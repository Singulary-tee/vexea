import { DS } from "../design-system";
import { audioManager } from "../audio";

const screens = ['splash-screen', 'main-menu-screen', 'lobby-screen', 'dev-map-editor-screen', 'dev-entities-screen'];
let transitionTimers: number[] = [];

export function hideAll() {
  transitionTimers.forEach(clearTimeout);
  transitionTimers = [];
  
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.opacity = '0';
      transitionTimers.push(window.setTimeout(() => {
        el.style.display = 'none';
      }, 300));
    }
  });
}

function showScreen(id: string, durationMs: number, immediate: boolean) {
  audioManager.setMatchState(false);
  if (immediate) {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'flex';
      el.style.transition = `opacity ${durationMs}ms`;
      void el.offsetWidth;
      el.style.opacity = '1';
    }
  } else {
    hideAll();
    transitionTimers.push(window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.style.transition = 'none';
        el.style.opacity = '0';
        el.style.display = 'flex';
        void el.offsetWidth;
        el.style.transition = `opacity ${durationMs}ms`;
        el.style.opacity = '1';
      }
    }, 300));
  }
}

export function showSplash() {
  showScreen('splash-screen', 0, true);
}

export function showMainMenu() {
  showScreen('main-menu-screen', 500, false);
}

export function showLobby() {
  showScreen('lobby-screen', 500, false);
}

export function showDevMapEditor() {
  showScreen('dev-map-editor-screen', 500, false);
}
if (typeof window !== 'undefined') {
  (window as any).showDevMapEditor = showDevMapEditor;
}

export function showDevEntities() {
  import("./dev-entities").then(({ initDevEntities, activateScreen }) => {
    initDevEntities().then(() => {
      activateScreen();
    });
  });
}
if (typeof window !== 'undefined') {
  (window as any).showDevEntities = showDevEntities;
}

export function showGame() {
  audioManager.setMatchState(true);
  hideAll();
}
