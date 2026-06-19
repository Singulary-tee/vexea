/**
 * VEXEA Authoritative Full-Stack Game Server (Room-Scoping Refactor)
 * Coordinates and scales matchmaking sessions to allow 100+ parallel, real-time authoritative matches.
 * Enforces Zero-GC, authoritative validation, and server-side LLM loop per room.
 */

import dotenv from "dotenv";
import express from "express";
import http from "http";
import path from "path";
import RAPIER from "@dimforge/rapier3d-compat";
import { createServer as createViteServer } from "vite";

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { createTransport, ChannelAdapter } from "./transport/adapter";
import { matchManager } from "./MatchManager";
import { 
  ZONES, 
  DroneType, 
  DroneState, 
  WEAPONS, 
  DRONE_CONFIGS, 
  MAX_DRONES
} from "../shared/constants";
import { DETAILED_WEAPONS, calculateDamageWithFalloff } from "../shared/weapons";

export const HISTORICAL_SAMPLES_MAX = 120;
export const HISTORIC_BLOCK_SIZE = 2 + MAX_DRONES * 4;

dotenv.config();

export const globalChannels: any[] = [];
export const globalServerLogs: string[] = [];
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

// Initialize Firebase Admin SDK
let serviceAccount: any = null;
try {
  const envSecret = process.env["vexea-e0a37-firebase-adminsdk-fbsvc-2e76859592.json"];
  if (envSecret) {
    serviceAccount = JSON.parse(envSecret);
  }
} catch (e) {
  console.warn("VEXEA Server Notice: Could not parse service account from environment:", e);
}

if (serviceAccount) {
  try {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert(serviceAccount)
      });
      console.log("VEXEA Authoritative Database Server: Firebase initialized with administrative credentials.");
    }
  } catch (err: any) {
    console.error("VEXEA Authoritative Database Server: Admin initialization failed, falling back:", err);
    if (getApps().length === 0) initializeApp();
  }
} else {
  try {
    if (getApps().length === 0) {
      initializeApp();
      console.log("VEXEA Authoritative Database Server: Firebase initialized with default environment profile.");
    }
  } catch (err) {}
}

let _dbInstance: any = null;
function getDbInstance() {
  if (!_dbInstance) {
    try {
      _dbInstance = getFirestore();
    } catch (e: any) {
      console.warn("VEXEA Database Notice: Failed to retrieve Firestore instance.", e.message || e);
      _dbInstance = new Proxy({}, {
        get(target, prop) {
          if (prop === "collection") {
            return () => ({
              doc: () => ({ set: async () => {}, update: async () => {}, delete: async () => {} }),
              where: () => ({ get: async () => ({ size: 0, forEach: () => {} }) }),
              get: async () => ({ size: 0, forEach: () => {} })
            });
          }
          if (prop === "doc") {
            return () => ({
              set: async () => {},
              update: async () => {},
              delete: async () => {}
            });
          }
          if (prop === "runTransaction") {
            return async (fn: any) => {
              const tx = {
                get: async () => ({ exists: false, data: () => null }),
                set: () => tx,
                update: () => tx,
                delete: () => tx
              };
              return fn(tx);
            };
          }
          return () => {
            console.warn(`[Database Proxy] Operation ${String(prop)} skipped - database connection inactive.`);
            return {
              doc: () => ({ set: async () => {}, update: async () => {}, delete: async () => {} }),
              collection: () => ({ doc: () => ({ set: async () => {}, update: async () => {}, delete: async () => {} }) }),
              where: () => ({ get: async () => ({ size: 0, forEach: () => {} }) }),
              get: async () => ({ size: 0, forEach: () => {} }),
              set: async () => {},
              update: async () => {},
              delete: async () => {}
            };
          };
        }
      });
    }
  }
  return _dbInstance;
}

export const db: any = new Proxy({}, {
  get(target, prop) {
    const inst = getDbInstance();
    const val = inst[prop];
    if (typeof val === "function") {
      return val.bind(inst);
    }
    return val;
  }
}) as any;

// Mimic firebase client interfaces for Firestore admin helpers
export function doc(database: any, collectionName: string, docId?: string) {
  if (docId) {
    return db.collection(collectionName).doc(docId);
  }
  return db.doc(collectionName);
}

export function collection(database: any, collectionName: string) {
  return db.collection(collectionName);
}

export function query(collRef: any, ...constraints: any[]) {
  let q = collRef;
  for (const c of constraints) {
    if (c && typeof c === "function") {
      q = c(q);
    }
  }
  return q;
}

export function where(fieldPath: string, opStr: any, value: any) {
  return (q: any) => q.where(fieldPath, opStr, value);
}

export async function getDocs(q: any) {
  const response = await q.get();
  return response;
}

export function processFirebaseDataForAdmin(data: any): any {
  if (data === null || typeof data !== "object") return data;
  if (data.__isIncrement) {
    return FieldValue.increment(data.value);
  }
  const copy = Array.isArray(data) ? [] : {};
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val && typeof val === "object" && val.__isIncrement) {
      (copy as any)[key] = FieldValue.increment(val.value);
    } else if (val && typeof val === "object") {
      (copy as any)[key] = processFirebaseDataForAdmin(val);
    } else {
      (copy as any)[key] = val;
    }
  }
  return copy;
}

export async function setDoc(docRef: any, data: any) {
  const cleanData = processFirebaseDataForAdmin(data);
  return docRef.set(cleanData);
}

export async function deleteDoc(docRef: any) {
  return docRef.delete();
}

export async function updateDoc(docRef: any, data: any) {
  const cleanData = processFirebaseDataForAdmin(data);
  return docRef.update(cleanData);
}

export function increment(n: number) {
  return { __isIncrement: true, value: n };
}

export async function runTransaction(database: any, updateFunction: (transaction: any) => Promise<any>) {
  return db.runTransaction(async (adminTx) => {
    const wrappedTx = {
      get: async (docRef: any) => {
        const snap = (await adminTx.get(docRef)) as any;
        return {
          exists: () => snap.exists,
          data: () => snap.data(),
          ref: snap.ref
        };
      },
      set: (docRef: any, data: any) => {
        const cleanData = processFirebaseDataForAdmin(data);
        adminTx.set(docRef, cleanData);
        return wrappedTx;
      },
      update: (docRef: any, data: any) => {
        const cleanData = processFirebaseDataForAdmin(data);
        adminTx.update(docRef, cleanData);
        return wrappedTx;
      },
      delete: (docRef: any) => {
        adminTx.delete(docRef);
        return wrappedTx;
      }
    };
    return updateFunction(wrappedTx);
  });
}

// Garbage Collector for MatchInProgress sessions
setInterval(async () => {
  try {
    const q = query(collection(db, "MatchInProgress"), where("startTime", "<", Date.now() - 2 * 60 * 60 * 1000));
    const snapshot = await getDocs(q);
    snapshot.forEach(async (docSnap) => {
      const data = docSnap.data();
      if (data.playerId) {
        try {
           const userRef = doc(db, "Users", data.playerId);
           await updateDoc(userRef, { score: increment(-50) });
        } catch(e) {}
      }
      await deleteDoc(docSnap.ref);
    });
  } catch (e) {}
}, 30 * 60 * 1000);

// Create Express and HTTP Server
const app = express();
const server = http.createServer(app);
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
});

// Configure general global CORS middleware for decoupled client-server hosting environments
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Origin, Accept");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const io = createTransport();
io.listen(PORT, server);

app.use(express.json());

app.get("/api/proxy-asset", async (req, res) => {
  const fileUrl = req.query.url as string;
  if (!fileUrl) {
    return res.status(400).send("URL parameter is required");
  }

  try {
    const fetchResponse = await fetch(fileUrl);
    if (!fetchResponse.ok) {
      return res.status(fetchResponse.status).send(`Failed to fetch from remote: ${fetchResponse.statusText}`);
    }

    const contentType = fetchResponse.headers.get("Content-Type") || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    const contentLength = fetchResponse.headers.get("Content-Length");
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const arrayBuffer = await fetchResponse.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error: any) {
    console.error(`[Proxy] Error fetching from remote URL ${fileUrl}:`, error);
    res.status(500).send(`Proxy Error: ${error.message || error}`);
  }
});

app.get("/api/debug", (req, res) => {
  const roomsData = matchManager.getRooms().map(r => ({
    roomId: r.roomId,
    active: r.matchActive,
    playerCount: r.players.size,
    players: Array.from(r.players.keys()),
    droneCount: r.drones.filter(d => d.state !== DroneState.DEAD).length
  }));
  res.json({ rooms: roomsData, logs: globalServerLogs });
});

io.onConnection((channel: ChannelAdapter) => {
  globalChannels.push(channel);
  const playerId = `PL_${Math.floor(Math.random() * 100000)}`;

  // Default connection starts in the dedicated lobby pool room
  let currentRoom = matchManager.getOrCreateRoom("lobby", process.env.GEMINI_API_KEY);
  let pState = currentRoom.registerPlayer(playerId, channel, null);

  // Store MatchInProgress initially so it counts as pending
  setDoc(doc(db, "MatchInProgress", playerId), {
    playerId,
    startTime: Date.now()
  }).catch((e) => {});

  // When the client signals playing match
  channel.on("start_match", (args: any) => {
     const reqUid = args?.uid || playerId;
     const matchId = args?.matchId || `M_AUTO_${Math.floor(Math.random() * 100000)}`;
     const reqMap = args?.mapId || 'map_0_dev';

     console.log(`[VEXEA SERVER] Moving player ${pState.id} from ${currentRoom.roomId} -> MatchRoom: ${matchId} (Map: ${reqMap})`);
     
     // Unregister from current room
     currentRoom.removePlayer(pState.id);

     // Get or create targeted MatchRoom
     const targetRoom = matchManager.getOrCreateRoom(matchId, process.env.GEMINI_API_KEY, reqMap);
     
     // Complete room transfer registration
     pState = targetRoom.registerPlayer(reqUid, channel, null);
     targetRoom.triggerStartMatch();

     // Re-associate binding pointer
     currentRoom = targetRoom;
  });

  channel.on("rewarded_ad", () => {
    if (pState) pState.adMultiplier = 2;
  });

  channel.onRaw((message: any) => {
    if (!pState) return;
    const buffer = message as ArrayBuffer;
    if (buffer.byteLength >= 20) {
      const dataView = new DataView(buffer);
      const seq = dataView.getUint32(0, true);
      const inputMask = dataView.getUint8(4);
      const pitch = dataView.getFloat32(5, true);
      const yaw = dataView.getFloat32(9, true);
      
      if (seq > pState.lastSequence) {
        pState.lastSequence = seq;
        pState.pitch = pitch;
        pState.yaw = yaw;
        pState.inputMask = inputMask;
      }
    }
  });

  channel.on("dev_spawn_drone", (args: any) => {
    const type = typeof args.type === "number" ? args.type : Number(args.type);
    currentRoom.registerDeveloperSpawner(type);
  });

  channel.on("dev_clear_drones", () => {
    for (let i = 0; i < currentRoom.drones.length; i++) {
        currentRoom.drones[i].state = DroneState.DEAD;
    }
  });

  channel.on("dev_set_class", (args: any) => {
    if (args.playerClass && pState) {
        pState.weapon = 'rifle';
        pState.hp = 100;
    }
  });

  channel.on("reliable_event", (args: any) => {
    if (!pState || !pState.isAlive) return;
    
    if (args.type === "TOGGLE_FIRE_MODE") {
        const primary = pState.weaponState.primary;
        primary.fireMode = primary.fireMode === 'auto' ? 'burst' : 'auto';
        pState.channel.emit("reliable_event", { type: 'FIRE_MODE_CHANGED', mode: primary.fireMode });
    }
    
    if (args.type === "RELOAD") {
        const primary = pState.weaponState.primary;
        const secondary = pState.weaponState.secondary;
        if (!primary.isReloading && primary.currentMag < WEAPONS.rifle.capacity && primary.reserve > 0) {
            primary.isReloading = true;
            primary.reloadTimer = 150;
        }
        if (!secondary.isReloading && secondary.currentMag < WEAPONS.pistol.capacity && secondary.reserve > 0) {
            secondary.isReloading = true;
            secondary.reloadTimer = 120;
        }
        pState.channel.emit("reliable_event", { type: 'AMMO_STATE', primary, secondary });
    }

    if (args.type === "FIRE") {
        const slot = args.weaponSlot as 'primary' | 'secondary';
        const isPrimary = slot === 'primary';
        const weaponStats = isPrimary ? WEAPONS.rifle : WEAPONS.pistol;
        const wState = pState.weaponState[slot];

        if (wState.currentMag <= 0) {
           if (!wState.isReloading && wState.reserve > 0) {
               wState.isReloading = true;
               wState.reloadTimer = isPrimary ? 150 : 120;
               pState.channel.emit("reliable_event", { type: 'AMMO_STATE', primary: pState.weaponState.primary, secondary: pState.weaponState.secondary });
           }
           return;
        }
        if (wState.isReloading) return;

        const now = Date.now();
        const allowedInterval = 1000 / weaponStats.fireRateHz;
        
        let leakyUpdate = Math.max(0, wState.leakyBucket - ((now - wState.lastConfirmedShotT) / allowedInterval));
        
        if (leakyUpdate < weaponStats.capacity) {
            wState.leakyBucket = leakyUpdate + 1;
            wState.lastConfirmedShotT = now;
            wState.currentMag--;

            if (wState.currentMag === 0 && wState.reserve > 0) {
               wState.isReloading = true;
               wState.reloadTimer = isPrimary ? 150 : 120;
            }

            pState.channel.emit("reliable_event", { type: 'AMMO_STATE', primary: pState.weaponState.primary, secondary: pState.weaponState.secondary });

            const dirX = args.direction.x;
            const dirY = args.direction.y;
            const dirZ = args.direction.z;
            const timestamp = args.timestamp;
            
            const expectedT = Date.now() - pState.ping;
            let targetTick = currentRoom.serverTick;
            if (Math.abs(timestamp - expectedT) <= 50) {
                const rewindMs = Math.min(200, Date.now() - timestamp);
                targetTick = currentRoom.serverTick - Math.floor(rewindMs / 16.66);
            }

            let distSqMin = 99999;
            let bestHitDrone: any = null;
            
            for (let i = 0; i < HISTORICAL_SAMPLES_MAX; i++) {
                const baseIdx = i * HISTORIC_BLOCK_SIZE;
                const recTick = currentRoom.historicalAABBHistory[baseIdx];
                if (recTick > 0 && Math.abs(recTick - targetTick) <= 1) {
                    const numDrones = currentRoom.historicalAABBHistory[baseIdx + 1];
                    for (let dIdx = 0; dIdx < numDrones; dIdx++) {
                        const offset = baseIdx + 2 + dIdx * 4;
                        const dId = currentRoom.historicalAABBHistory[offset];
                        const cx = currentRoom.historicalAABBHistory[offset + 1];
                        const cy = currentRoom.historicalAABBHistory[offset + 2];
                        const cz = currentRoom.historicalAABBHistory[offset + 3];

                        const tox = cx - args.origin.x;
                        const toy = cy - args.origin.y;
                        const toz = cz - args.origin.z;
                        
                        const t = tox * dirX + toy * dirY + toz * dirZ;
                        if (t > 0) { 
                            const px = args.origin.x + dirX * t;
                            const py = args.origin.y + dirY * t;
                            const pz = args.origin.z + dirZ * t;
                            
                            const hitDrone = currentRoom.drones.find(d => d.id === dId);
                            if (!hitDrone || hitDrone.state === DroneState.DEAD) continue;
                            
                            let w=1, h=1, l=1;
                            switch(hitDrone.type) {
                                case DroneType.ROTARY_SHOOTER: w=0.6; h=0.6; l=0.6; break;
                                case DroneType.BOMBER: w=0.5; h=0.5; l=0.5; break;
                                case DroneType.RECON: w=0.4; h=0.4; l=0.4; break;
                                case DroneType.FIXED_WING: w=1.2; h=0.4; l=0.4; break;
                                case DroneType.WHEELED: w=0.8; h=0.5; l=0.6; break;
                                case DroneType.ROBOT_DOG: w=0.7; h=0.6; l=0.7; break;
                                case DroneType.HUMANOID: w=0.5; h=1.8; l=0.5; break;
                            }
                            
                            if (Math.abs(px - cx) <= w/2 && Math.abs(py - cy) <= h/2 && Math.abs(pz - cz) <= l/2) {
                                if (t < distSqMin) {
                                  distSqMin = t;
                                  bestHitDrone = hitDrone;
                                }
                            }
                        }
                    }
                    break;
                }
            }

            if (bestHitDrone) {
                const weaponPerf = isPrimary ? DETAILED_WEAPONS.rifle : DETAILED_WEAPONS.pistol;
                const distance = distSqMin; // t represents the raw coordinate distance offset along the hit ray
                const rawDamage = calculateDamageWithFalloff(weaponPerf.damage, distance, weaponPerf.falloff);
                const appliedDamage = Math.round(rawDamage * 10) / 10; // clamp to 1 decimal point to avoid floating precision bugs

                bestHitDrone.hp -= appliedDamage;
                pState.stats.damageDealt += appliedDamage;
                bestHitDrone.damageLog.push({ playerId: pState.id, timestamp: now });

                if (bestHitDrone.hp <= 0) {
                    bestHitDrone.state = DroneState.DEAD;
                    pState.stats.droneEliminations++;
                    pState.stats.scoreIndividual += 100;
                    pState.score += 100;
                    
                    const assistThreshold = now - 5000;
                    const assistants = new Set<string>();
                    for (const rec of bestHitDrone.damageLog) {
                       if (rec.playerId !== pState.id && rec.timestamp > assistThreshold) {
                           assistants.add(rec.playerId);
                       }
                    }
                    for (const aId of assistants) {
                        const aPlayer = currentRoom.players.get(aId);
                        if (aPlayer) {
                            aPlayer.stats.assists++;
                            aPlayer.stats.scoreIndividual += 50;
                            aPlayer.score += 50;
                        }
                    }
                    bestHitDrone.damageLog = [];
                    
                    if (bestHitDrone.path && bestHitDrone.path.length > 0 && bestHitDrone.pathIndex < bestHitDrone.path.length) {
                        currentRoom.failedOperations.push(JSON.stringify({ attempted: 'active_operation', reason: 'unit_destroyed', droneType: bestHitDrone.type }));
                    }

                    const impactX = args.origin.x + dirX * distSqMin;
                    const impactY = args.origin.y + dirY * distSqMin;
                    const impactZ = args.origin.z + dirZ * distSqMin;

                    pState.channel.emit("reliable_event", { type: 'HIT_CONFIRMED', droneId: bestHitDrone.id, droneHp: 0, impactX, impactY, impactZ });
                    currentRoom.broadcastReliableEvent({ type: "DRONE_DEATH", droneId: bestHitDrone.id, zone: bestHitDrone.zone });
                } else {
                    const impactX = args.origin.x + dirX * distSqMin;
                    const impactY = args.origin.y + dirY * distSqMin;
                    const impactZ = args.origin.z + dirZ * distSqMin;

                    pState.channel.emit("reliable_event", { type: 'HIT_CONFIRMED', droneId: bestHitDrone.id, droneHp: bestHitDrone.hp, impactX, impactY, impactZ });
                    currentRoom.broadcastReliableEvent({ type: "DRONE_HIT", droneId: bestHitDrone.id, zone: bestHitDrone.zone });
                }
            } else {
                let impactX: number;
                let impactY: number;
                let impactZ: number;
                
                if (currentRoom.rapierWorld) {
                    const ray = new RAPIER.Ray({ x: args.origin.x, y: args.origin.y, z: args.origin.z }, { x: dirX, y: dirY, z: dirZ });
                    const hit = currentRoom.rapierWorld.castRay(ray, 80, false, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
                    if (hit) {
                        impactX = args.origin.x + args.direction.x * hit.timeOfImpact;
                        impactY = args.origin.y + args.direction.y * hit.timeOfImpact;
                        impactZ = args.origin.z + args.direction.z * hit.timeOfImpact;
                    } else {
                        impactX = args.origin.x + args.direction.x * 80;
                        impactY = args.origin.y + args.direction.y * 80;
                        impactZ = args.origin.z + args.direction.z * 80;
                    }
                } else {
                    impactX = args.origin.x + args.direction.x * 80;
                    impactY = args.origin.y + args.direction.y * 80;
                    impactZ = args.origin.z + args.direction.z * 80;
                }
                
                if (typeof impactX === 'number' && !isNaN(impactX) &&
                    typeof impactY === 'number' && !isNaN(impactY) &&
                    typeof impactZ === 'number' && !isNaN(impactZ)) {
                    pState.channel.emit('reliable_event', { type: 'HIT_ENVIRONMENT', impactX, impactY, impactZ });
                }
            }
        }
    }
  });

  channel.on("PLAYER_QUIT", () => {
    if (pState) {
      console.log(`Player quit mission manually: ${pState.id}`);
      currentRoom.removePlayer(pState.id);
    }
    try {
        channel.emit("disconnect", {});
    } catch(e) {}
  });

  channel.onDisconnect(() => {
    if (pState) {
      console.log(`Disconnection registered: ${pState.id}`);
      currentRoom.removePlayer(pState.id);
    }
    const idx = globalChannels.indexOf(channel);
    if (idx !== -1) globalChannels.splice(idx, 1);
  });
});

const serveApp = async () => {
  // Setup Rapier globally once before room allocation
  await RAPIER.init();

  app.use('/shared', express.static(path.join(process.cwd(), 'shared')));

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
    console.log(`[VEXEA SERVER CORE] Authoritative Room-Scoping engine listening on Port ${PORT}`);
  });
};

serveApp();
