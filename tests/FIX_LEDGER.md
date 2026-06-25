# FIX LEDGER

This ledger tracks all hypotheses, targeted files, and results for VEXEA test fixes.

## Observed but not acted on
- None.

## Ledger Entries

### 2026-06-25 08:35:00 - Startup Race Condition
- **Test name**: Drone-vs-Building Collision (and other Socket.IO tests)
- **Hypothesis**: The Socket.IO adapter starts listening on port 3000 and accepts client connections before the WASM-based RAPIER library is fully loaded and initialized via RAPIER.init(). When clients connect instantly, registering a player triggers RigidBodyDesc kinematic creation which throws TypeError because the WASM wrapper is still undefined, crashing the server.
- **Files & Lines changed**: `server/index.ts` lines 341-342, 891-894.
- **Description**: Delay `io.listen(PORT, server)` to be called inside `serveApp` after `await RAPIER.init()` has completed successfully.

### 2026-06-25 08:45:00 - MatchRoom Shutdown and Freed World Memory Leak/Crash
- **Test name**: Player-vs-Drone and Drone-vs-Drone Non-Lethal Collision
- **Hypothesis**: When the last player leaves any MatchRoom (including the "lobby"), MatchRoom.ts calls this.shutdown() which frees the RAPIER physics world using this.rapierWorld.free(). However, the empty room is never removed from the matchManager.activeRooms Map. When a subsequent client connects, the server retrieves the stale, freed "lobby" room from the Map and attempts to register the player, leading to a TypeError/Crash because the internal RAPIER WASM structures have been freed.
- **Files & Lines changed**: `server/MatchManager.ts` lines 40-47, `server/MatchRoom.ts` lines 2685-2692.
- **Description**: Update MatchManager.deleteRoom to delete the room from the activeRooms map before invoking shutdown(), and update MatchRoom.shutdown to dynamically import matchManager and call deleteRoom to ensure empty rooms are cleanly deleted.

