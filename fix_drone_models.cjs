const fs = require('fs');

let code = `import * as THREE from "three/webgpu";
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

export interface DronePart {
  name: string;
  geom: THREE.BufferGeometry;
  localMatrix: THREE.Matrix4;
  parentName: string | null;
}

export async function initDroneModels(scene: THREE.Scene): Promise<void> {
  console.log("--- initDroneModels V4 with THREE.BatchedMesh ---");

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

      const parts: DronePart[] = [];
      if (gltf && gltf.scene) {
        gltf.scene.updateMatrixWorld(true);
        
        gltf.scene.traverse((child: any) => {
          if (child.isMesh && child.geometry) {
             if (!loggedMeshNames.has(child.name)) {
               loggedMeshNames.add(child.name);
               console.log('[DRONE_DIAG] Mesh:', child.name, 'hasMaterial:', !!child.material);
             }
             const cloned = child.geometry.clone();
             
             let current = child.parent;
             let parentName: string | null = null;
             let localMatrix = new THREE.Matrix4().copy(child.matrix);

             while (current && current.name !== 'body' && current.name !== 'Scene') {
               if (current.isMesh) {
                 parentName = current.name;
                 break;
               }
               localMatrix.premultiply(current.matrix);
               current = current.parent;
             }
             
             if (!parentName && current && current.name === 'body') {
               parentName = 'body';
             }

             if (child.name === 'body') {
               localMatrix.identity(); 
               parentName = null;
             }
             
             parts.push({
               name: child.name,
               geom: cloned,
               localMatrix: localMatrix,
               parentName: parentName
             });
          }
        });
      }
      return parts;
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

  console.log("Drone models parsed, generating BatchedMesh instances...");

  const mkBatchDirect = (
    parts: DronePart[], 
    singleMaterial: THREE.Material,
    fallbackGeom: THREE.BufferGeometry | null,
    maxDrones: number,
    targetRadius: number
  ) => {
     let useParts = parts;
     if (useParts.length === 0 && fallbackGeom) {
       useParts = [{
         name: 'body',
         geom: fallbackGeom.clone(),
         localMatrix: new THREE.Matrix4().identity(),
         parentName: null
       }];
     }

     const maxInstances = maxDrones * (1 + useParts.length);
     
     let bodyPart = useParts.find(p => p.name === 'body') || useParts[0];
     let scaleFactor = 1.0;
     if (bodyPart && bodyPart.geom) {
       bodyPart.geom.computeBoundingBox();
       const sphere = new THREE.Sphere();
       if (bodyPart.geom.boundingBox) bodyPart.geom.boundingBox.getBoundingSphere(sphere);
       const currentRadius = sphere.radius || 1.0;
       scaleFactor = targetRadius / currentRadius;
     }

     const rootScaleMatrix = new THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor);
     
     useParts.forEach(p => {
       if (p.parentName === null || p.name === 'body') {
         p.localMatrix.premultiply(rootScaleMatrix);
       }
     });

     const allAttrNames = new Set<string>();
     useParts.forEach(p => {
       Object.keys(p.geom.attributes).forEach(name => allAttrNames.add(name));
     });
     useParts.forEach(p => {
       const vertexCount = p.geom.getAttribute('position').count;
       allAttrNames.forEach(name => {
         if (!p.geom.hasAttribute(name)) {
           let itemSize = 3; let normalized = false;
           for (const other of useParts) {
             if (other.geom.hasAttribute(name)) {
               const attr = other.geom.getAttribute(name);
               itemSize = attr.itemSize; normalized = (attr as any).normalized || false;
               break;
             }
           }
           const buffer = new Float32Array(vertexCount * itemSize);
           const newAttr = new THREE.BufferAttribute(buffer, itemSize, normalized);
           p.geom.setAttribute(name, newAttr);
         }
       });
     });

     let totalVertices = 0; let totalIndices = 0;
     useParts.forEach(p => {
        totalVertices += p.geom.getAttribute('position').count;
        if (p.geom.index) totalIndices += p.geom.index.count;
        else totalIndices += p.geom.getAttribute('position').count;
     });

     const batchMesh = new (THREE.BatchedMesh as any)(
        maxInstances, 
        totalVertices, 
        totalIndices, 
        singleMaterial
     );
     batchMesh.frustumCulled = false;
     
     const geomIds: number[] = [];
     useParts.forEach(p => {
        if (!p.geom.index) {
            const count = p.geom.getAttribute('position').count;
            const indices = [];
            for(let j=0; j<count; j++) indices.push(j);
            p.geom.setIndex(indices);
        }
        geomIds.push(batchMesh.addGeometry(p.geom));
     });

     const instanceGroup: number[][] = [];
     for(let d=0; d<maxDrones; d++) {
         const subIds: number[] = [];
         for(let i=0; i<useParts.length; i++) {
             const instId = batchMesh.addInstance(geomIds[i]);
             if ((batchMesh as any).setVisibleAt) {
                (batchMesh as any).setVisibleAt(instId, true);
             }
             subIds.push(instId);
         }
         instanceGroup.push(subIds);
     }

     scene.add(batchMesh);
     
     console.log(\`BatchedMesh created. Parts: \${useParts.length}, maxInstances: \${maxInstances}. Parts list:\`, useParts.map(p => p.name));
     
     return { 
       mesh: batchMesh, 
       instanceGroup,
       partsInfo: useParts.map(p => ({
         name: p.name,
         parentName: p.parentName,
         localMatrix: p.localMatrix.clone()
       }))
     };
  };

  const tMatGround = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.8 });
  const tMatAir = new THREE.MeshStandardMaterial({ color: 0x00aaff, roughness: 0.5 });
  const tMatBomber = new THREE.MeshStandardMaterial({ color: 0xff4400, roughness: 0.5 });
  
  const gBase = new THREE.SphereGeometry(0.8, 8, 8);
  const gBox = new THREE.BoxGeometry(2, 0.5, 3);

  (window as any).droneBatches = [];
  (window as any).droneBatches[0] = mkBatchDirect(rotaryParts, tMatAir, gBase, 50, 1.0); // ROTARY_SHOOTER
  (window as any).droneBatches[1] = mkBatchDirect(bomberParts, tMatBomber, gBase, 50, 1.0); // BOMBER
  (window as any).droneBatches[2] = mkBatchDirect(reconParts, tMatAir, gBase, 50, 1.0); // RECON
  // index 3 is FIXED_WING, handled separately
  (window as any).droneBatches[4] = mkBatchDirect(wheeledParts, tMatGround, gBox, 50, 1.5); // WHEELED
  (window as any).droneBatches[5] = mkBatchDirect([], tMatGround, gBox, 50, 1.5); // ROBOT_DOG placeholder
  (window as any).droneBatches[6] = mkBatchDirect([], tMatGround, gBox, 50, 2.5); // HUMANOID placeholder

  // Setup standalone FIXED_WING model
  const fixedWingGroup = new THREE.Group();
  fixedWingGroup.name = "FixedWingStandalone";
  fixedWingParts.forEach(p => {
      const mesh = new THREE.Mesh(p.geom, tMatAir);
      mesh.name = p.name;
      mesh.applyMatrix4(p.localMatrix);
      if (p.parentName === null || p.name === 'body') {
          fixedWingGroup.add(mesh);
      } else {
          const parent = fixedWingGroup.getObjectByName(p.parentName);
          if (parent) parent.add(mesh);
          else fixedWingGroup.add(mesh); 
      }
  });
  
  let scaleFactorFW = 1.0;
  let bodyFW = fixedWingParts.find(p => p.name === 'body');
  if (bodyFW) {
      bodyFW.geom.computeBoundingBox();
      const sphere = new THREE.Sphere();
      if (bodyFW.geom.boundingBox) bodyFW.geom.boundingBox.getBoundingSphere(sphere);
      scaleFactorFW = 1.5 / (sphere.radius || 1.0);
  }
  fixedWingGroup.scale.set(scaleFactorFW, scaleFactorFW, scaleFactorFW);
  
  (window as any).fixedWingModel = fixedWingGroup;

  console.log("Drone models batched completely.");
}
`;

fs.writeFileSync('client/drone_models.ts', code);
