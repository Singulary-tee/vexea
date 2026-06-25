import * as screenManager from "./screen-manager";
import { getCachedOrFetchUrl, getAssetUrl, populateBlobUrlMap } from "../asset-cache";

const SOUNDS_TO_PRELOAD = [
  'click.mp3', 'vexea_theme.mp3'
];

const TEXTURES_TO_PRELOAD: string[] = [
];

const IMAGES_TO_PRELOAD = [
  'splash_screen.png',
  'vibeCo_card.png',
  'slopInc_card.png',
  'multiplayer_card.png',
  'statistics_card.png',
  'store_card.png',
  'feedback_card.png',
  'Blueprint.png',
  'file_00000000cdd071f48495d22753c89fa1.png'
];

const VIDEOS_TO_PRELOAD = [
  'Mainvideo1.mp4', 'Mainvideo2.mp4', 'Mainvideo3.mp4'
];

// The rest of the game assets
export const EXTENDED_SOUNDS = [
  'bass_scratch.mp3', 'concrete_run.mp3', 'concrete_walk.mp3',
  'error.mp3', 'iron_march.mp3', 'metal_ricochet.mp3', 'pistol_fire.mp3',
  'pistol_reload.mp3', 'rifle_fire.mp3', 'rifle_reload.mp3',
  'wood_walk.mp3'
];

export const EXTENDED_TEXTURES = [
  'asphalt_02_diff_1k.jpg', 'asphalt_02_nor_gl_1k.jpg', 'asphalt_02_arm_1k.jpg',
  'concrete_tiles_02_diff_1k.jpg', 'concrete_tiles_02_nor_gl_1k.jpg', 'concrete_tiles_02_arm_1k.jpg',
  'red_brick_03_diff_1k.jpg', 'red_brick_03_nor_gl_1k.jpg', 'red_brick_03_arm_1k.jpg',
  'rocks_ground_01_diff_1k.jpg', 'rocks_ground_01_nor_gl_1k.jpg', 'rocks_ground_01_arm_1k.jpg',
  'rocky_trail_diff_1k.jpg', 'rocky_trail_nor_gl_1k.jpg', 'rocky_trail_arm_1k.jpg'
];

export function initSplash() {
  let el = document.getElementById('splash-screen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'splash-screen';
    document.body.appendChild(el);
  }

  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '1000',
    backgroundSize: 'cover',
    backgroundPosition: 'center center',
    backgroundColor: '#0A0A0A'
  });

  // Attempt to resolve from cache immediately. If cached, apply background.
  populateBlobUrlMap().then(() => {
    if (el) {
      el.style.backgroundImage = `url('${getAssetUrl("splash_screen.png")}')`;
    }
  });

  if (el.children.length === 0) {
    Object.assign(el.style, {
      display: 'flex', flexDirection: 'column',
      width: '100vw', height: '100vh',
      alignItems: 'center', justifyContent: 'center'
    });

    const vignette = document.createElement('div');
    Object.assign(vignette.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1',
      background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.85) 100%)'
    });
    el.appendChild(vignette);

    const contentWrapper = document.createElement('div');
    Object.assign(contentWrapper.style, {
      position: 'absolute', top: '66%', left: '50%', transform: 'translate(-50%, -50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', zIndex: '2'
    });
    
    const loadingBarWrapper = document.createElement('div');
    Object.assign(loadingBarWrapper.style, {
      width: '120px', height: '2px', background: '#1A1A1A', overflow: 'hidden'
    });

    const loadingBarInner = document.createElement('div');
    Object.assign(loadingBarInner.style, {
      height: '100%', width: '0', background: '#C8882A'
    });
    loadingBarWrapper.appendChild(loadingBarInner);

    const initText = document.createElement('div');
    initText.textContent = 'CHARGING SYSTEM CACHE... 0%';
    Object.assign(initText.style, {
      fontFamily: "'Barlow Condensed', sans-serif", fontSize: '13px', letterSpacing: '4px',
      color: '#E8E8E8', textTransform: 'uppercase', opacity: '1', marginTop: '0', height: 'auto'
    });

    contentWrapper.appendChild(loadingBarWrapper);
    contentWrapper.appendChild(initText);
    el.appendChild(contentWrapper);
    document.body.appendChild(el);

    const preloadAll = async () => {
      const allFiles = [
        ...SOUNDS_TO_PRELOAD.map(f => ({ name: f, cat: 'Sound' as const })),
        ...TEXTURES_TO_PRELOAD.map(f => ({ name: f, cat: 'Asset' as const })),
        ...IMAGES_TO_PRELOAD.map(f => ({ name: f, cat: 'Image' as const })),
        ...VIDEOS_TO_PRELOAD.map(f => ({ name: f, cat: 'Video' as const }))
      ];
      const total = allFiles.length;
      let completed = 0;

      const processItem = async (item: typeof allFiles[0]) => {
        try {
          await getCachedOrFetchUrl(item.name, item.cat);
        } catch (e) {
          console.warn("[Preload] Failed item:", item.name);
        }
        completed++;
        const percent = Math.floor((completed / total) * 100);
        loadingBarInner.style.transition = 'width 100ms ease-out';
        loadingBarInner.style.width = `${Math.floor((completed / total) * 120)}px`;
        initText.textContent = `CHARGING SYSTEM CACHE... ${percent}%`;
      };

      const queue = [...allFiles];
      const workerCount = 4;
      const workers = Array(workerCount).fill(null).map(async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (item) {
            await processItem(item);
          }
        }
      });

      await Promise.all(workers);
      await populateBlobUrlMap();

      if (el) {
        el.style.backgroundImage = `url('${getAssetUrl("splash_screen.png")}')`;
      }

      loadingBarInner.style.width = '120px';

      setTimeout(() => {
        loadingBarWrapper.style.transition = 'opacity 200ms';
        loadingBarWrapper.style.opacity = '0';
      }, 500);

      setTimeout(() => {
        initText.textContent = 'CLICK TO INITIALIZE';
        startInteractions();
      }, 1000);
    };

    let breathingInterval: number;
    let interactionProcessed = false;

    const startInteractions = () => {
      let breathHigh = false;
      breathingInterval = window.setInterval(() => {
        initText.style.transition = 'opacity 2000ms ease-in-out';
        initText.style.opacity = breathHigh ? '0.6' : '1.0';
        breathHigh = !breathHigh;
      }, 2000);

      const attemptFullscreenAndGlitch = () => {
        if (interactionProcessed) return;
        interactionProcessed = true;
        clearInterval(breathingInterval);
        
        const docEl = document.documentElement as any;
        if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
            if (docEl.requestFullscreen) docEl.requestFullscreen();
            else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
        }

        document.removeEventListener('keydown', attemptFullscreenAndGlitch);
        document.removeEventListener('click', attemptFullscreenAndGlitch);
        document.removeEventListener('touchend', attemptFullscreenAndGlitch);

        let toggles = 0;
        const glitchFn = () => {
          toggles++;
          if (toggles <= 4) {
             el!.style.opacity = toggles % 2 === 1 ? '0' : '1';
             if (toggles <= 2) {
                 el!.style.filter = 'hue-rotate(90deg) brightness(2)';
             } else {
                 el!.style.filter = 'none';
             }
             setTimeout(glitchFn, 80);
          } else {
             el!.style.opacity = '1';
             el!.style.filter = 'none';
             screenManager.showMainMenu();
          }
        };
        glitchFn();

        const scanline = document.createElement('div');
        Object.assign(scanline.style, {
           position: 'fixed', width: '100%', height: '3px', background: '#C8882A',
           top: '0', zIndex: '9999', transition: 'top 320ms linear'
        });
        document.body.appendChild(scanline);
        void scanline.offsetWidth;
        scanline.style.top = '100vh';
        setTimeout(() => {
           scanline.remove();
        }, 320);
      };

      document.addEventListener('keydown', attemptFullscreenAndGlitch);
      document.addEventListener('click', attemptFullscreenAndGlitch);
      document.addEventListener('touchend', attemptFullscreenAndGlitch);
    };

    preloadAll();
  }
}

