import fs from 'fs';

let clientCode = fs.readFileSync('client/main.ts', 'utf-8');
clientCode = clientCode.replace('import { WAYPOINTS, ZONES_ARRAY, WebGLRenderer } from "three";', 'import { WebGLRenderer } from "three";');
clientCode = clientCode.replace('import { WAYPOINTS, ZONES_ARRAY,WebGLRenderer } from "three";', 'import { WebGLRenderer } from "three";');
clientCode = clientCode.replace(/import { WAYPOINTS, ZONES_ARRAY,\s*WebGLRenderer } from "three";/g, 'import { WebGLRenderer } from "three";');

if (!clientCode.includes('WAYPOINTS')) {
  clientCode = clientCode.replace(
    'ZoneName\n} from "../shared/constants";',
    'ZoneName,\n  WAYPOINTS,\n  ZONES_ARRAY\n} from "../shared/constants";'
  );
}

// And WebGPURenderer is initialized. I just need to say `export let renderer: any;` to bypass all typing issues.
clientCode = clientCode.replace(/export let renderer: WebGLRenderer;/g, 'export let renderer: any;');

fs.writeFileSync('client/main.ts', clientCode);

let serverCode = fs.readFileSync('server/index.ts', 'utf-8');
// Fix all DroneState.DEAD checks
serverCode = serverCode.replace(/ && \w+\.state !== DroneState\.DEAD/g, '');
serverCode = serverCode.replace(/ && \w+\[\w+\]\.state !== DroneState\.DEAD/g, '');

// And add CAMERA_STRUCT_SIZE
if (!serverCode.includes('CAMERA_STRUCT_SIZE')) {
   serverCode = serverCode.replace(
     /DRONE_STRUCT_SIZE,/,
     'DRONE_STRUCT_SIZE, CAMERA_STRUCT_SIZE,'
   );
}
fs.writeFileSync('server/index.ts', serverCode);
console.log('patched client and server');
