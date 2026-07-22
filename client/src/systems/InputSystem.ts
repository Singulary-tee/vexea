import * as THREE from "three";
import { MatchController } from "../../MatchController";
import { inputManager, InputAction } from "../../input";
import { GlobalState } from "../../state";
import { audioManager } from "../../audio";
import { 
  keys, 
  tempInputBuffer, 
  tempInputView, 
  incrementInputSequence 
} from "../input/InputSynchronizer";
import { 
  DETAILED_WEAPONS, 
  PLAYER_EYE_LEVEL, 
  PLAYER_CENTER_OFFSET, 
  PLAYER_EYE_LEVEL_CROUCH,
  PLAYER_BASE_SPEED,
  PLAYER_CROUCH_SPEED,
  PLAYER_SPRINT_MULTIPLIER,
  PLAYER_DASH_MULTIPLIER,
  PLAYER_JUMP_VELOCITY,
  PLAYER_GRAVITY
} from "../../../shared/constants";
import { 
  switchActiveWeaponModel, 
  isSwitchingWeapon, 
  setWeaponReloading 
} from "../../weapons_model";

import { IS_DESKTOP } from "../../platform-gate";

export class InputSystem {
  private camera: THREE.PerspectiveCamera;
  private canvasContainer: HTMLElement | null;
  private abortController = new AbortController();

  constructor(private match: MatchController, camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.canvasContainer = document.getElementById("canvas-container");
  }

  public init() {
    this.setupEventListeners();
  }

  public dispose() {
    this.abortController.abort();
    inputManager.dispose();
  }

  private setupEventListeners() {
    const signal = this.abortController.signal;

    if (this.canvasContainer) {
      this.canvasContainer.addEventListener("click", (e) => {
        if (this.isUIElement(e.target) || this.isGameInputLocked()) return;
        if (!this.match || this.match.isLocalPlayerDead) return;
        if (IS_DESKTOP && this.canvasContainer) {
          try {
             this.canvasContainer.requestPointerLock();
          } catch(err) {}
        }
        this.match.combat?.fireActiveShot(this.camera);
      }, { signal });

      this.canvasContainer.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });
    }

    document.addEventListener("mousedown", (e) => {
      if (this.isUIElement(e.target) || this.isGameInputLocked()) return;
      if (!this.match || this.match.isLocalPlayerDead) return;
      if (isSwitchingWeapon()) return;
      if (e.button === 2) {
        e.preventDefault();
        this.match.isADS = true;
      }
    }, { signal });

    document.addEventListener("mouseup", (e) => {
      if (this.isUIElement(e.target) || this.isGameInputLocked()) return;
      if (!this.match || this.match.isLocalPlayerDead) return;
      if (e.button === 2) {
        e.preventDefault();
        this.match.isADS = false;
      }
    }, { signal });

    document.addEventListener("mousemove", (e) => {
      if (this.isGameInputLocked()) return;
      if (!this.match || this.match.isLocalPlayerDead) return;
      const currentWeaponStats =
        this.match.activeWeapon === 1 ? DETAILED_WEAPONS.rifle : DETAILED_WEAPONS.pistol;
      const sensMult =
        1.0 - this.match.currentAdsLerp * (1.0 - currentWeaponStats.adsSensitivityMult);

      this.match.playerYaw -= e.movementX * 0.0022 * sensMult;
      this.match.playerPitch -= e.movementY * 0.0022 * sensMult;

      const limit = Math.PI * 0.48;
      this.match.playerPitch = Math.max(-limit, Math.min(limit, this.match.playerPitch));
    }, { signal });

    inputManager.init();
    inputManager.registerHandler((action, state) => {
      if (state) {
        if (action === InputAction.RELOAD) this.requestReload();
        if (action === InputAction.SWAP_WEAPON_1) this.selectWeapon(1);
        if (action === InputAction.SWAP_WEAPON_2) this.selectWeapon(2);
      }
    });

    this.setupTouchControls();
  }

  private requestReload() {
    if (!this.match || this.match.isLocalPlayerDead) return;
    // Gate reload if currently switching weapons
    if (isSwitchingWeapon()) return;

    const weaponAmmo = this.match.activeWeapon === 1 ? this.match.ammo1 : this.match.ammo2;
    const weaponMax = this.match.activeWeapon === 1 ? this.match.maxAmmo1 : this.match.maxAmmo2;
    if (this.match.isReloading || weaponAmmo === weaponMax) return;
    this.match.isReloading = true;
    setWeaponReloading(true);
    audioManager.playWeaponReload(this.match.activeWeapon);
    const wSlot = this.match.activeWeapon === 1 ? "primary" : "secondary";
    if (this.match.transport) this.match.transport.emit("reliable_event", { type: "RELOAD", weaponSlot: wSlot });
  }

  private selectWeapon(slot: number) {
    if (!this.match || this.match.isLocalPlayerDead) return;
    // Gate weapon selection if currently switching weapons to prevent timer resets and visual pops
    if (isSwitchingWeapon()) return;

    if (this.match.activeWeapon !== slot) {
      this.match.isADS = false;
      this.match.targetAdsLerp = 0.0;

      if (this.match.isReloading) {
        this.match.isReloading = false;
        setWeaponReloading(false);
        audioManager.stopWeaponReload();
        const wSlot = this.match.activeWeapon === 1 ? "primary" : "secondary";
        if (this.match.transport) this.match.transport.emit("reliable_event", { type: "CANCEL_RELOAD", weaponSlot: wSlot });
      }

      switchActiveWeaponModel(slot);
      this.match.activeWeapon = slot;
      this.match.updateWeaponUI();
    } else if (slot === 1) {
      if (this.match.transport) this.match.transport.emit("reliable_event", { type: "TOGGLE_FIRE_MODE" });
    }
  }

  private setupTouchControls() {
    if (IS_DESKTOP) return;

    const joystickKnob = document.getElementById("joystick-knob");
    const joystickBoundary = document.getElementById("joystick-boundary");

    if (joystickBoundary && joystickKnob) {
      joystickBoundary.style.pointerEvents = "auto";
      joystickBoundary.style.touchAction = "none";
      let joystickActive = false;
      let startX = 0, startY = 0;
      const maxRadius = 48;
      let movePointerId: number | null = null;

      const startJoystick = (e: PointerEvent) => {
        if ((window as any).isEditMode) return;
        if (this.isGameInputLocked()) return;
        if (!this.match || this.match.isLocalPlayerDead) return;
        if (e.pointerType === "mouse") return;
        e.preventDefault(); e.stopPropagation();
        if (movePointerId !== null) return;

        try { joystickBoundary.setPointerCapture(e.pointerId); } catch (_) {}
        movePointerId = e.pointerId;
        joystickActive = true;
        this.match.activePointers.set(e.pointerId, { type: "joystick", id: "" });

        const rect = joystickBoundary.getBoundingClientRect();
        startX = rect.left + rect.width / 2;
        startY = rect.top + rect.height / 2;
      };

      const moveJoystick = (e: PointerEvent) => {
        if (!this.match || this.match.isLocalPlayerDead) return;
        if (e.pointerType === "mouse") return;
        if (!joystickActive || e.pointerId !== movePointerId) return;
        e.preventDefault(); e.stopPropagation();

        let rawDX = e.clientX - startX;
        let rawDY = e.clientY - startY;
        const js = (window as any).vexeaSettings ? (window as any).vexeaSettings.joySens : 1.0;
        let deltaX = rawDX * js;
        let deltaY = rawDY * js;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distance > maxRadius) {
          deltaX = (deltaX / distance) * maxRadius;
          deltaY = (deltaY / distance) * maxRadius;
        }

        joystickKnob.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        const normX = deltaX / maxRadius;
        const normY = -deltaY / maxRadius;
        const sprint = normY > 0.8 && Math.abs(normX) < 0.5;
        inputManager.setJoystick(normX, normY, sprint);

        if (sprint) {
          inputManager.isCrouching = false;
          document.getElementById("btn-crouch")?.classList.remove("bg-white", "text-black");
        }
      };

      const resetJoystick = (e: PointerEvent) => {
        if (e.pointerType === "mouse") return;
        if (e.pointerId !== movePointerId) return;
        e.preventDefault(); e.stopPropagation();
        this.match.activePointers.delete(e.pointerId);
        try { joystickBoundary.releasePointerCapture(e.pointerId); } catch (_) {}
        joystickActive = false;
        joystickKnob.style.transform = "translate(0px, 0px)";
        inputManager.setJoystick(0, 0, false);
        movePointerId = null;
      };

      joystickBoundary.addEventListener("pointerdown", startJoystick, { signal: this.abortController.signal });
      joystickBoundary.addEventListener("pointermove", moveJoystick, { signal: this.abortController.signal });
      joystickBoundary.addEventListener("pointerup", resetJoystick, { signal: this.abortController.signal });
      joystickBoundary.addEventListener("pointercancel", resetJoystick, { signal: this.abortController.signal });
    }

    const lookZone = document.getElementById("look-zone-right");
    if (lookZone) {
      lookZone.style.touchAction = "none";
      const touchSensitivity = 0.003;

      const startLook = (e: PointerEvent) => {
        if ((window as any).isEditMode) return;
        if (this.isGameInputLocked()) return;
        if (!this.match || this.match.isLocalPlayerDead) return;
        if (e.pointerType === "mouse") return;
        e.preventDefault(); e.stopPropagation();
        if (this.match.lookPointerId !== null) return;

        try { lookZone.setPointerCapture(e.pointerId); } catch (_) {}
        this.match.lookPointerId = e.pointerId;
        this.match.isTouchingLookZone = true;
        this.match.lastTouchX = e.clientX;
        this.match.lastTouchY = e.clientY;
        this.match.activePointers.set(e.pointerId, { type: "camera", id: "" });
      };

      const moveLook = (e: PointerEvent) => {
        if (!this.match || this.match.isLocalPlayerDead) return;
        if (e.pointerType === "mouse") return;
        if (!this.match.isTouchingLookZone || e.pointerId !== this.match.lookPointerId) return;
        e.preventDefault(); e.stopPropagation();

        const deltaX = e.clientX - this.match.lastTouchX;
        const deltaY = e.clientY - this.match.lastTouchY;
        const cs = (window as any).vexeaSettings ? (window as any).vexeaSettings.camSens : 1.0;
        const inv = (window as any).vexeaSettings && (window as any).vexeaSettings.invertY ? -1 : 1;
        this.match.playerYaw -= deltaX * touchSensitivity * cs;
        this.match.playerPitch -= deltaY * touchSensitivity * cs * inv;
        this.match.playerPitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.match.playerPitch));

        this.match.lastTouchX = e.clientX;
        this.match.lastTouchY = e.clientY;
      };

      const stopLook = (e: PointerEvent) => {
        if (e.pointerType === "mouse") return;
        if (e.pointerId !== this.match.lookPointerId) return;
        e.preventDefault(); e.stopPropagation();
        this.match.activePointers.delete(e.pointerId);
        try { lookZone.releasePointerCapture(e.pointerId); } catch (_) {}
        this.match.isTouchingLookZone = false;
        this.match.lookPointerId = null;
      };

      lookZone.addEventListener("pointerdown", startLook, { signal: this.abortController.signal });
      lookZone.addEventListener("pointermove", moveLook, { signal: this.abortController.signal });
      lookZone.addEventListener("pointerup", stopLook, { signal: this.abortController.signal });
      lookZone.addEventListener("pointercancel", stopLook, { signal: this.abortController.signal });
    }

    this.safeBindTouch("btn-jump", () => { inputManager.isJumping = true; }, () => { inputManager.isJumping = false; });
    this.toggleStateBtn("btn-crouch", "Crouch");
    this.safeBindTouch("btn-sprint", () => {});

    const adsBtn = document.getElementById("btn-ads");
    if (adsBtn) {
      this.safeBindTouch("btn-ads", () => {
        if (isSwitchingWeapon()) return;
        if (!this.match) return;
        this.match.isADS = !this.match.isADS;
        if (this.match.isADS) adsBtn.classList.add("bg-white", "opacity-80");
        else adsBtn.classList.remove("bg-white", "opacity-80");
      });
    }

    this.safeBindTouch("btn-reload", () => { this.requestReload(); });

    const ws1 = document.getElementById("weapon-slot-1");
    if (ws1) {
      ws1.style.pointerEvents = "auto";
      ws1.addEventListener("pointerdown", (e) => {
        if ((window as any).isEditMode) return;
        if (this.isGameInputLocked()) return;
        e.preventDefault(); e.stopPropagation();
        this.selectWeapon(1);
      }, { signal: this.abortController.signal });
    }
    const ws2 = document.getElementById("weapon-slot-2");
    if (ws2) {
      ws2.style.pointerEvents = "auto";
      ws2.addEventListener("pointerdown", (e) => {
        if ((window as any).isEditMode) return;
        if (this.isGameInputLocked()) return;
        e.preventDefault(); e.stopPropagation();
        this.selectWeapon(2);
      }, { signal: this.abortController.signal });
    }

    this.bindDragShoot("btn-fire-right", this.triggerFireStart.bind(this), this.triggerFireEnd.bind(this));
    this.bindDragShoot("btn-fire-left", this.triggerFireStart.bind(this), this.triggerFireEnd.bind(this));
  }

  private fireInterval: any = null;

  private triggerFireStart() {
    if (!this.match || this.match.isLocalPlayerDead) return;
    if (this.match.activeWeapon === 2) {
      this.match.combat?.fireActiveShot(this.camera);
    } else {
      if (this.match.rifleMode === "auto") {
        this.match.combat?.fireActiveShot(this.camera);
        if (this.fireInterval) clearInterval(this.fireInterval);
        this.fireInterval = setInterval(() => {
          if (this.match) this.match.combat?.fireActiveShot(this.camera);
        }, 150);
      } else {
        this.match.combat?.fireActiveShot(this.camera);
        let bCount = 1;
        if (this.fireInterval) clearInterval(this.fireInterval);
        this.fireInterval = setInterval(() => {
          if (!this.match) {
            clearInterval(this.fireInterval);
            return;
          }
          bCount++;
          if (bCount <= 3) this.match.combat?.fireActiveShot(this.camera);
          else {
            clearInterval(this.fireInterval);
            this.fireInterval = null;
          }
        }, 100);
      }
    }
  }

  private triggerFireEnd() {
    if (!this.match) return;
    if (this.match.rifleMode === "auto" && this.fireInterval) {
      clearInterval(this.fireInterval);
      this.fireInterval = null;
    }
  }

  private safeBindTouch(
    id: string,
    startHandler: (e: PointerEvent) => void,
    endHandler?: (e: PointerEvent) => void,
  ) {
    const el = document.getElementById(id);
    if (!el) return;

    el.style.pointerEvents = "auto";
    el.style.touchAction = "none";

    el.addEventListener("pointerdown", (e: PointerEvent) => {
      if ((window as any).isEditMode) return;
      if (this.isGameInputLocked()) return;
      if (!this.match || this.match.isLocalPlayerDead) return;
      if (e.pointerType === "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      this.match.activePointers.set(e.pointerId, { type: "button", id });
      startHandler(e);
    }, { signal: this.abortController.signal });

    if (endHandler) {
      const handleEnd = (e: PointerEvent) => {
        if (e.pointerType === "mouse") return;
        e.preventDefault();
        e.stopPropagation();
        if (this.match.activePointers.has(e.pointerId)) {
          this.match.activePointers.delete(e.pointerId);
          try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        endHandler(e);
      };
      el.addEventListener("pointerup", handleEnd, { signal: this.abortController.signal });
      el.addEventListener("pointercancel", handleEnd, { signal: this.abortController.signal });
    }
  }

  private toggleStateBtn(id: string, keyName: string) {
    const el = document.getElementById(id);
    if (el) {
      this.safeBindTouch(id, () => {
        if (keyName === "Crouch") {
          inputManager.isCrouching = !inputManager.isCrouching;
          if (inputManager.isCrouching) el.classList.add("bg-white", "text-black");
          else el.classList.remove("bg-white", "text-black");
        }
      });
    }
  }

  private bindDragShoot(id: string, startCb: Function, endCb: Function) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.pointerEvents = "auto";
    el.style.touchAction = "none";

    let shootPointerId: number | null = null;

    const onStart = (e: PointerEvent) => {
      if ((window as any).isEditMode) return;
      if (this.isGameInputLocked()) return;
      if (e.pointerType === "mouse") return;
      if (!this.match || this.match.isLocalPlayerDead) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      this.match.activePointers.set(e.pointerId, { type: "shoot", id });
      shootPointerId = e.pointerId;
      startCb();

      if (this.match.lookPointerId === null) {
        this.match.lookPointerId = e.pointerId;
        this.match.isTouchingLookZone = true;
        this.match.lastTouchX = e.clientX;
        this.match.lastTouchY = e.clientY;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (shootPointerId !== e.pointerId) return;
      e.preventDefault(); e.stopPropagation();

      if (this.match.isTouchingLookZone && this.match.lookPointerId === e.pointerId) {
        const deltaX = e.clientX - this.match.lastTouchX;
        const deltaY = e.clientY - this.match.lastTouchY;
        const cs = (window as any).vexeaSettings ? (window as any).vexeaSettings.camSens : 1.0;
        const inv = (window as any).vexeaSettings && (window as any).vexeaSettings.invertY ? -1 : 1;
        this.match.playerYaw -= deltaX * 0.003 * cs;
        this.match.playerPitch -= deltaY * 0.003 * cs * inv;
        this.match.playerPitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.match.playerPitch));
        this.match.lastTouchX = e.clientX;
        this.match.lastTouchY = e.clientY;
      }
    };

    const onEnd = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      if (shootPointerId !== e.pointerId) return;
      e.preventDefault(); e.stopPropagation();
      this.match.activePointers.delete(e.pointerId);
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      if (this.match.lookPointerId === e.pointerId) {
        this.match.lookPointerId = null;
        this.match.isTouchingLookZone = false;
      }
      shootPointerId = null;
      endCb();
    };

    el.addEventListener("pointerdown", onStart, { signal: this.abortController.signal });
    el.addEventListener("pointermove", onMove, { signal: this.abortController.signal });
    el.addEventListener("pointerup", onEnd, { signal: this.abortController.signal });
    el.addEventListener("pointercancel", onEnd, { signal: this.abortController.signal });
  }

  public step(dt: number) {
    if (this.isGameInputLocked()) {
      // Clear movement keys and vectors instantly on input lock to prevent infinite running/sliding
      this.match.tempMoveDir.set(0, 0, 0);
      if (this.match.physicsData) {
        this.match.physicsData[0] = 0;
        this.match.physicsData[1] = 0;
        this.match.physicsData[2] = 0;
        this.match.physicsData[3] = 0;
        this.match.physicsData[9] = 0;
      }
      return;
    }
    if (!this.match || this.match.isLocalPlayerDead) return;

    let mask = 0;
    if (keys.w || GlobalState.__forceWalk) mask |= 1 << 0;
    if (keys.a) mask |= 1 << 1;
    if (keys.s) mask |= 1 << 2;
    if (keys.d) mask |= 1 << 3;
    if (keys.Space) mask |= 1 << 4;
    if (keys.Shift) mask |= 1 << 5;
    if (keys.Crouch) mask |= 1 << 6;
    if (keys.Dash) mask |= 1 << 7;

    this.match.tempMoveDir.set(0, 0, 0);
    if (keys.w || GlobalState.__forceWalk) this.match.tempMoveDir.z -= 1.0;
    if (keys.s) this.match.tempMoveDir.z += 1.0;
    if (keys.a) this.match.tempMoveDir.x -= 1.0;
    if (keys.d) this.match.tempMoveDir.x += 1.0;

    const len = this.match.tempMoveDir.length();
    if (len > 0) {
      this.match.tempMoveDir.divideScalar(len);
    }
    this.match.tempMoveDir.applyEuler(new THREE.Euler(0, this.match.playerYaw, 0));

    let targetSpeed = 0.0;

    if (GlobalState.isFlying) {
      this.match.localVy = 0.0;
      this.match.localGrounded = false;
      targetSpeed = (keys.Shift ? 25.0 : 10.0) * (GlobalState.speedMultiplier || 1.0);
      const flyMove = new THREE.Vector3().copy(this.match.tempMoveDir).multiplyScalar(targetSpeed * dt);

      if (keys.Space) flyMove.y += targetSpeed * dt;
      if (keys.Crouch) flyMove.y -= targetSpeed * dt;

      this.match.playerPos.add(flyMove);

      if (this.match.physicsWorker) {
        this.match.physicsWorker.postMessage({
          type: "CORRECT_POS",
          pos: { x: this.match.playerPos.x, y: this.match.playerPos.y, z: this.match.playerPos.z },
        });
      }

      if (this.match.transport) {
        this.match.transport.emit("dev_set_position", {
          position: { x: this.match.playerPos.x, y: this.match.playerPos.y, z: this.match.playerPos.z }
        });
      }
    } else {
      let curveT = 0.0;
      const isMoving = keys.w || keys.a || keys.s || keys.d || GlobalState.__forceWalk;
      const isSprinting = isMoving && keys.Shift && !keys.Crouch;

      if (this.match.cameraEffects) {
        curveT = this.match.cameraEffects.updateSpeedBlend(dt, isMoving, isSprinting);
      } else {
        curveT = isSprinting ? 1.0 : 0.0;
      }

      const baseWalkSpeed = keys.Crouch ? PLAYER_CROUCH_SPEED : PLAYER_BASE_SPEED;
      const maxSprintSpeed = PLAYER_BASE_SPEED * PLAYER_SPRINT_MULTIPLIER;
      targetSpeed = baseWalkSpeed + (maxSprintSpeed - baseWalkSpeed) * curveT;
      targetSpeed *= (GlobalState.speedMultiplier || 1.0);

      let targetCamY = keys.Crouch ? PLAYER_EYE_LEVEL_CROUCH : PLAYER_EYE_LEVEL;
      this.match.localCrouchY += (targetCamY - this.match.localCrouchY) * 10.0 * dt;

      if (keys.Space && this.match.localGrounded) {
        this.match.localVy = PLAYER_JUMP_VELOCITY;
        this.match.localGrounded = false;
      }

      if (!this.match.localGrounded) {
        this.match.localVy -= PLAYER_GRAVITY * dt;
        this.match.playerPos.y += this.match.localVy * dt;
      }

      if (keys.Dash) targetSpeed = PLAYER_BASE_SPEED * PLAYER_DASH_MULTIPLIER;

      if (this.match.physicsData) {
        this.match.physicsData[0] = this.match.tempMoveDir.x;
        this.match.physicsData[1] = this.match.tempMoveDir.z;
        this.match.physicsData[2] = targetSpeed;
        this.match.physicsData[3] = inputManager.isJumping ? 1 : 0;
        this.match.physicsData[9] = inputManager.isCrouching ? 1 : 0;

        this.match.playerPos.set(this.match.physicsData[5], this.match.physicsData[6], this.match.physicsData[7]);
      } else if (this.match.physicsWorker) {
        this.match.physicsWorker.postMessage({
          type: "INPUT",
          moveX: this.match.tempMoveDir.x,
          moveZ: this.match.tempMoveDir.z,
          speed: targetSpeed,
          jump: inputManager.isJumping ? 1 : 0,
          crouch: inputManager.isCrouching ? 1 : 0
        });
      } else {
        this.match.playerPos.add(this.match.tempMoveDir.multiplyScalar(targetSpeed * dt));
      }
    }

    this.camera.position.set(
      this.match.playerPos.x,
      this.match.playerPos.y + (this.match.localCrouchY - PLAYER_CENTER_OFFSET),
      this.match.playerPos.z,
    );

    if (this.match.transport) {
      const seq = incrementInputSequence();
      tempInputView.setUint32(0, seq, true);
      tempInputView.setUint8(4, mask);
      tempInputView.setFloat32(5, this.match.playerPitch, true);
      tempInputView.setFloat32(9, this.match.playerYaw, true);
      tempInputView.setUint8(13, this.match.pendingFire ? 1 : 0);
      tempInputView.setUint32(14, performance.now() % 0xffffffff, true);
      this.match.transport.rawEmit(tempInputBuffer);
      this.match.pendingFire = false;

      if (this.match.moveHistory.length > 120) {
        this.match.moveHistory.shift();
      }
      this.match.moveHistory.push({
        seq,
        time: performance.now(),
        x: this.match.playerPos.x,
        y: this.match.playerPos.y,
        z: this.match.playerPos.z,
        mask
      });
    }

    const currentSpeed = len > 0 ? targetSpeed : 0;
    audioManager.updateFootsteps(dt, currentSpeed, this.match.playerPos, this.match.localGrounded);
  }

  public isGameInputLocked(): boolean {
    if (!this.match) return true;
    if (this.match.isLocalPlayerDead) return true;
    if ((window as any).gameState !== "ACTIVE_MATCH") return true;
    
    // Check if any overlays/menus are active
    const splash = document.getElementById("splash-screen");
    if (splash && splash.style.display !== "none") return true;

    const portraitLock = document.getElementById("portrait-lock");
    if (portraitLock && portraitLock.style.pointerEvents !== "none" && portraitLock.style.opacity !== "0") return true;

    const loadingOverlay = document.querySelector(".loading-overlay") as HTMLElement;
    if (loadingOverlay && loadingOverlay.style.display !== "none") return true;

    const devMenu = document.getElementById("dev-overlay");
    if (devMenu && devMenu.style.display !== "none") return true;
    
    const mapEditor = document.getElementById("dev-map-editor-screen");
    if (mapEditor && mapEditor.style.display !== "none") return true;
    
    const minimap = document.getElementById("minimap-container");
    if (minimap && minimap.classList.contains("fullscreen-minimap")) return true;
    
    const settings = document.getElementById("vexea-settings-overlay");
    if (settings && settings.style.display !== "none") return true;

    const matchStatus = document.getElementById("match-status-modal");
    if (matchStatus && matchStatus.style.display !== "none") return true;

    const uiEditor = document.getElementById("ui-editor-bar");
    if (uiEditor && uiEditor.style.display !== "none") return true;
    
    return false;
  }

  private isUIElement(target: EventTarget | null): boolean {
    if (!target) return false;
    let el = target as HTMLElement;
    while (el) {
      if (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'A') {
        return true;
      }
      if (
        el.id === 'dev-overlay' || 
        el.id === 'minimap-container' || 
        el.classList?.contains('fullscreen-minimap') || 
        el.id === 'vexea-settings-overlay' ||
        el.id === 'match-status-modal' ||
        el.id === 'btn-match-status' ||
        el.id === 'ui-editor-bar' ||
        el.id === 'splash-screen' ||
        el.id === 'portrait-lock' ||
        el.classList?.contains('loading-overlay')
      ) {
        return true;
      }
      el = el.parentElement as HTMLElement;
    }
    return false;
  }
}
