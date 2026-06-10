import * as THREE from 'three';
import { ZONES, ZoneName } from '../shared/constants';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export const initMapEditor = (
    scene: THREE.Scene, 
    camera: THREE.PerspectiveCamera, 
    renderer: THREE.WebGLRenderer, 
    canvasContainer: HTMLDivElement
) => {
    // Editor State
    const objects: THREE.Mesh[] = [];
    let selectedObject: THREE.Mesh | null = null;
    let currentZone: ZoneName = ZONES.CORE;
    let snapSize = 1;

    // Controls
    const orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.05;
    
    // Initial Camera Pos
    camera.position.set(0, 40, 40);
    camera.lookAt(0, 0, 0);

    const transformControl = new TransformControls(camera, renderer.domElement);
    transformControl.addEventListener('dragging-changed', (event) => {
        orbitControls.enabled = !event.value;
    });
    transformControl.setTranslationSnap(snapSize);
    transformControl.setRotationSnap(Math.PI / 12);
    scene.add(transformControl as any);

    // Outline Helper
    const boxHelper = new THREE.BoxHelper(new THREE.Mesh(new THREE.BoxGeometry(1,1,1)), 0x22c55e);
    boxHelper.visible = false;
    scene.add(boxHelper);

    // UI Setup
    const editorUI = document.createElement("div");
    editorUI.className = "absolute inset-0 pointer-events-none z-[200] flex flex-col font-mono text-sm";
    editorUI.id = "map-editor-ui";
    
    const uiHTML = `
      <!-- Top Bar -->
      <div class="w-full flex flex-wrap items-center justify-between p-2 bg-black/80 pointer-events-auto backdrop-blur border-b border-gray-700">
          <div class="flex flex-wrap gap-2 items-center">
            <button id="btn-exit-editor" class="px-3 py-1 bg-red-900/80 text-white rounded active:bg-red-800 border border-red-700 mr-2">EXIT</button>
            <button id="btn-fullscreen" class="px-3 py-1 bg-gray-700 text-white rounded active:bg-gray-600 border border-gray-600">FULLSCREEN</button>
            <button id="btn-settings" class="px-3 py-1 bg-gray-700 text-white rounded active:bg-gray-600 border border-gray-600">SETTINGS</button>
            
            <div class="h-6 w-px bg-gray-600 mx-1"></div>
            
            <select id="sel-add" class="bg-black border border-gray-600 text-white px-2 py-1 rounded cursor-pointer">
              <option value="">+ ADD OBJECT</option>
              <option value="cube">Cube</option>
              <option value="wall">Wall</option>
              <option value="spawn">Spawn</option>
            </select>

            <select id="sel-zone" class="bg-black border border-gray-600 text-white px-2 py-1 rounded cursor-pointer">
              ${Object.values(ZONES).map(z => `<option value="${z}">Zone: ${z.toUpperCase()}</option>`).join("")}
            </select>
          </div>

          <div class="flex gap-2 items-center mt-2 sm:mt-0">
            <select id="sel-mode" class="bg-black border border-gray-600 text-white px-2 py-1 rounded cursor-pointer">
              <option value="translate">Translate</option>
              <option value="rotate">Rotate</option>
              <option value="scale">Scale</option>
            </select>
            <select id="sel-snap" class="bg-black border border-gray-600 text-white px-2 py-1 rounded cursor-pointer">
              <option value="0.5">Snap: 0.5</option>
              <option value="1" selected>Snap: 1.0</option>
              <option value="2">Snap: 2.0</option>
              <option value="0">Snap: OFF</option>
            </select>
            
            <div class="h-6 w-px bg-gray-600 mx-1"></div>
            <button id="btn-del" class="px-3 py-1 bg-red-900/50 text-red-400 border border-red-800 rounded active:bg-red-800 hidden">DEL</button>
            <button id="btn-dup" class="px-3 py-1 bg-yellow-900/50 text-yellow-400 border border-yellow-800 rounded active:bg-yellow-800 hidden">DUP</button>

            <div class="h-6 w-px bg-gray-600 mx-1"></div>
            
            <button id="btn-save" class="px-3 py-1 bg-blue-600 text-white rounded active:bg-blue-500 border border-blue-500">SAVE</button>
            <button id="btn-copy" class="px-3 py-1 bg-green-600 text-white rounded active:bg-green-500 border border-green-500">COPY EXPORT</button>
          </div>
      </div>

      <!-- Settings Modal -->
      <div id="editor-settings-modal" class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black/95 border border-gray-600 p-6 rounded hidden pointer-events-auto flex-col gap-4 min-w-[250px]">
        <h2 class="text-xl font-bold text-white mb-2">Editor Settings</h2>
        <label class="flex justify-between items-center text-gray-300">
            Grid Size:
            <input type="number" id="inp-grid-size" value="100" class="w-20 bg-gray-800 border border-gray-600 rounded px-2 text-white">
        </label>
        <button id="btn-close-settings" class="mt-4 px-4 py-2 bg-gray-700 text-white rounded active:bg-gray-600 border border-gray-600">CLOSE</button>
      </div>
    `;
    editorUI.innerHTML = uiHTML;
    document.body.appendChild(editorUI);

    // Materials
    const ZONE_COLORS: Record<string, number> = {
        [ZONES.SPAWN]: 0x5a6982,
        [ZONES.COURTYARD]: 0x8292ab,
        [ZONES.WAREHOUSE]: 0x93c5fd,
        [ZONES.BRIDGE]: 0xfca5a5,
        [ZONES.PLANT]: 0x86efac,
        [ZONES.TUNNELS]: 0xd8b4fe,
        [ZONES.CORE]: 0xfde047
    };
    
    // Instead of instancing many materials, we use the zone array
    const unselectedMats: Record<string, THREE.MeshStandardMaterial> = {};
    for (const z of Object.values(ZONES)) {
        unselectedMats[z] = new THREE.MeshStandardMaterial({ color: ZONE_COLORS[z] || 0x888888, roughness: 0.8 });
    }

    // Grid Helper Re-init mechanism
    let editorGrid = new THREE.GridHelper(100, 100, 0xffffff, 0x555555);
    scene.add(editorGrid);

    const updateGrid = (size: number) => {
      scene.remove(editorGrid);
      editorGrid = new THREE.GridHelper(size, size, 0xffffff, 0x555555);
      scene.add(editorGrid);
    };

    // Editor Functions
    const spawnObject = (type: string) => {
        let geom;
        if (type === 'cube') geom = new THREE.BoxGeometry(4, 4, 4);
        else if (type === 'spawn') geom = new THREE.CylinderGeometry(1, 1, 0.5, 8);
        else geom = new THREE.BoxGeometry(1, 4, 8); // wall
        
        const mesh = new THREE.Mesh(geom, unselectedMats[currentZone]);
        mesh.position.copy(camera.position);
        mesh.position.y = 2; 
        
        const cf = new THREE.Vector3();
        camera.getWorldDirection(cf);
        mesh.position.addScaledVector(cf, 20); 
        mesh.position.x = Math.round(mesh.position.x);
        mesh.position.z = Math.round(mesh.position.z);
        
        mesh.userData = { type, zone: currentZone };
        scene.add(mesh);
        objects.push(mesh);
        selectObject(mesh);
    };

    const selectObject = (mesh: THREE.Mesh | null) => {
        selectedObject = mesh;
        if (mesh) {
            transformControl.attach(mesh);
            boxHelper.setFromObject(mesh);
            boxHelper.visible = true;
            document.getElementById("btn-del")?.classList.remove("hidden");
            document.getElementById("btn-dup")?.classList.remove("hidden");
        } else {
            transformControl.detach();
            boxHelper.visible = false;
            document.getElementById("btn-del")?.classList.add("hidden");
            document.getElementById("btn-dup")?.classList.add("hidden");
        }
    };

    const duplicateSelected = () => {
        if (!selectedObject) return;
        const cl = selectedObject.clone();
        cl.material = unselectedMats[cl.userData.zone];
        cl.position.x += snapSize > 0 ? snapSize : 1;
        scene.add(cl);
        objects.push(cl);
        selectObject(cl);
    };

    const deleteSelected = () => {
        if (!selectedObject) return;
        scene.remove(selectedObject);
        const ix = objects.indexOf(selectedObject);
        if (ix > -1) objects.splice(ix, 1);
        selectObject(null);
    };

    // Raycast Utils
    const raycaster = new THREE.Raycaster();
    const vecTemp = new THREE.Vector2();

    const getIntersection = (x: number, y: number, meshes: THREE.Mesh[]) => {
        vecTemp.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
        raycaster.setFromCamera(vecTemp, camera);
        const hits = raycaster.intersectObjects(meshes, false);
        return hits.length > 0 ? hits[0] : null;
    };

    let lastTapTime = 0;
    canvasContainer.addEventListener('pointerdown', (e) => {
        if (e.target !== canvasContainer && e.target !== renderer.domElement) return;
        if (transformControl.dragging) return; // Ignore if operating the gizmo
        
        const now = performance.now();
        if (now - lastTapTime < 300) {
            // Double Tap to deselect
            selectObject(null);
            return;
        }
        lastTapTime = now;

        const hit = getIntersection(e.clientX, e.clientY, objects);
        if (hit && hit.object instanceof THREE.Mesh) {
            selectObject(hit.object);
        } else {
           // We might want to keep selection if they missed, but let's allow OrbitControls to work
        }
    });

    // UI Dispatch
    document.getElementById("sel-add")?.addEventListener("change", (e) => {
        const val = (e.target as HTMLSelectElement).value;
        if (val) {
            spawnObject(val);
            (e.target as HTMLSelectElement).value = "";
        }
    });

    document.getElementById("sel-zone")?.addEventListener("change", (e) => {
        currentZone = (e.target as HTMLSelectElement).value as ZoneName;
        if (selectedObject) {
            selectedObject.userData.zone = currentZone;
            selectedObject.material = unselectedMats[currentZone];
        }
    });

    document.getElementById("sel-mode")?.addEventListener("change", (e) => {
        const mode = (e.target as HTMLSelectElement).value;
        transformControl.setMode(mode as "translate"|"rotate"|"scale");
    });

    document.getElementById("sel-snap")?.addEventListener("change", (e) => {
        const val = parseFloat((e.target as HTMLSelectElement).value);
        snapSize = val;
        if (val > 0) {
            transformControl.setTranslationSnap(val);
        } else {
            transformControl.setTranslationSnap(null);
        }
    });

    document.getElementById("btn-del")?.addEventListener("click", deleteSelected);
    document.getElementById("btn-dup")?.addEventListener("click", duplicateSelected);

    document.getElementById("btn-settings")?.addEventListener("click", () => {
        document.getElementById("editor-settings-modal")?.classList.remove('hidden');
        document.getElementById("editor-settings-modal")?.classList.add('flex');
    });

    document.getElementById("btn-close-settings")?.addEventListener("click", () => {
        document.getElementById("editor-settings-modal")?.classList.add('hidden');
        document.getElementById("editor-settings-modal")?.classList.remove('flex');
        
        const newSize = parseInt((document.getElementById("inp-grid-size") as HTMLInputElement).value);
        if (!isNaN(newSize) && newSize > 0) {
            updateGrid(newSize);
        }
    });

    // Fullscreen Support
    document.getElementById("btn-fullscreen")?.addEventListener("click", () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch((err) => {
                console.warn(`Error attempting to enable fullscreen: ${err.message}`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    });

    document.getElementById("btn-exit-editor")?.addEventListener("click", () => {
        window.location.reload();
    });

    // Export Logic
    document.getElementById("btn-save")?.addEventListener("click", () => {
        saveMapState();
        alert("Saved to LocalStorage");
    });

    document.getElementById("btn-copy")?.addEventListener("click", async () => {
        const str = saveMapState();
        try {
            await navigator.clipboard.writeText(str);
            alert("Payload copied to clipboard!");
        } catch (e) {
            console.log("Export:", str);
        }
    });

    const saveMapState = () => {
        const payload = {
            version: 1,
            nodes: objects.map(o => {
                const s = new THREE.Vector3();
                o.geometry.computeBoundingBox();
                o.geometry.boundingBox?.getSize(s);
                // Factor in scale
                s.multiply(o.scale);
                
                return {
                    t: o.userData.type,
                    z: o.userData.zone,
                    px: o.position.x, py: o.position.y, pz: o.position.z,
                    sx: s.x, sy: s.y, sz: s.z,
                    ry: o.rotation.y
                };
            })
        };
        const str = JSON.stringify(payload);
        localStorage.setItem("vexea_map_state", str);
        return str;
    };

    // Load Routine
    const stored = localStorage.getItem("vexea_map_state");
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            parsed.nodes.forEach((n: any) => {
                let geom;
                if (n.t === 'spawn') geom = new THREE.CylinderGeometry(1, 1, 0.5, 8);
                else geom = new THREE.BoxGeometry(1, 1, 1); // Unit box, we will scale it
                
                const mesh = new THREE.Mesh(geom, unselectedMats[n.z] || unselectedMats[ZONES.CORE]);
                mesh.position.set(n.px, n.py, n.pz);
                mesh.rotation.y = n.ry || 0;
                
                if (n.t !== 'spawn') {
                    mesh.scale.set(n.sx, n.sy, n.sz);
                }
                
                mesh.userData = { type: n.t, zone: n.z };
                scene.add(mesh);
                objects.push(mesh);
            });
        } catch (e) {
            console.error(e);
        }
    }
    
    // Editor Tick Loop
    const editorLoop = () => {
        if (! (window as any).isEditMode) return;
        requestAnimationFrame(editorLoop);
        
        orbitControls.update();
        if (selectedObject && boxHelper.visible) {
            boxHelper.update();
        }
        
        renderer.render(scene, camera);
    };
    editorLoop();
};
