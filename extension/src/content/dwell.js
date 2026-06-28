// dwell.js - the dwell state machine. This is the whole ballgame: tune here.
//
// States: idle -> settling (debounce timer running) -> armed (chip shown).
//         suppressed (guard blocks target). engaged/streaming live in the runner.
// The timer restarts on every significant move and fires once movement stops.
(function () {
  const AUC = (globalThis.AUC = globalThis.AUC || {});

  AUC.Dwell = function Dwell(opts) {
    const cfg = Object.assign({ dwellMs: 700, jitter: 6, trigger: "off" }, opts);
    const onArm = opts.onArm;                 // (x, y, ctx) => void
    const onDisarm = opts.onDisarm || (() => {});

    let timer = null;
    let lastX = 0, lastY = 0;
    let armed = false;
    let enabled = true;
    let stashed = []; // [element, title] pairs whose native tooltips we hid

    function clear() { clearTimeout(timer); timer = null; }

    // Native title tooltips render above everything (OS layer) and would cover
    // the chip. Strip them off the hovered subtree while the chip is up, and
    // restore on disarm.
    function stashTitles(el) {
      let n = el;
      while (n && n !== document.body) {
        if (n.getAttribute && n.getAttribute("title")) {
          stashed.push([n, n.getAttribute("title")]);
          n.removeAttribute("title");
        }
        n = n.parentElement;
      }
    }
    function restoreTitles() {
      stashed.forEach((pair) => { try { pair[0].setAttribute("title", pair[1]); } catch (_) {} });
      stashed = [];
    }

    function disarm() {
      if (!armed) return;
      armed = false;
      restoreTitles();
      onDisarm();
    }

    // Is there a settled selection sitting under this point? Selection is a
    // deliberate gesture, so it always summons the chip regardless of mode.
    function selectionAt(x, y) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !String(sel).trim()) return false;
      try {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      } catch (_) { return false; }
    }

    function fire(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el || AUC.guard.suppressed(el)) return;
      const ctx = AUC.classify(el, x, y);
      if (!ctx) return;
      armed = true;
      stashTitles(el);
      onArm(x, y, ctx);
    }

    function onMove(e) {
      if (!enabled) return;
      const x = e.clientX, y = e.clientY;
      const moved = Math.hypot(x - lastX, y - lastY);

      // Tiny jitter while a timer is pending: treat as "still", don't reset.
      if (moved <= cfg.jitter && timer) return;
      lastX = x; lastY = y;

      // If armed and the pointer wandered off, retract the chip.
      if (armed && moved > cfg.jitter * 4) disarm();

      if (AUC.guard.suppressed(e.target)) { clear(); return; }

      // Selection always summons the chip; hover obeys the trigger mode.
      const overSel = selectionAt(x, y);
      const eager = cfg.trigger === "hover";
      if (!eager && !overSel) { clear(); return; }

      // Debounce: (re)start the timer; it fires once movement stops.
      clear();
      const delay = overSel ? 250 : cfg.dwellMs;
      timer = setTimeout(() => {
        timer = null;
        if (!eager && !selectionAt(x, y)) return;
        fire(x, y);
      }, delay);
    }

    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", clear);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { clear(); disarm(); }
    });

    // Finishing a selection should summon the chip even if the mouse then
    // holds perfectly still (no further mousemove to trigger onMove).
    document.addEventListener("mouseup", (e) => {
      const x = e.clientX, y = e.clientY;
      setTimeout(() => {
        if (!enabled || armed || !selectionAt(x, y)) return;
        lastX = x; lastY = y;
        clear();
        timer = setTimeout(() => { timer = null; if (selectionAt(x, y)) fire(x, y); }, 250);
      }, 0);
    });

    return {
      setDwellMs: (ms) => { cfg.dwellMs = ms; },
      setTrigger: (t) => { cfg.trigger = t; clear(); disarm(); },
      setEnabled: (v) => { enabled = v; if (!v) { clear(); disarm(); } },
      disarm,
    };
  };
})();
