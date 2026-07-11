import RAPIER from '@dimforge/rapier3d-compat';
import { MatchRoom } from '../MatchRoom.js';
import { DroneType, DroneState } from '../../shared/constants.js';
import { processDroneIntelligence, getMemoryThreeState } from '../ai/DroneIntelligence.js';

async function run() {
  await RAPIER.init();
  process.env.PORT = "3333";
  const room = new MatchRoom('test-room', undefined, 'map_1_facility');
  
  room.matchActive = true;
  room.matchStartTime = Date.now();
  
  const player = room.registerBotPlayer();
  // Player within range and LOS initially
  player.posX = 100; player.posY = 5; player.posZ = 100;
  if (player.body) {
    player.body.setTranslation({ x: 100, y: 5, z: 100 }, true);
  }

  let drone = null;
  for (let i = 0; i < room.drones.length; i++) {
    if (room.drones[i].state === DroneState.DEAD) {
      drone = room.drones[i];
      drone.id = room.nextDroneId++;
      drone.type = DroneType.WHEELED;
      drone.state = DroneState.IDLE;
      drone.posX = 100; drone.posY = 5; drone.posZ = 110; // facing target (100,5,100)
      room.initDronePhysics(drone);
      break;
    }
  }

  if (!drone) {
    console.error("Failed to find and initialize drone");
    return;
  }

  drone.rotX = 0;
  drone.rotY = 1;
  drone.rotZ = 0;
  drone.rotW = 0;
  if (drone.body) {
    drone.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
  }

  console.log("--- STARTING MEMORY DECAY VERIFICATION RUN ---");
  const nowMs = Date.now();

  // Tick 1: Player is in LOS
  console.log("\n[Tick 1] Player is in LOS (10m away)");
  processDroneIntelligence(nowMs, room.drones, room.players, room.rapierWorld, RAPIER, 0.0166);
  
  let record = drone.memoryRecords.find(r => r.entityId === player.id);
  if (record) {
    console.log(`  Confidence: ${record.confidence.toFixed(4)} | Derived State: ${getMemoryThreeState(record.confidence)}`);
  }

  // Move player completely out of sight/range to trigger decay
  player.posX = 500; player.posY = 500; player.posZ = 500;
  if (player.body) {
    player.body.setTranslation({ x: 500, y: 500, z: 500 }, true);
  }

  console.log("\n[Player moved completely out of sight]");
  console.log("Simulating confidence decay tick-by-step (dt = 1.0s):");

  for (let step = 1; step <= 20; step++) {
    processDroneIntelligence(nowMs + step * 1000, room.drones, room.players, room.rapierWorld, RAPIER, 1.0);
    record = drone.memoryRecords.find(r => r.entityId === player.id);
    if (record) {
      console.log(`  After ${step}s: Confidence = ${record.confidence.toFixed(4)} | State = '${getMemoryThreeState(record.confidence)}'`);
    }
  }

  room.shutdown();
}

run().catch(console.error).finally(() => process.exit(0));
