# CLAUDE.md — PasallyGlance

Project memory for Claude Code. Read this before editing.

## What this is

PasallyGlance is a Manifest V3 Chrome extension — a context-aware AI assistant. The user **selects** text (a chip appears) or **right-clicks** anything (text, image, link, or the page) and gets an AI answer streamed into a Shadow-DOM panel, with follow-ups, a "go deeper" upgrade, copy, and Gmail insert. It's bring-your-own Anthropic key and privacy-first: there is no backend, and content only leaves the machine — straight to `api.anthropic.com` — when the user taps an action.

## Environment & workflow

- **No build step.** Plain JS/HTML/CSS, loaded unpacked. Dev machine is Windows ARM64.
- **Load / reload:** `chrome://extensions` → Developer mode → Load unpacked → select this folder. After any edit, click the reload icon on the card, then refresh the page you're testing on.
- **API key:** toolbar icon → Options → paste the Anthropic key (stored in `chrome.storage.local`).
- **Validate before reloading:**
  - JS syntax: `node --check src/content/main.js` (loop over all `src/**/*.js`).
  - Manifest: `python -c "import json; json.load(open('manifest.json'))"`.
- **Package for the store:** zip the *contents* of this folder so `manifest.json` sits at the zip root. Do not zip the parent folder.

## Mental model (the non-obvious parts)

- **One shared namespace.** Every content script hangs off `globalThis.AUC`. They load in dependency order, set by the `content_scripts` list in the manifest: `guard → classify → ui → dwell → adapters/gmail → main`. `main.js` is last and wires everything together. **Reordering that list breaks the extension.**
- **Internal prefix is `AUC` / `auc`; the product is PasallyGlance.** The namespace, DOM IDs, the background port name (`"auc"`), and the context-menu id (`"auc-ask"`) all still use the old `AUC` prefix. This is intentional and cosmetic — don't do a mass rename; several of these strings are load-bearing and must match across files.
- **Two stages, and nothing hits the network until stage two.** Selecting or right-clicking only *classifies* (local, zero API calls) and shows a chip or menu. The model is called **only** when the user taps an action. Keep classification and hover network-free — this is a privacy invariant, not just an optimization.

## File map

- `manifest.json` — MV3. Permissions: `storage`, `contextMenus`. Host permission: `https://api.anthropic.com/*`. Content scripts on `<all_urls>` at `document_idle` (list order = load order). Registers the icon, the toolbar action, and the options page.
- `src/background.js` — service worker. Streams from Anthropic's `/v1/messages` (parses SSE) and relays `delta` / `done` / `error` messages to the page over a port named `"auc"`. Accepts a full `messages` array (multi-turn). Owns the right-click context menu (id `"auc-ask"`, contexts: selection / image / link / page); it removes-all-then-creates on startup to avoid duplicate-id errors on reload.
- `src/content/guard.js` — `AUC.guard`: the "stay silent" rules. Suppresses inside password fields, inputs / textareas / contenteditable, the extension's own UI, and mid-drag; honors a blocklist and a per-page disable. When unsure, it suppresses.
- `src/content/classify.js` — `AUC.classify(el, x, y)` → a typed context object. **Order is deliberate:** selection → site adapters → video → image → code → table (gated by `isDataTable`, which rejects layout tables) → link (`isNavLink` splits standalone/URL links into a preview vs. inline-prose links treated as text) → text (gated by `textUnderCursor` so empty space never triggers a chip). Exposes `AUC.TEXT_ACTIONS`. Helpers: `textUnderCursor`, `climbText`, `tableToCsv`, `isDataTable`, `looksLikeUrl`, `isNavLink`.
- `src/content/ui.js` — `AUC.ui`: all DOM, isolated in a Shadow root. The chip; the conversation panel (follow-up box, "Go deeper", Copy with an `execCommand` fallback, Insert, × close); markdown rendering (`mdToHtml` — bold / code / headers / bullets, so answers are rendered, never shown raw); loading dots; viewport-aware repositioning; the instruction input (`openInput`); one-off notes (`message`); and pinned-panel dismissal (Esc / click-outside). The `makeController` object is the API the runner drives: `stream` / `streamReplaceLast` / `userTurn` / `done` / `error` / `setModel` / `getLastAnswer`.
- `src/content/dwell.js` — `AUC.Dwell`: the trigger state machine (debounced). Two modes: `"off"` (default — right-click + selection only) and `"hover"` (eager, opt-in). **Selection always summons the chip regardless of mode.** Exposes `setDwellMs` / `setTrigger` / `setEnabled`. There is no Alt-key mode — it was removed; don't reintroduce it.
- `src/content/adapters/gmail.js` — Gmail-specific context. Reads the open email body via the `.a3s` selector → reply / reply-as / summarize / action-items, plus `AUC.gmailInsert(text)` to drop a drafted reply into the compose box. Site adapters are the extension point for per-site smarts.
- `src/content/main.js` — the wiring.
  - `DEFAULTS` is the single source of truth for settings: `apiKey`, `quickModel: "claude-haiku-4-5-20251001"`, `deepModel: "claude-sonnet-4-6"`, `dwellMs: 700`, `trigger: "off"`, `translateTo: ""`, `dailyCap: 0`, `blocklist`.
  - Conversation runner: `startConversation` / `streamTurn` / `followup` / `goDeeper`.
  - `friendly()` maps API errors (401 / 429 / 529 / 400 / network) to human messages.
  - Usage cap: `underCap` / `bumpUsage`, persisted under the `aucUsage` key in `chrome.storage.local`.
  - `translatePrompt` — target language defaults to the browser's, overridable in settings.
  - `handleContext` — the right-click path: classify whatever was under the cursor when the menu opened.
  - `modelFor` — `identify` and "go deeper" route to `deepModel` (Sonnet); everything else uses `quickModel` (Haiku).
  - `PROMPTS` — per-action prompt templates.
  - On load it migrates old trigger values: `"dwell"` → `"hover"`, anything else → `"off"`.
- `src/options/options.html` + `options.js` — the settings page; reads/writes the same `chrome.storage.local` keys as `DEFAULTS`.
- `icons/` — `icon.svg` (source) plus 16 / 32 / 48 / 128 / 512 PNGs.

## Invariants & gotchas (don't trip these)

- No network in classification or hover. Model calls happen only on an explicit action tap.
- Don't reorder `content_scripts` — it's the load/dependency order.
- Image person-identification is **refused on purpose** (privacy). "What is this?" answers objects, landmarks, and products. Leave the refusal in.
- Follow-ups resend the whole thread, so token cost grows with conversation length; `dailyCap` is the backstop. Weigh that before adding auto-context.
- Adding a setting means touching four places: `DEFAULTS` (main.js), the control in `options.html`, the read/write in `options.js`, and wherever main.js consumes it.
- Map new API error shapes in `friendly()` rather than letting them surface raw.
- Copy keeps an `execCommand` fallback because clipboard access is unreliable inside content scripts — don't drop it.
- Model strings live in `DEFAULTS`; change them there, not scattered across files.

## Where it stands / what's next

- **Status:** complete enough to dogfood and packaged for the Chrome Web Store (assets + listing copy done; pending real screenshots and a privacy-policy page).
- **Differentiator to build next — a verification layer.** Let an answer be checked against its sources (claim → supporting / contradicting evidence), surfaced in the panel. This is the strategic wedge a generic horizontal assistant won't build, and it lines up with the verification-over-generation thesis behind EZWrite / PASally.
- **Competitive frame:** Google's Magic Pointer (Gemini-in-Chrome) is the head-on competitor. The defensible angles are (1) privacy-first + model-agnostic — BYO key, Claude, no Google lock-in — and (2) vertical document / verification depth Google won't tune for. Build toward those, not toward matching the generic horizontal tool.
- **Open product question (unresolved):** whether this stays a standalone horizontal tool or becomes the in-browser companion to PASally. The code is name-agnostic enough to go either way.

## Working style in this repo

- Terse and concrete; no ceremony.
- When handing back a prompt (for Claude Code or anything else), put the *entire* prompt in a single fenced code block so it gets a copy button, and don't nest code fences inside it — use indentation for any inner code.
- Prefer small, reviewable diffs; validate (`node --check` + manifest JSON parse) before declaring done.
