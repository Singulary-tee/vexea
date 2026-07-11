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
  collider: { type: 'cuboid' | 'capsule' | 'ball', halfExtents?: [number, number, number], halfHeight?: number, radius?: number };
  muzzleOffset?: [number, number, number]; // [x,y,z] relative to drone center
  visualRadius: number; // Target radius for visual scaling
  orientationOffset?: [number, number, number]; // [x,y,z] rotation offsets in radians to align forward axis
  animations: string[]; // Available animation loops (e.g. ['spin', 'sway'] or ['wheels', 'turret'] or ['hold'])

  // Category 2 - Manual Points
  lightPoints?: [number, number, number][]; // Array of [x,y,z] light offset points
  detonationTriggerRadius?: number; // Kamikaze Bomber radius

  // Category 3 - Client-Only Animation Values
  propellerSpinRate?: number;
  hoverSwayAmount?: number;
  hoverSwaySpeed?: number;
  wheelRollSpeed?: number;
  wheelSteerAngle?: number;
  barrelRecoilAmount?: number;
  chassisVibration?: number;
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
    visualRadius: 1.0,
    orientationOffset: [0, 0, 0],
    collider: { type: 'cuboid', halfExtents: [0.777, 0.204, 0.596] },
    muzzleOffset: [0, -0.15, 0.8],
    animations: ['spin', 'sway'],
    // Category 2
    lightPoints: [[-0.5, 0, 0.5], [0.5, 0, 0.5]],
    // Category 3
    propellerSpinRate: 35.0,
    hoverSwayAmount: 0.05,
    hoverSwaySpeed: 2.0,
    muzzleFlashScale: 0.8,
    firingSoundPitch: 1.3,
    // Category 4
    maxRotationSpeed: 3.0,
    maxVerticalSpeed: 5.0,
    bankingAngle: 0.35,
    fireCooldown: 20
  },
  [DroneType.BOMBER]: {
    type: DroneType.BOMBER,
    hp: 30,
    maxHp: 30,
    damage: 80,
    speed: 15,
    apCost: 2,
    isAirUnit: true,
    groupSizeMin: 1,
    groupSizeMax: 3,
    visualRadius: 1.0,
    orientationOffset: [0, 0, 0],
    collider: { type: 'cuboid', halfExtents: [0.777, 0.204, 0.596] },
    animations: ['spin', 'sway'],
    // Category 2
    lightPoints: [[-0.5, 0, 0.5], [0.5, 0, 0.5]],
    detonationTriggerRadius: 4.0,
    // Category 3
    propellerSpinRate: 35.0,
    hoverSwayAmount: 0.05,
    hoverSwaySpeed: 2.0,
    // Category 4
    maxRotationSpeed: 3.0,
    maxVerticalSpeed: 5.0,
    bankingAngle: 0.35
  },
  [DroneType.RECON]: {
    type: DroneType.RECON,
    hp: 20,
    maxHp: 20,
    damage: 0,
    speed: 20,
    apCost: 1,
    isAirUnit: true,
    groupSizeMin: 1,
    groupSizeMax: 2,
    visualRadius: 1.0,
    orientationOffset: [0, 0, 0],
    collider: { type: 'cuboid', halfExtents: [0.777, 0.204, 0.596] },
    animations: ['spin', 'sway'],
    // Category 2
    lightPoints: [[-0.5, 0, 0.5], [0.5, 0, 0.5]],
    // Category 3
    propellerSpinRate: 20.0,
    hoverSwayAmount: 0.05,
    hoverSwaySpeed: 2.0,
    // Category 4
    maxRotationSpeed: 3.0,
    maxVerticalSpeed: 5.0,
    bankingAngle: 0.35
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
    collider: { type: 'cuboid', halfExtents: [1.187, 0.695, 1.082] },
    muzzleOffset: [0, 0.6, 0.8],
    animations: ['wheels', 'steer', 'turret'],
    // Category 2
    lightPoints: [[-0.6, 0.3, 0.8], [0.6, 0.3, 0.8]],
    // Category 3
    wheelRollSpeed: 2.5,
    wheelSteerAngle: 0.5,
    barrelRecoilAmount: 0.15,
    chassisVibration: 0.05,
    muzzleFlashScale: 1.0,
    firingSoundPitch: 0.95,
    // Category 4
    maxTurnAngle: 0.6,
    maxTurnSpeed: 3.0,
    turretRotateAngle: 3.14,
    turretGunAngle: 0.5,
    fireCooldown: 15
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

export function getDroneMuzzleWorldPosition(d: { posX: number; posY: number; posZ: number; rotX: number; rotY: number; rotZ: number; rotW: number; type: DroneType }) {
  const conf = DRONE_CONFIGS[d.type] || DRONE_CONFIGS[DroneType.TEST_ENTITY];
  const offset = conf.muzzleOffset || [0, 0.5, 0];
  
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

  const rx = (1.0 - (num5 + num6)) * offset[0] + (num7 - num12) * offset[1] + (num8 + num11) * offset[2];
  const ry = (num7 + num12) * offset[0] + (1.0 - (num4 + num6)) * offset[1] + (num9 - num10) * offset[2];
  const rz = (num8 - num11) * offset[0] + (num9 + num10) * offset[1] + (1.0 - (num4 + num5)) * offset[2];

  return {
    x: d.posX + rx,
    y: d.posY + ry,
    z: d.posZ + rz
  };
}
