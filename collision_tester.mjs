import { chromium } from 'playwright';

(async () => {
    console.log("Launching browser...");
    const browser = await chromium.launch({
        args: ['--autoplay-policy=no-user-gesture-required']
    });
    const page = await browser.newPage();

    page.on('console', msg => {
        console.log(`[CLIENT] ${msg.text()}`);
    });
    page.on('pageerror', err => {
        console.log(`[PAGE_ERROR] ${err.stack}`);
    });

    console.log("Navigating to http://localhost:3000 ...");
    await page.goto('http://localhost:3000', { waitUntil: 'load' });
    
    console.log("Waiting 5 seconds for map load...");
    await new Promise(r => setTimeout(r, 5000));

    // Focus canvas and press W
    await page.evaluate(() => {
        if (window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('start-match', { detail: { map: { id: 'map_1_facility' } } }));
        }
    });
    
    // Simulate real keyboard input
    await page.mouse.click(200, 200);
    await page.keyboard.down('w');

    console.log("Waiting 3 seconds for room join...");
    await new Promise(r => setTimeout(r, 3000));

    console.log("Holding W key on document...");
    await page.evaluate(() => {
        window.__forceWalk = true;
    });

    console.log("Polling player positions...");
    for (let i=0; i<15; i++) {
        await new Promise(r => setTimeout(r, 200));
        await page.evaluate(() => {
            console.log(`CURRENT POS: X=${window.camera?.position?.x?.toFixed(2)} Y=${window.camera?.position?.y?.toFixed(2)} Z=${window.camera?.position?.z?.toFixed(2)} -- SAB: ${typeof SharedArrayBuffer} -- GS: ${window.gameState} -- FW: ${window.__forceWalk}`);
        });
    }

    await page.keyboard.up('w');
    await browser.close();
    console.log("Done.");
    process.exit(0);
})();
