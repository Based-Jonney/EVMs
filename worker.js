/**
 * EVMs GTD application proxy.
 *
 * Why this exists: a browser can't POST to Google Forms directly and read
 * the response (Forms doesn't send CORS headers), so the client can't know
 * whether a submission actually succeeded. This Worker does the submission
 * server-side, where CORS doesn't apply, and only tells the client "success"
 * once Google actually returns one.
 *
 * It also owns duplicate-wallet prevention via Workers KV, keyed on wallet
 * address, so the same wallet can't submit twice.
 *
 * REQUIRED CONFIG (see README.md):
 *   - GOOGLE_FORM_ID   : the form's ID (from its share/edit URL), set below
 *                        or as a Worker environment variable.
 *   - KV namespace      : bind a KV namespace named APPLICANTS (wrangler.toml).
 */

const ENTRY_X_HANDLE = "entry.2047122748";
const ENTRY_WALLET = "entry.1457108902";
const ENTRY_LIKE_RT = "entry.2098374744";

const ALLOWED_ORIGIN = "*"; // tighten to your deployed domain before going live

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function isValidWallet(addr) {
  return typeof addr === "string" && /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const { xHandle, wallet, likeRt } = body || {};

    if (!xHandle || !isValidWallet(wallet) || !likeRt) {
      return new Response(JSON.stringify({ error: "Missing or invalid fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const walletKey = "wallet:" + wallet.toLowerCase();

    // ---- duplicate check ----
    const existing = await env.APPLICANTS.get(walletKey);
    if (existing) {
      return new Response(JSON.stringify({ error: "Wallet already submitted" }), {
        status: 409,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const GOOGLE_FORM_ID = env.GOOGLE_FORM_ID || "YOUR_GOOGLE_FORM_ID_HERE";
    if (GOOGLE_FORM_ID === "YOUR_GOOGLE_FORM_ID_HERE") {
      return new Response(JSON.stringify({ error: "Worker not configured: GOOGLE_FORM_ID is unset" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const formUrl = `https://docs.google.com/forms/d/e/${GOOGLE_FORM_ID}/formResponse`;
    const params = new URLSearchParams();
    params.set(ENTRY_X_HANDLE, xHandle);
    params.set(ENTRY_WALLET, wallet);
    params.set(ENTRY_LIKE_RT, likeRt);

    let formRes;
    try {
      formRes = await fetch(formUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Could not reach Google Forms" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    // Google Forms' formResponse endpoint returns 200 on success (a normal
    // confirmation page), even though it doesn't give structured JSON back.
    // A non-200/300 status here means the submission did not go through.
    if (!formRes.ok) {
      return new Response(JSON.stringify({ error: "Form submission failed upstream" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    // ---- record the applicant only after a confirmed successful submission ----
    await env.APPLICANTS.put(
      walletKey,
      JSON.stringify({ xHandle, likeRt, submittedAt: new Date().toISOString() })
    );

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  },
};
