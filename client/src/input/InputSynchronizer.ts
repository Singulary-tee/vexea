import { inputManager } from "../../input";

// Pre-allocated buffers for input
export const tempInputBuffer = new ArrayBuffer(20);
export const tempInputView = new DataView(tempInputBuffer);
export let inputSequence = 0;

export function incrementInputSequence() {
  inputSequence++;
  return inputSequence;
}

export const keys = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'w') return inputManager.moveZ < 0;
    if (prop === 's') return inputManager.moveZ > 0;
    if (prop === 'a') return inputManager.moveX < 0;
    if (prop === 'd') return inputManager.moveX > 0;
    if (prop === 'Shift') return inputManager.isSprinting;
    if (prop === 'Space') return inputManager.isJumping;
    if (prop === 'Crouch') return inputManager.isCrouching;
    if (prop === 'Ads') return inputManager.isADS;
    return false;
  },
  set: (target, prop, value) => {
    // Swallow manual setters from touch joystick, route to input manager correctly!
    // This enforces the gate
    return true;
  }
}) as unknown as Record<string, boolean>;
