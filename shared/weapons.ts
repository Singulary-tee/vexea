/**
 * VEXEA Dynamic Weapons Configurations & Performance Coefficients
 * Zero-allocation, mathematically aligned with server-side validation.
 */

export interface DamageFalloff {
  maxDamageRange: number; // Max damage up to this distance (meters/units)
  minDamageRange: number; // Damage scales down to minDamage at this distance
  minDamage: number;      // Minimum damage beyond minDamageRange
}

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
  
  // Recoil Coefficients
  recoilForceUp: number;       // Upward visual pitch recoil
  recoilForceSide: number;     // Random horizontal yaw recoil factor
  recoilRecoveryRate: number;  // Recovery speed back to center
  
  // Bullets Grouping & Spread
  baseSpreadRad: number;       // Base angular spread (radians)
  maxSpreadRad: number;        // Max angular spread under continuous fire
  heatPerShot: number;         // Dynamic accuracy bloom added per shot
  coolRate: number;            // Accuracy recovery rate
  
  // Camera Shake (Visual Impact)
  camShakeMagnitude: number;   // Screen shake translation amplitude
  camShakeDurationMs: number;  // Active shaking decay length
  
  // Range & Damage Falloff Profile
  falloff: DamageFalloff;
  
  // ADS (Aim Down Sights) Settings
  adsFovMultipier: number;     // Fov zoom scales down to this factor (e.g. 0.7)
  adsSensitivityMult: number;  // Sensitivity factor during ADS
  adsTransitionSpeed: number;  // Lerp speed coefficient
  
  // Dynamic Motion Sway
  swayAmplitude: number;       // Idle movement circle radius
  swaySpeed: number;           // Breathing speed
  
  // Visual Configuration Block
  visualConfig: WeaponVisualConfig;
}

export const DETAILED_WEAPONS: Record<string, WeaponPerformance> = {
  rifle: {
    name: "Rifle",
    fireRateHz: 10, // 600 RPM
    damage: 20,
    capacity: 40,
    
    recoilForceUp: 0.05,
    recoilForceSide: 0.02,
    recoilRecoveryRate: 8.0,
    
    baseSpreadRad: 0.015,     // ~0.8 degrees base
    maxSpreadRad: 0.08,       // Continuous fire spread
    heatPerShot: 0.012,
    coolRate: 0.05,
    
    camShakeMagnitude: 0.08,
    camShakeDurationMs: 120,
    
    falloff: {
      maxDamageRange: 25.0,
      minDamageRange: 80.0,
      minDamage: 8.0
    },
    
    adsFovMultipier: 0.70,   // 30% zoom
    adsSensitivityMult: 0.60,
    adsTransitionSpeed: 10.0,
    
    swayAmplitude: 0.003,
    swaySpeed: 2.5,
    visualConfig: {
      hipPosition: [0.025, -0.49, 0.05],
      adsPosition: [-0.075, -0.42, 0.0],
      adsTilt: -0.05,
      muzzleOffset: [0.18, 0.15, -0.47],
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
    fireRateHz: 5,  // Semi-auto
    damage: 25,
    capacity: 35,
    
    recoilForceUp: 0.08,
    recoilForceSide: 0.03,
    recoilRecoveryRate: 12.0,
    
    baseSpreadRad: 0.008,     // Higher single-shot accuracy
    maxSpreadRad: 0.05,
    heatPerShot: 0.025,       // High accuracy bloom if spammed
    coolRate: 0.08,
    
    camShakeMagnitude: 0.12,
    camShakeDurationMs: 90,
    
    falloff: {
      maxDamageRange: 12.0,
      minDamageRange: 35.0,
      minDamage: 5.0
    },
    
    adsFovMultipier: 0.85,   // 15% zoom
    adsSensitivityMult: 0.80,
    adsTransitionSpeed: 12.0,
    
    swayAmplitude: 0.0015,
    swaySpeed: 1.8,
    visualConfig: {
      hipPosition: [0.005, -0.16, -0.185],
      adsPosition: [0.0, -0.135, -0.06],
      adsTilt: 0.0,
      muzzleOffset: [0.03, 0.12, -0.25],
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
    adsFovMultipier: 0.25,
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
    damage: -50,
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

/**
 * Utility to calculate damage falloff on server/client with zero dynamic state creation
 */
export function calculateDamageWithFalloff(baseDamage: number, distance: number, falloff: DamageFalloff): number {
  if (distance <= falloff.maxDamageRange) {
    return baseDamage;
  }
  if (distance >= falloff.minDamageRange) {
    return falloff.minDamage;
  }
  const ratio = (distance - falloff.maxDamageRange) / (falloff.minDamageRange - falloff.maxDamageRange);
  return baseDamage - (baseDamage - falloff.minDamage) * ratio;
}
