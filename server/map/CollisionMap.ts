interface AABB {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

export class CollisionMap {
  private boxes: AABB[] = [];

  public loadFromSpec(specJson: any) {
    this.boxes = [];
    if (specJson && Array.isArray(specJson.buildings)) {
      for (let i = 0; i < specJson.buildings.length; i++) {
        const b = specJson.buildings[i];
        if (b && b.position && b.size) {
          const angleRad = b.rotation && b.rotation.y ? b.rotation.y * Math.PI / 180 : 0;
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
            yMin: b.position.y - halfY,
            yMax: b.position.y + halfY,
            zMin: b.position.z - halfZ,
            zMax: b.position.z + halfZ
          });
        }
      }
    }
  }

  public rayIntersectsAny(origin: any, dir: any, minTimeOfImpact: number): boolean {
    const origX = origin.x;
    const origY = origin.y;
    const origZ = origin.z;

    const dirX = dir.x;
    const dirY = dir.y;
    const dirZ = dir.z;

    for (let i = 0; i < this.boxes.length; i++) {
      const box = this.boxes[i];
      let tmin = 0.0;
      let tmax = minTimeOfImpact;
      let intersects = true;

      // X slab
      if (Math.abs(dirX) < 1e-6) {
        if (origX < box.xMin || origX > box.xMax) continue;
      } else {
        const ood = 1.0 / dirX;
        let t1 = (box.xMin - origX) * ood;
        let t2 = (box.xMax - origX) * ood;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      // Y slab
      if (Math.abs(dirY) < 1e-6) {
        if (origY < box.yMin || origY > box.yMax) continue;
      } else {
        const ood = 1.0 / dirY;
        let t1 = (box.yMin - origY) * ood;
        let t2 = (box.yMax - origY) * ood;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      // Z slab
      if (Math.abs(dirZ) < 1e-6) {
        if (origZ < box.zMin || origZ > box.zMax) continue;
      } else {
        const ood = 1.0 / dirZ;
        let t1 = (box.zMin - origZ) * ood;
        let t2 = (box.zMax - origZ) * ood;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (intersects) {
        return true;
      }
    }

    return false;
  }
}
