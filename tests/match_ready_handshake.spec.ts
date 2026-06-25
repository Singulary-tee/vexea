import { test, expect } from '@playwright/test';
import { io } from 'socket.io-client';

test('match_ready Handshake', async () => {
  test.setTimeout(15000);
  
  const socket = io('http://127.0.0.1:3000', { transports: ['websocket'] });
  
  const capturedEvents: any[] = [];
  const origEmit = socket.emit.bind(socket);
  socket.emit = (ev, ...args) => {
    capturedEvents.push({ type: 'OUTBOUND', event: ev, time: Date.now() });
    return origEmit(ev, ...args);
  };
  
  socket.onAny((ev) => {
    capturedEvents.push({ type: 'INBOUND', event: ev, time: Date.now() });
  });

  await new Promise<void>((resolve) => {
    socket.on('connect', resolve);
  });

  // Start match
  socket.emit('start_match', { 
    uid: 'test_player_handshake',
    matchId: 'test_match_handshake',
    mapId: 'map_1_facility'
  });

  let matchReadyReceived = false;
  const startTime = Date.now();
  
  while (Date.now() - startTime < 10000) {
    if (capturedEvents.some(e => e.type === 'INBOUND' && e.event === 'match_ready')) {
      matchReadyReceived = true;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('Captured Handshake Events:');
  for (const e of capturedEvents) {
    console.log(`[${e.type}] ${e.event} at ${e.time}`);
  }

  socket.disconnect();
  
  expect(matchReadyReceived).toBe(true);
});
