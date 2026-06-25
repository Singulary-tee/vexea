import { test, expect } from '@playwright/test';
import { io } from 'socket.io-client';

test('Drone-vs-Building Collision', async () => {
  test.setTimeout(15000);
  
  const socket = io('http://127.0.0.1:3000', { transports: ['websocket'] });
  
  await new Promise<void>((resolve) => {
    socket.on('connect', () => {
      resolve();
    });
  });

  socket.emit('start_match', { 
    uid: 'test_drone_tester',
    matchId: 'test_match_drone',
    mapId: 'map_1_facility'
  });

  await new Promise(r => setTimeout(r, 1000));

  console.log('Requesting initial state');
  let state: any = await new Promise((resolve) => {
    socket.once('debug_state_response', resolve);
    socket.emit('debug_get_state', {});
  });
  console.log('Got initial state');

  const buildings = state.buildings;
  if (!buildings || buildings.length === 0) {
    throw new Error('No buildings found!');
  }
  
  const building = buildings[0]; 
  const bCenter = {
    x: building.xMin + (building.xMax - building.xMin) / 2,
    y: building.yMin + (building.yMax - building.yMin) / 2,
    z: building.zMin + (building.zMax - building.zMin) / 2
  };
  
  console.log('Target building bounds:', building);
  
  // Spawn a drone aiming at the building, slightly outside its bounds
  socket.emit("dev_spawn_drone", { type: 4, x: bCenter.x, y: bCenter.y + 5, z: building.zMin - 1.5 });
  socket.emit("dev_spawn_drone", { type: 4, x: building.xMin - 1.5, y: bCenter.y + 5, z: bCenter.z });
  
  await new Promise(r => setTimeout(r, 500));
  
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 200));
    
    console.log(`Requesting state for tick ${i}`);
    const tickState: any = await new Promise((resolve) => {
      socket.once('debug_state_response', resolve);
      socket.emit('debug_get_state', {});
    });
    console.log(`Got state for tick ${i}`);
    
    const drones = tickState.drones;
    console.log(`Tick ${i} drones:`, drones.map((d: any) => d.pos));
    
    for (const d of drones) {
      const inside = d.pos.x > building.xMin && d.pos.x < building.xMax &&
                     d.pos.y > building.yMin && d.pos.y < building.yMax &&
                     d.pos.z > building.zMin && d.pos.z < building.zMax;
      console.log(`Drone ${d.id} pos:`, d.pos, `Inside building? ${inside}`);
      expect(inside).toBe(false);
    }
  }

  socket.disconnect();
});
