Read Architecture.md, GAMEPLAY.md, and GAMEMODE_CONFIG.md in full before writing a single line. This prompt implements the drone AI primitive layer: perception, memory, and two-axis Task/Mode state. This is one system with internal structure — do not treat its parts as unrelated. No patch scripts. Direct file edits only.

**TRANSPORT DECLARATION:** Socket.IO for network transport. postMessage/SharedArrayBuffer for the client physics worker. Do not touch either — this prompt is server-side AI logic only, with client-side changes limited strictly to Part 6 (dev tab visibility).

**MODULARIZATION REQUIREMENT:** Perception, Memory, and the Task/Mode state must each be built as a single shared implementation used identically in structure by all seven drone types (Recon, Rotary Shooter, Bomber, Fixed Wing, Wheeled Drone, Robot Dog, Humanoid). What varies per type is *parameters* (detection radius, cone angle, memory decay rate) and *interpretation rule subsets* (what a drone does in response to a perception/memory event, per its current Task/Mode combination) — not the underlying mechanism. Before writing any per-type behavior, confirm the shared primitive functions exist and are being called by every type, not reimplemented per type.

**ABSOLUTE CONSTRAINTS — do not touch:**
- Client-side drone position/rotation interpolation (confirmed working)
- Server-side drone movement models: KCC application, quadcopter acceleration easing, fixed-wing heading/yaw-rate easing (confirmed working, built in prior prompts)
- LLM commander loop and its 8-second tool-call cycle itself — this prompt does not change what tools the commander can call or how its batch validation works
- Hitscan, damage, scoring
- Dev tab AI NAV/ZONES/PERF structure — Part 6 of this prompt adds to AI NAV and ZONES, it does not restructure them

---

**PART 1 — Perception (Universal Primitive)**

Every drone, regardless of type, continuously runs two perception channels, layered cheapest-check-first for performance:

**Sight channel**, evaluated per server tick per drone against all living players:

1. Distance check first — reject immediately if player is beyond this drone type's max sight distance (a per-type constant you add, reasonable defaults based on GAMEPLAY.md's stated detection radii per type — do not invent wildly different values than what's already specified there for AP/combat ranges).
2. Cone-angle check second — reject if player is outside the drone's forward-facing vision cone. Add a per-type `visionConeAngle` constant. For Humanoid specifically, make the effective cone angle inversely scale with distance (wider effective awareness at close range, narrower at long range) — implement this as a simple formula, not a lookup table, and state the formula used in your completion report.
3. LOS raycast third, only if the first two checks pass — raycast from the drone's eye/sensor position to the player's position against static map geometry. If blocked, no sight detection this tick.

**Sound channel**, evaluated per server tick per drone against all recent gunfire events (a gunfire event is created whenever any player fires a weapon — reuse the existing fire-event data already flowing through the hitscan system, do not create a duplicate event pipeline):
- Omnidirectional radius check only — no cone, no raycast. If a gunfire event occurred within this drone type's `hearingRadius` (a per-type constant you add) within the current tick, this drone perceives a sound event.
- A sound event produces only an approximate area (the gunfire event's actual position, but interpretation rules in Part 3 must not treat this with the same precision/confidence as a sight detection — state clearly in your report how this distinction is represented in the data, e.g. a lower confidence value or a randomized offset within a radius, and which approach you chose and why).

Perception does not decide behavior. It only produces raw detection events (sight: player X detected at position Y, confidence HIGH; sound: gunfire detected near position Z, confidence LOW). Store these as the per-tick output of the perception system, consumed by Memory in Part 2.

**PART 2 — Memory (Universal Primitive)**

Every drone maintains a persistent memory record per player it has ever perceived (sight or sound), not reset when perception momentarily loses them. Each memory record holds: last known position, a confidence value that starts high on fresh sight detection, lower on sound-only detection, and decays over time since the last update. Add a per-type `memoryDecayRate` constant. When confidence decays below a threshold, the memory record for that player is cleared (the drone has genuinely forgotten, not just currently not-perceiving).

Memory must be implemented as a fixed-size, pre-allocated structure — do not use unbounded arrays or dynamically grow memory per drone per player pair using `push`/array literals in the tick loop. If the maximum number of simultaneously-tracked players is bounded by `GAMEMODE_CONFIG.md`'s `maxPlayers` (10), pre-allocate memory slots accordingly per drone.

Memory is always running for every drone regardless of current Task or Mode. Perception writes to it every tick. Deliberation (Part 3) reads from it.

**PART 3 — Task/Mode Two-Axis State**

Replace the current single FSM (PATROL/PURSUING/ATTACKING/DEAD) with two independent, simultaneously-tracked values per drone:

**Task** — set by the LLM commander's existing tool calls (`move_group`, `hold_position`, patrol assignment, etc.) exactly as currently implemented. Do not change how the commander assigns Task. Task persists across Mode changes — if a drone enters COMBAT mode mid-Task, the Task is not discarded, only demoted in execution priority.

**Mode** — either `NORMAL` or `COMBAT`, determined by an interpretation layer that reads Perception (Part 1) and Memory (Part 2) output each tick and applies per-drone-type rules to decide:
- Whether a fresh perception/memory event should trigger a transition from NORMAL to COMBAT
- Whether a new perception/memory event occurring while already in COMBAT should change the drone's current combat behavior (e.g. a second gunfire sound heard while already engaged should generally be deprioritized versus the same sound heard while in NORMAL mode triggering full investigation — implement this as a real priority comparison, not a hardcoded ignore)
- The condition for transitioning COMBAT back to NORMAL: either the perceived/remembered threat is neutralized (player dead or memory confidence decayed below threshold with no fresh perception), resuming the demoted Task exactly where it left off

In `NORMAL` mode, a drone executes its Task using existing movement/targeting logic (unaffected by this prompt) plus passive perception running in the background per Parts 1-2.

In `COMBAT` mode, a drone executes a per-type combat behavior subset instead of its Task, using its current best target information from Memory. Implement per-type COMBAT behavior as follows, using the shared movement primitives already built (KCC for ground units, acceleration easing for quadcopter-body units, heading/yaw-rate easing for fixed wing) — do not reimplement movement, only decide *what target/direction* each type's movement primitive is given while in COMBAT:

- **Recon**: In COMBAT, actively evades — moves away from its remembered threat position while attempting to maintain sight of the player at a distance (not closing in). If the player aims at or fires near the Recon drone (reuse the existing fire-event data to detect this — a shot whose trajectory passes near the drone counts, do not invent a new "aimed at" detection system if fire trajectory data isn't already available; if it is not available, report this limitation rather than fabricating a workaround), immediately prioritize maximum-distance evasion over maintaining sight.
- **Rotary Shooter**: In COMBAT, maneuvers within its type's engagement range band (a per-type min/max range constant you add) rather than closing to point-blank or standing still, attempts to reposition rather than hover in place, and only fires when its facing is within its type's `fireArcTolerance` (a per-type constant you add — a shot is only valid if the drone's current facing direction is within this angular tolerance of the actual target direction, preventing the "shooting a different direction than facing" and "diving straight overhead" problems). Movement direction is not coupled to facing direction — the drone can move in any direction while independently rotating to face and track its target.
- **Bomber**: Three-state Combat behavior: SEEKING (evaluates Memory for a target or cluster of targets within range, using the same fixed-size iteration pattern, no per-tick array allocation), LOCKED (target selection is now fixed for a committed duration, no retargeting), COMMITTED (moves at maximum speed directly toward the locked target's last known position, ignoring normal steering/avoidance the way a committed munition would, detonates on a timer or proximity trigger — reuse the existing Bomber Drone explosion damage/radius values already defined in GAMEPLAY.md Section 6.2, do not invent new values).
- **Fixed Wing**: In COMBAT, does not fundamentally change its flight model (already turn-rate/speed constrained from the prior prompt) — its COMBAT behavior is simply that its current target becomes a player position instead of a patrol waypoint, still subject to the same minimum speed and yaw-rate constraints already implemented. Do not add hovering or instant-turn behavior to Fixed Wing under any circumstances, even in COMBAT.
- **Wheeled Drone**: In COMBAT, does not self-initiate investigation of sound-only perception events while executing an active Task from the commander (per the design: Wheeled Drone holds position/chokepoints as directed, it does not have self-preservation-driven independent initiative) — however it does react to direct sight detection or being fired upon within COMBAT rules, holding position and returning fire rather than repositioning. If Memory indicates a target moved to a position unreachable by ground pathfinding (query the existing static navmesh/A* system already used for ground unit pathing — reuse it, do not build a second reachability check), Wheeled Drone's COMBAT behavior is to hold its current position or the nearest reachable point with the best available line of sight toward the target's last known position, rather than continuing to attempt an impossible path.
- **Robot Dog**: In COMBAT, actively investigates sound-only perception events even without direct sight (self-initiating, matching its "agile and smart on targeting" design) and does not disengage from a reachability failure the way Wheeled Drone does — if Memory indicates the target is in a position the current path can't reach, Robot Dog attempts an alternate route via the navmesh rather than camping, since its design purpose is explicitly to prevent players from finding unreachable safe positions.
- **Humanoid**: In COMBAT, uses the most conservative behavior of all types — seeks and holds map geometry that provides cover relative to the last known target position/direction (reuse existing static navmesh/geometry data to identify nearby cover points if such a system exists; if no cover-point system exists anywhere in the codebase, report this explicitly rather than fabricating one, and instead implement a simpler placeholder: hold at current position if it already has partial geometry occlusion from the target's last known direction, otherwise move minimally to the nearest point that does, using existing raycasts). Uses SEARCHING behavior (moves toward last-known-position with decaying confidence, distinct from actively tracking a currently-visible target) when Memory confidence for its target is degrading but not yet cleared.

---

**PART 4 — Sound Event Priority in COMBAT Mode**

When a drone in COMBAT mode perceives a new sound event unrelated to its current engaged target, compare the new event's implied threat (proximity, and whether it's a repeated/sustained sound versus a single shot) against continuing its current engagement. Implement this as an explicit priority score comparison — do not hardcode "always ignore new sounds while in combat" or "always immediately switch," since your own design specifies this should be a real judgment, not a fixed rule. State the exact scoring/comparison logic used in your completion report.

**PART 5 — Mode Transition Logging**

Add tick-gated (not per-frame) logging for every Task→Mode transition: drone ID, drone type, previous Mode, new Mode, the perception/memory event that triggered it. This must not flood the console — log only on actual transitions, not continuously.

**PART 6 — Dev Tab Integration**

In the existing AI NAV tab's click-to-inspect panel (built in a prior prompt), add: current Task, current Mode, and a summary of active Memory records (player ID, last known position, confidence value) for the inspected drone. In the existing ZONES tab, no structural change required unless directly trivial — if adding Mode/Task visibility per zone is not straightforward given the existing zone tab structure, skip it and report that it was skipped rather than restructuring the ZONES tab, since that is out of scope for this prompt.

---

**PART 7 — Completion Report Requirements**

State explicitly:
1. Confirmation that Perception, Memory, and Task/Mode are each implemented once and shared across all seven drone types (not reimplemented per type) — name the actual shared function/class names.
2. The exact per-type constants chosen (sight distance, vision cone angle, hearing radius, memory decay rate, engagement range bands, fire arc tolerance, etc.) for every one of the seven drone types, with brief reasoning for each set of values.
3. The exact formula used for Humanoid's distance-scaled vision cone.
4. How sound-only detection confidence is represented as distinct from sight-based confidence (Part 1).
5. The exact priority scoring logic used for Part 4's new-sound-during-combat comparison.
6. For each of the seven per-type COMBAT behaviors in Part 3: confirmation it was implemented as specified, or explicit statement of what could not be implemented and why (e.g. if fire-trajectory data doesn't exist for Recon's evasion trigger, if a cover-point system doesn't exist for Humanoid).
7. Confirmation the existing static navmesh/A* reachability system was reused for Wheeled Drone and Robot Dog's reachability logic, not reimplemented.
8. Confirmation no changes were made to: client-side interpolation, server-side movement models (KCC/easing/yaw-rate), the LLM commander's tool schema or 8-second cycle, hitscan/damage/scoring.
9. List every file modified.

A completion report missing any of these nine items, or containing prose success claims without the specific answers, is incomplete.