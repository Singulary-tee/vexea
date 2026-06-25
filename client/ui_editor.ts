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
    }
    const elementStates = new Map<HTMLElement, ElementState>();
    
    const getGridSnap = (val: number, snap = 10) => Math.round(val / snap) * snap;
    
    // Floating UI Editor Window
    const editorBar = document.createElement("div");
    editorBar.id = "ui-editor-bar";
    editorBar.style.position = "absolute";
    editorBar.style.top = "50px";
    editorBar.style.left = "50px";
    editorBar.style.width = "300px";
    editorBar.style.background = "rgba(0, 0, 0, 0.9)";
    editorBar.style.color = "white";
    editorBar.style.display = "none";
    editorBar.style.flexDirection = "column";
    editorBar.style.padding = "20px";
    editorBar.style.zIndex = "100000";
    editorBar.style.border = "2px solid #444";
    editorBar.style.borderRadius = "8px";
    editorBar.style.pointerEvents = "auto";
    editorBar.style.cursor = "move"; // Indicate draggable

    editorBar.innerHTML = `
        <div style="font-weight: bold; color: #22c55e; margin-bottom: 15px; text-align: center; pointer-events: none;">HUD EDIT MODE</div>
        <div id="editor-selected" style="margin-bottom: 15px; text-align: center; pointer-events: none;">Selected: None</div>
        
        <div style="display: flex; flex-direction: column; gap: 10px;">
            <label style="display: flex; justify-content: space-between;">
                Size: <input type="range" id="editor-size" min="0.1" max="5" step="0.1" value="1" disabled>
            </label>
            <button id="editor-save" style="background: #eab308; border: none; padding: 10px; color: black; border-radius: 4px; font-weight: bold; cursor: pointer;">Save Locally</button>
            <button id="editor-reset" style="background: #ef4444; border: none; padding: 10px; color: white; border-radius: 4px; font-weight: bold; cursor: pointer;">Reset UI</button>
            <button id="editor-export" style="background: #3b82f6; border: none; padding: 10px; color: white; border-radius: 4px; font-weight: bold; cursor: pointer;">Export Config</button>
            <button id="editor-close" style="background: #444; border: none; padding: 10px; color: white; border-radius: 4px; font-weight: bold; cursor: pointer;">Close Editing</button>
        </div>
    `;
    hudContainer.appendChild(editorBar);

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

    const bgImage = document.createElement('div');
    bgImage.id = "editor-bg-image";
    bgImage.style.position = "fixed";
    bgImage.style.inset = "0";
    bgImage.style.zIndex = "-1";
    bgImage.style.backgroundSize = "cover";
    bgImage.style.backgroundPosition = "center";
    bgImage.style.display = "none";
    bgImage.style.pointerEvents = "none";
    // Load from settings or fallback
    const s = (window as any).vexeaSettings || {};
    const refImg = s.referenceImage || getAssetUrl("file_00000000cdd071f48495d22753c89fa1.png");
    bgImage.style.backgroundImage = `url('${refImg}')`;
    hudContainer.prepend(bgImage);

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
        "btn-medkit",
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
    const sizeSlider = editorBar.querySelector("#editor-size") as HTMLInputElement;
    const exportBtn = editorBar.querySelector("#editor-export") as HTMLButtonElement;
    const saveBtn = editorBar.querySelector("#editor-save") as HTMLButtonElement;
    const resetBtn = editorBar.querySelector("#editor-reset") as HTMLButtonElement;

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
    "left": "342.669px",
    "top": "8.06111px",
    "scale": 1
  },
  "minimap-container": {
    "left": "700px",
    "top": "15px",
    "scale": 1
  },
  "minimap-label": {
    "left": "696.433px",
    "top": "135.444px",
    "scale": 1
  },
  "btn-settings": {
    "left": "648px",
    "top": "7.67778px",
    "scale": 1
  },
  "btn-mic": {
    "left": "650px",
    "top": "50px",
    "scale": 1
  },
  "btn-chat": {
    "left": "650px",
    "top": "90px",
    "scale": 1
  },
  "joystick-boundary": {
    "left": "90px",
    "top": "230px",
    "scale": 0.6
  },
  "btn-fire-left": {
    "left": "25px",
    "top": "145px",
    "scale": 1.2
  },
  "weapon-slots-wrap": {
    "left": "330px",
    "top": "295px",
    "scale": 1
  },
  "btn-walkie": {
    "left": "260px",
    "top": "275px",
    "scale": 1.3
  },
  "btn-medkit": {
    "left": "540px",
    "top": "330px",
    "scale": 0.7
  },
  "auto-label": {
    "left": "410px",
    "top": "275px",
    "scale": 1
  },
  "health-bar": {
    "left": "295px",
    "top": "350px",
    "scale": 0.8
  },
  "health-plus-sq-wrap": {
    "left": "200px",
    "top": "340px",
    "scale": 2.9
  },
  "btn-fire-right": {
    "left": "675px",
    "top": "235px",
    "scale": 0.7
  },
  "btn-ads": {
    "left": "745px",
    "top": "175px",
    "scale": 0.9
  },
  "btn-reload": {
    "left": "620px",
    "top": "275px",
    "scale": 1
  },
  "btn-jump": {
    "left": "660px",
    "top": "325px",
    "scale": 0.8
  },
  "btn-crouch": {
    "left": "730px",
    "top": "325px",
    "scale": 1.1
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
                    el.style.setProperty('transform', `scale(${saved.scale})`, 'important');
                    el.style.setProperty('transform-origin', 'top left', 'important');
                    elementStates.set(el, { leftPx: parseFloat(saved.left) || 0, topPx: parseFloat(saved.top) || 0, scale: saved.scale });
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
        sizeSlider.disabled = false;
        
        const state = elementStates.get(target);
        if (state) {
            sizeSlider.value = state.scale.toString();
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
            state.leftPx = getGridSnap(startLeft + dx, 5);
            state.topPx = getGridSnap(startTop + dy, 5);
            selectedElement.style.setProperty('left', `${state.leftPx}px`, 'important');
            selectedElement.style.setProperty('top', `${state.topPx}px`, 'important');
        }
    };

    const onPointerUp = (e: PointerEvent) => {
        if (!isEditing || !selectedElement) return;
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
    };

    sizeSlider.addEventListener("input", (e: any) => {
        if (!selectedElement) return;
        const val = parseFloat(e.target.value);
        const state = elementStates.get(selectedElement);
        if (state) {
            state.scale = val;
            let currentTransform = selectedElement.style.transform;
            selectedElement.style.setProperty('transform', `scale(${val})`, 'important');
            // If they modify size, ensure origin is roughly centered
            selectedElement.style.setProperty('transform-origin', 'top left', 'important');
        }
    });

    (window as any).vexeaEditUI = () => {
        if (settingsModal) settingsModal.style.display = "none";
        isEditing = true;
        editorBar.style.display = "flex";
        bgImage.style.display = "block";
        (window as any).isEditMode = true; // Flag for main.ts 
        
        const canvasContainer = document.getElementById("canvas-container");
        if (canvasContainer) {
            canvasContainer.style.display = "none";
        }
        
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
                el.style.setProperty('transform', 'scale(1)', 'important');
                el.style.setProperty('transform-origin', 'top left', 'important');
                
                elementStates.set(el, { leftPx: left, topPx: top, scale: 1 });
            }

            el.addEventListener("pointerdown", onPointerDown as any);
            el.style.setProperty('pointer-events', 'auto', 'important');
            el.style.cursor = "move";
            el.style.outline = "1px solid rgba(255,255,255,0.3)";
        });
    };

    closeEditorBtn.addEventListener("click", () => {
        isEditing = false;
        editorBar.style.display = "none";
        bgImage.style.display = "none";
        selectedElement = null;
        selectedLabel.innerText = "Selected: None";
        sizeSlider.disabled = true;
        (window as any).isEditMode = false;

        const canvasContainer = document.getElementById("canvas-container");
        if (canvasContainer) {
            canvasContainer.style.display = "";
        }

        elementsToEdit.forEach(el => {
            el.removeEventListener("pointerdown", onPointerDown as any);
            el.style.cursor = "";
            el.style.outline = "none";
        });
    });

    exportBtn.addEventListener("click", () => {
        const config: Record<string, any> = {};
        elementsToEdit.forEach(el => {
            const state = elementStates.get(el);
            config[el.id] = {
                left: el.style.left,
                top: el.style.top,
                scale: state ? state.scale : 1
            };
        });

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(config, null, 2));
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
                scale: state ? state.scale : 1
            };
        });
        localStorage.setItem("hud_layout", JSON.stringify(config));
        alert("UI Layout saved locally!");
    });

    resetBtn.addEventListener("click", () => {
        localStorage.removeItem("hud_layout");
        location.reload();
    });
};
