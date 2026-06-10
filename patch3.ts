import fs from 'fs';
let code = fs.readFileSync('server/index.ts', 'utf-8');

const newPackFn = `const packWorldNetworkData = (): ArrayBuffer => {
  payloadWriter.setUint32(0, serverTick, true);
  
  let activeCount = 0;
  for (let i = 0; i < drones.length; i++) {
    if (drones[i].state !== DroneState.DEAD) { activeCount++; }
  }
  payloadWriter.setUint16(4, activeCount, true);
  
  let camCount = 0;
  for (let i = 0; i < cameras.length; i++) {
    if (cameras[i].isActive) { camCount++; }
  }
  payloadWriter.setUint16(6, camCount, true);
  
  let byteOffset = HEADER_SIZE;
  for (let i = 0; i < drones.length; i++) {
    const d = drones[i];
    if (d.state !== DroneState.DEAD) {
      payloadWriter.setUint16(byteOffset, d.id, true);
      payloadWriter.setFloat32(byteOffset + 2, d.posX, true);
      payloadWriter.setFloat32(byteOffset + 6, d.posY, true);
      payloadWriter.setFloat32(byteOffset + 10, d.posZ, true);
      payloadWriter.setFloat32(byteOffset + 14, d.rotX, true);
      payloadWriter.setFloat32(byteOffset + 18, d.rotY, true);
      payloadWriter.setFloat32(byteOffset + 22, d.rotZ, true);
      payloadWriter.setFloat32(byteOffset + 26, d.rotW, true);
      payloadWriter.setUint8(byteOffset + 30, d.state);
      payloadWriter.setUint8(byteOffset + 31, d.type);
      
      byteOffset += DRONE_STRUCT_SIZE;
      if (byteOffset >= TOTAL_STATE_BUFFER_SIZE) { break; }
    }
  }
  
  for (let i = 0; i < cameras.length; i++) {
    const c = cameras[i];
    if (c.isActive) {
      if (byteOffset + CAMERA_STRUCT_SIZE > TOTAL_STATE_BUFFER_SIZE) break;
      payloadWriter.setUint16(byteOffset, c.id, true);
      payloadWriter.setUint8(byteOffset + 2, 1);
      payloadWriter.setUint8(byteOffset + 3, 0); // padding
      byteOffset += CAMERA_STRUCT_SIZE;
    }
  }
  
  return preallocatedBuffer;
};`;

code = code.replace(/const packWorldNetworkData = \(\): ArrayBuffer => \{[\s\S]*?return preallocatedBuffer;\n\};/, newPackFn);

fs.writeFileSync('server/index.ts', code);
console.log('patched packWorldNetworkData');
