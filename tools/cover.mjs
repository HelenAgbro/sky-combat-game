/**
 * Sky Combat — render cover.png from the real game.
 *
 * start.ng shows a 16:10 cover picture on the game's card, and the docs ask for it
 * to look like the game with the title on it. So this renders the actual scene at
 * 1600x1000, with the aircraft holding a steady cruise (`?cover` switches off the
 * demonstration weave) and the title laid over the top.
 *
 *   node tools/cover.mjs
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARG_SETS, launch } from '../tests/smoke.mjs';
import { serve } from './serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'public', 'cover.png');

/**
 * Ahead and to the right, on the sunlit side, looking back at the aircraft — so the
 * cover shows the shape lit rather than in silhouette.
 */
const HERO_CAMERA = `
  (camera, aircraft) => {
    const forward = aircraft.controller.forward;
    const right = aircraft.controller.right;
    const up = aircraft.controller.up;
    const position = aircraft.position;
    camera.position.copy(position)
      .addScaledVector(forward, 13)
      .addScaledVector(right, 9)
      .addScaledVector(up, 3.4);
    camera.up.copy(up);
    camera.lookAt(position.x, position.y - 0.4, position.z);
  }
`;

const TITLE_OVERLAY = `
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:50;pointer-events:none;' +
    'background:linear-gradient(90deg,rgba(4,8,16,.9) 0%,rgba(4,8,16,.5) 40%,rgba(4,8,16,0) 66%),' +
    'linear-gradient(0deg,rgba(4,8,16,.75) 0%,rgba(4,8,16,0) 42%)';
  const copy = document.createElement('div');
  copy.style.cssText = 'position:fixed;left:64px;bottom:58px;z-index:51;' +
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#eef2f8';
  copy.innerHTML =
    '<div style="display:inline-block;background:#d8fd71;color:#11150b;font-weight:900;' +
    'letter-spacing:.18em;font-size:19px;padding:8px 14px;border-radius:10px;margin-bottom:16px">START.NG</div>' +
    '<div style="font-weight:900;font-style:italic;font-size:132px;line-height:.86;letter-spacing:-.03em;' +
    'text-transform:uppercase;text-shadow:0 10px 50px rgba(0,0,0,.6)">SKY <span style="color:#d8fd71">COMBAT</span></div>' +
    '<div style="font-weight:700;font-size:27px;margin-top:14px;opacity:.95">Fly, fight and chase the greatest distance.</div>';
  document.body.append(overlay, copy);
`;

async function main() {
  const server = await serve(join(ROOT, 'dist'), 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser = null;

  try {
    for (const set of ARG_SETS) {
      browser = await launch(set.args);
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
      page.on('pageerror', (error) => console.error('[pageerror]', error.message));
      await page.route('https://start.ng/**', (route) => route.abort());

      try {
        await page.goto(`${base}/?cover`, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });

        await page.evaluate(() => {
          window.__sky.hideMenu();
          window.__sky.start();
        });

        // Let the aircraft settle into level flight before framing it.
        await page.waitForTimeout(2500);
        await page.evaluate(`window.__sky.game.setCameraOverride(${HERO_CAMERA})`);
        await page.waitForTimeout(1500);
        await page.evaluate(TITLE_OVERLAY);
        await page.waitForTimeout(600);

        await page.screenshot({ path: OUTPUT, type: 'png' });
        const size = statSync(OUTPUT).size;
        console.log(`cover.png written: ${(size / 1024).toFixed(0)} KB at 1600x1000 (16:10)`);

        mkdirSync(join(ROOT, 'dist'), { recursive: true });
        copyFileSync(OUTPUT, join(ROOT, 'dist', 'cover.png'));
        console.log('Copied to dist/cover.png so the built game ships it.');
        break;
      } catch (error) {
        console.error(`Cover render failed with "${set.name}": ${error.message}`);
        await browser.close();
        browser = null;
      }
    }
    if (!browser) process.exitCode = 1;
  } finally {
    await browser?.close();
    server.close();
  }
}

await main();
