Drone Fix Ledger

Starting State

Test runs: 0
Last result: NONE

Initial Test

Output:
[CLIENT] Failed to load drone model: animated_drone.glb
--- TEST RESULTS ---
❌ [FAIL] Drone Batch System: Array exists
❌ [FAIL] Rendering Test Exception: Cannot read properties of undefined (reading 'length')
❌ [FAIL] Rotation Test Exception: Cannot read properties of undefined (reading '0')
--------------------
[CLIENT] Drone models parsed, generating batches...
[CLIENT] Drone models batched completely.

Result: FAIL

Attempt 1

Theory: BatchedMesh instances for drones are updated in the render loop using setMatrixAt, but the instanceMatrix.needsUpdate flag is never set to true. This prevents the Three.js WebGPU/WebGL renderer from uploading the updated matrix buffer to the GPU, causing drones to be invisible or stuck at their initial/fallback positions.
Change: Edit client/main.ts to set batch.mesh.instanceMatrix.needsUpdate = true for each drone batch after the update loop.
Status: PASS

Result: PASS
Output:
--- TEST RESULTS ---
✅ [PASS] Drone Batch System: Array exists
✅ [PASS] Drone Batch System: Minimum types initialized
✅ [PASS] Batch 0: Is valid THREE.BatchedMesh
✅ [PASS] Batch 0: Materials/Textures assigned
✅ [PASS] Batch 1: Is valid THREE.BatchedMesh
✅ [PASS] Batch 1: Materials/Textures assigned
✅ [PASS] Batch 2: Is valid THREE.BatchedMesh
✅ [PASS] Batch 2: Materials/Textures assigned
✅ [PASS] Batch 3: Is valid THREE.BatchedMesh
✅ [PASS] Batch 3: Materials/Textures assigned
✅ [PASS] Batch 4: Is valid THREE.BatchedMesh
✅ [PASS] Batch 4: Materials/Textures assigned
✅ [PASS] Batch 5: Is valid THREE.BatchedMesh
✅ [PASS] Batch 5: Materials/Textures assigned
✅ [PASS] Batch 6: Is valid THREE.BatchedMesh
✅ [PASS] Batch 6: Materials/Textures assigned
✅ [PASS] Rotation: Instance group mapping is valid
--------------------
