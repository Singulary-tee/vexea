
import { readFileSync } from 'fs';

const htmlContent = readFileSync('client/index.html', 'utf8');
const splashContent = readFileSync('client/screens/splash.ts', 'utf8');

console.log('--- VERIFYING FIXES ---');

// Check index.html for pointer-events: none on lock
const hasPointerEventsNone = htmlContent.includes('pointer-events: none;');
const hasTransition = htmlContent.includes('transition: opacity 0.3s ease-in-out;');
console.log(`[HTML] portrait-lock has pointer-events: none: ${hasPointerEventsNone}`);
console.log(`[HTML] portrait-lock has transition: ${hasTransition}`);

// Check splash.ts for pointer-events: none on start
const hasSplashPointerEventsNone = splashContent.includes("el!.style.pointerEvents = 'none';");
console.log(`[SPLASH] el!.style.pointerEvents = 'none' added: ${hasSplashPointerEventsNone}`);

if (hasPointerEventsNone && hasSplashPointerEventsNone) {
  console.log('STATUS: SUCCESS - Fixes implemented correctly.');
} else {
  console.log('STATUS: FAILURE - Fixes missing.');
  process.exit(1);
}
