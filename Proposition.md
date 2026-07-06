Read Architecture.md, GAMEPLAY.md, and GAMEMODE_CONFIG.md in full before writing a single line. This prompt corrects a prior false analysis, integrates the Yuka game AI library, and implements the drone AI primitive layer (perception, memory, Task/Mode) using it. This is a large, multi-stage task — work through it completely, end to end, verifying each stage with real evidence before moving to the next. If a stage fails, diagnose and retry it before proceeding. Do not stop and wait for confirmation between stages.

**TRANSPORT DECLARATION:** Socket.IO for network transport. postMessage/SharedArrayBuffer for the client physics worker. Neither is touched by this prompt except where explicitly stated in Part 6.

**CORRECTION OF A PRIOR FALSE CLAIM — READ THIS FIRST:**
A previous analysis claimed Yuka's steering behaviors allocate new objects (`new Vector3`, etc.) inside per-tick `calculate()` methods, and concluded this violates the Zero-GC Rule. This claim is FALSE and has been independently verified against the actual installed package source. `SeekBehavior.calculate(vehicle, force, delta)` and `PursuitBehavior.calculate(vehicle, force, delta)` both take a pre-allocated `force` vector as a parameter and mutate it via `.subVectors()` — they use module-level pre-allocated scratch vectors (e.g. `desiredVelocity$1`, `displacement$1`) allocated once at module load, not per-call. This matches the Zero-GC Rule's own required pattern (pre-allocate once, mutate via `.copy()`/`.set()`/`.subVectors()`). Do not repeat or rely on the prior false claim. Before writing any integration code, independently verify this yourself by reading the actual installed package source (not documentation, not assumptions) for every Yuka class you use in this prompt, and report per-class whether it follows this same pattern or not. If you find a class that genuinely does allocate per-call, report it specifically with the exact code — do not generalize a single bad class into 'the whole library is unsafe,' and do not generalize a single good class into 'the whole library is safe' — check each class you actually use.

**PACKAGE PINNING:**
Install the `yuka` npm package, pin its exact installed version in `package.json` (no `^` or `~` range — exact version only), and report the exact version number pinned.

**MODULARIZATION REQUIREMENT:** Yuka provides the vehicle model, steering behaviors (Seek, Pursue, Evade, Flee, Arrive, ObstacleAvoidance), and perception/memory primitives (vision cone, LOS, MemorySystem/MemoryRecord). It does NOT provide, and you must NOT use, its own FSM or Goal-Driven Agent classes for decision-making — VEXEA's Task/Mode two-axis state (defined below) replaces Yuka's own state/goal system entirely. Yuka answers 'how does this body move.' VEXEA's own Task/Mode/interpretation layer answers 'why is it moving there,' under the LLM commander's authority. Do not let Yuka's EntityManager, FSM, or Goal classes make any decision that should belong to the Task/Mode layer.

**ABSOLUTE CONSTRAINTS — do not touch:**
- Client-side drone position/rotation interpolation (confirmed working)
- Server-side KCC collision resolution pattern itself (Yuka's steering output becomes the desired-displacement INPUT to the existing KCC call, exactly as the drone movement models already do — do not replace KCC, do not let Yuka apply its own movement/collision)
- The LLM commander's 8-second tool-call cycle and tool schema
- Hitscan, damage, scoring
- Dev tab AI NAV/ZONES/PERF structure (Part 6 adds to them, does not restructure them)

---

**PART 1 — Verify Yuka Zero-GC Compliance (Real Evidence Required)**

For every Yuka class used in this prompt (SeekBehavior, PursuitBehavior, EvadeBehavior, FleeBehavior, ArriveBehavior, ObstacleAvoidanceBehavior, Vehicle, MemorySystem, MemoryRecord, Vision — if a class name differs from this list in the actual package, use the real name and report the discrepancy), read its actual `calculate()`/`update()` source from the installed package and report: does it allocate per-call, or does it use pre-allocated/passed-in result objects. Do not proceed to Part 2 until this is done and reported.

**PART 2 — Server-Side Integration**

Import Yuka into the server codebase (Node.js, not client). For each of the seven drone types, create a Yuka `Vehicle` instance wrapping the drone's existing server-side entity. Confirm Yuka's `Vehicle.position`/`.velocity`/`.rotation` can coexist with the drone's existing Rapier KCC-driven position without conflict — Yuka's vehicle should compute a desired steering force/direction; that output feeds into the existing KCC call exactly as the current RVO/steering output does today. Do not let Yuka's own `Vehicle.update()` directly move the drone if that bypasses KCC — if `Vehicle.update()` cannot be used without bypassing KCC, use Yuka's steering behavior `calculate()` methods directly to get a desired force/direction, and feed that into the existing KCC pattern manually instead of calling `Vehicle.update()`. Report which approach was used and why.

**PART 3 — Perception (Sight + Sound) Using Yuka's Vision/Memory Primitives**

Use Yuka's vision/LOS primitives for the sight channel (distance check, cone-angle check, LOS raycast against static map geometry — reuse Yuka's built-in method if it performs this, otherwise implement the raycast using the existing Rapier raycast pattern already used elsewhere server-side). For the sound channel (gunfire detection, omnidirectional radius, no cone/raycast), implement this as VEXEA-specific logic feeding into Yuka's `MemorySystem` the same way a sight detection would, but with lower initial confidence — reuse the existing fire-event data already flowing through the hitscan system, do not create a duplicate event pipeline. Per-type constants (sight distance, cone angle, hearing radius) as previously specified: reasonable defaults based on GAMEPLAY.md's stated detection ranges per type, with Humanoid's cone angle inversely scaled with distance (state the exact formula used).

**PART 4 — Memory Using Yuka's MemorySystem**

Use Yuka's `MemorySystem`/`MemoryRecord` directly for per-drone, per-player memory (last known position, confidence/visibility, decay over time) rather than building a custom parallel structure. Configure `memorySpan` per drone type (per-type decay rate as previously specified). Do not use a custom-built memory structure if `MemorySystem` already provides this — only build custom logic for what Yuka's memory system does not cover (e.g. distinguishing sound-derived low-confidence records from sight-derived high-confidence records, if `MemorySystem` doesn't natively support a confidence distinction — report if this is the case).

**PART 5 — Task/Mode Two-Axis State and Per-Type COMBAT Behavior**

Implement exactly as previously specified: Task (LLM-assigned, persists across Mode changes) and Mode (NORMAL/COMBAT, determined by an interpretation layer reading Yuka's perception/memory output). This layer is VEXEA-specific and does NOT use Yuka's FSM/Goal classes. Per-type COMBAT behavior, using Yuka's steering behaviors as the movement primitive for each:

- Recon: EvadeBehavior away from remembered threat, prioritizing max-distance evasion if fired upon (reuse existing fire-trajectory data if available; report if not available rather than fabricating detection).
- Rotary Shooter: maneuvers within an engagement range band (not direct Seek/Arrive at point-blank), fires only within `fireArcTolerance` of actual facing direction, movement not coupled to facing.
- Bomber: SEEKING (evaluate Memory for target/cluster) → LOCKED (fixed target, no retargeting) → COMMITTED (PursuitBehavior at max speed toward locked target, ignoring ObstacleAvoidanceBehavior the way a committed munition would), detonates using existing GAMEPLAY.md Section 6.2 explosion values.
- Fixed Wing: target becomes player position instead of patrol waypoint; existing turn-rate/speed constraints from the prior movement-model prompt remain untouched and are not replaced by Yuka's own steering — Yuka's PursuitBehavior output should be fed into the existing yaw-rate-limited heading system as the desired direction, not applied directly.
- Wheeled Drone: does not self-initiate on sound-only perception during an active Task; holds/returns fire on direct sight or being fired upon; if Memory indicates target is unreachable via ground pathfinding, hold nearest reachable point with best LOS (reuse existing navmesh/A* reachability, or Yuka's NavMesh if it's already integrated in Part 2 — do not build a third reachability system).
- Robot Dog: self-initiates on sound-only perception; attempts alternate route via navmesh if primary path unreachable rather than camping.
- Humanoid: seeks/holds cover using existing static geometry raycasts if a cover-point system doesn't exist (report if it doesn't); uses SEARCHING behavior (Yuka's Vehicle moving toward last-known-position with decaying confidence from MemoryRecord) when confidence is degrading but not cleared.

**PART 6 — Dev Tab Integration**

In the AI NAV tab's click-to-inspect panel, add current Task, current Mode, and Yuka MemorySystem record summary (player ID, last known position, confidence/visibility) for the inspected drone.

---

**PART 7 — Completion Report Requirements**

State explicitly, with real evidence (actual code shown, not prose claims) for each:
1. Per-class Zero-GC verification results from Part 1
2. Exact pinned Yuka version
3. Which integration approach was used in Part 2 (Vehicle.update() vs manual steering+existing KCC) and why
4. Per-type constants chosen, with reasoning
5. Confirmation Yuka's own FSM/Goal classes were NOT used for decision-making
6. Confirmation existing KCC, client interpolation, LLM commander cycle/schema, hitscan/damage/scoring were untouched
7. For each of the seven per-type COMBAT behaviors: confirmed implemented, or explicit statement of what couldn't be done and why
8. List every file modified

If any part cannot be completed as specified, do not fabricate a workaround — implement the closest correct alternative, state clearly what was changed from the original specification and why, and continue to the next part rather than stopping.