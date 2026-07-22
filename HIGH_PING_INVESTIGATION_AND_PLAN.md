# High-Ping Gameplay Investigation & Remediation Plan

## Executive Summary
Despite the client and server running in the same local environment in AI Studio, the gameplay exhibits significant input latency ("~500ms ping feel"). Extensive codebase investigation reveals that this is caused by architectural netcode anti-patterns:
1. **The local controlled soldier entity is subjected to remote snapshot interpolation** (100ms render history delay buffer).
2. **Client-side prediction is missing for soldier movement** (the client waits for server state snapshots before rendering soldier transform updates).
3. **Input events are artificially throttled** (33ms minimum send interval in `InputSynchronizer.ts`).
4. **Full JSON snapshots are broadcast per frame over Socket.IO**, inducing main-thread serialization spikes.

---

## Detailed Root Cause Analysis

### 1. Local Player Subject to Snapshot Interpolation Delay (`INTERPOLATION_DELAY = 100ms`)
* **Location:** `client/src/systems/NetworkSyncSystem.ts` (lines 142–180) & `client/src/systems/DroneSystem.ts`
* **Evidence:** `NetworkSyncSystem` maintains a snapshot history buffer with `INTERPOLATION_DELAY = 100ms`. When rendering a frame at `now`, `renderTime = now - 100ms`. The client iterates over all entities—including the local player's soldier entity—and sets their positions based on interpolated snapshots from 100ms in the past.
* **Impact:** Every movement input executed locally experiences a minimum forced delay of **100ms + Round Trip Time (RTT) + Server Tick Interval + Socket framing time**.

### 2. Absence of Client-Side Prediction & Reconciliation
* **Location:** `client/src/systems/DroneSystem.ts` & `client/src/systems/SimulationSystem.ts`
* **Evidence:** In `DroneSystem.ts`, client-controlled soldier entities do not run predictive local physics simulation on input. Instead, positions are updated directly when `NetworkSyncSystem` feeds interpolated snapshot positions or when server state is copied (`this.body.position.copy(serverPos)`).
* **Impact:** The local player cannot move immediately on key press. Every keystroke must travel to the server, undergo server physics tick integration, be broadcast back in a snapshot, sit in the client 100ms interpolation buffer, and finally render.

### 3. Artificial Input Rate Limiting (33ms Minimum Interval)
* **Location:** `client/src/input/InputSynchronizer.ts` (lines 12–25)
* **Evidence:** `MIN_SEND_INTERVAL_MS = 33` restricts input packet transmissions to a maximum frequency of ~30Hz.
* **Impact:** Inputs are held in a local accumulator for up to 33ms before being sent over Socket.IO, adding another frame or two of input lag before packets leave the browser.

### 4. Heavy Uncompressed JSON Snapshot Overheads
* **Location:** `server/MatchRoom.ts` & `client/transport/adapter.ts`
* **Evidence:** `MatchRoom.ts` serializes and broadcasts large uncompressed state objects via Socket.IO on every tick.
* **Impact:** Main-thread JSON stringification/parsing creates event loop micro-stutters, contributing to snapshot delivery jitter.

---

## Direct Netcode Architecture Strategy (Authoritative Character Movement)

1. **Local Soldier Client-Side Prediction:**
   - On the client, input vectors (WASD, rotation, aim angle) apply immediately to the local soldier physics body/mesh position every client render frame.
   - Maintain an input history buffer keyed by sequence number ($Seq$).
   - Transmit inputs to the server with sequence tags and timestamps.

2. **Server Snapshot Reconciliation:**
   - Server processes inputs, integrates soldier physics, and returns authoritative state with `lastProcessedSeq` and ping RTT metadata.
   - Client reconciles authoritative server position and re-simulates unacknowledged inputs ($Seq_{ack+1} \dots Seq_{latest}$) if drift exceeds threshold.

3. **Remote Entities Interpolation:**
   - Keep 100ms snapshot interpolation exclusively for remote player soldiers, AI drones, and network-synced objects.

---

## HUD Match Status & Live Ping Diagnostic UI Plan

1. **Snippet Holder Extraction:**
   - Extract the original squad character avatars (`#squad-container` with `#squad-p1`–`#squad-p4`) from `client/hud_template.ts`.
   - Store it safely in `/client/hud_snippets.ts`.
   - Register `/client/hud_snippets.ts` in `CODEBASE_INDEX.md`.

2. **Top-Left Status HUD Button:**
   - In place of `#squad-container` in the top-left of the HUD, insert `#btn-match-status` using the compass background style (`background: rgba(0,0,0,0.3) !important; border: none !important;`).
   - Register `#btn-match-status` across UI interactions (`ui_editor.ts`, `InputSystem.ts` touch/click lock, `HUDSystem.ts`).

3. **Match Status & Ping Modal:**
   - Clicking `#btn-match-status` toggles an overlay displaying match details:
     - Player Icon / Avatar
     - Player Name
     - Match Statistics (K/D / Points placeholder layout)
     - **Live Ping & Netcode Diagnostic Panel** (RTT, Jitter, Input Queue Length, Server Tick Rate).

---

## Implementation Execution Steps

- **Step 1:** Create `/client/hud_snippets.ts` and register in `CODEBASE_INDEX.md`.
- **Step 2:** Update `client/hud_template.ts` with `#btn-match-status` and Match Status/Ping modal.
- **Step 3:** Implement live Ping calculation (heartbeat / packet RTT tracking) in `client/transport/adapter.ts` and `NetworkSyncSystem.ts`.
- **Step 4:** Integrate `#btn-match-status` event handling and modal rendering in `HUDSystem.ts`, `ui_editor.ts`, and `InputSystem.ts`.
- **Step 5:** Implement local player prediction in `DroneSystem.ts` and `NetworkSyncSystem.ts` (bypass 100ms interpolation for `localPlayerId`, update local position immediately, reconcile on server snapshot).
- **Step 6:** Optimize input send cadence in `InputSynchronizer.ts` (remove 33ms throttle).
- **Step 7:** Compile applet, lint, and verify high-ping feel remediation.
