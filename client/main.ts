(window as any).__MAIN_TS_LOADED__ = true;
// Diagnostics evaluated

/**
 * VEXEA Authoritative Real-Time Clients Engine

 * Vanilla TypeScript client utilizing Three.js PBR, 3D Spatial Audio, and Jitter Buffers.
 * Rejects React overlays, ensuring strict Zero-GC 60fps thermal loops on Mobile.
 */

import "./index.css";
import "./dev_menu";
import { initSplash } from "./screens/splash";
import { initMainMenu } from "./screens/main-menu";
import { initLobby } from "./screens/lobby";
import { initMapViewerGlobally } from "./screens/map_viewer";
import * as screenManager from "./screens/screen-manager";
import { audioManager } from "./audio";
import { MapLoader } from "./src/map/MapLoader";
import { getMapById } from "../shared/maps/map-registry";
import { HUD_HTML } from "./hud_template";
import { 
  initMatchVisuals, 
  spawnTracer, 
  triggerFlash, 
  clearAllVisuals, 
  spawnImpactSparks, 
  spawnEnvironmentDecalAndDust, 
  updateVFX, 
  getVFXInitialized, 
  getCurrentVisualConfig,
  spawnBarrelSmoke,
  sparkActive,
  sparkBatch,
  sparksPerHitCount,
  decalBatch,
  decalSlots,
  dustBatch
} from "./visuals";

import * as THREE from "three/webgpu";
import { WebGLRenderer } from "three";
import { color, float, texture as tslTexture, time, oscSine, fog, rangeFogFactor, densityFogFactor, exponentialHeightFogFactor, max, uv, vec2, vec4, length as tslLength, smoothstep, mix } from "three/tsl";
import { setupAreaCorridors } from "./stage";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import {
  initPlayerWeapons,
  updateWeaponsContainer,
  applyWeaponRecoil,
  switchActiveWeaponModel,
  isSwitchingWeapon,
  getMuzzleWorldPosition
} from "./weapons_model";
import { getSettings, applySettings, openSettings, injectMatchTab, removeMatchTab } from "./settings";
import {
  initFirebase,
  testStorageUpload,
  authenticateAnonymously,
  fetchPlayerStats,
  savePlayerStats,
  lockMatchSession,
  unlockMatchSession,
  isFirebaseReady
} from "./firebase";
import { initUIEditor } from "./ui_editor";
import {
  ZONES,
  TOPOLOGY,
  ZONE_BOUNDS,
  DroneState,
  DroneType,
  WEAPONS,
  HEADER_SIZE,
  DRONE_STRUCT_SIZE,
  WeaponStats,
  ZoneName,
  WAYPOINTS,
  ZONES_ARRAY,
  DETAILED_WEAPONS
} from "../shared/constants";

// State Tracker
import { createClientTransport, ClientTransport } from "./transport/adapter";
let channel: ClientTransport | null = null;

interface PlayerHistoryNode { seq: number; x: number; y: number; z: number; mask: number; }
const moveHistory: PlayerHistoryNode[] = [];
let localPlayerId = "";
enum ClientState { MENU, LOBBY, ACTIVE, GAME_OVER }
let clientState = ClientState.MENU;
let currentTick = 0;
let lastPingTime = 0;
let latency = 30;
let serverTimeDelta = 0;

// Player visual controls
let playerHP = 100;
let playerScore = 0;
const playerPos = new THREE.Vector3(0, 1.2, 10);
let playerYaw = 0;
let playerPitch = 0;
const playerVel = new THREE.Vector3(0, 0, 0);

// Key mappings
const keys: Record<string, boolean> = { w: false, a: false, s: false, d: false, Shift: false, Space: false, Crouch: false, Ads: false, Dash: false };

let isLocalPlayerDead = false;
const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let updateWeaponUI: () => void = () => {};
let lastFrameTime = performance.now();

// Jitter Buffers & Dead Reckoning Interpolator structures
interface NetworkDroneState {
  t: number; // local receive timestamp
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  rotW: number;
  state: DroneState;
  type: DroneType;
}

const droneJitterMap = new Map<number, NetworkDroneState[]>();
const MAX_DRONES = 256;
interface VisualInstance {
  batchedId: number;
  lastUpdate: number;
  audio?: THREE.PositionalAudio;
}
const activeGroundDrones = new Map<number, VisualInstance>();
const activeAirDrones = new Map<number, VisualInstance>();
const availableGroundInstances: number[] = [];
const availableAirInstances: number[] = [];

// Pre-allocated math structures for Zero-GC loops
const tempMoveDir = new THREE.Vector3();
const tempUpAxis = new THREE.Vector3(0, 1, 0);
const tempQuat = new THREE.Quaternion();
const tempEuler = new THREE.Euler(0, 0, 0, "YXZ");
const tempOffsetLocal = new THREE.Vector3();
const tempQ0 = new THREE.Quaternion();
const tempQ1 = new THREE.Quaternion();
const tempMatrix = new THREE.Matrix4();
const tempScale = new THREE.Vector3(1, 1, 1);
const tempZeroScale = new THREE.Vector3(0, 0, 0);
const tempZeroPos = new THREE.Vector3(0, -9999, 0);

// Sound listeners and nodes pre-allocation
let audioListener: THREE.AudioListener | null = null;
let localLaserSound: THREE.Audio | null = null;
let droneHumBuffer: AudioBuffer | null = null;

// Physics Worker & SAB
let physicsWorker: Worker | undefined;
let physicsSAB: SharedArrayBuffer | undefined;
let physicsData: Float32Array | undefined;

// Three.js Render Elements
export let renderer: any;
export let scene: THREE.Scene;
export let camera: THREE.PerspectiveCamera;
export let gridHelper: THREE.GridHelper;

export let canvasContainer: HTMLDivElement | null = null;

// Pre-allocated batched geometry items
let groundBatchedMesh: THREE.BatchedMesh;
let airBatchedMesh: THREE.BatchedMesh;
let groundGeomId: number, airGeomId: number;
let playerWeaponMesh: THREE.Group;

// Dynamic weapon mechanics state variables (primitive values to comply with Zero-GC and prevent allocations)
let currentAccuracyHeat = 0.0;       // Dynamic bloom magnitude index [0, 1]
let visualRecoilUpOffset = 0.0;      // Dynamic recoil pitch modifier (radians)
let visualRecoilSideOffset = 0.0;    // Dynamic recoil yaw modifier (radians)
let targetAdsLerp = 0.0;             // Sights transition target
let currentAdsLerp = 0.0;            // Dynamic lerp position for ADS
let lastCamShakeT = 0;               // Timestamp of camera shake event start
let swayCycleTime = 0.0;             // Incremented frame cycle for breath sway
let isADS = false;                   // Aim Down Sights activation toggle

// Dynamic laser lines
let laserLineSegments: THREE.LineSegments;
const laserPositions: number[] = [];
const laserColors: number[] = [];

// Match visual elements are imported from client/visuals.ts and initialized dynamically

// Initialize Game loop
const initClient = async () => {
// Init Physics Worker
  if (typeof SharedArrayBuffer !== 'undefined') {
    physicsWorker = new Worker(new URL('./physics.worker.ts', import.meta.url), { type: 'module' });
    physicsSAB = new SharedArrayBuffer(9 * 4); // 9 floats
    physicsData = new Float32Array(physicsSAB);
    physicsWorker.postMessage({ type: 'INIT', sab: physicsSAB });
  } else {
  }

  // 1. Core DOM setup
  const root = document.getElementById("root");
  if (!root) return;
  
  root.innerHTML = HUD_HTML;

  canvasContainer = document.getElementById("canvas-container") as HTMLDivElement;
  
  window.addEventListener("start-match", (e: any) => {
      initMatchVisuals(scene);
      injectMatchTab();
      const hud = document.getElementById("hud-container");
      if (hud) hud.style.setProperty("display", "block", "important");
      
      const requestedMap = e.detail?.map?.id || 'map_0_dev';
      (window as any).vexMapId = requestedMap;

      // Initialize Three Audio Listener natively
      audioListener = new THREE.AudioListener();
      camera.add(audioListener);
      (window as any).audioListener = audioListener;
      const s = (window as any).vexeaSettings;
      if (s) audioListener.setMasterVolume(s.masterVolume);
      
      localLaserSound = new THREE.Audio(audioListener);
      
      // Pre-create synth raw sound buffers
      const audioCtx = audioListener.context;
      const bufferSize = audioCtx.sampleRate * 0.15; // 150ms shot
      const shotBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = shotBuffer.getChannelData(0);
      for (let s = 0; s < bufferSize; s++) {
        data[s] = Math.sin(2 * Math.PI * 800 * (s / audioCtx.sampleRate)) * Math.exp(-12 * (s / bufferSize));
      }
      localLaserSound.setBuffer(shotBuffer);
      localLaserSound.setVolume(0.2);

      // Connect socket & boot views
      clientState = ClientState.LOBBY;
      
      // Transition state machine
      (window as any).gameState = "ACTIVE_MATCH"; 
      
      // Pointer lock and fullscreen requests moved synchronously to lobby 'READY' button direct click handler.
      
      const cloudUid = (window as any).vexPlayerUid;
      const matchId = `M_${Math.floor(Math.random() * 1000000)}`;

      connectEngineSocket().then(() => {
          if (cloudUid) {
             lockMatchSession(matchId, cloudUid).then(locked => {
                 if (locked) {
                    (window as any).vexMatchId = matchId;
                    if(channel) channel.emit("start_match", { uid: cloudUid, matchId, mapId: requestedMap });
                 }
             });
          } else {
             (window as any).vexMatchId = matchId;
             if (channel) channel.emit("start_match", { uid: "guest_" + matchId, matchId, mapId: requestedMap });
          }

          // Load map via MapLoader if not dev map
          if (requestedMap !== 'map_0_dev') {
              const mapDef = getMapById(requestedMap);
              if (mapDef && channel) {
                  import('./src/map/LoadingOrchestrator').then(m => {
                      m.orchestrateMatchLoad(mapDef, channel);
                  });
              }
          } else {
              const mLoader = new MapLoader(scene);
              const mapDef = getMapById(requestedMap);
              if (mapDef) {
                  mLoader.load(mapDef).then(() => {
                      mLoader.buildScene();
                      mLoader.placeProps();
                      (window as any).__vexMapLoader = mLoader;
                  });
              }
          }
      });
  });

  // MENU State initialization
  const ready = await initFirebase();
  if (ready) {
    const cloudUid = await authenticateAnonymously();
    if (cloudUid) {
       (window as any).vexPlayerUid = cloudUid;
       fetchPlayerStats(cloudUid).then(stats => {
           if (stats) (window as any).vexCloudStats = stats;
       });
    }
  }

  // Initialize UI Screens
  initSplash();
  await audioManager.loadAll();
  audioManager.playNextMenuMusic();
  
  initMainMenu();
  initLobby();

  // 2. Setup Three.js Stage Pipeline
  await setup3DStage();
  
  // 3. Mount Listeners
  window.addEventListener("resize", handleWindowResize);
  setupControllerBinds();
  
  // 4. Tick loop trigger
  animateFrame();
};

// Connect to Node binary sockets
const connectEngineSocket = () => {
    return new Promise<void>((resolve) => {
      const s = getSettings();
      const serverUrl = s.serverUrl || window.location.origin;

      channel = createClientTransport();
      channel.connect(serverUrl, 3000);
      channel.onConnect(() => {
            if (typeof (window as any).initDevMenu === "function") {
                (window as any).initDevMenu(channel, droneJitterMap);
            }
            resolve();
      });

  channel.onRaw((data: any) => {
    if (typeof (window as any).trackNetwork === "function") (window as any).trackNetwork("IN", data);
    const view = new DataView(data);
    if (view.byteLength === 20) {
      const serverTick = view.getUint32(0, true);
      const lastSeq = view.getUint32(4, true);
      const px = view.getFloat32(8, true);
      const py = view.getFloat32(12, true);
      const pz = view.getFloat32(16, true);

      const idx = moveHistory.findIndex(h => h.seq === lastSeq);
      if (idx !== -1) {
        const hist = moveHistory[idx];
        const dx = hist.x - px;
        const dy = hist.y - py;
        const dz = hist.z - pz;
        if (dx*dx + dy*dy + dz*dz > 0.25) {
          playerPos.set(px, py, pz);
          if (physicsWorker) {
              physicsWorker.postMessage({ type: 'CORRECT_POS', pos: { x: px, y: py, z: pz } });
          }
          for (let i = idx + 1; i < moveHistory.length; i++) {
            const m = moveHistory[i];
            const maskW = (m.mask & 1) !== 0;
            const maskA = (m.mask & 2) !== 0;
            const maskS = (m.mask & 4) !== 0;
            const maskD = (m.mask & 8) !== 0;
            
            let moveX = 0; let moveZ = 0;
            if (maskW) moveZ -= 1;
            if (maskS) moveZ += 1;
            if (maskA) moveX -= 1;
            if (maskD) moveX += 1;
            
            const len = Math.sqrt(moveX*moveX + moveZ*moveZ);
            if (len > 0) { moveX /= len; moveZ /= len; }
            
            const speed = 15.0 * 0.0166;
            const yaw = playerYaw; 
            const dirX = moveX * Math.cos(yaw) + moveZ * Math.sin(yaw);
            const dirZ = -moveX * Math.sin(yaw) + moveZ * Math.cos(yaw);
            
            playerPos.x += dirX * speed;
            playerPos.z += dirZ * speed;
            m.x = playerPos.x;
            m.y = playerPos.y;
            m.z = playerPos.z;
          }
        }
        moveHistory.splice(0, idx + 1);
      }
      return;
    }
    
    // Otherwise drone data
    
    const incomingTick = view.getUint32(0, true);
    if (incomingTick <= (window as any).lastDroneTick) {
        return; // Drop out of order packet
    }
    (window as any).lastDroneTick = incomingTick;
    currentTick = incomingTick;
    
    // Server is 60Hz. So incomingTick * 1000/60
    const serverTimeReceived = incomingTick * (1000 / 60);
    const now = performance.now();
    serverTimeDelta = serverTimeReceived - now;
    
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

      if (!droneJitterMap.has(id)) {
        droneJitterMap.set(id, []);
      }
      const jitterBuffer = droneJitterMap.get(id);
      if (jitterBuffer) {
        jitterBuffer.push({
          t: serverTimeReceived, posX: px, posY: py, posZ: pz,
          rotX: rx, rotY: ry, rotZ: rz, rotW: rw,
          state, type
        });
        if (jitterBuffer.length > 3) jitterBuffer.shift(); // The jitter buffer holds the last 3 received position packets
      }
      byteOffset += DRONE_STRUCT_SIZE;
    }
    
    // Parse cameras
    (window as any).syncCameras = [];
    for (let c = 0; c < camCount; c++) {
      const camId = view.getUint16(byteOffset, true);
      const isActive = view.getUint8(byteOffset + 2) === 1;
      (window as any).syncCameras.push({ id: camId, isActive });
      byteOffset += 4; // CAMERA_STRUCT_SIZE
    }
  });

  channel.on("server_debug", (msg: any) => {
  });

  channel.on("handshake", (json: any) => localPlayerId = json.id);
  channel.on("environmental_event", (msg: any) => {
    if (msg.color) {
      if (scene.background instanceof THREE.Color) scene.background.set(msg.color);
      if (scene.fog instanceof THREE.FogExp2) scene.fog.color.set(msg.color);
    }
  });

  channel.on("reliable_event", (msg: any) => {
    if (msg.type === "dev_llm_feed") {
        if (typeof (window as any).receivedLLMFeed === 'function') {
            (window as any).receivedLLMFeed(msg);
        }
    }
    
    if (msg.type === "HIT_CONFIRMED") {
        if ((window as any).audioManager && (window as any).audioManager.play) {
            (window as any).audioManager.play('hit_confirmed');
        }
        
        const ch = document.getElementById("center-crosshair");
        if (ch) {
            const kills = msg.droneHp <= 0;
            ch.style.background = kills ? 'rgba(255, 180, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)';
            ch.style.width = kills ? '20px' : '15px';
            ch.style.height = kills ? '20px' : '15px';
            ch.style.borderRadius = "50%";
            setTimeout(() => {
                ch.style.background = 'transparent';
                ch.style.width = '0px';
                ch.style.height = '0px';
            }, kills ? 300 : 150);
        }

        spawnImpactSparks(msg.impactX, msg.impactY, msg.impactZ, sparksPerHitCount || 0);
    }

    if (msg.type === "DRONE_HIT") {
        // Drone hits handled via HIT_CONFIRMED sparks. Nothing specific to do here.
    }

    if (msg.type === "DRONE_DEATH") {
        if ((window as any).audioManager && (window as any).audioManager.play) {
            (window as any).audioManager.play('drone_death');
        }
        droneJitterMap.delete(msg.droneId);
        
        let visualInst = activeGroundDrones.get(msg.droneId);
        if (visualInst) {
            groundBatchedMesh.setMatrixAt(visualInst.batchedId, tempMatrix.identity().scale(tempZeroScale));
            availableGroundInstances.push(visualInst.batchedId);
            activeGroundDrones.delete(msg.droneId);
            if (groundBatchedMesh && (groundBatchedMesh as any).instanceMatrix) (groundBatchedMesh as any).instanceMatrix.needsUpdate = true;
        } else {
            visualInst = activeAirDrones.get(msg.droneId);
            if (visualInst) {
                airBatchedMesh.setMatrixAt(visualInst.batchedId, tempMatrix.identity().scale(tempZeroScale));
                availableAirInstances.push(visualInst.batchedId);
                activeAirDrones.delete(msg.droneId);
                if (airBatchedMesh && (airBatchedMesh as any).instanceMatrix) (airBatchedMesh as any).instanceMatrix.needsUpdate = true;
            }
        }
    }

    if (msg.type === "FIRE_MODE_CHANGED") {
        rifleMode = msg.mode;
        updateWeaponUI();
    }

    if (msg.type === "AMMO_STATE") {
        const a1 = document.getElementById("weapon-1-ammo");
        const a2 = document.getElementById("weapon-2-ammo");
        if (a1 && msg.primary) {
            ammo1 = msg.primary.currentMag;
            if (activeWeapon === 1) isReloading = msg.primary.isReloading;
            a1.innerText = msg.primary.isReloading ? "RELOADING" : `${msg.primary.currentMag.toString().padStart(2, '0')}/${msg.primary.reserve}`;
        }
        if (a2 && msg.secondary) {
            ammo2 = msg.secondary.currentMag;
            if (activeWeapon === 2) isReloading = msg.secondary.isReloading;
            a2.innerText = msg.secondary.isReloading ? "RELOADING" : `${msg.secondary.currentMag.toString().padStart(2, '0')}/${msg.secondary.reserve}`;
        }

        // Barrel smoke on magazine exhaustion
        if (msg.primary && msg.primary.currentMag === 0 && msg.primary.isReloading === true) {
            const tempMuzzle = new THREE.Vector3();
            getMuzzleWorldPosition(tempMuzzle, camera);
            spawnBarrelSmoke(camera, tempMuzzle);
        }
    }

    if (msg.type === "YOU_DIED") {
       console.log('[CLIENT] received YOU_DIED:', msg);
       isLocalPlayerDead = true;
       const overlay = document.getElementById("death-overlay");
       const countdown = document.getElementById("death-countdown");
       if (overlay) overlay.style.display = "flex";
       if (countdown && msg.respawnTimer) countdown.innerText = String(msg.respawnTimer);
       
       // Force stop inputs
       keys.w = false; keys.s = false; keys.a = false; keys.d = false;
       keys.Shift = false; keys.Space = false;
       const joystickKnob = document.getElementById("joystick-knob");
       if (joystickKnob) joystickKnob.style.transform = "translate(0px, 0px)";
    }

    if (msg.type === "RESPAWN_COUNTDOWN") {
       console.log('[CLIENT] received RESPAWN_COUNTDOWN:', msg);
       const countdown = document.getElementById("death-countdown");
       if (countdown) countdown.innerText = String(msg.remaining);
    }

    if (msg.type === "YOU_RESPAWNED" || msg.type === "RESPAWN") {
       console.log('[CLIENT] received YOU_RESPAWNED or RESPAWN:', msg);
       isLocalPlayerDead = false;
       const overlay = document.getElementById("death-overlay");
       if (overlay) overlay.style.display = "none";
       playerHP = msg.hp || 100;
       
       playerPos.set(msg.position.x, msg.position.y, msg.position.z);
       const hBar = document.getElementById("health-bar-fill");
       const hpVal = document.getElementById("health-text");
       if (hBar) hBar.style.width = `100%`;
       if (hpVal) hpVal.innerText = `100/100`;
    }

    if (msg.type === "PLAYER_RESPAWN" || msg.type === "PLAYER_DEATH" || msg.type === "PLAYER_LEFT") {
        // Just received event for info, local tracking doesn't block logic. No op needed for minimal scope.
    }
    
function triggerUIFlash(color: string = "255, 0, 0", duration: number = 0.5) {
  let flashDiv = document.getElementById("ui-damage-flash");
  if (!flashDiv) {
    flashDiv = document.createElement("div");
    flashDiv.id = "ui-damage-flash";
    Object.assign(flashDiv.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "999",
      transition: "opacity 0.1s ease-out"
    });
    document.body.appendChild(flashDiv);
  }
  flashDiv.style.background = `rgba(${color}, 0.3)`;
  flashDiv.style.opacity = "1";
  
  setTimeout(() => {
    if (flashDiv) {
      flashDiv.style.transition = `opacity ${duration}s ease-out`;
      flashDiv.style.opacity = "0";
    }
  }, 100);
}

    if (msg.type === "GATE_DAMAGE" || msg.type === "PLAYER_HIT") {
        if (msg.hp !== undefined) playerHP = msg.hp;
        if (msg.currentHp !== undefined) playerHP = msg.currentHp;
        
        triggerUIFlash("255, 0, 0", 0.5);

        const hBar = document.getElementById("health-bar-fill");
        const hpVal = document.getElementById("health-text");
        if (hBar) hBar.style.width = `${Math.max(0, playerHP)}%`;
        if (hpVal) hpVal.innerText = `${Math.floor(Math.max(0, playerHP))}/100`;
    }
    
    if (msg.type === "MATCH_END") {
       removeMatchTab();
       clientState = ClientState.GAME_OVER;
       const endScreen = document.getElementById("post-match-screen");
       const scoreEl = document.getElementById("summary-score");
       if (endScreen && scoreEl) {
          endScreen.style.display = "flex";
          scoreEl.innerText = msg.stats && msg.stats[localPlayerId] ? String(msg.stats[localPlayerId].scoreIndividual) : "0";
       }
        document.dispatchEvent(new CustomEvent("VEXEA_MATCH_OVER"));
        clearAllVisuals();
    }
  });

  channel.on("state_sync", (json: any) => {
    const elapsedSeconds = Math.floor(json.tick / 60);
    const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
    const seconds = (elapsedSeconds % 60).toString().padStart(2, '0');
    const elapsedVal = document.getElementById("hud-timer");
    if (elapsedVal && elapsedVal.innerText !== `TURN TIMER: ${minutes}:${seconds}`) {
      elapsedVal.innerText = `TURN TIMER: ${minutes}:${seconds}`;
    }

    syncVisualProjectiles(json.projectiles);
    const clientMatchMe = json.players.find((p: any) => p.id === localPlayerId);
    if (clientMatchMe) {
      playerHP = clientMatchMe.hp;
      playerScore = clientMatchMe.score;
      const hBar = document.getElementById("health-bar-fill");
      const hpVal = document.getElementById("health-text");
      const scoreVal = document.getElementById("score-val"); // assuming exists elsewhere or not
      if (hBar) hBar.style.width = `${playerHP}%`;
      if (hpVal) hpVal.innerText = `${playerHP}/100`;
      if (scoreVal) scoreVal.innerText = `${playerScore}`;
    }
  });

  setInterval(() => {
    if (channel) {
      lastPingTime = performance.now();
      channel.emit("ping", {});
    }
  }, 2000);
  });
};

// 3. PBR Renderer Design

  const rewardBtn = document.getElementById("rewarded-ad-btn");
  if (rewardBtn) {
    rewardBtn.addEventListener("click", () => {
      const grantReward = () => {
        if (channel) channel.emit("rewarded_ad", {});
        rewardBtn.style.display = 'none';
        rewardBtn.insertAdjacentHTML('afterend', '<div class="text-green-400 font-bold mb-4">MULTIPLIER APPLIED!</div>');
      };

      try {
        if (typeof (window as any).adBreak === 'function') {
          (window as any).adBreak({
            type: 'reward',
            name: '2x_multiplier',
            beforeReward: (showAdFn: any) => showAdFn(),
            adDismissed: () => {},
            adViewed: grantReward
          });
        } else {
          grantReward();
        }
      } catch (e) {
        grantReward();
      }
    });
  }

  const mainMenuBtn = document.getElementById("main-menu-btn");
  if (mainMenuBtn) {
    mainMenuBtn.addEventListener("click", () => {
      const cc = document.getElementById('canvas-container'); if (cc) cc.style.display = 'none';
      const hc = document.getElementById('hud-container'); if (hc) hc.style.display = 'none';
      const do_ = document.getElementById('death-overlay'); if (do_) do_.style.display = 'none';
      const me = document.getElementById('post-match-screen'); if (me) me.style.display = 'none';
      const mm = document.getElementById('main-menu-screen'); if (mm) mm.style.display = 'flex';
    });
  }

const setup3DStage = async () => {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151b2c);
  
  // Camera & Renderer
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 1.2, 10);
  camera.rotation.order = 'YXZ';
  
  const canvasContainer = document.getElementById("canvas-container");
  
  try {
      // Eagerly attempt WebGPU initialization
      renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: "high-performance" });
      await renderer.init(); 
      
      renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        cancelAnimationFrame(animationFrameId);
      }, false);

      console.log("[Renderer] WebGPU initialized successfully.");
  } catch (e) {
      console.warn("[Renderer] WebGPURenderer.init() failed. Falling back to WebGLRenderer:", e);
      
      // Fallback to standard WebGLRenderer (does not require asynchronous .init())
      renderer = new WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
    if ((window as any).composer) {
        (window as any).composer.setSize(window.innerWidth, window.innerHeight);
        const pixelRatio = renderer.getPixelRatio();
        if ((window as any).fxaaPass) {
            (window as any).fxaaPass.material.uniforms['resolution'].value.x = 1 / (window.innerWidth * pixelRatio);
            (window as any).fxaaPass.material.uniforms['resolution'].value.y = 1 / (window.innerHeight * pixelRatio);
        }
    }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  
  const W = window as any;
  W.isWebGPU = (renderer.constructor as any).name === "WebGPURenderer" || typeof (renderer as any).renderAsync === "function";

  if (!W.isWebGPU) {
      const composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);
      
      const fxaaPass = new ShaderPass(FXAAShader);
      const pixelRatio = renderer.getPixelRatio();
      fxaaPass.material.uniforms['resolution'].value.x = 1 / (window.innerWidth * pixelRatio);
      fxaaPass.material.uniforms['resolution'].value.y = 1 / (window.innerHeight * pixelRatio);
      composer.addPass(fxaaPass);

      W.composer = composer;
      W.fxaaPass = fxaaPass;
  } else {
      W.composer = { render: async () => { if (typeof (renderer as any).renderAsync === "function") { await (renderer as any).renderAsync(scene, camera); } else { renderer.render(scene, camera); } }, setSize: () => {} };
      W.fxaaPass = { enabled: false, material: { uniforms: { resolution: { value: { set: () => {} } } } } };
  }
  W.renderer = renderer;
  W.scene = scene;
  W.audioListener = audioListener;
  W.activeGroundDrones = activeGroundDrones;
  W.activeAirDrones = activeAirDrones;
  W.camera = camera;
  W.vexeaSettings = getSettings();
  applySettings(W.vexeaSettings);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  
  if (canvasContainer) {
      canvasContainer.appendChild(renderer.domElement);
      (window as any).__STAGE_MOUNTED__ = true;
  } else {
      throw new Error("Canvas container element '#canvas-container' not found in DOM.");
  }

  // Lighting ambient/direct setup
  const ambientLight = new THREE.AmbientLight(0x2a3048, 2.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xa5bcff, 2.0);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x8292ab);
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = pmremGenerator.fromScene(envScene).texture;

  // Street / Building Lights
  const lightPositions = [
    new THREE.Vector3(-4.5, 4, -20),
    new THREE.Vector3(4.5, 4, -20),
    new THREE.Vector3(-4.5, 4, 0),
    new THREE.Vector3(4.5, 4, 0),
    new THREE.Vector3(-4.5, 4, 20),
    new THREE.Vector3(4.5, 4, 20)
  ];
  
  lightPositions.forEach(pos => {
    const streetLight = new THREE.PointLight(0xffa95c, 2.5, 15);
    streetLight.position.copy(pos);
    scene.add(streetLight);
    
    // Optional: visual light bulb or streetlamp geometry could be added here
  });
  
  // Notice: setupAreaCorridors() has been deferred to prevent eager asset downloading on app start.
  // It will be called when the user actually decides to enter the match/lobby.

  const isWebGPU = renderer.constructor.name === "WebGPURenderer" || typeof (renderer as any).renderAsync === "function";

  if (isWebGPU) {
      // Create a subtle volumetric height fog + depth fog combining for depth perception
      const heightFog = exponentialHeightFogFactor(float(0.005), float(4.0)); 
      const depthFog = rangeFogFactor(float(70.0), float(250.0));
      // TSL fog allows chaining / mathematical combinations.
      const mixedFog = (heightFog as any).max(depthFog);
      // @ts-ignore
      (scene as any).fogNode = fog(color(0x151b2c), mixedFog);
  } else {
      scene.fog = new THREE.Fog(0x151b2c, 70, 250); // Fallback gives clear depth perception
  }

  // 2D Moon Sprite
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.2, 'rgba(240, 240, 250, 0.9)');
    grad.addColorStop(1, 'rgba(5, 7, 10, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const moonTexture = new THREE.CanvasTexture(canvas);
    
    let moonMaterial = new THREE.SpriteMaterial({ map: moonTexture, transparent: true });
    
    const moonSprite = new THREE.Sprite(moonMaterial);
    moonSprite.position.set(40, 100, -80);
    moonSprite.scale.set(15, 15, 1);
    scene.add(moonSprite);
  }

  // Create Drones visual geometries
  
  // Create Drone and Camera BatchedMeshes
  const tMatGround = new THREE.MeshStandardMaterial({ color: 0xFF8800, emissive: 0xFF8800, emissiveIntensity: 0.2, roughness: 0.8 });
  const tMatAir = new THREE.MeshStandardMaterial({ color: 0x00AAFF, emissive: 0x00AAFF, emissiveIntensity: 0.2, roughness: 0.5 });
  const tMatRecon = new THREE.MeshStandardMaterial({ color: 0xFFFF00, emissive: 0xFFFF00, emissiveIntensity: 0.2, roughness: 0.5 });
  const tMatBomber = new THREE.MeshStandardMaterial({ color: 0xFF4400, emissive: 0xFF4400, emissiveIntensity: 0.2, roughness: 0.5 });
  const tMatCamActive = new THREE.MeshStandardMaterial({ color: 0xFF0000, emissive: 0xFF0000, emissiveIntensity: 0.8 });
  const tMatCamDead = new THREE.MeshStandardMaterial({ color: 0x333333 });

  const buildMerge = (geoms: any) => {
    geoms = geoms.filter((g: any) => g !== null);
    if(geoms.length === 1) return geoms[0];
    return BufferGeometryUtils.mergeGeometries(geoms);
  };

  const gRecon = new THREE.SphereGeometry(0.8, 8, 8);
  const gRotaryBase = new THREE.SphereGeometry(0.8, 8, 8);
  const gRotor = new THREE.CylinderGeometry(0.1, 0.1, 1.5, 4);
  const r1 = gRotor.clone(); r1.translate(1, 0, 0);
  const r2 = gRotor.clone(); r2.translate(-1, 0, 0);
  const r3 = gRotor.clone(); r3.translate(0, 0, 1);
  const r4 = gRotor.clone(); r4.translate(0, 0, -1);
  const gRotary = buildMerge([gRotaryBase, r1, r2, r3, r4]);

  const gBomberBase = new THREE.SphereGeometry(0.9, 8, 8);
  const gPayload = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  gPayload.translate(0, -0.8, 0);
  const gBomber = buildMerge([gBomberBase, gPayload]);

  const gFixedWing = new THREE.BoxGeometry(3, 0.2, 1);

  const gWheeledBase = new THREE.BoxGeometry(2, 0.5, 3);
  const gWheel = new THREE.SphereGeometry(0.6, 8, 8);
  const w1 = gWheel.clone(); w1.translate(1, -0.3, 1);
  const w2 = gWheel.clone(); w2.translate(-1, -0.3, 1);
  const w3 = gWheel.clone(); w3.translate(1, -0.3, -1);
  const w4 = gWheel.clone(); w4.translate(-1, -0.3, -1);
  const gWheeled = buildMerge([gWheeledBase, w1, w2, w3, w4]);

  const gDogBase = new THREE.BoxGeometry(1.5, 0.8, 2.5);
  const gLeg = new THREE.CylinderGeometry(0.15, 0.1, 1, 4);
  const l1 = gLeg.clone(); l1.translate(0.6, -0.8, 1);
  const l2 = gLeg.clone(); l2.translate(-0.6, -0.8, 1);
  const l3 = gLeg.clone(); l3.translate(0.6, -0.8, -1);
  const l4 = gLeg.clone(); l4.translate(-0.6, -0.8, -1);
  const gMnt = new THREE.BoxGeometry(0.4, 0.6, 0.8);
  gMnt.translate(0, 0.7, 0);
  const gDog = buildMerge([gDogBase, l1, l2, l3, l4, gMnt]);

  const gHumBase = new THREE.CapsuleGeometry(0.6, 1.5, 4, 8);
  const gArm = new THREE.BoxGeometry(0.3, 1.2, 0.3);
  const a1 = gArm.clone(); a1.translate(0.8, 0.5, 0);
  const a2 = gArm.clone(); a2.translate(-0.8, 0.5, 0);
  const gHead = new THREE.SphereGeometry(0.5, 8, 8);
  gHead.translate(0, 1.6, 0);
  const gHumanoid = buildMerge([gHumBase, a1, a2, gHead]);

  const gCamBase = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const gLens = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8);
  gLens.rotateX(Math.PI/2);
  gLens.translate(0, 0, 0.6);
  const gCamera = buildMerge([gCamBase, gLens]);

  (window as any).droneMeshes = [];
  const mkBatch = (geom: any, mat: any, maxCount: number) => {
    const mesh = new THREE.BatchedMesh(maxCount, maxCount * 1000, maxCount * 2000, mat);
    mesh.addGeometry(geom);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  };

  (window as any).droneMeshes[0] = mkBatch(gRotary, tMatAir, 50); // ROTARY_SHOOTER = 0
  (window as any).droneMeshes[1] = mkBatch(gBomber, tMatBomber, 50); // BOMBER = 1
  (window as any).droneMeshes[2] = mkBatch(gRecon, tMatRecon, 50); // RECON = 2
  (window as any).droneMeshes[3] = mkBatch(gFixedWing, tMatAir, 50); // FIXED_WING = 3
  (window as any).droneMeshes[4] = mkBatch(gWheeled, tMatGround, 50); // WHEELED = 4
  (window as any).droneMeshes[5] = mkBatch(gDog, tMatGround, 50); // ROBOT_DOG = 5
  (window as any).droneMeshes[6] = mkBatch(gHumanoid, tMatGround, 50); // HUMANOID = 6
  
  (window as any).camActiveMesh = mkBatch(gCamera, tMatCamActive, 50);
  (window as any).camDeadMesh = mkBatch(gCamera, tMatCamDead, 50);

  // Allocate instances once
  for(let i=0; i<7; i++) {
     for(let j=0; j<50; j++) {
        (window as any).droneMeshes[i].addInstance(0); // init 50 times
     }
  }
  for(let j=0; j<50; j++) {
    (window as any).camActiveMesh.addInstance(0);
    (window as any).camDeadMesh.addInstance(0);
  }

  const maxLasers = 64;

  const laserGeom = new THREE.BufferGeometry();
  laserGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxLasers * 6), 3));
  const laserMat = new THREE.LineBasicMaterial({ color: 0xff3300 });
  laserMat.transparent = true;
  laserMat.opacity = 0.95;
  laserMat.blending = THREE.AdditiveBlending;
  
  laserLineSegments = new THREE.LineSegments(laserGeom, laserMat);
  scene.add(laserLineSegments);

  // Build Floating Player weapon model
  playerWeaponMesh = initPlayerWeapons(scene, camera);
};

// Merges area corridors elements dynamically

// 4. Input & Controls binds (Zero allocations in trigger keys)
const setupControllerBinds = () => {
  canvasContainer!.addEventListener("click", () => {
    if (isLocalPlayerDead) return;
    fireActiveShot();
  });

  canvasContainer!.addEventListener("contextmenu", (e) => e.preventDefault());

  document.addEventListener("mousedown", (e) => {
    if (isLocalPlayerDead) return;
    if (isSwitchingWeapon()) return;
    if (e.button === 2) {
      e.preventDefault();
      isADS = true;
    }
  });

  document.addEventListener("mouseup", (e) => {
    if (isLocalPlayerDead) return;
    if (e.button === 2) {
      e.preventDefault();
      isADS = false;
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (isLocalPlayerDead) return;
    const currentWeaponStats = activeWeapon === 1 ? DETAILED_WEAPONS.rifle : DETAILED_WEAPONS.pistol;
    const sensMult = 1.0 - currentAdsLerp * (1.0 - currentWeaponStats.adsSensitivityMult);

    playerYaw -= e.movementX * 0.0022 * sensMult;
    playerPitch -= e.movementY * 0.0022 * sensMult;
    
    const limit = Math.PI * 0.48;
    playerPitch = Math.max(-limit, Math.min(limit, playerPitch));
  });

  // Upstream Gating Controllers to enforce Single Source of Truth & Server Authority
  const requestReload = () => {
    if (isLocalPlayerDead) return;
    const weaponAmmo = activeWeapon === 1 ? ammo1 : ammo2;
    const weaponMax = activeWeapon === 1 ? maxAmmo1 : maxAmmo2;
    if (isReloading || weaponAmmo === weaponMax) return;
    
    isReloading = true;
    audioManager.playWeaponReload(activeWeapon);
    if (channel) channel.emit("reliable_event", { type: 'RELOAD' });
  };

  const selectWeapon = (slot: number) => {
    if (isLocalPlayerDead) return;
    if (activeWeapon !== slot) {
        // Break aiming immediately
        isADS = false;
        targetAdsLerp = 0.0;

        switchActiveWeaponModel(slot);
        activeWeapon = slot;
        updateWeaponUI();
    } else if (slot === 1) {
        // Toggle fire mode on rifle if already active
        if (channel) channel.emit("reliable_event", { type: 'TOGGLE_FIRE_MODE' });
    }
  };

  window.addEventListener("keydown", (e) => {
    if (isLocalPlayerDead) return;
    if (e.key === "w" || e.key === "W") keys.w = true;
    if (e.key === "a" || e.key === "A") keys.a = true;
    if (e.key === "s" || e.key === "S") keys.s = true;
    if (e.key === "d" || e.key === "D") keys.d = true;
    if (e.key === "Shift") keys.Shift = true;
    if (e.key === " ") keys.Space = true;
    
    // Gated keyboard binds
    if (e.key === "r" || e.key === "R") requestReload();
    if (e.key === "1") selectWeapon(1);
    if (e.key === "2") selectWeapon(2);
  });

  window.addEventListener("keyup", (e) => {
    if (isLocalPlayerDead) return;
    if (e.key === "w" || e.key === "W") keys.w = false;
    if (e.key === "a" || e.key === "A") keys.a = false;
    if (e.key === "s" || e.key === "S") keys.s = false;
    if (e.key === "d" || e.key === "D") keys.d = false;
    if (e.key === "Shift") keys.Shift = false;
    if (e.key === " ") keys.Space = false;
  });

  // 1. Core Pointer State Map
  const activePointers = new Map<number, any>();

  // Helper for generic action buttons
  function safeBindTouch(
      id: string, 
      startHandler: (e: PointerEvent) => void, 
      endHandler?: (e: PointerEvent) => void
  ) {
      const el = document.getElementById(id);
      if (!el) {
          return;
      }

      el.style.pointerEvents = "auto";
      el.style.touchAction = "none";

      el.addEventListener("pointerdown", (e: PointerEvent) => {
          if ((window as any).isEditMode) return;
          if (isLocalPlayerDead) return;
          if (e.pointerType === "mouse") return;
          e.preventDefault();
          e.stopPropagation();
          try { el.setPointerCapture(e.pointerId); } catch (_) {}
          activePointers.set(e.pointerId, { type: 'button', id });
          startHandler(e);
      });

      if (endHandler) {
          const handleEnd = (e: PointerEvent) => {
              if (e.pointerType === "mouse") return;
              e.preventDefault();
              e.stopPropagation();
              if (activePointers.has(e.pointerId)) {
                  activePointers.delete(e.pointerId);
                  try { el.releasePointerCapture(e.pointerId); } catch (_) {}
              }
              endHandler(e);
          };
          el.addEventListener("pointerup", handleEnd);
          el.addEventListener("pointercancel", handleEnd);
      }
  }

  // 2. Re-bind the Joystick with Pointer Events
  const joystickKnob = document.getElementById("joystick-knob");
  const joystickBoundary = document.getElementById("joystick-boundary");

  if (joystickBoundary && joystickKnob) {
      joystickBoundary.style.pointerEvents = "auto";
      joystickBoundary.style.touchAction = "none";
      let joystickActive = false;
      let startX = 0, startY = 0;
      const maxRadius = 48;
      let movePointerId: number | null = null;

      const startJoystick = (e: PointerEvent) => {
          if ((window as any).isEditMode) return;
          if (isLocalPlayerDead) return;
          if (e.pointerType === "mouse") return;
          e.preventDefault();
          e.stopPropagation();
          if (movePointerId !== null) return;
          
          try { joystickBoundary.setPointerCapture(e.pointerId); } catch (_) {}
          movePointerId = e.pointerId;
          joystickActive = true;
          activePointers.set(e.pointerId, { type: 'joystick' });
          
          const rect = joystickBoundary.getBoundingClientRect();
          startX = rect.left + rect.width / 2;
          startY = rect.top + rect.height / 2;
      };

      const moveJoystick = (e: PointerEvent) => {
          if (isLocalPlayerDead) return;
          if (e.pointerType === "mouse") return;
          if (!joystickActive || e.pointerId !== movePointerId) return;
          e.preventDefault();
          e.stopPropagation();
          
          let rawDX = e.clientX - startX;
          let rawDY = e.clientY - startY;
          const js = (window as any).vexeaSettings ? (window as any).vexeaSettings.joySens : 1.0;
          let deltaX = rawDX * js;
          let deltaY = rawDY * js;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

          if (distance > maxRadius) {
              deltaX = (deltaX / distance) * maxRadius;
              deltaY = (deltaY / distance) * maxRadius;
          }

          joystickKnob.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

          const normX = deltaX / maxRadius;
          const normY = -deltaY / maxRadius;

          keys.w = normY > 0.3;
          keys.s = normY < -0.3;
          keys.a = normX < -0.3;
          keys.d = normX > 0.3;

          if (normY > 0.8 && Math.abs(normX) < 0.5) {
              keys.Shift = true;
              keys.Crouch = false;
              document.getElementById("btn-crouch")?.classList.remove("bg-white", "text-black");
          } else {
              keys.Shift = false;
          }
      };

      const resetJoystick = (e: PointerEvent) => {
          if (e.pointerType === "mouse") return;
          if (e.pointerId !== movePointerId) return;
          e.preventDefault();
          e.stopPropagation();
          
          activePointers.delete(e.pointerId);
          try { joystickBoundary.releasePointerCapture(e.pointerId); } catch (_) {}
          
          joystickActive = false;
          joystickKnob.style.transform = "translate(0px, 0px)";
          keys.w = false;
          keys.s = false;
          keys.a = false;
          keys.d = false;
          keys.Shift = false;
          movePointerId = null;
      };

      joystickBoundary.addEventListener("pointerdown", startJoystick);
      joystickBoundary.addEventListener("pointermove", moveJoystick);
      joystickBoundary.addEventListener("pointerup", resetJoystick);
      joystickBoundary.addEventListener("pointercancel", resetJoystick);
  }

  // Swipe-to-Look (Right-Side Touch Zone)
  let lastTouchX = 0, lastTouchY = 0, isTouchingLookZone = false;
  let lookPointerId: number | null = null;
  let touchSensitivity = 0.003;

  const lookZone = document.getElementById("look-zone-right");
  if (lookZone) {
      lookZone.style.touchAction = "none";
      
      const startLook = (e: PointerEvent) => {
          if ((window as any).isEditMode) return;
          if (isLocalPlayerDead) return;
          if (e.pointerType === "mouse") return;
          e.preventDefault();
          e.stopPropagation();
          if (lookPointerId !== null) return;
          
          try { lookZone.setPointerCapture(e.pointerId); } catch (_) {}
          lookPointerId = e.pointerId;
          isTouchingLookZone = true;
          lastTouchX = e.clientX;
          lastTouchY = e.clientY;
          activePointers.set(e.pointerId, { type: 'camera' });
      };

      const moveLook = (e: PointerEvent) => {
          if (isLocalPlayerDead) return;
          if (e.pointerType === "mouse") return;
          if (!isTouchingLookZone || e.pointerId !== lookPointerId) return;
          e.preventDefault();
          e.stopPropagation();
          
          const deltaX = e.clientX - lastTouchX;
          const deltaY = e.clientY - lastTouchY;
          const cs = (window as any).vexeaSettings ? (window as any).vexeaSettings.camSens : 1.0;
              const inv = ((window as any).vexeaSettings && (window as any).vexeaSettings.invertY) ? -1 : 1;
              playerYaw -= deltaX * touchSensitivity * cs;
          playerPitch -= deltaY * touchSensitivity * cs * inv;
          playerPitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, playerPitch));
          
          lastTouchX = e.clientX;
          lastTouchY = e.clientY;
      };

      const stopLook = (e: PointerEvent) => {
          if (e.pointerType === "mouse") return;
          if (e.pointerId !== lookPointerId) return;
          e.preventDefault();
          e.stopPropagation();
          
          activePointers.delete(e.pointerId);
          try { lookZone.releasePointerCapture(e.pointerId); } catch (_) {}
          
          isTouchingLookZone = false;
          lookPointerId = null;
      };

      lookZone.addEventListener("pointerdown", startLook);
      lookZone.addEventListener("pointermove", moveLook);
      lookZone.addEventListener("pointerup", stopLook);
      lookZone.addEventListener("pointercancel", stopLook);
  }

  // 3. Bind All Action Buttons with Proper Mobile Toggles
  safeBindTouch("btn-jump", () => { keys.Space = true; }, () => { keys.Space = false; });

  const toggleStateBtn = (id: string, keyName: string) => {
      const el = document.getElementById(id);
      if(el) {
          safeBindTouch(id, () => {
              keys[keyName] = !keys[keyName];
              if(keys[keyName]) el.classList.add("bg-white", "text-black");
              else el.classList.remove("bg-white", "text-black");
          });
      }
  };

  toggleStateBtn("btn-crouch", "Crouch");

  safeBindTouch("btn-sprint", () => {});

  const adsBtn = document.getElementById("btn-ads");
  if (adsBtn) {
      safeBindTouch("btn-ads", () => {
          if (isSwitchingWeapon()) return;
          isADS = !isADS;
          if (isADS) {
              adsBtn.classList.add("bg-white", "opacity-80");
          } else {
              adsBtn.classList.remove("bg-white", "opacity-80");
          }
      });
  }

  safeBindTouch("btn-reload", () => {
      requestReload();
  });

  // Dual-Fire Buttons
  let fireInterval: any = null;
  const triggerFireStart = () => { 
      if (activeWeapon === 2) {
          fireActiveShot();
      } else {
          if (rifleMode === 'auto') {
              fireActiveShot();
              if (fireInterval) clearInterval(fireInterval);
              fireInterval = setInterval(fireActiveShot, 150); 
          } else {
              fireActiveShot();
              let bCount = 1;
              if (fireInterval) clearInterval(fireInterval);
              fireInterval = setInterval(() => {
                  bCount++;
                  if (bCount <= 3) fireActiveShot();
                  else clearInterval(fireInterval);
              }, 100);
          }
      }
  };
  const triggerFireEnd = () => { 
      if (rifleMode === 'auto' && fireInterval) {
          clearInterval(fireInterval);
          fireInterval = null;
      }
  };

  const bindDragShoot = (id: string, startCb: Function, endCb: Function) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.pointerEvents = "auto";
      el.style.touchAction = "none";
      
      let shootPointerId: number | null = null;
      
      const onStart = (e: PointerEvent) => {
          if ((window as any).isEditMode) return;
          if (e.pointerType === "mouse") return;
          e.preventDefault();
          e.stopPropagation();
          try { el.setPointerCapture(e.pointerId); } catch (_) {}
          activePointers.set(e.pointerId, { type: 'shoot', id });
          shootPointerId = e.pointerId;
          startCb();
          
          // Commandeer look if look wasn't active
          if (lookPointerId === null && lookZone) {
              lookPointerId = e.pointerId;
              isTouchingLookZone = true;
              lastTouchX = e.clientX;
              lastTouchY = e.clientY;
          }
      };
      
      const onMove = (e: PointerEvent) => {
          if (e.pointerType === "mouse") return;
          if (e.pointerId !== shootPointerId) return;
          e.preventDefault();
          e.stopPropagation();
          
          if (lookPointerId === e.pointerId) {
              const deltaX = e.clientX - lastTouchX;
              const deltaY = e.clientY - lastTouchY;
              const cs = (window as any).vexeaSettings ? (window as any).vexeaSettings.camSens : 1.0;
          const inv = ((window as any).vexeaSettings && (window as any).vexeaSettings.invertY) ? -1 : 1;
          playerYaw -= deltaX * touchSensitivity * cs;
              playerPitch -= deltaY * touchSensitivity * cs * inv;
              playerPitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, playerPitch));
              
              lastTouchX = e.clientX;
              lastTouchY = e.clientY;
          }
      };

      const onEnd = (e: PointerEvent) => {
          if (e.pointerType === "mouse") return;
          if (e.pointerId !== shootPointerId) return;
          e.preventDefault();
          e.stopPropagation();
          endCb();
          
          if (activePointers.has(e.pointerId)) {
              activePointers.delete(e.pointerId);
              try { el.releasePointerCapture(e.pointerId); } catch (_) {}
          }
          
          if (lookPointerId === e.pointerId) {
              isTouchingLookZone = false;
              lookPointerId = null;
          }
          shootPointerId = null;
      };
      
      el.addEventListener("pointerdown", onStart);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onEnd);
      el.addEventListener("pointercancel", onEnd);
  };

  bindDragShoot("btn-fire-right", triggerFireStart, triggerFireEnd);
  bindDragShoot("btn-fire-left", triggerFireStart, triggerFireEnd);

  // Weapon Slots
  updateWeaponUI = () => {
      const w1 = document.getElementById("weapon-slot-1");
      const w2 = document.getElementById("weapon-slot-2");
      const autoLabel = document.getElementById("auto-label");
      if (w1) {
          w1.style.setProperty('opacity', activeWeapon === 1 ? "1" : "0.4", 'important');
          if (activeWeapon === 1) w1.classList.add("active");
          else w1.classList.remove("active");
      }
      if (w2) {
          w2.style.setProperty('opacity', activeWeapon === 2 ? "1" : "0.4", 'important');
          if (activeWeapon === 2) w2.classList.add("active");
          else w2.classList.remove("active");
      }
      if (autoLabel) {
          if (activeWeapon === 1) autoLabel.innerHTML = rifleMode === 'auto' ? "AUTO &rarr;" : "BURST &rarr;";
          else autoLabel.innerHTML = "SINGLE &rarr;";
      }
  };

  safeBindTouch("weapon-slot-1", () => {
      selectWeapon(1);
  });
  safeBindTouch("weapon-slot-2", () => {
      selectWeapon(2);
  });

  // Utility Toggles
  // SETTINGS MODAL BINDINGS
  safeBindTouch("btn-settings", openSettings);

  safeBindTouch("btn-chat", () => {});
  safeBindTouch("btn-mic", () => {});
  safeBindTouch("btn-walkie", () => {}, () => {});
  safeBindTouch("btn-medkit", () => {});
};


const handleWindowResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
};

let lastTime = performance.now();
let isReloading = false;
let ammo1 = 40;
let ammo2 = 35;
const maxAmmo1 = 40;
const maxAmmo2 = 35;
let activeWeapon = 1;
let rifleMode: 'auto' | 'burst' = 'auto';
let pendingFire = false;

const syncVisualProjectiles = (data: any) => {
    if (Array.isArray(data)) {
        // network sync
        let ptr = 0;
        const maxLen = 64 * 6;
        for (let i = 0; i < data.length; i++) {
           const p = data[i];
           // Just a basic visual line or dot, 
           // In original code this populated laserPositions
           if (ptr < maxLen) {
               laserPositions[ptr++] = p.x;
               laserPositions[ptr++] = p.y;
               laserPositions[ptr++] = p.z;
               laserPositions[ptr++] = p.x + 0.5;
               laserPositions[ptr++] = p.y + 0.5;
               laserPositions[ptr++] = p.z + 0.5;
           }
        }
        if (laserLineSegments && laserLineSegments.geometry) {
           // We just zero out the rest
           for (let i = ptr; i < maxLen; i++) laserPositions[i] = 0;
           laserLineSegments.geometry.setAttribute('position', new THREE.Float32BufferAttribute(laserPositions, 3));
           laserLineSegments.geometry.attributes.position.needsUpdate = true;
        }
    } else {
        // dt update (unused logic maybe)
    }
};

let fireSequenceNumber = 0;
let lastPrimaryShotT = 0;
let lastSecondaryShotT = 0;

const fireActiveShot = () => {
    if (isLocalPlayerDead) return;

    // 0. CHECKS SWITCH GATE
    if (isSwitchingWeapon()) return;

    // 1. CHECKS RELOAD GATE
    if (isReloading) return;

    // 2. CHECKS AMMO GATE (HOLDING DOWN FIRE BUTTON WITH NO AMMO SHOULD NOT TRIGGER EFFECTS OR EVENT EMISSIONS)
    const currentAmmo = activeWeapon === 1 ? ammo1 : ammo2;
    if (currentAmmo <= 0) {
        // Play classic dry shot click sound on empty magazine
        const now = performance.now();
        const lastShotTime = activeWeapon === 1 ? lastPrimaryShotT : lastSecondaryShotT;
        const weaponStats = activeWeapon === 1 ? WEAPONS.rifle : WEAPONS.pistol;
        const allowedInterval = 1000 / weaponStats.fireRateHz;
        
        // Gate click sound to the weapon's fire rate to avoid extreme click spamming
        if (now - lastShotTime >= allowedInterval) {
            if (activeWeapon === 1) lastPrimaryShotT = now;
            else lastSecondaryShotT = now;
            audioManager.play('click');
        }
        return;
    }

    // 3. CHECKS COOLDOWN GATE (ENHANCES ANTI-CHEAT & GAME FEEL ALIGNMENT WITH THE SERVER)
    const now = performance.now();
    const weaponStats = activeWeapon === 1 ? WEAPONS.rifle : WEAPONS.pistol;
    const allowedInterval = 1000 / weaponStats.fireRateHz;
    const lastShotTime = activeWeapon === 1 ? lastPrimaryShotT : lastSecondaryShotT;
    
    if (now - lastShotTime < allowedInterval) return;

    // Update weapon slot cooldown timestamp (zero heap allocation)
    if (activeWeapon === 1) lastPrimaryShotT = now;
    else lastSecondaryShotT = now;

    // 4. CONSUMES AMMO
    if (activeWeapon === 1) ammo1--;
    else ammo2--;

    // Automatic reload trigger if client-side ammo drops to zero
    if ((activeWeapon === 1 && ammo1 <= 0) || (activeWeapon === 2 && ammo2 <= 0)) {
        if (!isReloading) {
            isReloading = true;
            audioManager.playWeaponReload(activeWeapon);
        }
    }

    // 5. PROCESS ACCURACY BLOOM, RECOIL KICK & CAMERA SHAKE (Dynamic zero-allocation state modifiers)
    const currentWeaponStats = activeWeapon === 1 ? DETAILED_WEAPONS.rifle : DETAILED_WEAPONS.pistol;

    // Apply bloom heat
    currentAccuracyHeat = Math.min(1.0, currentAccuracyHeat + currentWeaponStats.heatPerShot);

    // Apply visual camera pitch/yaw kicks
    visualRecoilUpOffset = Math.min(0.2, visualRecoilUpOffset + currentWeaponStats.recoilForceUp);
    visualRecoilSideOffset += (Math.random() - 0.5) * currentWeaponStats.recoilForceSide;

    // Set camera shake start timestamp
    lastCamShakeT = performance.now();

    // Compute angular spread deflection (suppressed by 50% when ADS aiming)
    const spreadRad = (currentWeaponStats.baseSpreadRad + currentAccuracyHeat * (currentWeaponStats.maxSpreadRad - currentWeaponStats.baseSpreadRad)) * (1.0 - currentAdsLerp * 0.5);

    // Compute random deflection inside a polar circle pattern (zero GC allocations)
    const deflectionAngle = Math.random() * Math.PI * 2.0;
    const deflectionRadius = Math.random() * spreadRad;
    const deflectionX = Math.cos(deflectionAngle) * deflectionRadius;
    const deflectionY = Math.sin(deflectionAngle) * deflectionRadius;

    // Construct the actual line-of-sight bullet direction vector deflected by spread
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    // Extract camera matrix coordinate vectors (zero GC allocations)
    const rightVec = new THREE.Vector3();
    const upVec = new THREE.Vector3();
    rightVec.setFromMatrixColumn(camera.matrixWorld, 0);
    upVec.setFromMatrixColumn(camera.matrixWorld, 1);

    // Apply spread offsets
    direction.addScaledVector(rightVec, deflectionX);
    direction.addScaledVector(upVec, deflectionY);
    direction.normalize();

    // EMITS COMPLETED FIRE EVENT (Keep server authority above all)
    fireSequenceNumber++;
    if (channel) {
        channel.emit("reliable_event", {
            type: 'FIRE',
            weaponSlot: activeWeapon === 1 ? 'primary' : 'secondary',
            origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            direction: { x: direction.x, y: direction.y, z: direction.z },
            timestamp: Date.now(),
            sequenceNumber: fireSequenceNumber
        });
    }

    // 6. DOWNSTREAM EFFECTS (Only played if all physical & authority gates above passed successfully)
    
    // Apply 3D weapon model spring-recoil kickback
    applyWeaponRecoil(currentWeaponStats.recoilForceUp, currentWeaponStats.recoilForceSide);

    // Gunshot Audio
    audioManager.playWeaponFire(activeWeapon);

    // Tracer Activation (Synchronized with the exact bullet spread deflected direction!)
    const localMuzzlePos = new THREE.Vector3();
    getMuzzleWorldPosition(localMuzzlePos, camera);

    spawnTracer(localMuzzlePos, direction);

    // Muzzle Flash
    triggerFlash(localMuzzlePos);

    // Immediate Client-Side Prediction for environmental decals
    const raycaster = new THREE.Raycaster(camera.position, direction);
    raycaster.camera = camera;
    // Ignore floating HUD, weapons and players. We just want static geometry
    const validIntersects = raycaster.intersectObjects(scene.children, true).filter(hit => {
        if (!hit.object.visible) return false;
        if (hit.object.name === "WeaponsContainer" || (hit.object.parent && hit.object.parent.name === "WeaponsContainer")) return false;
        if (hit.object.name === "floatingUI" || hit.object.type === "Sprite") return false;
        if ((hit.object as any).isInstancedMesh || (hit.object as any).isBatchedMesh) return false; // ignore drones and existing decals
        return true;
    });

    if (validIntersects.length > 0) {
        const impact = validIntersects[0].point;
        // Limit max range to roughly falloff distance
        if (impact.distanceTo(camera.position) < currentWeaponStats.falloff.minDamageRange * 2.0) {
            spawnEnvironmentDecalAndDust(impact.x, impact.y, impact.z);
        }
    }
};

let inputSequence = 0;
let localVy = 0.0;
let localGrounded = true;
let localCrouchY = 1.2;
let targetFpsRef = 0;
const executeLocalClientPhysics = (dt) => {
    
    let mask = 0;
    if (keys.w) mask |= 1 << 0;
    if (keys.a) mask |= 1 << 1;
    if (keys.s) mask |= 1 << 2;
    if (keys.d) mask |= 1 << 3;
    if (keys.Space) mask |= 1 << 4;
    // user requested bits: sprint=0x20, crouch=0x40, dash=0x80
    if (keys.Shift) mask |= 1 << 5;
    if (keys.Crouch) mask |= 1 << 6;
    if (keys.Dash) mask |= 1 << 7;

    tempMoveDir.set(0, 0, 0);
    if (keys.w) tempMoveDir.z -= 1.0;
    if (keys.s) tempMoveDir.z += 1.0;
    if (keys.a) tempMoveDir.x -= 1.0;
    if (keys.d) tempMoveDir.x += 1.0;

    const len = tempMoveDir.length();
    if (len > 0) {
        tempMoveDir.divideScalar(len);
    }
    tempMoveDir.applyEuler(new THREE.Euler(0, playerYaw, 0));
    
    // Explicit Local Fallback Physics
    let targetSpeed = keys.Shift ? 15.0 : 5.5;
    if (keys.Crouch) targetSpeed = 2.5;

    let targetCamY = keys.Crouch ? 0.6 : 1.2;

    // Smooth crouch interp
    localCrouchY += (targetCamY - localCrouchY) * 10.0 * dt;

    if (keys.Space && localGrounded) {
        localVy = 6.0;
        localGrounded = false;
    }
    
    // Fake gravity explicitly applied to Y coordinate
    if (!localGrounded) {
        localVy -= 20.0 * dt;
        playerPos.y += localVy * dt;
        if (playerPos.y <= 1.2) {
            playerPos.y = 1.2;
            localVy = 0;
            localGrounded = true;
        }
    }

    if (keys.Dash) {
        targetSpeed *= 3.0;
    }
    
    // Write input intent to SharedArrayBuffer for off-thread Rapier Physics worker
    if (physicsData) {
        physicsData[0] = tempMoveDir.x;
        physicsData[1] = tempMoveDir.z;
        physicsData[2] = targetSpeed;
        physicsData[3] = keys.Space ? 1 : 0;
        
        // Read back definitive interpolated position from worker
        playerPos.set(physicsData[5], physicsData[6], physicsData[7]);
    } else {
        // Fallback if worker not ready
        playerPos.add(tempMoveDir.multiplyScalar(targetSpeed * dt));
    }
    
    // Camera position is offset by the local smoothed crouch Y
    // Assume base worker playerPos.y is around ~1.2 or 0. Let's just track the Y relative
    camera.position.set(playerPos.x, playerPos.y + (localCrouchY - 1.2), playerPos.z);
    
    // We must send inputs to server
    if (channel) {
       // Pack according to server expectations:
       // Uint32 seq, Uint8 inputMask, Float32 pitch, Float32 yaw, Uint8 fire, Uint32 timestamp
       const buf = new ArrayBuffer(20);
       const view = new DataView(buf);
       inputSequence++;
       view.setUint32(0, inputSequence, true);
       view.setUint8(4, mask);
       view.setFloat32(5, playerPitch, true);
       view.setFloat32(9, playerYaw, true);
       view.setUint8(13, pendingFire ? 1 : 0);
       view.setUint32(14, performance.now() % 0xFFFFFFFF, true);
       channel.rawEmit(buf);
       pendingFire = false;
    }
    
    // Play footsteps based on input intent Speed
    const currentSpeed = (len > 0) ? targetSpeed : 0;
    audioManager.updateFootsteps(dt, currentSpeed, playerPos, localGrounded);
};

let diagnosticFrameCount = 0;
const diagTempMatrix = new THREE.Matrix4();
const diagTempPosition = new THREE.Vector3();
const diagTempScale = new THREE.Vector3();
const diagTempQuaternion = new THREE.Quaternion();

let animationFrameId = 0;

// updateVFX now fully handled inside client/visuals.ts

const animateFrame = async () => {
    const s = (window as any).vexeaSettings;
    if (s && s.fpsCap === 30) {
        setTimeout(() => {
            animationFrameId = requestAnimationFrame(animateFrame);
        }, 33);
    } else {
        animationFrameId = requestAnimationFrame(animateFrame);
    }


    if ((window as any).isEditMode) return;
    
    if ((window as any).gameState === "ACTIVE_MATCH") {
        const now = performance.now();
        // Prevent large dt jumps (e.g. from tab out or long loading times)
        const dt = Math.min(Math.max((now - lastTime) / 1000, 0.001), 0.1);
        lastTime = now;

        if ((window as any).__vexMapLoader) {
            (window as any).__vexMapLoader.update(dt);
        }

        // 2. Camera Rotation & Dynamic Weapon Systems Update (Zero allocations in loop)
        const currentWeaponStats = activeWeapon === 1 ? DETAILED_WEAPONS.rifle : DETAILED_WEAPONS.pistol;

        // Dynamic recoil decay using exponential smoothing
        visualRecoilUpOffset = visualRecoilUpOffset * Math.exp(-currentWeaponStats.recoilRecoveryRate * dt * 2.0);
        visualRecoilSideOffset = visualRecoilSideOffset * Math.exp(-currentWeaponStats.recoilRecoveryRate * dt * 2.0);

        // Dynamic accuracy heat decay
        currentAccuracyHeat = Math.max(0, currentAccuracyHeat - dt * currentWeaponStats.coolRate);

        // Break aiming immediately if switching weapon is in progress
        if (isSwitchingWeapon()) {
            isADS = false;
        }

        // ADS Lerp Zoom & FOV updates (Frame-Rate Independent)
        targetAdsLerp = isADS ? 1.0 : 0.0;
        currentAdsLerp += (targetAdsLerp - currentAdsLerp) * (1.0 - Math.exp(-currentWeaponStats.adsTransitionSpeed * dt));
        
        const baseFov = 75; // Standard default base FOV
        camera.fov = baseFov * (1.0 - currentAdsLerp * (1.0 - currentWeaponStats.adsFovMultipier));
        camera.updateProjectionMatrix();

        // Calculate dynamic breath sway (zero allocation)
        swayCycleTime += dt * currentWeaponStats.swaySpeed;
        const swayIntensity = currentWeaponStats.swayAmplitude * currentAdsLerp * 1.5;
        const swayX = Math.sin(swayCycleTime) * swayIntensity;
        const swayY = Math.cos(swayCycleTime * 2.0) * swayIntensity * 0.5;

        // Visual Camera Shake (Smooth spring decay instead of harsh noise)
        let shakeOffsetPitch = 0;
        let shakeOffsetYaw = 0;
        const timeSinceShake = now - lastCamShakeT;
        if (timeSinceShake < currentWeaponStats.camShakeDurationMs) {
            const shakeFactor = Math.pow(1.0 - (timeSinceShake / currentWeaponStats.camShakeDurationMs), 2.0);
            shakeOffsetPitch = Math.sin(timeSinceShake * 0.04) * currentWeaponStats.camShakeMagnitude * shakeFactor * 0.3;
            shakeOffsetYaw = Math.cos(timeSinceShake * 0.05) * currentWeaponStats.camShakeMagnitude * shakeFactor * 0.3;
        }

        const finalPitch = playerPitch + visualRecoilUpOffset + swayY + shakeOffsetPitch;
        const finalYaw = playerYaw + visualRecoilSideOffset + swayX + shakeOffsetYaw;
        
        camera.quaternion.setFromEuler(new THREE.Euler(finalPitch, finalYaw, 0, 'YXZ'));

        // 3. Movement & Physics Update
        if (typeof executeLocalClientPhysics === "function") {
            executeLocalClientPhysics(dt);
        }
        
        syncVisualProjectiles(dt);

        // Visual Pools Decay Update
        updateVFX(dt, camera);
        
        // Dead Reckoning Interpolator
        const droneCounts = [0,0,0,0,0,0,0];
        tempZeroScale.set(0, 0, 0);
        tempZeroPos.set(0, -9999, 0);

        droneJitterMap.forEach((buffer, id) => {
            if (buffer.length === 0) return;
            const latest = buffer[buffer.length - 1];
            if (latest.state === DroneState.DEAD) return;
            
            const localTime = performance.now();
            const serverTimeEstimate = localTime + serverTimeDelta;
            const renderTime = serverTimeEstimate - 100;
            
            let p0 = buffer[0], p1 = buffer[0];
            
            if (buffer.length === 1) {
                p0 = buffer[0];
                p1 = buffer[0];
            } else {
                if (renderTime > latest.t) {
                   p0 = latest;
                   p1 = latest;
                } else if (renderTime < buffer[0].t) {
                   p0 = buffer[0];
                   p1 = buffer[0];
                } else {
                   for (let i = buffer.length - 1; i >= 1; i--) {
                       if (renderTime >= buffer[i-1].t && renderTime <= buffer[i].t) {
                           p1 = buffer[i]; p0 = buffer[i - 1]; break;
                       }
                   }
                }
            }

            let t = 1.0;
            if (p1.t > p0.t) t = (renderTime - p0.t) / (p1.t - p0.t);
            t = Math.max(0, Math.min(1, t));

            diagTempPosition.set(
              p0.posX + (p1.posX - p0.posX) * t,
              p0.posY + (p1.posY - p0.posY) * t,
              p0.posZ + (p1.posZ - p0.posZ) * t
            );
            
            // Correction snap threshold strictly greater than 0.5 units
            let diffX = diagTempPosition.x - latest.posX;
            let diffY = diagTempPosition.y - latest.posY;
            let diffZ = diagTempPosition.z - latest.posZ;
            let distSq = diffX*diffX + diffY*diffY + diffZ*diffZ;
            if (distSq > 0.25) { // dist > 0.5 means distSq > 0.25
                diagTempPosition.set(latest.posX, latest.posY, latest.posZ);
            }
            
            tempQ0.set(p0.rotX, p0.rotY, p0.rotZ, p0.rotW);
            tempQ1.set(p1.rotX, p1.rotY, p1.rotZ, p1.rotW);
            diagTempQuaternion.copy(tempQ0).slerp(tempQ1, t);
            tempScale.set(1, 1, 1);
            
            diagTempMatrix.compose(diagTempPosition, diagTempQuaternion, tempScale);
            
            const typeId = latest.type;
            let calledSetMatrix = false;
            if (typeId >= 0 && typeId <= 6) {
                const idx = droneCounts[typeId];
                if (idx < 50) {
                    (window as any).droneMeshes[typeId].setMatrixAt(idx, diagTempMatrix);
                    droneCounts[typeId]++;
                    calledSetMatrix = true;
                }
            }
        });

        // Hide unused instances
        for (let i = 0; i < 7; i++) {
           for (let j = droneCounts[i]; j < 50; j++) {
              diagTempMatrix.compose(tempZeroPos, diagTempQuaternion, tempScale);
              (window as any).droneMeshes[i].setMatrixAt(j, diagTempMatrix);
           }
        }

        // Render cameras
        let camActiveIdx = 0;
        let camDeadIdx = 0;
        if ((window as any).syncCameras) {
            for (let i = 0; i < (window as any).syncCameras.length; i++) {
                const c = (window as any).syncCameras[i];
                diagTempPosition.set(c.id < ZONES_ARRAY.length ? WAYPOINTS[ZONES_ARRAY[c.id]].x : 0, 8, c.id < ZONES_ARRAY.length ? WAYPOINTS[ZONES_ARRAY[c.id]].z : 0);
                diagTempQuaternion.set(0, 0, 0, 1);
                tempScale.set(1, 1, 1);
                diagTempMatrix.compose(diagTempPosition, diagTempQuaternion, tempScale);
                
                if (c.isActive) {
                    if (camActiveIdx < 50) {
                       (window as any).camActiveMesh.setMatrixAt(camActiveIdx, diagTempMatrix);
                       camActiveIdx++;
                    }
                } else {
                    if (camDeadIdx < 50) {
                       (window as any).camDeadMesh.setMatrixAt(camDeadIdx, diagTempMatrix);
                       camDeadIdx++;
                    }
                }
            }
        }
        
        for (let j = camActiveIdx; j < 50; j++) {
           diagTempMatrix.compose(tempZeroPos, diagTempQuaternion, tempScale);
           (window as any).camActiveMesh.setMatrixAt(j, diagTempMatrix);
        }
        for (let j = camDeadIdx; j < 50; j++) {
           diagTempMatrix.compose(tempZeroPos, diagTempQuaternion, tempScale);
           (window as any).camDeadMesh.setMatrixAt(j, diagTempMatrix);
        }

        // 4. Weapon Position Sync (Smooth spring-recoil, breathing sway, and draw-holster animations)
        if (playerWeaponMesh) {
            updateWeaponsContainer(dt, camera, isADS, currentAdsLerp);
            
            // Hide Center Crosshair dynamically when aiming down sights (ADS)
            const crosshair = document.getElementById("center-crosshair");
            if (crosshair) {
                // Smoothly fade out crosshair as currentAdsLerp approaches 1.0
                crosshair.style.opacity = Math.max(0, 1.0 - currentAdsLerp).toString();
                crosshair.style.display = currentAdsLerp > 0.9 ? 'none' : 'block';
            }
        }

        // 4.5 Minimap Arrow Rotation
        const arrow = document.getElementById("minimap-player-arrow");
        if (arrow) {
            // playerYaw represents camera rotation on Y axis
            const px = ((camera.position.x - (-80)) / 160) * 100;
            const pz = ((camera.position.z - (-20)) / 300) * 100;
            arrow.style.left = `${px}%`;
            arrow.style.top = `${pz}%`;
            arrow.style.transform = `rotate(${-playerYaw}rad)`;
        }

        // 4.6 Minimap Drones Draw
        const mmCanvas = document.getElementById("minimap-canvas") as HTMLCanvasElement;
        if (mmCanvas) {
            const ctx = mmCanvas.getContext("2d");
            if (ctx) {
                // Ensure native canvas resolution matches CSS if needed, or just use 300x300 as base
                if (mmCanvas.width !== 300) mmCanvas.width = 300;
                if (mmCanvas.height !== 300) mmCanvas.height = 300;

                ctx.clearRect(0, 0, mmCanvas.width, mmCanvas.height);
                const w = mmCanvas.width;
                const h = mmCanvas.height;
                const minX = -80, maxX = 80, rangeX = 160;
                const minZ = -20, maxZ = 280, rangeZ = 300;
                
                droneJitterMap.forEach((buffer) => {
                    if (buffer.length === 0) return;
                    const head = buffer[buffer.length - 1];
                    if (head.state === DroneState.DEAD) return;
                    
                    let color = "#FF8800"; // Ground
                    if (head.type === 0 || head.type === 1 || head.type === 3) color = "#00AAFF"; // Air
                    else if (head.type === 2) color = "#FFFF00"; // Recon
                    
                    const cx = ((head.posX - minX) / rangeX) * w;
                    const cz = ((head.posZ - minZ) / rangeZ) * h;
                    
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(cx, cz, 4, 0, Math.PI * 2);
                    ctx.fill();
                });
            }
        }

        // 5. Render Step
        if ((window as any).fxaaPass && (window as any).fxaaPass.enabled) {
            (window as any).composer.render();
        } else {
            renderer.render(scene, camera);
        }
        if (typeof (window as any).updateDevPerf === 'function') (window as any).updateDevPerf(renderer, lastTime, performance.now());
    }
};

window.addEventListener("DOMContentLoaded", () => {
    initMapViewerGlobally();
    initClient();
    initUIEditor();
});

document.addEventListener("VEXEA_PLAYER_QUIT", () => {
    removeMatchTab();
    if (channel) channel.emit("PLAYER_QUIT", {});
    const cc = document.getElementById('canvas-container'); if (cc) cc.style.display = 'none';
    const hc = document.getElementById('hud-container'); if (hc) hc.style.display = 'none';
    const do_ = document.getElementById('death-overlay'); if (do_) do_.style.display = 'none';
    const me = document.getElementById('post-match-screen'); if (me) me.style.display = 'none';
    const mm = document.getElementById('main-menu-screen'); if (mm) mm.style.display = 'flex';
    clientState = ClientState.MENU;
    if (document.exitPointerLock) document.exitPointerLock();
});