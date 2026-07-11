import * as THREE from "three/webgpu";
import { DroneType, DRONE_CONFIGS } from "../../../shared/constants";

export interface DroneProceduralState {
  spinAngle: number;
  wheelAngle: number;
  turretYaw: number;
  turretPitch: number;
  recoilAmount: number;
  steerAngle: number;
  lastBodyYaw?: number;
}

export function createProceduralState(): DroneProceduralState {
  return {
    spinAngle: Math.random() * Math.PI * 2,
    wheelAngle: 0,
    turretYaw: 0,
    turretPitch: 0,
    recoilAmount: 0,
    steerAngle: 0,
  };
}

export function updateProceduralState(
  state: DroneProceduralState,
  typeId: number,
  dt: number,
  speed: number,
  smoothedVelocity: THREE.Vector3,
  bodyEuler: THREE.Euler, // Only needed for wheeled
  outSwayQuaternion: THREE.Quaternion // Only needed for quadcopters
) {
  const config = DRONE_CONFIGS[typeId as DroneType];
  if (!config) return;

  if (config.animations.includes('spin')) {
    state.spinAngle += dt * (config.propellerSpinRate ?? 20.0);
  }
  
  if (config.animations.includes('sway')) {
    const swayAmount = config.hoverSwayAmount ?? 0.05;
    const swayX = smoothedVelocity.z * swayAmount;
    const swayZ = -smoothedVelocity.x * swayAmount;
    outSwayQuaternion.setFromEuler(new THREE.Euler(swayX, 0, swayZ));
  } else {
    outSwayQuaternion.identity();
  }

  if (config.animations.includes('wheels')) {
    state.wheelAngle += speed * dt * (config.wheelRollSpeed ?? 2.0);
  }
  
  if (config.animations.includes('turret')) {
    state.recoilAmount = Math.max(0, state.recoilAmount - dt * 5.0);
  }

  if (config.animations.includes('steer')) {
    if (state.lastBodyYaw === undefined) state.lastBodyYaw = bodyEuler.y;
    let yawDelta = bodyEuler.y - state.lastBodyYaw;
    while (yawDelta > Math.PI) yawDelta -= 2*Math.PI;
    while (yawDelta < -Math.PI) yawDelta += 2*Math.PI;
    state.lastBodyYaw = bodyEuler.y;
    
    const steerAngleLimit = config.wheelSteerAngle ?? 0.5;
    let targetSteer = speed > 0.1 ? yawDelta * 10.0 : 0;
    targetSteer = Math.max(-steerAngleLimit, Math.min(steerAngleLimit, targetSteer));
    state.steerAngle = state.steerAngle + (targetSteer - state.steerAngle) * 0.1;
  }

  if (config.animations.includes('turret') && speed > 0.1) {
    const targetYaw = Math.atan2(smoothedVelocity.x, smoothedVelocity.z);
    let localYaw = targetYaw - bodyEuler.y;
    let yawDiff = localYaw - state.turretYaw;
    while (yawDiff > Math.PI) yawDiff -= 2*Math.PI;
    while (yawDiff < -Math.PI) yawDiff += 2*Math.PI;
    state.turretYaw += yawDiff * 0.1;
  }
}

// Applies rotations to a specific node. Returns true if rotation applied.
export function applyNodeRotation(
  typeId: number,
  nodeName: string,
  parentName: string | null | undefined,
  state: DroneProceduralState,
  rOut: THREE.Matrix4,
  recoilOut: THREE.Matrix4
): { didRotate: boolean; hasRecoil: boolean } {
  const config = DRONE_CONFIGS[typeId as DroneType];
  let didRotate = false;
  let hasRecoil = false;

  if (!config) return { didRotate, hasRecoil };

  if (config.animations.includes('spin')) {
    if (nodeName.toLowerCase().includes('prop') && 
      nodeName.toLowerCase() !== 'prop' && 
      parentName?.toLowerCase() !== 'propbl') {
      rOut.makeRotationY(state.spinAngle);
      didRotate = true;
    }
  }
  
  if (config.animations.includes('steer')) {
    if (nodeName === 'FrontAxel') {
      rOut.makeRotationY(state.steerAngle);
      didRotate = true;
    }
  }

  if (config.animations.includes('wheels')) {
    if (nodeName.includes('Tires')) {
      rOut.makeRotationY(-state.wheelAngle);
      didRotate = true;
    }
  }

  if (config.animations.includes('turret')) {
    if (nodeName === 'rotate') {
      rOut.makeRotationY(state.turretYaw);
      didRotate = true;
    } else if (nodeName === 'gun') {
      rOut.makeRotationX(state.turretPitch);
      didRotate = true;
      hasRecoil = true;
      recoilOut.makeTranslation(0, 0, state.recoilAmount * (config.barrelRecoilAmount ?? 0.15));
    }
  }

  return { didRotate, hasRecoil };
}
