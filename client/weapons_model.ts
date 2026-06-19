import * as THREE from "three/webgpu";
import { DETAILED_WEAPONS } from "../shared/weapons";

// Zero-GC pre-allocated math variables for frame loop optimization
const _pos = new THREE.Vector3();
const _rot = new THREE.Euler();
const _targetPos = new THREE.Vector3();
const _muzzleWorldPos = new THREE.Vector3();

// Weapon Container Group (attached directly to the camera)
export let weaponsContainer: THREE.Group | null = null;
export let rifleGroup: THREE.Group | null = null;
export let pistolGroup: THREE.Group | null = null;

// Global constants
export const WEAPON_SWITCH_DURATION = 0.4; // 400ms switch cooldown

// Weapon State Tracker (Zero heap allocations at runtime)
export const weaponVisualState = {
  activeSlot: 1,            // 1 = Rifle, 2 = Pistol
  switchTimer: 0.0,         // Decays from WEAPON_SWITCH_DURATION to 0
  pendingSlot: 0,           // The weapon we are switching to

  // Smooth Recoil Drift (decays back to zero)
  recoilZ: 0.0,             // Gun kick translation back
  recoilPitch: 0.0,         // Gun upward rotation
  recoilYaw: 0.0,           // Gun sideways rotation

  // Breathing Sway variables
  swayCycle: 0.0,
};

/**
 * Creates custom 3D models for the Rifle and Pistol using Three.js primitive shapes.
 */
export function initPlayerWeapons(scene: THREE.Scene, camera: THREE.Camera): THREE.Group {
  weaponsContainer = new THREE.Group();
  weaponsContainer.name = "WeaponsContainer";
  scene.add(weaponsContainer);

  // Materials definitions
  const matteDarkMetal = new THREE.MeshStandardMaterial({ 
    color: 0x15171b, 
    roughness: 0.65, 
    metalness: 0.85 
  });
  const chromeMetal = new THREE.MeshStandardMaterial({ 
    color: 0x7a818c, 
    roughness: 0.25, 
    metalness: 0.95 
  });
  const sciFiOrangePlastic = new THREE.MeshStandardMaterial({ 
    color: 0xe65c00, 
    roughness: 0.4, 
    metalness: 0.2 
  });
  const glowingRedResist = new THREE.MeshStandardMaterial({ 
    color: 0x221111, 
    emissive: new THREE.Color(0xff0033), 
    roughness: 0.1,
    metalness: 0.9
  });
  const glowingGreenResist = new THREE.MeshStandardMaterial({ 
    color: 0x112211, 
    emissive: new THREE.Color(0x33ff33), 
    roughness: 0.1,
    metalness: 0.9
  });

  // ==========================================
  // 1. RIFLE MODEL BUILD (Slot 1)
  // ==========================================
  rifleGroup = new THREE.Group();
  rifleGroup.name = "RifleModel";

  // Receiver body
  const receiverGeom = new THREE.BoxGeometry(0.04, 0.06, 0.35);
  const receiverMesh = new THREE.Mesh(receiverGeom, matteDarkMetal);
  receiverMesh.position.set(0, 0, 0);
  rifleGroup.add(receiverMesh);

  // Handguard
  const handguardGeom = new THREE.BoxGeometry(0.038, 0.05, 0.2);
  const handguardMesh = new THREE.Mesh(handguardGeom, sciFiOrangePlastic);
  handguardMesh.position.set(0, -0.01, -0.22);
  rifleGroup.add(handguardMesh);

  // Barrel extending front
  const barrelGeom = new THREE.CylinderGeometry(0.008, 0.008, 0.3, 8);
  barrelGeom.rotateX(Math.PI / 2);
  const barrelMesh = new THREE.Mesh(barrelGeom, chromeMetal);
  barrelMesh.position.set(0, 0.005, -0.42);
  rifleGroup.add(barrelMesh);

  // Stock
  const stockGeom = new THREE.BoxGeometry(0.035, 0.07, 0.18);
  const stockMesh = new THREE.Mesh(stockGeom, sciFiOrangePlastic);
  stockMesh.position.set(0, -0.012, 0.24);
  rifleGroup.add(stockMesh);

  // Rifle Grip
  const gripGeom = new THREE.BoxGeometry(0.03, 0.08, 0.04);
  gripGeom.rotateX(Math.PI / 6);
  const gripMesh = new THREE.Mesh(gripGeom, matteDarkMetal);
  gripMesh.position.set(0, -0.06, 0.05);
  rifleGroup.add(gripMesh);

  // Rifle Magazine
  const magGeom = new THREE.BoxGeometry(0.028, 0.12, 0.05);
  magGeom.rotateX(-Math.PI / 18);
  const magMesh = new THREE.Mesh(magGeom, matteDarkMetal);
  magMesh.position.set(0, -0.08, -0.05);
  rifleGroup.add(magMesh);

  // Reflex Sight Scope
  const scopeMountGeom = new THREE.BoxGeometry(0.015, 0.02, 0.03);
  const scopeMount = new THREE.Mesh(scopeMountGeom, matteDarkMetal);
  scopeMount.position.set(0, 0.04, -0.05);
  rifleGroup.add(scopeMount);

  const scopeTubeGeom = new THREE.BoxGeometry(0.03, 0.03, 0.09);
  const scopeTube = new THREE.Mesh(scopeTubeGeom, matteDarkMetal);
  scopeTube.position.set(0, 0.055, -0.05);
  rifleGroup.add(scopeTube);

  // Holographic red reticle plate inside scope
  const reticleGeom = new THREE.BoxGeometry(0.018, 0.018, 0.002);
  const reticleMesh = new THREE.Mesh(reticleGeom, glowingRedResist);
  reticleMesh.position.set(0, 0.055, -0.09);
  rifleGroup.add(reticleMesh);

  // Front Sight Guide pin
  const frontSightGeom = new THREE.BoxGeometry(0.006, 0.025, 0.006);
  const frontSight = new THREE.Mesh(frontSightGeom, matteDarkMetal);
  frontSight.position.set(0, 0.03, -0.55);
  rifleGroup.add(frontSight);

  // Muzzle Tip Object (where fire starts, absolute front of barrel)
  const rifleMuzzleNode = new THREE.Object3D();
  rifleMuzzleNode.position.set(0, 0.005, -0.58);
  rifleGroup.add(rifleMuzzleNode);
  (rifleGroup as any).muzzleNode = rifleMuzzleNode;

  weaponsContainer.add(rifleGroup);

  // ==========================================
  // 2. PISTOL MODEL BUILD (Slot 2)
  // ==========================================
  pistolGroup = new THREE.Group();
  pistolGroup.name = "PistolModel";
  pistolGroup.visible = false;

  // Pistol Slide
  const slideGeom = new THREE.BoxGeometry(0.03, 0.038, 0.18);
  const slideMesh = new THREE.Mesh(slideGeom, chromeMetal);
  slideMesh.position.set(0, 0, 0);
  pistolGroup.add(slideMesh);

  // Pistol Grip
  const pGripGeom = new THREE.BoxGeometry(0.028, 0.09, 0.035);
  pGripGeom.rotateX(Math.PI / 5);
  const pGripMesh = new THREE.Mesh(pGripGeom, matteDarkMetal);
  pGripMesh.position.set(0, -0.055, 0.03);
  pistolGroup.add(pGripMesh);

  // Small laser pointer or tactical light under barrel
  const tacLightGeom = new THREE.CylinderGeometry(0.007, 0.007, 0.05, 8);
  tacLightGeom.rotateX(Math.PI / 2);
  const tacLightMesh = new THREE.Mesh(tacLightGeom, matteDarkMetal);
  tacLightMesh.position.set(0, -0.022, -0.04);
  pistolGroup.add(tacLightMesh);

  const tacticalLensGeom = new THREE.BoxGeometry(0.01, 0.01, 0.002);
  const tacticalLens = new THREE.Mesh(tacticalLensGeom, glowingRedResist);
  tacticalLens.position.set(0, -0.022, -0.066);
  pistolGroup.add(tacticalLens);

  // Sights: Front tritium green dot
  const pFrontSightGeom = new THREE.BoxGeometry(0.004, 0.01, 0.004);
  const pFrontSight = new THREE.Mesh(pFrontSightGeom, matteDarkMetal);
  pFrontSight.position.set(0, 0.023, -0.08);
  pistolGroup.add(pFrontSight);

  const pFrontDotGeom = new THREE.SphereGeometry(0.002, 4, 4);
  const pFrontDot = new THREE.Mesh(pFrontDotGeom, glowingGreenResist);
  pFrontDot.position.set(0, 0.026, -0.076);
  pistolGroup.add(pFrontDot);

  // Sights: Rear tritium notch
  const pRearSightGeom = new THREE.BoxGeometry(0.012, 0.008, 0.004);
  const pRearSight = new THREE.Mesh(pRearSightGeom, matteDarkMetal);
  pRearSight.position.set(0, 0.022, 0.075);
  pistolGroup.add(pRearSight);

  const pLeftDot = new THREE.Mesh(pFrontDotGeom, glowingGreenResist);
  pLeftDot.position.set(-0.004, 0.024, 0.073);
  pistolGroup.add(pLeftDot);

  const pRightDot = new THREE.Mesh(pFrontDotGeom, glowingGreenResist);
  pRightDot.position.set(0.004, 0.024, 0.073);
  pistolGroup.add(pRightDot);

  // Pistol Barrel Core peaking out
  const pBarrelGeom = new THREE.CylinderGeometry(0.006, 0.006, 0.02, 8);
  pBarrelGeom.rotateX(Math.PI / 2);
  const pBarrelMesh = new THREE.Mesh(pBarrelGeom, matteDarkMetal);
  pBarrelMesh.position.set(0, 0.004, -0.091);
  pistolGroup.add(pBarrelMesh);

  // Pistol Muzzle Object
  const pistolMuzzleNode = new THREE.Object3D();
  pistolMuzzleNode.position.set(0, 0.004, -0.1);
  pistolGroup.add(pistolMuzzleNode);
  (pistolGroup as any).muzzleNode = pistolMuzzleNode;

  weaponsContainer.add(pistolGroup);

  return weaponsContainer;
}

/**
 * Triggers a visual recoil kick, modifying displacement and orientation.
 */
export function applyWeaponRecoil(upForce: number, sideForce: number): void {
  // Add direct backward push
  weaponVisualState.recoilZ = Math.min(0.2, weaponVisualState.recoilZ + 0.12);
  // Add direct upward pitch kick rotation
  weaponVisualState.recoilPitch = Math.min(0.35, weaponVisualState.recoilPitch + upForce * 3.5);
  // Introduce small random sideways roll/yaw kickback
  weaponVisualState.recoilYaw += (Math.random() - 0.5) * sideForce * 3.0;
}

/**
 * Triggers weapon switching state.
 */
export function switchActiveWeaponModel(slot: number): void {
  if (weaponVisualState.activeSlot === slot) return;
  weaponVisualState.pendingSlot = slot;
  weaponVisualState.switchTimer = WEAPON_SWITCH_DURATION;
}

/**
 * Checks if the weapon is currently drawing or holstering.
 */
export function isSwitchingWeapon(): boolean {
  return weaponVisualState.switchTimer > 0;
}

/**
 * Retrieves the current world coordinate position of the bullet ignition point on the barrel.
 */
export function getMuzzleWorldPosition(outVec: THREE.Vector3, camera: THREE.Camera): void {
  const activeMesh = weaponVisualState.activeSlot === 1 ? rifleGroup : pistolGroup;
  if (activeMesh && (activeMesh as any).muzzleNode) {
    (activeMesh as any).muzzleNode.getWorldPosition(outVec);
  } else {
    // Zero-overhead fallback to camera offset if uninitialized
    outVec.copy(camera.position);
    const cameraDir = _pos.set(0, 0, -1).applyQuaternion(camera.quaternion);
    outVec.addScaledVector(cameraDir, 0.5);
  }
}

/**
 * Animates and positions the weapons container and individual meshes.
 * Resolves springs, ads translation alignments, breathing sway, and weapon swap overlays.
 */
export function updateWeaponsContainer(
  dt: number,
  camera: THREE.Camera,
  isADS: boolean,
  currentAdsLerp: number
): void {
  if (!weaponsContainer || !rifleGroup || !pistolGroup) return;

  // 1. Process Weapon Switching Progress
  if (weaponVisualState.switchTimer > 0) {
    const prevTimer = weaponVisualState.switchTimer;
    weaponVisualState.switchTimer = Math.max(0, weaponVisualState.switchTimer - dt);

    // Swap models exactly at the half-way threshold (draw/holster intersection)
    if (prevTimer > WEAPON_SWITCH_DURATION * 0.5 && weaponVisualState.switchTimer <= WEAPON_SWITCH_DURATION * 0.5) {
      weaponVisualState.activeSlot = weaponVisualState.pendingSlot;
      rifleGroup.visible = (weaponVisualState.activeSlot === 1);
      pistolGroup.visible = (weaponVisualState.activeSlot === 2);
    }
  }

  // Determine current active weapon and fetch characteristics
  const activeSlot = weaponVisualState.activeSlot;
  const stats = activeSlot === 1 ? DETAILED_WEAPONS.rifle : DETAILED_WEAPONS.pistol;

  // 2. Resolve Smooth Recoil Decay (smooth elastic drift backwards and forwards)
  const recoverySpeed = stats.recoilRecoveryRate * 1.5;
  weaponVisualState.recoilZ = Math.max(0.0, weaponVisualState.recoilZ - dt * recoverySpeed);
  weaponVisualState.recoilPitch = Math.max(0.0, weaponVisualState.recoilPitch - dt * recoverySpeed);
  weaponVisualState.recoilYaw -= Math.sign(weaponVisualState.recoilYaw) * Math.min(Math.abs(weaponVisualState.recoilYaw), dt * recoverySpeed);

  // 3. Compute Breathing Sway (Only visible and prominent when aiming down the sights!)
  // In hip fire, sway is 0. In full ADS, it achieves maximum amplitude to represent breath holding details
  weaponVisualState.swayCycle += dt * stats.swaySpeed;
  const swayIntensity = currentAdsLerp * stats.swayAmplitude * 6.5; // Scale up to feel visible in sights
  const swayX = Math.sin(weaponVisualState.swayCycle) * swayIntensity;
  const swayY = Math.cos(weaponVisualState.swayCycle * 2.0) * swayIntensity * 0.5;

  // 4. Calculate Holster Lower-Raise Displacement
  let switchYOffset = 0.0;
  if (weaponVisualState.switchTimer > 0) {
    const progress = weaponVisualState.switchTimer / WEAPON_SWITCH_DURATION; // 1 to 0
    // Sinusoidal arc downwards for holster, raising new model upwards
    switchYOffset = -0.4 * Math.sin(progress * Math.PI);
  }

  // 5. Compute Aim-Down-Sights (ADS) Base offsets
  // Rifle Center Offset alignment coordinates
  const rifleHipX = 0.15;
  const rifleHipY = -0.15;
  const rifleHipZ = -0.40;
  // Sight alignment matches holographic center precisely
  const rifleAdsX = 0.0;
  const rifleAdsY = -0.055; // Height offset to aim straight down holographic window
  const rifleAdsZ = -0.22;

  // Pistol Center Offset alignment coordinates
  const pistolHipX = 0.12;
  const pistolHipY = -0.13;
  const pistolHipZ = -0.30;
  // Align iron notch perfectly
  const pistolAdsX = 0.0;
  const pistolAdsY = -0.024; // Height offset to align tritium dots in center
  const pistolAdsZ = -0.18;

  const hipX = activeSlot === 1 ? rifleHipX : pistolHipX;
  const hipY = activeSlot === 1 ? rifleHipY : pistolHipY;
  const hipZ = activeSlot === 1 ? rifleHipZ : pistolHipZ;

  const adsX = activeSlot === 1 ? rifleAdsX : pistolAdsX;
  const adsY = activeSlot === 1 ? rifleAdsY : pistolAdsY;
  const adsZ = activeSlot === 1 ? rifleAdsZ : pistolAdsZ;

  // Blend Hip and ADS offsets via current ads zoom ratio
  const baseTargetX = hipX + (adsX - hipX) * currentAdsLerp;
  const baseTargetY = hipY + (adsY - hipY) * currentAdsLerp;
  const baseTargetZ = hipZ + (adsZ - hipZ) * currentAdsLerp;

  // Assemble comprehensive final coordinates including recoil, sway, and switch translations
  const finalX = baseTargetX + swayX + (weaponVisualState.recoilYaw * 0.05);
  const finalY = baseTargetY + swayY + switchYOffset + (weaponVisualState.recoilPitch * 0.12);
  const finalZ = baseTargetZ - weaponVisualState.recoilZ; // recoil translation kickback

  // Copy camera position and orientation as our coordinate system anchor
  weaponsContainer.position.copy(camera.position);
  weaponsContainer.quaternion.copy(camera.quaternion);

  // Slide relative to camera space
  weaponsContainer.translateZ(finalZ);
  weaponsContainer.translateX(finalX);
  weaponsContainer.translateY(finalY);

  // Feed in local rotational kicks and sway rolls
  _rot.set(
    weaponVisualState.recoilPitch + (swayY * 1.5),
    -weaponVisualState.recoilYaw + (swayX * 1.5),
    -swayX * 4.0, // Rotate/tilt side-to-side during sideways sway loops
    'YXZ'
  );
  weaponsContainer.rotation.copy(_rot);
}
