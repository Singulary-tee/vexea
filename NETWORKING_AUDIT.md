# VEXEA Networking Architecture Audit

## 1. Transport Layer
- **Socket.IO Usage:** Active. Handled via `SocketIOChannelAdapter` (client) and `SocketIOServerAdapter` (server).
- **Geckos.io Usage:** Inactive/Experimental. Handled via `GeckosChannelAdapter` and `GeckosServerAdapter`.
- **Active Protocol:** Socket.IO is the current active transport (`shared/transport.config.ts`, line 2: `export const TRANSPORT_MODE: TransportMode = 'socketio'; // Geckos disabled due to AI Studio port restrictions`).
- **Instantiation Files:**
  - Server: `server/transport/adapter.ts` (`createTransport()`, lines 224-230).
  - Client: `client/transport/adapter.ts` (`createClientTransport()`, lines 199-205).
- **Transport Selection:** Occurs via a static check on the `TRANSPORT_MODE` constant in both factory functions.
- **Simultaneous Execution:** No. The factory functions (`createTransport()` and `createClientTransport()`) return exclusively one transport adapter based on the constant.
- **Health Check Path:** Explicitly not found. There is no `/api/health` route in `server/index.ts`. The Express server mounts `/api/logs` (line 354), `/api/proxy-asset` (line 358), `/api/debug` (line 393), `/api/test-compile` (line 404), and serves the frontend on `/` (line 1107).

## 2. Connection Lifecycle
- **Client Launch:** `/client/main.ts` calls `initClient()` (line 1072). This triggers renderer setup but defers networking.
- **Main Menu / Lobby:** `initClient()` sets up UI by calling `initMainMenu()` (line 477) and `initLobby()` (line 478).
- **Server Discovery & Connection:** In `/client/main.ts` (line 284), a listener for `start-match` triggers when the user clicks "READY" in the lobby. This invokes `connectEngineSocket()` (line 373). The server URL is determined (line 495) and passed to `channel.connect(serverUrl, 3000)` (line 498).
- **Gameplay Initialization:** On `channel.onConnect()`, `/client/main.ts` emits `start_match` (lines 386 and 396). The server intercepts this in `/server/index.ts` (line 144), resolves a `MatchRoom`, and registers the player (line 154: `currentRoom.registerPlayer(...)`). The client receives a `handshake` event to spawn into the simulation.
- **Disconnect:** The user triggers a manual exit via a `VEXEA_PLAYER_QUIT` event listener (`/client/main.ts`, line 1076), which emits `PLAYER_QUIT` (line 1085) and invokes `channel.disconnect()`.
- **Reconnect:** If a socket drops, `/server/index.ts` handles `channel.onDisconnect` (line 211). It waits 20000ms. If the player connects again with the same `id` before the timeout, `registerPlayer()` dynamically re-binds their socket to the existing `PlayerState` in the `MatchRoom` and immediately dispatches a new `handshake` (line 522 of `server/MatchRoom.ts`) to avoid state loss.

## 3. Network Endpoints
- **Environment Determination:** In `/client/main.ts` (line 495): `const serverUrl = s.serverUrl || window.location.origin;`.
- **Port:** Hardcoded to `3000` in `/client/main.ts` (line 498: `channel.connect(serverUrl, 3000);`).
- **Socket.IO Fallback:** In `/client/transport/adapter.ts` (line 20): `serverUrl = serverUrl || window.location.origin;`.
- **Geckos Fallback:** In `/client/transport/adapter.ts` (line 147): `serverUrl = serverUrl || \`\${window.location.protocol}//\${window.location.hostname}\`;`, utilizing implicit port `443` or `80`.

## 4. Environment Detection
- **AI Studio / Local Dev vs Production:**
  - `/shared/gate.ts` (lines 14-25) defines `IS_DEV`. On the client, it checks `(import.meta as any).env?.DEV`. On the server, it checks `process.env.NODE_ENV !== 'production'`.
  - In `/server/index.ts` (line 1092), if `process.env.NODE_ENV !== "production"`, the server dynamically mounts Vite via `createViteServer`. In production (line 1104), it uses `express.static` to serve pre-built files from `/dist`.
- **Test Mode:** `process.env.TEST_MODE` in `/server/index.ts` (line 1111) suppresses the HTTP server from binding to `0.0.0.0`, allowing headless tests without port collisions.

## 5. Message Catalogue

### Client → Server
- **Reliable (Socket.IO JSON):**
  - `start_match`: Sent when joining (`/client/main.ts`).
  - `rewarded_ad`: Client ad completion report (`/client/main.ts`).
  - `ping`: RTT measurement (`/client/main.ts`).
  - `latency_report`: Synchronizes client latency to the server (`/client/main.ts`).
  - `reliable_event`: Client weapon actions (`RELOAD`, `CANCEL_RELOAD`, `TOGGLE_FIRE_MODE`) (`/server/index.ts`).
  - `PLAYER_QUIT`: Manual client exit (`/server/index.ts`).
  - `debug_get_state`: Dev inspection payload (`/server/index.ts`).
  - *Dev Commands:* `dev_spawn_bots`, `dev_spawn_cube`, `dev_toggle_god_mode`, `dev_force_match_end`, etc. (`/server/index.ts`).
- **Unreliable (Binary `rawEmit`):**
  - **Input Payload:** 20-byte `ArrayBuffer` defined in `/client/src/input/InputSynchronizer.ts`. Populated and sent at screen-refresh rate in `/client/src/systems/InputSystem.ts` (lines 559-566). Contains `[seq(uint32), mask(uint8), pitch(f32), yaw(f32), pendingFire(uint8), timestamp(uint32)]`.

### Server → Client
- **Reliable (Socket.IO JSON):**
  - `handshake`: Initial state synchronization sent on join or reconnect (`/server/MatchRoom.ts`).
  - `match_ready`: Sent when match logic is prepared (`/server/MatchRoom.ts`).
  - `pong`: Response to `ping` (`/server/index.ts`).
  - `reliable_event`: Game events such as `YOU_DIED`, `YOU_RESPAWNED`, `HIT_CONFIRMED`, `DRONE_HIT`, `DRONE_DEATH`, `MATCH_TERMINATED` (`/server/MatchRoom.ts`, `/server/index.ts`).
  - `state_sync`: 20Hz JSON fallback carrying players, projectiles, and zone data (`/server/MatchRoom.ts`).
  - `environmental_event`: Environment triggers parsed by the client (`/client/src/systems/NetworkSyncSystem.ts`).
  - `dev_collision_telemetry`: Physics debugging (`/server/MatchRoom.ts`).
  - `dev_server_tick_ms`, `dev_server_memory_mb`: Performance metrics (`/client/main.ts`).
- **Unreliable (Binary `rawEmit`):**
  - **Global Entity State:** Packed `ArrayBuffer` of size `TOTAL_STATE_BUFFER_SIZE` (1688 bytes, derived from `/shared/constants.ts` line 429). Sent at 20Hz (`/server/MatchRoom.ts` line 1490).
  - **Player Sync:** 20-byte `ArrayBuffer` containing `[serverTick(uint32), lastSequence(uint32), posX(f32), posY(f32), posZ(f32)]`. Sent at 20Hz (`/server/MatchRoom.ts` line 1500).

## 6. Server Startup
- **Entry Point:** `/server/index.ts`.
- **Initialization:** Express is instantiated at line 351 (`const app = express()`). `RAPIER.init()` sets up WASM physics (line 330).
- **Transport Setup:** At line 230, `io = createTransport();` is called.
- **HTTP Server Creation:** `const httpServer = createServer(app);` (line 352).
- **Port:** `const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;` (line 353).
- **Production Routing:** In development, Vite middleware handles static assets. In production, `/dist` is served statically, and all unhandled `GET` requests route to `/dist/index.html` (lines 1104-1108).

## 7. Client Startup
- **Entry Point:** `/client/main.ts`.
- **Renderer Setup:** `setup3DStage()` is invoked by `initClient()` at line 482. It attempts to create a `THREE.WebGPURenderer` (line 602), and falls back to a WebGL rendering context explicitly bypassing WebGPU if initialization fails or if `forceWebGL` is requested (lines 621-630).
- **Networking Startup:** Networking is explicitly deferred. `channel = createClientTransport()` is only called within `connectEngineSocket()` (line 497) once the user interacts with the UI.

## 8. Match Flow
1. Client starts execution. `/client/main.ts` initializes the UI and WebGPU/WebGL rendering pipeline.
2. User clicks "READY" in the lobby (`/client/screens/lobby.ts`), dispatching `start-match`.
3. `/client/main.ts` catches `start-match` (line 284), invokes `connectEngineSocket()` (line 373) to create the Socket.IO transport.
4. Client emits `start_match` (line 386/396).
5. `/server/index.ts` intercepts `start_match` (line 144) and maps the player into a `MatchRoom` via `currentRoom.registerPlayer(...)`.
6. `/server/MatchRoom.ts` emits `handshake` back to the client (line 514/522).
7. Client catches `handshake` in `/client/src/systems/NetworkSyncSystem.ts` (line 74), loading the map and spanning entities.
8. Server ticks at 60Hz physics / 20Hz sync. Client ticks input logic each display frame (`animateFrame()`).
9. Match ends via `MATCH_TERMINATED` `reliable_event` (emitted by `/server/MatchRoom.ts` line 122).
10. Player leaves by triggering `VEXEA_PLAYER_QUIT`, sending `PLAYER_QUIT` to the server (`/client/main.ts` line 1085).

## 9. AI Studio Workarounds
- **Transport Lock:** `/shared/transport.config.ts` hardcodes `TRANSPORT_MODE = 'socketio'`. The code comments explicitly state: "Geckos disabled due to AI Studio port restrictions".
- **Raw ArrayBuffer Emulation:** Because Socket.IO on AI Studio corrupts native `ArrayBuffer` payloads, `/server/transport/adapter.ts` (`SocketIOServerAdapter.rawEmit`, line 214) converts `ArrayBuffer` to an array of numbers (`Array.from(new Uint8Array(buffer))`) before transmission.
- **Port 3000 Consolidation:** Because AI Studio only exposes Port 3000 externally, `/server/index.ts` binds Express static files, Vite HMR middleware, and the Socket.IO instance to the exact same HTTP server object running on Port 3000 (lines 1092-1108).

## 10. Deployment Checklist
Based on the current architecture, deploying to a production host (like Render) requires:
1. Environment configuration: Ensure `NODE_ENV=production` is set in the hosting environment.
2. Firebase Admin Credentials: The environment must provide the `FIREBASE_SERVICE_ACCOUNT` JSON string or appropriate GOOGLE_APPLICATION_CREDENTIALS for `/server/index.ts` (line 252) to authenticate.
3. Build Step: Ensure `npm run build` is executed to generate the `/dist` directory for the Express static fallback logic (`/server/index.ts` line 1104).
4. Run Step: The execution command must launch the compiled Node server (e.g., `node dist/server.cjs` or equivalent based on package scripts) using `PORT=3000` (which is standard).
