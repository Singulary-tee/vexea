import * as THREE from "three";
import { MatchController } from "../../MatchController";
import { DroneState } from "../../../shared/constants";

export class MinimapSystem {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private playerArrow: HTMLElement | null = null;
  private match: MatchController;
  
  private rangeX = 160;
  private rangeZ = 300;

  constructor(match: MatchController) {
    this.match = match;
    this.canvas = document.getElementById("minimap-canvas") as HTMLCanvasElement;
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
    }
    this.playerArrow = document.getElementById("minimap-player-arrow");
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

    // Ensure native canvas resolution matches CSS
    const rect = mmCanvas.getBoundingClientRect();
    const targetW = rect.width > 0 ? rect.width : 300;
    const targetH = rect.height > 0 ? rect.height : 300;
    if (mmCanvas.width !== targetW) mmCanvas.width = targetW;
    if (mmCanvas.height !== targetH) mmCanvas.height = targetH;

    // Update range based on map spec
    this.rangeX = spec ? spec.worldSize.x : 160;
    this.rangeZ = spec ? spec.worldSize.z : 300;

    ctx.clearRect(0, 0, mmCanvas.width, mmCanvas.height);
    const w = mmCanvas.width;
    const h = mmCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    
    // Use camera position from match (passed via main.ts camera for now)
    const px = (window as any).camera?.position.x || 0;
    const pz = (window as any).camera?.position.z || 0;
    const playerYaw = (window as any).getPlayerYaw?.() || 0;

    if (this.playerArrow) {
      this.playerArrow.style.display = "flex";
      this.playerArrow.style.transform = `rotate(${-playerYaw}rad)`;
    }

    if (spec) {
      const scaleX = w / this.rangeX;
      const scaleZ = h / this.rangeZ;

      if (spec.zones) {
        for (const zone of spec.zones) {
          if (!zone || !zone.bounds) continue;
          const zWidth = zone.bounds.xMax - zone.bounds.xMin;
          const zHeight = zone.bounds.zMax - zone.bounds.zMin;
          const zx = cx + (zone.bounds.xMin - px) * scaleX;
          const zz = cy + (zone.bounds.zMin - pz) * scaleZ;
          ctx.fillStyle = "rgba(80, 150, 200, 0.2)";
          ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
          ctx.lineWidth = 1;
          ctx.fillRect(zx, zz, zWidth * scaleX, zHeight * scaleZ);
          ctx.strokeRect(zx, zz, zWidth * scaleX, zHeight * scaleZ);
        }
      }

      if (spec.buildings) {
        for (const b of spec.buildings) {
          if (!b || !b.position || !b.size) continue;
          const bx = cx + (b.position.x - px) * scaleX;
          const bz = cy + (b.position.z - pz) * scaleZ;
          const bw = b.size.x * (b.scale?.x || 1) * scaleX;
          const bh = b.size.z * (b.scale?.z || 1) * scaleZ;

          ctx.fillStyle = "rgba(200, 200, 200, 0.6)";
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;

          ctx.save();
          ctx.translate(bx, bz);
          if (b.rotation?.y) {
            ctx.rotate((-b.rotation.y * Math.PI) / 180);
          }
          ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
          ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);

          ctx.fillStyle = "#000";
          ctx.font = "8px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(b.id || "B", 0, 0);
          ctx.restore();
        }
      }
    }

    this.match.droneJitterMap.forEach((buffer) => {
      if (buffer.count === 0) return;
      const head = buffer.states[(buffer.head - 1 + 3) % 3];
      if (!head || head.state === DroneState.DEAD) return;

      let color = "#FF8800"; // Ground
      if (head.type === 0 || head.type === 1 || head.type === 3)
        color = "#00AAFF"; // Air
      else if (head.type === 2) color = "#FFFF00"; // Recon

      const dx = cx + (head.posX - px) * (w / this.rangeX);
      const dz = cy + (head.posZ - pz) * (h / this.rangeZ);

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(dx, dz, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  public dispose() {
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
