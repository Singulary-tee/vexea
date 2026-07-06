import RAPIER from "@dimforge/rapier3d-compat";

export class PhysicsWorldManager {
  public rapierWorld!: RAPIER.World;

  constructor(private specJson: any) {}

  public initPhysics() {
    this.rapierWorld = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });

    // Static body for all fixed geometry
    const staticBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const staticBody = this.rapierWorld.createRigidBody(staticBodyDesc);

    // Map Boundaries
    const wall1Desc = RAPIER.ColliderDesc.cuboid(384, 20, 1).setTranslation(384, 10, 768);
    this.rapierWorld.createCollider(wall1Desc, staticBody);

    const wall2Desc = RAPIER.ColliderDesc.cuboid(384, 20, 1).setTranslation(384, 10, 0);
    this.rapierWorld.createCollider(wall2Desc, staticBody);

    const wall3Desc = RAPIER.ColliderDesc.cuboid(1, 20, 384).setTranslation(768, 10, 384);
    this.rapierWorld.createCollider(wall3Desc, staticBody);

    const wall4Desc = RAPIER.ColliderDesc.cuboid(1, 20, 384).setTranslation(0, 10, 384);
    this.rapierWorld.createCollider(wall4Desc, staticBody);

    // World Floor Boundary
    const floorDesc = RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(384, -0.5, 384);
    this.rapierWorld.createCollider(floorDesc, staticBody);

    // Actual map buildings
    if (this.specJson && this.specJson.buildings) {
      for (const b of this.specJson.buildings) {
        let sizeX = b.size.x || 10;
        let sizeZ = b.size.z || 10;
        const angleRad = b.rotation && b.rotation.y ? (b.rotation.y * Math.PI) / 180 : 0;
        if (Math.abs(Math.sin(angleRad)) > 0.707) {
          const temp = sizeX;
          sizeX = sizeZ;
          sizeZ = temp;
        }
        const halfX = sizeX / 2;
        const halfY = (b.size.y || 10) / 2;
        const halfZ = sizeZ / 2;
        const desc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
          .setTranslation(b.position.x, b.position.y + halfY, b.position.z);
        this.rapierWorld.createCollider(desc, staticBody);
      }
    }
  }
}
