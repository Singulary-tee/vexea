import { DroneType, DroneState, getDroneMuzzleWorldPosition, DRONE_CONFIGS } from "../../shared/constants";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { PlayerState, ServerDrone } from "../MatchRoom";
import { CollisionSystem } from "../../shared/collision";

export interface DroneIntelConfig {
  sightDistance: number;
  visionConeAngle: number;
  hearingRadius: number;
  memoryDecayRate: number;
  engagementMin: number;
  engagementMax: number;
  fireArcTolerance: number;
}

export const INTEL_CONFIGS: Record<DroneType, DroneIntelConfig> = {
  [DroneType.ROTARY_SHOOTER]: { sightDistance: 50, visionConeAngle: Math.PI/2, hearingRadius: 60, memoryDecayRate: 0.05, engagementMin: 15, engagementMax: 30, fireArcTolerance: 0.2 },
  [DroneType.BOMBER]: { sightDistance: 40, visionConeAngle: Math.PI/1.5, hearingRadius: 50, memoryDecayRate: 0.1, engagementMin: 0, engagementMax: 4, fireArcTolerance: 0 },
  [DroneType.RECON]: { sightDistance: 80, visionConeAngle: Math.PI, hearingRadius: 80, memoryDecayRate: 0.02, engagementMin: 40, engagementMax: 70, fireArcTolerance: 0 },
  [DroneType.FIXED_WING]: { sightDistance: 100, visionConeAngle: Math.PI/3, hearingRadius: 100, memoryDecayRate: 0.05, engagementMin: 20, engagementMax: 100, fireArcTolerance: 0 },
  [DroneType.WHEELED]: { sightDistance: 60, visionConeAngle: Math.PI/2, hearingRadius: 60, memoryDecayRate: 0.05, engagementMin: 10, engagementMax: 40, fireArcTolerance: 0 },
  [DroneType.ROBOT_DOG]: { sightDistance: 70, visionConeAngle: Math.PI/2.5, hearingRadius: 80, memoryDecayRate: 0.03, engagementMin: 15, engagementMax: 50, fireArcTolerance: 0 },
  [DroneType.HUMANOID]: { sightDistance: 90, visionConeAngle: Math.PI/3, hearingRadius: 70, memoryDecayRate: 0.02, engagementMin: 20, engagementMax: 60, fireArcTolerance: 0 },
  [DroneType.TEST_ENTITY]: { sightDistance: 90, visionConeAngle: Math.PI/3, hearingRadius: 70, memoryDecayRate: 0.02, engagementMin: 20, engagementMax: 60, fireArcTolerance: 0 },
};

export interface MemoryRecord {
  entityId: string;
  lastSensedPosition: { x: number, y: number, z: number };
  timeLastSensed: number;
  confidence: number;
  touchedThisTick?: boolean; // temporary flag for Zero-GC
}

export const DECAY_RATE = 1.0 / 15.0; // Tunable starting value: fully decays from 1.0 to 0.0 in ~15 seconds.
export const UNKNOWN_THRESHOLD = 0.2; // Tunable starting value.

export type MemoryThreeState = 'confirmed' | 'last_seen' | 'unknown';

export function getMemoryThreeState(confidence: number): MemoryThreeState {
  if (confidence === 1.0) {
    return 'confirmed';
  } else if (confidence > UNKNOWN_THRESHOLD && confidence < 1.0) {
    return 'last_seen';
  } else {
    return 'unknown';
  }
}

let lastLogMs = 0;
const LOG_COOLDOWN_MS = 1000;

export function processDroneIntelligence(
  nowMs: number,
  drones: ServerDrone[],
  players: Map<string, PlayerState>,
  rapierWorld: RAPIER.World | null,
  RAPIER_MOD: typeof RAPIER,
  dt: number = 0.0166,
  collisionMap: CollisionSystem | null = null
) {
  const livingPlayers: PlayerState[] = [];
  for (const player of players.values()) {
    if (player.isAlive && player.body) {
      livingPlayers.push(player);
    }
  }

  for (let i = 0; i < drones.length; i++) {
    const d = drones[i];
    if (d.state === DroneState.DEAD) continue;
    if (d.type === DroneType.TEST_ENTITY) continue;

    const conf = INTEL_CONFIGS[d.type];
    const droneConfig = DRONE_CONFIGS[d.type as DroneType];
    const sightDistance = droneConfig?.detectionRadius ?? conf.sightDistance;
    const visionConeAngle = droneConfig?.fovHalfAngle ? (droneConfig.fovHalfAngle * 2) : conf.visionConeAngle;
    
    if (!d.memoryRecords) d.memoryRecords = [];

    // Reset touched flags for Zero-GC memory tracking
    const records = d.memoryRecords;
    const initialRecLen = records.length;
    for (let r = 0; r < initialRecLen; r++) {
      records[r].touchedThisTick = false;
    }

    for (const player of livingPlayers) {
      // Stage 1: Distance check (Cheapest)
      const sensorPos = { x: d.posX, y: d.posY + 0.5, z: d.posZ };
      const dx = player.posX - sensorPos.x;
      const dy = (player.posY + 0.5) - sensorPos.y;
      const dz = player.posZ - sensorPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const inDistance = dist <= sightDistance;

      let inFOV = false;
      let angle = 0;
      let halfAngle = 0;

      if (inDistance) {
        // Stage 2: Cone/FOV angle check
        // Compute rotated 3D forward vector of the drone from its quaternion
        const qx = d.rotX;
        const qy = d.rotY;
        const qz = d.rotZ;
        const qw = d.rotW;

        // Assuming forward is +Z (0, 0, 1) in local space
        const forwardX = 2 * (qx * qz + qw * qy);
        const forwardY = 2 * (qy * qz - qw * qx);
        const forwardZ = 1 - 2 * (qx * qx + qy * qy);

        const fLen = Math.sqrt(forwardX * forwardX + forwardY * forwardY + forwardZ * forwardZ);
        const fx = fLen > 0 ? forwardX / fLen : 0;
        const fy = fLen > 0 ? forwardY / fLen : 0;
        const fz = fLen > 0 ? forwardZ / fLen : 1;

        // Direction to player
        const dirX = dist > 0 ? dx / dist : 0;
        const dirY = dist > 0 ? dy / dist : 0;
        const dirZ = dist > 0 ? dz / dist : 1;

        // Angle between forward vector and direction to player
        const dot = fx * dirX + fy * dirY + fz * dirZ;
        angle = Math.acos(Math.max(-1, Math.min(1, dot))); // Angle in radians

        let fov = visionConeAngle;
        if (d.type === DroneType.HUMANOID) {
          fov = Math.max(Math.PI / 6, (Math.PI / 2) * (1 - dist / sightDistance));
        }
        halfAngle = fov / 2;

        inFOV = angle <= halfAngle;
      }

      let hasLOS = false;

      if (inDistance && inFOV) {
        // Stage 3: Line-of-sight raycast (Most expensive)
        hasLOS = true;
        const rDir = { x: dx / dist, y: dy / dist, z: dz / dist };

        // 1. Check against static map structures
        if (collisionMap) {
          if (collisionMap.rayIntersectsAny(sensorPos, rDir, dist)) {
            hasLOS = false;
          }
        }

        // 2. Check against dynamic/other structures in rapierWorld (fallback)
        if (hasLOS && rapierWorld) {
          const rapierRay = new RAPIER_MOD.Ray(sensorPos, rDir);
          const hit = rapierWorld.castRay(rapierRay, dist, true, RAPIER_MOD.QueryFilterFlags.EXCLUDE_DYNAMIC);
          if (hit && hit.timeOfImpact < dist - 0.1) {
            hasLOS = false;
          }
        }
      }

      let detected = inDistance && inFOV && hasLOS;

      // 4. Hearing reaction (Gunshot sound)
      let heard = false;
      if (!detected && player.firedThisTick) {
        if (dist <= conf.hearingRadius) {
          heard = true;
        }
      }

      // 5. Damage reaction
      let reactedToDamage = false;
      if (!detected && !heard && d.damageLog && d.damageLog.length > 0) {
        // Check if latest damage log was caused by this player recently (within 2 seconds)
        const latestDamage = d.damageLog[d.damageLog.length - 1];
        if (latestDamage.playerId === player.id && (nowMs - latestDamage.timestamp) < 2000) {
          reactedToDamage = true;
        }
      }

      if (detected || heard || reactedToDamage) {
        let record = d.memoryRecords.find((r: any) => r.entityId === player.id);
        if (!record) {
          record = { entityId: player.id, lastSensedPosition: { x: 0, y: 0, z: 0 }, timeLastSensed: 0, confidence: 0 };
          d.memoryRecords.push(record);
        }
        const proposedConfidence = 1.0;
        record.confidence = Math.max(record.confidence, proposedConfidence);
        record.lastSensedPosition = { x: player.posX, y: player.posY, z: player.posZ };
        record.timeLastSensed = nowMs / 1000;
        record.touchedThisTick = true;
        detected = true; // treat as detected for logging
      }

      // Tick-gated representative logging for a single drone (e.g., first active drone)
      const now = Date.now();
      if (i === 0 && now - lastLogMs > LOG_COOLDOWN_MS) {
        lastLogMs = now;
        const droneTypeName = DroneType[d.type] || "UNKNOWN";
        const record = d.memoryRecords.find((r: any) => r.entityId === player.id);
        const currentConf = record ? record.confidence : 0;
        const threeState = getMemoryThreeState(currentConf);
        console.log(
          `[SIGHT_PERCEPTION] Tick Representative Drone ID: ${d.id} (${droneTypeName}) | Player: ${player.id} | ` +
          `Stage 1 (Dist: ${dist.toFixed(2)}m / Max: ${conf.sightDistance}m) -> ${inDistance ? "PASS" : "FAIL"} | ` +
          `Stage 2 (FOV: ${(angle * 180 / Math.PI).toFixed(1)}° / Half-FOV: ${(halfAngle * 180 / Math.PI).toFixed(1)}°) -> ${inFOV ? "PASS" : "FAIL"} | ` +
          `Stage 3 (Raycast unobstructed) -> ${hasLOS ? "PASS" : "FAIL"} | ` +
          `Result -> ${detected ? `WRITE confidence=1.0` : `DECAY confidence=${currentConf.toFixed(4)}`} | State: ${threeState} | pos(${player.posX.toFixed(1)}, ${player.posY.toFixed(1)}, ${player.posZ.toFixed(1)})`
        );
      }
    }

    // Decay records that were not updated this tick (using final records length)
    const currentRecLen = records.length;
    for (let r = 0; r < currentRecLen; r++) {
      const record = records[r];
      if (!record.touchedThisTick) {
        record.confidence = Math.max(0, record.confidence - (DECAY_RATE * dt));
      }
    }

    // STATE MACHINE SYNCHRONIZER
    // Find the highest-confidence player memory record
    let bestRecord: any = null;
    let maxConf = 0;
    for (let r = 0; r < records.length; r++) {
      if (records[r].confidence > maxConf) {
        maxConf = records[r].confidence;
        bestRecord = records[r];
      }
    }

    if (maxConf > UNKNOWN_THRESHOLD) {
      d.mode = "COMBAT";
      d.combatTarget = bestRecord;
    } else {
      d.mode = "NORMAL";
      d.combatTarget = null;
    }
  }
}
