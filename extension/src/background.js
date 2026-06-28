// background.js - service worker. Routes each model call either straight to
// Anthropic with the user's own key (BYO), or through our Supabase proxy with a
// Supabase session token (managed/free-trial). Also owns the right-click menu
// and Supabase sign-in (Google + email code).

// --- deployment config (replace for your Supabase project) ------------------
const SUPABASE_URL = "https://gmzdpvbpmplhymmiqele.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtemRwdmJwbXBsaHltbWlxZWxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjUwMzQsImV4cCI6MjA5ODI0MTAzNH0._8ACH5mugHFgIgd-s6p0M9OWzjx04Hzpu3aWc73HL-s";
const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"; // optional — for Google sign-in
const FUNCTIONS = SUPABASE_URL + "/functions/v1";

// --- right-click menu -------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    try {
      chrome.contextMenus.create({
        id: "auc-ask",
        title: "Ask AI about this",
        contexts: ["selection", "image", "link", "page"],
      });
    } catch (_) {}
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "auc-ask" || !tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "auc-context", info }).catch(() => {});
});

// --- model streaming over the page port -------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "auc") return;
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "run") return;
    try {
      await run(port, msg.payload);
    } catch (e) {
      try { port.postMessage({ type: "error", error: String((e && e.message) || e) }); } catch (_) {}
    }
  });
});

async function run(port, payload) {
  const { apiKey, plan, sessionToken } = await chrome.storage.local.get({
    apiKey: "", plan: "free", sessionToken: "",
  });
  const wantManaged =
    (plan === "pro_managed" && sessionToken) || (!apiKey && sessionToken);
  if (wantManaged) return runManaged(port, payload);
  if (apiKey) return runByo(port, payload, apiKey);
  port.postMessage({
    type: "error",
    error: "No API key set. Add your key or sign in in the extension Options.",
  });
}

async function runByo(port, payload, apiKey) {
  const { model, messages, system, tools } = payload;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model, max_tokens: 1024, stream: true, system, messages, ...(tools ? { tools } : {}) }),
  });
  await streamUpstream(port, res);
}

async function runManaged(port, payload) {
  let token = (await chrome.storage.local.get({ sessionToken: "" })).sessionToken;
  let res = await proxyFetch(payload, token);
  if (res.status === 401) {
    const fresh = await tryRefresh();
    if (fresh) res = await proxyFetch(payload, fresh);
  }
  if (res.status === 401) {
    port.postMessage({ type: "error", error: "Your session expired - sign in again in Options." });
    return;
  }
  await streamUpstream(port, res);
}

function proxyFetch(payload, token) {
  return fetch(FUNCTIONS + "/proxy", {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY, authorization: "Bearer " + token },
    body: JSON.stringify({ model: payload.model, messages: payload.messages, system: payload.system, tools: payload.tools }),
  });
}

async function streamUpstream(port, res) {
  if (!res.ok) {
    const t = await res.text();
    let msg = t;
    try { const j = JSON.parse(t); if (j && j.error) msg = j.error; } catch (_) {}
    port.postMessage({ type: "error", error: "API " + res.status + ": " + String(msg).slice(0, 180) });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const json = line.slice(5).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const evt = JSON.parse(json);
        if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
          port.postMessage({ type: "delta", text: evt.delta.text });
        } else if (evt.type === "error") {
          port.postMessage({ type: "error", error: (evt.error && evt.error.message) || "stream error" });
        }
      } catch (_) {}
    }
  }
  port.postMessage({ type: "done" });
}

// --- account: Supabase auth (driven by the Options page) --------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;
  const reply = (p) => p.then(sendResponse).catch((e) => sendResponse({ error: String((e && e.message) || e) }));
  if (msg.type === "auc-signin-google") { reply(signInGoogle()); return true; }
  if (msg.type === "auc-email-send") { reply(sendEmailCode(msg.email)); return true; }
  if (msg.type === "auc-email-verify") { reply(verifyEmailCode(msg.email, msg.code)); return true; }
  if (msg.type === "auc-signout") { signOut().then(() => sendResponse({ ok: true })); return true; }
  if (msg.type === "auc-refresh-entitlements") { reply(refreshEntitlements()); return true; }
  if (msg.type === "auc-checkout") { reply(getCheckout(msg.tier)); return true; }
});

async function storeSession(data) {
  const set = { sessionToken: data.access_token || "", refreshToken: data.refresh_token || "" };
  if (data.user && data.user.email) set.email = data.user.email;
  await chrome.storage.local.set(set);
}

async function signInGoogle() {
  const redirectUri = chrome.identity.getRedirectURL();
  const nonce = crypto.randomUUID();
  const url =
    "https://accounts.google.com/o/oauth2/v2/auth" +
    "?client_id=" + encodeURIComponent(GOOGLE_CLIENT_ID) +
    "&response_type=id_token&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&scope=" + encodeURIComponent("openid email") +
    "&nonce=" + nonce + "&prompt=select_account";
  const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const idToken = new URLSearchParams(new URL(redirect).hash.slice(1)).get("id_token");
  if (!idToken) throw new Error("sign-in did not return a token");
  const r = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=id_token", {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ provider: "google", id_token: idToken }),
  });
  if (!r.ok) throw new Error("authentication failed");
  await storeSession(await r.json());
  return refreshEntitlements();
}

async function sendEmailCode(email) {
  const r = await fetch(SUPABASE_URL + "/auth/v1/otp", {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!r.ok) throw new Error("could not send the code");
  return { ok: true };
}

async function verifyEmailCode(email, code) {
  const r = await fetch(SUPABASE_URL + "/auth/v1/verify", {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ type: "email", email, token: code }),
  });
  if (!r.ok) throw new Error("invalid or expired code");
  await storeSession(await r.json());
  return refreshEntitlements();
}

async function tryRefresh() {
  const { refreshToken } = await chrome.storage.local.get({ refreshToken: "" });
  if (!refreshToken) return null;
  const r = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  await storeSession(data);
  return data.access_token;
}

async function refreshEntitlements() {
  let token = (await chrome.storage.local.get({ sessionToken: "" })).sessionToken;
  if (!token) return { plan: "free" };
  const call = (t) =>
    fetch(SUPABASE_URL + "/rest/v1/rpc/entitlements", {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, authorization: "Bearer " + t, "content-type": "application/json" },
      body: "{}",
    });
  let r = await call(token);
  if (r.status === 401) { token = await tryRefresh(); if (token) r = await call(token); }
  if (!r.ok) throw new Error("could not load account");
  const me = await r.json();
  await chrome.storage.local.set({
    plan: me.plan || "free",
    features: me.features || [],
    quota: me.quota || null,
    dailyRemaining: me.dailyRemaining == null ? null : me.dailyRemaining,
  });
  return me;
}

async function getCheckout(tier) {
  let token = (await chrome.storage.local.get({ sessionToken: "" })).sessionToken;
  if (!token) throw new Error("not signed in");
  const call = (t) =>
    fetch(FUNCTIONS + "/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY, authorization: "Bearer " + t },
      body: JSON.stringify({ tier }),
    });
  let r = await call(token);
  if (r.status === 401) { token = await tryRefresh(); if (token) r = await call(token); }
  if (!r.ok) throw new Error("checkout failed");
  return r.json();
}

async function signOut() {
  await chrome.storage.local.set({
    sessionToken: "", refreshToken: "", plan: "free", features: [], email: "", quota: null, dailyRemaining: null,
  });
}
