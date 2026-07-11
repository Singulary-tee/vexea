# GAMEMODE_CONFIG.md
## VEXEA — Game Mode Configuration Document

This document is the authoritative source of truth for all game mode parameters, tunable values, and match configuration. It is separate from GAMEPLAY.md which governs game mechanics and design, and Architecture.md which governs technical implementation.

**Critical rule:** No value in this document is hardcoded in implementation files. Every parameter is read from the active game mode configuration object at runtime. Adding a new game mode requires only adding a new config block to this document and its corresponding server-side config object — zero restructuring of gameplay systems.

---

## 1. Game Mode Configuration Structure

Every game mode defines all of the following fields. No field is optional. If a future mode does not use a field, it sets it to its disabled value explicitly rather than omitting it.

```typescript
interface GameModeConfig {
  // Identity
  id: string
  displayName: string
  description: string

  // Match Structure
  matchDuration: number           // seconds
  minPlayers: number
  maxPlayers: number
  winCondition: 'OBJECTIVE' | 'ELIMINATION' | 'SURVIVAL'
  lossCondition: 'TIMEOUT' | 'TEAM_WIPE'
  winMessage: string
  lossMessage: string

  // Spawn
  spawnZones: string[]            // zone IDs from Architecture.md — map defines which are active
  respawnEnabled: boolean
  respawnDelay: number            // seconds
  respawnDeathPenaltyScore: number // score deducted per death

  // Friendly Fire
  friendlyFireEnabled: boolean
  friendlyFireDamageMultiplier: number // 0 = disabled, 1 = full damage, 0.5 = half damage
  teamKillPenaltyEnabled: boolean

  // Damage Types
  bulletDamageEnabled: boolean
  explosionDamageEnabled: boolean
  fallDamageEnabled: boolean
  fallDamageMinHeight: number     // units — below this height no fall damage
  fallDamageMaxHeight: number     // units — at this height and above = instant death
  fallDamageScaling: 'linear'    // how damage scales between min and max height

  // Objective
  objectiveHoldTime: number       // seconds of continuous hold required to win
  objectiveResetOnDamage: boolean // hold progress resets if player takes any damage
  objectiveResetOnExit: boolean   // hold progress resets if player leaves proximity radius
  objectiveProximityRadius: number // units — how close player must be to interact
  objectiveTerminalDamageable: boolean // can drones damage the terminal itself

  // Classes and Loadouts
  availableClasses: ('ASSAULT' | 'MEDIC' | 'RECON' | 'DEMOLITIONS')[]
  classLoadoutsLocked: boolean    // true = players cannot customise loadout, false = customisation allowed within class weapon pool

  // Utility
  utilityCooldownMultiplier: number // 1.0 = base cooldown, 0.5 = half cooldown, 2.0 = double
  utilityResetsOnRespawn: boolean

  // LLM Commander
  llmCycleInterval: number        // ms between commander decisions
  llmApStartPool: number          // starting AP pool
  llmApRegenPerCycle: number      // AP regenerated each cycle
  llmDifficultyScaling: boolean   // whether AP regen increases over match duration
  llmDifficultyScaleInterval: number // seconds between each difficulty increase
  llmDifficultyScaleAmount: number   // AP regen increase per interval

  // Drone Behaviour
  droneFriendlyFireExplosions: boolean // bomber/explosion drones damage other drones
  droneAvoidFriendlyFire: boolean      // drones attempt to avoid shooting allied units

  // Death Camera
  deathCamEnabled: boolean        // show killer drone camera on death
  deathCamFallback: 'teammate' | 'fixed' // fallback if killer drone is dead

  // Scoring
  scoreTrackingEnabled: boolean
  scoreIndividual: boolean        // track per-player score
  scoreTeam: boolean              // track team aggregate score
  scoreValues: {
    droneElimination: number
    assistElimination: number
    objectiveProgress: number     // per second of hold time contributed
    revivePerformed: number
    survivalBonus: number         // awarded per minute survived
    deathPenalty: number          // subtracted per death
    missionComplete: number       // awarded to all surviving players on win
  }

  // Post-Match Stats Tracked
  postMatchStats: string[]        // list of stat keys tracked and shown on profile card
}
```

---

## 2. Active Game Modes

### 2.1 STANDARD (MVP Default Mode)

```typescript
STANDARD: {
  id: 'STANDARD',
  displayName: 'INFILTRATION',
  description: 'Disable the rogue AI before the timer expires. 5–10 contractors. Respawn enabled.',

  matchDuration: 480,             // 8 minutes
  minPlayers: 1,                  // 1 for development testing, raise to 5 for launch
  maxPlayers: 10,
  winCondition: 'OBJECTIVE',
  lossCondition: 'TIMEOUT',
  winMessage: 'SYSTEM TERMINATED',
  lossMessage: 'CONTRACT FAILED',

  spawnZones: ['zone_spawn'],     // defined in Architecture.md Section 7
  respawnEnabled: true,
  respawnDelay: 5,
  respawnDeathPenaltyScore: 50,

  friendlyFireEnabled: false,
  friendlyFireDamageMultiplier: 0,
  teamKillPenaltyEnabled: false,

  bulletDamageEnabled: true,
  explosionDamageEnabled: true,
  fallDamageEnabled: true,
  fallDamageMinHeight: 6,         // units — no damage below this
  fallDamageMaxHeight: 20,        // units — instant death at or above this
  fallDamageScaling: 'linear',

  objectiveHoldTime: 8,
  objectiveResetOnDamage: true,
  objectiveResetOnExit: true,
  objectiveProximityRadius: 3,    // units
  objectiveTerminalDamageable: false,

  availableClasses: ['ASSAULT', 'MEDIC', 'RECON', 'DEMOLITIONS'],
  classLoadoutsLocked: true,      // no customisation at MVP

  utilityCooldownMultiplier: 1.0,
  utilityResetsOnRespawn: true,

  llmCycleInterval: 8000,
  llmApStartPool: 20,
  llmApRegenPerCycle: 3,
  llmDifficultyScaling: true,
  llmDifficultyScaleInterval: 120, // every 2 minutes
  llmDifficultyScaleAmount: 1,     // +1 AP regen per cycle every 2 minutes

  droneFriendlyFireExplosions: true,
  droneAvoidFriendlyFire: true,

  deathCamEnabled: true,
  deathCamFallback: 'teammate',

  scoreTrackingEnabled: true,
  scoreIndividual: true,
  scoreTeam: true,
  scoreValues: {
    droneElimination: 100,
    assistElimination: 50,
    objectiveProgress: 10,        // per second of uninterrupted hold
    revivePerformed: 150,
    survivalBonus: 25,            // per minute survived
    deathPenalty: 50,
    missionComplete: 500,
  },

  postMatchStats: [
    'droneEliminations',
    'assists',
    'deaths',
    'objectiveTimeHeld',          // total seconds contributed to objective hold
    'revivesPerformed',
    'damageDealt',
    'damageReceived',
    'utilityUsed',
    'distanceTravelled',
    'timeAlive',
    'scoreIndividual',
    'scoreTeam',
    'matchResult',                // WIN or CONTRACT FAILED
    'matchDuration',              // actual elapsed time
  ],
}
```

---

### 2.2 HARDCORE (Future Mode — Placeholder)

```typescript
HARDCORE: {
  id: 'HARDCORE',
  displayName: 'HARDCORE',
  description: 'No respawns. One life. Full team wipe ends the match.',

  matchDuration: 600,
  minPlayers: 3,
  maxPlayers: 10,
  winCondition: 'OBJECTIVE',
  lossCondition: 'TEAM_WIPE',
  winMessage: 'SYSTEM TERMINATED',
  lossMessage: 'ALL CONTRACTORS ELIMINATED',

  spawnZones: ['zone_spawn'],
  respawnEnabled: false,
  respawnDelay: 0,
  respawnDeathPenaltyScore: 0,    // death is already the penalty

  friendlyFireEnabled: false,
  friendlyFireDamageMultiplier: 0,
  teamKillPenaltyEnabled: false,

  bulletDamageEnabled: true,
  explosionDamageEnabled: true,
  fallDamageEnabled: true,
  fallDamageMinHeight: 4,         // more punishing
  fallDamageMaxHeight: 15,
  fallDamageScaling: 'linear',

  objectiveHoldTime: 8,
  objectiveResetOnDamage: true,
  objectiveResetOnExit: true,
  objectiveProximityRadius: 3,
  objectiveTerminalDamageable: false,

  availableClasses: ['ASSAULT', 'MEDIC', 'RECON', 'DEMOLITIONS'],
  classLoadoutsLocked: true,

  utilityCooldownMultiplier: 1.5, // slower cooldowns
  utilityResetsOnRespawn: false,  // irrelevant — no respawn

  llmCycleInterval: 8000,
  llmApStartPool: 25,             // more aggressive from the start
  llmApRegenPerCycle: 4,
  llmDifficultyScaling: true,
  llmDifficultyScaleInterval: 90,
  llmDifficultyScaleAmount: 1,

  droneFriendlyFireExplosions: true,
  droneAvoidFriendlyFire: true,

  deathCamEnabled: true,
  deathCamFallback: 'teammate',

  scoreTrackingEnabled: true,
  scoreIndividual: true,
  scoreTeam: true,
  scoreValues: {
    droneElimination: 150,        // higher reward for harder mode
    assistElimination: 75,
    objectiveProgress: 15,
    revivePerformed: 0,           // no respawn so no revives
    survivalBonus: 50,
    deathPenalty: 0,
    missionComplete: 1000,
  },

  postMatchStats: [
    'droneEliminations',
    'assists',
    'deaths',
    'objectiveTimeHeld',
    'damageDealt',
    'damageReceived',
    'utilityUsed',
    'distanceTravelled',
    'timeAlive',
    'scoreIndividual',
    'scoreTeam',
    'matchResult',
    'matchDuration',
  ],
}
```

---

## 3. Utility Cooldowns (Per Utility — All Modes Base Values)

All values in seconds. Modified at runtime by `utilityCooldownMultiplier` from active game mode config.

| Utility | Base Cooldown | Charges Per Life |
|---|---|---|
| Grenade | 30 | 2 |
| Flashbang | 25 | 2 |
| Med Kit | 45 | 1 |
| Revive Tool | 60 | 1 |
| Radio | 15 | unlimited |
| Signal Disruptor | 90 | 1 |
| EMP | 60 | 1 |
| C4 | 120 | 1 |

Charges reset on respawn if `utilityResetsOnRespawn: true` in active mode config.

---

## 4. Fall Damage Formula

```
if (fallHeight <= fallDamageMinHeight) damage = 0
if (fallHeight >= fallDamageMaxHeight) damage = playerMaxHP  // instant death
else damage = playerMaxHP * ((fallHeight - fallDamageMinHeight) / (fallDamageMaxHeight - fallDamageMinHeight))
```

Applied using values from active game mode config. Player max HP is defined in GAMEPLAY.md Section 5.

---

## 5. Difficulty Scaling Formula

```
currentApRegen = llmApRegenPerCycle + (floor(elapsedSeconds / llmDifficultyScaleInterval) * llmDifficultyScaleAmount)
```

Only applies if `llmDifficultyScaling: true`. Computed server-side every LLM cycle. Injected into the zone summary payload so the LLM is aware of its current resource rate.

---

## 6. Score Display Philosophy

Scores exist to create a sense of contribution and progression. They fill the post-match screen with meaningful-looking numbers that reward engagement. Individual score shows personal contribution. Team score shows collective performance. Both are tracked simultaneously.

Score values are intentionally tuned so that active engaged players accumulate visibly higher numbers than passive players. The `survivalBonus` rewards staying alive. The `revivePerformed` value is high to reward team-oriented play. The `missionComplete` bonus is large enough that winning feels categorically different from losing in score terms regardless of individual performance.

---

## 7. Post-Match Stats Display

Stats listed in `postMatchStats` are shown on the post-match screen and stored in Firestore under the player's profile document after each match. The profile card in the main menu reads the most recent match stats and lifetime aggregates from this stored data.

Lifetime aggregates tracked across all matches:
- Total drone eliminations
- Total deaths
- Total matches played
- Total matches won
- Total objective time held
- Total revives performed
- Highest individual score in a single match
- Win rate percentage

---

## 8. Adding New Game Modes

To add a new game mode:
1. Add a new config block to Section 2 of this document following the exact `GameModeConfig` interface structure.
2. Add the corresponding config object to `shared/gamemode-configs.ts` on the server.
3. Add the mode to the multiplayer mode selector in the lobby screen.
4. No other files require modification.

No gameplay system, damage pipeline, scoring system, or LLM commander code changes when a new mode is added. All systems read from the active config object passed at match initialization.

---

## 9. Drone Physics tuning
* Wheeled Drone speed constant: 8.0, proposed turn rate: 0.04.
