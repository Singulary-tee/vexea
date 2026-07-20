import { MatchController } from "../../MatchController";
import { ACTIVE_GAMEMODE } from "../../../shared/gamemode-configs";

export class HUDSystem {
  private match: MatchController;

  constructor(match: MatchController) {
    this.match = match;
  }

  public init() {
    this.updateHUD();
  }

  public updateHUD() {
    const match = this.match;
    const hBar = document.getElementById("health-bar-fill");
    const hpVal = document.getElementById("health-text");
    const scoreVal = document.getElementById("score-val");
    
    if (hBar) hBar.style.width = `${match.playerHP}%`;
    if (hpVal) hpVal.innerText = `${Math.floor(match.playerHP)}`;
    if (scoreVal) scoreVal.innerText = `${match.playerScore}`;
  }

  public updateAmmo(primary?: { currentMag: number, reserve: number, isReloading: boolean }, secondary?: { currentMag: number, reserve: number, isReloading: boolean }) {
    const a1 = document.getElementById("weapon-1-ammo");
    const a2 = document.getElementById("weapon-2-ammo");
    
    if (a1 && primary) {
      a1.innerHTML = primary.isReloading
        ? "RELOADING"
        : `<span class="ammo-mag">${primary.currentMag.toString().padStart(2, "0")}</span><span class="ammo-res">/${primary.reserve}</span>`;
    }
    
    if (a2 && secondary) {
      a2.innerHTML = secondary.isReloading
        ? "RELOADING"
        : `<span class="ammo-mag">${secondary.currentMag.toString().padStart(2, "0")}</span><span class="ammo-res">/${secondary.reserve}</span>`;
    }
  }

  public updateTimer(tick: number) {
    const totalSeconds = ACTIVE_GAMEMODE.matchDuration;
    const elapsedSeconds = Math.floor(tick / 60);
    const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
    const minutes = Math.floor(remainingSeconds / 60).toString().padStart(2, "0");
    const seconds = (remainingSeconds % 60).toString().padStart(2, "0");
    const elapsedVal = document.getElementById("hud-timer");
    if (elapsedVal) elapsedVal.innerText = `${ACTIVE_GAMEMODE.timerLabel.toUpperCase()}: ${minutes}:${seconds}`;
  }


  public triggerUIFlash(color: string = "255, 0, 0", duration: number = 0.5) {
    let flashDiv = document.getElementById("ui-damage-flash");
    if (!flashDiv) {
      flashDiv = document.createElement("div");
      flashDiv.id = "ui-damage-flash";
      Object.assign(flashDiv.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: "999",
        transition: "opacity 0.1s ease-out",
      });
      document.body.appendChild(flashDiv);
    }
    flashDiv.style.background = `rgba(${color}, 0.3)`;
    flashDiv.style.opacity = "1";

    setTimeout(() => {
      if (flashDiv) {
        flashDiv.style.transition = `opacity ${duration}s ease-out`;
        flashDiv.style.opacity = "0";
      }
    }, 100);
  }

  public showDeathOverlay(show: boolean, respawnTimer?: number) {
    const overlay = document.getElementById("death-overlay");
    const countdown = document.getElementById("death-countdown");
    if (overlay) overlay.style.display = show ? "flex" : "none";
    if (countdown && respawnTimer !== undefined) countdown.innerText = String(respawnTimer);
  }

  public updateRespawnCountdown(remaining: number) {
    const countdown = document.getElementById("death-countdown");
    if (countdown) countdown.innerText = String(remaining);
  }
}
