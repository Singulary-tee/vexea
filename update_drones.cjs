const fs = require('fs');
let code = fs.readFileSync('client/drone_models.ts', 'utf8');

code = code.replace(/animated_drone\.glb/g, 'quadcopter_rifle.glb');
code = code.replace(/animated_recon_fixed-wing\.glb/g, 'quadcopter_camera.glb');
code = code.replace(/wheeled_drone-rigged-animated\.glb/g, 'wheeled_drone.glb');

fs.writeFileSync('client/drone_models.ts', code);
