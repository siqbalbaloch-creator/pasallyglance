// ui.js - chip, conversation panel, instruction input (Shadow DOM, CSS-proof).
(function () {
  const AUC = (globalThis.AUC = globalThis.AUC || {});

  const LABELS = {
    explain: "Explain", summarize: "Summarize", translate: "Translate",
    preview: "Preview", safe: "Is it safe?",
    describe: "Describe", ocr: "Extract text", identify: "What is this?",
    findbug: "Find the bug", comment: "Add comments", keypoints: "Key points",
    tocsv: "Copy as CSV", reply: "Draft reply", replyas: "Reply with\u2026",
    actions: "Action items", ask: "Ask\u2026",
  };

  let host, root, hideTimer, anchorX = 0, anchorY = 0, rafPending = false, pinned = false;

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  }
  function mdToHtml(src) {
    const lines = escapeHtml(src).split("\n");
    let html = "", inList = false;
    const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
    for (const line of lines) {
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += "<li>" + inline(line.replace(/^\s*[-*]\s+/, "")) + "</li>";
        continue;
      }
      closeList();
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { html += '<div class="h">' + inline(h[2]) + "</div>"; continue; }
      if (line.trim() === "") { html += '<div class="sp"></div>'; continue; }
      html += "<div>" + inline(line) + "</div>";
    }
    closeList();
    return html;
  }

  function flash(btn, text) {
    if (!btn) return;
    const old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = btn.dataset.label; }, 1200);
  }
  function fallbackCopy(text, btn) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-1000px;left:-1000px";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      flash(btn, "Copied");
    } catch (_) {}
  }
  function copyText(text, btn) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => flash(btn, "Copied"), () => fallbackCopy(text, btn));
      } else fallbackCopy(text, btn);
    } catch (_) { fallbackCopy(text, btn); }
  }

  const LOADER = '<div class="loading"><span class="d"></span><span class="d"></span><span class="d"></span></div>';

  function mount() {
    if (host) return;
    host = document.createElement("div");
    host.setAttribute("data-auc-ui", "");
    root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.wrap{position:fixed;font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;z-index:2147483647}' +
      '.chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:#111;color:#fff;' +
      'border-radius:999px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);user-select:none;white-space:nowrap}' +
      '.spark{font-size:11px;opacity:.9}' +
      '.menu{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;max-width:320px}' +
      '.menu button{font:12px sans-serif;background:#fff;color:#111;border:1px solid #ddd;' +
      'border-radius:8px;padding:4px 8px;cursor:pointer}' +
      '.menu button:hover{background:#f2f2f2}' +
      '.panel,.aucbox{margin-top:6px;width:360px;background:#fff;color:#111;border:1px solid #e3e3e3;' +
      'border-radius:12px;padding:10px 12px;box-shadow:0 8px 30px rgba(0,0,0,.18)}' +
      '.meta{font:11px sans-serif;color:#999;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px}' +
      '.meta .acts{display:flex;gap:8px}' +
      '.meta button{border:0;background:none;color:#666;cursor:pointer;font:11px sans-serif;padding:0}' +
      '.meta button:hover{color:#111}' +
      '.conv{overflow:auto;display:flex;flex-direction:column;gap:8px}' +
      '.turn{font-size:13px;line-height:1.5}' +
      '.turn.you{color:#444;background:#f1f3f5;border-radius:8px;padding:5px 8px;align-self:flex-end;max-width:88%}' +
      '.turn.ai div{margin:0}.turn.ai .sp{height:8px}' +
      '.conv .h{font-weight:600;margin:8px 0 2px}' +
      '.conv strong{font-weight:600}' +
      '.conv code{background:#f0f0f0;border-radius:4px;padding:1px 4px;font:12px ui-monospace,monospace}' +
      '.conv ul{margin:4px 0;padding-left:18px}.conv li{margin:2px 0}' +
      '.err{color:#b00020}' +
      '.followup{display:none;margin-top:8px;gap:6px;align-items:flex-end}' +
      '.followup textarea{flex:1;resize:none;border:1px solid #ccc;border-radius:8px;padding:6px 8px;font:13px sans-serif;outline:none}' +
      '.followup .fsend{border:0;background:#111;color:#fff;border-radius:8px;padding:7px 12px;cursor:pointer;font:12px sans-serif}' +
      '.inrow{display:flex;gap:6px;align-items:flex-end}' +
      '.inrow textarea{flex:1;resize:none;border:1px solid #ccc;border-radius:8px;padding:6px 8px;font:13px sans-serif;outline:none}' +
      '.inrow .send{border:0;background:#111;color:#fff;border-radius:8px;padding:7px 12px;cursor:pointer;font:12px sans-serif}' +
      '.loading{display:flex;gap:4px;padding:3px 0}' +
      '.loading .d{width:6px;height:6px;border-radius:50%;background:#bbb;animation:auc-bounce 1s infinite ease-in-out}' +
      '.loading .d:nth-child(2){animation-delay:.15s}.loading .d:nth-child(3){animation-delay:.3s}' +
      '@keyframes auc-bounce{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}' +
      '</style><div class="wrap" style="display:none"></div>';
    document.documentElement.appendChild(host);

    document.addEventListener("keydown", (e) => { if (e.key === "Escape") AUC.ui.hide(); }, true);
    document.addEventListener("mousedown", (e) => {
      if (pinned && e.composedPath && e.composedPath().indexOf(host) === -1) AUC.ui.hide();
    }, true);
  }

  function wrap() { return root.querySelector(".wrap"); }
  function clearPanels() {
    const w = wrap();
    const p = w.querySelector(".panel"); if (p) p.remove();
    const b = w.querySelector(".aucbox"); if (b) b.remove();
  }

  function reposition() {
    const w = wrap();
    const m = 8;
    const r = w.getBoundingClientRect();
    let left = anchorX + 12;
    if (left + r.width > window.innerWidth - m) left = anchorX - r.width - 12;
    if (left + r.width > window.innerWidth - m) left = window.innerWidth - r.width - m;
    if (left < m) left = m;
    let top = anchorY + 12;
    if (top + r.height > window.innerHeight - m) top = window.innerHeight - r.height - m;
    if (top < m) top = m;
    w.style.left = left + "px";
    w.style.top = top + "px";
  }
  function repositionSoon() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; reposition(); });
  }

  // Controller over a conversation panel: stream turns, echo follow-ups, etc.
  function makeController(panel) {
    const conv = panel.querySelector(".conv");
    const followup = panel.querySelector(".followup");
    let lastAi = null;

    function newAiTurn(replace) {
      if (replace && lastAi) lastAi.el.remove();
      const el = document.createElement("div");
      el.className = "turn ai";
      el.innerHTML = LOADER;
      conv.appendChild(el);
      conv.scrollTop = conv.scrollHeight;
      let raw = "", pending = false;
      const render = () => {
        pending = false;
        el.innerHTML = mdToHtml(raw);
        conv.scrollTop = conv.scrollHeight;
        reposition();
      };
      const renderSoon = () => { if (pending) return; pending = true; requestAnimationFrame(render); };
      lastAi = { el, get text() { return raw; } };
      reposition();
      return { append: (t) => { raw += t; renderSoon(); } };
    }

    return {
      stream: () => newAiTurn(false),
      streamReplaceLast: () => newAiTurn(true),
      userTurn(text) {
        const el = document.createElement("div");
        el.className = "turn you";
        el.textContent = text;
        conv.appendChild(el);
        conv.scrollTop = conv.scrollHeight;
        reposition();
      },
      error(m) {
        if (lastAi) lastAi.el.innerHTML = '<span class="err">\u26a0 ' + escapeHtml(m) + "</span>";
        reposition();
      },
      done() { followup.style.display = "flex"; reposition(); },
      setModel(label) { panel.querySelector(".model").textContent = "via " + label; },
      getLastAnswer() { return lastAi ? lastAi.text : ""; },
    };
  }

  AUC.ui = {
    showChip(x, y, ctx, onAction) {
      mount();
      clearTimeout(hideTimer);
      pinned = false;
      anchorX = x; anchorY = y;
      const w = wrap();
      w.style.display = "block";
      const actions = ctx.actions
        .map((a) => '<button data-a="' + a + '">' + (LABELS[a] || a) + "</button>")
        .join("");
      w.innerHTML =
        '<div class="chip"><span class="spark">\u2726</span> Ask AI \u00b7 ' + ctx.label + "</div>" +
        '<div class="menu" style="display:none">' + actions + "</div>";
      const chip = w.querySelector(".chip");
      const menu = w.querySelector(".menu");
      chip.onclick = () => {
        menu.style.display = menu.style.display === "none" ? "flex" : "none";
        reposition();
      };
      menu.querySelectorAll("button").forEach((b) => { b.onclick = () => onAction(b.dataset.a); });
      w.onmouseenter = () => clearTimeout(hideTimer);
      w.onmouseleave = () => AUC.ui.scheduleHide();
      reposition();
    },

    openInput(placeholder, onSubmit) {
      mount();
      const w = wrap();
      pinned = true;
      clearPanels();
      const box = document.createElement("div");
      box.className = "aucbox";
      box.innerHTML =
        '<div class="meta"><span>Tell me what to write</span>' +
        '<span class="acts"><button class="close">\u00d7</button></span></div>' +
        '<div class="inrow"><textarea class="in" rows="2"></textarea>' +
        '<button class="send">Send</button></div>';
      w.appendChild(box);
      const ta = box.querySelector(".in");
      ta.placeholder = placeholder;
      const submit = () => { const v = ta.value.trim(); if (v) onSubmit(v); };
      box.querySelector(".send").onclick = submit;
      box.querySelector(".close").onclick = () => AUC.ui.hide();
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
      });
      reposition();
      ta.focus();
    },

    // A one-off message (clipboard confirmations, setup notices, etc.).
    message(text, isError) {
      mount();
      const w = wrap();
      pinned = true;
      clearPanels();
      const panel = document.createElement("div");
      panel.className = "panel";
      panel.innerHTML =
        '<div class="meta"><span></span><span class="acts"><button class="close">\u00d7</button></span></div>' +
        '<div class="conv"><div class="turn ai">' +
        (isError ? '<span class="err">\u26a0 ' + escapeHtml(text) + "</span>" : escapeHtml(text)) +
        "</div></div>";
      w.appendChild(panel);
      panel.querySelector(".close").onclick = () => AUC.ui.hide();
      reposition();
    },

    // Start a conversation panel.
    // handlers: { onDeeper, onFollowup(text), onInsert(text)->bool|null, onVerify }
    openPanel(modelLabel, handlers) {
      mount();
      handlers = handlers || {};
      const w = wrap();
      pinned = true;
      clearPanels();
      const panel = document.createElement("div");
      panel.className = "panel";
      panel.innerHTML =
        '<div class="meta"><span class="model"></span>' +
        '<span class="acts"><button class="verify" style="display:none">Verify</button>' +
        '<button class="deeper">Go deeper</button>' +
        '<button class="insert" style="display:none">Insert</button>' +
        '<button class="copy">Copy</button><button class="close">\u00d7</button></span></div>' +
        '<div class="conv"></div>' +
        '<div class="followup"><textarea class="fin" rows="1" placeholder="Ask a follow-up\u2026"></textarea>' +
        '<button class="fsend">Send</button></div>';
      w.appendChild(panel);

      panel.querySelector(".conv").style.maxHeight = Math.max(140, Math.min(340, window.innerHeight - 200)) + "px";
      panel.querySelector(".model").textContent = "via " + modelLabel;

      const ctrl = makeController(panel);
      const copyBtn = panel.querySelector(".copy");
      const insertBtn = panel.querySelector(".insert");

      panel.querySelector(".deeper").onclick = handlers.onDeeper || (() => {});
      if (handlers.onVerify) {
        const vb = panel.querySelector(".verify");
        vb.style.display = "inline";
        vb.onclick = handlers.onVerify;
      }
      panel.querySelector(".close").onclick = () => AUC.ui.hide();
      copyBtn.onclick = () => copyText(ctrl.getLastAnswer(), copyBtn);
      if (handlers.onInsert) {
        insertBtn.style.display = "inline";
        insertBtn.onclick = () => {
          const ok = handlers.onInsert(ctrl.getLastAnswer());
          flash(insertBtn, ok ? "Inserted" : "No reply box");
        };
      }

      const fin = panel.querySelector(".fin");
      const submit = () => {
        const v = fin.value.trim();
        if (!v) return;
        fin.value = "";
        (handlers.onFollowup || (() => {}))(v);
      };
      panel.querySelector(".fsend").onclick = submit;
      fin.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
      });

      reposition();
      return ctrl;
    },

    scheduleHide(ms) {
      if (pinned) return;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => AUC.ui.hide(), ms || 450);
    },

    hide() {
      if (!root) return;
      pinned = false;
      const w = wrap();
      w.style.display = "none";
      w.innerHTML = "";
    },
  };
})();
