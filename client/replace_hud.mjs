import { readFileSync, writeFileSync } from 'fs';
import { svgs } from '../shared/load_svgs.mjs';

const hudContent = `
<style>
/* 
   EXACT 1681x936 PROPORTIONAL HUD LAYOUT 
   All layout is responsive based purely on vw/vh. No fixed px conflicts.
*/
#hud-container {
  position: absolute !important;
  inset: 0 !important;
  pointer-events: none !important;
  user-select: none !important;
  font-family: 'Rajdhani', sans-serif !important;
  letter-spacing: 0.1em !important;
  z-index: 10 !important;
  margin: 0 !important;
  padding: 0 !important;
  color: white !important;
}
#hud-container * { box-sizing: border-box; }

#look-zone-right {
  position: absolute !important;
  top: 0 !important;
  right: 0 !important;
  width: 50% !important;
  height: 100% !important;
  pointer-events: auto !important;
}

/* SQUAD - TOP LEFT */
#squad-container {
  position: absolute !important;
  top: 2.1vh !important;
  left: 1.5vw !important;
  display: flex !important;
  flex-direction: row !important;
  gap: 1vh !important;
  pointer-events: auto !important;
}
.squad-circle {
  position: relative !important;
  width: 3.5vw !important;
  height: 3.5vw !important;
  min-width: 32px !important;
  min-height: 32px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: 1px solid #22c55e !important;
  color: white !important;
}

/* TIMERS & TEXT - TOP CENTER */
#hud-timer-container {
  position: absolute !important;
  top: 2.1vh !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  text-align: center !important;
  background: transparent !important;
}
#hud-timer {
  font-weight: bold !important;
  white-space: nowrap !important;
  font-size: clamp(14px, 1.8vw, 22px) !important;
  background: transparent !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
#hud-location {
  color: white !important;
  white-space: nowrap !important;
  font-size: clamp(9px, 1.1vw, 13px) !important;
  background: transparent !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

/* MINIMAP - TOP RIGHT */
#minimap-container {
  position: absolute !important;
  top: 2.1vh !important;
  right: 1.5vw !important;
  width: 14vw !important;
  height: 14vw !important;
  min-width: 100px !important;
  min-height: 100px !important;
  pointer-events: auto !important;
  background: transparent !important;
  border: 1px solid white !important;
  border-radius: 8px !important;
  overflow: hidden !important;
}
#minimap-canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}
#minimap-label {
  position: absolute !important;
  /* Float below minimap with gap */
  top: calc(2.1vh + 14vw + 12px) !important;
  right: 1.5vw !important;
  width: 14vw !important;
  text-align: center !important;
  color: white !important;
  background: transparent !important;
  font-weight: bold !important;
  font-size: clamp(10px, 1.1vw, 14px) !important;
  border: none !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
#minimap-label svg {
  height: 12px !important;
  width: auto !important;
  color: white !important;
}
@media (max-width: 714px) {
  #minimap-label {
    top: calc(2.1vh + 100px + 12px) !important;
    width: 100px !important;
  }
}

/* SIDEKICK UTIL BUTTONS - COLUMN LEFT OF MINIMAP */
.btn-sidekick {
  position: absolute !important;
  right: 17.5vw !important;
  width: 5vw !important;
  height: 5vw !important;
  min-width: 48px !important;
  min-height: 48px !important;
  background: transparent !important;
  border: none !important; /* No outline */
  pointer-events: auto !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: white !important;
}
#btn-settings { top: 2vh !important; }
#btn-mic { top: 12vh !important; }
#btn-chat { top: 22vh !important; }
@media (max-width: 714px) {
  .btn-sidekick {
    right: calc(1.5vw + 100px + 20px) !important;
  }
}

/* SETTINGS MODAL */
#settings-modal {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80vw;
  max-width: 450px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid #444;
  border-radius: 8px;
  padding: 20px;
  display: none; /* hidden by default */
  pointer-events: auto;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.settings-row label {
  font-size: 14px;
}
.settings-row input[type=range] {
  width: 60%;
}
#btn-close-settings {
  align-self: flex-end;
  background: white;
  color: black;
  border: none;
  border-radius: 4px;
  padding: 5px 15px;
  font-weight: bold;
}
#btn-modal-fullscreen {
  background: transparent;
  border: 1px solid white;
  color: white;
  border-radius: 4px;
  padding: 10px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
#btn-modal-fullscreen svg {
  width: 20px !important;
  height: 20px !important;
}

/* MOVEMENT & JOYSTICK - BOTTOM LEFT */
#joystick-boundary {
  position: absolute !important;
  left: 4.9vw !important;
  bottom: 9vh !important;
  width: 18.75vw !important;
  height: 18.75vw !important;
  min-width: 150px !important;
  min-height: 150px !important;
  pointer-events: auto !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: 1px solid rgba(255,255,255,0.2) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}
#joystick-knob {
  width: 35% !important;
  height: 35% !important;
  border-radius: 50% !important;
  background: white !important;
}

#btn-sprint {
  position: absolute !important;
  left: 17vw !important;
  bottom: 35vh !important;
  width: 5.4vw !important;
  height: 5.4vw !important;
  min-width: 50px !important;
  min-height: 50px !important;
  pointer-events: auto !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: 1px solid white !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: white !important;
}

#btn-fire-left {
  position: absolute !important;
  left: 25vw !important;
  bottom: 18vh !important;
  width: 6.75vw !important;
  height: 6.75vw !important;
  min-width: 66px !important;
  min-height: 66px !important;
  pointer-events: auto !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: 1px solid white !important;
  display: none !important;
  align-items: center !important;
  justify-content: center !important;
  color: white !important;
}

/* HEALTH BAR (Filled Rectangle) */
#health-bar {
  position: absolute !important;
  bottom: 2.5vh !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  width: 35vw !important;
  height: 2vh !important;
  min-height: 12px !important;
  background: transparent !important;
  border: 1px solid white !important;
  overflow: hidden !important;
}
#health-bar-fill {
  width: 100% !important;
  height: 100% !important;
  background: white !important;
}
#health-text-wrap {
  position: absolute !important;
  inset: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  pointer-events: none !important;
}
#health-text {
  font-weight: bold !important;
  color: black !important;
  font-size: clamp(8px, 0.9vw, 11px) !important;
  display: block !important;
}
#health-text-wrap svg {
  height: 60% !important;
  width: auto !important;
  color: black !important;
}

/* WEAPONS - BOTTOM CENTER */
#weapon-selector {
  position: absolute !important;
  bottom: 8vh !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  width: 48vw !important;
  height: 12vh !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  pointer-events: auto !important;
}
#auto-label {
  position: absolute !important;
  bottom: calc(8vh + 12vh + 8px) !important; /* Above weapon selector */
  left: 50% !important;
  transform: translateX(-50%) !important;
  color: white !important;
  background: transparent !important;
  font-weight: bold !important;
  font-size: clamp(10px, 1.1vw, 14px) !important;
  border: none !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
.btn-util {
  width: 7vw !important;
  height: 7vw !important;
  min-width: 64px !important;
  min-height: 64px !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: none !important; /* No outline */
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: white !important;
}
#weapon-slots-wrap {
  display: flex !important;
  gap: 0.5vw !important;
  background: transparent !important;
  border: none !important;
}
.weapon-slot {
  width: 12vw !important;
  height: 9vh !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  background: transparent !important;
  border: 1px solid white !important;
  color: white !important;
  border-radius: 0 !important; /* user requested rectangular border */
}
#weapon-slot-1 { opacity: 1 !important; }
#weapon-slot-2 { opacity: 0.4 !important; }

/* ACTION BUTTONS (THUMB PAD) - BOTTOM RIGHT */
.btn-action {
  position: absolute !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: 1px solid white !important;
  pointer-events: auto !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: white !important;
}

#btn-fire-right {
  right: 3vw !important;
  bottom: 5vh !important;
  width: 13.5vw !important;
  height: 13.5vw !important;
  min-width: 100px !important;
  min-height: 100px !important;
}

#btn-ads {
  right: 20vw !important;
  bottom: 15vh !important;
  width: 6.75vw !important;
  height: 6.75vw !important;
  min-width: 60px !important;
  min-height: 60px !important;
}

#btn-reload {
  right: 8vw !important;
  bottom: 35vh !important;
  width: 5.25vw !important;
  height: 5.25vw !important;
  min-width: 45px !important;
  min-height: 45px !important;
}

#btn-jump {
  right: 22vw !important;
  bottom: 28vh !important;
  width: 6vw !important;
  height: 6vw !important;
  min-width: 50px !important;
  min-height: 50px !important;
}

#btn-crouch {
  right: 2vw !important;
  bottom: 25vh !important;
  width: 5.25vw !important;
  height: 5.25vw !important;
  min-width: 45px !important;
  min-height: 45px !important;
}

#btn-dash {
  right: 22vw !important;
  bottom: 2vh !important;
  width: 5.25vw !important;
  height: 5.25vw !important;
  min-width: 45px !important;
  min-height: 45px !important;
}

/* SVG Constraints */
#hud-container svg { width: 50% !important; height: 50% !important; color: white !important; pointer-events: none !important; }
#hud-container svg path, #hud-container svg g { fill: currentColor !important; }
#hud-container .btn-sidekick svg { width: 55% !important; height: 55% !important; }
#hud-container .weapon-slot svg { width: 85% !important; height: auto !important; max-height: 70% !important; }
#hud-container .squad-circle svg { width: 70% !important; height: 70% !important; color: #22c55e !important; }
#hud-container .btn-util svg { width: 60% !important; height: 60% !important; }
#hud-container .btn-action svg { width: 55% !important; height: 55% !important; }
#squad-container .squad-circle { border-color: #22c55e !important; }

/* CROSSHAIR */
#center-crosshair {
  position: absolute !important;
  top: 50% !important;
  left: 50% !important;
  transform: translate(-50%, -50%) !important;
  width: 0 !important;
  height: 0 !important;
  pointer-events: none !important;
  z-index: 40 !important;
}
.cross-line { position: absolute !important; background: white !important; }
</style>

<div id="hud-container">
  <div id="look-zone-right"></div>
  
  <div id="squad-container">
    <div id="squad-p1" class="squad-circle text-white">
      ${svgs.char1}
    </div>
    <div id="squad-p2" class="squad-circle text-white">
      ${svgs.char2}
    </div>
    <div id="squad-p3" class="squad-circle text-white">
      ${svgs.char3}
    </div>
    <div id="squad-p4" class="squad-circle text-white">
      ${svgs.char4}
    </div>
  </div>

  <div id="hud-timer-container">
    <div id="hud-timer">TURN TIMER: 00:00</div>
    <div id="hud-location">LOCATION: CORE</div>
  </div>

  <div id="minimap-container">
    <canvas id="minimap-canvas"></canvas>
    <div id="minimap-players" style="position: absolute; inset: 0; pointer-events: none;">
      <div id="minimap-player-arrow" style="position: absolute; top: 50%; left: 50%; width: 20px; height: 20px; margin-top: -10px; margin-left: -10px; display: flex; align-items: center; justify-content: center; transform-origin: center;">
        ${svgs.player_arrow}
      </div>
    </div>
  </div>
  <div id="minimap-label">CORE</div>

  <button id="btn-settings" class="btn-sidekick text-white">
    ${svgs.settings}
  </button>
  <button id="btn-mic" class="btn-sidekick text-white">
    ${svgs.mic}
  </button>
  <button id="btn-chat" class="btn-sidekick text-white">
    ${svgs.chat}
  </button>

  <!-- SETTINGS MODAL -->
  <div id="settings-modal">
    <div style="font-size: 18px; font-weight: bold; border-bottom: 1px solid #666; padding-bottom: 10px; margin-bottom: 10px;">SETTINGS</div>
    
    <div class="settings-row">
      <label>SENSITIVITY (DRAG SPEED)</label>
      <input type="range" id="setting-sensitivity" min="0.1" max="5.0" step="0.1" value="1.0">
    </div>
    
    <div class="settings-row">
      <label>FIELD OF VIEW</label>
      <input type="range" id="setting-fov" min="60" max="120" step="1" value="75">
    </div>

    <div class="settings-row" style="margin-top: 10px;">
      <button id="btn-modal-fullscreen">
        ${svgs.fullscreen} FULLSCREEN
      </button>
      <button id="btn-edit-hud" style="background: transparent; border: 1px solid white; color: white; border-radius: 4px; padding: 10px; font-weight: bold;">EDIT UI</button>
      <button id="btn-close-settings">CLOSE</button>
    </div>
  </div>

  <div id="joystick-boundary">
    <div id="joystick-knob"></div>
  </div>
  
  <button id="btn-fire-left" class="btn-action">
    ${svgs.fire}
  </button>

  <div id="auto-label">AUTO &rarr;</div>
  <button id="btn-walkie" class="btn-util" style="position: absolute; left: 26vw; bottom: 8vh;">
    ${svgs.walkie}
  </button>
  
  <div id="weapon-slots-wrap" style="position: absolute; left: 50%; transform: translateX(-50%); bottom: 8vh; display: flex; gap: 8px;">
    <div id="weapon-slot-1" class="weapon-slot">
      ${svgs.rifle}
      <div id="weapon-1-ammo" style="margin-top: 2px; font-size: clamp(8px, 1vw, 13px); font-weight: bold; border: none; background: transparent;">40/289</div>
    </div>
    <div id="weapon-slot-2" class="weapon-slot">
      ${svgs.pistol}
      <div id="weapon-2-ammo" style="margin-top: 2px; font-size: clamp(8px, 1vw, 13px); font-weight: bold; border: none; background: transparent;">35/241</div>
    </div>
  </div>

  <button id="btn-medkit" class="btn-util" style="position: absolute; right: 26vw; bottom: 8vh;">
    ${svgs.medkit}
  </button>

  <div id="health-bar">
    <div id="health-bar-fill"></div>
    <div id="health-text-wrap">
      ${svgs.bandaid1}
      <div id="health-text" style="margin: 0 4px;">100/100</div>
      ${svgs.bandaid2}
    </div>
  </div>

  <button id="btn-fire-right" class="btn-action">
    ${svgs.fire}
  </button>
  <button id="btn-ads" class="btn-action">
    ${svgs.ads}
  </button>
  <button id="btn-reload" class="btn-action">
    ${svgs.reload}
  </button>
  <button id="btn-jump" class="btn-action">
    ${svgs.jump}
  </button>
  <button id="btn-crouch" class="btn-action">
    ${svgs.crouch}
  </button>

  <div id="center-crosshair">
    <div class="cross-line" style="top: -1.2vw; left: -1px; width: 2px; height: 1.2vw; transform: translateY(-0.6vw);"></div>
    <div class="cross-line" style="top: 0; left: -1px; width: 2px; height: 1.2vw; transform: translateY(0.6vw);"></div>
    <div class="cross-line" style="left: -1.2vw; top: -1px; width: 1.2vw; height: 2px; transform: translateX(-0.6vw);"></div>
    <div class="cross-line" style="left: 0; top: -1px; width: 1.2vw; height: 2px; transform: translateX(0.6vw);"></div>
  </div>

</div>
`;

const lines = readFileSync('client/main.ts', 'utf8').split('\n');

const startIdx = lines.findIndex(line => line.includes('<style>'));
let endIdx = -1;
for (let i = startIdx; i < lines.length; i++) {
  if (lines[i].includes('canvasContainer =')) {
    // track backwards to \`
    for (let j = i - 1; j >= startIdx; j--) {
      if (lines[j].includes('\`;')) {
        endIdx = j;
        break;
      }
    }
    if (endIdx !== -1) break;
  }
}
if (startIdx !== -1 && endIdx !== -1) {
    const prefix = lines.slice(0, startIdx).join('\n');
    const suffix = lines.slice(endIdx + 1).join('\n');
    writeFileSync('client/main.ts', prefix + '\n' + hudContent + '\n  \`;\n' + suffix);
    console.log('Replaced successfully');
} else {
    console.error('Could not find bounds', startIdx, endIdx);
}

