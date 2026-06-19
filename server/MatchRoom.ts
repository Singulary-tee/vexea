import { GoogleGenAI, Type } from "@google/genai";
import RAPIER from "@dimforge/rapier3d-compat";
import { ACTIVE_GAMEMODE } from "../shared/gamemode-configs.js";
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
  ZoneName,
  WAYPOINTS,
  ZONES_ARRAY,
  BehaviorProfile,
  DRONE_CONFIGS,
  TOTAL_STATE_BUFFER_SIZE as CONST_BUFFER_SIZE
} from "../shared/constants";
import { ChannelAdapter } from "./transport/adapter";
import { getMapById } from "../shared/maps/map-registry";
import { ZoneRegistry } from "./map/ZoneRegistry";
import { CollisionMap } from "./map/CollisionMap";
import * as fs from 'fs';
import * as path from 'path';
import { 
  db, doc, collection, query, where, getDocs, setDoc, deleteDoc, updateDoc, increment, runTransaction,
  globalChannels, globalServerLogs
} from "./index";

export const MAX_PROJECTILES = 200;

export interface PlayerState {
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
  weaponState: {
    primary: { currentMag: number, reserve: number, isReloading: boolean, reloadTimer: number, fireMode: 'auto' | 'burst', lastConfirmedShotT: number, leakyBucket: number };
    secondary: { currentMag: number, reserve: number, isReloading: boolean, reloadTimer: number, fireMode: 'auto' | 'burst', lastConfirmedShotT: number, leakyBucket: number };
  };
  ping: number;
  lastSequence: number;
  leakyRateLimit: number;
  lastFireTime: number;

  velEmaX: number; velEmaY: number; velEmaZ: number;
  adMultiplier?: number;
  firedThisTick?: boolean;

  maxHp: number;
  isAlive: boolean;
  isDead: boolean;
  respawnTimer: number;
  lastDamageSource: {
    type: 'bullet' | 'explosion' | 'fall' | 'melee';
    entityId: string;
    entityType: 'drone' | 'environment' | 'player';
  };
  deathPosition: { x: number, y: number, z: number };
  stats: {
    damageDealt: number;
    damageReceived: number;
    deaths: number;
    droneEliminations: number;
    assists: number;
    objectiveTimeHeld: number;
    revivesPerformed: number;
    distanceTravelled: number;
    timeAlive: number;
    scoreIndividual: number;
  };
  lastFallStartY: number;
}

export interface ServerDrone {
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
  cooldown: number;
  damageLog: { playerId: string, timestamp: number }[];
}

export interface ServerCamera {
  id: number; 
  posX: number; 
  posY: number; 
  posZ: number; 
  rotY: number; 
  isActive: boolean; 
  hp: number; 
  detectionRadius: number; 
  cooldown: number;
}

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

const HISTORICAL_SAMPLES_MAX = 120;
const HISTORIC_BLOCK_SIZE = 2 + MAX_DRONES * 4;

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

export class MatchRoom {
  public roomId: string;
  public players: Map<string, PlayerState> = new Map();
  public drones: ServerDrone[] = [];
  public nextDroneId = 1;
  public serverTick = 0;
  public matchActive = false;
  public matchStartTime = 0;
  public cameras: ServerCamera[] = [];
  public apiCallCount = 0;
  public failedOperations: string[] = [];
  public zoneSummary!: Record<ZoneName, ServerZoneState>;

  // Projectiles Pool
  public projActive = new Uint8Array(200);
  public projPosX = new Float32Array(200);
  public projPosY = new Float32Array(200);
  public projPosZ = new Float32Array(200);
  public projVelX = new Float32Array(200);
  public projVelY = new Float32Array(200);
  public projVelZ = new Float32Array(200);
  public projDamage = new Float32Array(200);
  public projDist = new Float32Array(200);
  public projEnemy = new Uint8Array(200);
  public projSourceId: string[] = new Array(200).fill("");

  // History verification buffer (Zero-GC)
  public historicalAABBHistory = new Float32Array(HISTORICAL_SAMPLES_MAX * HISTORIC_BLOCK_SIZE);
  public historicalAABBIndex = 0;

  // Rapier Physics
  public rapierWorld!: RAPIER.World;

  // AI config
  private geminiClient: GoogleGenAI | null = null;
  public aiCommanderActive = false;
  private geminiThrottleCooldownUntil = 0;

  // Sockets pre-allocated pack write buffers
  private preallocatedBuffer = new ArrayBuffer(TOTAL_STATE_BUFFER_SIZE);
  private payloadWriter = new DataView(this.preallocatedBuffer);
  private playerSyncBuffer = new ArrayBuffer(20);
  private playerSyncView = new DataView(this.playerSyncBuffer);

  // Interval handlers
  private physicsInterval: any = null;
  private syncInterval: any = null;
  private aiInterval: any = null;

  public mapId: string;
  public zoneRegistry: ZoneRegistry | null = null;
  public collisionMap: CollisionMap | null = null;

  constructor(roomId: string, geminiKey?: string, mapId = 'map_0_dev') {
    this.roomId = roomId;
    this.mapId = mapId;
    this.initMapConfig();
    this.initPhysics();
    this.initEntities();
    this.initLLMCommander(geminiKey);
    this.startSimulationLoops();
  }

  private initMapConfig() {
     const mapDef = getMapById(this.mapId);
     if (mapDef && mapDef.specFile) {
        try {
           const absolutePath = path.join(process.cwd(), mapDef.specFile);
           const specJson = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
           this.zoneRegistry = new ZoneRegistry();
           this.zoneRegistry.loadFromSpec(specJson);
           this.collisionMap = new CollisionMap();
           this.collisionMap.loadFromSpec(specJson);
           
           if (specJson.spawnPoints) {
             console.log('[MATCH ROOM] Registered spawn points from spec');
           }
        } catch (e) {
           console.error('[MATCH ROOM] failed to load map spec', e);
        }
     }
  }

  private initPhysics() {
    this.rapierWorld = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
    
    // Map Boundaries
    this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0));
    this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(100, 20, 1).setTranslation(0, 10, 100));
    this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(100, 20, 1).setTranslation(0, 10, -100));
    this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(1, 20, 100).setTranslation(100, 10, 0));
    this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(1, 20, 100).setTranslation(-100, 10, 0));
    
    // Core Pillars / Objs
    this.rapierWorld.createCollider(RAPIER.ColliderDesc.cylinder(6, 4).setTranslation(0, 3, 0));
    this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(5, 4, 1).setTranslation(-15, 2, -15));
    this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(5, 4, 1).setTranslation(15, 2, -15));
    this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(4, 4, 4).setTranslation(35, 2, 20));
    this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(3, 3, 3).setTranslation(45, 1.5, 35));
    this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(12, 5, 1).setTranslation(30, 2.5, -20));
  }

  private initEntities() {
    // Populate drone structures preallocated pool
    for (let i = 0; i < MAX_DRONES; i++) {
      this.drones.push({
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
        cooldown: 0,
        damageLog: []
      });
    }

    // Initialize cameras
    for (let i = 0; i < 20; i++) {
      this.cameras.push({ id: i, posX: 0, posY: 5, posZ: 0, rotY: 0, isActive: false, hp: 0, detectionRadius: 30, cooldown: 0 });
    }
    for (let i = 0; i < ZONES_ARRAY.length; i++) {
      this.cameras[i].isActive = true; 
      this.cameras[i].hp = 50; 
      this.cameras[i].posX = WAYPOINTS[ZONES_ARRAY[i]].x; 
      this.cameras[i].posY = 8; 
      this.cameras[i].posZ = WAYPOINTS[ZONES_ARRAY[i]].z;
    }

    // Default zone summaries structures
    this.zoneSummary = {
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
  }

  private initLLMCommander(geminiKey?: string) {
    const key = geminiKey || process.env.GEMINI_API_KEY;
    if (!key) return;
    this.geminiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    this.aiCommanderActive = true;
  }

  public registerPlayer(playerId: string, channel: ChannelAdapter, stats: any): PlayerState {
    const pState: PlayerState = {
      id: playerId,
      channel,
      kcc: null,
      body: null,
      collider: null,
      inputMask: 0,
      fire: 0,
      timestamp: Date.now(),
      posX: (Math.random() - 0.5) * 40,
      posY: 1.2,
      posZ: 120 + (Math.random() - 0.5) * 10,
      velX: 0, velY: 0, velZ: 0,
      pitch: 0, yaw: 0,
      hp: 100,
      score: 0,
      weapon: "rifle",
      weaponState: {
        primary: { currentMag: 40, reserve: 120, isReloading: false, reloadTimer: 0, fireMode: 'auto', lastConfirmedShotT: 0, leakyBucket: 0 },
        secondary: { currentMag: 35, reserve: 100, isReloading: false, reloadTimer: 0, fireMode: 'auto', lastConfirmedShotT: 0, leakyBucket: 0 }
      },
      ping: 30,
      lastSequence: 0,
      leakyRateLimit: 0,
      lastFireTime: 0,
      velEmaX: 0, velEmaY: 0, velEmaZ: 0,
      adMultiplier: 1,
      firedThisTick: false,
      maxHp: 100,
      isAlive: true,
      isDead: false,
      respawnTimer: 0,
      lastDamageSource: { type: 'bullet', entityId: '', entityType: 'player' },
      deathPosition: { x: 0, y: 0, z: 0 },
      stats: {
        damageDealt: 0,
        damageReceived: 0,
        deaths: 0,
        droneEliminations: 0,
        assists: 0,
        objectiveTimeHeld: 0,
        revivesPerformed: 0,
        distanceTravelled: 0,
        timeAlive: 0,
        scoreIndividual: 0
      },
      lastFallStartY: 1.2
    };

    if (stats) {
       Object.assign(pState.stats, stats);
    }

    // Create KCC bounds
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pState.posX, pState.posY, pState.posZ);
    pState.body = this.rapierWorld.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.3);
    pState.collider = this.rapierWorld.createCollider(colliderDesc, pState.body);
    pState.kcc = this.rapierWorld.createCharacterController(0.01);
    pState.kcc.setUp({ x: 0, y: 1, z: 0 });
    pState.kcc.setApplyImpulsesToDynamicBodies(true);

    this.players.set(playerId, pState);

    // Initial positioning handshake
    channel.emit("handshake", { type: "handshake", id: playerId, zones: Object.values(ZONES) });
    return pState;
  }

  public removePlayer(playerId: string) {
    const p = this.players.get(playerId);
    if (p) {
      if (p.body) this.rapierWorld.removeRigidBody(p.body);
      this.players.delete(playerId);
      this.broadcastReliableEvent({ type: 'PLAYER_LEFT', playerId });
    }
    // Clean room up if completely empty
    if (this.players.size === 0) {
      this.shutdown();
    }
  }

  private startSimulationLoops() {
    const PHYSICS_TICK_RATE = 60n;
    const PHYSICS_TIMESTEP = 1000000000n / PHYSICS_TICK_RATE;
    let lastPhysicsTime = process.hrtime.bigint();
    let physicsAccumulator = 0n;

    this.physicsInterval = setInterval(() => {
      const now = process.hrtime.bigint();
      physicsAccumulator += (now - lastPhysicsTime);
      lastPhysicsTime = now;

      if (physicsAccumulator > PHYSICS_TIMESTEP * 10n) {
        physicsAccumulator = PHYSICS_TIMESTEP * 10n;
      }

      while (physicsAccumulator >= PHYSICS_TIMESTEP) {
        if (this.matchActive) {
          this.serverTick++;
          const matchElapsed = (Date.now() - this.matchStartTime) / 1000;
          if (matchElapsed >= ACTIVE_GAMEMODE.matchDuration) {
            this.handleMatchEnd('loss');
            continue;
          }

          // Respawn ticks & weapon states
          for (const player of this.players.values()) {
            if (!player.isAlive) {
              player.hp = 0;
              player.inputMask = 0;
              player.fire = 0;
              player.velX = 0; player.velY = 0; player.velZ = 0;
              
              const dt = 0.016666;
              const beforeCeil = Math.ceil(player.respawnTimer);
              player.respawnTimer -= dt;
              
              if (player.respawnTimer <= 0) {
                console.log('[RESPAWN] triggering respawn for', player.id);
                player.isAlive = true;
                player.isDead = false;
                player.hp = player.maxHp;
                player.posX = (Math.random() - 0.5) * 40;
                player.posY = 1.0;
                player.posZ = 120 + (Math.random() - 0.5) * 10;
                
                if (player.body) {
                  player.body.setNextKinematicTranslation({ x: player.posX, y: player.posY, z: player.posZ });
                }
                player.channel.emit("reliable_event", { 
                   type: 'YOU_RESPAWNED', 
                   hp: player.hp, 
                   position: { x: player.posX, y: player.posY, z: player.posZ } 
                });
                this.broadcastReliableEvent({
                   type: 'PLAYER_RESPAWN',
                   playerId: player.id,
                   position: { x: player.posX, y: player.posY, z: player.posZ }
                });
              } else {
                const afterCeil = Math.ceil(player.respawnTimer);
                if (beforeCeil !== afterCeil) {
                   player.channel.emit("reliable_event", { type: 'RESPAWN_COUNTDOWN', remaining: afterCeil });
                }
              }
              continue;
            }

            // Reload timers
            ['primary', 'secondary'].forEach(s => {
                const slot = s as 'primary' | 'secondary';
                const wState = player.weaponState[slot];
                if (wState.isReloading) {
                    wState.reloadTimer--;
                    if (wState.reloadTimer <= 0) {
                        wState.isReloading = false;
                        const maxCapacity = slot === 'primary' ? 40 : 35;
                        const needed = maxCapacity - wState.currentMag;
                        const taken = Math.min(needed, wState.reserve);
                        wState.currentMag += taken;
                        wState.reserve -= taken;
                        player.channel.emit("reliable_event", {
                            type: 'AMMO_STATE',
                            primary: player.weaponState.primary,
                            secondary: player.weaponState.secondary
                        });
                    }
                }
            });

            // Player movement ticks
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

              const moveSpeed = 4.5 * speedMultiplier;
              player.velX = dirX * moveSpeed;
              player.velZ = dirZ * moveSpeed;

              // Simple jump / gravity mechanics
              const gravity = -18.0;
              player.velY += gravity * 0.0166;
              if (isJump && player.posY <= 1.2) {
                player.velY = 7.0;
              }

              const desiredTranslation = { x: player.velX * 0.0166, y: player.velY * 0.0166, z: player.velZ * 0.0166 };
              player.kcc.computeColliderMovement(player.collider, desiredTranslation, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
              
              const correctedTrans = player.kcc.computedMovement();
              const prevX = player.posX; const prevY = player.posY; const prevZ = player.posZ;
              player.posX += correctedTrans.x;
              player.posY += correctedTrans.y;
              player.posZ += correctedTrans.z;

              // Fall damage thresholds
              if (player.posY < prevY && player.velY < -5.0) {
                 if (player.lastFallStartY === 0) player.lastFallStartY = prevY;
              }
              const grounded = player.kcc.computedGrounded() || player.posY <= 1.22;
              if (grounded) {
                if (player.posY < 1.1) player.posY = 1.2;
                player.velY = 0;
                if (player.lastFallStartY > 0) {
                  const fallDist = player.lastFallStartY - player.posY;
                  player.lastFallStartY = 0;
                  if (fallDist > 14.0) {
                     const fallDamage = Math.floor((fallDist - 14.0) * 12.0);
                     if (fallDamage > 0) {
                        this.applyDamage(player.id, fallDamage, 'fall', '0', 'environment');
                     }
                  }
                }
              }

              // EMA Smoothed speed estimations
              const actualVx = (player.posX - prevX) / 0.0166;
              const actualVy = (player.posY - prevY) / 0.0166;
              const actualVz = (player.posZ - prevZ) / 0.0166;
              player.velEmaX = player.velEmaX * 0.8 + actualVx * 0.2;
              player.velEmaY = player.velEmaY * 0.8 + actualVy * 0.2;
              player.velEmaZ = player.velEmaZ * 0.8 + actualVz * 0.2;

              if (player.body) {
                player.body.setNextKinematicTranslation({ x: player.posX, y: player.posY, z: player.posZ });
              }
            } // end if player.kcc...

            // RESTRICTED GATE DAMAGE
            if (this.zoneRegistry && this.zoneRegistry.isInRestrictedGate(player.posX, player.posZ) && player.hp > 0) {
               const damage = 25 * 0.0166;
               player.hp -= damage;
               if (player.hp <= 0) {
                  player.hp = 0;
                  this.applyDamage(player.id, 9999, 'explosion', '0', 'environment');
               } else {
                  player.channel.emit("reliable_event", { type: 'GATE_DAMAGE', damage: damage, currentHp: player.hp });
               }
            }
          }

          // World updates (RVO avoidance, projectile updates)
          this.updateSystemEntities();
          this.rapierWorld.step();
        }

        physicsAccumulator -= PHYSICS_TIMESTEP;
      }
    }, 5);

    // AI timing loop (8s)
    this.aiInterval = setInterval(() => {
      if (!this.matchActive) return;
      if (this.aiCommanderActive && Date.now() > this.geminiThrottleCooldownUntil) {
        this.executeLLMStep();
      } else {
        this.offlineSystemFallbackAI();
      }
    }, 8000);

    // Sync broadcast networking updates (20Hz)
    this.syncInterval = setInterval(() => {
      if (this.players.size === 0) return;
      if (!this.matchActive) return;

      const packedData = this.packWorldNetworkData();
      const activeProj = [];
      for (let i = 0; i < MAX_PROJECTILES; i++) {
        if (this.projActive[i]) {
          activeProj.push({ x: this.projPosX[i], y: this.projPosY[i], z: this.projPosZ[i], enemy: this.projEnemy[i] === 1 });
        }
      }

      const ranking = Array.from(this.players.values()).map(p => ({ id: p.id, hp: p.hp, score: p.score }));

      for (const player of this.players.values()) {
        try {
          player.channel.rawEmit(packedData);
          
          this.playerSyncView.setUint32(0, this.serverTick, true);
          this.playerSyncView.setUint32(4, player.lastSequence, true);
          this.playerSyncView.setFloat32(8, player.posX, true);
          this.playerSyncView.setFloat32(12, player.posY, true);
          this.playerSyncView.setFloat32(16, player.posZ, true);
          player.channel.rawEmit(this.playerSyncBuffer);
          
          player.channel.emit("state_sync", {
            type: "state_sync",
            tick: this.serverTick,
            projectiles: activeProj,
            players: ranking
          });
        } catch (e) {
          // Discard safely
        }
      }
    }, 50.0);
  }

  public registerDeveloperSpawner(type: number): boolean {
    let spawned = false;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (d.state === DroneState.DEAD) {
        d.id = this.nextDroneId++;
        d.type = type;
        d.state = DroneState.IDLE;
        d.zone = ZONES.COURTYARD;
        const b = ZONE_BOUNDS[ZONES.COURTYARD];
        d.posX = b.center.x + (Math.random() - 0.5) * b.halfSize.x * 0.4;
        d.posY = d.type === DroneType.ROTARY_SHOOTER || d.type === DroneType.BOMBER || d.type === DroneType.RECON || d.type === DroneType.FIXED_WING ? b.center.y + 4 : b.center.y + 0.8;
        d.posZ = b.center.z + (Math.random() - 0.5) * b.halfSize.z * 0.4;
        d.hp = 100;
        d.groupId = "G_DEV";
        d.cooldown = 40;
        
        spawned = true;
        this.broadcastReliableEvent({ type: "group_spawned", zone: ZONES.COURTYARD, count: 1, groupId: d.groupId });
        break;
      }
    }
    return spawned;
  }

  public executeAABBShotValidation(origin: { x: number, y: number, z: number }, dir: { x: number, y: number, z: number }, timestamp: number): { hit: boolean, droneId: number } {
    let bestHitDrone: ServerDrone | null = null;
    let minTimeOfImpact = 999999.0;

    // Apply temporal rollback checks
    const pingCompensatedTick = Math.max(0, this.serverTick - Math.min(12, Math.floor(timestamp / 16.6)));
    let recordFoundIdx = -1;
    for (let r = 0; r < HISTORICAL_SAMPLES_MAX; r++) {
       const baseIdx = r * HISTORIC_BLOCK_SIZE;
       if (this.historicalAABBHistory[baseIdx] === pingCompensatedTick) {
          recordFoundIdx = baseIdx;
          break;
       }
    }

    if (recordFoundIdx !== -1) {
       const recordedCount = this.historicalAABBHistory[recordFoundIdx + 1];
       for (let i = 0; i < recordedCount; i++) {
          const dBase = recordFoundIdx + 2 + i * 4;
          const dId = this.historicalAABBHistory[dBase];
          const rx = this.historicalAABBHistory[dBase + 1];
          const ry = this.historicalAABBHistory[dBase + 2];
          const rz = this.historicalAABBHistory[dBase + 3];

          const droneRef = this.drones.find(d => d.id === dId);
          if (droneRef && droneRef.state !== DroneState.DEAD) {
             const distToDrone = Math.sqrt((rx - origin.x)*(rx - origin.x) + (ry - origin.y)*(ry - origin.y) + (rz - origin.z)*(rz - origin.z));
             if (distToDrone < minTimeOfImpact) {
                minTimeOfImpact = distToDrone;
                bestHitDrone = droneRef;
             }
          }
       }
    } else {
       // Fallback directly to present moments
       for (let i = 0; i < this.drones.length; i++) {
          const d = this.drones[i];
          if (d.state !== DroneState.DEAD) {
             const distToDrone = Math.sqrt((d.posX - origin.x)*(d.posX - origin.x) + (d.posY - origin.y)*(d.posY - origin.y) + (d.posZ - origin.z)*(d.posZ - origin.z));
             if (distToDrone < minTimeOfImpact) {
                minTimeOfImpact = distToDrone;
                bestHitDrone = d;
             }
          }
       }
    }

    if (bestHitDrone) {
       if (this.collisionMap && this.collisionMap.rayIntersectsAny(origin, dir, minTimeOfImpact)) {
           return { hit: false, droneId: 0 };
       }
       return { hit: true, droneId: bestHitDrone.id };
    }
    return { hit: false, droneId: 0 };
  }

  private updateSystemEntities() {
    let detectedZones = new Set<ZoneName>();
    
    // Process projectiles
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      if (this.projActive[i]) {
        this.projPosX[i] += this.projVelX[i] * 0.1666; 
        this.projPosY[i] += this.projVelY[i] * 0.1666; 
        this.projPosZ[i] += this.projVelZ[i] * 0.1666;
        this.projDist[i] += Math.sqrt(this.projVelX[i]*this.projVelX[i] + this.projVelY[i]*this.projVelY[i] + this.projVelZ[i]*this.projVelZ[i]) * 0.1666;
        
        if (this.projDist[i] >= 40 || Math.abs(this.projPosX[i]) > 100 || Math.abs(this.projPosZ[i]) > 100 || this.projPosY[i] < 0) { 
          this.projActive[i] = 0; continue; 
        }
        
        if (this.projEnemy[i]) {
          // Hits players
          for (const player of this.players.values()) {
            if (!player.isAlive) continue;
            const dx = player.posX - this.projPosX[i]; 
            const dy = player.posY - this.projPosY[i]; 
            const dz = player.posZ - this.projPosZ[i];
            if (dx*dx+dy*dy+dz*dz < 2.25) {
              this.applyDamage(player.id, this.projDamage[i], 'bullet', this.projSourceId[i], 'drone');
              this.projActive[i] = 0;
              break;
            }
          }
        } else {
          // Hits drones
          for (let j = 0; j < this.drones.length; j++) {
            const d = this.drones[j];
            if (d.state !== DroneState.DEAD) {
              const dx = d.posX - this.projPosX[i]; const dy = d.posY - this.projPosY[i]; const dz = d.posZ - this.projPosZ[i];
              if (dx*dx+dy*dy+dz*dz < (d.rad * d.rad)) {
                 d.hp -= this.projDamage[i]; this.projActive[i] = 0;
                 if (d.hp <= 0) { 
                    d.state = DroneState.DEAD; 
                    this.broadcastReliableEvent({ type: "drone_killed", id: d.id, zone: d.zone }); 
                 }
                 break;
              }
            }
          }
          // Hits zone cameras
          if (this.projActive[i]) {
             for (let j = 0; j < this.cameras.length; j++) {
                if (this.cameras[j].isActive) {
                   const dx = this.cameras[j].posX - this.projPosX[i]; const dy = this.cameras[j].posY - this.projPosY[i]; const dz = this.cameras[j].posZ - this.projPosZ[i];
                   if (dx*dx+dy*dy+dz*dz < 4) {
                      this.cameras[j].hp -= this.projDamage[i]; this.projActive[i] = 0;
                      if (this.cameras[j].hp <= 0) this.cameras[j].isActive = false;
                      break;
                   }
                }
             }
          }
        }
      }
    }

    let targetPlayer: PlayerState | null = null;
    for (const p of this.players.values()) { targetPlayer = p; break; }

    const nowMs = Date.now();
    for (const zoneId of ZONES_ARRAY) { this.zoneSummary[zoneId].droneGroups.length = 0; }
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (d.state !== DroneState.DEAD) {
        if (!this.zoneSummary[d.zone].droneGroups.includes(d.groupId)) { 
          this.zoneSummary[d.zone].droneGroups.push(d.groupId); 
        }
      }
    }

    if (targetPlayer) {
      let playerZone: ZoneName = ZONES.CORE;
      for (const zoneId of ZONES_ARRAY) {
        const b = ZONE_BOUNDS[zoneId];
        const dx = Math.abs(targetPlayer.posX - b.center.x); const dy = Math.abs(targetPlayer.posY - b.center.y); const dz = Math.abs(targetPlayer.posZ - b.center.z);
        if (dx <= b.halfSize.x && dy <= b.halfSize.y && dz <= b.halfSize.z) { playerZone = zoneId; break; }
      }
      
      // Drone detection check LOS
      for (let i = 0; i < this.drones.length; i++) {
        const d = this.drones[i];
        if (d.state !== DroneState.DEAD && d.zone === playerZone && d.type !== DroneType.BOMBER && d.type !== DroneType.FIXED_WING) {
           const dx = targetPlayer.posX - d.posX; const dy = targetPlayer.posY - d.posY; const dz = targetPlayer.posZ - d.posZ;
           if (dx*dx+dy*dy+dz*dz < 900) { detectedZones.add(playerZone); break; }
        }
      }

      // Camera checks LOS
      for (let c = 0; c < this.cameras.length; c++) {
        if (this.cameras[c].isActive) {
           const dx = targetPlayer.posX - this.cameras[c].posX; const dy = targetPlayer.posY - this.cameras[c].posY; const dz = targetPlayer.posZ - this.cameras[c].posZ;
           if (dx*dx+dy*dy+dz*dz < this.cameras[c].detectionRadius * this.cameras[c].detectionRadius) {
              let hasLOS = true;
              if (this.rapierWorld) {
                const rayDir = { x: targetPlayer.posX - this.cameras[c].posX, y: targetPlayer.posY - this.cameras[c].posY, z: targetPlayer.posZ - this.cameras[c].posZ };
                const len = Math.sqrt(rayDir.x*rayDir.x + rayDir.y*rayDir.y + rayDir.z*rayDir.z);
                if (len > 0) {
                   rayDir.x /= len; rayDir.y /= len; rayDir.z /= len;
                   const ray = new RAPIER.Ray({x: this.cameras[c].posX, y: this.cameras[c].posY, z: this.cameras[c].posZ}, rayDir);
                   const hit = this.rapierWorld.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
                   if (hit && hit.collider && hit.timeOfImpact < len - 0.7) hasLOS = false;
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
         const z = this.zoneSummary[zoneId];
         if (detectedZones.has(zoneId)) {
           z.playerPresence = "confirmed"; z.lastSeenTimestamp = nowMs;
         } else {
           const elapsed = nowMs - z.lastSeenTimestamp;
           if (z.playerPresence === "confirmed" && elapsed >= 30000) { z.playerPresence = "last_seen"; } 
           else if ((z.playerPresence === "confirmed" || z.playerPresence === "last_seen") && elapsed >= 60000) { z.playerPresence = "unknown"; }
           
           for (let i = 0; i < this.drones.length; i++) {
             if (this.drones[i].state !== DroneState.DEAD && this.drones[i].type === DroneType.RECON && this.drones[i].zone === zoneId) {
               if (z.playerPresence !== "confirmed") z.playerPresence = "confirmed";
             }
           }
         }
      }
    }

    // Drone state updates
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (d.state === DroneState.DEAD) continue;
      
      const oldState = d.state;

      if (d.state === DroneState.IDLE) {
        d.cooldown--;
        if (d.cooldown <= 0) { d.state = DroneState.PATROLLING; }
        continue;
      }

      let finalTargetX = WAYPOINTS[d.zone].x; let finalTargetY = WAYPOINTS[d.zone].y; let finalTargetZ = WAYPOINTS[d.zone].z;
      
      if (targetPlayer) {
        const dx = targetPlayer.posX - d.posX; const dy = targetPlayer.posY - d.posY; const dz = targetPlayer.posZ - d.posZ;
        const rsq = dx*dx + dy*dy + dz*dz;
        
        const fireDist = 625.0; // 25 units
        let withinFireDist = rsq < fireDist;
        
        let hasLOS = true;
        if (this.rapierWorld) {
          const rayStart = { x: d.posX, y: d.posY + 0.5, z: d.posZ };
          const rayDir = { x: targetPlayer.posX - d.posX, y: targetPlayer.posY - (d.posY + 0.5), z: targetPlayer.posZ - d.posZ };
          const len = Math.sqrt(rayDir.x*rayDir.x + rayDir.y*rayDir.y + rayDir.z*rayDir.z);
          if (len > 0 && rsq < 900) {
             let rDir = { x: rayDir.x/len, y: rayDir.y/len, z: rayDir.z/len };
             const ray = new RAPIER.Ray(rayStart, rDir);
             const hit = this.rapierWorld.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
             if (hit && hit.collider && hit.timeOfImpact < len - 0.7) hasLOS = false;
          } else { hasLOS = false; }
        }
        
        const playerInZone = this.zoneSummary[d.zone].playerPresence === "confirmed" || detectedZones.has(d.zone);
        
        if (d.type === DroneType.BOMBER && rsq < 4.0) {
           this.applyExplosionDamage({x: d.posX, y: d.posY, z: d.posZ}, 4.0, DRONE_CONFIGS[d.type].damage, d.id.toString(), 'drone');
           d.state = DroneState.DEAD;
           continue;
        }
        
        if (d.type === DroneType.RECON) {
           d.state = DroneState.PURSUING;
           finalTargetX = targetPlayer.posX + (Math.random() - 0.5) * 40;
           finalTargetY = targetPlayer.posY + 15;
           finalTargetZ = targetPlayer.posZ + (Math.random() - 0.5) * 40;
        } else if (d.type === DroneType.FIXED_WING) {
           d.state = DroneState.PURSUING;
           const time = this.serverTick * 0.05;
           finalTargetX = targetPlayer.posX + Math.cos(time) * 30;
           finalTargetY = targetPlayer.posY + 20;
           finalTargetZ = targetPlayer.posZ + Math.sin(time) * 30;
           if (rsq < 400 && d.cooldown <= 0) { withinFireDist = true; }
        } else if (d.type === DroneType.HUMANOID) {
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
          if (this.rapierWorld) {
            const rayStart = { x: d.posX, y: d.posY + 0.5, z: d.posZ };
            const rayDir = { x: aimX - d.posX, y: aimY - (d.posY + 0.5), z: aimZ - d.posZ };
            const len = Math.sqrt(rayDir.x*rayDir.x + rayDir.y*rayDir.y + rayDir.z*rayDir.z);
            if (len > 0) {
              rayDir.x /= len; rayDir.y /= len; rayDir.z /= len;
              const ray = new RAPIER.Ray(rayStart, rayDir);
              const hit = this.rapierWorld.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
              if (hit && hit.collider && hit.timeOfImpact < len - 0.7) hasLOS = false;
            }
          }
          if (hasLOS) {
            d.state = DroneState.ATTACKING;
            this.spawnServerProjectile(d.posX, d.posY + 0.5, d.posZ, aimX - d.posX, aimY - (d.posY + 0.5), aimZ - d.posZ, true, DRONE_CONFIGS[d.type].damage, d.id.toString());
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

      this.computeVelocityObstacleSteering(d, finalTargetX, finalTargetY, finalTargetZ);
      if (d.cooldown > 0) d.cooldown--;
      
      if (d.type === DroneType.BOMBER && targetPlayer) {
         const dx = targetPlayer.posX - d.posX; const dy = targetPlayer.posY - d.posY; const dz = targetPlayer.posZ - d.posZ;
         const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
         if (len > 0.01) { d.velX = (dx/len)*15; d.velY = (dy/len)*15; d.velZ = (dz/len)*15; }
      }

      d.posX += d.velX * 0.0166; d.posY += d.velY * 0.0166; d.posZ += d.velZ * 0.0166;
      
      const movementHeading = Math.atan2(d.velX, d.velZ);
      d.rotY = Math.sin(movementHeading * 0.5); d.rotW = Math.cos(movementHeading * 0.5); d.rotX = 0; d.rotZ = 0;
    }

    this.recordDroneHistory();
  }

  private recordDroneHistory() {
    const baseIdx = this.historicalAABBIndex * HISTORIC_BLOCK_SIZE;
    this.historicalAABBHistory[baseIdx] = this.serverTick;
    let count = 0;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (d.state !== DroneState.DEAD) {
        const dBase = baseIdx + 2 + count * 4;
        this.historicalAABBHistory[dBase] = d.id;
        this.historicalAABBHistory[dBase + 1] = d.posX;
        this.historicalAABBHistory[dBase + 2] = d.posY;
        this.historicalAABBHistory[dBase + 3] = d.posZ;
        count++;
      }
    }
    this.historicalAABBHistory[baseIdx + 1] = count;
    this.historicalAABBIndex = (this.historicalAABBIndex + 1) % HISTORICAL_SAMPLES_MAX;
  }

  private computeVelocityObstacleSteering(d: ServerDrone, tx: number, ty: number, tz: number) {
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
      
      for (let u = 0; u < this.drones.length; u++) {
        const other = this.drones[u];
        if (other.id !== d.id && other.state !== DroneState.DEAD) {
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

      for (const p of this.players.values()) {
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
  }

  public spawnServerProjectile(x: number, y: number, z: number, dirX: number, dirY: number, dirZ: number, isEnemy: boolean, damage: number, sourceId: string) {
    let pIdx = -1;
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      if (!this.projActive[i]) { pIdx = i; break; }
    }
    if (pIdx !== -1) {
      this.projActive[pIdx] = 1;
      this.projPosX[pIdx] = x;
      this.projPosY[pIdx] = y;
      this.projPosZ[pIdx] = z;
      const len = Math.sqrt(dirX*dirX + dirY*dirY + dirZ*dirZ);
      this.projVelX[pIdx] = len > 0.001 ? (dirX / len) * 35.0 : 0;
      this.projVelY[pIdx] = len > 0.001 ? (dirY / len) * 35.0 : 0;
      this.projVelZ[pIdx] = len > 0.001 ? (dirZ / len) * 35.0 : 0;
      this.projDamage[pIdx] = damage;
      this.projDist[pIdx] = 0;
      this.projEnemy[pIdx] = isEnemy ? 1 : 0;
      this.projSourceId[pIdx] = sourceId;
    }
  }

  private offlineSystemFallbackAI() {
    let targetPlayer: PlayerState | null = null;
    for (const p of this.players.values()) {
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

    let count = 0;
    for (let i = 0; i < this.drones.length; i++) {
      if (this.drones[i].state !== DroneState.DEAD) {
        count++;
      }
    }

    if (count < 12) {
      const spawnCountNeeded = Math.min(3, 12 - count);
      let spawnedIdx = 0;
      
      for (let i = 0; i < this.drones.length; i++) {
        const d = this.drones[i];
        if (d.state === DroneState.DEAD) {
          const targetSpawnZone = Math.random() < 0.6 ? playerZone : ZONES_ARRAY[Math.floor(Math.random() * ZONES_ARRAY.length)];
          const b = ZONE_BOUNDS[targetSpawnZone];
          
          d.id = this.nextDroneId++;
          d.state = DroneState.IDLE;
          d.type = Math.random() < 0.35 ? DroneType.ROTARY_SHOOTER : DroneType.WHEELED;
          d.zone = targetSpawnZone;
          d.posX = b.center.x + (Math.random() - 0.5) * b.halfSize.x * 0.5;
          d.posY = d.type === DroneType.ROTARY_SHOOTER ? b.center.y + 4 : b.center.y + 0.5;
          d.posZ = b.center.z + (Math.random() - 0.5) * b.halfSize.z * 0.5;
          d.hp = 100;
          
          const possibleGroupNames = ["G_ALPHA", "G_BETA", "G_GAMMA"];
          d.groupId = possibleGroupNames[Math.floor(Math.random() * possibleGroupNames.length)];
          d.cooldown = 40;
          
          spawnedIdx++;
          if (spawnedIdx >= spawnCountNeeded) break;
        }
      }
    }

    // Actively route
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (d.state !== DroneState.DEAD && d.state !== DroneState.IDLE) {
        if (d.zone !== playerZone && (d.path.length === 0 || d.pathIndex >= d.path.length - 1)) {
          if (Math.random() < 0.3) {
            d.path = astarPath(d.zone, playerZone);
            d.pathIndex = 0;
            d.state = DroneState.PATROLLING;
          }
        }
      }
    }
  }

  private async executeLLMStep() {
    if (!this.geminiClient) return;
    const _llmStartTime = Date.now();
    this.apiCallCount++;
    
    const statePayload = JSON.stringify(this.zoneSummary);
    const payloadToLLM = `Dynamic payload: Current Zone Summary: ${statePayload}\nFailed operations from previous cycle: ${JSON.stringify(this.failedOperations)}`;
    this.failedOperations.length = 0;

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
      const response = await this.geminiClient.models.generateContent({
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
      this.broadcastReliableEvent({ 
        type: "dev_llm_feed", 
        payload: statePayload, 
        calls: calls ? JSON.stringify(calls) : "[]", 
        latency: llmLatency, 
        count: this.apiCallCount,
        failedOps: [...this.failedOperations]
      });

      if (calls && calls.length > 0) {
        const pipelineOrder = ["spawn_units", "split_group", "merge_groups", "move_group", "hold_position", "sustain"];
        const sortedCalls = [...calls].sort((a, b) => pipelineOrder.indexOf(a.name) - pipelineOrder.indexOf(b.name));
        const groupLocks = new Set<string>();

        for (let i = 0; i < sortedCalls.length; i++) {
          const call = sortedCalls[i];
          const args: any = call.args;
          
          const mutatesGroups = ["split_group", "merge_groups", "move_group", "hold_position"].includes(call.name);
          if (mutatesGroups) {
            const g1 = args.group_id || args.source_group_id;
            const g2 = args.target_group_id;
            if ((g1 && groupLocks.has(g1)) || (g2 && groupLocks.has(g2))) {
              this.failedOperations.push(`Task rejected: Group lock collision for ${call.name}`);
              continue;
            }
            if (g1) groupLocks.add(g1);
            if (g2) groupLocks.add(g2);
          }

          switch (call.name) {
            case "spawn_units": {
              const { zone_id, unit_type, count, behavior_profile } = args;
              let currentActiveCount = 0;
              for (let j = 0; j < this.drones.length; j++) {
                if (this.drones[j].state !== DroneState.DEAD) currentActiveCount++;
              }
              if (currentActiveCount + count > MAX_DRONES) {
                this.failedOperations.push(`Spawn rejected: Count exceeded max active capacity of ${MAX_DRONES}`);
                break;
              }
              
              let successfullySpawned = 0;
              const newGroupId = `G_INC_${Math.floor(Math.random() * 1000)}`;
              for (let j = 0; j < this.drones.length; j++) {
                const d = this.drones[j];
                if (d.state === DroneState.DEAD) {
                  const b = ZONE_BOUNDS[zone_id as ZoneName];
                  d.id = this.nextDroneId++;
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
              this.broadcastReliableEvent({ type: "group_spawned", zone: zone_id, count: successfullySpawned, groupId: newGroupId });
              break;
            }

            case "split_group": {
              const { source_group_id, unit_count } = args;
              const matches: ServerDrone[] = [];
              for (let j = 0; j < this.drones.length; j++) {
                if (this.drones[j].groupId === source_group_id && this.drones[j].state !== DroneState.DEAD) {
                  matches.push(this.drones[j]);
                }
              }
              if (matches.length <= unit_count) {
                this.failedOperations.push(`Split rejected: Source group ${source_group_id} has insufficient members (${matches.length})`);
                break;
              }
              const newGroupId = `G_SPL_${Math.floor(Math.random() * 1000)}`;
              for (let j = 0; j < unit_count; j++) {
                matches[j].groupId = newGroupId;
              }
              this.broadcastReliableEvent({ type: "group_split_status", src: source_group_id, dst: newGroupId, size: unit_count });
              break;
            }

            case "merge_groups": {
              const { source_group_id, target_group_id } = args;
              let srcFound = false;
              let dstFound = false;
              for (let j = 0; j < this.drones.length; j++) {
                const d = this.drones[j];
                if (d.state !== DroneState.DEAD) {
                  if (d.groupId === source_group_id) { d.groupId = target_group_id; srcFound = true; }
                  if (d.groupId === target_group_id) dstFound = true;
                }
              }
              if (!srcFound || !dstFound) {
                this.failedOperations.push(`Merge rejected: Missing target groupings.`);
              } else {
                this.broadcastReliableEvent({ type: "group_linked", src: source_group_id, target: target_group_id });
              }
              break;
            }

            case "move_group": {
              const { group_id, target_zone } = args;
              let movedCount = 0;
              for (let j = 0; j < this.drones.length; j++) {
                const d = this.drones[j];
                if (d.groupId === group_id && d.state !== DroneState.DEAD) {
                  d.path = astarPath(d.zone, target_zone as ZoneName);
                  d.pathIndex = 0;
                  d.state = DroneState.PATROLLING;
                  movedCount++;
                }
              }
              if (movedCount === 0) {
                this.failedOperations.push(`Move rejected: No active members found for group: ${group_id}`);
              } else {
                this.broadcastReliableEvent({ type: "group_movement", id: group_id, zone: target_zone });
              }
              break;
            }

            case "hold_position": {
              const { group_id } = args;
              for (let j = 0; j < this.drones.length; j++) {
                const d = this.drones[j];
                if (d.groupId === group_id && d.state !== DroneState.DEAD) {
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
      this.broadcastReliableEvent({ 
        type: "dev_llm_feed", 
        payload: statePayload, 
        calls: JSON.stringify([{ error: errMsg }]), 
        latency: llmLatency, 
        count: this.apiCallCount,
        failedOps: [...this.failedOperations]
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
        this.geminiThrottleCooldownUntil = Date.now() + coolingPeriodMs;
        this.offlineSystemFallbackAI();
      } else {
        this.failedOperations.push(`Processor fail: ${errMsg}`);
      }
    }
  }

  public applyDamage(playerId: string, rawDamage: number, type: 'bullet' | 'explosion' | 'fall' | 'melee', entityId: string, entityType: 'drone' | 'environment' | 'player') {
    const p = this.players.get(playerId);
    if (!p || !p.isAlive) return;

    p.hp -= rawDamage;
    p.stats.damageReceived += rawDamage;
    p.lastDamageSource = { type, entityId, entityType };

    p.channel.emit("reliable_event", { type: 'PLAYER_HIT', hp: p.hp, rawDamage });

    if (p.hp <= 0) {
      p.hp = 0;
      p.isAlive = false;
      p.isDead = true;
      p.respawnTimer = 5.0; // 5 seconds respawn time
      p.deathPosition = { x: p.posX, y: p.posY, z: p.posZ };
      p.stats.deaths++;

      console.log('[DEATH] player died:', playerId, 'source:', type);

      p.channel.emit("reliable_event", { type: 'YOU_DIED', respawnTime: 5.0 });
      this.broadcastReliableEvent({
        type: 'PLAYER_DEATH',
        playerId,
        deathPosition: p.deathPosition,
        killerId: entityId
      });
    }
  }

  public applyExplosionDamage(origin: { x: number, y: number, z: number }, radius: number, maxDamage: number, sourceId: string, sourceType: 'drone' | 'environment' | 'player') {
    this.broadcastReliableEvent({ type: 'EXPLOSION', origin, radius });

    // Splash players
    for (const player of this.players.values()) {
      if (!player.isAlive) continue;
      const dx = player.posX - origin.x;
      const dy = player.posY - origin.y;
      const dz = player.posZ - origin.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist < radius) {
         const factor = 1.0 - dist / radius;
         const splash = Math.floor(maxDamage * factor);
         if (splash > 0) {
            this.applyDamage(player.id, splash, 'explosion', sourceId, sourceType);
         }
      }
    }

    // Splash drones
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (d.state !== DroneState.DEAD) {
        const dx = d.posX - origin.x;
        const dy = d.posY - origin.y;
        const dz = d.posZ - origin.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist < radius) {
           const factor = 1.0 - dist / radius;
           const splash = Math.floor(maxDamage * factor);
           d.hp -= splash;
           if (d.hp <= 0) {
              d.state = DroneState.DEAD;
              this.broadcastReliableEvent({ type: "drone_killed", id: d.id, zone: d.zone });
           }
        }
      }
    }
  }

  public broadcastReliableEvent(evt: any) {
    const json = JSON.stringify(evt);
    for (const p of this.players.values()) {
      p.channel.emit("reliable_event", JSON.parse(json));
    }
  }

  private handleMatchEnd(result: 'win' | 'loss'): void {
    this.matchActive = false;
    this.serverTick = 0;
    for (let i = 0; i < this.drones.length; i++) {
      this.drones[i].state = DroneState.DEAD;
    }
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      this.projActive[i] = 0;
    }

    const allStats: Record<string, any> = {};
    for (const [id, p] of this.players.entries()) {
      allStats[id] = p.stats;
      const finalScore = p.stats.scoreIndividual;
      this.processMatchEndTransaction(id, finalScore, p.adMultiplier || 1);
    }
    
    this.broadcastReliableEvent({ 
      type: 'MATCH_END', 
      result, 
      stats: allStats, 
      message: result === 'win' ? 'SYSTEM TERMINATED' : 'CONTRACT FAILED' 
    });
  }

  private processMatchEndTransaction(playerId: string, finalScore: number, adMultiplier: number) {
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
  }

  private packWorldNetworkData(): ArrayBuffer {
    this.payloadWriter.setUint32(0, this.serverTick, true);
    
    let activeCount = 0;
    for (let i = 0; i < this.drones.length; i++) {
      if (this.drones[i].state !== DroneState.DEAD) { activeCount++; }
    }
    this.payloadWriter.setUint16(4, activeCount, true);
    
    let camCount = 0;
    for (let i = 0; i < this.cameras.length; i++) {
      if (this.cameras[i].isActive) { camCount++; }
    }
    this.payloadWriter.setUint16(6, camCount, true);
    
    let byteOffset = HEADER_SIZE;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (d.state !== DroneState.DEAD) {
        this.payloadWriter.setUint16(byteOffset, d.id, true);
        this.payloadWriter.setFloat32(byteOffset + 2, d.posX, true);
        this.payloadWriter.setFloat32(byteOffset + 6, d.posY, true);
        this.payloadWriter.setFloat32(byteOffset + 10, d.posZ, true);
        this.payloadWriter.setFloat32(byteOffset + 14, d.rotX, true);
        this.payloadWriter.setFloat32(byteOffset + 18, d.rotY, true);
        this.payloadWriter.setFloat32(byteOffset + 22, d.rotZ, true);
        this.payloadWriter.setFloat32(byteOffset + 26, d.rotW, true);
        this.payloadWriter.setUint8(byteOffset + 30, d.state);
        this.payloadWriter.setUint8(byteOffset + 31, d.type);
        
        byteOffset += DRONE_STRUCT_SIZE;
        if (byteOffset >= CONST_BUFFER_SIZE) { break; }
      }
    }
    
    for (let i = 0; i < this.cameras.length; i++) {
      const c = this.cameras[i];
      if (c.isActive) {
        if (byteOffset + CAMERA_STRUCT_SIZE > CONST_BUFFER_SIZE) break;
        this.payloadWriter.setUint16(byteOffset, c.id, true);
        this.payloadWriter.setUint8(byteOffset + 2, 1);
        this.payloadWriter.setUint8(byteOffset + 3, 0);
        byteOffset += CAMERA_STRUCT_SIZE;
      }
    }
    
    return this.preallocatedBuffer;
  }

  public triggerStartMatch() {
    if (!this.matchActive) {
      this.matchActive = true;
      this.serverTick = 0;
      this.matchStartTime = Date.now();
      console.log(`[VEXEA SERVER] Match active! Triggered in Room: ${this.roomId}`);
      
      this.broadcastReliableEvent({ type: 'match_ready', mapId: this.mapId });
    }
  }

  public shutdown() {
    this.matchActive = false;
    if (this.physicsInterval) clearInterval(this.physicsInterval);
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.aiInterval) clearInterval(this.aiInterval);
    
    // Cleanup remaining players
    for (const p of this.players.values()) {
      if (p.body) this.rapierWorld.removeRigidBody(p.body);
    }
    this.players.clear();
    this.rapierWorld.free();
  }
}
