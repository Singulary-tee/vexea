import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MapRegistryEntry } from '../../../shared/maps/map-registry';
import { getCachedOrFetchUrl, blobUrlMap } from '../../asset-cache';
import { texture, uv, normalMap, uniform, parallaxUV } from 'three/tsl';
import { getSettings } from '../../settings';
import { DS } from '../../design-system';

export interface MapSpec {
  id: string;
  version: string;
  displayName: string;
  worldSize: { x: number; z: number };
  zones: any[];
  buildings: any[];
  spawnPoints: any[];
  restrictedGates: any[];
  objective: any;
  props?: { cameras?: any[] };
}

export class MapLoader {
  private spec: MapSpec | null = null;
  private loadedAssets: Map<string, THREE.Group> = new Map();
  private scene: THREE.Scene;
  private mergedMeshes: THREE.Mesh[] = [];
  private centerpieceFlickerTime: number = 0;
  private centerpieceDisc: THREE.Mesh | null = null;
  private sceneAddCallCount: number = 0;
  private concreteWallMat: THREE.MeshStandardMaterial | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  async load(mapEntry: MapRegistryEntry): Promise<void> {
    if (!mapEntry.specFile) return;

    try {
      const resp = await fetch('/' + mapEntry.specFile);
      this.spec = await resp.json() as MapSpec;
    } catch (e) {
      console.error('Failed to load map spec:', e);
      return;
    }

    if (!this.spec) return;

    const uniqueMeshes = new Set<string>();
    this.spec.buildings.forEach(b => {
      if (b.meshFile && b.meshType !== 'TYPE_CENTERPIECE') uniqueMeshes.add(b.meshFile);
    });
    if (this.spec.props?.cameras) {
      this.spec.props.cameras.forEach(c => {
        if (c.meshFile) uniqueMeshes.add(c.meshFile);
      });
    }

    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      const baseName = url.substring(url.lastIndexOf("/") + 1);
      if (blobUrlMap.has(baseName)) {
        return blobUrlMap.get(baseName)!;
      }
      return url;
    });

    const loader = new GLTFLoader(manager);
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    loader.setDRACOLoader(dracoLoader);

    let loaded = 0;
    const total = uniqueMeshes.size;

    const assetDir = mapEntry.assetDirectory || '';
    let browserDir = assetDir;
    if (browserDir.startsWith('client/public/')) {
      browserDir = '/' + browserDir.substring('client/public/'.length);
    }

    const loadPromises = Array.from(uniqueMeshes).map(async (meshFile) => {
      const fullUrl = browserDir + meshFile;
      let cachedUrl = fullUrl;
      try {
        cachedUrl = await getCachedOrFetchUrl(fullUrl, 'Asset');
      } catch (e) {
        console.warn(`[MapLoader] Cache routing failed, falling back:`, e);
      }

      return new Promise<void>((resolve, reject) => {
        loader.load(
          cachedUrl,
          (gltf) => {
            this.loadedAssets.set(meshFile, gltf.scene);
            loaded++;
            window.dispatchEvent(new CustomEvent('map_load_progress', { detail: { loaded, total } }));
            resolve();
          },
          undefined,
          (err) => {
            console.error('Failed to load ' + meshFile, err);
            resolve(); // Resolve anyway to avoid breaking Promise.all
          }
        );
      });
    });

    await Promise.all(loadPromises);
  }

  async buildScene(): Promise<void> {
    this.sceneAddCallCount = 0;
    if (!this.spec) return;
    console.log('[MAP DEBUG] buildScene called with spec:', JSON.stringify(this.spec).slice(0, 200));

    await this.setupEnvironment();

    const zoneGeometries: Map<string, { geom: THREE.BufferGeometry, mat: THREE.Material }[]> = new Map();

    const addMeshToZone = (zoneId: string, mesh: THREE.Mesh) => {
        if (!zoneGeometries.has(zoneId)) zoneGeometries.set(zoneId, []);
        
        // Clone geometry and apply world matrix to bake transformations
        const bGeom = mesh.geometry.clone();
        bGeom.applyMatrix4(mesh.matrixWorld);
        
        if (!bGeom.attributes.uv) {
            const count = bGeom.attributes.position.count;
            bGeom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
        }
        if (!bGeom.attributes.normal) {
            bGeom.computeVertexNormals();
        }
        
        // Ensure standard attributes only, or match them. For simple merging we drop morph targets etc if any.
        zoneGeometries.get(zoneId)!.push({ geom: bGeom, mat: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material });
    };

    const traverseAndCollect = (group: THREE.Group, zoneId: string) => {
        group.updateMatrixWorld(true);
        group.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                addMeshToZone(zoneId, child);
            }
        });
    };

    for (const b of this.spec.buildings) {
      if (b.meshType === 'TYPE_CENTERPIECE') {
        const cp = this.buildCenterpiece();
        cp.position.set(b.position.x, b.position.y, b.position.z);
        // Note: Blueprint X=x, Y=z, Z=y typically, but map spec uses x/y/z directly as THREE coordinates.
        // wait, the config coordinateSystem note says: "Blueprint X maps to Three.js X. Blueprint Y maps to Three.js Z. Elevation maps to Three.js Y. Z=0 is ground level"
        // But the spec JSON has y=0 and z=tunnels/depth. Wait, the spec has 'y' as elevation. e.g. position: x:40, y:0, z:200.
        cp.rotation.y = b.rotation.y ? b.rotation.y * Math.PI / 180 : 0;
        this.scene.add(cp);
        this.mergedMeshes.push(cp as any);
      } else if (b.meshFile && this.loadedAssets.has(b.meshFile)) {
        const asset = this.loadedAssets.get(b.meshFile)!;
        const clone = asset.clone();
        
        clone.position.set(b.position.x, b.position.y, b.position.z);
        if (b.rotation) {
          clone.rotation.set(
            b.rotation.x ? b.rotation.x * Math.PI / 180 : 0,
            b.rotation.y ? b.rotation.y * Math.PI / 180 : 0,
            b.rotation.z ? b.rotation.z * Math.PI / 180 : 0
          );
        }
        if (b.scale) {
          clone.scale.set(b.scale.x, b.scale.y, b.scale.z);
        }

        traverseAndCollect(clone, b.zone || 'default');
      }
    }

    // Merge static geometries per zone
    zoneGeometries.forEach((geoms, zoneId) => {
      // Group by material uuid to safely merge
      const matGroups = new Map<string, {geoms: THREE.BufferGeometry[], mat: THREE.Material}>();
      for (const g of geoms) {
          const matId = g.mat.uuid;
          if (!matGroups.has(matId)) matGroups.set(matId, { geoms: [], mat: g.mat });
          matGroups.get(matId)!.geoms.push(g.geom);
      }

      matGroups.forEach((group) => {
          if (group.geoms.length === 0) return;
          try {
              const mergedGeom = BufferGeometryUtils.mergeGeometries(group.geoms, false);
              if (mergedGeom) {
                  const mesh = new THREE.Mesh(mergedGeom, group.mat);
                  // Spec: "The entire group casts no shadows — shadow maps are disabled"
                  mesh.castShadow = false;
                  mesh.receiveShadow = false;
                  this.mergedMeshes.push(mesh);
                  this.scene.add(mesh);
                  this.sceneAddCallCount++;
              } else {
                  console.warn(`[MAP DEBUG] Failed to merge geometry for zone ${zoneId}: BufferGeometryUtils.mergeGeometries returned null for a group of ${group.geoms.length} geometries.`);
              }
          } catch(e) {
              console.error("Failed to merge geometry for zone", zoneId, e);
          }
      });
    });

    // Add CollisionMap exact representation
    if (this.spec && Array.isArray(this.spec.buildings)) {
      for (const b of this.spec.buildings) {
        if (b && b.position && b.size) {
          const angleRad = b.rotation && b.rotation.y ? (b.rotation.y * Math.PI) / 180 : 0;
          let sizeX = b.size.x || 10;
          let sizeZ = b.size.z || 10;
          if (Math.abs(Math.sin(angleRad)) > 0.707) {
            const temp = sizeX;
            sizeX = sizeZ;
            sizeZ = temp;
          }
          const halfX = sizeX / 2;
          const halfY = (b.size.y || 10) / 2;
          const halfZ = sizeZ / 2;

          const cx = b.position.x;
          const cy = b.position.y + halfY;
          const cz = b.position.z;

          const box3 = new THREE.Box3(
            new THREE.Vector3(cx - halfX, cy - halfY, cz - halfZ),
            new THREE.Vector3(cx + halfX, cy + halfY, cz + halfZ)
          );

          const boxHelper = new THREE.Box3Helper(box3, new THREE.Color(DS.colors.info));
          this.scene.add(boxHelper);
          this.mergedMeshes.push(boxHelper as any);
          (window as any).buildingColliders = (window as any).buildingColliders || [];
          (window as any).buildingColliders.push(boxHelper);
          boxHelper.visible = (window as any).GlobalState?.visDiag?.colliders || false;
        }
      }
    }

    console.log('[MAP DEBUG] Scene build complete. Zones merged:', this.mergedMeshes.length, 'Total draw calls added:', this.sceneAddCallCount);
  }

  async setupEnvironment(): Promise<void> {
    if (!this.spec) return;

    // Ground plane: a single large flat plane covering the full 768x768 world size.
    // We use the asphalt_02 PBR texture set to fit the facility vibe.
    const textureLoader = new THREE.TextureLoader();
    let diffUrl = '';
    let normUrl = '';
    let armUrl = '';
    let skyboxUrl = '';
    let wallDiffUrl = '';
    let wallNormUrl = '';
    let wallArmUrl = '';
    try {
      diffUrl = await getCachedOrFetchUrl('asphalt_02_diff_1k.jpg', 'Asset');
      normUrl = await getCachedOrFetchUrl('asphalt_02_nor_gl_1k.jpg', 'Asset');
      armUrl = await getCachedOrFetchUrl('asphalt_02_arm_1k.jpg', 'Asset');
      skyboxUrl = await getCachedOrFetchUrl('qwantani_dusk_2_puresky_4k.hdr', 'Asset');
      
      wallDiffUrl = await getCachedOrFetchUrl('concrete_tiles_02_diff_1k.jpg', 'Asset');
      wallNormUrl = await getCachedOrFetchUrl('concrete_tiles_02_nor_gl_1k.jpg', 'Asset');
      wallArmUrl = await getCachedOrFetchUrl('concrete_tiles_02_arm_1k.jpg', 'Asset');
    } catch (e) {
      console.warn('Failed to load environment textures from cache', e);
      return;
    }

    const albedo = textureLoader.load(diffUrl);
    const normal = textureLoader.load(normUrl);
    const arm = textureLoader.load(armUrl);

    albedo.colorSpace = THREE.SRGBColorSpace;
    [albedo, normal, arm].forEach(tex => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(80, 80);
    });

    const isWebGPU = (window as any).isWebGPU;
    const s = (window as any).vexeaSettings || getSettings();

    // 1. Concrete Wall Material
    if (wallDiffUrl) {
      const wallAlbedo = textureLoader.load(wallDiffUrl);
      const wallNormal = textureLoader.load(wallNormUrl);
      const wallArm = textureLoader.load(wallArmUrl);
      
      wallAlbedo.colorSpace = THREE.SRGBColorSpace;
      [wallAlbedo, wallNormal, wallArm].forEach(tex => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 4);
      });

      if (isWebGPU) {
        const wallNodeMat = new THREE.MeshStandardNodeMaterial();
        const pbrNormalScale = uniform(s.pbrMaterials ? 1.0 : 0.0);
        const pomScale = uniform(s.parallaxOcclusion ? 0.025 : 0.0);

        (window as any).vexGraphicsUniforms = (window as any).vexGraphicsUniforms || {};
        (window as any).vexGraphicsUniforms.wallPbrNormalScale = pbrNormalScale;
        (window as any).vexGraphicsUniforms.wallPomScale = pomScale;

        const wallUV = uv().mul(4.0);
        const pUV = parallaxUV(wallUV, pomScale.mul(texture(wallArm, wallUV).g));

        wallNodeMat.colorNode = texture(wallAlbedo, pUV);
        wallNodeMat.normalNode = normalMap(texture(wallNormal, pUV), pbrNormalScale);
        wallNodeMat.roughnessNode = texture(wallArm, pUV).g;
        wallNodeMat.metalnessNode = texture(wallArm, pUV).b.mul(0.1);
        wallNodeMat.aoNode = texture(wallArm, pUV).r;

        this.concreteWallMat = wallNodeMat as any;
      } else {
        this.concreteWallMat = new THREE.MeshStandardMaterial({
          map: wallAlbedo,
          normalMap: wallNormal,
          roughnessMap: wallArm,
          aoMap: wallArm,
          metalnessMap: wallArm,
          metalness: 0.1,
          roughness: 0.7
        });
      }
    } else {
      this.concreteWallMat = new THREE.MeshStandardMaterial({
        color: 0x768192,
        roughness: 0.8,
        metalness: 0.1
      });
    }

    // 2. Ground Material
    let groundMat;
    if (isWebGPU) {
      const groundNodeMat = new THREE.MeshStandardNodeMaterial();
      const pbrNormalScale = uniform(s.pbrMaterials ? 1.0 : 0.0);
      const pomScale = uniform(s.parallaxOcclusion ? 0.025 : 0.0);

      (window as any).vexGraphicsUniforms = (window as any).vexGraphicsUniforms || {};
      (window as any).vexGraphicsUniforms.pomScale = pomScale;
      (window as any).vexGraphicsUniforms.pbrNormalScale = pbrNormalScale;

      const groundUV = uv().mul(80.0);
      const pUV = parallaxUV(groundUV, pomScale.mul(texture(arm, groundUV).g));

      groundNodeMat.colorNode = texture(albedo, pUV);
      groundNodeMat.normalNode = normalMap(texture(normal, pUV), pbrNormalScale);
      groundNodeMat.roughnessNode = texture(arm, pUV).g;
      groundNodeMat.metalnessNode = texture(arm, pUV).b;
      groundNodeMat.aoNode = texture(arm, pUV).r;

      groundMat = groundNodeMat as any;
    } else {
      groundMat = new THREE.MeshStandardMaterial({
        map: albedo,
        normalMap: normal,
        roughnessMap: arm,
        aoMap: arm,
        metalnessMap: arm,
        metalness: 1.0,
        roughness: 1.0
      });
    }

    const { x: wX, z: wZ } = this.spec.worldSize;
    const groundGeom = new THREE.PlaneGeometry(wX, wZ);
    groundGeom.rotateX(-Math.PI / 2);
    const groundMesh = new THREE.Mesh(groundGeom, groundMat);
    // Center at world center (wX/2, wZ/2) instead of origin
    groundMesh.position.set(wX / 2, 0, wZ / 2);
    groundMesh.castShadow = false;
    groundMesh.receiveShadow = false;
    this.scene.add(groundMesh);
    this.mergedMeshes.push(groundMesh);

    // HDR skybox
    const rgbeLoader = new HDRLoader();
    rgbeLoader.load(skyboxUrl, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.background = texture;
      this.scene.environment = texture;
      
      const fogNear = 80;
      const fogFar = 400;
      this.scene.fog = new THREE.Fog(0x8899aa, fogNear, fogFar);
      
      // Clear WebGPU specific fogNode if it was set
      if ((this.scene as any).fogNode) {
          (this.scene as any).fogNode = null;
      }
      
      console.log('[ENV DEBUG] Environment setup complete. Skybox loaded: true', 'Fog near/far:', fogNear, fogFar);
    });

    // Ambient + directional light simulating dusk HDR
    const ambient = new THREE.AmbientLight(0xE8E8E8, 0.4);
    this.scene.add(ambient);
    this.mergedMeshes.push(ambient as any);
    const dirLight = new THREE.DirectionalLight(0xffddbb, 0.6);
    dirLight.position.set(100, 200, 50); 
    this.scene.add(dirLight);
    this.mergedMeshes.push(dirLight as any);
  }

  private buildCenterpiece(): THREE.Group {
    const group = new THREE.Group();
    
    // Base 80x24x80 dark concrete #1a1a1a
    const baseGeom = new THREE.BoxGeometry(80, 24, 80);
    // Move base up so bottom is at y=0 (height is 24, center is y=12)
    baseGeom.translate(0, 12, 0);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.1 });
    const baseMesh = new THREE.Mesh(baseGeom, baseMat);
    group.add(baseMesh);

    // 3 server tower columns, 8x20x8 #0d0d0d emissive #FF4500
    const towerGeom = new THREE.BoxGeometry(8, 20, 8);
    towerGeom.translate(0, 10, 0); // Center above base
    const towerMat = new THREE.MeshStandardMaterial({ 
        color: 0x0A0A0A, 
        emissive: DS.colors.accent, 
        emissiveIntensity: 0.3,
        roughness: 0.7
    });

    const tower1 = new THREE.Mesh(towerGeom, towerMat);
    tower1.position.set(0, 24, 0); // Center column
    group.add(tower1);
    
    const tower2 = new THREE.Mesh(towerGeom, towerMat);
    tower2.position.set(-20, 24, 20); // Side column
    group.add(tower2);

    const tower3 = new THREE.Mesh(towerGeom, towerMat);
    tower3.position.set(20, 24, -20); // Side column
    group.add(tower3);

    // Flat disc geometry 6 diameter
    const discGeom = new THREE.CylinderGeometry(3, 3, 0.5, 32);
    const discMat = new THREE.MeshStandardMaterial({
        color: 0xE8E8E8,
        emissive: 0xE8E8E8,
        emissiveIntensity: 1.0
    });
    this.centerpieceDisc = new THREE.Mesh(discGeom, discMat);
    this.centerpieceDisc.position.set(0, 24 + 20 + 2, 0);
    
    // Face forward
    this.centerpieceDisc.rotation.x = Math.PI / 2;
    group.add(this.centerpieceDisc);

    return group;
  }

  placeProps(): void {
    if (!this.spec?.props?.cameras) return;

    for (const prop of this.spec.props.cameras) {
      if (prop.meshFile && this.loadedAssets.has(prop.meshFile)) {
        const asset = this.loadedAssets.get(prop.meshFile)!;
        const clone = asset.clone();
        clone.position.set(prop.position.x, prop.position.y, prop.position.z);
        if (prop.rotation) {
          clone.rotation.set(
            prop.rotation.x ? prop.rotation.x * Math.PI / 180 : 0,
            prop.rotation.y ? prop.rotation.y * Math.PI / 180 : 0,
            prop.rotation.z ? prop.rotation.z * Math.PI / 180 : 0
          );
        }
        if (prop.scale) {
          clone.scale.set(prop.scale.x, prop.scale.y, prop.scale.z);
        } else {
          clone.scale.set(1, 1, 1);
        }
        this.mergedMeshes.push(clone as any as THREE.Mesh); // Track to dispose
        this.scene.add(clone);
        this.sceneAddCallCount++;
      }
    }
  }

  update(deltaTime: number) {
      if (this.centerpieceDisc) {
          this.centerpieceFlickerTime += deltaTime;
          const mat = this.centerpieceDisc.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 0.5 + 0.5 * Math.sin(this.centerpieceFlickerTime * 5.0);
      }
  }

  dispose(): void {
    for (const mesh of this.mergedMeshes) {
      this.scene.remove(mesh);
      mesh.traverse((child: any) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m: any) => m.dispose());
          } else if (child.material) {
            child.material.dispose();
          }
        }
      });
      if (mesh.geometry) mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else if (mesh.material) {
        mesh.material.dispose();
      }
    }
    this.mergedMeshes = [];
    if (this.centerpieceDisc) {
        this.centerpieceDisc.geometry.dispose();
        (this.centerpieceDisc.material as THREE.Material).dispose();
        this.centerpieceDisc = null;
    }
  }
}
