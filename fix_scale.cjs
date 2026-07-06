const fs = require('fs');

let dm = fs.readFileSync('client/drone_models.ts', 'utf8');
dm = dm.replace(
  /useParts\.forEach\(p => {\n\s*if \(p\.parentName === null \|\| p\.name === 'body'\) {\n\s*p\.localMatrix\.premultiply\(rootScaleMatrix\);\n\s*}\n\s*}\);/,
  `// scaleFactor will be passed to DroneSystem to scale the entire hierarchy
     useParts.forEach(p => {
       // localMatrix left untouched, DroneSystem will apply scaleFactor at the root
     });`
);
dm = dm.replace(
  /return { \n\s*mesh: batchMesh, \n\s*instanceGroup,/,
  `return { \n       mesh: batchMesh, \n       instanceGroup,\n       scaleFactor,`
);
fs.writeFileSync('client/drone_models.ts', dm);

let ds = fs.readFileSync('client/src/systems/DroneSystem.ts', 'utf8');
ds = ds.replace(
  /match\.tempScale\.set\(1, 1, 1\);\n\s*this\.diagTempMatrix\.compose\(this\.diagTempPosition, this\.diagTempQuaternion, match\.tempScale\);/,
  `// Scale is applied per-drone-type later during batch processing\n      // this.diagTempMatrix is composed later`
);

// we need to compose this.diagTempMatrix dynamically per batch
// wait, fixed wing also needs to be composed
ds = ds.replace(
  /if \(typeId === 3\) \{ \/\/ FIXED_WING standalone\n\s*let fw = this\.standaloneDrones\.get\(id\);/,
  `if (typeId === 3) { // FIXED_WING standalone
           match.tempScale.set(1, 1, 1);
           this.diagTempMatrix.compose(this.diagTempPosition, this.diagTempQuaternion, match.tempScale);
           let fw = this.standaloneDrones.get(id);`
);

ds = ds.replace(
  /const partsInfo = batch\.partsInfo;/,
  `const partsInfo = batch.partsInfo;
                 const sf = batch.scaleFactor || 1;
                 match.tempScale.set(sf, sf, sf);
                 this.diagTempMatrix.compose(this.diagTempPosition, this.diagTempQuaternion, match.tempScale);`
);

fs.writeFileSync('client/src/systems/DroneSystem.ts', ds);
