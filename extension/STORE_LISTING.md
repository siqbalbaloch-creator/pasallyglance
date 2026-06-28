# Chrome Web Store — listing & submission

Everything needed to fill out the Web Store developer dashboard for PasallyGlance.
Replace bracketed placeholders before submitting.

## Identity

- **Name:** PasallyGlance
- **Category:** Productivity
- **Summary** (≤132 chars): Select or right-click anything for an instant, context-aware Claude answer. Privacy-first, with one-tap source verification.

## Detailed description

> Turn any web page into a conversation. Select text or right-click an image,
> link, table, or email, and PasallyGlance gives you an instant answer from
> Claude — streamed into a tidy popover right where you're reading. No
> tab-switching, no copy-paste.
>
> • Explain, summarize, translate, identify images, draft replies, extract tables
>   — the actions adapt to whatever you picked.
> • Ask follow-ups in the same popover and upgrade any answer to a stronger model.
> • Verify (Pro): re-check an answer against live web sources, claim by claim,
>   marked Supported / Unverified / Contradicted with source links.
> • Gmail: drop a drafted reply straight into your compose box.
>
> Privacy-first by design. Nothing leaves your machine until you tap an action.
> Bring your own Anthropic API key and content goes straight to Anthropic — there
> is no backend in the loop. Prefer not to manage a key? Sign in for free trial
> asks or a managed plan; even then we relay to Anthropic and never store your
> prompts or answers.
>
> Calm by default: the chip only appears on selection or right-click, and you can
> disable it per-site. Built on Claude, your key, no platform lock-in.

## Single-purpose statement (required)

> PasallyGlance has one purpose: to send content the user explicitly selects or
> right-clicks to Anthropic's Claude API and display the AI-generated response in
> a popover on the page.

## Permission justifications (required)

| Permission | Justification |
|---|---|
| `storage` | Store the user's API key, model and behavior preferences, blocklist, and (if signed in) account/session tokens locally on the device. |
| `contextMenus` | Add the "Ask AI about this" right-click menu entry so the user can invoke the assistant on a selection, image, link, or page. |
| `identity` | Optional Google Sign-In (via `launchWebAuthFlow`) for users who choose an account-based free trial or managed plan. |
| Host `https://api.anthropic.com/*` | Send the user-selected content to Anthropic's Claude API to generate a response when the user activates an action (bring-your-own-key mode). |
| Host `https://[your-worker-domain]/*` | Relay requests to Anthropic for free-trial and managed plans, where we attach the API key and meter usage. |
| Content scripts on `<all_urls>` | The assistant must be available on any page the user reads. Context classification is local and no network request is made until the user taps an action. |

## Data-use disclosures (Privacy practices form)

- **Personally identifiable information:** Email address — collected only if the user signs in, used for account login. Not sold; not used for advertising.
- **Authentication information:** The user's Anthropic API key and session token are stored locally on the device.
- **Website content:** Content the user explicitly selects or right-clicks is transmitted to Anthropic (and, on managed plans, relayed via our server) to generate a response. Prompt/answer content is not stored by us.
- **We certify:** data is not sold; data use is limited to the single purpose above; no creditworthiness/lending use.
- **Privacy policy URL:** https://[your-domain]/privacy.html

## Assets checklist

- [x] Icons 16/32/48/128 (in `icons/`)
- [ ] Screenshots — 1280×800 or 640×400, 1–5 PNGs. Suggested shot list:
  1. The selection chip + action row over a real article (e.g. the World Cup page).
  2. A streamed answer in the panel with a follow-up.
  3. **Verify** result — claims marked ✓/⚠/✗ with source links (the differentiator shot).
  4. The right-click "Ask AI about this" menu.
  5. Options page showing account + plan.
- [ ] Small promo tile — 440×280 PNG (recommended).
- [ ] (Optional) Marquee promo — 1400×560 PNG.

## Pre-submit checklist

- [ ] Replace `API_BASE`, `GOOGLE_CLIENT_ID` in `src/background.js`, and the proxy host in `manifest.json`.
- [ ] Add a manifest `"key"` so the extension ID (and the Google OAuth redirect URI) is stable.
- [ ] Privacy policy + terms pages live (see `../pasallyglance-site`).
- [ ] $5 developer registration paid; 2FA enabled on the account.
- [ ] Package: zip the **contents** of this folder so `manifest.json` is at the zip root (do not include the parent folder, `STORE_LISTING.md`, or `CLAUDE.md` is fine to omit).
