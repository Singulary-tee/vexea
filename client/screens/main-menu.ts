import * as screenManager from "./screen-manager";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";
import { getAuth } from "firebase/auth";

export function initMainMenu() {
  let el = document.getElementById('main-menu-screen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'main-menu-screen';
    Object.assign(el.style, {
      position: 'fixed', inset: '0', zIndex: '900', display: 'none', width: '100vw', height: '100vh',
      backgroundImage: "url('/splash_screen.png')", backgroundSize: 'cover', backgroundPosition: 'center center',
      backgroundColor: '#0A0A0A'
    });

    const vignette = document.createElement('div');
    Object.assign(vignette.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1',
      background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.85) 100%)'
    });
    el.appendChild(vignette);

    // Top Bar
    const topBar = document.createElement('div');
    Object.assign(topBar.style, {
      height: '80px', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'relative', zIndex: '2'
    });
    
    // Left: VEXEA
    const logo = document.createElement('div');
    logo.textContent = 'VEXEA';
    Object.assign(logo.style, {
      fontFamily: "'Barlow Condensed', sans-serif", fontSize: '48px', color: '#C8882A', letterSpacing: '4px'
    });
    
    // Center: Player Identifier
    const playerIdentifier = document.createElement('div');
    Object.assign(playerIdentifier.style, {
      fontFamily: "'Barlow Condensed', sans-serif", fontSize: '14px', color: '#888888'
    });
    const updatePlayerIdentifier = () => {
       try {
           const auth = getAuth();
           if (auth.currentUser && !auth.currentUser.isAnonymous) {
               playerIdentifier.textContent = `${auth.currentUser.displayName || 'PLAYER'} — UNAFFILIATED`;
               playerIdentifier.style.color = '#E8E8E8';
           } else {
               playerIdentifier.textContent = `GUEST — ${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
               playerIdentifier.style.color = '#888888';
           }
       } catch(e) {
           playerIdentifier.textContent = `GUEST — ${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
           playerIdentifier.style.color = '#888888';
       }
    };
    updatePlayerIdentifier();

    // Right: Settings Gear
    const settingsBtn = document.createElement('div');
    settingsBtn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`;
    Object.assign(settingsBtn.style, {
      color: '#888888', cursor: 'pointer'
    });
    settingsBtn.addEventListener('click', () => {
      // The settings modal should be handled separately. For now just standard overlay
      const sm = document.getElementById('settings-modal');
      if (sm) sm.style.display = 'flex';
    });

    topBar.appendChild(logo);
    topBar.appendChild(playerIdentifier);
    topBar.appendChild(settingsBtn);
    el.appendChild(topBar);

    // Content area
    const contentArea = document.createElement('div');
    Object.assign(contentArea.style, {
      position: 'absolute', top: '80px', left: '32px', bottom: '32px', width: '65%',
      display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: '16px', zIndex: '2'
    });

    const createCard = (titleText: string, subtitleText: string, gradient: string, onClick?: () => void, disabled?: boolean) => {
       const card = document.createElement('div');
       Object.assign(card.style, {
         position: 'relative', overflow: 'hidden', cursor: disabled ? 'default' : 'pointer', border: 'none', borderRadius: '0'
       });
       if (disabled) {
           card.style.opacity = '0.35';
           card.style.pointerEvents = 'none';
       }

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

       const btmGradient = document.createElement('div');
       Object.assign(btmGradient.style, {
         position: 'absolute', bottom: '0', left: '0', right: '0', height: '50%', zIndex: '2',
         background: 'linear-gradient(transparent, rgba(0,0,0,0.92))'
       });
       card.appendChild(btmGradient);

       const content = document.createElement('div');
       Object.assign(content.style, {
          position: 'absolute', bottom: '0', left: '0', right: '0', zIndex: '3', padding: '16px'
       });
       
       const title = document.createElement('h3');
       title.textContent = titleText;
       Object.assign(title.style, {
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: '24px', textTransform: 'uppercase', 
          fontWeight: 'bold', color: '#E8E8E8', margin: '0'
       });

       const subtitle = document.createElement('div');
       subtitle.textContent = subtitleText;
       Object.assign(subtitle.style, {
          fontFamily: "'Barlow Condensed', sans-serif", fontSize: '14px', color: '#888888', 
          margin: '4px 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
       });

       content.appendChild(title);
       content.appendChild(subtitle);
       card.appendChild(content);

       if (!disabled) {
          card.addEventListener('mouseenter', () => card.style.outline = '2px solid #C8882A');
          card.addEventListener('mouseleave', () => card.style.outline = 'none');
          card.style.transition = 'outline 150ms';
       }

       if (onClick) {
           card.addEventListener('click', onClick);
       }

       return card;
    };

    const alertComingSoon = () => alert("Coming soon.");

    contentArea.appendChild(createCard("MULTIPLAYER", "Co-op infiltration. 5–10 contractors.", "linear-gradient(135deg, #0D1117 0%, #1A0A0A 100%)", () => screenManager.showLobby()));
    contentArea.appendChild(createCard("PROFILE", "Sign in to save progress.", "linear-gradient(135deg, #0D1117 0%, #0A0A1A 100%)", alertComingSoon));
    contentArea.appendChild(createCard("FACTION", "Vibe Co. or Slop Inc.", "linear-gradient(135deg, #0D1117 0%, #0A1A0A 100%)", alertComingSoon));
    contentArea.appendChild(createCard("INSTANT FEEDBACK", "Rate your experience.", "linear-gradient(135deg, #131109 0%, #1A1500 100%)", showFeedbackModal));
    contentArea.appendChild(createCard("STORE", "Coming soon.", "linear-gradient(135deg, #0D1117 0%, #111117 100%)", undefined, true));
    contentArea.appendChild(createCard("STATISTICS", "Matches. Eliminations. Extractions.", "linear-gradient(135deg, #0D1117 0%, #0A0A0A 100%)", alertComingSoon));

    el.appendChild(contentArea);
    document.body.appendChild(el);
  }
}

function showFeedbackModal() {
    let modal = document.getElementById('feedback-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'feedback-modal';
        Object.assign(modal.style, {
            position: 'fixed', inset: '0', zIndex: '1100', background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        });

        const card = document.createElement('div');
        Object.assign(card.style, {
            width: '400px', maxWidth: '90vw', background: '#111111', border: '1px solid #2A2A2A',
            padding: '32px', borderRadius: '0'
        });

        const title = document.createElement('h2');
        title.textContent = 'FEEDBACK';
        Object.assign(title.style, {
            fontFamily: "'Barlow Condensed', sans-serif", fontSize: '24px', color: '#E8E8E8', textTransform: 'uppercase', marginBottom: '24px'
        });
        card.appendChild(title);

        const starRow = document.createElement('div');
        Object.assign(starRow.style, { display: 'flex', gap: '8px' });
        let selectedRating = 0;
        const stars: HTMLButtonElement[] = [];

        for (let i=1; i<=5; i++) {
            const btn = document.createElement('button');
            btn.innerHTML = '★';
            Object.assign(btn.style, {
                width: '40px', height: '40px', background: 'transparent', border: 'none',
                fontSize: '28px', cursor: 'pointer', color: '#2A2A2A', padding: '0'
            });
            btn.addEventListener('mouseenter', () => {
                for(let j=0; j<5; j++) stars[j].style.color = j < i ? '#C8882A' : (j < selectedRating ? '#C8882A' : '#2A2A2A');
            });
            btn.addEventListener('mouseleave', () => {
                for(let j=0; j<5; j++) stars[j].style.color = j < selectedRating ? '#C8882A' : '#2A2A2A';
            });
            btn.addEventListener('click', () => {
                selectedRating = i;
                for(let j=0; j<5; j++) stars[j].style.color = j < selectedRating ? '#C8882A' : '#2A2A2A';
            });
            stars.push(btn);
            starRow.appendChild(btn);
        }
        card.appendChild(starRow);

        const textarea = document.createElement('textarea');
        textarea.placeholder = "Describe your experience.";
        Object.assign(textarea.style, {
            display: 'block', width: '100%', height: '120px', marginTop: '16px', background: '#0A0A0A',
            border: '1px solid #2A2A2A', borderRadius: '0', color: '#E8E8E8', fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: '14px', padding: '12px', resize: 'none', boxSizing: 'border-box'
        });
        card.appendChild(textarea);

        const submitBtn = document.createElement('button');
        submitBtn.textContent = 'SUBMIT';
        Object.assign(submitBtn.style, {
            display: 'block', width: '100%', height: '48px', marginTop: '16px', background: '#C8882A',
            border: 'none', borderRadius: '0', color: '#0A0A0A', fontFamily: "'Barlow Condensed', sans-serif",
            fontSize: '24px', fontWeight: 'bold', textTransform: 'uppercase', cursor: 'pointer'
        });
        submitBtn.addEventListener('click', async () => {
            const auth = getAuth();
            const uid = auth.currentUser ? auth.currentUser.uid : "guest";
            try {
                const db = getFirestore();
                await addDoc(collection(db, "feedback"), {
                    rating: selectedRating,
                    text: textarea.value,
                    timestamp: serverTimestamp(),
                    userId: uid
                });
            } catch (e) {
                console.error(e);
            }
            modal!.style.display = 'none';
        });
        card.appendChild(submitBtn);

        const cancelBtn = document.createElement('div');
        cancelBtn.textContent = 'CANCEL';
        Object.assign(cancelBtn.style, {
            display: 'block', width: '100%', marginTop: '12px', textAlign: 'center', fontSize: '14px',
            color: '#888888', cursor: 'pointer', textDecoration: 'underline', fontFamily: "'Barlow Condensed', sans-serif"
        });
        cancelBtn.addEventListener('click', () => {
            modal!.style.display = 'none';
        });
        card.appendChild(cancelBtn);

        modal.appendChild(card);
        document.body.appendChild(modal);
    }
    
    // Reset modal
    const textarea = modal.querySelector('textarea');
    if (textarea) textarea.value = '';
    modal.style.display = 'flex';
}
