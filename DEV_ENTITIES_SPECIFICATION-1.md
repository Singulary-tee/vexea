# Dev Entities Specification

## 1. Purpose

Dev Entities exposes every tunable value for every drone type — spatial properties, collider dimensions, manual points, and animation behavior — against the same real data the live match uses. It is not a separate simulation. It reads from one shared source file and writes back to that same file. There is no independent Dev Entities data model.

Initial slider values are populated from whatever the match currently uses. You tune values while watching the drone respond live in the viewport. When done, you click Export, which produces a downloadable JSON file. That exact file is uploaded back here for the shared source file to be updated. Gemini's job is limited to applying the JSON file's values to the shared source file — nothing more complex than that. Do not require typing, retyping, partial copying, or interpreting values by hand anywhere in this loop, on either end. If the export mechanism ever behaves differently than this (a copy-to-clipboard button instead of a real file, a broken clipboard action, a partial/malformed file, anything that isn't a clean file-out) — that is a bug in the tool itself and must be fixed before continuing to use it, not worked around by hand-transcribing values.

## 2. Single Source of Truth

One file. Both the live match and Dev Entities read from it. Dev Entities writes back to it on export. No decoupled or hardcoded values inside Dev Entities itself — if a value isn't coming from this shared file, it doesn't belong in the tool.

This was tested directly and failed on Day 40 (colliders were not identical between match and Dev Entities, despite claims of a unified source) before being fixed. Any future work on this tool must re-verify this specific property directly — enter a match, note a collider's shape/dimensions/origin, then compare against Dev Entities' display for the same drone. They must match exactly.

## 3. The Four Value Categories

Every tunable value on every drone belongs to exactly one of these. The category determines where the value lives in code and whether it's sent to the client at all.

### Category 1 — Spatial
Model orientation and scale. Raw glTF exports don't share a consistent forward axis — some are +Z forward, some -Z, etc. This category holds the rotation offset needed to align each model's actual nose/front with the engine's forward axis, plus overall scale.

### Category 2 — Collider & Manual Points
Collision dimensions (box half-extents, capsule radius/length, whichever shape a given drone uses) and fixed reference points on the model — muzzle position, light positions. These are set once per drone type and don't change during gameplay (except where a Category 4 value causes the collider itself to move — see below).

### Category 3 — Client-Only Animation
Values that only affect visual rendering, computed entirely client-side, with zero effect on anything the server tracks. Lives in `client/src/systems/DroneProcedural.ts`. The server never needs to know these values or send them over the network.

Examples, decided directly against the test below, not by how something looks:
- Barrel recoil translation (visual kick on firing — no collision or hit-registration consequence)
- Propeller spin
- Wheel roll direction and speed (visual only — actual movement speed is Category 4, this is just how the wheel mesh spins to match it)
- Wheel steering angle (visual only — actual max turn angle is Category 4)

### Category 4 — Server-Authoritative Values
Any value the server must track or validate for gameplay to function correctly, OR any value that has a downstream effect on something the server tracks — collision shape, hit registration, or anything relevant to anti-cheat/replay consistency — even if the value itself looks purely visual at first glance.

Examples:
- Max movement speed, max rotation speed, max turn angle/speed
- Health, damage
- Quadcopter banking angle — banking rotates the drone's collider, so the server needs the real bank angle to keep hit detection accurate, not just to make the drone look like it's turning
- Fixed-wing pitch — pitch is a real-time procedural rotation, not baked into any static pose, and the collider moves with it. Same reasoning as banking: a value that looks like pure visual rotation but actually changes what the server needs to know about the drone's collision volume
- Turret rotate (yaw) and gun (pitch) orientation — already established as server-authoritative, since it determines where shots actually originate from for hit-registration purposes. (Turret barrel recoil itself — the visual kick — is Category 3, same as any other recoil.)

### The Category 3 vs. Category 4 Test

Do not decide category by whether a motion "looks" cosmetic or "looks" like real steering — that framework was tried and rejected on Day 40 for being subjective and inconsistent across drone types (it called quadcopter banking cosmetic and fixed-wing pitch "real" for reasons that didn't hold up once actually checked against the fixed-wing's collider).

Instead, ask: **does this value affect anything the server independently tracks — collision shape, hit validation, anti-cheat, or replay-relevant state — regardless of whether it also affects movement authority in the more obvious sense?**

If yes, Category 4, even if the motion looks purely decorative on first glance (banking, fixed-wing pitch). If no — the value only changes what's rendered, with zero downstream effect on anything server-side — Category 3, even if the motion looks like it "should" be a real gameplay value (propeller spin, wheel visual roll/steer).

When adding a new drone type or a new motion to an existing one, check this explicitly rather than assuming by analogy to a similar-looking motion on a different drone. The same-looking motion (rotation, tilt, spin) can land in a different category on different drones depending on whether that specific drone's collider actually moves with it.

## 4. Smoothness Requirement

Every animated transition, in every category, uses a curve. No instant snaps, anywhere, on any drone, for any motion — including motions that might seem simple enough to not need one, like propeller spin-up or wheel roll starting/stopping. If a motion doesn't currently have a curve control, it needs one added, not an exception made.

Hover sway (quadcopter idle state) is a fixed, hardcoded, designed motion — not simulated noise or "atmospheric" randomness. It should look and behave the same way every time, not vary run to run.

## 5. Per-Drone Value Reference

This section lists what each drone type actually exposes. Extend it as new drones are added — don't leave a drone's actual value list undocumented the way the first version of this spec did.

### Quadcopter / Multi-Rotor

**Recon:** unarmed — no weapon, no muzzle point, no firing VFX/SFX of any kind. Confirmed via Day 40 investigation: it enters PURSUING state in combat but never triggers fire logic.
- Category 1: model forward-axis alignment, scale
- Category 2: collider box dimensions (no muzzle point — this drone doesn't fire)
- Category 3: propeller spin rate, hover sway (hardcoded motion, with a curve)
- Category 4: max movement speed, max rotation speed, max vertical speed, banking angle (collider-affecting)

**Rotary Shooter:** armed, hitscan projectile, 8 damage, ~333ms cooldown (20 ticks).
- Category 1: model forward-axis alignment, scale
- Category 2: collider box dimensions, muzzle point (currently broken — see Section 7, Known Active Bug)
- Category 3: propeller spin rate, hover sway (hardcoded, with a curve), muzzle flash scale (currently 0.8x), firing sound pitch (currently 1.3x — "high-pitched rapid fire" signature)
- Category 4: max movement speed, max rotation speed, max vertical speed, banking angle (collider-affecting), fire cooldown, damage per shot

**Bomber:** unarmed in the traditional sense — kamikaze unit. Moves through SEEKING → LOCKED → COMMITTED states (see Notion page's drone AI spec for the full state contract). On impact (distance < 4.0 units), triggers explosion damage (80) and despawns. No muzzle point, no tracer, no firing sound — needs its own Category 2/3 entries for whatever visual/audio cue plays on detonation, not yet defined anywhere and not covered by this investigation. Flag as an open gap, don't invent placeholder values for it.
- Category 1: model forward-axis alignment, scale
- Category 2: collider box dimensions, detonation trigger radius (4.0 units, currently a hardcoded distance check — confirm whether this should be exposed as a tunable value)
- Category 3: propeller spin rate, hover sway (hardcoded, with a curve) — detonation VFX/SFX not yet defined
- Category 4: max movement speed, max rotation speed, max vertical speed, banking angle (collider-affecting), explosion damage (80)

### Fixed Wing
Long-range attacker, holds at frame 14 of its animation track (gear up, bay closed — per the Day 38 collider fix). Fires missiles using the same server-authoritative hitscan/projectile pipeline as every other armed drone, not a bomb-drop mechanic — confirmed current behavior as of Day 40's investigation, GAMEPLAY.md's bomber description is stale and should not be trusted for this drone type.
- Category 1: model forward-axis alignment, scale
- Category 2: collider dimensions (computed from the frame-14 pose; must still update to follow real-time pitch per Category 4 below), muzzle/missile-release point (currently broken — see Section 7, Known Active Bug)
- Category 3: none currently identified — flag here if one is found, don't leave it undocumented
- Category 4: max speed, min speed (cannot hover), max turn rate, pitch (collider-affecting, procedural, not baked), engagement range (40m current value), missile damage (15 current value)

### Wheeled Drone
Armed, hitscan projectile, 12 damage.
- Category 1: model forward-axis alignment, scale
- Category 2: collider box dimensions, muzzle point at turret barrel tip (currently broken — see Section 7, Known Active Bug)
- Category 3: wheel roll visual speed, wheel steering visual angle, barrel recoil translation, chassis vibration, muzzle flash scale, firing sound pitch
- Category 4: max movement speed, max turn angle/speed, turret rotate (yaw) angle, turret gun (pitch) angle — both server-authoritative for hit-registration accuracy, fire cooldown, damage per shot

### Robot Dog (18 damage) / Humanoid (20 damage)
Both armed hitscan shooters, confirmed to exist in combat logic even though the physical model/animation set doesn't exist yet per Section 5's Robot Dog / Humanoid note. Combat values are already real and should be tracked now even before the visual asset exists — don't wait for the model to document the Category 4 values.
- Category 4 (confirmed, asset pending): max movement speed, max turn angle/speed, fire cooldown, damage per shot (18 / 20 respectively)
- Categories 1-3: cannot be defined until a real model and animation set exist

## 6. Known Active Bug: The Muzzle Offset War

Confirmed via direct code investigation on Day 40, not yet fixed. There are currently three disconnected sources of muzzle position data for every armed drone type, and none of them is the one actually meant to be authoritative:

1. `shared/constants.ts` defines a real `muzzleOffset` per drone type in `DRONE_CONFIGS` (e.g. `[0, -0.15, 0.8]` for Rotary Shooter) — **these values are currently ignored by all active code.**
2. The server hardcodes `d.posY + 0.5` for every drone type's projectile origin and line-of-sight raycasts, regardless of the drone's actual shape or the real `muzzleOffset` value.
3. The client independently hardcodes a third, different set of per-type offsets in `NetworkSyncSystem.ts` purely to make muzzle flash/tracer VFX visually line up with where the server said the shot came from — since the server's position doesn't match the visual muzzle, the client fakes it.

This must be fixed — consolidated to `shared/constants.ts`'s existing `muzzleOffset` field as the single real source — before Dev Entities' muzzle-point sliders can mean anything real. Until fixed, any muzzle-point value shown or adjusted in Dev Entities is cosmetic only and will not reflect what the server actually uses for hit origin or LOS checks.

## 7. Other Confirmed Findings (Day 40 investigation)

- Muzzle flash scale, firing sound pitch, and tracer origin/direction are all real, already-implemented, per-drone-type values (`VFXOrchestrator.ts`, `NetworkSyncSystem.ts`) — not yet exposed anywhere as tunable, and not yet decided whether they belong in Dev Entities at all versus staying as fixed VFX/audio design constants. Flag as an open question rather than assuming either way.
- The LLM commander's `spawn_units` tool currently only supports spawning Rotary Shooter (air) and Wheeled (ground) — Bomber and Fixed Wing cannot currently be deployed by the LLM at all. This is a real gameplay gap, separate from Dev Entities' scope, worth its own fix but noted here since it was discovered during this investigation.
- Perception constants (detection radius, FOV half-angle) and Arrival constants (deceleration radius, max turn rate) are real, currently-tunable Category 4 values, but they live in a completely separate tuning mechanism (direct code edits, not this tool) established before this spec was written. Whether these should eventually move into Dev Entities alongside everything else, or stay separate, is an open architectural question — not decided as part of this spec.

## 8. Tuning Workflow

1. Select a drone type.
2. Select the specific motion/category to adjust.
3. Adjust sliders — value updates the live 3D viewport immediately.
4. Confirm the motion still transitions smoothly (per Section 4) at the new value — no snap introduced by an extreme setting.
5. Export. This produces a real downloadable JSON file — not a clipboard copy, not a partial value list. Upload that exact file back for the shared source file to be updated. Verify the exported JSON file actually opens and contains the expected values before treating the export as successful — a button that appears to work but produces an empty, malformed, or clipboard-only result is a tool bug, not a usable export.
