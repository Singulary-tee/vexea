---
name: rapier-physics-worker
description: Guide for implementing Rapier physics engine with Web Workers for off-main-thread physics simulation. Use this when working with physics simulation, rigid body dynamics, collision detection, or Web Worker threading.
---

# Rapier Physics Engine with Web Workers

This skill provides guidance for implementing the Rapier physics engine in a Web Worker for high-performance off-main-thread physics simulation in browser games.

## Technology Stack
- **Rapier v0.17+** (Rust → WebAssembly)
- **Web Workers** for off-main-thread computation
- **SharedArrayBuffer** for efficient data transfer (optional)
- **Fixed timestep** at 60Hz (16.67ms per step)

## Rapier.js Installation

```bash
npm install @dimforge/rapier3d
# or for 2D
npm install @dimforge/rapier2d
```

## Football Physics Parameters

Regulation football specifications for realistic simulation:

```typescript
// Ball rigid body specification (regulation NFL football)
const BALL_CONFIG = {
  shape: 'ball',
  radius: 0.143,           // 11.35" diameter converted to meters
  mass: 0.41,              // 14.5 oz in kg
  restitution: 0.35,       // Bounce coefficient
  friction: 0.7,           // Surface grip
  linearDamping: 0.12,     // Air resistance
  angularDamping: 0.18     // Spiral decay rate
};

// Player collision capsule
const PLAYER_CONFIG = {
  shape: 'capsule',
  halfHeight: 0.9,
  radius: 0.3,
  mass: 100,               // kg
  restitution: 0.1,
  friction: 0.9
};
```

## Web Worker Architecture

### Main Thread → Worker Communication Protocol

```typescript
// Message types for physics worker
interface PhysicsMessage {
  type: 'INIT' | 'STEP' | 'THROW' | 'RESET_BALL' | 'MOVE_PLAYER';
  data?: any;
}

interface StepMessage {
  type: 'STEP';
  data: {
    delta: number;  // Delta time in ms
  };
}

interface ThrowMessage {
  type: 'THROW';
  data: {
    force: [number, number, number];
    spin: [number, number, number];
  };
}

// Worker → Main Thread response
interface StateUpdateMessage {
  type: 'STATE_UPDATE';
  timestamp: number;
  bodies: {
    id: string;
    position: [number, number, number];
    rotation: [number, number, number, number];  // Quaternion
  }[];
}
```

### Worker Implementation

```typescript
// physics-worker.ts
import RAPIER from '@dimforge/rapier3d';

let world: RAPIER.World;
let ball: RAPIER.RigidBody;
let ballCollider: RAPIER.Collider;

const FIXED_TIMESTEP = 1 / 60;  // 60Hz
let accumulator = 0;

async function initPhysics() {
  await RAPIER.init();
  
  // Create world with gravity
  const gravity = { x: 0.0, y: -9.81, z: 0.0 };
  world = new RAPIER.World(gravity);
  
  // Create ground
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(50.0, 0.1, 50.0);
  world.createCollider(groundColliderDesc);
  
  // Create football
  const ballBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0.0, 1.8, 0.0)
    .setLinearDamping(0.12)
    .setAngularDamping(0.18);
  ball = world.createRigidBody(ballBodyDesc);
  
  const ballColliderDesc = RAPIER.ColliderDesc.ball(0.143)
    .setRestitution(0.35)
    .setFriction(0.7)
    .setDensity(0.41 / (4/3 * Math.PI * 0.143**3));
  ballCollider = world.createCollider(ballColliderDesc, ball);
}

self.onmessage = async (event: MessageEvent) => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'INIT':
      await initPhysics();
      self.postMessage({ type: 'READY' });
      break;
      
    case 'STEP':
      accumulator += data.delta / 1000;  // Convert to seconds
      
      // Fixed timestep with accumulator
      while (accumulator >= FIXED_TIMESTEP) {
        world.step();
        accumulator -= FIXED_TIMESTEP;
      }
      
      // Interpolation factor for smooth rendering
      const alpha = accumulator / FIXED_TIMESTEP;
      
      self.postMessage({
        type: 'STATE_UPDATE',
        timestamp: performance.now(),
        ball: serializeBall(ball),
        alpha
      });
      break;
      
    case 'THROW':
      ball.setTranslation({ x: 0, y: 1.8, z: 0 }, true);
      ball.setLinvel({ x: data.force[0], y: data.force[1], z: data.force[2] }, true);
      ball.setAngvel({ x: data.spin[0], y: data.spin[1], z: data.spin[2] }, true);
      ball.wakeUp();
      break;
      
    case 'RESET_BALL':
      ball.setTranslation({ x: 0, y: 1.8, z: 0 }, true);
      ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
      ball.sleep();
      break;
  }
};

function serializeBall(body: RAPIER.RigidBody) {
  const pos = body.translation();
  const rot = body.rotation();
  const vel = body.linvel();
  const angVel = body.angvel();
  
  return {
    position: [pos.x, pos.y, pos.z],
    velocity: [vel.x, vel.y, vel.z],
    rotation: [rot.x, rot.y, rot.z, rot.w],
    angularVelocity: [angVel.x, angVel.y, angVel.z],
    isActive: body.isMoving()
  };
}
```

## Fixed Timestep Physics Loop

The accumulator pattern ensures deterministic physics regardless of frame rate:

```typescript
// Main thread game loop
let lastTime = performance.now();

function gameLoop(currentTime: number) {
  const delta = currentTime - lastTime;
  lastTime = currentTime;
  
  // Send delta to physics worker
  physicsWorker.postMessage({
    type: 'STEP',
    data: { delta }
  });
  
  requestAnimationFrame(gameLoop);
}
```

## Interpolation for Smooth Rendering

Interpolate between physics states for buttery-smooth visuals:

```typescript
let previousState: PhysicsState;
let currentState: PhysicsState;

physicsWorker.onmessage = (event) => {
  if (event.data.type === 'STATE_UPDATE') {
    previousState = currentState;
    currentState = event.data.ball;
  }
};

function render(alpha: number) {
  if (!previousState || !currentState) return;
  
  // Interpolate position
  const x = lerp(previousState.position[0], currentState.position[0], alpha);
  const y = lerp(previousState.position[1], currentState.position[1], alpha);
  const z = lerp(previousState.position[2], currentState.position[2], alpha);
  
  // Interpolate rotation (use slerp for quaternions)
  const rotation = slerpQuaternion(previousState.rotation, currentState.rotation, alpha);
  
  ballMesh.position.set(x, y, z);
  ballMesh.quaternion.set(...rotation);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

## Inline Worker Pattern (No Separate File)

For simpler deployment, create workers from inline code:

```typescript
function createPhysicsWorker(): Worker {
  const workerCode = `
    const GRAVITY = -9.81;
    const AIR_RESISTANCE = 0.12;
    const ANGULAR_DAMPING = 0.18;
    const GROUND_Y = 0.143;
    const FIXED_TIMESTEP = 1000 / 60;

    let state = {
      ball: {
        position: [0, 1.8, 0],
        velocity: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        angularVelocity: [0, 0, 0],
        isActive: false,
      },
      player: { position: [0, 0, 0] },
    };

    let accumulator = 0;

    function stepPhysics(dt) {
      if (!state.ball.isActive) return;
      const dtSeconds = dt / 1000;
      
      // Apply gravity
      state.ball.velocity[1] += GRAVITY * dtSeconds;
      
      // Apply air resistance
      state.ball.velocity[0] *= 1 - AIR_RESISTANCE * dtSeconds;
      state.ball.velocity[1] *= 1 - AIR_RESISTANCE * dtSeconds * 0.5;
      state.ball.velocity[2] *= 1 - AIR_RESISTANCE * dtSeconds;
      
      // Update position
      state.ball.position[0] += state.ball.velocity[0] * dtSeconds;
      state.ball.position[1] += state.ball.velocity[1] * dtSeconds;
      state.ball.position[2] += state.ball.velocity[2] * dtSeconds;
      
      // Ground collision
      if (state.ball.position[1] <= GROUND_Y) {
        state.ball.position[1] = GROUND_Y;
        state.ball.velocity = [0, 0, 0];
        state.ball.isActive = false;
      }
    }

    self.onmessage = (event) => {
      const { type, data } = event.data;
      
      switch (type) {
        case 'STEP':
          accumulator += data.delta;
          while (accumulator >= FIXED_TIMESTEP) {
            stepPhysics(FIXED_TIMESTEP);
            accumulator -= FIXED_TIMESTEP;
          }
          self.postMessage({ type: 'STATE_UPDATE', state });
          break;
        case 'THROW':
          state.ball.velocity = [...data.force];
          state.ball.angularVelocity = [...data.spin];
          state.ball.isActive = true;
          break;
      }
    };
  `;

  const blob = new Blob([workerCode], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
}
```

## Collision Detection

```typescript
// Check for collisions each frame
world.contactsWith(ballCollider, (otherCollider) => {
  // Handle collision
  const userData = otherCollider.parent()?.userData;
  if (userData?.type === 'target') {
    // Target hit!
    onTargetHit(userData.id);
  }
});
```

## Integration Parameters

```typescript
const integrationParameters = new RAPIER.IntegrationParameters();
integrationParameters.dt = 1 / 60;  // 60 FPS physics
integrationParameters.numSolverIterations = 4;  // Default, good for games
integrationParameters.numAdditionalFrictionIterations = 0;
```

## References

- [Rapier Documentation](https://rapier.rs/docs/)
- [Rapier.js GitHub](https://github.com/dimforge/rapier.js)
- [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
