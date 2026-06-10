import fs from 'fs';
let code = fs.readFileSync('client/dev_menu.ts', 'utf-8');

const cameraDrawCode = `
    // Draw Cameras
    if ((window as any).syncCameras) {
        for (const cam of (window as any).syncCameras) {
            // Find its position based on ID if possible
            // We know cam ID maps to ZONES_ARRAY indices
            // But we don't have WAYPOINTS here. Oh we can just use the DOM
            // I'll grab WAYPOINTS from the window since they are used elsewhere, or just pass them from main.ts?
            // Wait, we can't easily. I'll just draw them? No, we don't have to perfectly draw. Just draw what was requested.
        }
    }
`;
// Actually, WAYPOINTS and ZONES_ARRAY can be imported here!
if (!code.includes('import { ZONE_BOUNDS, WAYPOINTS, ZONES_ARRAY }')) {
    code = code.replace(/import \{ ZONE_BOUNDS \} from "\.\.\/shared\/constants";/, 'import { ZONE_BOUNDS, WAYPOINTS, ZONES_ARRAY } from "../shared/constants";');
}

const camCode = `

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
                ctx.fillText(\`CAM \${cam.id}\`, cx + 8, cz - 8);
            }
        }
    }

    if (droneJitterMapRef) {`;

code = code.replace(/    if \(droneJitterMapRef\) \{/, camCode);

fs.writeFileSync('client/dev_menu.ts', code);
console.log('patched dev menu cameras');
