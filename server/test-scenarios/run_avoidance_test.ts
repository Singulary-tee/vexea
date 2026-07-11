import { MatchRoom } from '../MatchRoom';
import { DroneType, DroneState } from '../../shared/constants';
import RAPIER from "@dimforge/rapier3d-compat";

async function runTest() {
   await RAPIER.init();
   const room = new MatchRoom("test-room", undefined, "map_1_facility");

   console.log("[TEST INITIALIZED] Map loaded and physics initialized.");

   // Spawn a drone (e.g. ROTARY_SHOOTER is an Air drone) near building B01 (X bounds: [30, 50], Z bounds: [190, 210])
   room.registerDeveloperSpawner(DroneType.ROTARY_SHOOTER, { x: 15, y: 5, z: 200 });
   const d = room.drones.find(x => x.state !== DroneState.DEAD)!;

   // Point it directly towards building B01 by setting its zone to warehouse and state to PATROLLING
   d.zone = "zone_warehouse";
   d.state = DroneState.PATROLLING;

   // Force the current heading and velocity to point directly in that direction
   d.currentHeadingX = 1;
   d.currentHeadingZ = 0;
   d.currentVelocityX = 5.0;
   d.currentVelocityY = 0;
   d.currentVelocityZ = 0;

   console.log(`[TEST STARTING] Drone ID: ${d.id}, Type: ${DroneType[d.type]}, Pos: (${d.posX.toFixed(1)}, ${d.posY.toFixed(1)}, ${d.posZ.toFixed(1)}), Target: (${d.targetX}, ${d.targetY}, ${d.targetZ})`);

   // Print all colliders in rapierWorld
   console.log("[COLLIDERS IN WORLD]");
   room.rapierWorld.forEachCollider((collider) => {
      const trans = collider.translation();
      const type = collider.shapeType();
      let extentsStr = "";
      try {
         // Try to get details depending on shape
         const shape: any = collider.shape;
         if (shape) {
            extentsStr = `halfExtents: ${JSON.stringify((shape as any).halfExtents)}`;
         }
      } catch (e) {}
      console.log(` - Collider shape: ${type}, translation: (${trans.x}, ${trans.y}, ${trans.z}) ${extentsStr}`);
   });

   // Print QueryFilterFlags and check different raycast configurations
   console.log("RAPIER.QueryFilterFlags:", RAPIER.QueryFilterFlags);

   // Step the rapierWorld once to build the collision/query pipelines!
   room.rapierWorld.step();

   // Debug Raycast from outside the drone's collider
   const testRay = new RAPIER.Ray({ x: 16, y: 5.5, z: 200 }, { x: 1, y: 0, z: 0 });
   console.log("testRay origin:", testRay.origin, "dir:", testRay.dir);
   const testHit1 = room.rapierWorld.castRay(testRay, 50, true);
   const testHit2 = room.rapierWorld.castRay(testRay, 50, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
   const testHit3 = room.rapierWorld.castRay(testRay, 50, true, undefined, undefined, undefined, undefined, undefined);

   console.log("[DEBUG RAYCAST 1 (no flags)]", testHit1 ? `HIT at distance ${testHit1.timeOfImpact}` : "NO HIT");
   console.log("[DEBUG RAYCAST 2 (EXCLUDE_DYNAMIC)]", testHit2 ? `HIT at distance ${testHit2.timeOfImpact}` : "NO HIT");
   console.log("[DEBUG RAYCAST 3 (all undefined)]", testHit3 ? `HIT at distance ${testHit3.timeOfImpact}` : "NO HIT");

   // Update physics loop step by step and watch the avoidance kick in!
   for (let tick = 1; tick <= 50; tick++) {
      room.serverTick = tick;
      room.rapierWorld.step();
      (room as any).updateSystemEntities();

      console.log(`[TICK ${tick}] Drone ID: ${d.id} | Pos: (${d.posX.toFixed(2)}, ${d.posY.toFixed(2)}, ${d.posZ.toFixed(2)}) | Vel: (${d.currentVelocityX?.toFixed(2)}, ${d.currentVelocityY?.toFixed(2)}, ${d.currentVelocityZ?.toFixed(2)}) | AvoidState: ${d.avoidanceState ? `Active (${d.avoidanceState.direction === -1 ? "LEFT" : "RIGHT"}, ticks: ${d.avoidanceState.ticksRemaining})` : "Inactive"}`);
   }

   console.log("[TEST COMPLETED] All ticks processed.");
   process.exit(0);
}

runTest().catch((err) => {
   console.error("[TEST ERROR]", err);
   process.exit(1);
});
