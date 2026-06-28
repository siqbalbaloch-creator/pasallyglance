// adapters/gmail.js - better context when hovering an open email in Gmail.
// Adapters are the per-site escape hatch from generic DOM guessing.
(function () {
  const AUC = (globalThis.AUC = globalThis.AUC || {});
  AUC.adapters = AUC.adapters || [];
  if (!/(^|\.)mail\.google\.com$/.test(location.hostname)) return;

  // Drop text straight into the open Gmail reply/compose box.
  AUC.gmailInsert = function (text) {
    const boxes = document.querySelectorAll(
      'div[aria-label="Message Body"][contenteditable="true"], div[g_editable="true"][contenteditable="true"], div[role="textbox"][contenteditable="true"]'
    );
    let box = null;
    boxes.forEach((b) => { if (b.offsetParent !== null) box = b; });
    if (!box) return false;
    box.focus();
    const html = String(text)
      .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))
      .replace(/\n/g, "<br>");
    try { document.execCommand("insertHTML", false, html); return true; }
    catch (_) {
      try { document.execCommand("insertText", false, text); return true; }
      catch (_2) { return false; }
    }
  };

  AUC.adapters.push({
    match(el) {
      return !!(el.closest && el.closest(".a3s, .a3s.aiL"));
    },
    extract(el) {
      const body = el.closest(".a3s, .a3s.aiL");
      if (!body) return null;
      const text = body.innerText.trim().slice(0, 6000);
      if (!text) return null;
      return {
        type: "email",
        label: "Email",
        text,
        actions: ["reply", "replyas", "summarize", "actions"],
      };
    },
  });
})();
