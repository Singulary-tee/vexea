import * as THREE from "three/webgpu";
import { 
  float, 
  color, 
  fog, 
  exponentialHeightFogFactor, 
  rangeFogFactor 
} from "three/tsl";
import { MatchController } from "../../MatchController";
import { 
  initMatchVisuals, 
  updateVFX, 
  clearAllVisuals,
  flashMesh,
  tracerBatch,
  sparkBatch,
  decalBatch,
  dustBatch,
  smokeBatch,
  tracerSlots,
  sparksPerHitCount,
  decalSlots,
  dustPerHitCount,
  barrelSmokeCount
} from "../vfx/VFXOrchestrator";
import { initDroneModels } from "../../drone_models";
import { initPlayerWeapons, rifleGroup, pistolGroup } from "../../weapons_model";
import { getSettings, applySettings } from "../../settings";

export class VisualsSystem {
  private match: MatchController;

  constructor(match: MatchController) {
    this.match = match;
  }

  public async init() {
    const scene = this.match.scene;
    const renderer = (window as any).renderer; // Use global renderer for now, but scene is match-specific
    
    scene.background = new THREE.Color(0x151b2c);
    
    // Lighting ambient/direct setup
    const ambientLight = new THREE.AmbientLight(0x2a3048, 2.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xa5bcff, 2.0);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    if (renderer) {
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x8292ab);
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      scene.environment = pmremGenerator.fromScene(envScene).texture;
    }

    // Fog
    const isWebGPU = (window as any).isWebGPU;
    if (isWebGPU) {
      const heightFog = exponentialHeightFogFactor(float(0.005), float(4.0));
      const depthFog = rangeFogFactor(float(70.0), float(250.0));
      const mixedFog = (heightFog as any).max(depthFog);
      // @ts-ignore
      (scene as any).fogNode = fog(color(0x151b2c), mixedFog);
    } else {
      scene.fog = new THREE.Fog(0x151b2c, 70, 250);
    }

    // Initialize VFX
    initMatchVisuals(scene);

    // Initialize Drone Models
    await initDroneModels(scene);

    // Initialize Player Weapons
    const camera = this.match.scene.userData.camera as THREE.PerspectiveCamera;
    await initPlayerWeapons(scene, camera);

    this.setupDevMapDecorations(scene);
    this.setupLaserSegments(scene);

    // Ensure all materials are pre-compiled and warmed via mock render pass
    if (renderer) {
      console.log("[VisualsSystem] Starting mock-render pre-warm pass for all shaders...");
      const tStart = performance.now();
      
      // Temporarily show pistolGroup and rifleGroup to compile both weapon models
      const wasPistolVisible = pistolGroup ? pistolGroup.visible : false;
      const wasRifleVisible = rifleGroup ? rifleGroup.visible : false;
      if (pistolGroup) pistolGroup.visible = true;
      if (rifleGroup) rifleGroup.visible = true;
      
      // Temporarily show flashMesh to compile its shader
      const wasFlashVisible = flashMesh ? flashMesh.visible : false;
      if (flashMesh) flashMesh.visible = true;

      // Make sure at least one instance is visible in each batch to guarantee compilation of instance rendering shaders
      if (tracerBatch && tracerSlots > 0) tracerBatch.setVisibleAt(0, true);
      if (sparkBatch && sparksPerHitCount > 0) sparkBatch.setVisibleAt(0, true);
      if (dustBatch && dustPerHitCount > 0) dustBatch.setVisibleAt(0, true);
      if (smokeBatch && barrelSmokeCount > 0) smokeBatch.setVisibleAt(0, true);
      if (decalBatch && decalSlots > 0) decalBatch.setVisibleAt(0, true);

      // Render a mock frame using the actual scene and camera to compile all WebGPU pipelines synchronously/asynchronously
      renderer.render(scene, camera);

      // Restore visibility
      if (pistolGroup) pistolGroup.visible = wasPistolVisible;
      if (rifleGroup) rifleGroup.visible = wasRifleVisible;
      if (flashMesh) flashMesh.visible = wasFlashVisible;

      if (tracerBatch && tracerSlots > 0) tracerBatch.setVisibleAt(0, false);
      if (sparkBatch && sparksPerHitCount > 0) sparkBatch.setVisibleAt(0, false);
      if (dustBatch && dustPerHitCount > 0) dustBatch.setVisibleAt(0, false);
      if (smokeBatch && barrelSmokeCount > 0) smokeBatch.setVisibleAt(0, false);
      if (decalBatch && decalSlots > 0) decalBatch.setVisibleAt(0, false);

      console.log(`[VisualsSystem] Pre-warm complete in ${(performance.now() - tStart).toFixed(2)}ms`);
    }

    console.log("[VisualsSystem] Scene initialized for match.");
  }

  private setupDevMapDecorations(scene: THREE.Scene) {
    if ((window as any).vexMapId !== "map_0_dev") return;

    const lightPositions = [
      new THREE.Vector3(-4.5, 4, -20),
      new THREE.Vector3(4.5, 4, -20),
      new THREE.Vector3(-4.5, 4, 0),
      new THREE.Vector3(4.5, 4, 0),
      new THREE.Vector3(-4.5, 4, 20),
      new THREE.Vector3(4.5, 4, 20),
    ];
    lightPositions.forEach((pos) => {
      const streetLight = new THREE.PointLight(0xffa95c, 2.5, 15);
      streetLight.position.copy(pos);
      scene.add(streetLight);
    });

    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255, 255, 255, 1)");
      grad.addColorStop(0.2, "rgba(240, 240, 250, 0.9)");
      grad.addColorStop(1, "rgba(5, 7, 10, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      const moonTexture = new THREE.CanvasTexture(canvas);
      const moonMaterial = new THREE.SpriteMaterial({ map: moonTexture, transparent: true });
      const moonSprite = new THREE.Sprite(moonMaterial);
      moonSprite.position.set(40, 100, -80);
      moonSprite.scale.set(15, 15, 1);
      scene.add(moonSprite);
    }
  }

  private setupLaserSegments(scene: THREE.Scene) {
    const maxLasers = 64;
    const laserGeom = new THREE.BufferGeometry();
    laserGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxLasers * 6), 3));
    const laserMat = new THREE.LineBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
    const laserLineSegments = new THREE.LineSegments(laserGeom, laserMat);
    scene.add(laserLineSegments);
    (window as any).laserLineSegments = laserLineSegments;
  }

  public step(dt: number, camera: THREE.PerspectiveCamera) {
    updateVFX(dt, camera);
  }

  public dispose() {
    clearAllVisuals();
  }
}
