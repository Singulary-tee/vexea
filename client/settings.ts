import * as THREE from 'three';
import { DS } from './design-system';

export interface VexeaSettingsData {
    joySens: number;
    camSens: number;
    invertY: boolean;
    graphicsPreset: 'Low' | 'Medium' | 'High';
    fpsCap: number; // 30 or 60
    fxaa: boolean;
    masterVolume: number;
    spatialAudio: boolean;
    music: boolean;
    uiSounds: boolean;
    hudScale: number;
    crosshairColor: string;
    crosshairSize: number;
    particleCount: number;
    lodLow: number;
    lodBillboard: number;
    fov: number;
    fullscreen: boolean;
    serverUrl: string;
}

const DEFAULT_SETTINGS: VexeaSettingsData = {
    joySens: 1.0,
    camSens: 1.0,
    invertY: false,
    graphicsPreset: 'Medium',
    fpsCap: 60,
    fxaa: false,
    masterVolume: 1.0,
    spatialAudio: true,
    music: true,
    uiSounds: true,
    hudScale: 1.0,
    crosshairColor: 'white',
    crosshairSize: 20,
    particleCount: 50,
    lodLow: 30,
    lodBillboard: 60,
    fov: 75,
    fullscreen: false,
    serverUrl: ""
};

export const getSettings = (): VexeaSettingsData => {
    let saved = localStorage.getItem('vexea_settings');
    if (saved) {
        try { return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) }; } 
        catch (e) { return { ...DEFAULT_SETTINGS }; }
    }
    return { ...DEFAULT_SETTINGS };
};

export const saveSettings = (s: VexeaSettingsData) => {
    localStorage.setItem('vexea_settings', JSON.stringify(s));
};

export function applySettings(s: VexeaSettingsData) {
    const W = window as any;
    W.vexeaSettings = s;
    
    // Graphics
    if (W.camera) {
        W.camera.fov = s.fov;
        W.camera.updateProjectionMatrix();
    }
    
    if (W.renderer) {
        if (s.graphicsPreset === 'Low') {
            W.renderer.setPixelRatio(1.0);
        } else if (s.graphicsPreset === 'Medium') {
            W.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        } else {
            W.renderer.setPixelRatio(window.devicePixelRatio);
        }
    }
    
    // FXAA
    if (W.fxaaPass) {
        W.fxaaPass.enabled = s.fxaa;
        if (W.fxaaPass.material && W.fxaaPass.material.uniforms.resolution) {
            W.fxaaPass.material.uniforms.resolution.value.set(1 / (window.innerWidth * window.devicePixelRatio), 1 / (window.innerHeight * window.devicePixelRatio));
        }
    }

    // Audio
    const Howler = (window as any).Howler;
    if (Howler) {
        Howler.volume(s.masterVolume);
        
        // Music & UI toggle
        const bgM = W.bgMusicHowl || W.musicHowl || W.bgm;
        if (bgM) bgM.mute(!s.music);
        
        const uiM = W.uiSoundHowl || W.uiHowl || W.uiAudio;
        if (uiM && typeof uiM.mute === 'function') uiM.mute(!s.uiSounds);
        // Sometimes an array of Howl instances
        if (Array.isArray(W.uiHowls)) {
            W.uiHowls.forEach((h: any) => h.mute(!s.uiSounds));
        }
    }
    if (W.audioListener) {
        W.audioListener.setMasterVolume(s.masterVolume);
    }

    // Spatial
    function updatePanner(node: any) {
        if (node && node.panner) {
            node.panner.panningModel = s.spatialAudio ? 'HRTF' : 'equalpower';
        }
    }
    
    if (W.activeGroundDrones) {
        for (let entry of W.activeGroundDrones.values()) {
            if (entry.audio) updatePanner(entry.audio);
        }
    }
    if (W.activeAirDrones) {
        for (let entry of W.activeAirDrones.values()) {
            if (entry.audio) updatePanner(entry.audio);
        }
    }

    // ACCESSIBILITY
    const hud = document.getElementById("hud-container");
    if (hud) hud.style.transform = `scale(${s.hudScale})`;
    
    const crosshair = document.getElementById("center-crosshair");
    if (crosshair) {
        crosshair.style.color = s.crosshairColor;
        // Check if there is an SVG inside
        const svg = crosshair.querySelector('svg');
        if (svg) {
            svg.style.width = s.crosshairSize + 'px';
            svg.style.height = s.crosshairSize + 'px';
            svg.style.stroke = s.crosshairColor;
        } else {
            crosshair.style.width = s.crosshairSize + 'px';
            crosshair.style.height = s.crosshairSize + 'px';
        }
    }
}

let overlayEl: HTMLDivElement | null = null;
let boundListeners: Array<{el: HTMLElement, type: string, fn: any}> = [];

function bind(el: HTMLElement, type: string, fn: any) {
    el.addEventListener(type, fn);
    boundListeners.push({el, type, fn});
}

function createOverlayHTML() {
    return `
    <div id="vexea-settings-overlay" style="position:fixed; inset:0; z-index:2000; background:rgba(0,0,0,0.85); backdrop-filter:${DS.glass.blur}; -webkit-backdrop-filter:${DS.glass.blur}; display:flex; flex-direction:row; font-family:${DS.typography.fontFamily}; color:white; pointer-events:auto;" class="flex-col md:flex-row">
        <!-- Sidebar -->
        <div id="settings-sidebar" style="background:${DS.glass.background}; backdrop-filter:${DS.glass.blur}; -webkit-backdrop-filter:${DS.glass.blur}; border-right:${DS.glass.border}; overflow-x:auto; display:flex;" class="w-full md:w-64 flex-row md:flex-col shrink-0 p-4 gap-2">
            <h2 class="text-2xl font-bold mb-4 hidden md:block" style="color:${DS.colors.accent}; letter-spacing: 2px;">SETTINGS</h2>
            <button class="settings-tab active" data-tab="CONTROLS">CONTROLS</button>
            <button class="settings-tab" data-tab="GRAPHICS">GRAPHICS</button>
            <button class="settings-tab" data-tab="FRAME RATE">FRAME RATE</button>
            <button class="settings-tab" data-tab="ANTI-ALIASING">ANTI-ALIASING</button>
            <button class="settings-tab" data-tab="AUDIO">AUDIO</button>
            <button class="settings-tab" data-tab="ACCESSIBILITY">ACCESSIBILITY</button>
            <button class="settings-tab" data-tab="SERVER">SERVER</button>
            <button class="settings-tab" data-tab="LEGAL">LEGAL</button>
            <div class="flex-1"></div>
            <button id="btn-close-settings-overlay" style="background:${DS.colors.danger}; font-family:${DS.typography.fontFamily}; font-weight:bold; letter-spacing:2px; font-size:14px; padding:10px 20px; border-radius:4px; margin-top:20px; cursor:pointer; color:white; border:${DS.glass.border}; box-shadow:${DS.glass.glowInner}; transition: background 150ms ease;">CLOSE</button>
        </div>
        
        <!-- Content -->
        <div id="settings-content" style="flex:1; overflow-y:auto; padding:30px; font-size:16px; background:rgba(10,10,10,0.4); backdrop-filter:${DS.glass.blur}; -webkit-backdrop-filter:${DS.glass.blur}; border-left:${DS.glass.border};">
            
            <div id="tab-CONTROLS" class="settings-page active">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">CONTROLS</h3>
                <div class="mb-4">
                    <label class="block mb-1">Joystick Sensitivity (Multiplier)</label>
                    <input type="range" id="inp-joySens" min="0.1" max="2.0" step="0.1" style="width:100%;max-width:300px;">
                    <span id="val-joySens" class="ml-2"></span>
                </div>
                <div class="mb-4">
                    <label class="block mb-1">Camera Sensitivity (Multiplier)</label>
                    <input type="range" id="inp-camSens" min="0.1" max="2.0" step="0.1" style="width:100%;max-width:300px;">
                    <span id="val-camSens" class="ml-2"></span>
                </div>
                <div class="mb-4 flex items-center gap-2">
                    <label>Invert Y Axis</label>
                    <input type="checkbox" id="inp-invertY" style="width:20px;height:20px;">
                </div>
            </div>

            <div id="tab-GRAPHICS" class="settings-page hidden">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">GRAPHICS</h3>
                <div class="mb-4">
                    <label class="block mb-1">Field of View</label>
                    <input type="range" id="inp-fov" min="60" max="120" step="1" style="width:100%;max-width:300px;">
                    <span id="val-fov" class="ml-2"></span>
                </div>
                <div class="mb-4">
                    <button id="btn-fullscreen" class="p-3 border border-gray-500 rounded bg-gray-800">Toggle Fullscreen</button>
                </div>
                <div class="flex gap-4">
                    <button class="preset-btn p-3 border border-gray-500 rounded bg-gray-800" data-val="Low">Low</button>
                    <button class="preset-btn p-3 border border-gray-500 rounded bg-gray-800" data-val="Medium">Medium</button>
                    <button class="preset-btn p-3 border border-gray-500 rounded bg-gray-800" data-val="High">High</button>
                </div>
                <p id="graphics-desc" class="mt-4 text-sm text-gray-400"></p>
            </div>

            <div id="tab-FRAME RATE" class="settings-page hidden">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">FRAME RATE</h3>
                <div class="flex gap-4">
                    <label><input type="radio" name="fps" value="30"> 30 FPS Cap (via 33ms throttle)</label>
                    <label><input type="radio" name="fps" value="60"> 60 FPS (Uncapped)</label>
                </div>
            </div>

            <div id="tab-ANTI-ALIASING" class="settings-page hidden">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">ANTI-ALIASING</h3>
                <div class="mb-4 flex items-center gap-2">
                    <label>Enable FXAA Post-Processing</label>
                    <input type="checkbox" id="inp-fxaa" style="width:20px;height:20px;">
                </div>
            </div>

            <div id="tab-AUDIO" class="settings-page hidden">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">AUDIO</h3>
                <div class="mb-4">
                    <label class="block mb-1">Master Volume</label>
                    <input type="range" id="inp-vol" min="0" max="1" step="0.05" style="width:100%;max-width:300px;">
                    <span id="val-vol" class="ml-2"></span>
                </div>
                <div class="mb-4 flex items-center gap-2">
                    <label>Spatial Audio (HRTF)</label>
                    <input type="checkbox" id="inp-spatial" style="width:20px;height:20px;">
                </div>
                <div class="mb-4 flex items-center gap-2">
                    <label>Music Enabled</label>
                    <input type="checkbox" id="inp-music" style="width:20px;height:20px;">
                </div>
                <div class="mb-4 flex items-center gap-2">
                    <label>UI Sounds Enabled</label>
                    <input type="checkbox" id="inp-uiSounds" style="width:20px;height:20px;">
                </div>
            </div>

            <div id="tab-ACCESSIBILITY" class="settings-page hidden">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">ACCESSIBILITY</h3>
                <div class="mb-4">
                    <button id="btn-edit-hud" class="p-3 border border-gray-500 rounded bg-gray-800 font-bold w-full max-w-[300px]">EDIT UI</button>
                </div>
                <div class="mb-4">
                    <label class="block mb-1">HUD Scale</label>
                    <input type="range" id="inp-hud" min="0.75" max="1.5" step="0.05" style="width:100%;max-width:300px;">
                    <span id="val-hud" class="ml-2"></span>
                </div>
                <div class="mb-4">
                    <label class="block mb-1">Crosshair Size (px)</label>
                    <input type="range" id="inp-crossSize" min="10" max="50" step="1" style="width:100%;max-width:300px;">
                    <span id="val-crossSize" class="ml-2"></span>
                </div>
                <div class="mb-4">
                    <label class="block mb-1">Crosshair Color</label>
                    <div class="flex gap-2">
                        <button class="color-btn w-10 h-10 border border-gray-500 rounded" style="background:white;" data-color="white"></button>
                        <button class="color-btn w-10 h-10 border border-gray-500 rounded" style="background:green;" data-color="green"></button>
                        <button class="color-btn w-10 h-10 border border-gray-500 rounded" style="background:red;" data-color="red"></button>
                        <button class="color-btn w-10 h-10 border border-gray-500 rounded" style="background:yellow;" data-color="yellow"></button>
                        <button class="color-btn w-10 h-10 border border-gray-500 rounded" style="background:cyan;" data-color="cyan"></button>
                    </div>
                </div>
            </div>
            
            <div id="tab-SERVER" class="settings-page hidden">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">SERVER CONNECTION</h3>
                <div class="mb-4">
                    <label class="block mb-1">Authoritative Server Address</label>
                    <input type="text" id="inp-serverUrl" placeholder="e.g. http://159.203.111.222:3000" style="width:100%; max-width:400px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.15); padding:10px; border-radius:4px; color:white; font-family:inherit; font-size:15px; outline:none; transition: border-color 0.15s ease;">
                    <p class="mt-2 text-xs text-gray-400">Specify your DigitalOcean droplet IP and port (e.g. http://YOUR_DROPLET_IP:3000). Leave blank to leverage the standard client hosting origin.</p>
                </div>
                <div class="mb-6 flex flex-col gap-2">
                    <p class="text-xs text-gray-500">Currently configured server: <span id="span-activeServer" class="font-mono text-gray-300"></span></p>
                    <p class="text-xs text-gray-500" style="color: ${DS.colors.accent};">Note: Reconnecting will trigger a full page reload to safely establish WebSocket & RTC sockets.</p>
                </div>
                <button id="btn-save-server" class="preset-btn p-3 border border-gray-500 rounded bg-gray-800" style="padding: 10px 20px; font-weight: bold; width: 100%; max-width: 300px; border-color: ${DS.colors.accent} !important; color: ${DS.colors.accent} !important;">APPLY & RECONNECT</button>
            </div>
            
            <div id="tab-LEGAL" class="settings-page hidden">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">LEGAL & ATTRIBUTION</h3>
                <div class="text-sm text-gray-300">
                    <p class="mb-2"><strong>Privacy Policy:</strong> Placeholder text for privacy policy. No user personal data is collected.</p>
                    <p class="mb-2"><strong>Attribution:</strong></p>
                    <ul class="list-disc ml-5 mb-4 space-y-1">
                        <li>Three.js - MIT License</li>
                        <li>Rapier - Apache 2.0 License</li>
                        <li>Geckos.io - MIT License</li>
                        <li>Howler.js - MIT License</li>
                        <li>Firebase - Apache 2.0 License</li>
                    </ul>
                </div>
            </div>
        </div>
        <style>
            #settings-sidebar::-webkit-scrollbar { display:none; }
            .settings-tab {
                text-align: left;
                padding: 12px 16px;
                opacity: 0.65;
                width: 100%;
                white-space: nowrap;
                background: transparent;
                border: 1px solid transparent;
                color: #E8E8E8;
                font-family: ${DS.typography.fontFamily};
                font-size: 16px;
                letter-spacing: 1px;
                cursor: pointer;
                transition: background 150ms ease, opacity 150ms ease, border-left 150ms ease;
            }
            .settings-tab.active {
                opacity: 1;
                background: rgba(200, 136, 42, 0.1) !important;
                border-left: 3px solid ${DS.colors.accent} !important;
                border-color: rgba(255,255,255,0.02);
                font-weight: bold;
                color: #FFFFFF;
            }
            .settings-tab:hover {
                background: rgba(255,255,255,0.03);
                opacity: 1;
            }
            #btn-close-settings-overlay:hover {
                background: #EE4444 !important;
            }
            .settings-page {
                max-width: 600px;
                font-family: ${DS.typography.fontFamily};
                letter-spacing: 1px;
            }
            .settings-page h3 {
                color: ${DS.colors.accent};
                border-bottom: 2px solid ${DS.colors.border};
                padding-bottom: 8px;
                margin-bottom: 24px;
                font-size: 20px;
                letter-spacing: 2px;
            }
            .settings-page label {
                font-family: ${DS.typography.fontFamily};
                font-size: 15px;
                letter-spacing: 1px;
                color: #CCCCCC;
            }
            input[type="range"] {
                -webkit-appearance: none;
                appearance: none;
                background: ${DS.colors.border};
                height: 6px;
                border-radius: 3px;
                outline: none;
                vertical-align: middle;
            }
            input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: ${DS.colors.accent};
                cursor: pointer;
                box-shadow: ${DS.glass.glowOuter};
            }
            input[type="checkbox"] {
                accent-color: ${DS.colors.accent};
                width: 18px;
                height: 18px;
                cursor: pointer;
            }
            .preset-btn, #btn-fullscreen, #btn-edit-hud {
                border: ${DS.glass.border} !important;
                background: rgba(255,255,255,0.03) !important;
                color: #FFF !important;
                font-family: ${DS.typography.fontFamily};
                letter-spacing: 1px;
                text-transform: uppercase;
                transition: background 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
                cursor: pointer;
            }
            .preset-btn:hover, #btn-fullscreen:hover, #btn-edit-hud:hover {
                border-color: ${DS.colors.accent} !important;
                background: rgba(200, 136, 42, 0.1) !important;
            }
            .bg-blue-600 {
                background-color: rgba(200, 136, 42, 0.2) !important;
                border-color: ${DS.colors.accent} !important;
                box-shadow: 0 0 8px rgba(200, 136, 42, 0.25) !important;
            }
            .bg-gray-800 {
                background-color: rgba(255, 255, 255, 0.03) !important;
                border-color: rgba(255, 255, 255, 0.08) !important;
            }
            @media(max-width:768px) {
                .settings-tab { text-align: center; width: auto; }
            }
        </style>
    </div>
    `;
}

let settingsModalOpen = false;

export function openSettings() {
    if (settingsModalOpen) return;
    settingsModalOpen = true;
    if (overlayEl) return;
    
    let container = document.createElement("div");
    container.innerHTML = createOverlayHTML();
    overlayEl = container.firstElementChild as HTMLDivElement;
    document.body.appendChild(overlayEl);
    
    const s = getSettings();
    
    // Tab logic
    const tabs = document.querySelectorAll('.settings-tab');
    const pages = document.querySelectorAll('.settings-page');
    tabs.forEach(t => {
        bind(t as HTMLElement, 'click', () => {
            tabs.forEach(tt => tt.classList.remove('active'));
            pages.forEach(p => p.classList.add('hidden'));
            t.classList.add('active');
            const targetId = 'tab-' + t.getAttribute('data-tab');
            document.getElementById(targetId)?.classList.remove('hidden');
        });
    });

    // Wire up inputs
    const joySens = document.getElementById('inp-joySens') as HTMLInputElement;
    const camSens = document.getElementById('inp-camSens') as HTMLInputElement;
    let invY = document.getElementById('inp-invertY') as HTMLInputElement;
    joySens.value = s.joySens.toString();
    camSens.value = s.camSens.toString();
    invY.checked = s.invertY;
    
    let vol = document.getElementById('inp-vol') as HTMLInputElement;
    let spatial = document.getElementById('inp-spatial') as HTMLInputElement;
    let music = document.getElementById('inp-music') as HTMLInputElement;
    let ui = document.getElementById('inp-uiSounds') as HTMLInputElement;
    vol.value = s.masterVolume.toString();
    spatial.checked = s.spatialAudio;
    music.checked = s.music;
    ui.checked = s.uiSounds;

    let hud = document.getElementById('inp-hud') as HTMLInputElement;
    let crossSize = document.getElementById('inp-crossSize') as HTMLInputElement;
    let fov = document.getElementById('inp-fov') as HTMLInputElement;
    hud.value = s.hudScale.toString();
    crossSize.value = s.crosshairSize.toString();
    fov.value = s.fov.toString();

    let fxaa = document.getElementById('inp-fxaa') as HTMLInputElement;
    fxaa.checked = s.fxaa;

    const radios = document.querySelectorAll('input[name="fps"]');
    radios.forEach(r => {
        if ((r as HTMLInputElement).value == s.fpsCap.toString()) (r as HTMLInputElement).checked = true;
    });

    const serverInput = document.getElementById('inp-serverUrl') as HTMLInputElement;
    const activeServerSpan = document.getElementById('span-activeServer') as HTMLSpanElement;
    const saveServerBtn = document.getElementById('btn-save-server') as HTMLButtonElement;

    if (serverInput) {
        serverInput.value = s.serverUrl || "";
    }
    if (activeServerSpan) {
        activeServerSpan.innerText = s.serverUrl || `${window.location.origin} (Default Client Origin)`;
    }
    if (saveServerBtn) {
        bind(saveServerBtn, 'click', () => {
            s.serverUrl = serverInput.value.trim();
            saveSettings(s);
            window.location.reload();
        });
    }

    const triggerApply = () => {
        s.joySens = parseFloat(joySens.value);
        s.camSens = parseFloat(camSens.value);
        s.invertY = invY.checked;
        s.fxaa = fxaa.checked;
        s.masterVolume = parseFloat(vol.value);
        s.spatialAudio = spatial.checked;
        s.music = music.checked;
        s.uiSounds = ui.checked;
        s.hudScale = parseFloat(hud.value);
        s.crosshairSize = parseFloat(crossSize.value);
        s.fov = parseInt(fov.value);
        
        let checkedFps = document.querySelector('input[name="fps"]:checked') as HTMLInputElement;
        if(checkedFps) s.fpsCap = parseInt(checkedFps.value);

        document.getElementById('val-joySens')!.innerText = s.joySens.toFixed(1);
        document.getElementById('val-camSens')!.innerText = s.camSens.toFixed(1);
        document.getElementById('val-vol')!.innerText = s.masterVolume.toFixed(2);
        document.getElementById('val-hud')!.innerText = s.hudScale.toFixed(2);
        document.getElementById('val-crossSize')!.innerText = s.crosshairSize + 'px';
        document.getElementById('val-fov')!.innerText = s.fov.toString();

        saveSettings(s);
        applySettings(s);
    };

    [joySens, camSens, invY, fxaa, vol, spatial, music, ui, hud, crossSize, fov].forEach(el => {
        bind(el, 'input', triggerApply);
        bind(el, 'change', triggerApply);
    });

    radios.forEach(r => bind(r as HTMLElement, 'change', triggerApply));

    const presets = document.querySelectorAll('.preset-btn');
    const syncPresets = () => {
        presets.forEach(p => {
            if (p.getAttribute('data-val') === s.graphicsPreset) {
                p.classList.add('bg-blue-600');
                p.classList.remove('bg-gray-800');
            } else {
                p.classList.add('bg-gray-800');
                p.classList.remove('bg-blue-600');
            }
        });
        const desc = document.getElementById('graphics-desc');
        if (desc) {
            if (s.graphicsPreset === 'Low') {
                s.particleCount = 0; s.lodBillboard = 20; s.lodLow = 10;
                desc.innerText = "Low: Normal maps disabled, particles off, aggressive LOD (billboards at 20 units).";
            } else if (s.graphicsPreset === 'Medium') {
                s.particleCount = 50; s.lodBillboard = 60; s.lodLow = 30;
                desc.innerText = "Medium: Normal maps enabled, 50% particles, standard LOD thresholds.";
            } else {
                s.particleCount = 100; s.lodBillboard = 60; s.lodLow = 30;
                desc.innerText = "High: Full PBR textures, 100% particles, visual fidelity prioritized.";
            }
        }
    };
    
    presets.forEach(p => {
        bind(p as HTMLElement, 'click', () => {
            s.graphicsPreset = p.getAttribute('data-val') as any;
            syncPresets();
            triggerApply();
        });
    });

    const colors = document.querySelectorAll('.color-btn');
    const syncColors = () => {
        colors.forEach(c => {
            if (c.getAttribute('data-color') === s.crosshairColor) c.classList.add('h-12', 'w-12', 'border-4');
            else c.classList.remove('h-12', 'w-12', 'border-4');
        });
    };
    colors.forEach(c => {
        bind(c as HTMLElement, 'click', () => {
            s.crosshairColor = c.getAttribute('data-color') || 'white';
            syncColors();
            triggerApply();
        });
    });

    syncPresets();
    syncColors();
    
    const fsBtn = document.getElementById("btn-fullscreen");
    if (fsBtn) {
        bind(fsBtn, 'click', () => {
            const docEl = document.documentElement as any;
            if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
                if (docEl.requestFullscreen) {
                    const p = docEl.requestFullscreen();
                    if (p && typeof p.catch === 'function') p.catch(() => {});
                }
                else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
            } else {
                if (document.exitFullscreen) {
                    const p = document.exitFullscreen();
                    if (p && typeof p.catch === 'function') p.catch(() => {});
                }
                else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
            }
        });
    }

    const editHudBtn = document.getElementById("btn-edit-hud");
    if (editHudBtn) {
        bind(editHudBtn, 'click', () => {
            const W = window as any;
            closeSettings();
            if (W.vexeaEditUI) {
                W.vexeaEditUI();
            }
        });
    }

    if (matchActiveInSettings) {
        _injectMatchTabDOM();
    }

    triggerApply(); 

    const closeBtn = document.getElementById('btn-close-settings-overlay');
    bind(closeBtn!, 'click', closeSettings);
}

export function closeSettings() {
    settingsModalOpen = false;
    if (!overlayEl) return;
    boundListeners.forEach(l => {
        l.el.removeEventListener(l.type, l.fn);
    });
    boundListeners = [];
    overlayEl.remove();
    overlayEl = null;
}

export let matchActiveInSettings = false;

function _injectMatchTabDOM() {
    const sidebar = document.getElementById('settings-sidebar');
    const content = document.getElementById('settings-content');
    if (!sidebar || !content) return;

    // MATCH button
    const btn = document.createElement('button');
    btn.className = 'settings-tab';
    btn.setAttribute('data-tab', 'MATCH');
    btn.innerText = 'MATCH';
    // Insert after "SETTINGS" header (index 1)
    sidebar.insertBefore(btn, sidebar.children[1]);

    const page = document.createElement('div');
    page.id = 'tab-MATCH';
    page.className = 'settings-page hidden';
    page.innerHTML = `
        <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">MATCH</h3>
        <button id="btn-quit-match" style="height: 48px; background: transparent; border: 1px solid #CC3333; color: #CC3333; font-family: 'Barlow Condensed', sans-serif; font-size: 24px; font-weight: bold; text-transform: uppercase; border-radius: 0; width: 100%; cursor: pointer;">QUIT MATCH</button>
    `;
    // Insert at beginning of content
    content.insertBefore(page, content.firstChild);

    // Reattach tab logic since we added a new tab
    bind(btn, 'click', () => {
        const tabs = document.querySelectorAll('.settings-tab');
        const pages = document.querySelectorAll('.settings-page');
        tabs.forEach(tt => tt.classList.remove('active'));
        pages.forEach(p => p.classList.add('hidden'));
        btn.classList.add('active');
        document.getElementById('tab-MATCH')?.classList.remove('hidden');
    });

    const quitMatchBtn = document.getElementById('btn-quit-match');
    if (quitMatchBtn) {
        bind(quitMatchBtn, 'click', () => {
            const modal = document.createElement('div');
            Object.assign(modal.style, {
                position: 'fixed', inset: '0', zIndex: '2001',
                background: 'rgba(0,0,0,0.9)', display: 'flex',
                alignItems: 'center', justifyContent: 'center'
            });
            
            const card = document.createElement('div');
            Object.assign(card.style, {
                width: '400px', background: '#111111', border: '1px solid #CC3333',
                padding: '32px', borderRadius: '0'
            });
            
            const title = document.createElement('div');
            title.innerText = 'ABANDON MISSION';
            Object.assign(title.style, {
                fontFamily: "'Barlow Condensed', sans-serif", fontSize: '24px',
                color: '#E8E8E8', textTransform: 'uppercase', marginBottom: '8px'
            });
            
            const body = document.createElement('div');
            body.innerText = 'You will be removed from the match. The mission continues without you.';
            Object.assign(body.style, {
                fontFamily: "'Barlow Condensed', sans-serif", fontSize: '14px',
                color: '#888888', marginBottom: '24px'
            });
            
            const btnWrap = document.createElement('div');
            Object.assign(btnWrap.style, { display: 'flex', gap: '16px' });
            
            const confBtn = document.createElement('button');
            confBtn.innerText = 'CONFIRM';
            Object.assign(confBtn.style, {
                background: '#CC3333', color: '#0A0A0A',
                fontFamily: "'Barlow Condensed', sans-serif", fontSize: '18px',
                fontWeight: 'bold', textTransform: 'uppercase', borderRadius: '0',
                padding: '8px 16px', border: 'none', cursor: 'pointer'
            });
            
            const cancBtn = document.createElement('button');
            cancBtn.innerText = 'CANCEL';
            Object.assign(cancBtn.style, {
                background: 'transparent', border: '1px solid #2A2A2A',
                color: '#888888', padding: '8px 16px', cursor: 'pointer'
            });
            
            confBtn.onclick = () => {
                document.dispatchEvent(new CustomEvent("VEXEA_PLAYER_QUIT"));
                modal.remove();
                closeSettings();
            };
            
            cancBtn.onclick = () => modal.remove();
            
            btnWrap.appendChild(confBtn);
            btnWrap.appendChild(cancBtn);
            card.appendChild(title);
            card.appendChild(body);
            card.appendChild(btnWrap);
            modal.appendChild(card);
            document.body.appendChild(modal);
        });
    }
}

export function injectMatchTab(): void {
    if (!matchActiveInSettings) {
        matchActiveInSettings = true;
        if (overlayEl) {
            _injectMatchTabDOM();
        }
    }
}

export function removeMatchTab(): void {
    matchActiveInSettings = false;
    if (overlayEl) {
        const btn = document.querySelector('.settings-tab[data-tab="MATCH"]');
        const page = document.getElementById('tab-MATCH');
        if (btn) btn.remove();
        if (page) page.remove();

        // if we removed the active tab, switch back to controls
        if (btn?.classList.contains('active')) {
            const controlsBtn = document.querySelector('.settings-tab[data-tab="CONTROLS"]') as HTMLElement;
            if (controlsBtn) controlsBtn.click();
        }
    }
}
