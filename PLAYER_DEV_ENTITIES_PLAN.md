# Action Plan: Player & Modular Weapons Integration in Dev Entities Calibration System

This plan details the full end-to-end integration of the **Player Entity** and **Modular Weapon Configs** into the Dev Entities Calibration Panel. It strictly obeys `ARCHITECTURE.md` (WebGPU/TSL, Zero-Allocation, Socket.IO over JSON, No React) and `DEV_ENTITIES_SPECIFICATION.md` (No direct filesystem writes, continuous loop bindings, single-source-of-truth constants).

---

## 1. Shared Constants & Unified Data Structures (A to Z Architecture)

To avoid magic numbers or divergence between matches and Dev Entities, all player and weapon properties are defined in shared, strongly-typed files.

### 1.1 Shared Player Physics & View Configuration (`/shared/constants.ts`)
We will centralize all player dimensions, speeds, and camera properties into a typed structure.

```typescript
export interface PlayerPhysicsConfig {
  hp: number;
  radius: number;
  heightStanding: number;
  heightCrouched: number;
  eyeLevelStanding: number;
  eyeLevelCrouched: number;
  speeds: {
    base: number;
    crouch: number;
    sprintMultiplier: number;
    dashMultiplier: number;
    jumpVelocity: number;
    gravity: number;
  };
}

export const PLAYER_PHYSICS_CONFIG: PlayerPhysicsConfig = {
  hp: 100,
  radius: 0.4,
  heightStanding: 1.8,
  heightCrouched: 1.1,
  eyeLevelStanding: 1.6,
  eyeLevelCrouched: 1.0,
  speeds: {
    base: 5.5,
    crouch: 2.5,
    sprintMultiplier: 1.6,
    dashMultiplier: 2.5,
    jumpVelocity: 7.0,
    gravity: 18.0
  }
};
```

### 1.2 Extended Modular Weapons Configuration (`/shared/weapons.ts`)
We will extend `WeaponPerformance` to incorporate all visual offsets, muzzle origins, and animation parameters per weapon, completely removing hardcoded limits in the match and the calibration panel.

```typescript
export interface WeaponVisualConfig {
  hipPosition: [number, number, number];    // First-person view model offsets (X, Y, Z)
  adsPosition: [number, number, number];    // Aim Down Sights view model offsets (X, Y, Z)
  adsTilt: number;                          // ADS alignment rotation correction
  muzzleOffset: [number, number, number];   // Muzzle particle/tracer origin relative to model mesh
  visualScale: number;                      // Scale coefficient of the weapon model
  animations: {
    idle: string;
    walk: string;
    shoot: string;
    reload: string;
    draw: string;
  };
  reloadDuration: number;                   // Time in seconds for reloading cycle
  drawDuration: number;                     // Time in seconds for equipping weapon
}

export interface WeaponPerformance {
  name: string;
  fireRateHz: number;
  damage: number;
  capacity: number;
  
  // Recoil Coordinates
  recoilForceUp: number;
  recoilForceSide: number;
  recoilRecoveryRate: number;
  
  // Bullets Grouping & Spread
  baseSpreadRad: number;
  maxSpreadRad: number;
  heatPerShot: number;
  coolRate: number;
  
  // Camera Shake
  camShakeMagnitude: number;
  camShakeDurationMs: number;
  
  // Range & Damage Falloff Profile
  falloff: DamageFalloff;
  
  // ADS Camera Settings
  adsFovMultipier: number;
  adsSensitivityMult: number;
  adsTransitionSpeed: number;
  
  // Motion Sway Coefficients
  swayAmplitude: number;
  swaySpeed: number;
  
  // New Visual Configuration Block
  visualConfig: WeaponVisualConfig;
}
```

### 1.3 Weapon Definitions Directory (`/shared/weapons.ts`)
We will define comprehensive configs for existing weapons and pre-create slots for the upcoming arsenal (Shotguns, LMGs, Snipers, Med Kits, Grenades, Radio) so that **no magic values exist** when they are integrated.

```typescript
export const DETAILED_WEAPONS: Record<string, WeaponPerformance> = {
  rifle: {
    name: "Rifle",
    fireRateHz: 10,
    damage: 20,
    capacity: 40,
    recoilForceUp: 0.05,
    recoilForceSide: 0.02,
    recoilRecoveryRate: 8.0,
    baseSpreadRad: 0.015,
    maxSpreadRad: 0.08,
    heatPerShot: 0.012,
    coolRate: 0.05,
    camShakeMagnitude: 0.08,
    camShakeDurationMs: 120,
    falloff: { maxDamageRange: 25.0, minDamageRange: 80.0, minDamage: 8.0 },
    adsFovMultipier: 0.70,
    adsSensitivityMult: 0.60,
    adsTransitionSpeed: 10.0,
    swayAmplitude: 0.003,
    swaySpeed: 2.5,
    visualConfig: {
      hipPosition: [0.025, -0.49, 0.05],
      adsPosition: [-0.075, -0.42, 0.0],
      adsTilt: -0.05,
      muzzleOffset: [0.0, 0.0, -0.5],
      visualScale: 1.0,
      animations: {
        idle: "Rig|KDW_DPose_Idle",
        walk: "Rig|KDW_Walk",
        shoot: "Rig|KDW_Shot",
        reload: "Rig|KDW_Reload_fast",
        draw: "Rig|KDW_Draw"
      },
      reloadDuration: 2.2,
      drawDuration: 0.4
    }
  },
  pistol: {
    name: "Pistol",
    fireRateHz: 5,
    damage: 25,
    capacity: 35,
    recoilForceUp: 0.08,
    recoilForceSide: 0.03,
    recoilRecoveryRate: 12.0,
    baseSpreadRad: 0.008,
    maxSpreadRad: 0.05,
    heatPerShot: 0.025,
    coolRate: 0.08,
    camShakeMagnitude: 0.12,
    camShakeDurationMs: 90,
    falloff: { maxDamageRange: 12.0, minDamageRange: 35.0, minDamage: 5.0 },
    adsFovMultipier: 0.85,
    adsSensitivityMult: 0.80,
    adsTransitionSpeed: 12.0,
    swayAmplitude: 0.0015,
    swaySpeed: 1.8,
    visualConfig: {
      hipPosition: [0.005, -0.16, -0.185],
      adsPosition: [0.0, -0.135, -0.06],
      adsTilt: 0.0,
      muzzleOffset: [-0.115, -0.2, -0.2],
      visualScale: 1.0,
      animations: {
        idle: "idle",
        walk: "walk",
        shoot: "shoot",
        reload: "reload",
        draw: "draw"
      },
      reloadDuration: 1.8,
      drawDuration: 0.3
    }
  },
  shotgun: {
    name: "Shotgun",
    fireRateHz: 1.2,
    damage: 80,
    capacity: 8,
    recoilForceUp: 0.22,
    recoilForceSide: 0.08,
    recoilRecoveryRate: 6.0,
    baseSpreadRad: 0.08,
    maxSpreadRad: 0.15,
    heatPerShot: 0.1,
    coolRate: 0.15,
    camShakeMagnitude: 0.25,
    camShakeDurationMs: 200,
    falloff: { maxDamageRange: 8.0, minDamageRange: 20.0, minDamage: 0.0 },
    adsFovMultipier: 0.80,
    adsSensitivityMult: 0.70,
    adsTransitionSpeed: 8.0,
    swayAmplitude: 0.004,
    swaySpeed: 2.0,
    visualConfig: {
      hipPosition: [0.03, -0.45, 0.0],
      adsPosition: [-0.08, -0.38, 0.0],
      adsTilt: -0.04,
      muzzleOffset: [0.0, 0.0, -0.6],
      visualScale: 1.0,
      animations: { idle: "idle", walk: "walk", shoot: "shoot", reload: "reload", draw: "draw" },
      reloadDuration: 3.0,
      drawDuration: 0.5
    }
  },
  lmg: {
    name: "LMG",
    fireRateHz: 13,
    damage: 18,
    capacity: 100,
    recoilForceUp: 0.04,
    recoilForceSide: 0.04,
    recoilRecoveryRate: 7.0,
    baseSpreadRad: 0.025,
    maxSpreadRad: 0.12,
    heatPerShot: 0.008,
    coolRate: 0.04,
    camShakeMagnitude: 0.09,
    camShakeDurationMs: 100,
    falloff: { maxDamageRange: 35.0, minDamageRange: 90.0, minDamage: 9.0 },
    adsFovMultipier: 0.65,
    adsSensitivityMult: 0.50,
    adsTransitionSpeed: 7.0,
    swayAmplitude: 0.005,
    swaySpeed: 3.0,
    visualConfig: {
      hipPosition: [0.04, -0.52, 0.1],
      adsPosition: [-0.09, -0.46, 0.0],
      adsTilt: -0.06,
      muzzleOffset: [0.0, 0.0, -0.75],
      visualScale: 1.1,
      animations: { idle: "idle", walk: "walk", shoot: "shoot", reload: "reload", draw: "draw" },
      reloadDuration: 4.5,
      drawDuration: 0.7
    }
  },
  sniper: {
    name: "Sniper Rifle",
    fireRateHz: 0.6,
    damage: 110,
    capacity: 5,
    recoilForceUp: 0.35,
    recoilForceSide: 0.05,
    recoilRecoveryRate: 4.0,
    baseSpreadRad: 0.001,
    maxSpreadRad: 0.2,
    heatPerShot: 0.3,
    coolRate: 0.1,
    camShakeMagnitude: 0.3,
    camShakeDurationMs: 250,
    falloff: { maxDamageRange: 150.0, minDamageRange: 200.0, minDamage: 85.0 },
    adsFovMultipier: 0.25, // 4x Scope zoom
    adsSensitivityMult: 0.30,
    adsTransitionSpeed: 5.0,
    swayAmplitude: 0.008,
    swaySpeed: 1.5,
    visualConfig: {
      hipPosition: [0.02, -0.48, 0.05],
      adsPosition: [-0.075, -0.41, 0.0],
      adsTilt: -0.05,
      muzzleOffset: [0.0, 0.0, -0.9],
      visualScale: 1.0,
      animations: { idle: "idle", walk: "walk", shoot: "shoot", reload: "reload", draw: "draw" },
      reloadDuration: 3.5,
      drawDuration: 0.6
    }
  },
  medkit: {
    name: "Med Kit",
    fireRateHz: 1.0,
    damage: -50, // Positive healing
    capacity: 2,
    recoilForceUp: 0.0,
    recoilForceSide: 0.0,
    recoilRecoveryRate: 10.0,
    baseSpreadRad: 0.0,
    maxSpreadRad: 0.0,
    heatPerShot: 0.0,
    coolRate: 1.0,
    camShakeMagnitude: 0.0,
    camShakeDurationMs: 0,
    falloff: { maxDamageRange: 2.0, minDamageRange: 2.0, minDamage: -50.0 },
    adsFovMultipier: 1.0,
    adsSensitivityMult: 1.0,
    adsTransitionSpeed: 10.0,
    swayAmplitude: 0.001,
    swaySpeed: 1.0,
    visualConfig: {
      hipPosition: [0.0, -0.3, -0.1],
      adsPosition: [0.0, -0.3, -0.1],
      adsTilt: 0.0,
      muzzleOffset: [0.0, 0.0, 0.0],
      visualScale: 0.8,
      animations: { idle: "idle", walk: "walk", shoot: "use", reload: "none", draw: "draw" },
      reloadDuration: 0.0,
      drawDuration: 0.3
    }
  },
  grenade: {
    name: "Frag Grenade",
    fireRateHz: 0.8,
    damage: 150,
    capacity: 3,
    recoilForceUp: 0.0,
    recoilForceSide: 0.0,
    recoilRecoveryRate: 10.0,
    baseSpreadRad: 0.0,
    maxSpreadRad: 0.0,
    heatPerShot: 0.0,
    coolRate: 1.0,
    camShakeMagnitude: 0.15,
    camShakeDurationMs: 150,
    falloff: { maxDamageRange: 5.0, minDamageRange: 10.0, minDamage: 10.0 },
    adsFovMultipier: 1.0,
    adsSensitivityMult: 1.0,
    adsTransitionSpeed: 10.0,
    swayAmplitude: 0.002,
    swaySpeed: 1.5,
    visualConfig: {
      hipPosition: [0.05, -0.25, -0.1],
      adsPosition: [0.05, -0.25, -0.1],
      adsTilt: 0.0,
      muzzleOffset: [0.0, 0.0, 0.0],
      visualScale: 0.5,
      animations: { idle: "idle", walk: "walk", shoot: "throw", reload: "none", draw: "draw" },
      reloadDuration: 0.0,
      drawDuration: 0.3
    }
  },
  radio: {
    name: "Tactical Radio",
    fireRateHz: 0.5,
    damage: 0,
    capacity: 1,
    recoilForceUp: 0.0,
    recoilForceSide: 0.0,
    recoilRecoveryRate: 10.0,
    baseSpreadRad: 0.0,
    maxSpreadRad: 0.0,
    heatPerShot: 0.0,
    coolRate: 1.0,
    camShakeMagnitude: 0.0,
    camShakeDurationMs: 0,
    falloff: { maxDamageRange: 0.0, minDamageRange: 0.0, minDamage: 0 },
    adsFovMultipier: 1.0,
    adsSensitivityMult: 1.0,
    adsTransitionSpeed: 10.0,
    swayAmplitude: 0.001,
    swaySpeed: 1.2,
    visualConfig: {
      hipPosition: [0.0, -0.3, -0.15],
      adsPosition: [0.0, -0.3, -0.15],
      adsTilt: 0.0,
      muzzleOffset: [0.0, 0.0, 0.0],
      visualScale: 0.6,
      animations: { idle: "idle", walk: "walk", shoot: "call", reload: "none", draw: "draw" },
      reloadDuration: 0.0,
      drawDuration: 0.4
    }
  }
};
```

---

## 2. Dev Entities Calibration Panel Expansion (`/client/screens/dev-entities.ts`)

We will add a fully dedicated, custom player configuration view inside `dev-entities.ts`.

### 2.1 Schema Definition for the Player
We will declare the metadata schema for the player, wrapping the shared physics and weapons lists dynamically so that additions of future weapons in `DETAILED_WEAPONS` automatically populate the UI without breaking changes.

```typescript
let activePlayerWeaponKey: string = "rifle"; // Current weapon selected for calibration
let currentPerspective: "FIRST_PERSON" | "THIRD_PERSON" = "THIRD_PERSON";

// State structure to track edited player and weapons presets live in memory
const playerParams: {
  physics: Record<string, any>;
  weapons: Record<string, Record<string, any>>;
} = {
  physics: JSON.parse(JSON.stringify(PLAYER_PHYSICS_CONFIG)),
  weapons: {}
};

// Initialize weapons params from shared dictionary
Object.keys(DETAILED_WEAPONS).forEach(key => {
  playerParams.weapons[key] = JSON.parse(JSON.stringify(DETAILED_WEAPONS[key]));
});
```

### 2.2 Re-routing the HTML DOM Controls
When the user switches to the `"PLAYER"` tab:
1. Hide standard drone categories selector.
2. Injected a **Weapon / Item Select Dropdown** (allowing instant switching between Rifle, Pistol, Shotgun, Medkit, etc.).
3. Injected a **View Perspective Selector** (`First Person` vs. `Third Person`) to quickly toggle between checking weapon model screen position (hip/ADS) and orbital mannequin views.
4. Render specialized slider categories mapped specifically to player values:

#### **Category 1 — View & Offsets (FP/TP)**
*   First-Person Hip Position (X, Y, Z sliders: `-1.0` to `1.0`, step `0.001`)
*   First-Person ADS Position (X, Y, Z sliders: `-1.0` to `1.0`, step `0.001`)
*   First-Person ADS Tilt (`-0.5` to `0.5`, step `0.01`)
*   Motion Sway Amplitude (`0.0` to `0.02`, step `0.0001`)
*   Motion Sway Speed (`0.5` to `10.0`, step `0.1`)
*   Visual Model Scale (`0.1` to `3.0`, step `0.01`)

#### **Category 2 — Collider & Muzzle Offsets**
*   Player Standing Height (`1.0` to `2.5`, step `0.01`)
*   Player Crouch Height (`0.5` to `1.5`, step `0.01`)
*   Player Capsule Radius (`0.1` to `1.0`, step `0.01`)
*   Weapon Muzzle Offset (X, Y, Z sliders relative to weapon center: `-2.0` to `2.0`, step `0.005`)

#### **Category 3 — Recoil, Sway, & Sound VFX**
*   Visual Recoil Upward Force (`0.0` to `0.5`, step `0.005`)
*   Visual Recoil Sideward Force (`0.0` to `0.2`, step `0.001`)
*   Visual Recoil Recovery Rate (`1.0` to `20.0`, step `0.1`)
*   Camera Shake Magnitude (`0.0` to `0.5`, step `0.01`)
*   Camera Shake Duration (`0` to `500` ms, step `10`)
*   Muzzle Flash Scale Multiplier (`0.1` to `4.0`, step `0.05`)
*   Reload Cycle Duration (`0.1` to `10.0` seconds, step `0.05`)

#### **Category 4 — Server-Authoritative Combat & Speeds**
*   Base Movement Speed (`1.0` to `15.0` m/s, step `0.1`)
*   Crouch Movement Speed (`0.5` to `8.0` m/s, step `0.1`)
*   Sprint Speed Multiplier (`1.0` to `3.0`, step `0.05`)
*   Base Damage Per Hit (`0.0` to `150.0`, step `1.0`)
*   Weapon Fire Rate (`0.1` to `25.0` Hz, step `0.1`)
*   Magazine Capacity (`1` to `200`, step `1`)
*   Falloff Damage Range Max (`1.0` to `100.0`, step `0.5`)
*   Falloff Damage Range Min (`10.0` to `200.0`, step `0.5`)

---

## 3. Viewport Simulation and Visual Setup

We will handle the Three.js viewport rendering based on the active perspective.

### 3.1 3D Camera & Model Setup for Player Tab
*   **Third-Person View (Orbit Rig)**:
    *   Load and render the full `bpre_rifleman.glb` character mesh centered at `(0, 0, 0)`.
    *   Load and attach the selected weapon model (e.g., `smg_fps_animations.glb` or `animated_pistol.glb` based on active weapon key) to the character model's right hand node.
    *   Overlay a wireframe cylinder/capsule matching the calibrated player height and radius.
    *   Draw the muzzle point visual (red sphere) exactly at the weapon's calibrated muzzle coordinate offsets.
*   **First-Person View (Eye-Level)**:
    *   Disable the full character mesh rendering (preventing camera clipping).
    *   Set the camera position directly to the calibrated `eyeLevelStanding` (e.g. `1.6m`).
    *   Mount the active weapon model directly to the camera's local coordinate system.
    *   Position the weapon model at `hipPosition` (default) or `adsPosition` (when the continuous ADS loop mode is selected) and apply `adsTilt` rotations.
    *   Allow the camera to zoom in based on the weapon's dynamic `adsFovMultiplier` when ADS mode is toggled!

### 3.2 Loop Animations Playback (Continuous & Multi-weapon)
The loop modes dropdown will dynamically play the continuous animations:
*   `STANDBY IDLE`: Plays a slow sine-wave visual breathing sway on the weapon viewmodel (pitch and yaw translations matching `swayAmplitude` and `swaySpeed`).
*   `WALK / RUN`: Plays camera head-bobbing and viewmodel pullback bobbing translations based on the player speeds.
*   `ADS TRANSITION`: Continuously interpolates (lerps) the weapon model's local coordinates between `hipPosition` and `adsPosition` at `adsTransitionSpeed`.
*   `RELOAD CYCLE`: Plays the weapon's mapped reload animation track continuously.
*   `DRAW CYCLE`: Plays the weapon's mapped draw animation track continuously.

### 3.3 Hitscan Event Simulation (One-Shot Trigger)
When `[FIRE SINGLE SHOT]` is clicked:
*   Apply an instant angular rotation offset to the camera (pitch offset equal to `recoilForceUp`, yaw offset random between `±recoilForceSide`).
*   Translate the weapon model backward (`recoilZ` is offset backward based on `recoilForceUp * 2.0`).
*   Trigger the camera shake translation (random spherical jitter matching `camShakeMagnitude` decaying over `camShakeDurationMs`).
*   Spawn a hitscan tracer line shooting forward from the calculated muzzle world coordinates.
*   Spawn a muzzle flash sprite scaled by `muzzleFlashScale`.
*   Play the fire audio buffer with the pitch multiplier `firingSoundPitch`.
*   In the frame tick loop, smoothly decay the camera recoil and viewmodel displacement back to baseline using the `recoilRecoveryRate` coefficient.

---

## 4. Preservation of Performance & Code Standards (Architecture Laws)

### 4.1 Zero-Allocation Compliance
Following the strict zero-allocation render loop law in Section 7, all vectors, quaternions, euler angles, and matrix calculations inside the high-frequency update frame tick loop are **pre-allocated at module scope**.
We will define static calculation cache objects:

```typescript
const tempWepPos = new THREE.Vector3();
const tempWepRot = new THREE.Euler();
const tempCamBob = new THREE.Vector3();
const tempSwayQuat = new THREE.Quaternion();
const tempRecoilQuat = new THREE.Quaternion();
const tempTargetPos = new THREE.Vector3();
```

No `new`, `[]`, or `{}` allocations are permitted inside the requestAnimationFrame render loop.

### 4.2 Absolute WebGPU/TSL Architecture
All particle systems, flash materials, and tracer geometries created dynamically will be rendered utilizing the modern WebGPU pipeline. Any WebGL-specific fallback or deprecated calls are strictly prohibited.

---

## 5. Unified Preset Export Protocol

In compliance with the **Absolute Rule of No Direct Filesystem Writes** (Section 2 of `DEV_ENTITIES_SPECIFICATION.md`):
*   No file writes will be initiated server-side.
*   Clicking `EXPORT PRESET` when the `PLAYER` tab is active will construct a formatted JSON document of:
    *   The customized `PLAYER_PHYSICS_CONFIG` parameters.
    *   The complete dictionary of customized weapon properties (for all configured weapons in `DETAILED_WEAPONS`).
*   The button will trigger an immediate, authentic browser-download dialog:

```typescript
function exportPlayerPreset() {
  const payload = {
    PLAYER_PHYSICS_CONFIG: playerParams.physics,
    DETAILED_WEAPONS: playerParams.weapons
  };
  
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `player_weapons_preset_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

The user can safely modify values, export the JSON preset, and supply it back to the agent, who will then hand-edit `/shared/constants.ts` and `/shared/weapons.ts` to update the global defaults.

---

## 6. Implementation Milestones

*   **Milestone A**: Refactor `/shared/weapons.ts` to include the `visualConfig` block and export `DETAILED_WEAPONS` with all 8 item/weapon presets, removing magic values.
*   **Milestone B**: Refactor `/client/weapons_model.ts` to dynamically pull offsets (`hip`, `ads`, `muzzle`, `adsTilt`) and reload/draw durations directly from `DETAILED_WEAPONS` configs, eliminating hardcoded offsets.
*   **Milestone C**: Expand `/client/screens/dev-entities.ts` to add the `"PLAYER"` tab, weapon select menu, perspective toggle, custom slider bindings, and camera coordinate setups.
*   **Milestone D**: Implement first-person weapon attachment, third-person hand-node constraints, visual bobbing, weapon recoil kickback visual decay, and muzzle tracer spawns in dev-entities frame loops.
*   **Milestone E**: Add player preset parsing in the Dynamic JSON Export function and compile the applet using `compile_applet`.
