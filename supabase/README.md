# PasallyGlance — Supabase backend

Replaces the old Cloudflare Worker. All dashboard-driven — no CLI needed.
(`../pasallyglance-server` is superseded; you can ignore/delete it.)

## What's here

- `schema.sql` — tables, the new-user trigger, metering (`bump_usage`), and the
  `entitlements()` function the extension reads.
- `functions/proxy/index.ts` — streams Claude, meters server-side (3/day free,
  monthly for managed), never stores content.
- `functions/checkout/index.ts` — creates a Paddle transaction → checkout URL.
- `functions/paddle-webhook/index.ts` — subscription → plan.

## Setup (Supabase dashboard)

**1. Project.** Create (or pick) a Supabase project. From **Project Settings → API**, copy:
- **Project URL** (`https://xxxx.supabase.co`)
- **anon public** key
You'll paste both into the extension's `background.js` later.

**2. Database.** **SQL Editor → New query** → paste all of `schema.sql` → **Run**.

**3. Auth — email code.** **Authentication → Providers → Email**: make sure it's enabled.
To send a 6-digit **code** (not a magic link, which doesn't work well in an extension):
**Authentication → Email Templates → Magic Link** → set the body to include
`{{ .Token }}` (e.g. "Your PasallyGlance code is: {{ .Token }}").

**4. Auth — Google (optional, can do later).** **Authentication → Providers → Google**:
add your Google OAuth **Client ID** + secret, and under "Authorized Client IDs" add the
same client ID the extension uses. (Email code works with zero Google setup, so you can
skip this to start.)

**5. Edge Functions.** **Edge Functions → Create a function**, once per function. For each,
paste the matching `index.ts`:
- `proxy` — Verify JWT: **ON**
- `checkout` — Verify JWT: **ON**
- `paddle-webhook` — Verify JWT: **OFF**  ← important (Paddle has no Supabase token)

**6. Secrets.** **Edge Functions → Secrets** (or Project Settings → Edge Functions) → add:
| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your `sk-ant-…` key |
| `PADDLE_API_BASE` | `https://api.paddle.com` |
| `PADDLE_API_KEY` | your Paddle API key (`pdl_…`) |
| `PADDLE_PRICE_PRO` | `pri_…` ($5) |
| `PADDLE_PRICE_MANAGED` | `pri_…` ($9.99) |
| `PADDLE_WEBHOOK_SECRET` | `pdl_ntfset_…` (from step 7) |

> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
> automatically — don't add them.

**7. Paddle webhook.** In Paddle → Developer Tools → Notifications, set the destination URL to:
`https://xxxx.supabase.co/functions/v1/paddle-webhook`
Subscribe to `subscription.created/activated/updated/canceled`, copy the signing secret
into `PADDLE_WEBHOOK_SECRET` (step 6).

**8. Extension.** In `pasallyglance/src/background.js`, set `SUPABASE_URL` and
`SUPABASE_ANON_KEY` to the values from step 1.

## Endpoints the extension uses

| Purpose | Call |
|---|---|
| Email: send code | `POST {URL}/auth/v1/otp` (apikey) `{email}` |
| Email: verify code | `POST {URL}/auth/v1/verify` (apikey) `{type:"email",email,token}` |
| Google sign-in | `POST {URL}/auth/v1/token?grant_type=id_token` (apikey) `{provider:"google",id_token}` |
| Refresh | `POST {URL}/auth/v1/token?grant_type=refresh_token` (apikey) `{refresh_token}` |
| Entitlements | `POST {URL}/rest/v1/rpc/entitlements` (apikey + Bearer) |
| Model call | `POST {URL}/functions/v1/proxy` (Bearer) |
| Checkout | `POST {URL}/functions/v1/checkout` (Bearer) `{tier}` |
