import * as THREE from "three";

export const GlobalState = {
  // attached to window for easy access

  __clientPhysics: null as any,
  __forceWalk: false,
  __teleported: false,
  camDeadMesh: null as THREE.InstancedMesh | null,
  camActiveMesh: null as THREE.InstancedMesh | null,
  
  // Developer Suit State variables
  visDiag: { colliders: false, aiSight: false, zoneBorders: false, bulletPaths: false, hitSpheres: false, navPoints: false, interpPaths: false, serverCubes: false },
  isFlying: false,
  speedMultiplier: 1.0,
  godMode: false,
  infiniteAmmo: false,
};
(window as any).GlobalState = GlobalState;
