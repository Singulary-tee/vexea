import { Howl, Howler } from 'howler';
import * as THREE from 'three';
import { getCachedOrFetchUrl } from "./asset-cache";

class AudioManager {
    private assetsLoaded = 0;
    private totalAssets = 0;
    
    // SFX
    public sounds: Record<string, Howl> = {};
    
    // Music sequence state
    private menuMusicSequence: string[] = ['vexea_theme', 'iron_march'];
    private currentMusicIndex = 0;
    private currentMusicHowl: Howl | null = null;
    
    // State
    private isMatchPlaying = false;
    
    // Footstep state
    private activeFootstepKey: string | null = null;

    public async loadAll(): Promise<void> {
        const audioFiles = {
            // Music
            vexea_theme: 'vexea_theme.mp3',
            bass_scratch: 'bass_scratch.mp3',
            iron_march: 'iron_march.mp3',
            // SFX menu
            click: 'click.mp3',
            error: 'error.mp3',
            // Footsteps / Materials
            metal_ricochet: 'metal_ricochet.mp3',
            wood_walk: 'wood_walk.mp3',
            concrete_run: 'concrete_run.mp3',
            concrete_walk: 'concrete_walk.mp3',
            // Weapons
            rifle_reload: 'rifle_reload.mp3',
            pistol_reload: 'pistol_reload.mp3',
            pistol_fire: 'pistol_fire.mp3',
            rifle_fire: 'rifle_fire.mp3'
        };

        this.totalAssets = Object.keys(audioFiles).length;

        const loadPromises = Object.entries(audioFiles).map(async ([key, filename]) => {
            const isFootstep = ['concrete_walk', 'concrete_run', 'wood_walk'].includes(key);
            const cachedUrl = await getCachedOrFetchUrl(filename, 'Sound');
            return new Promise<void>((resolve, reject) => {
                const howl = new Howl({
                    src: [cachedUrl],
                    format: ['mp3'],
                    preload: true,
                    loop: isFootstep,
                    onplayerror: function() {
                        if (!isFootstep) {
                            howl.once('unlock', function() {
                                howl.play();
                            });
                        }
                    },
                    onload: () => {
                        this.assetsLoaded++;
                        resolve();
                    },
                    onloaderror: (id, err) => {
                        console.warn(`Failed to load audio: ${filename}`, err);
                        resolve();
                    }
                });
                this.sounds[key] = howl;
            });
        });

        await Promise.all(loadPromises);
    }
    
    public play(name: string) {
        if (this.sounds[name]) {
            this.sounds[name].play();
        } else {
            console.warn(`Audio ${name} not found`);
        }
    }
    
    public setMatchState(inMatch: boolean) {
        this.isMatchPlaying = inMatch;
        if (inMatch) {
            this.stopMenuMusic();
        } else {
            if (this.activeFootstepKey) {
                this.sounds[this.activeFootstepKey]?.stop();
                this.activeFootstepKey = null;
            }
            if (!this.currentMusicHowl || !this.currentMusicHowl.playing()) {
                this.playNextMenuMusic();
            }
        }
    }
    
    public playNextMenuMusic() {
        if (this.isMatchPlaying) return;
        
        if (this.currentMusicHowl) {
            this.currentMusicHowl.stop();
            this.currentMusicHowl.off('end');
        }
        
        const nextTrackName = this.menuMusicSequence[this.currentMusicIndex];
        this.currentMusicIndex = (this.currentMusicIndex + 1) % this.menuMusicSequence.length;
        
        this.currentMusicHowl = this.sounds[nextTrackName];
        if (this.currentMusicHowl) {
            this.currentMusicHowl.play();
            this.currentMusicHowl.once('end', () => {
                this.playNextMenuMusic();
            });
        }
    }
    
    public stopMenuMusic() {
        if (this.currentMusicHowl) {
            this.currentMusicHowl.stop();
            this.currentMusicHowl.off('end');
            this.currentMusicHowl = null;
        }
    }

    public playWeaponFire(activeWeapon: number) {
        if (activeWeapon === 1) {
            this.play('rifle_fire');
        } else {
            this.play('pistol_fire');
        }
    }

    public playWeaponReload(activeWeapon: number) {
        if (activeWeapon === 1) {
            this.play('rifle_reload');
        } else {
            this.play('pistol_reload');
        }
    }

    public updateFootsteps(dt: number, speed: number, position: THREE.Vector3, isGrounded: boolean) {
        if (!isGrounded || speed < 0.1) {
            if (this.activeFootstepKey) {
                this.sounds[this.activeFootstepKey]?.stop();
                this.activeFootstepKey = null;
            }
            return;
        }

        const isRunning = speed > 6.0;
        let targetKey = 'concrete_walk';

        // In a real-time multiplayer environment, floor material properties are ideally part of the zone/navmesh definitions 
        // from the server, or defined via simple bounding zones client-side.
        // For now, removing the continuous scene-graph raycast and defaulting to concrete to respect zero-GC/performance rules.
        let matType = 'concrete'; 

        if (matType === 'wood') {
            targetKey = 'wood_walk';
        } else {
            targetKey = isRunning ? 'concrete_run' : 'concrete_walk';
        }

        if (this.activeFootstepKey !== targetKey) {
            // Stop previous active sound if any
            if (this.activeFootstepKey) {
                this.sounds[this.activeFootstepKey]?.stop();
            }
            this.activeFootstepKey = targetKey;
            const targetSound = this.sounds[targetKey];
            if (targetSound && !targetSound.playing()) {
                targetSound.play();
            }
        } else {
            const targetSound = this.sounds[targetKey];
            if (targetSound && !targetSound.playing()) {
                targetSound.play();
            }
        }
    }
}

export const audioManager = new AudioManager();
(window as any).audioManager = audioManager;
