// guard.js - decides when PasallyGlance must stay silent. When in doubt, suppress.
(function () {
  const AUC = (globalThis.AUC = globalThis.AUC || {});

  // Hostnames where the extension is fully disabled. User-editable in Options.
  // Seeded conservatively; add your bank, broker, health portal, etc.
  let BLOCKLIST = ["accounts.google.com", "paypal.com"];

  // Track active drag so the chip never pops up mid-selection.
  let dragging = false;
  document.addEventListener("mousedown", () => { dragging = true; }, true);
  document.addEventListener("mouseup", () => { dragging = false; }, true);

  AUC.guard = {
    setBlocklist(list) {
      if (Array.isArray(list)) BLOCKLIST = list;
    },

    // Whole-page kill switch. Supports "example.com" and "*.example.com".
    pageDisabled() {
      const host = location.hostname;
      return BLOCKLIST.some((p) =>
        p.startsWith("*.")
          ? host === p.slice(2) || host.endsWith(p.slice(1))
          : host === p || host.endsWith("." + p)
      );
    },

    // Per-target suppression. Returns true when we must NOT arm.
    suppressed(el) {
      if (!el) return true;

      // While actively dragging a selection, stay out of the way.
      if (dragging) return true;

      // Never interfere with sensitive fields or active typing.
      const ae = document.activeElement;
      if (ae && /^(input|textarea)$/i.test(ae.tagName)) {
        if (/password|email|tel|number/i.test(ae.type || "")) return true;
      }
      const tag = el.tagName ? el.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return true;

      // Don't fire on our own UI.
      if (el.closest && el.closest("[data-auc-ui]")) return true;

      return false;
    },
  };
})();
