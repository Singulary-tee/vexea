/**
 * VEXEA Dynamic Asset Cache & Downloader
 * 
 * High-performance, zero-GC conscious IndexedDB local-storage manager.
 * Bypasses standard server disk storage, downloading resources on-demand or during
 * preloading, holding them as blobs to avoid cross-origin and memory leak overheads.
 */

import { getSettings } from "./settings";
import { DS } from "./design-system";

const DB_NAME = "VexeaLocalCache";
const STORE_NAME = "files";
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

/**
 * Initializes the IndexedDB instance.
 */
function initDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "filename" });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = (err) => {
      console.error("[Cache] Failed to open IndexedDB", err);
      reject(err);
    };
  });
}

/**
 * Retrieves a cached block from IndexedDB.
 */
async function getCachedBlob(filename: string): Promise<Blob | null> {
  const db = await initDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(filename);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.blob);
      } else {
        resolve(null);
      }
    };

    request.onerror = () => {
      resolve(null);
    };
  });
}

/**
 * Checks if a file is already cached.
 */
export async function hasCachedBlob(filename: string): Promise<boolean> {
  const db = await initDB();
  // Extract baseName for robust lookup
  const baseName = filename.substring(filename.lastIndexOf("/") + 1);
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(baseName);

    request.onsuccess = () => {
      if (request.result) {
        resolve(true);
      } else {
        resolve(false);
      }
    };

    request.onerror = () => resolve(false);
  });
}

/**
 * Stores a blob directly in IndexedDB.
 */
async function setCachedBlob(filename: string, blob: Blob): Promise<void> {
  const db = await initDB();
  const baseName = filename.substring(filename.lastIndexOf("/") + 1);
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ filename: baseName, blob, timestamp: Date.now() });

    request.onsuccess = () => resolve();
    request.onerror = () => resolve(); // fail silently, memory-only fallback is clean anyway
  });
}

/**
 * Lists all files currently in the IndexedDB cache.
 */
export async function listCachedFiles(): Promise<{ filename: string; timestamp: number; size: number }[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result || [];
      resolve(results.map((r: any) => ({
        filename: r.filename,
        timestamp: r.timestamp,
        size: r.blob ? r.blob.size : 0
      })));
    };

    request.onerror = () => resolve([]);
  });
}

/**
 * Deletes a specific file from the IndexedDB cache.
 */
export async function deleteCachedFile(filename: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(filename);

    request.onsuccess = () => {
      // Also remove from blobUrlMap if present
      if (blobUrlMap.has(filename)) {
        URL.revokeObjectURL(blobUrlMap.get(filename)!);
        blobUrlMap.delete(filename);
      }
      resolve();
    };
    request.onerror = () => resolve();
  });
}

/**
 * Clears the entire IndexedDB cache.
 */
export async function clearCache(): Promise<void> {
  const db = await initDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      // Revoke all blob URLs
      for (const url of blobUrlMap.values()) {
        URL.revokeObjectURL(url);
      }
      blobUrlMap.clear();
      resolve();
    };
    request.onerror = () => resolve();
  });
}

/**
 * Maps a requested mock/virtual filename to the actual filename present in the release.
 */
export function mapRequestedFileToReal(filename: string): string {
  const base = filename.substring(filename.lastIndexOf("/") + 1);
  if (base === "asphalt_02_1k.glb") return "asphalt_02_1k.gltf";
  if (base === "concrete_tiles_02_1k.glb") return "concrete_tiles_02_1k.gltf";
  if (base === "red_brick_03_1k.glb") return "red_brick_03_1k.gltf";
  if (base === "rocks_ground_01_1k.glb") return "rocks_ground_01_1k.gltf";
  if (base === "rocky_trail_1k.glb") return "rocky_trail_1k.gltf";
  if (base === "defaultmaterial.glb" || base === "defaultmaterial_1.glb") return "concrete_block_low_poly.glb";
  if (base === "single_arm.glb" || base === "double_arm.glb") return "StreetLightPoles.glb";
  if (base === "single_arm_1.glb" || base === "double_arm_1.glb") return "StreetLightPoles.gltf";
  return base;
}

export const blobUrlMap = new Map<string, string>();

export async function populateBlobUrlMap(): Promise<void> {
  const db = await initDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();

    for (const url of blobUrlMap.values()) {
      URL.revokeObjectURL(url);
    }
    blobUrlMap.clear();

    request.onsuccess = (event: any) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        const blobUrl = URL.createObjectURL(record.blob);
        blobUrlMap.set(record.filename, blobUrl);
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => resolve();
  });
}

/**
 * Static lists of required files for maps
 */
export const MAP_1_ASSETS = [
  "grenade.glb",
  "bpre_rifleman.glb",
  "concrete_fence_low-poly.glb",
  "quadcopter_rifle.glb",
  "quadcopter_bomb.glb",
  "wheeled_drone.glb",
  "fixed_wing_drone.glb",
  "quadcopter_camera.glb",
  "security_camera_01_1k.gltf.glb",
  "security_camera_02_1k.gltf.glb",
  "concrete_block_low_poly.glb",
  "StreetLightPoles.glb",
  "StreetLightPoles.gltf",
  "StreetLightPoles.bin",
  "asphalt_02_1k.gltf",
  "asphalt_02.bin",
  "asphalt_02_diff_1k.jpg",
  "asphalt_02_nor_gl_1k.jpg",
  "asphalt_02_arm_1k.jpg",
  "concrete_tiles_02_1k.gltf",
  "concrete_tiles_02.bin",
  "concrete_tiles_02_diff_1k.jpg",
  "concrete_tiles_02_nor_gl_1k.jpg",
  "concrete_tiles_02_arm_1k.jpg",
  "red_brick_03_1k.gltf",
  "red_brick_03.bin",
  "red_brick_03_diff_1k.jpg",
  "red_brick_03_nor_gl_1k.jpg",
  "red_brick_03_arm_1k.jpg",
  "rocks_ground_01_1k.gltf",
  "rocks_ground_01.bin",
  "rocks_ground_01_diff_1k.jpg",
  "rocks_ground_01_nor_gl_1k.jpg",
  "rocks_ground_01_arm_1k.jpg",
  "rocky_trail_1k.gltf",
  "rocky_trail.bin",
  "rocky_trail_diff_1k.jpg",
  "rocky_trail_nor_gl_1k.jpg",
  "rocky_trail_arm_1k.jpg"
];

export const REQUIRED_SOUNDS = [
  "vexea_theme.mp3",
  "bass_scratch.mp3",
  "iron_march.mp3",
  "click.mp3",
  "error.mp3",
  "metal_ricochet.mp3",
  "wood_walk.mp3",
  "concrete_run.mp3",
  "concrete_walk.mp3",
  "rifle_reload.mp3",
  "pistol_reload.mp3",
  "pistol_fire.mp3",
  "rifle_fire.mp3"
];

export function getRequiredFilesForMap(mapId: string): { name: string; cat: "Asset" | "Sound" | "Image" }[] {
  if (mapId === 'map_1_facility') {
    return [
      ...MAP_1_ASSETS.map(name => ({ name, cat: "Asset" as const })),
      ...REQUIRED_SOUNDS.map(name => ({ name, cat: "Sound" as const })),
      { name: "Surface_Impact.png", cat: "Image" as const }
    ];
  }
  return []; // Dev maps do not require external downloads
}

export async function getMissingFilesForMap(mapId: string): Promise<{ name: string; cat: "Asset" | "Sound" | "Image" }[]> {
  const reqs = getRequiredFilesForMap(mapId);
  const missing: { name: string; cat: "Asset" | "Sound" | "Image" }[] = [];
  for (const item of reqs) {
    const hasCached = await hasCachedBlob(item.name);
    if (!hasCached) {
      missing.push(item);
    }
  }
  return missing;
}

export async function downloadMapAssets(
  mapId: string,
  onProgress: (progress: { loaded: number; total: number; currentFile: string; filePercent: number }) => void
): Promise<void> {
  const missing = await getMissingFilesForMap(mapId);
  if (missing.length === 0) return;

  const total = missing.length;
  let loaded = 0;

  for (const item of missing) {
    onProgress({ loaded, total, currentFile: item.name, filePercent: 0 });
    try {
      await getCachedOrFetchUrl(item.name, item.cat, (percent) => {
        onProgress({ loaded, total, currentFile: item.name, filePercent: percent });
      });
    } catch (e) {
      console.error(`[Cache] Error preloading ${item.name}:`, e);
    }
    loaded++;
    onProgress({ loaded, total, currentFile: item.name, filePercent: 100 });
  }
}

/**
 * Normalizes filenames and fetches them from high-performance releases.
 */
export async function getCachedOrFetchUrl(
  filename: string,
  category: "Asset" | "Sound" | "Video" | "Image",
  onProgress?: (progress: number) => void
): Promise<string> {
  let localPath = filename;
  if (localPath.startsWith("client/public/")) {
    localPath = "/" + localPath.substring("client/public/".length);
  } else if (!localPath.startsWith("/") && !localPath.startsWith("http")) {
    // If it's a relative path name like 'defaultmaterial.glb', prepend the mapping prefix
    if (category === "Asset") {
      localPath = "/assets/maps/map_1/" + localPath;
    } else {
      localPath = "/" + localPath;
    }
  }

  try {
    // 1. Clean filename from any subfolders for release pulling and map to real name
    const requestedName = filename.substring(filename.lastIndexOf("/") + 1);
    const baseName = mapRequestedFileToReal(requestedName);

    // 2. Check Local Cache first
    const cachedBlob = await getCachedBlob(baseName);
    if (cachedBlob) {
      if (onProgress) onProgress(100);
      return URL.createObjectURL(cachedBlob);
    }

    // 3. Download from appropriate GitHub Release CDN
    const baseUrl =
      category === "Asset"
        ? "https://github.com/Singulary-tee/vexea/releases/download/Asset"
        : category === "Video"
        ? "https://github.com/Singulary-tee/vexea/releases/download/Video"
        : category === "Image"
        ? "https://github.com/Singulary-tee/vexea/releases/download/Images"
        : "https://github.com/Singulary-tee/vexea/releases/download/Sound";

    const downloadUrl = baseName === "faction_card.jpg" 
      ? "https://s3.filebase.com/vexea-international/Images/Backgrounds/faction_card.jpg"
      : `${baseUrl}/${baseName}`;
      
    const s = getSettings();
    const serverPrefix = s.serverUrl ? s.serverUrl.replace(/\/$/, "") : "";
    const proxyUrl = `${serverPrefix}/api/proxy-asset?url=${encodeURIComponent(downloadUrl)}`;

    const isAiStudio = typeof window !== "undefined" && (
      window.location.hostname.endsWith(".run.app") ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    );

    let response: Response;
    if (!isAiStudio) {
      // Production builds outside of AI Studio must fetch directly from CDN without server proxy
      response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`[Cache] CDN fetch failed for ${baseName}: status ${response.status} ${response.statusText}`);
      }
    } else {
      try {
        response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error(`Direct CDN fetch failed: status ${response.status}`);
        }
      } catch (directErr) {
        console.warn(`[Cache] Direct CDN fetch failed for ${baseName}, attempting proxy fallback:`, directErr);
        response = await fetch(proxyUrl);
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(`[Cache] CDN fetch failed for ${baseName} via proxy fallback: ${response.status} ${response.statusText} - ${errorText}`);
        }
      }
    }

    // Wrap reader to track progress
    const reader = response.body?.getReader();
    const contentLength = +(response.headers.get("Content-Length") || "0");

    let receivedLength = 0;
    const chunks: Uint8Array[] = [];

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedLength += value.length;

        if (contentLength && onProgress) {
          onProgress(Math.min(99, Math.floor((receivedLength / contentLength) * 100)));
        }
      }
    }

    // Assemble blob
    const fullBuffer = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      fullBuffer.set(chunk, position);
      position += chunk.length;
    }

    const mime =
      category === "Sound"
        ? "audio/mp3"
        : category === "Video"
        ? "video/mp4"
        : category === "Image"
        ? (baseName.toLowerCase().endsWith(".jpg") || baseName.toLowerCase().endsWith(".jpeg") ? "image/jpeg" : "image/png")
        : "application/octet-stream";
    const blob = new Blob([fullBuffer], { type: mime });

    // Cache it asynchronously
    await setCachedBlob(baseName, blob);

    if (onProgress) onProgress(100);
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error(`[Cache] Fallback redirect activated for ${filename} due to:`, error);
    // Ultimate local backup fallback so development continues uninterrupted
    return localPath;
  }
}

/**
 * Returns the cached local blob URL if present in blobUrlMap, falling back to "/" paths.
 */
export function getAssetUrl(filename: string): string {
  const base = filename.substring(filename.lastIndexOf("/") + 1);
  if (blobUrlMap.has(base)) {
    return blobUrlMap.get(base)!;
  }
  return "/" + base;
}

export async function ensureAssetsDownloaded(onComplete: () => void, mapId: string) {
  const missingAssets = await getMissingFilesForMap(mapId);

  if (missingAssets.length === 0) {
    await populateBlobUrlMap();
    onComplete();
    return;
  }

  // Create Popup Modal
  const modal = document.createElement("div");
  Object.assign(modal.style, {
    position: "fixed", inset: "0", zIndex: "9999", display: "flex",
    alignItems: "center", justifyContent: "center", background: DS.utils.rgba('#000000', 0.85),
    backdropFilter: "blur(4px)"
  });

  const dialog = document.createElement("div");
  Object.assign(dialog.style, {
    background: DS.colors.background, border: `${DS.borders.thin} ${DS.colors.accent}`, padding: DS.spacing.xxl,
    display: "flex", flexDirection: "column", gap: DS.spacing.xl, minWidth: "300px", maxWidth: "400px"
  });

  const title = document.createElement("div");
  title.textContent = "GAME ASSETS REQUIRED";
  Object.assign(title.style, {
    fontFamily: DS.typography.fontFamily, fontSize: "20px", color: DS.colors.accent,
    fontWeight: "bold", textTransform: "uppercase"
  });

  const desc = document.createElement("div");
  desc.textContent = `To enter the match, the engine needs to download missing combat assets. Proceed?`;
  Object.assign(desc.style, { fontFamily: DS.typography.fontFamily, fontSize: "14px", color: "#E8E8E8" });

  const progressWrap = document.createElement("div");
  Object.assign(progressWrap.style, { display: "none", flexDirection: "column", gap: "8px" });
  
  const barWrapper = document.createElement("div");
  Object.assign(barWrapper.style, { width: "100%", height: "4px", background: "#1A1A1A" });
  const barInner = document.createElement("div");
  Object.assign(barInner.style, { width: "0%", height: "100%", background: DS.colors.accent, transition: "width 0.1s" });
  barWrapper.appendChild(barInner);
  
  const progressText = document.createElement("div");
  Object.assign(progressText.style, { fontFamily: DS.typography.fontFamily, fontSize: "12px", color: "#888888" });
  
  progressWrap.appendChild(barWrapper);
  progressWrap.appendChild(progressText);

  const btnWrap = document.createElement("div");
  Object.assign(btnWrap.style, { display: "flex", gap: "12px", marginTop: "8px" });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "CANCEL";
  Object.assign(cancelBtn.style, {
    flex: "1", padding: "8px", background: "transparent", border: "1px solid #555",
    color: "#888", fontFamily: DS.typography.fontFamily, cursor: "pointer"
  });
  cancelBtn.addEventListener("click", () => document.body.removeChild(modal));

  const acceptBtn = document.createElement("button");
  acceptBtn.textContent = "DOWNLOAD";
  Object.assign(acceptBtn.style, {
    flex: "1", padding: "8px", background: DS.colors.accent, border: "none",
    color: DS.colors.background, fontFamily: DS.typography.fontFamily, fontWeight: "bold", cursor: "pointer"
  });

  acceptBtn.addEventListener("click", async () => {
    btnWrap.style.display = "none";
    progressWrap.style.display = "flex";
    
    let completed = 0;
    const total = missingAssets.length;
    
    const workerCount = 4;
    const processQueue = async () => {
      while (missingAssets.length > 0) {
        const item = missingAssets.shift();
        if (item) {
          try { await getCachedOrFetchUrl(item.name, item.cat); } catch(e) {}
          completed++;
          const p = Math.floor((completed / total) * 100);
          barInner.style.width = p + "%";
          progressText.textContent = `Downloading... ${completed}/${total} (${p}%)`;
        }
      }
    };
    
    await Promise.all(Array(workerCount).fill(0).map(processQueue));
    await populateBlobUrlMap();
    
    progressText.textContent = "VEXEA SYSTEM READY";
    setTimeout(() => {
      document.body.removeChild(modal);
      onComplete();
    }, 500);
  });

  btnWrap.appendChild(cancelBtn);
  btnWrap.appendChild(acceptBtn);

  dialog.appendChild(title);
  dialog.appendChild(desc);
  dialog.appendChild(progressWrap);
  dialog.appendChild(btnWrap);
  modal.appendChild(dialog);
  document.body.appendChild(modal);
}
