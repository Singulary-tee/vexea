const fs = require('fs');

let jsonText = fs.readFileSync('assets_tracker.json', 'utf8');
// Fix the incorrect sed replacements:
jsonText = jsonText.replace(/"quadcopter_camera\.glb"/g, '"animated_drone.glb"');
jsonText = jsonText.replace(/"quadcopter_rifle\.glb"/g, '"animated_recon_fixed-wing.glb"');
jsonText = jsonText.replace(/"quadcopter_bomb\.glb"/g, '"wheeled_drone-rigged-animated.glb"');
jsonText = jsonText.replace(/"wheeled_drone\.glb"/g, '"bpre_rifleman.glb"');
jsonText = jsonText.replace(/"fixed_wing_drone\.glb"/g, '"grenade.glb"');

let json = JSON.parse(jsonText);

const obsolete = ["animated_drone.glb", "animated_recon_fixed-wing.glb", "wheeled_drone-rigged-animated.glb"];
const newAssets = [
  { "name": "quadcopter_camera.glb", "category": "Model", "source": "Release" },
  { "name": "quadcopter_rifle.glb", "category": "Model", "source": "Release" },
  { "name": "quadcopter_bomb.glb", "category": "Model", "source": "Release" },
  { "name": "wheeled_drone.glb", "category": "Model", "source": "Release" },
  { "name": "fixed_wing_drone.glb", "category": "Model", "source": "Release" }
];

json.assets = json.assets.filter(a => !obsolete.includes(a.name));
// Add new assets at the beginning of the model list or push them
json.assets.unshift(...newAssets);

fs.writeFileSync('assets_tracker.json', JSON.stringify(json, null, 2));

// Now fix assets_tracker.md
let md = fs.readFileSync('assets_tracker.md', 'utf8');

obsolete.forEach(o => {
  const regex = new RegExp(`.*${o}.*\\n`, 'g');
  md = md.replace(regex, '');
});

const newRows = newAssets.map(a => `| \`${a.name}\` | ${a.category} | Root Directory | \`Asset\` Release Package |`).join('\n') + '\n';
// Insert into the table (let's say after the first row `| StreetLightPoles.bin | Model | Root Directory | Asset Release Package |`)
md = md.replace(/(\| `StreetLightPoles.bin` \| Model \| Root Directory \| `Asset` Release Package \|\n)/, `$1${newRows}`);

fs.writeFileSync('assets_tracker.md', md);
