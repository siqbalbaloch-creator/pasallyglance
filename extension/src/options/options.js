const DEFAULTS = {
  apiKey: "",
  quickModel: "claude-haiku-4-5-20251001",
  deepModel: "claude-sonnet-4-6",
  dwellMs: 700,
  trigger: "off",
  translateTo: "",
  dailyCap: 0,
  blocklist: ["accounts.google.com", "paypal.com"],
};
// account state lives alongside settings but is managed by background.js
const ACCT = { sessionToken: "", plan: "free", email: "", quota: null, dailyRemaining: null };
const $ = (id) => document.getElementById(id);

function renderAccount(s) {
  const signedIn = !!s.sessionToken;
  $("loggedout").style.display = signedIn ? "none" : "";
  $("signout").style.display = signedIn ? "" : "none";
  $("up_pro").style.display = signedIn && s.plan === "free" ? "" : "none";
  $("up_managed").style.display = signedIn && s.plan !== "pro_managed" ? "" : "none";
  if (!signedIn) { $("acct").textContent = "Not signed in."; return; }
  const planName = s.plan === "pro_managed" ? "Pro Managed" : s.plan === "pro" ? "Pro" : "Free";
  let line = (s.email ? s.email + " — " : "") + planName + " plan";
  if (s.plan === "free") line += " · " + (s.dailyRemaining == null ? 3 : s.dailyRemaining) + " free actions left today";
  else if (s.plan === "pro_managed" && s.quota) line += " · " + s.quota.quickRemaining + " quick / " + s.quota.deepRemaining + " deep left";
  $("acct").textContent = line;
}

// --- settings form ----------------------------------------------------------
chrome.storage.local.get(DEFAULTS, (s) => {
  $("apiKey").value = s.apiKey;
  $("quickModel").value = s.quickModel;
  $("deepModel").value = s.deepModel;
  $("dwellMs").value = s.dwellMs;
  $("dwellLabel").textContent = s.dwellMs;
  $("trigger").value = (s.trigger === "hover" || s.trigger === "dwell") ? "hover" : "off";
  $("translateTo").value = s.translateTo;
  $("dailyCap").value = s.dailyCap;
  $("blocklist").value = (s.blocklist || []).join("\n");
});

$("dwellMs").oninput = () => { $("dwellLabel").textContent = $("dwellMs").value; };

$("save").onclick = () => {
  chrome.storage.local.set(
    {
      apiKey: $("apiKey").value.trim(),
      quickModel: $("quickModel").value.trim(),
      deepModel: $("deepModel").value.trim(),
      dwellMs: Number($("dwellMs").value),
      trigger: $("trigger").value,
      translateTo: $("translateTo").value.trim(),
      dailyCap: Number($("dailyCap").value) || 0,
      blocklist: $("blocklist").value.split("\n").map((s) => s.trim()).filter(Boolean),
    },
    () => {
      $("ok").textContent = "Saved";
      setTimeout(() => { $("ok").textContent = ""; }, 1500);
    }
  );
};

// --- account ----------------------------------------------------------------
chrome.storage.local.get(ACCT, renderAccount);
chrome.runtime.sendMessage({ type: "auc-refresh-entitlements" }, () => {
  void chrome.runtime.lastError; // ignore if not signed in / offline
  chrome.storage.local.get(ACCT, renderAccount);
});

$("signin").onclick = () => {
  $("acct").textContent = "Opening Google sign-in…";
  chrome.runtime.sendMessage({ type: "auc-signin-google" }, (res) => {
    if (chrome.runtime.lastError || (res && res.error)) { $("acct").textContent = "Sign-in failed. Try again."; return; }
    chrome.storage.local.get(ACCT, renderAccount);
  });
};

$("sendcode").onclick = () => {
  const email = $("email").value.trim();
  if (!email) { $("acct").textContent = "Enter your email first."; return; }
  $("acct").textContent = "Sending code…";
  chrome.runtime.sendMessage({ type: "auc-email-send", email }, (res) => {
    if (chrome.runtime.lastError || (res && res.error)) { $("acct").textContent = "Couldn't send the code."; return; }
    $("coderow").style.display = "flex";
    $("acct").textContent = "Code sent — check your email, then enter it below.";
  });
};

$("verifycode").onclick = () => {
  const email = $("email").value.trim();
  const code = $("code").value.trim();
  if (!email || !code) return;
  $("acct").textContent = "Verifying…";
  chrome.runtime.sendMessage({ type: "auc-email-verify", email, code }, (res) => {
    if (chrome.runtime.lastError || (res && res.error)) { $("acct").textContent = "Invalid or expired code."; return; }
    chrome.storage.local.get(ACCT, renderAccount);
  });
};

$("signout").onclick = () => {
  chrome.runtime.sendMessage({ type: "auc-signout" }, () => {
    void chrome.runtime.lastError;
    chrome.storage.local.get(ACCT, renderAccount);
  });
};

function startCheckout(tier) {
  $("acct").textContent = "Opening checkout…";
  chrome.runtime.sendMessage({ type: "auc-checkout", tier }, (res) => {
    if (chrome.runtime.lastError || !res || res.error || !res.checkoutUrl) {
      $("acct").textContent = "Couldn't start checkout. Try again.";
      return;
    }
    chrome.tabs.create({ url: res.checkoutUrl });
  });
}
$("up_pro").onclick = () => startCheckout("pro");
$("up_managed").onclick = () => startCheckout("pro_managed");
