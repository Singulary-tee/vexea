import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MapRegistryEntry } from '../../../shared/maps/map-registry';
import { getCachedOrFetchUrl, blobUrlMap } from '../../asset-cache';

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
    if (!this.spec) return;
    console.log('[MAP DEBUG] buildScene called with spec:', JSON.stringify(this.spec).slice(0, 200));

    const zoneGeometries: Map<string, { geom: THREE.BufferGeometry, mat: THREE.Material }[]> = new Map();

    const addMeshToZone = (zoneId: string, mesh: THREE.Mesh) => {
        if (!zoneGeometries.has(zoneId)) zoneGeometries.set(zoneId, []);
        
        // Clone geometry and apply world matrix to bake transformations
        const bGeom = mesh.geometry.clone();
        bGeom.applyMatrix4(mesh.matrixWorld);
        
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
              }
          } catch(e) {
              console.error("Failed to merge geometry for zone", zoneId, e);
          }
      });
    });

  }

  private buildCenterpiece(): THREE.Group {
    const group = new THREE.Group();
    
    // Base 80x24x80 dark concrete #1a1a1a
    const baseGeom = new THREE.BoxGeometry(80, 24, 80);
    // Move base up so bottom is at y=0 (height is 24, center is y=12)
    baseGeom.translate(0, 12, 0);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, metalness: 0.1 });
    const baseMesh = new THREE.Mesh(baseGeom, baseMat);
    group.add(baseMesh);

    // 3 server tower columns, 8x20x8 #0d0d0d emissive #C8882A
    const towerGeom = new THREE.BoxGeometry(8, 20, 8);
    towerGeom.translate(0, 10, 0); // Center above base
    const towerMat = new THREE.MeshStandardMaterial({ 
        color: 0x0d0d0d, 
        emissive: 0xC8882A, 
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
        color: 0xffffff,
        emissive: 0xffffff,
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
        this.mergedMeshes.push(clone as any as THREE.Mesh); // Track to dispose
        this.scene.add(clone);
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
