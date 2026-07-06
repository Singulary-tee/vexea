# Match Lifecycle Architecture Plan
**Signature:** Gemini 3.1 Pro (AI Studio) - Locked Reference

## 1. Vision & Architecture Overview
A deterministic, isolated, and leak-free architecture for creating, running, and destroying game instances (Rooms). The architecture must operate strictly within the bounds of a top-level `MatchManager` controlling multiple isolated `MatchRoom` instances.

## 2. Component Hierarchy
- **MatchManager**: A singleton responsible for creating, holding references to, and destroying `MatchRoom` instances. It acts as the absolute authority over room lifecycles.
- **MatchRoom**: Represents a single isolated instance of a match. Contains exactly 1 game world. It operates as a delegate of the server's authority for its specific sharded instance.
- **World Constituents**: Physics World, Navmesh, LLM Commander, Geckos channels, Pre-allocated memory pools, and Map Data (including Spawn Points).

## 3. The "A to B" Match Lifecycle

### Phase 1: Allocation & Initialization (The "Vacuum Cleaner")
Triggered by `MatchManager.createRoom(config)`. This is a single, synchronous, deterministic sweep. No scattered variable declarations or haphazard function chaining.
1. **Pre-Allocation**: Allocate flat arrays, ring buffers, and object pools specific to this room (Zero-GC compliance).
2. **World Creation (Primitives)**: Load the static map data, Navmesh graph, and parse `specJson`.
3. **Physics Integration**: Initialize the Rapier physics world and populate static colliders directly from the map primitives.
4. **Deterministic Spawning**: Resolve all spawn points (player and drones) *exactly once* during this phase based strictly on map data. No post-hoc coordinate mutations, no external hacking functions.
5. **Entity Setup**: Pre-allocate Drone structures, projectiles, and player slots up to the room's maximum capacity.
6. **AI & LLM Infrastructure**: Initialize the Gemini 3.5 Flash LLM Commander loop and topological graph for this specific room.
7. **Readiness State**: Room marked as `READY`. Await player connections.

### Phase 2: Start Sequence
1. **Player Connection**: Players join via Geckos.io. Handshake validates versions, assigns slots, and sets initial deterministic coordinates defined in Phase 1.
2. **Broadcast "Match Start"**: Once all players are ready, the server sends a reliable broadcast. The client's loading screen subsidises immediately.
3. **Loop Activation**: The room starts its physics (60Hz) and network (20Hz) loops (`setInterval`). 

### Phase 3: Active Simulation (The Delegate)
- The Room manages its own isolated tick loops.
- Abides strictly by all rules specified in `ARCHITECTURE.md` (Zero-GC, Binary Serialization, Hitscan validation, etc.).
- The `MatchManager` does not interfere with the active loop, it only monitors health/timeouts.

### Phase 4: Teardown & Deallocation (The Reverse Walk)
Triggered by match end condition (time limit, objective complete) or all players disconnecting. This must be a systematic, reverse-order unrolling of Phase 1.
1. **Data Export**: Flush any necessary persistence data (Firebase/Firestore) before tearing down.
2. **Halt Loops**: Explicitly `clearInterval` for 60Hz physics, 20Hz network loops, and any LLM intervals.
3. **Disconnect Clients**: Force close all Geckos.io channels bound to the room and clear all event listeners.
4. **Free WASM Memory**: Call `world.free()` on the Rapier physics instance (MANDATORY to prevent fatal WASM memory leaks).
5. **Nullify Pointers**: Nullify Navmesh, LLM context, and explicitly release all pre-allocated TypedArrays, Ring Buffers, and object pools so the Node V8 GC can cleanly sweep them.
6. **Signal Manager**: The Room signals `MatchManager` that teardown is complete. The Manager deletes the Room reference.

## 4. Edge Cases & Best Practices
- **WASM Memory Leaks**: The biggest risk in a Node.js + Rapier environment. A dropped room reference without calling `world.free()` will leak WASM heap indefinitely.
- **Asynchronous Dangling Closures**: If a teardown initiates while an LLM network request is pending, the returning promise must check `if (!this.isActive)` before attempting to mutate room state.
- **Event Listener Accumulation**: Geckos `channel.on` listeners must be bound to the specific room instance and forcefully cleared during teardown to prevent closure leaks across matches.
- **Spawn Coordinate Integrity**: Spawn points must be treated as immutable constants once parsed from the map data. Any function attempting to re-calculate or hack spawn offsets during the active match must be eliminated.

## 5. Testing the Architecture

### Server-Side Integrity Testing
1. **The Leak Test (V8 & WASM)**: Script a loop that spawns 50 `MatchRoom` instances, ticks them 10 times, and initiates teardown. Monitor `process.memoryUsage().heapUsed` and Rapier's internal memory allocator (if exposed) to assert zero permanent memory growth.
2. **The Zombie Test**: Assert that after Phase 4 completes, accessing `room.rapierWorld` or `room.syncInterval` throws a null reference error, proving the loops are dead.
3. **The Sandbox Test**: Spawn Room A and Room B. Fire a weapon in Room A. Assert Room B's hitscan ring buffer remains completely untouched at the exact byte level.

### Client-Side Integrity Testing
1. **The Clean Slate Reconnect**: Start Match 1. Quit via UI. Start Match 2 without refreshing the browser. 
   - *Assertion*: The client scene graph is completely purged of Match 1 meshes. The Geckos channel establishes a fresh connection. The player spawns at the correct deterministic coordinates, not falling through the floor due to stale positional states or out-of-sync map geometry.
2. **Buffer Purge**: Ensure all client-side Dead Reckoning ring buffers and Jitter buffers are flushed to zero upon leaving a match.

## Signature
I have analyzed the scattered implementation flaws and acknowledge this strict lifecycle. This document serves as the immutable reference for Match Management and Teardown. No edits will deviate from this standard.
**Signed:** Gemini 3.1 Pro (AI Studio) - Date: 2026-06-28
