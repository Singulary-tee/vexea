/**
 * VEXEA Shared Constants, Network Protocols and Types
 * Locked to Zero-GC and exact binary alignment.
 */

// Zones & Adjacency Graph from ARCHITECTURE Section 7
export const ZONES = {
  SPAWN: "zone_spawn",
  COURTYARD: "zone_courtyard",
  WAREHOUSE: "zone_warehouse",
  BRIDGE: "zone_bridge",
  PLANT: "zone_plant",
  TUNNELS: "zone_tunnels",
  CORE: "zone_core"
} as const;

export type ZoneName = typeof ZONES[keyof typeof ZONES];

export const ZONES_ARRAY = Object.values(ZONES);

export const WAYPOINTS: Record<ZoneName, { x: number; y: number; z: number }> = {
  [ZONES.SPAWN]: { x: 64, y: 1.2, z: 704 },
  [ZONES.COURTYARD]: { x: 144, y: 1.2, z: 496 },
  [ZONES.WAREHOUSE]: { x: 144, y: 1.2, z: 240 },
  [ZONES.BRIDGE]: { x: 288, y: 5.2, z: 496 },
  [ZONES.PLANT]: { x: 528, y: 1.2, z: 448 },
  [ZONES.TUNNELS]: { x: 448, y: -20.0, z: 64 },
  [ZONES.CORE]: { x: 384, y: 1.2, z: 384 }
};


export const TOPOLOGY: Record<ZoneName, ZoneName[]> = {
  [ZONES.SPAWN]: [ZONES.COURTYARD],
  [ZONES.COURTYARD]: [ZONES.SPAWN, ZONES.WAREHOUSE, ZONES.BRIDGE],
  [ZONES.WAREHOUSE]: [ZONES.COURTYARD, ZONES.TUNNELS, ZONES.PLANT],
  [ZONES.BRIDGE]: [ZONES.COURTYARD, ZONES.PLANT],
  [ZONES.PLANT]: [ZONES.WAREHOUSE, ZONES.BRIDGE, ZONES.CORE],
  [ZONES.TUNNELS]: [ZONES.WAREHOUSE, ZONES.CORE],
  [ZONES.CORE]: [ZONES.PLANT, ZONES.TUNNELS]
};

// Zone spatial bounding volumes (for AABB, pathfinding, player tracking)
export interface ZoneBounds {
  center: { x: number; y: number; z: number };
  halfSize: { x: number; y: number; z: number };
}

export const ZONE_BOUNDS: Record<ZoneName, ZoneBounds> = {
  [ZONES.SPAWN]: { center: { x: 64, y: 0, z: 704 }, halfSize: { x: 64, y: 30, z: 64 } },
  [ZONES.COURTYARD]: { center: { x: 144, y: 0, z: 496 }, halfSize: { x: 144, y: 30, z: 144 } },
  [ZONES.WAREHOUSE]: { center: { x: 144, y: 0, z: 240 }, halfSize: { x: 144, y: 30, z: 112 } },
  [ZONES.BRIDGE]: { center: { x: 288, y: 5.2, z: 496 }, halfSize: { x: 40, y: 30, z: 40 } },
  [ZONES.PLANT]: { center: { x: 528, y: 0, z: 448 }, halfSize: { x: 240, y: 30, z: 320 } },
  [ZONES.TUNNELS]: { center: { x: 448, y: -10, z: 64 }, halfSize: { x: 320, y: 25, z: 64 } },
  [ZONES.CORE]: { center: { x: 384, y: 0, z: 384 }, halfSize: { x: 64, y: 30, z: 64 } }
};

// Drone Behaviour Profiles and States
export type BehaviorProfile = "assault" | "patrol" | "recon";

export enum DroneState {
  IDLE = 0,
  PATROLLING = 1,
  PURSUING = 2,
  ATTACKING = 3,
  REPOSITIONING = 4,
  DEAD = 5
}

export enum DroneType {
  ROTARY_SHOOTER = 0,
  BOMBER = 1,
  RECON = 2,
  FIXED_WING = 3,
  WHEELED = 4,
  ROBOT_DOG = 5,
  HUMANOID = 6,
  TEST_ENTITY = 99
}

// Numerical limits and Network constraints
export const RECOIL_ANGLE_KICK = 0.05;
export const WEAPON_COOLDOWN = 0.12;
export const DRONE_RENDER_INTERPOLATION_DELAY_MS = 100;
export const MAX_REWIND_VALIDATION_TOLERANCE_MS = 200;

export interface DroneConfig {
  type: DroneType;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  apCost: number;
  isAirUnit: boolean;
  groupSizeMin: number;
  groupSizeMax: number;
  collider: { type: 'cuboid' | 'capsule' | 'ball', halfExtents?: [number, number, number], halfHeight?: number, radius?: number, offset?: [number, number, number] };
  muzzleOffset?: [number, number, number]; // [x,y,z] relative to drone center
  visualRadius: number; // Target radius for visual scaling
  orientationOffset?: [number, number, number]; // [x,y,z] rotation offsets in radians to align forward axis
  animations: string[]; // Available animation loops (e.g. ['spin', 'sway'] or ['wheels', 'turret'] or ['hold'])

  // Category 2 - Manual Points
  lightPoints?: [number, number, number][]; // Array of [x,y,z] light offset points
  detonationTriggerRadius?: number; // Kamikaze Bomber radius
  turretYawPivot?: [number, number, number];
  gunPitchPivot?: [number, number, number];
  propPivotX?: number;
  propPivotZ?: number;
  propellerOffset?: [number, number];

  // Category 3 - Client-Only Animation Values
  propellerSpinRate?: number;
  hoverSwayAmount?: number;
  hoverSwaySpeed?: number;
  verticalBobAmount?: number;
  verticalBobSpeed?: number;
  wheelRollSpeed?: number;
  wheelSteerAngle?: number;
  barrelRecoilAmount?: number;
  recoilDuration?: number;
  recoilRecoverDuration?: number;
  chassisVibration?: number;
  chassisVibrationSpeed?: number;
  muzzleFlashScale?: number;
  firingSoundPitch?: number;

  // Category 4 - Server-Authoritative Values
  maxRotationSpeed?: number;
  maxVerticalSpeed?: number;
  bankingAngle?: number;
  minSpeed?: number;
  maxTurnRate?: number;
  pitchAngle?: number;
  engagementRange?: number;
  maxTurnAngle?: number;
  maxTurnSpeed?: number;
  turretRotateAngle?: number;
  turretGunAngle?: number;
  fireCooldown?: number;
  detectionRadius?: number;
  fovHalfAngle?: number;
  decelerationRadius?: number;
}

export const DRONE_CONFIGS: Record<DroneType, DroneConfig> = {
  [DroneType.ROTARY_SHOOTER]: {
    type: DroneType.ROTARY_SHOOTER,
    hp: 40,
    maxHp: 40,
    damage: 8,
    speed: 12,
    apCost: 2,
    isAirUnit: true,
    groupSizeMin: 3,
    groupSizeMax: 5,
    visualRadius: 1,
    orientationOffset: [0, 0, 0],
    collider: { type: 'cuboid', halfExtents: [0.777, 0.204, 0.596] },
    muzzleOffset: [0.04, 2.37, 8.59],
    animations: ['spin', 'sway'],
    // Category 2
    lightPoints: [[-0.03, 0.01, 0.45], [0.03, 0.01, 0.45]],
    propPivotX: 0.6633333333333333,
    propPivotZ: 0.5666666666666667,
    propellerOffset: [0.6633333333333333, 0.5666666666666667],
    detonationTriggerRadius: 4,
    // Category 3
    propellerSpinRate: 60,
    hoverSwayAmount: 0.02,
    hoverSwaySpeed: 4.3,
    verticalBobAmount: 0.03,
    verticalBobSpeed: 1.5,
    muzzleFlashScale: 0.6,
    firingSoundPitch: 1.3,
    wheelRollSpeed: 2.5,
    wheelSteerAngle: 0.5,
    barrelRecoilAmount: 0.8,
    recoilDuration: 0.05,
    recoilRecoverDuration: 0.13,
    chassisVibration: 0.05,
    chassisVibrationSpeed: 30,
    // Category 4
    maxRotationSpeed: 1.5,
    maxVerticalSpeed: 2,
    bankingAngle: 0.15,
    minSpeed: 10,
    maxTurnRate: 1.5,
    pitchAngle: 0.35,
    engagementRange: 40,
    maxTurnAngle: 0.6,
    maxTurnSpeed: 3,
    turretRotateAngle: 3.14,
    turretGunAngle: 0.5,
    fireCooldown: 10,
    detectionRadius: 30,
    fovHalfAngle: 0.7853981633974483,
    decelerationRadius: 5
  },
  [DroneType.BOMBER]: {
    type: DroneType.BOMBER,
    hp: 40,
    maxHp: 40,
    damage: 8,
    speed: 12,
    apCost: 2,
    isAirUnit: true,
    groupSizeMin: 3,
    groupSizeMax: 5,
    visualRadius: 1.1,
    orientationOffset: [0, 0, 0],
    collider: { type: 'cuboid', halfExtents: [1.05, 0.4, 0.85] },
    muzzleOffset: [0.04, 2.37, 8.59],
    animations: ['spin', 'sway'],
    // Category 2
    lightPoints: [[-0.03, 0.01, 0.45], [0.03, 0.01, 0.45]],
    propPivotX: 0.7296666666666666,
    propPivotZ: 0.6233333333333334,
    propellerOffset: [0.7296666666666666, 0.6233333333333334],
    detonationTriggerRadius: 4,
    // Category 3
    propellerSpinRate: 60,
    hoverSwayAmount: 0.02,
    hoverSwaySpeed: 4.3,
    verticalBobAmount: 0.03,
    verticalBobSpeed: 1.5,
    muzzleFlashScale: 0.6,
    firingSoundPitch: 1.3,
    wheelRollSpeed: 2.5,
    wheelSteerAngle: 0.5,
    barrelRecoilAmount: 0.8,
    recoilDuration: 0.05,
    recoilRecoverDuration: 0.13,
    chassisVibration: 0.05,
    chassisVibrationSpeed: 30,
    // Category 4
    maxRotationSpeed: 1.5,
    maxVerticalSpeed: 2,
    bankingAngle: 0.15,
    minSpeed: 10,
    maxTurnRate: 1.5,
    pitchAngle: 0.35,
    engagementRange: 40,
    maxTurnAngle: 0.6,
    maxTurnSpeed: 3,
    turretRotateAngle: 3.14,
    turretGunAngle: 0.5,
    fireCooldown: 10,
    detectionRadius: 30,
    fovHalfAngle: 0.7853981633974483,
    decelerationRadius: 5
  },
  [DroneType.RECON]: {
    type: DroneType.RECON,
    hp: 40,
    maxHp: 40,
    damage: 8,
    speed: 12,
    apCost: 2,
    isAirUnit: true,
    groupSizeMin: 3,
    groupSizeMax: 5,
    visualRadius: 0.8,
    orientationOffset: [0, 0, 0],
    collider: { type: 'cuboid', halfExtents: [0.55, 0.19, 0.5] },
    muzzleOffset: [0.04, 2.37, 8.59],
    animations: ['spin', 'sway'],
    // Category 2
    lightPoints: [[-0.03, 0.01, 0.45], [0.03, 0.01, 0.45]],
    propPivotX: 0.5306666666666666,
    propPivotZ: 0.45333333333333337,
    propellerOffset: [0.5306666666666666, 0.45333333333333337],
    detonationTriggerRadius: 4,
    // Category 3
    propellerSpinRate: 60,
    hoverSwayAmount: 0.02,
    hoverSwaySpeed: 4.3,
    verticalBobAmount: 0.03,
    verticalBobSpeed: 1.5,
    muzzleFlashScale: 0.6,
    firingSoundPitch: 1.3,
    wheelRollSpeed: 2.5,
    wheelSteerAngle: 0.5,
    barrelRecoilAmount: 0.8,
    recoilDuration: 0.05,
    recoilRecoverDuration: 0.13,
    chassisVibration: 0.05,
    chassisVibrationSpeed: 30,
    // Category 4
    maxRotationSpeed: 1.5,
    maxVerticalSpeed: 2,
    bankingAngle: 0.15,
    minSpeed: 10,
    maxTurnRate: 1.5,
    pitchAngle: 0.35,
    engagementRange: 40,
    maxTurnAngle: 0.6,
    maxTurnSpeed: 3,
    turretRotateAngle: 3.14,
    turretGunAngle: 0.5,
    fireCooldown: 10,
    detectionRadius: 30,
    fovHalfAngle: 0.7853981633974483,
    decelerationRadius: 5
  },
  [DroneType.FIXED_WING]: {
    type: DroneType.FIXED_WING,
    hp: 60,
    maxHp: 60,
    damage: 15,
    speed: 25,
    apCost: 5,
    isAirUnit: true,
    groupSizeMin: 1,
    groupSizeMax: 1,
    visualRadius: 1.5,
    orientationOffset: [0, -1.570796, 0],
    collider: { type: 'cuboid', halfExtents: [6.435, 1.545, 13.890] },
    animations: ['hold_frame'],
    // Category 2
    lightPoints: [[-1.5, 0, 0.5], [1.5, 0, 0.5]],
    muzzleOffset: [0, 0, 1.2],
    // Category 3
    muzzleFlashScale: 2.0,
    firingSoundPitch: 0.6,
    // Category 4
    minSpeed: 10.0,
    maxTurnRate: 1.5,
    pitchAngle: 0.35,
    engagementRange: 40.0
  },
  [DroneType.WHEELED]: {
    type: DroneType.WHEELED,
    hp: 80,
    maxHp: 80,
    damage: 12,
    speed: 8,
    apCost: 3,
    isAirUnit: false,
    groupSizeMin: 2,
    groupSizeMax: 3,
    visualRadius: 1.5,
    orientationOffset: [0, -1.570796, 0],
    collider: { type: 'cuboid', halfExtents: [1.65, 0.695, 1.8], offset: [0, -0.33, 0] },
    muzzleOffset: [-4.62, 0.5, 0.1],
    animations: ['wheels', 'steer', 'turret'],
    // Category 2
    lightPoints: [[-0.6, 0.3, 3], [0.6, -0.34, 3]],
    detonationTriggerRadius: 4,
    turretYawPivot: [-0.85, 0.45, -0.81],
    gunPitchPivot: [-1.22, 0.99, 0],
    // Category 3
    wheelRollSpeed: 1.8,
    wheelSteerAngle: 0.1,
    barrelRecoilAmount: 0.6,
    recoilDuration: 0.08,
    recoilRecoverDuration: 0.16,
    chassisVibration: 0.01,
    chassisVibrationSpeed: 32.79,
    muzzleFlashScale: 1.7,
    firingSoundPitch: 0.95,
    // Category 4
    maxRotationSpeed: 3,
    maxVerticalSpeed: 5,
    bankingAngle: 0.35,
    minSpeed: 10,
    maxTurnRate: 0.3,
    pitchAngle: 0.35,
    engagementRange: 40,
    maxTurnAngle: 0.3,
    maxTurnSpeed: 1.5,
    turretRotateAngle: 6.25,
    turretGunAngle: 0.3,
    fireCooldown: 30,
    detectionRadius: 30,
    fovHalfAngle: 0.7853981633974483,
    decelerationRadius: 5
  },
  [DroneType.ROBOT_DOG]: {
    type: DroneType.ROBOT_DOG,
    hp: 150,
    maxHp: 150,
    damage: 18,
    speed: 5,
    apCost: 4,
    isAirUnit: false,
    groupSizeMin: 1,
    groupSizeMax: 2,
    visualRadius: 1.0,
    orientationOffset: [0, 0, 0],
    collider: { type: 'cuboid', halfExtents: [0.8, 0.6, 1.0] },
    muzzleOffset: [0, 0.5, 0.8],
    animations: ['walk'],
    // Category 4
    maxTurnAngle: 0.6,
    maxTurnSpeed: 2.0,
    fireCooldown: 20
  },
  [DroneType.HUMANOID]: {
    type: DroneType.HUMANOID,
    hp: 200,
    maxHp: 200,
    damage: 20,
    speed: 3,
    apCost: 6,
    isAirUnit: false,
    groupSizeMin: 1,
    groupSizeMax: 1,
    visualRadius: 1.0,
    orientationOffset: [0, 0, 0],
    collider: { type: 'capsule', halfHeight: 1.0, radius: 0.8 },
    muzzleOffset: [0.2, 0.8, 0.5],
    animations: ['walk', 'run', 'shoot'],
    // Category 4
    maxTurnAngle: 0.6,
    maxTurnSpeed: 2.0,
    fireCooldown: 40
  },
  [DroneType.TEST_ENTITY]: { type: DroneType.TEST_ENTITY, hp: 100, maxHp: 100, damage: 0, speed: 10, apCost: 0, isAirUnit: false, groupSizeMin: 1, groupSizeMax: 1, visualRadius: 1.0, orientationOffset: [0, 0, 0], collider: { type: 'ball', radius: 1.5 }, animations: [] }
};

export const HEADER_SIZE = 8; // Tick(4), DroneCount(2), CameraCount(2)
export const DRONE_STRUCT_SIZE = 32;
export const CAMERA_STRUCT_SIZE = 4;
export const MAX_DRONES = 50;
export const MAX_CAMERAS = 20;
export const TOTAL_STATE_BUFFER_SIZE = HEADER_SIZE + DRONE_STRUCT_SIZE * MAX_DRONES + CAMERA_STRUCT_SIZE * MAX_CAMERAS;

// Player Physics & Dimensions
export const PLAYER_RADIUS = 0.4;
export const PLAYER_CAPSULE_HALF_HEIGHT = 0.5; // Dist between spheres: Total height 1.8m (2*0.5 + 2*0.4)
export const PLAYER_CAPSULE_HALF_HEIGHT_CROUCH = 0.15; // Total height 1.1m (2*0.15 + 2*0.4)
export const PLAYER_TOTAL_HEIGHT = 1.8;
export const PLAYER_CENTER_OFFSET = PLAYER_TOTAL_HEIGHT / 2; // 0.9m
export const PLAYER_EYE_LEVEL = 1.6;
export const PLAYER_EYE_LEVEL_CROUCH = 1.0;

export interface DroneNetworkData {
  id: number;
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  rotW: number;
  stateId: DroneState;
}

import { DETAILED_WEAPONS } from "./weapons";
import type { WeaponPerformance } from "./weapons";

export { DETAILED_WEAPONS };
export type { WeaponPerformance };

// Player weapon types and characteristics
export interface WeaponStats {
  name: string;
  fireRateHz: number; // Max frequency
  damage: number;
  capacity: number;
}

export const WEAPONS: Record<string, WeaponStats> = {
  rifle: DETAILED_WEAPONS.rifle,
  pistol: DETAILED_WEAPONS.pistol
};

// Combat & Health sync structure
export interface HitEvent {
  sequence: number;
  timestamp: number;
  posX: number;
  posY: number;
  posZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

export function getDroneMuzzleWorldPosition(
  d: { posX: number; posY: number; posZ: number; rotX: number; rotY: number; rotZ: number; rotW: number; type: DroneType },
  targetPos?: { x: number; y: number; z: number }
) {
  const conf = DRONE_CONFIGS[d.type] || DRONE_CONFIGS[DroneType.TEST_ENTITY];
  const offset = conf.muzzleOffset || [0, 0.5, 0];
  
  let rx = offset[0];
  let ry = offset[1];
  let rz = offset[2];

  if (d.type === DroneType.WHEELED && targetPos) {
    // Precise analytical forward kinematics for the wheeled drone's articulated turret
    const pt_x = conf.turretYawPivot ? conf.turretYawPivot[0] : 0.0;
    const pt_y = conf.turretYawPivot ? conf.turretYawPivot[1] : 0.45;
    const pt_z = conf.turretYawPivot ? conf.turretYawPivot[2] : -0.1;

    const pg_x = conf.gunPitchPivot ? conf.gunPitchPivot[0] : 0.0;
    const pg_y = conf.gunPitchPivot ? conf.gunPitchPivot[1] : 0.65;
    const pg_z = conf.gunPitchPivot ? conf.gunPitchPivot[2] : 0.0;

    const pg_rel_x = pg_x - pt_x;
    const pg_rel_y = pg_y - pt_y;
    const pg_rel_z = pg_z - pt_z;

    const pm_rel_x = offset[0] - pg_x;
    const pm_rel_y = offset[1] - pg_y;
    const pm_rel_z = offset[2] - pg_z;

    // 1. Transform targetPos to local space of the drone body
    const dx = targetPos.x - d.posX;
    const dy = targetPos.y - d.posY;
    const dz = targetPos.z - d.posZ;

    const qx = -d.rotX;
    const qy = -d.rotY;
    const qz = -d.rotZ;
    const qw = d.rotW;

    const num1 = qx * 2;
    const num2 = qy * 2;
    const num3 = qz * 2;
    const num4 = qx * num1;
    const num5 = qy * num2;
    const num6 = qz * num3;
    const num7 = qx * num2;
    const num8 = qx * num3;
    const num9 = qy * num3;
    const num10 = qw * num1;
    const num11 = qw * num2;
    const num12 = qw * num3;

    const localTargetX = (1.0 - (num5 + num6)) * dx + (num7 - num12) * dy + (num8 + num11) * dz;
    const localTargetY = (num7 + num12) * dx + (1.0 - (num4 + num6)) * dy + (num9 - num10) * dz;
    const localTargetZ = (num8 - num11) * dx + (num9 + num10) * dy + (1.0 - (num4 + num5)) * dz;

    // 2. Vector from Gun Pivot to local target
    const vx = localTargetX - pg_x;
    const vy = localTargetY - pg_y;
    const vz = localTargetZ - pg_z;

    // 3. Calculate yaw and pitch needed to face local target
    const targetYaw = Math.atan2(vz, vx);
    const dist2d = Math.sqrt(vx * vx + vz * vz);
    const targetPitch = Math.atan2(vy, dist2d);

    const maxYaw = conf.turretRotateAngle ?? Math.PI;
    const maxPitch = conf.turretGunAngle ?? 0.5;
    const clampedYaw = Math.max(-maxYaw, Math.min(maxYaw, targetYaw));
    const clampedPitch = Math.max(-maxPitch, Math.min(maxPitch, targetPitch));

    // 4. Kinematic chain evaluation
    const cosP = Math.cos(clampedPitch);
    const sinP = Math.sin(clampedPitch);
    const rGunX = pm_rel_x * cosP - pm_rel_y * sinP;
    const rGunY = pm_rel_x * sinP + pm_rel_y * cosP;
    const rGunZ = pm_rel_z;

    const rTurretRelX = rGunX + pg_rel_x;
    const rTurretRelY = rGunY + pg_rel_y;
    const rTurretRelZ = rGunZ + pg_rel_z;

    const cosY = Math.cos(clampedYaw);
    const sinY = Math.sin(clampedYaw);
    const rTurretX = rTurretRelX * cosY - rTurretRelZ * sinY;
    const rTurretY = rTurretRelY;
    const rTurretZ = rTurretRelX * sinY + rTurretRelZ * cosY;

    rx = rTurretX + pt_x;
    ry = rTurretY + pt_y;
    rz = rTurretZ + pt_z;
  }

  const qx = d.rotX;
  const qy = d.rotY;
  const qz = d.rotZ;
  const qw = d.rotW;

  const num1 = qx * 2;
  const num2 = qy * 2;
  const num3 = qz * 2;
  const num4 = qx * num1;
  const num5 = qy * num2;
  const num6 = qz * num3;
  const num7 = qx * num2;
  const num8 = qx * num3;
  const num9 = qy * num3;
  const num10 = qw * num1;
  const num11 = qw * num2;
  const num12 = qw * num3;

  const rx_final = (1.0 - (num5 + num6)) * rx + (num7 - num12) * ry + (num8 + num11) * rz;
  const ry_final = (num7 + num12) * rx + (1.0 - (num4 + num6)) * ry + (num9 - num10) * rz;
  const rz_final = (num8 - num11) * rx + (num9 + num10) * ry + (1.0 - (num4 + num5)) * rz;

  return {
    x: d.posX + rx_final,
    y: d.posY + ry_final,
    z: d.posZ + rz_final
  };
}
