// main.js - wiring. Settings -> dwell/context-menu -> chip -> conversation panel.
(function () {
  const AUC = (globalThis.AUC = globalThis.AUC || {});

  const DEFAULTS = {
    apiKey: "",
    quickModel: "claude-haiku-4-5-20251001",
    deepModel: "claude-sonnet-4-6",
    dwellMs: 700,
    trigger: "off",
    translateTo: "",
    dailyCap: 0,
    blocklist: ["accounts.google.com", "paypal.com"],
    // account state mirrored from the backend /me endpoint (see background.js)
    plan: "free",
    sessionToken: "",
    features: [],
  };

  const SYSTEM = "You are a fast in-browser assistant shown in a small popover. Answer briefly and directly, usually a few sentences. Use light markdown only when it genuinely helps (bold, short bullet lists); skip headings and preamble.";

  const PROMPTS = {
    explain: "Explain this clearly and concisely. If it is a single word or short phrase, define it plainly; if it is a longer passage, explain what it means or how it works.",
    summarize: "Summarize this in 2-3 sentences.",
    preview: "What is this link or page likely about? Be brief.",
    findbug: "Review this code and point out the most likely bug, briefly.",
    describe: "Describe this image concisely.",
    ocr: "Transcribe all text visible in this image. Output only the text.",
    identify: "Identify what is in this image as specifically as you can: name the place, landmark, building, product, brand, artwork, plant, animal, or media if recognizable. If the main subject is a person you cannot identify, just describe them and do not ask the user who they are. Be concise.",
    reply: "Write a concise, professional reply to this email. Output ONLY the reply body, starting directly with the greeting. No preamble (do not write things like 'Here is a reply'), no '---' separators, and no trailing name placeholder.",
    actions: "List the action items or asks in this email as short bullets.",
    comment: "Add concise, helpful inline comments to this code. Return the full commented code.",
    safe: "Considering only the hovered link's URL and text, is it likely safe or suspicious, and why? One or two sentences.",
    keypoints: "Give the key points of this video from its title and any available context. Note briefly if the information is limited.",
  };

  // Verification layer (Pro): re-check the last answer against live sources.
  const VERIFY_SYSTEM = "You are a rigorous fact-checker. Use web search to verify factual claims and cite sources with URLs. Be concise and honest about uncertainty.";
  const WEB_SEARCH_TOOLS = [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }];
  const VERIFY_PROMPT =
    "Fact-check your previous answer. Break it into distinct factual claims. " +
    "For each, use web search and judge it. Output a short markdown list where each item starts with " +
    "**✓ Supported**, **⚠ Unverified**, or **✗ Contradicted**, then the claim in a few words, " +
    "then ' — ' and a one-line reason with a source link. Finish with a one-line overall verdict. " +
    "Do not restate the original answer.";

  let settings = Object.assign({}, DEFAULTS);
  let dwell = null;
  let lastCtx = null;
  let convo = null;

  chrome.storage.local.get(DEFAULTS, (s) => {
    settings = Object.assign({}, DEFAULTS, s);
    settings.trigger = (settings.trigger === "hover" || settings.trigger === "dwell") ? "hover" : "off";
    AUC.guard.setBlocklist(settings.blocklist);
    if (AUC.guard.pageDisabled()) return; // no dwell on blocked sites
    start();
  });

  chrome.storage.onChanged.addListener((ch) => {
    for (const k in ch) settings[k] = ch[k].newValue;
    if (ch.blocklist) AUC.guard.setBlocklist(settings.blocklist);
    if (ch.dwellMs && dwell) dwell.setDwellMs(settings.dwellMs);
    if (ch.trigger && dwell) dwell.setTrigger(settings.trigger);
  });

  function modelFor(action) {
    return action === "identify" ? settings.deepModel : settings.quickModel;
  }
  function hasFeature(name) {
    return (settings.features || []).indexOf(name) !== -1;
  }
  function modelLabel(model) {
    return model.indexOf("haiku") !== -1 ? "Claude Haiku"
      : (model.indexOf("opus") !== -1 ? "Claude Opus" : "Claude Sonnet");
  }

  // Translate target: an explicit setting, else the browser's language.
  function targetLang() {
    if (settings.translateTo && settings.translateTo.trim()) return settings.translateTo.trim();
    const code = (navigator.language || "en").split("-")[0];
    try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || "English"; }
    catch (_) { return "English"; }
  }
  function translatePrompt() {
    const lang = targetLang();
    return "Translate this into " + lang + ". If it is already in " + lang +
      ", translate it into English instead. Output only the translation, nothing else.";
  }

  function start() {
    dwell = AUC.Dwell({
      dwellMs: settings.dwellMs,
      trigger: settings.trigger,
      onArm: (x, y, ctx) => {
        lastCtx = ctx;
        AUC.ui.showChip(x, y, ctx, (action) => run(action, modelFor(action)));
      },
      onDisarm: () => AUC.ui.scheduleHide(),
    });
  }

  // --- right-click fallback ---------------------------------------------------
  let ctxMenuPos = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 3) };
  document.addEventListener("contextmenu", (e) => { ctxMenuPos = { x: e.clientX, y: e.clientY }; }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "auc-context") handleContext(msg.info);
  });

  function handleContext(info) {
    if (AUC.guard.pageDisabled()) return;
    const x = ctxMenuPos.x, y = ctxMenuPos.y;
    let ctx = null;

    if (info.selectionText && info.selectionText.trim()) {
      ctx = { type: "text", label: "Selection", text: info.selectionText.trim().slice(0, 4000), actions: AUC.TEXT_ACTIONS };
    } else if (info.mediaType === "image" && info.srcUrl) {
      ctx = { type: "image", label: "Image", imageUrl: info.srcUrl, actions: ["identify", "describe", "ocr", "ask"] };
    } else {
      // Classify whatever sits under the right-click - picks up an email (via
      // the Gmail adapter), a table, a code block, a paragraph, etc.
      const el = document.elementFromPoint(x, y);
      ctx = el ? AUC.classify(el, x, y) : null;
      // Right-click is deliberate, so be lenient: grab nearby text if needed.
      if (!ctx && el) {
        const block = el.closest && el.closest("p,li,td,th,blockquote,article,section,div,span,a");
        const text = (((block || el).innerText) || "").trim().slice(0, 1500);
        if (text.length >= 3) ctx = { type: "text", label: "Text", text, actions: AUC.TEXT_ACTIONS };
      }
      if (!ctx && info.linkUrl) ctx = { type: "link", label: "Link", text: "Link: " + info.linkUrl, actions: ["preview", "safe"] };
    }

    if (!ctx) return;
    lastCtx = ctx;
    AUC.ui.showChip(x, y, ctx, (action) => run(action, modelFor(action)));
  }

  // --- soft daily spend guard -------------------------------------------------
  async function underCap() {
    const cap = settings.dailyCap || 0;
    if (!cap) return true;
    const today = new Date().toISOString().slice(0, 10);
    const { aucUsage } = await chrome.storage.local.get({ aucUsage: { date: today, count: 0 } });
    const u = aucUsage && aucUsage.date === today ? aucUsage : { date: today, count: 0 };
    return u.count < cap;
  }
  async function bumpUsage() {
    const today = new Date().toISOString().slice(0, 10);
    const { aucUsage } = await chrome.storage.local.get({ aucUsage: { date: today, count: 0 } });
    const u = aucUsage && aucUsage.date === today ? aucUsage : { date: today, count: 0 };
    u.count += 1;
    try { await chrome.storage.local.set({ aucUsage: u }); } catch (_) {}
  }

  function friendly(err) {
    const s = String(err || "");
    if (/\b401\b|invalid x-api-key|authentication_error/i.test(s)) return "Your API key looks invalid. Check it in the extension Options.";
    if (/\b402\b|daily free limit/i.test(s)) return "You've used your 3 free actions for today. Upgrade in the extension Options for more.";
    if (/quota reached/i.test(s)) return "You've hit your monthly limit. It resets next month, or add your own key in Options.";
    if (/BYO plan uses your own key/i.test(s)) return "You're on the bring-your-own-key plan - add your Anthropic key in Options.";
    if (/\b429\b|rate.?limit/i.test(s)) return "Rate limited or out of quota. Wait a few seconds and try again.";
    if (/\b529\b|overloaded/i.test(s)) return "The model is briefly overloaded. Please try again.";
    if (/\b400\b|invalid_request/i.test(s)) return "That request was rejected - the content may be too large.";
    if (/Failed to fetch|networkerror|load failed/i.test(s)) return "Couldn't reach the model. Check your connection.";
    return s.length > 140 ? s.slice(0, 140) + "\u2026" : s;
  }

  async function imageToBase64(url) {
    const res = await fetch(url); // may fail on cross-origin images
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(blob);
    });
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, dataUrl.indexOf(";"));
    return { media: meta, b64: dataUrl.slice(comma + 1) };
  }

  async function buildContent(promptText) {
    const ctx = lastCtx;
    if (ctx.type === "image") {
      const img = await imageToBase64(ctx.imageUrl);
      return [
        { type: "image", source: { type: "base64", media_type: img.media, data: img.b64 } },
        { type: "text", text: promptText },
      ];
    }
    return promptText + "\n\n---\n" + ctx.text;
  }

  // --- entry point: resolve the action, then run a conversation ---------------
  async function run(action, model) {
    const ctx = lastCtx;

    if (action === "tocsv") {
      try {
        await navigator.clipboard.writeText((ctx && ctx.csv) || "");
        const rows = ((ctx && ctx.csv) || "").split("\n").filter(Boolean).length;
        AUC.ui.message("Copied " + rows + " rows as CSV.");
      } catch (_) { AUC.ui.message("Clipboard was blocked by the page.", true); }
      return;
    }

    if (action === "ask" || action === "replyas") {
      const reply = action === "replyas";
      AUC.ui.openInput(
        reply ? "e.g. politely decline and ask them to resend the file" : "Ask anything about this\u2026",
        (instruction) => {
          const prompt = reply
            ? 'Write a concise, professional reply to this email following this instruction: "' + instruction +
              '". Output ONLY the reply body, starting at the greeting, with no preamble or separators.'
            : instruction;
          startConversation(prompt, model, { insertable: reply });
        }
      );
      return;
    }

    if (action === "translate") { startConversation(translatePrompt(), model, {}); return; }

    startConversation(PROMPTS[action] || "Help with this.", model, { insertable: action === "reply" });
  }

  async function startConversation(promptText, model, opts) {
    opts = opts || {};
    if (!settings.apiKey && !settings.sessionToken) { AUC.ui.message("Add your Anthropic key or sign in - in the extension Options.", true); return; }

    let content;
    try { content = await buildContent(promptText); }
    catch (_) { AUC.ui.message("Couldn't read this image (cross-origin).", true); return; }

    const insertable = !!(opts.insertable && AUC.gmailInsert && hasFeature("gmail"));
    convo = { messages: [{ role: "user", content }], model };
    convo.ctrl = AUC.ui.openPanel(modelLabel(model), {
      onDeeper: () => goDeeper(),
      onFollowup: (t) => followup(t),
      onInsert: insertable ? (txt) => AUC.gmailInsert(txt) : null,
      onVerify: hasFeature("verify") ? () => verify() : null,
    });
    streamTurn(false);
  }

  function followup(text) {
    if (!convo) return;
    convo.ctrl.userTurn(text);
    convo.messages.push({ role: "user", content: text });
    streamTurn(false);
  }

  // Verification: a new turn that fact-checks the previous answer with web search.
  function verify() {
    if (!convo) return;
    convo.messages.push({ role: "user", content: VERIFY_PROMPT });
    convo.model = settings.deepModel;
    convo.ctrl.setModel(modelLabel(convo.model));
    convo.ctrl.userTurn("Verify against sources");
    streamTurn(false, { system: VERIFY_SYSTEM, tools: WEB_SEARCH_TOOLS });
  }

  function goDeeper() {
    if (!convo) return;
    if (!hasFeature("deep")) { AUC.ui.message("Going deeper is a Pro feature - upgrade in the extension Options.", true); return; }
    if (convo.messages.length && convo.messages[convo.messages.length - 1].role === "assistant") {
      convo.messages.pop();
    }
    convo.model = settings.deepModel;
    convo.ctrl.setModel(modelLabel(convo.model));
    streamTurn(true);
  }

  async function streamTurn(replace, opts) {
    opts = opts || {};
    if (!convo) return;
    if (!(await underCap())) {
      convo.ctrl.error("Daily request limit reached (" + settings.dailyCap + "). Raise it in Options.");
      convo.ctrl.done();
      return;
    }
    bumpUsage();

    const sink = replace ? convo.ctrl.streamReplaceLast() : convo.ctrl.stream();
    let answer = "";
    const port = chrome.runtime.connect({ name: "auc" });
    port.onMessage.addListener((m) => {
      if (m.type === "delta") { answer += m.text; sink.append(m.text); }
      else if (m.type === "error") {
        convo.ctrl.error(friendly(m.error));
        if (convo.messages.length && convo.messages[convo.messages.length - 1].role === "user") {
          convo.messages.push({ role: "assistant", content: "(no response)" });
        }
        convo.ctrl.done();
        try { port.disconnect(); } catch (_) {}
      } else if (m.type === "done") {
        convo.messages.push({ role: "assistant", content: answer || "(no response)" });
        convo.ctrl.done();
        try { port.disconnect(); } catch (_) {}
      }
    });
    port.postMessage({ type: "run", payload: { model: convo.model, messages: convo.messages, system: opts.system || SYSTEM, tools: opts.tools } });
  }
})();
