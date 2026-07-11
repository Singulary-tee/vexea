import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getCachedOrFetchUrl } from "./asset-cache";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { DRONE_CONFIGS, DroneType } from "../shared/constants";

function countMeshesInScene(scene: THREE.Object3D): number {
  let count = 0;
  scene.traverse((node: any) => {
    if (node.isMesh && node.geometry) count++;
  });
  return count;
}

export interface DroneNode {
  name: string;
  isMesh: boolean;
  geom: THREE.BufferGeometry | null;
  material: THREE.Material | null;
  localMatrix: THREE.Matrix4;
  parentName: string | null;
  meshIndex: number; // -1 if not a mesh
  pivot?: THREE.Vector3;
  localPivot?: THREE.Vector3;
}

export async function initDroneModels(scene: THREE.Scene): Promise<void> {
  console.log("--- initDroneModels V5 with True Hierarchy ---");

  const parseGLTF = async (urlName: string) => {
    try {
      const url = await Promise.race([
          getCachedOrFetchUrl(urlName, "Asset"),
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Timeout caching " + urlName)), 2000))
      ]);
      const loader = new GLTFLoader();
      const gltf = await Promise.race([
          loader.loadAsync(url),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout loading " + urlName)), 2000))
      ]) as any;

      if (urlName === "fixed_wing_drone.glb" && gltf && gltf.animations) {
         (window as any).fixedWingAnimations = gltf.animations;
      }

      const nodes: DroneNode[] = [];
      if (gltf && gltf.scene) {
        if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(gltf.scene);
            const action = mixer.clipAction(gltf.animations[0]);
            action.play();
            mixer.setTime(14/30);
            mixer.update(0);
        }
        gltf.scene.updateMatrixWorld(true);
        
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = new THREE.Vector3();
        box.getCenter(center);
        
        gltf.scene.children.forEach((child: any) => {
           child.position.sub(center);
        });
        gltf.scene.updateMatrixWorld(true);

        let meshCounter = 0;
        
        gltf.scene.traverse((child: any) => {
          if (child === gltf.scene) return;
          
          let pivot = new THREE.Vector3();
          const box = new THREE.Box3().setFromObject(child);
          if (!box.isEmpty()) {
              box.getCenter(pivot);
          }
          let localPivot = pivot.clone();
          if (child.matrixWorld) {
              const invWorld = child.matrixWorld.clone().invert();
              localPivot.applyMatrix4(invWorld);
          }
          
          let geom = null;
          let mat = null;
          let mIndex = -1;
          if (child.isMesh && child.geometry) {
             geom = child.geometry.clone();
             mat = child.material;
             mIndex = meshCounter++;
          }
          
          nodes.push({
            name: child.name || 'unnamed_' + Math.random().toString(36).substr(2, 9),
            isMesh: !!geom,
            geom: geom,
            material: mat,
            localMatrix: child.matrix.clone(),
            parentName: child.parent && child.parent !== gltf.scene ? child.parent.name : null,
            meshIndex: mIndex,
            pivot,
            localPivot
          });
        });
      }
      if (urlName === "fixed_wing_drone.glb") (window as any).rawFwGLTF = gltf; return nodes;
    } catch(e) {
      console.warn("Failed to load drone model:", urlName, e);
    }
    return [];
  };

  const reconParts = await parseGLTF("quadcopter_camera.glb");
  const rotaryParts = await parseGLTF("quadcopter_rifle.glb");
  const bomberParts = await parseGLTF("quadcopter_bomb.glb");
  const wheeledParts = await parseGLTF("wheeled_drone.glb");
  const fixedWingParts = await parseGLTF("fixed_wing_drone.glb");

  const mkBatchDirect = (
    nodes: DroneNode[], 
    singleMaterial: THREE.Material,
    fallbackGeom: THREE.BufferGeometry | null,
    maxDrones: number,
    targetRadius: number
  ) => {
     let useNodes = nodes;
     if (useNodes.length === 0 && fallbackGeom) {
       useNodes = [{
         name: 'body',
         isMesh: true,
         geom: fallbackGeom.clone(),
         material: singleMaterial,
         localMatrix: new THREE.Matrix4().identity(),
         parentName: null,
         meshIndex: 0
       }];
     }

     const meshes = useNodes.filter(n => n.isMesh && n.geom);
     const maxInstances = maxDrones * Math.max(1, meshes.length);
     
     let bodyMesh = meshes.find(m => m.name === 'body' || m.name.toLowerCase().includes('body')) || meshes[0];
     let scaleFactor = 1.0;
     if (bodyMesh && bodyMesh.geom) {
       bodyMesh.geom.computeBoundingBox();
       const sphere = new THREE.Sphere();
       if (bodyMesh.geom.boundingBox) bodyMesh.geom.boundingBox.getBoundingSphere(sphere);
       const currentRadius = sphere.radius || 1.0;
       scaleFactor = targetRadius / currentRadius;
     }

     const allAttrNames = new Set<string>();
     meshes.forEach(p => {
       Object.keys(p.geom!.attributes).forEach(name => allAttrNames.add(name));
     });
     meshes.forEach(p => {
       const vertexCount = p.geom!.getAttribute('position').count;
       allAttrNames.forEach(name => {
         if (!p.geom!.hasAttribute(name)) {
           let itemSize = 3; let normalized = false;
           for (const other of meshes) {
             if (other.geom!.hasAttribute(name)) {
               const attr = other.geom!.getAttribute(name);
               itemSize = attr.itemSize; normalized = (attr as any).normalized || false;
               break;
             }
           }
           const buffer = new Float32Array(vertexCount * itemSize);
           const newAttr = new THREE.BufferAttribute(buffer, itemSize, normalized);
           p.geom!.setAttribute(name, newAttr);
         }
       });
     });

     let totalVertices = 0; let totalIndices = 0;
     meshes.forEach(p => {
        totalVertices += p.geom!.getAttribute('position').count;
        if (p.geom!.index) totalIndices += p.geom!.index.count;
        else totalIndices += p.geom!.getAttribute('position').count;
     });

     const actualMaterial = useNodes.find(n => n.isMesh && n.material)?.material || singleMaterial;

     const batchMesh = new (THREE.BatchedMesh as any)(
        maxInstances, 
        totalVertices, 
        totalIndices, 
        actualMaterial
     );
     batchMesh.frustumCulled = false;
     
     const geomIds: number[] = [];
     meshes.forEach(p => {
        if (!p.geom!.index) {
            const count = p.geom!.getAttribute('position').count;
            const indices = [];
            for(let j=0; j<count; j++) indices.push(j);
            p.geom!.setIndex(indices);
        }
        geomIds.push(batchMesh.addGeometry(p.geom!));
     });

     const instanceGroup: number[][] = [];
     for(let d=0; d<maxDrones; d++) {
         const subIds: number[] = [];
         for(let i=0; i<meshes.length; i++) {
             const instId = batchMesh.addInstance(geomIds[i]);
             if ((batchMesh as any).setVisibleAt) {
                (batchMesh as any).setVisibleAt(instId, false);
             }
             subIds.push(instId);
         }
         instanceGroup.push(subIds);
     }

     scene.add(batchMesh);
     
     return { 
       mesh: batchMesh, 
       instanceGroup,
       scaleFactor,
       nodesInfo: useNodes.map(n => ({
         name: n.name,
         parentName: n.parentName,
         localMatrix: n.localMatrix.clone(),
         baseLocalMatrix: n.localMatrix.clone(),
         meshIndex: n.meshIndex,
         pivot: n.pivot ? n.pivot.clone() : new THREE.Vector3(),
          localPivot: (n as any).localPivot ? (n as any).localPivot.clone() : new THREE.Vector3()
       }))
     };
  };

  const tMatGround = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.8 });
  const tMatAir = new THREE.MeshStandardMaterial({ color: 0x00aaff, roughness: 0.5 });
  const tMatBomber = new THREE.MeshStandardMaterial({ color: 0xff4400, roughness: 0.5 });
  
  const gBase = new THREE.SphereGeometry(0.8, 8, 8);
  const gBox = new THREE.BoxGeometry(2, 0.5, 3);

  (window as any).droneBatches = [];
  (window as any).droneBatches[0] = mkBatchDirect(rotaryParts, tMatAir, gBase, 50, 1.0);
  (window as any).droneBatches[1] = mkBatchDirect(bomberParts, tMatBomber, gBase, 50, 1.0);
  (window as any).droneBatches[2] = mkBatchDirect(reconParts, tMatAir, gBase, 50, 1.0);
  (window as any).droneBatches[4] = mkBatchDirect(wheeledParts, tMatGround, gBox, 50, 1.5);
  (window as any).droneBatches[5] = mkBatchDirect([], tMatGround, gBox, 50, 1.5);
  (window as any).droneBatches[6] = mkBatchDirect([], tMatGround, gBox, 50, 2.5);

  const fixedWingGroup = new THREE.Group();
  fixedWingGroup.name = "FixedWingStandalone";
  
  const offsetGroup = new THREE.Group();
  const fwOffset = DRONE_CONFIGS[DroneType.FIXED_WING].orientationOffset || [0, 0, 0];
  offsetGroup.rotation.set(fwOffset[0], fwOffset[1], fwOffset[2]);
  fixedWingGroup.add(offsetGroup);

  const gltf = (window as any).rawFwGLTF;
  if (gltf && gltf.scene) {
      const clone = SkeletonUtils.clone(gltf.scene);
      offsetGroup.add(clone);
  }
  
  let scaleFactorFW = 1.0;
  let bodyFW = fixedWingParts.find(p => p.isMesh && (p.name === 'body' || p.name.toLowerCase().includes('body'))) || fixedWingParts.find(p=>p.isMesh);
  if (bodyFW) {
      bodyFW.geom!.computeBoundingBox();
      const sphere = new THREE.Sphere();
      if (bodyFW.geom!.boundingBox) bodyFW.geom!.boundingBox.getBoundingSphere(sphere);
      scaleFactorFW = 1.5 / (sphere.radius || 1.0);
  }
  fixedWingGroup.scale.set(scaleFactorFW, scaleFactorFW, scaleFactorFW);
  
  (window as any).fixedWingModel = fixedWingGroup;
  setTimeout(() => {
     let logs = [];
     if (fixedWingGroup) {
         let sceneObj = (window as any).rawFwScene;
         if (sceneObj && sceneObj.animations && sceneObj.animations.length > 0) {
             const mixer = new THREE.AnimationMixer(sceneObj);
             const action = mixer.clipAction(sceneObj.animations[0]);
             action.play();
             mixer.setTime(14/30);
             sceneObj.updateMatrixWorld(true);
         }
         fixedWingGroup.updateMatrixWorld(true);
         let fwB = new THREE.Box3();
         fixedWingGroup.traverse((n: any) => {
             if (n.isMesh && !n.name.includes("AGM") && !n.name.includes("MBDA")) {
                 if (n.geometry) {
                     if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
                     let b = n.geometry.boundingBox.clone();
                     b.applyMatrix4(n.matrixWorld);
                     fwB.expandByPoint(b.min);
                     fwB.expandByPoint(b.max);
                 }
             }
         });
         logs.push("FW Frame 14 scaled width: " + (fwB.max.x - fwB.min.x) + " height: " + (fwB.max.y - fwB.min.y) + " depth: " + (fwB.max.z - fwB.min.z));
         fetch("/api/log", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(logs) });
     }
  }, 3000);
}

setTimeout(() => {
    let logs = [];
    const gltf = (window as any).rawFwGLTF;
    if (gltf && gltf.scene && gltf.animations && gltf.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(gltf.scene);
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
        mixer.setTime(14/30);
        gltf.scene.updateMatrixWorld(true);
        let fwB = new THREE.Box3();
        gltf.scene.traverse((n: any) => {
            if (n.isMesh && !n.name.includes("AGM") && !n.name.includes("MBDA")) {
                if (n.geometry) {
                    if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
                    let b = n.geometry.boundingBox.clone();
                    b.applyMatrix4(n.matrixWorld);
                    fwB.expandByPoint(b.min);
                    fwB.expandByPoint(b.max);
                }
            }
        });
        
        // calculate scale Factor for FW
        let bodyFW = null;
        gltf.scene.traverse((n: any) => {
           if (n.isMesh && (n.name === 'body' || n.name.toLowerCase().includes('body'))) bodyFW = n;
        });
        if (!bodyFW) {
           gltf.scene.traverse((n: any) => { if (n.isMesh && !bodyFW) bodyFW = n; });
        }
        let sf = 1.0;
        if (bodyFW) {
            bodyFW.geometry.computeBoundingBox();
            const sphere = new THREE.Sphere();
            bodyFW.geometry.boundingBox.getBoundingSphere(sphere);
            sf = 1.5 / (sphere.radius || 1.0);
        }
        
        logs.push("FW Frame 14 SCALED Width (x): " + (fwB.max.x - fwB.min.x) * sf);
        logs.push("FW Frame 14 SCALED Height (y): " + (fwB.max.y - fwB.min.y) * sf);
        logs.push("FW Frame 14 SCALED Depth (z): " + (fwB.max.z - fwB.min.z) * sf);
        
        fetch("/api/log", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(logs) });
    }
}, 3000);
