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
  [ZONES.SPAWN]: { x: 0, y: 1.2, z: 120 },
  [ZONES.COURTYARD]: { x: 0, y: 1.2, z: 50 },
  [ZONES.WAREHOUSE]: { x: -40, y: 1.2, z: 0 },
  [ZONES.BRIDGE]: { x: 40, y: 5.2, z: 0 },
  [ZONES.PLANT]: { x: 0, y: 1.2, z: -50 },
  [ZONES.TUNNELS]: { x: -40, y: -5.0, z: -50 },
  [ZONES.CORE]: { x: 0, y: 1.2, z: -100 }
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
  [ZONES.SPAWN]: { center: { x: 0, y: 0, z: 0 }, halfSize: { x: 20, y: 10, z: 20 } },
  [ZONES.COURTYARD]: { center: { x: 0, y: 0, z: 50 }, halfSize: { x: 60, y: 10, z: 30 } },
  [ZONES.WAREHOUSE]: { center: { x: -50, y: 0, z: 120 }, halfSize: { x: 30, y: 10, z: 40 } },
  [ZONES.BRIDGE]: { center: { x: 0, y: 0, z: 110 }, halfSize: { x: 20, y: 10, z: 30 } },
  [ZONES.PLANT]: { center: { x: 20, y: 0, z: 180 }, halfSize: { x: 40, y: 10, z: 40 } },
  [ZONES.TUNNELS]: { center: { x: -50, y: 0, z: 200 }, halfSize: { x: 30, y: 10, z: 40 } },
  [ZONES.CORE]: { center: { x: 0, y: 0, z: 250 }, halfSize: { x: 40, y: 10, z: 30 } }
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
  HUMANOID = 6
}

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
}

export const DRONE_CONFIGS: Record<DroneType, DroneConfig> = {
  [DroneType.ROTARY_SHOOTER]: { type: DroneType.ROTARY_SHOOTER, hp: 40, maxHp: 40, damage: 8, speed: 12, apCost: 2, isAirUnit: true, groupSizeMin: 3, groupSizeMax: 5 },
  [DroneType.BOMBER]: { type: DroneType.BOMBER, hp: 30, maxHp: 30, damage: 80, speed: 15, apCost: 2, isAirUnit: true, groupSizeMin: 1, groupSizeMax: 3 },
  [DroneType.RECON]: { type: DroneType.RECON, hp: 20, maxHp: 20, damage: 0, speed: 20, apCost: 1, isAirUnit: true, groupSizeMin: 1, groupSizeMax: 2 },
  [DroneType.FIXED_WING]: { type: DroneType.FIXED_WING, hp: 60, maxHp: 60, damage: 15, speed: 25, apCost: 5, isAirUnit: true, groupSizeMin: 1, groupSizeMax: 1 },
  [DroneType.WHEELED]: { type: DroneType.WHEELED, hp: 80, maxHp: 80, damage: 12, speed: 8, apCost: 3, isAirUnit: false, groupSizeMin: 2, groupSizeMax: 3 },
  [DroneType.ROBOT_DOG]: { type: DroneType.ROBOT_DOG, hp: 150, maxHp: 150, damage: 18, speed: 5, apCost: 4, isAirUnit: false, groupSizeMin: 1, groupSizeMax: 2 },
  [DroneType.HUMANOID]: { type: DroneType.HUMANOID, hp: 200, maxHp: 200, damage: 20, speed: 3, apCost: 6, isAirUnit: false, groupSizeMin: 1, groupSizeMax: 1 }
};

export const HEADER_SIZE = 8; // Tick(4), DroneCount(2), CameraCount(2)
export const DRONE_STRUCT_SIZE = 32;
export const CAMERA_STRUCT_SIZE = 4;
export const MAX_DRONES = 50;
export const MAX_CAMERAS = 20;
export const TOTAL_STATE_BUFFER_SIZE = HEADER_SIZE + DRONE_STRUCT_SIZE * MAX_DRONES + CAMERA_STRUCT_SIZE * MAX_CAMERAS;

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
