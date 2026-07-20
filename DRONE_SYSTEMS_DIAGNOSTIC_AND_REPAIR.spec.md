# DRONE_SYSTEMS_DIAGNOSTIC_AND_REPAIR.spec.md

Read `gemini_wall_of_shame.md` in full before touching anything. Read this entire file before writing one line of code. This is not a request for a fix. This is a request for evidence, followed by a fix ONLY where evidence proves a real cause. Every claim in your response must cite real quoted code with file path and line number, or a real logged value from actual execution. A sentence describing what code "does" without quoting it is worthless and will be treated as a failure to comply with this document.

**Confirmed broken via direct player testing, not assumption:**
- Sight Perception: player is never detected by any drone under any condition.
- Sound Perception (damage/gunfire-triggered): drones do not react to being shot or to nearby gunfire.
- Obstacle Avoidance: drones zig-zag around obstacles (repeated small corrections) instead of one smooth curve.

These may share one root cause, several root causes, or be fully independent. Do not assume a shared cause. Do not assume independence. Find out.

---

## PART 0 — Full Disclosure (mandatory, before any other part)

Quote, in full, with file paths and line numbers:
1. The complete current Sight Perception function(s) — distance check, FOV check, LOS raycast, and the memory write.
2. The complete current Memory/confidence-decay function(s) — the read and write paths, and the confirmed/last_seen/unknown derivation.
3. The complete current damage-taken handler — what runs when a player's shot hits a drone, and whether anything there writes to Mode, memory, or any perception-adjacent state.
4. The complete current sound/gunfire-detection code, if any exists at all. If none exists, say so explicitly — do not describe what should exist.
5. The complete current Obstacle Avoidance detection + deflection + state-machine code (the raycast, the direction choice, `avoidanceState` and its transitions).
6. The complete current Mode transition logic (`NORMAL` ↔ `COMBAT`) — every place that reads or writes `d.mode`.
7. The complete current per-tick call order inside `updateSystemEntities` (or wherever the drone tick loop lives) — list every function called, in the actual order they run, for one full tick.

Do not summarize any of these. Paste the real code.

---

## PART 1 — Falsifiable Tests (run these yourself, report raw output for every one)

For each test: state PASS or FAIL. A test is FAIL unless the stated evidence is present. You may not mark PASS based on reasoning alone.

**T1 — Sight detection fires at all.**
Add a tick-gated log (max once per second per drone) that prints: drone ID, distance to player, FOV angle to player, raycast hit/miss, and whether a memory write occurred. Stand directly in front of a drone, close range, unobstructed, for 10 seconds. Report the raw log lines. PASS requires at least one line showing a successful memory write with confidence 1.0.

**T2 — Memory record is the same object perception writes to.**
Log the memory object's identity (e.g. object reference or a unique debug field) at the point Sight Perception writes it, and separately at the point Memory's decay logic reads it, and separately at the point anything downstream (Mode transition, LLM zone summary) reads it. Report all three. PASS requires all three to be reading/writing the literal same record, not three different objects that happen to look similar.

**T3 — Confidence value actually reaches something that acts on it.**
Force a drone's memory confidence to 1.0 by any means (direct test harness, dev tool, hardcoded temporary override — clearly marked as temporary). Log whether `d.mode` changes to `COMBAT` within 5 seconds. PASS requires an observed Mode change. If this fails while T1 passes, perception is writing data nothing reads — a disconnected pipeline, not a detection failure. Report which case this is.

**T4 — Damage triggers something.**
Log every field/variable that changes on a drone the instant it takes damage from a player's shot (hp, damageLog, mode, memory, anything). Shoot a drone once. Report the full before/after diff of every field on that drone's object. PASS requires at least Mode or memory to change as a direct result.

**T5 — Sound/gunfire detection exists and fires.**
If Part 0.4 found real code: log every time it evaluates, what it found, and what it decided. Fire a weapon near a drone (not aimed at it) for 10 seconds. Report raw log lines. If Part 0.4 found no code at all: report that plainly, this test is N/A, do not fabricate a result.

**T6 — Obstacle avoidance direction stability.**
Log, every tick while `avoidanceState.active === true`: drone ID, chosen direction (+1/-1), ticks remaining, whether direction changed from the previous tick. Drive a drone toward a single static obstacle at a shallow approach angle (not head-on) for the full duration of the avoidance maneuver. Report every logged tick. PASS requires the direction value to stay constant for the full maneuver. If it flips sign more than once during a single approach to a single obstacle, that is the zig-zag's exact mechanism — report every tick where it flips and what `obstacleDetected` was on that tick.

**T7 — Cross-system interference check.**
With T1-T6 logging all simultaneously active, drive a drone near an obstacle WHILE the player is within its sight range WHILE the player fires a weapon. Report all logs from this combined scenario. PASS requires each system to behave as it did in isolation. FAIL requires identifying which system's output is being overwritten, ignored, or corrupted by another running in the same tick — quote the exact line where this happens.

---

## PART 2 — Dev Tool Test Suite (build this, do not skip it)

Add a new dev tab, or extend an existing one: **SYSTEMS TEST**. It must NOT auto-pass anything. Each test below is a real, running scenario with a real pass/fail condition checked against real logged data, not a hardcoded flag.

- **Perception Range Test:** spawn a drone, place the player at increasing distances (5m increments) up to the drone's configured detection radius + 10m. Auto-log at which distance detection first fires. Compare against the configured `detectionRadius` value. Report the delta. A delta greater than 1 unit is a FAIL requiring investigation, not a rounding note.
- **Perception FOV Test:** same setup, sweep player angle around the drone at fixed close range. Log the exact angle detection stops firing at. Compare against configured `fovHalfAngle`. Same delta rule.
- **Perception LOS Test:** place a wall between drone and player within range and FOV. Confirm zero detections while blocked. Remove the wall. Confirm detection resumes within one tick.
- **Damage Reaction Test:** shoot a drone from a position outside its normal detection range/FOV (i.e. a shot that should NOT be visually detectable). Log whether Mode still changes. This isolates damage-reaction from sight-based detection — they may use different pathways, find out which.
- **Sound Reaction Test:** fire a weapon at increasing distances from a drone with no line of sight to the shooter. Log the maximum distance at which the drone reacts. If no reaction occurs at any distance, this is the confirmed root cause of the "sound doesn't work" report — state this plainly.
- **Avoidance Direction-Lock Test:** automate T6 above as a repeatable dev-tool button — spawn drone, obstacle, approach angle, log direction-flip count. A flip count above 0 for a single continuous approach is an automatic FAIL, displayed in the UI, not just the console.

Every test above must produce a visible PASS/FAIL in the dev tab UI, backed by the actual logged numbers, not a static label.

---

## PART 3 — Fix (only after Parts 0-2 are complete and reported)

Do not write a fix for anything until its specific test has FAILED with a real, quoted, identified cause. Do not fix a system whose test passed. For each confirmed FAIL, state the exact root cause (quoting the responsible code) before changing anything, then implement the fix, then re-run that specific test and report the new result.

If you reach a point where you believe something is fixed but cannot re-run its test to confirm (session ending, time constraint, anything) — explicitly say so. Do not report a fix as complete without its corresponding test's new PASS result. An unconfirmed fix must be labeled unconfirmed in your final summary, not omitted.

---

## REQUIRED FINAL OUTPUT

A single table: one row per test (T1-T7 plus every dev-tool test), three columns — Result (PASS/FAIL/N/A), Evidence (the specific logged values or quoted code proving it), Fix Applied (yes/no/not needed). No row may be left blank. No row may cite "should work" or "looks correct" as evidence.
