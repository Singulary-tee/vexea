
---

"Read Architecture.md, GAMEPLAY.md, and client/design-system.ts in full before writing a single line. This prompt fixes 8 issues. No patch scripts. Direct file edits only. Do not touch game logic, drone systems, LLM commander, networking, or the in-game HUD.

---

**Fix 1 — Firestore Security Rule:**

Add exactly this rule to firestore.rules. Do not modify any existing rules:

```
match /feedback/{docId} {
  allow create: true;
}
```

No other rules change.

---

**Fix 2 — Log Audit and Removal:**

On the server: remove `[TRANSPORT] Broadcast tick` entirely from the server transport adapter. Then audit every file in the server directory — find every `console.log`, `console.warn`, and `console.error` that fires inside a `setInterval`, `setImmediate`, or any game tick loop. Remove all of them. The only server logs that survive are those that fire on discrete events: connection, disconnection, errors thrown outside loops, and the `[TRANSPORT] Mode` startup log.

On the client: remove `[TRANSPORT] Raw received` entirely from the client transport adapter. Then audit every file in the client directory — find every `console.log` firing on a recurring interval, inside a render loop, or inside a network message handler. Remove all of them.

After removal, the console must be silent during normal gameplay except for connection and disconnection events.

---

**Fix 3 — Portrait Lock:**

In `index.html`, immediately after the opening `<body>` tag, add this element:

```html
<div id="portrait-lock" style="
  display: none;
  position: fixed;
  inset: 0;
  background: #0A0A0A;
  z-index: 99999;
  align-items: center;
  justify-content: center;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 24px;
  letter-spacing: 8px;
  color: #C8882A;
  text-transform: uppercase;
">ROTATE DEVICE</div>
```

Add this script immediately after:

```javascript
(function() {
  const lock = document.getElementById('portrait-lock');
  function checkOrientation() {
    const isPortrait = window.innerHeight > window.innerWidth;
    lock.style.display = isPortrait ? 'flex' : 'none';
  }
  window.addEventListener('resize', checkOrientation);
  window.addEventListener('orientationchange', checkOrientation);
  checkOrientation();
})();
```

No CSS pseudo-elements. No media queries for this. The DOM element approach works regardless of overflow or z-index stacking from other elements.

---

**Fix 4 — Screen Manager:**

Create `client/screens/screen-manager.ts`.

This is the single authority for all screen transitions. No screen mounts or unmounts itself. All screen logic routes through these five functions only:

```typescript
showSplash()
showMainMenu()
showLobby()
showGame()
hideAll()
```

`hideAll()`: sets every screen div to `opacity: 0` then `display: none` after 300ms. Cancels any pending transition timers.

Each `show` function: calls `hideAll()`, waits 300ms, sets target screen to `display: flex`, then transitions opacity from 0 to 1 over the screen-specific duration.

Exception: `showSplash()` shows immediately with no hideAll delay — it is the first screen.

The game canvas and HUD are never touched by screen-manager. They exist permanently behind all screens.

Remove completely: every reference to the old start game screen, the old map editor screen, and any other pre-existing screen that is not SPLASH, MAIN_MENU, LOBBY, or GAME. Delete their HTML, their mount calls, and their files if they exist as standalone files. They must not appear under any circumstances.

---

**Fix 5 — Splash Screen (complete rewrite):**

Create or fully replace `client/screens/splash.ts`.

The splash div: position fixed, inset 0, z-index 1000, display flex, flex-direction column, align-items center, justify-content center.

Background: `background-image: url('/splash_screen.png')`, `background-size: cover`, `background-position: center center`. Fallback if image missing: `background: radial-gradient(ellipse at center, #1A1208 0%, #0A0A0A 100%)`.

Vignette child div: position absolute, inset 0, `background: radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.85) 100%)`, pointer-events none, z-index 1.

All content sits at z-index 2 above vignette.

Content wrapper: position absolute, top 66%, left 50%, transform translate(-50%, -50%), display flex, flex-direction column, align-items center, gap 0.

Loading bar wrapper: width 120px, height 2px, background #1A1A1A, overflow hidden.
Loading bar inner: height 100%, width 0, background #C8882A, transition width 2000ms ease-in-out.

INITIALIZE text: font Barlow Condensed, font-size 14px, letter-spacing 6px, color #E8E8E8, text-transform uppercase, opacity 0, margin-top 0, height 0, overflow hidden.

**Sequence on mount:**
1. After 100ms: set loading bar inner width to 120px — starts 2000ms fill animation.
2. After 2100ms (bar complete): fade loading bar wrapper opacity to 0 over 200ms.
3. After 2300ms (bar gone): set INITIALIZE text height to auto, fade opacity to 1 over 500ms.
4. After 2800ms (text fully visible): begin breathing — CSS animation cycling opacity between 0.6 and 1.0 over 2000ms infinite.
5. After 2800ms: add event listeners for `keydown`, `mousedown`, `touchstart` on document.

**On any input event after step 5:**
1. Call `document.documentElement.requestFullscreen()` — this is the only place fullscreen is requested in the entire codebase.
2. Remove all three event listeners immediately.
3. Execute glitch sequence:
   - Toggle splash div opacity 4 times, 80ms each: 1→0→1→0→1
   - During toggles 1-2: apply `filter: hue-rotate(90deg) brightness(2)`
   - During toggles 3-4: remove filter
   - Simultaneously: inject a scanline div — position fixed, width 100%, height 3px, background #C8882A, top 0, transition top 320ms linear, set top to 100vh
   - After 320ms: remove scanline div, call `screen-manager.showMainMenu()`

---

**Fix 6 — Main Menu (complete rewrite):**

Create or fully replace `client/screens/main-menu.ts`.

The main menu div: position fixed, inset 0, z-index 900, display none initially.

Background: same `splash_screen.png`, same vignette overlay as splash. Reuse the same CSS — do not load the image twice in memory. The background persists visually across the glitch transition.

**Layout — two regions:**

Top bar: height 80px, padding 0 32px, display flex, align-items center, justify-content space-between, position relative, z-index 2.
- Left: VEXEA wordmark. Barlow Condensed 48px #C8882A letter-spacing 4px.
- Center: player identifier. Barlow Condensed 14px. Guest: "GUEST — [6 char random alphanumeric]" color #888888. Logged in: "[USERNAME] — [FACTION]" color #E8E8E8.
- Right: settings gear SVG icon, 24px, color #888888, cursor pointer. On click: opens settings overlay.

Content area: position absolute, top 80px, left 32px, bottom 32px, width 65%, display grid, grid-template-columns repeat(2, 1fr), grid-template-rows repeat(3, 1fr), gap 16px.

The right 35% of the viewport is intentionally empty. No element occupies it. The background image shows through. This is not an accident — it is deliberate breathing space.

**Card structure — all 6 cards follow this exact pattern:**

Card div: position relative, overflow hidden, cursor pointer, border: none, no border-radius anywhere.

Image layer: position absolute, inset 0, z-index 1. For MVP use CSS gradient per card as the image placeholder. Structure must accept a real image later — when a real image is added, it replaces the gradient as a `background-image: url(...)` with `background-size: cover background-position: center`.

Gradient overlays — two layers both at z-index 2:
- Full card subtle darkening: `background: rgba(0,0,0,0.3)`
- Bottom gradient: position absolute, bottom 0, left 0, right 0, height 50%, `background: linear-gradient(transparent, rgba(0,0,0,0.92))`

Content: position absolute, bottom 0, left 0, right 0, z-index 3, padding 16px.
- Title: Barlow Condensed 24px uppercase bold #E8E8E8, margin 0.
- Subtitle: Barlow Condensed 14px #888888 regular, margin 4px 0 0 0, white-space nowrap, overflow hidden, text-overflow ellipsis.

Selected/hover state: add `outline: 2px solid #C8882A` on hover. Transition 150ms. No background change — the outline is enough.

**The 6 cards with their placeholder gradients and content:**

1. MULTIPLAYER
Gradient: `linear-gradient(135deg, #0D1117 0%, #1A0A0A 100%)`
Title: MULTIPLAYER
Subtitle: Co-op infiltration. 5–10 contractors.
On click: `screen-manager.showLobby()`

2. PROFILE
Gradient: `linear-gradient(135deg, #0D1117 0%, #0A0A1A 100%)`
Title: PROFILE
Subtitle guest: Sign in to save progress. / Subtitle logged in: [FACTION NAME]
On click: show Coming Soon alert for now.

3. FACTION
Gradient: `linear-gradient(135deg, #0D1117 0%, #0A1A0A 100%)`
Title: FACTION
Subtitle: Vibe Co. or Slop Inc.
On click: Coming Soon alert.

4. INSTANT FEEDBACK
Gradient: `linear-gradient(135deg, #131109 0%, #1A1500 100%)`
Title: INSTANT FEEDBACK
Subtitle: Rate your experience.
On click: show feedback modal (spec below).

5. STORE
Gradient: `linear-gradient(135deg, #0D1117 0%, #111117 100%)`
Title: STORE
Subtitle: Coming soon.
Opacity: 0.35. Pointer-events: none. No hover state.

6. STATISTICS
Gradient: `linear-gradient(135deg, #0D1117 0%, #0A0A0A 100%)`
Title: STATISTICS
Subtitle: Matches. Eliminations. Extractions.
On click: Coming Soon alert.

**Feedback modal:**
Position fixed, inset 0, z-index 1100, background rgba(0,0,0,0.85), display flex, align-items center, justify-content center.

Inner card: width 400px, max-width 90vw, background #111111, border 1px solid #2A2A2A, padding 32px, no border-radius.

Title: FEEDBACK, Barlow Condensed 24px #E8E8E8 uppercase, margin-bottom 24px.

Star row: 5 buttons in a row, gap 8px. Each button: 40px width 40px height, background transparent, border none, font-size 28px, cursor pointer, color #2A2A2A. Selected and hovered stars: color #C8882A. Clicking a star selects it and all stars before it.

Textarea: display block, width 100%, height 120px, margin-top 16px, background #0A0A0A, border 1px solid #2A2A2A, border-radius 0, color #E8E8E8, font-family Barlow Condensed, font-size 14px, padding 12px, resize none, placeholder "Describe your experience."

SUBMIT button: display block, width 100%, height 48px, margin-top 16px, background #C8882A, border none, border-radius 0, color #0A0A0A, font-family Barlow Condensed, font-size 24px, font-weight bold, text-transform uppercase, cursor pointer. On click: write to Firestore collection `feedback` with fields `rating` (number), `text` (string), `timestamp` (serverTimestamp()), `userId` (Firebase Auth UID or guest string). Then close modal.

CANCEL: display block, width 100%, margin-top 12px, text-align center, font-size 14px, color #888888, cursor pointer, text-decoration underline. On click: close modal without writing.

---

**Fix 7 — Lobby Class Cards (complete rewrite):**

Create or fully replace `client/screens/lobby.ts`.

Lobby div: position fixed, inset 0, z-index 800, background #0A0A0A, display none initially.

**Top section — 60% of viewport height:**
Display flex, flex-direction row. On mobile landscape: overflow-x auto, scroll-snap-type x mandatory, -webkit-overflow-scrolling touch. On desktop: no scroll, flex items fill width equally.

4 class cards. Each: flex 1, min-width 180px, height 100%, position relative, overflow hidden, cursor pointer, no border-radius, scroll-snap-align start.

Same full-bleed card structure as main menu cards. Gradient placeholders:
- ASSAULT: `linear-gradient(180deg, #1A0A0A 0%, #080808 100%)`
- MEDIC: `linear-gradient(180deg, #0A1A0A 0%, #080808 100%)`
- RECON: `linear-gradient(180deg, #0A0A1A 0%, #080808 100%)`
- DEMOLITIONS: `linear-gradient(180deg, #1A1A0A 0%, #080808 100%)`

Content at bottom z-index 3 padding 16px:
- Class name: Barlow Condensed 24px uppercase bold #E8E8E8
- Role description: 14px #888888 — use exact text from GAMEPLAY.md for each class
- Two utility names: 12px #555555 — use exact utility names from GAMEPLAY.md

Selected state: `outline: 2px solid #C8882A` on all four sides. Background overlay: `rgba(200,136,42,0.06)`. Default selected: ASSAULT.

Gap between cards: 8px.

**Bottom section — 40% of viewport height:**
Padding 24px, display flex, flex-direction column.

Section header row: display flex, align-items center, gap 16px, margin-bottom 16px.
- Label: CONTRACTORS, Barlow Condensed 14px uppercase #888888 letter-spacing 4px, white-space nowrap.
- Line: flex 1, height 1px, background #2A2A2A.

Player list: flex 1, overflow-y auto. Each row: display flex, justify-content space-between, align-items center, padding 8px 0, border-bottom 1px solid #111111. Animate in: opacity 0 to 1 over 200ms on append.
- Local player row: border-left 3px solid #C8882A, padding-left 8px.
- Name: Barlow Condensed 14px #E8E8E8.
- Faction: Barlow Condensed 14px. Vibe Co.: #4A9EFF. Slop Inc.: #FF6B35. Unaffiliated/guest: #555555 text "UNAFFILIATED".
- Class: Barlow Condensed 14px #888888.

Bottom action bar: display flex, justify-content space-between, align-items center, padding-top 16px, border-top 1px solid #2A2A2A, margin-top auto.

BACK button: height 48px, padding 0 24px, background transparent, border 1px solid #2A2A2A, color #888888, Barlow Condensed 24px uppercase, no border-radius, cursor pointer. On click: `screen-manager.showMainMenu()`.

READY button: height 48px, padding 0 32px, background #C8882A, border none, color #0A0A0A, Barlow Condensed 24px bold uppercase, no border-radius, cursor pointer. On press: background becomes #8A5C1A. Emits ready event via transport adapter.

---

**Fix 8 — Settings Screen Consistency:**

The existing settings screen must be updated to match the design system. Do not rebuild it — restyle it.

Changes only:
- Background: #0A0A0A
- All fonts: Barlow Condensed. Import from Google Fonts if not already imported.
- Sidebar category tabs: background #111111, border-right 1px solid #2A2A2A, selected tab: border-left 3px solid #C8882A, background #161616.
- All tab labels: Barlow Condensed 14px uppercase #888888. Selected: #E8E8E8.
- Content panel background: #0A0A0A.
- All section headers: Barlow Condensed 14px uppercase #888888 letter-spacing 4px, border-bottom 1px solid #2A2A2A, padding-bottom 8px margin-bottom 16px.
- All sliders: accent-color #C8882A.
- All toggles: when active background #C8882A.
- All buttons in settings: same pattern as BACK button — height 48px, border 1px solid #2A2A2A, background transparent, color #E8E8E8, Barlow Condensed, no border-radius.
- No border-radius on any element anywhere in settings.
- Spacing: all padding and margins must be multiples of 8px only.

---

**Final constraints:**
- No patch scripts. Direct file edits only.
- No border-radius on any element in any screen anywhere.
- All color values imported from design-system.ts — zero hardcoded hex values in screen files.
- splash_screen.png is the background image for splash and main menu. Reference it as `/splash_screen.png`.
- The old start game screen and map editor screen are completely removed — files deleted, mount calls removed, HTML removed.
- After completing everything list: every file created, every file modified, every file deleted. Confirm old screens are gone. Confirm portrait lock is a real DOM element. Confirm fullscreen is requested on first input only."