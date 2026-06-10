import fs from 'fs';

let codeEditor = fs.readFileSync('client/map_editor.ts', 'utf-8');
codeEditor = codeEditor.replace(/WebGPURenderer/g, '');
codeEditor = codeEditor.replace(/scene\.add\(transformControl\);/g, 'scene.add(transformControl as any);');
fs.writeFileSync('client/map_editor.ts', codeEditor);

let serverCode = fs.readFileSync('server/index.ts', 'utf-8');
serverCode = serverCode.replace(/\(d\.state === DroneState\.PURSUING \|\| d\.state === DroneState\.ATTACKING\)/g, 'd.state === DroneState.PURSUING');
fs.writeFileSync('server/index.ts', serverCode);

console.log('patched map editor and server attack logic');
