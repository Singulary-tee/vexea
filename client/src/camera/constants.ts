/**
 * Camera and Viewmodel Effects Constants
 * externalizes all magic numbers, curve multipliers, and tuning values for points 8 and 9.
 */

export const CAMERA_EFFECTS_CONFIG = {
  // Speed transition parameters (Walking to Running S-curves)
  MOVEMENT: {
    RUN_ACCEL_RATE: 1.1,  // How fast (in seconds) player transitions from walk to sprint
    RUN_DECEL_RATE: 1.5,  // How fast player transitions back from sprint to walk/stop
  },

  // Weapon follow lag ("catch up" slerp on snap rotation)
  WEAPON_FOLLOW: {
    BASE_SPEED: 20.0,      // Follow rate for slow/normal mouse sweeps
    LAG_FACTOR: 0.1,       // Larger values create MORE lag (more pronounced "catch up") on hard/snappy mouse turns
    MIN_FOLLOW_SPEED_MULT: 0.01, // Caps the minimum follow rate on extremely hard snaps
  },

  // Head Bobbing per step parameters
  BOB: {
    WALK_FREQ: 1.0,       // Footstep frequency when walking
    WALK_AMP_Y: 0.035,     // Vertical step height when walking
    WALK_AMP_X: 0.02,      // Horizontal side-to-side sway when walking
    WALK_AMP_ROLL: 0.001,  // Roll tilt when walking

    SPRINT_FREQ: 7.0,     // Footstep frequency when sprinting
    SPRINT_AMP_Y: 0.09,    // Vertical step height when sprinting
    SPRINT_AMP_X: 0.05,    // Horizontal side-to-side sway when sprinting
    SPRINT_AMP_ROLL: 0.004, // Roll tilt when sprinting

    ADS_REDUCTION: 0.35,    // Bobbing is reduced during aiming (ADS) to preserve targeting
    SMOOTHING_RATE: 10.0,   // Interpolation speed for bobbing amplitude transitions
  },

  // Camera bank tilting (leaning on sprint + sharp turn)
  TILT: {
    RUN_TILT_STRENGTH: 0.101, // Base roll angle (in radians) per unit of yaw velocity
    RUN_TILT_SPRING: 1.5,    // Spring return/catch-up speed to recover straight camera alignment
    MAX_ROLL: 0.1,          // Cap on maximum banking roll tilt (approx 7 degrees)
  },

  // Progressive viewmodel pull-back when running fast
  PULL_BACK: {
    MAX_PULL_BACK_Z: 0.02,   // Maximum distance (in meters) the weapon model is pulled backwards
    CHARGE_SPEED: 0.1,       // How quickly the pull-back builds up when running fast
    DECAY_SPEED: 10.0,       // How quickly the weapon springs back forward when slowing down
  },

  // Landing impact jolt (slight downward camera camera tilt/offset on ground hit)
  LANDING: {
    FORCE: 0.18,             // Downward pitch deflection angle on impact
    DECAY: 8.0,              // Speed at which the pitch returns to normal
  },

  // Sprint FOV dynamic stretch
  FOV_STRETCH: {
    MAX_STRETCH: 8.0,        // Maximum extra FOV degrees added when sprinting
    CHARGE_SPEED: 1.5,       // Speed at which FOV stretches
    DECAY_SPEED: 10.0,       // Speed at which FOV contracts
  }
};

(window as any).CAMERA_EFFECTS_CONFIG = CAMERA_EFFECTS_CONFIG;

