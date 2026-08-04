# Visitor counter (self-hosted on Cloudflare Workers + KV)

The homepage footer shows "You are visitor № N". The count is stored in **your own**
Cloudflare Worker + KV — no third-party counter service, free tier, and portable
(you can move it elsewhere later without losing the number).

## Deploy (once, ~5 minutes)

1. Sign in at <https://dash.cloudflare.com> (free account).
2. **Workers & Pages → Create → Worker → choose "Start with Hello World!"**
   (do NOT use the "Upload and deploy" / drag-and-drop tab — that's for static-asset
   projects and will warn about needing a build process). Name it, click **Deploy**,
   then open **`</> Edit code`**, select-all + delete the default, paste the contents of
   [`worker.js`](./worker.js), and **Deploy**.
3. **Storage & Databases → KV → Create namespace**, name it `visitor_counter`.
4. Back in the Worker → **Settings → Bindings → Add binding → KV namespace**:
   - Variable name: `COUNTER`
   - KV namespace: `visitor_counter`

   Save, then **Deploy** again.
5. Copy the Worker URL, e.g. `https://yikai-counter.<your-subdomain>.workers.dev`.
6. In `index.html`, find the **Visitor counter** `<script>` and set:
   ```js
   var API = 'https://yikai-counter.<your-subdomain>.workers.dev';
   ```
   Until you do this, the counter line stays hidden (the rest of the footer is unaffected).

## Test

- Open the Worker URL in a browser → `{"count":0}`.
- Add `?hit=1` → the number increments each reload.
- The homepage increments once per browser session (via `sessionStorage`), then just reads.

## Carry over an existing count (e.g. from the old easycounter)

No code change needed — just seed the KV value once:

1. Find the old total N (open the old counter in a **browser**; scripts are bot-blocked).
2. Cloudflare → **Storage & Databases → KV → `visitor_counter`** → set the key
   `count` to **N** (create it if missing). The next visit shows N+1 and continues.

## Optional hardening

- Restrict CORS: change `Access-Control-Allow-Origin: "*"` to
  `"https://yikai-wang.github.io"` (blocks other sites, but also blocks `file://` local
  preview).
- Anti-spam: the count can be inflated by hitting `?hit=1` directly. For a vanity counter
  this is usually fine; if it matters, add a per-IP rate limit or a shared secret header.

## Migrating away from Cloudflare later

`worker.js` is ~15 lines of standard JS. Export the KV value
(`count`) and drop the same handler onto Vercel / Netlify / Deno Deploy / a small VPS,
seed the stored value, and repoint the `API` URL. Your number carries over.
