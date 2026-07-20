import * as THREE from "three/webgpu";
import { MatchController } from "../../MatchController";
import { WAYPOINTS } from "../../../shared/constants";

export interface CompassTarget {
  id: string;
  name?: string;
  worldPos?: THREE.Vector3;
  bearing?: number; // fallback in case of static angular landmarks
  icon?: string; // "eye", "terminal", "target", "star", "warning" etc.
  color?: string; // Hex code, e.g. "#C8882A"
}

export class CompassSystem {
  private match: MatchController;
  private placeholder: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private targets: CompassTarget[] = [];
  
  // Settable Field of View (defaults to 180 degrees)
  public fov: number = Math.PI; // 180 degrees total width

  constructor(match: MatchController) {
    this.match = match;
  }

  public init() {
    this.placeholder = document.getElementById("compass-placeholder");
    if (!this.placeholder) {
      console.warn("[COMPASS] Placeholder '#compass-placeholder' not found in DOM.");
      return;
    }

    // Clean up inside placeholder and insert a canvas
    this.placeholder.innerHTML = "";
    this.canvas = document.createElement("canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.placeholder.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    // Clear previous targets and initialize default game landmarks
    this.targets = [];
    
    // Auto-track the LLM Core
    if (WAYPOINTS && WAYPOINTS.zone_core) {
      const corePos = WAYPOINTS.zone_core;
      this.addTarget({
        id: "core",
        name: "LLM CORE",
        worldPos: new THREE.Vector3(corePos.x, corePos.y, corePos.z),
        icon: "terminal",
        color: "#C8882A"
      });
    }

    // Auto-track the Spawn Zone
    if (WAYPOINTS && WAYPOINTS.zone_spawn) {
      const spawnPos = WAYPOINTS.zone_spawn;
      this.addTarget({
        id: "spawn",
        name: "SPAWN BASE",
        worldPos: new THREE.Vector3(spawnPos.x, spawnPos.y, spawnPos.z),
        icon: "star",
        color: "#22c55e"
      });
    }
  }

  public addTarget(target: CompassTarget) {
    if (this.targets.find(t => t.id === target.id)) {
      return;
    }
    this.targets.push(target);
  }

  public removeTarget(id: string) {
    this.targets = this.targets.filter(t => t.id !== id);
  }

  public clearTargets() {
    this.targets = [];
  }

  public update(dt: number) {
    if (!this.canvas || !this.ctx || !this.placeholder || !document.body.contains(this.canvas)) {
      this.placeholder = document.getElementById("compass-placeholder");
      if (this.placeholder) {
        this.placeholder.innerHTML = "";
        this.canvas = document.createElement("canvas");
        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
        this.canvas.style.display = "block";
        this.placeholder.appendChild(this.canvas);
        this.ctx = this.canvas.getContext("2d");
      }
    }

    if (!this.canvas || !this.ctx) return;
    const canvas = this.canvas;
    const ctx = this.ctx;

    // Responsive Canvas Resizing with DPR scaling
    const dpr = window.devicePixelRatio || 1;
    const rect = this.placeholder!.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : 200;
    const h = rect.height > 0 ? rect.height : 30;

    const targetW = w * dpr;
    const targetH = h * dpr;
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(dpr, dpr);

    const cx = w / 2;
    const fov = this.fov;
    const yaw = this.match.playerYaw;

    // 1. Draw horizontal line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.stroke();

    // 2. Draw degree tick marks
    for (let angleDeg = 0; angleDeg < 360; angleDeg += 5) {
      const angleRad = -angleDeg * Math.PI / 180; // Negative due to counter-clockwise yaw
      let diff = angleRad + yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));

      if (Math.abs(diff) < fov / 2) {
        const x = cx + (diff / (fov / 2)) * cx;

        const isMajor = angleDeg % 45 === 0;
        const isMedium = angleDeg % 15 === 0 && !isMajor;
        const tickHeight = isMajor ? 10 : (isMedium ? 6 : 3);

        ctx.strokeStyle = isMajor ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.2)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, tickHeight);
        ctx.stroke();

        if (isMajor) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
          ctx.font = "bold 9px 'Rajdhani', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          let label = "";
          if (angleDeg === 0) label = "N";
          else if (angleDeg === 45) label = "NE";
          else if (angleDeg === 90) label = "E";
          else if (angleDeg === 135) label = "SE";
          else if (angleDeg === 180) label = "S";
          else if (angleDeg === 225) label = "SW";
          else if (angleDeg === 270) label = "W";
          else if (angleDeg === 315) label = "NW";

          ctx.fillText(label, x, tickHeight + 2);
        } else if (isMedium) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
          ctx.font = "8px 'Rajdhani', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(String(angleDeg), x, tickHeight + 2);
        }
      }
    }

    // 3. Draw central heading indicator (triangle & line)
    ctx.strokeStyle = "#C8882A";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, 14);
    ctx.stroke();

    ctx.fillStyle = "#C8882A";
    ctx.beginPath();
    ctx.moveTo(cx - 4, 0);
    ctx.lineTo(cx + 4, 0);
    ctx.lineTo(cx, 4);
    ctx.fill();

    // 4. Draw tracked targets
    for (let i = 0; i < this.targets.length; i++) {
      const target = this.targets[i];
      let angleRad = 0;

      if (target.worldPos) {
        const dx = target.worldPos.x - this.match.playerPos.x;
        const dz = target.worldPos.z - this.match.playerPos.z;
        angleRad = Math.atan2(dx, -dz);
      } else if (target.bearing !== undefined) {
        angleRad = target.bearing;
      } else {
        continue;
      }

      let diff = angleRad + yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));

      if (Math.abs(diff) < fov / 2) {
        const x = cx + (diff / (fov / 2)) * cx;
        const color = target.color || "#C8882A";
        
        // Draw icon shape on the canvas tape
        this.drawIcon(ctx, target.icon || "default", x, h - 8, color);

        // Compute display label with distance if worldPos is tracked
        let label = target.name || "";
        if (target.worldPos) {
          const dist = Math.round(this.match.playerPos.distanceTo(target.worldPos));
          label += ` [${dist}m]`;
        }

        if (label) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
          ctx.font = "bold 8px 'Rajdhani', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(label, x, h - 18);
        }
      }
    }

    ctx.restore();
  }

  private drawIcon(ctx: CanvasRenderingContext2D, icon: string, x: number, y: number, color: string) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.translate(x, y);

    if (icon === "eye") {
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.quadraticCurveTo(0, -5, 6, 0);
      ctx.quadraticCurveTo(0, 5, -6, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (icon === "terminal" || icon === "monitor") {
      ctx.strokeRect(-5, -4, 10, 6);
      ctx.beginPath();
      ctx.moveTo(-2, 2);
      ctx.lineTo(-3, 4);
      ctx.lineTo(3, 4);
      ctx.lineTo(2, 2);
      ctx.fill();
    } else if (icon === "target" || icon === "crosshair") {
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-5, 0); ctx.lineTo(5, 0);
      ctx.moveTo(0, -5); ctx.lineTo(0, 5);
      ctx.stroke();
    } else if (icon === "star") {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        ctx.lineTo(Math.cos((18 + i * 72) * Math.PI / 180) * 4.5, -Math.sin((18 + i * 72) * Math.PI / 180) * 4.5);
        ctx.lineTo(Math.cos((54 + i * 72) * Math.PI / 180) * 1.8, -Math.sin((54 + i * 72) * Math.PI / 180) * 1.8);
      }
      ctx.closePath();
      ctx.fill();
    } else if (icon === "warning") {
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(4.5, 3.5);
      ctx.lineTo(-4.5, 3.5);
      ctx.closePath();
      ctx.stroke();
      ctx.fillRect(-0.5, -1.5, 1, 2.5);
      ctx.fillRect(-0.5, 1.8, 1, 0.9);
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -3.5);
      ctx.lineTo(3.5, 0);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(-3.5, 0);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}
