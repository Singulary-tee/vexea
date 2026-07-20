import RAPIER from '@dimforge/rapier3d-compat';
import { MatchRoom } from '../MatchRoom.js';
import { DroneType, DroneState } from '../../shared/constants.js';
import { processDroneIntelligence } from '../ai/DroneIntelligence.js';

export async function runAllTests() {
  await RAPIER.init();
  process.env.PORT = "3333";
  const room = new MatchRoom('diagnostic-room', undefined, 'map_1_facility');
  room.matchActive = true;
  room.matchStartTime = Date.now();

  console.log("=================================================");
  console.log("   DRONE SYSTEMS TEST SUITE (T1-T7) STARTING   ");
  console.log("=================================================\n");

  const results: any[] = [];

  // =========================================================================
  // T1: SIGHT PERCEPTION RANGE TEST
  // =========================================================================
  {
    console.log("--- T1: Sight Perception Range ---");
    const player = room.registerBotPlayer();
    player.id = "player_t1";
    player.posX = 100; player.posY = 5; player.posZ = 100;
    if (player.body) {
      player.body.setTranslation({ x: 100, y: 5, z: 100 }, true);
    }

    // Spawn frozen drone at (100, 5, 100 + d)
    room.registerDeveloperSpawner(DroneType.ROTARY_SHOOTER, { x: 100, y: 5, z: 110 });
    const drone = room.drones.find(x => x.state !== DroneState.DEAD && x.type === DroneType.ROTARY_SHOOTER)!;
    (drone as any).isFrozen = true;
    
    // Face directly towards player at +Z => yaw = 0 (rotY=0, rotW=1)
    drone.rotX = 0; drone.rotY = 0; drone.rotZ = 0; drone.rotW = 1;
    if (drone.body) {
      drone.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }

    let maxDetectedDistance = 0;
    // Step backwards in 5m increments up to 50m
    for (let dist = 5; dist <= 50; dist += 5) {
      player.posX = 100; player.posY = 5; player.posZ = 100 + dist;
      if (player.body) {
        player.body.setTranslation({ x: 100, y: 5, z: 100 + dist }, true);
      }
      drone.posX = 100; drone.posY = 5; drone.posZ = 100;
      if (drone.body) {
        drone.body.setTranslation({ x: 100, y: 5, z: 100 }, true);
      }

      // Reset memory record
      drone.memoryRecords = [];

      // Run 1 tick
      processDroneIntelligence(Date.now(), room.drones, room.players, room.rapierWorld, RAPIER, 0.0166, room.collisionMap);

      const record = drone.memoryRecords.find(r => r.entityId === player.id);
      if (record && record.confidence > 0) {
        maxDetectedDistance = dist;
      }
    }

    const expectedRadius = 30.0; // ROTARY_SHOOTER detectionRadius
    const delta = Math.abs(maxDetectedDistance - expectedRadius);
    const pass = maxDetectedDistance > 0 && delta <= 5.0;
    
    console.log(`> Max Detected Distance: ${maxDetectedDistance}m (Expected Config: ${expectedRadius}m)`);
    console.log(`> Delta: ${delta}m`);
    console.log(`> Result: ${pass ? "PASS" : "FAIL"}\n`);
    results.push({ id: "T1", name: "Sight Perception Range", status: pass ? "PASS" : "FAIL", details: `Max dist: ${maxDetectedDistance}m, expected: ${expectedRadius}m, delta: ${delta}m` });

    // Clean up
    room.despawnDrone(drone);
    room.players.delete(player.id);
  }

  // =========================================================================
  // T2: SIGHT PERCEPTION FOV TEST
  // =========================================================================
  {
    console.log("--- T2: Sight Perception FOV ---");
    const player = room.registerBotPlayer();
    player.id = "player_t2";

    room.registerDeveloperSpawner(DroneType.ROTARY_SHOOTER, { x: 100, y: 5, z: 100 });
    const drone = room.drones.find(x => x.state !== DroneState.DEAD && x.type === DroneType.ROTARY_SHOOTER)!;
    (drone as any).isFrozen = true;
    
    // Face directly along Z-axis (forward is +Z, angle = 0) => rotY = 0, rotW = 1
    drone.rotX = 0; drone.rotY = 0; drone.rotZ = 0; drone.rotW = 1;
    if (drone.body) {
      drone.body.setTranslation({ x: 100, y: 5, z: 100 }, true);
      drone.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }

    let maxDetectedAngleRad = 0;
    const testRange = 10.0; // 10m away

    // Sweep player angle from 0 to 90 degrees in 5-degree steps
    for (let deg = 0; deg <= 90; deg += 5) {
      const rad = deg * Math.PI / 180;
      // Position player on arc around the drone (which looks along +Z)
      player.posX = 100 + testRange * Math.sin(rad);
      player.posY = 5;
      player.posZ = 100 + testRange * Math.cos(rad);
      if (player.body) {
        player.body.setTranslation({ x: player.posX, y: 5, z: player.posZ }, true);
      }

      drone.memoryRecords = [];
      processDroneIntelligence(Date.now(), room.drones, room.players, room.rapierWorld, RAPIER, 0.0166, room.collisionMap);

      const record = drone.memoryRecords.find(r => r.entityId === player.id);
      if (record && record.confidence > 0) {
        maxDetectedAngleRad = rad;
      }
    }

    const expectedHalfAngleRad = 0.7854; // ROTARY_SHOOTER fovHalfAngle (45 degrees)
    const maxAngleDeg = (maxDetectedAngleRad * 180 / Math.PI);
    const deltaDeg = Math.abs(maxAngleDeg - 45);
    const pass = maxDetectedAngleRad > 0 && deltaDeg <= 5.0;

    console.log(`> Max Detected Angle: ${maxAngleDeg.toFixed(1)}° (Expected Config: 45.0°)`);
    console.log(`> Delta: ${deltaDeg.toFixed(1)}°`);
    console.log(`> Result: ${pass ? "PASS" : "FAIL"}\n`);
    results.push({ id: "T2", name: "Sight Perception FOV", status: pass ? "PASS" : "FAIL", details: `Max angle: ${maxAngleDeg.toFixed(1)}°, expected: 45.0°, delta: ${deltaDeg.toFixed(1)}°` });

    room.despawnDrone(drone);
    room.players.delete(player.id);
  }

  // =========================================================================
  // T3: SIGHT PERCEPTION LOS TEST
  // =========================================================================
  {
    console.log("--- T3: Sight Perception LOS ---");
    const player = room.registerBotPlayer();
    player.id = "player_t3";

    // Setup drone on one side of wall B01 (wall at X = 30)
    // Drone at (15, 5, 200) facing +X (yaw = PI/2, rotY = 0.707, rotW = 0.707)
    room.registerDeveloperSpawner(DroneType.ROTARY_SHOOTER, { x: 15, y: 5, z: 200 });
    const drone = room.drones.find(x => x.state !== DroneState.DEAD && x.type === DroneType.ROTARY_SHOOTER)!;
    (drone as any).isFrozen = true;
    drone.rotX = 0; drone.rotY = 0.7071; drone.rotZ = 0; drone.rotW = 0.7071;
    if (drone.body) {
      drone.body.setTranslation({ x: 15, y: 5, z: 200 }, true);
      drone.body.setRotation({ x: 0, y: 0.7071, z: 0, w: 0.7071 }, true);
    }

    // Step 1: Player behind the wall at (35, 5, 200)
    player.posX = 35; player.posY = 5; player.posZ = 200;
    if (player.body) {
      player.body.setTranslation({ x: 35, y: 5, z: 200 }, true);
    }

    drone.memoryRecords = [];
    processDroneIntelligence(Date.now(), room.drones, room.players, room.rapierWorld, RAPIER, 0.0166, room.collisionMap);
    let record = drone.memoryRecords.find(r => r.entityId === player.id);
    const blockedConf = record ? record.confidence : 0;

    // Step 2: Player moves in front of the wall at (25, 5, 200) (unblocked LOS)
    player.posX = 25; player.posY = 5; player.posZ = 200;
    if (player.body) {
      player.body.setTranslation({ x: 25, y: 5, z: 200 }, true);
    }

    processDroneIntelligence(Date.now(), room.drones, room.players, room.rapierWorld, RAPIER, 0.0166, room.collisionMap);
    record = drone.memoryRecords.find(r => r.entityId === player.id);
    const unblockedConf = record ? record.confidence : 0;

    const pass = blockedConf === 0 && unblockedConf > 0;
    console.log(`> Blocked Confidence: ${blockedConf.toFixed(2)} (Expected: 0.00)`);
    console.log(`> Unblocked Confidence: ${unblockedConf.toFixed(2)} (Expected: >0.00)`);
    console.log(`> Result: ${pass ? "PASS" : "FAIL"}\n`);
    results.push({ id: "T3", name: "Sight Perception LOS", status: pass ? "PASS" : "FAIL", details: `Blocked conf: ${blockedConf.toFixed(2)}, Unblocked conf: ${unblockedConf.toFixed(2)}` });

    room.despawnDrone(drone);
    room.players.delete(player.id);
  }

  // =========================================================================
  // T4: DAMAGE REACTION TEST
  // =========================================================================
  {
    console.log("--- T4: Damage Reaction ---");
    const player = room.registerBotPlayer();
    player.id = "player_t4";
    // Out of sight (70m away)
    player.posX = 15; player.posY = 5; player.posZ = 270;
    if (player.body) {
      player.body.setTranslation({ x: 15, y: 5, z: 270 }, true);
    }

    room.registerDeveloperSpawner(DroneType.ROTARY_SHOOTER, { x: 15, y: 5, z: 200 });
    const drone = room.drones.find(x => x.state !== DroneState.DEAD && x.type === DroneType.ROTARY_SHOOTER)!;
    
    // Mode before
    const modeBefore = drone.mode;

    // Simulate projectile damage hit
    drone.hp -= 10;
    if (!drone.damageLog) drone.damageLog = [];
    drone.damageLog.push({ playerId: player.id, timestamp: Date.now() });

    // Step 1 tick of MatchRoom logic
    room.serverTick++;
    (room as any).updateSystemEntities();

    const modeAfter = drone.mode;
    const targetSet = drone.combatTarget !== null && drone.combatTarget !== undefined;
    const pass = modeAfter === "COMBAT" && targetSet;

    console.log(`> Mode Before: ${modeBefore} | Mode After: ${modeAfter}`);
    console.log(`> Combat Target Set: ${targetSet ? "YES" : "NO"}`);
    console.log(`> Result: ${pass ? "PASS" : "FAIL"}\n`);
    results.push({ id: "T4", name: "Damage Reaction", status: pass ? "PASS" : "FAIL", details: `Mode: ${modeBefore} -> ${modeAfter}, Target Set: ${targetSet ? "YES" : "NO"}` });

    room.despawnDrone(drone);
    room.players.delete(player.id);
  }

  // =========================================================================
  // T5: SOUND REACTION TEST
  // =========================================================================
  {
    console.log("--- T5: Sound Reaction ---");
    const player = room.registerBotPlayer();
    player.id = "player_t5";
    // Place behind wall at X=30, so no LOS
    player.posX = 35; player.posY = 5; player.posZ = 200;
    if (player.body) {
      player.body.setTranslation({ x: 35, y: 5, z: 200 }, true);
    }

    room.registerDeveloperSpawner(DroneType.ROTARY_SHOOTER, { x: 15, y: 5, z: 200 });
    const drone = room.drones.find(x => x.state !== DroneState.DEAD && x.type === DroneType.ROTARY_SHOOTER)!;

    // Simulate firing a gun
    player.firedThisTick = true;

    // Update match entities (which processes sound reaction)
    room.serverTick++;
    (room as any).updateSystemEntities();

    const modeAfter = drone.mode;
    const memoryRecord = drone.memoryRecords.find(r => r.entityId === player.id);
    const hasMemory = memoryRecord !== undefined && memoryRecord.confidence > 0;
    const pass = modeAfter === "COMBAT" && hasMemory;

    console.log(`> Mode After Gunfire: ${modeAfter}`);
    console.log(`> Memory Created: ${hasMemory ? `YES (conf: ${memoryRecord.confidence.toFixed(2)})` : "NO"}`);
    console.log(`> Result: ${pass ? "PASS" : "FAIL"}\n`);
    results.push({ id: "T5", name: "Sound Reaction", status: pass ? "PASS" : "FAIL", details: `Mode: ${modeAfter}, Has Memory: ${hasMemory ? "YES" : "NO"}` });

    room.despawnDrone(drone);
    room.players.delete(player.id);
  }

  // =========================================================================
  // T6: AVOIDANCE DIRECTION-LOCK TEST
  // =========================================================================
  {
    console.log("--- T6: Avoidance Direction-Lock ---");
    // Spawn rotary shooter near building B01 wall
    room.registerDeveloperSpawner(DroneType.ROTARY_SHOOTER, { x: 15, y: 5, z: 200 });
    const drone = room.drones.find(x => x.state !== DroneState.DEAD && x.type === DroneType.ROTARY_SHOOTER)!;

    drone.zone = "zone_warehouse";
    drone.state = DroneState.PATROLLING;
    drone.currentHeadingX = 1;
    drone.currentHeadingZ = 0;
    drone.currentVelocityX = 5.0;
    drone.currentVelocityY = 0;
    drone.currentVelocityZ = 0;

    let previousDirection: number | null = null;
    let flipCount = 0;

    // Run 30 ticks to simulate approach and deflection
    for (let tick = 1; tick <= 30; tick++) {
      room.serverTick++;
      room.rapierWorld.step();
      (room as any).updateSystemEntities();

      if (drone.avoidanceState && drone.avoidanceState.active) {
        const dir = drone.avoidanceState.direction;
        if (previousDirection !== null && previousDirection !== dir) {
          flipCount++;
        }
        previousDirection = dir;
      }
    }

    const pass = flipCount === 0;
    console.log(`> Avoidance Direction Flips: ${flipCount} (Expected: 0)`);
    console.log(`> Result: ${pass ? "PASS" : "FAIL"}\n`);
    results.push({ id: "T6", name: "Avoidance Direction-Lock", status: pass ? "PASS" : "FAIL", details: `Flips: ${flipCount}` });

    room.despawnDrone(drone);
  }

  // =========================================================================
  // T7: STATE MACHINE SYNCHRONIZER TEST
  // =========================================================================
  {
    console.log("--- T7: State Machine Synchronizer ---");
    const player = room.registerBotPlayer();
    player.id = "player_t7";
    player.posX = 100; player.posY = 5; player.posZ = 100;
    if (player.body) {
      player.body.setTranslation({ x: 100, y: 5, z: 100 }, true);
    }

    room.registerDeveloperSpawner(DroneType.ROTARY_SHOOTER, { x: 100, y: 5, z: 110 });
    const drone = room.drones.find(x => x.state !== DroneState.DEAD && x.type === DroneType.ROTARY_SHOOTER)!;
    drone.memoryRecords = [];
    drone.damageLog = [];
    drone.rotX = 0; drone.rotY = 1; drone.rotZ = 0; drone.rotW = 0;
    if (drone.body) {
      drone.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
    }

    // Step 1: Detect player (LOS clear)
    processDroneIntelligence(Date.now(), room.drones, room.players, room.rapierWorld, RAPIER, 0.0166, room.collisionMap);
    let record = drone.memoryRecords.find(r => r.entityId === player.id);
    const initialConf = record ? record.confidence : 0;

    // Step 2: Set mode to COMBAT manually to simulate combat engagement
    drone.mode = "COMBAT";
    drone.combatTarget = record;

    // Step 3: Move player out of sight to trigger decay
    player.posX = 500; player.posY = 500; player.posZ = 500;
    if (player.body) {
      player.body.setTranslation({ x: 500, y: 500, z: 500 }, true);
    }

    // Decay memory for several steps
    const nowMs = Date.now();
    for (let step = 1; step <= 20; step++) {
      processDroneIntelligence(nowMs + step * 1000, room.drones, room.players, room.rapierWorld, RAPIER, 1.0, room.collisionMap);
    }

    record = drone.memoryRecords.find(r => r.entityId === player.id);
    const finalConf = record ? record.confidence : 0;

    // Update match entities once after decay to run state transitions
    room.serverTick++;
    (room as any).updateSystemEntities();

    const modeAfterDecay = drone.mode;
    const targetAfterDecay = drone.combatTarget;

    const pass = finalConf === 0 && modeAfterDecay === "NORMAL" && targetAfterDecay === null;
    console.log(`> Initial Confidence: ${initialConf.toFixed(2)}`);
    console.log(`> Final Confidence After Decay: ${finalConf.toFixed(2)}`);
    console.log(`> Mode After Decay: ${modeAfterDecay} (Expected: NORMAL)`);
    console.log(`> Combat Target After Decay: ${targetAfterDecay ? "STILL SET" : "CLEARED"}`);
    console.log(`> Result: ${pass ? "PASS" : "FAIL"}\n`);
    results.push({ id: "T7", name: "State Machine Synchronizer", status: pass ? "PASS" : "FAIL", details: `Final conf: ${finalConf.toFixed(2)}, Mode after decay: ${modeAfterDecay}, Target after decay: ${targetAfterDecay ? "set" : "cleared"}` });

    room.despawnDrone(drone);
    room.players.delete(player.id);
  }

  // =========================================================================
  // PRINT CONSOLIDATED RESULTS
  // =========================================================================
  console.log("=================================================");
  console.log("             DIAGNOSTICS RESULTS                 ");
  console.log("=================================================");
  console.table(results);
  console.log("=================================================");

  room.shutdown();
  return results;
}

if (typeof process !== "undefined" && process.argv && process.argv[1] && (process.argv[1].includes("run_all_diagnostics") || process.argv[1].includes("run_all_diagnostics.ts"))) {
  runAllTests().catch(console.error).finally(() => process.exit(0));
}
