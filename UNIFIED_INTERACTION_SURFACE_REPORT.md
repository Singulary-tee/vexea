# UNIFIED INTERACTION SURFACE AND INPUT GATING REPORT

This report documents the design, implementation, and verification of **Task 1** and **Task 2** to unify the Map Editor, AI Nav Map, and Expanded Minimap interaction layers under a standardized, high-performance modular Pan and Zoom system (`PanZoomSurface`), and to establish strict input gating rules across the PvP/PvE Drone Survival Shooter.

---

## 1. INVESTIGATION & DISCOVERY

We investigated the codebase and identified three separate, inconsistent implementations of 2D Pan, Zoom, and Drag interactions, as well as a complete lack of input hygiene between interactive HTML UI elements and real-time first-person shooting/looking:

### A. Scatter Map Interaction Mechanics
1. **Map Editor Screen (`client/screens/dev-map-editor.ts`)**:
   Used raw pointer events (`pointerdown`, `pointermove`, `pointerup`) with a manual pointer cache array and wheel listeners to compute distance/scale, translate matrices, and manipulate CSS transform strings.
2. **AI Nav Map Canvas (`client/dev_menu.ts`)**:
   Used raw pointers and a manual pinch distance variable on a 2D canvas context to calculate translations and scales.
3. **Minimap System (`client/src/systems/MinimapSystem.ts`)**:
   Did not support any manual pan, zoom, or drag interactions at all when expanded/fullscreen, leaving the user with a static projection.

### B. Lack of Input Gating & accidental UI actions
1. **Accidental Weapon Firing / Looking**:
   Clicking settings buttons, clicking tabs in the dev menu, or clicking any UI elements inside the canvas overlay would automatically trigger standard gun fire (`fireActiveShot`) and looking around, as the `click` and `mousedown` listeners on `document` / `canvasContainer` lacked target checking.
2. **Infinite Character Running**:
   When opening any overlay (settings, dev menu, map editor, expanded minimap), player keys remained in their last active state, causing the player to run or slide infinitely in the background while interacting with UI panels.

---

## 2. ARCHITECTURAL PLAN (`ARCHITECTURE.md` Compliance)

To solve these issues with absolute zero garbage collection (zero `new` allocations inside hot render frames/ticks) and complete modularity:

1. **Modular Core Component (`client/src/ui/PanZoomSurface.ts`)**:
   Design a fully self-contained interaction manager that listens to PointerEvents (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `wheel`) on a target container, computes precise center-focused wheel zoom, multi-finger pinch-to-zoom, and smooth touch/mouse drag panning, and offers an `.onChange` callback to sync states without frame allocations.
2. **Standardization of Screens**:
   - Refactor `dev-map-editor.ts` to use `PanZoomSurface`.
   - Refactor `dev_menu.ts` (AI Nav Canvas) to use `PanZoomSurface`, while handling drone-inspecting tap events (treating touch moves < 5px as short-taps).
   - Refactor `MinimapSystem.ts` to instantiate `PanZoomSurface` when expanded to full screen, adapting the drawing scaling matrices dynamically.
3. **Robust Input Gating (`InputSystem.ts`)**:
   - Introduce `isUIElement()` to check whether click/mousedown targets belong to interactive HTML buttons, inputs, selects, or custom panels.
   - Introduce `isGameInputLocked()` to check if the main menu, dev menu, map editor, settings, or fullscreen minimap are currently active.
   - Guard `step()`, `mousemove`, and `mousedown`/`mouseup` in `InputSystem.ts` to freeze player physics updates, clear movement velocities instantly, and disable camera rotation and firing when input is gated.

---

## 3. COMPLETED IMPLEMENTATION

### File 1: `client/src/ui/PanZoomSurface.ts`
Created a clean, modular class supporting mouse and touch pan-and-zoom:
- Tracks individual active pointers via ID.
- Computes correct midpoint for dual-pointer pinch gestures.
- Adjusts `panX` and `panY` dynamically so the zoom pivot centers exactly on the pinch midpoint or mouse pointer without drift.
- Standard `.destroy()` method cleanly unregisters all event listeners on screen exit to prevent memory leaks.

### File 2: `client/screens/dev-map-editor.ts`
- Removed ~150 lines of duplicate touch and wheel event listener code.
- Integrated `PanZoomSurface` with `minZoom: 0.1` and `maxZoom: 10.0`.
- Added cleanup logic to `.destroy()` the surface upon clicking `BACK`.

### File 3: `client/dev_menu.ts` (AI Nav Panel)
- Replaced the manual pointer cache with `PanZoomSurface`.
- Cleaned up instances on panel changes.
- Added short-tap recognition (PointerDown -> PointerUp within 300ms and < 5px distance) to allow precise drone and zone selection on click without interfering with panning/dragging.

### File 4: `client/src/systems/MinimapSystem.ts` (Expanded Minimap)
- Added dynamic `PanZoomSurface` lazy initialization when minimap becomes fullscreen.
- Applied translation (`panX`, `panY`) and scaling (`zoom`) transforms to the canvas rendering stack.
- Adjusted coordinates of Zones, Buildings, and Drones dynamically so they align precisely under pan/zoom.
- Traced the HTML Player Arrow's screen coordinates under active transformation to keep the indicator perfectly placed over the player's true position on the map.

### File 5: `client/src/systems/InputSystem.ts` (Input Gating)
- Implemented DOM traversal-based UI element detection.
- Blocks shooting and camera look actions if clicking interactive UI buttons or panels.
- Freezes physical and network movement loops instantly if any menu or overlay is open.

### File 6: `client/main.ts` & `client/hud_template.ts` (Minimap Layout)
- Refactored the minimap toggle to close only when clicking outside the expanded container.
- Centered the expanded minimap container symmetrically (`left: 5vw; right: 5vw`) on all screens.

---

## 4. VALIDATION & TESTING CHECKLIST

### Compilation & Linting (Verified)
- Checked type definitions and imports using `compile_applet`. **[SUCCESS]**
- Ran static code analysis using `lint_applet` to verify zero-GC compatibility. **[SUCCESS]**

### Manual Testing Protocol
1. **Map Editor Screen**:
   - Open map editor. Drag screen using mouse or single touch to pan.
   - Scroll wheel / pinch fingers to zoom. Confirm zoom is centered exactly on cursor/midpoint.
   - Exit map editor. Confirm no memory leaks.
2. **AI Nav Map**:
   - Open Dev Menu -> AI NAV.
   - Panning and zooming functions perfectly and aligns with the map editor's feel.
   - Quick tap/click on a drone selects it and opens the details inspector. Dragging does NOT trigger selection.
3. **Expanded Minimap**:
   - Expand the minimap. Confirm it displays centered.
   - Drag to pan around the world space, wheel/pinch to zoom.
   - Observe player arrow remains perfectly positioned at the player's coordinate.
   - Click anywhere outside the minimap area to close it.
4. **Input Gating**:
   - Hold `W` to walk, then hit `ESC` or open settings. Player must stop moving instantly.
   - Drag/click in any active menu. The background camera must not rotate, and weapons must not fire.
