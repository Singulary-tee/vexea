import * as THREE from "three/webgpu";
import { uv, float, smoothstep, length as tslLength, vec2, vec4, mix } from "three/tsl";
import { VFX_CONSTANTS } from "./constants";
import { getAssetUrl } from "../../asset-cache";

// Pre-allocated math objects for Zero-GC loops
const _hitPos = new THREE.Vector3();
const _hitQuat = new THREE.Quaternion();
const _hitScale = new THREE.Vector3();
const _hitMatrix = new THREE.Matrix4();
const _hitZAxis = new THREE.Vector3(0, 0, 1);
const _hitNormal = new THREE.Vector3();

// Batches and config limits
export let sparkBatch: THREE.BatchedMesh | null = null;
export let dustBatch: THREE.BatchedMesh | null = null;
export let decalBatch: THREE.BatchedMesh | null = null;

let sparkSlotsCount = 0;
let dustSlotsCount = 0;
let decalSlotsCount = 0;

let sparkInstIds: Int32Array | null = null;
let dustInstIds: Int32Array | null = null;
let decalInstIds: Int32Array | null = null;

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

let decalIndex = 0;
let _scene: THREE.Scene;

// High-performance dynamic impact lights pool
export interface ImpactLight {
  light: THREE.PointLight;
  life: number;
  maxLife: number;
}

const impactLightsPool: ImpactLight[] = [];
const IMPACT_LIGHT_COUNT = 8;

export function initHitsVFX(scene: THREE.Scene, config: any) {
  _scene = scene;
  decalIndex = 0;

  // 1. SPARK MAT
  const sparkMat = new THREE.MeshBasicNodeMaterial();
  sparkMat.transparent = true;
  sparkMat.blending = THREE.AdditiveBlending;
  sparkMat.depthWrite = false;
  sparkMat.side = THREE.DoubleSide;
  const sparkUV = uv().sub(vec2(0.5, 0.5));
  const sparkDist = tslLength(sparkUV).mul(float(2.0));
  const sparkCore = smoothstep(float(1.0), float(0.0), sparkDist);
  const sparkAmber = vec4(1.0, 0.27, 0.0, 0.0); // DS.colors.accent normalized
  const sparkWhite = vec4(1.0, 1.0, 1.0, 0.0);
  const sparkColor = mix(sparkAmber, sparkWhite, smoothstep(float(0.3), float(0.0), sparkDist));
  sparkMat.colorNode = vec4(sparkColor.x, sparkColor.y, sparkColor.z, sparkCore);

  // 2. DUST MAT (Dirt / smoke debris)
  const dustMat = new THREE.MeshBasicNodeMaterial();
  dustMat.transparent = true;
  dustMat.depthWrite = false;
  dustMat.side = THREE.DoubleSide;
  const dustUV = uv().sub(vec2(0.5, 0.5));
  const dustDist = tslLength(dustUV).mul(float(2.0));
  const dustAlpha = smoothstep(float(1.0), float(0.2), dustDist).mul(float(0.7));
  const dustGrey = vec4(0.34, 0.28, 0.22, 0.0); // dirt/brown color
  dustMat.colorNode = vec4(dustGrey.x, dustGrey.y, dustGrey.z, dustAlpha);

  // 3. DECAL MAT
  const decalTexture = new THREE.TextureLoader().load(getAssetUrl('Surface_Impact.png'));
  const decalMat = new THREE.MeshBasicNodeMaterial();
  decalMat.map = decalTexture;
  decalMat.transparent = true;
  decalMat.depthWrite = false;
  decalMat.polygonOffset = true;
  decalMat.polygonOffsetFactor = VFX_CONSTANTS.HITS.DECAL_OFFSET_FACTOR;
  decalMat.side = THREE.DoubleSide;

  // Setup Sparks BatchedMesh
  const sparksPerHit = config.sparksPerHit || 0;
  if (sparksPerHit > 0) {
    sparkSlotsCount = sparksPerHit * 10;
    sparkInstIds = new Int32Array(sparkSlotsCount);
    sparkActive = new Uint8Array(sparkSlotsCount);
    sparkLife = new Float32Array(sparkSlotsCount);
    sparkPosX = new Float32Array(sparkSlotsCount);
    sparkPosY = new Float32Array(sparkSlotsCount);
    sparkPosZ = new Float32Array(sparkSlotsCount);
    sparkVelX = new Float32Array(sparkSlotsCount);
    sparkVelY = new Float32Array(sparkSlotsCount);
    sparkVelZ = new Float32Array(sparkSlotsCount);

    sparkBatch = new THREE.BatchedMesh(sparkSlotsCount, 4, 6, sparkMat);
    sparkBatch.name = "VFX_Spark";
    sparkBatch.frustumCulled = false;
    const _sparkGeom = new THREE.PlaneGeometry(VFX_CONSTANTS.HITS.SPARK_SIZE, VFX_CONSTANTS.HITS.SPARK_SIZE);
    const _sparkGeomId = sparkBatch.addGeometry(_sparkGeom);
    for (let i = 0; i < sparkSlotsCount; i++) {
      sparkInstIds[i] = sparkBatch.addInstance(_sparkGeomId);
      sparkBatch.setVisibleAt(sparkInstIds[i], false);
    }
    _scene.add(sparkBatch);
  }

  // Setup Dust BatchedMesh
  const dustPerHit = config.dustPerHit || 0;
  if (dustPerHit > 0) {
    dustSlotsCount = dustPerHit * 8;
    dustInstIds = new Int32Array(dustSlotsCount);
    dustActive = new Uint8Array(dustSlotsCount);
    dustLife = new Float32Array(dustSlotsCount);
    dustPosX = new Float32Array(dustSlotsCount);
    dustPosY = new Float32Array(dustSlotsCount);
    dustPosZ = new Float32Array(dustSlotsCount);
    dustVelX = new Float32Array(dustSlotsCount);
    dustVelY = new Float32Array(dustSlotsCount);
    dustVelZ = new Float32Array(dustSlotsCount);

    dustBatch = new THREE.BatchedMesh(dustSlotsCount, 4, 6, dustMat);
    dustBatch.name = "VFX_Dust";
    dustBatch.frustumCulled = false;
    const _dustGeom = new THREE.PlaneGeometry(VFX_CONSTANTS.HITS.DUST_SIZE_START, VFX_CONSTANTS.HITS.DUST_SIZE_START);
    const _dustGeomId = dustBatch.addGeometry(_dustGeom);
    for (let i = 0; i < dustSlotsCount; i++) {
      dustInstIds[i] = dustBatch.addInstance(_dustGeomId);
      dustBatch.setVisibleAt(dustInstIds[i], false);
    }
    _scene.add(dustBatch);
  }

  // Setup Decal BatchedMesh
  const decalSlots = config.decalSlots || 0;
  if (decalSlots > 0) {
    decalSlotsCount = decalSlots;
    decalInstIds = new Int32Array(decalSlotsCount);
    decalBatch = new THREE.BatchedMesh(decalSlotsCount, 4, 6, decalMat);
    decalBatch.name = "VFX_Decal";
    decalBatch.frustumCulled = false;
    const _decalGeom = new THREE.PlaneGeometry(VFX_CONSTANTS.HITS.DECAL_SIZE, VFX_CONSTANTS.HITS.DECAL_SIZE);
    const _decalGeomId = decalBatch.addGeometry(_decalGeom);
    for (let i = 0; i < decalSlotsCount; i++) {
      decalInstIds[i] = decalBatch.addInstance(_decalGeomId);
      decalBatch.setVisibleAt(decalInstIds[i], false);
    }
    _scene.add(decalBatch);
  }

  // Setup Impact PointLights Pool (Removed per user request)
  impactLightsPool.length = 0;
}

export function triggerImpactPointLight(x: number, y: number, z: number, intensity: number = 8.0) {
  // Removed per user request
}

export function spawnImpactSparks(x: number, y: number, z: number, count: number, nx: number = 0, ny: number = 1, nz: number = 0) {
  if (!sparkBatch || !sparkActive || !sparkInstIds || count <= 0) return;

  _hitNormal.set(nx, ny, nz).normalize();
  const normalQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), _hitNormal);
  const velocityVec = new THREE.Vector3();

  let activated = 0;
  for (let i = 0; i < sparkSlotsCount && activated < count; i++) {
    if (!sparkActive[i]) {
      sparkActive[i] = 1;
      sparkLife![i] = VFX_CONSTANTS.HITS.SPARK_LIFETIME;
      sparkPosX![i] = x;
      sparkPosY![i] = y;
      sparkPosZ![i] = z;
      
      const angle = Math.random() * Math.PI * 2;
      const elevation = Math.random() * Math.PI * 0.5;
      const speed = VFX_CONSTANTS.HITS.SPARK_SPEED_MIN + Math.random() * (VFX_CONSTANTS.HITS.SPARK_SPEED_MAX - VFX_CONSTANTS.HITS.SPARK_SPEED_MIN);
      
      // Generate standard velocity in hemisphere centered around +Y
      velocityVec.set(
        Math.cos(angle) * Math.cos(elevation) * speed,
        Math.sin(elevation) * speed,
        Math.sin(angle) * Math.cos(elevation) * speed
      );
      // Rotate to center around the actual surface normal
      velocityVec.applyQuaternion(normalQuat);

      sparkVelX![i] = velocityVec.x;
      sparkVelY![i] = velocityVec.y;
      sparkVelZ![i] = velocityVec.z;
      
      sparkBatch.setVisibleAt(sparkInstIds[i], true);
      activated++;
    }
  }
}

export function spawnEnvironmentDecalAndDust(ix: number, iy: number, iz: number, nx: number = 0, ny: number = 1, nz: number = 0) {
  _hitNormal.set(nx, ny, nz).normalize();

  if (decalBatch && decalInstIds && decalSlotsCount > 0) {
    const dInstId = decalInstIds[decalIndex];
    
    // Offset slightly along surface normal to fully prevent z-fighting with geometry
    _hitPos.set(ix + _hitNormal.x * 0.012, iy + _hitNormal.y * 0.012, iz + _hitNormal.z * 0.012);
    
    // Rotate to align with the surface normal vector
    _hitQuat.setFromUnitVectors(_hitZAxis, _hitNormal);
    
    // Give each decal a tiny randomized rotation around its normal (the local Z axis) so they look organic
    const randomAngle = Math.random() * Math.PI * 2;
    const tempRot = new THREE.Quaternion().setFromAxisAngle(_hitZAxis, randomAngle);
    _hitQuat.multiply(tempRot);

    _hitScale.set(1, 1, 1);
    _hitMatrix.compose(_hitPos, _hitQuat, _hitScale);
    
    decalBatch.setMatrixAt(dInstId, _hitMatrix);
    decalBatch.setVisibleAt(dInstId, true);
    
    decalIndex = (decalIndex + 1) % decalSlotsCount;
  }
  
  if (dustBatch && dustActive && dustInstIds && dustSlotsCount > 0) {
    const dustToSpawn = Math.floor(dustSlotsCount / 8);
    const dustQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), _hitNormal);
    const dustVec = new THREE.Vector3();

    let activated = 0;
    for (let i = 0; i < dustSlotsCount && activated < dustToSpawn; i++) {
      if (!dustActive[i]) {
        dustActive[i] = 1;
        dustLife![i] = VFX_CONSTANTS.HITS.DUST_LIFETIME;
        dustPosX![i] = ix;
        dustPosY![i] = iy;
        dustPosZ![i] = iz;
        
        const angle = Math.random() * Math.PI * 2;
        const dustSpeed = 1.0 + Math.random() * VFX_CONSTANTS.HITS.DUST_RISE_SPEED;
        
        // Push dust outward along the surface normal
        dustVec.set(
          Math.cos(angle) * (0.5 + Math.random() * VFX_CONSTANTS.HITS.DUST_SPREAD_SPEED),
          Math.random() * 0.5,
          Math.sin(angle) * (0.5 + Math.random() * VFX_CONSTANTS.HITS.DUST_SPREAD_SPEED)
        );
        dustVec.applyQuaternion(dustQuat);

        dustVelX![i] = dustVec.x;
        dustVelY![i] = dustVec.y + dustSpeed * 0.5; // add upward buoyancy
        dustVelZ![i] = dustVec.z;
        
        dustBatch.setVisibleAt(dustInstIds[i], true);
        activated++;
      }
    }
  }

  // Removed impact point light trigger per user request
}

export function updateHitsVFX(deltaTime: number, camera: THREE.PerspectiveCamera) {
  // Update Sparks
  if (sparkBatch && sparkActive && sparkInstIds) {
    let updateNeeded = false;
    for (let i = 0; i < sparkSlotsCount; i++) {
      if (!sparkActive[i]) continue;
      
      sparkLife![i]--;
      if (sparkLife![i] <= 0) {
        sparkActive[i] = 0;
        sparkBatch.setVisibleAt(sparkInstIds[i], false);
        updateNeeded = true;
        continue;
      }
      
      sparkVelY![i] -= VFX_CONSTANTS.HITS.SPARK_GRAVITY * deltaTime;
      sparkVelX![i] *= VFX_CONSTANTS.HITS.SPARK_DECAY_RATE;
      sparkVelZ![i] *= VFX_CONSTANTS.HITS.SPARK_DECAY_RATE;
      
      sparkPosX![i] += sparkVelX![i] * deltaTime;
      sparkPosY![i] += sparkVelY![i] * deltaTime;
      sparkPosZ![i] += sparkVelZ![i] * deltaTime;
      
      _hitPos.set(sparkPosX![i], sparkPosY![i], sparkPosZ![i]);
      _hitQuat.copy(camera.quaternion);
      
      const progress = sparkLife![i] / VFX_CONSTANTS.HITS.SPARK_LIFETIME;
      _hitScale.setScalar(VFX_CONSTANTS.HITS.SPARK_SIZE * progress);
      
      _hitMatrix.compose(_hitPos, _hitQuat, _hitScale);
      sparkBatch.setMatrixAt(sparkInstIds[i], _hitMatrix);
      updateNeeded = true;
    }
    if (updateNeeded && (sparkBatch as any).instanceMatrix) {
      (sparkBatch as any).instanceMatrix.needsUpdate = true;
    }
  }

  // Update Dust (Dirt / ground hits)
  if (dustBatch && dustActive && dustInstIds) {
    let updateNeeded = false;
    for (let i = 0; i < dustSlotsCount; i++) {
      if (!dustActive[i]) continue;
      
      dustLife![i]--;
      if (dustLife![i] <= 0) {
        dustActive[i] = 0;
        dustBatch.setVisibleAt(dustInstIds[i], false);
        updateNeeded = true;
        continue;
      }
      
      dustVelX![i] *= 0.95;
      dustVelZ![i] *= 0.95;
      dustPosX![i] += dustVelX![i] * deltaTime;
      dustPosY![i] += dustVelY![i] * deltaTime;
      dustPosZ![i] += dustVelZ![i] * deltaTime;
      
      _hitPos.set(dustPosX![i], dustPosY![i], dustPosZ![i]);
      _hitQuat.copy(camera.quaternion);
      
      const t = 1 - (dustLife![i] / VFX_CONSTANTS.HITS.DUST_LIFETIME); // 0 -> 1
      const scale = VFX_CONSTANTS.HITS.DUST_SIZE_START + t * (VFX_CONSTANTS.HITS.DUST_SIZE_END - VFX_CONSTANTS.HITS.DUST_SIZE_START);
      _hitScale.setScalar(scale);
      
      _hitMatrix.compose(_hitPos, _hitQuat, _hitScale);
      dustBatch.setMatrixAt(dustInstIds[i], _hitMatrix);
      updateNeeded = true;
    }
    if (updateNeeded && (dustBatch as any).instanceMatrix) {
      (dustBatch as any).instanceMatrix.needsUpdate = true;
    }
  }

  // Mark Decal update needed
  if (decalBatch && (decalBatch as any).instanceMatrix) {
    (decalBatch as any).instanceMatrix.needsUpdate = true;
  }
}

export function clearHitsVFX() {
  if (sparkBatch && sparkInstIds && sparkActive) {
    sparkActive.fill(0);
    for (let i = 0; i < sparkSlotsCount; i++) sparkBatch.setVisibleAt(sparkInstIds[i], false);
  }
  if (dustBatch && dustInstIds && dustActive) {
    dustActive.fill(0);
    for (let i = 0; i < dustSlotsCount; i++) dustBatch.setVisibleAt(dustInstIds[i], false);
  }
  if (decalBatch && decalInstIds) {
    for (let i = 0; i < decalSlotsCount; i++) decalBatch.setVisibleAt(decalInstIds[i], false);
    decalIndex = 0;
  }
  // Impact light clearing removed per user request
}
