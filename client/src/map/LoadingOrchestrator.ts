import { MapRegistryEntry } from "../../../shared/maps/map-registry";
import { LoadingScreen } from "../ui/LoadingScreen";
import { getMissingFilesForMap, downloadMapAssets } from "../../asset-cache";
import { MapLoader } from "./MapLoader";
import { scene } from "../../main";

export async function orchestrateMatchLoad(mapEntry: MapRegistryEntry, channel: any): Promise<void> {
  const loadingScreen = new LoadingScreen();
  const mapLoader = new MapLoader(scene);

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
  loadingScreen.setProgress(1, 1);

  // Phase 3 — Wait for server ready confirmation
  loadingScreen.setPhase('WAITING FOR SERVER');
  await waitForServerReady(channel);

  loadingScreen.destroy();
}

async function waitForServerReady(channel: any): Promise<void> {
  return new Promise((resolve) => {
    const handleMatchReady = () => {
      resolve();
    };
    channel.on('match_ready', handleMatchReady);
    
    setTimeout(() => {
      console.warn('[LOADING] Server ready timeout — proceeding without confirmation');
      resolve();
    }, 15000);
  });
}
