import fs from 'fs';
const code = fs.readFileSync('server/index.ts', 'utf-8');

const newCode = code.replace(
/const updateSystemEntities = \(\) => \{[\s\S]*?recordDroneHistory\(\);\n\};/,
`// CAMERAS
interface ServerCamera {
  id: number; posX: number; posY: number; posZ: number; rotY: number; isActive: boolean; hp: number; detectionRadius: number; cooldown: number;
}
const cameras: ServerCamera[] = [];
for (let i = 0; i < 20; i++) {
  cameras.push({ id: i, posX: 0, posY: 5, posZ: 0, rotY: 0, isActive: false, hp: 0, detectionRadius: 30, cooldown: 0 });
}
for (let i = 0; i < ZONES_ARRAY.length; i++) {
  cameras[i].isActive = true; cameras[i].hp = 50; 
  cameras[i].posX = WAYPOINTS[ZONES_ARRAY[i]].x; cameras[i].posY = 8; cameras[i].posZ = WAYPOINTS[ZONES_ARRAY[i]].z;
}

const updateSystemEntities = () => {
  serverTick++;
  
  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i];
    if (p.active) {
      p.posX += p.velX * 0.1666; p.posY += p.velY * 0.1666; p.posZ += p.velZ * 0.1666;
      p.life--;
      if (p.life <= 0 || Math.abs(p.posX) > 100 || Math.abs(p.posZ) > 100 || p.posY < 0) { p.active = false; continue; }
      if (p.isEnemy) {
        for (const player of players.values()) {
          const dx = player.posX - p.posX; const dy = player.posY - p.posY; const dz = player.posZ - p.posZ;
          if (dx*dx+dy*dy+dz*dz < 2.25) {
            player.hp -= p.damage; p.active = false;
            broadcastReliableEvent({ type: "player_damaged", id: player.id, value: player.hp });
            if (player.hp <= 0) {
              player.hp = 0; broadcastReliableEvent({ type: "match_over", id: player.id });
              const info = players.get(player.id);
              if (info) processMatchEndTransaction(player.id, info.score, info.adMultiplier || 1);
            }
            break;
          }
        }
      } else {
        for (let j = 0; j < drones.length; j++) {
          const d = drones[j];
          if (d.state !== DroneState.DEAD) {
            const dx = d.posX - p.posX; const dy = d.posY - p.posY; const dz = d.posZ - p.posZ;
            if (dx*dx+dy*dy+dz*dz < (d.rad * d.rad)) {
              d.hp -= p.damage; p.active = false;
              if (d.hp <= 0) { d.state = DroneState.DEAD; broadcastReliableEvent({ type: "drone_killed", id: d.id, zone: d.zone }); }
              break;
            }
          }
        }
        if(p.active) {
           for (let j = 0; j < cameras.length; j++) {
              if (cameras[j].isActive) {
                 const dx = cameras[j].posX - p.posX; const dy = cameras[j].posY - p.posY; const dz = cameras[j].posZ - p.posZ;
                 if (dx*dx+dy*dy+dz*dz < 4) {
                    cameras[j].hp -= p.damage; p.active = false;
                    if (cameras[j].hp <= 0) cameras[j].isActive = false;
                    break;
                 }
              }
           }
        }
      }
    }
  }

  let targetPlayer: PlayerState | null = null;
  for (const p of players.values()) { targetPlayer = p; break; }

  const nowMs = Date.now();
  for (const zoneId of ZONES_ARRAY) { zoneSummary[zoneId].droneGroups.length = 0; }
  for (let i = 0; i < drones.length; i++) {
    const d = drones[i];
    if (d.state !== DroneState.DEAD) {
      if (!zoneSummary[d.zone].droneGroups.includes(d.groupId)) { zoneSummary[d.zone].droneGroups.push(d.groupId); }
    }
  }

  if (targetPlayer) {
    let playerZone: ZoneName = ZONES.CORE;
    for (const zoneId of ZONES_ARRAY) {
      const b = ZONE_BOUNDS[zoneId];
      const dx = Math.abs(targetPlayer.posX - b.center.x); const dy = Math.abs(targetPlayer.posY - b.center.y); const dz = Math.abs(targetPlayer.posZ - b.center.z);
      if (dx <= b.halfSize.x && dy <= b.halfSize.y && dz <= b.halfSize.z) { playerZone = zoneId; break; }
    }

    let detectedZones = new Set<ZoneName>();
    
    // Check LOS from any drone
    for (let i = 0; i < drones.length; i++) {
      const d = drones[i];
      if (d.state !== DroneState.DEAD && d.zone === playerZone && d.type !== DroneType.BOMBER && d.type !== DroneType.FIXED_WING) {
         const dx = targetPlayer.posX - d.posX; const dy = targetPlayer.posY - d.posY; const dz = targetPlayer.posZ - d.posZ;
         if (dx*dx+dy*dy+dz*dz < 900) { detectedZones.add(playerZone); break; }
      }
    }

    // CHECK CAMERAS
    for (let c = 0; c < cameras.length; c++) {
      if (cameras[c].isActive) {
         const dx = targetPlayer.posX - cameras[c].posX; const dy = targetPlayer.posY - cameras[c].posY; const dz = targetPlayer.posZ - cameras[c].posZ;
         if (dx*dx+dy*dy+dz*dz < cameras[c].detectionRadius * cameras[c].detectionRadius) {
            let hasLOS = true;
            if (rapierWorld) {
              const rayDir = { x: targetPlayer.posX - cameras[c].posX, y: targetPlayer.posY - cameras[c].posY, z: targetPlayer.posZ - cameras[c].posZ };
              const len = Math.sqrt(rayDir.x*rayDir.x + rayDir.y*rayDir.y + rayDir.z*rayDir.z);
              if (len > 0) {
                 rayDir.x /= len; rayDir.y /= len; rayDir.z /= len;
                 const ray = new RAPIER.Ray({x: cameras[c].posX, y: cameras[c].posY, z: cameras[c].posZ}, rayDir);
                 const hit = rapierWorld.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
                 if (hit && hit.collider) hasLOS = false;
              }
            }
            if (hasLOS) detectedZones.add(playerZone);
         }
      }
    }

    if (targetPlayer.firedThisTick) {
      detectedZones.add(playerZone);
      for (const adj of TOPOLOGY[playerZone] || []) { detectedZones.add(adj); }
      targetPlayer.firedThisTick = false;
    }

    for (const zoneId of ZONES_ARRAY) {
       const z = zoneSummary[zoneId];
       if (detectedZones.has(zoneId)) {
         z.playerPresence = "confirmed"; z.lastSeenTimestamp = nowMs;
       } else {
         const elapsed = nowMs - z.lastSeenTimestamp;
         if (z.playerPresence === "confirmed" && elapsed >= 30000) { z.playerPresence = "last_seen"; } 
         else if ((z.playerPresence === "confirmed" || z.playerPresence === "last_seen") && elapsed >= 60000) { z.playerPresence = "unknown"; }
         
         // Recon drone never drops zone to unknown
         for (let i = 0; i < drones.length; i++) {
           if (drones[i].state !== DroneState.DEAD && drones[i].type === DroneType.RECON && drones[i].zone === zoneId) {
             if (z.playerPresence !== "confirmed") z.playerPresence = "confirmed";
           }
         }
       }
    }
  }

  for (let i = 0; i < drones.length; i++) {
    const d = drones[i];
    if (d.state === DroneState.DEAD) continue;

    if (d.state === DroneState.IDLE) {
      d.cooldown--;
      if (d.cooldown <= 0) { d.state = DroneState.PATROLLING; }
      continue;
    }

    let finalTargetX = WAYPOINTS[d.zone].x; let finalTargetY = WAYPOINTS[d.zone].y; let finalTargetZ = WAYPOINTS[d.zone].z;
    const isGround = d.type === DroneType.WHEELED || d.type === DroneType.ROBOT_DOG || d.type === DroneType.HUMANOID;
    
    if (targetPlayer) {
      const dx = targetPlayer.posX - d.posX; const dy = targetPlayer.posY - d.posY; const dz = targetPlayer.posZ - d.posZ;
      const rsq = dx*dx + dy*dy + dz*dz;
      
      const fireDist = 625.0; // 25 units
      let withinFireDist = rsq < fireDist;

      if (d.type === DroneType.BOMBER && rsq < 4.0) {
         // Detonate
         targetPlayer.hp -= 80;
         d.state = DroneState.DEAD;
         broadcastReliableEvent({ type: "player_damaged", id: targetPlayer.id, value: targetPlayer.hp });
         continue;
      }
      
      if (d.type === DroneType.RECON) {
         // Erratic evasion/pursuit
         d.state = DroneState.PURSUING;
         finalTargetX = targetPlayer.posX + (Math.random() - 0.5) * 40;
         finalTargetY = targetPlayer.posY + 15;
         finalTargetZ = targetPlayer.posZ + (Math.random() - 0.5) * 40;
      } else if (d.type === DroneType.FIXED_WING) {
         // Arc movement
         d.state = DroneState.PURSUING;
         const time = serverTick * 0.05;
         finalTargetX = targetPlayer.posX + Math.cos(time) * 30;
         finalTargetY = targetPlayer.posY + 20;
         finalTargetZ = targetPlayer.posZ + Math.sin(time) * 30;
         if (rsq < 400 && d.cooldown <= 0) { withinFireDist = true; } // strafe
      } else if (d.type === DroneType.HUMANOID) {
         // Uses cover logic - pathfinds to nearest static geometry. But for zero-allocation, just holds distance.
         d.state = DroneState.PURSUING;
         finalTargetX = targetPlayer.posX + (d.posX - targetPlayer.posX)*0.3; 
         finalTargetY = d.posY;
         finalTargetZ = targetPlayer.posZ + (d.posZ - targetPlayer.posZ)*0.3;
      } else if (rsq < 9.0) { 
        d.state = DroneState.PURSUING; 
        finalTargetX = d.posX; finalTargetY = d.posY; finalTargetZ = d.posZ;
      } else if (withinFireDist) {
        d.state = DroneState.PURSUING;
        finalTargetX = targetPlayer.posX; finalTargetY = targetPlayer.posY; finalTargetZ = targetPlayer.posZ;
      } else {
        d.state = DroneState.PATROLLING;
      }

      if ((d.state === DroneState.PURSUING || d.state === DroneState.ATTACKING) && d.cooldown <= 0 && d.type !== DroneType.RECON && d.type !== DroneType.BOMBER && withinFireDist) {
        const shootSpeed = 35.0; const MathSQRT = Math.sqrt(rsq);
        const aimX = targetPlayer.posX + targetPlayer.velEmaX * (MathSQRT / shootSpeed);
        const aimY = targetPlayer.posY + targetPlayer.velEmaY * (MathSQRT / shootSpeed);
        const aimZ = targetPlayer.posZ + targetPlayer.velEmaZ * (MathSQRT / shootSpeed);
        
        let hasLOS = true;
        if (rapierWorld) {
          const rayStart = { x: d.posX, y: d.posY + 0.5, z: d.posZ };
          const rayDir = { x: aimX - d.posX, y: aimY - (d.posY + 0.5), z: aimZ - d.posZ };
          const len = Math.sqrt(rayDir.x*rayDir.x + rayDir.y*rayDir.y + rayDir.z*rayDir.z);
          if (len > 0) {
            rayDir.x /= len; rayDir.y /= len; rayDir.z /= len;
            const ray = new RAPIER.Ray(rayStart, rayDir);
            const hit = rapierWorld.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
            if (hit && hit.collider) hasLOS = false;
          }
        }
        if (hasLOS) {
          d.state = DroneState.ATTACKING;
          spawnServerProjectile(d.posX, d.posY + 0.5, d.posZ, aimX - d.posX, aimY - (d.posY + 0.5), aimZ - d.posZ, true, 10);
          d.cooldown = d.type === DroneType.HUMANOID ? 40 : 20; 
        } else {
          d.cooldown = 15;
        }
      }
    }

    if (d.state === DroneState.PATROLLING || d.state === DroneState.REPOSITIONING) {
      if (d.path.length > 0) {
        d.zone = d.path[d.pathIndex];
        const subWaypoint = WAYPOINTS[d.zone];
        const wx = subWaypoint.x - d.posX; const wz = subWaypoint.z - d.posZ;
        if (wx*wx + wz*wz < 9.0) { d.pathIndex = Math.min(d.pathIndex + 1, d.path.length - 1); }
        const wp = WAYPOINTS[d.path[d.pathIndex]];
        finalTargetX = wp.x; finalTargetY = wp.y; finalTargetZ = wp.z;
      }
    }

    computeVelocityObstacleSteering(d, finalTargetX, finalTargetY, finalTargetZ);
    if (d.cooldown > 0) d.cooldown--;
    
    // Bomber flies perfectly straight
    if (d.type === DroneType.BOMBER && targetPlayer) {
       const dx = targetPlayer.posX - d.posX; const dy = targetPlayer.posY - d.posY; const dz = targetPlayer.posZ - d.posZ;
       const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
       if (len > 0.01) { d.velX = (dx/len)*15; d.velY = (dy/len)*15; d.velZ = (dz/len)*15; }
    }

    d.posX += d.velX * 0.0166; d.posY += d.velY * 0.0166; d.posZ += d.velZ * 0.0166;
    
    const movementHeading = Math.atan2(d.velX, d.velZ);
    d.rotY = Math.sin(movementHeading * 0.5); d.rotW = Math.cos(movementHeading * 0.5); d.rotX = 0; d.rotZ = 0;
  }
  recordDroneHistory();
};
`
);
fs.writeFileSync('server/index.ts', newCode);
console.log('patched updateSystemEntities');
