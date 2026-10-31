// Back Rehab Tracker API.
// The UI is a static page hosted elsewhere (Supabase forces text/plain on HTML served
// from *.supabase.co, so it cannot host the page itself). This function is data only.
// JWT verification is off because the browser calls it directly; it authenticates every
// data action with a passcode instead, and the tables are sealed by RLS with no policies.

const SB = Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "content-type": "application/json" };

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

async function rest(path: string, init: any = {}) {
  const headers = Object.assign({}, H, init.headers || {});
  const r = await fetch(SB + "/rest/v1/" + path, Object.assign({}, init, { headers }));
  const t = await r.text();
  if (!r.ok) throw new Error(t || ("status " + r.status));
  return t ? JSON.parse(t) : null;
}

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
}

async function getSettings() {
  const rows = await rest("settings?id=eq.1&select=*");
  return rows && rows[0] ? rows[0] : null;
}

async function requireAuth(passcode: string) {
  const s = await getSettings();
  if (!s || !s.passcode_hash) throw new Error("NO_PASSCODE");
  const h = await sha(String(passcode || ""));
  if (h !== s.passcode_hash) throw new Error("BAD_PASSCODE");
  return s;
}

function json(o: any, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: Object.assign({ "content-type": "application/json" }, CORS)
  });
}

// A positive integer row id, or null. Guards the PATCH/DELETE endpoints against a
// malformed id being interpolated into a PostgREST filter.
function rowId(v: any): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// A 0-10 pain score, or null. The column has a CHECK constraint; clamping here turns a
// bad client value into a stored null rather than a 500 that loses the whole entry.
function painScore(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : null;
}

// Copy only the keys the caller is allowed to set, and only when they were actually sent.
// Anything absent from the body is left untouched in the database.
function pick(body: any, map: Record<string, string>) {
  const row: Record<string, any> = {};
  for (const k in map) {
    if (Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined) row[map[k]] = body[k];
  }
  return row;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (req.method === "GET") {
    return new Response("Back Rehab Tracker API. POST only.", {
      headers: Object.assign({ "content-type": "text/plain" }, CORS)
    });
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch (_e) { return json({ error: "bad json" }, 400); }
  const action = body.action;

  try {
    if (action === "status") {
      const s = await getSettings();
      return json({ hasPasscode: !!(s && s.passcode_hash) });
    }

    if (action === "setPasscode") {
      const s = await getSettings();
      if (s && s.passcode_hash) return json({ error: "already set" }, 400);
      const pc = String(body.passcode || "");
      if (pc.length < 4) return json({ error: "too short" }, 400);
      const h = await sha(pc);
      await rest("settings?id=eq.1", { method: "PATCH", body: JSON.stringify({ passcode_hash: h, program_start: body.programStart || null }) });
      return json({ ok: true });
    }

    const s = await requireAuth(body.passcode);

    if (action === "bootstrap") {
      // The progression chart reads the whole training history, so the session limit is
      // generous: 400 covers well over two years at three sessions a week.
      const sessions = await rest("sessions?select=*&order=session_date.desc,id.desc&limit=400");
      const checkins = await rest("checkins?select=*&order=checkin_date.desc&limit=180");
      const benchmarks = await rest("benchmarks?select=*&order=test_date.desc&limit=20");
      const flares = await rest("flares?select=*&order=started_on.desc&limit=20");
      const last: any = {};
      for (let i = sessions.length - 1; i >= 0; i--) {
        const lf = sessions[i].lifts || [];
        for (let j = 0; j < lf.length; j++) {
          if (lf[j] && lf[j].n) last[lf[j].n] = { load: lf[j].load, reps: lf[j].reps };
        }
      }
      return json({ settings: s, sessions, checkins, benchmarks, flares, lastLoads: last });
    }

    if (action === "saveSession") {
      const row = {
        session_date: body.date, phase: body.phase, week: body.week, day_code: body.day,
        // pain is what Andreas reports to his physio; traffic_light is derived from it in
        // the client and stored alongside because the flare ladder and the phase rules
        // are written in terms of the light.
        pain: painScore(body.pain),
        traffic_light: body.light, leg_symptoms: !!body.legSymptoms,
        symptom_note: body.symptomNote || null, lifts: body.lifts || [], notes: body.notes || null,
        // Which rung of the flare ladder this session was trained at, so a dip in the
        // loads is explained on the row itself rather than looking like lost strength.
        flare_stage: body.flareStage == null ? null : body.flareStage
      };
      const r = await rest("sessions", { method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=representation" } });
      return json({ ok: true, row: r && r[0] });
    }

    // Correct a session that was logged wrong. Only the fields present in the request
    // are changed, so the app can send just the lifts array or just the pain score.
    if (action === "updateSession") {
      const id = rowId(body.id);
      if (!id) return json({ error: "bad id" }, 400);
      const row = pick(body, {
        date: "session_date", light: "traffic_light", day: "day_code",
        phase: "phase", week: "week", lifts: "lifts", notes: "notes",
        symptomNote: "symptom_note", flareStage: "flare_stage"
      });
      if (Object.prototype.hasOwnProperty.call(body, "pain")) row.pain = painScore(body.pain);
      if (Object.prototype.hasOwnProperty.call(body, "legSymptoms")) row.leg_symptoms = !!body.legSymptoms;
      if (!Object.keys(row).length) return json({ error: "nothing to update" }, 400);
      const r = await rest("sessions?id=eq." + id, {
        method: "PATCH", body: JSON.stringify(row), headers: { Prefer: "return=representation" }
      });
      if (!r || !r.length) return json({ error: "not found" }, 404);
      return json({ ok: true, row: r[0] });
    }

    if (action === "deleteSession") {
      const id = rowId(body.id);
      if (!id) return json({ error: "bad id" }, 400);
      const r = await rest("sessions?id=eq." + id, {
        method: "DELETE", headers: { Prefer: "return=representation" }
      });
      if (!r || !r.length) return json({ error: "not found" }, 404);
      return json({ ok: true });
    }

    if (action === "saveCheckin") {
      const row = {
        checkin_date: body.date, pain: painScore(body.pain), traffic_light: body.light || null,
        home_routine: !!body.homeRoutine, walk_minutes: body.walkMinutes || null, notes: body.notes || null
      };
      const r = await rest("checkins?on_conflict=checkin_date", {
        method: "POST", body: JSON.stringify(row),
        headers: { Prefer: "resolution=merge-duplicates,return=representation" }
      });
      return json({ ok: true, row: r && r[0] });
    }

    if (action === "saveFlare") {
      const row = {
        started_on: body.date, severity: painScore(body.severity), leg_symptoms: !!body.legSymptoms,
        symptom_note: body.symptomNote || null, suspected_cause: body.cause || null, debrief: body.debrief || null
      };
      const r = await rest("flares", { method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=representation" } });
      return json({ ok: true, row: r && r[0] });
    }

    // Drives the adaptive flare mode: close a flare (resolvedOn), pin the return stage
    // manually (stageOverride + overrideOn), or fill in the debrief later.
    if (action === "updateFlare") {
      const id = rowId(body.id);
      if (!id) return json({ error: "bad id" }, 400);
      const row = pick(body, {
        resolvedOn: "resolved_on", stageOverride: "stage_override", overrideOn: "override_on",
        debrief: "debrief", cause: "suspected_cause", symptomNote: "symptom_note",
        date: "started_on"
      });
      if (Object.prototype.hasOwnProperty.call(body, "severity")) row.severity = painScore(body.severity);
      if (Object.prototype.hasOwnProperty.call(body, "legSymptoms")) row.leg_symptoms = !!body.legSymptoms;
      if (!Object.keys(row).length) return json({ error: "nothing to update" }, 400);
      const r = await rest("flares?id=eq." + id, {
        method: "PATCH", body: JSON.stringify(row), headers: { Prefer: "return=representation" }
      });
      if (!r || !r.length) return json({ error: "not found" }, 404);
      return json({ ok: true, row: r[0] });
    }

    if (action === "saveBenchmark") {
      const row = {
        test_date: body.date, calf_raise_l: body.calfL, calf_raise_r: body.calfR,
        side_plank_l: body.plankL, side_plank_r: body.plankR, bird_dog_hold: body.birdDog,
        balance_l: body.balL, balance_r: body.balR, walk_tolerance_min: body.walkTol,
        sit_tolerance_min: body.sitTol, notes: body.notes || null
      };
      const r = await rest("benchmarks", { method: "POST", body: JSON.stringify(row), headers: { Prefer: "return=representation" } });
      return json({ ok: true, row: r && r[0] });
    }

    if (action === "setStart") {
      await rest("settings?id=eq.1", { method: "PATCH", body: JSON.stringify({ program_start: body.programStart }) });
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    const m = String(e && e.message ? e.message : e);
    if (m === "BAD_PASSCODE" || m === "NO_PASSCODE") return json({ error: m }, 401);
    return json({ error: m }, 500);
  }
});
