# EVMs website — deployment notes

## What's included
- `index.html` — the complete site. Single file, no build step. Drop it on
  Cloudflare Pages (or any static host) as-is.
- `og-image.png` — a 512×512 real identity from the collection, for the
  social-preview meta tags.
- `worker/` — a Cloudflare Worker that proxies GTD applications to Google
  Forms server-side and prevents duplicate wallet submissions via KV.

## Two things I could not fill in myself
1. **The Google Form ID.** You gave me the three `entry.*` field IDs, but
   not the form's own ID or share URL — I don't have it and won't invent
   one. Open your form's "Get link" or look at its edit URL
   (`https://docs.google.com/forms/d/<FORM_ID>/edit`) and drop `<FORM_ID>`
   into `worker/wrangler.toml` (`GOOGLE_FORM_ID`).
2. **A real domain for the OG image.** Social platforms need an absolute
   URL for preview images, not a relative path. After deploying, replace
   `REPLACE_WITH_DEPLOYED_DOMAIN` in `index.html`'s `<meta property="og:image">`
   and `twitter:image` tags with your real deployed domain.

## Deploying the Worker (required for the GTD form to actually submit)
The site's "Apply for GTD" button posts to a Worker, not directly to Google
Forms — a browser can't read Google Forms' response due to CORS, so without
a server-side hop the client has no reliable way to know whether a
submission truly succeeded. That's also where duplicate-wallet checking
lives.

```
cd worker
wrangler kv:namespace create APPLICANTS
# paste the returned id into wrangler.toml under [[kv_namespaces]]
# set GOOGLE_FORM_ID in wrangler.toml
wrangler deploy
```

Then in `index.html`, set `CONFIG.workerEndpoint` (inside the `<script>`
block) to your deployed Worker's URL, e.g.
`https://evms-gtd-proxy.<your-subdomain>.workers.dev`.

## What was and wasn't tested here
This was built and statically checked in a sandboxed environment with no
network access — I could not:
- exercise a real MetaMask connection against a live page,
- actually call Google Forms or a deployed Worker,
- verify Cloudflare Pages/Workers behavior directly.

What I did verify:
- HTML tag balance (no unclosed/mismatched elements),
- the embedded JavaScript parses cleanly (`node --check`),
- the wallet-connect code uses the standard EIP-1193 pattern
  (`eth_requestAccounts` / `eth_accounts` / `accountsChanged`) that MetaMask
  and other injected wallets implement,
- the Worker's duplicate-check-then-submit-then-record ordering, so a
  submission is only recorded after Google Forms confirms it.

Test the wallet connect, form submission, and duplicate handling against a
real MetaMask install and your deployed Worker before pointing real users
at it.

## Honesty notes baked into the copy
- "Disconnect" only clears the site's local state — injected wallets like
  MetaMask don't expose a real programmatic disconnect; the extension
  itself stays connected until revoked from the wallet's own UI. The code
  comment and this note exist so that's never misrepresented to a user.
- No X/like/repost verification is automated — the form only collects the
  link for manual review, matching what was specified.
- The success screen only renders after the Worker returns a real success
  response, never optimistically.
