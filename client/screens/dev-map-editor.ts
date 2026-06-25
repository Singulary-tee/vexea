import * as screenManager from "./screen-manager";
import { getAssetUrl } from "../asset-cache";

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
    backBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        screenManager.showMainMenu(); // Or a mechanism to remember previous screen if needed
    });
    el.appendChild(backBtn);

    let zoom = 1.0;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let lastPanX = 0;
    let lastPanY = 0;

    let initialPinchDist = 0;
    let initialZoom = 1.0;
    let initialPinchCenter = { x: 0, y: 0 };
    let initialPanX = 0;
    let initialPanY = 0;
    
    let activePointers = new Map<number, PointerEvent>();

    const updateTransform = () => {
        transformContainer.style.transform = `matrix(${zoom}, 0, 0, ${zoom}, ${panX}, ${panY})`;
        uiOverlay.innerHTML = `Zoom: ${zoom.toFixed(2)}<br>Pan: (${panX.toFixed(0)}, ${panY.toFixed(0)})`;
    };

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

    const getPinchCenter = (p1: PointerEvent, p2: PointerEvent) => {
        return {
            x: (p1.clientX + p2.clientX) / 2,
            y: (p1.clientY + p2.clientY) / 2
        };
    };

    const getPinchDistance = (p1: PointerEvent, p2: PointerEvent) => {
        const dx = p1.clientX - p2.clientX;
        const dy = p1.clientY - p2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    el.addEventListener('pointerdown', (e) => {
        // Only accept primary button for mouse
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        
        activePointers.set(e.pointerId, e);
        
        if (activePointers.size === 1) {
            isPanning = true;
            lastPanX = e.clientX;
            lastPanY = e.clientY;
        } else if (activePointers.size === 2) {
            isPanning = false;
            const pointers = Array.from(activePointers.values());
            initialPinchDist = getPinchDistance(pointers[0], pointers[1]);
            initialPinchCenter = getPinchCenter(pointers[0], pointers[1]);
            initialZoom = zoom;
            initialPanX = panX;
            initialPanY = panY;
        }
    });

    el.addEventListener('pointermove', (e) => {
        if (!activePointers.has(e.pointerId)) return;
        activePointers.set(e.pointerId, e);
        
        if (activePointers.size === 1 && isPanning) {
            const dx = e.clientX - lastPanX;
            const dy = e.clientY - lastPanY;
            panX += dx;
            panY += dy;
            lastPanX = e.clientX;
            lastPanY = e.clientY;
            updateTransform();
        } else if (activePointers.size === 2) {
            const pointers = Array.from(activePointers.values());
            const currentDist = getPinchDistance(pointers[0], pointers[1]);
            const currentCenter = getPinchCenter(pointers[0], pointers[1]);
            
            // Calculate new zoom
            const scaleFactor = currentDist / initialPinchDist;
            let newZoom = initialZoom * scaleFactor;
            newZoom = Math.max(0.1, Math.min(newZoom, 10.0)); // Clamp limits
            
            const rect = el!.getBoundingClientRect();
            
            // Point in local coordinates from initial state
            const localX = (initialPinchCenter.x - rect.left - initialPanX) / initialZoom;
            const localY = (initialPinchCenter.y - rect.top - initialPanY) / initialZoom;
            
            // Set new zoom
            zoom = newZoom;
            
            // Set new pan so localX, localY matches currentCenter
            panX = currentCenter.x - rect.left - localX * zoom;
            panY = currentCenter.y - rect.top - localY * zoom;
            
            updateTransform();
        }
    });

    const pointerUpHandler = (e: PointerEvent) => {
        activePointers.delete(e.pointerId);
        if (activePointers.size === 0) {
            isPanning = false;
        } else if (activePointers.size === 1) {
            // Revert to panning with remaining finger
            const remainingPointer = Array.from(activePointers.values())[0];
            isPanning = true;
            lastPanX = remainingPointer.clientX;
            lastPanY = remainingPointer.clientY;
        }
    };

    el.addEventListener('pointerup', pointerUpHandler);
    el.addEventListener('pointercancel', pointerUpHandler);
    el.addEventListener('pointerout', (e) => {
        // pointerout can trigger when hovering over child elements if they had pointer-events,
        // but we have none. Still safe to handle.
        if (e.target === el) pointerUpHandler(e);
    });

    // Support mouse wheel zooming as well
    el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = el!.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const localX = (mouseX - panX) / zoom;
        const localY = (mouseY - panY) / zoom;
        
        const zoomDelta = e.deltaY < 0 ? 1.1 : 0.9;
        let newZoom = zoom * zoomDelta;
        newZoom = Math.max(0.1, Math.min(newZoom, 10.0));
        
        zoom = newZoom;
        panX = mouseX - localX * zoom;
        panY = mouseY - localY * zoom;
        
        updateTransform();
    }, { passive: false });

    updateTransform();
}
