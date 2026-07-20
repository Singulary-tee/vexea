import { test, expect } from '@playwright/test';

test.describe('Splash and Orientation Lock Pointer Events', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
    // We assume the dev server is running on port 3000
    await page.goto('http://localhost:3000');
  });

  test('orientation lock should not block clicks in landscape', async ({ page }) => {
    // Set viewport to landscape
    await page.setViewportSize({ width: 1280, height: 720 });
    
    const lock = page.locator('#portrait-lock');
    await expect(lock).toHaveCSS('pointer-events', 'none');
    await expect(lock).toHaveCSS('opacity', '0');
    
    // Attempt to click something behind it (the splash screen)
    const splash = page.locator('#splash-screen');
    await expect(splash).toBeVisible();
    await splash.click(); // If lock blocked it, this would likely fail or hit the lock
  });

  test('splash screen should disable pointer events after first click', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    
    const splash = page.locator('#splash-screen');
    await expect(splash).toBeVisible();
    
    // Wait for the "CLICK TO INITIALIZE" text to appear, indicating listeners are active
    const initText = page.locator('text=CLICK TO INITIALIZE');
    await expect(initText).toBeVisible({ timeout: 15000 });
    
    await expect(splash).toHaveCSS('pointer-events', 'auto'); // Initial state
    
    // Wait for splash to be ready (when "CLICK TO INITIALIZE" appears)
    // This ensures canInteract is true and blocker is removed
    await expect(page.locator('text=CLICK TO INITIALIZE')).toBeVisible({ timeout: 15000 });

    // Check if main.ts loaded
    const mainLoaded = await page.evaluate(() => (window as any).__MAIN_TS_LOADED__);
    const interactionsInitialized = await page.evaluate(() => (window as any).interactionsInitialized);
    console.log(`TEST: __MAIN_TS_LOADED__: ${mainLoaded}, interactionsInitialized: ${interactionsInitialized}`);

    const before = await splash.evaluate(el => window.getComputedStyle(el).pointerEvents);
    console.log(`TEST: splash pointer-events before click: ${before}`);

    // Click splash to start glitch/exit using mouse click at center
    const box = await splash.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }

    // Wait a bit for the event loop
    await page.waitForTimeout(500);

    const after = await splash.evaluate(el => window.getComputedStyle(el).pointerEvents);
    console.log(`TEST: splash pointer-events after click: ${after}`);
    const interactionStarted = await page.evaluate(() => (window as any).interactionStarted);
    console.log(`TEST: interactionStarted flag after click: ${interactionStarted}`);

    // Now it should have pointer-events: none even while visual glitch continues
    await expect(splash).toHaveCSS('pointer-events', 'none');
  });
});
