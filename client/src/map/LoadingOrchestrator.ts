import { MapRegistryEntry } from "../../../shared/maps/map-registry";
import { LoadingScreen } from "../ui/LoadingScreen";
import { getMissingFilesForMap, downloadMapAssets } from "../../asset-cache";
import { MapLoader } from "./MapLoader";
import * as THREE from "three";

export async function orchestrateMatchLoad(mapEntry: MapRegistryEntry, channel: any, targetScene: THREE.Scene): Promise<void> {
  (window as any)._serverMatchReady = false; // Reset the server ready flag for the new match load!
  const loadingScreen = new LoadingScreen();
  const mapLoader = new MapLoader(targetScene);

  loadingScreen.show();

  // Phase 1 — Check Cache and Download Required Assets
  loadingScreen.setPhase('CHECKING CACHE');
  const missing = await getMissingFilesForMap(mapEntry.id);

  if (missing.length > 0) {
    loadingScreen.setPhase('DOWNLOADING ASSETS');
    await downloadMapAssets(mapEntry.id, (progress) => {
      loadingScreen.setPhase(`DOWNLOADING ${progress.currentFile.toUpperCase()}`);
      loadingScreen.setProgress(progress.loaded, progress.total);
    });
  }

  // Phase 2 — Build Scene
  loadingScreen.setPhase('BUILDING MAP');
  loadingScreen.setProgress(0, 1);
  try {
    await mapLoader.load(mapEntry);
    await mapLoader.buildScene();
    mapLoader.placeProps();
    (window as any).__vexMapLoader = mapLoader;
  } catch (e) {
    console.error("Error building map scene:", e);
  }

  // Prewarm shaders and materials with a multi-directional panoramic view from the spawn point
  loadingScreen.setPhase('PREWARMING SHADERS');
  const prewarmCam = new THREE.PerspectiveCamera(90, 1, 0.1, 2000);
  
  // Position near player spawn coordinates (384, 5, 10)
  prewarmCam.position.set(384, 5, 10);

  const renderer = (window as any).renderer;
  if (renderer) {
    try {
      // 6-directional panoramic targets to compile all faces, materials, and LODs across the map
      const targets = [
        new THREE.Vector3(384, 5, 500),  // North (Look forward towards center of map)
        new THREE.Vector3(384, 5, -500), // South (Look backward)
        new THREE.Vector3(500, 5, 10),   // East (Look right)
        new THREE.Vector3(-500, 5, 10),  // West (Look left)
        new THREE.Vector3(384, 500, 10), // Up (Look skyward)
        new THREE.Vector3(384, -500, 10) // Down (Look groundward)
      ];

      for (let i = 0; i < targets.length; i++) {
        prewarmCam.lookAt(targets[i]);
        if (typeof renderer.compileAsync === 'function') {
          await renderer.compileAsync(targetScene, prewarmCam);
        } else if (typeof renderer.compile === 'function') {
          renderer.compile(targetScene, prewarmCam);
        }
        // Dry run render one frame to make sure all draw state is primed on GPU
        if (typeof renderer.render === 'function') {
          renderer.render(targetScene, prewarmCam);
        }
      }
      console.log('[VFX:PREWARM] Prewarm panoramic compile and mock renders completed successfully for all 6 directions');
    } catch (err) {
      console.warn('[VFX:PREWARM] Prewarm compile failed, bypassing:', err);
    }
  }

  loadingScreen.setProgress(1, 1);

  // Send player_ready signal to the server
  if (channel && typeof channel.emit === 'function') {
    channel.emit("player_ready", {});
  }

  // Phase 3 — Wait for server ready confirmation
  loadingScreen.setPhase('WAITING FOR SERVER');
  await waitForServerReady(channel);

  loadingScreen.destroy();
}

async function waitForServerReady(channel: any): Promise<void> {
  if ((window as any)._serverMatchReady) return Promise.resolve();
  if (!channel || typeof channel.on !== 'function') {
    console.warn('[LOADING] No valid channel provided — proceeding without confirmation');
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let resolved = false;
    const handleMatchReady = () => {
      if (!resolved) {
        resolved = true;
        if (typeof channel.off === 'function') {
          channel.off('match_ready', handleMatchReady);
        }
        resolve();
      }
    };
    channel.on('match_ready', handleMatchReady);
    
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (typeof channel.off === 'function') {
          channel.off('match_ready', handleMatchReady);
        }
        console.warn('[LOADING] Server ready timeout — proceeding without confirmation');
        resolve();
      }
    }, 15000);
  });
}
