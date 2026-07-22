export const DS = {
  colors: {
    background: '#0A0A0A',
    surface: '#111111',
    border: '#2A2A2A',
    accent: '#FF4500',
    textPrimary: '#E8E8E8',
    textSecondary: '#888888',
    danger: '#CC3333',
    success: '#33AA66',
    warning: '#EAB308',
    dev: '#FF0064',
    info: '#3b82f6',
    text: '#E8E8E8',
    textMuted: '#888888',
    factions: {
      vibe: {
        primary: '#A855F7',
        muted: '#c084fc',
        shadow: 'rgba(168,85,247,0.2)'
      },
      slop: {
        primary: '#F97316',
        muted: '#fdba74',
        shadow: 'rgba(249,115,22,0.2)'
      }
    },
    zones: {
      spawn: "#5a6982",
      courtyard: "#8292ab",
      warehouse: "#93c5fd",
      bridge: "#fca5a5",
      plant: "#86efac",
      tunnels: "#d8b4fe",
      core: "#fde047"
    },
    drones: {
      recon: "#00aaff",
      rotary: "#00aaff",
      bomber: "#ff4400",
      ground: "#ff8800"
    }
  },
  glass: {
    background: 'rgba(10, 10, 10, 0.55)',
    blur: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderAccent: '1px solid #FF4500',
    borderAccentFull: '2px solid #FF4500',
    glowInner: 'inset 0 0 16px rgba(255, 69, 0, 0.08)',
    glowOuter: '0 0 12px rgba(255, 69, 0, 0.25)',
  },
  typography: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontFamilySecondary: "'Rajdhani', sans-serif",
    fontFamilyMono: "'Roboto Mono', monospace",
    large: '48px',
    medium: '24px',
    small: '14px',
    tiny: '11px',
    weightBold: '700',
    weightMedium: '500',
    weightRegular: '400',
    transform: 'uppercase',
    letterSpacing: {
      normal: 'normal',
      tight: '1px',
      wide: '3px',
      extraWide: '6px',
      mega: '8px'
    }
  },
  spacing: {
    none: '0px',
    xs: '2px',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    xxl: '24px',
    huge: '32px'
  },
  borders: {
    thin: '1px solid',
    thick: '2px solid',
    radius: {
      none: '0px',
      sm: '4px',
      md: '8px',
      lg: '12px',
      full: '9999px'
    }
  },
  shadows: {
    accent: '0 0 16px rgba(255, 69, 0, 0.15)',
    accentStrong: '0 0 24px rgba(255, 69, 0, 0.3)',
    text: '2px 2px 4px rgba(0,0,0,0.5)',
    overlay: 'rgba(0, 0, 0, 0.88)'
  },
  motion: {
    fast: '150ms ease',
    normal: '300ms ease-in-out',
    slow: '2000ms ease-in-out'
  },
  transitions: {
    card: '180ms ease-out',
    panel: '250ms ease-out',
    expand: '320ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  utils: {
    rgba: (hex: string, alpha: number) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
};
