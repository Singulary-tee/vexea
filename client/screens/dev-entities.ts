import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getAssetUrl, getCachedOrFetchUrl } from "../asset-cache";
import * as screenManager from "./screen-manager";
import { DS } from "../design-system";
import { audioManager } from "../audio";
import { PLAYER_TOTAL_HEIGHT, PLAYER_RADIUS, DRONE_CONFIGS, DroneType } from "../../shared/constants";
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
        
        const isAir = type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON || type === DroneType.FIXED_WING;
        if (isAir) {
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

        const isAir = type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON || type === DroneType.FIXED_WING;
        if (isAir) {
            // Hover bobbing
            model.position.y = 0.25 + Math.sin(time * 2.0) * 0.06;
            model.rotation.z = Math.sin(time * 1.5) * 0.02; // Tiny side sway
        } else {
            model.position.y = 0.2;
        }

        state.spinAngle += dt * 10.0; // Idle slow spin
        state.wheelAngle = 0;
        state.steerAngle = 0;
        state.trotPhase = 0;
        state.walkPhase = 0;
    }
});

const createYawSurveyLoop = (type: DroneType): LoopMode => ({
    id: "YAW_360",
    name: "360° SURVEY",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        const yaw = (lTimer * 0.5) % (Math.PI * 2);
        model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

        const isAir = type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON || type === DroneType.FIXED_WING;
        if (isAir) {
            model.position.y = 0.25 + Math.sin(time * 2.0) * 0.02;
            state.spinAngle += dt * 25.0;
        } else {
            model.position.y = 0.2;
            state.wheelAngle += dt * 2.0;
        }
    }
});

const createCombatLoop = (type: DroneType): LoopMode => ({
    id: "COMBAT_FIRE",
    name: "COMBAT TRIGGER FIRE",
    run: (dt, params, model, time, lTimer) => {
        model.position.set(0, 0.2, 0);
        model.quaternion.set(0, 0, 0, 1);
        
        const isAir = type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON || type === DroneType.FIXED_WING;
        if (isAir) {
            model.position.y = 0.25 + Math.sin(time * 25.0) * 0.005; // Fire rattle
            state.spinAngle += dt * (params.rotorSpeed || 35.0);
        } else {
            model.position.y = 0.2;
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
        muzzleFlashScale: config.muzzleFlashScale ?? 1.0,
        firingSoundPitch: config.firingSoundPitch ?? 1.0,
        wheelRollSpeed: config.wheelRollSpeed ?? 2.5,
        wheelSteerAngle: config.wheelSteerAngle ?? 0.5,
        barrelRecoilAmount: config.barrelRecoilAmount ?? 0.15,
        chassisVibration: config.chassisVibration ?? 0.05,

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
        category2.muzzleX = { label: "Muzzle X Offset", min: -2.0, max: 2.0, step: 0.01 };
        category2.muzzleY = { label: "Muzzle Y Offset", min: -2.0, max: 2.0, step: 0.01 };
        category2.muzzleZ = { label: "Muzzle Z Offset", min: -2.0, max: 2.0, step: 0.01 };
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
        }
        if (type !== DroneType.RECON && type !== DroneType.BOMBER && type !== DroneType.FIXED_WING) {
            category3.muzzleFlashScale = { label: "Muzzle Flash Scale", min: 0.1, max: 4.0, step: 0.1 };
            category3.firingSoundPitch = { label: "Firing Sound Pitch", min: 0.2, max: 3.0, step: 0.05 };
        }
        if (config.animations.includes('wheels')) {
            category3.wheelRollSpeed = { label: "Wheel Roll Speed", min: 0.5, max: 10.0, step: 0.1 };
        }
        if (config.animations.includes('steer')) {
            category3.wheelSteerAngle = { label: "Wheel Steer Angle", min: 0.1, max: 1.5, step: 0.05 };
        }
        if (config.animations.includes('turret')) {
            category3.barrelRecoilAmount = { label: "Barrel Recoil Amount", min: 0.0, max: 0.8, step: 0.01 };
            category3.chassisVibration = { label: "Chassis Vibration", min: 0.0, max: 0.5, step: 0.01 };
        }
    }

    const category4: Record<string, any> = {
        speed: { label: "Max Movement Speed (m/s)", min: 1.0, max: 40.0, step: 0.5 }
    };
    if (isAir) {
        category4.maxRotationSpeed = { label: "Max Rotation Speed (rad/s)", min: 0.5, max: 10.0, step: 0.1 };
        category4.maxVerticalSpeed = { label: "Max Vertical Speed (m/s)", min: 1.0, max: 20.0, step: 0.5 };
        category4.bankingAngle = { label: "Banking Angle (rad)", min: 0.0, max: 1.2, step: 0.01 };
    }
    if (type === DroneType.BOMBER) {
        category4.damage = { label: "Explosion Damage", min: 10, max: 200, step: 5 };
    }
    if (type === DroneType.FIXED_WING) {
        category4.minSpeed = { label: "Min Speed (cannot hover)", min: 2.0, max: 20.0, step: 0.5 };
        category4.maxTurnRate = { label: "Max Turn Rate (rad/s)", min: 0.5, max: 5.0, step: 0.1 };
        category4.pitchAngle = { label: "Max Pitch Angle (rad)", min: 0.0, max: 1.2, step: 0.01 };
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

    const categories = {
        "Category 1 — Spatial": category1,
        "Category 2 — Collider & Manual Points": category2,
        ...(Object.keys(category3).length > 0 ? { "Category 3 — Client-Only Animations": category3 } : {}),
        "Category 4 — Server-Authoritative Stats": category4
    };

    return {
        id: DroneType[type],
        name,
        type,
        glbUrl,
        defaults,
        categories,
        availableLoopModes: [
            createIdleLoop(type),
            createSpeedTestLoop(type),
            createYawSurveyLoop(type),
            createCombatLoop(type)
        ]
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

const loadedGLBsCache = new Map<string, THREE.Group>();

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
        backgroundColor: "#06080d",
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
            background: #05070c;
            min-height: 50%;
        }
        #de-controls-drawer {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: ${DS.colors.surface};
            border-top: 1px solid ${DS.colors.border};
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 100;
            display: flex;
            flex-direction: column;
            max-height: 80vh;
        }
        #de-controls-drawer.collapsed {
            transform: translateY(calc(100% - 48px));
        }
        #de-drawer-handle {
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 16px;
            cursor: pointer;
            background: rgba(255,255,255,0.03);
            border-bottom: 1px solid rgba(255,255,255,0.05);
            flex: 0 0 auto;
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
        <div id="de-drawer-handle">
            <span style="font-size: 12px; font-weight: bold; letter-spacing: 1px;">DRONE ENGINE CALIBRATION</span>
            <span id="de-drawer-arrow">▲</span>
        </div>
        <div id="de-drawer-content">
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
                    <button id="de-reset-camera" class="de-overlay-btn" style="padding: 4px 8px; font-size: 10px; background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1);">RESET CAMERA</button>
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
        <button id="de-loop-cycle" class="de-overlay-btn" style="width: 170px; text-align: left; pointer-events: auto; font-family: monospace;">LOOP: STANDBY</button>
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
    drawer.querySelector("#de-drawer-handle")!.addEventListener("click", () => {
        isControlPanelExpanded = !isControlPanelExpanded;
        drawer.className = isControlPanelExpanded ? "" : "collapsed";
        drawer.querySelector("#de-drawer-arrow")!.textContent = isControlPanelExpanded ? "▼" : "▲";
    });

    drawer.querySelectorAll(".de-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            switchTab(tab.getAttribute("data-tab")!);
        });
    });

    drawer.querySelector("#de-category-picker")!.addEventListener("change", (e: any) => {
        currentCategory = e.target.value;
        buildSliders(currentTab);
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

    const btnResetCam = drawer.querySelector("#de-reset-camera") as HTMLButtonElement;
    btnResetCam.addEventListener("click", () => {
        resetCamera();
    });
}

async function setup3D() {
    const canvasCont = document.getElementById("de-canvas-container")!;
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06080d);
    scene.fog = new THREE.FogExp2(0x06080d, 0.04);

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
    canvasEl.style.backgroundColor = "#06080d";
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
    currentTab = tabId;
    
    const screen = document.getElementById("dev-entities-screen")!;
    screen.querySelectorAll(".de-tab").forEach(t => {
        if (t.getAttribute("data-tab") === tabId) {
            t.classList.add("active");
        } else {
            t.classList.remove("active");
        }
    });

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

        const block = document.createElement("div");
        block.className = "de-slider-block";
        block.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 10px; color: #aaa; margin-bottom: 2px;">
                <span>${sliderConf.label}</span>
                <span class="de-val-indicator" style="font-family: monospace; color: ${DS.colors.accent};">${val}</span>
            </div>
            <input type="range" class="de-slider" data-key="${key}" min="${sliderConf.min}" max="${sliderConf.max}" step="${sliderConf.step}" value="${val}" style="width: 100%; height: 32px; accent-color: ${DS.colors.accent};">
        `;

        const slider = block.querySelector(".de-slider") as HTMLInputElement;
        slider.addEventListener("input", (e: any) => {
            const nVal = parseFloat(e.target.value);
            params[key] = nVal;
            block.querySelector(".de-val-indicator")!.textContent = nVal.toString();
            onParamChanged(key, nVal);
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
    if (params.muzzleFlashScale !== undefined) config.muzzleFlashScale = params.muzzleFlashScale;
    if (params.firingSoundPitch !== undefined) config.firingSoundPitch = params.firingSoundPitch;
    if (params.wheelRollSpeed !== undefined) config.wheelRollSpeed = params.wheelRollSpeed;
    if (params.wheelSteerAngle !== undefined) config.wheelSteerAngle = params.wheelSteerAngle;
    if (params.barrelRecoilAmount !== undefined) config.barrelRecoilAmount = params.barrelRecoilAmount;
    if (params.chassisVibration !== undefined) config.chassisVibration = params.chassisVibration;

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
    } else if (key === "refDistance" || key.startsWith("collider") || key.startsWith("muzzle") || key.startsWith("light")) {
        updatePlayerRefPosition();
        updateMuzzleVisualLocation();
        updateColliderPositionAndDimensions();
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
    if (activeMuzzleVisual) {
        activeMuzzleVisual.position.set(
            params.muzzleX || 0.0, 
            params.muzzleY || 0.0, 
            params.muzzleZ || 0.8
        );
    }
    if (activeLightLeftVisual) {
        activeLightLeftVisual.position.set(
            params.lightLeftX || -0.5, 
            params.lightLeftY || 0.0, 
            params.lightLeftZ || 0.5
        );
    }
    if (activeLightRightVisual) {
        activeLightRightVisual.position.set(
            params.lightRightX || 0.5, 
            params.lightRightY || 0.0, 
            params.lightRightZ || 0.5
        );
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

        // Bake pivots and base matrices onto each node's userData of the active instance to prevent GC re-allocation in tickLoop
        modelGroup.traverse((child: any) => {
            child.userData.baseLocalMatrix = child.matrix.clone();
            
            let pivot = new THREE.Vector3();
            const b = new THREE.Box3().setFromObject(child);
            if (!b.isEmpty()) {
                b.getCenter(pivot);
            }
            const localPivot = pivot.clone();
            if (child.matrixWorld) {
                const invWorld = child.matrixWorld.clone().invert();
                localPivot.applyMatrix4(invWorld);
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

        updatePlayerRefPosition();
        updateMuzzleVisualLocation();
        updateColliderPositionAndDimensions();
    }
}

function triggerSingleShot() {
    recoilState = "KICK";
    recoilProgress = 0.0;
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

function runLoopSimulation(dt: number) {
    if (!activeGLBModel) return;

    const schema = DRONE_SCHEMAS.find(s => s.id === currentTab);
    if (!schema) return;

    const params = currentParams[currentTab];
    loopTimer += dt;

    // Run active loop routine from our magnificent modular schema!
    const activeLoop = schema.availableLoopModes.find(m => m.id === loopMode);
    if (activeLoop) {
        activeLoop.run(dt, params, activeGLBModel, simulationTime, loopTimer, schema.type);
    }

    if (loopMode === "COMBAT_FIRE") {
        fireTimer += dt;
        const rateHz = 6.0;
        if (fireTimer >= 1.0 / rateHz) {
            fireTimer = 0.0;
            triggerSingleShot();
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
    
    // We approximate speed and smoothed velocity for dev entities
    const currentPos = activeGLBModel.position.clone();
    if (!state.lastPos) state.lastPos = currentPos.clone();
    
    // Calculate raw velocity
    const rawVelocity = currentPos.clone().sub(state.lastPos).divideScalar(Math.max(dt, 0.0001));
    state.lastPos.copy(currentPos);
    
    if (!state.smoothedVelocity) state.smoothedVelocity = new THREE.Vector3();
    state.smoothedVelocity.lerp(rawVelocity, 0.2); // Smooth it out
    const speed = state.smoothedVelocity.length();
    updateProceduralState(state, schema.type, dt, speed, state.smoothedVelocity, bodyEuler, swayQ);
    
    // Apply sway to the group
    activeGLBModel.quaternion.multiply(swayQ);

    // -------------------------------------------------------------
    // Unified Zero-GC Pivot-Aware Matrix Hierarchy Animate Block (Issue 7 & 15)
    // -------------------------------------------------------------
    const type = schema.type;

    activeGLBModel.traverse((child: any) => {
        if (!child.userData.baseLocalMatrix) return;

        // Copy default pre-centered local base matrix
        const localMat = child.userData.baseLocalMatrix.clone();
        
        let r = new THREE.Matrix4().identity();
        let didRotate = false;
        let hasRecoil = false;

        if (type === DroneType.ROTARY_SHOOTER || type === DroneType.BOMBER || type === DroneType.RECON) {
            // Precise prop spun
            if (child.name.toLowerCase().includes('prop') && 
                child.name.toLowerCase() !== 'prop' && 
                child.parent?.name?.toLowerCase() !== 'propbl') {
                r.makeRotationY(state.spinAngle);
                didRotate = true;
            }
        } else if (type === DroneType.WHEELED) {
            // Front axel steering, wheel rolling, turret tracking, and gun recoils
            if (child.name === 'FrontAxel') {
                r.makeRotationY(state.steerAngle);
                didRotate = true;
            } else if (child.name.includes('Tires')) {
                r.makeRotationY(-state.wheelAngle);
                didRotate = true;
            } else if (child.name === 'rotate') {
                r.makeRotationY(state.turretYaw);
                didRotate = true;
            } else if (child.name === 'gun') {
                r.makeRotationX(state.turretPitch);
                didRotate = true;
                hasRecoil = true;
            }
        } else if (type === DroneType.ROBOT_DOG) {
            // Trot trot trot
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
            // Humanoid walk limb swings
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
            const lp = child.userData.localPivot || new THREE.Vector3();
            const t1 = new THREE.Matrix4().makeTranslation(-lp.x, -lp.y, -lp.z);
            const t2 = new THREE.Matrix4().makeTranslation(lp.x, lp.y, lp.z);
            const rotAroundPivot = new THREE.Matrix4().multiplyMatrices(t2, r).multiply(t1);
            localMat.multiply(rotAroundPivot);
        }

        if (hasRecoil) {
            const recoilMat = new THREE.Matrix4().makeTranslation(0, 0, state.recoilAmount * (params.recoilDisplacement || 0.15));
            localMat.multiply(recoilMat);
        }

        child.matrix.copy(localMat);
    });
    
    activeGLBModel.updateMatrixWorld(true);
}

// Global window registration
if (typeof window !== "undefined") {
    (window as any).showDevEntities = async () => {
        await initDevEntities();
        activateScreen();
    };
}
