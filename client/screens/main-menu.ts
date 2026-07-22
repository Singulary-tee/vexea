import * as screenManager from "./screen-manager";
import { getFirestore, collection, addDoc, serverTimestamp, doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { DS } from "../design-system";
import { IS_DEV } from "../../shared/gate";
import { getDevMap, getDefaultMap, MAP_REGISTRY } from "../../shared/maps/map-registry";
import { hasCachedBlob, getCachedOrFetchUrl, ensureAssetsDownloaded, getAssetUrl } from "../asset-cache";
import { EXTENDED_SOUNDS, EXTENDED_TEXTURES } from "./splash";

let styleInjected = false;
let activeCardId: string | null = null;
let currentRightPanelMode: 'DEFAULT' | 'MULTIPLAYER' | 'FACTION' | 'INTEL' | 'FEEDBACK' | 'STORE' | 'PROFILE' | 'MAP_EDITOR' | 'PLAY' | 'LOADOUT' = 'DEFAULT';
let userFaction: string | null = null;
let registeredUserData: any = null;
let userSubscriptionUnsubscribe: (() => void) | null = null;

const cardImages = [
    'multiplayer_card.png',
    'vibeCo_card.png',
    'slopInc_card.png',
    'statistics_card.png',
    'store_card.png',
    'feedback_card.png'
];

// Element References
let rightPanelContent: HTMLElement;
let leftColumn: HTMLElement;
let multiplayerCard: HTMLElement;
let devQuickstartBtn: HTMLElement | null = null;
let profileRankBadge: HTMLElement;
let profileNameText: HTMLElement;


export function initMainMenu() {
  cardImages.forEach(name => {
    const img = new Image();
    img.src = getAssetUrl(name);
  });

  const auth = getAuth();
  if (auth.currentUser) {
    const db = getFirestore();
    const uid = auth.currentUser.uid;
    
    if (userSubscriptionUnsubscribe) {
      userSubscriptionUnsubscribe();
    }
    
    userSubscriptionUnsubscribe = onSnapshot(doc(db, 'Users', uid), (snapshot) => {
      if (snapshot.exists()) {
        registeredUserData = snapshot.data();
        userFaction = registeredUserData.faction || null;
        
        const overlay = document.getElementById('vex-enlistment-overlay');
        if (overlay) overlay.remove();
        
        checkDailyRefresh(registeredUserData, doc(db, 'Users', uid));
        enableLeftColumnMenu(true);
      } else {
        registeredUserData = null;
        userFaction = null;
        enableLeftColumnMenu(false);
        showEnlistmentOverlay(db, auth);
      }
      
      updateProfileBox();
      renderRightPanel();
    }, (err) => {
      console.warn("User state subscription failed:", err);
    });
  }

  let el = document.getElementById('main-menu-screen');
  if (el) el.remove();

  if (!styleInjected) {
    const style = document.createElement('style');
    style.innerHTML = `
      #main-menu-screen * {
        box-sizing: border-box;
      }
      .mm-glass {
        background: ${DS.glass.background};
        backdrop-filter: ${DS.glass.blur};
        -webkit-backdrop-filter: ${DS.glass.blur};
        border: ${DS.glass.border};
      }
      .mm-wordmark { font-size: clamp(18px, 3vw, 36px); }
      .mm-right-panel-content {
        transition: opacity ${DS.transitions.panel};
      }
      
      .mm-fisheye-wrap {
        position: absolute;
        inset: 0;
        transform: scale(0.97) perspective(1200px) rotateX(2.5deg);
        transform-style: preserve-3d;
        pointer-events: none;
        z-index: 2;
      }
      .mm-fisheye-wrap > * {
        pointer-events: auto;
      }
      .mm-top-shadow {
        position: absolute;
        top: 0; left: 0; right: 0;
        height: clamp(80px, 15vh, 160px);
        background: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.8) 40%, rgba(0,0,0,0) 100%);
        z-index: 1;
        pointer-events: none;
      }
      .mm-new-card {
        position: relative;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        box-shadow: inset 0 0 60px rgba(0,0,0,0.9), inset 0 0 20px rgba(0,0,0,0.6), 0 6px 15px rgba(0,0,0,0.4);
        cursor: pointer;
        overflow: hidden;
        transition: transform 0.2s, box-shadow 0.2s, border 0.2s;
        display: flex;
        flex-direction: column;
        border: none;
        container-type: inline-size;
      }
      .mm-new-card:hover {
        transform: scale(1.02);
        box-shadow: inset 0 0 40px rgba(0,0,0,0.7), inset 0 0 10px rgba(0,0,0,0.4), 0 10px 25px rgba(0,0,0,0.6), 0 0 20px rgba(255,255,255,0.05);
        z-index: 10;
      }
      .mm-new-card-title {
        font-family: ${DS.typography.fontFamily};
        font-weight: bold;
        font-size: clamp(10px, 8cqi, 28px);
        text-transform: uppercase;
        color: #FFFFFF;
        text-shadow: 1px 1px 4px rgba(0,0,0,1);
        padding: clamp(4px, 4cqi, 16px);
        z-index: 2;
        pointer-events: none;
      }
      #settings-sidebar::-webkit-scrollbar { display:none; }
      @media (max-width: 768px) {
         .mm-wordmark { font-size: 24px !important; }
         .mm-profile-rank { display: none !important; }
         .mm-new-card-title { font-size: clamp(12px, 10cqi, 24px) !important; padding: 8px !important; }
      }
      @keyframes fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    styleInjected = true;
  }

  el = document.createElement('div');
  el.id = 'main-menu-screen';
  Object.assign(el.style, {
    position: 'fixed', inset: '0', zIndex: '900', display: 'none',
    backgroundColor: DS.colors.background,
    backgroundImage: `url('${getAssetUrl("faction_card.jpg")}')`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    opacity: '0', transition: `opacity ${DS.transitions.panel}`,
    overflow: 'hidden'
  });

  const fisheyeWrap = document.createElement('div');
  fisheyeWrap.className = 'mm-fisheye-wrap';
  el.appendChild(fisheyeWrap);

  const vignette = document.createElement('div');
  vignette.className = 'mm-vignette';
  el.appendChild(vignette);

  const topShadow = document.createElement('div');
  topShadow.className = 'mm-top-shadow';
  el.appendChild(topShadow);

  // Region 1 & 2 — Top Row: VEXEΛ Wordmark and Profile Mode
  const topRow = document.createElement('div');
  Object.assign(topRow.style, {
    position: 'absolute', top: '0', left: '0', right: '0', zIndex: '10',
    padding: 'clamp(12px, 2.5vh, 20px) clamp(16px, 3vw, 32px)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  });

  const wordmark = document.createElement('div');
  wordmark.className = 'mm-wordmark';
  wordmark.textContent = 'VEXEΛ';
  Object.assign(wordmark.style, {
    fontFamily: DS.typography.fontFamily, color: DS.colors.accent, letterSpacing: '4px',
    textTransform: 'uppercase', fontWeight: DS.typography.weightBold
  });
  topRow.appendChild(wordmark);

  const profileBox = document.createElement('div');
  Object.assign(profileBox.style, {
    padding: 'clamp(4px, 1vh, 8px) clamp(6px, 1vw, 12px)', display: 'flex', alignItems: 'center', gap: 'clamp(12px, 2vw, 24px)'
  });

  const pFullscreen = document.createElement('div');
  pFullscreen.style.color = DS.colors.textMuted;
  pFullscreen.style.cursor = 'pointer';
  pFullscreen.style.display = 'flex';
  pFullscreen.style.alignItems = 'center';
  pFullscreen.style.transition = 'color 0.2s';
  pFullscreen.title = 'Toggle Fullscreen';

  const updateFullscreenIcon = () => {
    if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
      pFullscreen.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4"/></svg>`;
    } else {
      pFullscreen.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
    }
  };
  updateFullscreenIcon();

  pFullscreen.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        const docEl = document.documentElement as any;
        if (docEl.requestFullscreen) docEl.requestFullscreen();
        else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
      } else {
        const doc = document as any;
        if (doc.exitFullscreen) doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen toggle failed:", err);
    }
  });

  pFullscreen.addEventListener('mouseenter', () => { pFullscreen.style.color = DS.colors.text; });
  pFullscreen.addEventListener('mouseleave', () => { pFullscreen.style.color = DS.colors.textMuted; });
  document.addEventListener('fullscreenchange', updateFullscreenIcon);
  document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
  profileBox.appendChild(pFullscreen);

  const fsDivider = document.createElement('div');
  Object.assign(fsDivider.style, { width: '1px', height: 'clamp(14px, 2vh, 20px)', background: 'rgba(255,255,255,0.1)' });
  profileBox.appendChild(fsDivider);

  const pIcon = document.createElement('div');
  pIcon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
  pIcon.style.color = DS.colors.textMuted;
  profileBox.appendChild(pIcon);

  profileNameText = document.createElement('div');
  Object.assign(profileNameText.style, {
    fontFamily: DS.typography.fontFamily, fontSize: 'clamp(8px, 1.25vh, 12px)', color: DS.colors.text, uppercase: 'true', letterSpacing: '2px'
  });
  profileBox.appendChild(profileNameText);

  profileRankBadge = document.createElement('div');
  profileRankBadge.className = 'mm-profile-rank';
  Object.assign(profileRankBadge.style, {
    background: DS.colors.accent, padding: 'clamp(2px, 0.5vh, 4px) clamp(5px, 1vw, 10px)',
    fontFamily: DS.typography.fontFamily, fontSize: 'clamp(8px, 1.25vh, 12px)', fontWeight: DS.typography.weightBold, color: DS.colors.background
  });
  profileBox.appendChild(profileRankBadge);

  const divider = document.createElement('div');
  Object.assign(divider.style, { width: '1px', height: 'clamp(14px, 2vh, 20px)', background: 'rgba(255,255,255,0.1)' });
  profileBox.appendChild(divider);

  const pFeedback = document.createElement('div');
  pFeedback.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  pFeedback.style.color = DS.colors.textMuted;
  pFeedback.style.cursor = 'pointer';
  pFeedback.style.display = 'flex';
  pFeedback.style.alignItems = 'center';
  pFeedback.style.transition = 'color 0.2s';
  pFeedback.title = 'Send Feedback';
  pFeedback.onclick = (e) => { e.stopPropagation(); setActiveCard('FEEDBACK'); };
  pFeedback.addEventListener('mouseenter', () => { pFeedback.style.color = DS.colors.text; });
  pFeedback.addEventListener('mouseleave', () => { pFeedback.style.color = DS.colors.textMuted; });
  profileBox.appendChild(pFeedback);

  const pGear = document.createElement('div');
  pGear.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`;
  pGear.style.color = DS.colors.textMuted;
  pGear.style.cursor = 'pointer';
  pGear.onclick = () => { import("../settings").then(({ openSettings }) => openSettings()); };
  profileBox.appendChild(pGear);
  topRow.appendChild(profileBox);
  
  el.appendChild(topRow);
  updateProfileBox();

  const mainLayout = document.createElement('div');
  mainLayout.id = 'mm-main-layout';
  Object.assign(mainLayout.style, {
    position: 'absolute', top: 'clamp(140px, 26vh, 180px)', bottom: 'clamp(120px, 22vh, 160px)', 
    left: 'clamp(15px, 3vw, 30px)', right: 'clamp(15px, 3vw, 30px)', zIndex: '2',
    display: 'flex', flexDirection: 'row', gap: 'clamp(40px, 10vw, 150px)',
    maxWidth: '800px', margin: '0 auto', transition: 'opacity 0.3s'
  });

  const menuLeftColumn = document.createElement('div');
  Object.assign(menuLeftColumn.style, {
    display: 'flex', flexDirection: 'column', gap: 'clamp(5px, 0.75vh, 10px)', flex: '1', minHeight: '0'
  });

  const menuRightColumn = document.createElement('div');
  Object.assign(menuRightColumn.style, {
    display: 'flex', flexDirection: 'column', gap: 'clamp(5px, 0.75vh, 10px)', flex: '1', minHeight: '0'
  });

  const leftBottomRow = document.createElement('div');
  Object.assign(leftBottomRow.style, {
    display: 'flex', gap: 'clamp(3px, 0.5vw, 5px)', flex: '1'
  });

  const rightBottomRow = document.createElement('div');
  Object.assign(rightBottomRow.style, {
    display: 'flex', gap: 'clamp(3px, 0.5vw, 5px)', flex: '1'
  });

  const createNewCard = (title: string, bgImage: string) => {
    const card = document.createElement('div');
    card.className = 'mm-new-card';
    Object.assign(card.style, {
      flex: '1', backgroundImage: `url('${getAssetUrl(bgImage)}')`
    });

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.className = 'mm-new-card-title';
    card.appendChild(titleEl);

    return { card, titleEl };
  };

  // --- Middle Row ---
  // PLAY
  const playObj = createNewCard('PLAY', 'multiplayer_card.png');
  const playCard = playObj.card;
  playCard.style.flex = '1.8';
  playObj.titleEl.style.fontSize = 'clamp(14px, 12cqi, 42px)';
  playCard.onclick = (e) => {
    e.stopPropagation();
    setActiveCard('PLAY');
  };
  
  const playContent = document.createElement('div');
  Object.assign(playContent.style, {
    flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'flex-end',
    padding: 'clamp(6px, 1vh, 12px)', gap: '5px', zIndex: '2', pointerEvents: 'none'
  });

  if (IS_DEV) {
    const devContainer = document.createElement('div');
    Object.assign(devContainer.style, { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 'auto', pointerEvents: 'auto' });
    
    const createDevBtn = (text: string, onClick: (e:Event) => void) => {
        const btn = document.createElement('div');
        btn.textContent = text;
        Object.assign(btn.style, {
            color: DS.colors.background, border: 'none', background: DS.colors.accent,
            padding: '4px 8px', fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 3cqi, 14px)', cursor: 'pointer',
            fontWeight: 'bold', textShadow: 'none', borderRadius: '2px'
        });
        btn.onclick = onClick;
        devContainer.appendChild(btn);
    };

    createDevBtn('DEV QUICK START', (e) => {
        e.stopPropagation();
        const mapId = getDefaultMap().id;
        ensureAssetsDownloaded(() => {
            window.dispatchEvent(new CustomEvent('start-match', { detail: { mode: 'STANDARD', class: 'ASSAULT', solo: true, map: getDefaultMap() }}));
            screenManager.showGame();
        }, mapId);
    });
    createDevBtn('MAP EDITOR', (e) => {
        e.stopPropagation();
        screenManager.showDevMapEditor();
    });
    createDevBtn('DEV ENTITIES', (e) => {
        e.stopPropagation();
        screenManager.showDevEntities();
    });
    playContent.appendChild(devContainer);
  }

  const qmBtn = document.createElement('div');
  qmBtn.textContent = 'QUICK START';
  Object.assign(qmBtn.style, {
    color: DS.colors.background, background: DS.colors.accent, border: 'none',
    padding: 'clamp(3px, 0.75vh, 5px) clamp(6px, 1.5cqi, 12px)',
    fontFamily: DS.typography.fontFamily, fontWeight: DS.typography.weightBold,
    fontSize: 'clamp(9px, 5cqi, 17px)', cursor: 'pointer', pointerEvents: 'auto',
    borderRadius: '2px', textAlign: 'center'
  });
  qmBtn.onclick = (e) => {
      e.stopPropagation();
      const mapId = getDefaultMap().id;
      ensureAssetsDownloaded(() => {
          try {
              const docEl = document.documentElement as any;
              if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
                  if (docEl.requestFullscreen) docEl.requestFullscreen();
                  else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
              }
          } catch (err) {}
          window.dispatchEvent(new CustomEvent('start-match', { detail: { mode: 'STANDARD', class: 'ASSAULT', solo: true, map: getDefaultMap() }}));
          screenManager.showGame();
      }, mapId);
  };
  playContent.appendChild(qmBtn);
  playCard.appendChild(playContent);
  menuLeftColumn.appendChild(playCard);

  // INTEL
  const intelObj = createNewCard('INTEL', 'statistics_card.png');
  const intelCard = intelObj.card;
  intelCard.style.flex = '1.8';
  intelObj.titleEl.style.fontSize = 'clamp(14px, 12cqi, 42px)';
  
  const intelInternal = document.createElement('div');
  Object.assign(intelInternal.style, {
    flex: '1', display: 'flex', flexDirection: 'column', padding: 'clamp(6px, 1vh, 12px)', zIndex: '2', pointerEvents: 'none'
  });
  
  const statsLabel = document.createElement('div');
  statsLabel.textContent = 'Stats';
  Object.assign(statsLabel.style, { 
    fontFamily: DS.typography.fontFamily, color: DS.colors.accent, fontSize: 'clamp(7px, 4cqi, 13px)', 
    textTransform: 'uppercase', marginBottom: 'auto', textAlign: 'right'
  });
  
  const dividerLine = document.createElement('div');
  Object.assign(dividerLine.style, { width: '100%', height: '1px', background: 'rgba(255,0,0,0.4)', margin: '6px 0' });
  
  const challengesLabel = document.createElement('div');
  challengesLabel.textContent = 'Challenges';
  Object.assign(challengesLabel.style, { 
    fontFamily: DS.typography.fontFamily, color: 'rgba(255,0,0,0.8)', fontSize: 'clamp(7px, 4cqi, 13px)', 
    textTransform: 'uppercase', textAlign: 'right'
  });

  intelInternal.appendChild(statsLabel);
  intelInternal.appendChild(dividerLine);
  intelInternal.appendChild(challengesLabel);
  intelCard.appendChild(intelInternal);

  intelCard.onclick = (e) => {
    e.stopPropagation();
    setActiveCard('INTEL');
  };
  menuRightColumn.appendChild(intelCard);

  // --- Bottom Rows ---
  const addBottomCard = (id: string, title: string, img: string, container: HTMLElement, flexValue: string = '1') => {
    const obj = createNewCard(title, img);
    if (id === 'FACTION' || id === 'FEEDBACK') {
      obj.card.style.aspectRatio = '1 / 1';
      obj.card.style.flex = 'none';
    } else {
      obj.card.style.flex = flexValue;
    }
    if (id === 'FACTION') obj.card.id = 'faction-card';
    obj.card.onclick = (e) => {
      e.stopPropagation();
      setActiveCard(id);
    };
    container.appendChild(obj.card);
  };

  addBottomCard('LOADOUT', 'LOADOUT', 'Blueprint.png', leftBottomRow, '1');
  addBottomCard('STORE', 'STORE', 'store_card.png', rightBottomRow, '2');
  addBottomCard('FACTION', 'FACTION', 'vibeCo_card.png', rightBottomRow, '1');

  menuLeftColumn.appendChild(leftBottomRow);
  menuRightColumn.appendChild(rightBottomRow);
  mainLayout.appendChild(menuLeftColumn);
  mainLayout.appendChild(menuRightColumn);
  fisheyeWrap.appendChild(mainLayout);

  const tabContentLayout = document.createElement('div');
  tabContentLayout.id = 'mm-tab-layout';
  Object.assign(tabContentLayout.style, {
    position: 'absolute', top: 'clamp(40px, 7.5vh, 60px)', bottom: 'clamp(15px, 2.5vh, 30px)', 
    left: 'clamp(15px, 2.5vw, 30px)', right: 'clamp(15px, 2.5vw, 30px)', zIndex: '3',
    display: 'none', flexDirection: 'column',
    maxWidth: '600px', margin: '0 auto'
  });

  const backBtn = document.createElement('div');
  backBtn.textContent = 'BACK TO MENU';
  Object.assign(backBtn.style, {
    fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)',
    color: DS.colors.warning, cursor: 'pointer', marginBottom: '20px', fontWeight: 'bold'
  });
  backBtn.onclick = () => {
    setActiveCard('DEFAULT');
  };
  tabContentLayout.appendChild(backBtn);

  const tabTitle = document.createElement('div');
  tabTitle.id = 'dynamic-panel-title';
  Object.assign(tabTitle.style, {
    fontFamily: DS.typography.fontFamily, fontSize: 'clamp(24px, 4vh, 48px)',
    color: DS.colors.text, textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '20px',
    textShadow: DS.shadows.text
  });
  tabContentLayout.appendChild(tabTitle);

  rightPanelContent = document.createElement('div');
  Object.assign(rightPanelContent.style, {
    display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto',
    flex: '1', scrollbarWidth: 'none', msOverflowStyle: 'none'
  });
  tabContentLayout.appendChild(rightPanelContent);
  fisheyeWrap.appendChild(tabContentLayout);

  document.body.appendChild(el);

  // Trigger default panel render for INTEL
  currentRightPanelMode = 'DEFAULT';
  renderRightPanel();

  setTimeout(() => { if (el) el.style.opacity = '1'; }, 50);
}

function updateProfileBox() {
  const factionCard = document.getElementById('faction-card');
  if (factionCard) {
    let img = 'vibeCo_card.png';
    if (userFaction === 'SLOP INC.') img = 'slopInc_card.png';
    import('../asset-cache').then(({ getAssetUrl }) => {
      factionCard.style.backgroundImage = `url('${getAssetUrl(img)}')`;
    });
  }
  if (registeredUserData) {
    profileNameText.textContent = `${registeredUserData.displayName.toUpperCase()}`;
    profileRankBadge.textContent = `${registeredUserData.battlePass || 1}`;
    profileRankBadge.style.display = 'block';
    profileNameText.style.color = DS.colors.text;

    let crDisplay = document.getElementById('profile-cr-display');
    if (!crDisplay) {
      crDisplay = document.createElement('div');
      crDisplay.id = 'profile-cr-display';
      Object.assign(crDisplay.style, {
        fontFamily: DS.typography.fontFamily,
        fontSize: 'clamp(8px, 1vh, 10px)',
        color: DS.colors.accent,
        letterSpacing: '1.2px',
        marginTop: '2px',
        fontWeight: 'bold'
      });
      profileNameText.parentNode?.insertBefore(crDisplay, profileNameText.nextSibling);
    }
    crDisplay.textContent = `CR: ${registeredUserData.credits !== undefined ? registeredUserData.credits : 100} · EN: ${registeredUserData.energy !== undefined ? registeredUserData.energy : 100}`;
  } else {
    const guestId = localStorage.getItem('guestId') || Math.random().toString(36).substring(2, 8).toUpperCase();
    localStorage.setItem('guestId', guestId);
    profileNameText.textContent = `GUEST — [${guestId}]`;
    profileRankBadge.textContent = '—';
    profileNameText.style.color = DS.colors.textMuted;

    const crDisplay = document.getElementById('profile-cr-display');
    if (crDisplay) crDisplay.remove();
  }
}

function setActiveCard(id: string) {
  if (currentRightPanelMode === id as any) return;
  import('../audio').then(({ audioManager }) => audioManager.play('click'));
  currentRightPanelMode = id as any;
  const titleEl = document.getElementById('dynamic-panel-title');
  if (titleEl) {
    titleEl.textContent = id === 'DEFAULT' ? 'INTEL' : id;
  }
  
  const mainLayout = document.getElementById('mm-main-layout');
  const tabLayout = document.getElementById('mm-tab-layout');
  
  if (id === 'DEFAULT') {
    if (mainLayout) mainLayout.style.display = 'flex';
    if (tabLayout) tabLayout.style.display = 'none';
  } else {
    if (mainLayout) mainLayout.style.display = 'none';
    if (tabLayout) tabLayout.style.display = 'flex';
    renderRightPanel();
  }
}

function clearActiveCard() {
  setActiveCard('DEFAULT');
}

function createPanelBlock(label: string, renderContent: (container: HTMLElement) => void, isLast: boolean = false) {
  const block = document.createElement('div');
  Object.assign(block.style, {
    padding: 'clamp(8px, 2vh, 16px) 0', borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.06)'
  });
  
  if (label) {
    const lbl = document.createElement('div');
    lbl.textContent = label;
    Object.assign(lbl.style, {
      fontFamily: DS.typography.fontFamily, fontSize: 'clamp(8px, 1.25vh, 11px)', textTransform: 'uppercase',
      color: DS.colors.textMuted, letterSpacing: '4px', marginBottom: 'clamp(4px, 1vh, 8px)'
    });
    block.appendChild(lbl);
  }

  renderContent(block);
  return block;
}

function renderRightPanel() {
  rightPanelContent.style.opacity = '0';
  
  // Right Column Overflow Logic
  const rightCol = document.getElementById('mm-right-col');
  if (rightCol) {
     rightCol.style.overflowY = 'auto';
  }

  setTimeout(() => {
    rightPanelContent.innerHTML = '';
    
    if (currentRightPanelMode === 'DEFAULT' || currentRightPanelMode === 'INTEL') {
       rightPanelContent.appendChild(createPanelBlock(currentRightPanelMode === 'DEFAULT' ? 'INTEL SUMMARY' : 'LIFETIME STATS', c => {
         const stats = [
           { l: 'MATCHES', v: registeredUserData ? String(registeredUserData.totalMatches || 0) : '—' },
           { l: 'WINS', v: registeredUserData ? String(registeredUserData.totalWins || 0) : '—' },
           { l: 'WIN RATE', v: registeredUserData ? `${registeredUserData.winRate || 0}%` : '—' },
           { l: 'ELIMINATIONS', v: registeredUserData ? String(registeredUserData.totalDroneEliminations || 0) : '—' },
           { l: 'DEATHS', v: registeredUserData ? String(registeredUserData.totalDeaths || 0) : '—' },
           { l: 'OBJECTIVE TIME', v: registeredUserData ? `${registeredUserData.totalObjectiveTimeHeld || 0}s` : '—' },
           { l: 'REVIVES', v: registeredUserData ? String(registeredUserData.totalRevivesPerformed || 0) : '—' },
           { l: 'BEST SCORE', v: registeredUserData ? String(registeredUserData.highestIndividualScore || 0) : '—' }
         ];
         stats.forEach(s => {
           const row = document.createElement('div');
           Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', marginBottom: 'clamp(4px, 1vh, 8px)' });
           const lbl = document.createElement('span'); lbl.textContent = s.l;
           Object.assign(lbl.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 14px)', color: DS.colors.textMuted });
           const val = document.createElement('span'); val.textContent = s.v;
           Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: DS.colors.text, fontWeight: DS.typography.weightBold });
           row.appendChild(lbl); row.appendChild(val); c.appendChild(row);
         });

         if (IS_DEV) {
           const devBlock = document.createElement('div');
           Object.assign(devBlock.style, {
             marginTop: '24px',
             borderTop: '1px dashed rgba(255,255,255,0.1)',
             paddingTop: '16px',
             fontFamily: DS.typography.fontFamily
           });
           
           const devTitle = document.createElement('div');
           devTitle.textContent = 'DEV DIAGNOSTICS';
           Object.assign(devTitle.style, {
             fontSize: '11px',
             letterSpacing: '3px',
             color: DS.colors.dev,
             marginBottom: '8px'
           });
           devBlock.appendChild(devTitle);
           
           const devNote = document.createElement('div');
           devNote.textContent = 'NOTE: Standard 100-credit allotment is arbitrary and subject to game balance review.';
           Object.assign(devNote.style, {
             fontSize: '10px',
             color: DS.colors.textMuted,
             marginBottom: '12px',
             textTransform: 'none'
           });
           devBlock.appendChild(devNote);
           
           const refillBtn = document.createElement('button');
           refillBtn.textContent = 'REFILL CREDITS & ENERGY [DEV SERVER AUTH]';
           Object.assign(refillBtn.style, {
             width: '100%',
             padding: '8px',
             background: 'rgba(255, 0, 100, 0.15)',
             border: '1px solid rgba(255, 0, 100, 0.4)',
             color: DS.colors.dev,
             fontSize: '11px',
             fontWeight: 'bold',
             letterSpacing: '2px',
             cursor: 'pointer'
           });
           refillBtn.onclick = () => {
             const auth = getAuth();
             import('../main').then(({ getSocketChannel }) => {
               const chan = getSocketChannel();
               if (chan && registeredUserData) {
                 chan.emit('refill_credits', { uid: auth.currentUser?.uid });
                 showMenuNotification("CREDITS REFILL REQUEST EMITTED.");
               } else {
                 showMenuNotification("CHANNEL INACTIVE. OFFLINE FALLBACK EMULATING REFILL.", "warning");
                 const uid = auth.currentUser?.uid;
                 if (uid) {
                   import('firebase/firestore').then(({ updateDoc }) => {
                     updateDoc(doc(getFirestore(), 'Users', uid), {
                       credits: 1000,
                       energy: 1000
                     });
                   });
                 }
               }
             });
           };
           devBlock.appendChild(refillBtn);
           c.appendChild(devBlock);
         }
       }));
       rightPanelContent.appendChild(createPanelBlock('LAST MATCH', c => {
         const lbl = document.createElement('div'); lbl.textContent = 'NO DATA AVAILABLE';
         Object.assign(lbl.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 14px)', color: DS.colors.textMuted });
         c.appendChild(lbl);
       }, true));
    } 
    else if (currentRightPanelMode === 'PLAY') {
      rightPanelContent.appendChild(createPanelBlock('GAME MODE', c => {
         const opActive = document.createElement('div'); opActive.textContent = 'INFILTRATION';
         Object.assign(opActive.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: DS.colors.text, borderLeft: '2px solid ' + DS.colors.accent, background: 'rgba(255, 69, 0, 0.08)', padding: 'clamp(2px, 0.5vh, 4px) clamp(4px, 1vw, 8px)', marginBottom: 'clamp(2px, 0.5vh, 4px)' });
         const opFuture = document.createElement('div'); opFuture.innerHTML = 'HARDCORE <span style="font-size:clamp(8px, 1.25vh, 11px); color:' + DS.colors.textMuted + '">COMING SOON</span>';
         Object.assign(opFuture.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: DS.colors.text, opacity: '0.35', padding: 'clamp(2px, 0.5vh, 4px) clamp(4px, 1vw, 8px)' });
         c.appendChild(opActive); c.appendChild(opFuture);
      }));
      rightPanelContent.appendChild(createPanelBlock('MATCH TYPE', c => {
         const opActive = document.createElement('div'); opActive.textContent = 'OPEN MATCH';
         Object.assign(opActive.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: DS.colors.text, borderLeft: '2px solid ' + DS.colors.accent, background: 'rgba(255, 69, 0, 0.08)', padding: 'clamp(2px, 0.5vh, 4px) clamp(4px, 1vw, 8px)', marginBottom: 'clamp(2px, 0.5vh, 4px)' });
         const op2 = document.createElement('div'); op2.textContent = 'PRIVATE MATCH';
         Object.assign(op2.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: DS.colors.text, opacity: '0.6', padding: 'clamp(2px, 0.5vh, 4px) clamp(4px, 1vw, 8px)' });
         c.appendChild(opActive); c.appendChild(op2);
      }));
      rightPanelContent.appendChild(createPanelBlock('CONTRACTORS', c => {
         const val = document.createElement('div'); val.textContent = '1 / 10';
         Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: DS.colors.text });
         c.appendChild(val);
      }));
      rightPanelContent.appendChild(createPanelBlock('', c => {
         const btn = document.createElement('button');
         btn.textContent = 'DEPLOY';
         Object.assign(btn.style, {
           width: '100%', height: 'clamp(32px, 6vh, 48px)', background: DS.colors.accent, color: DS.colors.background, border: 'none',
           fontFamily: DS.typography.fontFamily, fontSize: 'clamp(16px, 3vh, 24px)', fontWeight: DS.typography.weightBold, textTransform: 'uppercase',
           cursor: 'pointer'
         });
         btn.addEventListener('click', () => { 
             if (registeredUserData && (registeredUserData.energy || 0) < 10) {
                 showMenuNotification("DEPLOYMENT REJECTED: INSUFFICIENT ENERGY. REFILL DEV CREDITS IN INTEL.", "warning");
                 return;
             }
             ensureAssetsDownloaded(() => screenManager.showLobby(), getDefaultMap().id); 
         });
         c.appendChild(btn);
      }, true));
    }
    else if (currentRightPanelMode === 'LOADOUT') {
        rightPanelContent.appendChild(createPanelBlock('LOADOUT', c => {
            const val = document.createElement('div'); val.textContent = 'EQUIPMENT SYSTEM OFFLINE';
            Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: '#888888' });
            c.appendChild(val);
        }));
    }
    else if (currentRightPanelMode === 'FACTION') {
      const auth = getAuth();
      const isGuest = !auth.currentUser || auth.currentUser.isAnonymous;
      rightPanelContent.appendChild(createPanelBlock('CURRENT FACTION', c => {
         const val = document.createElement('div'); val.textContent = isGuest ? 'UNAFFILIATED' : (userFaction || 'UNASSIGNED');
         Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: DS.colors.text });
         c.appendChild(val);
      }));
      rightPanelContent.appendChild(createPanelBlock('ENLIST', c => {
         ['VIBE CO.', 'SLOP INC.'].forEach((f, i) => {
            const btn = document.createElement('div'); btn.textContent = f;
            const isSelected = userFaction === f;
            Object.assign(btn.style, {
              fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', padding: 'clamp(6px, 1.5vh, 12px)', marginBottom: 'clamp(4px, 1vh, 8px)', cursor: isGuest ? 'default' : 'pointer',
              borderLeft: isSelected ? '2px solid ' + DS.colors.accent : '2px solid transparent',
              background: isSelected ? 'rgba(255, 69, 0, 0.08)' : 'transparent',
              color: isSelected ? DS.colors.text : DS.colors.textMuted
            });
            c.appendChild(btn);
         });
      }));
      rightPanelContent.appendChild(createPanelBlock('', c => {
         const btn = document.createElement('button');
         btn.textContent = 'CONFIRM';
         Object.assign(btn.style, {
           width: '100%', height: 'clamp(32px, 6vh, 48px)', background: isGuest ? '#333' : DS.colors.accent, color: isGuest ? '#666' : DS.colors.background, border: 'none',
           fontFamily: DS.typography.fontFamily, fontSize: 'clamp(16px, 3vh, 24px)', fontWeight: DS.typography.weightBold, textTransform: 'uppercase', cursor: isGuest ? 'default' : 'pointer'
         });
         if (isGuest) btn.disabled = true;
         c.appendChild(btn);
         if (isGuest) {
            const sub = document.createElement('div'); sub.textContent = 'Sign in to save faction.';
            Object.assign(sub.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 13px)', color: DS.colors.textMuted, textAlign: 'center', marginTop: 'clamp(4px, 1vh, 8px)' });
            c.appendChild(sub);
         }
      }, true));
    }
    else if (currentRightPanelMode === 'FEEDBACK') {
       let sr = 0;
       const stars: HTMLElement[] = [];
       rightPanelContent.appendChild(createPanelBlock('', c => {
         const row = document.createElement('div'); Object.assign(row.style, { display: 'flex', gap: 'clamp(4px, 1vh, 8px)', marginBottom: 'clamp(8px, 2vh, 16px)' });
         for (let i=1; i<=5; i++) {
           const s = document.createElement('div'); s.innerHTML = '★';
           Object.assign(s.style, { fontSize: 'clamp(20px, 3.5vh, 32px)', color: DS.colors.border, cursor: 'pointer', lineHeight: '1' });
           s.onclick = () => { sr = i; stars.forEach((st, idx) => st.style.color = idx < sr ? DS.colors.accent : DS.colors.border); };
           stars.push(s); row.appendChild(s);
         }
         c.appendChild(row);

         const txt = document.createElement('textarea');
         txt.placeholder = 'Describe your experience.';
         Object.assign(txt.style, {
           width: '100%', height: 'clamp(50px, 10vh, 80px)', background: 'rgba(0,0,0,0.4)', border: DS.glass.border,
           color: DS.colors.text, fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 13px)', padding: 'clamp(5px, 1vh, 10px)', resize: 'none'
         });
         c.appendChild(txt);
       }));
       rightPanelContent.appendChild(createPanelBlock('', c => {
         const btn = document.createElement('button'); btn.textContent = 'SUBMIT';
         Object.assign(btn.style, {
           width: '100%', height: 'clamp(30px, 4vh, 40px)', background: DS.colors.accent, color: DS.colors.background, border: 'none',
           fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', fontWeight: DS.typography.weightBold, textTransform: 'uppercase', cursor: 'pointer'
         });
         btn.onclick = async () => {
           const auth = getAuth();
           const uid = auth.currentUser ? auth.currentUser.uid : "guest";
           const txt = rightPanelContent.querySelector('textarea');
           try {
               await addDoc(collection(getFirestore(), "feedback"), {
                   rating: sr, text: txt?.value || '', timestamp: serverTimestamp(), userId: uid
               });
               if(txt) txt.value = '';
               sr = 0; stars.forEach(st => st.style.color = DS.colors.border);
               btn.textContent = 'SENT';
               setTimeout(() => btn.textContent = 'SUBMIT', 2000);
           } catch(e) {}
         };
         c.appendChild(btn);
       }, true));
    }
    else if (currentRightPanelMode === 'STORE') {
        rightPanelContent.appendChild(createPanelBlock('STORE', c => {
            const val = document.createElement('div'); val.textContent = 'OFFLINE';
            Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: '#888888' });
            c.appendChild(val);
        }));
    }
    else if (currentRightPanelMode === 'MAP_EDITOR') {
        rightPanelContent.appendChild(createPanelBlock('AVAILABLE MAPS', c => {
            MAP_REGISTRY.forEach(map => {
                const mapBtn = document.createElement('div');
                Object.assign(mapBtn.style, {
                    padding: 'clamp(8px, 1.5vh, 12px)',
                    marginBottom: '8px',
                    borderLeft: `2px solid ${DS.colors.accent}`,
                    background: 'rgba(255,255,255,0.05)',
                    cursor: 'pointer',
                    color: DS.colors.text,
                    fontFamily: DS.typography.fontFamily,
                    fontSize: 'clamp(14px, 2.5vh, 18px)'
                });
                mapBtn.textContent = map.displayName;
                mapBtn.addEventListener('mouseenter', () => { mapBtn.style.background = 'rgba(255,255,255,0.1)'; });
                mapBtn.addEventListener('mouseleave', () => { mapBtn.style.background = 'rgba(255,255,255,0.05)'; });
                mapBtn.addEventListener('click', () => {
                    if ((window as any).launchMapEditor) {
                        (window as any).launchMapEditor(map.id);
                    } else {
                        console.log('launchMapEditor missing');
                    }
                });
                c.appendChild(mapBtn);
            });
        }));
    }

    rightPanelContent.style.opacity = '1';
  }, 100);
}

function checkDailyRefresh(userData: any, userDocRef: any) {
  if (!userData || !userData.dailyRefreshedAt) return;
  
  let refreshedDate: Date;
  if (userData.dailyRefreshedAt.toDate) {
    refreshedDate = userData.dailyRefreshedAt.toDate();
  } else if (userData.dailyRefreshedAt.seconds) {
    refreshedDate = new Date(userData.dailyRefreshedAt.seconds * 1000);
  } else {
    refreshedDate = new Date(userData.dailyRefreshedAt);
  }
  
  const now = new Date();
  
  const refreshedYear = refreshedDate.getFullYear();
  const refreshedMonth = refreshedDate.getMonth();
  const refreshedDay = refreshedDate.getDate();
  
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDay = now.getDate();
  
  const isDifferentDay = (currentYear > refreshedYear) ||
                         (currentYear === refreshedYear && currentMonth > refreshedMonth) ||
                         (currentYear === refreshedYear && currentMonth === refreshedMonth && currentDay > refreshedDay);
                         
  if (isDifferentDay) {
    import('firebase/firestore').then(async ({ updateDoc, serverTimestamp }) => {
      try {
        await updateDoc(userDocRef, {
          credits: (userData.credits || 0) + 100,
          energy: (userData.energy || 0) + 100,
          dailyRefreshedAt: serverTimestamp()
        });
        showMenuNotification("DAILY REFRESH: +100 Credits & +100 Energy awarded!");
      } catch (err) {
        console.warn("Daily refresh update failed:", err);
      }
    });
  }
}

function showMenuNotification(msg: string, type: 'info' | 'warning' = 'info') {
  const container = document.getElementById('vex-menu-notification-container') || document.createElement('div');
  if (!container.parentElement) {
    container.id = 'vex-menu-notification-container';
    Object.assign(container.style, {
      position: 'absolute',
      top: 'clamp(36px, 5vh, 50px)',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '4500',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      pointerEvents: 'none'
    });
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = 'mm-glass';
  Object.assign(toast.style, {
    padding: '8px 16px',
    fontFamily: DS.typography.fontFamily,
    fontSize: '12px',
    letterSpacing: '2px',
    color: type === 'warning' ? DS.colors.danger : DS.colors.accent,
    borderLeft: `3px solid ${type === 'warning' ? DS.colors.danger : DS.colors.accent}`,
    boxShadow: DS.glass.glowOuter,
    pointerEvents: 'auto',
    opacity: '0',
    transition: 'all 300ms cubic-bezier(0.4,0,0.2,1)',
    transform: 'translateY(-20px)'
  });
  toast.textContent = msg.toUpperCase();
  container.appendChild(toast);
  
  void toast.offsetWidth;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function enableLeftColumnMenu(enabled: boolean) {
  const cards = document.querySelectorAll('.mm-new-card');
  cards.forEach(child => {
    const c = child as HTMLElement;
    if (enabled) {
      c.style.pointerEvents = 'auto';
      c.style.opacity = '1';
    } else {
      c.style.pointerEvents = 'none';
      c.style.opacity = '0.3';
    }
  });
}

function showEnlistmentOverlay(db: any, auth: any) {
  let overlay = document.getElementById('vex-enlistment-overlay');
  if (overlay) return;
  
  overlay = document.createElement('div');
  overlay.id = 'vex-enlistment-overlay';
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '4000',
    background: 'rgba(10, 10, 10, 0.95)',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    animation: 'fade-in 400ms ease-out'
  });
  
  const widthContainer = document.createElement('div');
  Object.assign(widthContainer.style, {
    width: '100%',
    maxWidth: '520px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  });
  
  const branding = document.createElement('div');
  Object.assign(branding.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    marginBottom: '8px'
  });
  const logoStar = document.createElement('div');
  logoStar.textContent = '✧';
  Object.assign(logoStar.style, {
    fontSize: '44px',
    color: DS.colors.accent,
    lineHeight: '1',
    animation: 'pulse 2s infinite ease-in-out'
  });
  branding.appendChild(logoStar);
  
  const word = document.createElement('div');
  word.textContent = 'VEXEΛ SECURE PORTAL';
  Object.assign(word.style, {
    fontFamily: DS.typography.fontFamily,
    fontSize: '24px',
    fontWeight: 'bold',
    letterSpacing: '6px',
    color: DS.colors.text,
    marginTop: '8px'
  });
  branding.appendChild(word);
  
  const sub = document.createElement('div');
  sub.textContent = 'RESTRICTED SYSTEM ACCESS — REGISTER CODENAME';
  Object.assign(sub.style, {
    fontFamily: DS.typography.fontFamily,
    fontSize: '11px',
    letterSpacing: '3px',
    color: DS.colors.textMuted,
    marginTop: '4px'
  });
  branding.appendChild(sub);
  widthContainer.appendChild(branding);
  
  const inputGroup = document.createElement('div');
  Object.assign(inputGroup.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
  
  const inputLabel = document.createElement('div');
  inputLabel.textContent = 'CONTRACTOR CODENAME';
  Object.assign(inputLabel.style, {
    fontFamily: DS.typography.fontFamily,
    fontSize: '11px',
    letterSpacing: '3px',
    color: DS.colors.accent
  });
  inputGroup.appendChild(inputLabel);
  
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'ENTER CODENAME [3-16 ALPHANUMERIC]';
  Object.assign(input.style, {
    width: '100%',
    padding: '12px',
    background: 'rgba(0, 0, 0, 0.4)',
    border: DS.glass.border,
    color: DS.colors.text,
    fontFamily: DS.typography.fontFamily,
    fontSize: '14px',
    letterSpacing: '2px',
    outline: 'none',
    textAlign: 'center'
  });
  input.onfocus = () => { input.style.border = DS.glass.borderAccentFull; };
  input.onblur = () => { input.style.border = DS.glass.border; };
  inputGroup.appendChild(input);
  widthContainer.appendChild(inputGroup);
  
  const factionLabel = document.createElement('div');
  factionLabel.textContent = 'FACTION AFFILIATION [COSMETIC ONLY]';
  Object.assign(factionLabel.style, {
    fontFamily: DS.typography.fontFamily,
    fontSize: '11px',
    letterSpacing: '3px',
    color: DS.colors.textMuted,
    marginBottom: '-10px'
  });
  widthContainer.appendChild(factionLabel);
  
  const factionsGrid = document.createElement('div');
  Object.assign(factionsGrid.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px'
  });
  
  let selectedFaction: string | null = null;
  
  const vibeCard = document.createElement('div');
  vibeCard.className = 'mm-glass';
  Object.assign(vibeCard.style, {
    padding: '16px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    transition: 'all 250ms ease'
  });
  vibeCard.innerHTML = `
    <div style="font-family:${DS.typography.fontFamily}; font-size:16px; font-weight:bold; letter-spacing:2px; color:${DS.colors.factions.vibe.primary};">VIBE CO.</div>
    <div style="font-family:${DS.typography.fontFamily}; font-size:9px; letter-spacing:1px; color:${DS.colors.factions.vibe.muted}; margin-top:4px;">SILENT & PRECISE</div>
    <div style="font-family:${DS.typography.fontFamily}; font-size:10px; color:${DS.colors.textMuted}; text-transform:none; margin-top:8px; line-height:1.4;">Corporate infiltrators specialized in speed, stealth, and facility breaches.</div>
  `;
  vibeCard.onclick = () => {
    selectedFaction = 'VIBE CO.';
    vibeCard.style.border = `1px solid ${DS.colors.factions.vibe.primary}`;
    vibeCard.style.boxShadow = `0 0 15px ${DS.colors.factions.vibe.shadow}`;
    slopCard.style.border = DS.glass.border;
    slopCard.style.boxShadow = 'none';
  };
  factionsGrid.appendChild(vibeCard);
  
  const slopCard = document.createElement('div');
  slopCard.className = 'mm-glass';
  Object.assign(slopCard.style, {
    padding: '16px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    transition: 'all 250ms ease'
  });
  slopCard.innerHTML = `
    <div style="font-family:${DS.typography.fontFamily}; font-size:16px; font-weight:bold; letter-spacing:2px; color:${DS.colors.factions.slop.primary};">SLOP INC.</div>
    <div style="font-family:${DS.typography.fontFamily}; font-size:9px; letter-spacing:1px; color:${DS.colors.factions.slop.muted}; margin-top:4px;">BRUTALIST & UTILITY</div>
    <div style="font-family:${DS.typography.fontFamily}; font-size:10px; color:${DS.colors.textMuted}; text-transform:none; margin-top:8px; line-height:1.4;">Heavy sweeper division specialized in maximum attrition and hardware pacification.</div>
  `;
  slopCard.onclick = () => {
    selectedFaction = 'SLOP INC.';
    slopCard.style.border = `1px solid ${DS.colors.factions.slop.primary}`;
    slopCard.style.boxShadow = `0 0 15px ${DS.colors.factions.slop.shadow}`;
    vibeCard.style.border = DS.glass.border;
    vibeCard.style.boxShadow = 'none';
  };
  factionsGrid.appendChild(slopCard);
  widthContainer.appendChild(factionsGrid);
  
  const errText = document.createElement('div');
  Object.assign(errText.style, {
    fontFamily: DS.typography.fontFamily,
    fontSize: '11px',
    letterSpacing: '1px',
    color: DS.colors.danger,
    textAlign: 'center',
    height: '14px',
    margin: '-4px 0'
  });
  widthContainer.appendChild(errText);
  
  const enlistBtn = document.createElement('button');
  enlistBtn.textContent = 'ENLIST CONTRACTOR';
  Object.assign(enlistBtn.style, {
    width: '100%',
    padding: '12px',
    background: DS.colors.accent,
    color: DS.colors.background,
    fontFamily: DS.typography.fontFamily,
    fontSize: '16px',
    fontWeight: 'bold',
    letterSpacing: '3px',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 200ms ease'
  });
  
  enlistBtn.onclick = async () => {
    const codename = input.value.trim().toUpperCase();
    if (codename.length < 3 || codename.length > 16) {
      errText.textContent = 'ERROR: CODENAME MUST BE 3 - 16 CHARACTERS';
      return;
    }
    if (!/^[A-Z0-9]+$/.test(codename)) {
      errText.textContent = 'ERROR: ONLY ALPHANUMERIC CHARACTERS ALLOWED';
      return;
    }
    if (!selectedFaction) {
      errText.textContent = 'ERROR: FACTION AFFILIATION REQUIRED';
      return;
    }
    
    enlistBtn.disabled = true;
    enlistBtn.textContent = 'PROCESSING ENLISTMENT...';
    errText.textContent = '';
    
    try {
      await setDoc(doc(db, 'Users', auth.currentUser.uid), {
        displayName: codename,
        faction: selectedFaction,
        credits: 100,
        energy: 100,
        createdAt: serverTimestamp(),
        dailyRefreshedAt: serverTimestamp(),
        
        totalMatches: 0,
        totalWins: 0,
        totalDroneEliminations: 0,
        totalDeaths: 0,
        totalObjectiveTimeHeld: 0,
        totalRevivesPerformed: 0,
        highestIndividualScore: 0,
        winRate: 0,
        score: 0,
        kills: 0,
        battlePass: 1
      });
      showMenuNotification("ENLISTMENT COMPLETE. WELCOME TO VEXEΛ, CONTRACTOR.");
    } catch (e: any) {
      console.warn("Enlistment failed:", e);
      enlistBtn.disabled = false;
      enlistBtn.textContent = 'ENLIST CONTRACTOR';
      errText.textContent = 'ERROR: TRANSACTION REJECTED BY SYSTEM';
    }
  };
  widthContainer.appendChild(enlistBtn);
  widthContainer.appendChild(errText);
  overlay.appendChild(widthContainer);
  
  const menuScreen = document.getElementById('main-menu-screen');
  if (menuScreen) {
    menuScreen.appendChild(overlay);
  }
}

