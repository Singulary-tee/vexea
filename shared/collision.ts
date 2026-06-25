// Zero-GC, highly optimized AABB collision library
export interface AABB {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

export class CollisionSystem {
  public boxes: AABB[] = [];

  public loadFromSpec(specJson: any) {
    this.boxes = [];
    if (specJson && Array.isArray(specJson.buildings)) {
      for (let i = 0; i < specJson.buildings.length; i++) {
        const b = specJson.buildings[i];
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

          this.boxes.push({
            xMin: b.position.x - halfX,
            xMax: b.position.x + halfX,
            yMin: b.position.y,
            yMax: b.position.y + (b.size.y || 10),
            zMin: b.position.z - halfZ,
            zMax: b.position.z + halfZ,
          });
        }
      }
    }
  }

  // Hitscan raycast vs AABB logic (Drones/Players/Walls)
  public rayIntersectsAny(origin: {x: number, y: number, z: number}, dir: {x: number, y: number, z: number}, maxDistance: number): boolean {
    for (let i = 0; i < this.boxes.length; i++) {
      if (this.rayIntersectsAABB(origin, dir, this.boxes[i], maxDistance)) {
        return true;
      }
    }
    return false;
  }

  public rayIntersectsAABB(origin: {x: number, y: number, z: number}, dir: {x: number, y: number, z: number}, box: AABB, maxDistance: number): boolean {
    const oodX = dir.x !== 0 ? 1.0 / dir.x : 0;
    const oodY = dir.y !== 0 ? 1.0 / dir.y : 0;
    const oodZ = dir.z !== 0 ? 1.0 / dir.z : 0;

    let tmin = 0.0;
    let tmax = maxDistance;

    // X
    if (Math.abs(dir.x) < 1e-6) {
      if (origin.x < box.xMin || origin.x > box.xMax) return false;
    } else {
      let t1 = (box.xMin - origin.x) * oodX;
      let t2 = (box.xMax - origin.x) * oodX;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }

    // Y
    if (Math.abs(dir.y) < 1e-6) {
      if (origin.y < box.yMin || origin.y > box.yMax) return false;
    } else {
      let t1 = (box.yMin - origin.y) * oodY;
      let t2 = (box.yMax - origin.y) * oodY;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }

    // Z
    if (Math.abs(dir.z) < 1e-6) {
      if (origin.z < box.zMin || origin.z > box.zMax) return false;
    } else {
      let t1 = (box.zMin - origin.z) * oodZ;
      let t2 = (box.zMax - origin.z) * oodZ;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }

    return true;
  }
}

export const globalCollisionSystem = new CollisionSystem();
