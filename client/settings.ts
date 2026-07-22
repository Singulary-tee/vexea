import * as THREE from 'three';
import { DS } from './design-system';
import { listCachedFiles, deleteCachedFile, clearCache } from './asset-cache';
import { IS_DEV } from '../shared/gate';
import { IS_MOBILE } from './platform-gate';

export interface VexeaSettingsData {
    joySens: number;
    camSens: number;
    invertY: boolean;
    graphicsPreset: 'Low' | 'Medium' | 'High' | 'Custom';
    fpsCap: number; // 30 or 60
    fxaa: boolean;
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
    uiVolume: number;
    voiceVolume: number;
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
    rendererType: 'auto' | 'webgpu' | 'webgl';
    fullscreen: boolean;
    serverUrl: string;

    // Custom Graphics Controls
    shadows: boolean;
    ssao: boolean;
    bloom: boolean;
    bloomStrength: number;
    bloomRadius: number;
    bloomThreshold: number;
    vignette: boolean;
    vignetteIntensity: number;
    chromaticAberration: boolean;
    chromaticAberrationIntensity: number;
    toneMapping: 'none' | 'linear' | 'reinhard' | 'cineon' | 'aces';
    exposure: number;
    parallaxOcclusion: boolean;
    pbrMaterials: boolean;
    instancedProps: boolean;
    pixelRatioMode: '0.75' | '1.0' | '1.5' | 'native';
    flashLight: boolean;
}

const DEFAULT_SETTINGS: VexeaSettingsData = {
    joySens: 1.0,
    camSens: 1.0,
    invertY: false,
    graphicsPreset: IS_MOBILE ? 'Low' : 'Medium',
    fpsCap: IS_MOBILE ? 30 : 60,
    fxaa: false,
    masterVolume: 1.0,
    musicVolume: 0.7,
    sfxVolume: 1.0,
    uiVolume: 0.8,
    voiceVolume: 0.8,
    spatialAudio: true,
    music: true,
    uiSounds: true,
    hudScale: 1.0,
    crosshairColor: 'white',
    crosshairSize: 20,
    particleCount: IS_MOBILE ? 20 : 50,
    lodLow: IS_MOBILE ? 15 : 30,
    lodBillboard: IS_MOBILE ? 30 : 60,
    fov: 75,
    rendererType: 'auto',
    fullscreen: false,
    serverUrl: "",

    // Graphics defaults
    shadows: !IS_MOBILE,
    ssao: false,
    bloom: !IS_MOBILE,
    bloomStrength: 1.0,
    bloomRadius: 0.5,
    bloomThreshold: 0.5,
    vignette: true,
    vignetteIntensity: 0.5,
    chromaticAberration: false,
    chromaticAberrationIntensity: 0.005,
    toneMapping: 'aces',
    exposure: 1.0,
    parallaxOcclusion: !IS_MOBILE,
    pbrMaterials: !IS_MOBILE,
    instancedProps: !IS_MOBILE,
    pixelRatioMode: IS_MOBILE ? '0.75' : '1.5',
    flashLight: !IS_MOBILE
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
        let targetRatio = 1.0;
        if (s.pixelRatioMode === '0.75') {
            targetRatio = 0.75;
        } else if (s.pixelRatioMode === '1.0') {
            targetRatio = 1.0;
        } else if (s.pixelRatioMode === '1.5') {
            targetRatio = Math.min(window.devicePixelRatio, 1.5);
        } else if (s.pixelRatioMode === 'native') {
            targetRatio = window.devicePixelRatio;
        } else {
            targetRatio = s.graphicsPreset === 'Low' ? 0.75 : Math.min(window.devicePixelRatio, 1.5);
        }
        W.renderer.setPixelRatio(targetRatio);

        // Apply Tone Mapping & Exposure
        let tm = 0; // THREE.NoToneMapping
        if (s.toneMapping === 'linear') tm = 1; // THREE.LinearToneMapping
        else if (s.toneMapping === 'reinhard') tm = 2; // THREE.ReinhardToneMapping
        else if (s.toneMapping === 'cineon') tm = 3; // THREE.CineonToneMapping
        else if (s.toneMapping === 'aces') tm = 4; // THREE.ACESFilmicToneMapping
        W.renderer.toneMapping = tm;
        W.renderer.toneMappingExposure = s.exposure;

        // Apply Shadow Map settings
        W.renderer.shadowMap.enabled = s.shadows;
    }

    // Apply TSL graphics uniforms
    const uniforms = W.vexGraphicsUniforms;
    if (uniforms) {
        uniforms.bloomEnabled.value = s.bloom ? 1.0 : 0.0;
        uniforms.bloomStrength.value = s.bloomStrength;
        uniforms.bloomRadius.value = s.bloomRadius;
        uniforms.bloomThreshold.value = s.bloomThreshold;
        uniforms.vignetteEnabled.value = s.vignette ? 1.0 : 0.0;
        uniforms.vignetteIntensity.value = s.vignetteIntensity;
        uniforms.chromaticAberrationEnabled.value = s.chromaticAberration ? 1.0 : 0.0;
        uniforms.chromaticAberrationIntensity.value = s.chromaticAberrationIntensity;
        uniforms.ssaoEnabled.value = s.ssao ? 1.0 : 0.0;
        uniforms.pomScale.value = s.parallaxOcclusion ? 0.025 : 0.0;
        uniforms.pbrNormalScale.value = s.pbrMaterials ? 1.0 : 0.0;
        uniforms.pbrDetailsEnabled.value = s.pbrMaterials ? 1.0 : 0.0;
        uniforms.instancedPropsEnabled.value = s.instancedProps ? 1.0 : 0.0;
    }

    // Trigger prop visibility or custom rendering updates
    document.dispatchEvent(new CustomEvent("VEXEA_GRAPHICS_CHANGED", { detail: s }));
    
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
    if (W.audioManager && typeof W.audioManager.updateVolumes === 'function') {
        W.audioManager.updateVolumes(s);
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
    <div id="vexea-settings-overlay" style="position:fixed; inset:0; z-index:2000; background:${DS.utils.rgba('#000000', 0.85)}; backdrop-filter:${DS.glass.blur}; -webkit-backdrop-filter:${DS.glass.blur}; display:flex; flex-direction:row; font-family:${DS.typography.fontFamily}; color:white; pointer-events:auto;" class="flex-col md:flex-row">
        <!-- Sidebar -->
        <div id="settings-sidebar" style="background:${DS.glass.background}; backdrop-filter:${DS.glass.blur}; -webkit-backdrop-filter:${DS.glass.blur}; border-right:${DS.glass.border}; overflow-x:auto; display:flex;" class="w-full md:w-64 flex-row md:flex-col shrink-0 p-4 gap-2">
            <h2 class="text-2xl font-bold mb-4 hidden md:block" style="color:${DS.colors.accent}; letter-spacing: 2px; font-size:clamp(1.2rem, 3vw, 1.5rem);">SETTINGS</h2>
            <button class="settings-tab active" data-tab="CONTROLS">CONTROLS</button>
            <button class="settings-tab" data-tab="GRAPHICS">GRAPHICS</button>
            <button class="settings-tab" data-tab="FRAME RATE">FRAME RATE</button>
            <button class="settings-tab" data-tab="ANTI-ALIASING">ANTI-ALIASING</button>
            <button class="settings-tab" data-tab="AUDIO">AUDIO</button>
            <button class="settings-tab" data-tab="ACCESSIBILITY">ACCESSIBILITY</button>
            ${IS_DEV ? `<button class="settings-tab" data-tab="SERVER">SERVER</button>` : ''}
            ${IS_DEV ? `<button class="settings-tab" data-tab="DEV" id="btn-tab-dev">ASSET MANAGEMENT</button>` : ''}
            <button class="settings-tab" data-tab="LEGAL">LEGAL</button>
            <div class="flex-1"></div>
            <button id="btn-close-settings-overlay" style="background:${DS.colors.danger}; font-family:${DS.typography.fontFamily}; font-weight:bold; letter-spacing:2px; font-size:clamp(12px, 1.5vw, 14px); padding:clamp(8px, 1.5vh, 10px) clamp(16px, 2vw, 20px); border-radius:4px; margin-top:clamp(10px, 2vh, 20px); cursor:pointer; color:white; border:${DS.glass.border}; box-shadow:${DS.glass.glowInner}; transition: background 150ms ease;">CLOSE</button>
        </div>
        
        <!-- Content -->
        <div id="settings-content" style="flex:1; overflow-y:auto; padding:clamp(16px, 4vw, 30px); font-size:clamp(14px, 1.5vw, 16px); background:${DS.utils.rgba('#0A0A0A', 0.4)}; backdrop-filter:${DS.glass.blur}; -webkit-backdrop-filter:${DS.glass.blur}; border-left:${DS.glass.border};">
            
            <div id="tab-CONTROLS" class="settings-page active">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">CONTROLS</h3>
                <div class="mb-4">
                    <label class="block mb-1">Joystick Sensitivity (Multiplier)</label>
                    <input type="range" id="inp-joySens" min="0.1" max="2.0" step="0.1" style="width:100%;max-width:clamp(200px, 40vw, 300px);">
                    <span id="val-joySens" class="ml-2"></span>
                </div>
                <div class="mb-4">
                    <label class="block mb-1">Camera Sensitivity (Multiplier)</label>
                    <input type="range" id="inp-camSens" min="0.1" max="2.0" step="0.1" style="width:100%;max-width:clamp(200px, 40vw, 300px);">
                    <span id="val-camSens" class="ml-2"></span>
                </div>
                <div class="mb-4 flex items-center gap-2">
                    <label>Invert Y Axis</label>
                    <input type="checkbox" id="inp-invertY" style="width:clamp(16px, 2vw, 20px);height:clamp(16px, 2vw, 20px);">
                </div>
            </div>

            <div id="tab-GRAPHICS" class="settings-page hidden">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">GRAPHICS</h3>
                
                <!-- Presets -->
                <div class="mb-6">
                    <label class="block mb-2 font-bold text-gray-300">Overall Quality Preset</label>
                    <div class="flex gap-3">
                        <button class="preset-btn px-4 py-2 border rounded font-bold" data-val="Low" style="border-color:${DS.colors.accent}; font-family:${DS.typography.fontFamily}; letter-spacing:1px; cursor:pointer;">LOW</button>
                        <button class="preset-btn px-4 py-2 border rounded font-bold" data-val="Medium" style="border-color:${DS.colors.accent}; font-family:${DS.typography.fontFamily}; letter-spacing:1px; cursor:pointer;">MEDIUM</button>
                        <button class="preset-btn px-4 py-2 border rounded font-bold" data-val="High" style="border-color:${DS.colors.accent}; font-family:${DS.typography.fontFamily}; letter-spacing:1px; cursor:pointer;">HIGH</button>
                        <button class="preset-btn px-4 py-2 border rounded font-bold" data-val="Custom" style="border-color:${DS.colors.accent}; font-family:${DS.typography.fontFamily}; letter-spacing:1px; cursor:pointer;" disabled>CUSTOM</button>
                    </div>
                    <p id="graphics-desc" class="mt-2 text-xs text-gray-400 font-mono"></p>
                </div>

                <!-- Custom options panel -->
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:20px; border-top:1px solid ${DS.utils.rgba(DS.colors.text, 0.1)}; pt-4;">
                    <!-- Column 1: Engine & Materials -->
                    <div class="flex flex-col gap-4">
                        <h4 class="font-bold text-sm text-blue-400 uppercase tracking-widest border-b border-gray-800 pb-1">Engine & Geometry</h4>
                        <div>
                            <label class="block text-sm mb-1 text-gray-300">Field of View</label>
                            <input type="range" id="inp-fov" min="60" max="120" step="1" style="width:100%;">
                            <span id="val-fov" class="text-xs text-gray-400 font-mono"></span>
                        </div>
                        <div>
                            <label class="block text-sm mb-1 text-gray-300">Renderer Engine (Requires Reload)</label>
                            <select id="inp-rendererType" style="width:100%; background:${DS.utils.rgba('#000000', 0.5)}; border:1px solid ${DS.utils.rgba(DS.colors.text, 0.15)}; padding:8px; border-radius:4px; color:white; font-family:inherit; outline:none;">
                                <option value="auto">Auto-Detect (Preferred)</option>
                                <option value="webgpu" id="opt-webgpu">WebGPU Only</option>
                                <option value="webgl">WebGL Only</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm mb-1 text-gray-300">Pixel Ratio Scale (Resolution)</label>
                            <div class="flex gap-1" id="group-pixelRatio">
                                <label class="pixel-ratio-label flex-1 text-center py-1.5 text-xs border rounded cursor-pointer font-bold" style="border-color:${DS.utils.rgba(DS.colors.text, 0.15)}">
                                    <input type="radio" name="pixelRatioMode" value="0.75" class="hidden"> 0.75x
                                </label>
                                <label class="pixel-ratio-label flex-1 text-center py-1.5 text-xs border rounded cursor-pointer font-bold" style="border-color:${DS.utils.rgba(DS.colors.text, 0.15)}">
                                    <input type="radio" name="pixelRatioMode" value="1.0" class="hidden"> 1.0x
                                </label>
                                <label class="pixel-ratio-label flex-1 text-center py-1.5 text-xs border rounded cursor-pointer font-bold" style="border-color:${DS.utils.rgba(DS.colors.text, 0.15)}">
                                    <input type="radio" name="pixelRatioMode" value="1.5" class="hidden"> 1.5x
                                </label>
                                <label class="pixel-ratio-label flex-1 text-center py-1.5 text-xs border rounded cursor-pointer font-bold" style="border-color:${DS.utils.rgba(DS.colors.text, 0.15)}">
                                    <input type="radio" name="pixelRatioMode" value="native" class="hidden"> Native
                                </label>
                            </div>
                        </div>
                        <div class="flex items-center justify-between" style="padding:4px 0;">
                            <label for="inp-shadows" class="text-sm text-gray-300">Real-Time Shadows</label>
                            <input type="checkbox" id="inp-shadows" style="width:20px;height:20px;cursor:pointer;">
                        </div>
                        <div class="flex items-center justify-between" style="padding:4px 0;">
                            <label for="inp-pbrMaterials" class="text-sm text-gray-300">PBR Texture Details</label>
                            <input type="checkbox" id="inp-pbrMaterials" style="width:20px;height:20px;cursor:pointer;">
                        </div>
                        <div class="flex items-center justify-between" style="padding:4px 0;">
                            <label for="inp-parallaxOcclusion" class="text-sm text-gray-300">Parallax Mapping (POM)</label>
                            <input type="checkbox" id="inp-parallaxOcclusion" style="width:20px;height:20px;cursor:pointer;">
                        </div>
                        <div class="flex items-center justify-between" style="padding:4px 0;">
                            <label for="inp-instancedProps" class="text-sm text-gray-300">Instance Random Props</label>
                            <input type="checkbox" id="inp-instancedProps" style="width:20px;height:20px;cursor:pointer;">
                        </div>
                    </div>

                    <!-- Column 2: Lighting & Post-Processing -->
                    <div class="flex flex-col gap-4">
                        <h4 class="font-bold text-sm text-blue-400 uppercase tracking-widest border-b border-gray-800 pb-1">Lighting & Effects</h4>
                        <div class="flex items-center justify-between" style="padding:4px 0;">
                            <label for="inp-flashLight" class="text-sm text-gray-300">Dynamic Lights (Muzzle/Explosions)</label>
                            <input type="checkbox" id="inp-flashLight" style="width:20px;height:20px;cursor:pointer;">
                        </div>
                        <div class="flex items-center justify-between" style="padding:4px 0;">
                            <label for="inp-ssao" class="text-sm text-gray-300">Screen Space AO (GTAO)</label>
                            <input type="checkbox" id="inp-ssao" style="width:20px;height:20px;cursor:pointer;">
                        </div>
                        
                        <!-- Bloom block -->
                        <div class="border border-gray-800 p-2 rounded" style="background:${DS.utils.rgba('#000000', 0.35)}; border:1px solid ${DS.utils.rgba(DS.colors.text, 0.05)};">
                            <div class="flex items-center justify-between mb-2">
                                <label for="inp-bloom" class="font-bold text-sm text-gray-300">Bloom Post-Processing</label>
                                <input type="checkbox" id="inp-bloom" style="width:20px;height:20px;cursor:pointer;">
                            </div>
                            <div class="flex flex-col gap-2 pl-2">
                                <div>
                                    <label class="text-xs text-gray-400 block">Bloom Strength</label>
                                    <input type="range" id="inp-bloomStrength" min="0.1" max="3.0" step="0.1" style="width:100%;">
                                    <span id="val-bloomStrength" class="text-xs font-mono text-gray-500 block text-right"></span>
                                </div>
                            </div>
                        </div>

                        <!-- Vignette block -->
                        <div class="border border-gray-800 p-2 rounded" style="background:${DS.utils.rgba('#000000', 0.35)}; border:1px solid ${DS.utils.rgba(DS.colors.text, 0.05)};">
                            <div class="flex items-center justify-between mb-2">
                                <label for="inp-vignette" class="font-bold text-sm text-gray-300">Vignette Shading</label>
                                <input type="checkbox" id="inp-vignette" style="width:20px;height:20px;cursor:pointer;">
                            </div>
                            <div class="flex flex-col gap-2 pl-2">
                                <div>
                                    <label class="text-xs text-gray-400 block">Vignette Intensity</label>
                                    <input type="range" id="inp-vignetteIntensity" min="0.1" max="2.0" step="0.1" style="width:100%;">
                                    <span id="val-vignetteIntensity" class="text-xs font-mono text-gray-500 block text-right"></span>
                                </div>
                            </div>
                        </div>

                        <!-- Chromatic Aberration block -->
                        <div class="border border-gray-800 p-2 rounded" style="background:${DS.utils.rgba('#000000', 0.35)}; border:1px solid ${DS.utils.rgba(DS.colors.text, 0.05)};">
                            <div class="flex items-center justify-between mb-2">
                                <label for="inp-chromaticAberration" class="font-bold text-sm text-gray-300">Chromatic Aberration</label>
                                <input type="checkbox" id="inp-chromaticAberration" style="width:20px;height:20px;cursor:pointer;">
                            </div>
                            <div class="flex flex-col gap-2 pl-2">
                                <div>
                                    <label class="text-xs text-gray-400 block">Aberration Intensity</label>
                                    <input type="range" id="inp-chromaticAberrationIntensity" min="0.001" max="0.020" step="0.001" style="width:100%;">
                                    <span id="val-chromaticAberrationIntensity" class="text-xs font-mono text-gray-500 block text-right"></span>
                                </div>
                            </div>
                        </div>

                        <!-- Tone Mapping -->
                        <div>
                            <label class="block text-sm mb-1 text-gray-300">Tone Mapping</label>
                            <select id="inp-toneMapping" style="width:100%; background:${DS.utils.rgba('#000000', 0.5)}; border:1px solid ${DS.utils.rgba(DS.colors.text, 0.15)}; padding:8px; border-radius:4px; color:white; font-family:inherit; outline:none;">
                                <option value="none">None</option>
                                <option value="linear">Linear</option>
                                <option value="reinhard">Reinhard</option>
                                <option value="cineon">Cineon</option>
                                <option value="aces">ACES Filmic (Cinematic)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm mb-1 text-gray-300">Camera Exposure</label>
                            <input type="range" id="inp-exposure" min="0.1" max="3.0" step="0.1" style="width:100%;">
                            <span id="val-exposure" class="text-xs text-gray-400 font-mono block text-right"></span>
                        </div>
                    </div>
                </div>

                <div class="mt-4 flex justify-between items-center">
                    <button id="btn-fullscreen" class="p-3 border rounded bg-gray-800" style="border-color:${DS.colors.accent}; font-family:${DS.typography.fontFamily}; letter-spacing:1px; cursor:pointer;">TOGGLE FULLSCREEN</button>
                </div>
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
                <div class="mb-4">
                    <label class="block mb-1">Music Volume</label>
                    <input type="range" id="inp-musicVol" min="0" max="1" step="0.05" style="width:100%;max-width:300px;">
                    <span id="val-musicVol" class="ml-2"></span>
                </div>
                <div class="mb-4">
                    <label class="block mb-1">SFX Volume</label>
                    <input type="range" id="inp-sfxVol" min="0" max="1" step="0.05" style="width:100%;max-width:300px;">
                    <span id="val-sfxVol" class="ml-2"></span>
                </div>
                <div class="mb-4">
                    <label class="block mb-1">UI Volume</label>
                    <input type="range" id="inp-uiVol" min="0" max="1" step="0.05" style="width:100%;max-width:300px;">
                    <span id="val-uiVol" class="ml-2"></span>
                </div>
                <div class="mb-4">
                    <label class="block mb-1">Voice Volume</label>
                    <input type="range" id="inp-voiceVol" min="0" max="1" step="0.05" style="width:100%;max-width:300px;">
                    <span id="val-voiceVol" class="ml-2"></span>
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
            
            ${IS_DEV ? `
            <div id="tab-SERVER" class="settings-page hidden">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">SERVER CONNECTION</h3>
                <div class="mb-4">
                    <label class="block mb-1">Authoritative Server Address</label>
                    <input type="text" id="inp-serverUrl" placeholder="e.g. http://159.203.111.222:3000" style="width:100%; max-width:400px; background:${DS.utils.rgba('#000000', 0.3)}; border:1px solid ${DS.utils.rgba(DS.colors.text, 0.15)}; padding:10px; border-radius:4px; color:white; font-family:inherit; font-size:15px; outline:none; transition: border-color 0.15s ease;">
                    <p class="mt-2 text-xs text-gray-400">Specify your DigitalOcean droplet IP and port (e.g. http://YOUR_DROPLET_IP:3000). Leave blank to leverage the standard client hosting origin.</p>
                </div>
                <div class="mb-6 flex flex-col gap-2">
                    <p class="text-xs text-gray-500">Currently configured server: <span id="span-activeServer" class="font-mono text-gray-300"></span></p>
                    <p class="text-xs text-gray-500" style="color: ${DS.colors.accent};">Note: Reconnecting will trigger a full page reload to safely establish WebSocket & RTC sockets.</p>
                </div>
                <button id="btn-save-server" class="preset-btn p-3 border border-gray-500 rounded bg-gray-800" style="padding: 10px 20px; font-weight: bold; width: 100%; max-width: 300px; border-color: ${DS.colors.accent} !important; color: ${DS.colors.accent} !important;">APPLY & RECONNECT</button>
            </div>
            ` : ''}

            ${IS_DEV ? `
            <div id="tab-DEV" class="settings-page hidden">
                <h3 class="text-xl font-bold mb-4 border-b border-gray-600 pb-2">ASSET CACHE MANAGEMENT</h3>
                <div class="mb-6">
                    <p class="text-sm text-gray-400 mb-4">Local asset cache management. Clear specific files to force the engine to refetch the latest versions from the CDN.</p>
                    <button id="btn-clear-cache" class="preset-btn p-3 border border-red-500 rounded bg-red-900/20 text-red-500 font-bold w-full max-w-[300px]" style="border-color: #ff4444 !important; color: #ff4444 !important;">CLEAR ENTIRE CACHE</button>
                </div>
                <div class="border-t border-gray-700 pt-4">
                    <h4 class="text-lg font-bold mb-4" style="color: ${DS.colors.accent};">CACHED ASSETS</h4>
                    <div id="dev-file-list" class="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-2" style="scrollbar-width: thin; scrollbar-color: ${DS.colors.accent} transparent;">
                        <p class="text-gray-500 italic">Scanning local IndexedDB...</p>
                    </div>
                </div>
            </div>
            ` : ''}
            
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
                background: ${DS.utils.rgba(DS.colors.accent, 0.1)} !important;
                border-left: 3px solid ${DS.colors.accent} !important;
                border-color: ${DS.utils.rgba(DS.colors.text, 0.02)};
                font-weight: bold;
                color: #FFFFFF;
            }
            .settings-tab:hover {
                background: ${DS.utils.rgba(DS.colors.text, 0.03)};
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
                background: ${DS.utils.rgba(DS.colors.text, 0.03)} !important;
                color: #FFF !important;
                font-family: ${DS.typography.fontFamily};
                letter-spacing: 1px;
                text-transform: uppercase;
                transition: background 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
                cursor: pointer;
            }
            .preset-btn:hover, #btn-fullscreen:hover, #btn-edit-hud:hover {
                border-color: ${DS.colors.accent} !important;
                background: ${DS.utils.rgba(DS.colors.accent, 0.1)} !important;
            }
            .bg-blue-600 {
                background-color: ${DS.utils.rgba(DS.colors.accent, 0.2)} !important;
                border-color: ${DS.colors.accent} !important;
                box-shadow: 0 0 8px ${DS.utils.rgba(DS.colors.accent, 0.25)} !important;
            }
            .bg-gray-800 {
                background-color: ${DS.utils.rgba(DS.colors.text, 0.03)} !important;
                border-color: ${DS.utils.rgba(DS.colors.text, 0.08)} !important;
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
    let musicVol = document.getElementById('inp-musicVol') as HTMLInputElement;
    let sfxVol = document.getElementById('inp-sfxVol') as HTMLInputElement;
    let uiVol = document.getElementById('inp-uiVol') as HTMLInputElement;
    let voiceVol = document.getElementById('inp-voiceVol') as HTMLInputElement;
    let spatial = document.getElementById('inp-spatial') as HTMLInputElement;
    let music = document.getElementById('inp-music') as HTMLInputElement;
    let ui = document.getElementById('inp-uiSounds') as HTMLInputElement;
    vol.value = s.masterVolume.toString();
    musicVol.value = s.musicVolume.toString();
    sfxVol.value = s.sfxVolume.toString();
    uiVol.value = s.uiVolume.toString();
    if (voiceVol) voiceVol.value = (s.voiceVolume ?? 0.8).toString();
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

    let rendType = document.getElementById('inp-rendererType') as HTMLSelectElement;
    if (rendType) {
        rendType.value = s.rendererType;
        const webgpuSupported = typeof navigator !== 'undefined' && (navigator as any).gpu !== undefined;
        const webgpuOpt = document.getElementById('opt-webgpu') as HTMLOptionElement;
        if (webgpuOpt) {
            if (!webgpuSupported) {
                webgpuOpt.disabled = true;
                webgpuOpt.innerText = "WebGPU Only (Not Supported)";
                if (s.rendererType === 'webgpu') {
                    // Fallback visual selection if saved setting is WebGPU but browser doesn't support it
                    rendType.value = 'auto';
                }
            } else {
                webgpuOpt.disabled = false;
                webgpuOpt.innerText = "WebGPU Only";
            }
        }
    }

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

    // Advanced Custom Graphics DOM elements
    const shadows = document.getElementById('inp-shadows') as HTMLInputElement;
    const pbrMaterials = document.getElementById('inp-pbrMaterials') as HTMLInputElement;
    const parallaxOcclusion = document.getElementById('inp-parallaxOcclusion') as HTMLInputElement;
    const instancedProps = document.getElementById('inp-instancedProps') as HTMLInputElement;
    const flashLight = document.getElementById('inp-flashLight') as HTMLInputElement;
    const ssao = document.getElementById('inp-ssao') as HTMLInputElement;
    const bloom = document.getElementById('inp-bloom') as HTMLInputElement;
    const bloomStrength = document.getElementById('inp-bloomStrength') as HTMLInputElement;
    const vignette = document.getElementById('inp-vignette') as HTMLInputElement;
    const vignetteIntensity = document.getElementById('inp-vignetteIntensity') as HTMLInputElement;
    const chromaticAberration = document.getElementById('inp-chromaticAberration') as HTMLInputElement;
    const chromaticAberrationIntensity = document.getElementById('inp-chromaticAberrationIntensity') as HTMLInputElement;
    const toneMapping = document.getElementById('inp-toneMapping') as HTMLSelectElement;
    const exposure = document.getElementById('inp-exposure') as HTMLInputElement;

    const populateUIFromSettings = () => {
        if (shadows) shadows.checked = s.shadows;
        if (pbrMaterials) pbrMaterials.checked = s.pbrMaterials;
        if (parallaxOcclusion) parallaxOcclusion.checked = s.parallaxOcclusion;
        if (instancedProps) instancedProps.checked = s.instancedProps;
        if (flashLight) flashLight.checked = s.flashLight;
        if (ssao) ssao.checked = s.ssao;
        if (bloom) bloom.checked = s.bloom;
        if (bloomStrength) bloomStrength.value = s.bloomStrength.toString();
        if (vignette) vignette.checked = s.vignette;
        if (vignetteIntensity) vignetteIntensity.value = s.vignetteIntensity.toString();
        if (chromaticAberration) chromaticAberration.checked = s.chromaticAberration;
        if (chromaticAberrationIntensity) chromaticAberrationIntensity.value = s.chromaticAberrationIntensity.toString();
        if (toneMapping) toneMapping.value = s.toneMapping;
        if (exposure) exposure.value = s.exposure.toString();

        const pixelRatioRadios = document.querySelectorAll('input[name="pixelRatioMode"]') as NodeListOf<HTMLInputElement>;
        pixelRatioRadios.forEach(r => {
            r.checked = (r.value === s.pixelRatioMode);
            const parent = r.parentElement;
            if (parent) {
                if (r.checked) {
                    parent.style.background = DS.colors.accent;
                    parent.style.borderColor = DS.colors.accent;
                    parent.style.color = '#ffffff';
                } else {
                    parent.style.background = DS.utils.rgba('#000000', 0.4);
                    parent.style.borderColor = DS.utils.rgba(DS.colors.text, 0.15);
                    parent.style.color = DS.colors.textSecondary;
                }
            }
        });

        if (document.getElementById('val-bloomStrength')) {
            document.getElementById('val-bloomStrength')!.innerText = s.bloomStrength.toFixed(1);
        }
        if (document.getElementById('val-vignetteIntensity')) {
            document.getElementById('val-vignetteIntensity')!.innerText = s.vignetteIntensity.toFixed(1);
        }
        if (document.getElementById('val-chromaticAberrationIntensity')) {
            document.getElementById('val-chromaticAberrationIntensity')!.innerText = s.chromaticAberrationIntensity.toFixed(3);
        }
        if (document.getElementById('val-exposure')) {
            document.getElementById('val-exposure')!.innerText = s.exposure.toFixed(1);
        }
    };
    populateUIFromSettings();

    const triggerApply = () => {
        s.joySens = parseFloat(joySens.value);
        s.camSens = parseFloat(camSens.value);
        s.invertY = invY.checked;
        s.fxaa = fxaa.checked;
        s.masterVolume = parseFloat(vol.value);
        s.musicVolume = parseFloat(musicVol.value);
        s.sfxVolume = parseFloat(sfxVol.value);
        s.uiVolume = parseFloat(uiVol.value);
        if (voiceVol) s.voiceVolume = parseFloat(voiceVol.value);
        s.spatialAudio = spatial.checked;
        s.music = music.checked;
        s.uiSounds = ui.checked;
        s.hudScale = parseFloat(hud.value);
        s.crosshairSize = parseFloat(crossSize.value);
        s.fov = parseInt(fov.value);
        if (rendType) s.rendererType = rendType.value as any;
        
        let checkedFps = document.querySelector('input[name="fps"]:checked') as HTMLInputElement;
        if(checkedFps) s.fpsCap = parseInt(checkedFps.value);

        // Read advanced graphics
        if (shadows) s.shadows = shadows.checked;
        if (pbrMaterials) s.pbrMaterials = pbrMaterials.checked;
        if (parallaxOcclusion) s.parallaxOcclusion = parallaxOcclusion.checked;
        if (instancedProps) s.instancedProps = instancedProps.checked;
        if (flashLight) s.flashLight = flashLight.checked;
        if (ssao) s.ssao = ssao.checked;
        if (bloom) s.bloom = bloom.checked;
        if (bloomStrength) s.bloomStrength = parseFloat(bloomStrength.value);
        if (vignette) s.vignette = vignette.checked;
        if (vignetteIntensity) s.vignetteIntensity = parseFloat(vignetteIntensity.value);
        if (chromaticAberration) s.chromaticAberration = chromaticAberration.checked;
        if (chromaticAberrationIntensity) s.chromaticAberrationIntensity = parseFloat(chromaticAberrationIntensity.value);
        if (toneMapping) s.toneMapping = toneMapping.value as any;
        if (exposure) s.exposure = parseFloat(exposure.value);

        const checkedPixelRatio = document.querySelector('input[name="pixelRatioMode"]:checked') as HTMLInputElement;
        if (checkedPixelRatio) s.pixelRatioMode = checkedPixelRatio.value as any;

        // Update labels
        if (document.getElementById('val-joySens')) document.getElementById('val-joySens')!.innerText = s.joySens.toFixed(1);
        if (document.getElementById('val-camSens')) document.getElementById('val-camSens')!.innerText = s.camSens.toFixed(1);
        if (document.getElementById('val-vol')) document.getElementById('val-vol')!.innerText = s.masterVolume.toFixed(2);
        if (document.getElementById('val-musicVol')) document.getElementById('val-musicVol')!.innerText = s.musicVolume.toFixed(2);
        if (document.getElementById('val-sfxVol')) document.getElementById('val-sfxVol')!.innerText = s.sfxVolume.toFixed(2);
        if (document.getElementById('val-uiVol')) document.getElementById('val-uiVol')!.innerText = s.uiVolume.toFixed(2);
        if (document.getElementById('val-voiceVol') && voiceVol) document.getElementById('val-voiceVol')!.innerText = (s.voiceVolume ?? 0.8).toFixed(2);
        if (document.getElementById('val-hud')) document.getElementById('val-hud')!.innerText = s.hudScale.toFixed(2);
        if (document.getElementById('val-crossSize')) document.getElementById('val-crossSize')!.innerText = s.crosshairSize + 'px';
        if (document.getElementById('val-fov')) document.getElementById('val-fov')!.innerText = s.fov.toString();

        if (document.getElementById('val-bloomStrength')) {
            document.getElementById('val-bloomStrength')!.innerText = s.bloomStrength.toFixed(1);
        }
        if (document.getElementById('val-vignetteIntensity')) {
            document.getElementById('val-vignetteIntensity')!.innerText = s.vignetteIntensity.toFixed(1);
        }
        if (document.getElementById('val-chromaticAberrationIntensity')) {
            document.getElementById('val-chromaticAberrationIntensity')!.innerText = s.chromaticAberrationIntensity.toFixed(3);
        }
        if (document.getElementById('val-exposure')) {
            document.getElementById('val-exposure')!.innerText = s.exposure.toFixed(1);
        }

        saveSettings(s);
        applySettings(s);
    };

    [joySens, camSens, invY, fxaa, vol, musicVol, sfxVol, uiVol, voiceVol, spatial, music, ui, hud, crossSize, fov, rendType].forEach(el => {
        if (!el) return;
        bind(el as HTMLElement, 'input', triggerApply);
        bind(el as HTMLElement, 'change', triggerApply);
    });

    // Bind custom graphics controls. Changing any shifts preset to 'Custom'
    const customGraphicsControls = [
        shadows, pbrMaterials, parallaxOcclusion, instancedProps, flashLight, ssao, bloom, bloomStrength,
        vignette, vignetteIntensity, chromaticAberration, chromaticAberrationIntensity, toneMapping, exposure
    ];
    customGraphicsControls.forEach(el => {
        if (!el) return;
        bind(el as HTMLElement, 'change', () => {
            s.graphicsPreset = 'Custom';
            syncPresets();
            triggerApply();
        });
        bind(el as HTMLElement, 'input', () => {
            s.graphicsPreset = 'Custom';
            syncPresets();
            triggerApply();
        });
    });

    const prRadios = document.querySelectorAll('input[name="pixelRatioMode"]');
    prRadios.forEach(r => {
        bind(r as HTMLElement, 'change', () => {
            s.graphicsPreset = 'Custom';
            syncPresets();
            triggerApply();
        });
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
                desc.innerText = "Low: Shadows off, particles off, normal maps disabled, post-effects disabled. (60 FPS focus)";
            } else if (s.graphicsPreset === 'Medium') {
                s.particleCount = 50; s.lodBillboard = 60; s.lodLow = 30;
                desc.innerText = "Medium: Shadows, Bloom, Vignette, and normal maps enabled. (Balanced)";
            } else if (s.graphicsPreset === 'High') {
                s.particleCount = 100; s.lodBillboard = 60; s.lodLow = 30;
                desc.innerText = "High: GTAO Ambient Occlusion, Bloom, Vignette, Chromatic Aberration, POM, and shadows active. (Max Visuals)";
            } else {
                desc.innerText = "Custom Settings: Quality components modified individually.";
            }
        }
    };
    
    presets.forEach(p => {
        bind(p as HTMLElement, 'click', () => {
            const val = p.getAttribute('data-val') as any;
            if (val === 'Custom') return;
            s.graphicsPreset = val;

            if (val === 'Low') {
                s.shadows = false;
                s.ssao = false;
                s.bloom = false;
                s.bloomStrength = 0.0;
                s.vignette = false;
                s.vignetteIntensity = 0.0;
                s.chromaticAberration = false;
                s.chromaticAberrationIntensity = 0.0;
                s.toneMapping = 'none';
                s.exposure = 1.0;
                s.parallaxOcclusion = false;
                s.pbrMaterials = false;
                s.instancedProps = false;
                s.flashLight = false;
                s.pixelRatioMode = '0.75';
                s.fxaa = false;
            } else if (val === 'Medium') {
                s.shadows = true;
                s.ssao = false;
                s.bloom = true;
                s.bloomStrength = 1.0;
                s.vignette = true;
                s.vignetteIntensity = 0.5;
                s.chromaticAberration = false;
                s.chromaticAberrationIntensity = 0.005;
                s.toneMapping = 'aces';
                s.exposure = 1.0;
                s.parallaxOcclusion = true;
                s.pbrMaterials = true;
                s.instancedProps = true;
                s.flashLight = true;
                s.pixelRatioMode = '1.5';
                s.fxaa = false;
            } else if (val === 'High') {
                s.shadows = true;
                s.ssao = true;
                s.bloom = true;
                s.bloomStrength = 1.5;
                s.vignette = true;
                s.vignetteIntensity = 0.8;
                s.chromaticAberration = true;
                s.chromaticAberrationIntensity = 0.010;
                s.toneMapping = 'aces';
                s.exposure = 1.1;
                s.parallaxOcclusion = true;
                s.pbrMaterials = true;
                s.instancedProps = true;
                s.flashLight = true;
                s.pixelRatioMode = 'native';
                s.fxaa = true;
            }

            populateUIFromSettings();
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

    const devTabBtn = document.getElementById("btn-tab-dev");
    if (devTabBtn) {
        if (matchActiveInSettings) {
            devTabBtn.style.display = 'none';
        } else {
            devTabBtn.style.display = 'block';
            
            // Logic for the Dev tab
            const clearCacheBtn = document.getElementById("btn-clear-cache");
            if (clearCacheBtn) {
                bind(clearCacheBtn, 'click', async () => {
                    if (confirm("Are you sure you want to clear the entire local cache? All assets will be redownloaded.")) {
                        await clearCache();
                        refreshDevFileList();
                    }
                });
            }

            const refreshDevFileList = async () => {
                const listEl = document.getElementById("dev-file-list");
                if (!listEl) return;
                listEl.innerHTML = '<p class="text-gray-500 italic">Scanning local IndexedDB...</p>';
                
                const files = await listCachedFiles();
                if (files.length === 0) {
                    listEl.innerHTML = '<p class="text-gray-500 italic">No files in cache.</p>';
                    return;
                }

                // Sort by name
                files.sort((a, b) => a.filename.localeCompare(b.filename));

                listEl.innerHTML = "";
                files.forEach(f => {
                    const row = document.createElement("div");
                    Object.assign(row.style, {
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "8px 12px", background: "${DS.utils.rgba(DS.colors.text, 0.03)}",
                        border: "1px solid ${DS.utils.rgba(DS.colors.text, 0.05)}", borderRadius: "4px"
                    });

                    const info = document.createElement("div");
                    info.style.display = "flex";
                    info.style.flexDirection = "column";
                    
                    const name = document.createElement("span");
                    name.textContent = f.filename;
                    name.style.fontSize = "14px";
                    name.style.fontWeight = "bold";
                    name.style.color = "#E8E8E8";

                    const meta = document.createElement("span");
                    const sizeKB = (f.size / 1024).toFixed(1);
                    const date = new Date(f.timestamp).toLocaleDateString();
                    meta.textContent = `${sizeKB} KB | ${date}`;
                    meta.style.fontSize = "11px";
                    meta.style.color = "#888";

                    info.appendChild(name);
                    info.appendChild(meta);

                    const delBtn = document.createElement("button");
                    delBtn.textContent = "DELETE";
                    Object.assign(delBtn.style, {
                        padding: "4px 8px", background: "rgba(255,0,0,0.1)",
                        border: "1px solid rgba(255,0,0,0.3)", color: "#FF6666",
                        fontSize: "10px", fontWeight: "bold", cursor: "pointer",
                        borderRadius: "2px"
                    });
                    delBtn.onclick = async (e) => {
                        e.stopPropagation();
                        await deleteCachedFile(f.filename);
                        refreshDevFileList();
                    };

                    row.appendChild(info);
                    row.appendChild(delBtn);
                    listEl.appendChild(row);
                });
            };

            // Initial load when tab is clicked
            bind(devTabBtn, 'click', () => {
                refreshDevFileList();
            });
        }
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
        <button id="btn-quit-match" style="height: 48px; background: transparent; border: 1px solid ${DS.colors.danger}; color: ${DS.colors.danger}; font-family: ${DS.typography.fontFamily}; font-size: 24px; font-weight: bold; text-transform: uppercase; border-radius: 0; width: 100%; cursor: pointer;">QUIT MATCH</button>
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
                background: DS.utils.rgba('#000000', 0.9), display: 'flex',
                alignItems: 'center', justifyContent: 'center'
            });
            
            const card = document.createElement('div');
            Object.assign(card.style, {
                width: '400px', background: DS.colors.surface, border: `1px solid ${DS.colors.danger}`,
                padding: '32px', borderRadius: '0'
            });
            
            const title = document.createElement('div');
            title.innerText = 'ABANDON MISSION';
            Object.assign(title.style, {
                fontFamily: DS.typography.fontFamily, fontSize: '24px',
                color: DS.colors.textPrimary, textTransform: 'uppercase', marginBottom: '8px'
            });
            
            const body = document.createElement('div');
            body.innerText = 'You will be removed from the match. The mission continues without you.';
            Object.assign(body.style, {
                fontFamily: DS.typography.fontFamily, fontSize: '14px',
                color: DS.colors.textSecondary, marginBottom: '24px'
            });
            
            const btnWrap = document.createElement('div');
            Object.assign(btnWrap.style, { display: 'flex', gap: '16px' });
            
            const confBtn = document.createElement('button');
            confBtn.innerText = 'CONFIRM';
            Object.assign(confBtn.style, {
                background: DS.colors.danger, color: DS.colors.background,
                fontFamily: DS.typography.fontFamily, fontSize: '18px',
                fontWeight: 'bold', textTransform: 'uppercase', borderRadius: '0',
                padding: '8px 16px', border: 'none', cursor: 'pointer'
            });
            
            const cancBtn = document.createElement('button');
            cancBtn.innerText = 'CANCEL';
            Object.assign(cancBtn.style, {
                background: 'transparent', border: `1px solid ${DS.colors.border}`,
                color: DS.colors.textSecondary, padding: '8px 16px', cursor: 'pointer'
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
            
            const devBtn = document.getElementById("btn-tab-dev");
            if (devBtn) {
                devBtn.style.display = 'none';
                if (devBtn.classList.contains('active')) {
                    const controlsBtn = document.querySelector('.settings-tab[data-tab="CONTROLS"]') as HTMLElement;
                    if (controlsBtn) controlsBtn.click();
                }
            }
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

        const devBtn = document.getElementById("btn-tab-dev");
        if (devBtn) devBtn.style.display = 'block';

        // if we removed the active tab, switch back to controls
        if (btn?.classList.contains('active')) {
            const controlsBtn = document.querySelector('.settings-tab[data-tab="CONTROLS"]') as HTMLElement;
            if (controlsBtn) controlsBtn.click();
        }
    }
}
