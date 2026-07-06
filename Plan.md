# VEXEA: MatchController & System Refactor Plan

This plan outlines the migration of monolithic logic from `client/main.ts` and `client/src/systems/NetworkSyncSystem.ts` into a modular, system-based architecture managed by `MatchController`.

## Goals
1. **Separation of Concerns**: Each gameplay subsystem (Input, Drones, Combat, HUD, Visuals) should be a self-contained class.
2. **Lifecycle Management**: `MatchController` should handle the `init()`, `step()`, and `dispose()` cycles for all systems.
3. **Reduced main.ts Complexity**: Move the ~900 lines of input and rendering logic out of the main entry point.
4. **Clean Disposal**: Ensure all event listeners and visual assets are cleared when a match ends.

---

## Phase 1: Core System Definitions
- [x] **CombatSystem.ts**: Handle weapon firing, hitscan, and recoil.
- [x] **SimulationSystem.ts**: Handle server-authoritative physics sync and reconciliation.
- [x] **InputSystem.ts**: Handle keyboard/mouse/touch events and local physics stepping.
- [x] **Register Systems**: Add references to `MatchController.ts`.

## Phase 2: Input & Physics Migration
- [x] Move `executeLocalClientPhysics` logic to `InputSystem.step()`.
- [x] Move `setupControllerBinds` and all DOM event listeners to `InputSystem.setupEventListeners()`.
- [x] Update `main.ts` to call `match.input.step(dt)` inside the `animateFrame` loop.
- [x] **Zero-GC**: Ensure pre-allocated vectors/quaternions are class members in `InputSystem`.

## Phase 3: Drone & Remote Player Migration
- [x] **DroneSystem.ts**: Create system for drone interpolation and remote player rendering.
- [x] Move Dead Reckoning / Jitter Buffer logic from `main.ts` to `DroneSystem.step()`.
- [x] Handle remote player model cloning and animation mixers in `DroneSystem`.
- [x] Update `main.ts` to call `match.drones.step(dt)`.

## Phase 4: HUD & UI Migration
- [x] **HUDSystem.ts**: Manage health bars, ammo text, score, and death overlays.
- [x] Move `updateHUD`, `triggerUIFlash`, and `showDeathOverlay` from `NetworkSyncSystem`.
- [x] Update `NetworkSyncSystem` to use `match.hud` instead of direct DOM manipulation.
- [x] Ensure UI updates remain decoupled from core logic.

## Phase 5: Visuals & Environment Migration
- [x] **VisualsSystem.ts**: Handle scene setup, lighting, fog, and VFX updates.
- [x] Move lighting setup and map-specific decorations (moon, lights) to `VisualsSystem.init()`.
- [x] Move `updateVFX` call to `VisualsSystem.step()`.
- [x] Initialize `drone_models` and `weapons_model` within the visuals init sequence.

## Phase 6: Lifecycle & Cleanup
- [x] **Input Disposal**: Use `AbortController` in `InputSystem` to remove all listeners in `dispose()`.
- [x] **Visual Disposal**: Call `clearAllVisuals()` in `VisualsSystem.dispose()`.
- [x] **MatchController Stop**: Update `stop()` to call `dispose()` on all active systems.
- [x] **main.ts Cleanup**: Remove dead code, legacy variables, and exported helper functions that are now internal to systems.

---

## Verification Checklist
- [x] **No Allocations in Loop**: Verify `step()` methods use pre-allocated objects.
- [x] **Input Parity**: Ensure touch joystick and mouse look feel identical after migration.
- [x] **Drone Rendering**: Verify interpolation is still smooth and correction thresholds are respected.
- [x] **UI Updates**: Confirm health and ammo displays reflect server state correctly.
- [x] **Build Status**: `npm run build` must pass.
- [x] **Linting**: `npm run lint` must be clean.
