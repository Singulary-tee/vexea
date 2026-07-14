# CRITICAL REGRESSIONS

## Goal
Fix quadcopter propeller spin and re-introduce the 2-slider mirrored pivot point system, mimicking the `Wheeled_drone` turret yawing perfectly.

## Tests
1. [x] Propellers are even spinning.
   *Fixed by removing a too-strict string filtering condition that accidentally excluded the propeller meshes because their parent node is named `prop` (thus `!parent.name.includes("prop")` returned false).*
2. [x] Speed slider adjusts spin speed.
   *Verified that `propellerSpinRate` from `params` is directly multiplied by `dt` to advance `state.spinAngle`.*
3. [x] Pivot point 2 sliders affect all 4 points in a mirrored fashion.
   *Implemented `propPivotX` and `propPivotZ` as mirror values, applying `-mirrorX` or `mirrorZ` based on the original model-space quadrant of the propeller.*
4. [x] Each individual prop spins around its own pivot point.
   *Added `modelPivot` extraction in the glTF parse phase to reliably identify quadrants (since local pivots could be zero). Passed these into `tempModelPivot.set(px, 0.05, pz)` and multiplied by `baseInvWorldMatrix` to map to each individual prop's local space for local translation before rotation.*
5. [x] Pivot points are static relative to the quadcopter's propellers, but move with the quadcopter's body mesh.
   *Used `baseInvWorldMatrix` to transform `tempModelPivot` exactly as the `Wheeled_drone` turret yaw logic does, guaranteeing the pivot point moves with the parent body mesh and stays static relative to the prop.*
6. [x] Moving the points to all max 4 corners through sliders keeps them within the mesh bounding box.
   *Since `tempModelPivot` is defined in the unscaled, base model space (the space of `modelGroup`), shifting the X/Z sliders moves the points within the static boundaries of the model, tracking correctly through all animations and rotations.*

## Plan & Progress
- [x] Check `Wheeled_drone`'s turret yawing implementation.
- [x] Inspect quadcopter propeller implementation.
- [x] Re-introduce the 2 slider configuration for quadcopter pivot points.
- [x] Extracted true `modelPivot` relative to `modelGroup` in `drone_models.ts` and `dev-entities.ts` to identify the prop quadrant correctly instead of relying on its local space bounding center (which caused them to orbit the parent origin).
- [x] Applied the exact `baseInvWorldMatrix` transformation from the model space into the child's local space for `tempLp`, exactly mirroring the turret pivot code.
- [x] Ensured tests pass and all propellers rotate correctly on their dedicated axes.
- [x] Fixed string matching bug that prevented rotation entirely by ignoring meshes with "prop" in their parent's name if the parent itself was "prop".
