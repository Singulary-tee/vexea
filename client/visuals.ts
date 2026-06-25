import * as THREE from "three/webgpu";
import { uv, float, smoothstep, length as tslLength, vec2, vec4, mix } from "three/tsl";
import { getSettings } from "./settings";
import { audioManager } from "./audio";
import { getAssetUrl } from "./asset-cache";

// Pre-allocated math objects for Zero-GC loops
const _vfxPos = new THREE.Vector3();
const _vfxDir = new THREE.Vector3();
const _vfxUp = new THREE.Vector3();
const _vfxRight = new THREE.Vector3();
const _vfxNormal = new THREE.Vector3();
const _vfxQuat = new THREE.Quaternion();
const _vfxScale = new THREE.Vector3();
const _vfxMatrix = new THREE.Matrix4();
const _vfxZAxis = new THREE.Vector3(0, 0, 1);
const _vfxCamFwd = new THREE.Vector3();
const _vfxCamUp = new THREE.Vector3(0, 1, 0);

const VISUAL_CONFIG: Record<string, any> = {
  High:   { decalSlots: 30, dustPerHit: 8,  sparksPerHit: 10, tracerSlots: 10, barrelSmokeSprites: 4,  flashLight: true  },
  Medium: { decalSlots: 15, dustPerHit: 4,  sparksPerHit: 5,  tracerSlots: 6,  barrelSmokeSprites: 2,  flashLight: false },
  Low:    { decalSlots: 0,  dustPerHit: 0,  sparksPerHit: 0,  tracerSlots: 4,  barrelSmokeSprites: 0,  flashLight: false },
} as const;

// Pool batch references
export let tracerBatch: THREE.BatchedMesh | null = null;
export let sparkBatch: THREE.BatchedMesh | null = null;
export let decalBatch: THREE.BatchedMesh | null = null;
export let dustBatch: THREE.BatchedMesh | null = null;
export let smokeBatch: THREE.BatchedMesh | null = null;
export let flashMesh: THREE.Mesh | null = null;
export let flashLight: THREE.PointLight | null = null;

// Pool slot counts
export let tracerSlots = 0;
export let sparksPerHitCount = 0;
export let decalSlots = 0;
export let dustPerHitCount = 0;
export let barrelSmokeCount = 0;

// Instance ID arrays
let tracerInstIds: Int32Array | null = null;
let sparkInstIds: Int32Array | null = null;
let decalInstIds: Int32Array | null = null;
let dustInstIds: Int32Array | null = null;
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
let sparkLife: Float32Array | null = null;
let sparkPosX: Float32Array | null = null;
let sparkPosY: Float32Array | null = null;
let sparkPosZ: Float32Array | null = null;
let sparkVelX: Float32Array | null = null;
let sparkVelY: Float32Array | null = null;
let sparkVelZ: Float32Array | null = null;

export let dustActive: Uint8Array | null = null;
let dustLife: Float32Array | null = null;
let dustPosX: Float32Array | null = null;
let dustPosY: Float32Array | null = null;
let dustPosZ: Float32Array | null = null;
let dustVelX: Float32Array | null = null;
let dustVelY: Float32Array | null = null;
let dustVelZ: Float32Array | null = null;

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
  
  const preset = getSettings().graphicsPreset || 'Medium';
  const cfg = VISUAL_CONFIG[preset] || VISUAL_CONFIG['Medium'];
  currentVisualConfig = cfg;

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
  const tracerAmber = vec4(1.0, 0.784, 0.165, 0.0);
  const tracerWhite = vec4(1.0, 1.0, 1.0, 0.0);
  const tracerColor = mix(tracerAmber, tracerWhite, smoothstep(float(0.3), float(0.7), tracerU));
  tracerMat.colorNode = vec4(tracerColor.x, tracerColor.y, tracerColor.z, tracerAlpha);

  // SPARK MAT
  const sparkMat = new THREE.MeshBasicNodeMaterial();
  sparkMat.transparent = true;
  sparkMat.blending = THREE.AdditiveBlending;
  sparkMat.depthWrite = false;
  sparkMat.side = THREE.DoubleSide;
  const sparkUV = uv().sub(vec2(0.5, 0.5));
  const sparkDist = tslLength(sparkUV).mul(float(2.0));
  const sparkCore = smoothstep(float(1.0), float(0.0), sparkDist);
  const sparkAmber = vec4(1.0, 0.533, 0.165, 0.0);
  const sparkWhite = vec4(1.0, 1.0, 1.0, 0.0);
  const sparkColor = mix(sparkAmber, sparkWhite, smoothstep(float(0.3), float(0.0), sparkDist));
  sparkMat.colorNode = vec4(sparkColor.x, sparkColor.y, sparkColor.z, sparkCore);

  // DUST MAT
  const dustMat = new THREE.MeshBasicNodeMaterial();
  dustMat.transparent = true;
  dustMat.depthWrite = false;
  dustMat.side = THREE.DoubleSide;
  const dustUV = uv().sub(vec2(0.5, 0.5));
  const dustDist = tslLength(dustUV).mul(float(2.0));
  const dustAlpha = smoothstep(float(1.0), float(0.2), dustDist).mul(float(0.7));
  const dustGrey = vec4(0.22, 0.22, 0.22, 0.0);
  dustMat.colorNode = vec4(dustGrey.x, dustGrey.y, dustGrey.z, dustAlpha);

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

  // FLASH MAT
  const flashMat = new THREE.MeshBasicNodeMaterial();
  flashMat.transparent = true;
  flashMat.blending = THREE.AdditiveBlending;
  flashMat.depthWrite = false;
  flashMat.side = THREE.DoubleSide;
  const flashUVNode = uv();
  const offsetNode = vec2(0.5, 0.5);
  const flashUV = flashUVNode.sub(offsetNode);
  const flashDist = tslLength(flashUV).mul(float(2.0));
  const flashAlpha = smoothstep(float(1.0), float(0.0), flashDist);
  flashMat.colorNode = vec4(float(1.0), float(1.0), float(1.0), flashAlpha);

  // DECAL MAT
  const decalTexture = new THREE.TextureLoader().load(getAssetUrl('Surface_Impact.png'));
  const decalMat = new THREE.MeshBasicNodeMaterial();
  decalMat.map = decalTexture;
  decalMat.transparent = true;
  decalMat.depthWrite = false;
  decalMat.polygonOffset = true;
  decalMat.polygonOffsetFactor = -4;
  decalMat.side = THREE.DoubleSide;

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

  sparksPerHitCount = cfg.sparksPerHit;
  if (sparksPerHitCount > 0) {
    const sSlots = sparksPerHitCount * 10;
    sparkInstIds = new Int32Array(sSlots);
    sparkActive = new Uint8Array(sSlots);
    sparkLife = new Float32Array(sSlots);
    sparkPosX = new Float32Array(sSlots);
    sparkPosY = new Float32Array(sSlots);
    sparkPosZ = new Float32Array(sSlots);
    sparkVelX = new Float32Array(sSlots);
    sparkVelY = new Float32Array(sSlots);
    sparkVelZ = new Float32Array(sSlots);

    sparkBatch = new THREE.BatchedMesh(sSlots, 4, 6, sparkMat);
    sparkBatch.name = "VFX_Spark";
    sparkBatch.frustumCulled = false;
    const _sparkGeom = new THREE.PlaneGeometry(0.08, 0.08);
    const _sparkGeomId = sparkBatch.addGeometry(_sparkGeom);
    for (let i = 0; i < sSlots; i++) {
        sparkInstIds[i] = sparkBatch.addInstance(_sparkGeomId);
        sparkBatch.setVisibleAt(sparkInstIds[i], false);
    }
    _scene.add(sparkBatch);
  }

  dustPerHitCount = cfg.dustPerHit;
  if (dustPerHitCount > 0) {
    const dSlots = dustPerHitCount * 8;
    dustInstIds = new Int32Array(dSlots);
    dustActive = new Uint8Array(dSlots);
    dustLife = new Float32Array(dSlots);
    dustPosX = new Float32Array(dSlots);
    dustPosY = new Float32Array(dSlots);
    dustPosZ = new Float32Array(dSlots);
    dustVelX = new Float32Array(dSlots);
    dustVelY = new Float32Array(dSlots);
    dustVelZ = new Float32Array(dSlots);

    dustBatch = new THREE.BatchedMesh(dSlots, 4, 6, dustMat);
    dustBatch.name = "VFX_Dust";
    dustBatch.frustumCulled = false;
    const _dustGeom = new THREE.PlaneGeometry(0.15, 0.15);
    const _dustGeomId = dustBatch.addGeometry(_dustGeom);
    for (let i = 0; i < dSlots; i++) {
        dustInstIds[i] = dustBatch.addInstance(_dustGeomId);
        dustBatch.setVisibleAt(dustInstIds[i], false);
    }
    _scene.add(dustBatch);
  }

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

  if (cfg.decalSlots > 0) {
    decalSlots = cfg.decalSlots;
    decalInstIds = new Int32Array(decalSlots);
    decalBatch = new THREE.BatchedMesh(decalSlots, 4, 6, decalMat);
    decalBatch.name = "VFX_Decal";
    decalBatch.frustumCulled = false;
    const _decalGeom = new THREE.PlaneGeometry(0.3, 0.3);
    const _decalGeomId = decalBatch.addGeometry(_decalGeom);
    for (let i = 0; i < decalSlots; i++) {
        decalInstIds[i] = decalBatch.addInstance(_decalGeomId);
        decalBatch.setVisibleAt(decalInstIds[i], false);
    }
    _scene.add(decalBatch);
  }
  
  const _flashGeom = new THREE.PlaneGeometry(0.6, 0.6);
  flashMesh = new THREE.Mesh(_flashGeom, flashMat);
  flashMesh.name = "VFX_Flash";
  flashMesh.visible = false;
  _scene.add(flashMesh);

  if (cfg.flashLight) {
    flashLight = new THREE.PointLight(0xFFF5E0, 0, 4);
    flashLight.visible = false;
    _scene.add(flashLight);
  }

  console.log('[VFX:INIT]', 'preset:', getSettings().graphicsPreset, 'tracerSlots:', tracerSlots, 'sparks:', sparksPerHitCount, 'decals:', decalSlots, 'dust:', dustPerHitCount);
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

export function triggerFlash(muzzlePos?: THREE.Vector3) {
  if (flashMesh) {
    flashLife = 3;
    flashMesh.visible = true;
    if (muzzlePos) {
      flashMesh.position.copy(muzzlePos);
    }
    if (flashLight) {
      flashLight.visible = true;
      flashLight.intensity = 8;
      if (muzzlePos) {
        flashLight.position.copy(muzzlePos);
      }
    }
  }
}

export function clearAllVisuals() {
  vfxInitialized = false;
  if (tracerBatch && tracerInstIds && tracerActive) {
    tracerActive.fill(0);
    for (let i = 0; i < tracerInstIds.length; i++) tracerBatch.setVisibleAt(tracerInstIds[i], false);
  }
  if (sparkBatch && sparkInstIds && sparkActive) {
    sparkActive.fill(0);
    for (let i = 0; i < sparkInstIds.length; i++) sparkBatch.setVisibleAt(sparkInstIds[i], false);
  }
  if (dustBatch && dustInstIds && dustActive) {
    dustActive.fill(0);
    for (let i = 0; i < dustInstIds.length; i++) dustBatch.setVisibleAt(dustInstIds[i], false);
  }
  if (smokeBatch && smokeInstIds && smokeActive) {
    smokeActive.fill(0);
    for (let i = 0; i < smokeInstIds.length; i++) smokeBatch.setVisibleAt(smokeInstIds[i], false);
  }
  if (decalBatch && decalInstIds) {
    for (let i = 0; i < decalInstIds.length; i++) decalBatch.setVisibleAt(decalInstIds[i], false);
    decalIndex = 0;
  }
  if (flashMesh) flashMesh.visible = false;
  if (flashLight) {
    flashLight.visible = false;
    flashLight.intensity = 0;
  }
  flashLife = 0;
}

export function spawnImpactSparks(x: number, y: number, z: number, sparksToSpawn: number) {
  if (!sparkBatch || !sparkActive || !sparkInstIds || sparksToSpawn <= 0) return;

  let activated = 0;
  for (let i = 0; i < sparkInstIds.length && activated < sparksToSpawn; i++) {
    if (!sparkActive[i]) {
      sparkActive[i] = 1;
      sparkLife![i] = 8;
      sparkPosX![i] = x;
      sparkPosY![i] = y;
      sparkPosZ![i] = z;
      
      const angle = Math.random() * Math.PI * 2;
      const elevation = Math.random() * Math.PI * 0.5;
      const speed = 2 + Math.random() * 6;
      sparkVelX![i] = Math.cos(angle) * Math.cos(elevation) * speed;
      sparkVelY![i] = Math.sin(elevation) * speed;
      sparkVelZ![i] = Math.sin(angle) * Math.cos(elevation) * speed;
      
      sparkBatch.setVisibleAt(sparkInstIds[i], true);
      activated++;
    }
  }
}

export function spawnEnvironmentDecalAndDust(ix: number, iy: number, iz: number) {
  if (!currentVisualConfig) return;

  if (decalBatch && decalInstIds && decalSlots > 0) {
    const dInstId = decalInstIds[decalIndex];
    _vfxPos.set(ix, iy + 0.01, iz);
    _vfxNormal.set(0, 1, 0);
    _vfxQuat.setFromUnitVectors(_vfxZAxis, _vfxNormal);
    _vfxScale.set(1, 1, 1);
    _vfxMatrix.compose(_vfxPos, _vfxQuat, _vfxScale);
    
    decalBatch.setMatrixAt(dInstId, _vfxMatrix);
    decalBatch.setVisibleAt(dInstId, true);
    
    decalIndex = (decalIndex + 1) % decalSlots;
  }
  
  if (dustBatch && dustActive && dustInstIds && dustPerHitCount > 0) {
    let activated = 0;
    for (let i = 0; i < dustInstIds.length && activated < dustPerHitCount; i++) {
      if (!dustActive[i]) {
        dustActive[i] = 1;
        dustLife![i] = 20;
        dustPosX![i] = ix;
        dustPosY![i] = iy;
        dustPosZ![i] = iz;
        
        const angle = Math.random() * Math.PI * 2;
        dustVelX![i] = Math.cos(angle) * (0.5 + Math.random() * 1.5);
        dustVelY![i] = 1.5 + Math.random() * 2.0;
        dustVelZ![i] = Math.sin(angle) * (0.5 + Math.random() * 1.5);
        
        dustBatch.setVisibleAt(dustInstIds[i], true);
        activated++;
      }
    }
  }
}

export function updateVFX(deltaTime: number, camera: THREE.PerspectiveCamera): void {
  // --- TRACER UPDATE ---
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
  
  // --- FLASH UPDATE ---
  if (flashMesh && flashLife > 0) {
    flashLife--;
    
    camera.getWorldPosition(_vfxPos);
    camera.getWorldDirection(_vfxDir);
    _vfxRight.setFromMatrixColumn(camera.matrixWorld, 0);
    _vfxCamUp.setFromMatrixColumn(camera.matrixWorld, 1);
    _vfxPos.addScaledVector(_vfxDir, 0.5);
    _vfxPos.addScaledVector(_vfxRight, 0.2);
    _vfxPos.addScaledVector(_vfxCamUp, -0.15);
    
    flashMesh.position.copy(_vfxPos);
    flashMesh.quaternion.copy(camera.quaternion);
    
    const fScale = flashLife / 3;
    flashMesh.scale.setScalar(fScale);
    
    if (flashLight) {
      flashLight.position.copy(_vfxPos);
      flashLight.intensity = 8 * fScale;
    }
    
    if (flashLife <= 0) {
      flashMesh.visible = false;
      if (flashLight) {
        flashLight.visible = false;
        flashLight.intensity = 0;
      }
    }
  }
  
  // --- SPARK UPDATE ---
  if (sparkBatch && sparkActive && sparkInstIds) {
    let sparkUpdateNeeded = false;
    for (let i = 0; i < sparkInstIds.length; i++) {
      if (!sparkActive[i]) continue;
      
      sparkLife![i]--;
      if (sparkLife![i] <= 0) {
        sparkActive[i] = 0;
        sparkBatch.setVisibleAt(sparkInstIds[i], false);
        sparkUpdateNeeded = true;
        continue;
      }
      
      sparkVelY![i] -= 9.81 * deltaTime;
      sparkPosX![i] += sparkVelX![i] * deltaTime;
      sparkPosY![i] += sparkVelY![i] * deltaTime;
      sparkPosZ![i] += sparkVelZ![i] * deltaTime;
      
      _vfxPos.set(sparkPosX![i], sparkPosY![i], sparkPosZ![i]);
      _vfxQuat.copy(camera.quaternion);
      const sAlpha = sparkLife![i] / 8;
      _vfxScale.setScalar(0.08 * sAlpha);
      
      _vfxMatrix.compose(_vfxPos, _vfxQuat, _vfxScale);
      sparkBatch.setMatrixAt(sparkInstIds[i], _vfxMatrix);
      sparkUpdateNeeded = true;
    }
    if (sparkUpdateNeeded && (sparkBatch as any).instanceMatrix) {
      (sparkBatch as any).instanceMatrix.needsUpdate = true;
    }
  }
  
  // --- DUST UPDATE ---
  if (dustBatch && dustActive && dustInstIds) {
    let dustUpdateNeeded = false;
    for (let i = 0; i < dustInstIds.length; i++) {
      if (!dustActive[i]) continue;
      
      dustLife![i]--;
      if (dustLife![i] <= 0) {
        dustActive[i] = 0;
        dustBatch.setVisibleAt(dustInstIds[i], false);
        dustUpdateNeeded = true;
        continue;
      }
      
      dustVelX![i] *= 0.95;
      dustVelZ![i] *= 0.95;
      dustPosX![i] += dustVelX![i] * deltaTime;
      dustPosY![i] += dustVelY![i] * deltaTime;
      dustPosZ![i] += dustVelZ![i] * deltaTime;
      
      _vfxPos.set(dustPosX![i], dustPosY![i], dustPosZ![i]);
      _vfxQuat.copy(camera.quaternion);
      const dProgress = 1 - (dustLife![i] / 20);
      _vfxScale.setScalar(0.1 + dProgress * 0.35);
      
      _vfxMatrix.compose(_vfxPos, _vfxQuat, _vfxScale);
      dustBatch.setMatrixAt(dustInstIds[i], _vfxMatrix);
      dustUpdateNeeded = true;
    }
    if (dustUpdateNeeded && (dustBatch as any).instanceMatrix) {
      (dustBatch as any).instanceMatrix.needsUpdate = true;
    }
  }
  
  // --- SMOKE UPDATE ---
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
      
      smokePosY![i] += 0.015;
      _vfxPos.set(smokePosX![i], smokePosY![i], smokePosZ![i]);
      _vfxQuat.copy(camera.quaternion);
      const sProgress = 1 - (smokeLife![i] / 30);
      _vfxScale.setScalar(0.1 + sProgress * 0.4);
      
      _vfxMatrix.compose(_vfxPos, _vfxQuat, _vfxScale);
      smokeBatch.setMatrixAt(smokeInstIds[i], _vfxMatrix);
      smokeUpdateNeeded = true;
    }
    if (smokeUpdateNeeded && (smokeBatch as any).instanceMatrix) {
      (smokeBatch as any).instanceMatrix.needsUpdate = true;
    }
  }
  
  if (decalBatch && (decalBatch as any).instanceMatrix) {
    (decalBatch as any).instanceMatrix.needsUpdate = true;
  }
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
        smokeLife![i] = 30;
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
