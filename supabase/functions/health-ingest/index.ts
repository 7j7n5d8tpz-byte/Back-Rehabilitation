// Apple Health -> public.runs, fed by Health Auto Export's REST API automation.
// Auth: "Authorization: Bearer <HEALTH_INGEST_TOKEN>" (a function secret). JWT
// verification is off (config.toml) because the phone sends that secret, not a Supabase
// JWT. The function can only add running workouts; it never reads or returns data.
import { parsePayload, safeEqual } from "./parse.ts";

const SB = Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TOKEN = Deno.env.get("HEALTH_INGEST_TOKEN") || "";
const MAX_BYTES = 6 * 1024 * 1024; // turn route data off in the automation if this bites

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Refuse everything when the secret is unset, rather than accepting an empty bearer.
  const auth = req.headers.get("authorization") || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (TOKEN.length < 24 || !safeEqual(given, TOKEN)) return json({ error: "unauthorized" }, 401);

  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BYTES) return json({ error: "payload too large" }, 413);
  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ error: "payload too large" }, 413);

  let body: unknown;
  try { body = JSON.parse(text); } catch (_e) { return json({ error: "bad json" }, 400); }

  const { rows, seen } = parsePayload(body);
  if (seen < 0) return json({ error: "expected data.workouts[]" }, 400);
  if (!rows.length) return json({ ok: true, seen, runs: 0, inserted: 0 });

  // ignore-duplicates: a workout already stored is left exactly as it is, so the hourly
  // "previous 7 days" re-send never overwrites a correction or a confirmed back score.
  const r = await fetch(SB + "/rest/v1/runs?on_conflict=source,external_id", {
    method: "POST",
    headers: {
      apikey: KEY, Authorization: "Bearer " + KEY, "content-type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation"
    },
    body: JSON.stringify(rows)
  });
  const t = await r.text();
  // 5xx makes Health Auto Export log the failure and retry on its next run.
  if (!r.ok) return json({ error: "store failed", detail: t.slice(0, 300) }, 502);
  const inserted = t ? (JSON.parse(t) as unknown[]).length : 0;
  return json({ ok: true, seen, runs: rows.length, inserted });
});
