import * as THREE from "three/webgpu";
import { CAMERA_EFFECTS_CONFIG } from "./constants";
import { MatchController } from "../../MatchController";
import { inputManager } from "../../input";

// Zero-allocation variables for tick-loop operations
const _tempEuler = new THREE.Euler(0, 0, 0, "YXZ");
const _tempQuat = new THREE.Quaternion();

export class CameraEffectsSystem {
  private match: MatchController;

  // Stateful properties (Zero GC allocations on update ticks)
  public currentSpeedBlend = 0.0; // 0 = walking, 1 = sprinting
  public bobCycle = 0.0;
  
  // Smoothly interpolated active bobbing amplitudes
  private activeBobAmpY = 0.0;
  private activeBobAmpX = 0.0;
  private activeBobAmpRoll = 0.0;

  // Camera rotational offsets
  public cameraRoll = 0.0;
  private lastPlayerYaw = 0.0;

  // Progressive effects
  public runPullBack = 0.0;
  public landingJolt = 0.0;
  private lastGroundedState = true;
  public fovStretch = 0.0;

  constructor(match: MatchController) {
    this.match = match;
    this.lastPlayerYaw = match.playerYaw;
  }

  /**
   * Evaluates the speed blend transition curve from walking to sprinting.
   * Uses an S-curve (smoothstep) for organic acceleration and deceleration feeling.
   */
  public updateSpeedBlend(dt: number, isMoving: boolean, isSprinting: boolean): number {
    const config = CAMERA_EFFECTS_CONFIG.MOVEMENT;
    
    if (isSprinting && isMoving) {
      this.currentSpeedBlend = Math.min(1.0, this.currentSpeedBlend + dt * config.RUN_ACCEL_RATE);
    } else {
      this.currentSpeedBlend = Math.max(0.0, this.currentSpeedBlend - dt * config.RUN_DECEL_RATE);
    }

    // Apply S-Curve (Smoothstep)
    const t = this.currentSpeedBlend;
    return t * t * (3.0 - 2.0 * t);
  }

  /**
   * Main camera effects update. Computes camera offset transformations and FOV stretch.
   * Outputs final offsets to be applied to the player's view camera.
   */
  public step(
    dt: number,
    camera: THREE.PerspectiveCamera,
    isMovingOnGround: boolean,
    isSprinting: boolean,
    isADS: boolean,
    currentAdsLerp: number
  ) {
    const config = CAMERA_EFFECTS_CONFIG;
    
    // 1. Landing Jolt detection & processing
    const isGrounded = this.match.localGrounded;
    if (isGrounded && !this.lastGroundedState && this.match.localVy < -2.0) {
      // Player fell and just hit the ground -> trigger downward jolt
      this.landingJolt = Math.min(config.LANDING.FORCE, -this.match.localVy * 0.03);
    }
    this.lastGroundedState = isGrounded;

    // Decay the landing jolt smoothly
    if (this.landingJolt > 0) {
      this.landingJolt = Math.max(0.0, this.landingJolt - dt * config.LANDING.DECAY);
    }

    // Update speed blend first so we have the smooth S-curve blend factor
    const blend = this.updateSpeedBlend(dt, isMovingOnGround, isSprinting);

    // 2. Smoothly transition head bobbing amplitudes depending on motion state
    let targetFreq = 0.0;
    let targetAmpY = 0.0;
    let targetAmpX = 0.0;
    let targetAmpRoll = 0.0;

    if (isMovingOnGround) {
      // Interpolate between walk and sprint parameters using our speed blend curve
      targetFreq = THREE.MathUtils.lerp(config.BOB.WALK_FREQ, config.BOB.SPRINT_FREQ, blend);
      targetAmpY = THREE.MathUtils.lerp(config.BOB.WALK_AMP_Y, config.BOB.SPRINT_AMP_Y, blend);
      targetAmpX = THREE.MathUtils.lerp(config.BOB.WALK_AMP_X, config.BOB.SPRINT_AMP_X, blend);
      targetAmpRoll = THREE.MathUtils.lerp(config.BOB.WALK_AMP_ROLL, config.BOB.SPRINT_AMP_ROLL, blend);
      
      // ADS reduces bobbing substantially to keep crosshairs usable while aiming
      const adsReduction = THREE.MathUtils.lerp(1.0, config.BOB.ADS_REDUCTION, currentAdsLerp);
      targetAmpY *= adsReduction;
      targetAmpX *= adsReduction;
      targetAmpRoll *= adsReduction;

      // Accumulate the bob cycle based on our dynamic frequency
      this.bobCycle += dt * targetFreq;
    } else {
      // Smoothly decay bob cycle amplitudes back to rest
      targetAmpY = 0;
      targetAmpX = 0;
      targetAmpRoll = 0;
      this.bobCycle = 0;
    }

    // Blend current bob amplitudes towards target parameters
    const smoothing = dt * config.BOB.SMOOTHING_RATE;
    this.activeBobAmpY += (targetAmpY - this.activeBobAmpY) * Math.min(1.0, smoothing);
    this.activeBobAmpX += (targetAmpX - this.activeBobAmpX) * Math.min(1.0, smoothing);
    this.activeBobAmpRoll += (targetAmpRoll - this.activeBobAmpRoll) * Math.min(1.0, smoothing);

    // 3. Compute Head Bob Offset values (Position & Rotation)
    // Vertical Bob (using absolute sine for realistic stepped bounce)
    const bobOffsetY = Math.abs(Math.sin(this.bobCycle)) * this.activeBobAmpY;
    // Horizontal Bob (standard cosine side-to-side sway)
    const bobOffsetX = Math.cos(this.bobCycle * 0.5) * this.activeBobAmpX;
    // Roll Bob (slight tilting based on sway cycle)
    const bobOffsetRoll = Math.sin(this.bobCycle * 0.5) * this.activeBobAmpRoll;

    // 4. Miniature banking camera tilting (leaning combined with sharp sprint turns)
    let yawDelta = this.match.playerYaw - this.lastPlayerYaw;
    this.lastPlayerYaw = this.match.playerYaw;

    // Handle yaw wraps around -PI and PI
    if (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;

    const yawVelocity = yawDelta / Math.max(0.001, dt);
    
    // Leaning only applies when moving quickly and not aiming
    const leanFactor = this.currentSpeedBlend * (1.0 - currentAdsLerp);
    const targetRoll = -yawVelocity * config.TILT.RUN_TILT_STRENGTH * leanFactor;

    // Interpolate roll using high-frequency spring physics
    this.cameraRoll += (targetRoll - this.cameraRoll) * Math.min(1.0, dt * config.TILT.RUN_TILT_SPRING);
    this.cameraRoll = THREE.MathUtils.clamp(this.cameraRoll, -config.TILT.MAX_ROLL, config.TILT.MAX_ROLL);

    // 5. Sprint-based Viewmodel pulling backwards
    if (isSprinting && isMovingOnGround) {
      this.runPullBack = Math.min(
        config.PULL_BACK.MAX_PULL_BACK_Z,
        this.runPullBack + dt * config.PULL_BACK.CHARGE_SPEED
      );
    } else {
      this.runPullBack = Math.max(
        0.0,
        this.runPullBack - dt * config.PULL_BACK.DECAY_SPEED
      );
    }

    // 6. Sprintf FOV dynamic stretch
    if (isSprinting && isMovingOnGround && !isADS) {
      this.fovStretch = Math.min(
        config.FOV_STRETCH.MAX_STRETCH,
        this.fovStretch + dt * config.FOV_STRETCH.CHARGE_SPEED
      );
    } else {
      this.fovStretch = Math.max(
        0.0,
        this.fovStretch - dt * config.FOV_STRETCH.DECAY_SPEED
      );
    }

    // 7. Inject calculated offset values back to MatchController for global retrieval
    // Offset camera height slightly with bobOffsetY and landingJolt, slide horizontally with bobOffsetX
    camera.position.x += bobOffsetX;
    camera.position.y += bobOffsetY - this.landingJolt;
    
    // Inject dynamic extra FOV stretch
    camera.fov += this.fovStretch;
    camera.updateProjectionMatrix();

    // 8. Re-apply rotation matrices with bank lean tilt & lateral head-bob roll added
    const finalRoll = this.cameraRoll + bobOffsetRoll;
    
    // Convert current camera rotation back to Euler, add roll tilt, apply back
    _tempEuler.setFromQuaternion(camera.quaternion, "YXZ");
    _tempEuler.z = finalRoll;
    camera.quaternion.setFromEuler(_tempEuler);
  }
}
