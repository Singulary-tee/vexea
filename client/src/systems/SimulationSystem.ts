import { MatchController } from "../../MatchController";
import map1Spec from "../../../shared/maps/map_1_facility.spec.json";
import { GlobalState } from "../../state";

export class SimulationSystem {
  constructor(private match: MatchController) {}

  public init() {
    // Re-init Physics Worker for fresh match state
    this.match.physicsWorker = new Worker(
      new URL("../../physics.worker.ts", import.meta.url),
      { type: "module" },
    );
    
    if (typeof SharedArrayBuffer !== "undefined") {
      try {
        this.match.physicsSAB = new SharedArrayBuffer(12 * 4); // 12 floats
        this.match.physicsData = new Float32Array(this.match.physicsSAB);
      } catch (err) {
        console.warn("Failed to create SharedArrayBuffer", err);
        this.match.physicsSAB = null;
        this.match.physicsData = null;
      }
    } else {
      this.match.physicsSAB = null;
      this.match.physicsData = null;
    }
    
    const spec = this.match.mapId === "map_1_facility" ? map1Spec : null;
    let buildingsToPass: any[] = [];
    if (spec && spec.buildings) {
        buildingsToPass = spec.buildings;
    }

    try {
      this.match.physicsWorker.postMessage({ 
        type: "INIT", 
        sab: this.match.physicsSAB, 
        buildings: buildingsToPass 
      });
    } catch (err) {
      console.warn("Failed to postMessage SharedArrayBuffer, falling back", err);
      this.match.physicsSAB = null;
      this.match.physicsData = null;
      this.match.physicsWorker.postMessage({ 
        type: "INIT", 
        sab: null, 
        buildings: buildingsToPass 
      });
    }

    this.match.physicsWorker.onmessage = (e: MessageEvent) => {
      this.handleWorkerMessage(e);
    };
  }

  private handleWorkerMessage(e: MessageEvent) {
    if (e.data.type === "CUBE_UPDATE") {
      (window as any).clientCubeTelemetry = {
        pos: e.data.pos,
        vel: e.data.vel,
        events: e.data.events
      };
      if (typeof (window as any).updateClientCubeMesh === "function") {
        (window as any).updateClientCubeMesh(e.data.pos);
      }
    } else if (e.data.type === "CUBE_CLEARED") {
      (window as any).clientCubeTelemetry = null;
      if (typeof (window as any).removeClientCubeMesh === "function") {
        (window as any).removeClientCubeMesh();
      }
    } else if (e.data.type === "PLAYER_COLLISIONS") {
      (window as any).clientPlayerCollisions = e.data.collisions;
    } else if (e.data.type === "PLAYER_UPDATE") {
      if (!GlobalState.isFlying) {
        this.match.playerPos.set(e.data.pos.x, e.data.pos.y, e.data.pos.z);
      }
      // We need a way to pass localGrounded back to main.ts or store it in match
      // For now, let's store it in match
      (this.match as any).localGrounded = e.data.grounded;
    }
  }

  public step(dt: number) {
    if (this.match.physicsWorker) {
      let dronesData: any[] = [];
      if (this.match.droneJitterMap) {
        this.match.droneJitterMap.forEach((buffer, id) => {
          if (buffer.count > 0) {
            const latest = buffer.getLatest();
            if (latest.state !== 2) { // DroneState.DEAD is 2
              dronesData.push({
                id,
                x: latest.posX,
                y: latest.posY,
                z: latest.posZ,
                type: latest.type
              });
            }
          }
        });
      }
      this.match.physicsWorker.postMessage({ type: "STEP", delta: dt * 1000, drones: dronesData });
    }
  }

  public dispose() {
    if (this.match.physicsWorker) {
      console.log("[SimulationSystem] Terminating physics worker.");
      this.match.physicsWorker.terminate();
      this.match.physicsWorker = null;
    }
    this.match.physicsSAB = null;
    this.match.physicsData = null;
    (window as any).clientCubeTelemetry = null;
  }
}
