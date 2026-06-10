# GAMEPLAY.md
## VEXEA — Gameplay Design Document
*This document is the authoritative source of truth for all gameplay mechanics, balance values, and design decisions. It is separate from Architecture.md which governs technical implementation. Both documents must be read before any gameplay-related code is written.*

---

## 1. Game Premise

VEXEA is an AI defence company whose LLM systems have gone rogue. The rogue AIs are too dangerous to shut down publicly. VEXEA has contracted two private companies — **Vibe Co.** and **Slop Inc.** — to infiltrate VEXEA facilities and silence the rogue systems quietly.

Players are contractors working for either Vibe Co. or Slop Inc. The enemy is VEXEA's autonomous drone army, directed in real-time by a rogue LLM commander.

---

## 2. Factions

Two factions. Identical mechanics. Cosmetically differentiated. Faction choice is identity, not competitive advantage.

- **Vibe Co.**
- **Slop Inc.**

Faction is selected at account creation — guest or registered. Cannot be changed without a new account. Faction affects: character skin presets, HUD color accent, leaderboard grouping, and season standings.

---

## 3. Player Presets (Classes)

4 presets per faction. Same archetype across both factions, different visual treatment. Players select a preset before each match. All presets share the same base movement speed unless noted.

Each preset has:
- 1 primary weapon slot (rifle)
- 1 secondary weapon slot (pistol)
- 2 utility slots (preset-specific)

### 3.1 Assault
**Role:** Baseline combat. Highest damage output. No special utility.
- Primary: Rifle
- Secondary: Pistol
- Utility 1: Grenade
- Utility 2: Flashbang

### 3.2 Medic
**Role:** Team sustain. Critical in attrition matches.
- Primary: Rifle
- Secondary: Pistol
- Utility 1: Med Kit — heals self or teammate on use. Single charge, replenished at spawn.
- Utility 2: Revive Tool — revives downed teammate. Short channel time, interruptible by damage.

### 3.3 Recon
**Role:** Intelligence and disruption. Directly counters the LLM commander's awareness layer.
- Primary: Rifle
- Secondary: Pistol
- Utility 1: Radio — intercepts fragments of the LLM's last tool call. Surfaces as a distorted audio cue and brief text bleed on screen. Active on use. Passive when equipped — the radio icon appears in HUD only for this preset.
- Utility 2: Signal Disruptor — on activation, removes the player from all camera and drone LOS reporting for a short duration. The player's zone degrades to UNKNOWN in the LLM zone summary payload for the duration. Limited charges. Cooldown between uses.

### 3.4 Demolitions
**Role:** Zone control and infrastructure destruction.
- Primary: Rifle
- Secondary: Pistol
- Utility 1: EMP — disables static cameras in a radius temporarily. Affected cameras stop reporting to the LLM zone summary. Duration TBD via playtesting.
- Utility 2: C4 — placeable explosive charge. Detonates on command. High damage, area of effect. Destructible environment interaction — post-MVP feature, C4 placement points will interact with destructible geometry when added.

---

## 4. Weapons

### 4.1 Rifle
- Damage: 20 per shot
- Fire modes: Automatic (600rpm), Burst (3-round burst)
- Magazine: 40 rounds
- Reserve: 289 rounds
- Range: Medium-long
- TTK at full auto close range: ~2 seconds sustained accurate fire on 100HP target

### 4.2 Pistol
- Damage: 25 per shot
- Fire mode: Semi-automatic
- Magazine: 35 rounds
- Reserve: 241 rounds
- Range: Short-medium
- Notes: Higher single-shot damage than rifle. Lower sustained output. Backup weapon.

### 4.3 Grenade (Assault utility)
- Damage: 80 in radius
- Radius: 4 units
- Fuse: Timed. Cook mechanic TBD via playtesting.

### 4.4 Flashbang (Assault utility)
- Effect: Temporary screen whiteout and audio suppression on players and drones in radius
- Duration: TBD via playtesting

### 4.5 Future Weapons
Additional weapon types to be added post-MVP. All new weapons must define: damage, fire mode, magazine size, reserve, range category, and fire rate before implementation.

---

## 5. Player Stats

- Base HP: 100
- Movement speed: Standard (value set in implementation)
- No regeneration — healing requires Medic utility only

---

## 6. Enemy — VEXEA Drone Army

All drones carry the VEXEA eye mark visually. The mark placement varies by unit type. All drones are directed by the LLM commander operating on an 8-second loop (see Architecture.md Section 8).

### 6.1 AP Economy

The LLM commander spawns units using an Action Point pool.

- Starting pool: 20 AP
- Regeneration: 3 AP per 8-second cycle
- AP costs per unit type:

| Unit | AP Cost |
|---|---|
| Recon Drone | 1 |
| Rotary Shooter | 2 |
| Bomber Drone | 2 |
| Wheeled Drone | 3 |
| Robot Dog | 4 |
| Fixed Wing | 5 |
| Humanoid | 6 |

Fixed Wing is hard-capped at 1 deployment per match regardless of AP availability.

### 6.2 Drone Types

#### AIR UNITS

**Rotary Shooter**
- HP: 40
- Damage: 8 per shot, semi-automatic, poor accuracy at range
- Speed: High
- Hitbox: Small
- Spawn group size: 3–5 units
- Behavior: Zone pressure and player location confirmation. Harasses from above. Prioritized target for players due to nuisance factor.
- VEXEA mark: Body

**Bomber Drone**
- HP: 30
- Weapon: None — explosive payload
- Explosion damage: 80
- Explosion radius: 4 units
- Speed: High
- Hitbox: Small
- Spawn group size: 1–3 units
- Behavior: Flies directly at player or cluster and detonates. Single use. LLM deploys in chokepoints and clustered player scenarios. Creates zone denial.
- VEXEA mark: Body

**Recon Drone**
- HP: 20
- Weapon: None
- Speed: Highest in game. Erratic flight path.
- Hitbox: Smallest in game
- Spawn group size: 1–2 units
- Behavior: Maintains playerPresence as 'confirmed' in zone summary. No combat role. Players must prioritize destroying it — its survival directly improves LLM decision quality. While active, its zone never degrades to 'last_seen' or 'unknown'.
- VEXEA mark: Body

**Fixed Wing**
- HP: 60
- Damage: 15 per shot, short burst per pass
- Speed: Highest sustained speed. Constant movement in wide arc. Cannot hover.
- Hitbox: Medium, fast-moving
- Spawn group size: 1 unit
- Hard cap: 1 per match
- Behavior: Strafing runs on open zones. Deployed by LLM when players cluster in open areas (zone_courtyard primary target). Feels like a match event when it appears.
- VEXEA mark: Fuselage

#### GROUND UNITS

**Wheeled Drone**
- HP: 80
- Damage: 12 per shot, automatic, moderate accuracy
- Speed: Medium
- Hitbox: Medium
- Spawn group size: 2–3 units
- Behavior: Backbone of ground army. Pathfinds aggressively toward player zone. Most common ground threat. Dangerous in numbers.
- VEXEA mark: Chassis

**Robot Dog**
- HP: 150
- Damage: 18 per shot, burst fire, high accuracy
- Speed: Slow but relentless — never stops pathfinding
- Hitbox: Medium, lower profile than humanoid
- Spawn group size: 1–2 units
- Behavior: Zone denial rather than aggressive push. Holds positions with LOS on players. Effective in corridors. Players must sustain fire from both weapons to eliminate. Countered by flanking or Demolitions EMP breaking its reporting.
- VEXEA mark: Chassis

**Humanoid**
- HP: 200
- Damage: 20 per shot, semi-automatic, high accuracy
- Speed: Slow
- Hitbox: Large, upright profile
- Spawn group size: 1 unit
- Behavior: The only unit that uses cover actively. Pathfinds to a position with LOS on player then holds it. Does not rush. Elite anchor unit — LLM deploys sparingly. One humanoid holding a chokepoint is a serious tactical problem. Countered by Recon Signal Disruptor cutting its reporting or Demolitions EMP blinding the camera network it relies on.
- VEXEA mark: Chest plate

### 6.3 Static Surveillance — Cameras

Fixed cameras mounted throughout the environment. Each camera covers a detection radius. If a camera has LOS on a player, that zone's playerPresence is set to 'confirmed' in the zone summary.

Players can shoot cameras. Destroyed cameras leave their coverage radius permanently dark until a Recon Drone covers the area. Camera destruction is a core strategic action — Demolitions EMP temporarily disables cameras in radius without destroying them.

Camera health: TBD via playtesting. Should survive a few rifle shots — destroying one should be a deliberate decision, not accidental.

---

## 7. Match Structure

- Win condition: Any player reaches zone_core and completes the objective
- Loss condition: All players eliminated
- Match timer: TBD via playtesting
- Player count: 1–N (asymmetric PvE, N TBD)

---

## 8. Post-MVP Features (Locked Out of Scope)

The following are confirmed future features. They must not be implemented until explicitly scoped:

- Destructible environment geometry (C4 interaction)
- Additional weapon types
- Additional drone types
- Additional map layouts
- Faction-specific cosmetic differentiation beyond preset skins
- Additional player presets beyond the initial 4

---

## 9. Balance Philosophy

All numerical values in this document are starting points for playtesting. No value is locked until it has been tested in a live match. The LLM commander's imprecision is compensated by unit numbers, not individual unit strength. Players should feel pressure from volume, not from individually overpowered enemies.

The signal disruptor, EMP, and camera destruction mechanics are the primary tools for countering the LLM's intelligence layer. These must always feel impactful — if the LLM is making good decisions, disrupting its awareness should visibly degrade its behavior within one 8-second cycle.
