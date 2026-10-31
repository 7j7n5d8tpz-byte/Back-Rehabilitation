// Self-check for back-rehab-app/logic.js, run against the real generated data in
// index.html (PROGRAM, FLARE, RUNPLAN), so a plan or programme edit is tested too.
//   node program-source/test_logic.mjs [path/to/app-folder]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(process.argv[2] || join(here, "..", "back-rehab-app"));
const RL = createRequire(import.meta.url)(join(appDir, "logic.js"));
const src = readFileSync(join(appDir, "index.html"), "utf8");
const block = src.slice(src.indexOf("// <<< GENERATED"), src.indexOf("// >>> END GENERATED"));
const { PROGRAM, FLARE, RUNPLAN: P, DELOADS } = new Function(block + "; return {PROGRAM, FLARE, RUNPLAN, DELOADS};")();

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };
const stage = (key) => FLARE.stages.find((s) => s.t.toLowerCase().startsWith(key));
const run = (id, date, min, slot) => ({ id, run_date: date, duration_min: min, slot: slot || null });

t("weeks: Monday start, Sunday end, null outside the plan", () => {
  assert.equal(RL.weekOf(P, "2026-11-01"), null);
  assert.equal(RL.weekOf(P, "2026-11-02").w, 1);
  assert.equal(RL.weekOf(P, "2026-11-08").w, 1);
  assert.equal(RL.weekOf(P, "2026-11-09").w, 2);
  assert.equal(RL.weekOf(P, "2027-05-09").w, 27);
  assert.equal(RL.weekOf(P, "2027-05-10"), null);
  assert.equal(RL.dow("2026-11-02"), 0);
  assert.equal(RL.dow("2026-11-08"), 6);
});

t("assignment: longest qualifying run is L, rest fill E then Q by date", () => {
  const wk = RL.weekOf(P, "2026-11-09"); // 25 / 30 / 40
  const a = RL.assignWeek([run(1, "2026-11-10", 26), run(2, "2026-11-12", 31), run(3, "2026-11-15", 42)], wk);
  assert.deepEqual(a.byId, { 1: "E", 2: "Q", 3: "L" });
});

t("assignment: a short shakeout never takes the long run", () => {
  const wk = RL.weekOf(P, "2026-11-09");
  const a = RL.assignWeek([run(1, "2026-11-10", 10)], wk);
  assert.equal(a.byId[1], "extra");
  assert.equal(a.done.L, undefined);
});

t("assignment: an explicit slot wins, even against the duration", () => {
  const wk = RL.weekOf(P, "2026-11-09");
  const a = RL.assignWeek([run(1, "2026-11-10", 45, "E"), run(2, "2026-11-14", 30)], wk);
  assert.equal(a.byId[1], "E");
  assert.equal(a.byId[2], "L"); // 30 >= half of 40
  assert.equal(a.done.Q, undefined);
});

t("assignment: runs outside the week are ignored; race day counts as RACE", () => {
  const wk = RL.weekOf(P, "2027-05-03");
  const a = RL.assignWeek([run(1, "2027-05-02", 60), run(2, "2027-05-09", 290), run(3, "2027-05-04", 30)], wk, P.race_date);
  assert.equal(a.byId[1], undefined);
  assert.equal(a.byId[2], "RACE");
  assert.equal(a.byId[3], "E");
});

const wk9 = RL.weekOf(P, "2026-12-28"); // build, strides in Q
const base = { plan: P, light: "green", legs: false, stage: null, quiet: 30 };

t("green day: as planned, quality kept once earned", () => {
  const r = RL.prescribe({ ...base, wk: wk9, slot: "Q" });
  assert.equal(r.min, 45);
  assert.equal(r.quality, true);
  assert.equal(r.blocked, false);
});

t("intensity gate: under 7 quiet days the Q is run easy at full length", () => {
  const r = RL.prescribe({ ...base, wk: wk9, slot: "Q", quiet: 3 });
  assert.equal(r.min, 45);
  assert.equal(r.quality, false);
  assert.match(r.reason, /7 days/);
  assert.equal(RL.quietDays("2026-12-30", [{ date: "2026-12-27", light: "amber" }, { date: "2026-12-29", light: "green" }]), 3);
  assert.equal(RL.quietDays("2026-12-30", []), 999);
});

t("amber: easy, 30 min cap, long run at 60%", () => {
  assert.equal(RL.prescribe({ ...base, wk: wk9, slot: "Q", light: "amber" }).min, 30);
  assert.equal(RL.prescribe({ ...base, wk: wk9, slot: "E", light: "amber" }).min, 30);
  assert.equal(RL.prescribe({ ...base, wk: wk9, slot: "L", light: "amber" }).min, 50); // 80 * .6 = 48 -> 50
  assert.equal(RL.prescribe({ ...base, wk: wk9, slot: "L", light: "amber" }).quality, false);
});

t("red or leg symptoms: no run", () => {
  assert.equal(RL.prescribe({ ...base, wk: wk9, slot: "E", light: "red" }).blocked, true);
  assert.equal(RL.prescribe({ ...base, wk: wk9, slot: "L", legs: true }).blocked, true);
  assert.match(RL.prescribe({ ...base, wk: P.weeks[26], slot: "RACE", light: "red" }).reason, /do not start/);
});

t("flare ladder: settle blocks, reintroduce is walk-run, rebuild halves and caps", () => {
  assert.equal(RL.prescribe({ ...base, wk: wk9, slot: "E", stage: stage("settle") }).blocked, true);
  const wr = RL.prescribe({ ...base, wk: wk9, slot: "L", stage: stage("reintro") });
  assert.equal(wr.walkrun, true);
  assert.equal(wr.min, 20);
  assert.equal(RL.prescribe({ ...base, wk: wk9, slot: "L", stage: stage("rebuild") }).min, 40); // 80 * 50% = 40 <= 45
  const wk22 = P.weeks[21]; // L 180
  assert.equal(RL.prescribe({ ...base, wk: wk22, slot: "L", stage: stage("rebuild") }).min, 45);
  assert.equal(RL.prescribe({ ...base, wk: wk22, slot: "L", stage: stage("re-load") }).min, 135);
  assert.equal(RL.prescribe({ ...base, wk: wk9, slot: "Q", stage: stage("full") }).quality, false);
});

t("flare plus amber: the smaller of the two wins", () => {
  const r = RL.prescribe({ ...base, wk: P.weeks[21], slot: "L", stage: stage("re-load"), light: "amber" });
  assert.equal(r.min, 110); // min(135, 180 * .6 = 108 -> 110)
});

t("suggestion: easy runs first with days to spare, long run when time runs out", () => {
  const wk = RL.weekOf(P, "2026-11-09");
  const none = { done: {} };
  assert.equal(RL.suggest(wk, none, "2026-11-10"), "E");           // Tue
  assert.equal(RL.suggest(wk, none, "2026-11-13"), "L");           // Fri, 3 runs in 3 days
  assert.equal(RL.suggest(wk, { done: { E: 1 } }, "2026-11-11"), "Q");
  assert.equal(RL.suggest(wk, { done: { E: 1, Q: 1 } }, "2026-11-11"), "L");
  assert.equal(RL.suggest(wk, { done: { E: 1, Q: 1, L: 1 } }, "2026-11-11"), null);
});

t("gym deloads: programme weeks first, then run cutbacks after week 24", () => {
  assert.equal(RL.gymDeload(18, DELOADS, P.weeks[0]), true);
  assert.equal(RL.gymDeload(19, DELOADS, P.weeks[3]), false); // cutback, but before week 24
  assert.equal(RL.gymDeload(29, DELOADS, P.weeks[15]), true);  // run cutback week 16
  assert.equal(RL.gymDeload(29, DELOADS, P.weeks[14]), false);
});

t("exercise catalog: no duplicates, spine filter, current phase's dose first", () => {
  const all = RL.exerciseCatalog(PROGRAM, null, 3).flatMap((g) => g.items);
  const names = all.map((e) => e.n);
  assert.equal(new Set(names).size, names.length);
  const safe = RL.exerciseCatalog(PROGRAM, 1, 3).flatMap((g) => g.items);
  assert.ok(safe.length > 0 && safe.length < all.length);
  assert.ok(safe.every((e) => (e.sp || 1) <= 1));
  const day = PROGRAM[3].A;
  const other = all.find((e) => !day.some((d) => d.n === e.n));
  const out = RL.applySwaps(day, { [day[0].n]: other.n }, PROGRAM, 3);
  assert.equal(out[0].n, other.n);
  assert.equal(out[0].from, day[0].n);
  assert.equal(out[1], day[1]);
  assert.equal(RL.applySwaps(day, { [day[0].n]: "No such exercise" }, PROGRAM, 3)[0], day[0]);
  // keyed by name: still applies when an earlier row has been filtered out by a flare stage
  const later = RL.applySwaps(day.slice(1), { [day[2].n]: other.n }, PROGRAM, 3);
  assert.equal(later[1].n, other.n);
  assert.equal(RL.applySwaps(day, null, PROGRAM, 3), day);
});

// +12% or +15 min, whichever is larger: under ~125 min a week, 5-minute steps make a pure
// percentage cap stricter than intended (Stine's hand-built re-plan takes the same steps).
t("plan arithmetic: each build week within +12% / +15 min of the last build week, long run +10 max", () => {
  let last = null;
  for (const w of P.weeks.slice(0, 24)) {
    const tot = w.E + w.Q + w.L;
    if (w.tag) continue;
    if (last) {
      assert.ok(tot <= Math.max(Math.ceil(last.tot * 1.12), last.tot + 15), "week " + w.w + " total " + tot + " vs " + last.tot);
      assert.ok(w.L - last.L <= 10, "week " + w.w + " long run +" + (w.L - last.L));
    }
    last = { tot, L: w.L };
  }
});

console.log(n + " checks passed");
