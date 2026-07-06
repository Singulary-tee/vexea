const fs = require('fs');

let json = JSON.parse(fs.readFileSync('assets_tracker.json', 'utf8'));

const obsolete = ["animated_drone.glb", "animated_recon_fixed-wing.glb", "wheeled_drone-rigged-animated.glb"];
const newAssets = [
  { "name": "quadcopter_camera.glb", "category": "Model", "source": "Release" },
  { "name": "quadcopter_rifle.glb", "category": "Model", "source": "Release" },
  { "name": "quadcopter_bomb.glb", "category": "Model", "source": "Release" },
  { "name": "wheeled_drone.glb", "category": "Model", "source": "Release" },
  { "name": "fixed_wing_drone.glb", "category": "Model", "source": "Release" }
];

json.assets = json.assets.filter(a => !obsolete.includes(a.name));

// Wait, my previous sed replaced things like bpre_rifleman.glb.
// Let's re-read the original from my earlier view and just write it properly.
