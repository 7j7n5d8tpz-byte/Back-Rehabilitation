// Run: node --test supabase/functions/health-ingest/parse_test.ts
// Fixtures follow Health Auto Export's documented shapes. Replace them with a real payload
// from Manual Export once the automation is set up; the assertions should still hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePayload, parseWorkout, isoTime, safeEqual } from "./parse.ts";

const v2Run = {
  id: "8F1C2A44-0C3B-4E4B-9D1D-5B2B7E7D9A10",
  name: "Outdoor Run",
  start: "2026-11-08 09:14:03 +0100",
  end: "2026-11-08 09:49:15 +0100",
  duration: 2112,
  distance: { qty: 5.42, units: "km" },
  heartRate: { min: { qty: 98, units: "bpm" }, avg: { qty: 141.4, units: "bpm" }, max: { qty: 156, units: "bpm" } },
  stepCadence: { qty: 168.2, units: "spm" },
  elevationUp: { qty: 18, units: "m" },
  route: [{ lat: 55.67, lon: 12.56 }]
};

const v1Run = {
  name: "Running",
  start: "2026-11-10 18:02:00 +0100",
  end: "2026-11-10 18:27:30 +0100",
  distance: { qty: 2.9, units: "mi" },
  avgHeartRate: { qty: 139, units: "count/min" },
  maxHeartRate: { qty: 151, units: "count/min" },
  elevation: { ascent: 40, descent: 41, units: "ft" }
};

test("v2 outdoor run maps every field", () => {
  const r = parseWorkout(v2Run)!;
  assert.equal(r.run_date, "2026-11-08");
  assert.equal(r.started_at, "2026-11-08T09:14:03+01:00");
  assert.equal(r.duration_min, 35.2);
  assert.equal(r.distance_km, 5.42);
  assert.equal(r.avg_hr, 141);
  assert.equal(r.max_hr, 156);
  assert.equal(r.cadence_spm, 168);
  assert.equal(r.elevation_m, 18);
  assert.equal(r.external_id, v2Run.id);
  assert.equal("route" in (r.raw as object), false, "GPS track is not stored");
});

test("v1 run: miles, feet, duration from start/end, id from start", () => {
  const r = parseWorkout(v1Run)!;
  assert.equal(r.duration_min, 25.5);
  assert.equal(r.distance_km, 4.67);
  assert.equal(r.avg_hr, 139);
  assert.equal(r.elevation_m, 12);
  assert.equal(r.cadence_spm, null);
  assert.equal(r.external_id, "2026-11-10T18:02:00+01:00");
});

test("Danish workout names count as runs; other workouts are dropped", () => {
  assert.ok(parseWorkout({ ...v2Run, name: "Løb indendørs" }));
  assert.equal(parseWorkout({ ...v2Run, name: "Traditional Strength Training" }), null);
  assert.equal(parseWorkout({ ...v2Run, name: "Outdoor Walk" }), null);
});

test("implausible values become null instead of failing the row", () => {
  const r = parseWorkout({ ...v2Run, heartRate: { avg: { qty: 400 } }, stepCadence: { qty: "x" } })!;
  assert.equal(r.avg_hr, null);
  assert.equal(r.cadence_spm, null);
  assert.equal(parseWorkout({ ...v2Run, duration: 20 }), null, "under a minute is not a run");
  assert.equal(parseWorkout({ ...v2Run, start: "yesterday", duration: undefined }), null);
});

test("payload: both shapes, duplicates collapsed, bad shape flagged", () => {
  const walk = { ...v2Run, id: "w1", name: "Outdoor Walk" };
  const a = parsePayload({ data: { workouts: [v2Run, v2Run, walk, v1Run] } });
  assert.equal(a.seen, 4);
  assert.equal(a.rows.length, 2);
  assert.equal(parsePayload({ workouts: [v1Run] }).rows.length, 1);
  assert.equal(parsePayload({ data: { metrics: [] } }).seen, -1);
  assert.equal(parsePayload(null).seen, -1);
});

test("isoTime and safeEqual", () => {
  assert.equal(isoTime("2026-11-08T09:14:03Z"), "2026-11-08T09:14:03Z");
  assert.equal(isoTime("2026-11-08 09:14 -0130"), "2026-11-08T09:14:00-01:30");
  assert.equal(isoTime("nope"), null);
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
});
