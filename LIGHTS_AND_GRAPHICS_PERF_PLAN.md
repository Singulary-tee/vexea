# Light Effects and Graphics Settings Decoupling Plan

## Part 1: In-Game Light Effects Optimization (Muzzle Flash & Explosions)

### Findings
- Previously, Option 1 (toggling `.visible` on PointLights) caused WebGPU shader pipeline rebuilds/light graph updates, introducing severe frame spikes whenever a gun fired or an explosion occurred.
- Option 2 (keeping lights `.visible = true` at `0` intensity) avoided graph rebuilds but added 8–12 point light evaluations to every object/pixel rendered in the scene. Under WebGPU forward rendering, calculating 10 point lights per pixel across high-DPI viewports severely bottlenecked fragment shader execution (resulting in 6 FPS).

### Solution
1. **Reduce Maximum Active Point Light Count to 3**:
   - In `client/src/vfx/firing.ts`: Limit muzzle flash point light instances to 2 max in the pool.
   - In `client/src/vfx/large.ts`: Limit explosion point light instances to 1 max in the pool.
   - Total scene point lights capped at 3 maximum (2 muzzle + 1 explosion).
2. **Dedicated Flashlight / Dynamic Lights Toggle**:
   - Introduce a dedicated setting `flashLight` / "Dynamic Lights (Muzzle Flash / Explosions)" toggle in the Settings UI under Lighting & Effects.
   - Allows users to disable all dynamic point lights independently of graphics quality presets.

---

## Part 2: Graphics Setting Coupling & Pixel Ratio Investigation

### Findings
1. **Pixel Ratio Hard-Coupling**:
   - In `client/settings.ts`, `W.renderer.setPixelRatio(...)` was evaluated based directly on `s.graphicsPreset`:
     - `Low` preset enforced `0.75x`.
     - `Medium` preset enforced `1.5x`.
     - Any other setting (including `'Custom'`) fell into an `else` clause that forced `window.devicePixelRatio` (native device resolution, often 2.0x to 3.0x on mobile/Retina screens).
   - Toggling *any* individual setting (e.g. `instancedProps`, `shadows`, `vignette`) changed `s.graphicsPreset` to `'Custom'`.
   - As a result, toggling a lightweight option while in `Low` preset immediately jumped pixel ratio from `0.75` to native `2.0+` (a 4x to 9x increase in rendered pixels), causing the frame rate to instantly drop from 60 FPS to 6 FPS.
2. **Preset Overwrite Coupling**:
   - Presets previously overwrote all custom settings indiscriminately without allowing fine-grained control over resolution scale or dynamic light instantiation.

### Solution
1. **Decouple Pixel Ratio Scale**:
   - Add a dedicated `pixelRatioMode` setting in `GameSettings` with choices:
     - `'0.75'` (Low / Fast 0.75x)
     - `'1.0'` (Balanced 1.0x)
     - `'1.5'` (High Quality 1.5x)
     - `'native'` (Max Native DPI)
   - Add a horizontal radio selector box in the Graphics Settings UI under Engine & Geometry for **Pixel Ratio Scale**.
   - `applySettings()` will read `s.pixelRatioMode` directly, completely decoupling resolution scale from `graphicsPreset`.
2. **Decouple Flashlight / Dynamic Lights Toggle**:
   - Add a dedicated checkbox toggle in the Graphics Settings UI under Lighting & Effects for **Dynamic Lights (Muzzle / Explosions)** (`inp-flashLight`).
   - When quality presets are clicked, defaults are set (`0.75` / `off` for Low; `1.5` / `on` for Medium; `native` / `on` for High), but modifying any individual control will preserve `pixelRatioMode` and `flashLight` values as customized by the user.

---

## Implementation Steps
1. **`client/settings.ts`**:
   - Update `GameSettings` interface and `DEFAULT_SETTINGS` with `pixelRatioMode` and `flashLight`.
   - Update `applySettings()` to set `setPixelRatio()` according to `s.pixelRatioMode`.
   - Add UI HTML elements for Pixel Ratio radio buttons and Dynamic Lights checkbox.
   - Bind change events for new UI controls.
   - Update presets to populate `pixelRatioMode` and `flashLight`.
2. **`client/src/vfx/firing.ts`**:
   - Cap point lights created in pool to max 2 instances (`POOL_LIGHTS_COUNT = 2`).
3. **`client/src/vfx/large.ts`**:
   - Cap point lights created in pool to max 1 instance (`LARGE_LIGHTS_COUNT = 1`).
4. **`client/src/vfx/VFXOrchestrator.ts` & `client/src/systems/VisualsSystem.ts`**:
   - Pass `getSettings().flashLight` when initializing firing and large VFX.
5. **Verification**:
   - Run `compile_applet` to ensure type safety and build success.
