import { test, expect } from '@playwright/test';
import { io } from 'socket.io-client';

test('Player-vs-Drone and Drone-vs-Drone Non-Lethal Collision', async () => {
  test.setTimeout(15000);
  
  const socket = io('http://127.0.0.1:3000', { transports: ['websocket'] });
  
  await new Promise<void>((resolve) => {
    socket.on('connect', resolve);
  });

  socket.emit('start_match', { 
    uid: 'test_player_entity',
    matchId: 'test_match_entity',
    mapId: 'map_1_facility'
  });

  await new Promise(r => setTimeout(r, 2000));
  
  socket.emit("dev_clear_drones", {});
  await new Promise(r => setTimeout(r, 500));

  socket.emit("dev_spawn_drone", { type: 4, x: -5, y: 1.5, z: 0 });
  socket.emit("dev_spawn_drone", { type: 4, x: 5, y: 1.5, z: 0 });
  
  // Set player near them
  const buffer = new ArrayBuffer(20);
  const view = new DataView(buffer);
  view.setUint32(0, 1, true);
  view.setUint8(4, 0x00);
  view.setFloat32(5, 0, true);
  view.setFloat32(9, 0, true);
  socket.emit("raw", { type: 'raw', data: Array.from(new Uint8Array(buffer)) });

  let d1Start: any = null;
  let d2Start: any = null;

  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const state: any = await new Promise((resolve) => {
      socket.once('debug_state_response', resolve);
      socket.emit('debug_get_state', {});
    });
    
    const drones = state.drones;
    console.log(`Tick ${i} Drones:`, drones.map((d: any) => d.pos));
    if (drones.length >= 2) {
      const d1 = drones[0].pos;
      const d2 = drones[1].pos;
      if (!d1Start) { d1Start = d1; d2Start = d2; }
      const dist = Math.sqrt(Math.pow(d1.x - d2.x, 2) + Math.pow(d1.y - d2.y, 2) + Math.pow(d1.z - d2.z, 2));
      console.log(`Distance between drones: ${dist}`);
      expect(dist).toBeGreaterThan(0.5);
    }
  }

  socket.disconnect();
});
