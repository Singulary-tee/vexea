async function checkGLB(name) {
  try {
     const res = await fetch(`https://github.com/Singulary-tee/vexea/releases/download/Asset/${name}`);
     const buffer = await res.arrayBuffer();
     const view = new DataView(buffer);
     const chunk0Len = view.getUint32(12, true);
     const jsonStr = new TextDecoder('utf-8').decode(new Uint8Array(buffer, 20, chunk0Len));
     const json = JSON.parse(jsonStr);
     
     console.log('---', name, '---');
     let parts = 0;
     if (json.nodes) {
        json.nodes.forEach(n => {
           if (n.mesh !== undefined) {
              parts++;
           }
        });
     }
     console.log('Parts length:', parts);
  } catch (e) { }
}
checkGLB('quadcopter_camera.glb').then(() => checkGLB('quadcopter_rifle.glb')).then(() => checkGLB('quadcopter_bomb.glb')).then(() => checkGLB('wheeled_drone.glb')).then(() => checkGLB('fixed_wing_drone.glb'));
