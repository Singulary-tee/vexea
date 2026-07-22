import { DS } from "../../design-system";

export class LoadingScreen {
  private overlay: HTMLDivElement;
  private phaseLabel: HTMLDivElement;
  private progressBarFill: HTMLDivElement;
  private percentageText: HTMLDivElement;
  private tipText: HTMLDivElement;
  private tipInterval: any;
  private tips = [
    "RECON DRONES MAINTAIN CONFIRMED PRESENCE. DESTROY THEM FIRST.",
    "THE LLM COMMANDER ADAPTS EVERY 8 SECONDS. DISRUPT ITS AWARENESS.",
    "SIGNAL DISRUPTOR REMOVES YOU FROM ALL DRONE REPORTING FOR ITS DURATION.",
    "EMP DISABLES CAMERAS IN RADIUS. BLIND THE COMMANDER BEFORE PUSHING.",
    "COORDINATING REVIVES KEEPS YOUR TEAM'S PRESSURE ON THE OBJECTIVE."
  ];

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "fullscreen-overlay loading-overlay";
    this.overlay.style.position = "fixed";
    this.overlay.style.top = "0";
    this.overlay.style.left = "0";
    this.overlay.style.width = "100vw";
    this.overlay.style.height = "100vh";
    this.overlay.style.backgroundColor = DS.colors.background;
    this.overlay.style.zIndex = "9999";
    this.overlay.style.display = "flex";
    this.overlay.style.flexDirection = "column";
    this.overlay.style.justifyContent = "center";
    this.overlay.style.alignItems = "center";
    this.overlay.style.fontFamily = DS.typography.fontFamily;
    this.overlay.style.pointerEvents = "auto";

    const blockEvents = ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "touchstart", "touchend", "touchmove"];
    blockEvents.forEach(evt => {
      this.overlay.addEventListener(evt, (e) => {
        e.stopPropagation();
        e.preventDefault();
      }, { capture: true });
    });

    // Wordmark
    const wordmark = document.createElement("div");
    wordmark.innerText = "VEXEΛ";
    wordmark.style.color = DS.colors.text;
    wordmark.style.fontSize = "48px";
    wordmark.style.marginBottom = "10px";
    this.overlay.appendChild(wordmark);

    // Phase Label
    this.phaseLabel = document.createElement("div");
    this.phaseLabel.style.color = DS.colors.accent;
    this.phaseLabel.style.fontSize = "18px";
    this.phaseLabel.style.textTransform = "uppercase";
    this.phaseLabel.style.marginBottom = "5px";
    this.phaseLabel.innerText = "INITIALIZING";
    this.overlay.appendChild(this.phaseLabel);

    // Progress Bar Container
    const progressContainer = document.createElement("div");
    progressContainer.style.width = "calc(100% - 40px)";
    progressContainer.style.height = "4px";
    progressContainer.style.backgroundColor = DS.colors.surface;
    progressContainer.style.marginBottom = "5px";

    // Progress Bar Fill
    this.progressBarFill = document.createElement("div");
    this.progressBarFill.style.width = "0%";
    this.progressBarFill.style.height = "100%";
    this.progressBarFill.style.backgroundColor = DS.colors.accent;
    progressContainer.appendChild(this.progressBarFill);
    this.overlay.appendChild(progressContainer);

    // Percentage Text
    this.percentageText = document.createElement("div");
    this.percentageText.style.color = DS.colors.text;
    this.percentageText.style.fontSize = "14px";
    this.percentageText.innerText = "0%";
    this.overlay.appendChild(this.percentageText);

    // Tip Text
    this.tipText = document.createElement("div");
    this.tipText.style.position = "absolute";
    this.tipText.style.bottom = "20px";
    this.tipText.style.color = DS.colors.textMuted;
    this.tipText.style.fontSize = "14px";
    this.tipText.style.textAlign = "center";
    this.tipText.style.width = "100%";
    this.tipText.innerText = this.tips[0];
    this.overlay.appendChild(this.tipText);

    document.body.appendChild(this.overlay);

    let tipIndex = 0;
    this.tipInterval = setInterval(() => {
      tipIndex = (tipIndex + 1) % this.tips.length;
      this.tipText.innerText = this.tips[tipIndex];
    }, 4000);
  }

  show(): void {
    this.overlay.style.display = "flex";
  }

  hide(): void {
    this.overlay.style.display = "none";
  }

  setPhase(label: string): void {
    this.phaseLabel.innerText = label;
  }

  setProgress(loaded: number, total: number): void {
    const p = Math.max(0, Math.min(100, (loaded / total) * 100));
    this.progressBarFill.style.width = `${p}%`;
    this.percentageText.innerText = `${Math.floor(p)}%`;
  }

  destroy(): void {
    clearInterval(this.tipInterval);
    if (this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }
}
