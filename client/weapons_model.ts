import * as THREE from "three/webgpu";
import { DETAILED_WEAPONS } from "../shared/weapons";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getCachedOrFetchUrl } from "./asset-cache";

// Zero-GC pre-allocated math variables for frame loop optimization
const _pos = new THREE.Vector3();
const _rot = new THREE.Euler();
const _targetPos = new THREE.Vector3();
const _muzzleWorldPos = new THREE.Vector3();

// Weapon Container Group (attached directly to the camera)
export let weaponsContainer: THREE.Group | null = null;
export let rifleGroup: THREE.Group | null = null;
export let pistolGroup: THREE.Group | null = null;

// Animation stuff
export let rifleMixer: THREE.AnimationMixer | null = null;
export let pistolMixer: THREE.AnimationMixer | null = null;
export const weaponActions = {
  rifle: {} as Record<string, THREE.AnimationAction>,
  pistol: {} as Record<string, THREE.AnimationAction>
};

// Global constants
export const WEAPON_SWITCH_DURATION = 0.4; // 400ms switch cooldown

export const DEV_WEAPON_OFFSETS = {
  rifle: {
    hip: new THREE.Vector3(0, 0, 0),
    ads: new THREE.Vector3(0, 0, 0),
    muzzle: new THREE.Vector3(0, 0, -0.5)
  },
  pistol: {
    hip: new THREE.Vector3(0, 0, 0),
    ads: new THREE.Vector3(0, 0, 0),
    muzzle: new THREE.Vector3(0, 0, -0.2)
  }
};
(window as any).DEV_WEAPON_OFFSETS = DEV_WEAPON_OFFSETS;

// Weapon State Tracker (Zero heap allocations at runtime)
export const weaponVisualState = {
  activeSlot: 1,            // 1 = Rifle/SMG, 2 = Pistol
  switchTimer: 0.0,         // Decays from WEAPON_SWITCH_DURATION to 0
  pendingSlot: 0,           // The weapon we are switching to

  // Smooth Recoil Drift (decays back to zero)
  recoilZ: 0.0,             
  recoilPitch: 0.0,         
  recoilYaw: 0.0,           

  // Breathing Sway variables
  swayCycle: 0.0,
};

export function initPlayerWeapons(scene: THREE.Scene, camera: THREE.Camera): THREE.Group {
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
  getCachedOrFetchUrl("smg_fps_animations.glb", "Asset").then((url) => {
    loader.load(url, (gltf) => {
      rifleGroup!.add(gltf.scene);
      rifleMixer = new THREE.AnimationMixer(gltf.scene);
      gltf.animations.forEach((clip) => {
        weaponActions.rifle[clip.name.toLowerCase()] = rifleMixer!.clipAction(clip);
      });
      // Try play idle
      const idle = Object.keys(weaponActions.rifle).find(n => n.includes('idle'));
      if (idle) weaponActions.rifle[idle].play();

      // Find muzzle node or create one
      let muzzleNode = gltf.scene.getObjectByName('Muzzle') || gltf.scene.getObjectByName('muzzle');
      if (!muzzleNode) {
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
      console.log("[WEAPONS] SMG Loaded, Animations:", Object.keys(weaponActions.rifle));
    });
  });

  // Load Pistol
  getCachedOrFetchUrl("animated_pistol.glb", "Asset").then((url) => {
    loader.load(url, (gltf) => {
      pistolGroup!.add(gltf.scene);
      pistolMixer = new THREE.AnimationMixer(gltf.scene);
      gltf.animations.forEach((clip) => {
        weaponActions.pistol[clip.name.toLowerCase()] = pistolMixer!.clipAction(clip);
      });
      // Try play idle
      const idle = Object.keys(weaponActions.pistol).find(n => n.includes('idle'));
      if (idle) weaponActions.pistol[idle].play();

      let muzzleNode = gltf.scene.getObjectByName('Muzzle') || gltf.scene.getObjectByName('muzzle');
      if (!muzzleNode) {
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
      console.log("[WEAPONS] Pistol Loaded, Animations:", Object.keys(weaponActions.pistol));
    });
  });

  return weaponsContainer;
}

export function playWeaponAnimation(animName: string, loop: boolean = true) {
    const slot = weaponVisualState.activeSlot;
    const actions = slot === 1 ? weaponActions.rifle : weaponActions.pistol;
    if (!actions) return;
    
    // Play named animation. To do it properly, cross-fade.
    const clipName = Object.keys(actions).find(n => n.includes(animName.toLowerCase()));
    if (clipName && actions[clipName]) {
        const action = actions[clipName];
        action.reset();
        if (!loop) {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
        } else {
            action.setLoop(THREE.LoopRepeat, Infinity);
        }
        action.play();
        // Crossfade from others if needed
    }
}

export function applyWeaponRecoil(upForce: number, sideForce: number): void {
  weaponVisualState.recoilZ = Math.min(0.2, weaponVisualState.recoilZ + 0.12);
  weaponVisualState.recoilPitch = Math.min(0.35, weaponVisualState.recoilPitch + upForce * 3.5);
  weaponVisualState.recoilYaw += (Math.random() - 0.5) * sideForce * 3.0;

  // Attempt to play a shoot animation if it exists
  playWeaponAnimation('shoot', false);
  playWeaponAnimation('fire', false);
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
    const muzzleOffset = weaponVisualState.activeSlot === 1 ? DEV_WEAPON_OFFSETS.rifle.muzzle : DEV_WEAPON_OFFSETS.pistol.muzzle;
    
    // First, make sure the local offset of the dummy node is 0
    (activeMesh as any).muzzleNode.position.set(0, 0, 0);
    (activeMesh as any).muzzleNode.updateMatrixWorld(true);
    
    // Get the base animated world position from the model's muzzle or bone
    (activeMesh as any).muzzleNode.getWorldPosition(outVec);
    
    // Convert the camera's rotation to world axes so the DEV_WEAPON_OFFSETS 
    // predictably apply in view space (X=Right, Y=Up, Z=Backward)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    
    outVec.addScaledVector(right, muzzleOffset.x);
    outVec.addScaledVector(up, muzzleOffset.y);
    outVec.addScaledVector(forward, muzzleOffset.z);
  } else {
    outVec.copy(camera.position);
    const cameraDir = _pos.set(0, 0, -1).applyQuaternion(camera.quaternion);
    outVec.addScaledVector(cameraDir, 0.5);
  }
}

export let isWeaponReloading = false;
export function setWeaponReloading(val: boolean) {
  if (isWeaponReloading !== val) {
    isWeaponReloading = val;
    if (val) {
        // Find a reload animation
        playWeaponAnimation('reload', false);
    } else {
        // Revert to idle or run
        playWeaponAnimation('idle', true);
    }
  }
}

let lastAnimState = 'idle';

export function updateWeaponsContainer(
  dt: number,
  camera: THREE.Camera,
  isADS: boolean,
  currentAdsLerp: number,
  isMoving: boolean = false
): void {
  if (!weaponsContainer || !rifleGroup || !pistolGroup) return;

  if (rifleMixer) rifleMixer.update(dt);
  if (pistolMixer) pistolMixer.update(dt);

  // Animation State Machine
  let desiredAnim = 'idle';
  if (isWeaponReloading) {
     desiredAnim = 'reload';
  } else if (isMoving) {
     desiredAnim = isADS ? 'walk' : 'run';
  } else {
     desiredAnim = isADS ? 'idle' : 'idle'; 
  }

  if (desiredAnim !== lastAnimState && !isWeaponReloading) {
     lastAnimState = desiredAnim;
     playWeaponAnimation(desiredAnim, true);
  }

  // Switch logic
  if (weaponVisualState.switchTimer > 0) {
    const prevTimer = weaponVisualState.switchTimer;
    weaponVisualState.switchTimer = Math.max(0, weaponVisualState.switchTimer - dt);

    if (prevTimer > WEAPON_SWITCH_DURATION * 0.5 && weaponVisualState.switchTimer <= WEAPON_SWITCH_DURATION * 0.5) {
      weaponVisualState.activeSlot = weaponVisualState.pendingSlot;
      rifleGroup.visible = (weaponVisualState.activeSlot === 1);
      pistolGroup.visible = (weaponVisualState.activeSlot === 2);
      playWeaponAnimation('draw', false); // Play draw animation on switch
    }
  }

  const activeSlot = weaponVisualState.activeSlot;
  const stats = activeSlot === 1 ? DETAILED_WEAPONS.rifle : DETAILED_WEAPONS.pistol;

  const recoverySpeed = stats.recoilRecoveryRate * 1.5;
  weaponVisualState.recoilZ = Math.max(0.0, weaponVisualState.recoilZ - dt * recoverySpeed);
  weaponVisualState.recoilPitch = Math.max(0.0, weaponVisualState.recoilPitch - dt * recoverySpeed);
  weaponVisualState.recoilYaw -= Math.sign(weaponVisualState.recoilYaw) * Math.min(Math.abs(weaponVisualState.recoilYaw), dt * recoverySpeed);


  weaponVisualState.swayCycle += dt * stats.swaySpeed;
  const swayIntensity = currentAdsLerp * stats.swayAmplitude * 6.5; 
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

  const finalX = baseTargetX + swayX + (weaponVisualState.recoilYaw * 0.05);
  const finalY = baseTargetY + swayY + switchYOffset + (weaponVisualState.recoilPitch * 0.12);
  const finalZ = baseTargetZ - weaponVisualState.recoilZ; 

  weaponsContainer.position.copy(camera.position);
  // Match camera rotation perfectly
  weaponsContainer.quaternion.copy(camera.quaternion);

  // Apply recoil rotation relative to the camera
  weaponsContainer.rotateX(weaponVisualState.recoilPitch + (swayY * 1.5));
  weaponsContainer.rotateY(-weaponVisualState.recoilYaw + (swayX * 1.5));
  weaponsContainer.rotateZ(-swayX * 4.0);
  
  // Model files are facing +Z instead of -Z, so spin them 180 on Y
  weaponsContainer.rotateY(Math.PI);

  // Apply translational offsets (X and Z inverted because we just spun 180 degrees)
  weaponsContainer.translateX(-finalX);
  weaponsContainer.translateY(finalY);
  weaponsContainer.translateZ(-finalZ);
}
