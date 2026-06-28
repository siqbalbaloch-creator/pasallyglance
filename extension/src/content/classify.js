// classify.js - turn whatever is under the cursor into a typed context.
(function () {
  const AUC = (globalThis.AUC = globalThis.AUC || {});
  AUC.adapters = AUC.adapters || []; // site adapters push { match, extract }

  const MIN_IMG = 64; // ignore icons / sprites smaller than this

  // True text under the cursor: the caret must land on a non-empty text node
  // whose glyph actually sits under the pointer (not snapped from empty space).
  function textUnderCursor(x, y) {
    let node = null, offset = 0;
    if (document.caretPositionFromPoint) {
      const c = document.caretPositionFromPoint(x, y);
      if (c) { node = c.offsetNode; offset = c.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    if (!node || node.nodeType !== 3) return null;
    const s = node.textContent || "";
    if (!s.trim()) return null;
    try {
      const range = document.createRange();
      const i = Math.min(offset, Math.max(0, s.length - 1));
      range.setStart(node, i);
      range.setEnd(node, Math.min(i + 1, s.length));
      const rect = range.getBoundingClientRect();
      const pad = 6;
      if (x < rect.left - pad || x > rect.right + pad || y < rect.top - pad || y > rect.bottom + pad) return null;
    } catch (_) {}
    return node;
  }

  // Climb to the nearest block holding a paragraph's worth of text.
  function climbText(startNode, el) {
    let cur = startNode && startNode.nodeType === 3 ? startNode.parentElement : (startNode || el);
    if (!cur) cur = el;
    let best = cur;
    for (let i = 0; i < 6 && cur; i++) {
      const t = (cur.innerText || "").trim();
      best = cur;
      if (t.length >= 40) break;
      cur = cur.parentElement;
    }
    const text = (best.innerText || "").trim();
    return text.length > 1500 ? text.slice(0, 1500) : text;
  }

  function tableToCsv(table) {
    const out = [];
    table.querySelectorAll("tr").forEach((tr) => {
      const vals = [];
      tr.querySelectorAll("th,td").forEach((c) => {
        let v = (c.innerText || "").replace(/\s+/g, " ").trim();
        if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
        vals.push(v);
      });
      if (vals.length) out.push(vals.join(","));
    });
    return out.join("\n");
  }

  // Tell a real data table apart from a layout table (which wraps prose).
  function isDataTable(table) {
    const role = (table.getAttribute("role") || "").toLowerCase();
    if (role === "presentation" || role === "none") return false;
    if (table.querySelector("table")) return false;
    if ((table.innerText || "").length > 4000) return false;
    if (table.querySelector("th")) return true;
    const firstRow = table.querySelector("tr");
    const cols = firstRow ? firstRow.children.length : 0;
    const rows = table.querySelectorAll("tr").length;
    return rows >= 2 && cols >= 2;
  }

  // Distinguish a standalone / URL-ish link from an inline content link.
  function looksLikeUrl(s) {
    return /^https?:\/\//i.test(s) || /^www\.[a-z0-9.-]+/i.test(s) ||
      /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s);
  }
  function isNavLink(link, para) {
    const anchor = (link.innerText || "").replace(/\s+/g, " ").trim();
    if (!anchor) return true;
    if (looksLikeUrl(anchor)) return true;
    if (para && para.length <= anchor.length + 25) return true;
    return false;
  }

  const TEXT_ACTIONS = ["explain", "summarize", "translate", "ask"];
  AUC.TEXT_ACTIONS = TEXT_ACTIONS;

  AUC.classify = function (el, x, y) {
    if (!el) return null;

    // 0) Selection under the cursor wins.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      const selText = String(sel).trim();
      if (selText) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return { type: "text", label: "Selection", text: selText.slice(0, 4000), actions: TEXT_ACTIONS };
        }
      }
    }

    // 1) Site adapters (e.g. an open Gmail message).
    for (const a of AUC.adapters) {
      try { if (a.match(el)) { const ctx = a.extract(el); if (ctx) return ctx; } } catch (_) {}
    }

    // 2) Video (real <video> or known embed/link).
    const vid = el.closest && el.closest(
      'video, iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"], iframe[src*="vimeo.com"], a[href*="youtube.com/watch"], a[href*="youtu.be/"], a[href*="vimeo.com/"]'
    );
    if (vid) {
      const url = vid.src || vid.href || location.href;
      return { type: "video", label: "Video", text: "Video title: " + document.title + "\nURL: " + url,
        actions: ["summarize", "keypoints", "ask"] };
    }

    // 3) Image
    let img = null;
    if (el.tagName === "IMG") img = el;
    else if (el.closest) img = el.closest("img");
    if (img && img.naturalWidth >= MIN_IMG && img.naturalHeight >= MIN_IMG) {
      return { type: "image", label: "Image", imageUrl: img.currentSrc || img.src,
        actions: ["identify", "describe", "ocr", "ask"] };
    }

    // 4) Code
    const code = el.closest && el.closest("pre, code");
    if (code) {
      return { type: "code", label: "Code", text: code.innerText.trim().slice(0, 4000),
        actions: ["explain", "findbug", "comment", "ask"] };
    }

    // 5) Table - genuine data tables only.
    const table = el.closest && el.closest("table");
    if (table && isDataTable(table)) {
      return { type: "table", label: "Table", text: table.innerText.trim().slice(0, 4000),
        csv: tableToCsv(table), actions: ["explain", "summarize", "ask", "tocsv"] };
    }

    // 6) Link - standalone/URL links get vetting; inline prose links act as text.
    const link = el.closest && el.closest("a[href]");
    const glyph = textUnderCursor(x, y);
    if (link) {
      const para = climbText(glyph, el);
      const anchor = (link.innerText || "").replace(/\s+/g, " ").trim();
      if (isNavLink(link, para)) {
        return { type: "link", label: "Link",
          text: 'Link: "' + anchor.slice(0, 200) + '" -> ' + link.href, actions: ["preview", "safe"] };
      }
      if (para && para.length >= 3) {
        return { type: "text", label: "Text", text: para, actions: TEXT_ACTIONS };
      }
    }

    // 7) Text - only when a real glyph sits under the cursor.
    if (glyph) {
      const text = climbText(glyph, el);
      if (text && text.length >= 3) {
        return { type: "text", label: "Text", text, actions: TEXT_ACTIONS };
      }
    }

    return null;
  };
})();
