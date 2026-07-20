import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getAssetUrl, getCachedOrFetchUrl } from "../asset-cache";
import * as screenManager from "./screen-manager";
import { DS } from "../design-system";
import { audioManager } from "../audio";
import { PLAYER_TOTAL_HEIGHT, PLAYER_RADIUS, DRONE_CONFIGS, DroneType } from "../../shared/constants";
import { triggerFlash, spawnTracer, updateVFX, initMatchVisuals } from "../src/vfx/VFXOrchestrator";
import { updateProceduralState } from "../src/systems/DroneProcedural";

// -------------------------------------------------------------
// Drone Calibration & Visual Simulation Schema Definitions
// -------------------------------------------------------------

interface LoopMode {
    id: string;
    name: string;
    run: (dt: number, params: any, model: THREE.Group, time: number, lTimer: number, type: DroneType) => void;
}

interface DroneSchema {
    id: string;
    name: string;
    type: DroneType;
    glbUrl: string;
    defaults: Record<string, any>;
    categories: Record<string, Record<string, { label: string; min: number; max: number; step: number }>>;
    availableLoopModes: LoopMode[];
}

// Global Procedural Animation state (pre-allocated to obey Zero-GC rules)
const state: {
    spinAngle: number;
    wheelAngle: number;
    steerAngle: number;
    turretYaw: number;
    turretPitch: number;
    recoilAmount: number;
    trotPhase: number;
    walkPhase: number;
    lastPos?: THREE.Vector3;
    smoothedVelocity?: THREE.Vector3;
    lastBodyYaw?: number;
} = {
    spinAngle: 0,
    wheelAngle: 0,
    steerAngle: 0,
    turretYaw: 0,
    turretPitch: 0,
    recoilAmount: 0,
    trotPhase: 0,
    walkPhase: 0
};

// Pre-allocated static variables for Zero-GC compliance in tickLoop
const tempModelPivot = new THREE.Vector3();
const tempLp = new THREE.Vector3();
const tempT1 = new THREE.Matrix4();
const tempT2 = new THREE.Matrix4();
const tempRotAroundPivot = new THREE.Matrix4();

// Pivot Rotation Test State & Helpers
function getLocalBoundingBoxOfNode(node: THREE.Object3D): THREE.Box3 {
    const box = new THREE.Box3();
    node.updateMatrixWorld(true);
    const invMat = node.matrixWorld.clone().invert();
    let hasMesh = false;
    node.traverse((child: any) => {
        if (child.isMesh && child.geometry) {
            if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
            const childBox = child.geometry.boundingBox.clone();
            const childToNode = child.matrixWorld.clone().premultiply(invMat);
            childBox.applyMatrix4(childToNode);
            box.union(childBox);
            hasMesh = true;
        }
    });
    if (!hasMesh) {
        box.set(new THREE.Vector3(-0.15, -0.15, -0.15), new THREE.Vector3(0.15, 0.15, 0.15));
    }
    return box;
}

function verifyPivotRotationMath() {
    if (!activeGLBModel) return;
    const rotateNode = activeGLBModel.getObjectByName("rotate");
    const gunNode = activeGLBModel.getObjectByName("gun");
    const modelGroup = activeGLBModel.children[0]?.children[0] as THREE.Group;
    if (!rotateNode || !gunNode || !modelGroup) return;

    const params = currentParams[currentTab];
    const baseWorldMat = modelGroup.userData.baseWorldMatrix;
    if (!baseWorldMat) return;

    // 1. Get current pivot configurations in unscaled model space
    const turretPivotModel = new THREE.Vector3(
        params.turretYawPivotX !== undefined ? params.turretYawPivotX : 0.0,
        params.turretYawPivotY !== undefined ? params.turretYawPivotY : 0.45,
        params.turretYawPivotZ !== undefined ? params.turretYawPivotZ : -0.1
    );

    const gunPivotModel = new THREE.Vector3(
        params.gunPitchPivotX !== undefined ? params.gunPitchPivotX : 0.0,
        params.gunPitchPivotY !== undefined ? params.gunPitchPivotY : 0.65,
        params.gunPitchPivotZ !== undefined ? params.gunPitchPivotZ : 0.0
    );

    // Compute local positions inside the meshes
    const tempTurretLp = turretPivotModel.clone();
    tempTurretLp.applyMatrix4(baseWorldMat);
    if (rotateNode.userData.baseInvWorldMatrix) {
        tempTurretLp.applyMatrix4(rotateNode.userData.baseInvWorldMatrix);
    }

    const tempGunLp = gunPivotModel.clone();
    tempGunLp.applyMatrix4(baseWorldMat);
    if (gunNode.userData.baseInvWorldMatrix) {
        tempGunLp.applyMatrix4(gunNode.userData.baseInvWorldMatrix);
    }

    // Compute bounding boxes in local coordinate space
    const turretBox = getLocalBoundingBoxOfNode(rotateNode);
    const gunBox = getLocalBoundingBoxOfNode(gunNode);

    // CRITERION 1: Points must be within the turret or the gun mesh
    const turretPivotInside = turretBox.containsPoint(tempTurretLp);
    const gunPivotInside = gunBox.containsPoint(tempGunLp);

    // CRITERION 2 & 3 & 4: Stationary, never leaves inside, moves correctly
    // Compute current world positions
    const worldTurretPivot = turretPivotModel.clone().applyMatrix4(modelGroup.matrixWorld);

    const initialWorldGunPivot = gunPivotModel.clone().applyMatrix4(baseWorldMat);
    const localPivotInRotate = initialWorldGunPivot.clone().applyMatrix4(rotateNode.userData.baseInvWorldMatrix);
    const worldGunPivot = localPivotInRotate.clone().applyMatrix4(rotateNode.matrixWorld);

    // Track previous positions to measure drift
    if (!(window as any)._lastPivots) {
        (window as any)._lastPivots = {
            worldTurretPivot: worldTurretPivot.clone(),
            worldGunPivot: worldGunPivot.clone(),
            turretYaw: state.turretYaw,
            turretPitch: state.turretPitch,
        };
    }
    const last = (window as any)._lastPivots;

    const turretYawDiff = Math.abs(state.turretYaw - last.turretYaw);
    const turretPitchDiff = Math.abs(state.turretPitch - last.turretPitch);

    let turretPivotDriftDuringYaw = 0;
    let gunPivotDriftDuringPitch = 0;
    let gunPivotMovesWithTurretYaw = false;

    if (turretYawDiff > 0.001) {
        turretPivotDriftDuringYaw = worldTurretPivot.distanceTo(last.worldTurretPivot);
    }
    if (turretPitchDiff > 0.001) {
        gunPivotDriftDuringPitch = worldGunPivot.distanceTo(last.worldGunPivot);
    }
    if (turretYawDiff > 0.001) {
        const gunPivotMovedDist = worldGunPivot.distanceTo(last.worldGunPivot);
        if (gunPivotMovedDist > 0.001) {
            gunPivotMovesWithTurretYaw = true;
        }
    }

    // Save for next frame
    last.worldTurretPivot.copy(worldTurretPivot);
    last.worldGunPivot.copy(worldGunPivot);
    last.turretYaw = state.turretYaw;
    last.turretPitch = state.turretPitch;

    // Update HTML validation interface
    const statusEl = document.getElementById("de-pivot-validation-status");
    if (statusEl) {
        const c1_turret = turretPivotInside 
            ? `<span style="color: #00ff00; font-weight: bold;">[PASS]</span>` 
            : `<span style="color: #ff3333; font-weight: bold;">[FAIL]</span>`;
        const c1_gun = gunPivotInside 
            ? `<span style="color: #00ff00; font-weight: bold;">[PASS]</span>` 
            : `<span style="color: #ff3333; font-weight: bold;">[FAIL]</span>`;

        const c2_turret = turretPivotDriftDuringYaw < 0.001
            ? `<span style="color: #00ff00; font-weight: bold;">[PASS]</span>`
            : `<span style="color: #ff3333; font-weight: bold;">[FAIL] (Drift: ${turretPivotDriftDuringYaw.toFixed(5)})</span>`;

        const c2_gun = gunPivotDriftDuringPitch < 0.001
            ? `<span style="color: #00ff00; font-weight: bold;">[PASS]</span>`
            : `<span style="color: #ff3333; font-weight: bold;">[FAIL] (Drift: ${gunPivotDriftDuringPitch.toFixed(5)})</span>`;

        const c3_turret = turretPivotInside
            ? `<span style="color: #00ff00; font-weight: bold;">[PASS]</span>`
            : `<span style="color: #ff3333; font-weight: bold;">[FAIL]</span>`;
        const c3_gun = gunPivotInside
            ? `<span style="color: #00ff00; font-weight: bold;">[PASS]</span>`
            : `<span style="color: #ff3333; font-weight: bold;">[FAIL]</span>`;

        const c4_gun = (state.turretYaw === 0 || gunPivotMovesWithTurretYaw)
            ? `<span style="color: #00ff00; font-weight: bold;">[PASS]</span>`
            : `<span style="color: #aaa; font-style: italic;">[WAITING FOR YAW]</span>`;

        let html = "";
        html += `<div style="display: flex; flex-direction: column; gap: 8px;">`;
        
        html += `<div>`;
        html += `<div style="font-weight: bold; color: #fff;">1. Points inside mesh bounds:</div>`;
        html += `<div style="display: flex; justify-content: space-between; padding-left: 8px;"><span>- Turret Pivot inside Turret Mesh:</span><span>${c1_turret}</span></div>`;
        html += `<div style="display: flex; justify-content: space-between; padding-left: 8px;"><span>- Gun Pivot inside Gun Mesh:</span><span>${c1_gun}</span></div>`;
        html += `</div>`;

        html += `<div>`;
        html += `<div style="font-weight: bold; color: #fff;">2. Points are stationary:</div>`;
        html += `<div style="display: flex; justify-content: space-between; padding-left: 8px;"><span>- Turret Pivot stationary during yaw:</span><span>${c2_turret}</span></div>`;
        html += `<div style="display: flex; justify-content: space-between; padding-left: 8px;"><span>- Gun Pivot stationary during pitch:</span><span>${c2_gun}</span></div>`;
        html += `</div>`;

        html += `<div>`;
        html += `<div style="font-weight: bold; color: #fff;">3. Point stays inside during rotation:</div>`;
        html += `<div style="display: flex; justify-content: space-between; padding-left: 8px;"><span>- Turret Pivot never leaves mesh:</span><span>${c3_turret}</span></div>`;
        html += `<div style="display: flex; justify-content: space-between; padding-left: 8px;"><span>- Gun Pivot never leaves mesh:</span><span>${c3_gun}</span></div>`;
        html += `</div>`;

        html += `<div>`;
        html += `<div style="font-weight: bold; color: #fff;">4. Hierarchical dependencies:</div>`;
        html += `<div style="display: flex; justify-content: space-between; padding-left: 8px;"><span>- Gun Pivot moves with turret yaw:</span><span>${c4_gun}</span></div>`;
        html += `</div>`;

        const allOk = turretPivotInside && gunPivotInside && (turretPivotDriftDuringYaw < 0.001) && (gunPivotDriftDuringPitch < 0.001);
        if (allOk) {
            html += `<div style="color: #00ff00; font-weight: bold; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; text-align: center; margin-top: 4px;">🎉 ALL PIVOT RULES SATISFIED!</div>`;
        } else {
            html += `<div style="color: #ff3333; font-weight: bold; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; text-align: center; margin-top: 4px;">⚠️ ALIGN SLIDERS TO PASS TESTS</div>`;
        }

        html += `</div>`;
        statusEl.innerHTML = html;
    }
}


// Common loop modes shared dynamically across schemas
const createSpeedTestLoop = (type: DroneType): LoopMode => ({
    id: "SPEED_TEST",
    name: "SPEED TEST (50M TRACK)",
    run: (dt, params, model, time, lTimer) => {
        const speed = params.speed || 10.0;
        // 50m track length: travel from Z = -10 to Z = 40.
        const duration = 50.0 / speed;
        const progress = (lTimer % duration) / duration;
        const currentZ = -10.0 + progress * 50.0;
        
        model.position.set(0, 0.2, currentZ);
        model.quaternion.set(0, 0, 0, 1);

        // Tilt forward dynamically based on speed to feel momentum
        const tilt = Math.min(0.35, speed * 0.02);
        
        const isQuad = type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON;
        if (isQuad) {
            model.rotation.x = tilt;
            model.position.y = 0.5 + Math.sin(time * 3.0) * 0.04; // Gentle floating bobbing
        } else {
            model.position.y = 0.2;
        }

        // Advance rotating/articulated parts based on velocity
        state.spinAngle += dt * (params.rotorSpeed || 35.0);
        state.wheelAngle += dt * speed * 2.5;
        state.steerAngle = 0; // Driving straight
        state.trotPhase += dt * speed * 1.5;
        state.walkPhase += dt * speed * 2.0;
    }
});

const createIdleLoop = (type: DroneType): LoopMode => ({
    id: "IDLE",
    name: "STANDBY IDLE",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        model.quaternion.set(0, 0, 0, 1);

        // Truly standby idle
        if (!state.smoothedVelocity) state.smoothedVelocity = new THREE.Vector3();
        state.smoothedVelocity.set(0, 0, 0);
        (state as any).simulatedBank = 0;
        (state as any).simulatedPitch = 0;
        state.steerAngle = 0;
        state.turretYaw = 0;
        state.turretPitch = 0;
        
        // Allow subtle standby propeller spin/bob
        if (type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON) {
            state.spinAngle += dt * 5.0;
        }
    }
});

const createPropSpinLoop = (type: DroneType): LoopMode => ({
    id: "PROP_SPIN",
    name: "PROPELLER SPIN",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        model.quaternion.set(0, 0, 0, 1);
        if (!state.smoothedVelocity) state.smoothedVelocity = new THREE.Vector3();
        state.smoothedVelocity.set(0, 0, 0);
        state.spinAngle += dt * (params.propellerSpinRate ?? 35.0);
    }
});

const createHoverSwayLoop = (type: DroneType): LoopMode => ({
    id: "HOVER_SWAY",
    name: "HOVER SWAY & BOB",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        model.quaternion.set(0, 0, 0, 1);
        state.spinAngle += dt * 5.0;
        if (!state.smoothedVelocity) state.smoothedVelocity = new THREE.Vector3();
        state.smoothedVelocity.set(0, 0, 0);
    }
});

const createBankingRollLoop = (type: DroneType): LoopMode => ({
    id: "BANKING_ROLL",
    name: "BANKING & PITCH",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        model.quaternion.set(0, 0, 0, 1);
        const motionPhase = lTimer * 1.5;
        const bankLimit = params.bankingAngle ?? 0.35;
        const pitchLimit = params.pitchAngle ?? 0.35;
        (state as any).simulatedBank = Math.sin(motionPhase) * bankLimit;
        (state as any).simulatedPitch = Math.cos(motionPhase * 2.0) * pitchLimit * 0.3;
    }
});

const createWheelRollLoop = (type: DroneType): LoopMode => ({
    id: "WHEEL_ROLL",
    name: "WHEEL ROLL",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        model.quaternion.set(0, 0, 0, 1);
        const fakeSpeed = params.speed ?? 8.0;
        state.wheelAngle += dt * fakeSpeed * (params.wheelRollSpeed ?? 2.5);
        state.steerAngle = 0;
        state.turretYaw = 0;
        state.turretPitch = 0;
    }
});

const createWheelSteerLoop = (type: DroneType): LoopMode => ({
    id: "WHEEL_STEER",
    name: "WHEEL STEER",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        model.quaternion.set(0, 0, 0, 1);
        const steerLimit = params.wheelSteerAngle ?? 0.5;
        state.steerAngle = Math.sin(lTimer * 2.0) * steerLimit;
        state.wheelAngle = 0;
        state.turretYaw = 0;
        state.turretPitch = 0;
    }
});

const createTurretSweepLoop = (type: DroneType): LoopMode => ({
    id: "TURRET_SWEEP",
    name: "TURRET SWEEP & RECOIL",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        model.quaternion.set(0, 0, 0, 1);
        const turretRotateLimit = params.turretRotateAngle ?? 3.14;
        const turretGunLimit = params.turretGunAngle ?? 0.5;
        state.turretYaw = Math.sin(lTimer * 1.0) * turretRotateLimit * 0.5;
        state.turretPitch = (Math.cos(lTimer * 1.5) * 0.5 + 0.5) * turretGunLimit;
        state.wheelAngle = 0;
        state.steerAngle = 0;
    }
});

const createLegsTrotLoop = (type: DroneType): LoopMode => ({
    id: "LEGS_TROT",
    name: "LEG TROTTING",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        model.quaternion.set(0, 0, 0, 1);
        const fakeSpeed = params.speed ?? 5.0;
        state.trotPhase += dt * fakeSpeed * 1.5;
    }
});

const createHumanoidWalkLoop = (type: DroneType): LoopMode => ({
    id: "HUMANOID_WALK",
    name: "HUMANOID WALKING",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        model.quaternion.set(0, 0, 0, 1);
        const fakeSpeed = params.speed ?? 3.0;
        state.walkPhase += dt * fakeSpeed * 2.0;
    }
});

const createYawSurveyLoop = (type: DroneType): LoopMode => ({
    id: "YAW_360",
    name: "360° SURVEY",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        const yaw = (lTimer * 0.5) % (Math.PI * 2);
        model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

        const isQuad = type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON;
        if (isQuad) {
            model.position.y = 0.25 + Math.sin(time * 2.0) * 0.02;
            state.spinAngle += dt * 25.0;
        } else {
            model.position.y = 0.2;
            state.wheelAngle += dt * 2.0;
        }
    }
});



const buildSchema = (type: DroneType, name: string, glbUrl: string, baseDefaults: Record<string, any>): DroneSchema => {
    const config = DRONE_CONFIGS[type];
    
    // Unified Defaults from Single Source of Truth constants
    const defaults = {
        // Category 1 - Spatial
        scale: config.visualRadius ?? 1.0,
        orientationX: config.orientationOffset?.[0] ?? 0.0,
        orientationY: config.orientationOffset?.[1] ?? 0.0,
        orientationZ: config.orientationOffset?.[2] ?? 0.0,
        refDistance: 1.0,
        hp: config.hp,

        // Category 2 - Collider & Manual Points
        colliderType: config.collider.type === "cuboid" ? "Box" : (config.collider.type === "capsule" ? "Capsule" : "Ball"),
        colliderX: 0.0,
        colliderY: 0.0,
        colliderZ: 0.0,
        colliderW: config.collider.halfExtents?.[0] ?? baseDefaults.colliderW ?? 1.2,
        colliderH: config.collider.halfExtents?.[1] ?? baseDefaults.colliderH ?? 0.6,
        colliderD: config.collider.halfExtents?.[2] ?? baseDefaults.colliderD ?? 1.2,
        colliderRadius: config.collider.radius ?? baseDefaults.colliderRadius ?? 0.5,
        colliderHeight: config.collider.halfHeight ?? baseDefaults.colliderHeight ?? 1.2,
        
        muzzleX: config.muzzleOffset?.[0] ?? 0.0,
        muzzleY: config.muzzleOffset?.[1] ?? 0.0,
        muzzleZ: config.muzzleOffset?.[2] ?? 0.8,

        lightLeftX: config.lightPoints?.[0]?.[0] ?? -0.5,
        lightLeftY: config.lightPoints?.[0]?.[1] ?? 0.0,
        lightLeftZ: config.lightPoints?.[0]?.[2] ?? 0.5,

        lightRightX: config.lightPoints?.[1]?.[0] ?? 0.5,
        lightRightY: config.lightPoints?.[1]?.[1] ?? 0.0,
        lightRightZ: config.lightPoints?.[1]?.[2] ?? 0.5,

        detonationTriggerRadius: config.detonationTriggerRadius ?? 4.0,

        // Category 3 - Client-Only Animations
        propellerSpinRate: config.propellerSpinRate ?? 20.0,
        hoverSwayAmount: config.hoverSwayAmount ?? 0.05,
        hoverSwaySpeed: config.hoverSwaySpeed ?? 2.0,
        verticalBobAmount: config.verticalBobAmount ?? 0.08,
        verticalBobSpeed: config.verticalBobSpeed ?? 1.5,
        muzzleFlashScale: config.muzzleFlashScale ?? 1.0,
        firingSoundPitch: config.firingSoundPitch ?? 1.0,
        wheelRollSpeed: config.wheelRollSpeed ?? 2.5,
        wheelSteerAngle: config.wheelSteerAngle ?? 0.5,
        barrelRecoilAmount: config.barrelRecoilAmount ?? 0.15,
        recoilDuration: config.recoilDuration ?? 0.08,
        recoilRecoverDuration: config.recoilRecoverDuration ?? 0.20,
        chassisVibration: config.chassisVibration ?? 0.05,
        chassisVibrationSpeed: config.chassisVibrationSpeed ?? 30.0,

        turretYawPivotX: config.turretYawPivot?.[0] ?? 0.0,
        turretYawPivotY: config.turretYawPivot?.[1] ?? 0.45,
        turretYawPivotZ: config.turretYawPivot?.[2] ?? -0.1,

        gunPitchPivotX: config.gunPitchPivot?.[0] ?? 0.0,
        gunPitchPivotY: config.gunPitchPivot?.[1] ?? 0.65,
        gunPitchPivotZ: config.gunPitchPivot?.[2] ?? 0.0,

        // Category 4 - Server-Authoritative Stats
        speed: config.speed,
        maxRotationSpeed: config.maxRotationSpeed ?? 3.0,
        maxVerticalSpeed: config.maxVerticalSpeed ?? 5.0,
        bankingAngle: config.bankingAngle ?? 0.35,
        minSpeed: config.minSpeed ?? 10.0,
        maxTurnRate: config.maxTurnRate ?? 1.5,
        pitchAngle: config.pitchAngle ?? 0.35,
        engagementRange: config.engagementRange ?? 40.0,
        maxTurnAngle: config.maxTurnAngle ?? 0.6,
        maxTurnSpeed: config.maxTurnSpeed ?? 3.0,
        turretRotateAngle: config.turretRotateAngle ?? 3.14,
        turretGunAngle: config.turretGunAngle ?? 0.5,
        fireCooldown: config.fireCooldown ?? 15,
        detectionRadius: config.detectionRadius ?? 30.0,
        fovHalfAngle: config.fovHalfAngle ?? (Math.PI / 4),
        decelerationRadius: config.decelerationRadius ?? 5.0,
        damage: config.damage
    };

    const isAir = type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON || type === DroneType.FIXED_WING;
    
    const category1: Record<string, any> = {
        scale: { label: "Visual Scale", min: 0.1, max: 5.0, step: 0.01 },
        orientationX: { label: "Forward Orientation X (rad)", min: -Math.PI, max: Math.PI, step: 0.01 },
        orientationY: { label: "Forward Orientation Y (rad)", min: -Math.PI, max: Math.PI, step: 0.01 },
        orientationZ: { label: "Forward Orientation Z (rad)", min: -Math.PI, max: Math.PI, step: 0.01 },
        refDistance: { label: "Player Ref Distance", min: 0.2, max: 3.0, step: 0.05 },
        hp: { label: "Max HP (Structural)", min: 10, max: 500, step: 5 }
    };

    const category2: Record<string, any> = {};
    if (type !== DroneType.ROBOT_DOG && type !== DroneType.HUMANOID) {
        category2.colliderX = { label: "Collider X Offset", min: -5.0, max: 5.0, step: 0.01 };
        category2.colliderY = { label: "Collider Y Offset", min: -5.0, max: 5.0, step: 0.01 };
        category2.colliderZ = { label: "Collider Z Offset", min: -5.0, max: 5.0, step: 0.01 };
    }

    if (config.collider.type === "cuboid") {
        category2.colliderW = { label: "Collider Half-Width", min: 0.1, max: 20.0, step: 0.01 };
        category2.colliderH = { label: "Collider Half-Height", min: 0.1, max: 20.0, step: 0.01 };
        category2.colliderD = { label: "Collider Half-Depth", min: 0.1, max: 20.0, step: 0.01 };
    } else if (config.collider.type === "capsule") {
        category2.colliderRadius = { label: "Collider Radius", min: 0.1, max: 5.0, step: 0.01 };
        category2.colliderHeight = { label: "Collider Half-Height", min: 0.1, max: 10.0, step: 0.01 };
    } else {
        category2.colliderRadius = { label: "Collider Radius", min: 0.1, max: 5.0, step: 0.01 };
    }

    // Exclude Recon and Bomber from muzzle point tuning
    if (type !== DroneType.RECON && type !== DroneType.BOMBER) {
        category2.muzzleX = { label: "Muzzle X Offset", min: -100.0, max: 100.0, step: 0.01 };
        category2.muzzleY = { label: "Muzzle Y Offset", min: -100.0, max: 100.0, step: 0.01 };
        category2.muzzleZ = { label: "Muzzle Z Offset", min: -100.0, max: 100.0, step: 0.01 };
    }

    // Light offset points (Except pending assets)
    if (type !== DroneType.ROBOT_DOG && type !== DroneType.HUMANOID) {
        category2.lightLeftX = { label: "Left Light X Offset", min: -3.0, max: 3.0, step: 0.01 };
        category2.lightLeftY = { label: "Left Light Y Offset", min: -3.0, max: 3.0, step: 0.01 };
        category2.lightLeftZ = { label: "Left Light Z Offset", min: -3.0, max: 3.0, step: 0.01 };

        category2.lightRightX = { label: "Right Light X Offset", min: -3.0, max: 3.0, step: 0.01 };
        category2.lightRightY = { label: "Right Light Y Offset", min: -3.0, max: 3.0, step: 0.01 };
        category2.lightRightZ = { label: "Right Light Z Offset", min: -3.0, max: 3.0, step: 0.01 };
    }

    if (type === DroneType.WHEELED) {
        category2.turretYawPivotX = { label: "Turret Yaw Pivot X", min: -2.0, max: 2.0, step: 0.01 };
        category2.turretYawPivotZ = { label: "Turret Yaw Pivot Z", min: -2.0, max: 2.0, step: 0.01 };

        category2.gunPitchPivotY = { label: "Gun Pitch Pivot Y", min: -2.0, max: 2.0, step: 0.01 };
        category2.gunPitchPivotX = { label: "Gun Pitch Pivot X", min: -2.0, max: 2.0, step: 0.01 };
    }

    if (type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON) {
        category2.propPivotX = { label: "Prop X Pivot (Mirror)", min: -20, max: 20.0, step: 0.01 };
        category2.propPivotZ = { label: "Prop Z Pivot (Mirror)", min: -20, max: 20.0, step: 0.01 };
    }

    if (type === DroneType.BOMBER) {
        category2.detonationTriggerRadius = { label: "Detonation Radius", min: 1.0, max: 10.0, step: 0.1 };
    }

    const category3: Record<string, any> = {};
    if (type !== DroneType.ROBOT_DOG && type !== DroneType.HUMANOID) {
        if (config.animations.includes('spin')) {
            category3.propellerSpinRate = { label: "Propeller Spin Rate", min: 5.0, max: 60.0, step: 1.0 };
        }
        if (config.animations.includes('sway')) {
            category3.hoverSwayAmount = { label: "Hover Sway Amount", min: 0.0, max: 0.5, step: 0.01 };
            category3.hoverSwaySpeed = { label: "Hover Sway Speed", min: 0.5, max: 10.0, step: 0.1 };
            category3.verticalBobAmount = { label: "Vertical Bob Amount", min: 0.0, max: 0.5, step: 0.01 };
            category3.verticalBobSpeed = { label: "Vertical Bob Speed", min: 0.5, max: 10.0, step: 0.1 };
        }
        if (type !== DroneType.RECON && type !== DroneType.BOMBER) {
            category3.muzzleFlashScale = { label: "Muzzle Flash Scale", min: 0.1, max: 4.0, step: 0.1 };
            category3.firingSoundPitch = { label: "Firing Sound Pitch", min: 0.2, max: 3.0, step: 0.05 };
        }
        if (config.animations.includes('wheels')) {
            category3.wheelRollSpeed = { label: "Wheel Roll Speed", min: 0.5, max: 10.0, step: 0.1 };
        }
        if (config.animations.includes('steer')) {
            category3.wheelSteerAngle = { label: "Wheel Steer Angle", min: 0.1, max: 1.5, step: 0.05 };
        }
        if (config.animations.includes('turret') || type === DroneType.ROTARY_SHOOTER) {
            category3.barrelRecoilAmount = { label: "Barrel Recoil Amount", min: 0.0, max: 0.8, step: 0.01 };
            category3.recoilDuration = { label: "Recoil Duration", min: 0.01, max: 1.0, step: 0.01 };
            category3.recoilRecoverDuration = { label: "Recoil Recover Duration", min: 0.01, max: 2.0, step: 0.01 };
            if (config.animations.includes('turret')) {
                category3.chassisVibration = { label: "Chassis Vibration Dist", min: 0.0, max: 0.5, step: 0.01 };
                category3.chassisVibrationSpeed = { label: "Chassis Vibration Speed", min: 0.01, max: 100.0, step: 0.01 };
            }
        }
    }

    const category4: Record<string, any> = {
        speed: { label: "Max Movement Speed (m/s)", min: 1.0, max: 40.0, step: 0.5 }
    };
    if (isAir) {
        category4.maxRotationSpeed = { label: "Max Rotation Speed (rad/s)", min: 0.5, max: 10.0, step: 0.1 };
        category4.maxVerticalSpeed = { label: "Max Vertical Speed (m/s)", min: 1.0, max: 20.0, step: 0.5 };
        category4.bankingAngle = { label: "Banking Angle (rad)", min: 0.0, max: 1.2, step: 0.01 };
        category4.pitchAngle = { label: "Max Pitch Angle (rad)", min: 0.0, max: 1.2, step: 0.01 };
    }
    if (type === DroneType.BOMBER) {
        category4.damage = { label: "Explosion Damage", min: 10, max: 200, step: 5 };
    }
    if (type === DroneType.FIXED_WING) {
        category4.minSpeed = { label: "Min Speed (cannot hover)", min: 2.0, max: 20.0, step: 0.5 };
        category4.maxTurnRate = { label: "Max Turn Rate (rad/s)", min: 0.5, max: 5.0, step: 0.1 };
        category4.engagementRange = { label: "Engagement Range (m)", min: 10.0, max: 100.0, step: 1.0 };
        category4.damage = { label: "Missile Damage", min: 5, max: 100, step: 1 };
    }
    if (type === DroneType.WHEELED || type === DroneType.ROBOT_DOG || type === DroneType.HUMANOID) {
        category4.maxTurnAngle = { label: "Max Turn Angle (rad)", min: 0.1, max: 1.5, step: 0.01 };
        category4.maxTurnSpeed = { label: "Max Turn Speed (rad/s)", min: 0.5, max: 10.0, step: 0.1 };
    }
    if (type === DroneType.WHEELED) {
        category4.turretRotateAngle = { label: "Max Turret Rotate Yaw (rad)", min: 0.5, max: Math.PI * 2, step: 0.05 };
        category4.turretGunAngle = { label: "Max Turret Gun Pitch (rad)", min: 0.1, max: 1.5, step: 0.05 };
    }
    if (type !== DroneType.RECON && type !== DroneType.BOMBER && type !== DroneType.FIXED_WING) {
        category4.fireCooldown = { label: "Fire Cooldown (ticks)", min: 5, max: 100, step: 1 };
        category4.damage = { label: "Weapon Damage", min: 1, max: 100, step: 1 };
    }

    // Fulfill Section 8: Behavioral Stats
    category4.detectionRadius = { label: "Detection Radius (m)", min: 5.0, max: 100.0, step: 1.0 };
    category4.fovHalfAngle = { label: "FOV Half-Angle (rad)", min: 0.1, max: Math.PI, step: 0.05 };
    category4.decelerationRadius = { label: "Deceleration Radius (m)", min: 0.0, max: 30.0, step: 0.5 };
    if (type !== DroneType.FIXED_WING) { 
        category4.maxTurnRate = { label: "Max Turn Rate (rad/s)", min: 0.1, max: 10.0, step: 0.1 };
    }

    const categories = {
        "Category 1 — Spatial": category1,
        "Category 2 — Collider & Manual Points": category2,
        ...(Object.keys(category3).length > 0 ? { "Category 3 — Client-Only Animations": category3 } : {}),
        "Category 4 — Server-Authoritative Stats": category4
    };

    const loops: LoopMode[] = [
        createIdleLoop(type),
        createSpeedTestLoop(type),
        createYawSurveyLoop(type)
    ];

    if (type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON) {
        loops.push(createPropSpinLoop(type));
        loops.push(createHoverSwayLoop(type));
    } else if (type === DroneType.FIXED_WING) {
        loops.push(createBankingRollLoop(type));
    } else if (type === DroneType.WHEELED) {
        loops.push(createWheelRollLoop(type));
        loops.push(createWheelSteerLoop(type));
        loops.push(createTurretSweepLoop(type));
    } else if (type === DroneType.ROBOT_DOG) {
        loops.push(createLegsTrotLoop(type));
    } else if (type === DroneType.HUMANOID) {
        loops.push(createHumanoidWalkLoop(type));
    }

    return {
        id: DroneType[type],
        name,
        type,
        glbUrl,
        defaults,
        categories,
        availableLoopModes: loops
    };
};

const DRONE_SCHEMAS: DroneSchema[] = Object.values(DRONE_CONFIGS).map(config => {
    let glbUrl = "";
    let name = DroneType[config.type];
    if (config.type === DroneType.ROTARY_SHOOTER) glbUrl = "quadcopter_rifle.glb";
    if (config.type === DroneType.BOMBER) glbUrl = "quadcopter_bomb.glb";
    if (config.type === DroneType.RECON) glbUrl = "quadcopter_camera.glb";
    if (config.type === DroneType.FIXED_WING) glbUrl = "fixed_wing_drone.glb";
    if (config.type === DroneType.WHEELED) glbUrl = "wheeled_drone.glb";
    if (config.type === DroneType.ROBOT_DOG) glbUrl = "robot_dog.glb";
    if (config.type === DroneType.HUMANOID) glbUrl = "humanoid_drone.glb";

    const baseDefaults: Record<string, any> = {};
    if (config.muzzleOffset) {
        baseDefaults.muzzleX = config.muzzleOffset[0];
        baseDefaults.muzzleY = config.muzzleOffset[1];
        baseDefaults.muzzleZ = config.muzzleOffset[2];
    }
    
    if (config.collider) {
        if (config.collider.type === 'cuboid' && config.collider.halfExtents) {
            baseDefaults.colliderType = "Box";
            baseDefaults.colliderW = config.collider.halfExtents[0];
            baseDefaults.colliderH = config.collider.halfExtents[1];
            baseDefaults.colliderD = config.collider.halfExtents[2];
        } else if (config.collider.type === 'capsule' && config.collider.halfHeight !== undefined && config.collider.radius !== undefined) {
            baseDefaults.colliderType = "Capsule";
            baseDefaults.colliderRadius = config.collider.radius;
            baseDefaults.colliderHeight = config.collider.halfHeight;
        } else {
            baseDefaults.colliderType = "Sphere";
            baseDefaults.colliderRadius = config.collider.radius || 1.5;
        }
    }

    if (config.type === DroneType.WHEELED) {
        baseDefaults.turretYawPivotX = config.turretYawPivot?.[0] ?? 0.0;
        baseDefaults.turretYawPivotZ = config.turretYawPivot?.[2] ?? -0.1;

        baseDefaults.gunPitchPivotY = config.gunPitchPivot?.[1] ?? 0.65;
        baseDefaults.gunPitchPivotX = config.gunPitchPivot?.[0] ?? 0.0;
    }

    if (config.type === DroneType.ROTARY_SHOOTER || config.type === DroneType.BOMBER || config.type === DroneType.RECON) {
        baseDefaults.propPivotX = config.propPivotX ?? 0.5;
        baseDefaults.propPivotZ = config.propPivotZ ?? 0.5;
    }

    return buildSchema(config.type, name, glbUrl, baseDefaults);
});

// -------------------------------------------------------------
// Calibration Screen State Variables
// -------------------------------------------------------------

const currentParams: Record<string, any> = {};
DRONE_SCHEMAS.forEach(schema => {
    currentParams[schema.id] = JSON.parse(JSON.stringify(schema.defaults));
});

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let localRenderer: any;
let container: HTMLDivElement;
let isDevEntitiesActive = false;
let isInitialized = false;

let currentTab: string = "ROTARY_SHOOTER";
let activeGLBModel: THREE.Group | null = null;
let activeMuzzleVisual: THREE.Mesh | null = null;
let activeLightLeftVisual: THREE.Mesh | null = null;
let activeLightRightVisual: THREE.Mesh | null = null;
let activeColliderWireframe: THREE.LineSegments | null = null;
let playerRefMesh: THREE.Group | null = null;

let isControlPanelExpanded = false;
let currentCategory: string = "Category 1 — Spatial";

let simulationTime = 0;
let loopMode: string = "IDLE";
let loopTimer = 0.0;
let fireTimer = 0.0;

let recoilProgress = 0.0;
let recoilState: "IDLE" | "KICK" | "RECOVER" = "IDLE";

let camTheta = Math.PI / 4;
let camPhi = Math.PI / 6;
let camRadius = 4.0;
const camTarget = new THREE.Vector3(0, 0.4, 0);
let isDraggingCamera = false;
let lastMouseX = 0;
let lastMouseY = 0;

let showPlayerScale = true;
let showCollider = true;
let showMuzzle = true;
let showPivots = true;

let activeTurretYawPivotVisual: THREE.Mesh | null = null;
let activeGunPitchPivotVisual: THREE.Mesh | null = null;

let activePropFLPivotVisual: THREE.Mesh | null = null;
let activePropFRPivotVisual: THREE.Mesh | null = null;
let activePropBLPivotVisual: THREE.Mesh | null = null;
let activePropBRPivotVisual: THREE.Mesh | null = null;

const loadedGLBsCache = new Map<string, THREE.Group>();

let activeSliderAnimationKey: string | null = null;
let sliderAnimTimer = 0.0;
let simulationHelperGroup: THREE.Group | null = null;

// 50m Speed Calibration visual posts distances
const distances = [0, 5, 10, 15, 20, 25, 30, 40, 50];

export async function initDevEntities() {
    if (isInitialized) return;
    let screen = document.getElementById("dev-entities-screen");
    if (!screen) {
        screen = document.createElement("div");
        screen.id = "dev-entities-screen";
        document.body.appendChild(screen);
    }
    screen.innerHTML = "";
    
    Object.assign(screen.style, {
        position: "fixed",
        inset: "0",
        zIndex: "1400",
        display: "none",
        backgroundColor: "#1a2b4c",
        color: "#ffffff",
        fontFamily: DS.typography.fontFamily,
        overflow: "hidden",
        touchAction: "none"
    });

    container = document.createElement("div");
    Object.assign(container.style, {
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative"
    });
    screen.appendChild(container);

    buildDOM();
    await setup3D();
    isInitialized = true;
    switchTab("ROTARY_SHOOTER");
}

function buildDOM() {
    const screen = document.getElementById("dev-entities-screen")!;
    screen.innerHTML = "";

    const layout = document.createElement("div");
    layout.id = "de-layout";
    Object.assign(layout.style, {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden"
    });

    const style = document.createElement("style");
    style.textContent = `
        #de-canvas-container {
            flex: 1 1 auto;
            position: relative;
            background: #1a2b4c;
            min-height: 50%;
        }
        #de-controls-drawer {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 50%;
            background: rgba(26, 43, 76, 0.85);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            border-right: 1px solid rgba(255, 255, 255, 0.1);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 100;
            display: flex;
            flex-direction: column;
            max-height: 80vh;
        }
        #de-controls-drawer.collapsed {
            transform: translateY(100%);
        }
        #de-drawer-content {
            padding: 16px;
            overflow-y: auto;
            flex: 1 1 auto;
        }
        .de-tab-row {
            display: flex;
            gap: 4px;
            margin-bottom: 16px;
            overflow-x: auto;
            padding-bottom: 4px;
        }
        .de-tab {
            flex: 0 0 auto;
            padding: 10px 12px;
            font-size: 10px;
            text-align: center;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            color: #888;
            cursor: pointer;
            font-weight: bold;
            text-transform: uppercase;
            white-space: nowrap;
        }
        .de-tab.active {
            background: rgba(200, 136, 42, 0.15);
            border-color: ${DS.colors.accent};
            color: ${DS.colors.accent};
        }
        .de-category-select {
            width: 100%;
            background: #000;
            color: #fff;
            border: 1px solid ${DS.colors.border};
            padding: 10px;
            font-size: 12px;
            margin-bottom: 16px;
            outline: none;
        }
        .de-slider-block {
            margin-bottom: 12px;
            padding: 8px;
            background: rgba(255,255,255,0.02);
            border-radius: 4px;
        }
        .de-overlay-btn {
            background: rgba(10, 15, 25, 0.85);
            backdrop-filter: blur(8px);
            border: 1px solid ${DS.colors.border};
            color: #fff;
            padding: 8px 12px;
            font-size: 11px;
            border-radius: 4px;
            cursor: pointer;
            pointer-events: auto;
        }
    `;
    screen.appendChild(style);
    screen.appendChild(layout);

    const styleCanvas = document.createElement("style");
    styleCanvas.innerHTML = `
        div#dev-entities-screen > div#de-layout > div#de-canvas-container > canvas {
            image-rendering: auto;
            touch-action: none;
            user-select: none;
            -webkit-user-select: none;
        }
    `;
    document.head.appendChild(styleCanvas);

    const canvasCont = document.createElement("div");
    canvasCont.id = "de-canvas-container";
    layout.appendChild(canvasCont);

    // Projected HTML text markers overlay
    const projectedMarkers = document.createElement("div");
    projectedMarkers.id = "de-projected-markers";
    Object.assign(projectedMarkers.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: "10"
    });
    canvasCont.appendChild(projectedMarkers);

    const drawer = document.createElement("div");
    drawer.id = "de-controls-drawer";
    drawer.className = "collapsed";
    layout.appendChild(drawer);

    // Build tabs for exactly 7 drone types
    const tabsHtml = DRONE_SCHEMAS.map((s, idx) => {
        return `<div class="de-tab ${idx === 0 ? 'active' : ''}" data-tab="${s.id}">${s.name.split(" ")[0]}</div>`;
    }).join("");

    drawer.innerHTML = `
        <div id="de-drawer-content">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
                <span style="font-size: 11px; font-weight: bold; color: ${DS.colors.accent}; letter-spacing: 0.5px;">CALIBRATION PANEL</span>
                <button id="de-expand-width-btn" class="de-overlay-btn" style="padding: 4px 8px; font-size: 10px; font-weight: bold; background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1);">EXPAND WIDTH</button>
            </div>

            <div class="de-tab-row">
                ${tabsHtml}
            </div>
            
            <select class="de-category-select" id="de-category-picker"></select>
            
            <div id="de-sliders-container"></div>

            <div style="margin-top: 16px; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 4px;">
                <div style="font-size: 11px; font-weight: bold; color: ${DS.colors.accent}; margin-bottom: 10px; letter-spacing: 0.5px;">VISUAL REFS</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: #ccc; cursor: pointer;">
                        <input type="checkbox" id="de-toggle-player" ${showPlayerScale ? 'checked' : ''} style="accent-color: ${DS.colors.accent}; width: 14px; height: 14px;">
                        <span>Scale (1.8m)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: #ccc; cursor: pointer;">
                        <input type="checkbox" id="de-toggle-collider" ${showCollider ? 'checked' : ''} style="accent-color: ${DS.colors.accent}; width: 14px; height: 14px;">
                        <span>Collider</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: #ccc; cursor: pointer;">
                        <input type="checkbox" id="de-toggle-muzzle" ${showMuzzle ? 'checked' : ''} style="accent-color: ${DS.colors.accent}; width: 14px; height: 14px;">
                        <span>Weapon Node</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: #ccc; cursor: pointer;">
                        <input type="checkbox" id="de-toggle-pivots" ${showPivots ? 'checked' : ''} style="accent-color: ${DS.colors.accent}; width: 14px; height: 14px;">
                        <span>Turret/Gun Pivots</span>
                    </label>
                    <button id="de-reset-camera" class="de-overlay-btn" style="padding: 4px 8px; font-size: 10px; background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1);">RESET CAMERA</button>
                </div>
            </div>

            <div id="de-pivot-validation-section" style="margin-top: 16px; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 4px; display: ${currentTab === 'WHEELED' ? 'block' : 'none'};">
                <div style="font-size: 11px; font-weight: bold; color: ${DS.colors.accent}; margin-bottom: 10px; letter-spacing: 0.5px;">PIVOT REAL-TIME VALIDATION</div>
                <div id="de-pivot-validation-status" style="font-family: monospace; font-size: 10px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; border: 1px solid rgba(255,255,255,0.05); line-height: 1.4;">
                    Initializing pivot checks...
                </div>
            </div>

            <div style="margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <button id="de-reset-params" class="de-overlay-btn" style="background: rgba(255,255,255,0.05)">RESET VALUES</button>
                <button id="de-export-json" class="de-overlay-btn" style="background: ${DS.colors.accent}; color: #000; border: none; font-weight: bold;">EXPORT PRESET</button>
            </div>
        </div>
    `;

    const overlayControls = document.createElement("div");
    Object.assign(overlayControls.style, {
        position: "absolute",
        top: "16px",
        left: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        pointerEvents: "none",
        zIndex: "100"
    });
    canvasCont.appendChild(overlayControls);

    overlayControls.innerHTML = `
        <div style="display: flex; gap: 8px; pointer-events: auto;">
            <button id="de-loop-cycle" class="de-overlay-btn" style="width: 170px; text-align: left; font-family: monospace;">LOOP: STANDBY</button>
            <button id="de-toggle-config-btn" class="de-overlay-btn" style="width: 120px; text-align: center; font-weight: bold;">[ CONFIG ]</button>
        </div>
        <button id="de-shoot-once" class="de-overlay-btn" style="width: 170px; text-align: left; color: #FF0064; border-color: rgba(255,0,100,0.4); pointer-events: auto;">[FIRE SINGLE SHOT]</button>
        <div style="display: flex; gap: 4px; pointer-events: auto; width: 170px;">
            <button id="de-zoom-in" class="de-overlay-btn" style="flex: 1; text-align: center; font-weight: bold; padding: 6px 0;">[ ZOOM + ]</button>
            <button id="de-zoom-out" class="de-overlay-btn" style="flex: 1; text-align: center; font-weight: bold; padding: 6px 0;">[ ZOOM - ]</button>
        </div>
    `;

    const exitBtn = document.createElement("button");
    exitBtn.className = "de-overlay-btn";
    exitBtn.textContent = "EXIT";
    Object.assign(exitBtn.style, {
        position: "absolute",
        top: "16px",
        right: "16px",
        pointerEvents: "auto",
        zIndex: "100"
    });
    exitBtn.onclick = deactivateScreen;
    canvasCont.appendChild(exitBtn);

    // Wire up listeners
    canvasCont.querySelector("#de-toggle-config-btn")!.addEventListener("click", () => {
        isControlPanelExpanded = !isControlPanelExpanded;
        drawer.className = isControlPanelExpanded ? "" : "collapsed";
        const configBtn = canvasCont.querySelector("#de-toggle-config-btn")!;
        configBtn.textContent = isControlPanelExpanded ? "[ CLOSE CONFIG ]" : "[ CONFIG ]";
    });

    let isDrawerExpandedFullWidth = false;
    const expandWidthBtn = drawer.querySelector("#de-expand-width-btn") as HTMLButtonElement;
    expandWidthBtn.addEventListener("click", () => {
        isDrawerExpandedFullWidth = !isDrawerExpandedFullWidth;
        if (isDrawerExpandedFullWidth) {
            drawer.style.width = "100%";
            expandWidthBtn.textContent = "SHRINK WIDTH";
        } else {
            drawer.style.width = "50%";
            expandWidthBtn.textContent = "EXPAND WIDTH";
        }
    });

    drawer.querySelectorAll(".de-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            switchTab(tab.getAttribute("data-tab")!);
        });
    });

    drawer.querySelector("#de-category-picker")!.addEventListener("change", (e: any) => {
        stopSliderAnimation();
        currentCategory = e.target.value;
        buildSliders(currentTab);
        
        // Fulfill Section 4: Selecting a category must make the motion play continuously immediately
        if (currentCategory.includes("Category 3") || currentCategory.includes("Category 4")) {
            // We just let the tick loop handle this based on currentCategory
        }
    });

    canvasCont.querySelector("#de-loop-cycle")!.addEventListener("click", () => {
        const schema = DRONE_SCHEMAS.find(s => s.id === currentTab);
        if (!schema) return;
        const available = schema.availableLoopModes;
        const currentIdx = available.findIndex(m => m.id === loopMode);
        const next = available[(currentIdx + 1) % available.length];
        switchLoopMode(next.id);
    });

    canvasCont.querySelector("#de-shoot-once")!.addEventListener("click", triggerSingleShot);

    // Overlay Zoom buttons
    canvasCont.querySelector("#de-zoom-in")!.addEventListener("click", () => {
        camRadius = Math.max(1.5, camRadius - 0.5);
    });
    canvasCont.querySelector("#de-zoom-out")!.addEventListener("click", () => {
        camRadius = Math.min(15.0, camRadius + 0.5);
    });

    drawer.querySelector("#de-reset-params")!.addEventListener("click", resetParams);
    drawer.querySelector("#de-export-json")!.addEventListener("click", openExportPanel);

    const togglePlayer = drawer.querySelector("#de-toggle-player") as HTMLInputElement;
    togglePlayer.addEventListener("change", (e: any) => {
        showPlayerScale = e.target.checked;
        if (playerRefMesh) {
            playerRefMesh.visible = showPlayerScale;
        }
    });

    const toggleCollider = drawer.querySelector("#de-toggle-collider") as HTMLInputElement;
    toggleCollider.addEventListener("change", (e: any) => {
        showCollider = e.target.checked;
        updateColliderPositionAndDimensions();
    });

    const toggleMuzzle = drawer.querySelector("#de-toggle-muzzle") as HTMLInputElement;
    toggleMuzzle.addEventListener("change", (e: any) => {
        showMuzzle = e.target.checked;
        if (activeMuzzleVisual) {
            activeMuzzleVisual.visible = showMuzzle;
        }
    });

    const togglePivots = drawer.querySelector("#de-toggle-pivots") as HTMLInputElement;
    if (togglePivots) {
        togglePivots.addEventListener("change", (e: any) => {
            showPivots = e.target.checked;
            const isWheeled = currentTab === "WHEELED";
            const isQuad = currentTab === "ROTARY_SHOOTER" || currentTab === "BOMBER" || currentTab === "RECON";
            if (activeTurretYawPivotVisual) {
                activeTurretYawPivotVisual.visible = (isWheeled && showPivots);
            }
            if (activeGunPitchPivotVisual) {
                activeGunPitchPivotVisual.visible = (isWheeled && showPivots);
            }
            if (activePropFLPivotVisual) {
                activePropFLPivotVisual.visible = (isQuad && showPivots);
            }
            if (activePropFRPivotVisual) {
                activePropFRPivotVisual.visible = (isQuad && showPivots);
            }
            if (activePropBLPivotVisual) {
                activePropBLPivotVisual.visible = (isQuad && showPivots);
            }
            if (activePropBRPivotVisual) {
                activePropBRPivotVisual.visible = (isQuad && showPivots);
            }
        });
    }

    const btnResetCam = drawer.querySelector("#de-reset-camera") as HTMLButtonElement;
    btnResetCam.addEventListener("click", () => {
        resetCamera();
    });

}

async function setup3D() {
    const canvasCont = document.getElementById("de-canvas-container")!;
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a2b4c);
    scene.fog = new THREE.FogExp2(0x1a2b4c, 0.04);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    resetCamera();

    const webgpuSupported = typeof navigator !== 'undefined' && (navigator as any).gpu !== undefined;
    localRenderer = new THREE.WebGPURenderer({ 
        antialias: true, 
        alpha: false,
        forceWebGL: !webgpuSupported
    });
    
    try {
        await localRenderer.init();
    } catch (err) {
        console.error("[DevEntities] Standalone WebGPURenderer Init FAILED:", err);
    }

    localRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    localRenderer.setSize(window.innerWidth, window.innerHeight);
    
    const canvasEl = localRenderer.domElement;
    canvasEl.id = "de-main-canvas";
    canvasEl.style.width = "100%";
    canvasEl.style.height = "100%";
    canvasEl.style.display = "block";
    canvasEl.style.outline = "none";
    canvasEl.style.backgroundColor = "#1a2b4c";
    canvasCont.appendChild(canvasEl);

    // Supercharged Ultra Bright Direct Illumination flashlight & Environment
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x1f293d, 3.0);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 4.0);
    dirLight1.position.set(10, 15, 10);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xa9c0e3, 2.5);
    dirLight2.position.set(-10, 8, -10);
    scene.add(dirLight2);

    const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
    scene.add(ambientLight);
    initMatchVisuals(scene);

    // Headlight camera-attached light to resolve weak lighting completely
    const cameraLight = new THREE.DirectionalLight(0xffffff, 3.5);
    camera.add(cameraLight);
    scene.add(camera);

    // Beautiful Grid Visual Calibration Runway
    const gridHelper = new THREE.GridHelper(150, 150, 0xffaa00, 0x1e293b);
    scene.add(gridHelper);

    // Highly Visible Calibration Posts / Stakes at exact 5m distances to calibrate speed
    const postsGroup = new THREE.Group();
    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8);
    const postMatPrimary = new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.5, metalness: 0.5 });
    const postMatSecondary = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5 });

    distances.forEach(d => {
        const mat = (d % 10 === 0) ? postMatPrimary : postMatSecondary;
        
        // Left column post
        const leftPost = new THREE.Mesh(postGeo, mat);
        leftPost.position.set(-2.5, 1.1, d);
        postsGroup.add(leftPost);
        
        // Right column post
        const rightPost = new THREE.Mesh(postGeo, mat);
        rightPost.position.set(2.5, 1.1, d);
        postsGroup.add(rightPost);

        // Grid transverse crossbar line
        const barGeo = new THREE.BoxGeometry(5.0, 0.02, 0.1);
        const bar = new THREE.Mesh(barGeo, mat);
        bar.position.set(0, 0.01, d);
        postsGroup.add(bar);
    });
    scene.add(postsGroup);

    // Player scale reference mannequin
    playerRefMesh = new THREE.Group();
    playerRefMesh.name = "PlayerScaleReference";
    playerRefMesh.position.set(-1.8, 0, 0); // Default, updated dynamically

    const capGeo = new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_TOTAL_HEIGHT - PLAYER_RADIUS * 2, 4, 12);
    const capMat = new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        wireframe: true,
        transparent: true,
        opacity: 0.5
    });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = PLAYER_TOTAL_HEIGHT / 2;
    playerRefMesh.add(cap);

    const ringGeo = new THREE.RingGeometry(PLAYER_RADIUS, PLAYER_RADIUS + 0.05, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    playerRefMesh.add(ring);

    scene.add(playerRefMesh);
    playerRefMesh.visible = showPlayerScale;

    // Orbit Camera Drag Controls
    canvasEl.addEventListener("pointerdown", (e: PointerEvent) => {
        isDraggingCamera = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        canvasEl.setPointerCapture(e.pointerId);
    });

    canvasEl.addEventListener("pointermove", (e: PointerEvent) => {
        if (!isDraggingCamera) return;
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        camTheta -= dx * 0.005;
        camPhi = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camPhi + dy * 0.005));
    });

    canvasEl.addEventListener("pointerup", (e: PointerEvent) => {
        isDraggingCamera = false;
        canvasEl.releasePointerCapture(e.pointerId);
    });

    // Window wheel zoom listener attached to dev screen for absolute safety (Issue 1)
    const screenEl = document.getElementById("dev-entities-screen")!;
    screenEl.addEventListener("wheel", (e: WheelEvent) => {
        camRadius = Math.max(1.5, Math.min(15.0, camRadius + e.deltaY * 0.004));
    }, { passive: true });

    // Touch Pinch-to-Zoom
    let touchStartDist = 0;
    let touchStartRadius = 0;

    canvasEl.addEventListener("touchstart", (e: TouchEvent) => {
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchStartDist = Math.sqrt(dx * dx + dy * dy);
            touchStartRadius = camRadius;
        }
    }, { passive: true });

    canvasEl.addEventListener("touchmove", (e: TouchEvent) => {
        if (e.touches.length === 2 && touchStartDist > 0) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const factor = touchStartDist / dist;
            camRadius = Math.max(1.5, Math.min(15.0, touchStartRadius * factor));
        }
    }, { passive: true });

    canvasEl.addEventListener("touchend", () => {
        touchStartDist = 0;
    }, { passive: true });

    window.addEventListener("resize", onWindowResize);
}

function resetCamera() {
    camTheta = Math.PI / 4;
    camPhi = Math.PI / 6;
    camRadius = 4.0;
    camTarget.set(0, 0.4, 0);
}

function onWindowResize() {
    const canvasCont = document.getElementById("de-canvas-container");
    if (!canvasCont || !camera || !localRenderer) return;
    camera.aspect = canvasCont.clientWidth / canvasCont.clientHeight;
    camera.updateProjectionMatrix();
    localRenderer.setSize(canvasCont.clientWidth, canvasCont.clientHeight);
}

function switchTab(tabId: string) {
    stopSliderAnimation();
    currentTab = tabId;
    
    const screen = document.getElementById("dev-entities-screen")!;
    screen.querySelectorAll(".de-tab").forEach(t => {
        if (t.getAttribute("data-tab") === tabId) {
            t.classList.add("active");
        } else {
            t.classList.remove("active");
        }
    });

    const validationSection = document.getElementById("de-pivot-validation-section");
    if (validationSection) {
        validationSection.style.display = tabId === "WHEELED" ? "block" : "none";
    }

    const schema = DRONE_SCHEMAS.find(s => s.id === tabId);
    if (!schema) return;

    // Reset loop timer and switch to default loop
    switchLoopMode(schema.availableLoopModes[0].id);

    // Build categories list
    currentCategory = Object.keys(schema.categories)[0] || "General";

    // Build sliders and GLB
    buildSliders(tabId);
    loadActiveGLB();
}

function switchLoopMode(modeId: string) {
    loopMode = modeId;
    loopTimer = 0;
    
    state.spinAngle = 0;
    state.wheelAngle = 0;
    state.steerAngle = 0;
    state.turretYaw = 0;
    state.turretPitch = 0;
    state.trotPhase = 0;
    state.walkPhase = 0;

    const schema = DRONE_SCHEMAS.find(s => s.id === currentTab);
    if (!schema) return;

    const activeMode = schema.availableLoopModes.find(m => m.id === modeId);
    const loopLabel = activeMode ? activeMode.name : "STANDBY";

    const cycleBtn = document.getElementById("de-loop-cycle");
    if (cycleBtn) {
        cycleBtn.textContent = `LOOP: ${loopLabel}`;
    }
}

function toggleSliderAnimation(key: string) {
    if (activeSliderAnimationKey === key) {
        stopSliderAnimation();
    } else {
        stopSliderAnimation();
        activeSliderAnimationKey = key;
        sliderAnimTimer = 0.0;
        updateSliderBtnStates();
    }
}

function stopSliderAnimation() {
    activeSliderAnimationKey = null;
    sliderAnimTimer = 0.0;
    
    // Clean up helper geometry
    if (simulationHelperGroup) {
        scene.remove(simulationHelperGroup);
        simulationHelperGroup = null;
    }
    
    // Restore model transform/states
    if (activeGLBModel) {
        activeGLBModel.position.set(0, 0.2, 0);
        activeGLBModel.quaternion.set(0, 0, 0, 1);
        
        const params = currentParams[currentTab];
        const userScale = params.scale ?? 1.0;
        activeGLBModel.scale.set(userScale, userScale, userScale);
        
        const wrapper = activeGLBModel.getObjectByName("VisualWrapper");
        if (wrapper) {
            const ox = params.orientationX ?? 0.0;
            const oy = params.orientationY ?? 0.0;
            const oz = params.orientationZ ?? 0.0;
            wrapper.rotation.set(ox, oy, oz);
        }
    }
    
    // Restore procedural states
    state.spinAngle = 0;
    state.wheelAngle = 0;
    state.steerAngle = 0;
    state.turretYaw = 0;
    state.turretPitch = 0;
    state.trotPhase = 0;
    state.walkPhase = 0;
    
    // Restore helper locations and reference objects
    updatePlayerRefPosition();
    updateMuzzleVisualLocation();
    updateColliderPositionAndDimensions();
    
    updateSliderBtnStates();
}

function updateSliderBtnStates() {
    const btns = document.querySelectorAll(".de-play-anim-btn");
    btns.forEach(btn => {
        const key = btn.getAttribute("data-key");
        if (key === activeSliderAnimationKey) {
            btn.textContent = "[ STOP ]";
            (btn as HTMLElement).style.borderColor = "#FF0064";
            (btn as HTMLElement).style.color = "#FF0064";
        } else {
            btn.textContent = "[ PLAY ]";
            (btn as HTMLElement).style.borderColor = DS.colors.border;
            (btn as HTMLElement).style.color = "#fff";
        }
    });
}

function buildSliders(tabId: string) {
    const slidersCont = document.getElementById("de-sliders-container")!;
    const picker = document.getElementById("de-category-picker") as HTMLSelectElement;
    slidersCont.innerHTML = "";

    const schema = DRONE_SCHEMAS.find(s => s.id === tabId);
    if (!schema) return;

    const categories = Object.keys(schema.categories);
    picker.innerHTML = categories.map(c => {
        return `<option value="${c}" ${c === currentCategory ? 'selected' : ''}>CATEGORY: ${c.toUpperCase()}</option>`;
    }).join("");

    const activeCatData = schema.categories[currentCategory];
    if (!activeCatData) return;

    const params = currentParams[tabId];

    Object.keys(activeCatData).forEach(key => {
        const sliderConf = activeCatData[key];
        const val = params[key];

        const isCurrentlyPlaying = activeSliderAnimationKey === key;
        const btnText = isCurrentlyPlaying ? "STOP" : "PLAY";
        const btnStyleColor = isCurrentlyPlaying ? "#FF0064" : "#fff";
        const btnBorderColor = isCurrentlyPlaying ? "#FF0064" : DS.colors.border;

        const block = document.createElement("div");
        block.className = "de-slider-block";
        block.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #aaa; margin-bottom: 2px;">
                <span>${sliderConf.label}</span>
                <input type="number" step="any" class="de-val-input" value="${val}" style="width: 70px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); color: ${DS.colors.accent}; font-family: monospace; font-size: 10px; text-align: right; padding: 2px 4px; border-radius: 2px; outline: none;">
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <input type="range" class="de-slider" data-key="${key}" min="${sliderConf.min}" max="${sliderConf.max}" step="${sliderConf.step}" value="${val}" style="flex: 1; height: 32px; accent-color: ${DS.colors.accent};">
                <button class="de-play-anim-btn de-overlay-btn" data-key="${key}" style="padding: 4px 8px; font-size: 10px; font-weight: bold; min-width: 65px; text-align: center; color: ${btnStyleColor}; border-color: ${btnBorderColor};">[ ${btnText} ]</button>
            </div>
        `;

        const slider = block.querySelector(".de-slider") as HTMLInputElement;
        const numInput = block.querySelector(".de-val-input") as HTMLInputElement;

        slider.addEventListener("input", (e: any) => {
            const nVal = parseFloat(e.target.value);
            params[key] = nVal;
            numInput.value = nVal.toString();
            onParamChanged(key, nVal);
        });

        numInput.addEventListener("input", (e: any) => {
            let nVal = parseFloat(e.target.value);
            if (isNaN(nVal)) return;
            nVal = Math.max(sliderConf.min, Math.min(sliderConf.max, nVal));
            params[key] = nVal;
            slider.value = nVal.toString();
            onParamChanged(key, nVal);
        });

        numInput.addEventListener("change", (e: any) => {
            let nVal = parseFloat(e.target.value);
            if (isNaN(nVal)) {
                e.target.value = params[key].toString();
                return;
            }
            nVal = Math.max(sliderConf.min, Math.min(sliderConf.max, nVal));
            params[key] = nVal;
            e.target.value = nVal.toString();
            slider.value = nVal.toString();
            onParamChanged(key, nVal);
        });

        const playBtn = block.querySelector(".de-play-anim-btn") as HTMLButtonElement;
        playBtn.addEventListener("click", () => {
            toggleSliderAnimation(key);
        });

        slidersCont.appendChild(block);
    });
}

function syncParamsToConfig(type: DroneType, params: any) {
    const config = DRONE_CONFIGS[type];
    if (!config) return;

    config.visualRadius = params.scale ?? 1.0;
    config.orientationOffset = [params.orientationX ?? 0.0, params.orientationY ?? 0.0, params.orientationZ ?? 0.0];
    config.hp = params.hp;
    config.maxHp = params.hp;
    config.speed = params.speed;
    config.damage = params.damage;

    if (params.muzzleX !== undefined && params.muzzleY !== undefined && params.muzzleZ !== undefined) {
        config.muzzleOffset = [params.muzzleX, params.muzzleY, params.muzzleZ];
    }

    if (config.collider.type === 'cuboid') {
        config.collider.halfExtents = [params.colliderW, params.colliderH, params.colliderD];
    } else if (config.collider.type === 'capsule') {
        config.collider.radius = params.colliderRadius;
        config.collider.halfHeight = params.colliderHeight;
    } else {
        config.collider.radius = params.colliderRadius;
    }

    if (params.lightLeftX !== undefined && params.lightLeftY !== undefined && params.lightLeftZ !== undefined &&
        params.lightRightX !== undefined && params.lightRightY !== undefined && params.lightRightZ !== undefined) {
        config.lightPoints = [
            [params.lightLeftX, params.lightLeftY, params.lightLeftZ],
            [params.lightRightX, params.lightRightY, params.lightRightZ]
        ];
    }

    if (params.detonationTriggerRadius !== undefined) {
        config.detonationTriggerRadius = params.detonationTriggerRadius;
    }

    // Category 3
    if (params.propellerSpinRate !== undefined) config.propellerSpinRate = params.propellerSpinRate;
    if (params.hoverSwayAmount !== undefined) config.hoverSwayAmount = params.hoverSwayAmount;
    if (params.hoverSwaySpeed !== undefined) config.hoverSwaySpeed = params.hoverSwaySpeed;
    if (params.verticalBobAmount !== undefined) config.verticalBobAmount = params.verticalBobAmount;
    if (params.verticalBobSpeed !== undefined) config.verticalBobSpeed = params.verticalBobSpeed;
    if (params.muzzleFlashScale !== undefined) config.muzzleFlashScale = params.muzzleFlashScale;
    if (params.firingSoundPitch !== undefined) config.firingSoundPitch = params.firingSoundPitch;
    if (params.wheelRollSpeed !== undefined) config.wheelRollSpeed = params.wheelRollSpeed;
    if (params.wheelSteerAngle !== undefined) config.wheelSteerAngle = params.wheelSteerAngle;
    if (params.barrelRecoilAmount !== undefined) config.barrelRecoilAmount = params.barrelRecoilAmount;
    if (params.recoilDuration !== undefined) config.recoilDuration = params.recoilDuration;
    if (params.recoilRecoverDuration !== undefined) config.recoilRecoverDuration = params.recoilRecoverDuration;
    if (params.chassisVibration !== undefined) config.chassisVibration = params.chassisVibration;
    if (params.chassisVibrationSpeed !== undefined) config.chassisVibrationSpeed = params.chassisVibrationSpeed;
    if (params.turretYawPivotX !== undefined && params.turretYawPivotZ !== undefined) {
        config.turretYawPivot = [params.turretYawPivotX, params.turretYawPivotY ?? 0.45, params.turretYawPivotZ];
    }
    if (params.gunPitchPivotX !== undefined && params.gunPitchPivotY !== undefined) {
        config.gunPitchPivot = [params.gunPitchPivotX, params.gunPitchPivotY, params.gunPitchPivotZ ?? 0.0];
    }

    if (params.propPivotX !== undefined && params.propPivotZ !== undefined) {
        config.propPivotX = params.propPivotX;
        config.propPivotZ = params.propPivotZ;
    }

    // Category 4
    if (params.maxRotationSpeed !== undefined) config.maxRotationSpeed = params.maxRotationSpeed;
    if (params.maxVerticalSpeed !== undefined) config.maxVerticalSpeed = params.maxVerticalSpeed;
    if (params.bankingAngle !== undefined) config.bankingAngle = params.bankingAngle;
    if (params.minSpeed !== undefined) config.minSpeed = params.minSpeed;
    if (params.maxTurnRate !== undefined) config.maxTurnRate = params.maxTurnRate;
    if (params.pitchAngle !== undefined) config.pitchAngle = params.pitchAngle;
    if (params.engagementRange !== undefined) config.engagementRange = params.engagementRange;
    if (params.maxTurnAngle !== undefined) config.maxTurnAngle = params.maxTurnAngle;
    if (params.maxTurnSpeed !== undefined) config.maxTurnSpeed = params.maxTurnSpeed;
    if (params.turretRotateAngle !== undefined) config.turretRotateAngle = params.turretRotateAngle;
    if (params.turretGunAngle !== undefined) config.turretGunAngle = params.turretGunAngle;
    if (params.fireCooldown !== undefined) config.fireCooldown = params.fireCooldown;
    
    // Section 8: Behavioral Stats
    if (params.detectionRadius !== undefined) config.detectionRadius = params.detectionRadius;
    if (params.fovHalfAngle !== undefined) config.fovHalfAngle = params.fovHalfAngle;
    if (params.decelerationRadius !== undefined) config.decelerationRadius = params.decelerationRadius;
}

function onParamChanged(key: string, value: number) {
    if (!activeGLBModel) return;

    const schema = DRONE_SCHEMAS.find(s => s.id === currentTab);
    if (schema) {
        syncParamsToConfig(schema.type, currentParams[currentTab]);
    }

    if (key === "scale") {
        activeGLBModel.scale.set(value, value, value);
        updatePlayerRefPosition();
        updateColliderPositionAndDimensions();
        updateMuzzleVisualLocation();
    } else if (key.startsWith("orientation")) {
        const wrapper = activeGLBModel.getObjectByName("VisualWrapper");
        if (wrapper) {
            const params = currentParams[currentTab];
            const ox = params.orientationX ?? 0.0;
            const oy = params.orientationY ?? 0.0;
            const oz = params.orientationZ ?? 0.0;
            wrapper.rotation.set(ox, oy, oz);
        }
    } else if (key === "refDistance" || key.startsWith("collider") || key.startsWith("muzzle") || key.startsWith("light") || key.includes("Pivot")) {
        updatePlayerRefPosition();
        updateMuzzleVisualLocation();
        updateColliderPositionAndDimensions();
        if (key === "propPivotX" || key === "propPivotZ") {
            const schema = DRONE_SCHEMAS.find(s => s.id === currentTab);
            if (schema && activeGLBModel) {
                const params = currentParams[currentTab];
                const mirrorX = params.propPivotX !== undefined ? params.propPivotX : 0.5;
                const mirrorZ = params.propPivotZ !== undefined ? params.propPivotZ : 0.5;
                
                const modelGroup = activeGLBModel.getObjectByName("VisualWrapper")?.children[0];
                if (modelGroup) {
                    modelGroup.traverse((child: any) => {
                        const parentNameLower = child.parent?.name?.toLowerCase() || '';
                        const isPropellerMesh = child.isMesh && (parentNameLower.includes('prop') && parentNameLower !== 'prop');
                        if (isPropellerMesh) {
                            const mpOrig = child.userData.modelPivot || new THREE.Vector3();
                            let px = 0;
                            let pz = 0;
                            if (mpOrig.x < 0 && mpOrig.z > 0) {
                                px = -mirrorX; pz = mirrorZ;
                            } else if (mpOrig.x > 0 && mpOrig.z > 0) {
                                px = mirrorX; pz = mirrorZ;
                            } else if (mpOrig.x < 0 && mpOrig.z < 0) {
                                px = -mirrorX; pz = -mirrorZ;
                            } else if (mpOrig.x > 0 && mpOrig.z < 0) {
                                px = mirrorX; pz = -mirrorZ;
                            } else {
                                px = mpOrig.x; pz = mpOrig.z;
                            }
                            const tempPropellerPivot = new THREE.Vector3(px, 0.05, pz);
                            if (child.userData.baseInvWorldMatrix) {
                                tempPropellerPivot.applyMatrix4(child.userData.baseInvWorldMatrix);
                            }
                            if (!child.userData.localPivot) {
                                child.userData.localPivot = new THREE.Vector3();
                            }
                            child.userData.localPivot.copy(tempPropellerPivot);
                        }
                    });
                }
            }
        }
    }
}

function updatePlayerRefPosition() {
    if (!playerRefMesh) return;
    
    const params = currentParams[currentTab];
    
    let boundaryWidth = 1.0;
    if (params.colliderType === "Capsule") {
        boundaryWidth = (params.colliderRadius || 0.4) * 2.0;
    } else {
        boundaryWidth = (params.colliderW || 1.2) * 2.0;
    }
    
    const refDistance = params.refDistance ?? 1.0;
    const posX = -(boundaryWidth / 2.0 + PLAYER_RADIUS + refDistance);
    playerRefMesh.position.set(posX, 0, 0);
}

function updateMuzzleVisualLocation() {
    const params = currentParams[currentTab];
    if (!activeGLBModel) return;
    activeGLBModel.updateMatrixWorld(true);

    if (activeMuzzleVisual) {
        const localPos = new THREE.Vector3(
            params.muzzleX || 0.0, 
            params.muzzleY || 0.0, 
            params.muzzleZ || 0.8
        );
        
        let parentNode: THREE.Object3D = activeGLBModel;
        if (currentTab === "WHEELED") {
            const barrelNode = activeGLBModel.getObjectByName("barrel");
            const gunNode = activeGLBModel.getObjectByName("gun");
            const rotateNode = activeGLBModel.getObjectByName("rotate");
            if (barrelNode) {
                parentNode = barrelNode;
            } else if (gunNode) {
                parentNode = gunNode;
            } else if (rotateNode) {
                parentNode = rotateNode;
            }
        } else if (currentTab === "ROTARY_SHOOTER") {
            const barrelNode = activeGLBModel.getObjectByName("barrel");
            const rifleNode = activeGLBModel.getObjectByName("rifle");
            const gunNode = activeGLBModel.getObjectByName("gun");
            const rotateNode = activeGLBModel.getObjectByName("rotate");
            if (barrelNode) {
                parentNode = barrelNode;
            } else if (rifleNode) {
                parentNode = rifleNode;
            } else if (gunNode) {
                parentNode = gunNode;
            } else if (rotateNode) {
                parentNode = rotateNode;
            }
        }
        
        localPos.applyMatrix4(parentNode.matrixWorld);
        activeMuzzleVisual.position.copy(localPos);
        
        const worldQuat = new THREE.Quaternion();
        parentNode.getWorldQuaternion(worldQuat);
        if (currentTab === "WHEELED") {
            const rot180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
            worldQuat.multiply(rot180);
        }
        activeMuzzleVisual.quaternion.copy(worldQuat);
    }
    if (activeLightLeftVisual) {
        const localPos = new THREE.Vector3(
            params.lightLeftX || -0.5, 
            params.lightLeftY || 0.0, 
            params.lightLeftZ || 0.5
        );
        localPos.applyMatrix4(activeGLBModel.matrixWorld);
        activeLightLeftVisual.position.copy(localPos);
    }
    if (activeLightRightVisual) {
        const localPos = new THREE.Vector3(
            params.lightRightX || 0.5, 
            params.lightRightY || 0.0, 
            params.lightRightZ || 0.5
        );
        localPos.applyMatrix4(activeGLBModel.matrixWorld);
        activeLightRightVisual.position.copy(localPos);
    }
    const rotateNode = activeGLBModel.getObjectByName('rotate');
    const modelGroup = activeGLBModel.children[0]?.children[0] as THREE.Group;
    const baseWorldMat = modelGroup?.userData.baseWorldMatrix;

    if (activeTurretYawPivotVisual && modelGroup) {
        const turretPivotModel = new THREE.Vector3(
            params.turretYawPivotX !== undefined ? params.turretYawPivotX : 0.0, 
            params.turretYawPivotY !== undefined ? params.turretYawPivotY : 0.45, 
            params.turretYawPivotZ !== undefined ? params.turretYawPivotZ : -0.1
        );
        const worldTurretPivot = turretPivotModel.clone().applyMatrix4(modelGroup.matrixWorld);
        activeTurretYawPivotVisual.position.copy(worldTurretPivot);
    }
    if (activeGunPitchPivotVisual && modelGroup && rotateNode && baseWorldMat && rotateNode.userData.baseInvWorldMatrix) {
        const gunPivotModel = new THREE.Vector3(
            params.gunPitchPivotX !== undefined ? params.gunPitchPivotX : 0.0, 
            params.gunPitchPivotY !== undefined ? params.gunPitchPivotY : 0.65, 
            params.gunPitchPivotZ !== undefined ? params.gunPitchPivotZ : 0.0
        );
        const initialWorldGunPivot = gunPivotModel.clone().applyMatrix4(baseWorldMat);
        const localPivotInRotate = initialWorldGunPivot.clone().applyMatrix4(rotateNode.userData.baseInvWorldMatrix);
        const worldGunPivot = localPivotInRotate.clone().applyMatrix4(rotateNode.matrixWorld);
        activeGunPitchPivotVisual.position.copy(worldGunPivot);
    }

    if (modelGroup) {
        const mirrorX = params.propPivotX !== undefined ? params.propPivotX : 0.5;
        const mirrorZ = params.propPivotZ !== undefined ? params.propPivotZ : 0.5;
        
        if (activePropFLPivotVisual) {
            const localPos = new THREE.Vector3(-mirrorX, 0.05, mirrorZ).applyMatrix4(modelGroup.matrixWorld);
            activePropFLPivotVisual.position.copy(localPos);
        }
        if (activePropFRPivotVisual) {
            const localPos = new THREE.Vector3(mirrorX, 0.05, mirrorZ).applyMatrix4(modelGroup.matrixWorld);
            activePropFRPivotVisual.position.copy(localPos);
        }
        if (activePropBLPivotVisual) {
            const localPos = new THREE.Vector3(-mirrorX, 0.05, -mirrorZ).applyMatrix4(modelGroup.matrixWorld);
            activePropBLPivotVisual.position.copy(localPos);
        }
        if (activePropBRPivotVisual) {
            const localPos = new THREE.Vector3(mirrorX, 0.05, -mirrorZ).applyMatrix4(modelGroup.matrixWorld);
            activePropBRPivotVisual.position.copy(localPos);
        }
    }
}

function updateColliderPositionAndDimensions() {
    if (activeColliderWireframe) {
        scene.remove(activeColliderWireframe);
        activeColliderWireframe = null;
    }

    if (!showCollider) return;

    const params = currentParams[currentTab];

    const ox = params.colliderX || 0.0;
    const oy = params.colliderY || 0.0;
    const oz = params.colliderZ || 0.0;

    const greenMat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });

    if (params.colliderType === "Capsule") {
        const radius = params.colliderRadius || 0.8;
        const halfHeight = params.colliderHeight || 1.0;
        const cylLength = 2.0 * halfHeight;
        const capGeo = new THREE.CapsuleGeometry(radius, cylLength, 4, 12);
        const wireGeo = new THREE.EdgesGeometry(capGeo);
        activeColliderWireframe = new THREE.LineSegments(wireGeo, greenMat);
        activeColliderWireframe.position.set(ox, oy, oz);
        scene.add(activeColliderWireframe);
    } else if (params.colliderType === "Sphere" || params.colliderType === "Ball") {
        const radius = params.colliderRadius || 1.5;
        const sphereGeo = new THREE.SphereGeometry(radius, 8, 8);
        const wireGeo = new THREE.EdgesGeometry(sphereGeo);
        activeColliderWireframe = new THREE.LineSegments(wireGeo, greenMat);
        activeColliderWireframe.position.set(ox, oy, oz);
        scene.add(activeColliderWireframe);
    } else {
        const w = params.colliderW || 1.2;
        const h = params.colliderH || 0.6;
        const d = params.colliderD || 1.2;

        const boxGeo = new THREE.BoxGeometry(w * 2.0, h * 2.0, d * 2.0);
        const wireGeo = new THREE.EdgesGeometry(boxGeo);
        activeColliderWireframe = new THREE.LineSegments(wireGeo, greenMat);
        activeColliderWireframe.position.set(ox, oy, oz);
        scene.add(activeColliderWireframe);
    }
}

function resetParams() {
    const schema = DRONE_SCHEMAS.find(s => s.id === currentTab);
    if (!schema) return;

    currentParams[currentTab] = JSON.parse(JSON.stringify(schema.defaults));
    buildSliders(currentTab);
    
    // Write reset values back to DRONE_CONFIGS
    syncParamsToConfig(schema.type, currentParams[currentTab]);

    if (activeGLBModel) {
        activeGLBModel.scale.set(currentParams[currentTab].scale, currentParams[currentTab].scale, currentParams[currentTab].scale);
        const wrapper = activeGLBModel.getObjectByName("VisualWrapper");
        if (wrapper) {
            wrapper.rotation.set(
                currentParams[currentTab].orientationX,
                currentParams[currentTab].orientationY,
                currentParams[currentTab].orientationZ
            );
        }
    }
    updatePlayerRefPosition();
    updateMuzzleVisualLocation();
    updateColliderPositionAndDimensions();
}

async function loadActiveGLB() {
    if (activeGLBModel) {
        scene.remove(activeGLBModel);
        activeGLBModel = null;
    }
    if (activeMuzzleVisual) {
        scene.remove(activeMuzzleVisual);
        activeMuzzleVisual = null;
    }
    if (activeLightLeftVisual) {
        scene.remove(activeLightLeftVisual);
        activeLightLeftVisual = null;
    }
    if (activeLightRightVisual) {
        scene.remove(activeLightRightVisual);
        activeLightRightVisual = null;
    }
    if (activeTurretYawPivotVisual) {
        scene.remove(activeTurretYawPivotVisual);
        activeTurretYawPivotVisual = null;
    }
    if (activeGunPitchPivotVisual) {
        scene.remove(activeGunPitchPivotVisual);
        activeGunPitchPivotVisual = null;
    }
    if (activePropFLPivotVisual) {
        scene.remove(activePropFLPivotVisual);
        activePropFLPivotVisual = null;
    }
    if (activePropFRPivotVisual) {
        scene.remove(activePropFRPivotVisual);
        activePropFRPivotVisual = null;
    }
    if (activePropBLPivotVisual) {
        scene.remove(activePropBLPivotVisual);
        activePropBLPivotVisual = null;
    }
    if (activePropBRPivotVisual) {
        scene.remove(activePropBRPivotVisual);
        activePropBRPivotVisual = null;
    }
    if (activeColliderWireframe) {
        scene.remove(activeColliderWireframe);
        activeColliderWireframe = null;
    }

    const schema = DRONE_SCHEMAS.find(s => s.id === currentTab);
    if (!schema) return;

    const urlName = schema.glbUrl;
    const loader = new GLTFLoader();
    
    let modelGroup: THREE.Group | null = null;

    if (loadedGLBsCache.has(urlName)) {
        modelGroup = loadedGLBsCache.get(urlName)!.clone();
    } else {
        try {
            const assetUrl = await getAssetUrl(urlName);
            console.log(`[DevEntities] Sourcing GLB: ${urlName} from ${assetUrl}`);
            const gltf = await loader.loadAsync(assetUrl);
            
            if (gltf && gltf.scene) {
                gltf.scene.traverse((node: any) => {
                    if (node.isMesh && node.material) {
                        node.material.metalness = 0.85;
                        node.material.roughness = 0.15;
                    }
                });

                // Center children relative to local origin
                const box = new THREE.Box3().setFromObject(gltf.scene);
                const center = new THREE.Vector3();
                box.getCenter(center);
                gltf.scene.children.forEach((child: any) => {
                    child.position.sub(center);
                });
                gltf.scene.updateMatrixWorld(true);

                loadedGLBsCache.set(urlName, gltf.scene);
                modelGroup = gltf.scene.clone();
            }
        } catch (e) {
            console.warn(`[DevEntities] Sourcing GLB failed/absent: ${urlName}. Synthesizing highly styled dynamic fallback.`);
            
            // Generate brilliant high-quality fallback mesh dynamically
            modelGroup = new THREE.Group();
            modelGroup.name = "ProceduralMannequinFallback";

            const mat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.9, roughness: 0.1 });
            const coreMesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.15, 0.8), mat);
            coreMesh.name = "body";
            modelGroup.add(coreMesh);

            const type = schema.type;
            if (type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON) {
                // Quad arms and prop meshes
                for (let i = 0; i < 4; i++) {
                    const angle = (i * Math.PI) / 2;
                    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5), mat);
                    arm.rotation.z = Math.PI / 2;
                    arm.position.set(Math.cos(angle) * 0.25, 0, Math.sin(angle) * 0.25);
                    arm.rotation.y = -angle;
                    modelGroup.add(arm);

                    const propGroup = new THREE.Group();
                    propGroup.name = `prop_${i}`;
                    propGroup.position.set(Math.cos(angle) * 0.5, 0.05, Math.sin(angle) * 0.5);
                    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.01, 0.04), mat);
                    propGroup.add(blade);
                    modelGroup.add(propGroup);
                }
            } else if (type === DroneType.WHEELED) {
                // Front axle and wheels
                const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0), mat);
                axle.name = "FrontAxel";
                axle.rotation.x = Math.PI / 2;
                axle.position.set(0, -0.2, 0.4);
                
                const tire1 = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.15, 12), mat);
                tire1.name = "LeftTires";
                tire1.rotation.z = Math.PI / 2;
                tire1.position.y = 0.5;
                axle.add(tire1);

                const tire2 = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.15, 12), mat);
                tire2.name = "RightTires";
                tire2.rotation.z = Math.PI / 2;
                tire2.position.y = -0.5;
                axle.add(tire2);
                
                modelGroup.add(axle);
            } else if (type === DroneType.HUMANOID) {
                // Standalone biped joints
                const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.6), mat);
                torso.name = "Torso";
                torso.position.y = 0.7;
                modelGroup.add(torso);

                const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), mat);
                head.name = "Head";
                head.position.set(0, 1.1, 0);
                modelGroup.add(head);

                const lLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.5), mat);
                lLeg.name = "LeftLeg";
                lLeg.position.set(-0.15, 0.25, 0);
                modelGroup.add(lLeg);

                const rLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.5), mat);
                rLeg.name = "RightLeg";
                rLeg.position.set(0.15, 0.25, 0);
                modelGroup.add(rLeg);

                const lArm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.45), mat);
                lArm.name = "LeftArm";
                lArm.position.set(-0.28, 0.75, 0);
                modelGroup.add(lArm);

                const rArm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.45), mat);
                rArm.name = "RightArm";
                rArm.position.set(0.28, 0.75, 0);
                modelGroup.add(rArm);
            } else if (type === DroneType.ROBOT_DOG) {
                const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.8), mat);
                body.name = "Chassis";
                body.position.y = 0.4;
                modelGroup.add(body);

                const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.4), mat);
                fl.name = "FrontLeftLeg";
                fl.position.set(-0.18, 0.2, 0.3);
                modelGroup.add(fl);

                const fr = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.4), mat);
                fr.name = "FrontRightLeg";
                fr.position.set(0.18, 0.2, 0.3);
                modelGroup.add(fr);

                const bl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.4), mat);
                bl.name = "BackLeftLeg";
                bl.position.set(-0.18, 0.2, -0.3);
                modelGroup.add(bl);

                const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.4), mat);
                br.name = "BackRightLeg";
                br.position.set(0.18, 0.2, -0.3);
                modelGroup.add(br);
            }
        }
    }

    if (modelGroup) {
        // Compute normalization scale factor based on the bounding sphere of the body mesh (the same way the match is doing it)
        let scaleFactor = 1.0;
        const targetRadius = DRONE_CONFIGS[schema.type]?.visualRadius ?? 1.0;
        
        const meshes: THREE.Mesh[] = [];
        modelGroup.traverse((node: any) => {
            if (node.isMesh && node.geometry) {
                meshes.push(node as THREE.Mesh);
            }
        });
        
        let bodyMesh = meshes.find(m => m.name === 'body' || m.name.toLowerCase().includes('body')) || meshes[0];
        if (bodyMesh && bodyMesh.geometry) {
            if (!bodyMesh.geometry.boundingBox) {
                bodyMesh.geometry.computeBoundingBox();
            }
            const sphere = new THREE.Sphere();
            if (bodyMesh.geometry.boundingBox) {
                bodyMesh.geometry.boundingBox.getBoundingSphere(sphere);
            }
            const currentRadius = sphere.radius || 1.0;
            scaleFactor = targetRadius / currentRadius;
        }
        
        modelGroup.scale.set(scaleFactor, scaleFactor, scaleFactor);

        // Compute matrixWorld to ensure clean initial layout matrices
        modelGroup.updateMatrixWorld(true);

        modelGroup.userData.baseWorldMatrix = modelGroup.matrixWorld.clone();

        // Bake pivots and base matrices onto each node's userData of the active instance to prevent GC re-allocation in tickLoop
        const invModelWorld = modelGroup.matrixWorld.clone().invert();
        modelGroup.traverse((child: any) => {
            child.userData.baseLocalMatrix = child.matrix.clone();
            
            let pivot = new THREE.Vector3();
            const b = new THREE.Box3().setFromObject(child);
            if (!b.isEmpty()) {
                b.getCenter(pivot);
            }
            
            const modelPivot = pivot.clone();
            modelPivot.applyMatrix4(invModelWorld);
            child.userData.modelPivot = modelPivot;
            
            const localPivot = pivot.clone();
            if (child.matrixWorld) {
                const invWorld = child.matrixWorld.clone().invert();
                child.userData.baseInvWorldMatrix = invWorld.clone();
                localPivot.applyMatrix4(invWorld);
            }

            const parentNameLower = child.parent && child.parent !== modelGroup ? child.parent.name.toLowerCase() : '';
            const isPropellerMesh = child.isMesh && (parentNameLower.includes('prop') && parentNameLower !== 'prop');
            if (isPropellerMesh) {
                const config = DRONE_CONFIGS[schema.type];
                let offset_x = 0.5;
                let offset_z = 0.5;
                if (config) {
                    if (config.propellerOffset) {
                        offset_x = config.propellerOffset[0];
                        offset_z = config.propellerOffset[1];
                    } else if (config.propPivotX !== undefined && config.propPivotZ !== undefined) {
                        offset_x = config.propPivotX;
                        offset_z = config.propPivotZ;
                    }
                }
                let px = 0;
                let pz = 0;
                if (pivot.x < 0 && pivot.z > 0) {
                    px = -offset_x; pz = offset_z;
                } else if (pivot.x > 0 && pivot.z > 0) {
                    px = offset_x; pz = offset_z;
                } else if (pivot.x < 0 && pivot.z < 0) {
                    px = -offset_x; pz = -offset_z;
                } else if (pivot.x > 0 && pivot.z < 0) {
                    px = offset_x; pz = -offset_z;
                } else {
                    px = pivot.x; pz = pivot.z;
                }
                const tempPropellerPivot = new THREE.Vector3(px, 0.05, pz);
                if (child.userData.baseInvWorldMatrix) {
                    tempPropellerPivot.applyMatrix4(child.userData.baseInvWorldMatrix);
                }
                localPivot.copy(tempPropellerPivot);
            }

            child.userData.localPivot = localPivot;
            child.matrixAutoUpdate = false; // Direct matrix manual updates
        });

        const visualWrapperGroup = new THREE.Group();
        visualWrapperGroup.name = "VisualWrapper";
        
        const params = currentParams[currentTab];
        const ox = params.orientationX ?? 0.0;
        const oy = params.orientationY ?? 0.0;
        const oz = params.orientationZ ?? 0.0;
        visualWrapperGroup.rotation.set(ox, oy, oz);
        visualWrapperGroup.add(modelGroup);

        activeGLBModel = new THREE.Group();
        activeGLBModel.add(visualWrapperGroup);
        
        const userScale = params.scale ?? 1.0;
        activeGLBModel.scale.set(userScale, userScale, userScale);
        activeGLBModel.position.set(0, 0.2, 0);
        scene.add(activeGLBModel);

        const mGeo = new THREE.SphereGeometry(0.06, 8, 8);
        const mMat = new THREE.MeshBasicMaterial({ color: 0xff0064, transparent: true, opacity: 0.85 });
        activeMuzzleVisual = new THREE.Mesh(mGeo, mMat);
        scene.add(activeMuzzleVisual);
        activeMuzzleVisual.visible = showMuzzle;

        // Left and Right Light Indicators (Yellow spheres)
        const lMat = new THREE.MeshBasicMaterial({ color: 0xffea00, transparent: true, opacity: 0.85 });
        activeLightLeftVisual = new THREE.Mesh(mGeo, lMat);
        scene.add(activeLightLeftVisual);
        activeLightLeftVisual.visible = showMuzzle;

        activeLightRightVisual = new THREE.Mesh(mGeo, lMat);
        scene.add(activeLightRightVisual);
        activeLightRightVisual.visible = showMuzzle;

        const isWheeled = schema.type === DroneType.WHEELED;
        const yawMat = new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.85 });
        activeTurretYawPivotVisual = new THREE.Mesh(mGeo, yawMat);
        scene.add(activeTurretYawPivotVisual);
        activeTurretYawPivotVisual.visible = (isWheeled && showPivots);

        const pitchMat = new THREE.MeshBasicMaterial({ color: 0xaa00ff, transparent: true, opacity: 0.85 });
        activeGunPitchPivotVisual = new THREE.Mesh(mGeo, pitchMat);
        scene.add(activeGunPitchPivotVisual);
        activeGunPitchPivotVisual.visible = (isWheeled && showPivots);

        const isQuad = schema.type === DroneType.ROTARY_SHOOTER || schema.type === DroneType.BOMBER || schema.type === DroneType.RECON;
        const propMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.85 });
        
        activePropFLPivotVisual = new THREE.Mesh(mGeo, propMat);
        scene.add(activePropFLPivotVisual);
        activePropFLPivotVisual.visible = (isQuad && showPivots);

        activePropFRPivotVisual = new THREE.Mesh(mGeo, propMat);
        scene.add(activePropFRPivotVisual);
        activePropFRPivotVisual.visible = (isQuad && showPivots);

        activePropBLPivotVisual = new THREE.Mesh(mGeo, propMat);
        scene.add(activePropBLPivotVisual);
        activePropBLPivotVisual.visible = (isQuad && showPivots);

        activePropBRPivotVisual = new THREE.Mesh(mGeo, propMat);
        scene.add(activePropBRPivotVisual);
        activePropBRPivotVisual.visible = (isQuad && showPivots);

        updatePlayerRefPosition();
        updateMuzzleVisualLocation();
        updateColliderPositionAndDimensions();
        if (schema.type === DroneType.WHEELED) {
            verifyPivotRotationMath();
        }
    }
}

function triggerSingleShot() {
    recoilState = "KICK";
    recoilProgress = 0.0;
    
    const schema = DRONE_SCHEMAS.find(s => s.id === currentTab);
    if (!schema) return;
    const params = currentParams[currentTab];
    
    // Firing Sound
    const basePitch = params.firingSoundPitch ?? 1.0;
    const pitch = basePitch * (0.95 + Math.random() * 0.1); // Pitch variation to break monotony
    const audioCtx = (window as any).audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx) {
        (window as any).audioCtx = audioCtx;
        const shotBuffer = (window as any).shotBuffer;
        if (shotBuffer) {
            const source = audioCtx.createBufferSource();
            const gainNode = audioCtx.createGain();
            
            // Strictly gate via master and sfx settings
            const s = (window as any).vexeaSettings;
            const masterVol = s ? s.masterVolume : 1.0;
            const sfxVol = s ? s.sfxVolume : 1.0;
            gainNode.gain.value = masterVol * sfxVol;

            source.buffer = shotBuffer;
            source.playbackRate.value = pitch;
            source.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            source.start();
        }
    }
    
    // VFX Muzzle Flash & Tracer
    if (schema.type !== DroneType.RECON && schema.type !== DroneType.BOMBER) {
        if (activeMuzzleVisual && activeGLBModel) {
            const flashScale = params.muzzleFlashScale ?? 1.0;
            triggerFlash(activeMuzzleVisual.position, flashScale);
            
            // Tracer direction is based on the muzzle's world orientation
            const dir = currentTab === "WHEELED" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
            dir.applyQuaternion(activeMuzzleVisual.getWorldQuaternion(new THREE.Quaternion()));
            spawnTracer(activeMuzzleVisual.position, dir);
        }
    }
}

function openExportPanel() {
    const out = {
        _meta: {
            app: "VEXEA",
            version: "0.1.0",
            exportTime: new Date().toISOString(),
            description: "Calibrated drone performance and visual layout presets"
        },
        configs: currentParams
    };

    const json = JSON.stringify(out, null, 4);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = `vexea_drone_configs_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function activateScreen() {
    if (isDevEntitiesActive) return;
    isDevEntitiesActive = true;
    const el = document.getElementById("dev-entities-screen")!;
    el.style.display = "flex";

    setTimeout(() => { 
        el.style.opacity = "1"; 
        onWindowResize();
    }, 50);

    audioManager.setMatchState(false);
    requestAnimationFrame(tickLoop);
}

export function deactivateScreen() {
    isDevEntitiesActive = false;
    const el = document.getElementById("dev-entities-screen")!;
    el.style.opacity = "0";

    setTimeout(() => { el.style.display = "none"; }, 300);
    screenManager.showMainMenu();
}

let lastTickTime = performance.now();

function tickLoop() {
    if (!isDevEntitiesActive) return;
    requestAnimationFrame(tickLoop);

    const now = performance.now();
    let dt = (now - lastTickTime) / 1000;
    lastTickTime = now;

    if (dt > 0.1) dt = 0.1;

    simulationTime += dt;

    updateOrbitCamera();
    runLoopSimulation(dt);
    applyProceduralModelAnimations(dt);
    updateVFX(dt, camera);

    if (localRenderer && scene && camera) {
        localRenderer.render(scene, camera);
    }
}

function updateOrbitCamera() {
    const cosPhi = Math.cos(camPhi);
    camera.position.x = camTarget.x + camRadius * Math.sin(camTheta) * cosPhi;
    camera.position.y = camTarget.y + camRadius * Math.sin(camPhi);
    camera.position.z = camTarget.z + camRadius * Math.cos(camTheta) * cosPhi;
    camera.lookAt(camTarget);
}

function runSliderAnimationTick(dt: number) {
    if (!activeGLBModel) return;
    const schema = DRONE_SCHEMAS.find(s => s.id === currentTab);
    if (!schema) return;
    const params = currentParams[currentTab];
    const key = activeSliderAnimationKey;

    // Reset base posture to default to prevent accumulation of movements
    activeGLBModel.position.set(0, 0.2, 0);
    activeGLBModel.quaternion.set(0, 0, 0, 1);

    if (key === "scale") {
        const baseScale = params.scale ?? 1.0;
        const oscScale = baseScale * (1.0 + Math.sin(sliderAnimTimer * 4.0) * 0.25);
        activeGLBModel.scale.set(oscScale, oscScale, oscScale);
        updatePlayerRefPosition();
        updateColliderPositionAndDimensions();
        updateMuzzleVisualLocation();
    } 
    else if (key === "orientationX" || key === "orientationY" || key === "orientationZ") {
        const baseOx = params.orientationX ?? 0.0;
        const baseOy = params.orientationY ?? 0.0;
        const baseOz = params.orientationZ ?? 0.0;
        let ox = baseOx;
        let oy = baseOy;
        let oz = baseOz;
        if (key === "orientationX") ox += Math.sin(sliderAnimTimer * 3.0) * 0.5;
        if (key === "orientationY") oy += Math.sin(sliderAnimTimer * 3.0) * 0.5;
        if (key === "orientationZ") oz += Math.sin(sliderAnimTimer * 3.0) * 0.5;
        const wrapper = activeGLBModel.getObjectByName("VisualWrapper");
        if (wrapper) {
            wrapper.rotation.set(ox, oy, oz);
        }
    } 
    else if (key === "refDistance") {
        const baseDistance = params.refDistance ?? 1.0;
        const oscDistance = baseDistance + Math.sin(sliderAnimTimer * 3.0) * 0.5;
        let boundaryWidth = 1.0;
        if (params.colliderType === "Capsule") {
            boundaryWidth = (params.colliderRadius || 0.4) * 2.0;
        } else {
            boundaryWidth = (params.colliderW || 1.2) * 2.0;
        }
        const posX = -(boundaryWidth / 2.0 + PLAYER_RADIUS + oscDistance);
        if (playerRefMesh) {
            playerRefMesh.position.set(posX, 0, 0);
        }
    } 
    else if (key === "hp") {
        if (!simulationHelperGroup) {
            simulationHelperGroup = new THREE.Group();
            scene.add(simulationHelperGroup);
            
            // Create background red bar and foreground green bar
            const bgGeo = new THREE.BoxGeometry(1.0, 0.1, 0.05);
            const bgMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
            const bgMesh = new THREE.Mesh(bgGeo, bgMat);
            bgMesh.position.set(0, 1.5, 0);
            simulationHelperGroup.add(bgMesh);
            
            const fgGeo = new THREE.BoxGeometry(1.0, 0.1, 0.06);
            const fgMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
            const fgMesh = new THREE.Mesh(fgGeo, fgMat);
            fgMesh.name = "hp_foreground";
            fgMesh.position.set(0, 1.5, 0.01);
            simulationHelperGroup.add(fgMesh);
        }
        
        const progress = 1.0 - (sliderAnimTimer * 0.5) % 1.0;
        const fg = simulationHelperGroup.getObjectByName("hp_foreground") as THREE.Mesh;
        if (fg) {
            fg.scale.set(progress, 1, 1);
            fg.position.x = - (1.0 - progress) * 0.5;
        }
    } 
    else if (key === "colliderX" || key === "colliderY" || key === "colliderZ") {
        const ox = params.colliderX || 0.0;
        const oy = params.colliderY || 0.0;
        const oz = params.colliderZ || 0.0;
        
        let extraX = 0, extraY = 0, extraZ = 0;
        if (key === "colliderX") extraX = Math.sin(sliderAnimTimer * 5.0) * 0.5;
        if (key === "colliderY") extraY = Math.sin(sliderAnimTimer * 5.0) * 0.5;
        if (key === "colliderZ") extraZ = Math.sin(sliderAnimTimer * 5.0) * 0.5;
        
        if (activeColliderWireframe) {
            activeColliderWireframe.position.set(ox + extraX, oy + extraY, oz + extraZ);
        }
    } 
    else if (key === "colliderW" || key === "colliderH" || key === "colliderD" || key === "colliderRadius" || key === "colliderHeight") {
        if (activeColliderWireframe) {
            scene.remove(activeColliderWireframe);
            activeColliderWireframe = null;
        }
        
        const ox = params.colliderX || 0.0;
        const oy = params.colliderY || 0.0;
        const oz = params.colliderZ || 0.0;
        const greenMat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
        const pulse = 1.0 + Math.sin(sliderAnimTimer * 4.0) * 0.25;
        
        if (params.colliderType === "Capsule") {
            let radius = params.colliderRadius || 0.8;
            let halfHeight = params.colliderHeight || 1.0;
            if (key === "colliderRadius") radius *= pulse;
            if (key === "colliderHeight") halfHeight *= pulse;
            
            const cylLength = 2.0 * halfHeight;
            const capGeo = new THREE.CapsuleGeometry(radius, cylLength, 4, 12);
            const wireGeo = new THREE.EdgesGeometry(capGeo);
            activeColliderWireframe = new THREE.LineSegments(wireGeo, greenMat);
            activeColliderWireframe.position.set(ox, oy, oz);
            scene.add(activeColliderWireframe);
        } else if (params.colliderType === "Sphere" || params.colliderType === "Ball") {
            let radius = params.colliderRadius || 1.5;
            if (key === "colliderRadius") radius *= pulse;
            
            const sphereGeo = new THREE.SphereGeometry(radius, 8, 8);
            const wireGeo = new THREE.EdgesGeometry(sphereGeo);
            activeColliderWireframe = new THREE.LineSegments(wireGeo, greenMat);
            activeColliderWireframe.position.set(ox, oy, oz);
            scene.add(activeColliderWireframe);
        } else {
            let w = params.colliderW || 1.2;
            let h = params.colliderH || 0.6;
            let d = params.colliderD || 1.2;
            if (key === "colliderW") w *= pulse;
            if (key === "colliderH") h *= pulse;
            if (key === "colliderD") d *= pulse;
            
            const boxGeo = new THREE.BoxGeometry(w * 2.0, h * 2.0, d * 2.0);
            const wireGeo = new THREE.EdgesGeometry(boxGeo);
            activeColliderWireframe = new THREE.LineSegments(wireGeo, greenMat);
            activeColliderWireframe.position.set(ox, oy, oz);
            scene.add(activeColliderWireframe);
        }
    } 
    else if (key === "muzzleX" || key === "muzzleY" || key === "muzzleZ") {
        if (activeMuzzleVisual) {
            const pulse = 1.0 + Math.sin(sliderAnimTimer * 5.0) * 0.5;
            activeMuzzleVisual.scale.set(pulse, pulse, pulse);
            
            let mx = params.muzzleX || 0.0;
            let my = params.muzzleY || 0.0;
            let mz = params.muzzleZ || 0.8;
            
            if (key === "muzzleX") mx += Math.sin(sliderAnimTimer * 4.0) * 0.4;
            if (key === "muzzleY") my += Math.sin(sliderAnimTimer * 4.0) * 0.4;
            if (key === "muzzleZ") mz += Math.sin(sliderAnimTimer * 4.0) * 0.4;
            
            let parentNode: THREE.Object3D = activeGLBModel;
            if (currentTab === "WHEELED") {
                const barrelNode = activeGLBModel.getObjectByName("barrel");
                const gunNode = activeGLBModel.getObjectByName("gun");
                const rotateNode = activeGLBModel.getObjectByName("rotate");
                if (barrelNode) parentNode = barrelNode;
                else if (gunNode) parentNode = gunNode;
                else if (rotateNode) parentNode = rotateNode;
            } else if (currentTab === "ROTARY_SHOOTER") {
                const barrelNode = activeGLBModel.getObjectByName("barrel");
                const rifleNode = activeGLBModel.getObjectByName("rifle");
                const gunNode = activeGLBModel.getObjectByName("gun");
                const rotateNode = activeGLBModel.getObjectByName("rotate");
                if (barrelNode) parentNode = barrelNode;
                else if (rifleNode) parentNode = rifleNode;
                else if (gunNode) parentNode = gunNode;
                else if (rotateNode) parentNode = rotateNode;
            }
            
            const localPos = new THREE.Vector3(mx, my, mz);
            localPos.applyMatrix4(parentNode.matrixWorld);
            activeMuzzleVisual.position.copy(localPos);
        }
    } 
    else if (key === "lightLeftX" || key === "lightLeftY" || key === "lightLeftZ" || key === "lightRightX" || key === "lightRightY" || key === "lightRightZ") {
        if (activeLightLeftVisual) {
            const pulse = 1.0 + Math.sin(sliderAnimTimer * 5.0) * 0.5;
            activeLightLeftVisual.scale.set(pulse, pulse, pulse);
            
            let lx = params.lightLeftX || -0.5;
            let ly = params.lightLeftY || 0.0;
            let lz = params.lightLeftZ || 0.5;
            
            if (key === "lightLeftX") lx += Math.sin(sliderAnimTimer * 4.0) * 0.4;
            if (key === "lightLeftY") ly += Math.sin(sliderAnimTimer * 4.0) * 0.4;
            if (key === "lightLeftZ") lz += Math.sin(sliderAnimTimer * 4.0) * 0.4;
            
            const localPos = new THREE.Vector3(lx, ly, lz);
            localPos.applyMatrix4(activeGLBModel.matrixWorld);
            activeLightLeftVisual.position.copy(localPos);
        }
        if (activeLightRightVisual) {
            const pulse = 1.0 + Math.sin(sliderAnimTimer * 5.0) * 0.5;
            activeLightRightVisual.scale.set(pulse, pulse, pulse);
            
            let rx = params.lightRightX || 0.5;
            let ry = params.lightRightY || 0.0;
            let rz = params.lightRightZ || 0.5;
            
            if (key === "lightRightX") rx += Math.sin(sliderAnimTimer * 4.0) * 0.4;
            if (key === "lightRightY") ry += Math.sin(sliderAnimTimer * 4.0) * 0.4;
            if (key === "lightRightZ") rz += Math.sin(sliderAnimTimer * 4.0) * 0.4;
            
            const localPos = new THREE.Vector3(rx, ry, rz);
            localPos.applyMatrix4(activeGLBModel.matrixWorld);
            activeLightRightVisual.position.copy(localPos);
        }
    } 
    else if (key === "detonationTriggerRadius") {
        if (!simulationHelperGroup) {
            simulationHelperGroup = new THREE.Group();
            scene.add(simulationHelperGroup);
            
            const radius = params.detonationTriggerRadius || 4.0;
            const geo = new THREE.SphereGeometry(radius, 16, 16);
            const mat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.2 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.name = "detonation_sphere";
            simulationHelperGroup.add(mesh);
        }
        
        const sphere = simulationHelperGroup.getObjectByName("detonation_sphere") as THREE.Mesh;
        if (sphere) {
            const radius = params.detonationTriggerRadius || 4.0;
            const pulse = 1.0 + Math.sin(sliderAnimTimer * 4.0) * 0.15;
            sphere.scale.set(pulse, pulse, pulse);
        }
    } 
    else if (key === "propellerSpinRate") {
        // Handled identically to the match in the unified applyProceduralModelAnimations
    } 
    else if (key === "hoverSwayAmount" || key === "hoverSwaySpeed") {
        // Handled identically to the match in the unified applyProceduralModelAnimations
    } 
    else if (key === "verticalBobAmount" || key === "verticalBobSpeed") {
        // Handled identically to the match in the unified applyProceduralModelAnimations
    } 
    else if (key === "muzzleFlashScale" || key === "firingSoundPitch" || key === "barrelRecoilAmount" || key === "recoilDuration" || key === "recoilRecoverDuration" || key === "fireCooldown") {
        const fireInterval = key === "fireCooldown" ? (params.fireCooldown ?? 15) * 0.0166 : 0.6;
        if (Math.floor(sliderAnimTimer / fireInterval) > Math.floor((sliderAnimTimer - dt) / fireInterval)) {
            triggerSingleShot();
        }
    } 
    else if (key === "wheelRollSpeed") {
        state.wheelAngle += dt * 10.0 * (params.wheelRollSpeed ?? 2.5);
    } 
    else if (key === "wheelSteerAngle") {
        state.steerAngle = Math.sin(sliderAnimTimer * 3.0) * (params.wheelSteerAngle ?? 0.5);
    } 
    else if (key === "chassisVibration" || key === "chassisVibrationSpeed") {
        // Handled procedurally on the body mesh itself in applyProceduralModelAnimations
    } 
    else if (key === "speed" || key === "minSpeed") {
        const speedVal = key === "speed" ? (params.speed ?? 10.0) : (params.minSpeed ?? 5.0);
        const duration = 50.0 / speedVal;
        const progress = (sliderAnimTimer % duration) / duration;
        activeGLBModel.position.set(0, 0.2, -10.0 + progress * 50.0);
        
        state.spinAngle += dt * 35.0;
        state.wheelAngle += dt * speedVal * 2.5;
    } 
    else if (key === "maxRotationSpeed") {
        const maxRotSpeed = params.maxRotationSpeed ?? 3.0;
        const loopLen = 4.0;
        const timeInLoop = sliderAnimTimer % loopLen;
        let currentRotSpeed = 0.0;
        if (timeInLoop < 1.0) {
            const t = timeInLoop;
            currentRotSpeed = maxRotSpeed * (t * t * (3 - 2 * t));
        } else if (timeInLoop < 3.0) {
            currentRotSpeed = maxRotSpeed;
        } else {
            const t = 1.0 - (timeInLoop - 3.0);
            currentRotSpeed = maxRotSpeed * (t * t * (3 - 2 * t));
        }
        activeGLBModel.rotation.y += dt * currentRotSpeed;
    } 
    else if (key === "maxVerticalSpeed") {
        const maxVertSpeed = params.maxVerticalSpeed ?? 5.0;
        const cycle = sliderAnimTimer % 4.0;
        let targetY = 0.2;
        if (cycle < 1.0) {
            const t = cycle;
            targetY = 0.2 + maxVertSpeed * 0.5 * (t * t * (1.5 - t * 0.5));
        } else if (cycle < 2.0) {
            const t = cycle - 1.0;
            targetY = 0.2 + maxVertSpeed * 0.5 + maxVertSpeed * t;
        } else if (cycle < 3.0) {
            const t = cycle - 2.0;
            targetY = 0.2 + maxVertSpeed * 1.5 - maxVertSpeed * 0.5 * ( (1-t) * (1-t) * (1.5 - (1-t) * 0.5) );
        } else {
            const t = cycle - 3.0;
            const smoothT = t * t * (3 - 2 * t);
            targetY = 0.2 + maxVertSpeed * 1.5 * (1.0 - smoothT);
        }
        activeGLBModel.position.y = targetY;
    } 
    else if (key === "bankingAngle") {
        const bank = params.bankingAngle ?? 0.35;
        activeGLBModel.rotation.z = Math.sin(sliderAnimTimer * 2.0) * bank;
    } 
    else if (key === "maxTurnRate") {
        const rate = params.maxTurnRate ?? 1.5;
        activeGLBModel.rotation.y = Math.sin(sliderAnimTimer * 1.5) * rate;
    } 
    else if (key === "pitchAngle") {
        const pitch = params.pitchAngle ?? 0.35;
        activeGLBModel.rotation.x = Math.sin(sliderAnimTimer * 2.0) * pitch;
    } 
    else if (key === "engagementRange") {
        if (!simulationHelperGroup) {
            simulationHelperGroup = new THREE.Group();
            scene.add(simulationHelperGroup);
            
            const range = params.engagementRange || 40.0;
            const geo = new THREE.CylinderGeometry(range, range, 0.2, 32, 1, true);
            const mat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.3 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.name = "engagement_range";
            simulationHelperGroup.add(mesh);
        }
        const mesh = simulationHelperGroup.getObjectByName("engagement_range") as THREE.Mesh;
        if (mesh) {
            const range = params.engagementRange || 40.0;
            const pulse = 1.0 + Math.sin(sliderAnimTimer * 3.0) * 0.05;
            mesh.scale.set(pulse, 1, pulse);
        }
    } 
    else if (key === "maxTurnAngle") {
        const angle = params.maxTurnAngle ?? 0.6;
        activeGLBModel.rotation.y = Math.sin(sliderAnimTimer * 2.0) * angle;
    } 
    else if (key === "maxTurnSpeed") {
        const speed = params.maxTurnSpeed ?? 3.0;
        activeGLBModel.rotation.y = Math.sin(sliderAnimTimer * speed) * 0.5;
    } 
    else if (key === "turretRotateAngle") {
        const angle = params.turretRotateAngle ?? 3.14;
        state.turretYaw = Math.sin(sliderAnimTimer * 2.0) * angle * 0.5;
    } 
    else if (key === "turretGunAngle") {
        const angle = params.turretGunAngle ?? 0.5;
        state.turretPitch = (Math.sin(sliderAnimTimer * 2.0) * 0.5 + 0.5) * angle;
    } 
    else if (key === "damage") {
        const interval = 1.0;
        if (Math.floor(sliderAnimTimer / interval) > Math.floor((sliderAnimTimer - dt) / interval)) {
            if (playerRefMesh) {
                triggerFlash(playerRefMesh.position, 1.0);
                
                const damageVal = params.damage ?? 10;
                const floatText = document.createElement("div");
                floatText.textContent = `-${damageVal}`;
                Object.assign(floatText.style, {
                    position: "absolute",
                    color: "#ff0000",
                    fontSize: "20px",
                    fontFamily: "monospace",
                    fontWeight: "bold",
                    pointerEvents: "none",
                    transition: "all 1s ease-out",
                    opacity: "1",
                    transform: "translate(-50%, -50%)"
                });
                
                const pos = new THREE.Vector3(0, 1.5, 0).applyMatrix4(playerRefMesh.matrixWorld);
                pos.project(camera);
                const rect = document.getElementById("de-projected-markers")!.getBoundingClientRect();
                const x = (pos.x * 0.5 + 0.5) * rect.width;
                const y = (-(pos.y * 0.5) + 0.5) * rect.height;
                
                floatText.style.left = `${x}px`;
                floatText.style.top = `${y}px`;
                document.getElementById("de-projected-markers")!.appendChild(floatText);
                
                setTimeout(() => {
                    floatText.style.top = `${y - 100}px`;
                    floatText.style.opacity = "0";
                }, 50);
                setTimeout(() => {
                    floatText.remove();
                }, 1000);
            }
        }
    } 
    else if (key === "detectionRadius") {
        if (!simulationHelperGroup) {
            simulationHelperGroup = new THREE.Group();
            scene.add(simulationHelperGroup);
            
            const radius = params.detectionRadius || 30.0;
            const geo = new THREE.CylinderGeometry(radius, radius, 0.1, 32, 1, true);
            const mat = new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true, transparent: true, opacity: 0.2 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.name = "detection_radius";
            simulationHelperGroup.add(mesh);
        }
        const mesh = simulationHelperGroup.getObjectByName("detection_radius") as THREE.Mesh;
        if (mesh) {
            const radius = params.detectionRadius || 30.0;
            const pulse = 1.0 + Math.sin(sliderAnimTimer * 3.0) * 0.05;
            mesh.scale.set(pulse, 1, pulse);
        }
    } 
    else if (key === "decelerationRadius") {
        if (!simulationHelperGroup) {
            simulationHelperGroup = new THREE.Group();
            scene.add(simulationHelperGroup);
            
            const radius = params.decelerationRadius || 5.0;
            const geo = new THREE.CylinderGeometry(radius, radius, 0.1, 32, 1, true);
            const mat = new THREE.MeshBasicMaterial({ color: 0xff8800, wireframe: true, transparent: true, opacity: 0.25 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.name = "deceleration_radius";
            simulationHelperGroup.add(mesh);
        }
        const mesh = simulationHelperGroup.getObjectByName("deceleration_radius") as THREE.Mesh;
        if (mesh) {
            const radius = params.decelerationRadius || 5.0;
            const pulse = 1.0 + Math.sin(sliderAnimTimer * 3.0) * 0.05;
            mesh.scale.set(pulse, 1, pulse);
        }
    } 
    else if (key === "fovHalfAngle") {
        if (!simulationHelperGroup) {
            simulationHelperGroup = new THREE.Group();
            scene.add(simulationHelperGroup);
            
            const halfAngle = params.fovHalfAngle ?? (Math.PI / 4);
            const radius = params.detectionRadius || 30.0;
            const height = Math.min(radius, 15.0);
            const baseRadius = height * Math.tan(halfAngle);
            
            const coneGeo = new THREE.ConeGeometry(baseRadius, height, 16, 1, true);
            const coneMat = new THREE.MeshBasicMaterial({
                color: 0x00ffcc,
                wireframe: true,
                transparent: true,
                opacity: 0.35
            });
            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.name = "fov_cone";
            cone.rotation.x = -Math.PI / 2;
            cone.position.z = height / 2;
            
            simulationHelperGroup.add(cone);
        } else {
            const cone = simulationHelperGroup.getObjectByName("fov_cone") as THREE.Mesh;
            if (cone) {
                const halfAngle = params.fovHalfAngle ?? (Math.PI / 4);
                const radius = params.detectionRadius || 30.0;
                const height = Math.min(radius, 15.0);
                const baseRadius = height * Math.tan(halfAngle);
                
                cone.geometry.dispose();
                cone.geometry = new THREE.ConeGeometry(baseRadius, height, 16, 1, true);
                cone.rotation.x = -Math.PI / 2;
                cone.position.z = height / 2;
            }
        }
        
        if (simulationHelperGroup && activeGLBModel) {
            simulationHelperGroup.position.copy(activeGLBModel.position);
            simulationHelperGroup.quaternion.copy(activeGLBModel.quaternion);
        }
    }
    else if (key === "propPivotX" || key === "propPivotZ") {
        const pulse = 1.0 + Math.sin(sliderAnimTimer * 5.0) * 0.5;
        if (activePropFLPivotVisual) activePropFLPivotVisual.scale.set(pulse, pulse, pulse);
        if (activePropFRPivotVisual) activePropFRPivotVisual.scale.set(pulse, pulse, pulse);
        if (activePropBLPivotVisual) activePropBLPivotVisual.scale.set(pulse, pulse, pulse);
        if (activePropBRPivotVisual) activePropBRPivotVisual.scale.set(pulse, pulse, pulse);
    }
}

function runLoopSimulation(dt: number) {
    if (!activeGLBModel) return;

    const schema = DRONE_SCHEMAS.find(s => s.id === currentTab);
    if (!schema) return;

    const params = currentParams[currentTab];

    if (activeSliderAnimationKey) {
        sliderAnimTimer += dt;
        runSliderAnimationTick(dt);
    } else {
        loopTimer += dt;
        // Run active loop routine from our magnificent modular schema!
        const activeLoop = schema.availableLoopModes.find(m => m.id === loopMode);
        if (activeLoop) {
            activeLoop.run(dt, params, activeGLBModel, simulationTime, loopTimer, schema.type);
        }
    }

    // Align projected HTML markers in 3D screen space (Issue 11 & 16)
    const projectedMarkers = document.getElementById("de-projected-markers");
    if (projectedMarkers && camera) {
        projectedMarkers.innerHTML = "";
        distances.forEach(d => {
            const markerWorldPos = new THREE.Vector3(2.7, 1.1, d);
            markerWorldPos.project(camera);
            
            // Behind camera, ignore
            if (markerWorldPos.z > 1.0) return;
            
            const rect = projectedMarkers.getBoundingClientRect();
            const x = (markerWorldPos.x * 0.5 + 0.5) * rect.width;
            const y = (-(markerWorldPos.y * 0.5) + 0.5) * rect.height;
            
            if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
                const label = document.createElement("div");
                label.style.position = "absolute";
                label.style.left = `${x}px`;
                label.style.top = `${y}px`;
                label.style.transform = "translate(-50%, -100%)";
                label.style.background = "rgba(10, 15, 25, 0.9)";
                label.style.border = `1px solid ${DS.colors.accent}`;
                label.style.padding = "2px 6px";
                label.style.borderRadius = "3px";
                label.style.fontSize = "9px";
                label.style.fontFamily = "monospace";
                label.style.color = DS.colors.accent;
                label.style.pointerEvents = "none";
                label.textContent = `${d}M`;
                projectedMarkers.appendChild(label);
            }
        });
    }

    // Update muzzle location & move collider with model (Issue 3, 10)
    updateMuzzleVisualLocation();
    
    if (activeColliderWireframe && activeGLBModel) {
        activeColliderWireframe.position.copy(activeGLBModel.position);
        activeColliderWireframe.quaternion.copy(activeGLBModel.quaternion);
        
        const ox = params.colliderX || 0.0;
        const oy = params.colliderY || 0.0;
        const oz = params.colliderZ || 0.0;
        
        const offset = new THREE.Vector3(ox, oy, oz);
        offset.applyQuaternion(activeGLBModel.quaternion);
        activeColliderWireframe.position.add(offset);
    }
}

function applyProceduralModelAnimations(dt: number) {
    if (!activeGLBModel) return;

    const schema = DRONE_SCHEMAS.find(s => s.id === currentTab);
    if (!schema) return;

    const params = currentParams[currentTab];
    const type = schema.type;

    // Resolve weapon recoil state machines
    if (recoilState === "KICK") {
        const dur = params.recoilDuration || 0.08;
        recoilProgress += dt / dur;
        if (recoilProgress >= 1.0) {
            recoilProgress = 0.0;
            recoilState = "RECOVER";
            state.recoilAmount = 1.0;
        } else {
            state.recoilAmount = Math.sin(recoilProgress * Math.PI * 0.5);
        }
    } else if (recoilState === "RECOVER") {
        const dur = params.recoilRecoverDuration || 0.20;
        recoilProgress += dt / dur;
        if (recoilProgress >= 1.0) {
            recoilProgress = 0.0;
            recoilState = "IDLE";
            state.recoilAmount = 0.0;
        } else {
            state.recoilAmount = 1.0 - Math.sin(recoilProgress * Math.PI * 0.5);
        }
    }

    // Call shared update loop for procedural state
    const bodyEuler = new THREE.Euler().setFromQuaternion(activeGLBModel.quaternion, 'YXZ');
    const swayQ = new THREE.Quaternion();
    
    const currentPos = activeGLBModel.position.clone();
    if (!state.lastPos) state.lastPos = currentPos.clone();
    
    const rawVelocity = currentPos.clone().sub(state.lastPos).divideScalar(Math.max(dt, 0.0001));
    state.lastPos.copy(currentPos);
    
    if (!state.smoothedVelocity) state.smoothedVelocity = new THREE.Vector3();
    state.smoothedVelocity.lerp(rawVelocity, 0.2); // Smooth it out
    const speed = state.smoothedVelocity.length();
    
    updateProceduralState(state, schema.type, dt, speed, state.smoothedVelocity, bodyEuler, swayQ);
    
    const isQuad = type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON;
    if (isQuad) {
        // Apply hover sway strictly only to quadcopters
        activeGLBModel.quaternion.multiply(swayQ);
        
        // Apply vertical bob
        const bobAmp = params.verticalBobAmount ?? 0.08;
        const bobSpeed = params.verticalBobSpeed ?? 1.5;
        if (bobAmp > 0) {
            activeGLBModel.position.y += Math.sin(simulationTime * bobSpeed) * bobAmp;
        }
    }

    // -------------------------------------------------------------
    // Unified Zero-GC Pivot-Aware Matrix Hierarchy Animate Block (Issue 7 & 15)
    // -------------------------------------------------------------
    activeGLBModel.traverse((child: any) => {
        if (!child.userData.baseLocalMatrix) return;

        const localMat = child.userData.baseLocalMatrix.clone();
        
        let r = new THREE.Matrix4().identity();
        let didRotate = false;
        let hasRecoil = false;

        if (isQuad) {
            // Precise prop spun with exact turret pivot logic
            const parentNameLower = child.parent?.name?.toLowerCase() || '';
            const isPropellerMesh = child.isMesh && (parentNameLower.includes('prop') && parentNameLower !== 'prop');
            if (isPropellerMesh) {
                const lp = child.userData.localPivot || new THREE.Vector3();
                tempT1.makeTranslation(-lp.x, -lp.y, -lp.z);
                tempT2.makeTranslation(lp.x, lp.y, lp.z);
                r.makeRotationY(state.spinAngle);
                tempRotAroundPivot.multiplyMatrices(tempT2, r).multiply(tempT1);
                localMat.copy(child.userData.baseLocalMatrix).multiply(tempRotAroundPivot);
                didRotate = false;
            } else if (child.name === 'barrel' || child.name.toLowerCase().includes('barrel') || child.name.toLowerCase() === 'rifle' || child.name === 'gun') {
                hasRecoil = true;
            }
        } else if (type === DroneType.FIXED_WING) {
            // Fixed Wing: banking/roll into turns, applied ONLY to the actual plane body/fuselage mesh
            const nameLower = child.name.toLowerCase();
            if (nameLower.includes('bomb') || nameLower.includes('weapon') || nameLower.includes('missile') || nameLower.includes('rack')) {
                child.scale.set(0, 0, 0); // Hide the bombs
            } else if (child.isMesh) {
                const bnk = (state as any).simulatedBank || 0;
                const ptc = (state as any).simulatedPitch || 0;
                r.makeRotationZ(bnk);
                
                // Add minor pitch too if we want, but banking is key
                const pitchMat = new THREE.Matrix4().makeRotationX(ptc);
                r.multiply(pitchMat);
                didRotate = true;
            }
        } else if (type === DroneType.WHEELED) {
            // Front axel steering, wheel rolling, turret tracking, and gun recoils
            if (child.name === 'FrontAxel') {
                r.makeRotationX(state.steerAngle);
                didRotate = true;
            } else if (child.name.includes('Tires') || (child.name.toLowerCase().includes('wheel') && !child.name.toLowerCase().includes('wheeled'))) {
                r.makeRotationY(state.wheelAngle);
                const nameLower = child.name.toLowerCase();
                const isSteeringWheel = nameLower.includes('front') || 
                                        nameLower.includes('steer') || 
                                        nameLower.includes('fl') || 
                                        nameLower.includes('fr') || 
                                        nameLower.includes('lefttires') || 
                                        nameLower.includes('righttires');
                if (isSteeringWheel) {
                    const steerRot = new THREE.Matrix4().makeRotationX(state.steerAngle);
                    r.premultiply(steerRot);
                }
                didRotate = true;
            } else if (child.name === 'rotate') {
                tempModelPivot.set(
                    params.turretYawPivotX !== undefined ? params.turretYawPivotX : 0.0,
                    params.turretYawPivotY !== undefined ? params.turretYawPivotY : 0.45,
                    params.turretYawPivotZ !== undefined ? params.turretYawPivotZ : -0.1
                );
                
                tempLp.copy(tempModelPivot);
                if (child.userData.baseInvWorldMatrix && activeGLBModel) {
                    const modelGroup = activeGLBModel.children[0]?.children[0] as THREE.Group;
                    const baseWorldMat = modelGroup?.userData.baseWorldMatrix;
                    if (baseWorldMat) {
                        tempLp.applyMatrix4(baseWorldMat);
                    }
                    tempLp.applyMatrix4(child.userData.baseInvWorldMatrix);
                }
                
                tempT1.makeTranslation(-tempLp.x, -tempLp.y, -tempLp.z);
                tempT2.makeTranslation(tempLp.x, tempLp.y, tempLp.z);
                r.makeRotationY(state.turretYaw);
                
                tempRotAroundPivot.multiplyMatrices(tempT2, r).multiply(tempT1);
                localMat.copy(child.userData.baseLocalMatrix).multiply(tempRotAroundPivot);
                didRotate = false;
            } else if (child.name === 'gun') {
                tempModelPivot.set(
                    params.gunPitchPivotX !== undefined ? params.gunPitchPivotX : 0.0,
                    params.gunPitchPivotY !== undefined ? params.gunPitchPivotY : 0.65,
                    params.gunPitchPivotZ !== undefined ? params.gunPitchPivotZ : 0.0
                );
                
                tempLp.copy(tempModelPivot);
                if (child.userData.baseInvWorldMatrix && activeGLBModel) {
                    const modelGroup = activeGLBModel.children[0]?.children[0] as THREE.Group;
                    const baseWorldMat = modelGroup?.userData.baseWorldMatrix;
                    if (baseWorldMat) {
                        tempLp.applyMatrix4(baseWorldMat);
                    }
                    tempLp.applyMatrix4(child.userData.baseInvWorldMatrix);
                }
                
                tempT1.makeTranslation(-tempLp.x, -tempLp.y, -tempLp.z);
                tempT2.makeTranslation(tempLp.x, tempLp.y, tempLp.z);
                r.makeRotationZ(state.turretPitch);
                
                tempRotAroundPivot.multiplyMatrices(tempT2, r).multiply(tempT1);
                localMat.copy(child.userData.baseLocalMatrix).multiply(tempRotAroundPivot);
                didRotate = false;
            } else if (child.name === 'barrel' || child.name.toLowerCase().includes('barrel') || child.name.toLowerCase() === 'rifle' || child.name === 'gun') {
                hasRecoil = true;
            }
        } else if (type === DroneType.ROBOT_DOG) {
            const trot = state.trotPhase || 0;
            if (child.name.toLowerCase().includes("frontleftleg") || child.name.toLowerCase().includes("fl_leg")) {
                r.makeRotationX(Math.sin(trot) * 0.5);
                didRotate = true;
            } else if (child.name.toLowerCase().includes("backrightleg") || child.name.toLowerCase().includes("br_leg")) {
                r.makeRotationX(Math.sin(trot) * 0.5);
                didRotate = true;
            } else if (child.name.toLowerCase().includes("frontrightleg") || child.name.toLowerCase().includes("fr_leg")) {
                r.makeRotationX(-Math.sin(trot) * 0.5);
                didRotate = true;
            } else if (child.name.toLowerCase().includes("backleftleg") || child.name.toLowerCase().includes("bl_leg")) {
                r.makeRotationX(-Math.sin(trot) * 0.5);
                didRotate = true;
            }
        } else if (type === DroneType.HUMANOID) {
            const walk = state.walkPhase || 0;
            if (child.name.toLowerCase().includes("leftleg") || child.name.toLowerCase().includes("l_leg")) {
                r.makeRotationX(Math.sin(walk) * 0.6);
                didRotate = true;
            } else if (child.name.toLowerCase().includes("rightleg") || child.name.toLowerCase().includes("r_leg")) {
                r.makeRotationX(-Math.sin(walk) * 0.6);
                didRotate = true;
            } else if (child.name.toLowerCase().includes("leftarm") || child.name.toLowerCase().includes("l_arm")) {
                r.makeRotationX(-Math.sin(walk) * 0.5);
                didRotate = true;
            } else if (child.name.toLowerCase().includes("rightarm") || child.name.toLowerCase().includes("r_arm")) {
                r.makeRotationX(Math.sin(walk) * 0.5);
                didRotate = true;
            }
        }

        // Apply pivot translation to prevent offset general orbits
        if (didRotate) {
            let lp = child.userData.localPivot || new THREE.Vector3();
            const t1 = new THREE.Matrix4().makeTranslation(-lp.x, -lp.y, -lp.z);
            const t2 = new THREE.Matrix4().makeTranslation(lp.x, lp.y, lp.z);
            const rotAroundPivot = new THREE.Matrix4().multiplyMatrices(t2, r).multiply(t1);
            localMat.multiply(rotAroundPivot);
        }

        if (hasRecoil) {
            const recoilAmt = params.barrelRecoilAmount ?? 0.15;
            const recoilMat = new THREE.Matrix4();
            if (type === DroneType.ROTARY_SHOOTER) {
                recoilMat.makeTranslation(0, 0, -state.recoilAmount * recoilAmt);
            } else if (type === DroneType.WHEELED) {
                recoilMat.makeTranslation(state.recoilAmount * recoilAmt, 0, 0);
            } else {
                recoilMat.makeTranslation(-state.recoilAmount * recoilAmt, 0, 0);
            }
            localMat.multiply(recoilMat);
        }

        // Apply chassis vibration strictly to the body mesh only (not the wheels)
        if (type === DroneType.WHEELED && (child.name === 'Cube_BASE_0' || child.name === 'm2hb_mount_0' || child.name === 'body' || child.name.toLowerCase().includes('body') || child.name.toLowerCase().includes('chassis'))) {
            const vibAmp = params.chassisVibration ?? 0.05;
            const vibSpeed = params.chassisVibrationSpeed ?? 30.0;
            let totalVib = 0;
            if (vibAmp > 0 && speed > 0.1) {
                totalVib += Math.sin(simulationTime * vibSpeed) * vibAmp * Math.min(speed / 10.0, 1.0);
            }
            if (state.recoilAmount > 0) {
                totalVib += Math.sin(simulationTime * (vibSpeed * 1.5)) * vibAmp * state.recoilAmount;
            }
            const isVibSliderActive = (activeSliderAnimationKey === "chassisVibration" || activeSliderAnimationKey === "chassisVibrationSpeed");
            if (isVibSliderActive && vibAmp > 0) {
                totalVib += Math.sin(sliderAnimTimer * vibSpeed) * vibAmp;
            }
            if (totalVib !== 0) {
                const vibMat = new THREE.Matrix4().makeTranslation(0, totalVib, 0);
                localMat.multiply(vibMat);
            }
        }
        child.matrix.copy(localMat);
    });
    
    activeGLBModel.updateMatrixWorld(true);
    updateMuzzleVisualLocation();
}

// Global window registration
if (typeof window !== "undefined") {
    (window as any).showDevEntities = async () => {
        await initDevEntities();
        activateScreen();
    };
}
