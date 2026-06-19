/**
 * VEXEA Dynamic Weapons Configurations & Performance Coefficients
 * Zero-allocation, mathematically aligned with server-side validation.
 */

export interface DamageFalloff {
  maxDamageRange: number; // Max damage up to this distance (meters/units)
  minDamageRange: number; // Damage scales down to minDamage at this distance
  minDamage: number;      // Minimum damage beyond minDamageRange
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
    swaySpeed: 2.5
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
    swaySpeed: 1.8
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
