import RAPIER from "@dimforge/rapier3d-compat";
import mapSpec from "../shared/maps/map_1_facility.spec.json";
import { PLAYER_RADIUS, PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_CAPSULE_HALF_HEIGHT_CROUCH } from "../shared/constants";

let world: RAPIER.World;
let kcc: RAPIER.KinematicCharacterController;
let playerBody: RAPIER.RigidBody;
let playerCollider: RAPIER.Collider;
let lastCrouchState = false;

let sharedData: Float32Array | null = null;
let lastLoggedPos = { x: 0, y: 0, z: 0 };
let hasLoggedCollisionTest = false;

let cubeBody: RAPIER.RigidBody | undefined;
let cubeCollider: RAPIER.Collider | undefined;
let cubeEvents: string[] = [];
let cubePrevState: "air" | "ground" | "none" = "none";
let cubeSpawned = false;

let localGravityY = -9.81;
let localSpeedMultiplier = 1.0;
let localPaused = false;
let localStepOnceRequested = false;

const FIXED_TIMESTEP = 1 / 60;
let accumulator = 0;
let desiredMovement: RAPIER.Vector3;
let nextPos: RAPIER.Vector3;

let localMoveX = 0;
let localMoveZ = 0;
let localSpeed = 0;
let localIsJump = false;
let localIsCrouch = false;
let localVelY = 0;

self.onerror = function(message, source, lineno, colno, error) {
    self.postMessage({
        type: "WORKER_CRASH",
        error: `${message} at ${source}:${lineno}`
    });
    return true;
};

self.onmessage = async (e) => {
    if (e.data.type === 'INIT') {
        try {
            await RAPIER.init();
            console.log("[Worker] Rapier3D WASM initialized successfully.");
        } catch (err: any) {
            console.error("[Worker] Failed to initialize Rapier WASM:", err);
            self.postMessage({
                type: "WORKER_CRASH",
                error: `Rapier WASM Init Failed: ${err.message}`
            });
            return;
        }

        world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
        world.integrationParameters.dt = 1 / 60;
        world.integrationParameters.numSolverIterations = 4;
        
        desiredMovement = new RAPIER.Vector3(0, 0, 0);
        nextPos = new RAPIER.Vector3(0, 0, 0);
        
        // Static body for all fixed geometry
        const staticBodyDesc = RAPIER.RigidBodyDesc.fixed();
        const staticBody = world.createRigidBody(staticBodyDesc);
        
        // Floor plate (DELETED)
        
        // World Floor Boundary
        const floorDesc = RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(384, -0.5, 384);
        world.createCollider(floorDesc, staticBody);
        
        // Outer boundary walls
        const b1Desc = RAPIER.ColliderDesc.cuboid(384, 20, 1).setTranslation(384, 10, 768);
        world.createCollider(b1Desc, staticBody);
        const b2Desc = RAPIER.ColliderDesc.cuboid(384, 20, 1).setTranslation(384, 10, 0);
        world.createCollider(b2Desc, staticBody);
        const b3Desc = RAPIER.ColliderDesc.cuboid(1, 20, 384).setTranslation(768, 10, 384);
        world.createCollider(b3Desc, staticBody);
        const b4Desc = RAPIER.ColliderDesc.cuboid(1, 20, 384).setTranslation(0, 10, 384);
        world.createCollider(b4Desc, staticBody);

        // Actual map buildings from INIT message
        console.log('[MAPSPEC_DIAG] mapSpec exists:', !!mapSpec, 'buildings exists:', !!(mapSpec && (mapSpec as any).buildings), 'buildings length:', mapSpec && (mapSpec as any).buildings ? (mapSpec as any).buildings.length : 'N/A');
        const buildings = e.data.buildings;
        if (buildings && Array.isArray(buildings)) {
            console.log(`[Worker INIT] Loading ${buildings.length} buildings from INIT data...`);
            for (const b of buildings) {
                const sizeX = b.size.x || 10;
                const sizeY = b.size.y || 10;
                const sizeZ = b.size.z || 10;
                const angleRad = b.rotation && b.rotation.y ? (b.rotation.y * Math.PI) / 180 : 0;
                const halfX = sizeX / 2;
                const halfY = sizeY / 2;
                const halfZ = sizeZ / 2;
                const desc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
                    .setTranslation(b.position.x, b.position.y + halfY, b.position.z);
                const bc = world.createCollider(desc, staticBody);
            }
        }

        // Player Setup
        const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(384, 5.0, 10);
        playerBody = world.createRigidBody(bodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.capsule(PLAYER_CAPSULE_HALF_HEIGHT, PLAYER_RADIUS);
        playerCollider = world.createCollider(colliderDesc, playerBody);
        
        console.log("[Worker INIT] Player collider shape:", JSON.stringify({
            halfHeight: playerCollider.halfHeight(),
            radius: playerCollider.radius(),
            translation: playerCollider.translation(),
            isSensor: playerCollider.isSensor(),
            collisionGroups: playerCollider.collisionGroups(),
            solverGroups: playerCollider.solverGroups()
        }));

        kcc = world.createCharacterController(0.01);
        kcc.setUp({ x: 0, y: 1, z: 0 });
        kcc.setApplyImpulsesToDynamicBodies(true);

        if (e.data.sab) {
            sharedData = new Float32Array(e.data.sab);
        } else {
            sharedData = null;
        }

        // Notify ready
        self.postMessage({ type: 'READY' });
    }
    
    if (e.data.type === 'STEP') {
        if (!world) return;
        
        let delta = e.data.delta / 1000;
        if (localPaused) {
            delta = 0;
        } else {
            delta *= localSpeedMultiplier;
        }
        
        accumulator += delta;
        
        if (localStepOnceRequested) {
            accumulator += FIXED_TIMESTEP;
            localStepOnceRequested = false;
        }
        
        while (accumulator >= FIXED_TIMESTEP) {
            let preCubePos = { x: 0, y: 0, z: 0 };
            let preCubeVel = { x: 0, y: 0, z: 0 };
            if (cubeBody && cubeSpawned) {
                const translation = cubeBody.translation();
                preCubePos = { x: translation.x, y: translation.y, z: translation.z };
                const linvel = cubeBody.linvel();
                preCubeVel = { x: linvel.x, y: linvel.y, z: linvel.z };
            }

            world.step();

            if (cubeBody && cubeSpawned) {
                const t = cubeBody.translation();
                const vel = cubeBody.linvel();
                
                if (t.y < -10 && !cubeEvents.some(ev => ev.includes("FELL THROUGH WORLD"))) {
                    cubeEvents.push(`FELL THROUGH WORLD! Pos Y: ${t.y.toFixed(2)}`);
                }
                
                let collidedWith: string[] = [];
                try {
                    const sphereShape = RAPIER.ColliderDesc.ball(0.55).shape;
                    world.intersectionsWithShape(
                        t,
                        { x: 0, y: 0, z: 0, w: 1 },
                        sphereShape,
                        (collider) => {
                            if (collider.handle === cubeCollider?.handle) return true;
                            if (playerCollider && collider.handle === playerCollider.handle) {
                                collidedWith.push("Player");
                                return true;
                            }
                            
                            const colTranslation = collider.translation();
                            if (collider.shapeType() === RAPIER.ShapeType.Cuboid) {
                                if (Math.abs(colTranslation.y - (-0.5)) < 0.1) {
                                    collidedWith.push("Floor");
                                } else {
                                    collidedWith.push("Building");
                                }
                            } else {
                                collidedWith.push("Wall");
                            }
                            return true;
                        }
                    );
                } catch (err) {}
                
                if (collidedWith.length > 0) {
                    if (cubePrevState !== "ground") {
                        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
                        
                        const dy = t.y - preCubePos.y;
                        const expectedFall = localGravityY * (1 / 60);
                        const normalForceCorrectionY = dy - expectedFall;

                        cubeEvents.push(`COLLISION: Touch ${collidedWith.join(", ")}`);
                        cubeEvents.push(`  - Pre-Pos:  (${preCubePos.x.toFixed(3)}, ${preCubePos.y.toFixed(3)}, ${preCubePos.z.toFixed(3)})`);
                        cubeEvents.push(`  - Post-Pos: (${t.x.toFixed(3)}, ${t.y.toFixed(3)}, ${t.z.toFixed(3)})`);
                        cubeEvents.push(`  - Pre-Vel:  (${preCubeVel.x.toFixed(2)}, ${preCubeVel.y.toFixed(2)}, ${preCubeVel.z.toFixed(2)})`);
                        cubeEvents.push(`  - Post-Vel: (${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}, ${vel.z.toFixed(2)})`);
                        cubeEvents.push(`  - Correct:  X: ${(t.x - preCubePos.x).toFixed(4)} | Y: ${normalForceCorrectionY.toFixed(4)} | Z: ${(t.z - preCubePos.z).toFixed(4)}`);
                        
                        cubePrevState = "ground";
                    }
                } else {
                    if (cubePrevState === "ground" && Math.abs(vel.y) > 0.1) {
                        cubeEvents.push(`Left surface, currently in air. Vel Y: ${vel.y.toFixed(2)}`);
                        cubePrevState = "air";
                    }
                }
                
                if (cubeEvents.length > 50) {
                    cubeEvents.splice(0, cubeEvents.length - 50);
                }
            }

            let moveX = 0;
            let moveZ = 0;
            let speed = 0;
            let isJump = false;
            let isCrouch = false;
            let velY = 0;

            if (sharedData) {
                moveX = sharedData[0];
                moveZ = sharedData[1];
                speed = sharedData[2];
                isJump = sharedData[3] > 0;
                isCrouch = sharedData[9] > 0;
                velY = sharedData[4];
            } else {
                moveX = localMoveX;
                moveZ = localMoveZ;
                speed = localSpeed;
                isJump = localIsJump;
                isCrouch = localIsCrouch;
                velY = localVelY;
            }

            velY -= 9.81 * 3.0 * FIXED_TIMESTEP;
            
            // Adjust collider height based on crouch
            if (isCrouch !== lastCrouchState) {
                if (isCrouch) {
                    playerCollider.setHalfHeight(PLAYER_CAPSULE_HALF_HEIGHT_CROUCH);
                } else {
                    playerCollider.setHalfHeight(PLAYER_CAPSULE_HALF_HEIGHT);
                }
                lastCrouchState = isCrouch;
            }
            
            const isGrounded = kcc.computedGrounded();
            if (isGrounded && velY < 0) velY = 0;
            if (isGrounded && isJump) velY = 7.0;
            
            if (sharedData) {
                sharedData[4] = velY;
            } else {
                localVelY = velY;
            }
            
            desiredMovement.x = moveX * speed * FIXED_TIMESTEP;
            desiredMovement.y = velY * FIXED_TIMESTEP;
            desiredMovement.z = moveZ * speed * FIXED_TIMESTEP;
            
            kcc.computeColliderMovement(playerCollider, desiredMovement, undefined, undefined, undefined);

            const computed = kcc.computedMovement();
            const currBodyPos = playerBody.translation();

            nextPos.x = currBodyPos.x + computed.x;
            nextPos.y = currBodyPos.y + computed.y;
            
            nextPos.z = currBodyPos.z + computed.z;
            
            playerBody.setNextKinematicTranslation(nextPos);

            if (sharedData) {
                sharedData[5] = nextPos.x;
                sharedData[6] = nextPos.y;
                sharedData[7] = nextPos.z;
                sharedData[8] = isGrounded ? 1 : 0;
            } else {
                self.postMessage({
                    type: "PLAYER_UPDATE",
                    pos: { x: nextPos.x, y: nextPos.y, z: nextPos.z },
                    grounded: isGrounded
                });
            }
            
            accumulator -= FIXED_TIMESTEP;
        }
        
        const alpha = accumulator / FIXED_TIMESTEP;
        if (sharedData) {
            sharedData[10] = alpha;
        }

        if (cubeBody && cubeSpawned) {
            const t = cubeBody.translation();
            const vel = cubeBody.linvel();
            self.postMessage({
                type: "CUBE_UPDATE",
                pos: { x: t.x, y: t.y, z: t.z },
                vel: { x: vel.x, y: vel.y, z: vel.z },
                events: [...cubeEvents]
            });
        }
    }
    
    if (e.data.type === 'SPAWN_CUBE') {
        const { x, y, z } = e.data;
        if (cubeBody) {
            try {
                world.removeRigidBody(cubeBody);
            } catch (err) {}
        }
        cubeEvents = [];
        cubePrevState = "air";
        cubeSpawned = true;
        
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
        cubeBody = world.createRigidBody(bodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
        cubeCollider = world.createCollider(colliderDesc, cubeBody);
        
        cubeEvents.push(`Spawned dynamic cube at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
        self.postMessage({
            type: "CUBE_UPDATE",
            pos: { x, y, z },
            vel: { x: 0, y: 0, z: 0 },
            events: [...cubeEvents]
        });
    }
    
    if (e.data.type === 'CLEAR_CUBE') {
        if (cubeBody) {
            try {
                world.removeRigidBody(cubeBody);
            } catch (err) {}
            cubeBody = undefined;
            cubeCollider = undefined;
        }
        cubeSpawned = false;
        cubeEvents = [];
        self.postMessage({
            type: "CUBE_CLEARED"
        });
    }
    
    if (e.data.type === 'INPUT') {
        localMoveX = e.data.moveX;
        localMoveZ = e.data.moveZ;
        localSpeed = e.data.speed;
        localIsJump = e.data.jump > 0;
        localIsCrouch = e.data.crouch > 0;
    }
    
    if (e.data.type === 'CORRECT_POS') {
        if (playerBody) {
            playerBody.setNextKinematicTranslation(e.data.pos);
            if (sharedData) {
                sharedData[5] = e.data.pos.x;
                sharedData[6] = e.data.pos.y;
                sharedData[7] = e.data.pos.z;
            }
        }
    }
    
    if (e.data.type === 'SET_PHYSICS_SETTINGS') {
        localGravityY = e.data.gravityY;
        localSpeedMultiplier = e.data.speedMultiplier;
        localPaused = e.data.paused;
        if (world) {
            world.gravity = { x: 0, y: localGravityY, z: 0 };
        }
    }
    
    if (e.data.type === 'STEP_ONCE') {
        localStepOnceRequested = true;
    }
};
