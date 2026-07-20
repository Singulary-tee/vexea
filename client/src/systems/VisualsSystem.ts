import * as THREE from "three/webgpu";
import { 
  float, 
  color, 
  fog, 
  exponentialHeightFogFactor, 
  rangeFogFactor,
  uniform,
  pass,
  mrt,
  output,
  normalView,
  select,
  screenUV,
  vec2,
  vec3,
  vec4,
  Fn
} from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { chromaticAberration } from "three/addons/tsl/display/ChromaticAberrationNode.js";
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
  private decorativeProps: THREE.Mesh[] = [];

  constructor(match: MatchController) {
    this.match = match;
    window.addEventListener("VEXEA_GRAPHICS_CHANGED", this.onGraphicsChanged as any);
  }

  private onGraphicsChanged = (e: Event) => {
    const s = (e as CustomEvent).detail;
    this.decorativeProps.forEach(p => {
      p.visible = s.instancedProps;
    });
  };

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
    this.spawnDecorativeProps(scene);
    this.initPostProcessing(scene, camera, renderer);

    // Ensure all materials are pre-compiled and warmed via mock render pass
    if (renderer) {
      console.log("[VisualsSystem] Starting mock-render pre-warm pass for all shaders...");
      const tStart = performance.now();
      
      // Temporarily show pistolGroup and rifleGroup to compile both weapon models
      const wasPistolVisible = pistolGroup ? pistolGroup.visible : false;
      const wasRifleVisible = rifleGroup ? rifleGroup.visible : false;
      if (pistolGroup) pistolGroup.visible = true;
      if (rifleGroup) rifleGroup.visible = true;
      
      // Temporarily position WeaponsContainer in front of camera so it is inside the view frustum and compiled
      const weaponsContainer = scene.getObjectByName("WeaponsContainer");
      const wasWeaponsContainerPos = new THREE.Vector3();
      const wasWeaponsContainerQuat = new THREE.Quaternion();
      if (weaponsContainer) {
        wasWeaponsContainerPos.copy(weaponsContainer.position);
        wasWeaponsContainerQuat.copy(weaponsContainer.quaternion);
        
        weaponsContainer.position.copy(camera.position);
        weaponsContainer.quaternion.copy(camera.quaternion);
        // Spin 180 degrees around Y (weapons face forward along Z) and translate forward so they are centered in view
        weaponsContainer.rotateY(Math.PI);
        weaponsContainer.translateZ(0.8);
        weaponsContainer.translateY(-0.25);
        weaponsContainer.updateMatrixWorld(true);
      }
      
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
      if (isWebGPU && (window as any).renderPipeline) {
        (window as any).renderPipeline.render();
      } else {
        renderer.render(scene, camera);
      }

      // Restore original positions and orientations
      if (weaponsContainer) {
        weaponsContainer.position.copy(wasWeaponsContainerPos);
        weaponsContainer.quaternion.copy(wasWeaponsContainerQuat);
        weaponsContainer.updateMatrixWorld(true);
      }

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
    window.removeEventListener("VEXEA_GRAPHICS_CHANGED", this.onGraphicsChanged as any);
  }

  private initPostProcessing(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: any) {
    const s = getSettings();
    const isWebGPU = (window as any).isWebGPU;
    if (!isWebGPU || !renderer) return;

    console.log("[VisualsSystem] Setting up WebGPU advanced RenderPipeline...");
    try {
      // Create our global uniforms object if not already initialized
      const uniforms = {
        bloomEnabled: uniform(s.bloom ? 1.0 : 0.0),
        bloomStrength: uniform(s.bloomStrength),
        bloomRadius: uniform(s.bloomRadius),
        bloomThreshold: uniform(s.bloomThreshold),
        vignetteEnabled: uniform(s.vignette ? 1.0 : 0.0),
        vignetteIntensity: uniform(s.vignetteIntensity),
        chromaticAberrationEnabled: uniform(s.chromaticAberration ? 1.0 : 0.0),
        chromaticAberrationIntensity: uniform(s.chromaticAberrationIntensity),
        ssaoEnabled: uniform(s.ssao ? 1.0 : 0.0),
        pomScale: uniform(s.parallaxOcclusion ? 0.025 : 0.0),
        pbrNormalScale: uniform(s.pbrMaterials ? 1.0 : 0.0),
        pbrDetailsEnabled: uniform(s.pbrMaterials ? 1.0 : 0.0),
        instancedPropsEnabled: uniform(s.instancedProps ? 1.0 : 0.0)
      };
      
      // Merge into window-level graphics uniforms so applySettings can access them
      (window as any).vexGraphicsUniforms = Object.assign((window as any).vexGraphicsUniforms || {}, uniforms);

      const renderPipeline = new (THREE as any).RenderPipeline(renderer);

      // 1. Scene pass (color and depth)
      const scenePass = pass(scene, camera);
      const sceneColor = scenePass.getTextureNode('output');

      let colorNode = sceneColor;

      // 2. Inline Chromatic Aberration pass (extremely performant and robust inline TSL)
      const uvNode = screenUV;
      const center = vec2(0.5, 0.5);
      const offset = uvNode.sub(center);
      const distance = offset.length();
      const aberrationStrength = uniforms.chromaticAberrationIntensity.mul(distance).mul(0.01);
      
      const rOffset = offset.mul(aberrationStrength);
      const bOffset = offset.mul(aberrationStrength).negate();
      
      const r = sceneColor.sample(uvNode.add(rOffset)).r;
      const g = sceneColor.g;
      const b = sceneColor.sample(uvNode.add(bOffset)).b;
      const a = sceneColor.a;
      
      const caPass = vec4(r, g, b, a);
      colorNode = select(uniforms.chromaticAberrationEnabled.equal(1.0), caPass as any, colorNode) as any;

      // 3. Bloom pass
      const bloomPass = bloom(colorNode, uniforms.bloomStrength.mul(0.10) as any, uniforms.bloomRadius as any, uniforms.bloomThreshold as any);
      colorNode = select(uniforms.bloomEnabled.equal(1.0), colorNode.add(bloomPass) as any, colorNode) as any;

      // 4. Vignette custom effect using inline TSL (no Fn wrapper to avoid WGSL scope issues)
      const dist = uvNode.sub(vec2(0.5)).length();
      const vignetteVal = float(1.0).sub(dist.mul(uniforms.vignetteIntensity).pow(2.0)).saturate();
      colorNode = select(uniforms.vignetteEnabled.equal(1.0), colorNode.mul(vignetteVal) as any, colorNode) as any;

      // Output back to screen
      renderPipeline.outputNode = colorNode;

      // Save to window so main loop can render it
      (window as any).renderPipeline = renderPipeline;
      console.log("[VisualsSystem] WebGPU advanced RenderPipeline initialization complete and active.");
    } catch (e) {
      console.error("[VisualsSystem] WebGPU RenderPipeline creation failed:", e);
    }
  }

  private spawnDecorativeProps(scene: THREE.Scene) {
    const s = getSettings();
    const spec = (window as any).__vexMapLoader?.spec;
    if (!spec || !spec.buildings) {
      console.log("[VisualsSystem] No map spec or buildings found for decorative prop spawning. Creating procedural props instead.");
      const centers = [
        new THREE.Vector3(-15, 0, -15),
        new THREE.Vector3(15, 0, 15),
        new THREE.Vector3(-25, 0, 20),
        new THREE.Vector3(25, 0, -20)
      ];
      centers.forEach((center, idx) => {
        this.createPropCluster(scene, center, idx, s);
      });
      return;
    }

    console.log(`[VisualsSystem] Spawning decorative props clustered around ${spec.buildings.length} buildings.`);
    spec.buildings.forEach((b: any, bIdx: number) => {
      if (b.meshType === 'TYPE_CENTERPIECE') return; // Skip centerpiece to avoid occlusion
      
      const pos = new THREE.Vector3(b.position.x, b.position.y, b.position.z);
      const sizeX = b.size?.x || 10;
      const sizeZ = b.size?.z || 10;
      
      // Spawn 2-3 small props next to the building walls (clustered)
      const propCount = 2 + (bIdx % 2); 
      for (let i = 0; i < propCount; i++) {
        const angle = (i / propCount) * Math.PI * 2 + (bIdx * 1.5);
        const offsetX = Math.cos(angle) * (sizeX / 2 + 1.5);
        const offsetZ = Math.sin(angle) * (sizeZ / 2 + 1.5);
        
        const propPos = new THREE.Vector3()
          .copy(pos)
          .add(new THREE.Vector3(offsetX, 0, offsetZ));
        
        propPos.y = 0;

        this.createPropCluster(scene, propPos, bIdx * 10 + i, s);
      }
    });
  }

  private createPropCluster(scene: THREE.Scene, pos: THREE.Vector3, seed: number, s: any) {
    const propType = seed % 3; // 0 = crate, 1 = barrel, 2 = generator

    let mesh: THREE.Mesh;
    if (propType === 0) {
      const geom = new THREE.BoxGeometry(1.6, 1.6, 1.6);
      const mat = new THREE.MeshStandardMaterial({
        color: seed % 2 === 0 ? 0xcc5500 : 0x444e5c, // Industrial Orange or Dark Slate Steel
        roughness: 0.6,
        metalness: 0.8,
        name: 'crate_material'
      });
      mesh = new THREE.Mesh(geom, mat);
    } else if (propType === 1) {
      const geom = new THREE.CylinderGeometry(0.6, 0.6, 1.8, 12);
      const mat = new THREE.MeshStandardMaterial({
        color: seed % 2 === 0 ? 0x992222 : 0x226644, // Hazard Red or Acid Green
        roughness: 0.5,
        metalness: 0.7,
        name: 'barrel_material'
      });
      mesh = new THREE.Mesh(geom, mat);
    } else {
      const geom = new THREE.BoxGeometry(1.4, 2.0, 1.4);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x20252c,
        roughness: 0.4,
        metalness: 0.9,
        emissive: 0x00ffaa,
        emissiveIntensity: seed % 2 === 0 ? 0.6 : 0.2,
        name: 'gen_material'
      });
      mesh = new THREE.Mesh(geom, mat);
    }

    mesh.position.copy(pos);
    mesh.position.y += (mesh.geometry as any).parameters.height / 2; // offset upward so base is on ground

    mesh.rotation.y = (seed * 17) % (Math.PI * 2);
    mesh.rotation.x = ((seed * 3) % 10) * 0.01;
    mesh.rotation.z = ((seed * 7) % 10) * 0.01;

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    mesh.visible = s.instancedProps; // respect setting initially

    scene.add(mesh);
    this.decorativeProps.push(mesh);
  }
}
