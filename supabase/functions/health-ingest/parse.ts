// Turns a Health Auto Export "REST API" payload into rows for public.runs.
// Pure: no Deno or Node APIs, so the same file runs in the edge function and under
// `node --test` (parse_test.ts).
//
// Health Auto Export's field names have changed between its v1 and v2 export formats and
// are not formally versioned, so every field is read defensively: a number, or {qty},
// under any of the names it has been seen under. Anything unreadable becomes null rather
// than failing the batch, and the workout itself is kept in `raw` so a field we did not
// map can be backfilled later.

export type RunRow = {
  run_date: string;
  started_at: string | null;
  duration_min: number;
  distance_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  cadence_spm: number | null;
  elevation_m: number | null;
  source: "healthkit";
  external_id: string;
  raw: unknown;
};

const RUN_NAME = /run|løb/i;

// 12.3, "12.3", {qty: 12.3} -> 12.3; anything else -> null.
function qty(v: any): number | null {
  if (v && typeof v === "object" && "qty" in v) v = v.qty;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function units(v: any): string {
  return v && typeof v === "object" && typeof v.units === "string" ? v.units.toLowerCase() : "";
}
function first(w: any, keys: string[]): any {
  for (const k of keys) if (w[k] !== undefined && w[k] !== null) return w[k];
  return undefined;
}

// "2026-11-08 09:14:03 +0100" -> "2026-11-08T09:14:03+01:00". ISO strings pass through.
export function isoTime(s: any): string | null {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  let tz = m[3] || "Z";
  if (/^[+-]\d{4}$/.test(tz)) tz = tz.slice(0, 3) + ":" + tz.slice(3);
  const t = m[2].length === 5 ? m[2] + ":00" : m[2];
  const out = m[1] + "T" + t + tz;
  return Number.isNaN(Date.parse(out)) ? null : out;
}

function toKm(v: any): number | null {
  const n = qty(v);
  if (n == null) return null;
  const u = units(v);
  if (u === "mi") return n * 1.609344;
  if (u === "m") return n / 1000;
  if (u === "yd") return n * 0.0009144;
  return n; // km, or unitless (Health Auto Export's default unit is km)
}

function toMeters(v: any): number | null {
  const n = qty(v);
  if (n == null) return null;
  return units(v) === "ft" ? n * 0.3048 : n;
}

function hr(w: any, which: "avg" | "max"): number | null {
  const direct = qty(first(w, which === "avg" ? ["avgHeartRate", "averageHeartRate"] : ["maxHeartRate"]));
  if (direct != null) return direct;
  return w.heartRate && typeof w.heartRate === "object" ? qty(w.heartRate[which]) : null;
}

function round(n: number | null, dp = 0): number | null {
  if (n == null) return null;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

// The workout as stored: everything except the GPS track, which is large and maps where
// you live, and which nothing here uses.
function rawCopy(w: any) {
  const c: Record<string, unknown> = {};
  for (const k of Object.keys(w)) if (k !== "route" && k !== "routeData") c[k] = w[k];
  return c;
}

export function parseWorkout(w: any): RunRow | null {
  if (!w || typeof w !== "object") return null;
  const name = String(first(w, ["name", "workoutActivityType", "type"]) || "");
  if (!RUN_NAME.test(name)) return null;

  const start = isoTime(w.start);
  const end = isoTime(w.end);
  let seconds = qty(w.duration);
  if (seconds != null && units(w.duration) === "min") seconds *= 60;
  if (seconds == null && start && end) seconds = (Date.parse(end) - Date.parse(start)) / 1000;
  if (seconds == null || seconds < 60 || seconds >= 600 * 60) return null;

  const rawStart = typeof w.start === "string" ? w.start : "";
  const runDate = /^\d{4}-\d{2}-\d{2}/.test(rawStart) ? rawStart.slice(0, 10) : null; // the phone's local date
  if (!runDate) return null;

  const km = toKm(first(w, ["distance", "totalDistance"]));
  const cadence = qty(first(w, ["stepCadence", "cadence"]));
  const elev = first(w, ["elevationUp", "elevation"]);
  const ascent = elev && typeof elev === "object" && "ascent" in elev ? toMeters({ qty: elev.ascent, units: elev.units }) : toMeters(elev);

  const keep = (n: number | null, lo: number, hi: number) => (n != null && n >= lo && n <= hi ? n : null);
  return {
    run_date: runDate,
    started_at: start,
    duration_min: round(seconds / 60, 1) as number,
    distance_km: keep(round(km, 2), 0, 99),
    avg_hr: keep(round(hr(w, "avg")), 30, 250),
    max_hr: keep(round(hr(w, "max")), 30, 250),
    cadence_spm: keep(round(cadence), 60, 260),
    elevation_m: keep(round(ascent), 0, 5000),
    source: "healthkit",
    external_id: String(w.id || start || rawStart),
    raw: rawCopy(w)
  };
}

// Accepts {data: {workouts: [...]}} (the documented shape) or {workouts: [...]}.
export function parsePayload(body: any): { rows: RunRow[]; seen: number } {
  const list = body && body.data && Array.isArray(body.data.workouts) ? body.data.workouts
    : body && Array.isArray(body.workouts) ? body.workouts : null;
  if (!list) return { rows: [], seen: -1 };
  const rows: RunRow[] = [];
  const ids = new Set<string>();
  for (const w of list) {
    const r = parseWorkout(w);
    if (r && !ids.has(r.external_id)) { ids.add(r.external_id); rows.push(r); }
  }
  return { rows, seen: list.length };
}

// Constant-time string comparison for the bearer secret.
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}
