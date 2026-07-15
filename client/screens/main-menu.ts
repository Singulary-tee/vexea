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
let currentRightPanelMode: 'DEFAULT' | 'MULTIPLAYER' | 'FACTION' | 'STATISTICS' | 'FEEDBACK' | 'STORE' | 'PROFILE' | 'MAP_EDITOR' = 'DEFAULT';
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
      .mm-left-col { width: clamp(200px, 25vw, 320px); }
      .mm-right-col { width: clamp(280px, 30vw, 400px); right: clamp(16px, 3vw, 32px); }
      .mm-bot-banner { width: 40vw; max-width: 500px; min-width: 280px; }
      .mm-wordmark { font-size: clamp(24px, 4vw, 48px); }
      .mm-card-text { font-size: clamp(16px, 2vw, 24px); }
      .mm-card {
        transition: flex 320ms cubic-bezier(0.4,0,0.2,1), min-height 320ms cubic-bezier(0.4,0,0.2,1), max-height 320ms cubic-bezier(0.4,0,0.2,1), background-color 320ms cubic-bezier(0.4,0,0.2,1), border 320ms cubic-bezier(0.4,0,0.2,1), transform 320ms cubic-bezier(0.4,0,0.2,1);
        flex: 1 1 0px;
        min-height: clamp(32px, 6vh, 48px);
        max-height: clamp(60px, 12vh, 80px);
        overflow: hidden;
      }
      .mm-card-expanded {
        flex: 4 1 0px !important;
        min-height: clamp(140px, 20vh, 220px) !important;
        max-height: clamp(200px, 30vh, 320px) !important;
        background-size: cover !important;
        background-position: center !important;
        background-repeat: no-repeat !important;
      }
      .mm-card[data-id="MULTIPLAYER"].mm-card-expanded { background-image: url('${getAssetUrl("multiplayer_card.png")}') !important; }
      .mm-card[data-id="STATISTICS"].mm-card-expanded { background-image: url('${getAssetUrl("statistics_card.png")}') !important; }
      .mm-card[data-id="STORE"].mm-card-expanded { background-image: url('${getAssetUrl("store_card.png")}') !important; }
      .mm-card[data-id="FEEDBACK"].mm-card-expanded { background-image: url('${getAssetUrl("feedback_card.png")}') !important; }
      .mm-card.faction-vibe.mm-card-expanded { background-image: url('${getAssetUrl("vibeCo_card.png")}') !important; }
      .mm-card.faction-slop.mm-card-expanded { background-image: url('${getAssetUrl("slopInc_card.png")}') !important; }
      .mm-card-dimmed {
        opacity: 0.3 !important;
      }
      .mm-right-panel-content {
        transition: opacity ${DS.transitions.panel};
      }
      
      .mm-loop-bg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        z-index: 1;
        pointer-events: none;
        opacity: 0;
        transition: opacity 500ms ease-in-out;
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
      .mm-vignette {
        display: none;
      }
      #settings-sidebar::-webkit-scrollbar { display:none; }
      .mm-left-col { overflow-y: auto; overflow-x: hidden; }
      @media (max-width: 768px) {
         .mm-left-col { width: 320px; }
         .mm-bot-banner { width: 50vw; }
         .mm-wordmark { font-size: 32px !important; }
         .mm-profile-rank { display: none !important; }
         .mm-glass { backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important; }
         .mm-card-text { font-size: clamp(14px, 2vw, 18px) !important; }
      }
      @keyframes pulse {
        0%, 100% { opacity: 0.8; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.05); }
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
    backgroundColor: '#000',
    backgroundImage: `url('${getAssetUrl("splash_screen.png")}')`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    opacity: '0', transition: 'opacity 500ms ease-out',
    overflow: 'hidden'
  });

  const loopBg = document.createElement('video');
  loopBg.className = 'mm-loop-bg';
  loopBg.muted = true;
  loopBg.autoplay = true;
  loopBg.playsInline = true;
  loopBg.setAttribute('playsinline', 'true');
  loopBg.setAttribute('muted', 'true');
  el.appendChild(loopBg);

  const menuVideos = ['Mainvideo1.mp4'];
  const videoUrls: string[] = [];
  let currentVideoIndex = -1;

  async function playRandomVideo() {
    if (videoUrls.length === 0) return;
    let nextIdx = 0;
    if (videoUrls.length > 1) {
      do {
        nextIdx = Math.floor(Math.random() * videoUrls.length);
      } while (nextIdx === currentVideoIndex);
    }
    currentVideoIndex = nextIdx;
    loopBg.src = videoUrls[currentVideoIndex];
    loopBg.load();
    try {
      await loopBg.play();
    } catch (err) {
      console.warn("[Menu Video] Playback blocked or failed:", err);
    }
  }

  loopBg.addEventListener('playing', () => {
    loopBg.style.opacity = '1';
  });

  loopBg.addEventListener('ended', () => {
    loopBg.style.opacity = '0';
    setTimeout(() => {
      playRandomVideo();
    }, 500);
  });

  Promise.all(menuVideos.map(v => getCachedOrFetchUrl(v, 'Video'))).then(urls => {
    videoUrls.push(...urls);
    playRandomVideo();
  }).catch(e => {
    console.warn("[Menu Video] Error reading cached videos:", e);
  });

  const fisheyeWrap = document.createElement('div');
  fisheyeWrap.className = 'mm-fisheye-wrap';
  el.appendChild(fisheyeWrap);

  const vignette = document.createElement('div');
  vignette.className = 'mm-vignette';
  el.appendChild(vignette);

  // Region 1 & 2 — Top Row: VEXEA Wordmark and Profile Mode
  const topRow = document.createElement('div');
  Object.assign(topRow.style, {
    position: 'absolute', top: 'clamp(12px, 2vh, 24px)', left: 'clamp(16px, 3vw, 32px)', right: 'clamp(16px, 3vw, 32px)', zIndex: '2',
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
  });
  
  const wordmark = document.createElement('div');
  wordmark.className = 'mm-wordmark';
  wordmark.textContent = 'VEXEA';
  Object.assign(wordmark.style, {
    fontFamily: DS.typography.fontFamily, color: DS.colors.accent, letterSpacing: '4px',
    textTransform: 'uppercase', fontWeight: DS.typography.weightBold
  });
  topRow.appendChild(wordmark);

  const profileBox = document.createElement('div');
  profileBox.className = 'mm-glass';
  Object.assign(profileBox.style, {
    padding: 'clamp(4px, 1vh, 8px) clamp(6px, 1vw, 12px)', display: 'flex', alignItems: 'center', gap: 'clamp(6px, 1vw, 12px)'
  });

  const pIcon = document.createElement('div');
  pIcon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
  pIcon.style.color = '#888888';
  profileBox.appendChild(pIcon);

  profileNameText = document.createElement('div');
  Object.assign(profileNameText.style, {
    fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 14px)', color: '#E8E8E8', uppercase: 'true', letterSpacing: '2px'
  });
  profileBox.appendChild(profileNameText);

  profileRankBadge = document.createElement('div');
  profileRankBadge.className = 'mm-profile-rank';
  Object.assign(profileRankBadge.style, {
    background: DS.colors.accent, padding: 'clamp(2px, 0.5vh, 4px) clamp(5px, 1vw, 10px)',
    fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 14px)', fontWeight: DS.typography.weightBold, color: '#0A0A0A'
  });
  profileBox.appendChild(profileRankBadge);

  const divider = document.createElement('div');
  Object.assign(divider.style, { width: '1px', height: 'clamp(14px, 2vh, 20px)', background: '#2A2A2A' });
  profileBox.appendChild(divider);

  const pGear = document.createElement('div');
  pGear.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`;
  pGear.style.color = '#888888';
  pGear.style.cursor = 'pointer';
  pGear.onclick = () => { import("../settings").then(({ openSettings }) => openSettings()); };
  profileBox.appendChild(pGear);
  topRow.appendChild(profileBox);
  
  fisheyeWrap.appendChild(topRow);
  updateProfileBox();

  // Region 4 — Right Column: Contextual Info Panel (Done before left column to exist for handlers)
  const rightColumn = document.createElement('div');
  rightColumn.className = 'mm-glass mm-right-col';
  rightColumn.id = 'mm-right-col';
  Object.assign(rightColumn.style, {
    position: 'absolute', top: 'clamp(64px, 12vh, 96px)', bottom: 'clamp(64px, 12vh, 96px)', width: 'clamp(280px, 30vw, 400px)', right: 'clamp(16px, 3vw, 32px)', zIndex: '2',
    padding: 'clamp(16px, 4vh, 48px)', display: 'flex', flexDirection: 'column', gap: '0', overflowX: 'hidden', overflowY: 'auto'
  });

  rightPanelContent = document.createElement('div');
  rightPanelContent.className = 'mm-right-panel-content';
  Object.assign(rightPanelContent.style, {
    display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '800px', margin: '0 auto', gap: 'clamp(8px, 2vh, 16px)'
  });
  rightColumn.appendChild(rightPanelContent);
  fisheyeWrap.appendChild(rightColumn);

  // Region 3 — Left Column: Navigation Cards
  leftColumn = document.createElement('div');
  leftColumn.className = 'mm-glass mm-left-col';
  Object.assign(leftColumn.style, {
    position: 'absolute', top: 'clamp(64px, 12vh, 96px)', bottom: 'clamp(64px, 12vh, 96px)', left: 'clamp(16px, 3vw, 32px)', width: 'clamp(200px, 25vw, 320px)', zIndex: '2',
    display: 'flex', flexDirection: 'column', gap: 'clamp(4px, 1vh, 8px)', overflowY: 'auto'
  });

  const createNavCard = (id: string, text: string, isDisabled: boolean = false) => {
    const card = document.createElement('div');
    card.className = 'mm-card';
    card.dataset.id = id;
    Object.assign(card.style, {
      borderLeft: `3px solid ${DS.colors.accent}`, padding: 'clamp(10px, 2vh, 20px) clamp(12px, 2vw, 24px)', cursor: isDisabled ? 'default' : 'pointer',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', position: 'relative'
    });

    if (isDisabled) {
      card.style.opacity = '0.4';
      card.style.pointerEvents = 'none';
      card.style.borderLeft = `3px solid ${DS.colors.border}`;
    }

    const tEl = document.createElement('div');
    tEl.className = 'mm-card-text';
    tEl.textContent = text;
    Object.assign(tEl.style, {
      fontFamily: DS.typography.fontFamily, fontWeight: DS.typography.weightBold, textTransform: 'uppercase',
      color: 'rgba(232,232,232,0.7)', letterSpacing: '2px', position: 'relative', zIndex: '2'
    });
    card.appendChild(tEl);

    if (!isDisabled) {
      const applyHover = () => {
        card.style.border = DS.glass.borderAccentFull;
        card.style.borderLeft = `3px solid ${DS.colors.accent}`;
        card.style.background = 'rgba(200, 136, 42, 0.06)';
        card.style.boxShadow = `${DS.glass.glowOuter}, ${DS.glass.glowInner}`;
        tEl.style.color = '#E8E8E8';
        card.style.transform = 'scaleX(1.02)';
      };
      const removeHover = () => {
        if (activeCardId === id) return; // Keep hover styles if active
        card.style.border = '1px solid transparent';
        card.style.borderBottom = '1px solid rgba(255,255,255,0.02)';
        card.style.borderLeft = `3px solid ${DS.colors.accent}`;
        card.style.background = 'transparent';
        card.style.boxShadow = 'none';
        tEl.style.color = 'rgba(232,232,232,0.7)';
        card.style.transform = 'scaleX(1)';
      };

      card.addEventListener('mouseenter', () => {
        setActiveCard(id); 
        applyHover(); 
      });
      card.addEventListener('mouseleave', () => {
        if (activeCardId !== id) removeHover();
      });
      card.addEventListener('click', () => {
        setActiveCard(id);
      });
    }

    return { card, tEl };
  };

  const mpCard = createNavCard('MULTIPLAYER', 'MULTIPLAYER');
  multiplayerCard = mpCard.card;
  
  leftColumn.appendChild(multiplayerCard);
  leftColumn.appendChild(createNavCard('FACTION', 'FACTION').card);
  leftColumn.appendChild(createNavCard('STORE', 'STORE').card);
  leftColumn.appendChild(createNavCard('STATISTICS', 'STATISTICS').card);
  leftColumn.appendChild(createNavCard('FEEDBACK', 'FEEDBACK').card);

  if (IS_DEV) {
    const devBtn = createNavCard('DEV_QUICKSTART', 'DEV QUICK START').card;
    Object.assign(devBtn.style, {
      background: 'rgba(255,0,100,0.15)', border: '1px solid rgba(255,0,100,0.4)',
      borderLeft: '3px solid #FF0064'
    });
    (devBtn.firstChild as HTMLElement).style.color = '#FF0064';
    devBtn.addEventListener('click', () => {
       const mapId = getDefaultMap().id;
       ensureAssetsDownloaded(() => {
           try {
               const docEl = document.documentElement as any;
               if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
                   if (docEl.requestFullscreen) docEl.requestFullscreen();
                   else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
               }
           } catch (err) {}

           // Direct dispatch bypassing screens
           window.dispatchEvent(new CustomEvent('start-match', { detail: { mode: 'STANDARD', class: 'ASSAULT', solo: true, map: getDefaultMap() }}));
           screenManager.showGame();
       }, mapId);
    });
    devQuickstartBtn = devBtn;
    leftColumn.appendChild(devBtn);

    const mapEditorBtn = createNavCard('MAP_EDITOR', 'MAP EDITOR').card;
    Object.assign(mapEditorBtn.style, {
      background: 'rgba(255,0,100,0.15)', border: '1px solid rgba(255,0,100,0.4)',
      borderLeft: '3px solid #FF0064'
    });
    (mapEditorBtn.firstChild as HTMLElement).style.color = '#FF0064';
    mapEditorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      screenManager.showDevMapEditor();
    }, true);
    leftColumn.appendChild(mapEditorBtn);

    const devEntitiesBtn = createNavCard('DEV_ENTITIES', 'DEV ENTITIES').card;
    Object.assign(devEntitiesBtn.style, {
      background: 'rgba(255,0,100,0.15)', border: '1px solid rgba(255,0,100,0.4)',
      borderLeft: '3px solid #FF0064'
    });
    (devEntitiesBtn.firstChild as HTMLElement).style.color = '#FF0064';
    devEntitiesBtn.addEventListener('click', (e) => {
      console.log("[MainMenu] Dev Entities button clicked");
      e.stopPropagation();
      e.stopImmediatePropagation();
      screenManager.showDevEntities();
    }, true);
    leftColumn.appendChild(devEntitiesBtn);
  }

  const backBtn = document.createElement('div');
  backBtn.className = 'mm-back-btn';
  backBtn.innerHTML = '&#8592; BACK';
  Object.assign(backBtn.style, {
    display: 'none',
    position: 'absolute',
    bottom: 'clamp(12px, 2vh, 24px)',
    left: 'clamp(16px, 3vw, 32px)',
    width: 'clamp(200px, 25vw, 320px)',
    zIndex: '10',
    padding: 'clamp(8px, 1.5vh, 16px)',
    fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 14px)', textTransform: 'uppercase',
    color: '#E8E8E8', letterSpacing: '3px', cursor: 'pointer', textAlign: 'center', background: 'rgba(10,10,10,0.85)',
    backdropFilter: DS.glass.blur, webkitBackdropFilter: DS.glass.blur,
    borderRadius: '4px',
    border: DS.glass.border
  });
  backBtn.addEventListener('mouseenter', () => { backBtn.style.background = 'rgba(255,255,255,0.05)'; });
  backBtn.addEventListener('mouseleave', () => { backBtn.style.background = 'rgba(10,10,10,0.85)'; });
  backBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearActiveCard();
  });
  fisheyeWrap.appendChild(backBtn);

  fisheyeWrap.appendChild(leftColumn);

  // Bottom Banner
  const botBanner = document.createElement('div');
  botBanner.className = 'mm-glass mm-bot-banner';
  Object.assign(botBanner.style, {
    position: 'absolute', bottom: 'clamp(12px, 2vh, 24px)', left: '50%', transform: 'translateX(-50%)', zIndex: '2',
    height: 'clamp(48px, 8vh, 64px)', display: 'flex', alignItems: 'center', padding: '0 clamp(8px, 2vw, 16px)', gap: 'clamp(8px, 2vw, 16px)', cursor: 'pointer'
  });
  botBanner.addEventListener('click', () => setActiveCard('MULTIPLAYER'));

  const botImg = document.createElement('div');
  Object.assign(botImg.style, {
    width: 'clamp(32px, 6vh, 48px)', height: 'clamp(32px, 6vh, 48px)', border: DS.glass.borderAccent, background: '#1A1208',
    backgroundImage: `url('${getAssetUrl("splash_screen.png")}')`, backgroundSize: 'cover', backgroundPosition: 'center'
  });
  botBanner.appendChild(botImg);

  const botTextCol = document.createElement('div');
  Object.assign(botTextCol.style, { display: 'flex', flexDirection: 'column' });
  const botTitle = document.createElement('div');
  botTitle.textContent = 'FEATURED OPERATION';
  Object.assign(botTitle.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(12px, 2vh, 16px)', fontWeight: DS.typography.weightBold, textTransform: 'uppercase', color: '#E8E8E8' });
  const botSub = document.createElement('div');
  botSub.textContent = '(Standard · Open Match)';
  Object.assign(botSub.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(9px, 1.5vh, 12px)', color: '#888888' });
  botTextCol.appendChild(botTitle);
  botTextCol.appendChild(botSub);
  botBanner.appendChild(botTextCol);

  fisheyeWrap.appendChild(botBanner);

  document.body.appendChild(el);

  // Set initial state
  clearActiveCard();

  setTimeout(() => { if (el) el.style.opacity = '1'; }, 50);
}

function updateProfileBox() {
  if (registeredUserData) {
    profileNameText.textContent = `${registeredUserData.displayName.toUpperCase()}`;
    profileRankBadge.textContent = `${registeredUserData.battlePass || 1}`;
    profileRankBadge.style.display = 'block';
    profileNameText.style.color = '#E8E8E8';

    let crDisplay = document.getElementById('profile-cr-display');
    if (!crDisplay) {
      crDisplay = document.createElement('div');
      crDisplay.id = 'profile-cr-display';
      Object.assign(crDisplay.style, {
        fontFamily: DS.typography.fontFamily,
        fontSize: 'clamp(9px, 1.25vh, 12px)',
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
    profileNameText.style.color = '#888888';

    const crDisplay = document.getElementById('profile-cr-display');
    if (crDisplay) crDisplay.remove();
  }
}

function setActiveCard(id: string) {
  if (activeCardId === id && currentRightPanelMode === id as any) return;
  import('../audio').then(({ audioManager }) => audioManager.play('click'));
  activeCardId = id;
  currentRightPanelMode = id as any;

  Array.from(leftColumn.children).forEach(child => {
     const c = child as HTMLElement;
     const tEl = c.querySelector('.mm-card-text') as HTMLElement;
     
     if (c.dataset.id === id) {
       c.classList.add('mm-card-expanded');
       c.classList.remove('mm-card-dimmed');
       
       if (id === 'FACTION') {
          if (userFaction === 'VIBE CO.') c.classList.add('faction-vibe');
          else if (userFaction === 'SLOP INC.') c.classList.add('faction-slop');
       }

       c.style.border = DS.glass.borderAccentFull;
       c.style.borderLeft = `3px solid ${DS.colors.accent}`;
       c.style.background = 'rgba(200, 136, 42, 0.06)';
       c.style.boxShadow = `${DS.glass.glowOuter}, ${DS.glass.glowInner}`;
       if (tEl) tEl.style.color = '#E8E8E8';
       c.style.transform = 'scaleX(1.02)';
     } else {
       if (c.dataset.id) {
         c.classList.add('mm-card-dimmed');

         c.style.border = '1px solid transparent';
         c.style.borderBottom = '1px solid rgba(255,255,255,0.02)';
         c.style.borderLeft = c.dataset.id === 'STORE' ? `3px solid transparent` : `3px solid ${DS.colors.accent}`;
         c.style.background = 'transparent';
         c.style.boxShadow = 'none';
         if (tEl) tEl.style.color = 'rgba(232,232,232,0.7)';
         c.style.transform = 'scaleX(1)';
         c.classList.remove('mm-card-expanded');
       }
     }
  });

  const backBtn = document.querySelector('.mm-back-btn') as HTMLElement | null;
  if (backBtn) backBtn.style.display = 'block';

  renderRightPanel();
}

function clearActiveCard() {
  activeCardId = null;
  currentRightPanelMode = 'DEFAULT';
  Array.from(leftColumn.children).forEach(child => {
     const c = child as HTMLElement;
     if (!c.dataset.id) return;
     c.classList.remove('mm-card-dimmed');
     c.classList.remove('mm-card-expanded');
     c.style.border = '1px solid transparent';
     c.style.borderBottom = '1px solid rgba(255,255,255,0.02)';
     c.style.borderLeft = c.dataset.id === 'STORE' ? `3px solid transparent` : `3px solid ${DS.colors.accent}`;
     c.style.background = 'transparent';
     c.style.boxShadow = 'none';
     c.style.transform = 'scaleX(1)';
     const tEl = c.querySelector('.mm-card-text') as HTMLElement;
     if (tEl) tEl.style.color = 'rgba(232,232,232,0.7)';
  });

  const backBtn = document.querySelector('.mm-back-btn') as HTMLElement | null;
  if (backBtn) backBtn.style.display = 'none';

  renderRightPanel();
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
      color: '#888888', letterSpacing: '4px', marginBottom: 'clamp(4px, 1vh, 8px)'
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
    
    if (currentRightPanelMode === 'DEFAULT') {
      rightPanelContent.appendChild(createPanelBlock('ACTIVE CONTRACTORS', c => {
        const val = document.createElement('div');
        val.textContent = '—'; // Pull from sever if available
        Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(16px, 3vh, 24px)', fontWeight: DS.typography.weightBold, color: '#E8E8E8' });
        const sub = document.createElement('div');
        sub.textContent = 'Matches —    Rank —';
        Object.assign(sub.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 13px)', color: '#888888' });
        c.appendChild(val); c.appendChild(sub);
      }));
      rightPanelContent.appendChild(createPanelBlock('FEATURED OPERATION', c => {
        const val = document.createElement('div'); val.textContent = 'INFILTRATION';
        Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', fontWeight: DS.typography.weightBold, color: '#E8E8E8' });
        const sub = document.createElement('div'); sub.textContent = 'Standard mode. 5–10 contractors.';
        Object.assign(sub.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 13px)', color: '#888888' });
        c.appendChild(val); c.appendChild(sub);
      }));
      rightPanelContent.appendChild(createPanelBlock('LATEST UPDATE', c => {
        const val = document.createElement('div'); val.textContent = 'BUILD 0.1.0';
        Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: '#E8E8E8' });
        const sub = document.createElement('div'); sub.textContent = 'Initial development build.';
        Object.assign(sub.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 13px)', color: '#888888' });
        c.appendChild(val); c.appendChild(sub);
      }));
      rightPanelContent.appendChild(createPanelBlock('CURRENT EVENT', c => {
        const val = document.createElement('div'); val.textContent = 'NONE ACTIVE';
        Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: '#555555' });
        const sub = document.createElement('div'); sub.textContent = 'Check back later.';
        Object.assign(sub.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 13px)', color: '#444444' });
        c.appendChild(val); c.appendChild(sub);
      }, true));
    } 
    else if (currentRightPanelMode === 'MULTIPLAYER') {
      rightPanelContent.appendChild(createPanelBlock('GAME MODE', c => {
         const opActive = document.createElement('div'); opActive.textContent = 'INFILTRATION';
         Object.assign(opActive.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: '#E8E8E8', borderLeft: '2px solid ' + DS.colors.accent, background: 'rgba(200,136,42,0.08)', padding: 'clamp(2px, 0.5vh, 4px) clamp(4px, 1vw, 8px)', marginBottom: 'clamp(2px, 0.5vh, 4px)' });
         const opFuture = document.createElement('div'); opFuture.innerHTML = 'HARDCORE <span style="font-size:clamp(8px, 1.25vh, 11px); color:#555555">COMING SOON</span>';
         Object.assign(opFuture.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: '#E8E8E8', opacity: '0.35', padding: 'clamp(2px, 0.5vh, 4px) clamp(4px, 1vw, 8px)' });
         c.appendChild(opActive); c.appendChild(opFuture);
      }));
      rightPanelContent.appendChild(createPanelBlock('MATCH TYPE', c => {
         const opActive = document.createElement('div'); opActive.textContent = 'OPEN MATCH';
         Object.assign(opActive.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: '#E8E8E8', borderLeft: '2px solid ' + DS.colors.accent, background: 'rgba(200,136,42,0.08)', padding: 'clamp(2px, 0.5vh, 4px) clamp(4px, 1vw, 8px)', marginBottom: 'clamp(2px, 0.5vh, 4px)' });
         const op2 = document.createElement('div'); op2.textContent = 'PRIVATE MATCH';
         Object.assign(op2.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: '#E8E8E8', opacity: '0.6', padding: 'clamp(2px, 0.5vh, 4px) clamp(4px, 1vw, 8px)' });
         c.appendChild(opActive); c.appendChild(op2);
      }));
      rightPanelContent.appendChild(createPanelBlock('CONTRACTORS', c => {
         const val = document.createElement('div'); val.textContent = '1 / 10';
         Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: '#E8E8E8' });
         const sub = document.createElement('div'); sub.textContent = 'Waiting for contractors...';
         Object.assign(sub.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 13px)', color: '#888888' });
         c.appendChild(val); c.appendChild(sub);
      }));
      rightPanelContent.appendChild(createPanelBlock('', c => {
         const btn = document.createElement('button');
         btn.textContent = 'DEPLOY';
         Object.assign(btn.style, {
           width: '100%', height: 'clamp(32px, 6vh, 48px)', background: DS.colors.accent, color: '#0A0A0A', border: 'none',
           fontFamily: DS.typography.fontFamily, fontSize: 'clamp(16px, 3vh, 24px)', fontWeight: DS.typography.weightBold, textTransform: 'uppercase',
           cursor: 'pointer'
         });
         btn.addEventListener('click', () => { 
             if (registeredUserData && (registeredUserData.energy || 0) < 10) {
                 showMenuNotification("DEPLOYMENT REJECTED: INSUFFICIENT ENERGY. REFILL DEV CREDITS IN STATISTICS.", "warning");
                 return;
             }
             ensureAssetsDownloaded(() => screenManager.showLobby(), getDefaultMap().id); 
         });
         c.appendChild(btn);
      }, true));
    }
    else if (currentRightPanelMode === 'FACTION') {
      const auth = getAuth();
      const isGuest = !auth.currentUser || auth.currentUser.isAnonymous;
      rightPanelContent.appendChild(createPanelBlock('CURRENT FACTION', c => {
         const val = document.createElement('div'); val.textContent = isGuest ? 'UNAFFILIATED' : (userFaction || 'UNASSIGNED');
         Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: '#E8E8E8' });
         c.appendChild(val);
      }));
      rightPanelContent.appendChild(createPanelBlock('ENLIST', c => {
         ['VIBE CO.', 'SLOP INC.'].forEach((f, i) => {
            const btn = document.createElement('div'); btn.textContent = f;
            const isSelected = userFaction === f;
            Object.assign(btn.style, {
              fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', padding: 'clamp(6px, 1.5vh, 12px)', marginBottom: 'clamp(4px, 1vh, 8px)', cursor: isGuest ? 'default' : 'pointer',
              borderLeft: isSelected ? '2px solid ' + DS.colors.accent : '2px solid transparent',
              background: isSelected ? 'rgba(200,136,42,0.08)' : 'transparent',
              color: isSelected ? '#E8E8E8' : '#888888'
            });
            c.appendChild(btn);
         });
      }));
      rightPanelContent.appendChild(createPanelBlock('', c => {
         const btn = document.createElement('button');
         btn.textContent = 'CONFIRM';
         Object.assign(btn.style, {
           width: '100%', height: 'clamp(32px, 6vh, 48px)', background: isGuest ? '#333' : DS.colors.accent, color: isGuest ? '#666' : '#0A0A0A', border: 'none',
           fontFamily: DS.typography.fontFamily, fontSize: 'clamp(16px, 3vh, 24px)', fontWeight: DS.typography.weightBold, textTransform: 'uppercase', cursor: isGuest ? 'default' : 'pointer'
         });
         if (isGuest) btn.disabled = true;
         c.appendChild(btn);
         if (isGuest) {
            const sub = document.createElement('div'); sub.textContent = 'Sign in to save faction.';
            Object.assign(sub.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 13px)', color: '#888888', textAlign: 'center', marginTop: 'clamp(4px, 1vh, 8px)' });
            c.appendChild(sub);
         }
      }, true));
    }
    else if (currentRightPanelMode === 'STATISTICS') {
       rightPanelContent.appendChild(createPanelBlock('LIFETIME STATS', c => {
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
           Object.assign(lbl.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 14px)', color: '#888888' });
           const val = document.createElement('span'); val.textContent = s.v;
           Object.assign(val.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(14px, 2.5vh, 18px)', color: '#E8E8E8', fontWeight: DS.typography.weightBold });
           row.appendChild(lbl); row.appendChild(val); c.appendChild(row);
         });

         // DEV DIAGNOSTICS & TESTING PANEL
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
           color: '#FF0064',
           marginBottom: '8px'
         });
         devBlock.appendChild(devTitle);
         
         const devNote = document.createElement('div');
         devNote.textContent = 'NOTE: Standard 100-credit allotment is arbitrary and subject to game balance review.';
         Object.assign(devNote.style, {
           fontSize: '10px',
           color: '#888888',
           marginBottom: '12px',
           textTransform: 'none'
         });
         devBlock.appendChild(devNote);
         
         const refillBtn = document.createElement('button');
         refillBtn.textContent = 'REFILL CREDITS & ENERGY [DEV SERVER AUTH]';
         Object.assign(refillBtn.style, {
           width: '100%',
           padding: '8px',
           background: 'rgba(255,0,100,0.15)',
           border: '1px solid rgba(255,0,100,0.4)',
           color: '#FF0064',
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
         Object.assign(lbl.style, { fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 14px)', color: '#555555' });
         c.appendChild(lbl);
       }, true));
    }
    else if (currentRightPanelMode === 'FEEDBACK') {
       let sr = 0;
       const stars: HTMLElement[] = [];
       rightPanelContent.appendChild(createPanelBlock('', c => {
         const row = document.createElement('div'); Object.assign(row.style, { display: 'flex', gap: 'clamp(4px, 1vh, 8px)', marginBottom: 'clamp(8px, 2vh, 16px)' });
         for (let i=1; i<=5; i++) {
           const s = document.createElement('div'); s.innerHTML = '★';
           Object.assign(s.style, { fontSize: 'clamp(20px, 3.5vh, 32px)', color: '#2A2A2A', cursor: 'pointer', lineHeight: '1' });
           s.onclick = () => { sr = i; stars.forEach((st, idx) => st.style.color = idx < sr ? DS.colors.accent : '#2A2A2A'); };
           stars.push(s); row.appendChild(s);
         }
         c.appendChild(row);

         const txt = document.createElement('textarea');
         txt.placeholder = 'Describe your experience.';
         Object.assign(txt.style, {
           width: '100%', height: 'clamp(50px, 10vh, 80px)', background: 'rgba(0,0,0,0.4)', border: DS.glass.border,
           color: '#E8E8E8', fontFamily: DS.typography.fontFamily, fontSize: 'clamp(10px, 1.5vh, 13px)', padding: 'clamp(5px, 1vh, 10px)', resize: 'none'
         });
         c.appendChild(txt);
       }));
       rightPanelContent.appendChild(createPanelBlock('', c => {
         const btn = document.createElement('button'); btn.textContent = 'SUBMIT';
         Object.assign(btn.style, {
           width: '100%', height: 'clamp(30px, 4vh, 40px)', background: DS.colors.accent, color: '#0A0A0A', border: 'none',
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
               sr = 0; stars.forEach(st => st.style.color = '#2A2A2A');
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
                    color: '#E8E8E8',
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
      top: 'clamp(72px, 10vh, 100px)',
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
    color: type === 'warning' ? '#FF5555' : DS.colors.accent,
    borderLeft: `3px solid ${type === 'warning' ? '#FF5555' : DS.colors.accent}`,
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
  if (!leftColumn) return;
  Array.from(leftColumn.children).forEach(child => {
    const c = child as HTMLElement;
    if (enabled) {
      c.style.pointerEvents = 'auto';
      c.style.opacity = c.classList.contains('mm-card-dimmed') ? '0.3' : '1';
    } else {
      c.style.pointerEvents = 'none';
      c.style.opacity = '0.15';
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
    background: 'rgba(5, 5, 5, 0.95)',
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
  word.textContent = 'VEXEA SECURE PORTAL';
  Object.assign(word.style, {
    fontFamily: DS.typography.fontFamily,
    fontSize: '24px',
    fontWeight: 'bold',
    letterSpacing: '6px',
    color: '#E8E8E8',
    marginTop: '8px'
  });
  branding.appendChild(word);
  
  const sub = document.createElement('div');
  sub.textContent = 'RESTRICTED SYSTEM ACCESS — REGISTER CODENAME';
  Object.assign(sub.style, {
    fontFamily: DS.typography.fontFamily,
    fontSize: '11px',
    letterSpacing: '3px',
    color: '#888888',
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
    color: '#E8E8E8',
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
    color: '#888888',
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
    <div style="font-family:${DS.typography.fontFamily}; font-size:16px; font-weight:bold; letter-spacing:2px; color:#A855F7;">VIBE CO.</div>
    <div style="font-family:${DS.typography.fontFamily}; font-size:9px; letter-spacing:1px; color:#c084fc; margin-top:4px;">SILENT & PRECISE</div>
    <div style="font-family:${DS.typography.fontFamily}; font-size:10px; color:#888888; text-transform:none; margin-top:8px; line-height:1.4;">Corporate infiltrators specialized in speed, stealth, and facility breaches.</div>
  `;
  vibeCard.onclick = () => {
    selectedFaction = 'VIBE CO.';
    vibeCard.style.border = '1px solid #A855F7';
    vibeCard.style.boxShadow = '0 0 15px rgba(168,85,247,0.2)';
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
    <div style="font-family:${DS.typography.fontFamily}; font-size:16px; font-weight:bold; letter-spacing:2px; color:#F97316;">SLOP INC.</div>
    <div style="font-family:${DS.typography.fontFamily}; font-size:9px; letter-spacing:1px; color:#fdba74; margin-top:4px;">BRUTALIST & UTILITY</div>
    <div style="font-family:${DS.typography.fontFamily}; font-size:10px; color:#888888; text-transform:none; margin-top:8px; line-height:1.4;">Heavy sweeper division specialized in maximum attrition and hardware pacification.</div>
  `;
  slopCard.onclick = () => {
    selectedFaction = 'SLOP INC.';
    slopCard.style.border = '1px solid #F97316';
    slopCard.style.boxShadow = '0 0 15px rgba(249,115,22,0.2)';
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
    color: '#FF5555',
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
    color: '#0A0A0A',
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
      showMenuNotification("ENLISTMENT COMPLETE. WELCOME TO VEXEA, CONTRACTOR.");
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

