const fs = require('fs');

let code = fs.readFileSync('client/src/systems/DroneSystem.ts', 'utf8');

code = code.replace(
  /const worldMats = new Map<string, THREE.Matrix4>\(\);/,
  `const worldMats = new Map<string, THREE.Matrix4>();\n                 worldMats.set('body', this.diagTempMatrix);`
);

fs.writeFileSync('client/src/systems/DroneSystem.ts', code);
