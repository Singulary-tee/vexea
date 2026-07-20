import { test, expect } from '@playwright/test';

test.describe('Minimap Fullscreen Toggle and Styling', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
    await page.goto('http://localhost:3000');
  });

  test('minimap should toggle fullscreen state when clicked and outside clicked', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    const splash = page.locator('#splash-screen');
    await expect(splash).toBeVisible();

    // Wait for splash initialization
    const initText = page.locator('text=CLICK TO INITIALIZE');
    await expect(initText).toBeVisible({ timeout: 15000 });

    // Dismiss splash screen
    const box = await splash.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(splash).toHaveCSS('pointer-events', 'none');

    // Wait a brief moment and dispatch the start-match event to reveal HUD and minimap
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('start-match'));
    });

    // Let's log the UI interaction lock status and the displays of each potential blocker
    await page.evaluate(() => {
      const getDisplay = (id: string) => {
        const el = document.getElementById(id);
        return el ? el.style.display : 'NOT_FOUND';
      };
      const getDisplayClass = (cls: string) => {
        const el = document.querySelector(cls) as HTMLElement;
        return el ? el.style.display : 'NOT_FOUND';
      };
      console.log(`DIAGNOSTIC: isUIInteractionLocked() = ${ (window as any).isUIInteractionLocked() }`);
      console.log(`DIAGNOSTIC: splash-screen display = ${getDisplay('splash-screen')}`);
      console.log(`DIAGNOSTIC: loading-overlay display = ${getDisplayClass('.loading-overlay')}`);
      console.log(`DIAGNOSTIC: dev-overlay display = ${getDisplay('dev-overlay')}`);
      console.log(`DIAGNOSTIC: vexea-settings-overlay display = ${getDisplay('vexea-settings-overlay')}`);
      console.log(`DIAGNOSTIC: dev-map-editor-screen display = ${getDisplay('dev-map-editor-screen')}`);
    });

    // Ensure minimap-container is present (even if hidden by menus, we can force click)
    const minimap = page.locator('#minimap-container');
    await expect(minimap).toBeAttached({ timeout: 15000 });

    // Ensure it doesn't start with fullscreen-minimap
    await expect(minimap).not.toHaveClass(/fullscreen-minimap/);

    // Let's force-dispatch a click on minimap-container from the browser side directly!
    await page.evaluate(() => {
      const minimap = document.getElementById('minimap-container');
      if (minimap) {
        minimap.click();
      } else {
        console.log('DIAGNOSTIC: #minimap-container not found in DOM!');
      }
    });

    // Verify it gained the fullscreen-minimap class
    await expect(minimap).toHaveClass(/fullscreen-minimap/);

    // Click outside the minimap container to close it
    // The fullscreen minimap is 90vw x 90vh (top: 5vh, left: 5vw), so clicking at (10, 10) is outside the minimap
    await page.mouse.click(10, 10);

    // Verify it lost the fullscreen-minimap class
    await expect(minimap).not.toHaveClass(/fullscreen-minimap/);
  });
});
