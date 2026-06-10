import fs from 'fs';
let serverCode = fs.readFileSync('server/index.ts', 'utf-8');

serverCode = serverCode.replace(/d\.state === DroneState\.DEAD \|\| d\.state === DroneState\.DEAD/g, 'd.state === DroneState.DEAD');

const waypointsRegex = /const WAYPOINTS: Record<ZoneName, \{ x: number; y: number; z: number \}> = \{[\s\S]*?\};\n/g;
serverCode = serverCode.replace(waypointsRegex, '');

const zonesArrayRegex = /const ZONES_ARRAY: ZoneName\[\] = Object\.values\(ZONES\);\n/g;
serverCode = serverCode.replace(zonesArrayRegex, '');
serverCode = serverCode.replace(/const ZONES_ARRAY = Object\.values\(ZONES\);\n/g, '');

if (!serverCode.includes('CAMERA_STRUCT_SIZE')) {
   serverCode = serverCode.replace(/import \{[\s\S]*?\} from "\.\.\/shared\/constants";/, (match) => {
       if (!match.includes('CAMERA_STRUCT_SIZE')) {
           return match.replace('\n} from', ',\n  CAMERA_STRUCT_SIZE\n} from');
       }
       return match;
   });
}

fs.writeFileSync('server/index.ts', serverCode);

console.log('patched server compilation errors');
