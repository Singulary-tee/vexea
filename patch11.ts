import fs from 'fs';

let sharedCode = fs.readFileSync('shared/constants.ts', 'utf-8');
const additions = `
export const ZONES_ARRAY = Object.values(ZONES);

export const WAYPOINTS: Record<ZoneName, { x: number; y: number; z: number }> = {
  [ZONES.SPAWN]: { x: 0, y: 1.2, z: 120 },
  [ZONES.COURTYARD]: { x: 0, y: 1.2, z: 50 },
  [ZONES.WAREHOUSE]: { x: -40, y: 1.2, z: 0 },
  [ZONES.BRIDGE]: { x: 40, y: 5.2, z: 0 },
  [ZONES.PLANT]: { x: 0, y: 1.2, z: -50 },
  [ZONES.TUNNELS]: { x: -40, y: -5.0, z: -50 },
  [ZONES.CORE]: { x: 0, y: 1.2, z: -100 }
};
`;

if (!sharedCode.includes('ZONES_ARRAY')) {
    sharedCode = sharedCode.replace(
      'export type ZoneName = typeof ZONES[keyof typeof ZONES];',
      'export type ZoneName = typeof ZONES[keyof typeof ZONES];\n' + additions
    );
    fs.writeFileSync('shared/constants.ts', sharedCode);
}

let serverCode = fs.readFileSync('server/index.ts', 'utf-8');
serverCode = serverCode.replace(/const WAYPOINTS[\s\S]*?ZONES\.CORE\]: \{ x: 0, y: 1\.2, z: -100 \}\n\};\n/g, '');
const zonesArrRegex = /const ZONES_ARRAY = Object\.values\(ZONES\);\n/g;
serverCode = serverCode.replace(zonesArrRegex, '');

if (!serverCode.includes('WAYPOINTS,')) {
    serverCode = serverCode.replace('ZoneName,', 'ZoneName, WAYPOINTS, ZONES_ARRAY,');
}

// To fix the DroneState.DEAD errors that weren't caught:
/*
server/index.ts(545,50): error TS2367: ... DroneState.DEAD' have no overlap.
server/index.ts(713,42): error TS2367: ... DroneState.DEAD' have no overlap.
*/
// The errors are actually from lines 545 and 713 in `executeLLMStep()`.
serverCode = serverCode.replace(/&& d\.state !== DroneState\.DEAD/g, '');

fs.writeFileSync('server/index.ts', serverCode);

console.log('patched WAYPOINTS');
