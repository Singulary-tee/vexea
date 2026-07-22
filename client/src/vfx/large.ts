import * as THREE from "three/webgpu";
import { uv, float, smoothstep, length as tslLength, vec2, vec4, mix } from "three/tsl";
import { VFX_CONSTANTS } from "./constants";

// Math caching for Zero-GC
const _largePos = new THREE.Vector3();
const _largeDir = new THREE.Vector3();
const _largeQuat = new THREE.Quaternion();
const _largeScale = new THREE.Vector3();
const _largeMatrix = new THREE.Matrix4();

export interface ExplosionInstance {
  pos: THREE.Vector3;
  light: THREE.PointLight | null;
  life: number;
  maxLife: number;
  scale: number;
  active: boolean;
}

const POOL_SIZE = 4;
const LARGE_LIGHTS_COUNT = 1; // Cap explosion point lights to 1 max
const explosionPool: ExplosionInstance[] = [];

// Fireballs/Plumes
export let fireBatch: THREE.BatchedMesh | null = null;
let fireInstIds: Int32Array | null = null;
export let fireActive: Uint8Array | null = null;
let fireLife: Float32Array | null = null;
let firePosX: Float32Array | null = null;
let firePosY: Float32Array | null = null;
let firePosZ: Float32Array | null = null;
let fireVelX: Float32Array | null = null;
let fireVelY: Float32Array | null = null;
let fireVelZ: Float32Array | null = null;

let _scene: THREE.Scene;

export function initLargeVFX(scene: THREE.Scene, hasLights: boolean) {
  _scene = scene;
  explosionPool.length = 0;

  // Fireball material with TSL (dynamic gradient heat map)
  const fireMat = new THREE.MeshBasicNodeMaterial();
  fireMat.transparent = true;
  fireMat.blending = THREE.AdditiveBlending;
  fireMat.depthWrite = false;
  fireMat.side = THREE.DoubleSide;

  const fireUV = uv().sub(vec2(0.5, 0.5));
  const fireDist = tslLength(fireUV).mul(float(2.0));
  const fireAlpha = smoothstep(float(1.0), float(0.1), fireDist);

  // Gradient: Inner hot white-yellow to deep orange-red
  const hotColor = vec4(1.0, 0.95, 0.6, 1.0);
  const midColor = vec4(1.0, 0.45, 0.05, 1.0);
  const coldColor = vec4(0.3, 0.1, 0.05, 0.0);
  
  const tempNode = smoothstep(float(0.8), float(0.1), fireDist);
  const tempMix = mix(coldColor, mix(midColor, hotColor, tempNode), smoothstep(float(1.0), float(0.3), fireDist));

  fireMat.colorNode = vec4(tempMix.x, tempMix.y, tempMix.z, fireAlpha);

  // Setup Fire BatchedMesh for explosion debris and flames
  const fSlots = POOL_SIZE * VFX_CONSTANTS.LARGE.FIRE_PARTICLES;
  fireInstIds = new Int32Array(fSlots);
  fireActive = new Uint8Array(fSlots);
  fireLife = new Float32Array(fSlots);
  firePosX = new Float32Array(fSlots);
  firePosY = new Float32Array(fSlots);
  firePosZ = new Float32Array(fSlots);
  fireVelX = new Float32Array(fSlots);
  fireVelY = new Float32Array(fSlots);
  fireVelZ = new Float32Array(fSlots);

  fireBatch = new THREE.BatchedMesh(fSlots, 4, 6, fireMat);
  fireBatch.name = "VFX_Large_Fire";
  fireBatch.frustumCulled = false;
  const _fireGeom = new THREE.PlaneGeometry(VFX_CONSTANTS.LARGE.FIRE_SIZE, VFX_CONSTANTS.LARGE.FIRE_SIZE);
  const _fireGeomId = fireBatch.addGeometry(_fireGeom);
  for (let i = 0; i < fSlots; i++) {
    fireInstIds[i] = fireBatch.addInstance(_fireGeomId);
    fireBatch.setVisibleAt(fireInstIds[i], false);
  }
  _scene.add(fireBatch);

  // Create Explosion instances
  for (let i = 0; i < POOL_SIZE; i++) {
    let light: THREE.PointLight | null = null;
    if (hasLights && i < LARGE_LIGHTS_COUNT) {
      light = new THREE.PointLight(
        VFX_CONSTANTS.FIRING.LIGHT_COLOR,
        0,
        VFX_CONSTANTS.LARGE.EXPLOSION_LIGHT_DISTANCE,
        1.5
      );
      // Keep PointLights visible at all times under WebGPU, setting intensity to 0 when inactive.
      light.visible = true;
      _scene.add(light);
    }

    explosionPool.push({
      pos: new THREE.Vector3(),
      light,
      life: 0,
      maxLife: VFX_CONSTANTS.LARGE.EXPLOSION_LIFETIME,
      scale: 1.0,
      active: false
    });
  }
}

export function triggerExplosion(pos: THREE.Vector3, scale = 1.0) {
  let inst: ExplosionInstance | null = null;
  for (let i = 0; i < POOL_SIZE; i++) {
    if (!explosionPool[i].active) {
      inst = explosionPool[i];
      break;
    }
  }

  if (!inst && explosionPool.length > 0) {
    inst = explosionPool[0]; // Recycle first
  }

  if (inst) {
    inst.active = true;
    inst.pos.copy(pos);
    inst.life = VFX_CONSTANTS.LARGE.EXPLOSION_LIFETIME;
    inst.scale = scale;

    if (inst.light) {
      inst.light.position.copy(pos);
      inst.light.intensity = VFX_CONSTANTS.LARGE.EXPLOSION_LIGHT_INTENSITY * scale;
    }

    // Spawn expanding fireball particles
    const fireCount = VFX_CONSTANTS.LARGE.FIRE_PARTICLES;
    let spawned = 0;
    const fSlots = POOL_SIZE * fireCount;
    for (let i = 0; i < fSlots && spawned < fireCount; i++) {
      if (!fireActive![i]) {
        fireActive![i] = 1;
        fireLife![i] = VFX_CONSTANTS.LARGE.FIRE_LIFETIME;
        firePosX![i] = pos.x + (Math.random() - 0.5) * 0.4 * scale;
        firePosY![i] = pos.y + (Math.random() - 0.5) * 0.4 * scale;
        firePosZ![i] = pos.z + (Math.random() - 0.5) * 0.4 * scale;

        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        const speed = (1.5 + Math.random() * 3.5) * scale;
        fireVelX![i] = Math.sin(phi) * Math.cos(theta) * speed;
        fireVelY![i] = Math.sin(phi) * Math.sin(theta) * speed + (VFX_CONSTANTS.LARGE.FIRE_RISE_SPEED * 60);
        fireVelZ![i] = Math.cos(phi) * speed;

        fireBatch!.setVisibleAt(fireInstIds![i], true);
        spawned++;
      }
    }
  }
}

export function updateLargeVFX(deltaTime: number, camera: THREE.PerspectiveCamera) {
  // Update explosion structures & lights
  for (let i = 0; i < POOL_SIZE; i++) {
    const inst = explosionPool[i];
    if (inst.active) {
      inst.life -= deltaTime;
      if (inst.life <= 0) {
        inst.active = false;
        if (inst.light) {
          inst.light.intensity = 0;
        }
      } else {
        const progress = inst.life / inst.maxLife; // 1.0 -> 0.0
        if (inst.light) {
          inst.light.intensity = VFX_CONSTANTS.LARGE.EXPLOSION_LIGHT_INTENSITY * inst.scale * progress;
        }
      }
    }
  }

  // Update fireball particles
  if (fireBatch && fireActive && fireInstIds) {
    let updateNeeded = false;
    const fSlots = POOL_SIZE * VFX_CONSTANTS.LARGE.FIRE_PARTICLES;
    for (let i = 0; i < fSlots; i++) {
      if (!fireActive[i]) continue;

      fireLife![i]--;
      if (fireLife![i] <= 0) {
        fireActive[i] = 0;
        fireBatch.setVisibleAt(fireInstIds[i], false);
        updateNeeded = true;
        continue;
      }

      fireVelX![i] *= 0.92;
      fireVelY![i] *= 0.92;
      fireVelZ![i] *= 0.92;

      firePosX![i] += fireVelX![i] * deltaTime;
      firePosY![i] += fireVelY![i] * deltaTime;
      firePosZ![i] += fireVelZ![i] * deltaTime;

      _largePos.set(firePosX![i], firePosY![i], firePosZ![i]);
      _largeQuat.copy(camera.quaternion);

      const progress = 1 - (fireLife![i] / VFX_CONSTANTS.LARGE.FIRE_LIFETIME); // 0 -> 1
      const size = VFX_CONSTANTS.LARGE.FIRE_SIZE * (1.0 + progress * VFX_CONSTANTS.LARGE.EXPLOSION_EXPANSION_RATE);
      _largeScale.setScalar(size);

      _largeMatrix.compose(_largePos, _largeQuat, _largeScale);
      fireBatch.setMatrixAt(fireInstIds[i], _largeMatrix);
      updateNeeded = true;
    }
    if (updateNeeded && (fireBatch as any).instanceMatrix) {
      (fireBatch as any).instanceMatrix.needsUpdate = true;
    }
  }
}

export function clearLargeVFX() {
  for (let i = 0; i < POOL_SIZE; i++) {
    const inst = explosionPool[i];
    inst.active = false;
    inst.life = 0;
    if (inst.light) {
      inst.light.intensity = 0;
    }
  }
  if (fireBatch && fireInstIds && fireActive) {
    fireActive.fill(0);
    for (let i = 0; i < fireInstIds.length; i++) fireBatch.setVisibleAt(fireInstIds[i], false);
  }
}
