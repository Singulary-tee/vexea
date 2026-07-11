import { getAssetUrl } from "./asset-cache";

export const initUIEditor = () => {
    const settingsModal = document.getElementById("settings-modal");
    const hudContainer = document.getElementById("hud-container");
    
    if (!hudContainer) return;

    let isEditing = false;
    let selectedElement: HTMLElement | null = null;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;

    interface ElementState {
        leftPx: number;
        topPx: number;
        scale: number;
        widthPx?: number;
        heightPx?: number;
    }
    const elementStates = new Map<HTMLElement, ElementState>();
    
    // Grid alignment and snapping variables
    let gridSnapSize = 5;
    let gridOffsetX = 0;
    let gridOffsetY = 0;
    let showVisualGrid = true;

    // Reference Image variables
    let refOpacity = 1.0;
    let refScale = 100;
    let refOffsetX = 0;
    let refOffsetY = 0;

    const getGridSnap = (val: number, snap = 5, offset = 0) => {
        if (snap <= 1) return val;
        return Math.round((val - offset) / snap) * snap + offset;
    };
    
    // Floating UI Editor Window
    const editorBar = document.createElement("div");
    editorBar.id = "ui-editor-bar";
    editorBar.style.position = "absolute";
    editorBar.style.top = "50px";
    editorBar.style.left = "50px";
    editorBar.style.width = "320px";
    editorBar.style.background = "rgba(10, 10, 10, 0.95)";
    editorBar.style.color = "white";
    editorBar.style.display = "none";
    editorBar.style.flexDirection = "column";
    editorBar.style.padding = "20px";
    editorBar.style.zIndex = "100000";
    editorBar.style.border = "2px solid #333";
    editorBar.style.borderRadius = "8px";
    editorBar.style.pointerEvents = "auto";
    editorBar.style.cursor = "move";
    editorBar.style.boxShadow = "0 8px 32px rgba(0,0,0,0.8)";

    editorBar.innerHTML = `
        <div style="font-weight: bold; color: #22c55e; margin-bottom: 15px; text-align: center; pointer-events: none; font-family: monospace; font-size: 14px; letter-spacing: 1px;">VEXEA HUD EDITOR</div>
        <div id="editor-selected" style="margin-bottom: 15px; text-align: center; pointer-events: none; font-family: monospace; font-size: 11px; color: #aaa; background: #151515; padding: 6px; border-radius: 4px;">Selected: None</div>
        
        <!-- Tab Headers -->
        <div style="display: flex; background: #111; padding: 2px; border-radius: 6px; margin-bottom: 15px; gap: 2px; border: 1px solid #222;">
            <button id="tab-element" style="flex: 1; padding: 6px; background: #22c55e; color: black; border: none; font-size: 11px; cursor: pointer; font-weight: bold; border-radius: 4px; transition: all 0.2s;">ELEMENT</button>
            <button id="tab-grid" style="flex: 1; padding: 6px; background: transparent; color: #888; border: none; font-size: 11px; cursor: pointer; font-weight: bold; border-radius: 4px; transition: all 0.2s;">GRID & REF</button>
        </div>

        <!-- Panel 1: Element Properties -->
        <div id="panel-element" style="display: flex; flex-direction: column; gap: 12px; font-family: monospace; font-size: 11px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Slider Step:</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="range" id="editor-step" min="0.1" max="10" step="0.1" value="1" style="width: 100px; accent-color: #22c55e;">
                    <input type="number" id="editor-step-num" min="0.1" max="10" step="0.1" value="1.0" style="width: 65px; background: #151515; color: #22c55e; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                </div>
            </div>

            <!-- Position Controls -->
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Left (px):</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="range" id="editor-left" min="0" max="1920" step="1" value="0" disabled style="width: 100px; accent-color: #22c55e;">
                    <input type="number" id="editor-left-num" min="-500" max="3840" step="1" value="0" disabled style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Top (px):</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="range" id="editor-top" min="0" max="1080" step="1" value="0" disabled style="width: 100px; accent-color: #22c55e;">
                    <input type="number" id="editor-top-num" min="-500" max="2160" step="1" value="0" disabled style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                </div>
            </div>

            <div id="editor-size-wrap" style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>Scale:</span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <input type="range" id="editor-scale" min="0.1" max="5" step="0.05" value="1" disabled style="width: 100px; accent-color: #22c55e;">
                        <input type="number" id="editor-scale-num" min="0.1" max="5" step="0.01" value="1.00" disabled style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                    </div>
                </div>
            </div>

            <div id="editor-dim-wrap" style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>Width (px):</span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <input type="range" id="editor-width" min="10" max="1200" step="1" value="100" disabled style="width: 100px; accent-color: #22c55e;">
                        <input type="number" id="editor-width-num" min="10" max="2000" step="1" value="100" disabled style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                    </div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>Height (px):</span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <input type="range" id="editor-height" min="10" max="1200" step="1" value="100" disabled style="width: 100px; accent-color: #22c55e;">
                        <input type="number" id="editor-height-num" min="10" max="2000" step="1" value="100" disabled style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                    </div>
                </div>
            </div>
        </div>

        <!-- Panel 2: Grid & Reference Properties -->
        <div id="panel-grid" style="display: none; flex-direction: column; gap: 12px; font-family: monospace; font-size: 11px;">
            <!-- Grid Snap Size -->
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Grid Snap (px):</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="range" id="grid-snap" min="1" max="100" step="1" value="5" style="width: 100px; accent-color: #22c55e;">
                    <input type="number" id="grid-snap-num" min="1" max="100" step="1" value="5" style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                </div>
            </div>

            <!-- Grid Offset X -->
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Grid Offset X:</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="range" id="grid-offset-x" min="-100" max="100" step="1" value="0" style="width: 100px; accent-color: #22c55e;">
                    <input type="number" id="grid-offset-x-num" min="-100" max="100" step="1" value="0" style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                </div>
            </div>

            <!-- Grid Offset Y -->
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Grid Offset Y:</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="range" id="grid-offset-y" min="-100" max="100" step="1" value="0" style="width: 100px; accent-color: #22c55e;">
                    <input type="number" id="grid-offset-y-num" min="-100" max="100" step="1" value="0" style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                </div>
            </div>

            <!-- Show Grid Checkbox -->
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Show Visual Grid:</span>
                <input type="checkbox" id="show-grid-checkbox" checked style="cursor: pointer; width: 16px; height: 16px; accent-color: #22c55e;">
            </div>

            <!-- Divider -->
            <div style="border-top: 1px solid #222; margin: 5px 0;"></div>

            <!-- Ref Opacity -->
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Ref Opacity:</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="range" id="ref-opacity" min="0" max="1" step="0.05" value="1" style="width: 100px; accent-color: #22c55e;">
                    <input type="number" id="ref-opacity-num" min="0" max="1" step="0.01" value="1.00" style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                </div>
            </div>

            <!-- Ref Scale -->
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Ref Scale (%):</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="range" id="ref-scale" min="10" max="300" step="1" value="100" style="width: 100px; accent-color: #22c55e;">
                    <input type="number" id="ref-scale-num" min="10" max="300" step="1" value="100" style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                </div>
            </div>

            <!-- Ref Offset X -->
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Ref Offset X (px):</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="range" id="ref-offset-x" min="-1000" max="1000" step="1" value="0" style="width: 100px; accent-color: #22c55e;">
                    <input type="number" id="ref-offset-x-num" min="-2000" max="2000" step="1" value="0" style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                </div>
            </div>

            <!-- Ref Offset Y -->
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Ref Offset Y (px):</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="range" id="ref-offset-y" min="-1000" max="1000" step="1" value="0" style="width: 100px; accent-color: #22c55e;">
                    <input type="number" id="ref-offset-y-num" min="-2000" max="2000" step="1" value="0" style="width: 65px; background: #151515; color: #fff; border: 1px solid #333; border-radius: 4px; padding: 3px 6px; font-size: 11px; text-align: right; font-family: monospace;">
                </div>
            </div>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="editor-save" style="flex: 1; padding: 10px; background: #22c55e; color: black; border: none; font-weight: bold; cursor: pointer; border-radius: 4px; font-family: sans-serif; font-size: 11px;">Save Local</button>
            <button id="editor-export" style="flex: 1; padding: 10px; background: #0ea5e9; color: white; border: none; font-weight: bold; cursor: pointer; border-radius: 4px; font-family: sans-serif; font-size: 11px;">Export JSON</button>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 10px;">
            <button id="editor-reset" style="flex: 1; padding: 10px; background: #f87171; color: black; border: none; font-weight: bold; cursor: pointer; border-radius: 4px; font-family: sans-serif; font-size: 11px;">Reset Default</button>
            <button id="editor-close" style="flex: 1; padding: 10px; background: #555; color: white; border: none; cursor: pointer; border-radius: 4px; font-family: sans-serif; font-size: 11px;">Close</button>
        </div>`;
    hudContainer.appendChild(editorBar);

    const circularIds = new Set([
        "joystick-boundary", "btn-sprint", "btn-fire-left", "btn-fire-right", 
        "btn-ads", "btn-reload", "btn-jump", "btn-dash", "btn-crouch", 
        "btn-walkie", "btn-helmet", "btn-medkit"
    ]);

    // Draggable logic for the editor bar
    let editorDrag = false;
    let edStartX = 0, edStartY = 0;
    let edStartLeft = 0, edStartTop = 0;
    
    editorBar.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'INPUT') return;
        editorDrag = true;
        edStartX = e.clientX;
        edStartY = e.clientY;
        const rect = editorBar.getBoundingClientRect();
        edStartLeft = rect.left;
        edStartTop = rect.top;
        e.preventDefault();
        e.stopPropagation();
    });
    
    window.addEventListener('pointermove', (e) => {
        if (!editorDrag) return;
        const dx = e.clientX - edStartX;
        const dy = e.clientY - edStartY;
        editorBar.style.left = `${edStartLeft + dx}px`;
        editorBar.style.top = `${edStartTop + dy}px`;
    });
    
    window.addEventListener('pointerup', () => {
        editorDrag = false;
    });

    // Create Background Reference Image
    const bgImage = document.createElement('div');
    bgImage.id = "editor-bg-image";
    bgImage.style.position = "fixed";
    bgImage.style.inset = "0";
    bgImage.style.zIndex = "-1";
    bgImage.style.backgroundRepeat = "no-repeat";
    bgImage.style.backgroundSize = "cover";
    bgImage.style.backgroundPosition = "center";
    bgImage.style.display = "none";
    bgImage.style.pointerEvents = "none";
    
    hudContainer.prepend(bgImage);

    // Create Visual Grid Overlay
    const gridOverlay = document.createElement("div");
    gridOverlay.id = "editor-grid-overlay";
    gridOverlay.style.position = "fixed";
    gridOverlay.style.inset = "0";
    gridOverlay.style.zIndex = "1"; // Above background, below HUD controls
    gridOverlay.style.pointerEvents = "none";
    gridOverlay.style.display = "none";
    hudContainer.appendChild(gridOverlay);

    const updateVisualGrid = () => {
        if (showVisualGrid && gridSnapSize >= 4) {
            gridOverlay.style.display = "block";
            const opacity = gridSnapSize < 10 ? 0.04 : 0.1;
            gridOverlay.style.backgroundImage = `
                linear-gradient(to right, rgba(255, 255, 255, ${opacity}) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(255, 255, 255, ${opacity}) 1px, transparent 1px)
            `;
            gridOverlay.style.backgroundSize = `${gridSnapSize}px ${gridSnapSize}px`;
            gridOverlay.style.backgroundPosition = `${gridOffsetX}px ${gridOffsetY}px`;
        } else {
            gridOverlay.style.display = "none";
        }
    };

    const updateRefImage = () => {
        bgImage.style.opacity = refOpacity.toString();
        bgImage.style.backgroundSize = `${refScale}%`;
        bgImage.style.backgroundPosition = `calc(50% + ${refOffsetX}px) calc(50% + ${refOffsetY}px)`;
    };

    const editableIds = [
        "squad-container",
        "hud-timer-container",
        "minimap-container",
        "minimap-label",
        "btn-settings",
        "btn-mic",
        "btn-chat",
        "joystick-boundary",
        "btn-sprint",
        "btn-fire-left",
        "weapon-slots-wrap",
        "btn-walkie",
        "btn-helmet",
        "btn-medkit",
        "medkit-arrow",
        "compass-placeholder",
        "auto-label",
        "health-bar",
        "health-plus-sq-wrap",
        "btn-fire-right",
        "btn-ads",
        "btn-reload",
        "btn-jump",
        "btn-dash",
        "btn-crouch"
    ];

    const elementsToEdit = editableIds.map(id => document.getElementById(id)).filter(el => el !== null) as HTMLElement[];

    const closeEditorBtn = editorBar.querySelector("#editor-close") as HTMLButtonElement;
    const selectedLabel = editorBar.querySelector("#editor-selected") as HTMLElement;
    
    // Tab Selectors
    const tabElement = editorBar.querySelector("#tab-element") as HTMLButtonElement;
    const tabGrid = editorBar.querySelector("#tab-grid") as HTMLButtonElement;
    const panelElement = editorBar.querySelector("#panel-element") as HTMLElement;
    const panelGrid = editorBar.querySelector("#panel-grid") as HTMLElement;

    tabElement.addEventListener("click", () => {
        tabElement.style.background = "#22c55e";
        tabElement.style.color = "black";
        tabGrid.style.background = "transparent";
        tabGrid.style.color = "#888";
        panelElement.style.display = "flex";
        panelGrid.style.display = "none";
    });

    tabGrid.addEventListener("click", () => {
        tabGrid.style.background = "#22c55e";
        tabGrid.style.color = "black";
        tabElement.style.background = "transparent";
        tabElement.style.color = "#888";
        panelGrid.style.display = "flex";
        panelElement.style.display = "none";
    });

    // Element Panel Inputs
    const scaleSlider = editorBar.querySelector("#editor-scale") as HTMLInputElement;
    const scaleNum = editorBar.querySelector("#editor-scale-num") as HTMLInputElement;
    const widthSlider = editorBar.querySelector("#editor-width") as HTMLInputElement;
    const widthNum = editorBar.querySelector("#editor-width-num") as HTMLInputElement;
    const heightSlider = editorBar.querySelector("#editor-height") as HTMLInputElement;
    const heightNum = editorBar.querySelector("#editor-height-num") as HTMLInputElement;
    
    const leftSlider = editorBar.querySelector("#editor-left") as HTMLInputElement;
    const leftNum = editorBar.querySelector("#editor-left-num") as HTMLInputElement;
    const topSlider = editorBar.querySelector("#editor-top") as HTMLInputElement;
    const topNum = editorBar.querySelector("#editor-top-num") as HTMLInputElement;

    const stepSlider = editorBar.querySelector("#editor-step") as HTMLInputElement;
    const stepNum = editorBar.querySelector("#editor-step-num") as HTMLInputElement;

    const sizeWrap = editorBar.querySelector("#editor-size-wrap") as HTMLElement;
    const dimWrap = editorBar.querySelector("#editor-dim-wrap") as HTMLElement;
    
    // Grid & Ref Panel Inputs
    const gridSnapSlider = editorBar.querySelector("#grid-snap") as HTMLInputElement;
    const gridSnapNum = editorBar.querySelector("#grid-snap-num") as HTMLInputElement;
    const gridOffsetXSlider = editorBar.querySelector("#grid-offset-x") as HTMLInputElement;
    const gridOffsetXNum = editorBar.querySelector("#grid-offset-x-num") as HTMLInputElement;
    const gridOffsetYSlider = editorBar.querySelector("#grid-offset-y") as HTMLInputElement;
    const gridOffsetYNum = editorBar.querySelector("#grid-offset-y-num") as HTMLInputElement;
    const showGridCheckbox = editorBar.querySelector("#show-grid-checkbox") as HTMLInputElement;

    const refOpacitySlider = editorBar.querySelector("#ref-opacity") as HTMLInputElement;
    const refOpacityNum = editorBar.querySelector("#ref-opacity-num") as HTMLInputElement;
    const refScaleSlider = editorBar.querySelector("#ref-scale") as HTMLInputElement;
    const refScaleNum = editorBar.querySelector("#ref-scale-num") as HTMLInputElement;
    const refOffsetXSlider = editorBar.querySelector("#ref-offset-x") as HTMLInputElement;
    const refOffsetXNum = editorBar.querySelector("#ref-offset-x-num") as HTMLInputElement;
    const refOffsetYSlider = editorBar.querySelector("#ref-offset-y") as HTMLInputElement;
    const refOffsetYNum = editorBar.querySelector("#ref-offset-y-num") as HTMLInputElement;

    const exportBtn = editorBar.querySelector("#editor-export") as HTMLButtonElement;
    const saveBtn = editorBar.querySelector("#editor-save") as HTMLButtonElement;
    const resetBtn = editorBar.querySelector("#editor-reset") as HTMLButtonElement;

    // Helper for Bidirectional Slider-Number sync
    const bindSliderAndNumber = (
        slider: HTMLInputElement,
        numInput: HTMLInputElement,
        onChange: (val: number) => void,
        decimalPlaces = 0
    ) => {
        slider.addEventListener("input", (e: any) => {
            const val = parseFloat(e.target.value);
            numInput.value = val.toFixed(decimalPlaces);
            onChange(val);
        });
        numInput.addEventListener("input", (e: any) => {
            let val = parseFloat(e.target.value);
            if (isNaN(val)) return;
            const min = parseFloat(slider.min);
            const max = parseFloat(slider.max);
            if (val < min) val = min;
            if (val > max) val = max;
            slider.value = val.toString();
            onChange(val);
        });
    };

    // Load from local storage or fallback to default preferred layout
    let savedConfigRaw = localStorage.getItem("hud_layout");
    if (!savedConfigRaw) {
        // User's default preferred layout
        const defaultLayout = {
  "squad-container": {
    "left": "12.3611px",
    "top": "8.06111px",
    "scale": 1.2
  },
  "hud-timer-container": {
    "left": "356px",
    "top": "28px",
    "scale": 1,
    "width": "131.2px",
    "height": "20.4px"
  },
  "minimap-container": {
    "left": "706px",
    "top": "20px",
    "scale": 1,
    "width": "101px",
    "height": "87px"
  },
  "minimap-label": {
    "left": "708px",
    "top": "110px",
    "scale": 1
  },
  "btn-settings": {
    "left": "671px",
    "top": "13px",
    "scale": 1,
    "width": "34px",
    "height": "34px"
  },
  "btn-mic": {
    "left": "671px",
    "top": "74px",
    "scale": 1,
    "width": "34px",
    "height": "34px"
  },
  "btn-chat": {
    "left": "671px",
    "top": "43px",
    "scale": 1,
    "width": "34px",
    "height": "34px"
  },
  "joystick-boundary": {
    "left": "96px",
    "top": "234px",
    "scale": 0.6
  },
  "btn-sprint": {
    "left": "7.14vw",
    "top": "16.56vh",
    "scale": 1
  },
  "btn-fire-left": {
    "left": "34px",
    "top": "160px",
    "scale": 1.2
  },
  "weapon-slots-wrap": {
    "left": "378px",
    "top": "304px",
    "scale": 1,
    "width": "176.5px",
    "height": "28px"
  },
  "btn-walkie": {
    "left": "296px",
    "top": "282px",
    "scale": 1.22
  },
  "btn-helmet": {
    "left": "344px",
    "top": "306px",
    "scale": 0.58,
    "width": "64px",
    "height": "64px"
  },
  "btn-medkit": {
    "left": "578px",
    "top": "314px",
    "scale": 0.6
  },
  "medkit-arrow": {
    "left": "585px",
    "top": "300px",
    "scale": 1,
    "width": "24px",
    "height": "24px"
  },
  "compass-placeholder": {
    "left": "340px",
    "top": "12px",
    "scale": 1,
    "width": "164.83334350585938px",
    "height": "35.7px"
  },
  "auto-label": {
    "left": "402px",
    "top": "288px",
    "scale": 1,
    "width": "60.6px"
  },
  "health-bar": {
    "left": "334px",
    "top": "352px",
    "scale": 0.8,
    "width": "230px",
    "height": "10px"
  },
  "health-plus-sq-wrap": {
    "left": "304px",
    "top": "338px",
    "scale": 2.9,
    "width": "30.5px",
    "height": "35.5px"
  },
  "btn-fire-right": {
    "left": "704px",
    "top": "232px",
    "scale": 0.6
  },
  "btn-ads": {
    "left": "744px",
    "top": "186px",
    "scale": 0.62
  },
  "btn-reload": {
    "left": "660px",
    "top": "274px",
    "scale": 0.95
  },
  "btn-jump": {
    "left": "674px",
    "top": "326px",
    "scale": 0.6
  },
  "btn-crouch": {
    "left": "720px",
    "top": "316px",
    "scale": 0.85
  }
};
        savedConfigRaw = JSON.stringify(defaultLayout);
    }

    if (savedConfigRaw) {
        try {
            const config = JSON.parse(savedConfigRaw);
            elementsToEdit.forEach(el => {
                if (config[el.id]) {
                    const saved = config[el.id];
                    el.style.setProperty('position', 'absolute', 'important');
                    el.style.setProperty('left', saved.left, 'important');
                    el.style.setProperty('top', saved.top, 'important');
                    el.style.setProperty('right', 'auto', 'important');
                    el.style.setProperty('bottom', 'auto', 'important');
                    el.style.setProperty('margin', '0', 'important');
                    
                    let w = el.getBoundingClientRect().width;
                    let h = el.getBoundingClientRect().height;
                    
                    if (circularIds.has(el.id)) {
                        el.style.setProperty('transform', `scale(${saved.scale})`, 'important');
                        el.style.setProperty('transform-origin', 'top left', 'important');
                    } else {
                        if (saved.width) {
                            el.style.setProperty('width', saved.width, 'important');
                            el.style.setProperty('min-width', saved.width, 'important');
                            w = parseFloat(saved.width);
                        }
                        if (saved.height) {
                            el.style.setProperty('height', saved.height, 'important');
                            el.style.setProperty('min-height', saved.height, 'important');
                            h = parseFloat(saved.height);
                        }
                        el.style.setProperty('transform', 'none', 'important');
                    }
                    elementStates.set(el, { 
                        leftPx: parseFloat(saved.left) || 0, 
                        topPx: parseFloat(saved.top) || 0, 
                        scale: saved.scale || 1,
                        widthPx: w,
                        heightPx: h
                    });
                }
            });
        } catch (err) {}
    }

    const onPointerDown = (e: PointerEvent) => {
        if (!isEditing) return;
        const target = e.currentTarget as HTMLElement;
        e.preventDefault();
        e.stopPropagation();

        selectedElement = target;
        selectedLabel.innerText = `Selected: ${target.id}`;
        
        const state = elementStates.get(target);
        if (state) {
            leftSlider.disabled = false;
            leftNum.disabled = false;
            topSlider.disabled = false;
            topNum.disabled = false;

            leftSlider.max = window.innerWidth.toString();
            leftNum.max = window.innerWidth.toString();
            topSlider.max = window.innerHeight.toString();
            topNum.max = window.innerHeight.toString();

            leftSlider.value = state.leftPx.toString();
            leftNum.value = Math.round(state.leftPx).toString();
            topSlider.value = state.topPx.toString();
            topNum.value = Math.round(state.topPx).toString();

            if (circularIds.has(target.id)) {
                if (sizeWrap) sizeWrap.style.display = "flex";
                if (dimWrap) dimWrap.style.display = "none";
                scaleSlider.disabled = false;
                scaleNum.disabled = false;
                widthSlider.disabled = true;
                widthNum.disabled = true;
                heightSlider.disabled = true;
                heightNum.disabled = true;

                scaleSlider.value = state.scale.toString();
                scaleNum.value = state.scale.toFixed(2);
            } else {
                if (sizeWrap) sizeWrap.style.display = "none";
                if (dimWrap) dimWrap.style.display = "flex";
                scaleSlider.disabled = true;
                scaleNum.disabled = true;
                widthSlider.disabled = false;
                widthNum.disabled = false;
                heightSlider.disabled = false;
                heightNum.disabled = false;

                widthSlider.value = state.widthPx ? state.widthPx.toString() : "100";
                widthNum.value = state.widthPx ? Math.round(state.widthPx).toString() : "100";
                heightSlider.value = state.heightPx ? state.heightPx.toString() : "100";
                heightNum.value = state.heightPx ? Math.round(state.heightPx).toString() : "100";
            }
        }

        // Highlight
        elementsToEdit.forEach(el => el.style.outline = "none");
        target.style.outline = "2px dashed #22c55e";

        startX = e.clientX;
        startY = e.clientY;
        if (state) {
            startLeft = state.leftPx;
            startTop = state.topPx;
        }

        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
    };

    const onPointerMove = (e: PointerEvent) => {
        if (!isEditing || !selectedElement) return;
        e.preventDefault();
        
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        const state = elementStates.get(selectedElement);
        if (state) {
            state.leftPx = getGridSnap(startLeft + dx, gridSnapSize, gridOffsetX);
            state.topPx = getGridSnap(startTop + dy, gridSnapSize, gridOffsetY);
            selectedElement.style.setProperty('left', `${state.leftPx}px`, 'important');
            selectedElement.style.setProperty('top', `${state.topPx}px`, 'important');

            // Synchronize control panel input values live!
            leftSlider.value = state.leftPx.toString();
            leftNum.value = Math.round(state.leftPx).toString();
            topSlider.value = state.topPx.toString();
            topNum.value = Math.round(state.topPx).toString();
        }
    };

    const onPointerUp = (e: PointerEvent) => {
        if (!isEditing || !selectedElement) return;
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
    };

    // Bind slider step controller
    bindSliderAndNumber(stepSlider, stepNum, (val) => {
        scaleSlider.step = (val / 10).toString();
        scaleNum.step = (val / 10).toString();
        widthSlider.step = val.toString();
        widthNum.step = val.toString();
        heightSlider.step = val.toString();
        heightNum.step = val.toString();
        leftSlider.step = val.toString();
        leftNum.step = val.toString();
        topSlider.step = val.toString();
        topNum.step = val.toString();
    }, 1);

    // Bind element position & properties controllers
    bindSliderAndNumber(leftSlider, leftNum, (val) => {
        if (!selectedElement) return;
        const state = elementStates.get(selectedElement);
        if (state) {
            state.leftPx = val;
            selectedElement.style.setProperty('left', `${val}px`, 'important');
        }
    }, 0);

    bindSliderAndNumber(topSlider, topNum, (val) => {
        if (!selectedElement) return;
        const state = elementStates.get(selectedElement);
        if (state) {
            state.topPx = val;
            selectedElement.style.setProperty('top', `${val}px`, 'important');
        }
    }, 0);

    bindSliderAndNumber(scaleSlider, scaleNum, (val) => {
        if (!selectedElement) return;
        const state = elementStates.get(selectedElement);
        if (state && circularIds.has(selectedElement.id)) {
            state.scale = val;
            selectedElement.style.setProperty('transform', `scale(${val})`, 'important');
            selectedElement.style.setProperty('transform-origin', 'top left', 'important');
        }
    }, 2);

    bindSliderAndNumber(widthSlider, widthNum, (val) => {
        if (!selectedElement) return;
        const state = elementStates.get(selectedElement);
        if (state && !circularIds.has(selectedElement.id)) {
            state.widthPx = val;
            selectedElement.style.setProperty('width', `${val}px`, 'important');
            selectedElement.style.setProperty('min-width', `${val}px`, 'important');
        }
    }, 0);

    bindSliderAndNumber(heightSlider, heightNum, (val) => {
        if (!selectedElement) return;
        const state = elementStates.get(selectedElement);
        if (state && !circularIds.has(selectedElement.id)) {
            state.heightPx = val;
            selectedElement.style.setProperty('height', `${val}px`, 'important');
            selectedElement.style.setProperty('min-height', `${val}px`, 'important');
        }
    }, 0);

    // Bind Grid Controllers
    bindSliderAndNumber(gridSnapSlider, gridSnapNum, (val) => {
        gridSnapSize = val;
        updateVisualGrid();
    }, 0);

    bindSliderAndNumber(gridOffsetXSlider, gridOffsetXNum, (val) => {
        gridOffsetX = val;
        updateVisualGrid();
    }, 0);

    bindSliderAndNumber(gridOffsetYSlider, gridOffsetYNum, (val) => {
        gridOffsetY = val;
        updateVisualGrid();
    }, 0);

    showGridCheckbox.addEventListener("change", (e: any) => {
        showVisualGrid = e.target.checked;
        updateVisualGrid();
    });

    // Bind Reference Image Controllers
    bindSliderAndNumber(refOpacitySlider, refOpacityNum, (val) => {
        refOpacity = val;
        updateRefImage();
    }, 2);

    bindSliderAndNumber(refScaleSlider, refScaleNum, (val) => {
        refScale = val;
        updateRefImage();
    }, 0);

    bindSliderAndNumber(refOffsetXSlider, refOffsetXNum, (val) => {
        refOffsetX = val;
        updateRefImage();
    }, 0);

    bindSliderAndNumber(refOffsetYSlider, refOffsetYNum, (val) => {
        refOffsetY = val;
        updateRefImage();
    }, 0);

    (window as any).vexeaEditUI = () => {
    	const s = (window as any).vexeaSettings || {};
        const refImg = s.referenceImage || getAssetUrl("file_00000000cdd071f48495d22753c89fa1.png");
        bgImage.style.backgroundImage = `url('${refImg}')`;
        hudContainer.style.setProperty("display", "block", "important");
        if (settingsModal) settingsModal.style.display = "none";
        isEditing = true;
        editorBar.style.display = "flex";
        bgImage.style.display = "block";
        (window as any).isEditMode = true; // Flag for main.ts 
        
        const canvasContainer = document.getElementById("canvas-container");
        if (canvasContainer) {
            canvasContainer.style.display = "none";
        }
        
        // Show/refresh grid and ref image according to saved inputs
        showVisualGrid = showGridCheckbox.checked;
        updateVisualGrid();
        updateRefImage();

        elementsToEdit.forEach(el => {
            if (!elementStates.has(el)) {
                // Initialize clean pixel positions the first time we enter edit mode
                const rect = el.getBoundingClientRect();
                const parentRect = hudContainer.getBoundingClientRect();
                const left = rect.left - parentRect.left;
                const top = rect.top - parentRect.top;

                el.style.setProperty('position', 'absolute', 'important');
                el.style.setProperty('left', `${left}px`, 'important');
                el.style.setProperty('top', `${top}px`, 'important');
                el.style.setProperty('right', 'auto', 'important');
                el.style.setProperty('bottom', 'auto', 'important');
                el.style.setProperty('margin', '0', 'important');
                
                if (circularIds.has(el.id)) {
                    el.style.setProperty('transform', 'scale(1)', 'important');
                    el.style.setProperty('transform-origin', 'top left', 'important');
                } else {
                    el.style.setProperty('transform', 'none', 'important');
                }
                
                elementStates.set(el, { 
                    leftPx: left, 
                    topPx: top, 
                    scale: 1,
                    widthPx: rect.width,
                    heightPx: rect.height
                });
            }

            el.addEventListener("pointerdown", onPointerDown as any);
            el.style.setProperty('pointer-events', 'auto', 'important');
            el.style.cursor = "move";
            el.style.outline = "1px solid rgba(255,255,255,0.3)";
            if (el.id === "btn-sprint") {
                el.style.setProperty('display', 'flex', 'important');
            }
        });
    };

    closeEditorBtn.addEventListener("click", () => {
        isEditing = false;
        editorBar.style.display = "none";
        bgImage.style.display = "none";
        gridOverlay.style.display = "none";
        selectedElement = null;
        selectedLabel.innerText = "Selected: None";
        
        leftSlider.disabled = true; leftNum.disabled = true;
        topSlider.disabled = true; topNum.disabled = true;
        scaleSlider.disabled = true; scaleNum.disabled = true;
        widthSlider.disabled = true; widthNum.disabled = true;
        heightSlider.disabled = true; heightNum.disabled = true;
        (window as any).isEditMode = false;

        // Hide HUD container if not in active match
        if ((window as any).gameState !== "ACTIVE_MATCH") {
            hudContainer.style.setProperty("display", "none", "important");
        }

        const canvasContainer = document.getElementById("canvas-container");
        if (canvasContainer) {
            canvasContainer.style.display = "";
        }

        elementsToEdit.forEach(el => {
            el.removeEventListener("pointerdown", onPointerDown as any);
            el.style.cursor = "";
            el.style.outline = "none";
            if (el.id === "btn-sprint") {
                el.style.setProperty('display', 'none', 'important');
            }
        });
    });

    exportBtn.addEventListener("click", () => {
        const config: Record<string, any> = {};
        elementsToEdit.forEach(el => {
            const state = elementStates.get(el);
            config[el.id] = {
                left: el.style.left,
                top: el.style.top,
                scale: state ? state.scale : 1,
                width: state && state.widthPx ? `${state.widthPx}px` : undefined,
                height: state && state.heightPx ? `${state.heightPx}px` : undefined
            };
        });

        const configStr = JSON.stringify(config, null, 2);
        localStorage.setItem("hud_layout_default", configStr); // Make exported config the new default
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(configStr);
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", "hud_layout.json");
        dlAnchorElem.click();
    });

    saveBtn.addEventListener("click", () => {
        const config: Record<string, any> = {};
        elementsToEdit.forEach(el => {
            const state = elementStates.get(el);
            config[el.id] = {
                left: el.style.left,
                top: el.style.top,
                scale: state ? state.scale : 1,
                width: state && state.widthPx ? `${state.widthPx}px` : undefined,
                height: state && state.heightPx ? `${state.heightPx}px` : undefined
            };
        });
        localStorage.setItem("hud_layout", JSON.stringify(config));
        
        const originalText = saveBtn.innerText;
        saveBtn.innerText = "SAVED!";
        saveBtn.style.background = "#ffffff";
        saveBtn.style.color = "#000000";
        setTimeout(() => {
            saveBtn.innerText = originalText;
            saveBtn.style.background = "#22c55e";
            saveBtn.style.color = "black";
        }, 1500);
    });

    resetBtn.addEventListener("click", () => {
        localStorage.removeItem("hud_layout_default");
        localStorage.removeItem("hud_layout");
        location.reload();
    });
};
