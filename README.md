# PasallyGlance

A privacy-first, context-aware AI assistant for the browser. Select or right-click
anything on a page for an instant Claude answer, with a one-tap verification layer
that checks the answer against live sources.

Operated by Korel (usekorel.com).

## Monorepo layout

```
extension/   Chrome extension (Manifest V3, plain JS — load unpacked)
site/        Marketing + legal site (static — deployed to Vercel, pasallyglance.com)
supabase/    Backend: Postgres migrations + Edge Functions (proxy, checkout, paddle-webhook)
```

## Backend (Supabase)

- `supabase/migrations/` — schema, the new-user trigger, metering, and the
  `entitlements()` function (3 free actions/day; monthly quota for managed plans).
- `supabase/functions/proxy/` — streams Claude, meters server-side, never stores content.
- `supabase/functions/checkout/` — creates a Paddle transaction → checkout URL.
- `supabase/functions/paddle-webhook/` — maps a Paddle subscription to the user's plan.

Setup steps are in `supabase/README.md`.

## Extension

Plain JS/HTML/CSS, no build step. Load unpacked from `extension/` at
`chrome://extensions`. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top of
`extension/src/background.js` before use.

## Plans

- **Free** — bring your own Anthropic key (unlimited, fully private), or sign in for
  3 free managed actions per day.
- **Pro ($5/mo)** — your key + premium features (verification, go-deeper, Gmail).
- **Pro Managed ($9.99/mo)** — we provide the key, with a monthly quota.
