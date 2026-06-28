// Edge Function: checkout
// Verifies the user, creates a Paddle transaction with custom_data.user_id,
// returns the hosted checkout URL. Dashboard: keep "Verify JWT" ON.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const j = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return j(401, { error: "not signed in" });

    const { tier } = await req.json(); // 'pro' | 'pro_managed'
    const priceId = tier === "pro_managed"
      ? Deno.env.get("PADDLE_PRICE_MANAGED")
      : Deno.env.get("PADDLE_PRICE_PRO");
    if (!priceId) return j(400, { error: "unknown tier" });

    const base = Deno.env.get("PADDLE_API_BASE") || "https://api.paddle.com";
    const r = await fetch(base + "/transactions", {
      method: "POST",
      headers: { authorization: "Bearer " + Deno.env.get("PADDLE_API_KEY"), "content-type": "application/json" },
      body: JSON.stringify({ items: [{ price_id: priceId, quantity: 1 }], custom_data: { user_id: user.id } }),
    });
    if (!r.ok) return j(502, { error: "paddle " + r.status + ": " + (await r.text()).slice(0, 180) });
    const d = await r.json();
    const checkoutUrl = d?.data?.checkout?.url;
    if (!checkoutUrl) return j(502, { error: "no checkout url — set a default payment link in Paddle" });
    return j(200, { checkoutUrl });
  } catch (e) {
    return j(500, { error: String((e as Error)?.message || e) });
  }
});
