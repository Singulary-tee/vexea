import * as THREE from "three/webgpu";
import { uv, float, smoothstep, length as tslLength, vec2, vec4, mix } from "three/tsl";
import { getSettings } from "../../settings";
import { MatchController } from "../../MatchController";

// Import modular VFX components
import { initFiringVFX, triggerNiagaraFlash, updateFiringVFX, clearFiringVFX, getFirstNiagaraFlash } from "./firing";
import { initHitsVFX, spawnImpactSparks as hitsSpawnSparks, spawnEnvironmentDecalAndDust as hitsSpawnDecal, updateHitsVFX, clearHitsVFX, sparkBatch as hitsSparkBatch, dustBatch as hitsDustBatch, decalBatch as hitsDecalBatch, sparkActive as hitsSparkActive, dustActive as hitsDustActive } from "./hits";
import { initLargeVFX, triggerExplosion, updateLargeVFX, clearLargeVFX } from "./large";
import { VFX_CONSTANTS } from "./constants";

// Pre-allocated math objects for Zero-GC loops
const _vfxPos = new THREE.Vector3();
const _vfxDir = new THREE.Vector3();
const _vfxUp = new THREE.Vector3();
const _vfxRight = new THREE.Vector3();
const _vfxCamFwd = new THREE.Vector3();
const _vfxCamUp = new THREE.Vector3(0, 1, 0);
const _vfxQuat = new THREE.Quaternion();
const _vfxScale = new THREE.Vector3();
const _vfxMatrix = new THREE.Matrix4();

const VISUAL_CONFIG: Record<string, any> = {
  High:   { decalSlots: 30, dustPerHit: 8,  sparksPerHit: 10, tracerSlots: 10, barrelSmokeSprites: 4,  flashLight: true  },
  Medium: { decalSlots: 15, dustPerHit: 4,  sparksPerHit: 5,  tracerSlots: 6,  barrelSmokeSprites: 2,  flashLight: true  },
  Low:    { decalSlots: 0,  dustPerHit: 0,  sparksPerHit: 0,  tracerSlots: 4,  barrelSmokeSprites: 0,  flashLight: false },
} as const;

// Pool batch references (bound/aliased for backwards compatibility)
export let tracerBatch: THREE.BatchedMesh | null = null;
export let sparkBatch: THREE.BatchedMesh | null = null;
export let decalBatch: THREE.BatchedMesh | null = null;
export let dustBatch: THREE.BatchedMesh | null = null;
export let smokeBatch: THREE.BatchedMesh | null = null;

// Kept for backward compatibility signatures but initialized to null
export let flashMesh: THREE.Mesh | null = null;
export let flashLight: THREE.PointLight | null = null;

// Re-export modular functions directly
export { triggerExplosion, getFirstNiagaraFlash };

// Pool slot counts
export let tracerSlots = 0;
export let sparksPerHitCount = 0;
export let decalSlots = 0;
export let dustPerHitCount = 0;
export let barrelSmokeCount = 0;

// Instance ID arrays
let tracerInstIds: Int32Array | null = null;
let smokeInstIds: Int32Array | null = null;

// Active/life flat typed arrays
export let tracerActive: Uint8Array | null = null;
let tracerLife: Float32Array | null = null;
let tracerPosX: Float32Array | null = null;
let tracerPosY: Float32Array | null = null;
let tracerPosZ: Float32Array | null = null;
let tracerDirX: Float32Array | null = null;
let tracerDirY: Float32Array | null = null;
let tracerDirZ: Float32Array | null = null;

export let sparkActive: Uint8Array | null = null;
export let dustActive: Uint8Array | null = null;

export let smokeActive: Uint8Array | null = null;
let smokeLife: Float32Array | null = null;
let smokePosX: Float32Array | null = null;
let smokePosY: Float32Array | null = null;
let smokePosZ: Float32Array | null = null;

export let decalIndex = 0;
export let flashLife = 0;
export let vfxInitialized = false;
export let currentVisualConfig: any = null;

let _scene: THREE.Scene;

export function getVFXInitialized(): boolean {
  return vfxInitialized;
}

export function getCurrentVisualConfig(): any {
  return currentVisualConfig;
}

export function initMatchVisuals(scene: THREE.Scene) {
  if (vfxInitialized) return;
  _scene = scene;
  
  const settings = getSettings();
  const preset = settings.graphicsPreset || 'Medium';
  const cfg = { ...(VISUAL_CONFIG[preset] || VISUAL_CONFIG['Medium']) };
  if (typeof settings.flashLight === 'boolean') {
    cfg.flashLight = settings.flashLight;
  }
  currentVisualConfig = cfg;

  // Initialize Modular Sub-systems
  initFiringVFX(scene, cfg.flashLight);
  initHitsVFX(scene, cfg);
  initLargeVFX(scene, cfg.flashLight);

  // Map references to hits module batches
  sparkBatch = hitsSparkBatch;
  dustBatch = hitsDustBatch;
  decalBatch = hitsDecalBatch;
  sparkActive = hitsSparkActive;
  dustActive = hitsDustActive;

  // TRACER MAT
  const tracerMat = new THREE.MeshBasicNodeMaterial();
  tracerMat.transparent = true;
  tracerMat.blending = THREE.AdditiveBlending;
  tracerMat.depthWrite = false;
  tracerMat.side = THREE.DoubleSide;
  const tracerU = uv().x;
  const tracerV = uv().y;
  const tracerAlphaU = smoothstep(float(0.0), float(0.18), tracerU).mul(smoothstep(float(1.0), float(0.82), tracerU));
  const tracerAlphaV = smoothstep(float(0.0), float(0.18), tracerV).mul(smoothstep(float(1.0), float(0.82), tracerV));
  const tracerAlpha = tracerAlphaU.mul(tracerAlphaV);
  const tracerAmber = vec4(1.0, 0.27, 0.0, 0.0); // DS.colors.accent normalized
  const tracerWhite = vec4(1.0, 1.0, 1.0, 0.0);
  const tracerColor = mix(tracerAmber, tracerWhite, smoothstep(float(0.3), float(0.7), tracerU));
  tracerMat.colorNode = vec4(tracerColor.x, tracerColor.y, tracerColor.z, tracerAlpha);

  // SMOKE MAT
  const smokeMat = new THREE.MeshBasicNodeMaterial();
  smokeMat.transparent = true;
  smokeMat.depthWrite = false;
  smokeMat.side = THREE.DoubleSide;
  const smokeUV = uv().sub(vec2(0.5, 0.5));
  const smokeDist = tslLength(smokeUV).mul(float(2.0));
  const smokeAlpha = smoothstep(float(1.0), float(0.1), smokeDist).mul(float(0.5));
  const smokeGrey = vec4(0.53, 0.53, 0.53, 0.0);
  smokeMat.colorNode = vec4(smokeGrey.x, smokeGrey.y, smokeGrey.z, smokeAlpha);

  // Setup tracer batch
  if (cfg.tracerSlots > 0) {
    tracerSlots = cfg.tracerSlots;
    tracerInstIds = new Int32Array(tracerSlots);
    tracerActive = new Uint8Array(tracerSlots);
    tracerLife = new Float32Array(tracerSlots);
    tracerPosX = new Float32Array(tracerSlots);
    tracerPosY = new Float32Array(tracerSlots);
    tracerPosZ = new Float32Array(tracerSlots);
    tracerDirX = new Float32Array(tracerSlots);
    tracerDirY = new Float32Array(tracerSlots);
    tracerDirZ = new Float32Array(tracerSlots);

    tracerBatch = new THREE.BatchedMesh(tracerSlots, 4, 6, tracerMat);
    tracerBatch.name = "VFX_Tracer";
    tracerBatch.frustumCulled = false;
    const _tracerGeom = new THREE.PlaneGeometry(1.0, 0.02);
    const _tracerGeomId = tracerBatch.addGeometry(_tracerGeom);
    for (let i = 0; i < tracerSlots; i++) {
        tracerInstIds[i] = tracerBatch.addInstance(_tracerGeomId);
        tracerBatch.setVisibleAt(tracerInstIds[i], false);
    }
    _scene.add(tracerBatch);
  }

  // Setup smoke batch
  barrelSmokeCount = cfg.barrelSmokeSprites;
  if (barrelSmokeCount > 0) {
    const smSlots = barrelSmokeCount;
    smokeInstIds = new Int32Array(smSlots);
    smokeActive = new Uint8Array(smSlots);
    smokeLife = new Float32Array(smSlots);
    smokePosX = new Float32Array(smSlots);
    smokePosY = new Float32Array(smSlots);
    smokePosZ = new Float32Array(smSlots);

    smokeBatch = new THREE.BatchedMesh(smSlots, 4, 6, smokeMat);
    smokeBatch.name = "VFX_Smoke";
    smokeBatch.frustumCulled = false;
    const _smokeGeom = new THREE.PlaneGeometry(0.12, 0.12);
    const _smokeGeomId = smokeBatch.addGeometry(_smokeGeom);
    for (let i = 0; i < smSlots; i++) {
        smokeInstIds[i] = smokeBatch.addInstance(_smokeGeomId);
        smokeBatch.setVisibleAt(smokeInstIds[i], false);
    }
    _scene.add(smokeBatch);
  }

  console.log('[VFX:INIT] Modular pipeline loaded successfully. Preset:', preset);
  vfxInitialized = true;
}

export function spawnTracer(muzzlePos: THREE.Vector3, direction: THREE.Vector3) {
  if (!vfxInitialized || !tracerBatch || !tracerActive || !tracerInstIds) return;

  let tSlot = -1;
  for (let i = 0; i < tracerSlots; i++) {
    if (!tracerActive[i]) { tSlot = i; break; }
  }
  if (tSlot !== -1) {
    tracerPosX![tSlot] = muzzlePos.x;
    tracerPosY![tSlot] = muzzlePos.y;
    tracerPosZ![tSlot] = muzzlePos.z;
    tracerDirX![tSlot] = direction.x;
    tracerDirY![tSlot] = direction.y;
    tracerDirZ![tSlot] = direction.z;
    tracerLife![tSlot] = 6;
    tracerActive![tSlot] = 1;
    tracerBatch.setVisibleAt(tracerInstIds[tSlot], true);
  }
}

export function triggerFlash(
  muzzlePos?: THREE.Vector3,
  scaleFactor = 1.0,
  attachToPlayer = false,
  attachToDroneId: number | null = null,
  match?: MatchController
) {
  if (!vfxInitialized || !muzzlePos) return;

  // 1. Point Camera direction Vector
  const camera = (window as any).camera;
  _vfxDir.set(0, 0, 1);
  if (camera) {
    camera.getWorldDirection(_vfxDir);
  }

  // 2. Trigger Advanced Niagara Muzzle Flash
  triggerNiagaraFlash(muzzlePos, _vfxDir, scaleFactor, attachToPlayer, attachToDroneId, match);
}

export function spawnImpactSparks(x: number, y: number, z: number, sparksToSpawn: number, nx = 0, ny = 1, nz = 0) {
  hitsSpawnSparks(x, y, z, sparksToSpawn, nx, ny, nz);
}

export function spawnEnvironmentDecalAndDust(ix: number, iy: number, iz: number, nx = 0, ny = 1, nz = 0) {
  hitsSpawnDecal(ix, iy, iz, nx, ny, nz);
}

export function spawnBarrelSmoke(camera: THREE.PerspectiveCamera, muzzlePos?: THREE.Vector3): void {
  if (smokeBatch && smokeActive && smokeInstIds && barrelSmokeCount > 0) {
    if (muzzlePos) {
      _vfxPos.copy(muzzlePos);
    } else {
      camera.getWorldPosition(_vfxPos);
      camera.getWorldDirection(_vfxDir);
      _vfxPos.addScaledVector(_vfxDir, 0.5);
      _vfxPos.y -= 0.15;
    }
    
    for (let i = 0; i < barrelSmokeCount; i++) {
      if (smokeInstIds[i] !== undefined) {
        smokeActive[i] = 1;
        smokeLife![i] = VFX_CONSTANTS.FIRING.SMOKE_LIFETIME;
        smokePosX![i] = _vfxPos.x + (Math.random() - 0.5) * 0.05;
        smokePosY![i] = _vfxPos.y;
        smokePosZ![i] = _vfxPos.z + (Math.random() - 0.5) * 0.05;
        smokeBatch.setVisibleAt(smokeInstIds[i], true);
      }
    }
    if ((smokeBatch as any).instanceMatrix) {
      (smokeBatch as any).instanceMatrix.needsUpdate = true;
    }
  }
}

export function updateVFX(deltaTime: number, camera: THREE.PerspectiveCamera, match?: MatchController): void {
  if (!vfxInitialized) return;

  // 1. Update modular components
  updateFiringVFX(deltaTime, camera, match);
  updateHitsVFX(deltaTime, camera);
  updateLargeVFX(deltaTime, camera);

  // 2. Update Tracers
  if (tracerBatch && tracerActive && tracerInstIds) {
    let tracerUpdateNeeded = false;
    for (let i = 0; i < tracerSlots; i++) {
      if (!tracerActive[i]) continue;
      
      tracerLife![i]--;
      if (tracerLife![i] <= 0) {
        tracerActive[i] = 0;
        tracerBatch.setVisibleAt(tracerInstIds[i], false);
        tracerUpdateNeeded = true;
        continue;
      }
      
      tracerPosX![i] += tracerDirX![i] * 120 * deltaTime;
      tracerPosY![i] += tracerDirY![i] * 120 * deltaTime;
      tracerPosZ![i] += tracerDirZ![i] * 120 * deltaTime;
      
      _vfxPos.set(tracerPosX![i], tracerPosY![i], tracerPosZ![i]);
      _vfxDir.set(tracerDirX![i], tracerDirY![i], tracerDirZ![i]);
      camera.getWorldDirection(_vfxCamFwd);
      
      _vfxUp.crossVectors(_vfxDir, _vfxCamFwd).normalize();
      if (_vfxUp.lengthSq() < 0.001) {
        _vfxCamUp.set(0, 1, 0);
        _vfxUp.crossVectors(_vfxDir, _vfxCamUp).normalize();
        if (_vfxUp.lengthSq() < 0.001) {
          _vfxUp.set(0, 1, 0);
        }
      }
      
      _vfxRight.crossVectors(_vfxDir, _vfxUp).normalize();
      _vfxMatrix.makeBasis(_vfxDir, _vfxUp, _vfxRight);
      _vfxQuat.setFromRotationMatrix(_vfxMatrix);
      
      const scaleX = (tracerLife![i] / 6) * 3.0 + 0.5;
      _vfxScale.set(scaleX, 1, 1);
      
      _vfxMatrix.compose(_vfxPos, _vfxQuat, _vfxScale);
      tracerBatch.setMatrixAt(tracerInstIds[i], _vfxMatrix);
      tracerUpdateNeeded = true;
    }
    if (tracerUpdateNeeded && (tracerBatch as any).instanceMatrix) {
      (tracerBatch as any).instanceMatrix.needsUpdate = true;
    }
  }

  // 3. Update Smoke
  if (smokeBatch && smokeActive && smokeInstIds) {
    let smokeUpdateNeeded = false;
    for (let i = 0; i < barrelSmokeCount; i++) {
      if (!smokeActive[i]) continue;
      
      smokeLife![i]--;
      if (smokeLife![i] <= 0) {
        smokeActive[i] = 0;
        smokeBatch.setVisibleAt(smokeInstIds[i], false);
        smokeUpdateNeeded = true;
        continue;
      }
      
      smokePosY![i] += VFX_CONSTANTS.FIRING.SMOKE_RISE_SPEED;
      _vfxPos.set(smokePosX![i], smokePosY![i], smokePosZ![i]);
      _vfxQuat.copy(camera.quaternion);
      const sProgress = 1 - (smokeLife![i] / VFX_CONSTANTS.FIRING.SMOKE_LIFETIME);
      _vfxScale.setScalar(0.1 + sProgress * VFX_CONSTANTS.FIRING.SMOKE_GROWTH_SPEED);
      
      _vfxMatrix.compose(_vfxPos, _vfxQuat, _vfxScale);
      smokeBatch.setMatrixAt(smokeInstIds[i], _vfxMatrix);
      smokeUpdateNeeded = true;
    }
    if (smokeUpdateNeeded && (smokeBatch as any).instanceMatrix) {
      (smokeBatch as any).instanceMatrix.needsUpdate = true;
    }
  }
}

export function clearAllVisuals() {
  vfxInitialized = false;

  // Clear modular systems
  clearFiringVFX();
  clearHitsVFX();
  clearLargeVFX();

  if (tracerBatch && tracerInstIds && tracerActive) {
    tracerActive.fill(0);
    for (let i = 0; i < tracerInstIds.length; i++) tracerBatch.setVisibleAt(tracerInstIds[i], false);
  }
  if (smokeBatch && smokeInstIds && smokeActive) {
    smokeActive.fill(0);
    for (let i = 0; i < smokeInstIds.length; i++) smokeBatch.setVisibleAt(smokeInstIds[i], false);
  }
  flashLife = 0;
}
