import { MatchController } from "../../MatchController";
import { getSocketChannel } from "../../main";
import { getSettings } from "../../settings";
import { DS } from "../../design-system";

export class ReconnectionSystem {
  private match: MatchController;
  private simulatedDisconnectActive = false;
  private originalUrl: string = "";

  constructor(match: MatchController) {
    this.match = match;
  }

  public init() {
    const channel = getSocketChannel();
    if (!channel) return;

    // Cache the original connection url
    const s = getSettings();
    this.originalUrl = s.serverUrl || window.location.origin;

    channel.onDisconnect(() => {
      console.warn("[RECONNECTION] Connection dropped!");
      const statusEl = document.getElementById("dev-disconnect-status");
      if (statusEl) {
        statusEl.innerText = "Status: Disconnected";
        statusEl.style.color = DS.colors.danger;
      }

      if (this.simulatedDisconnectActive) {
        console.log("[RECONNECTION] Disconnect is simulated. Waiting for timer to reconnect.");
      } else {
        // Auto-reconnect logic for natural drops
        console.log("[RECONNECTION] Attempting automatic reconnection in 2 seconds...");
        setTimeout(() => this.reconnect(), 2000);
      }
    });

    channel.onConnect(() => {
      console.log("[RECONNECTION] Connection re-established!");
      const statusEl = document.getElementById("dev-disconnect-status");
      if (statusEl) {
        statusEl.innerText = "Status: Connected";
        statusEl.style.color = DS.colors.success;
      }

      // Rejoin the match
      this.rejoinActiveMatch();
    });
  }

  public simulateDisconnect(durationMs: number) {
    if (this.simulatedDisconnectActive) return;
    this.simulatedDisconnectActive = true;

    const channel = getSocketChannel();
    if (!channel) {
      console.error("[RECONNECTION] No active transport channel to disconnect!");
      this.simulatedDisconnectActive = false;
      return;
    }

    console.log(`[RECONNECTION] Severing connection for ${durationMs}ms...`);
    const statusEl = document.getElementById("dev-disconnect-status");
    if (statusEl) {
      statusEl.innerText = "Status: Simulating Disconnect...";
      statusEl.style.color = DS.colors.warning;
    }

    // Force disconnect
    channel.disconnect();

    setTimeout(() => {
      console.log("[RECONNECTION] Simulated disconnect duration elapsed. Reconnecting...");
      this.simulatedDisconnectActive = false;
      this.reconnect();
    }, durationMs);
  }

  private reconnect() {
    const channel = getSocketChannel();
    if (!channel) return;
    console.log("[RECONNECTION] Connecting transport to:", this.originalUrl);
    channel.connect(this.originalUrl, 3000);
  }

  private rejoinActiveMatch() {
    const channel = getSocketChannel();
    if (!channel) return;

    const vexMatchId = (window as any).vexMatchId;
    const vexMapId = (window as any).vexMapId;
    const cloudUid = (window as any).vexPlayerUid || "guest_" + vexMatchId;
    
    // Attempt to recover player ID from global window if MatchController was reset
    const originalPlayerId = this.match.localPlayerId || (window as any).lastLocalPlayerId;

    if (vexMatchId) {
      console.log(`[RECONNECTION] Rejoining active match: ${vexMatchId}, map: ${vexMapId}, uid: ${originalPlayerId || cloudUid}`);
      
      channel.emit("start_match", {
        uid: originalPlayerId || cloudUid,
        matchId: vexMatchId,
        mapId: vexMapId || "map_0_dev",
      });
    }
  }
}
