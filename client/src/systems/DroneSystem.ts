import * as THREE from "three/webgpu";
import { MatchController } from "../../MatchController";
import { DroneState, DroneType, DRONE_CONFIGS } from "../../../shared/constants";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { createProceduralState, updateProceduralState, applyNodeRotation } from "./DroneProcedural";

export class DroneSystem {

  private droneProceduralState = new Map<number, any>();

  public getOrCreateProceduralState(id: number) {
     let state = this.droneProceduralState.get(id);
     if (!state) {
         state = { ...createProceduralState(), lastPos: new THREE.Vector3(), velocity: new THREE.Vector3(), smoothedVelocity: new THREE.Vector3(), lastFireTime: 0 };
         this.droneProceduralState.set(id, state);
     }
     return state;
  }
  
  public onDroneShoot(droneId: number, droneType: number) {
      const state = this.getOrCreateProceduralState(droneId);
      state.recoilAmount = 1.0;
      state.lastFireTime = performance.now();
  }
  private match: MatchController;
  private diagTempPosition = new THREE.Vector3();
  private diagTempQuaternion = new THREE.Quaternion();
  private diagTempMatrix = new THREE.Matrix4();
  
  // Pre-allocated temp matrices for Zero-GC rendering of drone parts
  private tempLocalMat = new THREE.Matrix4();
  private tempR = new THREE.Matrix4();
  private tempT1 = new THREE.Matrix4();
  private tempT2 = new THREE.Matrix4();
  private tempRotAroundPivot = new THREE.Matrix4();
  private tempRecoilMat = new THREE.Matrix4();
  private tempParentDroneLocalMat = new THREE.Matrix4();
  private tempWorldMat = new THREE.Matrix4();
  
  private droneSlots = new Map<number, { typeId: number, slotIdx: number }>();
  private freeSlots = new Map<number, number[]>();
  private activeThisTick = new Set<number>();
  private standaloneDrones = new Map<number, THREE.Group>();
  private extraRot = new THREE.Quaternion();
  private tempRotQ = new THREE.Quaternion();
  private tempUp = new THREE.Vector3(0, 1, 0);
  private standaloneMixers = new Map<number, THREE.AnimationMixer>();

  // Pre-allocated objects for zero GC loops
  private loopEuler = new THREE.Euler();
  private loopOffsetQ = new THREE.Quaternion();
  private loopP1Pos = new THREE.Vector3();
  private loopP0Pos = new THREE.Vector3();
  private loopSwayQ = new THREE.Quaternion();
  private loopBodyEuler = new THREE.Euler();
  private loopQ = new THREE.Quaternion();
  private zeroVector = new THREE.Vector3(0, 0, 0);
  private tempTurretPivot = new THREE.Vector3();
  private tempGunPivot = new THREE.Vector3();
  private tempPropellerPivot = new THREE.Vector3();

  public riflemanModel: THREE.Group | null = null;

  constructor(match: MatchController) {
    this.match = match;
    for (let i = 0; i < 7; i++) {
      this.freeSlots.set(i, Array.from({ length: 50 }, (_, k) => 49 - k));
    }
  }

  public init() {}

  public step(dt: number) {
    const match = this.match;
    if (!match.droneJitterMap) return;

    const droneBatches = (window as any).droneBatches;
    if (!droneBatches) return;

    const localTime = performance.now();
    const serverTimeEstimate = localTime + match.serverTimeDelta;
    const renderTime = serverTimeEstimate - 100;

    this.activeThisTick.clear();

    match.droneJitterMap.forEach((buffer, id) => {
      if (buffer.count === 0) return;
      const latest = buffer.getLatest();
      
      if (latest.state === DroneState.DEAD) return;

      this.activeThisTick.add(id);

      let p0 = buffer.get(0), p1 = buffer.get(0);

      if (buffer.count === 1) {
        p0 = buffer.get(0);
        p1 = buffer.get(0);
      } else {
        if (renderTime > latest.t) {
          p0 = latest;
          p1 = latest;
        } else if (renderTime < buffer.get(0).t) {
          p0 = buffer.get(0);
          p1 = buffer.get(0);
        } else {
          for (let i = buffer.count - 1; i >= 1; i--) {
            if (renderTime >= buffer.get(i - 1).t && renderTime <= buffer.get(i).t) {
              p1 = buffer.get(i);
              p0 = buffer.get(i - 1);
              break;
            }
          }
        }
      }

      let t = 1.0;
      if (p1.t > p0.t) t = (renderTime - p0.t) / (p1.t - p0.t);
      t = Math.max(0, Math.min(1, t));

      this.diagTempPosition.set(
        p0.posX + (p1.posX - p0.posX) * t,
        p0.posY + (p1.posY - p0.posY) * t,
        p0.posZ + (p1.posZ - p0.posZ) * t,
      );

      match.tempQ0.set(p0.rotX, p0.rotY, p0.rotZ, p0.rotW);
      match.tempQ1.set(p1.rotX, p1.rotY, p1.rotZ, p1.rotW);
      this.diagTempQuaternion.copy(match.tempQ0).slerp(match.tempQ1, t);

      let diffX = p1.posX - p0.posX;
      let diffY = p1.posY - p0.posY;
      let diffZ = p1.posZ - p0.posZ;
      let distSq = diffX * diffX + diffY * diffY + diffZ * diffZ;
      if (distSq > 0.25) {
        this.diagTempPosition.set(p1.posX, p1.posY, p1.posZ);
        this.diagTempQuaternion.copy(match.tempQ1);
      }

      // Scale is applied per-drone-type later during batch processing
      // this.diagTempMatrix is composed later

      (latest as any).clientPosX = this.diagTempPosition.x;
      (latest as any).clientPosY = this.diagTempPosition.y;
      (latest as any).clientPosZ = this.diagTempPosition.z;

      const typeId = latest.type;
      if (typeId >= 0 && typeId <= 6 || typeId === DroneType.TEST_ENTITY) {
        if (typeId === 3 || typeId === DroneType.TEST_ENTITY) { // FIXED_WING standalone or TEST_ENTITY
           match.tempScale.set(1, 1, 1);
           this.diagTempMatrix.compose(this.diagTempPosition, this.diagTempQuaternion, match.tempScale);
           let fw = this.standaloneDrones.get(id);
           if (!fw) {
              if (typeId === DroneType.TEST_ENTITY) {
                 const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
                 const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
                 fw = new THREE.Mesh(geo, mat) as any;
                 this.match.scene.add(fw);
                 this.standaloneDrones.set(id, fw);
              } else if ((window as any).fixedWingModel) {
                 fw = SkeletonUtils.clone((window as any).fixedWingModel) as THREE.Group;
                 this.match.scene.add(fw);
                 this.standaloneDrones.set(id, fw);
                 
                 const anims = (window as any).fixedWingAnimations;
                 if (anims && anims.length > 0) {
                    const mixer = new THREE.AnimationMixer(fw);
                    const action = mixer.clipAction(anims[0]);
                    action.play();
                    mixer.setTime(14/30); mixer.update(0);
                    // Do NOT add to standaloneMixers, so it holds at frame 14
                 }
              }
           }
           if (fw) {
              fw.position.copy(this.diagTempPosition);
              fw.quaternion.copy(this.diagTempQuaternion);
           }
        } else {
            let assignment = this.droneSlots.get(id);
            
            if (!assignment || assignment.typeId !== typeId) {
              if (assignment) {
                this.freeSlots.get(assignment.typeId)?.push(assignment.slotIdx);
                const oldBatch = droneBatches[assignment.typeId];
                if (oldBatch && oldBatch.mesh) {
                   const subIds = oldBatch.instanceGroup[assignment.slotIdx];
                   for(const sid of subIds) (oldBatch.mesh as any).setVisibleAt(sid, false);
                }
              }
              
              const freeIdx = this.freeSlots.get(typeId)?.pop();
              if (freeIdx !== undefined) {
                assignment = { typeId, slotIdx: freeIdx };
                this.droneSlots.set(id, assignment);
                const batch = droneBatches[typeId];
                if (batch && batch.mesh) {
                   const subIds = batch.instanceGroup[freeIdx];
                   for(const sid of subIds) (batch.mesh as any).setVisibleAt(sid, true);
                }
              }
            }

            if (assignment) {
              const batch = droneBatches[typeId];
              if (batch && batch.instanceGroup[assignment.slotIdx]) {
                 const subIds = batch.instanceGroup[assignment.slotIdx];
                 const nodesInfo = batch.nodesInfo;
                 const sf = batch.scaleFactor || 1;
                 match.tempScale.set(sf, sf, sf);
                 let q = this.diagTempQuaternion;
                 const config = DRONE_CONFIGS[typeId];
                 if (config && config.orientationOffset) {
                    this.loopEuler.set(config.orientationOffset[0], config.orientationOffset[1], config.orientationOffset[2], 'YXZ');
                    this.loopOffsetQ.setFromEuler(this.loopEuler);
                    this.tempRotQ.copy(this.diagTempQuaternion).multiply(this.loopOffsetQ);
                    q = this.tempRotQ;
                 }
                 this.diagTempMatrix.compose(this.diagTempPosition, q, match.tempScale);
                 
                 
                 const state = this.getOrCreateProceduralState(id);
                 let diffT = 0.016; // default 60hz
                 if (p1.t > p0.t) diffT = (p1.t - p0.t) / 1000;
                 if (diffT < 0.001) diffT = 0.016;
                 
                 this.loopP1Pos.set(p1.posX, p1.posY, p1.posZ);
                 this.loopP0Pos.set(p0.posX, p0.posY, p0.posZ);
                 state.velocity.copy(this.loopP1Pos).sub(this.loopP0Pos).divideScalar(diffT);
                 state.smoothedVelocity.lerp(state.velocity, 0.1);
                 
                 const speed = state.smoothedVelocity.length();
                 this.loopBodyEuler.setFromQuaternion(this.diagTempQuaternion, 'YXZ');
                 this.loopSwayQ.set(0, 0, 0, 1);
                 
                 updateProceduralState(state, typeId, dt, speed, state.smoothedVelocity, this.loopBodyEuler, this.loopSwayQ);
                 
                 this.loopQ.copy(this.diagTempQuaternion).multiply(this.loopSwayQ);
                 q = this.loopQ;
                 if (config && config.orientationOffset) {
                    this.loopEuler.set(config.orientationOffset[0], config.orientationOffset[1], config.orientationOffset[2], 'YXZ');
                    this.loopOffsetQ.setFromEuler(this.loopEuler);
                    q.multiply(this.loopOffsetQ);
                 }
                 
                 let basePosY = this.diagTempPosition.y;
                 if (typeId === DroneType.WHEELED) {
                     // Handled by body-only translation below
                 } else if (typeId === DroneType.ROTARY_SHOOTER || typeId === DroneType.BOMBER || typeId === DroneType.RECON) {
                     const bobAmp = config?.verticalBobAmount ?? 0.08;
                     const bobSpeed = config?.verticalBobSpeed ?? 1.5;
                     if (bobAmp > 0) {
                         this.diagTempPosition.y += Math.sin(performance.now() * 0.001 * bobSpeed) * bobAmp;
                     }
                 }
                 
                 this.diagTempMatrix.compose(this.diagTempPosition, q, match.tempScale);
                 
                 // Restore for next node calculations if any
                 this.diagTempPosition.y = basePosY;
                 
                 if (!state.droneLocalMats) {
                      state.droneLocalMats = new Map<string, THREE.Matrix4>();
                  }
                  if (!state.processedNodes) {
                      state.processedNodes = new Set<string>();
                  }
                  state.processedNodes.clear();

                  let unresolved = true;
                  let limit = 20;
                  while(unresolved && limit > 0) {
                      unresolved = false;
                      limit--;
                      for(let n=0; n<nodesInfo.length; n++) {
                         const info = nodesInfo[n];
                         if (state.processedNodes.has(info.name)) continue;
                         
                         let parentDroneLocalMat = this.tempParentDroneLocalMat.identity();
                         if (info.parentName) {
                             if (state.processedNodes.has(info.parentName)) {
                                 parentDroneLocalMat = state.droneLocalMats.get(info.parentName);
                             } else {
                                 unresolved = true;
                                 continue;
                             }
                         }

                         let droneLocalMat = state.droneLocalMats.get(info.name);
                         if (!droneLocalMat) {
                             droneLocalMat = new THREE.Matrix4();
                             state.droneLocalMats.set(info.name, droneLocalMat);
                         }

                         this.tempLocalMat.copy(info.baseLocalMatrix);
                         
                         let r = this.tempR.identity();
                         const { didRotate, hasRecoil } = applyNodeRotation(typeId, info.name, info.parentName, state, r, this.tempRecoilMat, info.isMesh);
                         
                         if (didRotate) {
                             let lp = (info as any).localPivot || this.zeroVector;
                             
                             // P_local: pivot relative to mesh origin in its own coordinate system
                             if (typeId === DroneType.WHEELED && (info as any).baseInvWorldMatrix) {
                                 if (info.name === 'rotate' && config.turretYawPivot) {
                                     this.tempTurretPivot.set(config.turretYawPivot[0], config.turretYawPivot[1], config.turretYawPivot[2]);
                                     this.tempTurretPivot.applyMatrix4((info as any).baseInvWorldMatrix);
                                     lp = this.tempTurretPivot;
                                 } else if (info.name === 'gun' && config.gunPitchPivot) {
                                     this.tempGunPivot.set(config.gunPitchPivot[0], config.gunPitchPivot[1], config.gunPitchPivot[2]);
                                     this.tempGunPivot.applyMatrix4((info as any).baseInvWorldMatrix);
                                     lp = this.tempGunPivot;
                                 }
                             }
                             // Geometric Rule: M_local = T_position * T(P_local) * R * T(-P_local)
                             this.tempT1.makeTranslation(-lp.x, -lp.y, -lp.z);
                             this.tempT2.makeTranslation(lp.x, lp.y, lp.z);
                             this.tempRotAroundPivot.multiplyMatrices(this.tempT2, r).multiply(this.tempT1);
                             
                             // Apply to base local matrix (T_position)
                             this.tempLocalMat.multiply(this.tempRotAroundPivot);
                         }

                         if (hasRecoil) {
                             const recoilAmt = config.barrelRecoilAmount ?? 0.15;
                             if (typeId === DroneType.ROTARY_SHOOTER) {
                                  this.tempRecoilMat.makeTranslation(0, 0, -state.recoilAmount * recoilAmt);
                              } else if (typeId === DroneType.WHEELED) {
                                  this.tempRecoilMat.makeTranslation(state.recoilAmount * recoilAmt, 0, 0);
                              } else {
                                  this.tempRecoilMat.makeTranslation(-state.recoilAmount * recoilAmt, 0, 0);
                              }
                             this.tempLocalMat.multiply(this.tempRecoilMat);
                         }

                         let totalVib = 0;
                         if (typeId === DroneType.WHEELED && (info.name === 'm2hb_mount_0' || (info.isMesh && (info.name === 'Cube_BASE_0' || info.name === 'body' || info.name.toLowerCase().includes('body') || info.name.toLowerCase().includes('chassis'))))) {
                             const vibAmp = config?.chassisVibration ?? 0.05;
                             const vibSpeed = config?.chassisVibrationSpeed ?? 30.0;
                             if (vibAmp > 0 && speed > 0.1) {
                                 totalVib += Math.sin(performance.now() * 0.001 * vibSpeed) * vibAmp * Math.min(speed / 10.0, 1.0);
                             }
                             if (state.recoilAmount > 0) {
                                 totalVib += Math.sin(performance.now() * 0.001 * (vibSpeed * 1.5)) * vibAmp * state.recoilAmount;
                             }
                         }

                         droneLocalMat.multiplyMatrices(parentDroneLocalMat, this.tempLocalMat);
                         state.processedNodes.add(info.name);

                         this.tempWorldMat.multiplyMatrices(this.diagTempMatrix, droneLocalMat);
                         if (totalVib !== 0) {
                             this.tempRecoilMat.makeTranslation(0, totalVib, 0);
                             this.tempWorldMat.multiply(this.tempRecoilMat);
                         }

                         if (info.meshIndex >= 0) {
                             batch.mesh.setMatrixAt(subIds[info.meshIndex], this.tempWorldMat);
                         }
                      }
              }
            }
        }
      }
       }
    });

    for (const [id, assignment] of this.droneSlots.entries()) {
      if (!this.activeThisTick.has(id)) {
        this.freeSlots.get(assignment.typeId)?.push(assignment.slotIdx);
        const batch = droneBatches[assignment.typeId];
        if (batch && batch.mesh) {
           const subIds = batch.instanceGroup[assignment.slotIdx];
           for(const sid of subIds) (batch.mesh as any).setVisibleAt(sid, false);
        }
        this.droneSlots.delete(id);
      }
    }
    
    for (const [id, fw] of this.standaloneDrones.entries()) {
      if (!this.activeThisTick.has(id)) {
         this.match.scene.remove(fw);
         this.standaloneDrones.delete(id);
         this.standaloneMixers.delete(id);
      }
    }

    this.standaloneMixers.forEach((mixer) => {
       mixer.update(dt);
    });

    match.remotePlayersTargetData.forEach((data, id) => {
      let group = match.remotePlayersMeshes.get(id);
      let mixer = match.remotePlayerMixers.get(id);

      if (!group) {
        if ((window as any).riflemanModel) {
          group = SkeletonUtils.clone((window as any).riflemanModel) as THREE.Group;
          group.name = "RemotePlayer";
          match.scene.add(group);
          match.remotePlayersMeshes.set(id, group);
          
          mixer = new THREE.AnimationMixer(group);
          match.remotePlayerMixers.set(id, mixer);
          
          if ((window as any).riflemanModel.animations && (window as any).riflemanModel.animations.length > 0) {
            mixer.clipAction((window as any).riflemanModel.animations[0]).play();
          }
        } else {
          const geom = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
          const mat = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
          group = new THREE.Mesh(geom, mat) as unknown as THREE.Group;
          group.name = "RemotePlayerFallback";
          match.scene.add(group);
          match.remotePlayersMeshes.set(id, group);
        }
      }

      if (group) {
        group.position.lerp(data.pos, 0.15);
        group.rotation.y += (data.yaw - group.rotation.y) * 0.15;
      }
      
      if (mixer) {
        mixer.update(dt);
      }
    });
  }
}
