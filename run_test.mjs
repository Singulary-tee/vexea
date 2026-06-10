import { spawn } from 'child_process';
import { chromium } from 'playwright';

(async () => {
    console.log("Starting server...");
    const serverProcess = spawn('npm', ['run', 'dev']);
    serverProcess.stdout.on('data', data => {
        const text = data.toString();
        process.stdout.write(`[SERVER_OUT] ${text}`);
    });
    serverProcess.stderr.on('data', data => {
        const text = data.toString();
        process.stdout.write(`[SERVER_ERR] ${text}`);
    });

    console.log("Waiting 5 seconds for server to start...");
    await new Promise(r => setTimeout(r, 5000));

    console.log("Launching browser...");
    const browser = await chromium.launch();
    const page = await browser.newPage();

    page.on('console', msg => {
        const text = msg.text();
        console.log(`[CLIENT] ${text}`);
    });

    console.log("Navigating to http://localhost:3000 ...");
    await page.goto('http://localhost:3000', { waitUntil: 'load' });
    
    console.log("Waiting 5 seconds for WebGL init and geckos connect...");
    await new Promise(r => setTimeout(r, 5000));
    
    console.log("Spawning drone...");
    await page.evaluate(() => {
        window.gameState = "ACTIVE_MATCH"; // force render loop
        if (window.spawnDevDrone) {
            window.spawnDevDrone(2);
        }
    });

    console.log("Waiting 3 seconds for logs...");
    await new Promise(r => setTimeout(r, 3000));

    await browser.close();
    serverProcess.kill();
    console.log("Done.");
    process.exit(0);
})();
