# Dev Entities Specification

## 1. Purpose

Dev Entities exposes every tunable value for every drone type — spatial properties, collider dimensions, manual points, and animation behavior — against the same real data the live match uses. It is not a separate simulation. It reads from one shared source file (`shared/constants.ts`) and previews edits live. It never writes to that file, or to any file, directly. Export is the only output mechanism, covered in Section 2.

## 2. Export Mechanism — Absolute Rule

**There is no code path, anywhere, under any function name, for any reason, that writes to any file.** Not the shared config file. Not a cache file. Not a backup file. Not a "helpful" auto-save. The only output this tool ever produces is a browser-downloaded JSON file, triggered by an explicit Export button, containing the currently-edited values.

This is not a preference or a "should" — it is a hard prohibition with no exception and no alternate interpretation. If a code path writes bytes to disk for any reason other than a browser download dialog the person explicitly triggers, that code path is a bug and must be removed, regardless of how convenient or well-intentioned it seemed.

The exported JSON is uploaded back, separately, as its own action, and applied to `shared/constants.ts` by hand or by a separate prompt — never automatically, never by Dev Entities itself.

**Verifying export actually works:** the Export button must produce a real file the browser downloads (a `.json` file with a real filename, opens and contains the expected values when inspected). A button that only copies to a clipboard, or produces an empty file, or silently does nothing, is broken and must be fixed before Dev Entities is considered functional — this already happened once (Day 40) and cost three wasted prompts before it was caught. Test this directly by downloading the file and opening it, every time a change is made to the export logic.

## 3. Single Source of Truth

One file: `shared/constants.ts`, specifically the `DRONE_CONFIGS` object already confirmed to exist and already confirmed to be what the live match, hitscan validation, and the visual diagnostic overlay all read from directly, with zero derived multipliers or independent scale computation. Dev Entities' collider and model placement must use this exact same direct-read approach — this was broken for most of Day 40 (an invented `currentModelScaleFactor` system) and is now fixed and confirmed working. Do not reintroduce any derived/computed intermediate value between the config and the rendered result, for any value, ever.

Initial values shown in every slider are read live from `DRONE_CONFIGS` on load. Nothing in Dev Entities is a separate, independently-tracked value — every slider's starting position is whatever the real config currently says.

## 4. Live Preview Binding — Concrete Rule

**Selecting a value category or motion from the dropdown must cause that specific motion to play continuously, on loop, in the viewport, for as long as it's selected.** This is not optional and not satisfied by an "Idle" default that never changes. If the person selects "Banking" from the dropdown, the drone must visibly bank back and forth continuously, right now, so that dragging the max-bank-angle slider visibly changes how far it banks, in real time, with no additional click or trigger needed. If the person selects "Wheel Steering," the wheels must visibly turn left-right continuously so the max-turn-angle slider's effect is visible immediately.

This applies to every continuous/looping motion (banking, hover sway, prop spin, wheel roll, turret rotate/pitch). It does not apply to one-shot event motions (fire, detonate, barrel recoil) — those remain trigger-button-activated, since they represent discrete events, not continuous states, and looping a "fire" animation forever would misrepresent what it actually looks like in the match.

If a slider is being edited and nothing in the viewport visibly changes as a result, that is a broken binding and must be fixed — a numeric value changing with no visible effect is not a working feature.

## 5. The Four Value Categories

### Category 1 — Spatial
Model forward-axis orientation offset (rotation to align each model's actual nose/front with the engine's forward axis — raw glTF exports don't share a consistent forward axis) and real-world scale, read directly from config with no derived multiplier. **Confirmed fixed and working as of Day 41.**

### Category 2 — Collider & Manual Points
Collision dimensions (box half-extents or capsule radius/length, per drone's real shape) and fixed reference points — muzzle/missile-release point, light positions. Read directly from config, same no-multiplier rule as Category 1. **Confirmed fixed and working as of Day 41** (Y-offset bug and body-mesh scale bug both resolved and verified against real match screenshots).

### Category 3 — Client-Only Animation
Values that only affect visual rendering, with zero effect on anything the server tracks (collision shape, hit registration, anti-cheat, or replay state). Lives in `client/src/systems/DroneProcedural.ts`. Every value here uses a curve for its transition — no instant snaps, ever, including values that might seem too simple to need one (prop spin-up, wheel roll starting).

### Category 4 — Server-Authoritative Values
Any value the server must track for gameplay, or any value with a downstream effect on collision shape, hit registration, or anti-cheat/replay state — even if it looks purely visual (banking, fixed-wing pitch, both confirmed Category 4 because they rotate the drone's actual collider).

**The test, applied consistently, no exceptions:** does this value affect anything the server independently tracks? If yes, Category 4, regardless of how the motion looks. If no, Category 3, regardless of how "important" the motion looks.

## 6. Known Active Bug: The Muzzle Offset War

Three disconnected muzzle position sources exist right now, confirmed via direct code investigation:
1. `shared/constants.ts`'s real `muzzleOffset` field per drone type (e.g. `[0, -0.15, 0.8]` for Rotary Shooter) — **currently ignored by all active gameplay code.**
2. The server hardcodes `d.posY + 0.5` for every drone's projectile origin and LOS raycasts, ignoring the real per-type offset and the drone's actual shape.
3. The client independently hardcodes a third, different set of per-type offsets in `NetworkSyncSystem.ts` purely to visually fake alignment with wherever the server actually fired from.

**Fix:** consolidate to `shared/constants.ts`'s `muzzleOffset` as the single real source. Server-side projectile origin and LOS raycasts read this value directly, per drone type, replacing the hardcoded `d.posY + 0.5`. Client-side VFX (muzzle flash, tracers) read the same value, replacing its own separate hardcoded offsets. No third copy, anywhere, once this is done.

## 7. Per-Drone Complete Value Reference

Every value each drone type exposes. This list is exhaustive for what's currently known — if a new value is discovered that isn't listed here, add it to this document immediately rather than letting it exist only in code.

### Recon (Quadcopter, unarmed)
HP: 20 (per GAMEPLAY.md 6.2).
- **Category 1:** forward-axis rotation offset (X/Y/Z), scale
- **Category 2:** collider box half-extents (X/Y/Z) — no muzzle point, this drone never fires
- **Category 3:** propeller spin rate (all 4 props share one rate value), hover sway amplitude, hover sway period, vertical bob amplitude, vertical bob period
- **Category 4:** max horizontal speed, max vertical speed, max rotation/turn speed, banking max angle (collider-affecting), deceleration radius (Arrival), health (20)

### Rotary Shooter (Quadcopter, armed)
HP: 40. Damage: 8 per shot. Fire mode: semi-automatic, poor accuracy at range (per GAMEPLAY.md 6.2).
- **Category 1:** forward-axis rotation offset, scale
- **Category 2:** collider box half-extents, muzzle point (per Section 6's consolidated `muzzleOffset`)
- **Category 3:** propeller spin rate, hover sway amplitude/period, vertical bob amplitude/period, muzzle flash scale multiplier (currently 0.8x), firing sound pitch multiplier (currently 1.3x)
- **Category 4:** max horizontal speed, max vertical speed, max rotation/turn speed, banking max angle (collider-affecting), deceleration radius, health (40), damage per shot (8), fire cooldown (confirmed 20 ticks / ~333ms via Day 40 investigation — do not re-measure, this value is known)

### Bomber (Quadcopter, kamikaze)
HP: 30. Explosion damage: 80. Explosion radius: 4 units. Detonates on contact (distance < 4.0 units, per Day 40 investigation).
- **Category 1:** forward-axis rotation offset, scale
- **Category 2:** collider box half-extents, detonation trigger radius (currently hardcoded at 4.0 — expose as a tunable value, same treatment as any other Category 2 point)
- **Category 3:** propeller spin rate, hover sway amplitude/period, detonation flash (a point light, same mechanism as the existing muzzle-flash light already implemented in `VFXOrchestrator.ts` — triggered on the same detonation event that currently applies explosion damage, not a new trigger system), detonation sound (triggered on the same event, using the existing `shotBuffer`-style audio triggering pattern already implemented for gunfire)
- **Category 4:** max horizontal speed, max vertical speed, max rotation/turn speed, banking max angle (collider-affecting), deceleration radius, health (30), explosion damage (80), explosion radius (4)

### Fixed Wing (armed, missile — NOT a bomber; GAMEPLAY.md's strafing-gunship description is stale)
HP: 60. Damage: 15 per shot. Engagement range: 40m (confirmed via Day 40 investigation). Cannot hover, wide-arc turns only. Holds at frame 14 of its animation track (gear up, bay closed) as its rest pose.
- **Category 1:** forward-axis rotation offset, scale
- **Category 2:** collider dimensions (computed from the frame-14 pose, updates live with real-time pitch per Category 4), missile-release point (per Section 6's consolidated `muzzleOffset` — currently broken/missing for this drone specifically, must be added)
- **Category 3:** banking/roll into turns (cosmetic — the collider is a box sized to account for full wingspan regardless of roll angle, so roll does not need to affect it; if this assumption turns out wrong during implementation, re-classify as Category 4 and update this document, don't silently leave it inconsistent), missile launch flash, missile launch sound
- **Category 4:** max speed, min speed (cannot hover — must never reach zero), max turn rate, pitch (collider-affecting, real-time procedural, not baked into the animation track), engagement range (40m), damage per shot (15), health (60)

### Wheeled Drone (armed, ground turret)
HP: 80. Damage: 12 per shot. Fire mode: automatic, moderate accuracy. Fire cooldown value is not yet confirmed — **before implementing, read the real cooldown constant from the server's fire-control code for this drone type and report the actual value found. Do not invent or estimate a number.**
- **Category 1:** forward-axis rotation offset, scale
- **Category 2:** collider box half-extents, muzzle point at turret barrel tip (per Section 6's consolidated `muzzleOffset`)
- **Category 3:** wheel roll visual speed (Front Axel and Back Axel are paired nodes — both wheels on a side move together, no independent left/right control, this is a hard structural limit of the source asset), wheel steering visual angle (same Front-Axel-pairing limit applies), barrel recoil translation distance and return curve, chassis vibration amplitude, muzzle flash scale multiplier, firing sound pitch multiplier
- **Category 4:** max movement speed, max turn angle/speed, turret rotate (yaw) max angle and max rate, turret gun (pitch) min/max angle and max rate — turret yaw/pitch are server-authoritative because they determine real shot origin for hit-registration, health (80), damage per shot (12), fire cooldown (measure per above, do not invent)

### Robot Dog (armed, no model yet)
HP: 150. Damage: 18 per shot, burst fire, high accuracy (per GAMEPLAY.md 6.2). Fire cooldown not yet confirmed — same rule as Wheeled Drone: measure the real value from server code, do not invent.
- **Categories 1-3:** cannot be defined until a real model and animation set exist. Do not populate with placeholder values.
- **Category 4 (track now, asset-independent):** max movement speed, max turn angle/speed, health (150), damage per shot (18), fire cooldown (measure, do not invent)

### Humanoid (armed, no model yet)
HP: 200. Damage: 20 per shot, semi-automatic, high accuracy (per GAMEPLAY.md 6.2). Fire cooldown not yet confirmed — same rule as above.
- **Categories 1-3:** cannot be defined until a real model and animation set exist.
- **Category 4 (track now, asset-independent):** max movement speed, max turn angle/speed, health (200), damage per shot (20), fire cooldown (measure, do not invent)

## 8. Perception and Arrival Constants — Decision

These currently live outside Dev Entities entirely, tuned via direct code edits (detection radius and FOV half-angle per drone type for Sight Perception; deceleration radius and max turn rate per drone type for Arrival behavior). **Decision: these move into Dev Entities as Category 4 values, under their own "Behavioral" section per drone type, alongside the existing movement/combat values.** They are server-authoritative by the same test used everywhere else in this document — the server needs them to run perception and steering — so there is no reason for them to be tuned through a separate mechanism than every other Category 4 value. Implement this the same way as every other Category 4 slider: read live from the real shared config, no derived values.

## 9. Tuning Workflow

1. Select a drone type.
2. Select a motion/category from the dropdown — the corresponding animation begins looping immediately in the viewport per Section 4's live preview binding.
3. Adjust sliders — the looping animation visibly responds in real time.
4. Confirm the motion transitions smoothly at the new value — no snap introduced by an extreme setting.
5. Export. This produces a real downloadable JSON file (per Section 2 — never a direct file write, never clipboard-only). Verify the file actually downloads and contains the expected values before treating the export as successful.
6. Upload that exact file back, separately, to have `shared/constants.ts` updated to match.
