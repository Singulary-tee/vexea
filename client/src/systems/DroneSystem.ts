import * as THREE from "three/webgpu";
import { MatchController } from "../../MatchController";
import { DroneState, DroneType } from "../../../shared/constants";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

export class DroneSystem {
  private match: MatchController;
  private diagTempPosition = new THREE.Vector3();
  private diagTempQuaternion = new THREE.Quaternion();
  private diagTempMatrix = new THREE.Matrix4();
  
  private droneSlots = new Map<number, { typeId: number, slotIdx: number }>();
  private freeSlots = new Map<number, number[]>();
  private activeThisTick = new Set<number>();
  private standaloneDrones = new Map<number, THREE.Group>();

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
                 this.diagTempMatrix.compose(this.diagTempPosition, this.diagTempQuaternion, match.tempScale);
                 
                 const worldMats = new Map<string, THREE.Matrix4>();
                 
                 let unresolved = true;
                 let limit = 20;
                 while(unresolved && limit > 0) {
                     unresolved = false;
                     limit--;
                     for(let n=0; n<nodesInfo.length; n++) {
                        const info = nodesInfo[n];
                        if (worldMats.has(info.name)) continue;
                        
                        if (!info.parentName) {
                            const worldMat = new THREE.Matrix4().multiplyMatrices(this.diagTempMatrix, info.localMatrix);
                            worldMats.set(info.name, worldMat);
                            if (info.meshIndex >= 0) {
                                batch.mesh.setMatrixAt(subIds[info.meshIndex], worldMat);
                            }
                        } else {
                            const parentMat = worldMats.get(info.parentName);
                            if (parentMat) {
                                const worldMat = new THREE.Matrix4().multiplyMatrices(parentMat, info.localMatrix);
                                worldMats.set(info.name, worldMat);
                                if (info.meshIndex >= 0) {
                                    batch.mesh.setMatrixAt(subIds[info.meshIndex], worldMat);
                                }
                            } else {
                                unresolved = true;
                            }
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
      }
    }

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
