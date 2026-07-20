import * as screenManager from "./screen-manager";
import { getAssetUrl } from "../asset-cache";
import { PanZoomSurface } from "../src/ui/PanZoomSurface";

export function initDevMapEditor() {
    let el = document.getElementById('dev-map-editor-screen');
    if (!el) {
        el = document.createElement('div');
        el.id = 'dev-map-editor-screen';
        document.body.appendChild(el);
    }
    
    // Clear and build DOM
    el.innerHTML = '';
    Object.assign(el.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '1500',
        display: 'none',
        backgroundColor: '#0A0A0A',
        overflow: 'hidden',
        touchAction: 'none' // Prevent browser pinch-to-zoom and scrolling
    });

    // We use a transform container to hold both the image and the grid canvas.
    // This guarantees zero drift since they are transformed by the exact same CSS matrix.
    const transformContainer = document.createElement('div');
    Object.assign(transformContainer.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        transformOrigin: '0 0',
        pointerEvents: 'none'
    });
    
    const bgImg = document.createElement('img');
    Object.assign(bgImg.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        pointerEvents: 'none',
        display: 'block'
    });

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        pointerEvents: 'none'
    });
    
    transformContainer.appendChild(bgImg);
    transformContainer.appendChild(canvas);
    el.appendChild(transformContainer);

    // Info overlay
    const uiOverlay = document.createElement('div');
    Object.assign(uiOverlay.style, {
        position: 'absolute',
        top: '20px',
        left: '20px',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: '14px',
        pointerEvents: 'none',
        textShadow: '1px 1px 0 #000'
    });
    el.appendChild(uiOverlay);

    // Back button
    const backBtn = document.createElement('button');
    backBtn.textContent = 'BACK';
    Object.assign(backBtn.style, {
        position: 'absolute',
        bottom: '20px',
        left: '20px',
        padding: '10px 20px',
        backgroundColor: '#f0f',
        color: '#fff',
        border: 'none',
        fontWeight: 'bold',
        cursor: 'pointer',
        pointerEvents: 'auto',
        zIndex: '10'
    });
    el.appendChild(backBtn);

    let zoom = 1.0;
    let panX = 0;
    let panY = 0;

    const updateTransform = () => {
        transformContainer.style.transform = `matrix(${zoom}, 0, 0, ${zoom}, ${panX}, ${panY})`;
        uiOverlay.innerHTML = `Zoom: ${zoom.toFixed(2)}<br>Pan: (${panX.toFixed(0)}, ${panY.toFixed(0)})`;
    };

    const panZoom = new PanZoomSurface(el, {
        initialZoom: 1.0,
        initialPanX: 0,
        initialPanY: 0,
        minZoom: 0.1,
        maxZoom: 10.0,
        onChange: (z, px, py) => {
            zoom = z;
            panX = px;
            panY = py;
            updateTransform();
        }
    });

    backBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panZoom.destroy();
        screenManager.showMainMenu(); // Or a mechanism to remember previous screen if needed
    });

    const drawGridAndMarker = () => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const w = bgImg.naturalWidth || 2048;
        const h = bgImg.naturalHeight || 2048;
        
        canvas.width = w;
        canvas.height = h;
        
        ctx.clearRect(0, 0, w, h);
        
        // Draw grid every 32 pixels
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
        ctx.lineWidth = 1;
        
        ctx.beginPath();
        for (let x = 0; x <= w; x += 32) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
        }
        for (let y = 0; y <= h; y += 32) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
        }
        ctx.stroke();

        // Draw red dot at (384, 384)
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(384, 384, 5, 0, Math.PI * 2);
        ctx.fill();
    };

    bgImg.onload = () => {
        drawGridAndMarker();
        updateTransform();
    };
    bgImg.src = getAssetUrl('Blueprint.png');
    
    // In case the image is already cached/loaded
    if (bgImg.complete && bgImg.naturalWidth > 0) {
        drawGridAndMarker();
        updateTransform();
    }

    updateTransform();
}
