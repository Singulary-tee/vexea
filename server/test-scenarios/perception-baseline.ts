import RAPIER from '@dimforge/rapier3d-compat';
import { MatchRoom } from '../MatchRoom.js';
import { DroneType, DroneState } from '../../shared/constants.js';
import { processDroneIntelligence } from '../ai/DroneIntelligence.js';

async function run() {
  await RAPIER.init();
  process.env.PORT = "3333";
  const room = new MatchRoom('test-room', undefined, 'map_1_facility');
  
  room.matchActive = true;
  room.matchStartTime = Date.now();
  
  // Register player at (100, 5, 100)
  const player = room.registerBotPlayer();
  player.posX = 100; player.posY = 5; player.posZ = 100;
  if (player.body) {
    player.body.setTranslation({ x: 100, y: 5, z: 100 }, true);
  }
  player.inputMask = 0; // Stationary
  player.velX = 0; player.velY = 0; player.velZ = 0;

  // Find a dead drone and init as WHEELED at (100, 5, 110)
  let drone = null;
  for (let i = 0; i < room.drones.length; i++) {
    if (room.drones[i].state === DroneState.DEAD) {
      drone = room.drones[i];
      drone.id = room.nextDroneId++;
      drone.type = DroneType.WHEELED;
      drone.state = DroneState.IDLE;
      drone.posX = 100; drone.posY = 5; drone.posZ = 110;
      room.initDronePhysics(drone);
      break;
    }
  }

  if (!drone) {
    console.error("Failed to find and initialize drone");
    return;
  }

  // Ensure stationary and facing player (which is at (100,5,100) from (100,5,110) -> direction is (0, 0, -1))
  // Facing direction (0, 0, -1) is yaw = Math.PI (180 degrees)
  drone.rotX = 0;
  drone.rotY = 1; // sin(pi/2)
  drone.rotZ = 0;
  drone.rotW = 0; // cos(pi/2)
  if (drone.body) {
    drone.body.setTranslation({ x: 100, y: 5, z: 110 }, true);
    drone.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
  }

  // Let's run a single tick manually or step to check perception
  console.log("--- PERCEPTION BASELINE RUN ---");
  console.log("Player position:", { x: player.posX, y: player.posY, z: player.posZ });
  console.log("Drone position:", { x: drone.posX, y: drone.posY, z: drone.posZ });
  console.log("Drone state/mode before:", drone.state, "/", drone.mode);

  // Synchronously call drone intelligence processing
  const nowMs = Date.now();
  processDroneIntelligence(nowMs, room.drones, room.players, room.rapierWorld, RAPIER);

  console.log("Drone state/mode after 1 tick:", drone.state, "/", drone.mode);
  console.log("Drone target identified:", drone.yukaTarget ? "YES" : "NO");
  if (drone.yukaTarget) {
    console.log("  Target confidence:", (drone.yukaTarget as any).confidence);
    console.log("  Target position:", {
      x: drone.yukaTarget.lastSensedPosition.x,
      y: drone.yukaTarget.lastSensedPosition.y,
      z: drone.yukaTarget.lastSensedPosition.z
    });
  }
  
  room.shutdown();
}

run().catch(console.error).finally(() => process.exit(0));
