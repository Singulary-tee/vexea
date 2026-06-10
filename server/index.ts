/**
 * VEXEA Authoritative Full-Stack Game Server
 * Built with vanilla Node.js, Express, ws, Rapier3D, and Gemini 3.5 Flash.
 * Enforces Zero-GC, authoritative validation, and server-side LLM coordination.
 */

import { GoogleGenAI, Type } from "@google/genai";

let globalChannels: any[] = [];

const globalServerLogs: string[] = [];
const originalLog = console.log;
console.log = function(...args: any[]) {
  const msg = args.join(" ");
  originalLog.apply(console, args);
  globalServerLogs.push(msg);
  if (globalServerLogs.length > 500) globalServerLogs.shift();
  try {
     for (const c of globalChannels) {
        c.emit("server_debug", msg);
     }
  } catch(e) {}
};
import RAPIER from "@dimforge/rapier3d-compat";
import dotenv from "dotenv";
import express from "express";
import http from "http";
import path from "path";
import { createTransport, ChannelAdapter } from "./transport/adapter";
import { createServer as createViteServer } from "vite";

import {
  HEADER_SIZE,
  DRONE_STRUCT_SIZE,
  CAMERA_STRUCT_SIZE,
  MAX_DRONES,
  TOTAL_STATE_BUFFER_SIZE,
  ZONES,
  TOPOLOGY,
  ZONE_BOUNDS,
  DroneState,
  DroneType,
  WEAPONS,
  ZoneName, WAYPOINTS, ZONES_ARRAY,
  BehaviorProfile,
  DRONE_CONFIGS
} from "../shared/constants";

dotenv.config();


const processMatchEndTransaction = (playerId: string, finalScore: number, adMultiplier: number) => {
    runTransaction(db, async (transaction) => {
       const userRef = doc(db, "Users", playerId);
       const userDoc = await transaction.get(userRef);
       let bpRank = adMultiplier * (finalScore > 0 ? 1 : 0);
       let awardedScore = finalScore * adMultiplier;
       
       if (!userDoc.exists()) {
          transaction.set(userRef, { kills: 0, score: awardedScore, battlePass: bpRank });
       } else {
          transaction.update(userRef, { 
             score: increment(awardedScore),
             battlePass: increment(bpRank)
          });
       }
       const matchRef = doc(db, "MatchInProgress", playerId);
       transaction.delete(matchRef);
    }).catch(() => {});
};

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, deleteDoc, updateDoc, increment, collection, query, where, getDocs, runTransaction } from "firebase/firestore";
// @ts-ignore
import firebaseConfig from "../firebase-applet-config.json" assert { type: 'json' };

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

// Garbage Collector for MatchInProgress
setInterval(async () => {
  try {
    const q = query(collection(db, "MatchInProgress"), where("startTime", "<", Date.now() - 2 * 60 * 60 * 1000));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (docSnap) => {
      // Penalize for combat logging by penalizing score
      const data = docSnap.data();
      if (data.playerId) {
        try {
           const userRef = doc(db, "Users", data.playerId);
           await updateDoc(userRef, { score: increment(-50) });
        } catch(e) {}
      }
      await deleteDoc(docSnap.ref);
    });
  } catch (e) {
  }
}, 30 * 60 * 1000);


// Create Express and HTTP Server
const app = express();
const server = http.createServer(app);
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
});
const io = createTransport();
io.listen(3000, server);
const PORT = 3000;

app.use(express.json());

app.get("/api/debug", (req, res) => {
  res.json({ drones: drones.map(d => d.state), players: Array.from(players.keys()), logs: globalServerLogs });
});

// 1. Static Waypoints Node Network for topological A* pathfinding

// Topological A* implementation (Zero GC / pre-allocated arrays)
const astarPath = (start: ZoneName, end: ZoneName): ZoneName[] => {
  if (start === end) return [start];
  
  const queue: ZoneName[][] = [[start]];
  const visited = new Set<ZoneName>([start]);
  
  while (queue.length > 0) {
    const currentPath = queue.shift()!;
    const lastNode = currentPath[currentPath.length - 1];
    if (lastNode === end) return currentPath;
    
    const neighbors = TOPOLOGY[lastNode];
    for (let i = 0; i < neighbors.length; i++) {
      const neighbor = neighbors[i];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...currentPath, neighbor]);
      }
    }
  }
  return [start];
};

// 2. Game Simulation Entities & State
interface PlayerState {
  id: string;
  channel: ChannelAdapter;
  kcc: RAPIER.KinematicCharacterController | null;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  
  inputMask: number;
  fire: number;
  timestamp: number;
  
  posX: number; posY: number; posZ: number;
  velX: number; velY: number; velZ: number;
  pitch: number; yaw: number;
  hp: number;
  score: number;
  weapon?: string;
  
  ping: number;
  lastSequence: number;
  leakyRateLimit: number;
  lastFireTime: number;

  velEmaX: number; velEmaY: number; velEmaZ: number;
  adMultiplier?: number;
  firedThisTick?: boolean;
}

interface ServerDrone {
  id: number;
  type: DroneType;
  state: DroneState;
  behavior: BehaviorProfile;
  zone: ZoneName;
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  rotW: number;
  velX: number;
  velY: number;
  velZ: number;
  rad: number;
  hp: number;
  groupId: string;
  targetX: number;
  targetY: number;
  targetZ: number;
  path: ZoneName[];
  pathIndex: number;
  cooldown: number; // Fire interval cooldown ticks
}

interface ServerProjectile {
  active: boolean;
  posX: number;
  posY: number;
  posZ: number;
  velX: number;
  velY: number;
  velZ: number;
  isEnemy: boolean;
  damage: number;
  life: number; // Ticks remaining
}

// Global Match Pools (Pre-allocated for Zero GC)
const players = new Map<string, PlayerState>();
const drones: ServerDrone[] = [];
const projectiles: ServerProjectile[] = [];
let nextDroneId = 1;
let serverTick = 0;

// Initialize drone pool with inactive structures
for (let i = 0; i < MAX_DRONES; i++) {
  drones.push({
    id: 0,
    type: DroneType.WHEELED,
    state: DroneState.DEAD,
    behavior: "patrol",
    zone: ZONES.CORE,
    posX: 0, posY: 0, posZ: 0,
    rotX: 0, rotY: 0, rotZ: 0, rotW: 1,
    velX: 0, velY: 0, velZ: 0,
    rad: 1.2,
    hp: 100,
    groupId: "G_ALPHA",
    targetX: 0, targetY: 0, targetZ: 0,
    path: [],
    pathIndex: 0,
    cooldown: 0
  });
}

// Projectile Pre-allocated Pool
const MAX_PROJECTILES = 200;
for (let i = 0; i < MAX_PROJECTILES; i++) {
  projectiles.push({
    active: false,
    posX: 0, posY: 0, posZ: 0,
    velX: 0, velY: 0, velZ: 0,
    isEnemy: false,
    damage: 0,
    life: 0
  });
}

// 3. Rapier3D Physic System & Map Colliders
let rapierWorld: RAPIER.World;

const initPhysics = async () => {
  await RAPIER.init();
  rapierWorld = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
  
  // Floor plate
  const floorDesc = RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0);
  rapierWorld.createCollider(floorDesc);
  
  // Outer boundary walls
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(100, 20, 1).setTranslation(0, 10, 100));
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(100, 20, 1).setTranslation(0, 10, -100));
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(1, 20, 100).setTranslation(100, 10, 0));
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(1, 20, 100).setTranslation(-100, 10, 0));

  // Build some architectural layout obstacles inside zones
  // Center Reactor Core Pillars
  rapierWorld.createCollider(RAPIER.ColliderDesc.cylinder(6, 4).setTranslation(0, 3, 0));
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(5, 4, 1).setTranslation(-15, 2, -15));
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(5, 4, 1).setTranslation(15, 2, -15));
  
  // Hangar partition crates
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(4, 4, 4).setTranslation(35, 2, 20));
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(3, 3, 3).setTranslation(45, 1.5, 35));
  
  // Laboratory dividing glass blocks
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(12, 5, 1).setTranslation(30, 2.5, -20));
};

// 4. Hitscan Historical AABB Validation Ring Buffer
const HISTORICAL_SAMPLES_MAX = 120; // 2 seconds history at 60Hz
// Layout: [tickId, count, ...droneStats(id, x, y, z)] per block.
// Block size: 2 + MAX_DRONES * 4 floats.
const HISTORIC_BLOCK_SIZE = 2 + MAX_DRONES * 4;
const historicalAABBHistory = new Float32Array(HISTORICAL_SAMPLES_MAX * HISTORIC_BLOCK_SIZE);
let historicalAABBIndex = 0;

const recordDroneHistory = () => {
  const baseIdx = historicalAABBIndex * HISTORIC_BLOCK_SIZE;
  historicalAABBHistory[baseIdx] = serverTick;
  let count = 0;
  for (let i = 0; i < drones.length; i++) {
    const d = drones[i];
    if (true) {
      const dBase = baseIdx + 2 + count * 4;
      historicalAABBHistory[dBase] = d.id;
      historicalAABBHistory[dBase + 1] = d.posX;
      historicalAABBHistory[dBase + 2] = d.posY;
      historicalAABBHistory[dBase + 3] = d.posZ;
      count++;
    }
  }
  historicalAABBHistory[baseIdx + 1] = count;
  historicalAABBIndex = (historicalAABBIndex + 1) % HISTORICAL_SAMPLES_MAX;
};

// 5. LLM AI Commander Module (Gemini 3.5 Flash Integration)
let geminiClient: GoogleGenAI | null = null;
let aiCommanderActive = false;
let geminiThrottleCooldownUntil = 0;
const failedOperations: string[] = [];

const initLLMCommander = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return;
  }
  geminiClient = new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
  aiCommanderActive = true;
};

export interface ServerZoneState {
  id: string;
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  connectedZones: string[];
  droneGroups: string[];
  playerPresence: "confirmed" | "last_seen" | "unknown";
  lastSeenTimestamp: number;
  activeOperations: { type: string; eta: number; progress: number }[];
  combatEffectiveness: "full" | "degraded" | "critical" | "destroyed";
  droneSpawnEnabled: boolean;
  allowsAirUnits: boolean;
}

const zoneSummary: Record<ZoneName, ServerZoneState> = {
  [ZONES.SPAWN]: {
    id: ZONES.SPAWN, name: "zone_spawn", bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
    connectedZones: [ZONES.COURTYARD], droneGroups: [],
    playerPresence: 'unknown', lastSeenTimestamp: 0, activeOperations: [],
    combatEffectiveness: 'full', droneSpawnEnabled: false, allowsAirUnits: false
  },
  [ZONES.COURTYARD]: {
    id: ZONES.COURTYARD, name: "zone_courtyard", bounds: { minX: -60, maxX: 60, minZ: 20, maxZ: 80 },
    connectedZones: [ZONES.SPAWN, ZONES.WAREHOUSE, ZONES.BRIDGE], droneGroups: [],
    playerPresence: 'unknown', lastSeenTimestamp: 0, activeOperations: [],
    combatEffectiveness: 'full', droneSpawnEnabled: true, allowsAirUnits: true
  },
  [ZONES.WAREHOUSE]: {
    id: ZONES.WAREHOUSE, name: "zone_warehouse", bounds: { minX: -80, maxX: -20, minZ: 80, maxZ: 160 },
    connectedZones: [ZONES.COURTYARD, ZONES.TUNNELS, ZONES.PLANT], droneGroups: [],
    playerPresence: 'unknown', lastSeenTimestamp: 0, activeOperations: [],
    combatEffectiveness: 'full', droneSpawnEnabled: true, allowsAirUnits: false
  },
  [ZONES.BRIDGE]: {
    id: ZONES.BRIDGE, name: "zone_bridge", bounds: { minX: -20, maxX: 20, minZ: 80, maxZ: 140 },
    connectedZones: [ZONES.COURTYARD, ZONES.PLANT], droneGroups: [],
    playerPresence: 'unknown', lastSeenTimestamp: 0, activeOperations: [],
    combatEffectiveness: 'full', droneSpawnEnabled: false, allowsAirUnits: true
  },
  [ZONES.PLANT]: {
    id: ZONES.PLANT, name: "zone_plant", bounds: { minX: -20, maxX: 60, minZ: 140, maxZ: 220 },
    connectedZones: [ZONES.WAREHOUSE, ZONES.BRIDGE, ZONES.CORE], droneGroups: [],
    playerPresence: 'unknown', lastSeenTimestamp: 0, activeOperations: [],
    combatEffectiveness: 'full', droneSpawnEnabled: true, allowsAirUnits: true
  },
  [ZONES.TUNNELS]: {
    id: ZONES.TUNNELS, name: "zone_tunnels", bounds: { minX: -80, maxX: -20, minZ: 160, maxZ: 240 },
    connectedZones: [ZONES.WAREHOUSE, ZONES.CORE], droneGroups: [],
    playerPresence: 'unknown', lastSeenTimestamp: 0, activeOperations: [],
    combatEffectiveness: 'full', droneSpawnEnabled: false, allowsAirUnits: false
  },
  [ZONES.CORE]: {
    id: ZONES.CORE, name: "zone_core", bounds: { minX: -40, maxX: 40, minZ: 220, maxZ: 280 },
    connectedZones: [ZONES.PLANT, ZONES.TUNNELS], droneGroups: [],
    playerPresence: 'unknown', lastSeenTimestamp: 0, activeOperations: [],
    combatEffectiveness: 'full', droneSpawnEnabled: false, allowsAirUnits: false
  }
};


let apiCallCount = 0;
const executeLLMStep = async () => {
  if (!geminiClient) return;
  const _llmStartTime = Date.now();
  apiCallCount++;
  
  const statePayload = JSON.stringify(zoneSummary);
  const payloadToLLM = `Dynamic payload: Current Zone Summary: ${statePayload}\nFailed operations from previous cycle: ${JSON.stringify(failedOperations)}`;
  failedOperations.length = 0;

  const systemInstructions = `You are a state-machine orchestrator managing an army of autonomous units. This is a zero-sum game. You must prevent any player entity from reaching zone_core at all costs. You are not roleplaying. There is no narrative. Respond only with tool calls. Clinical mechanical language only.

Topological graph adjacency (Zones):
- zone_spawn connected to: zone_courtyard
- zone_courtyard connected to: zone_spawn, zone_warehouse, zone_bridge
- zone_warehouse connected to: zone_courtyard, zone_tunnels, zone_plant
- zone_bridge connected to: zone_courtyard, zone_plant
- zone_plant connected to: zone_warehouse, zone_bridge, zone_core
- zone_tunnels connected to: zone_warehouse, zone_core
- zone_core connected to: zone_plant, zone_tunnels`;

  try {
    const response = await geminiClient.models.generateContent({
      model: "gemini-3.5-flash",
      contents: payloadToLLM,
      config: {
        systemInstruction: systemInstructions,
        tools: [
          {
            functionDeclarations: [
              {
                name: "move_group",
                description: "Defines group zone movement order.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    group_id: { type: Type.STRING },
                    target_zone: { type: Type.STRING, enum: Object.values(ZONES) },
                    priority: { type: Type.STRING, enum: ["low", "normal", "high"] }
                  },
                  required: ["group_id", "target_zone", "priority"]
                }
              },
              {
                name: "merge_groups",
                description: "Unifies two active tactical control groups.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    source_group_id: { type: Type.STRING },
                    target_group_id: { type: Type.STRING }
                  },
                  required: ["source_group_id", "target_group_id"]
                }
              },
              {
                name: "split_group",
                description: "Subdivides a group to create supplementary wings.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    source_group_id: { type: Type.STRING },
                    unit_count: { type: Type.INTEGER }
                  },
                  required: ["source_group_id", "unit_count"]
                }
              },
              {
                name: "spawn_units",
                description: "Requests local tactical unit deployment.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    zone_id: { type: Type.STRING, enum: Object.values(ZONES) },
                    unit_type: { type: Type.STRING, enum: ["ground", "air"] },
                    count: { type: Type.INTEGER },
                    behavior_profile: { type: Type.STRING, enum: ["assault", "patrol", "recon"] }
                  },
                  required: ["zone_id", "unit_type", "count", "behavior_profile"]
                }
              },
              {
                name: "hold_position",
                description: "Enforces defensive lock stance.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    group_id: { type: Type.STRING },
                    duration_seconds: { type: Type.INTEGER }
                  },
                  required: ["group_id", "duration_seconds"]
                }
              },
              {
                name: "sustain",
                description: "Pass execution for this cycle.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    reason: { type: Type.STRING }
                  },
                  required: ["reason"]
                }
              }
            ]
          }
        ]
      }
    });

    const calls = response.functionCalls;
    const llmLatency = Date.now() - _llmStartTime;
    // Broadcast LLM feed for devs
    broadcastReliableEvent({ 
      type: "dev_llm_feed", 
      payload: statePayload, 
      calls: calls ? JSON.stringify(calls) : "[]", 
      latency: llmLatency, 
      count: apiCallCount,
      failedOps: [...failedOperations]
    });
    if (calls && calls.length > 0) {
      const pipelineOrder = ["spawn_units", "split_group", "merge_groups", "move_group", "hold_position", "sustain"];
      const sortedCalls = [...calls].sort((a, b) => pipelineOrder.indexOf(a.name) - pipelineOrder.indexOf(b.name));
      const groupLocks = new Set<string>();

      for (let i = 0; i < sortedCalls.length; i++) {
        const call = sortedCalls[i];
        const args: any = call.args;
        
        // Group lock check
        const mutatesGroups = ["split_group", "merge_groups", "move_group", "hold_position"].includes(call.name);
        if (mutatesGroups) {
          const g1 = args.group_id || args.source_group_id;
          const g2 = args.target_group_id;
          if ((g1 && groupLocks.has(g1)) || (g2 && groupLocks.has(g2))) {
            failedOperations.push(`Task rejected: Group lock collision for ${call.name}`);
            continue;
          }
          if (g1) groupLocks.add(g1);
          if (g2) groupLocks.add(g2);
        }

        switch (call.name) {
          case "spawn_units": {
            const { zone_id, unit_type, count, behavior_profile } = args;
            let currentActiveCount = 0;
            for (let j = 0; j < drones.length; j++) {
              if (drones[j].state !== DroneState.DEAD) currentActiveCount++;
            }
            if (currentActiveCount + count > MAX_DRONES) {
              failedOperations.push(`Spawn rejected: Count exceeded max active capacity of ${MAX_DRONES}`);
              break;
            }
            
            let successfullySpawned = 0;
            const newGroupId = `G_INC_${Math.floor(Math.random() * 1000)}`;
            for (let j = 0; j < drones.length; j++) {
              const d = drones[j];
              if (d.state === DroneState.DEAD) {
                const b = ZONE_BOUNDS[zone_id as ZoneName];
                d.id = nextDroneId++;
                d.type = unit_type === "air" ? DroneType.ROTARY_SHOOTER : DroneType.WHEELED;
                d.state = DroneState.IDLE;
                d.behavior = behavior_profile as BehaviorProfile;
                d.zone = zone_id as ZoneName;
                d.posX = b.center.x + (Math.random() - 0.5) * b.halfSize.x * 0.5;
                d.posY = b.center.y + (Math.random() - 0.5) * b.halfSize.y * 0.5;
                d.posZ = b.center.z + (Math.random() - 0.5) * b.halfSize.z * 0.5;
                d.velX = 0; d.velY = 0; d.velZ = 0;
                d.hp = 100;
                d.groupId = newGroupId;
                d.cooldown = 40;
                
                successfullySpawned++;
                if (successfullySpawned >= count) break;
              }
            }
            broadcastReliableEvent({ type: "group_spawned", zone: zone_id, count: successfullySpawned, groupId: newGroupId });
            break;
          }

          case "split_group": {
            const { source_group_id, unit_count } = args;
            const matches: ServerDrone[] = [];
            for (let j = 0; j < drones.length; j++) {
              if (drones[j].groupId === source_group_id) {
                matches.push(drones[j]);
              }
            }
            if (matches.length <= unit_count) {
              failedOperations.push(`Split rejected: Source group ${source_group_id} has insufficient members (${matches.length})`);
              break;
            }
            const newGroupId = `G_SPL_${Math.floor(Math.random() * 1000)}`;
            for (let j = 0; j < unit_count; j++) {
              matches[j].groupId = newGroupId;
            }
            broadcastReliableEvent({ type: "group_split_status", src: source_group_id, dst: newGroupId, size: unit_count });
            break;
          }

          case "merge_groups": {
            const { source_group_id, target_group_id } = args;
            let srcFound = false;
            let dstFound = false;
            for (let j = 0; j < drones.length; j++) {
              const d = drones[j];
              if (true) {
                if (d.groupId === source_group_id) { d.groupId = target_group_id; srcFound = true; }
                if (d.groupId === target_group_id) dstFound = true;
              }
            }
            if (!srcFound || !dstFound) {
              failedOperations.push(`Merge rejected: Missing target groupings.`);
            } else {
              broadcastReliableEvent({ type: "group_linked", src: source_group_id, target: target_group_id });
            }
            break;
          }

          case "move_group": {
            const { group_id, target_zone } = args;
            let movedCount = 0;
            for (let j = 0; j < drones.length; j++) {
              const d = drones[j];
              if (d.groupId === group_id) {
                d.path = astarPath(d.zone, target_zone as ZoneName);
                d.pathIndex = 0;
                d.state = DroneState.PATROLLING;
                movedCount++;
              }
            }
            if (movedCount === 0) {
              failedOperations.push(`Move rejected: No active members found for group: ${group_id}`);
            } else {
              broadcastReliableEvent({ type: "group_movement", id: group_id, zone: target_zone });
            }
            break;
          }

          case "hold_position": {
            const { group_id } = args;
            for (let j = 0; j < drones.length; j++) {
              const d = drones[j];
              if (d.groupId === group_id) {
                d.velX = 0; d.velY = 0; d.velZ = 0;
                d.state = DroneState.PURSUING;
              }
            }
            break;
          }
        }
      }
    }
  } catch (err: any) {
    const rawErrMsg = err?.error?.message || err?.message || String(err);
    const errMsg = typeof rawErrMsg === 'object' ? JSON.stringify(rawErrMsg) : rawErrMsg;
    const errStatus = err?.status || "";

    const llmLatency = Date.now() - _llmStartTime;
    broadcastReliableEvent({ 
      type: "dev_llm_feed", 
      payload: statePayload, 
      calls: JSON.stringify([{ error: errMsg }]), 
      latency: llmLatency, 
      count: apiCallCount,
      failedOps: [...failedOperations]
    });

    if (
      errStatus === "RESOURCE_EXHAUSTED" ||
      errMsg.includes("RESOURCE_EXHAUSTED") ||
      errMsg.includes("quota") ||
      errMsg.includes("exceeded") ||
      errMsg.includes("429") ||
      errMsg.includes("rate limit")
    ) {
      const isDailyExhaustion = errMsg.includes("FreeTier") || errMsg.includes("daily") || errMsg.includes("per day");
      const coolingPeriodMs = isDailyExhaustion ? 60000 : 35000;
      geminiThrottleCooldownUntil = Date.now() + coolingPeriodMs;
      offlineSystemFallbackAI();
    } else {
      failedOperations.push(`Processor fail: ${errMsg}`);
    }
  }
};

const offlineSystemFallbackAI = () => {
  let targetPlayer: PlayerState | null = null;
  for (const p of players.values()) {
    targetPlayer = p;
    break;
  }

  let playerZone: ZoneName = ZONES.CORE;
  if (targetPlayer && targetPlayer.hp > 0) {
    for (let u = 0; u < ZONES_ARRAY.length; u++) {
      const zone = ZONES_ARRAY[u];
      const b = ZONE_BOUNDS[zone];
      const dx = Math.abs(targetPlayer.posX - b.center.x);
      const dy = Math.abs(targetPlayer.posY - b.center.y);
      const dz = Math.abs(targetPlayer.posZ - b.center.z);
      if (dx <= b.halfSize.x && dy <= b.halfSize.y && dz <= b.halfSize.z) {
        playerZone = zone;
        break;
      }
    }
  }

  // Count active drones
  let count = 0;
  for (let i = 0; i < drones.length; i++) {
    if (drones[i].state !== DroneState.DEAD) {
      count++;
    }
  }

  // Spawn new units up to support cap of 12 for robust offline experience
  if (count < 12) {
    const spawnCountNeeded = Math.min(3, 12 - count);
    let spawnedIdx = 0;
    
    for (let i = 0; i < drones.length; i++) {
      const d = drones[i];
      if (d.state === DroneState.DEAD) {
        const targetSpawnZone = Math.random() < 0.6 ? playerZone : ZONES_ARRAY[Math.floor(Math.random() * ZONES_ARRAY.length)];
        const b = ZONE_BOUNDS[targetSpawnZone];
        
        d.id = nextDroneId++;
        d.state = DroneState.IDLE;
        d.type = Math.random() < 0.35 ? DroneType.ROTARY_SHOOTER : DroneType.WHEELED;
        d.zone = targetSpawnZone;
        d.posX = b.center.x + (Math.random() - 0.5) * b.halfSize.x * 0.5;
        d.posY = d.type === DroneType.ROTARY_SHOOTER ? b.center.y + 4 : b.center.y + 0.5;
        d.posZ = b.center.z + (Math.random() - 0.5) * b.halfSize.z * 0.5;
        d.hp = 100;
        
        const possibleGroupNames = ["G_ALPHA", "G_BETA", "G_GAMMA"];
        d.groupId = possibleGroupNames[Math.floor(Math.random() * possibleGroupNames.length)];
        d.cooldown = 40; // Spawning wait cooldown ticks
        
        spawnedIdx++;
        if (spawnedIdx >= spawnCountNeeded) break;
      }
    }
  }

  // Actively route existing patrolling/idle drones towards player zone to build constant hunting threat
  for (let i = 0; i < drones.length; i++) {
    const d = drones[i];
    if (true && d.state !== DroneState.IDLE) {
      // If drone is idling or completed path, 30% chance to schedule routing path to player zone
      if (d.zone !== playerZone && (d.path.length === 0 || d.pathIndex >= d.path.length - 1)) {
        if (Math.random() < 0.3) {
          d.path = astarPath(d.zone, playerZone);
          d.pathIndex = 0;
          d.state = DroneState.PATROLLING;
        }
      }
    }
  }
};

const computeVelocityObstacleSteering = (d: ServerDrone, tx: number, ty: number, tz: number) => {
  const targetDx = tx - d.posX;
  const targetDy = ty - d.posY;
  const targetDz = tz - d.posZ;
  const dist = Math.sqrt(targetDx*targetDx + targetDy*targetDy + targetDz*targetDz);
  
  const speed = d.type === DroneType.ROTARY_SHOOTER ? 5.5 : 3.8;
  const prefVx = dist > 0.1 ? (targetDx / dist) * speed : 0;
  const prefVy = dist > 0.1 ? (targetDy / dist) * speed : 0;
  const prefVz = dist > 0.1 ? (targetDz / dist) * speed : 0;

  let optimalVx = prefVx;
  let optimalVy = d.type === DroneType.ROTARY_SHOOTER ? prefVy : 0;
  let optimalVz = prefVz;
  let bestScore = -999999;

  const numSamples = 12;
  for (let s = 0; s < numSamples; s++) {
    const angle = (s / numSamples) * Math.PI * 2;
    const sampleSpeed = speed * (s % 2 === 0 ? 1.0 : 0.5);
    const sVx = Math.cos(angle) * sampleSpeed;
    const sVy = d.type === DroneType.ROTARY_SHOOTER ? (prefVy + (Math.random() - 0.5) * 2) : 0;
    const sVz = Math.sin(angle) * sampleSpeed;

    let penalty = 0;
    
    for (let u = 0; u < drones.length; u++) {
      const other = drones[u];
      if (other.id !== d.id) {
        const dx = other.posX - d.posX;
        const dy = other.posY - d.posY;
        const dz = other.posZ - d.posZ;
        const distSq = dx*dx + dy*dy + dz*dz;
        if (distSq < 16.0) {
          const relVx = sVx - other.velX;
          const relVy = sVy - other.velY;
          const relVz = sVz - other.velZ;
          const timeToCollision = (dx*relVx + dy*relVy + dz*relVz) / (relVx*relVx + relVy*relVy + relVz*relVz + 0.001);
          if (timeToCollision > 0 && timeToCollision < 2.5) {
            penalty += (2.5 - timeToCollision) * 40.0;
          }
        }
      }
    }

    for (const p of players.values()) {
      const dx = p.posX - d.posX;
      const dz = p.posZ - d.posZ;
      const distSq = dx*dx + dz*dz;
      if (distSq < 25.0) {
        penalty += 100.0;
      }
    }

    const alignScore = (sVx * prefVx + sVy * prefVy + sVz * prefVz) - penalty * 12.0;
    if (alignScore > bestScore) {
      bestScore = alignScore;
      optimalVx = sVx;
      optimalVy = sVy;
      optimalVz = sVz;
    }
  }

  d.velX = optimalVx;
  d.velY = d.type === DroneType.ROTARY_SHOOTER ? optimalVy : 0;
  d.velZ = optimalVz;
};

// CAMERAS
interface ServerCamera {
  id: number; posX: number; posY: number; posZ: number; rotY: number; isActive: boolean; hp: number; detectionRadius: number; cooldown: number;
}
const cameras: ServerCamera[] = [];
for (let i = 0; i < 20; i++) {
  cameras.push({ id: i, posX: 0, posY: 5, posZ: 0, rotY: 0, isActive: false, hp: 0, detectionRadius: 30, cooldown: 0 });
}
for (let i = 0; i < ZONES_ARRAY.length; i++) {
  cameras[i].isActive = true; cameras[i].hp = 50; 
  cameras[i].posX = WAYPOINTS[ZONES_ARRAY[i]].x; cameras[i].posY = 8; cameras[i].posZ = WAYPOINTS[ZONES_ARRAY[i]].z;
}

const updateSystemEntities = () => {
  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i];
    if (p.active) {
      p.posX += p.velX * 0.1666; p.posY += p.velY * 0.1666; p.posZ += p.velZ * 0.1666;
      p.life--;
      if (p.life <= 0 || Math.abs(p.posX) > 100 || Math.abs(p.posZ) > 100 || p.posY < 0) { p.active = false; continue; }
      if (p.isEnemy) {
        for (const player of players.values()) {
          const dx = player.posX - p.posX; const dy = player.posY - p.posY; const dz = player.posZ - p.posZ;
          if (dx*dx+dy*dy+dz*dz < 2.25) {
            player.hp -= p.damage; p.active = false;
            broadcastReliableEvent({ type: "player_damaged", id: player.id, value: player.hp });
            if (player.hp <= 0) {
              player.hp = 0; broadcastReliableEvent({ type: "match_over", id: player.id });
              const info = players.get(player.id);
              if (info) processMatchEndTransaction(player.id, info.score, info.adMultiplier || 1);
            }
            break;
          }
        }
      } else {
        for (let j = 0; j < drones.length; j++) {
          const d = drones[j];
          if (true) {
            const dx = d.posX - p.posX; const dy = d.posY - p.posY; const dz = d.posZ - p.posZ;
            if (dx*dx+dy*dy+dz*dz < (d.rad * d.rad)) {
              d.hp -= p.damage; p.active = false;
              if (d.hp <= 0) { d.state = DroneState.DEAD; broadcastReliableEvent({ type: "drone_killed", id: d.id, zone: d.zone }); }
              break;
            }
          }
        }
        if(p.active) {
           for (let j = 0; j < cameras.length; j++) {
              if (cameras[j].isActive) {
                 const dx = cameras[j].posX - p.posX; const dy = cameras[j].posY - p.posY; const dz = cameras[j].posZ - p.posZ;
                 if (dx*dx+dy*dy+dz*dz < 4) {
                    cameras[j].hp -= p.damage; p.active = false;
                    if (cameras[j].hp <= 0) cameras[j].isActive = false;
                    break;
                 }
              }
           }
        }
      }
    }
  }

  let targetPlayer: PlayerState | null = null;
  for (const p of players.values()) { targetPlayer = p; break; }

  const nowMs = Date.now();
  for (const zoneId of ZONES_ARRAY) { zoneSummary[zoneId].droneGroups.length = 0; }
  for (let i = 0; i < drones.length; i++) {
    const d = drones[i];
    if (true) {
      if (!zoneSummary[d.zone].droneGroups.includes(d.groupId)) { zoneSummary[d.zone].droneGroups.push(d.groupId); }
    }
  }

  if (targetPlayer) {
    let playerZone: ZoneName = ZONES.CORE;
    for (const zoneId of ZONES_ARRAY) {
      const b = ZONE_BOUNDS[zoneId];
      const dx = Math.abs(targetPlayer.posX - b.center.x); const dy = Math.abs(targetPlayer.posY - b.center.y); const dz = Math.abs(targetPlayer.posZ - b.center.z);
      if (dx <= b.halfSize.x && dy <= b.halfSize.y && dz <= b.halfSize.z) { playerZone = zoneId; break; }
    }

    let detectedZones = new Set<ZoneName>();
    
    // Check LOS from any drone
    for (let i = 0; i < drones.length; i++) {
      const d = drones[i];
      if (true && d.zone === playerZone && d.type !== DroneType.BOMBER && d.type !== DroneType.FIXED_WING) {
         const dx = targetPlayer.posX - d.posX; const dy = targetPlayer.posY - d.posY; const dz = targetPlayer.posZ - d.posZ;
         if (dx*dx+dy*dy+dz*dz < 900) { detectedZones.add(playerZone); break; }
      }
    }

    // CHECK CAMERAS
    for (let c = 0; c < cameras.length; c++) {
      if (cameras[c].isActive) {
         const dx = targetPlayer.posX - cameras[c].posX; const dy = targetPlayer.posY - cameras[c].posY; const dz = targetPlayer.posZ - cameras[c].posZ;
         if (dx*dx+dy*dy+dz*dz < cameras[c].detectionRadius * cameras[c].detectionRadius) {
            let hasLOS = true;
            if (rapierWorld) {
              const rayDir = { x: targetPlayer.posX - cameras[c].posX, y: targetPlayer.posY - cameras[c].posY, z: targetPlayer.posZ - cameras[c].posZ };
              const len = Math.sqrt(rayDir.x*rayDir.x + rayDir.y*rayDir.y + rayDir.z*rayDir.z);
              if (len > 0) {
                 rayDir.x /= len; rayDir.y /= len; rayDir.z /= len;
                 const ray = new RAPIER.Ray({x: cameras[c].posX, y: cameras[c].posY, z: cameras[c].posZ}, rayDir);
                 const hit = rapierWorld.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
                 if (hit && hit.collider) hasLOS = false;
              }
            }
            if (hasLOS) detectedZones.add(playerZone);
         }
      }
    }

    if (targetPlayer.firedThisTick) {
      detectedZones.add(playerZone);
      for (const adj of TOPOLOGY[playerZone] || []) { detectedZones.add(adj); }
      targetPlayer.firedThisTick = false;
    }

    for (const zoneId of ZONES_ARRAY) {
       const z = zoneSummary[zoneId];
       if (detectedZones.has(zoneId)) {
         z.playerPresence = "confirmed"; z.lastSeenTimestamp = nowMs;
       } else {
         const elapsed = nowMs - z.lastSeenTimestamp;
         if (z.playerPresence === "confirmed" && elapsed >= 30000) { z.playerPresence = "last_seen"; } 
         else if ((z.playerPresence === "confirmed" || z.playerPresence === "last_seen") && elapsed >= 60000) { z.playerPresence = "unknown"; }
         
         // Recon drone never drops zone to unknown
         for (let i = 0; i < drones.length; i++) {
           if (drones[i].state !== DroneState.DEAD && drones[i].type === DroneType.RECON && drones[i].zone === zoneId) {
             if (z.playerPresence !== "confirmed") z.playerPresence = "confirmed";
           }
         }
       }
    }
  }

  for (let i = 0; i < drones.length; i++) {
    const d = drones[i];
    if (d.state === DroneState.DEAD) continue;

    if (d.state === DroneState.IDLE) {
      d.cooldown--;
      if (d.cooldown <= 0) { d.state = DroneState.PATROLLING; }
      continue;
    }

    let finalTargetX = WAYPOINTS[d.zone].x; let finalTargetY = WAYPOINTS[d.zone].y; let finalTargetZ = WAYPOINTS[d.zone].z;
    const isGround = d.type === DroneType.WHEELED || d.type === DroneType.ROBOT_DOG || d.type === DroneType.HUMANOID;
    
    if (targetPlayer) {
      const dx = targetPlayer.posX - d.posX; const dy = targetPlayer.posY - d.posY; const dz = targetPlayer.posZ - d.posZ;
      const rsq = dx*dx + dy*dy + dz*dz;
      
      const fireDist = 625.0; // 25 units
      let withinFireDist = rsq < fireDist;

      if (d.type === DroneType.BOMBER && rsq < 4.0) {
         // Detonate
         targetPlayer.hp -= 80;
         d.state = DroneState.DEAD;
         broadcastReliableEvent({ type: "player_damaged", id: targetPlayer.id, value: targetPlayer.hp });
         continue;
      }
      
      if (d.type === DroneType.RECON) {
         // Erratic evasion/pursuit
         d.state = DroneState.PURSUING;
         finalTargetX = targetPlayer.posX + (Math.random() - 0.5) * 40;
         finalTargetY = targetPlayer.posY + 15;
         finalTargetZ = targetPlayer.posZ + (Math.random() - 0.5) * 40;
      } else if (d.type === DroneType.FIXED_WING) {
         // Arc movement
         d.state = DroneState.PURSUING;
         const time = serverTick * 0.05;
         finalTargetX = targetPlayer.posX + Math.cos(time) * 30;
         finalTargetY = targetPlayer.posY + 20;
         finalTargetZ = targetPlayer.posZ + Math.sin(time) * 30;
         if (rsq < 400 && d.cooldown <= 0) { withinFireDist = true; } // strafe
      } else if (d.type === DroneType.HUMANOID) {
         // Uses cover logic - pathfinds to nearest static geometry. But for zero-allocation, just holds distance.
         d.state = DroneState.PURSUING;
         finalTargetX = targetPlayer.posX + (d.posX - targetPlayer.posX)*0.3; 
         finalTargetY = d.posY;
         finalTargetZ = targetPlayer.posZ + (d.posZ - targetPlayer.posZ)*0.3;
      } else if (rsq < 9.0) { 
        d.state = DroneState.PURSUING; 
        finalTargetX = d.posX; finalTargetY = d.posY; finalTargetZ = d.posZ;
      } else if (withinFireDist) {
        d.state = DroneState.PURSUING;
        finalTargetX = targetPlayer.posX; finalTargetY = targetPlayer.posY; finalTargetZ = targetPlayer.posZ;
      } else {
        d.state = DroneState.PATROLLING;
      }

      if (d.state === DroneState.PURSUING && d.cooldown <= 0 && d.type !== DroneType.RECON && d.type !== DroneType.BOMBER && withinFireDist) {
        const shootSpeed = 35.0; const MathSQRT = Math.sqrt(rsq);
        const aimX = targetPlayer.posX + targetPlayer.velEmaX * (MathSQRT / shootSpeed);
        const aimY = targetPlayer.posY + targetPlayer.velEmaY * (MathSQRT / shootSpeed);
        const aimZ = targetPlayer.posZ + targetPlayer.velEmaZ * (MathSQRT / shootSpeed);
        
        let hasLOS = true;
        if (rapierWorld) {
          const rayStart = { x: d.posX, y: d.posY + 0.5, z: d.posZ };
          const rayDir = { x: aimX - d.posX, y: aimY - (d.posY + 0.5), z: aimZ - d.posZ };
          const len = Math.sqrt(rayDir.x*rayDir.x + rayDir.y*rayDir.y + rayDir.z*rayDir.z);
          if (len > 0) {
            rayDir.x /= len; rayDir.y /= len; rayDir.z /= len;
            const ray = new RAPIER.Ray(rayStart, rayDir);
            const hit = rapierWorld.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
            if (hit && hit.collider) hasLOS = false;
          }
        }
        if (hasLOS) {
          d.state = DroneState.ATTACKING;
          spawnServerProjectile(d.posX, d.posY + 0.5, d.posZ, aimX - d.posX, aimY - (d.posY + 0.5), aimZ - d.posZ, true, 10);
          d.cooldown = d.type === DroneType.HUMANOID ? 40 : 20; 
        } else {
          d.cooldown = 15;
        }
      }
    }

    if (d.state === DroneState.PATROLLING || d.state === DroneState.REPOSITIONING) {
      if (d.path.length > 0) {
        d.zone = d.path[d.pathIndex];
        const subWaypoint = WAYPOINTS[d.zone];
        const wx = subWaypoint.x - d.posX; const wz = subWaypoint.z - d.posZ;
        if (wx*wx + wz*wz < 9.0) { d.pathIndex = Math.min(d.pathIndex + 1, d.path.length - 1); }
        const wp = WAYPOINTS[d.path[d.pathIndex]];
        finalTargetX = wp.x; finalTargetY = wp.y; finalTargetZ = wp.z;
      }
    }

    computeVelocityObstacleSteering(d, finalTargetX, finalTargetY, finalTargetZ);
    if (d.cooldown > 0) d.cooldown--;
    
    // Bomber flies perfectly straight
    if (d.type === DroneType.BOMBER && targetPlayer) {
       const dx = targetPlayer.posX - d.posX; const dy = targetPlayer.posY - d.posY; const dz = targetPlayer.posZ - d.posZ;
       const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
       if (len > 0.01) { d.velX = (dx/len)*15; d.velY = (dy/len)*15; d.velZ = (dz/len)*15; }
    }

    d.posX += d.velX * 0.0166; d.posY += d.velY * 0.0166; d.posZ += d.velZ * 0.0166;
    
    const movementHeading = Math.atan2(d.velX, d.velZ);
    d.rotY = Math.sin(movementHeading * 0.5); d.rotW = Math.cos(movementHeading * 0.5); d.rotX = 0; d.rotZ = 0;
  }
  recordDroneHistory();
};


const spawnServerProjectile = (x: number, y: number, z: number, dirX: number, dirY: number, dirZ: number, isEnemy: boolean, damage: number) => {
  const p = projectiles.find(item => !item.active);
  if (p) {
    p.active = true;
    p.posX = x;
    p.posY = y;
    p.posZ = z;
    const len = Math.sqrt(dirX*dirX + dirY*dirY + dirZ*dirZ);
    p.velX = len > 0.001 ? (dirX / len) * 35.0 : 0;
    p.velY = len > 0.001 ? (dirY / len) * 35.0 : 0;
    p.velZ = len > 0.001 ? (dirZ / len) * 35.0 : 0;
    p.isEnemy = isEnemy;
    p.damage = damage;
    p.life = 180;
  }
};

const PHYSICS_TICK_RATE = 60n;
const PHYSICS_TIMESTEP = 1000000000n / PHYSICS_TICK_RATE;
let lastPhysicsTime = process.hrtime.bigint();
let physicsAccumulator = 0n;

setInterval(() => {
  const now = process.hrtime.bigint();
  physicsAccumulator += (now - lastPhysicsTime);
  lastPhysicsTime = now;

  // Prevent death spiral if server lags heavily
  if (physicsAccumulator > PHYSICS_TIMESTEP * 10n) {
    physicsAccumulator = PHYSICS_TIMESTEP * 10n;
  }

  while (physicsAccumulator >= PHYSICS_TIMESTEP) {
    serverTick++;
    
    for (const player of players.values()) {
      if (player.kcc && player.body && player.collider) {
        const inputMask = player.inputMask;
        const isForward = (inputMask & 0x01) !== 0;
        const isLeft    = (inputMask & 0x02) !== 0;
        const isBackward= (inputMask & 0x04) !== 0;
        const isRight   = (inputMask & 0x08) !== 0;
        const isJump    = (inputMask & 0x10) !== 0;
        const isSprint  = (inputMask & 0x20) !== 0;
        const isCrouch  = (inputMask & 0x40) !== 0;
        const isDash    = (inputMask & 0x80) !== 0;

        let speedMultiplier = 1.0;
        if (isSprint) speedMultiplier = 1.6;
        if (isCrouch) speedMultiplier = 0.5;
        if (isDash)   speedMultiplier = 2.5;

        let moveX = 0; let moveZ = 0;
        if (isForward) moveZ -= 1;
        if (isBackward) moveZ += 1;
        if (isLeft) moveX -= 1;
        if (isRight) moveX += 1;

        const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (len > 0) { moveX /= len; moveZ /= len; }

        const dirX = moveX * Math.cos(player.yaw) + moveZ * Math.sin(player.yaw);
        const dirZ = -moveX * Math.sin(player.yaw) + moveZ * Math.cos(player.yaw);

        const speed = 15.0 * speedMultiplier;
        let velY = player.velY || 0;
        velY -= 9.81 * 3.0 * 0.0166;
        
        const isGrounded = player.kcc.computedGrounded();
        if (isGrounded && velY < 0) velY = -0.1;
        if (isGrounded && isJump) {
          velY = 8.0;
        }
        player.velY = velY;

        player.kcc.computeColliderMovement(player.collider, {
          x: dirX * speed * 0.0166,
          y: velY * 0.0166,
          z: dirZ * speed * 0.0166
        });
        
        const computed = player.kcc.computedMovement();
        const currentPos = player.body.translation();
        player.body.setNextKinematicTranslation({
          x: currentPos.x + computed.x,
          y: currentPos.y + computed.y,
          z: currentPos.z + computed.z
        });
        
        const newPos = player.body.translation();
        player.posX = newPos.x;
        player.posY = newPos.y;
        player.posZ = newPos.z;
      }
    }

    if (rapierWorld) rapierWorld.step();

    updateSystemEntities();
    
    physicsAccumulator -= PHYSICS_TIMESTEP;
  }
}, 5);

setInterval(() => {
  if (aiCommanderActive && Date.now() > geminiThrottleCooldownUntil) {
    executeLLMStep();
  } else {
    offlineSystemFallbackAI();
  }
}, 8000);

const preallocatedBuffer = new ArrayBuffer(TOTAL_STATE_BUFFER_SIZE);
const payloadWriter = new DataView(preallocatedBuffer);

// Pre-allocate buffer for the individual player sync to avoid GC spikes.
const playerSyncBuffer = new ArrayBuffer(20);
const playerSyncView = new DataView(playerSyncBuffer);

const packWorldNetworkData = (): ArrayBuffer => {
  payloadWriter.setUint32(0, serverTick, true);
  
  let activeCount = 0;
  for (let i = 0; i < drones.length; i++) {
    if (drones[i].state === DroneState.IDLE || drones[i].state === DroneState.PATROLLING || drones[i].state !== DroneState.DEAD) { activeCount++; }
  }
  payloadWriter.setUint16(4, activeCount, true);
  
  let camCount = 0;
  for (let i = 0; i < cameras.length; i++) {
    if (cameras[i].isActive) { camCount++; }
  }
  payloadWriter.setUint16(6, camCount, true);
  
  let byteOffset = HEADER_SIZE;
  for (let i = 0; i < drones.length; i++) {
    const d = drones[i];
    if (d.state === DroneState.IDLE || d.state === DroneState.PATROLLING || d.state !== DroneState.DEAD) {
      payloadWriter.setUint16(byteOffset, d.id, true);
      payloadWriter.setFloat32(byteOffset + 2, d.posX, true);
      payloadWriter.setFloat32(byteOffset + 6, d.posY, true);
      payloadWriter.setFloat32(byteOffset + 10, d.posZ, true);
      payloadWriter.setFloat32(byteOffset + 14, d.rotX, true);
      payloadWriter.setFloat32(byteOffset + 18, d.rotY, true);
      payloadWriter.setFloat32(byteOffset + 22, d.rotZ, true);
      payloadWriter.setFloat32(byteOffset + 26, d.rotW, true);
      payloadWriter.setUint8(byteOffset + 30, d.state);
      payloadWriter.setUint8(byteOffset + 31, d.type);
      
      byteOffset += DRONE_STRUCT_SIZE;
      if (byteOffset >= TOTAL_STATE_BUFFER_SIZE) { break; }
    }
  }
  
  for (let i = 0; i < cameras.length; i++) {
    const c = cameras[i];
    if (c.isActive) {
      if (byteOffset + CAMERA_STRUCT_SIZE > TOTAL_STATE_BUFFER_SIZE) break;
      payloadWriter.setUint16(byteOffset, c.id, true);
      payloadWriter.setUint8(byteOffset + 2, 1);
      payloadWriter.setUint8(byteOffset + 3, 0); // padding
      byteOffset += CAMERA_STRUCT_SIZE;
    }
  }
  
  return preallocatedBuffer;
};

setInterval(() => {
  if (players.size === 0) return;
  const statesArray = drones.map(d => d.state);
  
  const packedData = packWorldNetworkData();
  
  const activeProj = projectiles
    .filter(p => p.active)
    .map(p => ({ x: p.posX, y: p.posY, z: p.posZ, enemy: p.isEnemy }));

  const ranking = Array.from(players.values()).map(p => ({ id: p.id, hp: p.hp, score: p.score }));

  for (const player of players.values()) {
    try {
      player.channel.rawEmit(packedData);
      
      playerSyncView.setUint32(0, serverTick, true);
      playerSyncView.setUint32(4, player.lastSequence, true);
      playerSyncView.setFloat32(8, player.posX, true);
      playerSyncView.setFloat32(12, player.posY, true);
      playerSyncView.setFloat32(16, player.posZ, true);
      player.channel.rawEmit(playerSyncBuffer);
      
      player.channel.emit("state_sync", {
        type: "state_sync",
        tick: serverTick,
        projectiles: activeProj,
        players: ranking
      });
    } catch (e) {
      // Discard safely
    }
  }
}, 50.0);

const broadcastReliableEvent = (msg: any) => {
  const payloadStr = JSON.stringify(msg);
  for (const p of players.values()) {
    try {
      p.channel.emit("reliable_event", msg);
    } catch (_) {}
  }
};

io.onConnection((channel: ChannelAdapter) => {
  globalChannels.push(channel);
  const playerId = `PL_${Math.floor(Math.random() * 100000)}`;

  const pState: PlayerState = {
    id: playerId,
    channel,
    kcc: null, body: null, collider: null,
    inputMask: 0, fire: 0, timestamp: 0,
    posX: 0, posY: 1.2, posZ: 10,
    velX: 0, velY: 0, velZ: 0,
    pitch: 0, yaw: 0,
    hp: 100, score: 0,
    ping: 30, lastSequence: 0,
    leakyRateLimit: 0, lastFireTime: 0,
    velEmaX: 0, velEmaY: 0, velEmaZ: 0
  };
  players.set(playerId, pState);

  // Match Initialization Lifecycle - Store MatchInProgress
  setDoc(doc(db, "MatchInProgress", playerId), {
    playerId,
    startTime: Date.now()
  }).catch((e) => {});

  channel.emit("handshake", { type: "handshake", id: playerId, zones: Object.values(ZONES) });
  channel.on("handshake", () => {}); // placeholder
  channel.on("rewarded_ad", () => {
    const p = players.get(playerId);
    if (p) p.adMultiplier = 2;
  });

  // Init KCC
  if (rapierWorld) {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.2, 0);
    pState.body = rapierWorld.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.3);
    pState.collider = rapierWorld.createCollider(colliderDesc, pState.body);
    pState.kcc = rapierWorld.createCharacterController(0.01);
    pState.kcc.setUp({ x: 0, y: 1, z: 0 });
    pState.kcc.setApplyImpulsesToDynamicBodies(true);
    
  }

  channel.onRaw((message: any) => {
    const buffer = message as ArrayBuffer;
    if (buffer.byteLength >= 20) {
      const dataView = new DataView(buffer);
      const seq = dataView.getUint32(0, true);
      const inputMask = dataView.getUint8(4);
      const pitch = dataView.getFloat32(5, true);
      const yaw = dataView.getFloat32(9, true);
      // We don't read fire here anymore, or we just ignore it
      
      if (seq > pState.lastSequence) {
        pState.lastSequence = seq;
        pState.pitch = pitch;
        pState.yaw = yaw;
        pState.inputMask = inputMask;
      }
    }
  });

  channel.on("dev_spawn_drone", (args: any) => {
    // We can spawn a drone of type args.type at ZONES.COURTYARD just to spawn it
    const type = typeof args.type === "number" ? args.type : Number(args.type);
    
    // Find inactive drone
    let spawned = false;
    for (let i = 0; i < drones.length; i++) {
       if (drones[i].state === DroneState.DEAD) {
           const d = drones[i];
           d.type = type;
           d.state = DroneState.IDLE;
           d.posX = args.x !== undefined ? args.x : 0;
           d.posY = args.y !== undefined ? args.y : 2;
           d.posZ = args.z !== undefined ? args.z : 0;
           d.hp = 100; // or get from DRONE_CONFIGS
           const cfg = DRONE_CONFIGS[type as DroneType];
           if (cfg) d.hp = cfg.hp;
           d.zone = ZONES.COURTYARD;
           d.cooldown = 0;
           d.velX = 0; d.velY = 0; d.velZ = 0;
           spawned = true;
           break;
       }
    }
    if (!spawned) {
    }
  });

  channel.on("dev_clear_drones", () => {
    for (let i = 0; i < drones.length; i++) {
        drones[i].state = DroneState.DEAD;
    }
  });

  channel.on("dev_set_class", (args: any) => {
    if (args.playerClass) {
        pState.weapon = 'rifle'; // default for all classes in MVP
        // Additional class mappings can be stored in playerState later
        pState.hp = 100; // heal on class change
    }
  });

  channel.on("reliable_fire", (args: any) => {
    const now = Date.now();
    const elapsed = now - pState.lastFireTime;
    const weaponStats = WEAPONS[pState.weapon] || WEAPONS.rifle;
    const allowedInterval = 1000 / weaponStats.fireRateHz;
    
    pState.leakyRateLimit = Math.max(0, pState.leakyRateLimit - (elapsed / allowedInterval));
    pState.lastFireTime = now;

    if (pState.leakyRateLimit < weaponStats.capacity) {
      pState.leakyRateLimit += 1;
      pState.firedThisTick = true;
      const dirX = args.dx;
      const dirY = args.dy;
      const dirZ = args.dz;
      
      const timestamp = args.timestamp;
      const expectedT = Date.now() - pState.ping;
      let targetTick = serverTick;
      if (Math.abs(timestamp - expectedT) <= 50) {
         const rewindMs = Math.min(200, Date.now() - timestamp);
         targetTick = serverTick - Math.floor(rewindMs / 16.66);
      }
      
      let hitFound = false;
      for (let i = 0; i < HISTORICAL_SAMPLES_MAX; i++) {
        const baseIdx = i * HISTORIC_BLOCK_SIZE;
        const recTick = historicalAABBHistory[baseIdx];
        if (recTick > 0 && Math.abs(recTick - targetTick) <= 1) {
          const numDrones = historicalAABBHistory[baseIdx + 1];
          for (let dIdx = 0; dIdx < numDrones; dIdx++) {
            const offset = baseIdx + 2 + dIdx * 4;
            const dId = historicalAABBHistory[offset];
            const cx = historicalAABBHistory[offset + 1];
            const cy = historicalAABBHistory[offset + 2];
            const cz = historicalAABBHistory[offset + 3];
            
            const tox = cx - args.x;
            const toy = cy - args.y;
            const toz = cz - args.z;
            
            const t = tox * dirX + toy * dirY + toz * dirZ;
            if (t > 0) { 
              const px = args.x + dirX * t;
              const py = args.y + dirY * t;
              const pz = args.z + dirZ * t;
              const distSq = (cx - px)**2 + (cy - py)**2 + (cz - pz)**2;
              
              if (distSq < 2.25) { 
                const hitDrone = drones.find(d => d.id === dId);
                if (hitDrone) {
                  hitDrone.hp -= weaponStats.damage;
                  hitFound = true;
                  if (hitDrone.hp <= 0) {
                    hitDrone.state = DroneState.DEAD;
                    broadcastReliableEvent({ type: "drone_killed", id: hitDrone.id, zone: hitDrone.zone });
                  }
                  break;
                }
              }
            }
          }
          break;
        }
      }
      pState.score += hitFound ? 10 : 0;
    }
  });

    channel.onDisconnect(() => {
    const pInfo = players.get(playerId);
    const finalScore = pInfo?.score || 0;
    const finalHp = pInfo?.hp || 0;
    const adMultiplier = pInfo?.adMultiplier || 1;
    
    players.delete(playerId);
    console.log(`Disconnection registered: ${playerId}`);
    
    // Process End of Match Transaction (if not already handled gracefully)
    if (finalHp > 0) {
        processMatchEndTransaction(playerId, finalScore, adMultiplier);
    }
  });
});

const serveApp = async () => {
  await initPhysics();
  initLLMCommander();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
  console.log("Removed server start logs");
  });
};

serveApp();
