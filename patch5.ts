import fs from 'fs';
let code = fs.readFileSync('client/main.ts', 'utf-8');

const newParser = `
    currentTick = view.getUint32(0, true);
    const count = view.getUint16(4, true);
    const camCount = view.getUint16(6, true);
    
    let byteOffset = HEADER_SIZE;
    const now = performance.now();

    for (let i = 0; i < count; i++) {
      const id = view.getUint16(byteOffset, true);
      const px = view.getFloat32(byteOffset + 2, true);
      const py = view.getFloat32(byteOffset + 6, true);
      const pz = view.getFloat32(byteOffset + 10, true);
      const rx = view.getFloat32(byteOffset + 14, true);
      const ry = view.getFloat32(byteOffset + 18, true);
      const rz = view.getFloat32(byteOffset + 22, true);
      const rw = view.getFloat32(byteOffset + 26, true);
      const state = view.getUint8(byteOffset + 30);
      const type = view.getUint8(byteOffset + 31);

      if (!droneJitterMap.has(id)) {
        droneJitterMap.set(id, []);
      }
      const jitterBuffer = droneJitterMap.get(id);
      if (jitterBuffer) {
        jitterBuffer.push({
          t: now, posX: px, posY: py, posZ: pz,
          rotX: rx, rotY: ry, rotZ: rz, rotW: rw,
          state, type
        });
        if (jitterBuffer.length > 10) jitterBuffer.shift();
      }
      byteOffset += DRONE_STRUCT_SIZE;
    }
    
    // Parse cameras
    (window as any).syncCameras = [];
    for (let c = 0; c < camCount; c++) {
      const camId = view.getUint16(byteOffset, true);
      const isActive = view.getUint8(byteOffset + 2) === 1;
      (window as any).syncCameras.push({ id: camId, isActive });
      byteOffset += 4; // CAMERA_STRUCT_SIZE
    }
`;

code = code.replace(
  /currentTick = view\.getUint32\(0, true\);[\s\S]*?\}\n    \}/,
  newParser + '\n  });'
);

fs.writeFileSync('client/main.ts', code);
console.log('patched parser');
