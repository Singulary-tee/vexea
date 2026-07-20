# VEXEA Codebase Index

This file is the authoritative index of all directories and source files within the VEXEA multiplayer FPS engine. It provides exact descriptions of what each file contains and exports, serving as a strict audit gate. Every single codebase modification must be registered in this index first and last to ensure complete alignment and prevent random modifications.

---

## 1. Directory Structure and Module Index

### 1.1 Server Space (`/server`)

*   **`MatchManager.ts`**
    *   *Purpose:* Orchestrates the lifecycle of all active matches.
    *   *Key Functions/Exports:* `MatchManager` class (exported as default and as `matchManager` instance), `getOrCreateRoom(roomId, geminiKey, mapId)` (returns or provisions rooms), `findMatchmakingRoom(geminiKey)` (allocates players to empty rooms under 10 players), `deleteRoom(roomId)` (initiates cleanup), `getRooms()` and `getRoomCount()`.
*   **`MatchRoom.ts`**
    *   *Purpose:* The complete server-side simulation environment. Manages the 60Hz physics update loop, 20Hz state-synchronization packets, and tactical AI events.
    *   *Key Functions/Exports:* `MatchRoom` class, handles player join/leave, bot integration, collision handling, hitscan/rewind raycasting, objective point timers, score accounting, and shutdown processing.
*   **`index.ts`**
    *   *Purpose:* Primary server entry point. Configures the Express server, initializes WASM physics modules, binds HTTP and Socket.IO ports, hosts developer API endpoints, handles network reconnect tolerances, and serves static files.
*   **`ai/` (Tactical and Strategic AI)**
    *   **`DroneIntelligence.ts`**: Governs tactical awareness for individual drones. Computes sight lines (3D orientation quaternions to check forward vectors and cone of vision angles), performs static map and dynamic Rapier line-of-sight raycasts, and handles memory decay mechanics.
    *   **`LLMCommander.ts`**: High-level strategic controller powered by Gemini 3.5 Flash. Formulates formatted prompt strings, parses structured tool call arrays (Spawn, Move, Split, Merge, Hold), and manages strategic AP resource pools.
*   **`map/` (Spatial Structure)**
    *   **`ZoneRegistry.ts`**: Maps geometric boundaries to specific Named Zones (e.g., Core, Warehouse, Bridge), handles player zone occupancy queries, and stores localized waypoint indices.
*   **`physics/` (Server Simulation)**
    *   **`PhysicsWorldManager.ts`**: Direct integration with the `@dimforge/rapier3d-node` engine. Builds rigid bodies, defines player/drone collision geometry bounds, and runs stepped simulation updates.
*   **`test-scenarios/` (Headless Diagnostic Scripts)**
    *   **`memory-decay-verification.ts`**: Confirms confidence decay scaling under dt variations.
    *   **`movement-test.ts`**: Verifies pathing trajectories across multiple nodes.
    *   **`perception-baseline.ts`**: Evaluates cone-of-vision accuracy limits.
    *   **`run_all_diagnostics.ts`**: Main CLI coordinator for headless performance checks.
    *   **`run_avoidance_test.ts`**: Verifies dynamic pathing adjustment when friendly drone clusters collide.
*   **`transport/` (Server Connectivity)**
    *   **`adapter.ts`**: Defines the unified `ChannelAdapter` and `ServerTransport` interface layer. Implements the `SocketIOServerAdapter`/`SocketIOChannelAdapter` (the active transport, utilizing JSON events and number-array binary emulations) and `GeckosAdapter`/`GeckosChannelAdapter` (inactive/experimental).

---

### 1.2 Shared Space (`/shared`)

*   **`collision.ts`**
    *   *Purpose:* Zero-allocation AABB collision system.
    *   *Key Functions/Exports:* `CollisionSystem` class, `globalCollisionSystem` instance, `loadFromSpec(specJson)` (parses building layouts into active boxes), `rayIntersectsAABB` and `rayIntersectsAny` (highly efficient hitscan calculations for projectiles and sight lines).
*   **`constants.ts`**
    *   *Purpose:* Absolute single source of truth for game variables, network sizes, and entity shapes.
    *   *Key Functions/Exports:* `ZONES` registry, `WAYPOINTS` center-points, `TOPOLOGY` adjacency graph, `ZONE_BOUNDS` half-sizes, `DroneState` enum, `DroneType` enum, limits (`PLAYER_MAX_HP`, `CAMERA_MAX_HP`), and the `DRONE_CONFIGS` dictionary containing comprehensive visual, physical, and behavioral parameters per drone type.
*   **`gamemode-configs.ts`**
    *   *Purpose:* Governs rulesets, friendly fire options, victory requirements, and score scaling.
    *   *Key Functions/Exports:* `GameModeConfig` interface, `GAMEMODES` registry, and the active `ACTIVE_GAMEMODE` constant.
*   **`gate.ts`**
    *   *Purpose:* Gating system designed to separate development-only interfaces and network backdoors from production.
    *   *Key Functions/Exports:* `IS_DEV` environment check, `assertDev(featureName)` (denies execution in production environments).
*   **`weapons.ts`**
    *   *Purpose:* Stores performance matrices, damage variables, and recoil metrics.
    *   *Key Functions/Exports:* `WeaponPerformance` and `DamageFalloff` definitions, `DETAILED_WEAPONS` dictionary (containing Rifle and Pistol metrics), and `calculateDamageWithFalloff(baseDamage, distance, falloff)` (determines actual hit intensity).
*   **`transport.config.ts`**
    *   *Purpose:* Static transport router configuration.
    *   *Key Functions/Exports:* `TRANSPORT_MODE` constant (hardcoded to `'socketio'`).
*   **`maps/` (Spatial Layout JSONs)**
    *   **`map-registry.ts`**: Combines static facility models and inventory registries.
    *   **`map_1_facility.spec.json`**: Structure blueprints (positions, sizes, building heights) of the Facility level.
    *   **`map_1_inventory.json`**: Static placement points for terminal objectives, security cameras, and spawn nodes.

---

### 1.3 Client Space (`/client`)

*   **`MatchController.ts`**
    *   *Purpose:* Transitory session controller created upon entering matches and destroyed on termination. Isolates state variables to prevent memory leaks.
    *   *Key Functions/Exports:* `MatchController` class, manages sub-system state machines (minimap, network sync, input processing, visuals, UI, and audio) and tracks player properties (HP, score, ground states, camera recoil, ADS lerp, and ring buffers of drone updates).
*   **`asset-cache.ts`**
    *   *Purpose:* Facilitates model and sound file caching.
*   **`audio.ts`**
    *   *Purpose:* Handles spatial sound positioning and 2D UI playback.
*   **`design-system.ts`**
    *   *Purpose:* Governs UI rendering themes and CSS constraints.
*   **`dev_menu.ts`**
    *   *Purpose:* Dev UI for spawning assets, switching maps, and toggling invulnerability.
*   **`dev_visual_diagnosis.ts`**
    *   *Purpose:* Visual overlays rendering raw lines for wireframe colliders, raycast tracks, and velocity vectors.
*   **`drone_models.ts`**
    *   *Purpose:* Resolves asset configurations and custom procedural materials for drone glTF structures.
*   **`firebase.ts`**
    *   *Purpose:* Integrates client authentication and leaderboards.
*   **`hitscan.ts`**
    *   *Purpose:* Standard 3D raycaster implementation for targeting and crosshair alignment.
*   **`hud_template.ts`**
    *   *Purpose:* HTML structures dynamically appended to structure the overlay UI.
*   **`index.css`**
    *   *Purpose:* Central Tailwind loading point and visual font imports.
*   **`index.html`**
    *   *Purpose:* Mounts the canvas structure and references `/client/main.ts`.
*   **`input.ts`**
    *   *Purpose:* Captures mouse clicks, screen touch joystick inputs, and key bindings.
*   **`main.ts`**
    *   *Purpose:* Initializer and state coordinator. Preloads screens, instantiates Three.js stages (WebGPU or WebGL fallbacks), and hooks connection clicks.
*   **`map_editor.ts`**
    *   *Purpose:* Level-building sandbox interface.
*   **`physics.worker.ts`**
    *   *Purpose:* Web worker script for client physics predictions.
*   **`platform-gate.ts`**
    *   *Purpose:* Centralizes platform detection (mobile vs. desktop) at initialization. Responsible for gating UI elements, applying platform-specific CSS classes, and managing device-specific default settings.
*   **`settings.ts`**
    *   *Purpose:* Volume levels and mouse sensitivity configurations.
*   **`state.ts`**
    *   *Purpose:* Local state machine tracking lobby choices and connection status.
*   **`test_measure.ts`**
    *   *Purpose:* Renders diagnostics and framing metrics overlays.
*   **`ui_editor.ts`**
    *   *Purpose:* Panel positioning system for custom HUD configurations.
*   **`weapons_model.ts`**
    *   *Purpose:* Handles first-person weapon meshes, reload animations, and procedural recoil offsets.
*   **`transport/` (Client Connectivity)**
    *   **`adapter.ts`**: Client-side transport. Implements `SocketIOClientAdapter` and `GeckosClientAdapter` wrappers.
*   **`src/` (Client Subsystems)**
    *   **`input/`**
        *   **`InputSynchronizer.ts`**: Structures the 20-byte input payload buffer containing sequential numbers, yaw/pitch floats, action codes, and bitmasks to send at monitor refresh speeds.
    *   **`map/`**
        *   **`LoadingOrchestrator.ts`**: Monitors assets load states.
        *   **`MapLoader.ts`**: Spawns structural walls and facility bounds.
    *   **`systems/`**
        *   **`CombatSystem.ts`**: Local visual hit detection, impact spark spawning, ammunition state tracking, and local weapon animations.
        *   **`DiagnosisSystem.ts`**: Interactive debug box rendering, rendering coordinates, ping monitors, and tick metrics.
        *   **`DroneProcedural.ts`**: Drives local visual loops like rotor spins, wheel rolling, hover bob, and yaw/pitch tracking of turrets.
        *   **`DroneSystem.ts`**: Manages local models, instancing, and material updates for active drones.
        *   **`HUDSystem.ts`**: Injects real-time status telemetry into the HTML HUD (HP, Ammo, score, and active hold progress).
        *   **`InputSystem.ts`**: Processes inputs, sets rotation values, and triggers the `InputSynchronizer` stream.
        *   **`MinimapSystem.ts`**: Manages the 2D visual radar map tracking captured zone boundaries and detected targets.
        *   **`NetworkSyncSystem.ts`**: Unpacks global binary server payloads, interpolates remote entities, and tracks historic rewinds.
        *   **`ReconnectionSystem.ts`**: Manages reconnect routines.
        *   **`SimulationSystem.ts`**: Implements predictive movement loops.
        *   **`VisualsSystem.ts`**: Handles camera field-of-view zooms, visual sway patterns, and active recoil transitions.
    *   **`ui/`**
        *   **`LoadingScreen.ts`**: Renders structural loading indicators.
        *   **`PanZoomSurface.ts`**: Interactive map controller support.
    *   **`vfx/` (Visual Effects)**
        *   **`VFXOrchestrator.ts`**: Controls pooled particle effects, sparks, and impact dust.
        *   **`constants.ts`**: Constants for particle sizes and decays.
        *   **`firing.ts`**: Controls muzzle flashes and glowing tracers.
        *   **`hits.ts`**: Controls impact sparks and splatter visuals.
        *   **`large.ts`**: Controls explosion particle rings and fireballs.

---

## 2. Codebase Modification Audit Protocol

Every file change in the VEXEA codebase must follow this strict three-step protocol to prevent random edits:

1.  **Index Consultation:** The assistant must read this file (`/CODEBASE_INDEX.md`) to verify the file purpose and exports before preparing any edits.
2.  **Audit Registration (Pre-Change):** Register the target file, planned lines, and intended modification in Section 3 of this document.
3.  **Audit Finalization (Post-Change):** Record the results of the compilation, linter verification, and precise file diffs in Section 3 to ensure alignment.

---

## 3. Active Change Audit Log

### Cycle 2026-07-18-01: Move ready-state and start logic from server entry to MatchRoom.ts
*   **Target Files:** `/server/index.ts` & `/server/MatchRoom.ts`
*   **Status:** Verified & Finalized
*   **Modifications:**
    *   `/server/MatchRoom.ts`: Implement `setPlayerReady(playerId: string)` method, encapsulating player ready state updates and match simulation loop triggering inside the room environment. (Completed)
    *   `/server/index.ts`: Clean up transport layer event `"player_ready"` to delegate directly to `currentRoom.setPlayerReady(pState.id)`, maintaining zero business logic in the entry file. (Completed)
*   **Verification:** `lint_applet` passed, `compile_applet` succeeded, dev server successfully restarted.

### Cycle 2026-07-18-02: Fix Spawn Direction, Panoramic Prewarming, and Loading Screen Wait Times
*   **Target Files:** `/client/src/systems/NetworkSyncSystem.ts` & `/client/src/map/LoadingOrchestrator.ts`
*   **Status:** Verified & Finalized
*   **Modifications:**
    *   `/client/src/systems/NetworkSyncSystem.ts`: Reset local player yaw and pitch towards the map center when joining or respawning (`YOU_RESPAWNED` event), preventing players from starting with wrong look-angles. (Completed)
    *   `/client/src/map/LoadingOrchestrator.ts`: Reset `_serverMatchReady` at match load start to avoid bypassing the server-ready wait screen. Implemented panoramic 6-directional prewarming from the player's spawn coordinate to fully compile all building models and materials, eliminating first-turn lag. Cleaned up socket event listeners on connection resolve or timeout to prevent memory leaks. (Completed)
*   **Verification:** `lint_applet` passed, `compile_applet` succeeded, dev server successfully restarted.

### Cycle 2026-07-19-01: Gameplay Smoothness, Weapon Follow Lag, Camera Head-Bobbing, Bank Tilting, and Viewmodel Pull-back (Points 8 and 9)
*   **Target Files:** `/client/MatchController.ts`, `/client/src/systems/InputSystem.ts`, `/client/weapons_model.ts`, `/client/main.ts`, and new files in `/client/src/camera/`
*   **Status:** Verified & Finalized
*   **Modifications:**
    *   `/client/src/camera/constants.ts`: Created a configuration file containing all adjustable parameters for head bobbing, camera banking, weapon follow lag, landing jolts, and progressive model pullback. (Completed)
    *   `/client/src/camera/CameraEffects.ts`: Created a class that computes and updates all stateful camera and viewmodel offsets using smooth S-curves/interpolation. (Completed)
    *   `/client/MatchController.ts`: Declared and initialized camera effects state variables to prevent O(1) allocation overhead during high-frequency frame ticks. (Completed)
    *   `/client/src/systems/InputSystem.ts`: Replaced the instantaneous walk-to-run speed change with a smooth acceleration/deceleration S-curve. (Completed)
    *   `/client/weapons_model.ts`: Implemented slerp-based weapon follow lag with non-linear snapping drag and run-based model pullback. (Completed)
    *   `/client/main.ts`: Applied head-bobbing translations, landing jolts, and camera bank tilting to the final PerspectiveCamera transform. (Completed)
*   **Verification:** `lint_applet` passed successfully, `compile_applet` completed with zero errors, production build verified.

### Cycle 2026-07-19-02: Implement Countdown "Time Left" Timer and Modular Tactical Compass (Points 6 and 7)
*   **Target Files:** `/shared/gamemode-configs.ts`, `/client/src/systems/HUDSystem.ts`, `/client/hud_template.ts`, `/client/src/systems/CompassSystem.ts`, `/client/MatchController.ts`, `/client/main.ts`
*   **Status:** Verified & Finalized
*   **Modifications:**
    *   `/shared/gamemode-configs.ts`: Add `timerLabel` config parameter to `GameModeConfig` interface and STANDARD game mode. Changed STANDARD `matchDuration` to 600s (10 minutes) to establish the correct game duration parameter. (Completed)
    *   `/client/src/systems/HUDSystem.ts`: Calculate remaining seconds via subtracting current ticks from the total match duration and render using dynamic label matching the active game mode. (Completed)
    *   `/client/hud_template.ts`: Renamed static HTML fallback placeholder for HUD timer container. (Completed)
    *   `/client/src/systems/CompassSystem.ts`: Built a zero-allocation, modular horizontal compass canvas tape drawing cardinal directions, 5-degree and 15-degree markings, with real-time tracking support for landmarks using distance telemetry and custom SVG/vector icon rendering shapes. (Completed)
    *   `/client/MatchController.ts`: Integrated CompassSystem subsystem instantiation, binding, and lifecycle cleanup. (Completed)
    *   `/client/main.ts`: Ticked compass subsystem updates during logic frames. (Completed)
*   **Verification:** `lint_applet` passed successfully, `compile_applet` completed with zero errors, production build verified.


