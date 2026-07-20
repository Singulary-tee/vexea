/**
 * VFX Constants and Configuration
 * Keeps all magic numbers and tuning parameters externalized.
 */

export const VFX_CONSTANTS = {
  // Firing / Muzzle Flash Settings (Niagara-style)
  FIRING: {
    FLASH_DURATION: 0.08, // in seconds
    FLASH_SCALE_MULTIPLIER: 1.2,
    LIGHT_INTENSITY: 25.0,
    LIGHT_DECAY: 2.0,
    LIGHT_DISTANCE: 8.0,
    LIGHT_COLOR: 0xFF9D3B, // Warm high-intensity amber
    CORE_COLOR: [1.0, 0.9, 0.7], // Inner core hot white-yellow
    EDGE_COLOR: [1.0, 0.4, 0.1], // Outer gas plume orange-red
    
    SPIKE_COUNT: 4,
    SPIKE_LENGTH: 1.5,
    SPIKE_WIDTH: 0.25,
    
    SMOKE_LIFETIME: 30, // in frames
    SMOKE_GROWTH_SPEED: 0.45,
    SMOKE_RISE_SPEED: 0.02,
  },

  // Hit & Impact Effects (Sparks, Decals, Dirt)
  HITS: {
    SPARK_LIFETIME: 10, // frames
    SPARK_SPEED_MIN: 3.0,
    SPARK_SPEED_MAX: 9.0,
    SPARK_GRAVITY: 9.81,
    SPARK_SIZE: 0.10,
    SPARK_DECAY_RATE: 0.95,
    
    DUST_LIFETIME: 25, // frames
    DUST_RISE_SPEED: 1.8,
    DUST_SPREAD_SPEED: 1.2,
    DUST_SIZE_START: 0.15,
    DUST_SIZE_END: 0.55,
    
    DECAL_SIZE: 0.35,
    DECAL_OFFSET_FACTOR: -5,
  },

  // Large Effects (Explosions, Fire, Smoke)
  LARGE: {
    EXPLOSION_LIFETIME: 0.8, // seconds
    EXPLOSION_SPARKS: 40,
    EXPLOSION_SMOKE_PLUMES: 15,
    EXPLOSION_LIGHT_INTENSITY: 80.0,
    EXPLOSION_LIGHT_DISTANCE: 25.0,
    EXPLOSION_EXPANSION_RATE: 2.0,
    
    FIRE_PARTICLES: 12,
    FIRE_LIFETIME: 40, // frames
    FIRE_RISE_SPEED: 0.04,
    FIRE_SIZE: 0.6,
  }
} as const;
