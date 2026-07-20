import * as THREE from "three";
import { MatchController } from "../../MatchController";
import { DroneState } from "../../../shared/constants";
import { PanZoomSurface } from "../ui/PanZoomSurface";

export class MinimapSystem {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private playerArrow: HTMLElement | null = null;
  private match: MatchController;
  
  private rangeX = 160;
  private rangeZ = 300;

  private panZoom: PanZoomSurface | null = null;
  private zoom = 1.0;
  private panX = 0;
  private panY = 0;

  constructor(match: MatchController) {
    this.match = match;
    this.canvas = document.getElementById("minimap-canvas") as HTMLCanvasElement;
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
    }
    this.playerArrow = document.getElementById("minimap-player-arrow");
  }

  private isFullscreen(): boolean {
    const container = document.getElementById("minimap-container");
    return !!(container && container.classList.contains("fullscreen-minimap"));
  }

  public update(dt: number, spec: any) {
    if (!this.canvas || !document.body.contains(this.canvas)) {
      this.canvas = document.getElementById("minimap-canvas") as HTMLCanvasElement;
      if (this.canvas) {
        this.ctx = this.canvas.getContext("2d");
      }
      this.playerArrow = document.getElementById("minimap-player-arrow");
    }
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const mmCanvas = this.canvas;

    const isFS = this.isFullscreen();

    // Manage PanZoomSurface instance on-demand
    if (isFS) {
      if (!this.panZoom) {
        this.panZoom = new PanZoomSurface(mmCanvas, {
          initialZoom: 1.0,
          initialPanX: 0,
          initialPanY: 0,
          minZoom: 0.5,
          maxZoom: 5.0,
          onChange: (z, px, py) => {
            this.zoom = z;
            this.panX = px;
            this.panY = py;
          }
        });
      }
    } else {
      if (this.panZoom) {
        this.panZoom.destroy();
        this.panZoom = null;
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
      }
    }

    const dpr = window.devicePixelRatio || 1;
    const rect = mmCanvas.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : 300;
    const h = rect.height > 0 ? rect.height : 300;
    const targetW = w * dpr;
    const targetH = h * dpr;
    
    if (mmCanvas.width !== targetW) mmCanvas.width = targetW;
    if (mmCanvas.height !== targetH) mmCanvas.height = targetH;

    ctx.clearRect(0, 0, mmCanvas.width, mmCanvas.height);
    
    ctx.save();
    ctx.scale(dpr, dpr);
    
    const cx = w / 2;
    const cy = h / 2;
    
    const px = (window as any).camera?.position.x || 0;
    const pz = (window as any).camera?.position.z || 0;
    const playerYaw = (window as any).getPlayerYaw?.() || 0;

    if (this.playerArrow) {
      this.playerArrow.style.display = "flex";
      this.playerArrow.style.transform = `rotate(${-playerYaw}rad)`;
    }

    let scaleX = 1.0;
    let scaleZ = 1.0;

    if (spec) {
      if (isFS) {
        const worldX = spec.worldSize.x;
        const worldZ = spec.worldSize.z;
        const baseScale = Math.min(w / worldX, h / worldZ) * 0.95; // slightly inset to be safe
        scaleX = baseScale;
        scaleZ = baseScale;
      } else {
        const zoomFactor = 2.5;
        this.rangeX = spec.worldSize.x / zoomFactor;
        this.rangeZ = spec.worldSize.z / zoomFactor;
        scaleX = w / this.rangeX;
        scaleZ = h / this.rangeZ;
      }
    }

    // Apply Pan and Zoom inside the matrix stack if fullscreen
    ctx.save();
    if (isFS) {
      ctx.translate(this.panX, this.panY);
      // Zoom centered at canvas center
      ctx.translate(cx, cy);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-cx, -cy);
    }

    if (spec) {
      // 1. Draw Zones
      if (spec.zones) {
        for (const zone of spec.zones) {
          if (!zone || !zone.bounds) continue;
          const zWidth = zone.bounds.xMax - zone.bounds.xMin;
          const zHeight = zone.bounds.zMax - zone.bounds.zMin;
          
          const zx = cx + (zone.bounds.xMin - (isFS ? 0 : px)) * scaleX;
          const zz = cy + (zone.bounds.zMin - (isFS ? 0 : pz)) * scaleZ;
          
          ctx.fillStyle = "rgba(50,50,50,0.2)";
          ctx.strokeStyle = "rgba(255,255,255,0.05)";
          ctx.lineWidth = 1;
          ctx.fillRect(zx, zz, zWidth * scaleX, zHeight * scaleZ);
          ctx.strokeRect(zx, zz, zWidth * scaleX, zHeight * scaleZ);
        }
      }

      // 2. Draw Buildings
      if (spec.buildings) {
        for (const b of spec.buildings) {
          if (!b || !b.position || !b.size) continue;
          const bx = cx + (b.position.x - (isFS ? 0 : px)) * scaleX;
          const bz = cy + (b.position.z - (isFS ? 0 : pz)) * scaleZ;
          const bw = b.size.x * (b.scale?.x || 1) * scaleX;
          const bh = b.size.z * (b.scale?.z || 1) * scaleZ;

          ctx.fillStyle = "rgba(150,150,150,0.3)";
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 0.5;

          ctx.save();
          ctx.translate(bx, bz);
          if (b.rotation?.y) {
            ctx.rotate((-b.rotation.y * Math.PI) / 180);
          }
          ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
          ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
          ctx.restore();
        }
      }
    }

    // 3. Draw Drones
    this.match.droneJitterMap.forEach((buffer) => {
      if (buffer.count === 0) return;
      const head = buffer.states[(buffer.head - 1 + 3) % 3];
      if (!head || head.state === DroneState.DEAD) return;

      let color = "#CFCFCF"; // Ground
      if (head.type === 0 || head.type === 1 || head.type === 3)
        color = "#00AAFF"; // Air
      else if (head.type === 2) color = "#FFFF00"; // Recon

      const dx = cx + (head.posX - (isFS ? 0 : px)) * scaleX;
      const dz = cy + (head.posZ - (isFS ? 0 : pz)) * scaleZ;

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(dx, dz, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });

    ctx.restore(); // Restore Pan and Zoom stack

    // Position HTML Player Arrow
    if (this.playerArrow) {
      if (isFS) {
        // Calculate player screen position under Pan & Zoom
        const worldX_scaled = px * scaleX;
        const worldZ_scaled = pz * scaleZ;
        
        const screenX = (worldX_scaled) * this.zoom + this.panX + cx;
        const screenY = (worldZ_scaled) * this.zoom + this.panY + cy;
        
        this.playerArrow.style.left = `${screenX}px`;
        this.playerArrow.style.top = `${screenY}px`;
      } else {
        this.playerArrow.style.left = "50%";
        this.playerArrow.style.top = "50%";
      }
    }
    
    ctx.restore(); // Restore DPR stack
  }

  public dispose() {
    if (this.panZoom) {
      this.panZoom.destroy();
      this.panZoom = null;
    }
    if (this.canvas && this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.playerArrow) {
        this.playerArrow.style.display = "none";
    }
    this.canvas = null;
    this.ctx = null;
    this.playerArrow = null;
  }
}
