const RAPIER = require('@dimforge/rapier3d-compat');

async function test() {
  await RAPIER.init();
  const world = new RAPIER.World({x:0, y:-9.81, z:0});
  
  // Create player kinematic
  const pDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0);
  const pBody = world.createRigidBody(pDesc);
  const pColDesc = RAPIER.ColliderDesc.capsule(0.5, 0.4);
  const pCol = world.createCollider(pColDesc, pBody);
  const pKcc = world.createCharacterController(0.01);
  
  // Create drone kinematic
  const dDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(2, 0, 0);
  const dBody = world.createRigidBody(dDesc);
  const dColDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
  const dCol = world.createCollider(dColDesc, dBody);
  
  world.step();

  // Try to move player into drone
  pKcc.computeColliderMovement(pCol, {x: 5, y: 0, z: 0}, undefined, undefined, undefined);
  console.log("With undefined flags, collision:", pKcc.computedCollision(0) !== null);

  pKcc.computeColliderMovement(pCol, {x: 5, y: 0, z: 0}, 0, undefined, undefined);
  console.log("With 0 flags, collision:", pKcc.computedCollision(0) !== null);
  
  // Create static body
  const sDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(2, 0, 0);
  const sBody = world.createRigidBody(sDesc);
  const sColDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
  const sCol = world.createCollider(sColDesc, sBody);
  
  world.step();

  pKcc.computeColliderMovement(pCol, {x: 5, y: 0, z: 0}, undefined, undefined, undefined);
  console.log("Against static, undefined flags, collision:", pKcc.computedCollision(0) !== null);
  
  pKcc.computeColliderMovement(pCol, {x: 5, y: 0, z: 0}, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined);
  console.log("Against static, EXCLUDE_SENSORS, collision:", pKcc.computedCollision(0) !== null);
}
test();
