import * as THREE from "three/webgpu";
import { DETAILED_WEAPONS } from "../shared/weapons";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getCachedOrFetchUrl } from "./asset-cache";
import { CAMERA_EFFECTS_CONFIG } from "./src/camera/constants";
import { getMatch } from "./MatchController";

// Zero-GC pre-allocated math variables for frame loop optimization
const _pos = new THREE.Vector3();
const _rot = new THREE.Euler();
const _targetPos = new THREE.Vector3();
const _muzzleWorldPos = new THREE.Vector3();

// Weapon follow slerp tracking state (O(1) allocation)
let weaponBaseQuat = new THREE.Quaternion();
let isFirstFrame = true;


// Weapon Container Group (attached directly to the camera)
export let weaponsContainer: THREE.Group | null = null;
export let rifleGroup: THREE.Group | null = null;
export let pistolGroup: THREE.Group | null = null;

// Animation stuff
export let rifleMixer: THREE.AnimationMixer | null = null;
export let pistolMixer: THREE.AnimationMixer | null = null;

// Explicit mapping for SMG animations to friendly internal keys
const SMG_ANIM_MAP = {
  idle: "Rig|KDW_DPose_Idle",
  walk: "Rig|KDW_Walk",
  shoot: "Rig|KDW_Shot",
  reload_fast: "Rig|KDW_Reload_fast",
  reload_full: "Rig|KDW_Reload_full",
  draw: "Rig|KDW_Draw"
};

export const weaponActions = {
  rifle: {} as Record<string, THREE.AnimationAction>,
  pistol: {} as Record<string, THREE.AnimationAction>
};

// Global constants
export const WEAPON_SWITCH_DURATION = 0.4; // 400ms switch cooldown

export const DEV_WEAPON_OFFSETS = {
  rifle: {
    hip: new THREE.Vector3(0.025, -0.49, 0.05),
    ads: new THREE.Vector3(-0.075, -0.42, 0),
    muzzle: new THREE.Vector3(0, 0, -0.5),
    adsTilt: -0.05 // Corrective tilt for SMG ADS alignment
  },
  pistol: {
    hip: new THREE.Vector3(0.005, -0.16, -0.185),
    ads: new THREE.Vector3(0, -0.135, -0.06),
    muzzle: new THREE.Vector3(-0.115, -0.2, -0.2),
    adsTilt: 0
  }
};
(window as any).DEV_WEAPON_OFFSETS = DEV_WEAPON_OFFSETS;

export enum WeaponAnimState {
    IDLE = 'idle',
    WALK = 'walk',
    SHOOT = 'shoot',
    RELOAD = 'reload',
    DRAW = 'draw',
    ADS_IDLE = 'ads_idle'
}

export interface WeaponVisualState {
  activeSlot: number;            // 1 = Rifle/SMG, 2 = Pistol
  switchTimer: number;           // Decays from WEAPON_SWITCH_DURATION to 0
  pendingSlot: number;           // The weapon we are switching to
  recoilZ: number;             
  recoilPitch: number;         
  recoilYaw: number;           
  swayCycle: number;
  currentState: WeaponAnimState;
}

export const weaponVisualState: WeaponVisualState = {
  activeSlot: 1,
  switchTimer: 0.0,
  pendingSlot: 0,
  recoilZ: 0.0,
  recoilPitch: 0.0,
  recoilYaw: 0.0,
  swayCycle: 0.0,
  currentState: WeaponAnimState.IDLE
};

// Internal tracking for transition logic
let lastBaseState: WeaponAnimState = WeaponAnimState.IDLE;
let isWeaponReloading = false;

export async function initPlayerWeapons(scene: THREE.Scene, camera: THREE.Camera): Promise<THREE.Group> {
  isFirstFrame = true;
  weaponsContainer = new THREE.Group();
  weaponsContainer.name = "WeaponsContainer";
  scene.add(weaponsContainer);

  rifleGroup = new THREE.Group();
  rifleGroup.name = "RifleModel";
  weaponsContainer.add(rifleGroup);

  pistolGroup = new THREE.Group();
  pistolGroup.name = "PistolModel";
  pistolGroup.visible = false;
  weaponsContainer.add(pistolGroup);

  const loader = new GLTFLoader();

  // Load SMG (Rifle slot)
  const loadRiflePromise = (async () => {
    try {
      const url = await getCachedOrFetchUrl("smg_fps_animations.glb", "Asset");
      const gltf = await loader.loadAsync(url);
      rifleGroup!.add(gltf.scene);
      rifleMixer = new THREE.AnimationMixer(gltf.scene);
      
      // Explicitly map rifle animations to internal friendly keys
      gltf.animations.forEach((clip) => {
        const name = clip.name;
        if (name === SMG_ANIM_MAP.idle) weaponActions.rifle['idle'] = rifleMixer!.clipAction(clip);
        if (name === SMG_ANIM_MAP.walk) weaponActions.rifle['walk'] = rifleMixer!.clipAction(clip);
        if (name === SMG_ANIM_MAP.shoot) weaponActions.rifle['shoot'] = rifleMixer!.clipAction(clip);
        if (name === SMG_ANIM_MAP.reload_fast) weaponActions.rifle['reload'] = rifleMixer!.clipAction(clip);
        if (name === SMG_ANIM_MAP.reload_full) weaponActions.rifle['reload_full'] = rifleMixer!.clipAction(clip);
        if (name === SMG_ANIM_MAP.draw) weaponActions.rifle['draw'] = rifleMixer!.clipAction(clip);
      });

      // Try play idle
      if (weaponActions.rifle['idle']) {
         weaponActions.rifle['idle'].play();
         weaponVisualState.currentState = WeaponAnimState.IDLE;
      }

      // Smooth blending fallback back to base movement animation on action completion
      rifleMixer.addEventListener('finished', (e: any) => {
          if (e.action.loop === THREE.LoopOnce) {
              transitionToState(lastBaseState, true);
          }
      });

      // Find muzzle node or create one
      let muzzleNode = gltf.scene.getObjectByName('Muzzle') || gltf.scene.getObjectByName('muzzle');
      let isProcedural = false;
      if (!muzzleNode) {
          isProcedural = true;
          let anySkinnedMesh: any = null;
          gltf.scene.traverse((c: any) => { if (c.isSkinnedMesh) anySkinnedMesh = c; });
          
          let weaponBone: any = null;
          if (anySkinnedMesh && anySkinnedMesh.skeleton) {
             weaponBone = anySkinnedMesh.skeleton.bones.find((b: any) => b.name.toLowerCase().includes('weapon') || b.name.toLowerCase().includes('gun') || b.name.toLowerCase().includes('muzzle') || b.name.toLowerCase().includes('flash'));
             if (!weaponBone) weaponBone = anySkinnedMesh.skeleton.bones.find((b: any) => b.name.toLowerCase().includes('hand'));
             if (!weaponBone) weaponBone = anySkinnedMesh.skeleton.bones[anySkinnedMesh.skeleton.bones.length - 1];
          }
          
          muzzleNode = new THREE.Object3D();
          muzzleNode.name = "DynamicMuzzle";
          if (weaponBone) {
              weaponBone.add(muzzleNode);
          } else {
              rifleGroup!.add(muzzleNode);
          }
      } else {
          const dummy = new THREE.Object3D();
          dummy.name = "DynamicMuzzle";
          muzzleNode.add(dummy);
          muzzleNode = dummy;
      }
      (rifleGroup as any).muzzleNode = muzzleNode;
      (rifleGroup as any).isProceduralMuzzle = isProcedural;
      console.log("[WEAPONS] SMG Loaded, Animations:", Object.keys(weaponActions.rifle));
    } catch (e) {
      console.error("[WEAPONS] Failed to load SMG:", e);
    }
  })();

  // Load Pistol
  const loadPistolPromise = (async () => {
    try {
      const url = await getCachedOrFetchUrl("animated_pistol.glb", "Asset");
      const gltf = await loader.loadAsync(url);
      pistolGroup!.add(gltf.scene);
      pistolMixer = new THREE.AnimationMixer(gltf.scene);

      // Extract sub-clips from single track "allanimations" (8.8s total duration @ 30fps)
      const originalClip = gltf.animations.find(c => c.name.toLowerCase() === "allanimations") || gltf.animations[0];
      if (originalClip) {
          const fps = 30;
          // Precision mapping for (shoot, reload, shoot, reload, reload, walk)
          const shootClip = THREE.AnimationUtils.subclip(originalClip, "shoot", 0, 12, fps);
          const reloadClip = THREE.AnimationUtils.subclip(originalClip, "reload", 80, 175, fps); // Adjusted to skip leading shooting frames
          const walkClip = THREE.AnimationUtils.subclip(originalClip, "walk", 230, 264, fps);
          const idleClip = THREE.AnimationUtils.subclip(originalClip, "idle", 0, 1, fps); 

          const clips = [idleClip, walkClip, shootClip, reloadClip];
          clips.forEach(clip => {
              weaponActions.pistol[clip.name] = pistolMixer!.clipAction(clip);
          });
      } else {
          gltf.animations.forEach((clip) => {
              weaponActions.pistol[clip.name.toLowerCase()] = pistolMixer!.clipAction(clip);
          });
      }

      // Try play idle
      if (weaponActions.pistol['idle']) {
         weaponActions.pistol['idle'].play();
      }

      // Smooth blending fallback back to base movement animation on action completion
      pistolMixer.addEventListener('finished', (e: any) => {
          if (e.action.loop === THREE.LoopOnce) {
              transitionToState(lastBaseState, true);
          }
      });

      let muzzleNode = gltf.scene.getObjectByName('Muzzle') || gltf.scene.getObjectByName('muzzle');
      let isProcedural = false;
      if (!muzzleNode) {
          isProcedural = true;
          let anySkinnedMesh: any = null;
          gltf.scene.traverse((c: any) => { if (c.isSkinnedMesh) anySkinnedMesh = c; });
          
          let weaponBone: any = null;
          if (anySkinnedMesh && anySkinnedMesh.skeleton) {
             weaponBone = anySkinnedMesh.skeleton.bones.find((b: any) => b.name.toLowerCase().includes('weapon') || b.name.toLowerCase().includes('gun') || b.name.toLowerCase().includes('muzzle') || b.name.toLowerCase().includes('flash'));
             if (!weaponBone) weaponBone = anySkinnedMesh.skeleton.bones.find((b: any) => b.name.toLowerCase().includes('hand'));
             if (!weaponBone) weaponBone = anySkinnedMesh.skeleton.bones[anySkinnedMesh.skeleton.bones.length - 1];
          }
          
          muzzleNode = new THREE.Object3D();
          muzzleNode.name = "DynamicMuzzle";
          if (weaponBone) {
              weaponBone.add(muzzleNode);
          } else {
              pistolGroup!.add(muzzleNode);
          }
      } else {
          const dummy = new THREE.Object3D();
          dummy.name = "DynamicMuzzle";
          muzzleNode.add(dummy);
          muzzleNode = dummy;
      }
      (pistolGroup as any).muzzleNode = muzzleNode;
      (pistolGroup as any).isProceduralMuzzle = isProcedural;
      console.log("[WEAPONS] Pistol Loaded, Animations:", Object.keys(weaponActions.pistol));
    } catch (e) {
      console.error("[WEAPONS] Failed to load Pistol:", e);
    }
  })();

  await Promise.all([loadRiflePromise, loadPistolPromise]);

  return weaponsContainer;
}

// Module-level tracking for active clips per slot to prevent frame pops and redundant resets
export const currentActiveClipKeys: Record<number, string | null> = {
  1: null,
  2: null
};

export let lastBaseAnim = 'idle';

export function transitionToState(state: WeaponAnimState, force: boolean = false) {
    const slot = weaponVisualState.activeSlot;
    const actions = slot === 1 ? weaponActions.rifle : weaponActions.pistol;
    
    // Find animation key (ADS_IDLE maps to IDLE frozen)
    let clipKey = state === WeaponAnimState.ADS_IDLE ? 'idle' : state.toString();
    const targetAction = actions[clipKey];
    
    // Interrupt Schema: Shoot/Reload have high priority and lock movement updates
    const currentActionKey = weaponVisualState.currentState === WeaponAnimState.ADS_IDLE ? 'idle' : weaponVisualState.currentState;
    const currentAction = actions[currentActionKey];
    
    if (!force && currentAction && currentAction.isRunning() && currentAction.loop === THREE.LoopOnce) {
        // Queue movement for after the action finishes
        if (state === WeaponAnimState.IDLE || state === WeaponAnimState.WALK || state === WeaponAnimState.ADS_IDLE) {
            lastBaseState = state;
            return;
        }
    }

    if (!force && weaponVisualState.currentState === state) return;

    // Update state even if clip is missing (e.g. pistol draw) to ensure downstream gating logic holds
    weaponVisualState.currentState = state;

    if (!targetAction) return;

    const isLooping = (state === WeaponAnimState.IDLE || state === WeaponAnimState.WALK || state === WeaponAnimState.ADS_IDLE);
    const fadeDuration = 0.15;

    targetAction.reset();
    targetAction.setLoop(isLooping ? THREE.LoopRepeat : THREE.LoopOnce, isLooping ? Infinity : 1);
    targetAction.clampWhenFinished = !isLooping;
    targetAction.enabled = true;
    targetAction.timeScale = state === WeaponAnimState.ADS_IDLE ? 0 : 1; // Freeze for ADS stability
    targetAction.fadeIn(fadeDuration);
    targetAction.play();
    
    // Crossfade: Fade out all other actions
    Object.keys(actions).forEach(key => {
        if (key !== clipKey) {
            const act = actions[key];
            if (act && act.isRunning()) {
                act.fadeOut(fadeDuration);
            }
        }
    });

    if (isLooping) {
        lastBaseState = state;
    }
}

export function resetWeaponAnimations() {
    [rifleMixer, pistolMixer].forEach(m => m?.stopAllAction());
    weaponVisualState.currentState = WeaponAnimState.IDLE;
    lastBaseState = WeaponAnimState.IDLE;
    transitionToState(WeaponAnimState.IDLE, true);
    isWeaponReloading = false;
}

export function applyWeaponRecoil(upForce: number, sideForce: number): void {
  weaponVisualState.recoilZ = Math.min(0.2, weaponVisualState.recoilZ + 0.12);
  weaponVisualState.recoilPitch = Math.min(0.35, weaponVisualState.recoilPitch + upForce * 3.5);
  weaponVisualState.recoilYaw += (Math.random() - 0.5) * sideForce * 3.0;

  // High-priority interrupt - but cannot interrupt a reload in progress
  if (!isWeaponReloading) {
      transitionToState(WeaponAnimState.SHOOT, true);
  }
}

export function switchActiveWeaponModel(slot: number): void {
  if (weaponVisualState.activeSlot === slot) return;
  weaponVisualState.pendingSlot = slot;
  weaponVisualState.switchTimer = WEAPON_SWITCH_DURATION;
}

export function isSwitchingWeapon(): boolean {
  return weaponVisualState.switchTimer > 0;
}

export function getMuzzleWorldPosition(outVec: THREE.Vector3, camera: THREE.Camera): void {
  const activeMesh = weaponVisualState.activeSlot === 1 ? rifleGroup : pistolGroup;
  if (activeMesh && (activeMesh as any).muzzleNode) {
    // First, make sure the local offset of the dummy node is 0
    (activeMesh as any).muzzleNode.position.set(0, 0, 0);
    (activeMesh as any).muzzleNode.updateMatrixWorld(true);
    
    // Get the base animated world position from the model's muzzle or bone
    (activeMesh as any).muzzleNode.getWorldPosition(outVec);
    
    // ONLY apply the camera-space offset if this is a procedurally created dynamic muzzle fallback.
    // Authored gltf muzzle nodes are already placed perfectly at the tip.
    if ((activeMesh as any).isProceduralMuzzle) {
      const muzzleOffset = weaponVisualState.activeSlot === 1 ? DEV_WEAPON_OFFSETS.rifle.muzzle : DEV_WEAPON_OFFSETS.pistol.muzzle;
      
      // Convert the camera's rotation to world axes so the DEV_WEAPON_OFFSETS 
      // predictably apply in view space (X=Right, Y=Up, Z=Backward)
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
      
      outVec.addScaledVector(right, muzzleOffset.x);
      outVec.addScaledVector(up, muzzleOffset.y);
      outVec.addScaledVector(forward, muzzleOffset.z);
    }
  } else {
    outVec.copy(camera.position);
    const cameraDir = _pos.set(0, 0, -1).applyQuaternion(camera.quaternion);
    outVec.addScaledVector(cameraDir, 0.5);
  }
}

export function setWeaponReloading(val: boolean) {
  if (isWeaponReloading !== val) {
    isWeaponReloading = val;
    if (val) {
        transitionToState(WeaponAnimState.RELOAD);
    }
  }
}

export function updateWeaponsContainer(
  dt: number,
  camera: THREE.Camera,
  isADS: boolean,
  currentAdsLerp: number,
  isMoving: boolean = false
): void {
  if (!weaponsContainer || !rifleGroup || !pistolGroup) return;

  const slot = weaponVisualState.activeSlot;
  
  // Downstream Gating: Only update the mixer of the active weapon
  if (slot === 1 && rifleMixer) rifleMixer.update(dt);
  if (slot === 2 && pistolMixer) pistolMixer.update(dt);

  const actions = slot === 1 ? weaponActions.rifle : weaponActions.pistol;

  // Schema-driven state determination
  if (weaponVisualState.currentState !== WeaponAnimState.SHOOT && weaponVisualState.currentState !== WeaponAnimState.RELOAD) {
      let desired = WeaponAnimState.IDLE;
      if (isADS) {
          desired = WeaponAnimState.ADS_IDLE; // Dead still
      } else if (isMoving) {
          desired = WeaponAnimState.WALK;
      }
      transitionToState(desired);
  }

  // Handle Sprint speed scaling on the WALK animation (RUN animation is forbidden)
  const walkAction = actions[WeaponAnimState.WALK];
  if (walkAction) {
     const isSprinting = isMoving && !isADS; 
     walkAction.timeScale = isSprinting ? 1.5 : 1.0;
  }

  // Switch logic
  if (weaponVisualState.switchTimer > 0) {
    const prevTimer = weaponVisualState.switchTimer;
    weaponVisualState.switchTimer = Math.max(0, weaponVisualState.switchTimer - dt);

    if (prevTimer > WEAPON_SWITCH_DURATION * 0.5 && weaponVisualState.switchTimer <= WEAPON_SWITCH_DURATION * 0.5) {
      weaponVisualState.activeSlot = weaponVisualState.pendingSlot;
      rifleGroup.visible = (weaponVisualState.activeSlot === 1);
      pistolGroup.visible = (weaponVisualState.activeSlot === 2);
      transitionToState(WeaponAnimState.DRAW, true);
    }
  }

  const activeSlot = weaponVisualState.activeSlot;
  const stats = activeSlot === 1 ? DETAILED_WEAPONS.rifle : DETAILED_WEAPONS.pistol;

  const recoverySpeed = stats.recoilRecoveryRate * 1.5;
  weaponVisualState.recoilZ = Math.max(0.0, weaponVisualState.recoilZ - dt * recoverySpeed);
  weaponVisualState.recoilPitch = Math.max(0.0, weaponVisualState.recoilPitch - dt * recoverySpeed);
  weaponVisualState.recoilYaw -= Math.sign(weaponVisualState.recoilYaw) * Math.min(Math.abs(weaponVisualState.recoilYaw), dt * recoverySpeed);


  weaponVisualState.swayCycle += dt * stats.swaySpeed;
  // Procedural sway is disabled during ADS to prevent weapon flailing as requested
  const swayIntensity = (1.0 - currentAdsLerp) * stats.swayAmplitude * 2.0; 
  const swayX = Math.sin(weaponVisualState.swayCycle) * swayIntensity;
  const swayY = Math.cos(weaponVisualState.swayCycle * 2.0) * swayIntensity * 0.5;

  let switchYOffset = 0.0;
  if (weaponVisualState.switchTimer > 0) {
    const progress = weaponVisualState.switchTimer / WEAPON_SWITCH_DURATION; 
    switchYOffset = -0.4 * Math.sin(progress * Math.PI);
  }

  // Hip / ADS alignments.
  const offsets = activeSlot === 1 ? DEV_WEAPON_OFFSETS.rifle : DEV_WEAPON_OFFSETS.pistol;
  const hipX = offsets.hip.x, hipY = offsets.hip.y, hipZ = offsets.hip.z;
  const adsX = offsets.ads.x, adsY = offsets.ads.y, adsZ = offsets.ads.z;

  const baseTargetX = hipX + (adsX - hipX) * currentAdsLerp;
  const baseTargetY = hipY + (adsY - hipY) * currentAdsLerp;
  const baseTargetZ = hipZ + (adsZ - hipZ) * currentAdsLerp;

  let pullBackZ = 0.0;
  const match = getMatch();
  if (match && match.cameraEffects) {
    pullBackZ = match.cameraEffects.runPullBack;
  }

  const finalX = baseTargetX + swayX + (weaponVisualState.recoilYaw * 0.05);
  const finalY = baseTargetY + switchYOffset + (weaponVisualState.recoilPitch * 0.12);
  const finalZ = baseTargetZ - weaponVisualState.recoilZ - pullBackZ; 

  weaponsContainer.position.copy(camera.position);
  
  // Implement Weapon Follow slerp lag with non-linear snapping drag
  if (isFirstFrame) {
    weaponBaseQuat.copy(camera.quaternion);
    isFirstFrame = false;
  } else {
    const config = CAMERA_EFFECTS_CONFIG.WEAPON_FOLLOW;
    // Calculate angular difference
    const angle = weaponBaseQuat.angleTo(camera.quaternion);
    // Non-linear lag multiplier: follow speed gets slower as the angle gets larger (harder snap)
    const angleFactor = Math.max(config.MIN_FOLLOW_SPEED_MULT, Math.exp(-angle * config.LAG_FACTOR));
    const currentSpeed = config.BASE_SPEED * angleFactor;
    
    // Mathematically correct frame-rate independent exponential decay slerp interpolant
    const t = 1.0 - Math.exp(-currentSpeed * dt);
    weaponBaseQuat.slerp(camera.quaternion, t);
  }
  
  weaponsContainer.quaternion.copy(weaponBaseQuat);

  // Apply recoil rotation relative to the camera
  weaponsContainer.rotateX(weaponVisualState.recoilPitch + (swayY * 1.5));
  weaponsContainer.rotateY(-weaponVisualState.recoilYaw + (swayX * 1.5));
  
  // Apply sway roll and ADS corrective tilt
  const adsTilt = (offsets as any).adsTilt || 0;
  weaponsContainer.rotateZ((-swayX * 4.0) + (adsTilt * currentAdsLerp));
  
  // Model files are facing +Z instead of -Z, so spin them 180 on Y
  weaponsContainer.rotateY(Math.PI);

  // Apply translational offsets (X and Z inverted because we just spun 180 degrees)
  weaponsContainer.translateX(-finalX);
  weaponsContainer.translateY(finalY + swayY);
  weaponsContainer.translateZ(-finalZ + swayX);
}
