import { getVisualDiagnosisHTML } from "./dev_visual_diagnosis";
(window as any).getVisualDiagnosisHTML = getVisualDiagnosisHTML;
import { IS_DEV } from "../shared/gate";
export const isDev = IS_DEV;
import * as THREE from "three";
import { camera } from "./main";
import { ZONE_BOUNDS, WAYPOINTS, ZONES_ARRAY } from "../shared/constants";
import { GlobalState } from "./state";
import { getMatch } from "./MatchController";
import { PanZoomSurface } from "./src/ui/PanZoomSurface";
import { CAMERA_EFFECTS_CONFIG } from "./src/camera/constants";

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

// AI NAV state
let navPanX = 0;
let navPanY = 0;
let navZoom = 1;
let isNavPanning = false;
let startNavPanX = 0;
let startNavPanY = 0;
let baseNavPanX = 0;
let baseNavPanY = 0;
let initialPinchDist = 0;
let baseNavZoom = 1;
let selectedNavDroneId: number | null = null;
let lastInspectedZoneId: string | null = null;
let lastOutlierTick = 0;
let navDroneTrailBuffers = new Map<number, {x:number, z:number}[]>();
let navDroneStateTimers = new Map<number, {state:number, time:number}>();
let navPanZoomInstance: any = null;

// Dev Physics state
let devPhysicsGravityY = -9.81;
let devPhysicsSpeedMultiplier = 1.0;
let devPhysicsPaused = false;

(window as any).syncPhysicsSettings = (gY: number, sM: number, p: boolean) => {
    devPhysicsGravityY = gY;
    devPhysicsSpeedMultiplier = sM;
    devPhysicsPaused = p;
    
    if ((window as any)._physicsWorker) {
        (window as any)._physicsWorker.postMessage({
            type: "SET_PHYSICS_SETTINGS",
            gravityY: gY,
            speedMultiplier: sM,
            paused: p
        });
    }
    
    const gravitySlider = document.getElementById("dev-physics-gravity-slider") as HTMLInputElement;
    if (gravitySlider) {
        gravitySlider.value = String(gY);
    }
    const gravityVal = document.getElementById("dev-physics-gravity-val");
    if (gravityVal) {
        gravityVal.innerText = `${gY.toFixed(2)} m/s²`;
    }
    const speedVal = document.getElementById("dev-physics-speed-val");
    if (speedVal) {
        speedVal.innerText = `${sM.toFixed(2)}x ${p ? '(Paused)' : sM === 1.0 ? '(Normal)' : sM < 1.0 ? '(Slowmo)' : '(Fast)'}`;
    }
    const playPauseBtn = document.getElementById("dev-physics-play-pause");
    if (playPauseBtn) {
        playPauseBtn.innerText = p ? "RESUME" : "PAUSE";
        playPauseBtn.style.background = p ? "#047857" : "#1f2937";
        playPauseBtn.style.borderColor = p ? "#10b981" : "#4b5563";
    }
    const stepBtn = document.getElementById("dev-physics-step-one") as HTMLButtonElement;
    if (stepBtn) {
        stepBtn.disabled = !p;
        stepBtn.style.color = p ? "#ffffff" : "#9ca3af";
    }
};

// Network accumulators for granular bandwidth and connection diagnostic
let bytesReceivedTotal = 0;
let bytesSentTotal = 0;
let pktsReceivedTotal = 0;
let pktsSentTotal = 0;

let bytesReceivedSec = 0;
let bytesSentSec = 0;
let pktsReceivedSec = 0;
let pktsSentSec = 0;

let lastNetSecTime = performance.now();
let bandwidthInKB = 0;
let bandwidthOutKB = 0;
let ppsIn = 0;
let ppsOut = 0;

// Performance accumulators for frame-time diagnostic & leakage detectors
let accumLogicTime = 0;
let accumRenderTime = 0;
let logicTimeSpikes = 0;
let renderTimeSpikes = 0;
let maxFrameTime = 0;
let spikesThisSec = 0; // Task 3 counter
let spikeLogs: string[] = [];
let prevGeomCount = 0;
let prevTexCount = 0;
let leakWarningActive = false;

// Task 1 & 4 State
let clientFrameHistory = new Float32Array(60).fill(0);
let serverTickHistory = new Float32Array(60).fill(0);
const graphCanvas = document.createElement("canvas");
graphCanvas.width = 300;
graphCanvas.height = 80;
const graphCtx = graphCanvas.getContext("2d");

(window as any).devServerTickMs = 0;
(window as any).devServerMemory = { heapUsedMb: 0, heapTotalMb: 0 };

// Expose dynamically for main.ts 
(window as any).initDevMenu = initDevMenu;
(window as any).updateDevPerf = updateDevPerf;
(window as any).receivedLLMFeed = receivedLLMFeed;
(window as any).trackNetwork = trackNetwork;

if (isDev) {
    const _log = console.log, _warn = console.warn, _error = console.error;
    console.log = (...a) => {
        _log(...a);
        logs.push("[LOG] " + a.join(" "));
        if (logs.length > 200) logs.shift();
        updateConsole();
    };
    console.warn = (...a) => {
        _warn(...a);
        logs.push("[WARN] " + a.join(" "));
        if (logs.length > 200) logs.shift();
        updateConsole();
    };
    console.error = (...a) => {
        _error(...a);
        logs.push("[ERR] " + a.join(" "));
        if (logs.length > 200) logs.shift();
        updateConsole();
    };
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

export function updateDevPerf(renderer: any, _time: number, now: number, logicTime = 0, renderTime = 0) {
    if (!isDev) return;
    frames++;
    accumLogicTime += logicTime;
    accumRenderTime += renderTime;
    const totalFrame = logicTime + renderTime;
    if (totalFrame > maxFrameTime) maxFrameTime = totalFrame;

    // Detect lag spikes (frame times > 20ms are spikes for 50-60FPS target)
    if (totalFrame > 20) {
        spikesThisSec++; // Task 3
        if (spikeLogs.length > 10) spikeLogs.shift();
        const d = new Date();
        const timeStr = d.toISOString().split("T")[1].slice(0, 8);
        spikeLogs.push(`[${timeStr}] SPIKE: ${totalFrame.toFixed(1)}ms (Logic: ${logicTime.toFixed(1)}ms | Render: ${renderTime.toFixed(1)}ms)`);
        
        const eventSpike = (window as any).__lastEventSpike;
        if (eventSpike && performance.now() - eventSpike.t < 2000) {
            spikeLogs.push(`[${timeStr}] EVENT SPIKE: ${eventSpike.label} took ${eventSpike.ms.toFixed(1)}ms`);
            (window as any).__lastEventSpike = null;
        }

        if (logicTime > renderTime) {
            logicTimeSpikes++;
        } else {
            renderTimeSpikes++;
        }
    }

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
            
            const avgCalls = currCalls;
            const avgTris = currTris;
            
            const geom = renderer.info?.memory?.geometries || 0;
            const tex = renderer.info?.memory?.textures || 0;

            const avgLogic = accumLogicTime / (fps || 1);
            const avgRender = accumRenderTime / (fps || 1);
            const avgTotal = avgLogic + avgRender;

            const subs = (window as any).devSubsystems || {};
            const subRowsHtml = Object.entries(subs).map(([name, ms]: [string, any]) => {
                const color = ms < 2 ? '#0f0' : ms < 5 ? '#ff0' : '#f00';
                return `
                    <div style="display:flex; justify-content:space-between; font-size:10px; margin-top:2px;">
                        <span style="color:#aaa;">${name.toUpperCase()}:</span>
                        <span style="color:${color}; font-weight:bold;">${ms.toFixed(2)} ms</span>
                    </div>
                `;
            }).join("");

            // Task 1: Update rolling history
            for (let i = 0; i < 59; i++) {
                clientFrameHistory[i] = clientFrameHistory[i + 1];
                serverTickHistory[i] = serverTickHistory[i + 1];
            }
            clientFrameHistory[59] = avgTotal;
            serverTickHistory[59] = (window as any).devServerTickMs || 0;

            // Task 1: Draw Graph
            if (graphCtx) {
                graphCtx.fillStyle = "#0a0a0a";
                graphCtx.fillRect(0, 0, graphCanvas.width, graphCanvas.height);
                
                // Reference line at 16.6ms
                const refY = graphCanvas.height - (16.6 / 33) * graphCanvas.height;
                graphCtx.strokeStyle = "#333";
                graphCtx.lineWidth = 1;
                graphCtx.beginPath();
                graphCtx.moveTo(0, refY);
                graphCtx.lineTo(graphCanvas.width, refY);
                graphCtx.stroke();

                // Draw Series 1 (Cyan) - Client
                graphCtx.strokeStyle = "#0ff";
                graphCtx.beginPath();
                for (let i = 0; i < 60; i++) {
                    const x = (i / 59) * graphCanvas.width;
                    const y = graphCanvas.height - (clientFrameHistory[i] / 33) * graphCanvas.height;
                    if (i === 0) graphCtx.moveTo(x, y);
                    else graphCtx.lineTo(x, y);
                }
                graphCtx.stroke();

                // Draw Series 2 (Magenta) - Server
                graphCtx.strokeStyle = "#f0f";
                graphCtx.beginPath();
                for (let i = 0; i < 60; i++) {
                    const x = (i / 59) * graphCanvas.width;
                    const y = graphCanvas.height - (serverTickHistory[i] / 33) * graphCanvas.height;
                    if (i === 0) graphCtx.moveTo(x, y);
                    else graphCtx.lineTo(x, y);
                }
                graphCtx.stroke();
            }

            const spikeRatioDisplay = spikesThisSec; // Task 3
            spikesThisSec = 0;

            const serverMem = (window as any).devServerMemory;
            const serverMemStr = serverMem?.heapUsedMb ? `${serverMem.heapUsedMb} MB / ${serverMem.heapTotalMb} MB` : "N/A";

            // Resource leak detection heuristic
            if (prevGeomCount > 0 && geom > prevGeomCount + 10) {
                leakWarningActive = true;
            } else if (geom <= prevGeomCount) {
                leakWarningActive = false;
            }
            prevGeomCount = geom;
            prevTexCount = tex;

            accumLogicTime = 0;
            accumRenderTime = 0;
            
            const spikesHtml = spikeLogs.length > 0 
                ? spikeLogs.slice(-4).reverse().map(s => `<div style="color:#f33;">${s}</div>`).join("") 
                : `<div style="color:#888;">No lag spikes detected in last session</div>`;
            
            el.innerHTML = `
                <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px; margin-bottom:15px; line-height:1.4;">
                    <div style="font-weight:bold; color:#0ff; margin-bottom:5px;">[HARDWARE PERFORMANCE]</div>
                    <div>FPS: <span style="color:#0f0; font-weight:bold;">${fps}</span> | CLIENT HEAP: <span style="color:white;">${mem}</span></div>
                    <div>SERVER HEAP USED: <span style="color:white;">${serverMem?.heapUsedMb ? serverMem.heapUsedMb + ' MB' : 'N/A'}</span></div>
                    <div>SERVER HEAP TOTAL: <span style="color:white;">${serverMem?.heapTotalMb ? serverMem.heapTotalMb + ' MB' : 'N/A'}</span></div>
                    <div>MAX FRAME TIME: <span style="color:#ff8800; font-weight:bold;">${maxFrameTime.toFixed(1)} ms</span></div>
                    <div style="margin-top:5px; border-top:1px solid #222; padding-top:5px;">
                        <div>AVG FRAME BUDGET: <span style="color:white; font-weight:bold;">${avgTotal.toFixed(1)} ms</span></div>
                        <div style="display:flex; gap:10px; margin-top:3px;">
                            <div style="flex:1; background:#222; height:12px; border-radius:2px; overflow:hidden; display:flex;">
                                <div style="background:#0cf; width:${Math.min(100, (avgLogic / 16.6) * 100)}%; height:100%;" title="Logic Time"></div>
                                <div style="background:#f0c; width:${Math.min(100, (avgRender / 16.6) * 100)}%; height:100%;" title="Render Time"></div>
                            </div>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:10px; margin-top:2px;">
                            <span style="color:#0cf;">LOGIC: ${avgLogic.toFixed(1)} ms</span>
                            <span style="color:#f0c;">RENDER: ${avgRender.toFixed(1)} ms</span>
                        </div>
                    </div>
                    <div style="margin-top:10px; border-top:1px solid #222; padding-top:5px;">
                        <div style="font-weight:bold; color:#0ff; font-size:10px; margin-bottom:5px;">[SUBSYSTEMS]</div>
                        ${subRowsHtml}
                    </div>
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px; font-family:monospace; font-size:11px;">
                    <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px;">
                        <div style="font-weight:bold; color:#0f0; margin-bottom:5px;">[RESOURCE USAGE]</div>
                        <div>GEOMETRIES: <span style="color:white;">${geom}</span></div>
                        <div>TEXTURES: <span style="color:white;">${tex}</span></div>
                        <div>DRAW CALLS (FR): <span style="color:white;">${avgCalls}</span></div>
                        <div>TRIANGLES (FR): <span style="color:white;">${avgTris}</span></div>
                        <div style="margin-top:5px; font-weight:bold; color:${leakWarningActive ? '#f33' : '#0f0'};">
                            LEAK WATCH: ${leakWarningActive ? 'WARNING - SUSPECTED LEAK' : 'STABLE (PASS)'}
                        </div>
                    </div>
                    <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px;">
                        <div style="font-weight:bold; color:#f33; margin-bottom:5px;">[BOTTLENECK DIAGNOSIS]</div>
                        <div>TOTAL LAG SPIKES: <span style="color:white;">${spikeLogs.length}</span></div>
                        <div>LOGIC FAULTS: <span style="color:#0cf;">${logicTimeSpikes}</span></div>
                        <div>RENDER FAULTS: <span style="color:#f0c;">${renderTimeSpikes}</span></div>
                        <div style="margin-top:5px; font-size:10px; color:#888;">
                            SPIKE RATE: ${spikeRatioDisplay}/sec
                        </div>
                    </div>
                </div>

                <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px;">
                    <div style="font-weight:bold; color:#ff8800; margin-bottom:5px;">[LAG SPIKE LOG (LAST 4 EVENTS)]</div>
                    <div style="line-height:1.4; font-size:10px;">${spikesHtml}</div>
                </div>

                <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px; margin-top:15px;">
                    <div style="font-weight:bold; color:#0ff; margin-bottom:5px;">[FRAME BUDGET HISTORY — 60s]</div>
                    <div style="position:relative; width:100%; height:80px; background:#000;">
                        <img src="${graphCanvas.toDataURL()}" style="width:100%; height:100%; image-rendering:pixelated;" />
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:5px; font-size:10px;">
                        <span style="color:#0ff;">CLIENT FRAME: ${avgTotal.toFixed(1)}ms</span>
                        <span style="color:#f0f;">SERVER TICK: ${((window as any).devServerTickMs || 0).toFixed(1)}ms</span>
                    </div>
                </div>
            `.replace(/  +/g, '');

            maxFrameTime = 0;
        }
    }
}

export function trackNetwork(direction: "IN" | "OUT", data: any) {
    if (!isDev) return;
    
    // Parse size
    const size = data.byteLength || data.length || 0;
    if (direction === "IN") {
        bytesReceivedTotal += size;
        bytesReceivedSec += size;
        pktsReceivedTotal++;
        pktsReceivedSec++;
    } else {
        bytesSentTotal += size;
        bytesSentSec += size;
        pktsSentTotal++;
        pktsSentSec++;
    }

    // Attempt basic decode
    let decoded = "Binary " + size + " bytes";
    if (size === 20) decoded = "Player State (lastSeq, px, py, pz)";
    else if (size > 20) decoded = `Drone State (${Math.floor((size-6)/32)} units)`;
    else if (size === 14) decoded = "Client Input Payload";
    
    if (direction === "IN") {
        const p = inboundPackets[inboundIdx];
        const d = new Date();
        p.time = d.toISOString().split("T")[1].slice(0, -1);
        p.decoded = decoded;
        p.raw = size;
        inboundIdx = (inboundIdx + 1) % 10;
    } else {
        const p = outboundPackets[outboundIdx];
        const d = new Date();
        p.time = d.toISOString().split("T")[1].slice(0, -1);
        p.decoded = decoded;
        p.raw = size;
        outboundIdx = (outboundIdx + 1) % 10;
    }
}

export function updateNetworkHUD() {
    const el = document.getElementById("dev-network");
    if (!el) return;

    // Slide bandwidth counters once per update block
    const now = performance.now();
    const dt = (now - lastNetSecTime) / 1000;
    if (dt >= 0.5) {
        bandwidthInKB = (bytesReceivedSec / 1024) / dt;
        bandwidthOutKB = (bytesSentSec / 1024) / dt;
        ppsIn = Math.round(pktsReceivedSec / dt);
        ppsOut = Math.round(pktsSentSec / dt);
        
        bytesReceivedSec = 0;
        bytesSentSec = 0;
        pktsReceivedSec = 0;
        pktsSentSec = 0;
        lastNetSecTime = now;
    }

    const currentRTT = (window as any).latency !== undefined ? (window as any).latency : 30;

    let inStr = "";
    for (let i = 0; i < 10; i++) {
        const p = inboundPackets[(inboundIdx - 1 - i + 10) % 10];
        if (p && p.time) inStr += `[${p.time}] <span style="color:#0f0;">${p.decoded}</span> (${p.raw} B)<br>`;
    }
    let outStr = "";
    for (let i = 0; i < 10; i++) {
        const p = outboundPackets[(outboundIdx - 1 - i + 10) % 10];
        if (p && p.time) outStr += `[${p.time}] <span style="color:#0ff;">${p.decoded}</span> (${p.raw} B)<br>`;
    }

    el.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px; background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px;">
            <div>
                <div style="font-weight:bold; color:#0ff; margin-bottom:5px;">[CONNECTION TELEMETRY]</div>
                <div>PING / RTT: <span style="color:#0f0; font-weight:bold;">${currentRTT} ms</span></div>
                <div>HEALTH: <span style="color:${currentRTT < 80 ? '#0f0' : '#f00'};">${currentRTT < 80 ? 'EXCELLENT' : currentRTT < 150 ? 'GOOD' : 'POOR'}</span></div>
                <div>TOTAL RECV: <span style="color:white;">${(bytesReceivedTotal / 1024).toFixed(1)} KB</span> (${pktsReceivedTotal} pkts)</div>
            </div>
            <div>
                <div style="font-weight:bold; color:#f0f; margin-bottom:5px;">[BANDWIDTH DATA]</div>
                <div>DOWNSTREAM: <span style="color:white; font-weight:bold;">${bandwidthInKB.toFixed(2)} KB/s</span> (${ppsIn} PPS)</div>
                <div>UPSTREAM: <span style="color:white; font-weight:bold;">${bandwidthOutKB.toFixed(2)} KB/s</span> (${ppsOut} PPS)</div>
                <div>TOTAL SENT: <span style="color:white;">${(bytesSentTotal / 1024).toFixed(1)} KB</span> (${pktsSentTotal} pkts)</div>
            </div>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
            <div>
                <b style="color:#0f0; font-family:monospace;">RECENT INBOUND:</b>
                <div style="background:#0a0a0a; border:1px solid #222; padding:8px; border-radius:4px; font-family:monospace; font-size:10px; line-height:1.4; height:180px; overflow-y:auto; margin-top:5px;">${inStr || "No packets logged"}</div>
            </div>
            <div>
                <b style="color:#0ff; font-family:monospace;">RECENT OUTBOUND:</b>
                <div style="background:#0a0a0a; border:1px solid #222; padding:8px; border-radius:4px; font-family:monospace; font-size:10px; line-height:1.4; height:180px; overflow-y:auto; margin-top:5px;">${outStr || "No packets logged"}</div>
            </div>
        </div>
    `;
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

            let parsedCalls: any[] = [];
            try {
                parsedCalls = typeof tempCalls === "string" ? JSON.parse(tempCalls) : tempCalls;
                if (!Array.isArray(parsedCalls)) parsedCalls = [parsedCalls];
            } catch(e) {}

            const totalCallsCount = data.count || 0;
            const lastLatency = data.latency || 0;
            const hasError = parsedCalls.some(c => c && (c.error || c.errorMessage));
            
            let actionSummary = "";
            if (hasError) {
                actionSummary = `<span style="color:#f33; font-weight:bold;">ERROR ENCOUNTERED</span>`;
            } else if (parsedCalls.length > 0) {
                actionSummary = parsedCalls.map(c => {
                    if (!c) return "";
                    const name = c.name || "Unknown Tool";
                    const args = c.args ? JSON.stringify(c.args) : "";
                    return `<div style="color:#0f0; margin-bottom:3px;">-> CALL: <b>${name}</b> ${args}</div>`;
                }).join("");
            } else {
                actionSummary = `<span style="color:#888;">No active actions in last execution window</span>`;
            }

            const failedList = data.failedOps && data.failedOps.length > 0
                ? data.failedOps.map((op: any) => `<div style="color:#ff3333;">REJECTED: ${JSON.stringify(op)}</div>`).join("")
                : `<span style="color:#888;">Zero command failures in last cycle</span>`;

            el.innerHTML = `
                <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px; margin-bottom:15px; line-height:1.4;">
                    <div style="font-weight:bold; color:#0ff; margin-bottom:5px;">[LLM COMMANDER OVERVIEW]</div>
                    <div>ACTIVE MODEL: <span style="color:white; font-weight:bold;">gemini-3.5-flash (Server-Authoritative)</span></div>
                    <div>RESPONSE STATUS: <span style="color:${hasError ? '#f33' : 'lime'}; font-weight:bold;">${hasError ? 'FAILED' : 'RESPONDED SUCCESSFULLY'}</span></div>
                    <div>LATENCY: <span style="color:white;">${lastLatency} ms</span> | TOTAL CALLS: <span style="color:white;">${totalCallsCount}</span></div>
                </div>

                <div style="display:grid; grid-template-columns: 1fr; gap:15px; margin-bottom:15px; font-family:monospace; font-size:11px;">
                    <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px;">
                        <div style="font-weight:bold; color:#0f0; margin-bottom:5px;">[LATEST COMMANDER ACTIONS]</div>
                        <div style="font-size:10px; line-height:1.4;">${actionSummary}</div>
                    </div>
                    <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px;">
                        <div style="font-weight:bold; color:#f33; margin-bottom:5px;">[FAILED OPERATIONS & REJECTIONS]</div>
                        <div style="font-size:10px; line-height:1.4;">${failedList}</div>
                    </div>
                </div>

                <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px;">
                    <div style="font-weight:bold; color:#ff8800; margin-bottom:5px;">[RAW SEMANTIC ZONE STATE SENT TO AI]</div>
                    <pre style="font-size:9px; max-height:150px; overflow-y:auto; background:#050505; padding:6px; border:1px solid #222; border-radius:3px; margin:0; color:#ccc;">${formattedPayload}</pre>
                </div>
            `;
        }
    }
}
(window as any).receivedLLMFeed = receivedLLMFeed;


function updateCheatsHUD() {
    const el = document.getElementById("dev-cheats-hud");
    if (!el) return;

    const pPos = (window as any).playerPos;
    const yaw = (window as any).getPlayerYaw ? (window as any).getPlayerYaw() : 0;
    const pitch = (window as any).getPlayerPitch ? (window as any).getPlayerPitch() : 0;
    const vel = (window as any).playerVel;

    const yawDeg = (yaw * (180 / Math.PI)).toFixed(1);
    const pitchDeg = (pitch * (180 / Math.PI)).toFixed(1);

    let zoneName = "UNKNOWN";
    if (pPos) {
        for (const [name, bound] of Object.entries(ZONE_BOUNDS)) {
            const b = bound as any;
            if (pPos.x >= b.minX && pPos.x <= b.maxX && pPos.z >= b.minZ && pPos.z <= b.maxZ) {
                zoneName = name;
                break;
            }
        }
    }

    el.innerHTML = `
        <div style="background:#111; padding:10px; border:1px solid #0f0; margin-bottom:15px; border-radius:4px; font-family:monospace; line-height: 1.5;">
            <div style="font-weight:bold; color:#0ff; margin-bottom:5px;">[SPATIAL TELEMETRY]</div>
            <div>POSITION: X: <span style="color:white;">${pPos ? pPos.x.toFixed(3) : "0.000"}</span> | Y: <span style="color:white;">${pPos ? pPos.y.toFixed(3) : "0.000"}</span> | Z: <span style="color:white;">${pPos ? pPos.z.toFixed(3) : "0.000"}</span></div>
            <div>ROTATION: YAW: <span style="color:white;">${yawDeg}°</span> | PITCH: <span style="color:white;">${pitchDeg}°</span></div>
            <div>VELOCITY: X: <span style="color:white;">${vel ? vel.x.toFixed(2) : "0.00"}</span> | Y: <span style="color:white;">${vel ? vel.y.toFixed(2) : "0.00"}</span> | Z: <span style="color:white;">${vel ? vel.z.toFixed(2) : "0.00"}</span> | SPEED: <span style="color:white;">${vel ? vel.length().toFixed(2) : "0.00"} m/s</span></div>
            <div>CURRENT ZONE: <span style="color:#f0f; font-weight:bold;">${zoneName}</span></div>
        </div>
    `;
}


function updateEntitiesHUD() {
    const dataBoard = document.getElementById("dev-test-data-board");
    const collMask = document.getElementById("dev-test-curr-coll");
    
    const telemetry = (window as any).testEntityTelemetryData;
    if (telemetry && telemetry.length > 0) {
        if (dataBoard) {
            let html = "";
            for (const t of telemetry) {
                html += `<div style="color:#fff; margin-bottom:10px;"><b>Entity ID ${t.id} (Mode: ${t.mode})</b><br/>`;
                if (t.history && t.history.length > 0) {
                    for (const h of t.history) {
                        html += `[Tick ${h.time}] Target:(${h.targetX?.toFixed(1)},${h.targetY?.toFixed(1)},${h.targetZ?.toFixed(1)}) | Steer:(${h.steerX?.toFixed(2)},${h.steerZ?.toFixed(2)}) | Vel:(${h.velX?.toFixed(2)},${h.velZ?.toFixed(2)}) | Heading:(${h.headingX?.toFixed(2)},${h.headingZ?.toFixed(2)})<br/>`;
                    }
                } else {
                    html += `No history available yet.<br/>`;
                }
                html += `</div>`;
            }
            dataBoard.innerHTML = html;
        }
        if (collMask) {
            const firstColl = telemetry[0].coll;
            collMask.innerText = firstColl !== undefined ? `0x${firstColl.toString(16).toUpperCase().padStart(8, '0')}` : "UNKNOWN";
            
            const evBoard = document.getElementById("dev-test-collision-events");
            if (evBoard) {
                let evHtml = "";
                for (const t of telemetry) {
                    if (t.collisions && t.collisions.length > 0) {
                        evHtml += `<div style="color:#f00;">Entity ${t.id} CONTACT WITH: ${t.collisions.join(", ")}</div>`;
                    }
                }
                evBoard.innerHTML = evHtml || `<div style="color:#888;">No recent player contact events.</div>`;
            }
        }
    } else {
        if (dataBoard) dataBoard.innerHTML = "Waiting for telemetry... Spawn a Test Entity.";
        if (collMask) {
           collMask.innerText = "UNKNOWN";
           const evBoard = document.getElementById("dev-test-collision-events");
           if (evBoard) evBoard.innerHTML = `<div style="color:#888;">No recent player contact events.</div>`;
        }
    }
}

let activeChannel: any;

export function initDevMenu(channel: any, jitterMap: any) {
    if (!isDev) return;
    activeChannel = channel;
    (window as any).activeChannel = channel;
    

    if (channel) {
        // Monkeypatch Geckos outbound
        if (typeof channel.rawEmit === "function" && !(channel as any)._rawEmitPatched) {
            const origRaw = channel.rawEmit.bind(channel);
            channel.rawEmit = (data: any) => { trackNetwork("OUT", data); origRaw(data); };
            (channel as any)._rawEmitPatched = true;
        }
        if (typeof channel.emit === "function") {
            const origReliable = channel.emit.bind(channel);
            channel.emit = (ev: string, data: any) => { trackNetwork("OUT", data || ev); origReliable(ev, data); };
        }
        
        channel.on("dev_llm_feed", (data: any) => receivedLLMFeed(data));
        channel.on("dev_server_tick_ms", (data: any) => {
            (window as any).devServerTickMs = data.tickMs;
        });
        channel.on("dev_server_memory_mb", (data: any) => {
            (window as any).devServerMemory = data;
        });
        channel.on("dev_test_entity_telemetry", (data: any) => {
            (window as any).testEntityTelemetryData = data.data;
        });
        channel.on("dev_collision_signal", (data: string) => {
            if (!(window as any).collisionLogs) (window as any).collisionLogs = [];
            (window as any).collisionLogs.push(data);
            if ((window as any).collisionLogs.length > 200) (window as any).collisionLogs.shift();
            
            const logEl = document.getElementById("dev-collisions");
            if (logEl) {
                updateCollisionsHUD();
            }
        });
        channel.on("dev_collision_telemetry", (data: any) => {
            (window as any).lastCollisionTelemetry = data;
            const telEl = document.getElementById("dev-collision-telemetry");
            if (telEl) {
                telEl.innerHTML = `
                    <div style="color:#60a5fa; margin-bottom:5px;">[LIVE TELEMETRY (Tick: ${data.tick})]</div>
                    <div>PLAYER: [${data.player.x.toFixed(3)}, ${data.player.y.toFixed(3)}, ${data.player.z.toFixed(3)}]</div>
                    <div>DRONE (${data.drone.id}): [${data.drone.x.toFixed(3)}, ${data.drone.y.toFixed(3)}, ${data.drone.z.toFixed(3)}]</div>
                    <div>DISTANCE: ${data.dist.toFixed(3)}m</div>
                `;
            }
        });
    }

    // Construct DOM
    const btn = document.createElement("button");
    btn.innerText = "DEV";
    btn.style.cssText = "position:absolute;top:10px;left:10px;z-index:999999;background:#f0f;color:white;font-weight:bold;padding:5px 10px;border:none;cursor:pointer;pointer-events:auto;";
    btn.onclick = () => toggleDevMenu();
    document.body.appendChild(btn);

    const overlay = document.createElement("div");
    overlay.id = "dev-overlay";
    overlay.style.cssText = "display:none;position:absolute;inset:0;background:rgba(0,0,0,0.85);z-index:999998;pointer-events:auto;color:#0f0;font-family:monospace;padding:10px;flex-direction:column;";
    
    const tabs = ["VIS DIAG", "GAME CONTROL", "PHYSICS", "CHEATS", "WEPS", "CAM_FX", "CONSOLE", "LLM FEED", "AI NAV", "PERF", "NETWORK", "ZONES", "ENTITIES", "COLLISIONS"];
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
        if (isMenuOpen) {
            if (activePanel === "AI NAV") drawAINav();
            if (activePanel === "ZONES") drawZones();
            if (activePanel === "CHEATS") updateCheatsHUD();
            if (activePanel === "NETWORK") updateNetworkHUD();
            if (activePanel === "PHYSICS") updatePhysicsPanelHUD();
            if (activePanel === "ENTITIES") updateEntitiesHUD();
        }
    }, 200);
}

function toggleDevMenu() {
    isMenuOpen = !isMenuOpen;
    const overlay = document.getElementById("dev-overlay");
    if (overlay) overlay.style.display = isMenuOpen ? "flex" : "none";
    if (isMenuOpen) renderPanel();
}
(window as any).toggleDevMenu = toggleDevMenu;

function renderPanel() {
    if (activePanel !== "AI NAV" && navPanZoomInstance) {
        navPanZoomInstance.destroy();
        navPanZoomInstance = null;
    }
    const c = document.getElementById("dev-content");
    if (!c) return;
    
    if (activePanel === "GAME CONTROL") {
        c.innerHTML = `
            <h3>Player Class</h3>
            <div id="dev-loadout-buttons" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom: 20px;">
                <button data-class="assault" style="padding:5px;">Assault</button>
                <button data-class="medic" style="padding:5px;">Medic</button>
                <button data-class="recon" style="padding:5px;">Recon</button>
                <button data-class="demolitions" style="padding:5px;">Demolitions</button>
            </div>
            <h3>LLM Commander</h3>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button id="dev-toggle-llm" style="padding:5px;">${devLlmDisabled ? "ENABLE LLM COMMANDER" : "DISABLE LLM COMMANDER"}</button>
            </div>
        `;
        
        // Add event listeners programmatically
        const loadoutButtons = c.querySelectorAll('#dev-loadout-buttons button');
        loadoutButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const playerClass = (e.target as HTMLElement).getAttribute('data-class');
                if (playerClass) {
                    if (activeChannel) activeChannel.emit("dev_set_class", { playerClass });
                }
            });
        });

        const toggleLlmBtn = document.getElementById('dev-toggle-llm');
        if (toggleLlmBtn) {
            toggleLlmBtn.addEventListener('click', () => {
                devLlmDisabled = !devLlmDisabled;
                toggleLlmBtn.innerText = devLlmDisabled ? "ENABLE LLM COMMANDER" : "DISABLE LLM COMMANDER";
                if (activeChannel) activeChannel.emit("dev_toggle_llm", { disabled: devLlmDisabled });
            });
        }
    }
    else if (activePanel === "ENTITIES") {
        c.innerHTML = `
            <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px; margin-bottom:15px; line-height:1.4;">
                <div style="font-weight:bold; color:#0ff; margin-bottom:5px;">[ROW 1: VEXEA DRONE SPAWNING] <span style="cursor:help; color:#0cf; border:1px solid #0cf; border-radius:50%; padding:0 4px;" title="Spawns fully functional gameplay drones connected to the LLM Commander, full physics, and perception systems.">?</span></div>
                <div id="dev-spawn-buttons" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom: 10px;">
                    <button data-type="0" style="padding:5px;">Rotary Shooter</button>
                    <button data-type="1" style="padding:5px;">Bomber</button>
                    <button data-type="2" style="padding:5px;">Recon</button>
                    <button data-type="3" style="padding:5px;">Fixed Wing</button>
                    <button data-type="4" style="padding:5px;">Wheeled Drone</button>
                    <button data-type="5" style="padding:5px;">Robot Dog</button>
                    <button data-type="6" style="padding:5px;">Humanoid</button>
                </div>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button id="dev-clear-drones" style="padding:5px;">Clear All Drones</button>
                    <button id="dev-spawn-bots" style="padding:5px;">Spawn 3 Test Bots</button>
                </div>
            </div>
            <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px; margin-bottom:15px; line-height:1.4;">
                <div style="font-weight:bold; color:#f0f; margin-bottom:5px;">[ROW 2: ISOLATED VEHICLE SPAWNING] <span style="cursor:help; color:#0cf; border:1px solid #0cf; border-radius:50%; padding:0 4px;" title="Spawns a dummy test entity (Type 99) with an isolated Yuka vehicle. Useful for testing raw steering behaviors and physics filters without LLM or gameplay interference.">?</span></div>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button id="dev-spawn-test-entity" style="padding:5px; background:#1e3a8a; border:1px solid #3b82f6; color:white;">Spawn Test Entity (Bare Yuka)</button>
                    <button id="dev-clear-test-entities" style="padding:5px; background:#5c1d1d; border:1px solid #ef4444; color:white;">Clear All Test Entities</button>
                </div>
            </div>
            <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px; margin-bottom:15px; line-height:1.4;">
                <div style="font-weight:bold; color:#ff8800; margin-bottom:5px;">[ROW 3: FSM/TASK-MODE CONTROLS] <span style="cursor:help; color:#0cf; border:1px solid #0cf; border-radius:50%; padding:0 4px;" title="Forces the test entity to switch states manually (e.g. NORMAL idling vs COMBAT mode), or sets a specific world-space target for steering.">?</span></div>
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                    <button id="dev-test-mode-normal" style="padding:5px;">Force Mode: NORMAL</button>
                    <button id="dev-test-mode-combat" style="padding:5px;">Force Mode: COMBAT</button>
                </div>
                <div style="display:flex; gap:10px; align-items:center;">
                    <input type="number" id="dev-target-x" value="0" style="width:50px; background:#222; color:white; border:1px solid #444;" />
                    <input type="number" id="dev-target-y" value="0" style="width:50px; background:#222; color:white; border:1px solid #444;" />
                    <input type="number" id="dev-target-z" value="0" style="width:50px; background:#222; color:white; border:1px solid #444;" />
                    <button id="dev-test-assign-target" style="padding:5px;">Assign Target Position</button>
                </div>
            </div>

            <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px; margin-bottom:15px; line-height:1.4;">
                <div style="font-weight:bold; color:#0f0; margin-bottom:5px;">[ROW 4: PERCEPTION CONTROLS]</div>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button id="dev-test-sight" style="padding:5px;">Trigger Simulated Sight</button>
                    <button id="dev-test-sound" style="padding:5px;">Trigger Simulated Sound</button>
                </div>
            </div>

            <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px; margin-bottom:15px; line-height:1.4;">
                <div style="font-weight:bold; color:#ff0; margin-bottom:5px;">[ROW 5: LIVE DECISION DATA BOARD]</div>
                <div id="dev-test-data-board" style="background:#000; padding:10px; height:150px; overflow-y:auto; border:1px solid #222;">
                    Waiting for telemetry...
                </div>
            </div>

            <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px; margin-bottom:15px; line-height:1.4;">
                <div style="font-weight:bold; color:#0cf; margin-bottom:5px;">[ROW 6: COLLISION TESTING CONTROLS]</div>
                <div style="margin-bottom:10px; color:#ccc;">Hypothesis Toggles (Overrides Rapier Bitmask):</div>
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                    <button id="dev-test-coll-player" style="padding:5px;">Group: Player-Only</button>
                    <button id="dev-test-coll-world" style="padding:5px;">Group: World-Only</button>
                    <button id="dev-test-coll-all" style="padding:5px;">Group: All</button>
                </div>
                <div style="color:#ccc;">Current collision bitmask: <span id="dev-test-curr-coll" style="color:#fff; font-weight:bold;">UNKNOWN</span></div>
                <div id="dev-test-collision-events" style="margin-top:10px; background:#000; padding:10px; height:60px; overflow-y:auto; border:1px solid #222;">
                    No recent player contact events.
                </div>
            </div>
        `;

        // Row 1 Handlers
        const spawnButtons = c.querySelectorAll('#dev-spawn-buttons button');
        spawnButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = parseInt((e.target as HTMLElement).getAttribute('data-type') || '0', 10);
                if (!camera) return;
                const dir = new THREE.Vector3(0, 0, -1);
                dir.applyQuaternion(camera.quaternion);
                const pos = new THREE.Vector3();
                pos.copy(camera.position).add(dir.multiplyScalar(10));
                let spawnY = pos.y;
                if (spawnY < Number(0.5)) spawnY = Number(0.5);
                if (activeChannel) activeChannel.emit("dev_spawn_drone", { type, x: pos.x, y: spawnY, z: pos.z });
            });
        });
        const clearBtn = document.getElementById('dev-clear-drones');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (activeChannel) activeChannel.emit("dev_clear_drones", {});
                if (getMatch()?.droneJitterMap) getMatch()?.droneJitterMap.clear();
            });
        }
        const botsBtn = document.getElementById('dev-spawn-bots');
        if (botsBtn) {
            botsBtn.addEventListener('click', () => {
                if (activeChannel) activeChannel.emit("dev_spawn_bots", { count: 3 });
            });
        }

        // Row 2 Handlers
        const spawnTestBtn = document.getElementById('dev-spawn-test-entity');
        if (spawnTestBtn) {
            spawnTestBtn.addEventListener('click', () => {
                if (!camera) return;
                const dir = new THREE.Vector3(0, 0, -1);
                dir.applyQuaternion(camera.quaternion);
                const pos = new THREE.Vector3();
                pos.copy(camera.position).add(dir.multiplyScalar(10));
                let spawnY = pos.y;
                if (spawnY < Number(0.5)) spawnY = Number(0.5);
                if (activeChannel) activeChannel.emit("dev_spawn_test_entity", { x: pos.x, y: spawnY, z: pos.z });
            });
        }
        const clearTestBtn = document.getElementById('dev-clear-test-entities');
        if (clearTestBtn) {
            clearTestBtn.addEventListener('click', () => {
                if (activeChannel) activeChannel.emit("dev_clear_test_entities", {});
            });
        }

        // Row 3 Handlers
        document.getElementById('dev-test-mode-normal')?.addEventListener('click', () => {
            if (activeChannel) activeChannel.emit("dev_test_entity_mode", { mode: "NORMAL" });
        });
        document.getElementById('dev-test-mode-combat')?.addEventListener('click', () => {
            if (activeChannel) activeChannel.emit("dev_test_entity_mode", { mode: "COMBAT" });
        });
        document.getElementById('dev-test-assign-target')?.addEventListener('click', () => {
            const x = parseFloat((document.getElementById('dev-target-x') as HTMLInputElement).value) || 0;
            const y = parseFloat((document.getElementById('dev-target-y') as HTMLInputElement).value) || 0;
            const z = parseFloat((document.getElementById('dev-target-z') as HTMLInputElement).value) || 0;
            if (activeChannel) activeChannel.emit("dev_test_entity_target", { x, y, z });
        });

        // Row 4 Handlers
        document.getElementById('dev-test-sight')?.addEventListener('click', () => {
            if (activeChannel) activeChannel.emit("dev_test_entity_sight", {});
        });
        document.getElementById('dev-test-sound')?.addEventListener('click', () => {
            if (activeChannel) activeChannel.emit("dev_test_entity_sound", {});
        });

        // Row 6 Handlers
        // Group values: PLAYER is maybe group 1, WORLD is group 2. Let's use 0x0001, 0xFFFF
        document.getElementById('dev-test-coll-player')?.addEventListener('click', () => {
            // Hypothesis: Only collide with group 0x0001
            if (activeChannel) activeChannel.emit("dev_test_entity_collision_filter", { group: 1, mask: 0x0001 });
        });
        document.getElementById('dev-test-coll-world')?.addEventListener('click', () => {
            // Hypothesis: Only collide with group 0x0002
            if (activeChannel) activeChannel.emit("dev_test_entity_collision_filter", { group: 1, mask: 0x0002 });
        });
        document.getElementById('dev-test-coll-all')?.addEventListener('click', () => {
            if (activeChannel) activeChannel.emit("dev_test_entity_collision_filter", { group: 1, mask: 0xFFFF });
        });
    }
    else if (activePanel === "PHYSICS") {
        c.innerHTML = `
            <h2 style="color:#0f0; margin-top:0;">PHYSICS ENGINE CONTROL</h2>
            
            <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px; margin-bottom:15px; line-height:1.4;">
                <div style="font-weight:bold; color:#0ff; margin-bottom:10px;">[PACING & ENGINE PARAMETERS]</div>
                
                <div style="margin-bottom:12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <span style="color:#aaa;">SIMULATION STATE:</span>
                    <button id="dev-physics-play-pause" style="padding:6px 12px; background:#1f2937; border:1px solid #4b5563; color:white; font-weight:bold; cursor:pointer; border-radius:4px; min-width:90px;">PAUSE</button>
                    <button id="dev-physics-step-one" style="padding:6px 12px; background:#111827; border:1px solid #374151; color:#9ca3af; font-weight:bold; cursor:pointer; border-radius:4px;" disabled>STEP 1 FRAME</button>
                </div>

                <div style="margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <span style="color:#aaa;">SPEED MULTIPLIER (TIME DILATION):</span>
                        <span id="dev-physics-speed-val" style="color:#0f0; font-weight:bold;">1.00x (Normal)</span>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="dev-physics-speed-preset" data-speed="0.1" style="padding:5px 8px; background:#1f2937; border:1px solid #4b5563; color:white; cursor:pointer; border-radius:3px; font-size:10px;">0.10x (Slowmo)</button>
                        <button class="dev-physics-speed-preset" data-speed="0.25" style="padding:5px 8px; background:#1f2937; border:1px solid #4b5563; color:white; cursor:pointer; border-radius:3px; font-size:10px;">0.25x</button>
                        <button class="dev-physics-speed-preset" data-speed="0.5" style="padding:5px 8px; background:#1f2937; border:1px solid #4b5563; color:white; cursor:pointer; border-radius:3px; font-size:10px;">0.50x</button>
                        <button class="dev-physics-speed-preset" data-speed="1.0" style="padding:5px 8px; background:#111827; border:1px solid #3b82f6; color:#3b82f6; cursor:pointer; border-radius:3px; font-size:10px; font-weight:bold;">1.00x (Normal)</button>
                        <button class="dev-physics-speed-preset" data-speed="2.0" style="padding:5px 8px; background:#1f2937; border:1px solid #4b5563; color:white; cursor:pointer; border-radius:3px; font-size:10px;">2.00x (Fast)</button>
                    </div>
                </div>

                <div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <span style="color:#aaa;">GRAVITY Y ACCELERATION:</span>
                        <span id="dev-physics-gravity-val" style="color:#0f0; font-weight:bold;">-9.81 m/s²</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="range" id="dev-physics-gravity-slider" min="-25.0" max="5.0" step="0.5" value="-9.81" style="flex:1; cursor:pointer; background:#222; border:1px solid #444; border-radius:3px; height:6px;">
                        <button id="dev-physics-gravity-reset" style="padding:5px 8px; background:#374151; border:1px solid #4b5563; color:white; cursor:pointer; border-radius:3px; font-size:10px; font-weight:bold;">RESET</button>
                    </div>
                </div>
            </div>

            <div style="background:#111; padding:10px; border:1px solid #333; border-radius:4px; font-family:monospace; font-size:11px; margin-bottom:15px; line-height:1.4;">
                <div style="font-weight:bold; color:#0ff; margin-bottom:5px;">[DEBUG OPERATIONS]</div>
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                    <button id="dev-spawn-client-cube" style="padding:8px 12px; background:#1e3a8a; border:1px solid #3b82f6; color:white; font-weight:bold; cursor:pointer; border-radius:4px;">SPAWN CLIENT CUBE (Prediction)</button>
                    <button id="dev-spawn-server-cube" style="padding:8px 12px; background:#5c1d1d; border:1px solid #ef4444; color:white; font-weight:bold; cursor:pointer; border-radius:4px;">SPAWN SERVER CUBE (Authoritative)</button>
                    <button id="dev-spawn-both-cubes" style="padding:8px 12px; background:#b45309; border:1px solid #f59e0b; color:white; font-weight:bold; cursor:pointer; border-radius:4px;">SPAWN BOTH (Side-by-Side)</button>
                    <button id="dev-clear-physics-cubes" style="padding:8px 12px; background:#374151; border:1px solid #4b5563; color:white; font-weight:bold; cursor:pointer; border-radius:4px;">CLEAR ALL CUBES</button>
                </div>
                <div style="font-weight:bold; color:#a855f7; margin-bottom:5px;">[COLLISION DIAGNOSTICS & TEST ENTITIES]</div>
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                    <button id="dev-spawn-frozen-drone" style="padding:8px 12px; background:#6b21a8; border:1px solid #a855f7; color:white; font-weight:bold; cursor:pointer; border-radius:4px;">SPAWN FROZEN DRONE (At Player)</button>
                    <button id="dev-clear-frozen-drones" style="padding:8px 12px; background:#374151; border:1px solid #4b5563; color:white; font-weight:bold; cursor:pointer; border-radius:4px;">CLEAR FROZEN DRONES</button>
                </div>
                <div style="font-weight:bold; color:#ef4444; margin-bottom:5px;">[DISCONNECT / RECONNECT TEST (DISLOCATOR)]</div>
                <div style="display:flex; gap:10px; align-items:center;">
                    <button id="dev-simulate-disconnect" style="padding:8px 12px; background:#b91c1c; border:1px solid #ef4444; color:white; font-weight:bold; cursor:pointer; border-radius:4px;">SIMULATE DISCONNECT (3s)</button>
                    <span id="dev-disconnect-status" style="color:#10b981; font-weight:bold;">Status: Connected</span>
                </div>
            </div>

            <div id="dev-physics-hud"></div>
        `;

        // Initialize state indicators based on current client variables
        (window as any).syncPhysicsSettings(devPhysicsGravityY, devPhysicsSpeedMultiplier, devPhysicsPaused);
        updatePhysicsPanelHUD();

        // 1. Play / Pause Control
        const playPauseBtn = document.getElementById("dev-physics-play-pause");
        if (playPauseBtn) {
            playPauseBtn.onclick = () => {
                const targetPaused = !devPhysicsPaused;
                if (activeChannel) {
                    activeChannel.emit("dev_set_paused", { paused: targetPaused });
                }
                (window as any).syncPhysicsSettings(devPhysicsGravityY, devPhysicsSpeedMultiplier, targetPaused);
            };
        }

        // 2. Step One Frame
        const stepBtn = document.getElementById("dev-physics-step-one");
        if (stepBtn) {
            stepBtn.onclick = () => {
                if (activeChannel) {
                    activeChannel.emit("dev_step_once", {});
                }
                if ((window as any)._physicsWorker) {
                    (window as any)._physicsWorker.postMessage({ type: "STEP_ONCE" });
                }
            };
        }

        // 3. Speed presets
        const speedPresets = document.querySelectorAll(".dev-physics-speed-preset");
        speedPresets.forEach(btn => {
            (btn as HTMLButtonElement).onclick = () => {
                const speed = parseFloat(btn.getAttribute("data-speed") || "1.0");
                if (activeChannel) {
                    activeChannel.emit("dev_set_speed_multiplier", { speedMultiplier: speed });
                }
                (window as any).syncPhysicsSettings(devPhysicsGravityY, speed, devPhysicsPaused);
                
                // Style selection indicator
                speedPresets.forEach(b => {
                    const el = b as HTMLButtonElement;
                    el.style.border = "1px solid #4b5563";
                    el.style.background = "#1f2937";
                    el.style.color = "white";
                    el.style.fontWeight = "normal";
                });
                const selectedEl = btn as HTMLButtonElement;
                selectedEl.style.border = "1px solid #3b82f6";
                selectedEl.style.background = "#111827";
                selectedEl.style.color = "#3b82f6";
                selectedEl.style.fontWeight = "bold";
            };
        });

        // 4. Gravity Slider
        const gravitySlider = document.getElementById("dev-physics-gravity-slider") as HTMLInputElement;
        if (gravitySlider) {
            gravitySlider.oninput = (e) => {
                const gY = parseFloat((e.target as HTMLInputElement).value);
                const gravityVal = document.getElementById("dev-physics-gravity-val");
                if (gravityVal) {
                    gravityVal.innerText = `${gY.toFixed(2)} m/s²`;
                }
            };
            gravitySlider.onchange = (e) => {
                const gY = parseFloat((e.target as HTMLInputElement).value);
                if (activeChannel) {
                    activeChannel.emit("dev_set_gravity_y", { gravityY: gY });
                }
                (window as any).syncPhysicsSettings(gY, devPhysicsSpeedMultiplier, devPhysicsPaused);
            };
        }

        // 5. Gravity Reset
        const gravityResetBtn = document.getElementById("dev-physics-gravity-reset");
        if (gravityResetBtn) {
            gravityResetBtn.onclick = () => {
                const gY = -9.81;
                if (activeChannel) {
                    activeChannel.emit("dev_set_gravity_y", { gravityY: gY });
                }
                (window as any).syncPhysicsSettings(gY, devPhysicsSpeedMultiplier, devPhysicsPaused);
            };
        }

        // Spawners
        const spawnClientBtn = document.getElementById("dev-spawn-client-cube");
        if (spawnClientBtn) {
            spawnClientBtn.onclick = () => {
                const dir = new THREE.Vector3(0, 0, -1);
                if (camera) dir.applyQuaternion(camera.quaternion);
                const pos = new THREE.Vector3();
                const pPos = (window as any).playerPos;
                if (pPos) {
                    pos.copy(pPos).add(dir.multiplyScalar(5));
                } else if (camera) {
                    pos.copy(camera.position).add(dir.multiplyScalar(5));
                }
                const spawnY = pos.y + 3.0;
                
                if ((window as any)._physicsWorker) {
                    (window as any)._physicsWorker.postMessage({
                        type: "SPAWN_CUBE",
                        x: pos.x,
                        y: spawnY,
                        z: pos.z
                    });
                }
            };
        }

        const spawnServerBtn = document.getElementById("dev-spawn-server-cube");
        if (spawnServerBtn) {
            spawnServerBtn.onclick = () => {
                if (activeChannel) {
                    activeChannel.emit("dev_spawn_cube", {});
                }
            };
        }

        const spawnBothBtn = document.getElementById("dev-spawn-both-cubes");
        if (spawnBothBtn) {
            spawnBothBtn.onclick = () => {
                const dir = new THREE.Vector3(0, 0, -1);
                if (camera) dir.applyQuaternion(camera.quaternion);
                const pos = new THREE.Vector3();
                const pPos = (window as any).playerPos;
                if (pPos) {
                    pos.copy(pPos).add(dir.multiplyScalar(5));
                } else if (camera) {
                    pos.copy(camera.position).add(dir.multiplyScalar(5));
                }
                const spawnY = pos.y + 3.0;

                const right = new THREE.Vector3(1, 0, 0);
                if (camera) right.applyQuaternion(camera.quaternion).normalize();

                const leftSpawn = pos.clone().addScaledVector(right, -1.0);
                const rightSpawn = pos.clone().addScaledVector(right, 1.0);

                // Spawn client on left
                if ((window as any)._physicsWorker) {
                    (window as any)._physicsWorker.postMessage({
                        type: "SPAWN_CUBE",
                        x: leftSpawn.x,
                        y: spawnY,
                        z: leftSpawn.z
                    });
                }

                // Spawn server on right
                if (activeChannel) {
                    activeChannel.emit("dev_spawn_cube", { x: rightSpawn.x, y: spawnY, z: rightSpawn.z });
                }
            };
        }

        const clearBtn = document.getElementById("dev-clear-physics-cubes");
        if (clearBtn) {
            clearBtn.onclick = () => {
                if ((window as any)._physicsWorker) {
                    (window as any)._physicsWorker.postMessage({ type: "CLEAR_CUBE" });
                }
                if (activeChannel) {
                    activeChannel.emit("dev_clear_cube", {});
                }
            };
        }

        const spawnFrozenDroneBtn = document.getElementById("dev-spawn-frozen-drone");
        if (spawnFrozenDroneBtn) {
            spawnFrozenDroneBtn.onclick = () => {
                const dir = new THREE.Vector3(0, 0, -1);
                if (camera) dir.applyQuaternion(camera.quaternion);
                const pos = new THREE.Vector3();
                const pPos = (window as any).playerPos;
                if (pPos) {
                    pos.copy(pPos).add(dir.multiplyScalar(3));
                } else if (camera) {
                    pos.copy(camera.position).add(dir.multiplyScalar(3));
                }
                const spawnY = pos.y + 0.5;
                
                if (activeChannel) {
                    activeChannel.emit("dev_spawn_frozen_drone", {
                        type: 6, // HUMANOID
                        x: pos.x,
                        y: spawnY,
                        z: pos.z
                    });
                }
            };
        }

        const clearFrozenBtn = document.getElementById("dev-clear-frozen-drones");
        if (clearFrozenBtn) {
            clearFrozenBtn.onclick = () => {
                if (activeChannel) {
                    activeChannel.emit("dev_clear_frozen", {});
                }
            };
        }

        const simulateDisconnectBtn = document.getElementById("dev-simulate-disconnect");
        if (simulateDisconnectBtn) {
            simulateDisconnectBtn.onclick = () => {
                const matchInstance = getMatch();
                if (matchInstance && matchInstance.reconnection) {
                    matchInstance.reconnection.simulateDisconnect(3000);
                } else {
                    console.error("[RECONNECTION] MatchController or ReconnectionSystem not found.");
                }
            };
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
    else if (activePanel === "CAM_FX") {
        c.innerHTML = `
            <div style="padding: 10px; font-family: monospace; color: #0f0;">
                <h2 style="color: #0f0; margin-top: 0;">Camera & Viewmodel Effects Constants</h2>
                <p style="color: #888; font-size: 11px; margin-bottom: 15px;">Tweak these settings to instantly adjust camera movement, bobbing, tilt, pulling back, and landing effects.</p>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; margin-bottom: 20px;">
                    <!-- Movement Category -->
                    <div style="background: #111; padding: 10px; border: 1px solid #333; border-radius: 4px;">
                        <h3 style="color: #0ff; margin-top: 0; border-bottom: 1px solid #222; padding-bottom: 5px;">MOVEMENT</h3>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>RUN ACCEL RATE (s):</span>
                                <span id="val-movement-accel" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.MOVEMENT.RUN_ACCEL_RATE.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-movement-accel" min="0.1" max="10.0" step="0.1" value="${CAMERA_EFFECTS_CONFIG.MOVEMENT.RUN_ACCEL_RATE}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>RUN DECEL RATE (s):</span>
                                <span id="val-movement-decel" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.MOVEMENT.RUN_DECEL_RATE.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-movement-decel" min="0.1" max="10.0" step="0.1" value="${CAMERA_EFFECTS_CONFIG.MOVEMENT.RUN_DECEL_RATE}" style="width: 100%;">
                        </label>
                    </div>

                    <!-- Weapon Follow Category -->
                    <div style="background: #111; padding: 10px; border: 1px solid #333; border-radius: 4px;">
                        <h3 style="color: #0ff; margin-top: 0; border-bottom: 1px solid #222; padding-bottom: 5px;">WEAPON FOLLOW</h3>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>BASE FOLLOW SPEED:</span>
                                <span id="val-follow-base" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.WEAPON_FOLLOW.BASE_SPEED.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-follow-base" min="1.0" max="50.0" step="0.5" value="${CAMERA_EFFECTS_CONFIG.WEAPON_FOLLOW.BASE_SPEED}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>LAG FACTOR:</span>
                                <span id="val-follow-lag" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.WEAPON_FOLLOW.LAG_FACTOR.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-follow-lag" min="0.1" max="10.0" step="0.1" value="${CAMERA_EFFECTS_CONFIG.WEAPON_FOLLOW.LAG_FACTOR}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>MIN FOLLOW SPEED MULT:</span>
                                <span id="val-follow-min" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.WEAPON_FOLLOW.MIN_FOLLOW_SPEED_MULT.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-follow-min" min="0.01" max="1.0" step="0.01" value="${CAMERA_EFFECTS_CONFIG.WEAPON_FOLLOW.MIN_FOLLOW_SPEED_MULT}" style="width: 100%;">
                        </label>
                    </div>

                    <!-- Head Bob Walk Category -->
                    <div style="background: #111; padding: 10px; border: 1px solid #333; border-radius: 4px;">
                        <h3 style="color: #0ff; margin-top: 0; border-bottom: 1px solid #222; padding-bottom: 5px;">HEAD BOB (WALK)</h3>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>WALK FREQUENCY:</span>
                                <span id="val-bob-walk-freq" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.BOB.WALK_FREQ.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-bob-walk-freq" min="1.0" max="30.0" step="0.5" value="${CAMERA_EFFECTS_CONFIG.BOB.WALK_FREQ}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>WALK AMP Y (Vert):</span>
                                <span id="val-bob-walk-amp-y" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.BOB.WALK_AMP_Y.toFixed(4)}</span>
                            </span>
                            <input type="range" id="slide-bob-walk-amp-y" min="0.001" max="0.2" step="0.001" value="${CAMERA_EFFECTS_CONFIG.BOB.WALK_AMP_Y}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>WALK AMP X (Sway):</span>
                                <span id="val-bob-walk-amp-x" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.BOB.WALK_AMP_X.toFixed(4)}</span>
                            </span>
                            <input type="range" id="slide-bob-walk-amp-x" min="0.001" max="0.2" step="0.001" value="${CAMERA_EFFECTS_CONFIG.BOB.WALK_AMP_X}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>WALK AMP ROLL (Tilt):</span>
                                <span id="val-bob-walk-amp-roll" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.BOB.WALK_AMP_ROLL.toFixed(4)}</span>
                            </span>
                            <input type="range" id="slide-bob-walk-amp-roll" min="0.001" max="0.05" step="0.001" value="${CAMERA_EFFECTS_CONFIG.BOB.WALK_AMP_ROLL}" style="width: 100%;">
                        </label>
                    </div>

                    <!-- Head Bob Sprint Category -->
                    <div style="background: #111; padding: 10px; border: 1px solid #333; border-radius: 4px;">
                        <h3 style="color: #0ff; margin-top: 0; border-bottom: 1px solid #222; padding-bottom: 5px;">HEAD BOB (SPRINT)</h3>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>SPRINT FREQUENCY:</span>
                                <span id="val-bob-sprint-freq" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.BOB.SPRINT_FREQ.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-bob-sprint-freq" min="1.0" max="30.0" step="0.5" value="${CAMERA_EFFECTS_CONFIG.BOB.SPRINT_FREQ}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>SPRINT AMP Y (Vert):</span>
                                <span id="val-bob-sprint-amp-y" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.BOB.SPRINT_AMP_Y.toFixed(4)}</span>
                            </span>
                            <input type="range" id="slide-bob-sprint-amp-y" min="0.001" max="0.4" step="0.001" value="${CAMERA_EFFECTS_CONFIG.BOB.SPRINT_AMP_Y}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>SPRINT AMP X (Sway):</span>
                                <span id="val-bob-sprint-amp-x" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.BOB.SPRINT_AMP_X.toFixed(4)}</span>
                            </span>
                            <input type="range" id="slide-bob-sprint-amp-x" min="0.001" max="0.3" step="0.001" value="${CAMERA_EFFECTS_CONFIG.BOB.SPRINT_AMP_X}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>SPRINT AMP ROLL (Tilt):</span>
                                <span id="val-bob-sprint-amp-roll" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.BOB.SPRINT_AMP_ROLL.toFixed(4)}</span>
                            </span>
                            <input type="range" id="slide-bob-sprint-amp-roll" min="0.001" max="0.1" step="0.001" value="${CAMERA_EFFECTS_CONFIG.BOB.SPRINT_AMP_ROLL}" style="width: 100%;">
                        </label>
                    </div>

                    <!-- General Bob Tuning -->
                    <div style="background: #111; padding: 10px; border: 1px solid #333; border-radius: 4px;">
                        <h3 style="color: #0ff; margin-top: 0; border-bottom: 1px solid #222; padding-bottom: 5px;">GENERAL BOB / TILT</h3>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>ADS REDUCTION FACTOR:</span>
                                <span id="val-bob-ads-reduc" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.BOB.ADS_REDUCTION.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-bob-ads-reduc" min="0.0" max="1.0" step="0.05" value="${CAMERA_EFFECTS_CONFIG.BOB.ADS_REDUCTION}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>SMOOTHING RATE:</span>
                                <span id="val-bob-smoothing" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.BOB.SMOOTHING_RATE.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-bob-smoothing" min="1.0" max="20.0" step="0.5" value="${CAMERA_EFFECTS_CONFIG.BOB.SMOOTHING_RATE}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>RUN TILT STRENGTH:</span>
                                <span id="val-tilt-strength" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.TILT.RUN_TILT_STRENGTH.toFixed(3)}</span>
                            </span>
                            <input type="range" id="slide-tilt-strength" min="0.001" max="0.5" step="0.005" value="${CAMERA_EFFECTS_CONFIG.TILT.RUN_TILT_STRENGTH}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>RUN TILT SPRING:</span>
                                <span id="val-tilt-spring" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.TILT.RUN_TILT_SPRING.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-tilt-spring" min="1.0" max="20.0" step="0.5" value="${CAMERA_EFFECTS_CONFIG.TILT.RUN_TILT_SPRING}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>MAX ROLL (RAD):</span>
                                <span id="val-tilt-max-roll" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.TILT.MAX_ROLL.toFixed(3)}</span>
                            </span>
                            <input type="range" id="slide-tilt-max-roll" min="0.01" max="0.5" step="0.01" value="${CAMERA_EFFECTS_CONFIG.TILT.MAX_ROLL}" style="width: 100%;">
                        </label>
                    </div>

                    <!-- Pull Back & FOV Stretch & Landing -->
                    <div style="background: #111; padding: 10px; border: 1px solid #333; border-radius: 4px;">
                        <h3 style="color: #0ff; margin-top: 0; border-bottom: 1px solid #222; padding-bottom: 5px;">PULLBACK / FOV / IMPACT</h3>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>MAX PULL BACK Z:</span>
                                <span id="val-pullback-max" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.PULL_BACK.MAX_PULL_BACK_Z.toFixed(3)}</span>
                            </span>
                            <input type="range" id="slide-pullback-max" min="0.0" max="0.5" step="0.01" value="${CAMERA_EFFECTS_CONFIG.PULL_BACK.MAX_PULL_BACK_Z}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>PULLBACK CHARGE SPEED:</span>
                                <span id="val-pullback-charge" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.PULL_BACK.CHARGE_SPEED.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-pullback-charge" min="0.1" max="10.0" step="0.1" value="${CAMERA_EFFECTS_CONFIG.PULL_BACK.CHARGE_SPEED}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>PULLBACK DECAY SPEED:</span>
                                <span id="val-pullback-decay" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.PULL_BACK.DECAY_SPEED.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-pullback-decay" min="0.1" max="10.0" step="0.1" value="${CAMERA_EFFECTS_CONFIG.PULL_BACK.DECAY_SPEED}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>MAX FOV STRETCH:</span>
                                <span id="val-fov-max" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.FOV_STRETCH.MAX_STRETCH.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-fov-max" min="0.0" max="25.0" step="0.5" value="${CAMERA_EFFECTS_CONFIG.FOV_STRETCH.MAX_STRETCH}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>FOV CHARGE SPEED:</span>
                                <span id="val-fov-charge" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.FOV_STRETCH.CHARGE_SPEED.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-fov-charge" min="0.1" max="10.0" step="0.1" value="${CAMERA_EFFECTS_CONFIG.FOV_STRETCH.CHARGE_SPEED}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>FOV DECAY SPEED:</span>
                                <span id="val-fov-decay" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.FOV_STRETCH.DECAY_SPEED.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-fov-decay" min="0.1" max="10.0" step="0.1" value="${CAMERA_EFFECTS_CONFIG.FOV_STRETCH.DECAY_SPEED}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>LANDING JOLT FORCE:</span>
                                <span id="val-landing-force" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.LANDING.FORCE.toFixed(3)}</span>
                            </span>
                            <input type="range" id="slide-landing-force" min="0.01" max="0.5" step="0.01" value="${CAMERA_EFFECTS_CONFIG.LANDING.FORCE}" style="width: 100%;">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px;">
                            <span style="display: flex; justify-content: space-between;">
                                <span>LANDING JOLT DECAY:</span>
                                <span id="val-landing-decay" style="color: #0f0; font-weight: bold;">${CAMERA_EFFECTS_CONFIG.LANDING.DECAY.toFixed(2)}</span>
                            </span>
                            <input type="range" id="slide-landing-decay" min="1.0" max="20.0" step="0.5" value="${CAMERA_EFFECTS_CONFIG.LANDING.DECAY}" style="width: 100%;">
                        </label>
                    </div>
                </div>

                <button id="dev-export-camfx" style="padding: 10px 20px; background: #0f0; color: black; font-weight: bold; border: none; cursor: pointer; border-radius: 4px; font-family: monospace;">EXPORT CONFIG (JSON)</button>
            </div>
        `;

        const bindCamSlider = (id: string, updateFn: (v: number) => void) => {
            const input = document.getElementById(`slide-${id}`) as HTMLInputElement;
            const val = document.getElementById(`val-${id}`);
            if (input && val) {
                input.addEventListener('input', (e) => {
                    const v = parseFloat((e.target as HTMLInputElement).value);
                    const decimals = input.step.includes('0.001') ? 4 : input.step.includes('0.01') ? 3 : 2;
                    val.innerText = v.toFixed(decimals);
                    updateFn(v);
                });
            }
        };

        bindCamSlider('movement-accel', (v) => { (CAMERA_EFFECTS_CONFIG.MOVEMENT as any).RUN_ACCEL_RATE = v; });
        bindCamSlider('movement-decel', (v) => { (CAMERA_EFFECTS_CONFIG.MOVEMENT as any).RUN_DECEL_RATE = v; });
        
        bindCamSlider('follow-base', (v) => { (CAMERA_EFFECTS_CONFIG.WEAPON_FOLLOW as any).BASE_SPEED = v; });
        bindCamSlider('follow-lag', (v) => { (CAMERA_EFFECTS_CONFIG.WEAPON_FOLLOW as any).LAG_FACTOR = v; });
        bindCamSlider('follow-min', (v) => { (CAMERA_EFFECTS_CONFIG.WEAPON_FOLLOW as any).MIN_FOLLOW_SPEED_MULT = v; });
        
        bindCamSlider('bob-walk-freq', (v) => { (CAMERA_EFFECTS_CONFIG.BOB as any).WALK_FREQ = v; });
        bindCamSlider('bob-walk-amp-y', (v) => { (CAMERA_EFFECTS_CONFIG.BOB as any).WALK_AMP_Y = v; });
        bindCamSlider('bob-walk-amp-x', (v) => { (CAMERA_EFFECTS_CONFIG.BOB as any).WALK_AMP_X = v; });
        bindCamSlider('bob-walk-amp-roll', (v) => { (CAMERA_EFFECTS_CONFIG.BOB as any).WALK_AMP_ROLL = v; });
        
        bindCamSlider('bob-sprint-freq', (v) => { (CAMERA_EFFECTS_CONFIG.BOB as any).SPRINT_FREQ = v; });
        bindCamSlider('bob-sprint-amp-y', (v) => { (CAMERA_EFFECTS_CONFIG.BOB as any).SPRINT_AMP_Y = v; });
        bindCamSlider('bob-sprint-amp-x', (v) => { (CAMERA_EFFECTS_CONFIG.BOB as any).SPRINT_AMP_X = v; });
        bindCamSlider('bob-sprint-amp-roll', (v) => { (CAMERA_EFFECTS_CONFIG.BOB as any).SPRINT_AMP_ROLL = v; });
        
        bindCamSlider('bob-ads-reduc', (v) => { (CAMERA_EFFECTS_CONFIG.BOB as any).ADS_REDUCTION = v; });
        bindCamSlider('bob-smoothing', (v) => { (CAMERA_EFFECTS_CONFIG.BOB as any).SMOOTHING_RATE = v; });
        
        bindCamSlider('tilt-strength', (v) => { (CAMERA_EFFECTS_CONFIG.TILT as any).RUN_TILT_STRENGTH = v; });
        bindCamSlider('tilt-spring', (v) => { (CAMERA_EFFECTS_CONFIG.TILT as any).RUN_TILT_SPRING = v; });
        bindCamSlider('tilt-max-roll', (v) => { (CAMERA_EFFECTS_CONFIG.TILT as any).MAX_ROLL = v; });
        
        bindCamSlider('pullback-max', (v) => { (CAMERA_EFFECTS_CONFIG.PULL_BACK as any).MAX_PULL_BACK_Z = v; });
        bindCamSlider('pullback-charge', (v) => { (CAMERA_EFFECTS_CONFIG.PULL_BACK as any).CHARGE_SPEED = v; });
        bindCamSlider('pullback-decay', (v) => { (CAMERA_EFFECTS_CONFIG.PULL_BACK as any).DECAY_SPEED = v; });
        
        bindCamSlider('fov-max', (v) => { (CAMERA_EFFECTS_CONFIG.FOV_STRETCH as any).MAX_STRETCH = v; });
        bindCamSlider('fov-charge', (v) => { (CAMERA_EFFECTS_CONFIG.FOV_STRETCH as any).CHARGE_SPEED = v; });
        bindCamSlider('fov-decay', (v) => { (CAMERA_EFFECTS_CONFIG.FOV_STRETCH as any).DECAY_SPEED = v; });
        
        bindCamSlider('landing-force', (v) => { (CAMERA_EFFECTS_CONFIG.LANDING as any).FORCE = v; });
        bindCamSlider('landing-decay', (v) => { (CAMERA_EFFECTS_CONFIG.LANDING as any).DECAY = v; });

        const expBtn = document.getElementById('dev-export-camfx');
        if (expBtn) {
            expBtn.addEventListener('click', () => {
                const out = JSON.stringify(CAMERA_EFFECTS_CONFIG, null, 2);
                navigator.clipboard.writeText(out).then(() => {
                    const old = expBtn.innerText;
                    expBtn.innerText = "COPIED TO CLIPBOARD!";
                    setTimeout(() => expBtn.innerText = old, 1500);
                });
            });
        }
    }
    else if (activePanel === "CHEATS") {
        c.innerHTML = `
            <h2 style="color:#0f0; margin-top:0;">DEVELOPER CHEAT SUITE</h2>
            
            <!-- Real-Time Telemetry HUD -->
            <div id="dev-cheats-hud"></div>

            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:20px; margin-bottom:20px;">
                <!-- Column 1: Cheats & Modifiers -->
                <div style="background:#1a1a1a; padding:15px; border-radius:5px; border:1px solid #333; display:flex; flex-direction:column; gap:10px;">
                    <h3 style="margin:0; color:#0ff; border-bottom:1px solid #333; padding-bottom:5px;">State Overrides</h3>
                    
                    <button id="cheat-toggle-fly" style="padding:10px; font-weight:bold; cursor:pointer; text-align:left; border:1px solid #333; border-radius:4px; font-family:monospace; background:${GlobalState.isFlying ? '#0f0; color:black;' : '#222; color:white;'}">
                        FLY MODE (NOCLIP): <span style="float:right;">${GlobalState.isFlying ? 'ON' : 'OFF'}</span>
                    </button>
                    
                    <button id="cheat-toggle-god" style="padding:10px; font-weight:bold; cursor:pointer; text-align:left; border:1px solid #333; border-radius:4px; font-family:monospace; background:${GlobalState.godMode ? '#0f0; color:black;' : '#222; color:white;'}">
                        GOD MODE (INVINCIBLE): <span style="float:right;">${GlobalState.godMode ? 'ON' : 'OFF'}</span>
                    </button>

                    <button id="cheat-toggle-ammo" style="padding:10px; font-weight:bold; cursor:pointer; text-align:left; border:1px solid #333; border-radius:4px; font-family:monospace; background:${GlobalState.infiniteAmmo ? '#0f0; color:black;' : '#222; color:white;'}">
                        INFINITE AMMO: <span style="float:right;">${GlobalState.infiniteAmmo ? 'ON' : 'OFF'}</span>
                    </button>

                    <h3 style="margin:10px 0 0 0; color:#0ff; border-bottom:1px solid #333; padding-bottom:5px;">Speed Manipulation</h3>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <label style="flex:1; font-family:monospace;">
                            Multiplier: <span id="cheat-speed-val" style="color:white; font-weight:bold;">${GlobalState.speedMultiplier.toFixed(1)}x</span>
                            <input type="range" id="cheat-speed-slider" min="0.5" max="10" step="0.5" value="${GlobalState.speedMultiplier}" style="width:100%; margin-top:5px; cursor:pointer;">
                        </label>
                        <button id="cheat-speed-reset" style="padding:5px 10px; background:#444; color:white; border:none; cursor:pointer; border-radius:4px; margin-top:15px; font-family:monospace;">Reset</button>
                    </div>

                    <h3 style="margin:10px 0 0 0; color:#0ff; border-bottom:1px solid #333; padding-bottom:5px;">Health Overrides</h3>
                    <div style="display:flex; gap:10px; align-items:center; font-family:monospace;">
                        <input type="number" id="cheat-hp-input" value="100" style="width:70px; padding:6px; background:#222; color:white; border:1px solid #444; border-radius:4px;">
                        <button id="cheat-hp-set" style="flex:1; padding:6px; background:#0ff; color:black; font-weight:bold; border:none; cursor:pointer; border-radius:4px;">SET HP</button>
                        <button id="cheat-hp-max" style="padding:6px; background:#333; color:white; border:1px solid #444; cursor:pointer; border-radius:4px;">Max HP</button>
                    </div>
                </div>

                <!-- Column 2: Teleport Waypoints -->
                <div style="background:#1a1a1a; padding:15px; border-radius:5px; border:1px solid #333; display:flex; flex-direction:column; gap:10px;">
                    <h3 style="margin:0; color:#0ff; border-bottom:1px solid #333; padding-bottom:5px;">Landmark Presets</h3>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <button class="cheat-tp-preset" data-x="0" data-y="1.2" data-z="0" style="padding:8px; background:#222; color:white; border:1px solid #333; cursor:pointer; border-radius:4px; text-align:center; font-size:11px; font-family:monospace;">Bridge Core</button>
                        <button class="cheat-tp-preset" data-x="35" data-y="1.2" data-z="50" style="padding:8px; background:#222; color:white; border:1px solid #333; cursor:pointer; border-radius:4px; text-align:center; font-size:11px; font-family:monospace;">Warehouse</button>
                        <button class="cheat-tp-preset" data-x="-40" data-y="1.2" data-z="-100" style="padding:8px; background:#222; color:white; border:1px solid #333; cursor:pointer; border-radius:4px; text-align:center; font-size:11px; font-family:monospace;">Facility Gate</button>
                        <button class="cheat-tp-preset" data-x="15" data-y="5" data-z="45" style="padding:8px; background:#222; color:white; border:1px solid #333; cursor:pointer; border-radius:4px; text-align:center; font-size:11px; font-family:monospace;">Elevated Bridge</button>
                        <button class="cheat-tp-preset" data-x="-80" data-y="1.2" data-z="80" style="padding:8px; background:#222; color:white; border:1px solid #333; cursor:pointer; border-radius:4px; text-align:center; font-size:11px; font-family:monospace;">Storage Vault</button>
                        <button class="cheat-tp-preset" data-x="110" data-y="1.2" data-z="-120" style="padding:8px; background:#222; color:white; border:1px solid #333; cursor:pointer; border-radius:4px; text-align:center; font-size:11px; font-family:monospace;">Loading Dock B</button>
                    </div>

                    <h3 style="margin:10px 0 0 0; color:#0ff; border-bottom:1px solid #333; padding-bottom:5px;">Custom Coordinates</h3>
                    <div style="display:flex; flex-direction:column; gap:8px; font-family:monospace;">
                        <div style="display:flex; gap:5px;">
                            <label style="flex:1;">X: <input type="number" id="cheat-tp-x" value="0" step="1" style="width:100%; padding:5px; background:#222; color:white; border:1px solid #444; border-radius:4px; font-family:monospace;"></label>
                            <label style="flex:1;">Y: <input type="number" id="cheat-tp-y" value="1.2" step="1" style="width:100%; padding:5px; background:#222; color:white; border:1px solid #444; border-radius:4px; font-family:monospace;"></label>
                            <label style="flex:1;">Z: <input type="number" id="cheat-tp-z" value="0" step="1" style="width:100%; padding:5px; background:#222; color:white; border:1px solid #444; border-radius:4px; font-family:monospace;"></label>
                        </div>
                        <button id="cheat-tp-custom" style="padding:8px; background:#f0f; color:white; font-weight:bold; border:none; cursor:pointer; border-radius:4px; width:100%;">TELEPORT</button>
                    </div>

                    <h3 style="margin:10px 0 0 0; color:#f33; border-bottom:1px solid #522; padding-bottom:5px;">Tactical Operations</h3>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <button id="cheat-nuke-drones" style="padding:8px; background:#a00; color:white; font-weight:bold; border:none; cursor:pointer; border-radius:4px; width:100%; font-family:monospace;">NUKE ALL DRONES</button>
                        <button id="cheat-kill-self" style="padding:8px; background:#c50; color:white; font-weight:bold; border:none; cursor:pointer; border-radius:4px; width:100%; font-family:monospace;">KILL SELF (TEST RESPAWN)</button>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:5px;">
                            <button id="cheat-force-win" style="padding:8px; background:#0a0; color:white; font-weight:bold; border:none; cursor:pointer; border-radius:4px; font-size:10px; font-family:monospace;">FORCE PLAYER WIN</button>
                            <button id="cheat-force-loss" style="padding:8px; background:#a0a; color:white; font-weight:bold; border:none; cursor:pointer; border-radius:4px; font-size:10px; font-family:monospace;">FORCE LLM WIN</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        updateCheatsHUD();

        const flyBtn = document.getElementById("cheat-toggle-fly");
        if (flyBtn) {
            flyBtn.onclick = () => {
                GlobalState.isFlying = !GlobalState.isFlying;
                flyBtn.style.background = GlobalState.isFlying ? '#0f0' : '#222';
                flyBtn.style.color = GlobalState.isFlying ? 'black' : 'white';
                flyBtn.innerHTML = `FLY MODE (NOCLIP): <span style="float:right;">${GlobalState.isFlying ? 'ON' : 'OFF'}</span>`;
            };
        }

        const godBtn = document.getElementById("cheat-toggle-god");
        if (godBtn) {
            godBtn.onclick = () => {
                GlobalState.godMode = !GlobalState.godMode;
                godBtn.style.background = GlobalState.godMode ? '#0f0' : '#222';
                godBtn.style.color = GlobalState.godMode ? 'black' : 'white';
                godBtn.innerHTML = `GOD MODE (INVINCIBLE): <span style="float:right;">${GlobalState.godMode ? 'ON' : 'OFF'}</span>`;
                if (activeChannel) {
                    activeChannel.emit("dev_toggle_god_mode", { godMode: GlobalState.godMode });
                }
            };
        }

        const ammoBtn = document.getElementById("cheat-toggle-ammo");
        if (ammoBtn) {
            ammoBtn.onclick = () => {
                GlobalState.infiniteAmmo = !GlobalState.infiniteAmmo;
                ammoBtn.style.background = GlobalState.infiniteAmmo ? '#0f0' : '#222';
                ammoBtn.style.color = GlobalState.infiniteAmmo ? 'black' : 'white';
                ammoBtn.innerHTML = `INFINITE AMMO: <span style="float:right;">${GlobalState.infiniteAmmo ? 'ON' : 'OFF'}</span>`;
                if (activeChannel) {
                    activeChannel.emit("dev_toggle_infinite_ammo", { infiniteAmmo: GlobalState.infiniteAmmo });
                }
            };
        }

        const speedSlider = document.getElementById("cheat-speed-slider") as HTMLInputElement;
        const speedVal = document.getElementById("cheat-speed-val");
        if (speedSlider && speedVal) {
            speedSlider.oninput = (e) => {
                const v = parseFloat((e.target as HTMLInputElement).value);
                GlobalState.speedMultiplier = v;
                speedVal.innerText = `${v.toFixed(1)}x`;
            };
        }

        const speedReset = document.getElementById("cheat-speed-reset");
        if (speedReset && speedSlider && speedVal) {
            speedReset.onclick = () => {
                GlobalState.speedMultiplier = 1.0;
                speedSlider.value = "1.0";
                speedVal.innerText = "1.0x";
            };
        }

        const hpInput = document.getElementById("cheat-hp-input") as HTMLInputElement;
        const hpSet = document.getElementById("cheat-hp-set");
        if (hpInput && hpSet) {
            hpSet.onclick = () => {
                const hp = parseInt(hpInput.value, 10);
                if (!isNaN(hp) && activeChannel) {
                    activeChannel.emit("dev_set_hp", { hp });
                }
            };
        }

        const hpMax = document.getElementById("cheat-hp-max");
        if (hpMax && hpInput) {
            hpMax.onclick = () => {
                hpInput.value = "9999";
                if (activeChannel) {
                    activeChannel.emit("dev_set_hp", { hp: 9999 });
                }
            };
        }

        const presets = c.querySelectorAll(".cheat-tp-preset");
        presets.forEach(p => {
            p.addEventListener("click", (e) => {
                const target = e.currentTarget as HTMLElement;
                const tx = parseFloat(target.getAttribute("data-x") || "0");
                const ty = parseFloat(target.getAttribute("data-y") || "1.2");
                const tz = parseFloat(target.getAttribute("data-z") || "0");

                const pPos = (window as any).playerPos;
                if (pPos) {
                    pPos.set(tx, ty, tz);
                }

                if ((window as any)._physicsWorker) {
                    (window as any)._physicsWorker.postMessage({ type: "CORRECT_POS", pos: { x: tx, y: ty, z: tz } });
                }

                if (activeChannel) {
                    activeChannel.emit("dev_set_position", { position: { x: tx, y: ty, z: tz } });
                }
            });
        });

        const tpX = document.getElementById("cheat-tp-x") as HTMLInputElement;
        const tpY = document.getElementById("cheat-tp-y") as HTMLInputElement;
        const tpZ = document.getElementById("cheat-tp-z") as HTMLInputElement;
        const tpBtn = document.getElementById("cheat-tp-custom");

        if (tpX && tpY && tpZ && tpBtn) {
            tpBtn.onclick = () => {
                const tx = parseFloat(tpX.value);
                const ty = parseFloat(tpY.value);
                const tz = parseFloat(tpZ.value);

                if (!isNaN(tx) && !isNaN(ty) && !isNaN(tz)) {
                    const pPos = (window as any).playerPos;
                    if (pPos) {
                        pPos.set(tx, ty, tz);
                    }

                    if ((window as any)._physicsWorker) {
                        (window as any)._physicsWorker.postMessage({ type: "CORRECT_POS", pos: { x: tx, y: ty, z: tz } });
                    }

                    if (activeChannel) {
                        activeChannel.emit("dev_set_position", { position: { x: tx, y: ty, z: tz } });
                    }
                }
            };
        }

        const nukeBtn = document.getElementById("cheat-nuke-drones");
        if (nukeBtn) {
            nukeBtn.onclick = () => {
                if (activeChannel) {
                    activeChannel.emit("dev_nuke_drones", {});
                }
                if (getMatch()?.droneJitterMap) {
                    getMatch()?.droneJitterMap.clear();
                }
            };
        }

        const killSelfBtn = document.getElementById("cheat-kill-self");
        if (killSelfBtn) {
            killSelfBtn.onclick = () => {
                if (activeChannel) {
                    activeChannel.emit("dev_set_hp", { hp: 0 });
                }
            };
        }

        const forceWinBtn = document.getElementById("cheat-force-win");
        if (forceWinBtn) {
            forceWinBtn.onclick = () => {
                if (activeChannel) {
                    activeChannel.emit("dev_force_match_end", { result: "win" });
                }
            };
        }

        const forceLossBtn = document.getElementById("cheat-force-loss");
        if (forceLossBtn) {
            forceLossBtn.onclick = () => {
                if (activeChannel) {
                    activeChannel.emit("dev_force_match_end", { result: "loss" });
                }
            };
        }
    }
    else if (activePanel === "CONSOLE") c.innerHTML = "<div id='dev-console' style='white-space:pre-wrap;overflow-y:auto;height:100%;'></div>";
    else if (activePanel === "LLM FEED") c.innerHTML = "<div id='dev-llm' style='white-space:pre-wrap;overflow-y:auto;height:100%;'></div>";
    else if (activePanel === "PERF") c.innerHTML = "<div id='dev-perf' style='white-space:pre-wrap;overflow-y:auto;height:100%;'></div>";
    else if (activePanel === "NETWORK") {
        c.innerHTML = "<div id='dev-network' style='white-space:pre-wrap;overflow-y:auto;height:100%;'></div>";
        updateNetworkHUD();
    }
    else if (activePanel === "AI NAV") {
        c.innerHTML = `
            <div style="display:flex; flex-direction:column; height:100%; position:relative;">
                <div id="ai-nav-controls" style="padding: 5px; background: #222; display: flex; gap: 10px;">
                    <button id="dev-nav-reset" style="padding: 5px; cursor: pointer; font-family:monospace;">Reset View</button>
                    <span style="color:#0f0; padding-top:5px;">Legend: <span style="color:#00AAFF">AIR</span> | <span style="color:#FF8800">GROUND</span> | <span style="color:#FFFF00">RECON</span></span>
                </div>
                <div style="flex:1; position: relative; overflow:hidden;">
                    <canvas id='dev-canvas' width='600' height='600' style='border:1px solid #0f0;width:100%;height:100%;object-fit:contain;touch-action:none;'></canvas>
                    <div id="dev-nav-inspector" style="display:none; position:absolute; top:10px; right:10px; width:220px; background:rgba(0,0,0,0.9); border:1px solid #0ff; color:white; padding:10px; font-family:monospace; font-size:10px; pointer-events:auto;"></div>
                    <div id="dev-nav-outlier" style="position:absolute; bottom:10px; left:10px; width:250px; background:rgba(0,0,0,0.8); border:1px solid #ff8800; color:white; padding:10px; font-family:monospace; font-size:10px; pointer-events:none;"></div>
                </div>
            </div>
        `;
        setupNavEvents();
    }
    else if (activePanel === "VIS DIAG") {
        c.innerHTML = (window as any).getVisualDiagnosisHTML ? (window as any).getVisualDiagnosisHTML() : "Loading...";
    }
    else if (activePanel === "ZONES") {
        c.innerHTML = "<div id='dev-zones' style='white-space:pre-wrap;overflow-y:auto;height:100%; padding:10px;'></div>";
    }
    else if (activePanel === "COLLISIONS") {
        c.innerHTML = `
            <div style="display:flex; flex-direction:column; height:100%;">
                <div style="padding:10px; background:#111; border-bottom:1px solid #333;">
                    <div id="dev-collision-telemetry" style="font-family:monospace; font-size:12px; line-height:1.4; color:#34d399; background:#000; padding:8px; border:1px solid #222; border-radius:4px;">
                        Awaiting telemetry from server...
                    </div>
                </div>
                <div style="padding:10px; background:#222; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:bold; color:#f87171;">[OVERLAP LOG]</span>
                    <button id="dev-clear-collisions" style="padding:4px 8px; background:#b91c1c; border:1px solid #ef4444; color:white; font-weight:bold; cursor:pointer; border-radius:4px;">CLEAR LOG</button>
                </div>
                <div id="dev-collisions" style="white-space:pre-wrap; overflow-y:auto; flex:1; padding:10px; font-family:monospace; font-size:11px; line-height:1.5; background:#000; color:#34d399;">No overlap detected yet. Active server-side geometric scans are running...</div>
            </div>
        `;
        const clearBtn = document.getElementById("dev-clear-collisions");
        if (clearBtn) {
            clearBtn.onclick = () => {
                (window as any).collisionLogs = [];
                const logEl = document.getElementById("dev-collisions");
                if (logEl) logEl.innerText = "Cleared. Awaiting new overlap signals from server ticks...";
            };
        }
        updateCollisionsHUD();
    }

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
        } else if (activePanel === "VIS DIAG") {
            content = "VIS DIAG TAB - CONTROLS & DIAGNOSTICS";
        }
        else if (activePanel === "ZONES") {
            content = document.getElementById("dev-zones")?.innerText || "";
        }
        else if (activePanel === "COLLISIONS") {
            content = document.getElementById("dev-collisions")?.innerText || "";
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
            if (getMatch()?.droneJitterMap) {
                for (const [id, buffer] of getMatch()?.droneJitterMap?.entries()) {
                    if (buffer.count > 0) {
                        const head = buffer.states[(buffer.head - 1 + 3) % 3];
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

(window as any).inspectZone = (zoneName: string) => {
    activePanel = "AI NAV";
    const bound = ZONE_BOUNDS[zoneName as any];
    if (bound) {
        const canvasW = 600;
        const canvasH = 600;
        navZoom = 1.5;
        const scale = (canvasW / 300) * navZoom;
        const offX = 150;
        const offZ = 150;
        const worldScaledX = (bound.center.x + offX) * scale;
        const worldScaledZ = (bound.center.z + offZ) * scale;
        
        navPanX = canvasW / 2 - worldScaledX;
        navPanY = canvasH / 2 - worldScaledZ;
        lastInspectedZoneId = zoneName;
    }
    renderPanel();
};

function setupNavEvents() {
    const canvas = document.getElementById("dev-canvas") as HTMLCanvasElement;
    const resetBtn = document.getElementById("dev-nav-reset");
    if (resetBtn) {
        resetBtn.onclick = () => {
            navPanX = 0; navPanY = 0; navZoom = 1;
            if (navPanZoomInstance) {
                navPanZoomInstance.reset(1.0, 0, 0);
            }
        };
    }
    if (canvas) {
        if (navPanZoomInstance) {
            navPanZoomInstance.destroy();
            navPanZoomInstance = null;
        }

        navPanZoomInstance = new PanZoomSurface(canvas, {
            initialZoom: navZoom,
            initialPanX: navPanX,
            initialPanY: navPanY,
            minZoom: 0.5,
            maxZoom: 3.0,
            onChange: (z, px, py) => {
                navZoom = z;
                navPanX = px;
                navPanY = py;
            }
        });

        let downX = 0;
        let downY = 0;
        let downTime = 0;

        canvas.addEventListener("pointerdown", (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            downX = e.clientX;
            downY = e.clientY;
            downTime = performance.now();
        });

        canvas.addEventListener("pointerup", (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            const dx = e.clientX - downX;
            const dy = e.clientY - downY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const duration = performance.now() - downTime;

            if (dist < 5 && duration < 300) { // small move, quick click/tap
                const rect = canvas.getBoundingClientRect();
                const cx = e.clientX - rect.left;
                const cy = e.clientY - rect.top;
                
                const scale = (canvas.width / 300) * navZoom;
                const offX = 150;
                const offZ = 150;
                const worldX = (cx - navPanX) / scale - offX;
                const worldZ = (cy - navPanY) / scale - offZ;
                
                let clickedDrone = null;
                if (getMatch()?.droneJitterMap) {
                    for (const [id, buffer] of getMatch()?.droneJitterMap?.entries()) {
                        if (buffer.count > 0) {
                            const head = buffer.states[(buffer.head - 1 + 3) % 3];
                            if (head.state === 5) continue;
                            const dx = head.posX - worldX;
                            const dz = head.posZ - worldZ;
                            if (dx*dx + dz*dz < 64) { // generous click radius
                                clickedDrone = id;
                                break;
                            }
                        }
                    }
                }
                if (clickedDrone !== null) {
                    selectedNavDroneId = clickedDrone;
                    
                    // Determine which zone it is in physically
                    lastInspectedZoneId = null;
                    if (getMatch()?.droneJitterMap && getMatch()?.droneJitterMap.has(clickedDrone)) {
                        const buffer = getMatch()?.droneJitterMap.get(clickedDrone)!;
                        if (buffer.count > 0) {
                            const head = buffer.states[(buffer.head - 1 + 3) % 3];
                            for (const [zoneName, bound] of Object.entries(ZONE_BOUNDS)) {
                                if (Math.abs(head.posX - bound.center.x) <= bound.halfSize.x && 
                                    Math.abs(head.posZ - bound.center.z) <= bound.halfSize.z) {
                                    lastInspectedZoneId = zoneName;
                                    break;
                                }
                            }
                        }
                    }

                    const inspector = document.getElementById("dev-nav-inspector");
                    if (inspector) inspector.style.display = "block";
                } else {
                    const inspector = document.getElementById("dev-nav-inspector");
                    if (inspector) inspector.style.display = "none";
                    selectedNavDroneId = null;
                }
            }
        });
    }
}

function drawAINav() {
    const canvas = document.getElementById("dev-canvas") as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "rgba(0,50,0,1)";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.save();
    ctx.translate(navPanX, navPanY);

    const scale = (canvas.width / 300) * navZoom;
    const offX = 150;
    const offZ = 150;

    // Draw Zones
    ctx.lineWidth = 2;
    for (const [zoneName, bound] of Object.entries(ZONE_BOUNDS)) {
        const cx = (bound.center.x + offX) * scale;
        const cz = (bound.center.z + offZ) * scale;
        const width = (bound.halfSize.x * 2) * scale;
        const height = (bound.halfSize.z * 2) * scale;
        
        ctx.strokeStyle = (zoneName === lastInspectedZoneId) ? "rgba(255, 255, 0, 0.8)" : "rgba(0, 255, 0, 0.3)";
        ctx.strokeRect(cx - width/2, cz - height/2, width, height);
        
        ctx.fillStyle = (zoneName === lastInspectedZoneId) ? "rgba(255, 255, 0, 0.8)" : "rgba(0, 255, 0, 0.5)";
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

    let activeDroneCount = 0;
    let stuckCount = 0;
    const now = performance.now();

    if (getMatch()?.droneJitterMap) {
        for (const [id, buffer] of getMatch()?.droneJitterMap?.entries()) {
            if (buffer.count > 0) {
                const head = buffer.states[(buffer.head - 1 + 3) % 3];
                if (head.state === 5) continue; // DEAD
                activeDroneCount++;

                // Trail Buffer Logic
                if (!navDroneTrailBuffers.has(id)) navDroneTrailBuffers.set(id, []);
                const trail = navDroneTrailBuffers.get(id)!;
                if (trail.length === 0 || trail[trail.length - 1].x !== head.posX || trail[trail.length - 1].z !== head.posZ) {
                    trail.push({x: head.posX, z: head.posZ});
                    if (trail.length > 20) trail.shift();
                }

                // Stuck FSM Logic
                if (!navDroneStateTimers.has(id)) navDroneStateTimers.set(id, {state: head.state, time: now});
                const stateTimer = navDroneStateTimers.get(id)!;
                if (stateTimer.state !== head.state) {
                    stateTimer.state = head.state;
                    stateTimer.time = now;
                } else if (now - stateTimer.time > 10000) {
                    stuckCount++;
                }

                let color = "white";
                if (head.type === 0 || head.type === 1 || head.type === 3) color = "#00AAFF"; // AIR
                else if (head.type === 4 || head.type === 5 || head.type === 6) color = "#FF8800"; // GROUND
                else if (head.type === 2) color = "#FFFF00"; // RECON
                
                let stateName = "IDLE";
                if (head.state === 1) stateName = "PATROL";
                if (head.state === 2) stateName = "PURSUIT";
                if (head.state === 3) stateName = "ATTACK";
                if (head.state === 4) stateName = "REPOS";

                // Draw Trail
                if (trail.length > 1) {
                    ctx.beginPath();
                    for (let i = 0; i < trail.length; i++) {
                        const tx = (trail[i].x + offX) * scale;
                        const tz = (trail[i].z + offZ) * scale;
                        if (i === 0) ctx.moveTo(tx, tz);
                        else ctx.lineTo(tx, tz);
                    }
                    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
                    ctx.stroke();
                }

                const cx = (head.posX + offX) * scale;
                const cz = (head.posZ + offZ) * scale;
                
                // Drone Dot
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(cx, cz, 4, 0, Math.PI*2);
                ctx.fill();
                
                // FSM Label adjacent to dot
                ctx.fillStyle = "white";
                ctx.fillText(`${id} (${stateName})`, cx+6, cz);
                
                // Highlight if inside lastInspectedZoneId
                if (lastInspectedZoneId && ZONE_BOUNDS[lastInspectedZoneId as any]) {
                    const b = ZONE_BOUNDS[lastInspectedZoneId as any];
                    if (Math.abs(head.posX - b.center.x) <= b.halfSize.x && Math.abs(head.posZ - b.center.z) <= b.halfSize.z) {
                        ctx.strokeStyle = "rgba(255, 255, 0, 0.8)";
                        ctx.beginPath();
                        ctx.arc(cx, cz, 6, 0, Math.PI*2);
                        ctx.stroke();
                    }
                }

                // Highlight if selected
                if (id === selectedNavDroneId) {
                    ctx.strokeStyle = "magenta";
                    ctx.beginPath();
                    ctx.arc(cx, cz, 8, 0, Math.PI*2);
                    ctx.stroke();

                    // Update inspector
                    const inspector = document.getElementById("dev-nav-inspector");
                    if (inspector) {
                        const distDiff = (head as any).clientPosX !== undefined ? Math.sqrt(
                            Math.pow(head.posX - (head as any).clientPosX, 2) + Math.pow(head.posZ - (head as any).clientPosZ, 2)
                        ).toFixed(3) : 'N/A';

                        const memoryList = (head as any).memory ? ((head as any).memory.length > 0 ? (head as any).memory.map((m: any) => `[Player ${m.id}] Pos:(${m.x.toFixed(1)}, ${m.y.toFixed(1)}, ${m.z.toFixed(1)}) Conf:${m.conf.toFixed(2)}`).join("<br/>") : "None") : "None";
                        inspector.innerHTML = `
                            <b>DRONE INSPECTOR</b><br/>
                            ID: ${id}<br/>
                            TYPE: ${head.type}<br/>
                            MODE: ${(head as any).mode || 'NORMAL'}<br/>
                            TASK: ${stateName}<br/>
                            SERVER POS: <br/> X: ${head.posX.toFixed(2)}, Z: ${head.posZ.toFixed(2)}<br/>
                            CLIENT POS: <br/> X: ${((head as any).clientPosX ?? 0).toFixed(2)}, Z: ${((head as any).clientPosZ ?? 0).toFixed(2)}<br/>
                            DIVERGENCE: ${distDiff}<br/>
                            GROUP ID: ${(head as any).groupId || 'None'}<br/>
                            TARGET POS (Server): <br/> X: ${((head as any).targetX ?? 0).toFixed(2)}, Z: ${((head as any).targetZ ?? 0).toFixed(2)}<br/>
                            <hr style="border:1px solid #444"/>
                            <b>YUKA MEMORY</b><br/>
                            ${memoryList}<br/>
                            <hr style="border:1px solid #444"/>
                            <b>TRAIL BUFFER (Last 5)</b><br/>
                            ${trail.slice(-5).reverse().map(t => `[X: ${t.x.toFixed(1)}, Z: ${t.z.toFixed(1)}]`).join("<br/>")}
                        `;
                    }
                }
                
                // Draw REAL target line
                if (head.state === 2 || head.state === 3) {
                    const tx = (head as any).targetX;
                    const tz = (head as any).targetZ;
                    if (tx !== undefined && tz !== undefined) {
                        ctx.beginPath();
                        ctx.moveTo(cx, cz);
                        const tcx = (tx + offX) * scale;
                        const tcz = (tz + offZ) * scale;
                        ctx.lineTo(tcx, tcz);
                        ctx.setLineDash([5, 5]);
                        ctx.strokeStyle = "rgba(255, 0, 255, 0.8)";
                        ctx.stroke();
                        ctx.setLineDash([]); // reset dash
                    }
                }
            }
        }
    }
    
    ctx.restore(); // Restore before outlier panel UI

    if (now - lastOutlierTick > 1000) {
        lastOutlierTick = now;
        
        const targetMap = new Map<string, number>();
        let targetOutliersCount = 0;
        let outlierList = "";
        
        if (getMatch()?.droneJitterMap) {
            for (const buffer of getMatch()?.droneJitterMap?.values()) {
                if (buffer.count > 0) {
                    const head = buffer.states[(buffer.head - 1 + 3) % 3] as any;
                    if ((head.state === 2 || head.state === 3) && head.targetX !== undefined && head.targetZ !== undefined) {
                        const key = `${Math.round(head.targetX)},${Math.round(head.targetZ)}`;
                        targetMap.set(key, (targetMap.get(key) || 0) + 1);
                    }
                }
            }
        }
        for (const [key, count] of targetMap.entries()) {
            if (count >= 2) {
                targetOutliersCount += count;
                outlierList += `[${key}]: ${count} drones<br/>`;
            }
        }

        const outlier = document.getElementById("dev-nav-outlier");
        if (outlier) {
            outlier.innerHTML = `
                <b>OUTLIER DETECTION (1s interval)</b><br/>
                Total Active Drones: ${activeDroneCount}<br/>
                Stuck FSM State (>10s): ${stuckCount}<br/>
                Shared Target Outliers: ${targetOutliersCount > 0 ? targetOutliersCount : 'None'}<br/>
                ${outlierList}
            `;
        }
    }
}

function drawZones() {
    const el = document.getElementById("dev-zones");
    if (!el) return;
    
    let html = `<b>Zones Summary</b><br/>Comparison of Live State (synced at 20Hz) vs. LLM Snapshot (8s interval).<br/><br/>`;
    
    const liveZoneSummary = (window as any).liveZoneSummary || {};
    let snapshotData: any = {};
    if (llmFeed && llmFeed.payload) {
        try {
            snapshotData = JSON.parse(llmFeed.payload);
        } catch(e) {}
    }
    
    // Combine all zone keys
    const zoneKeys = new Set([...Object.keys(liveZoneSummary), ...Object.keys(snapshotData)]);
    
    if (zoneKeys.size > 0) {
        html += `<div style="display:flex; flex-direction:column; gap:10px;">`;
        for (const zoneName of Array.from(zoneKeys).sort()) {
            const liveData = liveZoneSummary[zoneName] || {};
            const snapData = snapshotData[zoneName] || {};
            
            let groupsDisplay = "None";
            if (liveData.droneGroups && liveData.droneGroups.length > 0) {
                const groupCounts = new Map<string, number>();
                if (getMatch()?.droneJitterMap) {
                    for (const buffer of getMatch()?.droneJitterMap?.values()) {
                        if (buffer.count > 0) {
                            const head = buffer.states[(buffer.head - 1 + 3) % 3] as any;
                            if (head.groupId && liveData.droneGroups.includes(head.groupId)) {
                                groupCounts.set(head.groupId, (groupCounts.get(head.groupId) || 0) + 1);
                            }
                        }
                    }
                }
                groupsDisplay = liveData.droneGroups.map((g: string) => `${g} (${groupCounts.get(g) || 0})`).join(", ");
            }

            const livePresence = liveData.playerPresence || 'unknown';
            const snapPresence = snapData.playerPresence || 'unknown';
            const presenceColor = livePresence !== snapPresence ? '#ff5555' : '#aaaaaa';

            html += `
            <div style="border:1px solid #444; padding:10px; cursor:pointer; background:#222;" onclick="window.inspectZone('${zoneName}')">
                <b style="color:#0f0">${zoneName}</b><br/>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:5px;">
                    <div>
                        <b style="color:#aaa">LIVE (Server Tick)</b><br/>
                        Presence: ${livePresence}<br/>
                        Combat: ${liveData.combatEffectiveness || 'N/A'}<br/>
                        Groups: ${groupsDisplay}<br/>
                        Updated: ${liveData.lastSeenTimestamp ? new Date(liveData.lastSeenTimestamp).toLocaleTimeString() : 'N/A'}
                    </div>
                    <div>
                        <b style="color:#aaa">LLM BELIEF (Snapshot)</b><br/>
                        Presence: <span style="color:${presenceColor}">${snapPresence}</span><br/>
                        Combat: ${snapData.combatEffectiveness || 'N/A'}<br/>
                        Groups: ${(snapData.droneGroups && snapData.droneGroups.length > 0) ? snapData.droneGroups.join(", ") : 'None'}<br/>
                        Updated: ${snapData.lastSeenTimestamp ? new Date(snapData.lastSeenTimestamp).toLocaleTimeString() : 'N/A'}
                    </div>
                </div>
                <div style="margin-top:5px;"><i style="color:#888">(Click to view in AI NAV)</i></div>
            </div>
            `;
        }
        html += `</div>`;
    } else {
        html += `No Zone Summary data available yet.`;
    }
    
    el.innerHTML = html;
}

(window as any).initDevMenu = initDevMenu; (window as any).trackNetwork = trackNetwork;

function updatePhysicsPanelHUD() {
    const el = document.getElementById("dev-physics-hud");
    if (!el) return;

    const clientCube = (window as any).clientCubeTelemetry;
    const serverCube = (window as any).serverCubeTelemetry;

    let clientEventsHtml = "<div style='color:#888;'>No events logged</div>";
    if (clientCube && clientCube.events && clientCube.events.length > 0) {
        clientEventsHtml = clientCube.events.slice().reverse().map((ev: string) => `<div>${ev}</div>`).join("");
    }

    let serverEventsHtml = "<div style='color:#888;'>No events logged</div>";
    if (serverCube && serverCube.events && serverCube.events.length > 0) {
        serverEventsHtml = serverCube.events.slice().reverse().map((ev: string) => `<div>${ev}</div>`).join("");
    }

    let comparisonHtml = "";
    if (clientCube && serverCube) {
        const dx = clientCube.pos.x - serverCube.x;
        const dy = clientCube.pos.y - serverCube.y;
        const dz = clientCube.pos.z - serverCube.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        comparisonHtml = `
            <div style="background:#151515; padding:10px; border:1px dashed #ffa500; border-radius:4px; font-family:monospace; margin-bottom:15px; font-size:11px;">
                <div style="font-weight:bold; color:#ffa500; margin-bottom:3px;">[PHYSICS DRIFT DIAGNOSTIC]</div>
                <div>Position Gap (Offset Distance): <span style="color:${dist < 0.1 ? 'lime' : dist < 1.0 ? 'yellow' : 'red'}; font-weight:bold;">${dist.toFixed(4)} meters</span></div>
                <div style="color:#888; font-size:10px; margin-top:2px;">Compare client (pure-prediction local Rapier simulation) vs server (authoritative synced simulation). Any large gap indicates packet delay or world representation discrepancy.</div>
            </div>
        `;
    }

    // New Collision Resolution State Diagnostic calculation
    const clientCols = (window as any).clientPlayerCollisions || [];
    let clientCollisionsListHtml = "<div style='color:#64748b; font-style:italic;'>No active collision contacts</div>";
    if (clientCols.length > 0) {
        clientCollisionsListHtml = clientCols.map((c: string) => `<div style="color:#22d3ee; font-weight:bold;">💥 COLLIDING WITH: ${c}</div>`).join("");
    }

    const serverCols = (window as any).serverPlayerCollisions || [];
    let serverCollisionsListHtml = "<div style='color:#94a3b8; font-style:italic;'>No active collision contacts</div>";
    if (serverCols.length > 0) {
        serverCollisionsListHtml = serverCols.map((c: string) => `<div style="color:#ef4444; font-weight:bold;">💥 COLLIDING WITH: ${c}</div>`).join("");
    }

    const collisionDiagnosticHtml = `
        <div style="background:#0f172a; padding:12px; border:1px solid #334155; border-radius:6px; font-family:monospace; margin-bottom:15px; font-size:11px; line-height:1.4;">
            <div style="font-weight:bold; color:#38bdf8; font-size:12px; margin-bottom:8px; border-bottom:1px solid #334155; padding-bottom:5px; display:flex; justify-content:space-between; align-items:center;">
                <span>🛡️ PLAYER COLLISION RESOLUTION STATE DIAGNOSTIC</span>
                <span style="font-size:10px; color:#94a3b8; font-weight:normal;">Genuinely Independent Dual Code-Paths</span>
            </div>
            
            <div style="display:flex; flex-wrap:wrap; gap:15px;">
                <!-- Client-Side Collision Column -->
                <div style="flex:1 1 280px; background:#020617; padding:10px; border:1px solid #1e293b; border-radius:4px;">
                    <div style="font-weight:bold; color:#06b6d4; margin-bottom:6px; display:flex; justify-content:space-between;">
                        <span>[CLIENT RESOLUTION (PREDICTION)]</span>
                        <span style="color:#10b981;">ACTIVE</span>
                    </div>
                    <div style="margin-bottom:8px; color:#94a3b8;">Source: <span style="color:#f472b6;">client/physics.worker.ts</span> (KCC query collisions log)</div>
                    
                    <div style="background:#090d16; border:1px solid #1e293b; padding:8px; border-radius:3px;">
                        <div style="font-weight:bold; color:#94a3b8; margin-bottom:4px; font-size:10px;">CLIENT-SIDE CONTACTS:</div>
                        ${clientCollisionsListHtml}
                    </div>
                    
                    <div style="margin-top:10px; color:#94a3b8; font-size:10px; border-top:1px dashed #1e293b; padding-top:6px; display:grid; gap:3px;">
                        <div>• Player vs Drone: <span style="color:#ef4444; font-weight:bold;">ABSENT</span> (Drones are NOT simulated in client local world)</div>
                        <div>• Player vs Player: <span style="color:#ef4444; font-weight:bold;">ABSENT</span> (Other players NOT in client world)</div>
                        <div>• Player vs Pred Cube: <span style="color:#10b981; font-weight:bold;">SUPPORTED</span> (Simulated in local Rapier)</div>
                    </div>
                </div>
                
                <!-- Server-Side Collision Column -->
                <div style="flex:1 1 280px; background:#090505; padding:10px; border:1px solid #3b0712; border-radius:4px;">
                    <div style="font-weight:bold; color:#ef4444; margin-bottom:6px; display:flex; justify-content:space-between;">
                        <span>[SERVER RESOLUTION (AUTHORITATIVE)]</span>
                        <span style="color:#10b981;">ACTIVE</span>
                    </div>
                    <div style="margin-bottom:8px; color:#fca5a5;">Source: <span style="color:#f472b6;">server/MatchRoom.ts</span> (KCC player activeCollisions via state_sync)</div>
                    
                    <div style="background:#1a080c; border:1px solid #3b0712; padding:8px; border-radius:3px;">
                        <div style="font-weight:bold; color:#f87171; margin-bottom:4px; font-size:10px;">SERVER-SIDE CONTACTS:</div>
                        ${serverCollisionsListHtml}
                    </div>
                    
                    <div style="margin-top:10px; color:#f87171; font-size:10px; border-top:1px dashed #3b0712; padding-top:6px; display:grid; gap:3px;">
                        <div>• Player vs Drone: <span style="color:#10b981; font-weight:bold;">FULLY SUPPORTED</span> (Authoritative)</div>
                        <div>• Player vs Player: <span style="color:#10b981; font-weight:bold;">FULLY SUPPORTED</span> (Authoritative)</div>
                        <div>• Player vs Auth Cube: <span style="color:#10b981; font-weight:bold;">FULLY SUPPORTED</span> (Authoritative)</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    el.innerHTML = `
        ${collisionDiagnosticHtml}
        ${comparisonHtml}
        <div style="display:flex; flex-wrap:wrap; gap:15px;">
            <!-- Client Cube column -->
            <div style="flex: 1 1 280px; background:#0b111e; padding:12px; border:1px solid #1e3a8a; border-radius:4px; font-family:monospace; font-size:11px;">
                <div style="font-weight:bold; color:#38bdf8; border-bottom:1px solid #1e3a8a; padding-bottom:5px; margin-bottom:8px; display:flex; justify-content:space-between;">
                    <span>[CLIENT LOCAL RAPIER]</span>
                    <span style="color:${clientCube ? '#34d399' : '#f87171'}">${clientCube ? 'SPAWNED' : 'INACTIVE'}</span>
                </div>
                <div>Position: X: <span style="color:white;">${clientCube ? clientCube.pos.x.toFixed(3) : '0.000'}</span> | Y: <span style="color:white;">${clientCube ? clientCube.pos.y.toFixed(3) : '0.000'}</span> | Z: <span style="color:white;">${clientCube ? clientCube.pos.z.toFixed(3) : '0.000'}</span></div>
                <div>Velocity: X: <span style="color:white;">${clientCube ? clientCube.vel.x.toFixed(2) : '0.00'}</span> | Y: <span style="color:white;">${clientCube ? clientCube.vel.y.toFixed(2) : '0.00'}</span> | Z: <span style="color:white;">${clientCube ? clientCube.vel.z.toFixed(2) : '0.00'}</span></div>
                <div>Speed: <span style="color:white;">${clientCube ? Math.sqrt(clientCube.vel.x*clientCube.vel.x + clientCube.vel.y*clientCube.vel.y + clientCube.vel.z*clientCube.vel.z).toFixed(2) : '0.00'} m/s</span></div>
                
                <div style="font-weight:bold; color:#38bdf8; margin-top:12px; margin-bottom:5px;">[LOCAL EVENT CHRONOLOGY]</div>
                <div style="background:#030712; border:1px solid #1e3a8a; padding:6px; border-radius:3px; max-height:140px; overflow-y:auto; line-height:1.4; font-size:10px; word-break:break-all;">
                    ${clientEventsHtml}
                </div>
            </div>

            <!-- Server Cube column -->
            <div style="flex: 1 1 280px; background:#1e0f0f; padding:12px; border:1px solid #5c1d1d; border-radius:4px; font-family:monospace; font-size:11px;">
                <div style="font-weight:bold; color:#f87171; border-bottom:1px solid #5c1d1d; padding-bottom:5px; margin-bottom:8px; display:flex; justify-content:space-between;">
                    <span>[SERVER AUTHORITATIVE]</span>
                    <span style="color:${serverCube ? '#34d399' : '#f87171'}">${serverCube ? 'SPAWNED' : 'INACTIVE'}</span>
                </div>
                <div>Position: X: <span style="color:white;">${serverCube ? serverCube.x.toFixed(3) : '0.000'}</span> | Y: <span style="color:white;">${serverCube ? serverCube.y.toFixed(3) : '0.000'}</span> | Z: <span style="color:white;">${serverCube ? serverCube.z.toFixed(3) : '0.000'}</span></div>
                <div>Velocity: X: <span style="color:white;">${serverCube ? serverCube.vx.toFixed(2) : '0.00'}</span> | Y: <span style="color:white;">${serverCube ? serverCube.vy.toFixed(2) : '0.00'}</span> | Z: <span style="color:white;">${serverCube ? serverCube.vz.toFixed(2) : '0.00'}</span></div>
                <div>Speed: <span style="color:white;">${serverCube ? Math.sqrt(serverCube.vx*serverCube.vx + serverCube.vy*serverCube.vy + serverCube.vz*serverCube.vz).toFixed(2) : '0.00'} m/s</span></div>
                
                <div style="font-weight:bold; color:#f87171; margin-top:12px; margin-bottom:5px;">[SERVER EVENT CHRONOLOGY]</div>
                <div style="background:#0a0505; border:1px solid #5c1d1d; padding:6px; border-radius:3px; max-height:140px; overflow-y:auto; line-height:1.4; font-size:10px; word-break:break-all;">
                    ${serverEventsHtml}
                </div>
            </div>
        </div>
    `;
}

function updateCollisionsHUD() {
    const logEl = document.getElementById("dev-collisions");
    if (logEl) {
        const logsArray = (window as any).collisionLogs || [];
        if (logsArray.length === 0) {
            logEl.innerText = "No overlap detected yet. Active server-side geometric scans are running...";
        } else {
            logEl.innerText = logsArray.slice().reverse().join("\n");
        }
    }
}
