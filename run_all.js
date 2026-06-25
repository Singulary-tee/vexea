const { spawn, execSync } = require('child_process');

console.log("Starting server...");
const server = spawn('npm', ['run', 'dev'], { stdio: 'inherit' });

setTimeout(() => {
  console.log("Running test...");
  try {
    execSync('npx playwright test tests/collision_player_building.spec.ts', { stdio: 'inherit' });
  } catch (err) {
    console.log("Test failed!");
  }
  server.kill();
  process.exit(0);
}, 15000);
