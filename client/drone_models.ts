import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getCachedOrFetchUrl } from "./asset-cache";

const loggedMeshNames = new Set<string>();

function countMeshesInScene(scene: THREE.Object3D): number {
  let count = 0;
  scene.traverse((node: any) => {
    if (node.isMesh && node.geometry) count++;
  });
  return count;
}

export async function initDroneModels(scene: THREE.Scene): Promise<void> {
  console.log("--- initDroneModels V2 ---");

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
      
      console.log('[DRONE_DIAG] Model loaded:', urlName, 'success:', !!gltf, 'meshCount:', gltf ? countMeshesInScene(gltf.scene) : 0);

      const parts: { geom: THREE.BufferGeometry, mat: THREE.Material }[] = [];
      gltf.scene.traverse((child: any) => {
        if (child.isMesh && child.geometry) {
           if (!loggedMeshNames.has(child.name)) {
             loggedMeshNames.add(child.name);
             console.log('[DRONE_DIAG] Mesh:', child.name, 'hasMaterial:', !!child.material, 'hasMap:', !!(child.material && child.material.map), 'mapLoaded:', !!(child.material && child.material.map && child.material.map.image));
           }
           const cloned = child.geometry.clone();
           cloned.applyMatrix4(child.matrixWorld);
           
           const mat = child.material.clone() as any;
           // Strip maps that might require tangents
           if (mat.normalMap) mat.normalMap = null;
           if (mat.clearcoatNormalMap) mat.clearcoatNormalMap = null;
           
           parts.push({ geom: cloned, mat: mat });
        }
      });
      return parts;
    } catch(e) {
      console.warn("Failed to load drone model:", urlName);
    }
    return [];
  };

  const droneParts = await parseGLTF("animated_drone.glb");
  const reconParts = await parseGLTF("animated_recon_fixed-wing.glb");
  const wheeledParts = await parseGLTF("wheeled_drone-rigged-animated.glb");

  console.log("Drone models parsed, generating batches...");

  const mkBatchDirect = (parts: {geom: THREE.BufferGeometry, mat: THREE.Material}[], fallbackMat: THREE.Material, fallbackGeom: THREE.BufferGeometry, maxDrones: number) => {
     let useParts = parts.length > 0 ? parts : [{ geom: fallbackGeom, mat: fallbackMat }];
     
     console.log(`mkBatchDirect starting with ${useParts.length} parts. MaxDrones: ${maxDrones}`);

     // Extreme limits for reliability
     const MAX_VERTS = 1000000;
     const MAX_INDICES = 2000000;
     const MAX_INSTANCES = maxDrones * useParts.length + 100;

     const mesh = new THREE.BatchedMesh(
       MAX_INSTANCES,
       MAX_VERTS,
       MAX_INDICES,
       fallbackMat
     );
     mesh.name = "DroneBatch";
     mesh.frustumCulled = false;
     
     const geomIds = [];
     for(let i=0; i<useParts.length; i++) {
         const p = useParts[i];
         const vCount = p.geom.attributes.position.count;
         
         // Create a clean geometry with ONLY pos/norm/uv/tangent
         const cleanGeom = new THREE.BufferGeometry();
         cleanGeom.setAttribute('position', p.geom.getAttribute('position'));
         
         if (p.geom.hasAttribute('normal')) {
             cleanGeom.setAttribute('normal', p.geom.getAttribute('normal'));
         } else {
             // Fallback normal
             const count = p.geom.attributes.position.count;
             cleanGeom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3).fill(0), 3));
         }

         if (p.geom.hasAttribute('uv')) {
             cleanGeom.setAttribute('uv', p.geom.getAttribute('uv'));
         } else {
             // Fallback UV
             const count = p.geom.attributes.position.count;
             cleanGeom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2).fill(0), 2));
         }

         // FORCE DUMMY TANGENT FOR CONSISTENCY
         const vertexCount = p.geom.attributes.position.count;
         const tangents = new Float32Array(vertexCount * 4);
         for(let j=0; j<vertexCount; j++) {
             tangents[j*4] = 1; tangents[j*4+1] = 0; tangents[j*4+2] = 0; tangents[j*4+3] = 1;
         }
         cleanGeom.setAttribute('tangent', new THREE.BufferAttribute(tangents, 4));

         if (p.geom.index) cleanGeom.setIndex(p.geom.index);
         
         console.log(`Adding geometry ${i}: Verts=${vertexCount}, Attributes: ${Object.keys(cleanGeom.attributes).join(',')}`);
         const returnedGeometryId = mesh.addGeometry(cleanGeom);
         console.log('[DRONE_DIAG] BatchedMesh geometry registered. geometryId:', returnedGeometryId);
         geomIds.push(returnedGeometryId);
     }
     
     let currentInstanceCount = 0;
     const instanceGroup = [];
     for(let d=0; d<maxDrones; d++) {
         const subIds = [];
         for(let partIdx=0; partIdx<useParts.length; partIdx++) {
             const returnedInstanceId = mesh.addInstance(geomIds[partIdx]);
             currentInstanceCount++;
             console.log('[DRONE_DIAG] BatchedMesh registered. droneId:', d, 'geometryId:', geomIds[partIdx], 'instanceId:', returnedInstanceId, 'totalInstancesNow:', currentInstanceCount);
             subIds.push(returnedInstanceId);
         }
         instanceGroup.push(subIds);
     }
     scene.add(mesh);
     console.log(`Batch created successfully with ${instanceGroup.length} groups.`);
     return { mesh, instanceGroup };
  };

  const tMatGround = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.8 });
  const tMatAir = new THREE.MeshStandardMaterial({ color: 0x00aaff, roughness: 0.5 });
  const tMatBomber = new THREE.MeshStandardMaterial({ color: 0xff4400, roughness: 0.5 });
  
  const gBase = new THREE.SphereGeometry(0.8, 8, 8);
  const gBox = new THREE.BoxGeometry(2, 0.5, 3);

  (window as any).droneBatches = [];
  (window as any).droneBatches[0] = mkBatchDirect(droneParts, tMatAir, gBase, 50); // ROTARY
  (window as any).droneBatches[1] = mkBatchDirect([], tMatBomber, gBase, 50); // BOMBER
  (window as any).droneBatches[2] = mkBatchDirect(reconParts, tMatAir, gBase, 50); // RECON
  (window as any).droneBatches[3] = mkBatchDirect(reconParts, tMatAir, gBase, 50); // FIXED
  (window as any).droneBatches[4] = mkBatchDirect(wheeledParts, tMatGround, gBox, 50); // WHEELED
  (window as any).droneBatches[5] = mkBatchDirect([], tMatGround, gBox, 50); 
  (window as any).droneBatches[6] = mkBatchDirect([], tMatGround, gBox, 50);

  console.log("Drone models batched completely.");
}
