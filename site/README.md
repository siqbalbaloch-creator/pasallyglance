# PasallyGlance — landing site

Static marketing + legal site. Plain HTML/CSS, no build step. Deploy to Cloudflare
Pages or Vercel (point it at this folder; no framework, no install).

## Pages

- `index.html` — hero, how-it-works, verification pitch, pricing, FAQ
- `privacy.html` — privacy policy (required for the Chrome Web Store listing)
- `terms.html` — terms of service
- `success.html` — post-checkout return page (set this as the Paddle success URL)

## Placeholders to replace before publishing

Search the folder for these tokens and fill them in:

- `STORE_URL` — your published Chrome Web Store listing URL (in `index.html`)
- `SUPPORT_EMAIL` — your support/contact email (in all pages)

The privacy + terms pages are required:
- **Chrome Web Store** needs the privacy policy URL in the listing.
- **Paddle** needs links to terms + privacy in your seller settings.

## Deploy (Cloudflare Pages example)

```sh
# from this folder
npx wrangler pages deploy . --project-name pasallyglance-site
```

Then set your custom domain, and use `https://<domain>/success.html` as the
Paddle checkout success URL. Put the privacy + terms URLs in the store listing
and in Paddle.
