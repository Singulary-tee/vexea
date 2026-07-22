import { GlobalState } from "./state";
import { DS } from "./design-system";

export function getVisualDiagnosisHTML(): string {
    return `
        <div style="display:flex; flex-direction:column; gap:10px; height:100%; overflow-y:auto; padding-right:10px; font-family:${DS.typography.fontFamily};">
            <h3 style="margin:0; letter-spacing:2px; color:${DS.colors.accent};">${DS.typography.transform} Visual Diagnosis</h3>
            ${createToggleHTML("colliders", "Show Colliders (Buildings, Drones, Players)")}
            ${createToggleHTML("aiSight", "Show AI Sight & Info (Floating text, Rays)")}
            ${createToggleHTML("zoneBorders", "Show Zone Borders")}
            ${createToggleHTML("bulletPaths", "Show Last 20 Bullet Paths (Server Data)")}
            ${createToggleHTML("hitSpheres", "Show Hit Spheres")}
            ${createToggleHTML("navPoints", "Show Navigation Points (Pathfinding Nodes)")}
            ${createToggleHTML("interpPaths", "Show Interpolation Paths")}
            ${createToggleHTML("serverCubes", "Show Server Authority Target Cubes")}
        </div>
    `;
}

function createToggleHTML(key: string, label: string) {
    const isChecked = (GlobalState as any).visDiag && (GlobalState as any).visDiag[key] ? "checked" : "";
    return `
        <label style="display:flex; align-items:center; gap:8px; background:${DS.glass.background}; border:${DS.glass.border}; padding:8px; cursor:pointer; color:${DS.colors.text}; font-size:12px; letter-spacing:1px;">
            <input type="checkbox" id="visdiag-${key}" ${isChecked} onchange="window.toggleVisDiag('${key}', this.checked)" style="accent-color:${DS.colors.accent};" />
            <span>${label.toUpperCase()}</span>
        </label>
    `;
}

(window as any).toggleVisDiag = (key: string, value: boolean) => {
    if (!(GlobalState as any).visDiag) {
        (GlobalState as any).visDiag = {
            colliders: false,
            aiSight: false,
            zoneBorders: false,
            bulletPaths: false,
            hitSpheres: false,
            navPoints: false,
            interpPaths: false,
            serverCubes: false
        };
    }
    (GlobalState as any).visDiag[key] = value;
    
    // Trigger any immediate side-effects
    if (key === 'colliders') {
        if ((window as any).buildingColliders) {
            (window as any).buildingColliders.forEach((c: any) => c.visible = value);
        }
    }
};
