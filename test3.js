import * as THREE from 'three';
const mesh = new THREE.BatchedMesh(10, 100, 100, new THREE.MeshBasicMaterial());
console.log(typeof mesh.setMatrixAt);
console.log(typeof mesh.setGeometryAt);
console.log("Keys:", Object.keys(mesh));
