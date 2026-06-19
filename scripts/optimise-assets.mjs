import fs from 'fs';
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, draco, cloneDocument } from '@gltf-transform/functions';
import sharp from 'sharp';
import draco3d from 'draco3dgltf';

const EXCLUSION_LIST = [
  'animated_drone.glb',
  'animated_pistol.glb',
  'animated_recon_fixed-wing.glb',
  'bpre_rifleman.glb',
  'smg_fps_animations.glb',
  'wheeled_drone-rigged-animated.glb',
  'tree_animate.glb'
];

const OUTPUT_DIR = path.join(process.cwd(), 'client', 'public', 'assets', 'maps', 'map_1');
const INVENTORY_FILE = path.join(process.cwd(), 'shared', 'maps', 'map_1_inventory.json');

const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function transformPoint(m, p) {
    let x = p[0], y = p[1], z = p[2];
    // Affine transform (missing w division, which is usually 1 for glTF global transforms)
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
}

function calculateStats(doc) {
    let triangleCount = 0;
    const meshNames = new Set();
    
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let hasPrimitives = false;

    doc.getRoot().listNodes().forEach(node => {
        const mesh = node.getMesh();
        if (mesh) {
            meshNames.add(mesh.getName() || node.getName() || 'unnamed');
            
            const worldMatrix = node.getWorldMatrix();
            
            mesh.listPrimitives().forEach(prim => {
                const indices = prim.getIndices();
                if (indices) {
                    triangleCount += indices.getCount() / 3;
                } else {
                    const position = prim.getAttribute('POSITION');
                    if (position) triangleCount += position.getCount() / 3;
                }

                const pos = prim.getAttribute('POSITION');
                if (pos) {
                    for (let i = 0; i < pos.getCount(); i++) {
                        const pt = pos.getElement(i, []);
                        const globalPt = transformPoint(worldMatrix, pt);
                        minX = Math.min(minX, globalPt[0]);
                        minY = Math.min(minY, globalPt[1]);
                        minZ = Math.min(minZ, globalPt[2]);
                        
                        maxX = Math.max(maxX, globalPt[0]);
                        maxY = Math.max(maxY, globalPt[1]);
                        maxZ = Math.max(maxZ, globalPt[2]);
                        hasPrimitives = true;
                    }
                }
            });
        }
    });

    const hasAnimations = doc.getRoot().listAnimations().length > 0;

    let boundingBox = { x: 0, y: 0, z: 0, width: 0, height: 0, depth: 0 };
    if (hasPrimitives) {
        boundingBox = {
            x: minX,
            y: minY,
            z: minZ,
            width: maxX - minX,
            height: maxY - minY,
            depth: maxZ - minZ
        };
    }

    return {
        triangleCount,
        meshNames: Array.from(meshNames),
        boundingBox,
        hasAnimations
    };
}

(async () => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(INVENTORY_FILE), { recursive: true });

    const io = new NodeIO()
        .registerExtensions(KHRONOS_EXTENSIONS)
        .registerDependencies({
            'draco3d.encoder': await draco3d.createEncoderModule(),
            'draco3d.decoder': await draco3d.createDecoderModule(),
        });

    const inventory = [];

    function findGltfFiles(dir, files = []) {
        for (const file of fs.readdirSync(dir)) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                if (['node_modules', '.git', 'client', 'dist', 'scripts'].includes(file) && dir === process.cwd()) continue;
                // Exclude the output directory specifically just in case
                if (fullPath === OUTPUT_DIR) continue;
                findGltfFiles(fullPath, files);
            } else if (file.endsWith('.glb') || file.endsWith('.gltf')) {
                files.push(fullPath);
            }
        }
        return files;
    }

    // Wait, the user specifically mentioned some paths in client/public/... are assets. 
    // Let's redefine findGltfFiles to ONLY exclude output dir and node_modules/git.
    // That means we SHOULD process client/public/textures stuff?
    // Let's just process everything except output and node_modules.

    function scanFiles(dir) {
        let results = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const res = path.resolve(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'scripts') continue;
                if (res.startsWith(OUTPUT_DIR)) continue;
                results = results.concat(scanFiles(res));
            } else {
                if (entry.name.endsWith('.glb') || entry.name.endsWith('.gltf')) {
                    results.push(res);
                }
            }
        }
        return results;
    }

    const allFiles = scanFiles(process.cwd());
    console.log(`Found ${allFiles.length} files to process.`);

    for (const filePath of allFiles) {
        const basename = path.basename(filePath);
        console.log(`\nProcessing: ${basename}`);
        
        try {
            const isExcluded = EXCLUSION_LIST.includes(basename);
            if (isExcluded) {
                console.log(`- In exclusion list. Copying as-is.`);
                const outPath = path.join(OUTPUT_DIR, basename);
                fs.copyFileSync(filePath, outPath);
                
                // Read purely for stats
                const doc = await io.read(filePath);
                const stats = calculateStats(doc);
                
                inventory.push({
                    filename: basename,
                    originalFile: basename,
                    boundingBox: stats.boundingBox,
                    triangleCount: stats.triangleCount,
                    hasAnimations: stats.hasAnimations,
                    meshNames: stats.meshNames
                });
                continue;
            }

            const sourceDoc = await io.read(filePath);
            
            // Check how many named mesh nodes exist
            const namedMeshNodes = [];
            sourceDoc.getRoot().listNodes().forEach(node => {
                if (node.getMesh() && (node.getName() || node.getMesh().getName())) {
                    namedMeshNodes.push(node);
                }
            });

            if (namedMeshNodes.length <= 1) {
                console.log(`- Single root mesh detected. Applying optimisations directly.`);
                await sourceDoc.transform(
                    dedup(),
                    prune(),
                    draco(),
                    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85 })
                );
                
                const extIndex = basename.lastIndexOf('.');
                const outName = basename.substring(0, extIndex) + '.glb';
                const outPath = path.join(OUTPUT_DIR, outName);
                await io.write(outPath, sourceDoc);
                
                const stats = calculateStats(sourceDoc);
                inventory.push({
                    filename: outName,
                    originalFile: basename,
                    boundingBox: stats.boundingBox,
                    triangleCount: stats.triangleCount,
                    hasAnimations: stats.hasAnimations,
                    meshNames: stats.meshNames
                });
            } else {
                console.log(`- Multiple named meshes detected (${namedMeshNodes.length}). Extracting...`);
                for (let i = 0; i < namedMeshNodes.length; i++) {
                    const node = namedMeshNodes[i];
                    const nodeName = node.getName() || node.getMesh().getName() || 'mesh_' + i;
                    const slug = slugify(nodeName);
                    
                    let outName = `${slug}.glb`;
                    let counter = 1;
                    while (fs.existsSync(path.join(OUTPUT_DIR, outName))) {
                        outName = `${slug}_${counter}.glb`;
                        counter++;
                    }
                    
                    const outPath = path.join(OUTPUT_DIR, outName);
                    
                    console.log(`  -> Extracting ${nodeName} to ${outName}`);
                    
                    const docClone = cloneDocument(sourceDoc);
                    const clonedScene = docClone.getRoot().listScenes()[0];
                    const clonedNode = docClone.getRoot().listNodes().find(n => n.getName() === node.getName() && n.getMesh()?.getName() === node.getMesh()?.getName());
                    
                    if (!clonedNode) {
                        console.error(`  [!] Could not find node ${nodeName} in cloned document. Skipping.`);
                        continue;
                    }
                    
                    // Keep only this node in the scene
                    clonedScene.listChildren().forEach(child => clonedScene.removeChild(child));
                    clonedScene.addChild(clonedNode);
                    
                    // Reset its local transform so it's centered if it was positioned globally?
                    // The prompt just says "Extracts all named mesh children as individual GLB files" 
                    // Usually you want to keep its transform, OR reset it? If they are props they are usually offset. 
                    // Let's NOT reset it because they might have internal transforms. Or wait, if you extract it, you usually want it centered. 
                    // We'll leave it as is to preserve accuracy!
                    
                    await docClone.transform(
                        dedup(),
                        prune(),
                        draco(),
                        textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85 })
                    );
                    
                    await io.write(outPath, docClone);
                    
                    const stats = calculateStats(docClone);
                    inventory.push({
                        filename: outName,
                        originalFile: basename,
                        boundingBox: stats.boundingBox,
                        triangleCount: stats.triangleCount,
                        hasAnimations: stats.hasAnimations,
                        meshNames: stats.meshNames
                    });
                }
            }
        } catch(err) {
            console.error(`[Error processing ${basename}]:`, err.message);
        }
    }

    fs.writeFileSync(INVENTORY_FILE, JSON.stringify(inventory, null, 2));
    console.log(`\nFinished! Wrote inventory to ${INVENTORY_FILE}`);
})();
