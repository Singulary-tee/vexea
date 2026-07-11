import { MatchRoom } from '../MatchRoom';
import { DroneType, DroneState } from '../../shared/constants';

const room = new MatchRoom();
room.initPhysics().then(() => {
    room.spawnDrone(DroneType.ROTARY_SHOOTER, 0, 10, 0);
    const drone = room.drones[0];
    drone.targetX = 10;
    drone.targetY = 10;
    drone.targetZ = 10;
    drone.state = DroneState.REPOSITIONING;
    console.log("Starting position:", drone.posX, drone.posY, drone.posZ);
    for (let i = 0; i < 10; i++) {
        room.updatePhysics(0.0166);
        console.log(`Tick ${i}: expected KCC output applied to pos:`, drone.posX, drone.posY, drone.posZ);
    }
    process.exit(0);
});
