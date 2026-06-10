import * as screenManager from "./screen-manager";

export function initSplash() {
  let el = document.getElementById('splash-screen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'splash-screen';
    Object.assign(el.style, {
      position: 'fixed', inset: '0', zIndex: '1000', display: 'flex', flexDirection: 'column',
      width: '100vw', height: '100vh',
      alignItems: 'center', justifyContent: 'center',
      backgroundImage: "url('/splash_screen.png')", backgroundSize: 'cover', backgroundPosition: 'center center',
      backgroundColor: 'radial-gradient(ellipse at center, #1A1208 0%, #0A0A0A 100%)' // fallback
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
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0', zIndex: '2'
    });
    
    const loadingBarWrapper = document.createElement('div');
    Object.assign(loadingBarWrapper.style, {
      width: '120px', height: '2px', background: '#1A1A1A', overflow: 'hidden'
    });

    const loadingBarInner = document.createElement('div');
    Object.assign(loadingBarInner.style, {
      height: '100%', width: '0', background: '#C8882A', transition: 'width 2000ms ease-in-out'
    });
    loadingBarWrapper.appendChild(loadingBarInner);

    const initText = document.createElement('div');
    initText.textContent = 'CLICK TO INITIALIZE';
    Object.assign(initText.style, {
      fontFamily: "'Barlow Condensed', sans-serif", fontSize: '14px', letterSpacing: '6px',
      color: '#E8E8E8', textTransform: 'uppercase', opacity: '0', marginTop: '0', height: '0', overflow: 'hidden'
    });

    contentWrapper.appendChild(loadingBarWrapper);
    contentWrapper.appendChild(initText);
    el.appendChild(contentWrapper);
    document.body.appendChild(el);

    // Sequence on mount
    setTimeout(() => {
      loadingBarInner.style.width = '120px'; // 1. After 100ms
    }, 100);

    setTimeout(() => {
      loadingBarWrapper.style.transition = 'opacity 200ms';
      loadingBarWrapper.style.opacity = '0'; // 2. After 2100ms
    }, 2100);

    setTimeout(() => {
      initText.style.height = 'auto';
      initText.style.transition = 'opacity 500ms';
      initText.style.opacity = '1'; // 3. After 2300ms
    }, 2300);

    let breathingInterval: number;
    let interactionProcessed = false;

    setTimeout(() => {
      // 4. After 2800ms begin breathing
      let breathHigh = false;
      breathingInterval = window.setInterval(() => {
        initText.style.transition = 'opacity 2000ms ease-in-out';
        initText.style.opacity = breathHigh ? '0.6' : '1.0';
        breathHigh = !breathHigh;
      }, 2000);

      // 5. Add event listeners
      const attemptFullscreenAndGlitch = () => {
        if (interactionProcessed) return;
        interactionProcessed = true;
        clearInterval(breathingInterval);
        
        try {
          document.documentElement.requestFullscreen();
        } catch(e) {}

        document.removeEventListener('keydown', attemptFullscreenAndGlitch);
        document.removeEventListener('mousedown', attemptFullscreenAndGlitch);
        document.removeEventListener('touchstart', attemptFullscreenAndGlitch);

        // Glitch sequence
        // Toggle opacity 4 times, 80ms each: 1->0->1->0->1
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
        void scanline.offsetWidth; // flush CSS
        scanline.style.top = '100vh';
        setTimeout(() => {
           scanline.remove();
        }, 320);

      };

      document.addEventListener('keydown', attemptFullscreenAndGlitch);
      document.addEventListener('mousedown', attemptFullscreenAndGlitch);
      document.addEventListener('touchstart', attemptFullscreenAndGlitch);

    }, 2800);
  }
}
