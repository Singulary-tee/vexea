import { chromium } from 'playwright';
import { spawn } from 'child_process';

(async () => {
    console.log("[TEST] Starting server...");
    const serverProcess = spawn('npm', ['run', 'dev']);
    serverProcess.stdout.on('data', () => {}); // silence server logs unless needed
    
    // give server time to start
    await new Promise(r => setTimeout(r, 4000));

    console.log("[TEST] Launching browser...");
    const browser = await chromium.launch();
    const page = await browser.newPage();

    let logs = [];
    page.on('console', msg => {
        logs.push(msg.text());
        console.log(`[CLIENT LOG] ${msg.text()}`);
    });

    console.log("[TEST] Navigating to game...");
    await page.goto('http://localhost:3000', { waitUntil: 'load' });
    
    // Wait for game to load
    await new Promise(r => setTimeout(r, 6000));

    console.log("[TEST] Forcing game active...");
    await page.evaluate(() => {
        window.gameState = "ACTIVE_MATCH";
    });

    // Wait a bit
    await new Promise(r => setTimeout(r, 2000));

    console.log("[TEST] Evaluating Weapons...");
    const report = await page.evaluate(async () => {
        const res = {};
        const cam = window.camera;
        let wepContainer = window.weaponsContainer;
        
        if (!wepContainer && window.initPlayerWeapons) {
            try {
                wepContainer = window.initPlayerWeapons(window.scene, window.camera);
                window.weaponsContainer = wepContainer;
            } catch(e) {
                return { error: "initPlayerWeapons threw an error: " + e.message, stack: e.stack };
            }
        }

        if (!cam || !wepContainer) {
            const keys = Object.keys(window).filter(k => k.toLowerCase().includes('weapon') || k.toLowerCase().includes('cam') || k.includes('__STAGE'));
            return { error: "Objects missing", "cam": !!cam, "wepContainer": !!wepContainer, keys };
        }

        res.camPos = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
        res.wepPos = { x: wepContainer.position.x, y: wepContainer.position.y, z: wepContainer.position.z };
        res.camRot = { x: cam.rotation.x, y: cam.rotation.y, z: cam.rotation.z };
        res.wepRot = { x: wepContainer.rotation.x, y: wepContainer.rotation.y, z: wepContainer.rotation.z };

        // Test Muzzle flash positions
        if (window.triggerFlash) {
            window.triggerFlash();
            res.flashPos = window.flashMesh ? { x: window.flashMesh.position.x, y: window.flashMesh.position.y, z: window.flashMesh.position.z } : null;
        }

        return res;
    });

    console.log("[TEST RESULTS]");
    console.log(JSON.stringify(report, null, 2));

    await browser.close();
    serverProcess.kill();
    process.exit(0);
})();
