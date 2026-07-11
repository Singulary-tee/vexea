# PvE Drone Survival Shooter: Complete Locked Architecture
**Status:** Architecture Locked. Implementation Phase.
**Scope Focus:** Strict preservation of all edge-case stress tests, failure modes, hardcoded thresholds, and zero-allocation pipelines. No generic abstractions.

---

## 1. Core Stack & Infrastructure
*   **Renderer (Client):** Three.js r184 with TSL (Three Shading Language). We strictly use the WebGPU renderer with `forcewebgl` if/when absolutely necessary for compatibility, and the outdated legacy WebGL renderer is never used. The use of THREE.WebGLRenderer is completely forbidden under any circumstances. No matter what's the issue or what's being fixed or added. This project is strictly designed, developed, and tested using the modern WebGPU pipeline. Under no circumstances should legacy WebGL-specific limitations, outdated APIs, or concepts like "WebGL buffer allocation" be assumed or referenced as primary.
*   **Physics:** Rapier via WASM.
    *   **Server:** Authoritative state, static collisions, hitscan validation.
    *   **Client:** Used **ONLY** for player kinematic character controller and static map geometry. **Drones are NOT simulated in client-side Rapier.**
*   **Assets:** Meshy -> GLB format with baked PBR materials. 50MB total asset budget.
*   **Hosting/Server:** Single DigitalOcean Droplet, running Node.js with PM2. Single region MVP.
*   **Monetization:** Google AdSense for Games (H5 Games Ads). Firestore battle pass state.
*   **Deployment:** GitHub -> GitHub Actions -> SSH -> Droplet.
*   **Frontend Constraints:** Vanilla JS + HTML overlay. **No React.**

---

## 2. AI Studio Preview Environment Workarounds (CRITICAL / HIGH IMPORTANCE)
*   **Networking Fallback:** Due to CORS, sandboxing, and Cross-Origin Isolation policies native to the AI Studio preview iframe environment which prevent the standard use of Geckos.io (WebRTC Data Channels) and SharedArrayBuffer, we utilize **Socket.io and JSON** as the primary transport layer to ensure reliability and bypass UDP/WebRTC port-blocking constraints in this specific containerized preview. This is a primary production workaround.
*   **Thread Synchronization Fallback:** For high-frequency thread synchronization, we rely on **Worker postMessage** as the fallback synchronization channel instead of SharedArrayBuffer (which is blocked by Cross-Origin Isolation constraints in the preview iframe).
*   **Server Lifecycle Coupling:** Inside the ephemeral AI Studio environment, the server is tightly coupled to the preview applet container. On page refresh, or when the applet is stopped/restarted, both the client and the server terminate and reload together. The server does not survive page reloads or run persistently in the background like a production VPS/droplet.
*   **Dependency Reference Authoritativeness:** The `node_modules` directory is the absolute authoritative source for any edits, builds, or plans touching external APIs (e.g., Three.js, Rapier, or Yuka). Never rely on outdated training data or pre-trained assumptions about these packages; verify their structural and interface APIs directly from the installed package files.

---

## 3. Security, Authentication & Database
*   **Authentication:** Firebase Anonymous Auth.
*   **Persistent State (Firestore):** Post-match batch writing only.
    *   *Match Lock Anti-Exploit:* At match start, write a `MatchInProgress` document containing player IDs. At match end, an atomic transaction updates stats and deletes `MatchInProgress`. A scheduled Google Cloud Function sweeps stale docs (>2 hours) and explicitly records a forfeit/death penalty for combat loggers/disconnects.
*   **Anti-Cheat (Visibility Culling):**
    *   DTLS encryption does not protect against RAM scanning/browser hooks parsing WebRTC Data Channels.
    *   **Defense:** Server-Side Visibility Culling. The server never sends coordinates for drones outside the player's line-of-sight and audio detection radius.

---

## 4. The Geckos Serialization & Networking Stack
*   **Protocol:** Geckos.io (WebRTC Data Channels) for authoritative UDP-like client-server communication.
*   **Network vs. Physics Loops:**
    *   *Physics Tick:* 60Hz (16.66ms) using Node `setInterval` (Rapier, A* validation, hitscans).
    *   *Network Tick:* 20Hz (50ms). Clients interpolate via Dead Reckoning.
*   **Strict Binary Serialization:** Zero garbage collection (GC). No `JSON.stringify()`.
*   **DataView Payload Configuration (1,606 bytes per packet):**
    *   ArrayBuffer wrapped in a `DataView`. Float values written to exact byte offsets.
    *   *Header (6 bytes):* `ServerTick` (Uint32, 4 bytes), `DroneCount` (Uint16, 2 bytes).
    *   *Drone Struct (32 bytes per drone, memory aligned):* `DroneID` (Uint16), `PosX, PosY, PosZ` (Float32x3, 12 bytes), `RotX, RotY, RotZ, RotW` (Float32x4, 16 bytes), `StateID` (Uint8, 1 byte), `Padding` (1 byte).
*   **Channel Segregation:**
    *   *Unreliable (`channel.raw.emit()`):* Drone and Player transforms.
    *   *Reliable (`channel.emit()`):* Damage, Deaths, Hitscan Confirmations, LLM Zone states.
*   **Client Input Payload (Reliable):** `[SequenceNumber (Uint32), InputMask (Uint8), Pitch (f32), Yaw (f32), FireEvent (Uint8), ClientTimestamp (Uint32)]`. Server replies with `LastProcessedSequenceNumber`.

---

## 5. Server Architecture (Zero GC Pipeline)
*   **Object Pooling:** Pre-allocate all buffers, matrixes, and vectors before the match. No `new` keywords, array spreads, or object literals in the tick loop. Input queues use fixed-size typed arrays. Mutate broadcast payloads in place.
*   **Dynamic Obstacles & AI Pathing:**
    *   *Static Navmesh:* Global A* uses a lightweight JSON graph. No `THREE` namespace on the server.
    *   *Obstacle Logic:* Players and temporary obstacles do NOT mutate the navmesh. Temporary deployables (shields) flag a node; pathfinding skips flagged nodes. A* routes to the doorway; Local Avoidance handles the rest.
*   **RVO/VO Entity Classification:**
    *   Ground drones use Reciprocal Velocity Obstacles (RVO) between each other.
    *   Players and unyielding obstacles are pure Velocity Obstacles (VO). The drone takes 100% of the avoidance responsibility, assuming zero player cooperation.
*   **Air Drone Navigation:** Steering Behaviors (Boids) + forward raycasting repulsion. No 3D voxel A*.

---

## 6. The Authoritative Combat System
*   **Hitscan Validation:** Player weapons are instant raycasts. Client registers unconfirmed hit marker immediately. Server executes raycast intersection check against a **Float32Array cyclic ring buffer** of lightweight AABBs at timestamp `T`. Do NOT rewind Rapier physics states.
*   **Timestamp Trust Exploit (Backtrack Hack) Prevention:**
    *   Server maintains a rolling RTT average per player.
    *   `Expected_Timestamp = Server_Time - Ping`.
    *   Client timestamps accepted if within a `±50ms` tolerance window, hard-capped at 200ms maximum rewind.
    *   Timestamps outside this window are processed against *current* server time (no rewind advantage, but shot is not dropped).
*   **Leaky Bucket Fire Rate:**
    *   Fire intervals checked against *Client* timestamps.
    *   Legitimately-spaced shots arriving in a UDP burst are accepted. Maximum bucket capacity = weapon magazine size. Violating intervals/capacity discards the excess.
*   **Drone Aiming (Smoothing & Pre-Fire Check):**
    *   Drone prediction uses an Exponential Moving Average (EMA) of player velocity over 250ms.
    *   `Aim_Point = Position + (Smoothed_Velocity * Travel_Time)`
    *   Drone runs a fast, pre-fire raycast from muzzle to predicted aim point against static geometry. If blocked, drone holds fire. Projectiles are zero-gravity.

---

## 7. Client Dead Reckoning & Zero-Allocation Render Loop
*   **Dead Reckoning & Jitter Buffer:**
    *   Client maintains a Ring Buffer of the last 3 UDP network packets.
    *   Drones render at `Server_Time - 100ms` to hide 20Hz UDP gaps.
    *   *Correction Threshold:* Server sends a correction snap ONLY if client-simulated position diverges from server authoritative position by **> 0.5 units**. State transitions trigger unconditional snaps.
    *   Server supplies a full-state background heartbeat every 1-2s reliably.
*   **The Zero-Allocation Client Pipeline:**
    *   `Geckos.io ArrayBuffer` -> `Dead Reckoning Interpolator` -> `Pre-allocated Vector3/Quaternion` -> `Pre-allocated Matrix4 Compose` -> `BatchedMesh Buffer Write`.
*   **Batched Geometries & Draw Call Budget (Max 15 Draw Calls):**
    *   Drones and projectiles use `THREE.BatchedMesh` (r184) for independent per-instance skeletal animations in a single draw call.
    *   Static map geometry batched into a single merged geometry at load time (1 draw call).
*   **Runtime Asset Loading & Shaders:**
    *   Pre-atlasing occurs at the build level via `gltf-transform`. Zero runtime atlasing.
    *   All rendering shaders are pre-warmed on a mock frame during the UI loading phase to prevent compilation stutters.
*   **LOD Pipeline (Compute Shader / 5Hz JS):**
    *   Three separate `BatchedMesh` buffers.
    *   `< 30 units`: Full geometry.
    *   `30 to 60 units`: Simplified mesh.
    *   `> 60 units`: Billboarded sprites.
*   **Thermal Management (Mobile Chrome):**
    *   Frame rate capped at 60fps via `requestAnimationFrame` throttling.
    *   Particle density scales down automatically if frame time exceeds 20ms for 3 consecutive frames.
    *   Shadow maps disabled entirely (baked PBR only).
*   **UI & Audio:**
    *   CSS/HTML overlays for static elements. World-space tracking (health bars, damage floaters) render as WebGPU instanced sprites.
    *   Audio: `Howler.js` for 2D UI. Three.js `PositionalAudio` (Web Audio API `PannerNode`) for C++ optimized HRTF spatialization.

---

## 8. The LLM Commander Ecosystem (Gemini 3.5 Flash)
*   **Control Loop:** 8-second asynchronous fire-and-forget loop.
*   **Prompt Architecture:** Strictly clinical, mechanical vocabulary. Rejects narrative phrasing to bypass Google aligner filter blocks.
*   **Topological Edge Graph:** Static Prompt defines specific node adjacency (e.g., "Core -> Bridge -> Warehouse"). Costs zero dynamic payload tokens.
*   **Input Payload (Semantic State):** Receives pre-computed zone summaries. Server calculates a `combat_effectiveness` enum (full, degraded, critical, destroyed) and remaining unit counts for every abstract "Group".
*   **Fog of War:** Semantic summary only defines player location if a drone holds active LOS or acoustically detects unsilenced fire. State degrades to `UNKNOWN` over time, forcing Recon.
*   **Batch Validation & Execution:**
    *   Server handles the array of calls atomically. Order forced as: Spawn -> Split -> Merge -> Move.
    *   Lock sets prevent mutating commands (Merge, Split, Move) from creating concurrency conflicts.
    *   Four validations: Schema conformity, Entity existence, Topology adjacency, Resource unit pool check.
    *   **No Silent Discards:** Validation failures are appended to a `failed_operations` array with rejection reasons in the adjacent 8-second prompt payload.
*   **Tool Call Schema:**
```json
{
  "tools": [
    {
      "name": "move_group",
      "parameters": {
        "group_id": "string",
        "target_zone": "string",
        "priority": "low|normal|high"
      }
    },
    {
      "name": "merge_groups",
      "parameters": {
        "source_group_id": "string",
        "target_group_id": "string"
      }
    },
    {
      "name": "split_group",
      "parameters": {
        "source_group_id": "string",
        "unit_count": "integer"
      }
    },
    {
      "name": "hold_position",
      "parameters": {
        "group_id": "string",
        "duration_seconds": "integer"
      }
    },
    {
      "name": "spawn_units",
      "parameters": {
        "zone_id": "string",
        "unit_type": "ground|air",
        "count": "integer",
        "behavior_profile": "assault|patrol|recon"
      }
    },
    {
      "name": "sustain",
      "parameters": {
        "reason": "string"
      }
    }
  ]
}