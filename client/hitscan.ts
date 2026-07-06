import * as THREE from "three";
import { spawnEnvironmentDecalAndDust } from "./src/vfx/VFXOrchestrator";

export class HitscanSystem {
  private raycaster = new THREE.Raycaster();
  private targets: THREE.Object3D[] = [];

  constructor() {}

  public performClientHitscan(
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    direction: THREE.Vector3,
    maxFalloffDist: number
  ) {
    this.raycaster.set(camera.position, direction);
    this.raycaster.camera = camera;

    this.targets.length = 0;
    scene.children.forEach(child => {
      // Skip local player weapon models, laser lines, lights, dynamic particle/VFX systems, and floating HUD elements
      if (child.name === "WeaponsContainer" || child.name === "WeaponsGroup" || child.name === "DynamicMuzzle") return;
      if (child.name.includes("VFX") || child.name.includes("Light") || child.name.includes("Helper")) return;
      if (child.name === "floatingUI" || child.type === "Sprite" || child.type === "LineSegments" || child.type === "PointLight" || child.type === "DirectionalLight") return;
      this.targets.push(child);
    });

    const intersects = this.raycaster.intersectObjects(this.targets, true);

    for (let i = 0; i < intersects.length; i++) {
      const hit = intersects[i];
      if (!hit.object.visible) continue;

      // Ignore weapons container entirely, block if RemotePlayer
      let currItems: THREE.Object3D | null = hit.object;
      let isWeapon = false;
      let isPlayer = false;
      while (currItems) {
        if (currItems.name === "WeaponsContainer") {
          isWeapon = true;
          break;
        }
        if (currItems.name === "RemotePlayer") {
          isPlayer = true;
        }
        currItems = currItems.parent;
      }
      if (isWeapon) continue;

      if (hit.object.name === "floatingUI" || hit.object.type === "Sprite") continue;

      // VFX batches and objects are ignored
      if (hit.object.name.includes("VFX")) continue;

      // If we hit a drone or player, we just stop the ray (let the server handle the hit confirmation)
      const isDrone = (hit.object as any).isBatchedMesh && hit.object.name === "DroneBatch";
      if (isDrone || isPlayer) {
        break; // Ray is blocked by entity, so no environment decal is made
      }

      // If we reach here, it's environment geometry!
      const impact = hit.point;
      if (impact.distanceTo(camera.position) < maxFalloffDist * 2.0) {
        spawnEnvironmentDecalAndDust(impact.x, impact.y, impact.z);
      }
      break; // Only process the first valid hit
    }
  }
}

export const hitscanSystem = new HitscanSystem();
