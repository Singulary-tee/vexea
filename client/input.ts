export enum InputAction {
  MOVE_FORWARD = "MOVE_FORWARD",
  MOVE_BACKWARD = "MOVE_BACKWARD",
  MOVE_LEFT = "MOVE_LEFT",
  MOVE_RIGHT = "MOVE_RIGHT",
  JUMP = "JUMP",
  CROUCH = "CROUCH",
  SPRINT = "SPRINT",
  FIRE = "FIRE",
  ADS = "ADS",
  RELOAD = "RELOAD",
  SWAP_WEAPON_1 = "SWAP_WEAPON_1",
  SWAP_WEAPON_2 = "SWAP_WEAPON_2",
}

type InputHandler = (action: InputAction, state: boolean) => void;

class InputManager {
  private activeKeys = new Map<string, boolean>();
  private activeActions = new Map<InputAction, boolean>();
  private handlers: InputHandler[] = [];
  
  // Expose primitive values natively for zero-GC querying
  public moveZ: number = 0;
  public moveX: number = 0;
  public isJumping: boolean = false;
  public isSprinting: boolean = false;
  public isFiring: boolean = false;
  public isReloading: boolean = false;
  public isCrouching: boolean = false;
  public isADS: boolean = false;

  // Global Gates
  public inputLocked: boolean = false; // E.g., when dead or in menu

  private keyMap: Record<string, InputAction> = {
    'w': InputAction.MOVE_FORWARD,
    'W': InputAction.MOVE_FORWARD,
    'a': InputAction.MOVE_LEFT,
    'A': InputAction.MOVE_LEFT,
    's': InputAction.MOVE_BACKWARD,
    'S': InputAction.MOVE_BACKWARD,
    'd': InputAction.MOVE_RIGHT,
    'D': InputAction.MOVE_RIGHT,
    ' ': InputAction.JUMP,
    'Shift': InputAction.SPRINT,
    'Control': InputAction.CROUCH,
    'c': InputAction.CROUCH,
    'C': InputAction.CROUCH,
    'r': InputAction.RELOAD,
    'R': InputAction.RELOAD,
    '1': InputAction.SWAP_WEAPON_1,
    '2': InputAction.SWAP_WEAPON_2,
  };

  public init() {
    window.addEventListener("keydown", this.onKeyDown.bind(this));
    window.addEventListener("keyup", this.onKeyUp.bind(this));
    window.addEventListener("mousedown", this.onMouseDown.bind(this));
    window.addEventListener("mouseup", this.onMouseUp.bind(this));
  }

  public registerHandler(handler: InputHandler) {
    this.handlers.push(handler);
  }

  private setAction(action: InputAction, state: boolean) {
    if (this.inputLocked) return;
    
    // Prevent duplicate firing
    if (this.activeActions.get(action) === state) return;
    
    this.activeActions.set(action, state);
    
    // Compute movement vector values instantly to avoid Object instantiation
    if (action === InputAction.MOVE_FORWARD || action === InputAction.MOVE_BACKWARD) {
      this.moveZ = (this.activeActions.get(InputAction.MOVE_FORWARD) ? -1 : 0) + (this.activeActions.get(InputAction.MOVE_BACKWARD) ? 1 : 0);
    }
    if (action === InputAction.MOVE_LEFT || action === InputAction.MOVE_RIGHT) {
      this.moveX = (this.activeActions.get(InputAction.MOVE_RIGHT) ? 1 : 0) + (this.activeActions.get(InputAction.MOVE_LEFT) ? -1 : 0);
    }
    
    // Primitive bindings for fast loops
    switch (action) {
      case InputAction.JUMP: this.isJumping = state; break;
      case InputAction.SPRINT: this.isSprinting = state; break;
      case InputAction.CROUCH: this.isCrouching = state; break;
      case InputAction.FIRE: this.isFiring = state; break;
      case InputAction.ADS: this.isADS = state; break;
      case InputAction.RELOAD: this.isReloading = state; break;
    }

    // Publish to subscribers
    for (const handler of this.handlers) {
      handler(action, state);
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    const action = this.keyMap[e.key];
    if (action && !this.activeKeys.get(e.key)) {
      this.activeKeys.set(e.key, true);
      this.setAction(action, true);
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    const action = this.keyMap[e.key];
    if (action) {
      this.activeKeys.set(e.key, false);
      this.setAction(action, false);
    }
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button === 0) this.setAction(InputAction.FIRE, true);
    if (e.button === 2) this.setAction(InputAction.ADS, true);
  }

  private onMouseUp(e: MouseEvent) {
    if (e.button === 0) this.setAction(InputAction.FIRE, false);
    if (e.button === 2) this.setAction(InputAction.ADS, false);
  }

  public setInputLocked(locked: boolean) {
    this.inputLocked = locked;
    if (locked) {
      this.resetAll();
    }
  }

  public resetAll() {
    this.activeKeys.clear();
    const actions = Array.from(this.activeActions.keys());
    for (const action of actions) {
      this.setAction(action, false);
    }
    this.moveX = 0;
    this.moveZ = 0;
    this.isJumping = false;
    this.isSprinting = false;
    this.isFiring = false;
    this.isADS = false;
    this.isReloading = false;
    this.isCrouching = false;
  }

  public setJoystick(normX: number, normZ: number, sprint: boolean) {
    if (this.inputLocked) return;
    this.moveX = (normX > 0.3 ? 1 : 0) + (normX < -0.3 ? -1 : 0);
    this.moveZ = (normZ > 0.3 ? -1 : 0) + (normZ < -0.3 ? 1 : 0);
    this.isSprinting = sprint;
  }
}

export const inputManager = new InputManager();
