(window as any).__MAIN_TS_LOADED__ = true;
// Diagnostics evaluated

declare global {
  interface Window {
    __forceWalk?: boolean;
    __teleported?: boolean;
  }
}

/**
 * VEXEA Authoritative Real-Time Clients Engine

 * Vanilla TypeScript client utilizing Three.js PBR, 3D Spatial Audio, and Jitter Buffers.
 * Rejects React overlays, ensuring strict Zero-GC 60fps thermal loops on Mobile.
 */

import "./index.css";
import "./dev_menu";
import { initSplash } from "./screens/splash";
import map1Spec from "../shared/maps/map_1_facility.spec.json";
import { initMainMenu } from "./screens/main-menu";
import { initLobby } from "./screens/lobby";
import { initDevMapEditor } from "./screens/dev-map-editor";
import { initDevEntities } from "./screens/dev-entities";
import { initMapViewerGlobally } from "./screens/map_viewer";
import * as screenManager from "./screens/screen-manager";
import { audioManager } from "./audio";
import { MapLoader } from "./src/map/MapLoader";
import { getMapById } from "../shared/maps/map-registry";
import { getAssetUrl } from "./asset-cache";
import { inputManager, InputAction } from "./input";
import { GlobalState } from "./state";
import { keys, tempInputBuffer, tempInputView, incrementInputSequence } from "./src/input/InputSynchronizer";

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
  dustBatch,
} from "./src/vfx/VFXOrchestrator";
import { hitscanSystem } from "./hitscan";

import * as THREE from "three/webgpu";
import {
  color,
  float,
  texture as tslTexture,
  time,
  oscSine,
  fog,
  rangeFogFactor,
  densityFogFactor,
  exponentialHeightFogFactor,
  max,
  uv,
  vec2,
  vec4,
  length as tslLength,
  smoothstep,
  mix,
} from "three/tsl";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { initDroneModels } from "./drone_models";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import {
  initPlayerWeapons,
  weaponsContainer,
  updateWeaponsContainer,
  applyWeaponRecoil,
  switchActiveWeaponModel,
  isSwitchingWeapon,
  getMuzzleWorldPosition,
  setWeaponReloading,
} from "./weapons_model";

(window as any).initPlayerWeapons = initPlayerWeapons;
import {
  getSettings,
  applySettings,
  openSettings,
  injectMatchTab,
  removeMatchTab,
} from "./settings";
import {
  initFirebase,
  testStorageUpload,
  authenticateAnonymously,
  fetchPlayerStats,
  savePlayerStats,
  lockMatchSession,
  unlockMatchSession,
  isFirebaseReady,
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
  DETAILED_WEAPONS,
} from "../shared/constants";

// State Tracker
import { createClientTransport, ClientTransport } from "./transport/adapter";
import { getMatch, createNewMatch, clearMatch } from "./MatchController";

let channel: ClientTransport | null = null;
export function getSocketChannel() { 
  const match = getMatch();
  return match ? match.transport : channel; 
}

// Match-specific network state moved to MatchController
// (latency, serverTimeDelta, currentTick, etc.)

// Expose player references for developer menu/cheats panel access
Object.defineProperty(window, 'playerPos', {
    get: () => {
        const match = getMatch();
        return match ? match.playerPos : null;
    },
    configurable: true
});
(window as any).getPlayerYaw = () => {
    const match = getMatch();
    return match ? match.playerYaw : 0;
};
(window as any).setPlayerYaw = (v: number) => { 
    const match = getMatch();
    if (match) match.playerYaw = v; 
};
(window as any).getPlayerPitch = () => {
    const match = getMatch();
    return match ? match.playerPitch : 0;
};
(window as any).setPlayerPitch = (v: number) => { 
    const match = getMatch();
    if (match) match.playerPitch = v; 
};
Object.defineProperty(window, 'playerVel', {
    get: () => {
        const match = getMatch();
        return match ? match.playerVel : null;
    },
    configurable: true
});
Object.defineProperty(window, 'isLocalPlayerDead', {
    get: () => {
        const match = getMatch();
        return match ? match.isLocalPlayerDead : false;
    },
    configurable: true
});
Object.defineProperty(window, '_physicsWorker', {
    get: () => {
        const match = getMatch();
        return match ? match.physicsWorker : null;
    },
    configurable: true
});
const isMobileDevice =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
let updateWeaponUI: () => void = () => {};
let lastFrameTime = performance.now();

// Pre-allocated math objects for weapon logic
const weaponFireDir = new THREE.Vector3();
const weaponFireRight = new THREE.Vector3();
const weaponFireUp = new THREE.Vector3();
const weaponMuzzlePos = new THREE.Vector3();

// Sound listeners and nodes pre-allocation
let audioListener: THREE.AudioListener | null = null;
let localLaserSound: THREE.Audio | null = null;
let shotBuffer: AudioBuffer | null = null;
let droneHumBuffer: AudioBuffer | null = null;

// Three.js Render Elements
export let renderer: any;
export let scene: THREE.Scene = new THREE.Scene();
export let camera: THREE.PerspectiveCamera;
export let gridHelper: THREE.GridHelper;

export let canvasContainer: HTMLDivElement | null = null;

// GLTF loaded models cache
export let riflemanModel: THREE.Group | null = null;
export let animatedDroneModel: THREE.Group | null = null;
export let wheeledDroneModel: THREE.Group | null = null;

// Dynamic weapon mechanics state variables
// Migrated to MatchController

// Dynamic laser lines
let laserLineSegments: THREE.LineSegments;
const laserPositions: number[] = [];
const laserColors: number[] = [];

// Match visual elements are imported from client/visuals.ts and initialized dynamically

// Initialize Game loop
const initClient = async () => {
  // 1. Core DOM setup
  const root = document.getElementById("root");
  if (!root) return;

  root.innerHTML = HUD_HTML;

  // Setup HUD Interaction listeners
  document.getElementById("btn-settings")?.addEventListener("click", () => {
    audioManager.play("click");
    openSettings();
  });

  const micBtn = document.getElementById("btn-mic");
  if (micBtn) {
    let micActive = false;
    micBtn.addEventListener("click", () => {
      audioManager.play("click");
      micActive = !micActive;
      if (micActive) {
        micBtn.classList.add("active");
        micBtn.style.color = "#FF4B4B"; // red indicator
      } else {
        micBtn.classList.remove("active");
        micBtn.style.color = "white";
      }
    });
  }

  const chatBtn = document.getElementById("btn-chat");
  if (chatBtn) {
    chatBtn.addEventListener("click", () => {
      audioManager.play("click");
      openSettings();
      setTimeout(() => {
        const tabChat = document.querySelector('.settings-tab[data-tab="MATCH"]') as HTMLElement;
        if (tabChat) tabChat.click();
      }, 50);
    });
  }

  const minimapContainer = document.getElementById("minimap-container");
  if (minimapContainer) {
    minimapContainer.addEventListener("click", () => {
      audioManager.play("click");
      minimapContainer.classList.toggle("fullscreen-minimap");
    });
  }

  canvasContainer = document.getElementById(
    "canvas-container",
  ) as HTMLDivElement;

  window.addEventListener("start-match", (e: any) => {
    const requestedMap = e.detail?.map?.id || "map_0_dev";
    (window as any).vexMapId = requestedMap;

    const match = createNewMatch();
    match.scene.userData.camera = camera;

    match.updateWeaponUI = () => {
      const w1 = document.getElementById("weapon-slot-1");
      const w2 = document.getElementById("weapon-slot-2");
      const autoLabel = document.getElementById("auto-label");
      if (w1) {
        w1.style.setProperty("opacity", "1", "important");
        if (match.activeWeapon === 1) w1.classList.add("active");
        else w1.classList.remove("active");
      }
      if (w2) {
        w2.style.setProperty("opacity", "1", "important");
        if (match.activeWeapon === 2) w2.classList.add("active");
        else w2.classList.remove("active");
      }
      if (autoLabel) {
        if (match.activeWeapon === 1)
          autoLabel.innerHTML = match.rifleMode === "auto" ? "AUTO &rarr;" : "BURST &rarr;";
        else autoLabel.innerHTML = "SINGLE &rarr;";
      }
    };

    match.start(requestedMap);
    match.updateWeaponUI();
    
    injectMatchTab();
    const cc = document.getElementById("canvas-container");
    if (cc) cc.style.display = "block";
    const hud = document.getElementById("hud-container");
    if (hud) hud.style.setProperty("display", "block", "important");

    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 10);

    (window as any)._serverMatchReady = false;

    const gltfLoader = new GLTFLoader();
    gltfLoader.load(getAssetUrl('bpre_rifleman.glb'), (gltf) => {
      riflemanModel = gltf.scene;
      riflemanModel.traverse((child) => {
        if ((child as any).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    });

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
    shotBuffer = audioCtx.createBuffer(
      1,
      bufferSize,
      audioCtx.sampleRate,
    );
    const data = shotBuffer.getChannelData(0);
    for (let s = 0; s < bufferSize; s++) {
      data[s] =
        Math.sin(2 * Math.PI * 800 * (s / audioCtx.sampleRate)) *
        Math.exp(-12 * (s / bufferSize));
    }
    localLaserSound.setBuffer(shotBuffer);
    (window as any).shotBuffer = shotBuffer;
    localLaserSound.setVolume(0.2);

    // Connect socket & boot views
    (window as any).gameState = "ACTIVE_MATCH";

    // Pointer lock and fullscreen requests moved synchronously to lobby 'READY' button direct click handler.

    const cloudUid = (window as any).vexPlayerUid;
    const matchId = `M_${Math.floor(Math.random() * 1000000)}`;

    connectEngineSocket().then(() => {
      if (channel) {
        channel.on("match_ready", () => {
          (window as any)._serverMatchReady = true;
        });
        match.transport = channel;
      }

      if (cloudUid) {
        lockMatchSession(matchId, cloudUid).then((locked) => {
          if (locked) {
            (window as any).vexMatchId = matchId;
            if (channel)
              channel.emit("start_match", {
                uid: cloudUid,
                matchId,
                mapId: requestedMap,
              });
          }
        });
      } else {
        (window as any).vexMatchId = matchId;
        if (channel)
          channel.emit("start_match", {
            uid: "guest_" + matchId,
            matchId,
            mapId: requestedMap,
          });
      }

      // Load map via MapLoader if not dev map
      if (requestedMap !== "map_0_dev") {
        const mapDef = getMapById(requestedMap);
        if (mapDef && channel) {
          import("./src/map/LoadingOrchestrator").then((m) => {
            const match = getMatch();
            if (match) m.orchestrateMatchLoad(mapDef, channel!, match.scene);
          });
        }
      } else {
        const mLoader = new MapLoader(match.scene);
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

  // Create scene synchronously so event listeners don't crash if dispatched early
  scene = new THREE.Scene();
  
  // TEMPORARY DIAGNOSTIC VISUAL - REMOVE AFTER COLLISION TEST
  const wallMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: false, transparent: true, opacity: 0.5 });
  const wallGeoms = [
    { size: [10, 6, 1], pos: [0, 1.5, 5] },
    { size: [10, 6, 1], pos: [0, 1.5, -5] },
    { size: [1, 6, 10], pos: [5, 1.5, 0] },
    { size: [1, 6, 10], pos: [-5, 1.5, 0] },
    { size: [800, 0.2, 800], pos: [0, -0.1, 0] }
  ];
  for (const w of wallGeoms) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]), wallMat);
    mesh.position.set(w.pos[0], w.pos[1], w.pos[2]);
    scene.add(mesh);
  }

  const grid = new THREE.GridHelper(800, 80, 0x444444, 0x222222);
  grid.position.y = 0.01;
  scene.add(grid);

  // Camera & Renderer
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 1.2, 10);
  camera.rotation.order = "YXZ";

  // MENU State initialization
  const ready = await initFirebase();
  if (ready) {
    const cloudUid = await authenticateAnonymously();
    if (cloudUid) {
      (window as any).vexPlayerUid = cloudUid;
      fetchPlayerStats(cloudUid).then((stats) => {
        if (stats) (window as any).vexCloudStats = stats;
      });
    }
  }

  // Initialize UI Screens
  initSplash();
  try {
     await audioManager.loadAll();
     audioManager.playNextMenuMusic();
  } catch(e) {}

  initMainMenu();
  initLobby();
  initDevMapEditor();
  // initDevEntities(); deferred until activation

  // 2. Setup Three.js Stage Pipeline
  await setup3DStage();

  // 3. Mount Listeners
  window.addEventListener("resize", handleWindowResize);

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
        const match = getMatch();
        (window as any).initDevMenu(channel, match ? match.droneJitterMap : new Map());
      }
      
      channel.on("match_ready", () => {
        console.log("[MAIN] Received match_ready from server.");
        (window as any)._serverMatchReady = true;
      });

      channel.on("dev_server_tick_ms", (data: any) => {
        (window as any).devServerTickMs = data.tickMs ?? 0;
      });
      channel.on("dev_server_memory_mb", (data: any) => {
        (window as any).devServerMemory = { heapUsedMb: data.heapUsedMb ?? 0, heapTotalMb: data.heapTotalMb ?? 0 };
      });

      resolve();
    });
  });
};

// 3. PBR Renderer Design

const rewardBtn = document.getElementById("rewarded-ad-btn");
if (rewardBtn) {
  rewardBtn.addEventListener("click", () => {
    const grantReward = () => {
      if (channel) channel.emit("rewarded_ad", {});
      rewardBtn.style.display = "none";
      rewardBtn.insertAdjacentHTML(
        "afterend",
        '<div class="text-green-400 font-bold mb-4">MULTIPLIER APPLIED!</div>',
      );
    };

    try {
      if (typeof (window as any).adBreak === "function") {
        (window as any).adBreak({
          type: "reward",
          name: "2x_multiplier",
          beforeReward: (showAdFn: any) => showAdFn(),
          adDismissed: () => {},
          adViewed: grantReward,
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
    const cc = document.getElementById("canvas-container");
    if (cc) cc.style.display = "none";
    const hc = document.getElementById("hud-container");
    if (hc) hc.style.display = "none";
    const do_ = document.getElementById("death-overlay");
    if (do_) do_.style.display = "none";
    const me = document.getElementById("post-match-screen");
    if (me) me.style.display = "none";
    const mm = document.getElementById("main-menu-screen");
    if (mm) mm.style.display = "flex";
  });
}

const setup3DStage = async () => {
  if (!scene) scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151b2c);

  const canvasContainer = document.getElementById("canvas-container");

  const s = getSettings();
  const reqType = s.rendererType || 'auto';
  
  let webgpuSupported = false;
  if (typeof navigator !== 'undefined' && (navigator as any).gpu !== undefined) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      webgpuSupported = adapter !== null;
    } catch (e) {
      webgpuSupported = false;
    }
  }

  console.log(`[Renderer] Requested renderer type: ${reqType}. WebGPU supported: ${webgpuSupported}`);

  // Always use WebGPURenderer to ensure TSL compatibility.
  // If WebGL is requested or WebGPU is not supported, pass forceWebGL: true to the WebGPURenderer.
  let forceWebGL = false;
  if (reqType === 'webgl' || !webgpuSupported) {
    forceWebGL = true;
    console.log("[Renderer] Initializing WebGPURenderer with WebGL 2 fallback backend (forceWebGL: true) to maintain TSL support.");
  } else {
    console.log("[Renderer] Initializing WebGPURenderer with WebGPU backend.");
  }

  try {
    renderer = new THREE.WebGPURenderer({
      antialias: false,
      powerPreference: "high-performance",
      forceWebGL: forceWebGL,
    });
    await renderer.init();
    (window as any).isWebGPU = !forceWebGL;
    console.log(`[Renderer] WebGPURenderer initialized successfully with ${forceWebGL ? 'WebGL' : 'WebGPU'} backend.`);

    renderer.domElement.addEventListener(
      "webglcontextlost",
      (e) => {
        e.preventDefault();
        cancelAnimationFrame(animationFrameId);
      },
      false,
    );
  } catch (e) {
    console.warn(
      "[Renderer] WebGPURenderer initialization failed. Attempting fallback to forceWebGL: true:",
      e,
    );
    if (!forceWebGL) {
      try {
        renderer = new THREE.WebGPURenderer({
          antialias: false,
          powerPreference: "high-performance",
          forceWebGL: true,
        });
        await renderer.init();
        (window as any).isWebGPU = false;
        console.log("[Renderer] WebGPURenderer initialized successfully with WebGL fallback backend (forceWebGL: true).");
      } catch (fallbackError) {
        console.error("[Renderer] Critical error: WebGL fallback also failed.", fallbackError);
        throw fallbackError;
      }
    } else {
      throw e;
    }
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
  if ((window as any).composer) {
    (window as any).composer.setSize(window.innerWidth, window.innerHeight);
    const pixelRatio = renderer.getPixelRatio();
    if ((window as any).fxaaPass) {
      (window as any).fxaaPass.material.uniforms["resolution"].value.x =
        1 / (window.innerWidth * pixelRatio);
      (window as any).fxaaPass.material.uniforms["resolution"].value.y =
        1 / (window.innerHeight * pixelRatio);
    }
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  const W = window as any;
  W.renderer = renderer;
  W.scene = scene;
  W.audioListener = audioListener;
  Object.defineProperty(W, 'activeGroundDrones', {
    get: () => {
        const match = getMatch();
        return match ? match.activeGroundDrones : new Map();
    },
    configurable: true
  });
  Object.defineProperty(W, 'activeAirDrones', {
    get: () => {
        const match = getMatch();
        return match ? match.activeAirDrones : new Map();
    },
    configurable: true
  });
  W.camera = camera;
  W.vexeaSettings = getSettings();
  applySettings(W.vexeaSettings);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  if (canvasContainer) {
    canvasContainer.appendChild(renderer.domElement);
    (window as any).__STAGE_MOUNTED__ = true;
  } else {
    throw new Error(
      "Canvas container element '#canvas-container' not found in DOM.",
    );
  }

  (window as any).weaponsContainer = weaponsContainer;
  (window as any).camera = camera;
  (window as any).triggerFlash = triggerFlash;
  (window as any).spawnTracer = spawnTracer;
};

// Merges area corridors elements dynamically

// 4. Input & Controls binds (Zero allocations in trigger keys)
const handleWindowResize = () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
};

let lastTime = performance.now();
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
      laserLineSegments.geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(laserPositions, 3),
      );
      laserLineSegments.geometry.attributes.position.needsUpdate = true;
    }
  } else {
    // dt update (unused logic maybe)
  }
};

let targetFpsRef = 0;
let diagnosticFrameCount = 0;
const diagTempMatrix = new THREE.Matrix4();
const diagTempPosition = new THREE.Vector3();
const diagTempScale = new THREE.Vector3();
const diagTempQuaternion = new THREE.Quaternion();

let animationFrameId = 0;

// updateVFX now fully handled inside client/visuals.ts

const animateFrame = async () => {
  const match = getMatch();
  if (!match) {
    animationFrameId = requestAnimationFrame(animateFrame);
    return;
  }
  (window as any).devSubsystems = (window as any).devSubsystems || { physics:0, droneInterp:0, vfx:0, minimap:0, weapons:0 };
  const t0 = performance.now();
  diagnosticFrameCount++;
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

    if (match.diagnosis) match.diagnosis.update();

    if (match.simulation) {
      match.simulation.step(dt);
    }

    if ((window as any).__vexMapLoader) {
      (window as any).__vexMapLoader.update(dt);
    }

    // 2. Camera Rotation & Dynamic Weapon Systems Update (Zero allocations in loop)
    const currentWeaponStats =
      match.activeWeapon === 1 ? DETAILED_WEAPONS.rifle : DETAILED_WEAPONS.pistol;

    // Dynamic recoil decay using exponential smoothing
    match.visualRecoilUpOffset =
      match.visualRecoilUpOffset *
      Math.exp(-currentWeaponStats.recoilRecoveryRate * dt * 2.0);
    match.visualRecoilSideOffset =
      match.visualRecoilSideOffset *
      Math.exp(-currentWeaponStats.recoilRecoveryRate * dt * 2.0);

    // Dynamic accuracy heat decay
    match.currentAccuracyHeat = Math.max(
      0,
      match.currentAccuracyHeat - dt * currentWeaponStats.coolRate,
    );

    // Break aiming immediately if switching weapon is in progress
    if (isSwitchingWeapon()) {
      match.isADS = false;
    }

    // ADS Lerp Zoom & FOV updates (Frame-Rate Independent)
    match.targetAdsLerp = match.isADS ? 1.0 : 0.0;
    match.currentAdsLerp +=
      (match.targetAdsLerp - match.currentAdsLerp) *
      (1.0 - Math.exp(-currentWeaponStats.adsTransitionSpeed * dt));

    const baseFov = 75; // Standard default base FOV
    camera.fov =
      baseFov *
      (1.0 - match.currentAdsLerp * (1.0 - currentWeaponStats.adsFovMultipier));
    camera.updateProjectionMatrix();

    // Calculate dynamic breath sway (zero allocation)
    match.swayCycleTime += dt * currentWeaponStats.swaySpeed;
    const swayIntensity =
      currentWeaponStats.swayAmplitude * match.currentAdsLerp * 1.5;
    const swayX = Math.sin(match.swayCycleTime) * swayIntensity;
    const swayY = Math.cos(match.swayCycleTime * 2.0) * swayIntensity * 0.5;

    // Visual Camera Shake (Smooth spring decay instead of harsh noise)
    let shakeOffsetPitch = 0;
    let shakeOffsetYaw = 0;
    const timeSinceShake = now - match.lastCamShakeT;
    if (timeSinceShake < currentWeaponStats.camShakeDurationMs) {
      const shakeFactor = Math.pow(
        1.0 - timeSinceShake / currentWeaponStats.camShakeDurationMs,
        2.0,
      );
      shakeOffsetPitch =
        Math.sin(timeSinceShake * 0.04) *
        currentWeaponStats.camShakeMagnitude *
        shakeFactor *
        0.3;
      shakeOffsetYaw =
        Math.cos(timeSinceShake * 0.05) *
        currentWeaponStats.camShakeMagnitude *
        shakeFactor *
        0.3;
    }

    const finalPitch =
      match.playerPitch + match.visualRecoilUpOffset + swayY + shakeOffsetPitch;
    const finalYaw =
      match.playerYaw + match.visualRecoilSideOffset + swayX + shakeOffsetYaw;

    camera.quaternion.setFromEuler(
      new THREE.Euler(finalPitch, finalYaw, 0, "YXZ"),
    );

    // 3. Movement & Physics Update
    if (match.input) {
      const _p0 = performance.now();
      match.input.step(dt);
      (window as any).devSubsystems.physics = performance.now() - _p0;
    }

    syncVisualProjectiles(dt);

    if (match.visuals) {
        const _v0 = performance.now();
        match.visuals.step(dt, camera);
        (window as any).devSubsystems.vfx = performance.now() - _v0;
    }

    if (match.drones) {
      const _d0 = performance.now();
      match.drones.step(dt);
      (window as any).devSubsystems.droneInterp = performance.now() - _d0;
    }

    // Render cameras
    let camActiveIdx = 0;
    let camDeadIdx = 0;
    const activeCameras = match.syncCameras || (window as any).syncCameras;
    if (
      activeCameras &&
      GlobalState.camActiveMesh &&
      GlobalState.camDeadMesh
    ) {
      for (let i = 0; i < activeCameras.length; i++) {
        const c = activeCameras[i];
        diagTempPosition.set(
          c.id < ZONES_ARRAY.length ? WAYPOINTS[ZONES_ARRAY[c.id]].x : 0,
          8,
          c.id < ZONES_ARRAY.length ? WAYPOINTS[ZONES_ARRAY[c.id]].z : 0,
        );
        diagTempQuaternion.set(0, 0, 0, 1);
        diagTempScale.set(1, 1, 1);
        diagTempMatrix.compose(diagTempPosition, diagTempQuaternion, diagTempScale);

        if (c.isActive) {
          if (camActiveIdx < 50) {
            GlobalState.camActiveMesh.setMatrixAt(
              camActiveIdx,
              diagTempMatrix,
            );
            camActiveIdx++;
          }
        } else {
          if (camDeadIdx < 50) {
            GlobalState.camDeadMesh.setMatrixAt(camDeadIdx, diagTempMatrix);
            camDeadIdx++;
          }
        }
      }
    }

    if (GlobalState.camActiveMesh) {
      for (let j = camActiveIdx; j < 50; j++) {
        diagTempMatrix.compose(match.tempZeroPos, diagTempQuaternion, diagTempScale);
        GlobalState.camActiveMesh.setMatrixAt(j, diagTempMatrix);
      }
    }
    if (GlobalState.camDeadMesh) {
      for (let j = camDeadIdx; j < 50; j++) {
        diagTempMatrix.compose(match.tempZeroPos, diagTempQuaternion, diagTempScale);
        GlobalState.camDeadMesh.setMatrixAt(j, diagTempMatrix);
      }
    }

    // 4. Weapon Position Sync (Smooth spring-recoil, breathing sway, and draw-holster animations)
    if (weaponsContainer) {
      const _w0 = performance.now();
      updateWeaponsContainer(dt, camera, match.isADS, match.currentAdsLerp, inputManager.moveX !== 0 || inputManager.moveZ !== 0);
      (window as any).devSubsystems.weapons = performance.now() - _w0;

      // Hide Center Crosshair dynamically when aiming down sights (ADS)
      const crosshair = document.getElementById("center-crosshair");
      if (crosshair) {
        // Smoothly fade out crosshair as match.currentAdsLerp approaches 1.0
        crosshair.style.opacity = Math.max(0, 1.0 - match.currentAdsLerp).toString();
        crosshair.style.display = match.currentAdsLerp > 0.9 ? "none" : "block";
      }

      // Toggle sprint button / running SVG display
      const btnSprint = document.getElementById("btn-sprint");
      if (btnSprint) {
        if ((window as any).isEditMode) {
          btnSprint.style.setProperty("display", "flex", "important");
        } else {
          btnSprint.style.setProperty("display", inputManager.isSprinting ? "flex" : "none", "important");
        }
      }
    }

    // 4.5 Minimap Arrow Rotation
    const arrow = document.getElementById("minimap-player-arrow");
    const spec = (window as any).__vexMapLoader?.spec;

    let minX = -80,
      maxX = 80,
      rangeX = 160;
    let minZ = -20,
      maxZ = 280,
      rangeZ = 300;

    if (spec) {
      minX = 0;
      rangeX = spec.worldSize.x;
      maxX = spec.worldSize.x;
      minZ = 0;
      rangeZ = spec.worldSize.z;
      maxZ = spec.worldSize.z;
    }

    if (arrow) {
      arrow.style.display = "flex";
      arrow.style.transform = `rotate(${-match.playerYaw}rad)`;
    }

    // 4.6 Minimap Draw
    if (match && match.minimap) {
      const _m0 = performance.now();
      match.minimap.update(dt, spec);
      (window as any).devSubsystems.minimap = performance.now() - _m0;
    }

    // 5. Render Step
    const tLogicEnd = performance.now();
    if ((window as any).isWebGPU && (window as any).renderPipeline) {
      (window as any).renderPipeline.render();
    } else if ((window as any).fxaaPass && (window as any).fxaaPass.enabled) {
      (window as any).composer.render();
    } else {
      renderer.render(match.scene, camera);
    }
    const tRenderEnd = performance.now();

    const logicTime = tLogicEnd - t0;
    const renderTime = tRenderEnd - tLogicEnd;

    if (typeof (window as any).updateDevPerf === "function")
      (window as any).updateDevPerf(renderer, lastTime, performance.now(), logicTime, renderTime);
  }
};

// =========================================================================
// PHYSICS DEV CUBE VISUALIZATIONS
// =========================================================================
let clientCubeMesh: THREE.Mesh | undefined;
let serverCubeMesh: THREE.Mesh | undefined;

(window as any).clientCubeTelemetry = null;
(window as any).serverCubeTelemetry = null;

(window as any).updateClientCubeMesh = (pos: { x: number, y: number, z: number }) => {
  if (!scene) return;
  if (!clientCubeMesh) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });
    clientCubeMesh = new THREE.Mesh(geometry, material);
    scene.add(clientCubeMesh);
  }
  clientCubeMesh.position.set(pos.x, pos.y, pos.z);
};

(window as any).removeClientCubeMesh = () => {
  if (clientCubeMesh && scene) {
    scene.remove(clientCubeMesh);
    clientCubeMesh.geometry.dispose();
    if (Array.isArray(clientCubeMesh.material)) {
      clientCubeMesh.material.forEach(m => m.dispose());
    } else {
      clientCubeMesh.material.dispose();
    }
    clientCubeMesh = undefined;
  }
};

(window as any).updateServerCubeMesh = (pos: { x: number, y: number, z: number }) => {
  if (!scene) return;
  if (!serverCubeMesh) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff3333,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });
    serverCubeMesh = new THREE.Mesh(geometry, material);
    scene.add(serverCubeMesh);
  }
  serverCubeMesh.position.set(pos.x, pos.y, pos.z);
};

(window as any).removeServerCubeMesh = () => {
  if (serverCubeMesh && scene) {
    scene.remove(serverCubeMesh);
    serverCubeMesh.geometry.dispose();
    if (Array.isArray(serverCubeMesh.material)) {
      serverCubeMesh.material.forEach(m => m.dispose());
    } else {
      serverCubeMesh.material.dispose();
    }
    serverCubeMesh = undefined;
  }
};

window.addEventListener("DOMContentLoaded", () => {
  initMapViewerGlobally();
  initClient();
  initUIEditor();
});

document.addEventListener("VEXEA_PLAYER_QUIT", () => {
  (window as any).removeClientCubeMesh?.();
  (window as any).removeServerCubeMesh?.();
  
  removeMatchTab();
  if (channel) {
    const c = channel;
    c.emit("PLAYER_QUIT", {});
    setTimeout(() => {
      c.disconnect();
    }, 100);
  }

  clearMatch();

  const cc = document.getElementById("canvas-container");
  if (cc) cc.style.display = "none";
  const hc = document.getElementById("hud-container");
  if (hc) hc.style.display = "none";
  const do_ = document.getElementById("death-overlay");
  if (do_) do_.style.display = "none";
  const me = document.getElementById("post-match-screen");
  if (me) me.style.display = "none";
  
  if ((window as any).__vexMapLoader) {
    (window as any).__vexMapLoader.dispose();
    (window as any).__vexMapLoader = undefined;
  }
  screenManager.showMainMenu();
  
  (window as any).gameState = "MENU";
  if (document.exitPointerLock) document.exitPointerLock();
});
