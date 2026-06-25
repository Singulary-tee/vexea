import RAPIER from "@dimforge/rapier3d-compat";
import mapSpec from "../shared/maps/map_1_facility.spec.json";

let world: RAPIER.World;
let kcc: RAPIER.KinematicCharacterController;
let playerBody: RAPIER.RigidBody;
let playerCollider: RAPIER.Collider;

let sharedData: Float32Array;

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
        
        // Floor plate
        const floorDesc = RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0);
        world.createCollider(floorDesc);
        
        // Outer boundary walls
        world.createCollider(RAPIER.ColliderDesc.cuboid(100, 20, 1).setTranslation(0, 10, 100));
        world.createCollider(RAPIER.ColliderDesc.cuboid(100, 20, 1).setTranslation(0, 10, -100));
        world.createCollider(RAPIER.ColliderDesc.cuboid(1, 20, 100).setTranslation(100, 10, 0));
        world.createCollider(RAPIER.ColliderDesc.cuboid(1, 20, 100).setTranslation(-100, 10, 0));

        // Pillars & Crates
        // world.createCollider(RAPIER.ColliderDesc.cylinder(4, 6).setTranslation(0, 3, 0));
        // world.createCollider(RAPIER.ColliderDesc.cuboid(5, 4, 1).setTranslation(-15, 2, -15));
        // world.createCollider(RAPIER.ColliderDesc.cuboid(5, 4, 1).setTranslation(15, 2, -15));
        // world.createCollider(RAPIER.ColliderDesc.cuboid(4, 4, 4).setTranslation(35, 2, 20));
        // world.createCollider(RAPIER.ColliderDesc.cuboid(3, 3, 3).setTranslation(45, 1.5, 35));
        // world.createCollider(RAPIER.ColliderDesc.cuboid(12, 5, 1).setTranslation(30, 2.5, -20));

        // Actual map buildings
        if (mapSpec && mapSpec.buildings) {
            for (const b of mapSpec.buildings) {
                let sizeX = b.size.x || 10;
                let sizeZ = b.size.z || 10;
                const angleRad = b.rotation && b.rotation.y ? (b.rotation.y * Math.PI) / 180 : 0;
                if (Math.abs(Math.sin(angleRad)) > 0.707) {
                    const temp = sizeX;
                    sizeX = sizeZ;
                    sizeZ = temp;
                }
                const halfX = sizeX / 2;
                const halfY = (b.size.y || 10) / 2;
                const halfZ = sizeZ / 2;
                const desc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
                    .setTranslation(b.position.x, b.position.y + halfY, b.position.z);
                world.createCollider(desc);
            }
        }

        // Player Setup
        const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.2, 10);
        playerBody = world.createRigidBody(bodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.3);
        playerCollider = world.createCollider(colliderDesc, playerBody);
        
        kcc = world.createCharacterController(0.01);
        kcc.setUp({ x: 0, y: 1, z: 0 });
        kcc.setApplyImpulsesToDynamicBodies(true);

        sharedData = new Float32Array(e.data.sab);

        // Notify ready
        self.postMessage({ type: 'READY' });

        // Fixed 60Hz loop
        setInterval(() => {
            const moveX = sharedData[0];
            const moveZ = sharedData[1];
            const speed = sharedData[2];
            const isJump = sharedData[3] > 0;
            const isCrouch = sharedData[9] > 0;

            let velY = sharedData[4];
            velY -= 9.81 * 3.0 * 0.0166;
            
            // Adjust collider height based on crouch
            if (isCrouch) {
                playerCollider.setHalfHeight(0.25);
            } else {
                playerCollider.setHalfHeight(0.5);
            }
            
            const isGrounded = kcc.computedGrounded();
            if (isGrounded && velY < 0) velY = -0.1;
            if (isGrounded && isJump) velY = 8.0;
            
            sharedData[4] = velY;
            
            kcc.computeColliderMovement(playerCollider, {
                x: moveX * speed * 0.0166,
                y: velY * 0.0166,
                z: moveZ * speed * 0.0166
            });

            const computed = kcc.computedMovement();
            const currPos = playerBody.translation();
            const nextPos = {
                x: currPos.x + computed.x,
                y: currPos.y + computed.y,
                z: currPos.z + computed.z
            };
            playerBody.setNextKinematicTranslation(nextPos);
            world.step();

            const finalPos = playerBody.translation();
            sharedData[5] = finalPos.x;
            sharedData[6] = finalPos.y;
            sharedData[7] = finalPos.z;
            sharedData[8] = isGrounded ? 1 : 0;
            
            if (moveZ !== 0) {
               console.log("[Worker] Moving! finalPos.z:", finalPos.z, "moveZ:", moveZ, "computed.z:", computed.z);
            }
            
        }, 16.66);
    }
    
    if (e.data.type === 'CORRECT_POS') {
        if (playerBody) {
            playerBody.setNextKinematicTranslation(e.data.pos);
            sharedData[5] = e.data.pos.x;
            sharedData[6] = e.data.pos.y;
            sharedData[7] = e.data.pos.z;
        }
    }
};
