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
*   **`hud_snippets.ts`**
    *   *Purpose:* Backup holder for preserved HUD UI snippets (e.g. original top-left squad character avatars).
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



### Cycle 2026-07-20-01: Shift FOV sight math to Server and use boolean flag
*   **Target Files:** `/server/MatchRoom.ts`, `/server/ai/DroneIntelligence.ts`, `/client/MatchController.ts`, `/client/src/systems/NetworkSyncSystem.ts`, `/client/src/systems/DiagnosisSystem.ts`
*   **Status:** Verified & Finalized
*   **Modifications:**
    *   `/server/MatchRoom.ts`: Extended `ServerDrone` with `playerInFOV` boolean. Added bitwise manipulation to serialize this into the highest bit of the 31st drone struct byte (type).
    *   `/server/ai/DroneIntelligence.ts`: Removed redundant `playerInFOV` reset. Evaluated server authoritative `hasLOS` via `inDistance && inFOV && hasLOS`. Assigned `d.playerInFOV = true` directly to the server state structure on successful player detection.
    *   `/client/MatchController.ts`: Appended `playerInFOV` property to the `NetworkDroneState` structure. Included parameter in `push()` to zero-alloc `DroneRingBuffer` to correctly parse array buffer offset bits.
    *   `/client/src/systems/NetworkSyncSystem.ts`: Read the 31st byte from the payload view buffer, decoupled bits using `& 127` mask for DroneType and `& 128` mask for the `playerInFOV` truth. Passed standard into interpolator buffer.
    *   `/client/src/systems/DiagnosisSystem.ts`: Ripped out the math hack comparing drone pursuing/attacking state values and cleanly integrated `head.playerInFOV` logic to change the FOV visualizer cone from cyan to red precisely aligned with authoritative detection.
*   **Verification:** `lint_applet` passed successfully, `compile_applet` completed with zero errors, production build verified.

### Cycle 2026-07-21-01: Update rifle and pistol muzzleOffset parameters
*   **Target Files:** `/shared/weapons.ts`
*   **Status:** Verified & Finalized
*   **Modifications:**
    *   `/shared/weapons.ts`: Update `DETAILED_WEAPONS.rifle.visualConfig.muzzleOffset` to `[0.18, 0.15, -0.47]` and `DETAILED_WEAPONS.pistol.visualConfig.muzzleOffset` to `[0.03, 0.12, -0.25]` as requested by the user.
*   **Verification:** `lint_applet` passed successfully, `compile_applet` completed with zero errors, production build verified.

### Cycle 2026-07-21-02: User Menu UI Polishing
*   **Target Files:** `/client/index.css`, `/client/screens/main-menu.ts`
*   **Status:** Verified & Finalized
*   **Modifications:**
*   `/client/index.css`: Injected global scrollbar suppression rules so scrollbars are completely hidden across all views, lists, panels, and frames.
*   `/client/screens/main-menu.ts`: Added a high-fidelity dynamic fullscreen toggle next to the profile/user icon that changes SVG path states automatically. Toggle is separated by a sleek 1px vertical divider.
*   `/client/screens/main-menu.ts`: Hidden the bottom featured operation banner during active card modes to resolve overlay conflicts with the back button and the right panel.
*   **Verification:** `lint_applet` passed successfully, `compile_applet` completed with zero errors, production build verified.

### Cycle 2026-07-21-03: Lobby Screen Class Selection Redesign
*   **Target Files:** `/client/screens/lobby.ts`
*   **Status:** Verified & Finalized
*   **Modifications:**
    *   `/client/screens/lobby.ts`: Complete redesign of the lobby UI screen layout:
        *   Ripped out the entire contractors/player list section and associated header elements.
        *   Positioned the Back button elegantly in the top-left corner as a discrete, tactical translucent button.
        *   Constructed a high-fidelity Gamemode Details panel in the top-right corner showing current active mode, type, and contractor count.
        *   Positioned the Class Selection Cards horizontally at the bottom left/middle, separated cleanly with standard gaps (no touching borders) and fully responsive clamping.
        *   Repositioned the READY action button to the bottom-right corner, fully decoupled from the cards.
        *   Kept the center of the viewport fully black/unobstructed to comfortably host 3D model visualization.
        *   Wired selected class detail successfully into the `start-match` event payload.
*   **Verification:** `lint_applet` passed successfully, `compile_applet` completed with zero errors, production build verified.

### Cycle 2026-07-21-04: Menu Card Overlap & Branding Update
*   **Target Files:** `/client/screens/main-menu.ts`, `/client/src/ui/LoadingScreen.ts`
*   **Status:** Verified & Finalized
*   **Modifications:**
    *   `/client/screens/main-menu.ts`: Replaced VEXEA wordmark with VEXEΛ in all UI layers.
    *   `/client/src/ui/LoadingScreen.ts`: Updated loading screen wordmark to match the VEXEΛ branding.
    *   `/client/screens/main-menu.ts`: Removed "Waiting for contractors..." subtext from the menu right panel as requested.
    *   `/client/screens/main-menu.ts`: Renamed "FACTION" menu item to "INTEL" to better reflect the knowledge base and lore.
    *   `/client/screens/main-menu.ts`: Updated `.mm-left-col` flex layout to dynamically center cards vertically by default, and push to `flex-start` when an active card expands.
    *   `/client/screens/main-menu.ts`: Removed injected `overflow-x: hidden;` and set `overflow: visible !important;` on the left column to prevent the card hover-scale `box-shadow` and `border` from being clipped.
*   **Verification:** `lint_applet` passed successfully, `compile_applet` completed with zero errors, production build verified.

### Cycle 2026-07-21-05: Update SEO Meta Description
*   **Target Files:** `/client/index.html`
*   **Status:** Verified & Finalized
*   **Modifications:**
    *   `/client/index.html`: Update the primary `<meta name="description">` tag with the new marketing copy provided by the user to improve SEO and brand messaging. (Completed)
*   **Verification:** `lint_applet` passed successfully, `compile_applet` completed with zero errors, production build verified.
