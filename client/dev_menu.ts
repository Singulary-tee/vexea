export const isDev = true;
import * as THREE from "three";
import { camera } from "./main";
import { ZONE_BOUNDS, WAYPOINTS, ZONES_ARRAY } from "../shared/constants";

let isMenuOpen = false;
let activePanel = "CONSOLE";
let llmFeed: any = { latency: 0, count: 0, calls: [], payload: "" };
const createPacketBuffer = (size: number) => Array.from({length: size}, () => ({ time: "", decoded: "", raw: 0 }));
let inboundPackets: any[] = createPacketBuffer(10);
let outboundPackets: any[] = createPacketBuffer(10);
let inboundIdx = 0;
let outboundIdx = 0;
let logs: string[] = [];
let devLlmDisabled = false;

// Expose dynamically for main.ts 
(window as any).initDevMenu = initDevMenu;
(window as any).updateDevPerf = updateDevPerf;
(window as any).receivedLLMFeed = receivedLLMFeed;
(window as any).trackNetwork = trackNetwork;

if (isDev) {
    const _log = console.log, _warn = console.warn, _error = console.error;
    console.log = (...a) => { _log(...a); logs.push("[LOG] " + a.join(" ")); updateConsole(); };
    console.warn = (...a) => { _warn(...a); logs.push("[WARN] " + a.join(" ")); updateConsole(); };
    console.error = (...a) => { _error(...a); logs.push("[ERR] " + a.join(" ")); updateConsole(); };
}

function updateConsole() {
    const el = document.getElementById("dev-console");
    if (el && activePanel === "CONSOLE") el.innerText = logs.slice(-50).join("\n");
}

let fps = 0, frames = 0, lastTime = performance.now();
let lastCalls = 0;
let lastTris = 0;
let lastPoints = 0;
let lastLines = 0;

export function updateDevPerf(renderer: any, _time: number, now: number) {
    if (!isDev) return;
    frames++;
    if (now - lastTime >= 1000) {
        fps = frames;
        frames = 0;
        lastTime = now;
        
        const el = document.getElementById("dev-perf");
        if (el && activePanel === "PERF") {
            const mem = (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) + " MB" : "N/A";
            
            const currCalls = renderer.info?.render?.calls || 0;
            const currTris = renderer.info?.render?.triangles || 0;
            const currPoints = renderer.info?.render?.points || 0;
            const currLines = renderer.info?.render?.lines || 0;
            
            const callsPerSec = currCalls - lastCalls;
            const trisPerSec = currTris - lastTris;
            const pointsPerSec = currPoints - lastPoints;
            const linesPerSec = currLines - lastLines;
            
            lastCalls = currCalls;
            lastTris = currTris;
            lastPoints = currPoints;
            lastLines = currLines;
            
            const avgCalls = Math.round(callsPerSec / (fps || 1));
            const avgTris = Math.round(trisPerSec / (fps || 1));
            const avgPoints = Math.round(pointsPerSec / (fps || 1));
            const avgLines = Math.round(linesPerSec / (fps || 1));
            
            const geom = renderer.info?.memory?.geometries || 0;
            const tex = renderer.info?.memory?.textures || 0;
            
            el.innerHTML = `
                <b>Performance</b><br>
                FPS: ${fps}<br>
                Memory: ${mem}<br><br>
                <b>Render (Avg / Frame)</b><br>
                Draw Calls: ${avgCalls}<br>
                Triangles: ${avgTris}<br>
                Points: ${avgPoints}<br>
                Lines: ${avgLines}<br><br>
                <b>Memory (Total Loaded)</b><br>
                Geometries: ${geom}<br>
                Textures: ${tex}
            `.replace(/  +/g, '');
        }
    }
}

export function trackNetwork(direction: "IN" | "OUT", data: any) {
    if (!isDev) return;
    
    // Attempt basic decode
    let decoded = "Binary " + (data.byteLength || data.length) + " bytes";
    if (data.byteLength === 20) decoded = "Player State (lastSeq, px, py, pz)";
    else if (data.byteLength > 20) decoded = `Drone State (${Math.floor((data.byteLength-6)/32)} units)`;
    else if (data.byteLength === 14) decoded = "Client Input Payload";
    
    if (direction === "IN") {
        const p = inboundPackets[inboundIdx];
        const d = new Date();
        p.time = d.toISOString().split("T")[1].slice(0, -1);
        p.decoded = decoded;
        p.raw = data.byteLength;
        inboundIdx = (inboundIdx + 1) % 10;
    } else {
        const p = outboundPackets[outboundIdx];
        const d = new Date();
        p.time = d.toISOString().split("T")[1].slice(0, -1);
        p.decoded = decoded;
        p.raw = data.byteLength;
        outboundIdx = (outboundIdx + 1) % 10;
    }

    if (activePanel === "NETWORK") {
        const el = document.getElementById("dev-network");
        if (el) {
            let inStr = "";
            for (let i = 0; i < 10; i++) {
                const p = inboundPackets[(inboundIdx - 1 - i + 10) % 10];
                if (p.time) inStr += `[${p.time}] ${p.decoded}<br>`;
            }
            let outStr = "";
            for (let i = 0; i < 10; i++) {
                const p = outboundPackets[(outboundIdx - 1 - i + 10) % 10];
                if (p.time) outStr += `[${p.time}] ${p.decoded}<br>`;
            }
            el.innerHTML = `<b>Recent Inbound (last 10):</b><br/>${inStr}<br/><br/><b>Recent Outbound (last 10):</b><br/>${outStr}`;
        }
    }
}

export function receivedLLMFeed(data: any) {
    if (!isDev || !data) return;
    llmFeed = data;
    if (activePanel === "LLM FEED") {
        const el = document.getElementById("dev-llm");
        if (el) {
            const tempPay = data.payload === undefined || data.payload === null ? "" : data.payload;
            const tempCalls = data.calls === undefined || data.calls === null ? "[]" : data.calls;
            
            let formattedPayload = "";
            try {
                formattedPayload = typeof tempPay === "string" && tempPay.trim() ? JSON.stringify(JSON.parse(tempPay), null, 2) : JSON.stringify(tempPay, null, 2);
            } catch (e) {
                formattedPayload = String(tempPay);
            }

            let formattedCalls = "";
            try {
                formattedCalls = typeof tempCalls === "string" && tempCalls.trim() ? JSON.stringify(JSON.parse(tempCalls), null, 2) : JSON.stringify(tempCalls, null, 2);
            } catch (e) {
                formattedCalls = String(tempCalls);
            }

            el.innerHTML = `<b>Latency:</b> ${data.latency || 0}ms<br><b>Total Calls:</b> ${data.count || 0}<br><b>Raw JSON Payload:</b><br>${formattedPayload}<br><b>Tool Calls:</b><br>${formattedCalls}<br><b>Failed Ops:</b><br>${data.failedOps ? JSON.stringify(data.failedOps, null, 2) : "[]"}`;
        }
    } else if (activePanel === "ZONES") {
        drawZones();
    }
}
(window as any).receivedLLMFeed = receivedLLMFeed;


let activeChannel: any;
let droneJitterMapRef: Map<number, any>;
export function initDevMenu(channel: any, jitterMap: any) {
    if (!isDev) return;
    activeChannel = channel;
    (window as any).activeChannel = channel;
    droneJitterMapRef = jitterMap;

    // Monkeypatch Geckos outbound
    if (channel && typeof channel.rawEmit === "function" && !(channel as any)._rawEmitPatched) {
        const origRaw = channel.rawEmit.bind(channel);
        channel.rawEmit = (data: any) => { trackNetwork("OUT", data); origRaw(data); };
        (channel as any)._rawEmitPatched = true;
    }
    if (channel && typeof channel.emit === "function") {
        const origReliable = channel.emit.bind(channel);
        channel.emit = (ev: string, data: any) => { trackNetwork("OUT", data || ev); origReliable(ev, data); };
    }
    
    channel.on("dev_llm_feed", (data: any) => receivedLLMFeed(data));

    // Construct DOM
    const btn = document.createElement("button");
    btn.innerText = "DEV";
    btn.style.cssText = "position:absolute;top:10px;left:10px;z-index:999999;background:#f0f;color:white;font-weight:bold;padding:5px 10px;border:none;cursor:pointer;pointer-events:auto;";
    btn.onclick = () => toggleDevMenu();
    document.body.appendChild(btn);

    const overlay = document.createElement("div");
    overlay.id = "dev-overlay";
    overlay.style.cssText = "display:none;position:absolute;inset:0;background:rgba(0,0,0,0.85);z-index:999998;pointer-events:auto;color:#0f0;font-family:monospace;padding:10px;flex-direction:column;";
    
    const tabs = ["GAME CONTROL", "WEPS", "CONSOLE", "LLM FEED", "AI NAV", "PERF", "NETWORK", "ZONES"];
    const header = document.createElement("div");
    header.style.cssText = "display:flex;gap:10px;margin-bottom:10px;overflow-x:auto;";
    tabs.forEach(t => {
        const tb = document.createElement("button");
        tb.innerText = t;
        tb.style.cssText = "background:#333;color:white;border:none;padding:5px 10px;cursor:pointer;";
        tb.onclick = (e) => {
            e.stopPropagation();
            activePanel = t;
            renderPanel();
        };
        header.appendChild(tb);
    });

    const content = document.createElement("div");
    content.id = "dev-content";
    content.style.cssText = "flex:1;overflow:auto;position:relative;font-size:12px;";

    overlay.appendChild(header);
    overlay.appendChild(content);

    // Tap outside to close
    overlay.onclick = (e) => {
        if (e.target === overlay) toggleDevMenu();
    };

    document.body.appendChild(overlay);

    setInterval(() => {
        if (isMenuOpen && activePanel === "AI NAV") drawAINav();
        if (isMenuOpen && activePanel === "ZONES") drawZones();
    }, 500);
}

function toggleDevMenu() {
    isMenuOpen = !isMenuOpen;
    const overlay = document.getElementById("dev-overlay");
    if (overlay) overlay.style.display = isMenuOpen ? "flex" : "none";
    if (isMenuOpen) renderPanel();
}
(window as any).toggleDevMenu = toggleDevMenu;

function renderPanel() {
    const c = document.getElementById("dev-content");
    if (!c) return;
    
    if (activePanel === "GAME CONTROL") {
        c.innerHTML = `
            <h3>Spawn Drone</h3>
            <div id="dev-spawn-buttons" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom: 20px;">
                <button data-type="0" style="padding:5px;">Rotary Shooter</button>
                <button data-type="1" style="padding:5px;">Bomber</button>
                <button data-type="2" style="padding:5px;">Recon</button>
                <button data-type="3" style="padding:5px;">Fixed Wing</button>
                <button data-type="4" style="padding:5px;">Wheeled</button>
                <button data-type="5" style="padding:5px;">Robot Dog</button>
                <button data-type="6" style="padding:5px;">Humanoid</button>
            </div>
            <h3>Player Class</h3>
            <div id="dev-loadout-buttons" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom: 20px;">
                <button data-class="assault" style="padding:5px;">Assault</button>
                <button data-class="medic" style="padding:5px;">Medic</button>
                <button data-class="recon" style="padding:5px;">Recon</button>
                <button data-class="demolitions" style="padding:5px;">Demolitions</button>
            </div>
            <h3>Manage Entities</h3>
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom: 20px;">
                <button id="dev-clear-drones" style="padding:5px;">Clear All Drones</button>
                <button id="dev-spawn-bots" style="padding:5px;">Spawn 3 Test Bots</button>
            </div>
            <h3>LLM Commander</h3>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button id="dev-toggle-llm" style="padding:5px;">${devLlmDisabled ? "ENABLE LLM COMMANDER" : "DISABLE LLM COMMANDER"}</button>
            </div>
        `;
        
        // Add event listeners programmatically
        const spawnButtons = c.querySelectorAll('#dev-spawn-buttons button');
        spawnButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = parseInt((e.target as HTMLElement).getAttribute('data-type') || '0', 10);
                if (!camera) return;
                const dir = new THREE.Vector3(0, 0, -1);
                dir.applyQuaternion(camera.quaternion);
                const pos = new THREE.Vector3();
                pos.copy(camera.position).add(dir.multiplyScalar(10)); // spawn 10 units in front
                let spawnY = pos.y;
                if (spawnY < Number(0.5)) spawnY = Number(0.5); // don't spawn under floor
                
                if (activeChannel) activeChannel.emit("dev_spawn_drone", { type, x: pos.x, y: spawnY, z: pos.z });
            });
        });
        
        const loadoutButtons = c.querySelectorAll('#dev-loadout-buttons button');
        loadoutButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const playerClass = (e.target as HTMLElement).getAttribute('data-class');
                if (playerClass) {
                    if (activeChannel) activeChannel.emit("dev_set_class", { playerClass });
                }
            });
        });

        const clearBtn = document.getElementById('dev-clear-drones');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (activeChannel) activeChannel.emit("dev_clear_drones", {});
                if (droneJitterMapRef) droneJitterMapRef.clear();
            });
        }

        const botsBtn = document.getElementById('dev-spawn-bots');
        if (botsBtn) {
            botsBtn.addEventListener('click', () => {
                if (activeChannel) activeChannel.emit("dev_spawn_bots", { count: 3 });
            });
        }

        const toggleLlmBtn = document.getElementById('dev-toggle-llm');
        if (toggleLlmBtn) {
            toggleLlmBtn.addEventListener('click', () => {
                devLlmDisabled = !devLlmDisabled;
                toggleLlmBtn.innerText = devLlmDisabled ? "ENABLE LLM COMMANDER" : "DISABLE LLM COMMANDER";
                if (activeChannel) activeChannel.emit("dev_toggle_llm", { disabled: devLlmDisabled });
            });
        }
    }
    else if (activePanel === "WEPS") {
        const offsets = (window as any).DEV_WEAPON_OFFSETS;
        if (!offsets) {
            c.innerHTML = "<div>DEV_WEAPON_OFFSETS not found.</div>";
            return;
        }

        const renderSliders = (type: string, data: any) => {
            let html = `<h3>${type.toUpperCase()}</h3>`;
            for (const state of ['hip', 'ads', 'muzzle']) {
                html += `<h4>${state.toUpperCase()}</h4><div style="display:flex; flex-direction:column; gap:5px; margin-bottom:10px;">`;
                for (const axis of ['x', 'y', 'z']) {
                    const id = `wep-${type}-${state}-${axis}`;
                    html += `<label style="display:flex; justify-content:space-between; max-width: 300px;">
                        <span>${axis.toUpperCase()}: <span id="${id}-val">${data[state][axis].toFixed(3)}</span></span>
                        <input type="range" id="${id}" min="-2" max="2" step="0.005" value="${data[state][axis]}" style="width:200px;">
                    </label>`;
                }
                html += `</div>`;
            }
            return html;
        };

        c.innerHTML = `
            <h2>Weapon Offsets</h2>
            ${renderSliders('rifle', offsets.rifle)}
            ${renderSliders('pistol', offsets.pistol)}
            <button id="dev-export-weps" style="margin-top:20px; padding:10px; background:#0f0; color:black; font-weight:bold; border:none; cursor:pointer;">EXPORT JSON</button>
        `;

        const bindSliders = (type: string, data: any) => {
            for (const state of ['hip', 'ads', 'muzzle']) {
                for (const axis of ['x', 'y', 'z']) {
                    const id = `wep-${type}-${state}-${axis}`;
                    const input = document.getElementById(id) as HTMLInputElement;
                    const val = document.getElementById(`${id}-val`);
                    if (input && val) {
                        input.addEventListener('input', (e) => {
                            const v = parseFloat((e.target as HTMLInputElement).value);
                            val.innerText = v.toFixed(3);
                            data[state][axis as keyof THREE.Vector3] = v;
                        });
                    }
                }
            }
        };

        bindSliders('rifle', offsets.rifle);
        bindSliders('pistol', offsets.pistol);

        const expBtn = document.getElementById('dev-export-weps');
        if (expBtn) {
            expBtn.addEventListener('click', () => {
                const out = JSON.stringify({
                    rifle: {
                        hip: {x: offsets.rifle.hip.x, y: offsets.rifle.hip.y, z: offsets.rifle.hip.z},
                        ads: {x: offsets.rifle.ads.x, y: offsets.rifle.ads.y, z: offsets.rifle.ads.z},
                        muzzle: {x: offsets.rifle.muzzle.x, y: offsets.rifle.muzzle.y, z: offsets.rifle.muzzle.z}
                    },
                    pistol: {
                        hip: {x: offsets.pistol.hip.x, y: offsets.pistol.hip.y, z: offsets.pistol.hip.z},
                        ads: {x: offsets.pistol.ads.x, y: offsets.pistol.ads.y, z: offsets.pistol.ads.z},
                        muzzle: {x: offsets.pistol.muzzle.x, y: offsets.pistol.muzzle.y, z: offsets.pistol.muzzle.z}
                    }
                }, null, 2);
                navigator.clipboard.writeText(out).then(() => {
                    const old = expBtn.innerText;
                    expBtn.innerText = "COPIED TO CLIPBOARD!";
                    setTimeout(() => expBtn.innerText = old, 1500);
                });
            });
        }
    }
    else if (activePanel === "CONSOLE") c.innerHTML = "<div id='dev-console' style='white-space:pre-wrap;overflow-y:auto;height:100%;'></div>";
    else if (activePanel === "LLM FEED") c.innerHTML = "<div id='dev-llm' style='white-space:pre-wrap;overflow-y:auto;height:100%;'></div>";
    else if (activePanel === "PERF") c.innerHTML = "<div id='dev-perf' style='white-space:pre-wrap;overflow-y:auto;height:100%;'></div>";
    else if (activePanel === "NETWORK") c.innerHTML = "<div id='dev-network' style='white-space:pre-wrap;overflow-y:auto;height:100%;'></div>";
    else if (activePanel === "AI NAV") c.innerHTML = "<canvas id='dev-canvas' width='600' height='600' style='border:1px solid #0f0;width:100%;height:100%;object-fit:contain;'></canvas>";
    else if (activePanel === "ZONES") c.innerHTML = "<div id='dev-zones' style='white-space:pre-wrap;overflow-y:auto;height:100%;'></div>";

    const copyBtn = document.createElement("button");
    copyBtn.id = "dev-copy-btn";
    copyBtn.innerText = "COPY";
    copyBtn.style.position = "absolute";
    copyBtn.style.top = "5px";
    copyBtn.style.right = "20px";
    copyBtn.style.zIndex = "1000";
    copyBtn.style.padding = "5px 10px";
    copyBtn.style.background = "#333";
    copyBtn.style.color = "white";
    copyBtn.style.border = "1px solid white";
    
    copyBtn.onclick = () => {
        let content = "";
        if (activePanel === "GAME CONTROL") {
            content = c.innerText;
        } else if (activePanel === "CONSOLE") {
            content = document.getElementById("dev-console")?.innerText || "";
        } else if (activePanel === "LLM FEED") {
            content = document.getElementById("dev-llm")?.innerText || "";
        } else if (activePanel === "PERF") {
            content = document.getElementById("dev-perf")?.innerText || "";
        } else if (activePanel === "NETWORK") {
            content = document.getElementById("dev-network")?.innerText || "";
        } else if (activePanel === "ZONES") {
            content = document.getElementById("dev-zones")?.innerText || "";
        } else if (activePanel === "AI NAV") {
            let lines: string[] = ["AI NAV TAB - EXTRACTED DRAWN TEXT LABELS"];
            for (const [zoneName, bound] of Object.entries(ZONE_BOUNDS)) {
                lines.push(`ZONE: ${zoneName}`);
            }
            if ((window as any).syncCameras) {
                for (const cam of (window as any).syncCameras) {
                    if (cam.id < ZONES_ARRAY.length) {
                        lines.push(`CAM ${cam.id}: ${cam.isActive ? 'ACTIVE' : 'DEAD'}`);
                    }
                }
            }
            if (droneJitterMapRef) {
                for (const [id, buffer] of droneJitterMapRef.entries()) {
                    if (buffer.length > 0) {
                        const head = buffer[buffer.length - 1];
                        if (head.state === 5) continue;
                        let stateName = "IDLE";
                        if (head.state === 1) stateName = "PATROL";
                        if (head.state === 2) stateName = "PURSUIT";
                        if (head.state === 3) stateName = "ATTACK";
                        if (head.state === 4) stateName = "REPOS";
                        lines.push(`${id} (${stateName})`);
                    }
                }
            }
            content = lines.join("\\n");
        }
        
        navigator.clipboard.writeText(content).then(() => {
            const old = copyBtn.innerText;
            copyBtn.innerText = "COPIED";
            setTimeout(() => { copyBtn.innerText = old; }, 1000);
        });
    };
    c.appendChild(copyBtn);

    updateConsole();
    receivedLLMFeed(llmFeed);
    if (activePanel === "AI NAV") drawAINav();
    if (activePanel === "ZONES") drawZones();
}

(window as any).spawnDevDrone = (type: number) => {
    if (activeChannel) {
        activeChannel.emit("dev_spawn_drone", { type });
    } else {
    }
};
(window as any).clearAllDrones = () => {
    if (activeChannel) activeChannel.emit("dev_clear_drones", {});
};

function drawAINav() {
    const canvas = document.getElementById("dev-canvas") as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Match window bounds to [-150, 150] space
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const scale = canvas.width / 300;
    const offX = 150;
    const offZ = 150;

    ctx.fillStyle = "rgba(0,50,0,1)";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // Draw Zones
    ctx.strokeStyle = "rgba(0, 255, 0, 0.3)";
    ctx.lineWidth = 2;
    for (const [zoneName, bound] of Object.entries(ZONE_BOUNDS)) {
        const cx = (bound.center.x + offX) * scale;
        const cz = (bound.center.z + offZ) * scale;
        const width = (bound.halfSize.x * 2) * scale;
        const height = (bound.halfSize.z * 2) * scale;
        
        ctx.strokeRect(cx - width/2, cz - height/2, width, height);
        ctx.fillStyle = "rgba(0, 255, 0, 0.5)";
        ctx.fillText(zoneName, cx - width/2 + 5, cz - height/2 + 15);
    }



    if ((window as any).syncCameras) {
        for (const cam of (window as any).syncCameras) {
            if (cam.id < ZONES_ARRAY.length) {
                const w = WAYPOINTS[ZONES_ARRAY[cam.id]];
                const cx = (w.x + offX) * scale;
                const cz = (w.z + offZ) * scale;
                ctx.fillStyle = cam.isActive ? "cyan" : "gray";
                ctx.beginPath();
                ctx.arc(cx, cz, 6, 0, Math.PI*2);
                ctx.fill();
                ctx.fillStyle = "white";
                ctx.fillText(`CAM ${cam.id}`, cx + 8, cz - 8);
            }
        }
    }

    if (droneJitterMapRef) {
        let itCount = 0;
        for (const [id, buffer] of droneJitterMapRef.entries()) {
            if (buffer.length > 0) itCount++;
        }
        for (const [id, buffer] of droneJitterMapRef.entries()) {
            if (buffer.length > 0) {
                const head = buffer[buffer.length - 1];
                if (head.state === 5) continue; // DEAD

                let color = "white";
                if (head.type === 0 || head.type === 1 || head.type === 3) color = "#00AAFF"; // AIR
                else if (head.type === 4 || head.type === 5 || head.type === 6) color = "#FF8800"; // GROUND
                else if (head.type === 2) color = "#FFFF00"; // RECON
                
                let stateName = "IDLE";
                if (head.state === 1) stateName = "PATROL";
                if (head.state === 2) stateName = "PURSUIT";
                if (head.state === 3) stateName = "ATTACK";
                if (head.state === 4) stateName = "REPOS";

                ctx.fillStyle = color;
                const cx = (head.posX + offX) * scale;
                const cz = (head.posZ + offZ) * scale;
                ctx.beginPath();
                ctx.arc(cx, cz, 4, 0, Math.PI*2);
                ctx.fill();
                ctx.fillStyle = "white";
                ctx.fillText(`${id} (${stateName})`, cx+6, cz);
                
                // Draw mock A* path line 
                if (head.state === 2 || head.state === 3) {
                    ctx.beginPath();
                    ctx.moveTo(cx, cz);
                    // Just draw line forward based on rotation as mock path for client display
                    const targetX = cx + (Math.sin(head.rotY) * 20 * scale);
                    const targetZ = cz + (Math.cos(head.rotY) * 20 * scale);
                    ctx.lineTo(targetX, targetZ);
                    ctx.strokeStyle = "magenta";
                    ctx.stroke();
                }
            }
        }
    }
}

function drawZones() {
    const el = document.getElementById("dev-zones");
    if (!el) return;
    el.innerHTML = "<b>Live Zone Summary</b><br/>Refer to LLM Payload for detailed semantic JSON.";
    if (llmFeed && llmFeed.payload) {
        try {
            const data = JSON.parse(llmFeed.payload);
            el.innerHTML += "<br><br>" + JSON.stringify(data, null, 2);
        } catch(e) {}
    }
}

(window as any).initDevMenu = initDevMenu; (window as any).trackNetwork = trackNetwork;
