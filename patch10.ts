import fs from 'fs';

let clientCode = fs.readFileSync('client/main.ts', 'utf-8');
if (!clientCode.includes('import { WAYPOINTS')) {
  clientCode = clientCode.replace(
    'ZoneName\n} from "../shared/constants";',
    'ZoneName,\n  WAYPOINTS,\n  ZONES_ARRAY\n} from "../shared/constants";'
  );
}
fs.writeFileSync('client/main.ts', clientCode);

let serverCode = fs.readFileSync('server/index.ts', 'utf-8');
if (!serverCode.includes('CAMERA_STRUCT_SIZE')) {
   serverCode = serverCode.replace(
     /DRONE_STRUCT_SIZE,/g,
     'DRONE_STRUCT_SIZE, CAMERA_STRUCT_SIZE,'
   );
}
serverCode = serverCode.replace(/ && \w+\.state !== DroneState\.DEAD/g, '');
serverCode = serverCode.replace(/ && [a-zA-Z0-9_\[\]]+\.state !== DroneState\.DEAD/g, '');
// Explicitly:
serverCode = serverCode.replace(/hitDrone\.state !== DroneState\.DEAD/g, 'true');
// Just completely remove any check against DroneState.DEAD manually in the specific line
serverCode = serverCode.replace(/d\.state !== DroneState\.DEAD/g, 'true');

fs.writeFileSync('server/index.ts', serverCode);
