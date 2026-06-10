import fs from 'fs';
let code = fs.readFileSync('server/index.ts', 'utf-8');

code = code.replace(/ && d\.state !== DroneState\.DEAD/g, '');
code = code.replace(/ && drones\[i\]\.state !== DroneState\.DEAD/g, '');
code = code.replace(/ && hitDrone\.state !== DroneState\.DEAD/g, '');

if (!code.includes('CAMERA_STRUCT_SIZE')) {
   code = code.replace(
     /DRONE_STRUCT_SIZE,/,
     'DRONE_STRUCT_SIZE, CAMERA_STRUCT_SIZE,'
   );
}

fs.writeFileSync('server/index.ts', code);
console.log('fixed TS overlap errors');

// Fix client/main.ts
let clientCode = fs.readFileSync('client/main.ts', 'utf-8');
clientCode = clientCode.replace(
  'import {',
  'import { WAYPOINTS, ZONES_ARRAY,'
);
// WebGPURenderer is somehow an issue? "Type 'WebGPURenderer' is missing..."
// I don't need WebGPURenderer in client/main.ts if TS complains, just let it be WebGLRenderer
clientCode = clientCode.replace(
  /export let renderer: THREE\.WebGPURenderer \| WebGLRenderer;/g,
  'export let renderer: WebGLRenderer;'
);

fs.writeFileSync('client/main.ts', clientCode);
