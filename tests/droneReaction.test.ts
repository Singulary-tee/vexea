import { processDroneIntelligence } from "../server/ai/DroneIntelligence";
import { DroneType, DroneState } from "../shared/constants";
import * as YUKA from "yuka";
import RAPIER from "@dimforge/rapier3d-compat";

async function runTests() {
  console.log("=== COMPREHENSIVE REALISTIC DRONE REACTION TEST ===");
  
  // Initialize Rapier physics engine
  await RAPIER.init();
  const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  // Recreate the real World Floor Boundary from MatchRoom.ts
  const staticBodyDesc = RAPIER.RigidBodyDesc.fixed();
  const staticBody = rapierWorld.createRigidBody(staticBodyDesc);
  const floorDesc = RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(384, -0.5, 384);
  rapierWorld.createCollider(floorDesc, staticBody);

  // Recreate a real static building/wall that blocks the drone's line of sight to the player
  // Placing a wall at (384, 5.85, 394) with size 10x10x10 directly between the drone and the player
  const wallDesc = RAPIER.ColliderDesc.cuboid(5, 5, 5).setTranslation(384, 5.85, 394);
  rapierWorld.createCollider(wallDesc, staticBody);

  // STEP THE RAPIER WORLD to build the collision/query pipeline structures
  rapierWorld.step();

  let testsPassed = 0;
  let testsFailed = 0;

  // Helper to create a standard Rotary Shooter drone for testing
  const createTestDrone = (id: number, x: number, y: number, z: number) => {
    const drone: any = {
      id,
      type: DroneType.ROTARY_SHOOTER,
      state: DroneState.PATROLLING,
      mode: "NORMAL",
      posX: x,
      posY: y,
      posZ: z,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      rotW: 1, // Facing positive Z
      velX: 0,
      velY: 0,
      velZ: 0,
      hp: 100,
      damageLog: [],
      yukaVehicle: new YUKA.Vehicle(),
      yukaMemory: null,
      yukaVision: null,
      yukaTarget: null,
    };
    
    drone.yukaVehicle.maxForce = 20;
    drone.yukaVehicle.maxSpeed = 10;
    drone.yukaMemory = new YUKA.MemorySystem(drone.yukaVehicle);
    drone.yukaMemory.memorySpan = 10;
    drone.yukaVision = new YUKA.Vision(drone.yukaVehicle);
    
    return drone;
  };

  // --- TEST 1: SIGHT REACTION ---
  console.log("\n--- TEST 1: Sight Detection (Player behind a static obstacle) ---");
  const drone1 = createTestDrone(1, 384, 10, 384);
  const player1 = {
    id: "player_sight",
    isAlive: true,
    body: {},
    posX: 384,
    posY: 1.2,
    posZ: 404, // 20m directly in front of drone, but blocked by the wall at 10m (posZ = 394)
    velX: 0,
    velY: 0,
    velZ: 0,
    firedThisTick: false,
  };
  const players1 = new Map([[player1.id, player1]]);

  console.log(`Initial Mode: ${drone1.mode}`);
  processDroneIntelligence(1000, [drone1], players1 as any, rapierWorld, RAPIER);
  console.log(`Mode after sight tick: ${drone1.mode}`);
  
  if (drone1.mode === "COMBAT") {
    console.log("Result: PASS");
    testsPassed++;
  } else {
    console.error("Result: FAIL (Drone stayed in NORMAL mode due to obstacle blocking line of sight)");
    testsFailed++;
  }


  // --- TEST 2: SOUND REACTION ---
  console.log("\n--- TEST 2: Sound Detection (Player behind firing) ---");
  const drone2 = createTestDrone(2, 384, 1.2, 384);
  const player2 = {
    id: "player_sound",
    isAlive: true,
    body: {},
    posX: 384,
    posY: 1.2,
    posZ: 374, // 10m behind drone (outside vision cone)
    velX: 0,
    velY: 0,
    velZ: 0,
    firedThisTick: true, // Player fires weapon
  };
  const players2 = new Map([[player2.id, player2]]);

  // In the real update cycle (MatchRoom.ts lines 1738-1743), player.firedThisTick is cleared to false 
  // BEFORE processDroneIntelligence (line 1776) is called. We replicate this exact game-loop sequence.
  console.log("Simulating real game loop sequence (clearing player.firedThisTick before processing AI)...");
  player2.firedThisTick = false; 

  console.log(`Initial Mode: ${drone2.mode}`);
  processDroneIntelligence(1000, [drone2], players2 as any, rapierWorld, RAPIER);
  console.log(`Mode after sound tick: ${drone2.mode}`);

  if (drone2.mode === "COMBAT") {
    console.log("Result: PASS");
    testsPassed++;
  } else {
    console.error("Result: FAIL (Drone stayed in NORMAL mode because player.firedThisTick was cleared beforehand)");
    testsFailed++;
  }


  // --- TEST 3: DAMAGE REACTION ---
  console.log("\n--- TEST 3: Damage Detection (Player behind drone inflicting damage) ---");
  const drone3 = createTestDrone(3, 384, 1.2, 384);
  const player3 = {
    id: "player_dmg",
    isAlive: true,
    body: {},
    posX: 384,
    posY: 1.2,
    posZ: 369, // 15m behind (not in sight, not firing)
    velX: 0,
    velY: 0,
    velZ: 0,
    firedThisTick: false,
  };
  const players3 = new Map([[player3.id, player3]]);

  // Simulate damage logging on the drone
  console.log("Simulating damage event from player_dmg...");
  drone3.hp -= 20;
  drone3.damageLog.push({
    playerId: "player_dmg",
    timestamp: Date.now()
  });

  console.log(`Initial Mode: ${drone3.mode}, HP: ${drone3.hp}, DamageLog entries: ${drone3.damageLog.length}`);
  processDroneIntelligence(1000, [drone3], players3 as any, rapierWorld, RAPIER);
  console.log(`Mode after damage tick: ${drone3.mode}`);

  if (drone3.mode === "COMBAT") {
    console.log("Result: PASS");
    testsPassed++;
  } else {
    console.error("Result: FAIL (Drone stayed in NORMAL mode because damage-based detection is missing)");
    testsFailed++;
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Tests Passed: ${testsPassed}`);
  console.log(`Tests Failed: ${testsFailed}`);

  if (testsFailed === 3) {
    console.log("\nSUCCESS: Verified that all 3 detection mechanisms fail as expected under actual codebase logic!");
    process.exit(0);
  } else {
    console.error(`\nERROR: Expected exactly 3 failures, but got ${testsFailed} instead.`);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution encountered an error:", err);
  process.exit(1);
});
