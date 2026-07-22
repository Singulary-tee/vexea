import * as THREE from "three/webgpu";
import { ClientTransport } from "./transport/adapter";
import { DroneState, DroneType } from "../shared/constants";
import { MinimapSystem } from "./src/systems/MinimapSystem";
import { NetworkSyncSystem } from "./src/systems/NetworkSyncSystem";
import { SimulationSystem } from "./src/systems/SimulationSystem";
import { CombatSystem } from "./src/systems/CombatSystem";
import { InputSystem } from "./src/systems/InputSystem";
import { DroneSystem } from "./src/systems/DroneSystem";
import { DiagnosisSystem } from "./src/systems/DiagnosisSystem";
import { HUDSystem } from "./src/systems/HUDSystem";
import { VisualsSystem } from "./src/systems/VisualsSystem";
import { ReconnectionSystem } from "./src/systems/ReconnectionSystem";
import { CameraEffectsSystem } from "./src/camera/CameraEffects";
import { CompassSystem } from "./src/systems/CompassSystem";


export interface NetworkDroneState {
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
  playerInFOV: boolean;
}

export class DroneRingBuffer {
  public states: NetworkDroneState[] = [
    { t: 0, posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, rotW: 1, state: 0, type: 0, playerInFOV: false },
    { t: 0, posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, rotW: 1, state: 0, type: 0, playerInFOV: false },
    { t: 0, posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, rotW: 1, state: 0, type: 0, playerInFOV: false }
  ];
  public head = 0;
  public count = 0;

  public push(t: number, posX: number, posY: number, posZ: number, rotX: number, rotY: number, rotZ: number, rotW: number, state: number, type: number, playerInFOV: boolean) {
    const s = this.states[this.head];
    s.t = t;
    s.posX = posX;
    s.posY = posY;
    s.posZ = posZ;
    s.rotX = rotX;
    s.rotY = rotY;
    s.rotZ = rotZ;
    s.rotW = rotW;
    s.state = state;
    s.type = type;
    s.playerInFOV = playerInFOV;
    this.head = (this.head + 1) % 3;
    if (this.count < 3) this.count++;
  }

  public getLatest(): NetworkDroneState {
    if (this.count === 0) return this.states[0];
    return this.states[(this.head - 1 + 3) % 3];
  }

  public get(index: number): NetworkDroneState {
    return this.states[(this.head - this.count + index + 3) % 3];
  }
}

export interface VisualInstance {
  batchedId: number;
  lastUpdate: number;
  audio?: THREE.PositionalAudio;
}

export interface PlayerHistoryNode {
  seq: number;
  time?: number;
  x: number;
  y: number;
  z: number;
  mask: number;
}

export interface RemotePlayerData {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  isAlive: boolean;
  isFiring: boolean;
  isReloading: boolean;
  weapon: string;
}

/**
 * MatchController: Transient process container for a single match session.
 * Created on join, destroyed on leave. Ensures zero-leak state isolation.
 */
import { PLAYER_TOTAL_HEIGHT, PLAYER_CENTER_OFFSET, PLAYER_EYE_LEVEL } from "../shared/constants";

export class MatchController {
  public active = false;
  public mapId: string = "";
  public scene: THREE.Scene;
  public physicsWorker: Worker | null = null;
  public physicsSAB: SharedArrayBuffer | null = null;
  public physicsData: Float32Array | null = null;
  private _transport: ClientTransport | null = null;
  public get transport(): ClientTransport | null {
    return this._transport;
  }
  public set transport(value: ClientTransport | null) {
    this._transport = value;
    if (value && this.networkSync) {
      this.networkSync.setupListeners();
    }
  }
  public animationFrameId: number | null = null;

  // Subsystems
  public minimap: MinimapSystem | null = null;
  public networkSync: NetworkSyncSystem | null = null;
  public simulation: SimulationSystem | null = null;
  public combat: CombatSystem | null = null;
  public input: InputSystem | null = null;
  public drones: DroneSystem | null = null;
  public diagnosis: DiagnosisSystem | null = null;
  public hud: HUDSystem | null = null;
  public compass: CompassSystem | null = null;
  public visuals: VisualsSystem | null = null;
  public reconnection: ReconnectionSystem | null = null;
  public cameraEffects: CameraEffectsSystem | null = null;


  // Match State
  public localPlayerId = "";
  public playerHP = 100;
  public playerScore = 0;
  public isLocalPlayerDead = false;
  public playerPos = new THREE.Vector3(0, PLAYER_CENTER_OFFSET, 10);
  public playerYaw = 0;
  public playerPitch = 0;
  public playerVel = new THREE.Vector3(0, 0, 0);
  public localGrounded = false;
  public localVy = 0.0;
  public localCrouchY = PLAYER_EYE_LEVEL;

  public isADS = false;
  public targetAdsLerp = 0.0;
  public currentAdsLerp = 0.0;
  public currentAccuracyHeat = 0.0;
  public visualRecoilUpOffset = 0.0;
  public visualRecoilSideOffset = 0.0;
  public lastCamShakeT = 0;
  public swayCycleTime = 0.0;

  public currentTick = 0;
  public lastPingTime = 0;
  public latency = 30;
  public serverTimeDelta = 0;
  public lastDroneTick = 0;
  public syncCameras: any[] = [];

  // Combat State
  public activeWeapon = 1;
  public ammo1 = 40;
  public maxAmmo1 = 40;
  public ammo2 = 35;
  public maxAmmo2 = 35;
  public isReloading = false;
  public lastPrimaryShotT = 0;
  public lastSecondaryShotT = 0;
  public fireSequenceNumber = 0;
  public pendingFire = false;
  public rifleMode: "auto" | "burst" = "auto";

  // Input/Touch State
  public activePointers = new Map<number, { type: string; id: string }>();
  public lookPointerId: number | null = null;
  public isTouchingLookZone = false;
  public lastTouchX = 0;
  public lastTouchY = 0;
  public updateWeaponUI: () => void = () => {};

  // Collections
  public moveHistory: PlayerHistoryNode[] = [];
  public droneJitterMap = new Map<number, DroneRingBuffer>();
  public activeGroundDrones = new Map<number, VisualInstance>();
  public activeAirDrones = new Map<number, VisualInstance>();
  public remotePlayersMeshes = new Map<string, THREE.Group>();
  public remotePlayersTargetData = new Map<string, RemotePlayerData>();
  public remotePlayerMixers = new Map<string, THREE.AnimationMixer>();
  public serverBulletPaths: { origin: THREE.Vector3, impact: THREE.Vector3, type: string, time: number }[] = [];

  // Pre-allocated math structures for Zero-GC loops
  public tempMoveDir = new THREE.Vector3();
  public tempUpAxis = new THREE.Vector3(0, 1, 0);
  public tempQuat = new THREE.Quaternion();
  public tempEuler = new THREE.Euler(0, 0, 0, "YXZ");
  public tempOffsetLocal = new THREE.Vector3();
  public tempQ0 = new THREE.Quaternion();
  public tempQ1 = new THREE.Quaternion();
  public tempMatrix = new THREE.Matrix4();
  public tempScale = new THREE.Vector3(1, 1, 1);
  public tempZeroScale = new THREE.Vector3(0, 0, 0);
  public tempZeroPos = new THREE.Vector3(0, -9999, 0);

  constructor() {
    this.scene = new THREE.Scene();
  }

  public async start(mapId: string) {
    if (this.active) return;
    this.active = true;
    this.mapId = mapId;
    console.log(`[MATCH] Starting match on map: ${mapId}`);
    
    // Initialize Subsystems
    this.minimap = new MinimapSystem(this);
    this.networkSync = new NetworkSyncSystem(this);
    this.simulation = new SimulationSystem(this);
    this.simulation.init();
    this.combat = new CombatSystem(this);
    this.input = new InputSystem(this, this.scene.userData.camera as THREE.PerspectiveCamera);
    this.input.init();
    this.drones = new DroneSystem(this);
    this.diagnosis = new DiagnosisSystem(this);
    this.diagnosis.init();
    this.drones.init();
    this.hud = new HUDSystem(this);
    this.hud.init();
    this.compass = new CompassSystem(this);
    this.compass.init();
    this.visuals = new VisualsSystem(this);
    this.visuals.init();
    this.cameraEffects = new CameraEffectsSystem(this);
    this.reconnection = new ReconnectionSystem(this);

    this.reconnection.init();
  }

  public stop() {
    if (!this.active) return;
    this.active = false;
    console.log(`[MATCH] Stopping match on map: ${this.mapId}`);

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    console.log(`[MATCH] Disposing match resources...`);
    this.dispose();
  }

  private dispose() {
    // 1. Terminate Simulation Subsystem
    if (this.simulation) {
      this.simulation.dispose();
      this.simulation = null;
    }

    // 2. Disconnect Transport
    if (this.transport) {
      console.log(`[MATCH] Disconnecting transport`);
      this.transport.disconnect();
      this.transport = null;
    }

    // 3. Deep disposal of Three.js Scene
    console.log(`[MATCH] Disposing scene objects`);
    this.scene.traverse((object: any) => {
      if (object.isMesh || object.isLine || object.isSprite || object.isPoints) {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((mat: any) => mat.dispose());
          } else {
            object.material.dispose();
          }
        }
      }
    });

    // 4. Clear collections to free memory
    this.moveHistory = [];
    this.droneJitterMap.clear();
    this.activeGroundDrones.clear();
    this.activeAirDrones.clear();
    
    this.remotePlayersMeshes.forEach((mesh, id) => {
        console.log(`[MATCH] Disposing remote player mesh: ${id}`);
        this.scene.remove(mesh);
        mesh.traverse((obj: any) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
                else obj.material.dispose();
            }
        });
    });
    this.remotePlayersMeshes.clear();
    this.remotePlayersTargetData.clear();
    
    this.remotePlayerMixers.forEach(mixer => mixer.stopAllAction());
    this.remotePlayerMixers.clear();

    if (this.minimap) {
        this.minimap.dispose();
        this.minimap = null;
    }
    
    if (this.networkSync) {
        this.networkSync.dispose();
        this.networkSync = null;
    }

    if (this.input) {
        this.input.dispose();
        this.input = null;
    }

    if (this.visuals) {
        this.visuals.dispose();
        this.visuals = null;
    }

    if (this.hud) {
        this.hud = null;
    }

    if (this.compass) {
        this.compass = null;
    }

    if (this.drones) {
        this.drones = null;
    }

    if (this.combat) {
        this.combat = null;
    }

    if (this.reconnection) {
        this.reconnection = null;
    }

    if (this.cameraEffects) {
        this.cameraEffects = null;
    }


    // 5. Reset primitives
    this.playerHP = 100;
    this.playerScore = 0;
    this.isLocalPlayerDead = false;
    this.currentTick = 0;
    
    console.log(`[MATCH] Match resources disposed.`);
  }
}

// Global accessor for current match (managed by main.ts)
let currentMatch: MatchController | null = null;

export function getMatch(): MatchController | null {
  return currentMatch;
}

export function createNewMatch(): MatchController {
  if (currentMatch) {
    currentMatch.stop();
  }
  currentMatch = new MatchController();
  return currentMatch;
}

export function clearMatch() {
    if (currentMatch) {
        currentMatch.stop();
        currentMatch = null;
    }
}
