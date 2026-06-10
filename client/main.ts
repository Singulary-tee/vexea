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
import * as screenManager from "./screens/screen-manager";

import * as THREE from "three/webgpu";
import { WebGLRenderer } from "three";
import { color, float, texture as tslTexture, time, oscSine, fog, rangeFogFactor, densityFogFactor, exponentialHeightFogFactor, max } from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { getSettings, applySettings, openSettings } from "./settings";
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
  ZONES_ARRAY
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

// Player visual controls
let playerHP = 100;
let playerScore = 0;
const playerPos = new THREE.Vector3(0, 1.2, 10);
let playerYaw = 0;
let playerPitch = 0;
const playerVel = new THREE.Vector3(0, 0, 0);

// Key mappings
const keys: Record<string, boolean> = { w: false, a: false, s: false, d: false, Shift: false, Space: false, Crouch: false, Ads: false, Dash: false };

let isMouseLocked = false;
const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
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
let playerWeaponMesh: THREE.Mesh;
let weaponRecoilVal = 0;

// Dynamic laser lines
let laserLineSegments: THREE.LineSegments;
const laserPositions: number[] = [];
const laserColors: number[] = [];

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
  
  root.innerHTML = `
    <!-- MAIN INTERACTIVE PORT -->
    <div id="vexea-view" class="relative w-screen h-screen overflow-hidden bg-transparent font-mono select-none text-white touch-none">
      
      <!-- 3D Canvas -->
      <div id="canvas-container" class="absolute inset-0 w-full h-full z-0"></div>

<style>
/* 
   EXACT 1681x936 PROPORTIONAL HUD LAYOUT 
   All layout is responsive based purely on vw/vh. No fixed px conflicts.
*/
#hud-container {
  display: none !important;
  position: absolute !important;
  inset: 0 !important;
  pointer-events: none !important;
  user-select: none !important;
  font-family: 'Rajdhani', sans-serif !important;
  letter-spacing: 0.1em !important;
  z-index: 10 !important;
  margin: 0 !important;
  padding: 0 !important;
  color: white !important;
}
#hud-container * { box-sizing: border-box; }

#look-zone-right {
  position: absolute !important;
  top: 0 !important;
  right: 0 !important;
  width: 50% !important;
  height: 100% !important;
  pointer-events: auto !important;
}

/* SQUAD - TOP LEFT */
#squad-container {
  position: absolute !important;
  top: 2.1vh !important;
  left: 1.5vw !important;
  display: flex !important;
  flex-direction: row !important;
  gap: 1vh !important;
  pointer-events: auto !important;
}
.squad-circle {
  position: relative !important;
  width: 3.5vw !important;
  height: 3.5vw !important;
  min-width: 32px !important;
  min-height: 32px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: 1px solid #22c55e !important;
  color: white !important;
}

/* TIMERS & TEXT - TOP CENTER */
#hud-timer-container {
  position: absolute !important;
  top: 2.1vh !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  text-align: center !important;
  background: transparent !important;
}
#hud-timer {
  font-weight: bold !important;
  white-space: nowrap !important;
  font-size: clamp(14px, 1.8vw, 22px) !important;
  background: transparent !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
#hud-location {
  color: white !important;
  white-space: nowrap !important;
  font-size: clamp(9px, 1.1vw, 13px) !important;
  background: transparent !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

/* MINIMAP - TOP RIGHT */
#minimap-container {
  position: absolute !important;
  top: 2.1vh !important;
  right: 1.5vw !important;
  width: 14vw !important;
  height: 95px !important;
  min-width: 100px !important;
  min-height: 95px !important;
  pointer-events: auto !important;
  background: transparent !important;
  border: 1px solid white !important;
  border-radius: 8px !important;
  overflow: hidden !important;
}
#minimap-canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}
#minimap-label {
  position: absolute !important;
  /* Float below minimap with gap */
  top: calc(2.1vh + 14vw + 12px) !important;
  right: 1.5vw !important;
  width: 14vw !important;
  text-align: center !important;
  color: white !important;
  background: transparent !important;
  font-weight: bold !important;
  font-size: clamp(10px, 1.1vw, 14px) !important;
  border: none !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
#minimap-label svg {
  height: 12px !important;
  width: auto !important;
  color: white !important;
}
@media (max-width: 714px) {
  #minimap-label {
    top: calc(2.1vh + 100px + 12px) !important;
    width: 100px !important;
  }
}

/* SIDEKICK UTIL BUTTONS - COLUMN LEFT OF MINIMAP */
.btn-sidekick {
  position: absolute !important;
  right: 17.5vw !important;
  width: 5vw !important;
  height: 5vw !important;
  min-width: 48px !important;
  min-height: 48px !important;
  background: transparent !important;
  border: none !important; /* No outline */
  pointer-events: auto !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: white !important;
}
#btn-settings { top: 2vh !important; }
#btn-mic { top: 12vh !important; }
#btn-chat { top: 22vh !important; }
@media (max-width: 714px) {
  .btn-sidekick {
    right: calc(1.5vw + 100px + 20px) !important;
  }
}

/* SETTINGS MODAL */
#settings-modal {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80vw;
  max-width: 450px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid #444;
  border-radius: 8px;
  padding: 20px;
  display: none; /* hidden by default */
  pointer-events: auto;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 15px;
}
/* MOVEMENT & JOYSTICK - BOTTOM LEFT */
#joystick-boundary {
  position: absolute !important;
  left: 4.9vw !important;
  bottom: 9vh !important;
  width: 18.75vw !important;
  height: 18.75vw !important;
  min-width: 150px !important;
  min-height: 150px !important;
  pointer-events: auto !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: 1px solid rgba(255,255,255,0.2) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}
#joystick-knob {
  width: 35% !important;
  height: 35% !important;
  border-radius: 50% !important;
  background: white !important;
}

#btn-sprint {
  position: absolute !important;
  left: 17vw !important;
  bottom: 35vh !important;
  width: 5.4vw !important;
  height: 5.4vw !important;
  min-width: 50px !important;
  min-height: 50px !important;
  pointer-events: auto !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: 1px solid white !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: white !important;
}

#btn-fire-left {
  position: absolute !important;
  left: 17vw !important;
  bottom: 35vh !important;
  width: 5.4vw !important;
  height: 5.4vw !important;
  min-width: 50px !important;
  min-height: 50px !important;
  pointer-events: auto !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: 1px solid white !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: white !important;
}

/* HEALTH BAR (Filled Rectangle) */
#health-bar {
  position: absolute !important;
  bottom: 2.5vh !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  width: 35vw !important;
  height: 2vh !important;
  min-height: 12px !important;
  background: transparent !important;
  border: 1px solid #d4d4d4 !important;
  overflow: hidden !important;
}
#health-bar-fill {
  width: 100% !important;
  height: 100% !important;
  background: #d4d4d4 !important;
}

#health-plus-sq-wrap {
  position: absolute !important;
  left: 26vw !important;
  bottom: 5vh !important;
  width: 7vw !important;
  height: 2.6vh !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: #666666 !important;
}
#health-plus-sq-wrap svg {
  height: 100% !important;
  width: auto !important;
}
#health-text-wrap {
  position: absolute !important;
  inset: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  pointer-events: none !important;
}
#health-text {
  font-weight: bold !important;
  color: black !important;
  font-size: clamp(8px, 0.9vw, 11px) !important;
  display: block !important;
}
#health-text-wrap svg {
  height: 60% !important;
  width: auto !important;
  color: black !important;
}

/* WEAPONS - BOTTOM CENTER */
#weapon-selector {
  position: absolute !important;
  bottom: 8vh !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  width: 48vw !important;
  height: 12vh !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  pointer-events: auto !important;
}
#auto-label {
  position: absolute !important;
  bottom: calc(8vh + 12vh + 8px) !important; /* Above weapon selector */
  left: 50% !important;
  transform: translateX(-50%) !important;
  color: white !important;
  background: transparent !important;
  font-weight: bold !important;
  font-size: clamp(10px, 1.1vw, 14px) !important;
  border: none !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
.btn-util {
  width: 7vw !important;
  height: 7vw !important;
  min-width: 64px !important;
  min-height: 64px !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: none !important; /* No outline */
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: white !important;
}
#weapon-slots-wrap {
  display: flex !important;
  gap: 0.5vw !important;
  background: transparent !important;
  border: none !important;
}
.weapon-slot {
  width: 12vw !important;
  height: 9vh !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  background: transparent !important;
  border: none !important;
  color: white !important;
  border-radius: 0 !important;
  position: relative !important;
}
.weapon-slot.active {
  border: 1px solid white !important;
}
.weapon-slot.active::before {
  content: "" !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 0 !important;
  height: 0 !important;
  border-top: 15px solid white !important;
  border-right: 15px solid transparent !important;
}
#weapon-slot-1 { opacity: 1 !important; }
#weapon-slot-2 { opacity: 0.4 !important; }

/* ACTION BUTTONS (THUMB PAD) - BOTTOM RIGHT */
.btn-action {
  position: absolute !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: 1px solid white !important;
  pointer-events: auto !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: white !important;
}

#btn-fire-right {
  right: 3vw !important;
  bottom: 5vh !important;
  width: 13.5vw !important;
  height: 13.5vw !important;
  min-width: 100px !important;
  min-height: 100px !important;
}

#btn-ads {
  right: 20vw !important;
  bottom: 15vh !important;
  width: 6.75vw !important;
  height: 6.75vw !important;
  min-width: 60px !important;
  min-height: 60px !important;
}

#btn-reload {
  right: 8vw !important;
  bottom: 35vh !important;
  width: 5.25vw !important;
  height: 5.25vw !important;
  min-width: 45px !important;
  min-height: 45px !important;
}

#btn-jump {
  right: 22vw !important;
  bottom: 28vh !important;
  width: 6vw !important;
  height: 6vw !important;
  min-width: 50px !important;
  min-height: 50px !important;
}

#btn-crouch {
  right: 2vw !important;
  bottom: 25vh !important;
  width: 5.25vw !important;
  height: 5.25vw !important;
  min-width: 45px !important;
  min-height: 45px !important;
}

#btn-dash {
  right: 22vw !important;
  bottom: 2vh !important;
  width: 5.25vw !important;
  height: 5.25vw !important;
  min-width: 45px !important;
  min-height: 45px !important;
}

/* SVG Constraints */
#hud-container svg { width: 50% !important; height: 50% !important; color: white !important; pointer-events: none !important; }
#hud-container svg path, #hud-container svg g { fill: currentColor !important; }
#hud-container .btn-sidekick svg { width: 55% !important; height: 55% !important; }
#hud-container #btn-mic svg { width: 75% !important; height: 75% !important; }
#hud-container .weapon-slot svg { width: 95% !important; height: 85% !important; max-height: 85% !important; }
#hud-container .squad-circle svg { width: 70% !important; height: 70% !important; color: #22c55e !important; }
#hud-container .btn-util svg { width: 60% !important; height: 60% !important; }
#hud-container .btn-action svg { width: 55% !important; height: 55% !important; }
#hud-container #btn-reload svg { width: 100% !important; height: 100% !important; transform: translate(-2px, -2px) !important; }
#weapon-slot-1 svg, #weapon-slot-2 svg, #btn-fire-left svg, #btn-fire-right svg { transform: scaleX(-1) !important; }
#squad-container .squad-circle { border-color: #22c55e !important; }

/* CROSSHAIR */
#center-crosshair {
  position: absolute !important;
  top: 50% !important;
  left: 50% !important;
  transform: translate(-50%, -50%) !important;
  width: 0 !important;
  height: 0 !important;
  pointer-events: none !important;
  z-index: 40 !important;
}
.cross-line { position: absolute !important; background: white !important; }
</style>

<div id="hud-container">
  <div id="look-zone-right"></div>
  
  <div id="squad-container">
    <div id="squad-p1" class="squad-circle text-white">
      <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 136.000000 126.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,126.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M554 1130 c-144 -38 -186 -71 -200 -160 -7 -42 -6 -43 17 -36 13 3
65 13 114 22 107 19 361 14 463 -9 l63 -15 -6 42 c-15 90 -48 117 -186 156
-90 25 -172 25 -265 0z"/>
<path d="M485 935 c-110 -17 -151 -36 -158 -71 -3 -16 -4 -30 -2 -32 1 -2 43
5 91 15 156 31 466 24 597 -13 13 -4 17 1 17 18 0 44 -21 58 -120 78 -111 23
-299 25 -425 5z"/>
<path d="M465 835 c-49 -8 -109 -21 -132 -29 -44 -15 -193 -107 -214 -132 -14
-18 -31 -19 170 16 157 28 275 26 392 -4 183 -48 211 -50 366 -27 77 12 156
21 174 21 42 0 36 5 -82 73 -70 40 -116 59 -175 71 -112 24 -382 30 -499 11z"/>
<path d="M335 670 c-3 -5 -1 -46 5 -92 5 -45 10 -92 10 -103 -1 -18 -2 -17
-14 5 -25 46 -40 137 -28 165 11 24 10 25 -21 24 -17 0 -63 -6 -102 -13 l-70
-13 48 -21 c27 -12 59 -22 72 -22 29 0 41 -15 49 -63 5 -24 22 -55 45 -80 21
-24 49 -74 66 -117 23 -60 40 -85 89 -133 78 -76 126 -101 196 -101 69 -1 123
29 198 108 29 31 55 56 58 56 2 0 4 -13 4 -29 0 -30 20 -95 27 -88 2 3 -1 35
-8 71 -10 61 -9 72 11 129 13 34 38 78 56 97 22 23 37 53 45 88 11 44 17 54
38 58 43 10 141 56 141 66 0 10 -55 4 -143 -16 l-52 -11 -6 -60 c-5 -58 -25
-105 -42 -105 -5 0 -7 6 -4 13 3 8 8 44 12 80 6 56 5 67 -8 67 -11 0 -17 -16
-22 -62 -8 -80 -39 -198 -66 -250 -49 -96 -164 -181 -245 -181 -61 0 -144 53
-200 126 -60 80 -99 214 -106 359 -3 54 -17 75 -33 48z"/>
<path d="M403 212 c-1 -44 2 -60 7 -47 11 25 12 102 3 108 -5 3 -9 -25 -10
-61z"/>
</g>
</svg>
    </div>
    <div id="squad-p2" class="squad-circle text-white">
      <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 107.000000 137.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,137.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M442 1232 c-82 -30 -135 -74 -159 -131 -9 -20 -18 -76 -21 -125 -5
-85 -4 -89 14 -81 130 54 226 70 329 56 72 -11 163 -37 180 -52 20 -19 25 -7
25 54 0 111 -39 201 -105 244 -28 19 -114 48 -170 58 -11 2 -53 -9 -93 -23z"/>
<path d="M258 1150 c-61 -53 -85 -113 -94 -230 l-7 -93 39 28 c21 16 41 31 44
33 3 2 8 48 11 103 5 88 9 104 37 149 17 27 27 50 23 50 -5 0 -28 -18 -53 -40z"/>
<path d="M764 1168 c43 -59 59 -112 59 -196 l0 -84 38 -24 c21 -13 41 -24 44
-24 18 0 -13 198 -39 248 -16 31 -92 102 -109 102 -5 0 -2 -10 7 -22z"/>
<path d="M425 926 c-65 -15 -191 -64 -230 -90 -26 -17 -30 -32 -16 -55 8 -12
16 -10 50 7 23 12 58 31 79 42 145 76 334 66 498 -25 52 -29 68 -34 80 -25 24
21 16 38 -29 65 -125 72 -314 108 -432 81z"/>
<path d="M325 791 c-74 -10 -130 -33 -144 -59 -15 -29 -14 -116 3 -156 30 -72
222 -111 279 -58 14 13 31 37 37 53 17 40 40 36 73 -11 41 -58 77 -74 151 -66
131 14 184 68 172 174 -9 72 -18 87 -67 106 -33 13 -85 18 -243 21 -111 2
-228 0 -261 -4z m481 -40 c37 -14 54 -47 54 -101 0 -78 -21 -98 -121 -119 -71
-15 -96 -6 -144 53 -23 28 -46 46 -59 46 -12 0 -40 -20 -68 -51 l-47 -51 -70
4 c-85 4 -120 26 -137 85 -23 79 6 129 81 143 72 13 473 6 511 -9z"/>
<path d="M354 750 c-49 -3 -95 -10 -102 -14 -31 -19 -32 -124 -2 -161 15 -19
73 -35 124 -35 34 0 45 6 90 55 31 34 59 55 72 55 14 0 39 -20 69 -55 41 -48
51 -55 83 -55 57 1 113 16 134 38 28 27 27 117 0 144 -32 32 -243 45 -468 28z"/>
<path d="M124 705 c-31 -47 -5 -155 52 -216 13 -14 31 -51 39 -82 19 -74 51
-123 133 -206 95 -95 183 -116 287 -67 99 46 225 214 225 301 0 13 7 30 15 37
37 30 57 54 66 76 10 26 12 132 3 156 -13 33 -19 14 -19 -57 0 -86 -16 -125
-54 -129 -23 -3 -27 -10 -38 -68 -19 -92 -47 -143 -122 -220 -74 -76 -119 -96
-203 -88 -62 6 -114 42 -183 125 -43 53 -61 84 -76 138 -30 103 -36 115 -54
109 -28 -11 -58 78 -52 153 2 35 3 63 1 63 -2 0 -11 -11 -20 -25z"/>
</g>
</svg>
    </div>
    <div id="squad-p3" class="squad-circle text-white">
      <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 107.000000 137.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,137.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M500 1250 c-14 -4 -58 -18 -99 -31 -133 -41 -206 -136 -231 -298 -7
-40 -10 -75 -7 -77 2 -2 41 14 86 36 101 50 182 70 286 70 121 0 207 -25 368
-108 27 -14 -12 167 -54 249 -19 38 -71 85 -125 112 -24 12 -193 60 -198 56 0
-1 -12 -5 -26 -9z"/>
<path d="M424 920 c-54 -11 -193 -66 -223 -89 -22 -17 -22 -19 -8 -48 33 -64
38 -64 182 -13 82 30 96 32 180 27 65 -3 110 -12 160 -32 105 -40 119 -41 150
-11 41 41 31 65 -45 104 -129 65 -270 87 -396 62z"/>
<path d="M134 729 c-38 -42 -13 -178 41 -229 18 -17 25 -34 25 -60 0 -58 54
-152 133 -234 84 -86 121 -101 233 -94 85 6 120 26 205 123 72 81 84 103 99
184 8 47 19 71 39 92 49 49 68 182 32 218 -20 20 -52 19 -70 -3 -5 -6 -11 -40
-13 -76 -4 -52 -12 -77 -41 -125 -20 -33 -48 -72 -62 -88 l-26 -27 -40 32
c-39 31 -45 33 -136 35 -105 2 -135 -6 -175 -44 l-27 -26 -36 39 c-55 60 -105
167 -105 225 0 72 -37 101 -76 58z m50 -112 c8 -98 -2 -108 -28 -30 -19 55
-20 87 -5 115 17 32 26 10 33 -85z m744 23 c-2 -49 -9 -75 -21 -87 -16 -16
-17 -15 -17 23 0 77 12 134 27 134 12 0 15 -13 11 -70z m-280 -236 c30 -20 30
-68 0 -88 -30 -22 -55 -20 -68 4 -7 13 -21 20 -39 20 -15 0 -36 -9 -46 -20
-24 -26 -41 -25 -70 5 -30 29 -31 49 -5 75 17 17 33 20 113 20 68 0 99 -4 115
-16z"/>
</g>
</svg>
    </div>
    <div id="squad-p4" class="squad-circle text-white">
      <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 112.000000 122.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,122.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M488 1107 c-65 -19 -154 -75 -193 -122 -99 -120 -185 -375 -185 -544
0 -79 51 -165 135 -228 89 -67 101 -68 39 -2 -142 150 -143 172 -15 367 93
139 129 172 223 203 68 21 70 21 134 4 85 -23 141 -74 230 -207 124 -186 124
-218 -4 -350 -36 -38 -60 -68 -54 -68 6 0 44 27 85 59 112 89 138 156 118 306
-26 192 -116 413 -200 487 -93 83 -219 121 -313 95z"/>
<path d="M350 581 c0 -24 41 -51 75 -51 62 0 36 28 -52 54 -14 5 -23 3 -23 -3z"/>
<path d="M703 567 c-24 -11 -43 -25 -43 -29 0 -4 17 -8 38 -8 27 0 45 7 60 23
21 23 20 38 -2 36 -6 0 -30 -10 -53 -22z"/>
<path d="M246 512 c-10 -29 11 -89 35 -102 10 -6 19 -21 19 -33 0 -55 23 -100
86 -166 35 -38 80 -76 98 -85 46 -22 118 -20 165 4 71 36 181 183 181 242 0 9
11 34 25 54 25 36 33 88 16 98 -5 3 -11 -11 -15 -32 -3 -23 -16 -47 -31 -60
-17 -15 -25 -32 -25 -55 0 -43 -59 -136 -124 -196 l-48 -43 -68 4 c-59 3 -74
8 -107 34 -54 44 -120 144 -128 196 -4 23 -17 54 -30 68 -13 14 -28 41 -33 60
-8 32 -9 33 -16 12z"/>
</g>
</svg>
    </div>
  </div>

  <div id="hud-timer-container">
    <div id="hud-timer">TURN TIMER: 00:00</div>
    <div id="hud-location">LOCATION: CORE</div>
  </div>

  <div id="minimap-container">
    <canvas id="minimap-canvas"></canvas>
    <div id="minimap-players" style="position: absolute; inset: 0; pointer-events: none;">
      <div id="minimap-player-arrow" style="position: absolute; top: 50%; left: 50%; width: 20px; height: 20px; margin-top: -10px; margin-left: -10px; display: flex; align-items: center; justify-content: center; transform-origin: center;">
        <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 101.000000 116.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,116.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M491 1018 c-18 -47 -81 -199 -176 -423 -178 -421 -204 -485 -200
-485 8 0 331 154 350 167 11 7 29 13 40 13 12 0 103 -40 204 -90 100 -49 185
-90 187 -90 10 0 -8 44 -171 425 -89 209 -172 406 -184 438 -27 67 -38 77 -50
45z"/>
</g>
</svg>
      </div>
    </div>
  </div>
  <div id="minimap-label">CORE</div>

  <button id="btn-settings" class="btn-sidekick text-white">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 119.000000 117.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,117.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M501 1023 c-6 -21 -11 -44 -11 -51 0 -7 -19 -22 -42 -32 l-43 -19
-44 25 c-24 13 -49 24 -55 24 -17 0 -106 -93 -106 -110 0 -8 12 -31 26 -52 24
-35 25 -40 14 -70 -18 -46 -22 -49 -76 -59 -26 -5 -51 -15 -56 -22 -11 -18
-10 -115 2 -138 7 -12 26 -21 52 -25 79 -13 106 -70 64 -134 -14 -22 -26 -44
-26 -49 0 -14 47 -68 81 -91 l29 -21 46 27 c42 25 48 26 85 14 29 -10 41 -20
45 -39 22 -95 11 -86 101 -89 l81 -3 19 58 c16 53 21 59 59 72 39 14 42 13 80
-12 21 -15 43 -27 49 -27 16 0 105 94 105 110 0 8 -11 32 -24 54 -23 36 -23
40 -9 75 19 45 14 41 64 52 24 6 49 15 56 21 14 12 18 125 5 145 -5 7 -29 17
-56 22 -55 10 -50 6 -69 52 -15 35 -14 38 14 80 16 24 29 46 29 49 0 16 -95
110 -111 110 -11 0 -37 -12 -58 -26 l-39 -26 -45 20 c-41 18 -46 24 -57 71
l-12 51 -79 0 -78 0 -10 -37z m188 -271 c14 -10 39 -35 55 -56 28 -35 31 -44
31 -111 0 -67 -3 -77 -30 -111 -43 -52 -89 -74 -156 -74 -171 0 -253 206 -130
324 59 56 174 70 230 28z"/>
</g>
</svg>
  </button>
  <button id="btn-mic" class="btn-sidekick text-white">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 138.000000 138.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,138.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M602 1170 c-66 -41 -72 -62 -72 -283 0 -229 7 -255 80 -296 75 -42
160 -17 205 60 17 30 20 56 24 208 4 206 -4 245 -60 296 -34 31 -46 35 -92 35
-34 0 -63 -7 -85 -20z"/>
<path d="M416 775 c-21 -55 9 -164 61 -224 36 -42 119 -91 156 -91 14 0 17 -9
17 -50 l0 -50 -67 0 c-76 0 -97 -9 -91 -36 3 -18 16 -19 191 -22 161 -2 188 0
193 13 13 32 -15 45 -93 45 l-74 0 3 46 c3 46 4 47 46 60 121 35 199 148 190
274 -2 34 -7 46 -22 48 -26 5 -36 -14 -36 -70 0 -61 -11 -88 -56 -138 -72 -80
-203 -89 -287 -19 -50 41 -69 81 -76 159 -5 56 -9 65 -27 68 -13 2 -24 -4 -28
-13z"/>
</g>
</svg>
  </button>
  <button id="btn-chat" class="btn-sidekick text-white">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 117.000000 101.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,101.000000) scale(0.050000,-0.050000)"
fill="#ffffff" stroke="none">
<path d="M409 1752 c-173 -75 -193 -153 -185 -694 l6 -411 56 -74 c108 -141
117 -142 764 -149 l579 -6 106 -80 c158 -119 165 -119 166 -5 0 90 6 101 79
151 138 96 143 118 136 642 -9 694 48 654 -939 653 -542 0 -721 -7 -768 -27z
m386 -565 c56 -61 57 -107 4 -174 -80 -102 -259 -48 -259 78 0 156 149 212
255 96z m431 50 c149 -79 109 -277 -56 -277 -162 0 -204 193 -60 276 51 29 63
29 116 1z m546 -39 c45 -50 44 -147 -2 -198 -52 -57 -177 -55 -219 4 -109 156
95 334 221 194z"/>
</g>
</svg>
  </button>

  <div id="joystick-boundary">
    <div style="position: absolute; top: 4px; left: 50%; transform: translateX(-50%); width: 8px; height: 6px; background: white; clip-path: polygon(50% 0%, 0% 100%, 100% 100%);"></div>
    <div style="position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); width: 8px; height: 6px; background: white; clip-path: polygon(50% 100%, 0% 0%, 100% 0%);"></div>
    <div style="position: absolute; left: 4px; top: 50%; transform: translateY(-50%); width: 6px; height: 8px; background: white; clip-path: polygon(0% 50%, 100% 0%, 100% 100%);"></div>
    <div style="position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 6px; height: 8px; background: white; clip-path: polygon(100% 50%, 0% 0%, 0% 100%);"></div>
    <div id="joystick-knob"></div>
  </div>
  
  <button id="btn-fire-left" class="btn-action">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 165.000000 165.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,165.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M1387 1536 c-43 -19 -108 -52 -145 -74 -76 -46 -232 -160 -232 -170
0 -4 51 -59 114 -121 102 -102 117 -113 132 -101 33 28 173 251 205 327 17 43
34 99 37 126 6 59 -3 60 -111 13z"/>
<path d="M925 1220 l-29 -31 122 -122 122 -122 30 30 30 30 -123 123 -123 122
-29 -30z"/>
<path d="M536 838 l-306 -312 127 -128 c70 -71 133 -128 140 -128 13 0 605
620 601 630 -2 3 -60 60 -129 128 l-126 123 -307 -313z"/>
<path d="M141 445 c-17 -20 -31 -42 -31 -49 0 -38 209 -246 247 -246 10 0 36
14 57 31 l38 32 -133 133 c-74 74 -137 134 -140 134 -4 0 -21 -16 -38 -35z"/>
</g>
</svg>
  </button>

  <div id="auto-label">AUTO &rarr;</div>
  <button id="btn-walkie" class="btn-util" style="position: absolute; left: 26vw; bottom: 8vh;">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 74.000000 163.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,163.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M234 1512 c-7 -4 -13 -67 -17 -172 -3 -91 -8 -212 -12 -270 -6 -104
-6 -105 -43 -143 l-37 -38 -3 -198 c-3 -196 -3 -198 22 -246 24 -44 26 -58 26
-180 0 -111 3 -135 17 -146 12 -11 57 -14 190 -14 161 0 176 1 189 19 10 15
14 53 14 150 0 125 1 131 28 170 26 38 27 43 30 204 2 90 1 180 -3 198 -3 19
-23 54 -45 79 -26 30 -37 51 -33 64 8 33 -5 71 -25 71 -28 0 -42 -21 -42 -62
0 -37 -1 -38 -35 -38 l-35 0 0 50 c0 49 -1 50 -30 50 -29 0 -30 -1 -30 -50 l0
-50 -39 0 -40 0 -5 135 c-4 74 -8 197 -12 273 -5 137 -9 157 -30 144z m314
-694 c16 -16 16 -180 0 -196 -17 -17 -329 -17 -346 0 -16 16 -16 180 0 196 17
17 329 17 346 0z m2 -277 c17 -33 12 -89 -10 -111 -18 -18 -33 -20 -163 -20
-173 0 -187 6 -187 79 0 26 5 52 12 59 8 8 61 12 175 12 150 0 163 -1 173 -19z"/>
<path d="M233 504 c-3 -9 -2 -24 4 -33 9 -14 30 -16 139 -14 70 2 132 7 137
12 5 5 7 17 5 27 -3 17 -16 19 -141 22 -121 2 -138 1 -144 -14z"/>
</g>
</svg>
  </button>
  
  <div id="weapon-slots-wrap" style="position: absolute; left: 50%; transform: translateX(-50%); bottom: 8vh; display: flex; gap: 8px;">
    <div id="weapon-slot-1" class="weapon-slot active">
      <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 183.000000 107.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,107.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M748 918 l-3 -43 -60 -8 c-33 -5 -114 -11 -180 -13 -66 -2 -130 -6
-142 -9 -13 -3 -34 -23 -48 -45 l-25 -40 -73 0 c-108 0 -111 -3 -98 -129 6
-57 11 -129 11 -161 0 -64 16 -81 54 -57 12 8 33 17 48 20 17 5 30 17 38 39 6
18 30 85 52 148 22 63 49 123 60 133 17 15 43 17 188 17 130 0 169 -3 173 -13
3 -8 -8 -43 -23 -78 -16 -36 -35 -86 -42 -113 -16 -59 -17 -58 134 -121 108
-46 109 -46 208 -43 71 2 100 0 100 -9 0 -6 -20 -59 -45 -119 -25 -59 -45
-113 -45 -119 0 -11 67 -45 89 -45 7 0 51 97 115 253 8 20 22 40 29 43 8 3 17
19 21 35 9 45 74 180 93 195 12 9 52 13 126 14 100 0 109 2 114 20 3 12 14 20
27 21 70 3 71 4 74 32 3 26 1 27 -41 27 -50 0 -57 9 -57 68 0 19 -7 43 -16 53
-9 10 -19 33 -23 51 -4 19 -14 34 -24 36 -14 3 -17 -4 -17 -42 l0 -46 -348 0
c-193 0 -352 4 -357 9 -6 5 -19 11 -30 13 -13 2 -22 13 -25 32 -8 47 -28 43
-32 -6z m570 -74 c20 -6 23 -12 20 -48 l-3 -41 -57 -3 -58 -3 0 45 c0 34 4 46
18 49 27 7 55 7 80 1z m-309 -83 c11 -7 12 -17 5 -43 -10 -33 -10 -33 -71 -33
-34 0 -64 3 -68 7 -9 9 4 68 15 68 5 0 10 -10 12 -22 2 -12 8 -23 15 -25 7 -3
9 3 6 17 -4 13 0 26 8 31 18 11 60 11 78 0z m-750 -103 c-1 -36 -33 -121 -46
-126 -10 -3 -13 16 -13 72 l0 76 30 0 c25 0 30 -4 29 -22z m692 2 c46 0 47 -6
17 -81 -24 -62 -73 -119 -100 -119 -17 0 -78 26 -78 34 0 4 46 136 55 159 6
15 15 18 38 13 16 -3 47 -6 68 -6z"/>
</g>
</svg>
      <div id="weapon-1-ammo" style="position: absolute; bottom: 2px; left: 4px; margin: 0; font-size: clamp(8px, 1vw, 13px); font-weight: bold; border: none; background: transparent;">40/289</div>
    </div>
    <div id="weapon-slot-2" class="weapon-slot">
      <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 145.000000 105.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,105.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M293 920 c-3 -11 -11 -20 -19 -20 -8 0 -22 -28 -34 -67 -24 -79 -52
-113 -91 -113 -58 0 -46 -25 31 -63 85 -42 87 -84 14 -278 -56 -148 -67 -224
-35 -253 18 -16 38 -19 140 -20 73 -1 124 3 131 10 5 5 24 66 40 134 17 68 39
143 50 168 l20 44 52 -8 c72 -11 195 -5 235 11 40 17 51 38 59 111 4 33 12 62
18 66 6 4 80 8 164 8 84 0 173 5 198 11 l44 11 0 55 c0 38 4 55 15 59 18 7 22
104 4 104 -7 0 -22 11 -35 25 -26 29 -42 32 -50 10 -5 -13 -65 -15 -454 -15
-389 0 -449 2 -454 15 -8 22 -37 18 -43 -5z m342 -334 c10 -40 54 -96 76 -96
7 0 3 10 -10 24 -22 24 -44 92 -35 108 3 4 40 8 83 8 92 0 104 -9 99 -71 -5
-65 -37 -84 -141 -84 -45 0 -94 3 -108 7 -49 14 -62 93 -23 133 25 25 48 14
59 -29z"/>
</g>
</svg>
      <div id="weapon-2-ammo" style="position: absolute; bottom: 2px; left: 4px; margin: 0; font-size: clamp(8px, 1vw, 13px); font-weight: bold; border: none; background: transparent;">35/241</div>
    </div>
  </div>

  <button id="btn-medkit" class="btn-util" style="position: absolute; right: 26vw; bottom: 8vh;">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 128.000000 117.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,117.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M470 1030 c-15 -15 -20 -33 -20 -79 l0 -59 -141 -4 -141 -3 -29 -33
-29 -32 0 -319 0 -319 28 -30 c23 -24 40 -32 87 -37 50 -7 555 2 563 9 1 2 -5
19 -13 39 -46 109 19 260 130 302 59 23 156 17 213 -13 23 -12 45 -22 48 -22
3 0 4 90 2 200 l-3 200 -28 27 c-27 27 -31 28 -165 33 l-137 5 -3 55 c-2 39
-9 61 -24 78 -20 21 -29 22 -170 22 -135 0 -150 -2 -168 -20z m304 -46 c3 -9
6 -33 6 -55 l0 -39 -140 0 -140 0 0 48 c0 27 3 52 7 55 3 4 64 7 134 7 106 0
128 -3 133 -16z m-216 -279 c20 -9 47 -25 59 -37 l22 -21 35 31 c43 38 81 46
131 30 84 -28 110 -125 56 -209 -34 -53 -203 -219 -222 -219 -8 0 -61 46 -118
101 -132 130 -162 190 -127 257 19 36 48 61 82 72 41 12 40 12 82 -5z"/>
<path d="M943 441 c-127 -32 -185 -202 -107 -313 79 -112 249 -112 328 0 64
91 35 232 -58 287 -47 28 -114 38 -163 26z m95 -113 l3 -48 50 0 50 0 -3 -37
c-3 -38 -4 -38 -50 -41 l-47 -3 -3 -42 c-3 -41 -4 -42 -40 -45 l-38 -3 0 45 0
45 -47 3 c-48 3 -48 3 -51 41 l-3 37 50 0 51 0 0 51 0 50 38 -3 c37 -3 37 -3
40 -50z"/>
</g>
</svg>
  </button>

  <div id="health-plus-sq-wrap">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 width="100%" height="100%" viewBox="0 0 93.000000 94.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,94.000000) scale(0.100000,-0.100000)"
fill="currentColor" stroke="none">
<path d="M0 470 l0 -470 465 0 465 0 0 470 0 470 -465 0 -465 0 0 -470z m568
344 c20 -14 22 -23 22 -120 l0 -104 96 0 c134 0 134 0 134 -114 0 -119 -1
-120 -132 -124 l-98 -4 0 -103 c0 -129 -1 -130 -122 -130 -115 0 -118 4 -118
137 0 54 -3 98 -7 98 -5 0 -49 2 -99 3 -121 3 -124 6 -124 118 0 117 2 119
131 119 l99 0 0 104 c0 130 6 136 120 136 52 0 82 -5 98 -16z"/>
</g>
</svg>
  </div>

  <div id="health-bar">
    <div id="health-bar-fill"></div>
    <div id="health-text-wrap">
      <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 125.000000 126.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,126.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M335 1155 c-5 -2 -23 -6 -39 -10 -38 -8 -154 -119 -177 -170 -10 -22
-19 -54 -19 -71 0 -40 43 -105 119 -179 l61 -60 150 150 c83 82 150 155 150
161 0 13 -124 134 -160 156 -27 17 -69 28 -85 23z"/>
<path d="M852 1149 c-23 -7 -130 -107 -381 -357 -375 -373 -383 -382 -367
-466 14 -75 148 -203 225 -213 25 -3 50 1 72 12 47 23 695 670 721 719 30 59
21 112 -31 180 -47 60 -130 122 -176 129 -16 3 -45 1 -63 -4z m-252 -424 c16
-15 20 -14 51 4 58 35 118 20 139 -35 18 -47 0 -86 -80 -166 -41 -43 -81 -78
-88 -78 -17 0 -108 85 -144 134 -27 38 -38 97 -20 122 31 44 103 54 142 19z"/>
<path d="M807 452 c-81 -81 -147 -152 -147 -157 0 -16 142 -151 177 -169 67
-34 135 -12 220 71 82 80 105 163 64 230 -21 34 -149 173 -160 173 -3 0 -73
-66 -154 -148z"/>
</g>
</svg>
      <div id="health-text" style="margin: 0 4px;">100/100</div>
      <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 127.000000 128.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,128.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M274 1134 c-59 -39 -143 -134 -156 -177 -19 -63 1 -105 96 -203 l84
-87 151 152 c83 83 151 155 151 159 0 10 -138 144 -170 166 -38 25 -110 21
-156 -10z"/>
<path d="M853 1147 c-12 -7 -179 -169 -372 -360 -385 -382 -387 -385 -362
-469 18 -59 140 -182 198 -199 88 -25 92 -23 466 355 186 187 347 355 358 371
43 68 13 153 -87 245 -71 65 -147 87 -201 57z m-118 -272 c0 -31 -49 -28 -53
3 -3 20 0 23 25 20 20 -2 28 -8 28 -23z m-7 -79 c10 -14 27 -45 36 -70 25 -65
66 -74 87 -19 11 31 33 25 37 -10 5 -38 -29 -67 -76 -67 -44 0 -62 15 -86 75
-28 67 -70 98 -78 58 -3 -16 -6 -15 -26 5 -32 32 -14 52 43 52 34 0 48 -5 63
-24z m-150 -68 c7 -7 12 -20 12 -30 0 -10 17 -37 39 -61 50 -55 61 -77 61
-125 0 -45 -14 -61 -62 -69 -44 -7 -83 25 -102 82 -18 51 -58 84 -81 65 -8 -7
-15 -21 -15 -31 0 -26 -27 -24 -35 2 -5 14 0 30 13 48 16 21 27 26 63 25 36
-1 47 -6 71 -35 15 -18 28 -40 28 -49 0 -25 29 -60 51 -60 35 0 28 38 -19 111
-66 101 -63 98 -57 67 6 -32 -2 -36 -21 -10 -26 34 -11 82 26 82 9 0 21 -5 28
-12z m87 -23 c26 -25 33 -59 15 -70 -11 -7 -80 64 -80 83 0 21 40 13 65 -13z
m77 -82 c32 -31 36 -68 9 -83 -20 -10 -51 -4 -51 11 0 4 7 6 15 3 19 -8 19 4
0 36 -15 27 -20 60 -8 60 4 0 20 -12 35 -27z m-192 -188 c7 -8 23 -15 36 -15
26 0 27 -1 18 -24 -12 -32 -59 -10 -88 42 -10 17 19 15 34 -3z"/>
<path d="M829 455 c-79 -80 -145 -151 -147 -158 -1 -7 35 -49 81 -94 93 -91
127 -105 200 -83 48 14 150 107 178 162 23 46 25 115 3 148 -20 29 -156 170
-164 170 -4 0 -71 -65 -151 -145z"/>
</g>
</svg>
    </div>
  </div>

  <button id="btn-fire-right" class="btn-action">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 165.000000 165.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,165.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M1387 1536 c-43 -19 -108 -52 -145 -74 -76 -46 -232 -160 -232 -170
0 -4 51 -59 114 -121 102 -102 117 -113 132 -101 33 28 173 251 205 327 17 43
34 99 37 126 6 59 -3 60 -111 13z"/>
<path d="M925 1220 l-29 -31 122 -122 122 -122 30 30 30 30 -123 123 -123 122
-29 -30z"/>
<path d="M536 838 l-306 -312 127 -128 c70 -71 133 -128 140 -128 13 0 605
620 601 630 -2 3 -60 60 -129 128 l-126 123 -307 -313z"/>
<path d="M141 445 c-17 -20 -31 -42 -31 -49 0 -38 209 -246 247 -246 10 0 36
14 57 31 l38 32 -133 133 c-74 74 -137 134 -140 134 -4 0 -21 -16 -38 -35z"/>
</g>
</svg>
  </button>
  <button id="btn-ads" class="btn-action">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 123.000000 125.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,125.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M596 1123 c-4 -4 -6 -95 -6 -203 l1 -195 -44 -47 -44 -48 -199 -2
c-271 -4 -266 -22 6 -26 l206 -2 18 -31 c10 -17 27 -34 38 -38 18 -6 19 -18
21 -211 2 -186 4 -205 20 -208 16 -3 17 11 17 197 l0 200 45 46 46 45 199 0
c171 0 200 2 200 15 0 13 -29 15 -205 15 l-204 0 -16 30 c-8 16 -27 37 -40 46
l-25 16 0 204 c0 163 -3 204 -13 204 -8 0 -17 -3 -21 -7z"/>
<path d="M443 990 c-88 -41 -154 -106 -197 -194 -39 -78 -43 -96 -23 -96 7 0
25 28 40 63 15 35 41 79 57 99 34 42 118 99 173 119 20 7 37 19 37 26 0 20
-19 16 -87 -17z"/>
<path d="M700 1005 c0 -8 12 -18 28 -21 15 -4 55 -25 90 -47 71 -45 132 -122
152 -192 15 -54 46 -66 35 -12 -22 98 -110 203 -216 256 -69 34 -89 38 -89 16z"/>
<path d="M215 519 c-12 -18 56 -141 107 -192 47 -46 154 -107 191 -107 32 0
13 22 -36 40 -98 37 -171 109 -217 212 -22 51 -35 64 -45 47z"/>
<path d="M961 465 c-34 -81 -99 -148 -187 -191 -78 -39 -96 -60 -41 -49 87 19
196 109 239 197 36 73 43 98 26 98 -8 0 -25 -25 -37 -55z"/>
</g>
</svg>
  </button>
  <button id="btn-reload" class="btn-action">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 138.000000 138.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,138.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M650 808 c0 -11 86 -160 140 -245 16 -24 35 -30 45 -13 7 11 -15 49
-109 193 -47 71 -76 96 -76 65z"/>
<path d="M747 805 c-7 -18 9 -29 43 -29 18 -1 26 -7 28 -24 4 -28 29 -40 45
-22 9 9 2 20 -32 51 -46 41 -75 49 -84 24z m30 -12 c-4 -3 -10 -3 -14 0 -3 4
0 7 7 7 7 0 10 -3 7 -7z m73 -53 c0 -5 -5 -10 -11 -10 -5 0 -7 5 -4 10 3 6 8
10 11 10 2 0 4 -4 4 -10z"/>
<path d="M580 771 c0 -23 150 -273 168 -279 20 -6 14 44 -10 82 -89 140 -142
216 -150 216 -4 0 -8 -8 -8 -19z"/>
<path d="M510 738 c0 -22 153 -289 164 -285 21 7 18 49 -7 85 -13 20 -48 76
-78 124 -49 79 -79 108 -79 76z"/>
<path d="M491 537 c-17 -17 -14 -22 44 -67 44 -34 58 -40 69 -30 23 18 8 43
-21 35 -30 -7 -53 10 -53 40 0 26 -22 39 -39 22z m24 -17 c3 -5 1 -10 -4 -10
-6 0 -11 5 -11 10 0 6 2 10 4 10 3 0 8 -4 11 -10z"/>
</g>
</svg>
  </button>
  <button id="btn-jump" class="btn-action">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 109.000000 122.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,122.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M369 915 c-96 -109 -193 -219 -217 -245 -23 -27 -42 -51 -42 -54 0
-3 55 -7 123 -8 l122 -3 3 -248 2 -247 185 0 185 0 2 247 3 248 125 5 124 5
-189 215 c-105 118 -204 230 -221 248 l-30 35 -175 -198z"/>
</g>
</svg>
  </button>
  <button id="btn-crouch" class="btn-action">
    <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 152.000000 152.000000"
 preserveAspectRatio="xMidYMid meet">
<g transform="translate(0.000000,152.000000) scale(0.100000,-0.100000)"
fill="#ffffff" stroke="none">
<path d="M775 1388 c-26 -15 -42 -35 -60 -76 -13 -29 -12 -37 5 -78 11 -25 20
-48 20 -50 0 -2 -29 -4 -65 -4 -58 0 -65 2 -65 19 0 29 -15 34 -81 26 -48 -6
-59 -10 -59 -25 0 -27 -18 -30 -180 -31 -176 -1 -192 -4 -188 -33 3 -20 9 -21
181 -26 162 -5 180 -7 193 -24 8 -11 14 -32 14 -46 0 -37 16 -52 90 -85 143
-66 238 -128 240 -158 0 -5 -36 -45 -81 -90 -45 -45 -85 -92 -89 -103 -5 -13
0 -93 13 -199 18 -153 19 -178 6 -186 -42 -25 -44 -28 -32 -40 9 -9 28 -10 70
-3 l58 9 12 164 c7 91 15 171 17 178 3 7 47 34 98 59 l93 45 5 -128 5 -128 58
-103 c40 -70 56 -109 52 -122 -8 -25 13 -26 55 -5 48 25 47 47 -6 162 l-47
104 12 92 c6 51 14 106 16 122 2 17 14 57 26 90 54 151 4 372 -101 441 -23 15
-62 29 -92 33 -39 5 -52 11 -49 21 2 8 8 31 14 50 25 89 -79 173 -158 128z
m-65 -309 c46 -5 86 -12 89 -14 4 -5 -23 -81 -37 -103 -7 -9 -31 -4 -105 25
-96 36 -97 37 -97 70 0 31 2 33 33 33 18 0 71 -5 117 -11z"/>
</g>
</svg>
  </button>

  <div id="center-crosshair">
    <div class="cross-line" style="top: -0.6vw; left: -1px; width: 2px; height: 0.6vw; transform: translateY(-0.3vw);"></div>
    <div class="cross-line" style="top: 0; left: -1px; width: 2px; height: 0.6vw; transform: translateY(0.3vw);"></div>
    <div class="cross-line" style="left: -0.6vw; top: -1px; width: 0.6vw; height: 2px; transform: translateX(-0.3vw);"></div>
    <div class="cross-line" style="left: 0; top: -1px; width: 0.6vw; height: 2px; transform: translateX(0.3vw);"></div>
  </div>

</div>

  `;

  canvasContainer = document.getElementById("canvas-container") as HTMLDivElement;
  
  window.addEventListener("start-match", () => {
      const hud = document.getElementById("hud-container");
      if (hud) hud.style.setProperty("display", "block", "important");
      
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
      connectEngineSocket();
      
      // Transition state machine
      (window as any).gameState = "ACTIVE_MATCH"; 
      
      // Request Pointer Lock for desktop players
      if (!isMobileDevice) {
          const container = document.getElementById("canvas-container");
          if (container) {
              try {
                  const plPromise = container.requestPointerLock() as any;
                  if (plPromise && plPromise.catch) {}
              } catch (err) {}
          }
          
          try {
             document.documentElement.requestFullscreen();
          } catch(e) {}
      }
      
      const cloudUid = (window as any).vexPlayerUid;
      if (cloudUid) {
         const matchId = `M_${Math.floor(Math.random() * 1000000)}`;
         lockMatchSession(matchId, cloudUid).then(locked => {
             if (locked) {
                (window as any).vexMatchId = matchId;
                if(channel) channel.emit("start_match", { uid: cloudUid, matchId });
             }
         });
      }
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
  channel = createClientTransport();
  channel.connect(window.location.origin, 3000);
  channel.onConnect(() => {
        if (typeof (window as any).initDevMenu === "function") {
            (window as any).initDevMenu(channel, droneJitterMap);
        }
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
    
    currentTick = view.getUint32(0, true);
    const count = view.getUint16(4, true);
    const camCount = view.getUint16(6, true);
    
    let byteOffset = HEADER_SIZE;
    const now = performance.now();

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
          t: now, posX: px, posY: py, posZ: pz,
          rotX: rx, rotY: ry, rotZ: rz, rotW: rw,
          state, type
        });
        if (jitterBuffer.length > 10) jitterBuffer.shift();
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
    
    if (msg.type === "match_over" && msg.id === localPlayerId) {
       clientState = ClientState.GAME_OVER;
       document.exitPointerLock();
       const endScreen = document.getElementById("post-match-screen");
       const scoreEl = document.getElementById("summary-score");
       if (endScreen && scoreEl) {
          endScreen.style.display = "flex";
          scoreEl.innerText = String(playerScore);
       }
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
       window.location.reload();
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

  // Merged Zone indicators & PBR
  setupAreaCorridors();

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
  const weaponMeshGeom = new THREE.BoxGeometry(0.12, 0.15, 0.65);
  const brushMetal = new THREE.MeshStandardMaterial({ color: 0x1c212b, roughness: 0.1, metalness: 0.9 });
  playerWeaponMesh = new THREE.Mesh(weaponMeshGeom, brushMetal);
  camera.add(playerWeaponMesh);
};

// Merges area corridors elements dynamically
const setupAreaCorridors = () => {
  const textureLoader = new THREE.TextureLoader();
  const loadPBR = (basePath: string, prefix: string, repeatX: number, repeatY: number) => {
    const albedo = textureLoader.load(`${basePath}/${prefix}_diff_1k.jpg`);
    const normal = textureLoader.load(`${basePath}/${prefix}_nor_gl_1k.jpg`);
    const arm = textureLoader.load(`${basePath}/${prefix}_arm_1k.jpg`);
    
    albedo.colorSpace = THREE.SRGBColorSpace;

    [albedo, normal, arm].forEach(tex => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
    });
    
    const isWebGPU = renderer.constructor.name === "WebGPURenderer" || typeof (renderer as any).renderAsync === "function";
    const matParams = {
      map: albedo,
      normalMap: normal,
      roughnessMap: arm,
      aoMap: arm,
      metalnessMap: arm,
      metalness: 1.0,
      roughness: 1.0
    };
    return new THREE.MeshStandardMaterial(matParams);
  };

  const asphaltMaterial = loadPBR('/textures/asphalt_02', 'asphalt_02', 10, 100);
  const sidewalkMaterial = loadPBR('/textures/concrete_tiles_02', 'concrete_tiles_02', 2, 100);
  const brickMaterial = loadPBR('/textures/red_brick_03', 'red_brick_03', 6, 6);
  const rocksGroundMaterial = loadPBR('/textures/rocks_ground_01', 'rocks_ground_01', 20, 40);
  const rockyTrailMaterial = loadPBR('/textures/rocky_trail', 'rocky_trail', 20, 40);

  const gltfLoader = new GLTFLoader();
  gltfLoader.load('/assets/models/map.glb', (gltf) => {
    const mapRoot = gltf.scene;
    mapRoot.traverse((node: any) => {
      if (node.isMesh || node instanceof THREE.Mesh) {
        node.frustumCulled = false;
        const originalMat = node.material;
        node.material = new THREE.MeshBasicMaterial({
          map: originalMat.map,
          color: originalMat.color,
          transparent: originalMat.transparent,
          opacity: originalMat.opacity
        });
      }
    });
    scene.add(mapRoot);
  }, 
  (xhr) => {},
  (error) => {
    
    // Procedural Fallback Scene - PBR Materials
    
    // 0. The Outer Terrain
    const leftGround = new THREE.Mesh(new THREE.PlaneGeometry(100, 200), rocksGroundMaterial);
    leftGround.rotation.x = -Math.PI / 2;
    leftGround.position.set(-50, -0.05, 0); // slightly below road
    scene.add(leftGround);

    const rightGround = new THREE.Mesh(new THREE.PlaneGeometry(100, 200), rockyTrailMaterial);
    rightGround.rotation.x = -Math.PI / 2;
    rightGround.position.set(50, -0.05, 0); // slightly below road
    scene.add(rightGround);

    // 1. The Ground (Terrain)
    const roadPlane = new THREE.Mesh(new THREE.PlaneGeometry(10, 100), asphaltMaterial);
    roadPlane.rotation.x = -Math.PI / 2; // Rotate flat
    roadPlane.position.y = 0;
    scene.add(roadPlane);

    // 2. The Sidewalks
    const sidewalkLeft = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 100), sidewalkMaterial);
    sidewalkLeft.position.set(-5.5, 0.1, 0);
    scene.add(sidewalkLeft);

    const sidewalkRight = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 100), sidewalkMaterial);
    sidewalkRight.position.set(5.5, 0.1, 0);
    scene.add(sidewalkRight);

    // 3. The Buildings
    const buildingGeom = new THREE.BoxGeometry(5, 20, 15);
    const zPositions = [-40, 0, 40];
    
    zPositions.forEach((z) => {
      const bLeft = new THREE.Mesh(buildingGeom, brickMaterial);
      bLeft.position.set(-8.5, 10, z);
      scene.add(bLeft);

      const bRight = new THREE.Mesh(buildingGeom, brickMaterial);
      bRight.position.set(8.5, 10, z);
      scene.add(bRight);
    });
  });
};

// 4. Input & Controls binds (Zero allocations in trigger keys)
const setupControllerBinds = () => {
  canvasContainer!.addEventListener("click", () => {
    if (!isMouseLocked && !isMobileDevice) {
      try {
        const plPromise = canvasContainer!.requestPointerLock() as any;
        if (plPromise && plPromise.catch) {
        }
      } catch (err) {
      }
    } else {
      fireActiveShot();
    }
  });

  document.addEventListener("pointerlockchange", () => {
    isMouseLocked = document.pointerLockElement === canvasContainer;
  });

  document.addEventListener("mousemove", (e) => {
    if (isMouseLocked || isMobileDevice) {
      playerYaw -= e.movementX * 0.0022;
      playerPitch -= e.movementY * 0.0022;
      
      const limit = Math.PI * 0.48;
      playerPitch = Math.max(-limit, Math.min(limit, playerPitch));
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "w" || e.key === "W") keys.w = true;
    if (e.key === "a" || e.key === "A") keys.a = true;
    if (e.key === "s" || e.key === "S") keys.s = true;
    if (e.key === "d" || e.key === "D") keys.d = true;
    if (e.key === "Shift") keys.Shift = true;
    if (e.key === " ") keys.Space = true;
  });

  window.addEventListener("keyup", (e) => {
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
          e.preventDefault();
          e.stopPropagation();
          el.setPointerCapture(e.pointerId);
          activePointers.set(e.pointerId, { type: 'button', id });
          startHandler(e);
      });

      if (endHandler) {
          const handleEnd = (e: PointerEvent) => {
              e.preventDefault();
              e.stopPropagation();
              if (activePointers.has(e.pointerId)) {
                  activePointers.delete(e.pointerId);
                  el.releasePointerCapture(e.pointerId);
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
          e.preventDefault();
          e.stopPropagation();
          if (movePointerId !== null) return;
          
          joystickBoundary.setPointerCapture(e.pointerId);
          movePointerId = e.pointerId;
          joystickActive = true;
          activePointers.set(e.pointerId, { type: 'joystick' });
          
          const rect = joystickBoundary.getBoundingClientRect();
          startX = rect.left + rect.width / 2;
          startY = rect.top + rect.height / 2;
      };

      const moveJoystick = (e: PointerEvent) => {
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
          if (e.pointerId !== movePointerId) return;
          e.preventDefault();
          e.stopPropagation();
          
          activePointers.delete(e.pointerId);
          joystickBoundary.releasePointerCapture(e.pointerId);
          
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
          e.preventDefault();
          e.stopPropagation();
          if (lookPointerId !== null) return;
          
          lookZone.setPointerCapture(e.pointerId);
          lookPointerId = e.pointerId;
          isTouchingLookZone = true;
          lastTouchX = e.clientX;
          lastTouchY = e.clientY;
          activePointers.set(e.pointerId, { type: 'camera' });
      };

      const moveLook = (e: PointerEvent) => {
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
          if (e.pointerId !== lookPointerId) return;
          e.preventDefault();
          e.stopPropagation();
          
          activePointers.delete(e.pointerId);
          lookZone.releasePointerCapture(e.pointerId);
          
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
          keys.Ads = !keys.Ads;
          if (keys.Ads) {
              camera.fov = 45;
              adsBtn.classList.add("bg-white");
          } else {
              camera.fov = 75;
              adsBtn.classList.remove("bg-white");
          }
          camera.updateProjectionMatrix();
      });
  }

  safeBindTouch("btn-reload", () => {
      if (activeWeapon === 2 && !isReloading && ammo2 < maxAmmo2) {
         ammo2 = maxAmmo2;
         const a2 = document.getElementById("weapon-2-ammo");
         if (a2) a2.innerText = `${ammo2.toString().padStart(2, '0')}/241`;
      } else if (!isReloading && ammo1 < maxAmmo1) {
         ammo1 = maxAmmo1;
         const a1 = document.getElementById("weapon-1-ammo");
         if (a1) a1.innerText = `${ammo1.toString().padStart(2, '0')}/289`;
      }
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
          e.preventDefault();
          e.stopPropagation();
          el.setPointerCapture(e.pointerId);
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
          if (e.pointerId !== shootPointerId) return;
          e.preventDefault();
          e.stopPropagation();
          endCb();
          
          if (activePointers.has(e.pointerId)) {
              activePointers.delete(e.pointerId);
              el.releasePointerCapture(e.pointerId);
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
  const updateWeaponUI = () => {
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
      if (activeWeapon !== 1) activeWeapon = 1;
      else rifleMode = rifleMode === 'auto' ? 'burst' : 'auto';
      updateWeaponUI();
  });
  safeBindTouch("weapon-slot-2", () => {
      activeWeapon = 2;
      updateWeaponUI();
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

const fireActiveShot = () => {
    if (isReloading) return;
    if (activeWeapon === 1) {
        if (ammo1 <= 0) return;
        ammo1--;
        const a1 = document.getElementById("weapon-1-ammo");
        if (a1) a1.innerText = `${ammo1.toString().padStart(2, '0')}/289`;
    } else {
        if (ammo2 <= 0) return;
        ammo2--;
        const a2 = document.getElementById("weapon-2-ammo");
        if (a2) a2.innerText = `${ammo2.toString().padStart(2, '0')}/241`;
    }
    pendingFire = true;
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
    
    // Now offset the camera by the local smoothed crouch Y
    // Assume base worker playerPos.y is around ~1.2 or 0. Let's just track the Y relative
    camera.position.set(playerPos.x, playerPos.y + (localCrouchY - 1.2), playerPos.z);
    
    // Smooth aiming interpolation
    let targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(playerPitch, playerYaw, 0, "YXZ"));
    camera.quaternion.slerp(targetQuat, 20.0 * dt);
    
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
};

let diagnosticFrameCount = 0;
const diagTempMatrix = new THREE.Matrix4();
const diagTempPosition = new THREE.Vector3();
const diagTempScale = new THREE.Vector3();
const diagTempQuaternion = new THREE.Quaternion();

let animationFrameId = 0;

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
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        // 2. Camera Rotation Update
        if (isMobileDevice) {
            camera.quaternion.setFromEuler(new THREE.Euler(playerPitch, playerYaw, 0, 'YXZ'));
        } else if (isMouseLocked) {
            camera.quaternion.setFromEuler(new THREE.Euler(playerPitch, playerYaw, 0, 'YXZ'));
        }

        // 3. Movement & Physics Update
        if (typeof executeLocalClientPhysics === "function") {
            executeLocalClientPhysics(dt);
        }
        
        syncVisualProjectiles(dt);

        
        // Dead Reckoning Interpolator
        const droneCounts = [0,0,0,0,0,0,0];
        tempZeroScale.set(0, 0, 0);
        tempZeroPos.set(0, -9999, 0);

        droneJitterMap.forEach((buffer, id) => {
            if (buffer.length < 2) return;
            const latest = buffer[buffer.length - 1];
            if (latest.state === DroneState.DEAD) return;
            
            const targetTime = performance.now() - latency;
            let p0 = buffer[0], p1 = buffer[1];
            for (let i = buffer.length - 1; i >= 1; i--) {
                if (buffer[i].t >= targetTime && buffer[i - 1].t <= targetTime) {
                    p1 = buffer[i]; p0 = buffer[i - 1]; break;
                }
            }

            let t = 1.0;
            if (p1.t > p0.t) t = (targetTime - p0.t) / (p1.t - p0.t);
            t = Math.max(0, Math.min(1, t));

            diagTempPosition.set(
              p0.posX + (p1.posX - p0.posX) * t,
              p0.posY + (p1.posY - p0.posY) * t,
              p0.posZ + (p1.posZ - p0.posZ) * t
            );
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

        // 4. Weapon Position Sync
        if (playerWeaponMesh) {
            playerWeaponMesh.position.copy(camera.position);
            playerWeaponMesh.quaternion.copy(camera.quaternion);
            playerWeaponMesh.translateZ(-0.5);
            playerWeaponMesh.translateX(0.15);
            playerWeaponMesh.translateY(-0.15);
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
    initClient();
    initUIEditor();
});