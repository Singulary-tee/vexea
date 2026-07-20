import * as THREE from "three";
import { MatchController, NetworkDroneState, DroneRingBuffer } from "../../MatchController";
import { 
  DroneState, 
  DroneType, 
  DRONE_CONFIGS,
  HEADER_SIZE, 
  DRONE_STRUCT_SIZE,
  DETAILED_WEAPONS 
} from "../../../shared/constants";
import { getAssetUrl } from "../../asset-cache";
import { setWeaponReloading, resetWeaponAnimations } from "../../weapons_model";

// --- BEGIN ZERO-GC OPTIMIZATIONS ---
const _droneMuzzlePos = new THREE.Vector3();
const _droneFireDir = new THREE.Vector3();
const _droneDeathPos = new THREE.Vector3();

class PositionalAudioPool {
  private pool: { audio: THREE.PositionalAudio | null; anchor: THREE.Mesh; active: boolean; timeoutId: any }[] = [];
  private max_size = 16;
  private geom = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  private mat = new THREE.MeshBasicMaterial({ visible: false });

  public play(scene: THREE.Scene, listener: THREE.AudioListener, buffer: any, mPos: THREE.Vector3, volume: number, playbackRate = 1.0) {
    let item = this.pool.find(i => !i.active);
    
    if (!item && this.pool.length < this.max_size) {
      const anchor = new THREE.Mesh(this.geom, this.mat);
      item = { audio: null, anchor, active: true, timeoutId: null };
      this.pool.push(item);
    } else if (!item) {
      // Recycle oldest active item
      item = this.pool.shift()!;
      if (item.timeoutId) clearTimeout(item.timeoutId);
      if (item.audio && item.audio.isPlaying) item.audio.stop();
      if (item.anchor.parent) scene.remove(item.anchor);
      item.active = true;
      this.pool.push(item);
    }

    if (item) {
      item.active = true;
      if (!item.audio) {
        item.audio = new THREE.PositionalAudio(listener);
        item.anchor.add(item.audio);
      }
      
      item.anchor.position.copy(mPos);
      if (!item.anchor.parent) {
        scene.add(item.anchor);
      }
      
      item.audio.setBuffer(buffer);
      item.audio.setDistanceModel('linear');
      item.audio.setRefDistance(5);
      item.audio.setMaxDistance(150);
      item.audio.setRolloffFactor(1.0);
      item.audio.setVolume(volume);
      item.audio.setPlaybackRate(playbackRate);
      
      if (item.audio.isPlaying) item.audio.stop();
      item.audio.play();

      const currentItem = item;
      if (item.timeoutId) clearTimeout(item.timeoutId);
      item.timeoutId = setTimeout(() => {
        currentItem.active = false;
        if (currentItem.anchor.parent) {
          scene.remove(currentItem.anchor);
        }
      }, 2000);
    }
  }
}

const droneAudioPool = new PositionalAudioPool();

interface BulletPathEntry {
  origin: THREE.Vector3;
  impact: THREE.Vector3;
  type: string;
  time: number;
}

const bulletPathEntryPool: BulletPathEntry[] = Array.from({ length: 40 }, () => ({
  origin: new THREE.Vector3(),
  impact: new THREE.Vector3(),
  type: "",
  time: 0
}));
let bulletPathEntryIndex = 0;

function getBulletPathEntry(ox: number, oy: number, oz: number, ix: number, iy: number, iz: number, type: string, time: number): BulletPathEntry {
  const entry = bulletPathEntryPool[bulletPathEntryIndex];
  entry.origin.set(ox, oy, oz);
  entry.impact.set(ix, iy, iz);
  entry.type = type;
  entry.time = time;
  bulletPathEntryIndex = (bulletPathEntryIndex + 1) % bulletPathEntryPool.length;
  return entry;
}
// --- END ZERO-GC OPTIMIZATIONS ---

export class NetworkSyncSystem {
  private match: MatchController;
  private lastTime = performance.now();

  private pingInterval: any = null;
  private listenersSetup = false;

  constructor(match: MatchController) {
    this.match = match;
    this.setupListeners();
    this.startPingInterval();
  }

  private startPingInterval() {
    this.pingInterval = setInterval(() => {
        this.sendPing();
    }, 2000);
  }

  public setupListeners() {
    if (this.listenersSetup) return;
    const channel = this.match.transport;
    if (!channel) return;

    channel.onRaw(this.handleRaw.bind(this));
    channel.on("handshake", this.handleHandshake.bind(this));
    channel.on("environmental_event", this.handleEnvironmentalEvent.bind(this));
    channel.on("reliable_event", this.handleReliableEvent.bind(this));
    channel.on("state_sync", this.handleStateSync.bind(this));
    channel.on("pong", this.handlePong.bind(this));

    this.listenersSetup = true;
  }

  private handleRaw(data: ArrayBuffer) {
    if (typeof (window as any).trackNetwork === "function")
      (window as any).trackNetwork("IN", data);
    
    const view = new DataView(data);
    
    // Player Position Correction (Reliable-ish via UDP)
    if (view.byteLength === 20) {
      const serverTick = view.getUint32(0, true);
      const lastSeq = view.getUint32(4, true);
      const px = view.getFloat32(8, true);
      const py = view.getFloat32(12, true);
      const pz = view.getFloat32(16, true);

      const idx = this.match.moveHistory.findIndex((h) => h.seq === lastSeq);
      if (idx !== -1) {
        const hist = this.match.moveHistory[idx];
        const dx = hist.x - px;
        const dy = hist.y - py;
        const dz = hist.z - pz;
        if (dx * dx + dy * dy + dz * dz > 0.25) {
          this.match.playerPos.set(px, py, pz);
          if (this.match.physicsWorker) {
            this.match.physicsWorker.postMessage({
              type: "CORRECT_POS",
              pos: { x: px, y: py, z: pz },
            });
          }
        }
        this.match.moveHistory.splice(0, idx + 1);
      }
      return;
    }

    // Drone Data
    const incomingTick = view.getUint32(0, true);
    if (incomingTick <= this.match.lastDroneTick) {
      return; // Drop out of order packet
    }
    this.match.lastDroneTick = incomingTick;
    this.match.currentTick = incomingTick;

    const serverTimeReceived = incomingTick * (1000 / 60);
    const now = performance.now();
    this.match.serverTimeDelta = serverTimeReceived - now;

    const count = view.getUint16(4, true);
    const camCount = view.getUint16(6, true);

    let byteOffset = HEADER_SIZE;

    for (let i = 0; i < count; i++) {
      const id = view.getUint16(byteOffset, true);
      const px = view.getFloat32(byteOffset + 2, true);
      const py = view.getFloat32(byteOffset + 6, true);
      const pz = view.getFloat32(byteOffset + 10, true);
      const rx = view.getFloat32(byteOffset + 14, true);
      const ry = view.getFloat32(byteOffset + 18, true);
      const rz = view.getFloat32(byteOffset + 22, true);
      const rw = view.getFloat32(byteOffset + 26, true);
      const state = view.getUint8(byteOffset + 30);
      const type = view.getUint8(byteOffset + 31);

      if (!this.match.droneJitterMap.has(id)) {
        this.match.droneJitterMap.set(id, new DroneRingBuffer());
      }
      const jitterBuffer = this.match.droneJitterMap.get(id);
      if (jitterBuffer) {
        jitterBuffer.push(serverTimeReceived, px, py, pz, rx, ry, rz, rw, state, type);
      }
      byteOffset += DRONE_STRUCT_SIZE;
    }

    this.match.syncCameras = [];
    for (let c = 0; c < camCount; c++) {
      const camId = view.getUint16(byteOffset, true);
      const isActive = view.getUint8(byteOffset + 2) === 1;
      this.match.syncCameras.push({ id: camId, isActive });
      byteOffset += 4;
    }
    (window as any).syncCameras = this.match.syncCameras;
  }

  private handleHandshake(json: any) {
    this.match.localPlayerId = json.id;
    (window as any).lastLocalPlayerId = json.id; // Persist for reconnection survival
    if (json.position) {
      this.match.playerPos.set(json.position.x, json.position.y, json.position.z);
      if (this.match.physicsWorker) {
        this.match.physicsWorker.postMessage({
          type: "CORRECT_POS",
          pos: { x: json.position.x, y: json.position.y, z: json.position.z },
        });
      }
      
      // Calculate look direction towards the center of the map (384, 0, 384)
      const dx = 384 - json.position.x;
      const dz = 384 - json.position.z;
      // In Three.js, default looking direction is along negative Z (yaw = 0)
      // So to look at (dx, dz), we compute Math.atan2(dx, -dz)
      const initialYaw = Math.atan2(dx, -dz);
      this.match.playerYaw = initialYaw;
      this.match.playerPitch = 0; // look level horizontally
    }
  }

  private handleEnvironmentalEvent(msg: any) {
    if (msg.color) {
      if (this.match.scene.background instanceof THREE.Color)
        this.match.scene.background.set(msg.color);
      if (this.match.scene.fog instanceof THREE.FogExp2) 
        this.match.scene.fog.color.set(msg.color);
    }
  }

  private handleReliableEvent(msg: any) {
    const match = this.match;
    const scene = match.scene;

    if (msg.type === "dev_llm_feed") {
      if (typeof (window as any).receivedLLMFeed === "function") {
        (window as any).receivedLLMFeed(msg);
      }
    }

    if (msg.type === "dev_server_tick_ms") {
      (window as any).devServerTickMs = msg.tickMs;
    }

    if (msg.type === "dev_server_memory_mb") {
      (window as any).devServerMemory = msg;
    }

    if (msg.type === "dev_test_entity_telemetry") {
      (window as any).testEntityTelemetryData = msg.data;
    }

    if (msg.type === "dev_physics_settings_sync") {
      if (typeof (window as any).syncPhysicsSettings === "function") {
        (window as any).syncPhysicsSettings(msg.gravityY, msg.speedMultiplier, msg.paused);
      }
    }

    if (msg.type === "PLAYER_LEFT") {
      const id = msg.playerId;
      if (match.remotePlayersMeshes.has(id)) {
        const mesh = match.remotePlayersMeshes.get(id)!;
        scene.remove(mesh);
        match.remotePlayersMeshes.delete(id);
      }
      match.remotePlayerMixers.delete(id);
      match.remotePlayersTargetData.delete(id);
    }

    if (msg.type === "HIT_CONFIRMED" || msg.type === "HIT_ENVIRONMENT") {
      if (msg.originX !== undefined && msg.impactX !== undefined) {
        const entry = getBulletPathEntry(msg.originX, msg.originY, msg.originZ, msg.impactX, msg.impactY, msg.impactZ, msg.type, performance.now());
        
        // Ensure the path is not duplicated in the tracking array
        const idx = this.match.serverBulletPaths.indexOf(entry);
        if (idx !== -1) {
          this.match.serverBulletPaths.splice(idx, 1);
        }
        
        this.match.serverBulletPaths.push(entry);
        if (this.match.serverBulletPaths.length > 20) this.match.serverBulletPaths.shift();
      }
    }
    if (msg.type === "HIT_CONFIRMED") {
      if ((window as any).audioManager && (window as any).audioManager.play) {
        (window as any).audioManager.play("hit_confirmed");
      }

      const ch = document.getElementById("center-crosshair");
      if (ch) {
        const kills = msg.droneHp <= 0;
        ch.style.background = kills ? "rgba(255, 180, 0, 0.8)" : "rgba(255, 255, 255, 0.8)";
        ch.style.width = kills ? "20px" : "15px";
        ch.style.height = kills ? "20px" : "15px";
        ch.style.borderRadius = "50%";
        setTimeout(() => {
          ch.style.background = "transparent";
          ch.style.width = "0px";
          ch.style.height = "0px";
        }, kills ? 300 : 150);
      }

      if (typeof (window as any).spawnImpactSparks === "function") {
          (window as any).spawnImpactSparks(msg.impactX, msg.impactY, msg.impactZ, 10);
      }
    }

    if (msg.type === "drone_shoot") {
      if (this.match.drones) {
        this.match.drones.onDroneShoot(msg.droneId, msg.droneType);
      }
      _droneMuzzlePos.set(msg.posX, msg.posY, msg.posZ);
      const type = msg.droneType;

      const config = DRONE_CONFIGS[type as DroneType];
      let playbackRate = (config?.firingSoundPitch ?? 1.0) * (0.95 + Math.random() * 0.1); // Add small random pitch variation
      let scaleFactor = config?.muzzleFlashScale ?? 1.0;

      _droneFireDir.set(msg.dirX, msg.dirY, msg.dirZ).normalize();
      if (typeof (window as any).spawnTracer === "function") (window as any).spawnTracer(_droneMuzzlePos, _droneFireDir);
      if (typeof (window as any).triggerFlash === "function") (window as any).triggerFlash(_droneMuzzlePos, scaleFactor);

      // Reusable Positional Audio to avoid dynamic allocation GC overhead during intense combat
      const camera = (window as any).camera;
      const shotBuffer = (window as any).shotBuffer;
      const audioListener = (window as any).audioListener;
      if (camera && camera.position.distanceToSquared(_droneMuzzlePos) < 22500 && shotBuffer && audioListener) {
         const s = (window as any).vexeaSettings;
         const volume = s ? s.sfxVolume : 1.0;
         droneAudioPool.play(scene, audioListener, shotBuffer, _droneMuzzlePos, volume, playbackRate);
      }
    }

    if (msg.type === "DRONE_DEATH") {
      if ((window as any).audioManager && (window as any).audioManager.play) {
        (window as any).audioManager.play("drone_death");
      }
      if (msg.posX !== undefined && msg.posY !== undefined && msg.posZ !== undefined) {
        _droneDeathPos.set(msg.posX, msg.posY, msg.posZ);
        if (typeof (window as any).spawnImpactSparks === "function") {
          (window as any).spawnImpactSparks(msg.posX, msg.posY, msg.posZ, 40); // 40 large sparks
        }
        if (typeof (window as any).triggerExplosion === "function") {
          (window as any).triggerExplosion(_droneDeathPos);
        } else if (typeof (window as any).triggerFlash === "function") {
          (window as any).triggerFlash(_droneDeathPos);
        }
      }
      match.droneJitterMap.delete(msg.droneId);
    }

    if (msg.type === "AMMO_STATE") {
      if (msg.primary) {
        match.ammo1 = msg.primary.currentMag;
        match.maxAmmo1 = msg.primary.maxMag ?? 40;
        match.isReloading = msg.primary.isReloading || (msg.secondary ? msg.secondary.isReloading : false);
        setWeaponReloading(match.isReloading);
      }
      if (msg.secondary) {
        match.ammo2 = msg.secondary.currentMag;
        match.maxAmmo2 = msg.secondary.maxMag ?? 35;
      }
      if (match.hud) match.hud.updateAmmo(msg.primary, msg.secondary);
    }

    if (msg.type === "YOU_DIED") {
      match.isLocalPlayerDead = true;
      resetWeaponAnimations();
      if (match.hud) match.hud.showDeathOverlay(true, msg.respawnTimer);
      if (typeof (window as any).stopAllInputs === "function") (window as any).stopAllInputs();
    }

    if (msg.type === "RESPAWN_COUNTDOWN") {
      if (match.hud) match.hud.updateRespawnCountdown(msg.remaining);
    }

    if (msg.type === "YOU_RESPAWNED" || msg.type === "RESPAWN") {
      match.isLocalPlayerDead = false;
      resetWeaponAnimations();
      if (match.hud) {
        match.hud.showDeathOverlay(false);
      }
      match.playerHP = msg.hp || 100;
      match.playerPos.set(msg.position.x, msg.position.y, msg.position.z);
      if (match.physicsWorker) {
        match.physicsWorker.postMessage({
          type: "CORRECT_POS",
          pos: { x: msg.position.x, y: msg.position.y, z: msg.position.z },
        });
      }
      
      // Calculate look direction towards the center of the map (384, 0, 384) to avoid spawning looking in the wrong direction
      const dx = 384 - msg.position.x;
      const dz = 384 - msg.position.z;
      // In Three.js, default looking direction is along negative Z (yaw = 0)
      // So to look at (dx, dz), we compute Math.atan2(dx, -dz)
      const initialYaw = Math.atan2(dx, -dz);
      match.playerYaw = initialYaw;
      match.playerPitch = 0; // look level horizontally

      if (match.hud) match.hud.updateHUD();
    }

    if (msg.type === "GATE_DAMAGE" || msg.type === "PLAYER_HIT") {
      if (msg.hp !== undefined) match.playerHP = msg.hp;
      if (msg.currentHp !== undefined) match.playerHP = msg.currentHp;
      if (match.hud) {
        match.hud.triggerUIFlash("255, 0, 0", 0.5);
        match.hud.updateHUD();
      }
    }

    if (msg.type === "MATCH_END") {
      if (typeof (window as any).removeMatchTab === "function") (window as any).removeMatchTab();
      // Additional match end logic handled by main.ts or MatchController
    }
  }

  private handleStateSync(json: any) {
    const match = this.match;
    
    // Sync other players
    for (const p of json.players) {
      if (p.id !== match.localPlayerId) {
        if (!match.remotePlayersTargetData.has(p.id)) {
          match.remotePlayersTargetData.set(p.id, {
            pos: new THREE.Vector3(p.posX, p.posY, p.posZ),
            yaw: p.yaw,
            pitch: 0,
            hp: p.hp,
            isAlive: p.isAlive,
            isFiring: p.isFiring,
            isReloading: p.isReloading,
            weapon: p.currentWeapon
          });
        } else {
          const data = match.remotePlayersTargetData.get(p.id)!;
          data.pos.set(p.posX, p.posY, p.posZ);
          data.yaw = p.yaw;
          data.hp = p.hp;
          data.isAlive = p.isAlive;
          data.isFiring = p.isFiring;
          data.isReloading = p.isReloading;
          data.weapon = p.currentWeapon;
        }
      }
    }

    // Sync local player stats from server authoritative state
    const clientMatchMe = json.players.find((p: any) => p.id === match.localPlayerId);
    if (clientMatchMe) {
      match.playerHP = clientMatchMe.hp;
      match.playerScore = clientMatchMe.score;
      (window as any).serverPlayerCollisions = clientMatchMe.activeCollisions || [];
      if (match.hud) match.hud.updateHUD();
    }

    // Timer update
    if (match.hud) match.hud.updateTimer(json.tick);

    // Authoritative Server Debug Cube sync
    if (json.devDrones) {
      for (const dd of json.devDrones) {
        if (this.match.droneJitterMap.has(dd.id)) {
          const buffer = this.match.droneJitterMap.get(dd.id)!;
          if (buffer.count > 0) {
            const head = buffer.getLatest();
            (head as any).groupId = dd.groupId;
            (head as any).targetX = dd.targetX;
            (head as any).targetY = dd.targetY;
            (head as any).targetZ = dd.targetZ;
            (head as any).mode = dd.mode;
            (head as any).memory = dd.memory;
          }
        }
      }
    }

    if (json.serverCube) {
      (window as any).serverCubeTelemetry = json.serverCube;
      if (typeof (window as any).updateServerCubeMesh === "function") {
        (window as any).updateServerCubeMesh(json.serverCube);
      }
    }

    if (json.liveZoneSummary) {
      (window as any).liveZoneSummary = json.liveZoneSummary;
    } else {
      (window as any).serverCubeTelemetry = null;
      if (typeof (window as any).removeServerCubeMesh === "function") {
        (window as any).removeServerCubeMesh();
      }
    }
  }

  private handlePong() {
    const match = this.match;
    match.latency = Math.round(performance.now() - match.lastPingTime);
    (window as any).latency = match.latency;
    if (match.transport) {
      match.transport.emit("latency_report", { latency: match.latency });
    }
  }

  public sendPing() {
    if (this.match.transport) {
      this.match.lastPingTime = performance.now();
      this.match.transport.emit("ping", {});
    }
  }

  public dispose() {
    if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
    }
  }
}
