import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { renderer, scene } from "./main";
import { getCachedOrFetchUrl } from "./asset-cache";

export const setupAreaCorridors = async (mapId: string = 'map_0_dev') => {
  const textureLoader = new THREE.TextureLoader();
  const loadPBR = (albedoUrl: string, normalUrl: string, armUrl: string, repeatX: number, repeatY: number) => {
    const albedo = textureLoader.load(albedoUrl);
    const normal = textureLoader.load(normalUrl);
    const arm = textureLoader.load(armUrl);
    
    albedo.colorSpace = THREE.SRGBColorSpace;

    [albedo, normal, arm].forEach(tex => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
    });
    
    const matParams = {
      map: albedo,
      normalMap: normal,
      roughnessMap: arm,
      aoMap: arm,
      metalnessMap: arm,
      metalness: 1.0,
      roughness: 1.0
    };
    return new THREE.MeshStandardMaterial(matParams);
  };

  // Pre-resolve all textures asynchronously using local cache / CDN fallback
  const [
    asphalt_diff, asphalt_norm, asphalt_arm,
    sidebar_diff, sidebar_norm, sidebar_arm,
    brick_diff, brick_norm, brick_arm,
    rocks_diff, rocks_norm, rocks_arm,
    trail_diff, trail_norm, trail_arm
  ] = await Promise.all([
    getCachedOrFetchUrl('asphalt_02_diff_1k.jpg', 'Asset'),
    getCachedOrFetchUrl('asphalt_02_nor_gl_1k.jpg', 'Asset'),
    getCachedOrFetchUrl('asphalt_02_arm_1k.jpg', 'Asset'),

    getCachedOrFetchUrl('concrete_tiles_02_diff_1k.jpg', 'Asset'),
    getCachedOrFetchUrl('concrete_tiles_02_nor_gl_1k.jpg', 'Asset'),
    getCachedOrFetchUrl('concrete_tiles_02_arm_1k.jpg', 'Asset'),

    getCachedOrFetchUrl('red_brick_03_diff_1k.jpg', 'Asset'),
    getCachedOrFetchUrl('red_brick_03_nor_gl_1k.jpg', 'Asset'),
    getCachedOrFetchUrl('red_brick_03_arm_1k.jpg', 'Asset'),

    getCachedOrFetchUrl('rocks_ground_01_diff_1k.jpg', 'Asset'),
    getCachedOrFetchUrl('rocks_ground_01_nor_gl_1k.jpg', 'Asset'),
    getCachedOrFetchUrl('rocks_ground_01_arm_1k.jpg', 'Asset'),

    getCachedOrFetchUrl('rocky_trail_diff_1k.jpg', 'Asset'),
    getCachedOrFetchUrl('rocky_trail_nor_gl_1k.jpg', 'Asset'),
    getCachedOrFetchUrl('rocky_trail_arm_1k.jpg', 'Asset')
  ]);

  const asphaltMaterial = loadPBR(asphalt_diff, asphalt_norm, asphalt_arm, 10, 100);
  const sidewalkMaterial = loadPBR(sidebar_diff, sidebar_norm, sidebar_arm, 2, 100);
  const brickMaterial = loadPBR(brick_diff, brick_norm, brick_arm, 6, 6);
  const rocksGroundMaterial = loadPBR(rocks_diff, rocks_norm, rocks_arm, 20, 40);
  const rockyTrailMaterial = loadPBR(trail_diff, trail_norm, trail_arm, 20, 40);

  const gltfLoader = new GLTFLoader();
  const mapFile = mapId === 'map_1_facility' ? '/assets/models/map_1_facility.glb' : '/assets/models/map_0_dev.glb';
  gltfLoader.load(mapFile, (gltf) => {
    const mapRoot = gltf.scene;
    mapRoot.traverse((node: any) => {
      if (node.isMesh || node instanceof THREE.Mesh) {
        node.frustumCulled = false;
        const originalMat = node.material;
        node.material = new THREE.MeshBasicMaterial({
          map: originalMat.map,
          color: originalMat.color,
          transparent: originalMat.transparent,
          opacity: originalMat.opacity
        });
      }
    });
    scene.add(mapRoot);
  }, 
  (xhr) => {},
  (error) => {
    // Procedural Fallback Scene - PBR Materials
    
    // 0. The Outer Terrain
    const leftGround = new THREE.Mesh(new THREE.PlaneGeometry(100, 200), rocksGroundMaterial);
    leftGround.rotation.x = -Math.PI / 2;
    leftGround.position.set(-50, -0.05, 0); // slightly below road
    scene.add(leftGround);

    const rightGround = new THREE.Mesh(new THREE.PlaneGeometry(100, 200), rockyTrailMaterial);
    rightGround.rotation.x = -Math.PI / 2;
    rightGround.position.set(50, -0.05, 0); // slightly below road
    scene.add(rightGround);

    // 1. The Ground (Terrain)
    const roadPlane = new THREE.Mesh(new THREE.PlaneGeometry(10, 100), asphaltMaterial);
    roadPlane.rotation.x = -Math.PI / 2; // Rotate flat
    roadPlane.position.y = 0;
    scene.add(roadPlane);

    // 2. The Sidewalks
    const sidewalkLeft = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 100), sidewalkMaterial);
    sidewalkLeft.position.set(-5.5, 0.1, 0);
    scene.add(sidewalkLeft);

    const sidewalkRight = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 100), sidewalkMaterial);
    sidewalkRight.position.set(5.5, 0.1, 0);
    scene.add(sidewalkRight);

    // 3. The Buildings
    const buildingGeom = new THREE.BoxGeometry(5, 20, 15);
    const zPositions = [-40, 0, 40];
    
    zPositions.forEach((z) => {
      const bLeft = new THREE.Mesh(buildingGeom, brickMaterial);
      bLeft.position.set(-8.5, 10, z);
      scene.add(bLeft);

      const bRight = new THREE.Mesh(buildingGeom, brickMaterial);
      bRight.position.set(8.5, 10, z);
      scene.add(bRight);
    });
  });
};
