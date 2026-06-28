// Edge Function: proxy
// Verifies the Supabase user, meters server-side, injects our Anthropic key,
// and streams the SSE response back. Never stores prompt/answer content.
// Dashboard: keep "Verify JWT" ON.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

const MODEL_TIERS: Record<string, string> = {
  "claude-haiku-4-5": "quick",
  "claude-haiku-4-5-20251001": "quick",
  "claude-sonnet-4-6": "deep",
};
const FREE_DAILY = 3;
const LIMITS: Record<string, number> = { quick: 500, deep: 100 };
const MAX_CHARS = 8000, MAX_MESSAGES = 50;

function json(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
function sanitizeTools(tools: any): any[] {
  if (!Array.isArray(tools)) return [];
  return tools.filter((t) => t && typeof t.type === "string" &&
    (t.type.startsWith("web_search") || t.type.startsWith("web_fetch"))).slice(0, 2);
}
function capMessages(messages: any[]) {
  for (const m of messages) {
    if (typeof m.content === "string") {
      if (m.content.length > MAX_CHARS) m.content = m.content.slice(0, MAX_CHARS);
    } else if (Array.isArray(m.content)) {
      for (const c of m.content)
        if (c && c.type === "text" && typeof c.text === "string" && c.text.length > MAX_CHARS)
          c.text = c.text.slice(0, MAX_CHARS);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json(401, { error: "not signed in" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json();
    const tier = MODEL_TIERS[body.model];
    if (!tier) return json(400, { error: "model not allowed" });

    const { data: profile } = await admin.from("profiles").select("plan").eq("id", user.id).maybeSingle();
    const plan = profile?.plan || "free";

    // --- admission control ---
    if (plan === "pro") return json(403, { error: "BYO plan uses your own key, not the proxy" });
    if (plan === "free") {
      const today = new Date().toISOString().slice(0, 10);
      const { data: u } = await admin.from("usage_daily").select("quick,deep")
        .eq("user_id", user.id).eq("day", today).maybeSingle();
      if (((u?.quick || 0) + (u?.deep || 0)) >= FREE_DAILY)
        return json(402, { error: "daily free limit reached" });
    } else if (plan === "pro_managed") {
      const ms = new Date(); ms.setUTCDate(1);
      const { data: rows } = await admin.from("usage_daily").select("quick,deep")
        .eq("user_id", user.id).gte("day", ms.toISOString().slice(0, 10));
      const used = (rows || []).reduce((a: number, r: any) => a + (tier === "deep" ? r.deep : r.quick), 0);
      if (used >= LIMITS[tier]) return json(429, { error: "monthly " + tier + " quota reached" });
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length > MAX_MESSAGES) return json(400, { error: "thread too long" });
    capMessages(messages);
    const tools = sanitizeTools(body.tools);

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: body.model, max_tokens: 1024, stream: true, system: body.system, messages, ...(tools.length ? { tools } : {}) }),
    });
    if (!upstream.ok) {
      const t = await upstream.text();
      return json(502, { error: "upstream " + upstream.status + ": " + t.slice(0, 180) });
    }

    // Count a successful start, then pipe the body untouched (no content stored).
    await admin.rpc("bump_usage", { uid: user.id, t: tier });

    return new Response(upstream.body, {
      status: 200,
      headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
