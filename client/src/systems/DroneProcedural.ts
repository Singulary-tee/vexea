import * as THREE from "three/webgpu";
import { DroneType, DRONE_CONFIGS } from "../../../shared/constants";

const tempEuler = new THREE.Euler();

export interface DroneProceduralState {
  spinAngle: number;
  wheelAngle: number;
  turretYaw: number;
  turretPitch: number;
  recoilAmount: number;
  steerAngle: number;
  lastBodyYaw?: number;
  accumulatedTime?: number;
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
    if (state.accumulatedTime === undefined) state.accumulatedTime = 0;
    state.accumulatedTime += dt;

    const swayAmount = config.hoverSwayAmount ?? 0.05;
    const swaySpeed = config.hoverSwaySpeed ?? 2.0;

    // Time-based continuous sway (runs regardless of movement/velocity)
    const timeSwayX = Math.sin(state.accumulatedTime * swaySpeed) * swayAmount;
    const timeSwayZ = Math.cos(state.accumulatedTime * swaySpeed * 0.9) * swayAmount;

    // Velocity-derived tilt
    let velocityTiltX = smoothedVelocity.z * 0.05;
    let velocityTiltZ = -smoothedVelocity.x * 0.05;

    // Clamp by pitchAngle (Max forward/backward banking) and bankingAngle (Max sideways roll)
    const maxPitch = config.pitchAngle ?? 0.35;
    const maxBank = config.bankingAngle ?? 0.35;
    velocityTiltX = Math.max(-maxPitch, Math.min(maxPitch, velocityTiltX));
    velocityTiltZ = Math.max(-maxBank, Math.min(maxBank, velocityTiltZ));

    // Combine both
    const totalSwayX = timeSwayX + velocityTiltX;
    const totalSwayZ = timeSwayZ + velocityTiltZ;

    tempEuler.set(totalSwayX, 0, totalSwayZ);
    outSwayQuaternion.setFromEuler(tempEuler);
  } else {
    outSwayQuaternion.identity();
  }

  if (config.animations.includes('wheels')) {
    state.wheelAngle += speed * dt * (config.wheelRollSpeed ?? 2.0);
  }
  
  if (config.animations.includes('turret') || typeId === DroneType.ROTARY_SHOOTER) {
    const recoverDur = config.recoilRecoverDuration ?? 0.20;
    state.recoilAmount = Math.max(0, state.recoilAmount - dt * (1.0 / recoverDur));
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
  recoilOut: THREE.Matrix4,
  isMesh?: boolean
): { didRotate: boolean; hasRecoil: boolean } {
  const config = DRONE_CONFIGS[typeId as DroneType];
  let didRotate = false;
  let hasRecoil = false;

  if (!config) return { didRotate, hasRecoil };

  if (config.animations.includes('spin')) {
    const parentNameLower = parentName?.toLowerCase() || '';
    const isPropMesh = !!isMesh && (parentNameLower.includes('prop') && parentNameLower !== 'prop');
    if (isPropMesh) {
      rOut.makeRotationY(state.spinAngle);
      didRotate = true;
    }
  }
  
  if (config.animations.includes('steer')) {
    if (nodeName === 'FrontAxel') {
      rOut.makeRotationX(state.steerAngle);
      didRotate = true;
    }
  }

  if (config.animations.includes('wheels')) {
    if (nodeName.includes('Tires') || (nodeName.toLowerCase().includes('wheel') && !nodeName.toLowerCase().includes('wheeled'))) {
      rOut.makeRotationY(state.wheelAngle);
      const nameLower = nodeName.toLowerCase();
      const isSteeringWheel = nameLower.includes('front') || 
                              nameLower.includes('steer') || 
                              nameLower.includes('fl') || 
                              nameLower.includes('fr') || 
                              nameLower.includes('lefttires') || 
                              nameLower.includes('righttires');
      if (isSteeringWheel) {
        const steerRot = new THREE.Matrix4().makeRotationX(state.steerAngle);
        rOut.premultiply(steerRot);
      }
      didRotate = true;
    }
  }

  if (config.animations.includes('turret')) {
    if (nodeName === 'rotate') {
      rOut.makeRotationY(state.turretYaw);
      didRotate = true;
    } else if (nodeName === 'gun') {
      rOut.makeRotationZ(state.turretPitch);
      didRotate = true;
    }
  }

  if (nodeName === 'barrel' || nodeName.toLowerCase().includes('barrel') || nodeName.toLowerCase() === 'rifle' || nodeName === 'gun') {
    hasRecoil = true;
    const recoilAmt = config.barrelRecoilAmount ?? 0.15;
    if (typeId === DroneType.ROTARY_SHOOTER) {
      recoilOut.makeTranslation(0, 0, -state.recoilAmount * recoilAmt);
    } else if (typeId === DroneType.WHEELED) {
      recoilOut.makeTranslation(state.recoilAmount * recoilAmt, 0, 0);
    } else {
      recoilOut.makeTranslation(-state.recoilAmount * recoilAmt, 0, 0);
    }
  }

  return { didRotate, hasRecoil };
}
