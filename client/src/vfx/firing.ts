import * as THREE from "three/webgpu";
import { uv, float, smoothstep, length as tslLength, vec2, vec4, mix } from "three/tsl";
import { VFX_CONSTANTS } from "./constants";

export interface NiagaraMuzzleFlash {
  coreMesh: THREE.Mesh;
  spikeMesh: THREE.Mesh;
  light: THREE.PointLight | null;
  life: number;
  maxLife: number;
  scaleFactor: number;
}

const flashPool: NiagaraMuzzleFlash[] = [];
const POOL_SIZE = 8;
let _scene: THREE.Scene;

export function initFiringVFX(scene: THREE.Scene, hasLights: boolean) {
  _scene = scene;
  flashPool.length = 0;

  // 1. Core Material using TSL (Niagara-style hot-white inner core and orange-red outer boundary)
  const coreMat = new THREE.MeshBasicNodeMaterial();
  coreMat.transparent = true;
  coreMat.blending = THREE.AdditiveBlending;
  coreMat.depthWrite = false;
  coreMat.side = THREE.DoubleSide;

  const coreUV = uv().sub(vec2(0.5, 0.5));
  const coreDist = tslLength(coreUV).mul(float(2.0));
  
  const innerSoft = smoothstep(float(1.0), float(0.0), coreDist);
  const outerPlume = smoothstep(float(0.8), float(0.2), coreDist);

  const innerColor = vec4(VFX_CONSTANTS.FIRING.CORE_COLOR[0], VFX_CONSTANTS.FIRING.CORE_COLOR[1], VFX_CONSTANTS.FIRING.CORE_COLOR[2], 1.0);
  const outerColor = vec4(VFX_CONSTANTS.FIRING.EDGE_COLOR[0], VFX_CONSTANTS.FIRING.EDGE_COLOR[1], VFX_CONSTANTS.FIRING.EDGE_COLOR[2], 0.0);
  const coreColorNode = mix(outerColor, innerColor, outerPlume);

  coreMat.colorNode = vec4(coreColorNode.x, coreColorNode.y, coreColorNode.z, innerSoft);

  // 2. Gas Spike Material (Linear stretch along U/V axes)
  const spikeMat = new THREE.MeshBasicNodeMaterial();
  spikeMat.transparent = true;
  spikeMat.blending = THREE.AdditiveBlending;
  spikeMat.depthWrite = false;
  spikeMat.side = THREE.DoubleSide;

  const spikeUV = uv();
  const uDist = smoothstep(float(0.0), float(0.2), spikeUV.x).mul(smoothstep(float(1.0), float(0.8), spikeUV.x));
  const vDist = smoothstep(float(0.5), float(0.0), tslLength(spikeUV.y.sub(float(0.5))));
  const spikeAlpha = uDist.mul(vDist);

  spikeMat.colorNode = vec4(
    float(VFX_CONSTANTS.FIRING.EDGE_COLOR[0]),
    float(VFX_CONSTANTS.FIRING.EDGE_COLOR[1]),
    float(VFX_CONSTANTS.FIRING.EDGE_COLOR[2]),
    spikeAlpha
  );

  // Geometries
  const coreGeom = new THREE.SphereGeometry(0.35, 16, 16);
  const spikeGeom = new THREE.ConeGeometry(VFX_CONSTANTS.FIRING.SPIKE_WIDTH, VFX_CONSTANTS.FIRING.SPIKE_LENGTH, 8);
  spikeGeom.rotateX(Math.PI / 2); // align cone forward along Z axis

  for (let i = 0; i < POOL_SIZE; i++) {
    const coreMesh = new THREE.Mesh(coreGeom, coreMat);
    coreMesh.name = `VFX_NiagaraFlash_Core_${i}`;
    coreMesh.visible = false;
    _scene.add(coreMesh);

    const spikeMesh = new THREE.Mesh(spikeGeom, spikeMat);
    spikeMesh.name = `VFX_NiagaraFlash_Spike_${i}`;
    spikeMesh.visible = false;
    _scene.add(spikeMesh);

    let light: THREE.PointLight | null = null;
    if (hasLights) {
      light = new THREE.PointLight(
        VFX_CONSTANTS.FIRING.LIGHT_COLOR,
        0,
        VFX_CONSTANTS.FIRING.LIGHT_DISTANCE,
        VFX_CONSTANTS.FIRING.LIGHT_DECAY
      );
      light.visible = false;
      _scene.add(light);
    }

    flashPool.push({
      coreMesh,
      spikeMesh,
      light,
      life: 0,
      maxLife: VFX_CONSTANTS.FIRING.FLASH_DURATION,
      scaleFactor: 1.0
    });
  }
}

export function triggerNiagaraFlash(muzzlePos: THREE.Vector3, direction: THREE.Vector3, scale = 1.0) {
  let inst: NiagaraMuzzleFlash | null = null;
  for (let i = 0; i < POOL_SIZE; i++) {
    if (flashPool[i].life <= 0) {
      inst = flashPool[i];
      break;
    }
  }

  // Fallback to oldest
  if (!inst && flashPool.length > 0) {
    let oldestIdx = 0;
    let minLife = flashPool[0].life;
    for (let i = 1; i < POOL_SIZE; i++) {
      if (flashPool[i].life < minLife) {
        minLife = flashPool[i].life;
        oldestIdx = i;
      }
    }
    inst = flashPool[oldestIdx];
  }

  if (inst) {
    const sFactor = scale * VFX_CONSTANTS.FIRING.FLASH_SCALE_MULTIPLIER;
    inst.life = VFX_CONSTANTS.FIRING.FLASH_DURATION;
    inst.maxLife = VFX_CONSTANTS.FIRING.FLASH_DURATION;
    inst.scaleFactor = sFactor;

    // Position and align
    inst.coreMesh.position.copy(muzzlePos);
    inst.coreMesh.scale.setScalar(sFactor);
    inst.coreMesh.visible = true;

    inst.spikeMesh.position.copy(muzzlePos);
    inst.spikeMesh.scale.set(sFactor, sFactor, sFactor);
    
    // Rotate spike to point in direction of firing
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    inst.spikeMesh.quaternion.copy(q);
    inst.spikeMesh.visible = false; // Disable glare spike mesh entirely as requested

    if (inst.light) {
      inst.light.position.copy(muzzlePos);
      inst.light.intensity = VFX_CONSTANTS.FIRING.LIGHT_INTENSITY * sFactor;
      inst.light.visible = true;
    }
  }
}

export function updateFiringVFX(deltaTime: number, camera: THREE.PerspectiveCamera) {
  for (let i = 0; i < flashPool.length; i++) {
    const inst = flashPool[i];
    if (inst.life > 0) {
      inst.life -= deltaTime;
      if (inst.life <= 0) {
        inst.coreMesh.visible = false;
        inst.spikeMesh.visible = false;
        if (inst.light) {
          inst.light.visible = false;
          inst.light.intensity = 0;
        }
      } else {
        // Core always faces the camera (billboard effect)
        inst.coreMesh.quaternion.copy(camera.quaternion);
        
        const progress = inst.life / inst.maxLife; // 1.0 -> 0.0
        inst.coreMesh.scale.setScalar(inst.scaleFactor * progress);
        
        // Spike grows forward, then fades
        inst.spikeMesh.scale.set(
          inst.scaleFactor * progress,
          inst.scaleFactor * progress,
          inst.scaleFactor * (2.0 - progress) // Stretches Z-axis forward as it decays
        );

        if (inst.light) {
          inst.light.intensity = VFX_CONSTANTS.FIRING.LIGHT_INTENSITY * inst.scaleFactor * progress;
        }
      }
    }
  }
}

export function clearFiringVFX() {
  for (let i = 0; i < flashPool.length; i++) {
    const inst = flashPool[i];
    inst.life = 0;
    inst.coreMesh.visible = false;
    inst.spikeMesh.visible = false;
    if (inst.light) {
      inst.light.visible = false;
      inst.light.intensity = 0;
    }
  }
}
