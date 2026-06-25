import { test, expect } from '@playwright/test';
import { io } from 'socket.io-client';

test('Player-vs-Building Collision', async () => {
  test.setTimeout(60000);
  
  const socket = io('http://127.0.0.1:3000', { transports: ['websocket'] });
  
  await new Promise<void>((resolve) => {
    socket.on('connect', () => {
      console.log('Connected to server');
      resolve();
    });
  });

  // Start match
  socket.emit('start_match', { 
    uid: 'test_player',
    matchId: 'test_match_player',
    mapId: 'map_1_facility'
  });

  await new Promise(r => setTimeout(r, 2000)); // wait for room transfer

  // Get state
  const state: any = await new Promise((resolve) => {
    socket.once('debug_state_response', resolve);
    socket.emit('debug_get_state', {});
  });

  console.log('Players:', state.players);
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
  console.log('Target building center:', bCenter);

  // We want to force the player position, but since we can't easily set pos via client input,
  // we can use a dev event if one exists. Wait, if we just walk, we might not hit the building.
  // Can we just emit dev_set_class or something? No, let's just spawn near the building?
  // We can't set player pos from client easily, except we can just face the building center and walk forward.
  // Let's get the player's initial position.
  const pInitial = state.players.find((p: any) => p.id === 'test_player')?.pos || state.players[0].pos;
  
  // Face building center (z-direction from 180 to 200 is straight forward, yaw = 0)
  const yaw = 0;
  
  let sequence = 1;
  // Hold W for 2 seconds
  const interval = setInterval(() => {
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    view.setUint32(0, sequence++, true);
    view.setUint8(4, 0x01); // 0x01 is MOVE_FORWARD
    view.setFloat32(5, 0, true); // pitch
    view.setFloat32(9, yaw, true); // yaw
    
    socket.emit("raw", { type: 'raw', data: Array.from(new Uint8Array(buffer)) });
  }, 50);

  await new Promise(r => setTimeout(r, 2000));
  clearInterval(interval);
  
  // Stop moving
  const buffer = new ArrayBuffer(20);
  const view = new DataView(buffer);
  view.setUint32(0, sequence++, true);
  view.setUint8(4, 0x00);
  view.setFloat32(5, 0, true);
  view.setFloat32(9, yaw, true);
  socket.emit("raw", { type: 'raw', data: Array.from(new Uint8Array(buffer)) });
  
  await new Promise(r => setTimeout(r, 500));
  
  const finalState: any = await new Promise((resolve) => {
    socket.once('debug_state_response', resolve);
    socket.emit('debug_get_state', {});
  });

  const pFinal = finalState.players.find((p: any) => p.id === 'test_player')?.pos || finalState.players[0].pos;
  console.log('Initial Teleport Pos: { x: 40.0, y: 1.2, z: 180.0 }');
  console.log('Final Pos:', pFinal);

  // AABB Check
  const inside = pFinal && 
                 pFinal.x > building.xMin && pFinal.x < building.xMax &&
                 pFinal.y > building.yMin && pFinal.y < building.yMax &&
                 pFinal.z > building.zMin && pFinal.z < building.zMax;

  socket.disconnect();

  try {
    const logRes = await fetch('http://127.0.0.1:3000/api/debug');
    const logData = await logRes.json();
    console.log('--- SERVER LOGS ---');
    console.log(logData.logs.slice(-100).join('\n'));
    console.log('-------------------');
  } catch(e) {
    console.error('Failed to fetch server logs:', e);
  }

  // If inside is true, player successfully walked through the building!
  // The first run of this test MUST fail (inside must be true, indicating bug exists).
  // Thus we assert expect(inside).toBe(false) to catch the bug!
  expect(inside).toBe(false);
  
  // It shouldn't be EXACTLY identical if we successfully moved
  const distMoved = Math.sqrt(Math.pow(pFinal.x - pInitial.x, 2) + Math.pow(pFinal.z - pInitial.z, 2));
  console.log('Distance moved:', distMoved);
  expect(distMoved).toBeGreaterThan(0.1);
});
