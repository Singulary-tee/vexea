# Exhaustive List of Hardcoded Values & Config Bypasses

## 1. Config Fallback Bypasses via `??` (Client-Side)
The codebase uses over 130 fallback values via the `??` operator. These completely bypass the explicit `DRONE_CONFIGS` values if they are undefined, rather than relying on a centralized default.
### `client/screens/dev-entities.ts`
* `visualRadius ?? 1.0`
* `orientationOffset[0] ?? 0.0`, `orientationOffset[1] ?? 0.0`, `orientationOffset[2] ?? 0.0`
* `collider.halfExtents[0] ?? 1.2`, `collider.halfExtents[1] ?? 0.6`, `collider.halfExtents[2] ?? 1.2`
* `collider.radius ?? 0.5`, `collider.halfHeight ?? 1.2`
* `muzzleOffset[0] ?? 0.0`, `muzzleOffset[1] ?? 0.0`, `muzzleOffset[2] ?? 0.8`
* `lightPoints[0][0] ?? -0.5`, `lightPoints[0][1] ?? 0.0`, `lightPoints[0][2] ?? 0.5`
* `lightPoints[1][0] ?? 0.5`, `lightPoints[1][1] ?? 0.0`, `lightPoints[1][2] ?? 0.5`
* `detonationTriggerRadius ?? 4.0`
* `propellerSpinRate ?? 20.0`
* `hoverSwayAmount ?? 0.05`, `hoverSwaySpeed ?? 2.0`
* `verticalBobAmount ?? 0.08`, `verticalBobSpeed ?? 1.5`
* `muzzleFlashScale ?? 1.0`, `firingSoundPitch ?? 1.0`
* `wheelRollSpeed ?? 2.5`, `wheelSteerAngle ?? 0.5`
* `barrelRecoilAmount ?? 0.15`, `recoilDuration ?? 0.08`, `recoilRecoverDuration ?? 0.20`
* `chassisVibration ?? 0.05`, `chassisVibrationSpeed ?? 30.0`
* `turretYawPivotX ?? 0.0`, `turretYawPivotY ?? 0.45`, `turretYawPivotZ ?? -0.1`
* `gunPitchPivotX ?? 0.0`, `gunPitchPivotY ?? 0.65`, `gunPitchPivotZ ?? 0.0`
* `maxRotationSpeed ?? 3.0`, `maxVerticalSpeed ?? 5.0`
* `bankingAngle ?? 0.35`, `minSpeed ?? 10.0`
* `maxTurnRate ?? 1.5`, `pitchAngle ?? 0.35`
* `engagementRange ?? 40.0`, `maxTurnAngle ?? 0.6`, `maxTurnSpeed ?? 3.0`
* `turretRotateAngle ?? 3.14`, `turretGunAngle ?? 0.5`
* `fireCooldown ?? 15`, `detectionRadius ?? 30.0`
* `fovHalfAngle ?? (Math.PI / 4)`
* `decelerationRadius ?? 5.0`
* `propPivotX ?? 0.5`, `propPivotZ ?? 0.5`

### `client/src/systems/DroneProcedural.ts`
* `config.propellerSpinRate ?? 20.0`
* `config.hoverSwayAmount ?? 0.05`
* `config.hoverSwaySpeed ?? 2.0`
* `velocityTiltX = smoothedVelocity.z * 0.05`
* `velocityTiltZ = -smoothedVelocity.x * 0.05`
* `maxPitch = config.pitchAngle ?? 0.35`
* `maxBank = config.bankingAngle ?? 0.35`
* `config.wheelRollSpeed ?? 2.0`
* `config.recoilRecoverDuration ?? 0.20`
* `config.wheelSteerAngle ?? 0.5`
* `yawDelta * 10.0` (Hardcoded steering multiplier)
* `steerAngle + (targetSteer - steerAngle) * 0.1` (Hardcoded steer lerp)
* `yawDiff * 0.1` (Hardcoded turret rotation lerp)
* `config.barrelRecoilAmount ?? 0.15`

## 2. Server-Side Overrides (`server/MatchRoom.ts`)
The server's tick loop actively ignores the values set in `DRONE_CONFIGS` by manually re-assigning them or overriding them via magic numbers.
### Physics & Drone Movement overrides
* **RECON Drone:** `maxSpeed = 15.0`, `maxAccelPerTick = 0.5`
* **BOMBER Drone:** `maxSpeed = 20.0`, `maxAccelPerTick = 0.8`
* **ROTARY_SHOOTER Drone:** `maxSpeed = 10.0`, `maxAccelPerTick = 0.3`
* **FIXED_WING Drone:** `maxSpeed = 25.0`, `maxAccelPerTick = 0.4`
* **WHEELED Drone:** `maxSpeed = 8.0`, `maxAccelPerTick = 0.4`
* **ROBOT_DOG Drone:** `maxSpeed = 10.0`, `maxAccelPerTick = 0.4`
* **HUMANOID Drone:** `maxSpeed = 6.0`, `maxAccelPerTick = 0.4`
* **Fallback AI Speed:** `maxSpeed = 10.0`
* **Fallback AI Accel:** `maxAccelPerTick = 0.4`
* **Drone Terminal Velocity (Gravity):** `desiredVy = -40.0` and `accel = -18.0 * 0.0166`
* **Aim Prediction Speed:** Hardcoded to `shootSpeed = 35.0`
* **Projectile Launch Speed:** `(dirX / len) * 35.0` (Speed locked to 35.0)

### Spawning & Health overrides
* **Drone Base HP:** `d.hp = 100` (Spawns ignore `DRONE_CONFIGS[d.type].hp`)
* **Player Respawn Timer:** `p.respawnTimer = 5.0` (Ignores `ACTIVE_GAMEMODE.respawnDelay`)
* **Player God Mode HP:** Sets to `p.hp = 100` instead of dynamic maximum.
* **Player Base Ammo on Respawn:** `primary.reserve = 120`, `primary.currentMag = 40`
* **Zone Cameras HP:** `this.cameras[i].hp = 50`
* **Zone Cameras Detection Radius:** `detectionRadius = 30`

### Detection & AI Combat overrides
* **Base Detection Distance:** `conf.detectionRadius ?? BASE_DETECTION_DISTANCE`
* **Collision Ray Probes Distance:** `probeDistance = Math.max(3.0, (detectionDistance + 5.0) * 0.75)`
* **Ray Probe Sine/Cosine Angles:** Hardcoded `0.70710678` (sin/cos of 45 degrees)

## 3. Player Movement & Input (`client/src/systems/InputSystem.ts`)
Player movement completely ignores gamemode settings and configuration constants, manually applying fixed modifiers:
* **Base Walk Speed:** `5.5`
* **Sprint Speed:** `15.0`
* **Crouch Speed:** `2.5`
* **Dash Multiplier:** `3.0`
* **Jump Velocity:** `6.0`
* **Gravity Acceleration:** `-20.0 * dt`
* **Dev/Fly Mode Speed:** `10.0` (Walk) and `25.0` (Sprint)
* **Pitch Bounds Clamp:** `Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch))`
* **Mouse Sensitivity Default Lerp:** `-e.movementX * 0.0022 * sensMult`
* **Touch Sensitivity:** `0.003`

## 4. Weapons & Combat Animations (`client/weapons_model.ts` & `client/src/systems/CombatSystem.ts`)
* **Weapon Switch Duration:** `WEAPON_SWITCH_DURATION = 0.4` (400ms)
* **Rifle Offsets:** `hip: (0.025, -0.49, 0.05)`, `ads: (-0.075, -0.42, 0)`, `muzzle: (0, 0, -0.5)`, `adsTilt: -0.05`
* **Pistol Offsets:** `hip: (0.005, -0.16, -0.185)`, `ads: (0, -0.135, -0.06)`, `muzzle: (-0.115, -0.2, -0.2)`
* **Recoil Modifiers (Visual):** `recoilZ + 0.12`, `recoilPitch + upForce * 3.5`, `recoilYaw += (Math.random() - 0.5) * sideForce * 3.0`
* **Recoil Recovery Multiplier:** `recoverySpeed = stats.recoilRecoveryRate * 1.5`
* **Sway Intensity ADS Mod:** `swayIntensity = (1.0 - currentAdsLerp) * stats.swayAmplitude * 2.0`
* **Sway Y Sinusoid Mod:** `swayY = Math.cos(weaponVisualState.swayCycle * 2.0) * swayIntensity * 0.5`
* **Weapon Switch Y Offset:** `-0.4 * Math.sin(progress * Math.PI)`
* **Weapon Walk Animation Timescale:** `isSprinting ? 1.5 : 1.0`
* **Max Upward Visual Recoil Clamp:** `Math.min(0.2, visualRecoilUpOffset + recoilForceUp)`
* **Empty Magazine Click Delay:** `250`ms
* **Visual Weapon Rotation Modifiers:** `rotateX(recoilPitch + (swayY * 1.5))`, `rotateY(-recoilYaw + (swayX * 1.5))`, `rotateZ((-swayX * 4.0) + (adsTilt * currentAdsLerp))`

## 5. Visuals & Post-Processing (`client/src/systems/VisualsSystem.ts`)
Visual constants, shaders, and props lack centralized configs:
* **PointLight Properties:** Default `intensity: 2.5`, `distance: 15`
* **Bloom Thresholds/Multipliers:** `bloomStrength.mul(0.10)`
* **Chromatic Aberration Multiplier:** `chromaticAberrationIntensity.mul(distance).mul(0.01)`
* **Vignette Dist Power:** `float(1.0).sub(dist.mul(uniforms.vignetteIntensity).pow(2.0))`
* **Box Prop Geometry:** Hardcoded `BoxGeometry(1.6, 1.6, 1.6)`
* **Cylinder Prop Geometry:** Hardcoded `CylinderGeometry(0.6, 0.6, 1.8, 12)`
* **Prop Placement Algorithm:** `offsetX = Math.cos(angle) * (sizeX / 2 + 1.5)`
* **Prop Rotation Modifiers:** `mesh.rotation.x = ((seed * 3) % 10) * 0.01`, `mesh.rotation.z = ((seed * 7) % 10) * 0.01`

## 6. Drone Intelligence overrides (`server/ai/DroneIntelligence.ts`)
AI systems implement their own nested configs that ignore global `DRONE_CONFIGS`:
* **ROTARY_SHOOTER:** `sightDistance: 50, visionConeAngle: Math.PI/2, engagementMin: 15, engagementMax: 30`
* **BOMBER:** `sightDistance: 40, visionConeAngle: Math.PI/1.5, engagementMin: 0, engagementMax: 4`
* **RECON:** `sightDistance: 80, visionConeAngle: Math.PI, engagementMin: 40, engagementMax: 70`
* **FIXED_WING:** `sightDistance: 100, visionConeAngle: Math.PI/3, engagementMin: 20, engagementMax: 100`
* **WHEELED:** `sightDistance: 60, visionConeAngle: Math.PI/2, engagementMin: 10, engagementMax: 40`
* **ROBOT_DOG:** `sightDistance: 70, visionConeAngle: Math.PI/2.5, engagementMin: 15, engagementMax: 50`
* **HUMANOID:** `sightDistance: 90, visionConeAngle: Math.PI/3, engagementMin: 20, engagementMax: 60`
* **DECAY_RATE:** `1.0 / 15.0`
* **UNKNOWN_THRESHOLD:** `0.2`
* **Update DeltaTime:** `dt: number = 0.0166`
* **Hitscan timeOfImpact padding:** `hit.timeOfImpact < dist - 0.1`

## 7. UI & Editor Overrides (`client/settings.ts`, `client/ui_editor.ts`)
* **High/Ultra Graphics Presets:** Hardcode presets directly (`bloomStrength = 1.0`, `vignetteIntensity = 0.5`, `chromaticAberrationIntensity = 0.005`, `exposure = 1.0` for Ultra).
* **Minimap Zoom:** `zoomFactor = 2.5`
* **Minimap Object Radius:** `ctx.arc(dx, dz, 4.5, 0, Math.PI * 2)`
* **LLM Commander Unit Cap:** `const MAX_DRONES = 40`
* **Damage Falloff Scaling:** Computed dynamically but relies on hardcoded `calculateDamageWithFalloff` logic bounds (ratio lerp).
* **UI Grid Snap Opacities:** `gridSnapSize < 10 ? 0.04 : 0.1`
