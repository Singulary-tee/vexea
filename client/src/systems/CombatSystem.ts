import * as THREE from "three";
import { MatchController } from "../../MatchController";
import { 
  WEAPONS, 
  DETAILED_WEAPONS, 
  WeaponStats 
} from "../../../shared/constants";
import { GlobalState } from "../../state";
import { audioManager } from "../../audio";
import { hitscanSystem } from "../../hitscan";
import { 
  spawnTracer, 
  triggerFlash 
} from "../vfx/VFXOrchestrator";
import { 
  getMuzzleWorldPosition, 
  applyWeaponRecoil, 
  setWeaponReloading 
} from "../../weapons_model";

export class CombatSystem {
  private weaponFireDir = new THREE.Vector3();
  private weaponFireRight = new THREE.Vector3();
  private weaponFireUp = new THREE.Vector3();
  private weaponMuzzlePos = new THREE.Vector3();

  constructor(private match: MatchController) {}

  public fireActiveShot(camera: THREE.PerspectiveCamera) {
    const _t0_shoot = performance.now();
    
    // 1. CHECKS DEAD GATE
    if (this.match.isLocalPlayerDead) return;

    // 2. CHECKS AMMO EMPTY GATE
    if ((this.match.activeWeapon === 1 && this.match.ammo1 <= 0) || (this.match.activeWeapon === 2 && this.match.ammo2 <= 0)) {
      const now = performance.now();
      const lastShotTime = this.match.activeWeapon === 1 ? this.match.lastPrimaryShotT : this.match.lastSecondaryShotT;
      if (now - lastShotTime > 250) {
        if (this.match.activeWeapon === 1) this.match.lastPrimaryShotT = now;
        else this.match.lastSecondaryShotT = now;
        audioManager.play("click");
      }
      return;
    }

    // 3. CHECKS COOLDOWN GATE
    const now = performance.now();
    const weaponStats = this.match.activeWeapon === 1 ? WEAPONS.rifle : WEAPONS.pistol;
    const allowedInterval = 1000 / weaponStats.fireRateHz;
    const lastShotTime = this.match.activeWeapon === 1 ? this.match.lastPrimaryShotT : this.match.lastSecondaryShotT;

    if (now - lastShotTime < allowedInterval) return;

    if (this.match.activeWeapon === 1) this.match.lastPrimaryShotT = now;
    else this.match.lastSecondaryShotT = now;

    // 4. CONSUMES AMMO
    if (!GlobalState.infiniteAmmo) {
      if (this.match.activeWeapon === 1) this.match.ammo1--;
      else this.match.ammo2--;
    } else {
      if (this.match.activeWeapon === 1) this.match.ammo1 = this.match.maxAmmo1;
      else this.match.ammo2 = this.match.maxAmmo2;
    }

    if ((this.match.activeWeapon === 1 && this.match.ammo1 <= 0) || (this.match.activeWeapon === 2 && this.match.ammo2 <= 0)) {
      if (!this.match.isReloading) {
        this.match.isReloading = true;
        setWeaponReloading(true);
        audioManager.playWeaponReload(this.match.activeWeapon);
      }
    }

    // 5. PROCESS ACCURACY BLOOM, RECOIL KICK & CAMERA SHAKE
    const currentWeaponStats = this.match.activeWeapon === 1 ? DETAILED_WEAPONS.rifle : DETAILED_WEAPONS.pistol;

    this.match.currentAccuracyHeat = Math.min(1.0, this.match.currentAccuracyHeat + currentWeaponStats.heatPerShot);
    this.match.visualRecoilUpOffset = Math.min(0.2, this.match.visualRecoilUpOffset + currentWeaponStats.recoilForceUp);
    this.match.visualRecoilSideOffset += (Math.random() - 0.5) * currentWeaponStats.recoilForceSide;
    this.match.lastCamShakeT = performance.now();

    const spreadRad = (currentWeaponStats.baseSpreadRad + this.match.currentAccuracyHeat * (currentWeaponStats.maxSpreadRad - currentWeaponStats.baseSpreadRad)) * (1.0 - this.match.currentAdsLerp * 0.5);
    const deflectionAngle = Math.random() * Math.PI * 2.0;
    const deflectionRadius = Math.random() * spreadRad;
    const deflectionX = Math.cos(deflectionAngle) * deflectionRadius;
    const deflectionY = Math.sin(deflectionAngle) * deflectionRadius;

    this.weaponFireDir.set(0, 0, 0);
    camera.getWorldDirection(this.weaponFireDir);
    this.weaponFireRight.setFromMatrixColumn(camera.matrixWorld, 0);
    this.weaponFireUp.setFromMatrixColumn(camera.matrixWorld, 1);

    this.weaponFireDir.addScaledVector(this.weaponFireRight, deflectionX);
    this.weaponFireDir.addScaledVector(this.weaponFireUp, deflectionY);
    this.weaponFireDir.normalize();

    this.match.fireSequenceNumber++;
    if (this.match.transport) {
      this.match.transport.emit("reliable_event", {
        type: "FIRE",
        weaponSlot: this.match.activeWeapon === 1 ? "primary" : "secondary",
        origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        direction: { x: this.weaponFireDir.x, y: this.weaponFireDir.y, z: this.weaponFireDir.z },
        timestamp: Date.now(),
        sequenceNumber: this.match.fireSequenceNumber,
      });
    }

    applyWeaponRecoil(currentWeaponStats.recoilForceUp, currentWeaponStats.recoilForceSide);
    audioManager.playWeaponFire(this.match.activeWeapon);

    this.weaponMuzzlePos.set(0, 0, 0);
    getMuzzleWorldPosition(this.weaponMuzzlePos, camera);
    spawnTracer(this.weaponMuzzlePos, this.weaponFireDir);
    triggerFlash(this.weaponMuzzlePos);

    hitscanSystem.performClientHitscan(camera, this.match.scene, this.weaponFireDir, currentWeaponStats.falloff.minDamageRange);
    
    this.match.pendingFire = false; // reset pending fire flag

    const _elapsed = performance.now() - _t0_shoot;
    if (_elapsed > 5) (window as any).__lastEventSpike = { label: 'SHOOT', ms: _elapsed, t: performance.now() };
  }
}
