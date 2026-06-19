import { getMapById } from "../../shared/maps/map-registry";
import { DS } from "../design-system";

export function initMapViewerGlobally() {
    (window as any).launchMapEditor = launchMapEditor;
}

export async function launchMapEditor(mapId: string) {
    const mapDef = getMapById(mapId);
    if (!mapDef || !mapDef.specFile) {
        console.warn("Map spec not found for", mapId);
        return;
    }

    try {
        const resp = await fetch('/' + mapDef.specFile);
        const spec = await resp.json();
        
        let container = document.getElementById('map-viewer-overlay');
        if (container) document.body.removeChild(container);

        container = document.createElement('div');
        container.id = 'map-viewer-overlay';
        Object.assign(container.style, {
            position: 'fixed',
            top: '0', left: '0', width: '100vw', height: '100vh',
            background: 'rgba(0, 0, 0, 0.95)',
            zIndex: '9999',
            display: 'flex',
            flexDirection: 'column'
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            height: '60px',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255,255,255,0.1)'
        });

        const title = document.createElement('div');
        title.textContent = `MAP VIEWER: ${mapDef.displayName}`;
        Object.assign(title.style, {
            color: DS.colors.accent,
            fontFamily: DS.typography.fontFamily,
            fontSize: '24px',
            fontWeight: DS.typography.weightBold,
            textTransform: 'uppercase',
            letterSpacing: '2px'
        });
        header.appendChild(title);

        const closeBtn = document.createElement('div');
        closeBtn.textContent = 'CLOSE';
        Object.assign(closeBtn.style, {
            color: '#0A0A0A',
            background: DS.colors.accent,
            padding: '8px 24px',
            fontFamily: DS.typography.fontFamily,
            fontSize: '18px',
            fontWeight: DS.typography.weightBold,
            cursor: 'pointer',
            borderRadius: '0', // sharp corners
            textTransform: 'uppercase'
        });
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(container!);
        });
        header.appendChild(closeBtn);

        container.appendChild(header);

        const canvasContainer = document.createElement('div');
        Object.assign(canvasContainer.style, {
            flex: '1',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        });
        container.appendChild(canvasContainer);

        const canvas = document.createElement('canvas');
        canvasContainer.appendChild(canvas);
        document.body.appendChild(container);

        const ctx = canvas.getContext('2d')!;

        // Threat level color map
        const THREAT_COLORS: Record<number, string> = {
            0: 'rgba(0, 255, 0, 0.2)',     // Green
            1: 'rgba(255, 255, 0, 0.2)',   // Yellow
            2: 'rgba(255, 165, 0, 0.2)',   // Orange
            3: 'rgba(255, 0, 0, 0.2)',     // Red
            4: 'rgba(139, 0, 0, 0.2)',     // Dark Red
            5: 'rgba(128, 0, 128, 0.2)'    // Purple
        };
        const THREAT_STROKES: Record<number, string> = {
            0: 'rgba(0, 255, 0, 0.8)',
            1: 'rgba(255, 255, 0, 0.8)',
            2: 'rgba(255, 165, 0, 0.8)',
            3: 'rgba(255, 0, 0, 0.8)',
            4: 'rgba(139, 0, 0, 0.8)',
            5: 'rgba(128, 0, 128, 0.8)'
        };

        const render = () => {
            const width = canvasContainer.clientWidth - 40;
            const height = canvasContainer.clientHeight - 40;
            canvas.width = width;
            canvas.height = height;

            ctx.clearRect(0, 0, width, height);

            const worldX = spec.worldSize.x;
            const worldZ = spec.worldSize.z;
            const scaleX = width / worldX;
            const scaleZ = height / worldZ;
            const scale = Math.min(scaleX, scaleZ);

            ctx.save();
            ctx.translate(width / 2, height / 2); // Center world (0,0) at canvas center

            // 1. Draw Zones
            if (spec.zones) {
                for (const zone of spec.zones) {
                    const zWidth = (zone.bounds.xMax - zone.bounds.xMin);
                    const zHeight = (zone.bounds.zMax - zone.bounds.zMin);
                    
                    const x = zone.bounds.xMin * scale;
                    const y = zone.bounds.zMin * scale;
                    const w = zWidth * scale;
                    const h = zHeight * scale;

                    const tl = zone.threatLevel || 0;
                    ctx.fillStyle = THREAT_COLORS[tl] || THREAT_COLORS[0];
                    ctx.strokeStyle = THREAT_STROKES[tl] || THREAT_STROKES[0];
                    ctx.lineWidth = 2;

                    ctx.fillRect(x, y, w, h);
                    ctx.strokeRect(x, y, w, h);

                    ctx.fillStyle = ctx.strokeStyle;
                    ctx.font = '12px ' + DS.typography.fontFamily;
                    ctx.textAlign = 'center';
                    ctx.fillText(zone.id, x + w/2, y + 16);
                }
            }

            // 2. Draw Buildings
            if (spec.buildings) {
                for (const b of spec.buildings) {
                    const bx = b.position.x * scale;
                    const bz = b.position.z * scale;
                    const bw = b.size.x * (b.scale?.x || 1) * scale;
                    const bh = b.size.z * (b.scale?.z || 1) * scale;

                    ctx.fillStyle = 'rgba(200, 200, 200, 0.8)';
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1;

                    ctx.save();
                    ctx.translate(bx, bz);
                    if (b.rotation?.y) {
                        ctx.rotate(-b.rotation.y * Math.PI / 180); 
                        // Canvas rotation vs THREE Y-rotation
                    }
                    ctx.fillRect(-bw/2, -bh/2, bw, bh);
                    ctx.strokeRect(-bw/2, -bh/2, bw, bh);

                    ctx.fillStyle = '#000';
                    ctx.font = '10px ' + DS.typography.fontFamily;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(b.id || b.meshFile || 'Building', 0, 0);
                    ctx.restore();
                }
            }

            // 3. Draw Spawn Points
            if (spec.spawnPoints) {
                for (const sp of spec.spawnPoints) {
                    const sx = sp.position.x * scale;
                    const sz = sp.position.z * scale;

                    ctx.beginPath();
                    ctx.arc(sx, sz, 4 * scale, 0, Math.PI * 2);
                    ctx.fillStyle = 'blue';
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.stroke();

                    ctx.fillStyle = '#fff';
                    ctx.font = '9px ' + DS.typography.fontFamily;
                    ctx.textAlign = 'center';
                    ctx.fillText(sp.id, sx, sz - 8);
                }
            }

            // 4. Draw Restricted Gates
            if (spec.restrictedGates) {
                for (const rg of spec.restrictedGates) {
                    const rx = rg.position.x * scale;
                    const rz = rg.position.z * scale;
                    const kRadius = rg.killZoneRadius * scale;

                    // Draw kill zone
                    ctx.beginPath();
                    ctx.arc(rx, rz, kRadius, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
                    ctx.fill();
                    ctx.strokeStyle = 'red';
                    ctx.setLineDash([5, 5]);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Draw X
                    const crossSize = 10;
                    ctx.beginPath();
                    ctx.moveTo(rx - crossSize, rz - crossSize);
                    ctx.lineTo(rx + crossSize, rz + crossSize);
                    ctx.moveTo(rx + crossSize, rz - crossSize);
                    ctx.lineTo(rx - crossSize, rz + crossSize);
                    ctx.strokeStyle = 'red';
                    ctx.lineWidth = 3;
                    ctx.stroke();
                }
            }

            ctx.restore();
        };

        window.addEventListener('resize', render);
        render();

        // Cleanup
        const oldClose = closeBtn.onclick;
        closeBtn.onclick = (e) => {
            window.removeEventListener('resize', render);
            if (oldClose) (oldClose as any)(e);
        };

    } catch (e) {
        console.error("Failed to load map spec for viewer", e);
    }
}
