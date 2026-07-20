# UI Investigation & Platform Gating Report

## 1. Class Selection Screen (`/client/screens/lobby.ts`)
**Status:** Mostly hardcoded and static.
**Analysis:** 
The class selection screen uses vanilla JS DOM manipulation to construct the interface but relies on rigid, non-responsive rules.
- **Static Detection:** It checks if the screen is desktop or mobile only once during initialization (`const isDesktop = window.innerWidth > window.innerHeight;`).
- **Platform Gating Needs:** Should utilize the new `platform-gate.ts` instead of inline checks, but primarily needs responsive CSS rewrites (using `clamp()`) to adapt dynamically to screen constraints.

## 2. Main Menu (`/client/screens/main-menu.ts`)
**Status:** Fully dynamic and responsive.
**Analysis:** 
- **Fluid Sizing:** Uses CSS `clamp()` and viewport relative units (`vw`/`vh`) extensively. 
- **Conclusion:** Highly responsive and cleanly implemented.

## 3. In-Game HUD & Controls (`/client/hud_template.ts`)
**Status:** Highly responsive to screen size, but **NOT** platform-aware.
**Analysis:** 
The HUD layout scales proportionally avoiding fixed pixels (`vw`/`vh`).
- **Platform Awareness Flaw:** Mobile-specific controls (`#joystick-boundary`, `#btn-sprint`, action buttons) are rendered regardless of the platform.
- **Platform Gating Needs:** The `platform-desktop` CSS class appended to the `body` by the gate must be used to automatically hide these touch-specific HUD elements on desktop devices.

## 4. Input Processing & Pointer Lock (`/client/src/systems/InputSystem.ts` & `/client/input.ts`)
**Status:** Blindly attempts to bind both paradigms.
**Analysis:**
- **Mouse/Pointer Lock:** Unconditionally attempts to request pointer lock on screen clicks. On mobile, this creates terrible UX.
- **Touch Controls:** Unconditionally bound even on desktop.
- **Platform Gating Needs:** 
  - `requestPointerLock()` must be gated entirely behind `IS_DESKTOP`. 
  - Touch control event listeners (for the joystick and buttons) should be skipped or ignored on desktop to avoid unnecessary processing.

## 5. "Rotate Device" / Portrait Lock Layer (`/client/index.html`)
**Status:** Indiscriminately targets any narrow aspect ratio.
**Analysis:**
- **The Flaw:** `index.html` has a raw script checking `window.innerHeight > window.innerWidth`. If a desktop user resizes their window to be narrow, they get locked out with a "ROTATE DEVICE" screen.
- **Platform Gating Needs:** This logic must be updated to check `IS_MOBILE` (or the equivalent platform class) before displaying the lock screen. Desktop users should be allowed to have narrow windows.

## 6. Settings Configuration & Default Values (`/client/settings.ts`)
**Status:** Universal defaults applied blindly.
**Analysis:**
- **Quality Settings:** Currently hardcodes presets like Bloom, Shadows, and High Quality globally. 
- **Platform Gating Needs:** We will import `IS_MOBILE` from `platform-gate.ts` to establish conditional default overrides (e.g., setting the baseline to 'Low' on mobile, disabling heavy post-processing). *Note: The Maximum setting options will remain identical and accessible on both platforms—only the defaults will differ.*
- **Keyboard/Keybinding Configuration:** Any future keyboard settings menus must be hidden on mobile by default, and should only be accessible if the user toggles a "Using External Keyboard" switch.

## 7. Unified Pan & Zoom Surface (`/client/src/ui/PanZoomSurface.ts`)
**Status:** Built to support both mouse (wheel, drag) and touch (pinch, pan).
**Analysis:**
- **Platform Gating Needs:** While robust, event listeners for pinch/touch operations (`activePointers` tracking) could be optimized or bypassed on desktop. Conversely, desktop-specific features (mouse wheel zoom) don't need to be attached on pure mobile deployments.

## 8. HUD/UI Editor (`/client/ui_editor.ts`)
**Status:** Used to absolute-position the mobile HUD elements.
**Analysis:**
- **Platform Gating Needs:** If launched on a desktop browser for development/editing purposes, the UI Editor *must* temporarily force the touch controls to be visible (overriding the `.platform-desktop` hiding rule). Otherwise, the developer won't be able to see or arrange the mobile layout.

## 9. Core Initialization (`/client/main.ts`)
**Status:** Contains redundant local definitions.
**Analysis:**
- **Platform Gating Needs:** The local regex check `const isMobileDevice = ...` in `main.ts` must be removed. The unified `initPlatformGate()` from `platform-gate.ts` should be invoked as early as possible in the bootstrap sequence.

## 10. Device Pixel Ratio (`/client/settings.ts` & `/client/main.ts`)
**Status:** Redundant clamp logic.
**Analysis:**
- **Platform Gating Needs:** Mobile devices often have huge pixel ratios (e.g., `window.devicePixelRatio = 3`) but weak GPUs. We should use `IS_MOBILE` to aggressively clamp `pixelRatio` defaults (e.g. `1.0` or `1.5` max) on mobile by default, while allowing desktop to use higher native values unless downgraded by the user.

## 11. Fullscreen Button & Requests (`/client/map_editor.ts` & `/client/settings.ts`)
**Status:** Present on both.
**Analysis:**
- **Platform Gating Needs:** Fullscreen behavior differs; forcing fullscreen is critical on mobile to hide the browser UI, but on Desktop it might be jarring if forced without explicit request. This should be taken into consideration in `lobby.ts` (the "READY" button synchronously requests fullscreen, which may need to be gated or handled differently).

## 12. Context Menu Restrictions (`/client/src/systems/InputSystem.ts`)
**Status:** Unconditionally prevents default context menu.
**Analysis:**
- **Platform Gating Needs:** The canvas container currently blocks the right-click `contextmenu` event completely. While necessary for gameplay (ADS on right click), we might need to ensure this doesn't conflict with normal mobile touch-and-hold interactions if those ever become relevant, or limit its scope if the user uses a mouse on a mobile device.

## 13. UI Mocks & Placeholders
**Status:** Remnants of temporary UI implementations exist.
**Analysis:**
- **Compass Placeholder:** `/client/src/systems/CompassSystem.ts` and `/client/hud_template.ts` use a `#compass-placeholder` div that is dynamically replaced with a canvas. This could be structured more cleanly if the canvas was defined directly in the HUD template or handled uniformly.
- **Privacy Policy Placeholder:** `/client/settings.ts` has a hardcoded text: "Placeholder text for privacy policy. No user personal data is collected." Needs real copy or removal.
- **Mock Local Player:** `/client/screens/lobby.ts` contains a `// Add local player mock` comment and logic for rendering the UI list of players in the lobby. This should be replaced with real data bindings from the backend connection.
