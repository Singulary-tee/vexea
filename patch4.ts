import fs from 'fs';
let code = fs.readFileSync('client/main.ts', 'utf-8');

// 1. Add BufferGeometryUtils import
if (!code.includes('import * as BufferGeometryUtils')) {
  code = code.replace(
    'import { FXAAShader } from "three/addons/shaders/FXAAShader.js";',
    'import { FXAAShader } from "three/addons/shaders/FXAAShader.js";\nimport * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";'
  );
}

// 2. Replace geometry initialization and BatchedMeshes
const newGeometriesCode = `
  // Create Drone and Camera BatchedMeshes
  const tMatGround = new THREE.MeshStandardMaterial({ color: 0xFF8800, emissive: 0xFF8800, emissiveIntensity: 0.2, roughness: 0.8 });
  const tMatAir = new THREE.MeshStandardMaterial({ color: 0x00AAFF, emissive: 0x00AAFF, emissiveIntensity: 0.2, roughness: 0.5 });
  const tMatRecon = new THREE.MeshStandardMaterial({ color: 0xFFFF00, emissive: 0xFFFF00, emissiveIntensity: 0.2, roughness: 0.5 });
  const tMatBomber = new THREE.MeshStandardMaterial({ color: 0xFF4400, emissive: 0xFF4400, emissiveIntensity: 0.2, roughness: 0.5 });
  const tMatCamActive = new THREE.MeshStandardMaterial({ color: 0xFF0000, emissive: 0xFF0000, emissiveIntensity: 0.8 });
  const tMatCamDead = new THREE.MeshStandardMaterial({ color: 0x333333 });

  const buildMerge = (geoms: any) => {
    geoms = geoms.filter((g: any) => g !== null);
    if(geoms.length === 1) return geoms[0];
    return BufferGeometryUtils.mergeGeometries(geoms);
  };

  const gRecon = new THREE.SphereGeometry(0.8, 8, 8);
  const gRotaryBase = new THREE.SphereGeometry(0.8, 8, 8);
  const gRotor = new THREE.CylinderGeometry(0.1, 0.1, 1.5, 4);
  const r1 = gRotor.clone(); r1.translate(1, 0, 0);
  const r2 = gRotor.clone(); r2.translate(-1, 0, 0);
  const r3 = gRotor.clone(); r3.translate(0, 0, 1);
  const r4 = gRotor.clone(); r4.translate(0, 0, -1);
  const gRotary = buildMerge([gRotaryBase, r1, r2, r3, r4]);

  const gBomberBase = new THREE.SphereGeometry(0.9, 8, 8);
  const gPayload = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  gPayload.translate(0, -0.8, 0);
  const gBomber = buildMerge([gBomberBase, gPayload]);

  const gFixedWing = new THREE.BoxGeometry(3, 0.2, 1);

  const gWheeledBase = new THREE.BoxGeometry(2, 0.5, 3);
  const gWheel = new THREE.SphereGeometry(0.6, 8, 8);
  const w1 = gWheel.clone(); w1.translate(1, -0.3, 1);
  const w2 = gWheel.clone(); w2.translate(-1, -0.3, 1);
  const w3 = gWheel.clone(); w3.translate(1, -0.3, -1);
  const w4 = gWheel.clone(); w4.translate(-1, -0.3, -1);
  const gWheeled = buildMerge([gWheeledBase, w1, w2, w3, w4]);

  const gDogBase = new THREE.BoxGeometry(1.5, 0.8, 2.5);
  const gLeg = new THREE.CylinderGeometry(0.15, 0.1, 1, 4);
  const l1 = gLeg.clone(); l1.translate(0.6, -0.8, 1);
  const l2 = gLeg.clone(); l2.translate(-0.6, -0.8, 1);
  const l3 = gLeg.clone(); l3.translate(0.6, -0.8, -1);
  const l4 = gLeg.clone(); l4.translate(-0.6, -0.8, -1);
  const gMnt = new THREE.BoxGeometry(0.4, 0.6, 0.8);
  gMnt.translate(0, 0.7, 0);
  const gDog = buildMerge([gDogBase, l1, l2, l3, l4, gMnt]);

  const gHumBase = new THREE.CapsuleGeometry(0.6, 1.5, 4, 8);
  const gArm = new THREE.BoxGeometry(0.3, 1.2, 0.3);
  const a1 = gArm.clone(); a1.translate(0.8, 0.5, 0);
  const a2 = gArm.clone(); a2.translate(-0.8, 0.5, 0);
  const gHead = new THREE.SphereGeometry(0.5, 8, 8);
  gHead.translate(0, 1.6, 0);
  const gHumanoid = buildMerge([gHumBase, a1, a2, gHead]);

  const gCamBase = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const gLens = new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8);
  gLens.rotateX(Math.PI/2);
  gLens.translate(0, 0, 0.6);
  const gCamera = buildMerge([gCamBase, gLens]);

  (window as any).droneMeshes = [];
  const mkBatch = (geom: any, mat: any, maxCount: number) => {
    const mesh = new THREE.BatchedMesh(maxCount, maxCount * 1000, maxCount * 2000, mat);
    mesh.addGeometry(geom);
    scene.add(mesh);
    return mesh;
  };

  (window as any).droneMeshes[0] = mkBatch(gRotary, tMatAir, 50); // ROTARY_SHOOTER = 0
  (window as any).droneMeshes[1] = mkBatch(gBomber, tMatBomber, 50); // BOMBER = 1
  (window as any).droneMeshes[2] = mkBatch(gRecon, tMatRecon, 50); // RECON = 2
  (window as any).droneMeshes[3] = mkBatch(gFixedWing, tMatAir, 50); // FIXED_WING = 3
  (window as any).droneMeshes[4] = mkBatch(gWheeled, tMatGround, 50); // WHEELED = 4
  (window as any).droneMeshes[5] = mkBatch(gDog, tMatGround, 50); // ROBOT_DOG = 5
  (window as any).droneMeshes[6] = mkBatch(gHumanoid, tMatGround, 50); // HUMANOID = 6
  
  (window as any).camActiveMesh = mkBatch(gCamera, tMatCamActive, 50);
  (window as any).camDeadMesh = mkBatch(gCamera, tMatCamDead, 50);

  // Allocate instances once
  for(let i=0; i<7; i++) {
     for(let j=0; j<50; j++) {
        (window as any).droneMeshes[i].addInstance(0); // init 50 times
     }
  }
  for(let j=0; j<50; j++) {
    (window as any).camActiveMesh.addInstance(0);
    (window as any).camDeadMesh.addInstance(0);
  }

  const maxLasers = 64;
`;

code = code.replace(/const groundGeom = new THREE\.CylinderGeometry[\s\S]*?const maxLasers = 64;/, newGeometriesCode);

fs.writeFileSync('client/main.ts', code);
console.log('patched geometries');
