const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    page.on('console', msg => {
        const text = msg.text();
        console.log(`[Browser] ${text}`);
    });

    page.on('pageerror', error => {
        console.log(`Page error: ${error.message}`);
    });

    console.log("Navigating to http://localhost:3000 ...");
    await page.goto('http://localhost:3000', { waitUntil: 'load' });

    console.log("Waiting 3 seconds for UI load...");
    await page.waitForTimeout(3000);

    console.log("Clicking Start Button...");
    await page.evaluate(() => {
        const btn = document.getElementById("gate-connect");
        if (btn) btn.click();
        else console.log("[Browser] no gate-connect found");
    });
    
    console.log("Waiting 5 seconds for WebGL init and geckos connect...");
    await page.waitForTimeout(5000);
    
    console.log("Evaluating dev_spawn_drone...");
    await page.evaluate(() => {
        window.gameState = "ACTIVE_MATCH";
        if (window.spawnDevDrone) {
            window.spawnDevDrone(2); // type 2
        } else {
            console.log("No spawnDevDrone function found!");
        }
    });

    console.log("Waiting 2 more seconds...");
    await page.waitForTimeout(2000);

    console.log("Fetching /api/debug ...");
    const debugData = await page.evaluate(async () => {
        const res = await fetch("/api/debug");
        return await res.json();
    });
    console.log(`[API_DEBUG] Players: ${JSON.stringify(debugData.players)}`);
    // Print non-idle non-dead drones
    const aliveStates = debugData.drones.filter(s => s !== 5); // 5 is DEAD usually
    console.log(`[API_DEBUG] Drone States active: ${JSON.stringify(aliveStates)}`);
    console.log(`[API_DEBUG] Logs:\n${debugData.logs.join('\n')}`);

    await browser.close();
    process.exit(0);
})();
