import * as screenManager from "./screen-manager";
import { getDefaultMap } from "../../shared/maps/map-registry";
import { ensureAssetsDownloaded } from "../asset-cache";
import { IS_DESKTOP } from "../platform-gate";
import { DS } from "../design-system";

export function initLobby() {
  let el = document.getElementById('lobby-screen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lobby-screen';
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '800',
      background: DS.colors.background,
      display: 'none',
      flexDirection: 'column',
      width: '100vw',
      height: '100vh',
      padding: DS.spacing.md,
      boxSizing: 'border-box',
      justifyContent: 'space-between'
    });

    // Top Section Container
    const topRow = document.createElement('div');
    Object.assign(topRow.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      width: '100%',
      pointerEvents: 'none'
    });

    // 1. BACK button (Top Left)
    const backBtn = document.createElement('div');
    backBtn.textContent = '← BACK';
    Object.assign(backBtn.style, {
      fontFamily: DS.typography.fontFamily,
      fontSize: 'clamp(12px, 1.8vh, 16px)',
      fontWeight: 'bold',
      textTransform: 'uppercase',
      color: DS.colors.textSecondary,
      letterSpacing: DS.typography.letterSpacing.wide,
      cursor: 'pointer',
      padding: `${DS.spacing.md} ${DS.spacing.xl}`,
      background: 'rgba(10, 10, 10, 0.65)',
      border: `${DS.borders.thin} rgba(255, 255, 255, 0.05)`,
      borderRadius: DS.borders.radius.sm,
      pointerEvents: 'auto',
      transition: 'all 0.2s ease-out'
    });
    backBtn.addEventListener('click', () => screenManager.showMainMenu());
    backBtn.addEventListener('mouseenter', () => {
      backBtn.style.color = DS.colors.textPrimary;
      backBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    });
    backBtn.addEventListener('mouseleave', () => {
      backBtn.style.color = DS.colors.textSecondary;
      backBtn.style.borderColor = 'rgba(255, 255, 255, 0.05)';
    });
    topRow.appendChild(backBtn);

    // 2. GAMEMODE DETAILS (Top Right)
    const gamemodeBox = document.createElement('div');
    Object.assign(gamemodeBox.style, {
      background: 'rgba(10, 10, 10, 0.65)',
      backdropFilter: DS.glass.blur,
      webkitBackdropFilter: DS.glass.blur,
      border: `${DS.borders.thin} rgba(255, 255, 255, 0.05)`,
      borderRadius: DS.borders.radius.sm,
      padding: `${DS.spacing.lg} ${DS.spacing.xxl}`,
      pointerEvents: 'auto',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: '4px'
    });

    const gmTitle = document.createElement('div');
    gmTitle.textContent = 'INFILTRATION';
    Object.assign(gmTitle.style, {
      fontFamily: DS.typography.fontFamily,
      fontSize: 'clamp(16px, 2.5vh, 22px)',
      fontWeight: 'bold',
      color: DS.colors.accent,
      letterSpacing: DS.typography.letterSpacing.wide
    });

    const gmSubtitle = document.createElement('div');
    gmSubtitle.textContent = 'STANDARD - OPEN MATCH';
    Object.assign(gmSubtitle.style, {
      fontFamily: DS.typography.fontFamily,
      fontSize: 'clamp(11px, 1.5vh, 14px)',
      color: DS.colors.textSecondary,
      letterSpacing: DS.typography.letterSpacing.tight
    });

    const gmContractors = document.createElement('div');
    gmContractors.textContent = 'CONTRACTORS: 1 / 10';
    Object.assign(gmContractors.style, {
      fontFamily: DS.typography.fontFamily,
      fontSize: 'clamp(10px, 1.3vh, 12px)',
      color: '#555555',
      letterSpacing: '1px',
      marginTop: '4px'
    });

    gamemodeBox.appendChild(gmTitle);
    gamemodeBox.appendChild(gmSubtitle);
    gamemodeBox.appendChild(gmContractors);
    topRow.appendChild(gamemodeBox);

    el.appendChild(topRow);

    // 3. MIDDLE AREA (Grow container to reserve space for the 3D model)
    const middleSpacer = document.createElement('div');
    Object.assign(middleSpacer.style, {
      flex: '1',
      width: '100%',
      pointerEvents: 'none'
    });
    el.appendChild(middleSpacer);

    // 4. BOTTOM CONTAINER (Cards on the left, Ready on the right)
    const bottomRow = document.createElement('div');
    Object.assign(bottomRow.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      width: '100%',
      gap: '24px',
      pointerEvents: 'none'
    });

    // Class cards list (separated, scrollable horizontal row)
    const cardsContainer = document.createElement('div');
    Object.assign(cardsContainer.style, {
      display: 'flex',
      gap: '16px',
      overflowX: 'auto',
      pointerEvents: 'auto',
      flex: '1',
      maxWidth: 'calc(100% - clamp(160px, 18vw, 220px) - 24px)'
    });

    let selectedClassIdx = 0;
    const cards: HTMLElement[] = [];

    const createClassCard = (idx: number, name: string, desc: string, utils: string[]) => {
      const card = document.createElement('div');
      Object.assign(card.style, {
        flex: '0 0 auto',
        width: 'clamp(180px, 16vw, 240px)',
        height: 'clamp(150px, 22vh, 210px)',
        background: 'rgba(10, 10, 10, 0.75)',
        backdropFilter: DS.glass.blur,
        webkitBackdropFilter: DS.glass.blur,
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '4px',
        padding: '16px',
        boxSizing: 'border-box',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'all 0.18s ease-out'
      });

      const topContent = document.createElement('div');
      topContent.style.display = 'flex';
      topContent.style.flexDirection = 'column';
      topContent.style.gap = '4px';

      const cardName = document.createElement('div');
      cardName.textContent = name;
      Object.assign(cardName.style, {
        fontFamily: DS.typography.fontFamily,
        fontSize: 'clamp(16px, 2.5vh, 22px)',
        fontWeight: 'bold',
        color: '#E8E8E8',
        letterSpacing: '1px'
      });

      const cardDesc = document.createElement('div');
      cardDesc.textContent = desc.toUpperCase();
      Object.assign(cardDesc.style, {
        fontFamily: DS.typography.fontFamily,
        fontSize: 'clamp(10px, 1.4vh, 12px)',
        color: '#888888',
        lineHeight: '1.3'
      });

      topContent.appendChild(cardName);
      topContent.appendChild(cardDesc);
      card.appendChild(topContent);

      const utilsContainer = document.createElement('div');
      utilsContainer.style.display = 'flex';
      utilsContainer.style.flexDirection = 'column';
      utilsContainer.style.gap = '2px';

      utils.forEach(u => {
        const uDiv = document.createElement('div');
        uDiv.textContent = `• ${u.toUpperCase()}`;
        uDiv.className = 'lobby-card-ability';
        Object.assign(uDiv.style, {
          fontFamily: DS.typography.fontFamily,
          fontSize: 'clamp(9px, 1.2vh, 11px)',
          color: '#555555',
          letterSpacing: '1px',
          transition: 'color 0.18s ease-out'
        });
        utilsContainer.appendChild(uDiv);
      });

      card.appendChild(utilsContainer);

      card.addEventListener('mouseenter', () => {
        if (selectedClassIdx !== idx) {
          card.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        }
      });

      card.addEventListener('mouseleave', () => {
        if (selectedClassIdx !== idx) {
          card.style.borderColor = 'rgba(255, 255, 255, 0.05)';
        }
      });

      card.addEventListener('click', () => {
        selectedClassIdx = idx;
        updateSelection();
      });

      cards.push(card);
      cardsContainer.appendChild(card);
    };

    createClassCard(0, "ASSAULT", "Frontline breach. Fast maneuverability.", ["Frag Grenade", "Sprint Stim"]);
    createClassCard(1, "MEDIC", "Sustainment and AoE healing.", ["Healing Drone", "Revive Dart"]);
    createClassCard(2, "RECON", "Map visibility and tactical scans.", ["Sensor Mine", "Radar Pulse"]);
    createClassCard(3, "DEMOLITIONS", "Anti-armor and structural denial.", ["C4 Charge", "Deployable Shield"]);

    const updateSelection = () => {
      cards.forEach((c, i) => {
        if (i === selectedClassIdx) {
          c.style.borderColor = DS.colors.accent;
          c.style.boxShadow = DS.shadows.accent;
          c.style.background = 'rgba(255, 69, 0, 0.05)';
          const abDivs = c.querySelectorAll('.lobby-card-ability');
          abDivs.forEach(ab => {
            (ab as HTMLElement).style.color = DS.colors.accent;
          });
        } else {
          c.style.borderColor = 'rgba(255, 255, 255, 0.05)';
          c.style.boxShadow = 'none';
          c.style.background = 'rgba(10, 10, 10, 0.75)';
          const abDivs = c.querySelectorAll('.lobby-card-ability');
          abDivs.forEach(ab => {
            (ab as HTMLElement).style.color = '#555555';
          });
        }
      });
    };

    updateSelection();
    bottomRow.appendChild(cardsContainer);

    // 5. READY Button Container (Bottom Right)
    const actionContainer = document.createElement('div');
    Object.assign(actionContainer.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: '8px',
      pointerEvents: 'auto',
      flexShrink: '0'
    });

    const readyBtn = document.createElement('button');
    readyBtn.textContent = 'READY';
    Object.assign(readyBtn.style, {
      width: 'clamp(140px, 15vw, 200px)',
      height: 'clamp(44px, 6vh, 56px)',
      background: DS.colors.accent,
      border: 'none',
      color: DS.colors.background,
      fontFamily: DS.typography.fontFamily,
      fontSize: 'clamp(18px, 2.5vh, 26px)',
      fontWeight: 'bold',
      textTransform: 'uppercase',
      borderRadius: DS.borders.radius.sm,
      cursor: 'pointer',
      transition: 'all 0.15s ease-out'
    });

    readyBtn.addEventListener('mouseenter', () => {
      readyBtn.style.background = '#FF6347';
      readyBtn.style.boxShadow = DS.shadows.accentStrong;
    });

    readyBtn.addEventListener('mouseleave', () => {
      readyBtn.style.background = DS.colors.accent;
      readyBtn.style.boxShadow = 'none';
    });

    readyBtn.addEventListener('mousedown', () => {
      readyBtn.style.background = '#CD3700';
    });

    readyBtn.addEventListener('mouseup', () => {
      readyBtn.style.background = DS.colors.accent;
    });

    readyBtn.addEventListener('touchstart', () => {
      readyBtn.style.background = '#CD3700';
    });

    readyBtn.addEventListener('touchend', () => {
      readyBtn.style.background = DS.colors.accent;
    });

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
        window.dispatchEvent(new CustomEvent("start-match", {
          detail: {
            map,
            class: ['ASSAULT', 'MEDIC', 'RECON', 'DEMOLITIONS'][selectedClassIdx]
          }
        }));
      }, map.id);
    });

    actionContainer.appendChild(readyBtn);
    bottomRow.appendChild(actionContainer);

    el.appendChild(bottomRow);
    document.body.appendChild(el);
  }
}
