// Edge Function: paddle-webhook
// Verifies Paddle's signature and maps a subscription to the user's plan.
// Dashboard: turn "Verify JWT" OFF (Paddle calls this without a Supabase JWT).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Paddle: `Paddle-Signature: ts=<ts>;h1=<hmac>`, signed over `<ts>:<rawBody>`.
async function verify(raw: string, header: string, secret: string): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const kv of header.split(";")) { const [k, v] = kv.split("="); parts[k] = v; }
  if (!parts.ts || !parts.h1) return false;
  const expected = await hmacHex(secret, parts.ts + ":" + raw);
  if (expected.length !== parts.h1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.h1.charCodeAt(i);
  return diff === 0;
}

function planForPrice(data: any): string | null {
  for (const it of (data?.items || [])) {
    const id = it?.price?.id;
    if (id === Deno.env.get("PADDLE_PRICE_MANAGED")) return "pro_managed";
    if (id === Deno.env.get("PADDLE_PRICE_PRO")) return "pro";
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const raw = await req.text();
    const sig = req.headers.get("paddle-signature") || "";
    const ok = await verify(raw, sig, Deno.env.get("PADDLE_WEBHOOK_SECRET")!);
    if (!ok) return new Response("bad signature", { status: 401 });

    const evt = JSON.parse(raw);
    const type = evt.event_type || "";
    const data = evt.data || {};
    const userId = data?.custom_data?.user_id;

    if (userId) {
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
      if (type === "subscription.canceled") {
        await admin.from("profiles").update({ plan: "free" }).eq("id", userId);
        await admin.from("subscriptions").upsert({ user_id: userId, status: "canceled" });
      } else if (type.startsWith("subscription.")) {
        const plan = planForPrice(data);
        if (plan) {
          await admin.from("profiles").update({ plan }).eq("id", userId);
          await admin.from("subscriptions").upsert({
            user_id: userId,
            paddle_subscription_id: data?.id || null,
            status: data?.status || "active",
            current_period_end: data?.current_billing_period?.ends_at || null,
          });
        }
      }
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500 });
  }
});
