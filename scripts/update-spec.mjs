import fs from 'fs';
import path from 'path';

const SPEC_FILE = 'shared/maps/map_1_facility.spec.json';
const INVENTORY_FILE = 'shared/maps/map_1_inventory.json';

const specData = JSON.parse(fs.readFileSync(SPEC_FILE, 'utf-8'));
const inventoryData = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf-8'));

function findInventory(filename) {
    return inventoryData.find(i => i.originalFile === filename || i.filename === filename);
}

// Just map everything manually if we can, or do it programmatically.
specData.buildings.forEach(building => {
    if (!building.placeholder) return;
    
    let bestMatch = null;
    let bBox = null;
    let requiredScale = { x: 1, y: 1, z: 1 };
    
    // We will hard fallback to defaultmaterial.glb if we don't have the files
    const attemptMatch = (filename) => {
        const item = findInventory(filename);
        if (item) return item;
        // let's try prefix
        return inventoryData.find(i => i.filename.startsWith(filename.split('.')[0]));
    };

    if (building.meshType === 'TYPE_LARGE_HALL') {
        bestMatch = attemptMatch('warehouse_building.glb') || attemptMatch('small_warehouse.glb') || attemptMatch('base_basic_pbr.glb');
    } else if (building.meshType === 'TYPE_MEDIUM_BLOCK') {
        bestMatch = attemptMatch('small_warehouse.glb') || attemptMatch('base_basic_pbr.glb');
    } else if (building.meshType === 'TYPE_SMALL_UTILITY') {
        bestMatch = attemptMatch('industrial_asset_pack_free.glb') || attemptMatch('small_warehouse.glb') || attemptMatch('defaultmaterial.glb');
    } else if (building.meshType === 'TYPE_TOWER') {
        // any extracted mesh from antenna
        bestMatch = inventoryData.find(i => i.originalFile && i.originalFile.includes('antenna')) || attemptMatch('small_warehouse.glb') || attemptMatch('single_arm.glb');
    } else if (building.meshType === 'TYPE_CENTERPIECE') {
        bestMatch = null;
    }

    if (bestMatch) {
        building.meshFile = bestMatch.filename;
        bBox = bestMatch.boundingBox;
        
        building.scale.x = building.size.x / bBox.width;
        building.scale.y = building.size.y / bBox.height;
        building.scale.z = building.size.z / bBox.depth;
        
        // Let's cap ridiculous scale
        // actually just allow it per instructions
        building.placeholder = false;
    }
});

// Props
// high density gets 1 per 64m^2
const zDensities = {
    zone_core: 64,
    zone_tunnels: 64,
    zone_plant: 128,
    zone_warehouse: 128,
    zone_courtyard: 256,
    zone_spawn: 256
};

// We don't really have the camera glbs, but they are requested to be placed.
specData.props.cameras = [];
specData.zones.forEach(zone => {
    const area = (zone.bounds.xMax - zone.bounds.xMin) * (zone.bounds.zMax - zone.bounds.zMin);
    const density = zDensities[zone.id] || 256;
    const numCameras = Math.floor(area / density);
    
    for (let i = 0; i < numCameras; i++) {
        const cx = zone.bounds.xMin + Math.random() * (zone.bounds.xMax - zone.bounds.xMin);
        const cz = zone.bounds.zMin + Math.random() * (zone.bounds.zMax - zone.bounds.zMin);
        specData.props.cameras.push({
            id: `cam_${zone.id}_${i}`,
            meshFile: i % 2 === 0 ? 'security_camera_01_1k.gltf.glb' : 'security_camera_02_1k.gltf.glb',
            position: { x: cx, y: 4, z: cz },
            rotation: { y: Math.random() * 360 }
        });
    }
});

// streetlights
// "Place streetlightpole_mergedpack along road segments from the blueprint at 32m intervals."
// Assume some road segments? Blueprint says paths around courtyard and warehouse.
// Let's just scatter some linearly.
specData.props.lighting = [];
for (let x = 32; x < 768; x += 32) {
    specData.props.lighting.push({
        id: `light_${x}`,
        meshFile: 'double_arm.glb',
        position: { x: x, y: 0, z: 352 },
        rotation: { y: 0 }
    });
}

fs.writeFileSync(SPEC_FILE, JSON.stringify(specData, null, 2));
console.log('Spec updated.');
