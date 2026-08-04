// Cloudflare Worker — a tiny visitor counter backed by Workers KV.
//
// One-time setup (all in the Cloudflare dashboard, free tier):
//   1. Workers & Pages → Create → Worker → give it a name → paste this file → Deploy.
//   2. Storage & Databases → KV → Create a namespace (e.g. "visitor_counter").
//   3. Your Worker → Settings → Bindings → Add → KV Namespace:
//        Variable name:  COUNTER      (must match the code below)
//        KV namespace:   visitor_counter
//      Save, then Deploy again.
//   4. Copy the Worker's URL (https://<name>.<subdomain>.workers.dev) and paste it
//      into index.html, in the "Visitor counter" <script> (the API constant).
//
// API:
//   GET <url>         -> { "count": N }          read only
//   GET <url>?hit=1   -> increment, then return   count one visit
//
// Notes:
//   - Access-Control-Allow-Origin is "*", so the static GitHub Pages site can call it.
//   - KV has no atomic increment; under heavy concurrent traffic the count can be off
//     by a little. That's fine for a vanity visitor counter. (Use a Durable Object if
//     you ever need exact counts.)
//   - You OWN this code and the KV value: export the value and move this same Worker to
//     any other serverless host if you ever leave Cloudflare — no lock-in.

export default {
  async fetch(request, env) {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "content-type": "application/json",
      "cache-control": "no-store",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    let count = parseInt(await env.COUNTER.get("count"), 10) || 0;
    if (new URL(request.url).searchParams.get("hit") === "1") {
      count += 1;
      await env.COUNTER.put("count", String(count));
    }
    return new Response(JSON.stringify({ count }), { headers });
  },
};
