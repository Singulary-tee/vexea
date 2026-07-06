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
import { DETAILED_WEAPONS, PLAYER_EYE_LEVEL, PLAYER_CENTER_OFFSET, PLAYER_EYE_LEVEL_CROUCH } from "../../../shared/constants";
import { 
  switchActiveWeaponModel, 
  isSwitchingWeapon, 
  setWeaponReloading 
} from "../../weapons_model";

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
      this.canvasContainer.addEventListener("click", () => {
        if (!this.match || this.match.isLocalPlayerDead) return;
        this.match.combat?.fireActiveShot(this.camera);
      }, { signal });

      this.canvasContainer.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });
    }

    document.addEventListener("mousedown", (e) => {
      if (!this.match || this.match.isLocalPlayerDead) return;
      if (isSwitchingWeapon()) return;
      if (e.button === 2) {
        e.preventDefault();
        this.match.isADS = true;
      }
    }, { signal });

    document.addEventListener("mouseup", (e) => {
      if (!this.match || this.match.isLocalPlayerDead) return;
      if (e.button === 2) {
        e.preventDefault();
        this.match.isADS = false;
      }
    }, { signal });

    document.addEventListener("mousemove", (e) => {
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
        e.preventDefault(); e.stopPropagation();
        this.selectWeapon(1);
      }, { signal: this.abortController.signal });
    }
    const ws2 = document.getElementById("weapon-slot-2");
    if (ws2) {
      ws2.style.pointerEvents = "auto";
      ws2.addEventListener("pointerdown", (e) => {
        if ((window as any).isEditMode) return;
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
      targetSpeed = keys.Shift ? 15.0 : 5.5;
      if (keys.Crouch) targetSpeed = 2.5;
      targetSpeed *= (GlobalState.speedMultiplier || 1.0);

      let targetCamY = keys.Crouch ? PLAYER_EYE_LEVEL_CROUCH : PLAYER_EYE_LEVEL;
      this.match.localCrouchY += (targetCamY - this.match.localCrouchY) * 10.0 * dt;

      if (keys.Space && this.match.localGrounded) {
        this.match.localVy = 6.0;
        this.match.localGrounded = false;
      }

      if (!this.match.localGrounded) {
        this.match.localVy -= 20.0 * dt;
        this.match.playerPos.y += this.match.localVy * dt;
      }

      if (keys.Dash) targetSpeed *= 3.0;

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
    }

    const currentSpeed = len > 0 ? targetSpeed : 0;
    audioManager.updateFootsteps(dt, currentSpeed, this.match.playerPos, this.match.localGrounded);
  }
}
