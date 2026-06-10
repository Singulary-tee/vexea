import fs from 'fs';
let code = fs.readFileSync('client/main.ts', 'utf-8');

const newInterpolator = `
        // Dead Reckoning Interpolator
        const droneCounts = [0,0,0,0,0,0,0];
        tempZeroScale.set(0, 0, 0);
        tempZeroPos.set(0, -9999, 0);

        droneJitterMap.forEach((buffer, id) => {
            if (buffer.length < 2) return;
            const latest = buffer[buffer.length - 1];
            if (latest.state === DroneState.DEAD) return;
            
            const targetTime = performance.now() - latency;
            let p0 = buffer[0], p1 = buffer[1];
            for (let i = buffer.length - 1; i >= 1; i--) {
                if (buffer[i].t >= targetTime && buffer[i - 1].t <= targetTime) {
                    p1 = buffer[i]; p0 = buffer[i - 1]; break;
                }
            }

            let t = 1.0;
            if (p1.t > p0.t) t = (targetTime - p0.t) / (p1.t - p0.t);
            t = Math.max(0, Math.min(1, t));

            diagTempPosition.set(
              p0.posX + (p1.posX - p0.posX) * t,
              p0.posY + (p1.posY - p0.posY) * t,
              p0.posZ + (p1.posZ - p0.posZ) * t
            );
            tempQ0.set(p0.rotX, p0.rotY, p0.rotZ, p0.rotW);
            tempQ1.set(p1.rotX, p1.rotY, p1.rotZ, p1.rotW);
            diagTempQuaternion.copy(tempQ0).slerp(tempQ1, t);
            tempScale.set(1, 1, 1);
            
            diagTempMatrix.compose(diagTempPosition, diagTempQuaternion, tempScale);
            
            const typeId = latest.type;
            if (typeId >= 0 && typeId <= 6) {
                const idx = droneCounts[typeId];
                if (idx < 50) {
                    (window as any).droneMeshes[typeId].setMatrixAt(idx, diagTempMatrix);
                    droneCounts[typeId]++;
                }
            }
        });

        // Hide unused instances
        for (let i = 0; i < 7; i++) {
           for (let j = droneCounts[i]; j < 50; j++) {
              diagTempMatrix.compose(tempZeroPos, diagTempQuaternion, tempZeroScale);
              (window as any).droneMeshes[i].setMatrixAt(j, diagTempMatrix);
           }
        }

        // Render cameras
        let camActiveIdx = 0;
        let camDeadIdx = 0;
        if ((window as any).syncCameras) {
            for (let i = 0; i < (window as any).syncCameras.length; i++) {
                const c = (window as any).syncCameras[i];
                diagTempPosition.set(c.id < ZONES_ARRAY.length ? WAYPOINTS[ZONES_ARRAY[c.id]].x : 0, 8, c.id < ZONES_ARRAY.length ? WAYPOINTS[ZONES_ARRAY[c.id]].z : 0);
                diagTempQuaternion.set(0, 0, 0, 1);
                tempScale.set(1, 1, 1);
                diagTempMatrix.compose(diagTempPosition, diagTempQuaternion, tempScale);
                
                if (c.isActive) {
                    if (camActiveIdx < 50) {
                       (window as any).camActiveMesh.setMatrixAt(camActiveIdx, diagTempMatrix);
                       camActiveIdx++;
                    }
                } else {
                    if (camDeadIdx < 50) {
                       (window as any).camDeadMesh.setMatrixAt(camDeadIdx, diagTempMatrix);
                       camDeadIdx++;
                    }
                }
            }
        }
        
        for (let j = camActiveIdx; j < 50; j++) {
           diagTempMatrix.compose(tempZeroPos, diagTempQuaternion, tempZeroScale);
           (window as any).camActiveMesh.setMatrixAt(j, diagTempMatrix);
        }
        for (let j = camDeadIdx; j < 50; j++) {
           diagTempMatrix.compose(tempZeroPos, diagTempQuaternion, tempZeroScale);
           (window as any).camDeadMesh.setMatrixAt(j, diagTempMatrix);
        }

        // 4. Weapon Position Sync`;

code = code.replace(/\/\/ 4\. Weapon Position Sync/, newInterpolator);

fs.writeFileSync('client/main.ts', code);
console.log('patched interpolator');
