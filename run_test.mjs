import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  await page.goto('http://127.0.0.1:3000');
  await page.waitForTimeout(5000);
  const body = await page.evaluate(() => document.body.innerHTML);
  console.log('BODY:', body);
  await browser.close();
})();
