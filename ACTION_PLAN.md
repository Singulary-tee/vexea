# Proposed Action Plan

## 1. Fix Model Loading & Pivot Baking (`/client/drone_models.ts`)
- Update `initDroneModels` to apply `scaleFactor` to the model hierarchy before computing `localPivot` and `baseInvWorldMatrix` for all nodes.
- Fall back to `propPivotX`/`propPivotZ` if `propellerOffset` is not specified.

## 2. Fix Match Node Rotation & Turret Kinematics (`/client/src/systems/DroneSystem.ts`)
- Store `baseWorldMatrix` in `nodesInfo` during batch creation.
- Update `DroneSystem.ts` turret yaw and gun pitch pivot calculations to apply `baseWorldMatrix` prior to `baseInvWorldMatrix`.

## 3. Harmonize Procedural Animations (`/client/src/systems/DroneProcedural.ts`)
- Implement `verticalBobAmount` and `verticalBobSpeed` handling for quadcopters in `updateProceduralState`.
- Support two-phase recoil (`recoilDuration` kick + `recoilRecoverDuration` recovery).
- Implement banking and pitch roll transforms for fixed-wing and flying drones in `updateProceduralState` and `applyNodeRotation`.
