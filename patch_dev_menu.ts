import fs from 'fs';

let devMenuCode = fs.readFileSync('client/dev_menu.ts', 'utf-8');

if (!devMenuCode.includes('import * as THREE')) {
  devMenuCode = devMenuCode.replace('import {', 'import * as THREE from "three";\nimport { camera } from "./main";\nimport {');
}

// Player Loadout
const badButtonsRegex = /<button data-weapon="plasma_rifle"[\s\S]*?<button data-weapon="rail_cannon"[\s\S]*?<\/button>/;
const loadoutHtml = `<button data-weapon="rifle" style="padding:5px;">Equip Rifle</button>
                <button data-weapon="pistol" style="padding:5px;">Equip Pistol</button>
                <button data-action="heal" style="padding:5px;">Full Heal</button>`;

devMenuCode = devMenuCode.replace(badButtonsRegex, loadoutHtml);

// Adding crosshair parsing to dev_spawn_drone
const oldSpawnBtnListener = `const type = parseInt((e.target as HTMLElement).getAttribute('data-type') || '0', 10);
                console.log(\`[DEV MENU] Spawning drone type \${type}\`);
                if (activeChannel) activeChannel.emit("dev_spawn_drone", { type });`;

const newSpawnBtnListener = `const type = parseInt((e.target as HTMLElement).getAttribute('data-type') || '0', 10);
                if (!camera) return;
                const dir = new THREE.Vector3(0, 0, -1);
                dir.applyQuaternion(camera.quaternion);
                const pos = new THREE.Vector3();
                pos.copy(camera.position).add(dir.multiplyScalar(20)); // spawn 20 units in front
                let spawnY = pos.y;
                if (spawnY < Number(0.5)) spawnY = Number(0.5); // don't spawn under floor
                
                console.log(\`[DEV MENU] Spawning drone type \${type} at \${pos.x.toFixed(2)}, \${spawnY.toFixed(2)}, \${pos.z.toFixed(2)}\`);
                if (activeChannel) activeChannel.emit("dev_spawn_drone", { type, x: pos.x, y: spawnY, z: pos.z });`;

devMenuCode = devMenuCode.replace(oldSpawnBtnListener, newSpawnBtnListener);

fs.writeFileSync('client/dev_menu.ts', devMenuCode);

// now server/index.ts
let serverCode = fs.readFileSync('server/index.ts', 'utf-8');
const oldSpawnHandler = `d.type = type;
           d.state = DroneState.IDLE;
           const wp = WAYPOINTS[ZONES.COURTYARD];
           d.posX = pState.posX || wp.x;
           d.posY = pState.posY || wp.y;
           d.posZ = pState.posZ || wp.z;`;

const newSpawnHandler = `d.type = type;
           d.state = DroneState.IDLE;
           d.posX = args.x !== undefined ? args.x : 0;
           d.posY = args.y !== undefined ? args.y : 2;
           d.posZ = args.z !== undefined ? args.z : 0;`;
serverCode = serverCode.replace(oldSpawnHandler, newSpawnHandler);

fs.writeFileSync('server/index.ts', serverCode);
console.log('patched dev menu and server spawn');
