# VFX PERFORMANCE AND ATTACHMENT REWORK PROPOSAL

This proposal outlines the architectural analysis and implementation plan to eliminate muzzle flash lag spikes under WebGPU, resolve the stationary attachment bug, and cleanly purge legacy muzzle flash systems while maintaining high-quality Niagara-style effects and adhering to a strict Zero-Allocation/Zero-GC architecture.

---

## 1. DIAGNOSTICS & FINDINGS

### A. WebGPU Light Cache Stutter (Lag Spikes)
We analyzed why pressing the fire button triggers massive lag spikes. 
In Three.js WebGPU, toggling a Light's visibility (`light.visible = true / false`) or adding/removing lights dynamically alters the active light structures. This invalidates the WebGPU pipeline cache, forcing the engine to rebuild light uniform buffers and perform on-demand shader recompilations on the hot path (during combat ticks).
Furthermore, a single call to `triggerFlash` triggers **two separate point lights** simultaneously:
1. One from the Niagara-style `NiagaraMuzzleFlash` pool in `/client/src/vfx/firing.ts`
2. One from the legacy `MuzzleFlashInstance` pool in `/client/src/vfx/VFXOrchestrator.ts`

### B. Stationary Muzzle Flash Bug
Currently, when a player or drone fires, `triggerFlash` captures a static snapshot of the muzzle position (`muzzlePos`). 
Over the muzzle flash's brief lifetime (50ms / 3 frames), the meshes (`coreMesh`, `spikeMesh`) and point light stay anchored to that exact static world position. If the player or drone is moving or turning while firing, the muzzle flash is left floating in mid-air behind the weapon tip, causing a highly noticeable visual detachment.

---

## 2. THE THREE-POINT ARCHITECTURAL PLAN

To achieve pristine, 60fps performance and correct attachment behavior on mobile and desktop:

### 1. Zero-Allocation Live Attachment Tracking
We will extend the `NiagaraMuzzleFlash` structure in `/client/src/vfx/firing.ts` to support dynamic tracking:
```typescript
export interface NiagaraMuzzleFlash {
  coreMesh: THREE.Mesh;
  spikeMesh: THREE.Mesh;
  light: THREE.PointLight | null;
  life: number;
  maxLife: number;
  scaleFactor: number;
  
  // Dynamic Attachment Metadata (Zero-GC)
  attachToPlayer: boolean;
  attachToDroneId: number | null;
  localOffset: THREE.Vector3; // Pre-allocated Vector3
}
```
*   **Player Muzzle Attachment:** If `attachToPlayer === true`, we will call `getMuzzleWorldPosition(inst.coreMesh.position, camera)` on every frame in the update loop. This ensures the flash and its light stick perfectly to the animated weapon tip.
*   **Drone Muzzle Attachment:** If `attachToDroneId` is set, we query the live client-interpolated position of that drone from `match.droneJitterMap` and translate the flash relative to its moving origin using a pre-allocated offset.

### 2. Zero-Recompilation Constant Lights
To eliminate WebGPU shader/pipeline updates entirely, we will treat lights as constant structures:
*   During initial pool creation, all muzzle flash and explosion lights will be added to the scene with **`visible = true`** and **`intensity = 0`**.
*   We will **NEVER** set `light.visible = false` at runtime.
*   To "activate" or "deactivate" a light, we only update its `intensity` (and/or color). Set to `intensity = 0` when inactive, and restore to its target intensity when active. WebGPU sees no change in the light count or layout, yielding a completely smooth, stutter-free frame rate.

### 3. Pure Niagara Migration & Legacy Purge
We will completely deprecate and remove:
*   The legacy `flashPool` and its associated meshes, materials, and lights inside `/client/src/vfx/VFXOrchestrator.ts`.
*   Unify all muzzle flash logic into `/client/src/vfx/firing.ts`.
*   Rewrite `triggerFlash(...)` in `/client/src/vfx/VFXOrchestrator.ts` to accept optional attachment parameters and delegate directly to `triggerNiagaraFlash(...)`.

---

## 3. PROPOSED IMPLEMENTATION SIGNATURES

### `/client/src/vfx/firing.ts`
```typescript
export function triggerNiagaraFlash(
  muzzlePos: THREE.Vector3,
  direction: THREE.Vector3,
  scale = 1.0,
  attachToPlayer = false,
  attachToDroneId: number | null = null
) {
  // 1. Recycle oldest or grab inactive slot from pool
  // 2. Set life, scale, attachToPlayer, attachToDroneId
  // 3. Compute localOffset relative to target if droneId is provided
  // 4. Update position & light intensity (visible remains true always)
}

export function updateFiringVFX(deltaTime: number, camera: THREE.PerspectiveCamera) {
  // 1. Decay lifetime
  // 2. If attachToPlayer: getMuzzleWorldPosition(inst.coreMesh.position, camera) and project spike & light
  // 3. If attachToDroneId: look up droneJitterMap and apply offset
  // 4. Update core billboard rotation, scale, and decay light intensity (setting to 0 upon completion)
}
```

### `/client/src/vfx/VFXOrchestrator.ts`
```typescript
export function triggerFlash(muzzlePos?: THREE.Vector3, scaleFactor = 1.0, attachToPlayer = false, droneIdToAttach: number | null = null) {
  if (!vfxInitialized || !muzzlePos) return;

  const camera = (window as any).camera;
  _vfxDir.set(0, 0, 1);
  if (camera) {
    camera.getWorldDirection(_vfxDir);
  }

  // Trigger modern Niagara muzzle flash with attachment parameters
  triggerNiagaraFlash(muzzlePos, _vfxDir, scaleFactor, attachToPlayer, droneIdToAttach);
}
```
