import { IS_DESKTOP, IS_MOBILE } from '../../platform-gate';

export class PanZoomSurface {
  private element: HTMLElement;
  private zoom: number = 1.0;
  private panX: number = 0;
  private panY: number = 0;
  
  private minZoom: number;
  private maxZoom: number;
  
  private onChange: (zoom: number, panX: number, panY: number) => void;
  
  private isPanning: boolean = false;
  private lastPanX: number = 0;
  private lastPanY: number = 0;
  
  private initialPinchDist: number = 0;
  private initialZoom: number = 1.0;
  private initialPanX: number = 0;
  private initialPanY: number = 0;
  private initialPinchCenterX: number = 0;
  private initialPinchCenterY: number = 0;
  
  private activePointers: Map<number, PointerEvent> = new Map();
  
  constructor(
    element: HTMLElement,
    options: {
      initialZoom?: number;
      initialPanX?: number;
      initialPanY?: number;
      minZoom?: number;
      maxZoom?: number;
      onChange: (zoom: number, panX: number, panY: number) => void;
    }
  ) {
    this.element = element;
    this.zoom = options.initialZoom ?? 1.0;
    this.panX = options.initialPanX ?? 0;
    this.panY = options.initialPanY ?? 0;
    this.minZoom = options.minZoom ?? 0.1;
    this.maxZoom = options.maxZoom ?? 10.0;
    this.onChange = options.onChange;
    
    this.setupEvents();
  }

  public getZoom(): number {
    return this.zoom;
  }

  public getPanX(): number {
    return this.panX;
  }

  public getPanY(): number {
    return this.panY;
  }

  public setZoom(zoom: number) {
    this.zoom = Math.max(this.minZoom, Math.min(zoom, this.maxZoom));
    this.onChange(this.zoom, this.panX, this.panY);
  }

  public setPan(panX: number, panY: number) {
    this.panX = panX;
    this.panY = panY;
    this.onChange(this.zoom, this.panX, this.panY);
  }

  public reset(zoom: number = 1.0, panX: number = 0, panY: number = 0) {
    this.zoom = zoom;
    this.panX = panX;
    this.panY = panY;
    this.onChange(this.zoom, this.panX, this.panY);
  }

  private getPinchCenter(p1: PointerEvent, p2: PointerEvent) {
    return {
      x: (p1.clientX + p2.clientX) / 2,
      y: (p1.clientY + p2.clientY) / 2
    };
  }

  private getPinchDistance(p1: PointerEvent, p2: PointerEvent) {
    const dx = p1.clientX - p2.clientX;
    const dy = p1.clientY - p2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private handlePointerDown = (e: PointerEvent) => {
    if (IS_DESKTOP && e.pointerType !== 'mouse') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    
    this.activePointers.set(e.pointerId, e);
    
    if (this.activePointers.size === 1) {
      this.isPanning = true;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
    } else if (this.activePointers.size === 2) {
      this.isPanning = false;
      const pointers = Array.from(this.activePointers.values());
      this.initialPinchDist = this.getPinchDistance(pointers[0], pointers[1]);
      const center = this.getPinchCenter(pointers[0], pointers[1]);
      this.initialPinchCenterX = center.x;
      this.initialPinchCenterY = center.y;
      this.initialZoom = this.zoom;
      this.initialPanX = this.panX;
      this.initialPanY = this.panY;
    }
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (IS_DESKTOP && e.pointerType !== 'mouse') return;
    if (!this.activePointers.has(e.pointerId)) return;
    this.activePointers.set(e.pointerId, e);
    
    if (this.activePointers.size === 1 && this.isPanning) {
      const dx = e.clientX - this.lastPanX;
      const dy = e.clientY - this.lastPanY;
      this.panX += dx;
      this.panY += dy;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.onChange(this.zoom, this.panX, this.panY);
    } else if (this.activePointers.size === 2) {
      const pointers = Array.from(this.activePointers.values());
      const currentDist = this.getPinchDistance(pointers[0], pointers[1]);
      const currentCenter = this.getPinchCenter(pointers[0], pointers[1]);
      
      const scaleFactor = currentDist / this.initialPinchDist;
      let newZoom = this.initialZoom * scaleFactor;
      newZoom = Math.max(this.minZoom, Math.min(newZoom, this.maxZoom));
      
      const rect = this.element.getBoundingClientRect();
      
      const localX = (this.initialPinchCenterX - rect.left - this.initialPanX) / this.initialZoom;
      const localY = (this.initialPinchCenterY - rect.top - this.initialPanY) / this.initialZoom;
      
      this.zoom = newZoom;
      this.panX = currentCenter.x - rect.left - localX * this.zoom;
      this.panY = currentCenter.y - rect.top - localY * this.zoom;
      
      this.onChange(this.zoom, this.panX, this.panY);
    }
  };

  private handlePointerUp = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size === 0) {
      this.isPanning = false;
    } else if (this.activePointers.size === 1) {
      const remainingPointer = Array.from(this.activePointers.values())[0];
      this.isPanning = true;
      this.lastPanX = remainingPointer.clientX;
      this.lastPanY = remainingPointer.clientY;
    }
  };

  private handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.element.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const localX = (mouseX - this.panX) / this.zoom;
    const localY = (mouseY - this.panY) / this.zoom;
    
    const zoomDelta = e.deltaY < 0 ? 1.1 : 0.9;
    let newZoom = this.zoom * zoomDelta;
    newZoom = Math.max(this.minZoom, Math.min(newZoom, this.maxZoom));
    
    this.zoom = newZoom;
    this.panX = mouseX - localX * this.zoom;
    this.panY = mouseY - localY * this.zoom;
    
    this.onChange(this.zoom, this.panX, this.panY);
  };

  private setupEvents() {
    this.element.addEventListener('pointerdown', this.handlePointerDown);
    this.element.addEventListener('pointermove', this.handlePointerMove);
    this.element.addEventListener('pointerup', this.handlePointerUp);
    this.element.addEventListener('pointercancel', this.handlePointerUp);
    if (!IS_MOBILE) {
      this.element.addEventListener('wheel', this.handleWheel, { passive: false });
    }
  }

  public destroy() {
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerUp);
    if (!IS_MOBILE) {
      this.element.removeEventListener('wheel', this.handleWheel);
    }
    this.activePointers.clear();
  }
}
