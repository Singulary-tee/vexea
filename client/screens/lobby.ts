import * as screenManager from "./screen-manager";
import { getDefaultMap } from "../../shared/maps/map-registry";
import { ensureAssetsDownloaded } from "../asset-cache";
import { IS_DESKTOP } from "../platform-gate";

export function initLobby() {
  let el = document.getElementById('lobby-screen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lobby-screen';
    Object.assign(el.style, {
      position: 'fixed', inset: '0', zIndex: '800', background: '#0A0A0A', display: 'none', flexDirection: 'column',
      width: '100vw', height: '100vh'
    });

    // We use a CSS class to handle responsive layout without platform checks
    el.classList.add('lobby-responsive');

    // Top Section
    const topSection = document.createElement('div');
    Object.assign(topSection.style, {
      height: 'clamp(50%, 60%, 70%)', display: 'flex', flexDirection: 'row', boxSizing: 'border-box',
      overflowX: 'auto', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch'
    });
    topSection.classList.add('lobby-top-section');

    let selectedClassIdx = 0;
    const cards: HTMLElement[] = [];

    const createClassCard = (idx: number, name: string, desc: string, utils: string[], gradient: string) => {
        const card = document.createElement('div');
        Object.assign(card.style, {
           flex: '1', minWidth: 'clamp(240px, 25vw, 400px)', height: '100%', position: 'relative',
           overflow: 'hidden', cursor: 'pointer', borderRadius: '0', scrollSnapAlign: 'start',
           marginRight: idx < 3 ? '8px' : '0'
        });
        card.classList.add('lobby-class-card');

        const imgLayer = document.createElement('div');
        Object.assign(imgLayer.style, {
           position: 'absolute', inset: '0', zIndex: '1', background: gradient
        });
        card.appendChild(imgLayer);

        const darkLayer = document.createElement('div');
        Object.assign(darkLayer.style, {
           position: 'absolute', inset: '0', zIndex: '2', background: 'rgba(0,0,0,0.3)'
        });
        card.appendChild(darkLayer);

        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
           position: 'absolute', inset: '0', zIndex: '2', background: 'transparent'
        });
        card.appendChild(overlay);

        const btmGradient = document.createElement('div');
        Object.assign(btmGradient.style, {
           position: 'absolute', bottom: '0', left: '0', right: '0', height: '50%', zIndex: '2',
           background: 'linear-gradient(transparent, rgba(0,0,0,0.92))'
        });
        card.appendChild(btmGradient);

        const content = document.createElement('div');
        Object.assign(content.style, {
           position: 'absolute', bottom: '0', left: '0', right: '0', zIndex: '3', padding: 'clamp(8px, 2vh, 24px) clamp(12px, 2vw, 32px)', boxSizing: 'border-box',
           maxHeight: 'clamp(30%, 40%, 50%)', overflow: 'hidden'
        });

        const clsName = document.createElement('div');
        clsName.textContent = name;
        Object.assign(clsName.style, {
           fontFamily: "'Barlow Condensed', sans-serif", fontSize: 'clamp(18px, 3vh, 32px)', textTransform: 'uppercase',
           fontWeight: 'bold', color: '#E8E8E8'
        });
        content.appendChild(clsName);

        const clsDesc = document.createElement('div');
        clsDesc.textContent = desc;
        Object.assign(clsDesc.style, {
           fontFamily: "'Barlow Condensed', sans-serif", fontSize: 'clamp(12px, 1.5vh, 18px)', color: '#888888', marginTop: '4px'
        });
        content.appendChild(clsDesc);

        utils.forEach(u => {
            const uDiv = document.createElement('div');
            uDiv.textContent = u;
            Object.assign(uDiv.style, {
               fontFamily: "'Barlow Condensed', sans-serif", fontSize: 'clamp(11px, 1.2vh, 16px)', color: '#555555'
            });
            content.appendChild(uDiv);
        });

        card.appendChild(content);

        card.addEventListener('click', () => {
            selectedClassIdx = idx;
            updateSelection();
        });

        cards.push(card);
        topSection.appendChild(card);
    };

    createClassCard(0, "ASSAULT", "Frontline breach. Fast maneuverability.", ["Frag Grenade", "Sprint Stim"], "linear-gradient(180deg, #1A0A0A 0%, #080808 100%)");
    createClassCard(1, "MEDIC", "Sustainment and AoE healing.", ["Healing Drone", "Revive Dart"], "linear-gradient(180deg, #0A1A0A 0%, #080808 100%)");
    createClassCard(2, "RECON", "Map visibility and single target elimination.", ["Sensor Mine", "Radar Pulse"], "linear-gradient(180deg, #0A0A1A 0%, #080808 100%)");
    createClassCard(3, "DEMOLITIONS", "Anti-armor and structural denial.", ["C4 Charge", "Deployable Shield"], "linear-gradient(180deg, #1A1A0A 0%, #080808 100%)");

    const updateSelection = () => {
        cards.forEach((c, i) => {
            if (i === selectedClassIdx) {
                c.style.outline = '2px solid #C8882A';
                (c.children[2] as HTMLElement).style.backgroundColor = 'rgba(200,136,42,0.06)';
            } else {
                c.style.outline = 'none';
                (c.children[2] as HTMLElement).style.backgroundColor = 'transparent';
            }
        });
    };
    updateSelection();
    el.appendChild(topSection);

    // Bottom Section
    const btmSection = document.createElement('div');
    Object.assign(btmSection.style, {
      height: '40%', padding: '24px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box'
    });

    const headerRow = document.createElement('div');
    Object.assign(headerRow.style, {
      display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px'
    });
    const label = document.createElement('div');
    label.textContent = "CONTRACTORS";
    Object.assign(label.style, {
      fontFamily: "'Barlow Condensed', sans-serif", fontSize: '14px', textTransform: 'uppercase', color: '#888888', letterSpacing: '4px', whiteSpace: 'nowrap'
    });
    const line = document.createElement('div');
    Object.assign(line.style, {
      flex: '1', height: '1px', background: '#2A2A2A'
    });
    headerRow.appendChild(label);
    headerRow.appendChild(line);
    btmSection.appendChild(headerRow);

    const playerList = document.createElement('div');
    Object.assign(playerList.style, {
      flex: '1', overflowY: 'auto'
    });
    
    // Add local player mock
    const playerRow = document.createElement('div');
    Object.assign(playerRow.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0',
      borderBottom: '1px solid #111111', borderLeft: '3px solid #C8882A', paddingLeft: '8px',
      opacity: '0', transition: 'opacity 200ms'
    });
    setTimeout(() => playerRow.style.opacity = '1', 50);

    const leftWrap = document.createElement('div');
    const pName = document.createElement('div');
    pName.textContent = "LOCAL PLAYER";
    Object.assign(pName.style, { fontFamily: "'Barlow Condensed', sans-serif", fontSize: '14px', color: '#E8E8E8' });
    const pFaction = document.createElement('div');
    pFaction.textContent = "UNAFFILIATED";
    Object.assign(pFaction.style, { fontFamily: "'Barlow Condensed', sans-serif", fontSize: '14px', color: '#555555' });
    leftWrap.appendChild(pName); leftWrap.appendChild(pFaction);

    const pClass = document.createElement('div');
    pClass.textContent = "ASSAULT";
    Object.assign(pClass.style, { fontFamily: "'Barlow Condensed', sans-serif", fontSize: '14px', color: '#888888' });

    playerRow.appendChild(leftWrap);
    playerRow.appendChild(pClass);
    playerList.appendChild(playerRow);
    btmSection.appendChild(playerList);

    const actionBar = document.createElement('div');
    Object.assign(actionBar.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '16px',
      borderTop: '1px solid #2A2A2A', marginTop: 'auto'
    });

    const backBtn = document.createElement('button');
    backBtn.textContent = 'BACK';
    Object.assign(backBtn.style, {
      height: '48px', padding: '0 24px', background: 'transparent', border: '1px solid #2A2A2A', color: '#888888',
      fontFamily: "'Barlow Condensed', sans-serif", fontSize: '24px', textTransform: 'uppercase', borderRadius: '0', cursor: 'pointer'
    });
    backBtn.addEventListener('click', () => screenManager.showMainMenu());
    actionBar.appendChild(backBtn);

    const readyBtn = document.createElement('button');
    readyBtn.textContent = 'READY';
    Object.assign(readyBtn.style, {
      height: '48px', padding: '0 32px', background: '#C8882A', border: 'none', color: '#0A0A0A',
      fontFamily: "'Barlow Condensed', sans-serif", fontSize: '24px', fontWeight: 'bold', textTransform: 'uppercase', borderRadius: '0', cursor: 'pointer'
    });
    readyBtn.addEventListener('mousedown', () => readyBtn.style.background = '#8A5C1A');
    readyBtn.addEventListener('mouseup', () => readyBtn.style.background = '#C8882A');
    readyBtn.addEventListener('touchstart', () => readyBtn.style.background = '#8A5C1A');
    readyBtn.addEventListener('touchend', () => readyBtn.style.background = '#C8882A');

    // Emit ready logic can be wired later
    readyBtn.addEventListener('click', () => {
        // Synchronously request fullscreen and pointer lock on canvas-container
        if (!IS_DESKTOP) {
            const docEl = document.documentElement as any;
            if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
                if (docEl.requestFullscreen) docEl.requestFullscreen();
                else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
            }
        }

        const map = getDefaultMap();
        ensureAssetsDownloaded(() => {
            screenManager.showGame();
            window.dispatchEvent(new CustomEvent("start-match", { detail: { map } }));
        }, map.id);
    });
    
    actionBar.appendChild(readyBtn);
    btmSection.appendChild(actionBar);

    el.appendChild(btmSection);
    document.body.appendChild(el);
  }
}
