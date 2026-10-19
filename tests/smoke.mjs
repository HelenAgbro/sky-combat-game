/**
 * Sky Combat — headless smoke test.
 *
 * Opens the built game in a real browser, waits for the scene to come up, flies
 * the demonstration sortie, captures screenshots for visual review and fails if
 * anything was logged as an error. GPU rendering is tried first and software
 * rendering (SwiftShader) is the fallback, so the test runs on a plain CI machine.
 *
 *   node tests/smoke.mjs [output-directory]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from '../tools/serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANNELS = ['chrome', 'msedge', 'chromium'];

/** GPU first, then software rendering, which always works but is slow. */
export const ARG_SETS = [
  { name: 'gpu', args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--hide-scrollbars', '--mute-audio'] },
  {
    name: 'software',
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--hide-scrollbars',
      '--mute-audio',
    ],
  },
];

/** Launch whichever browser is installed. */
export async function launch(args = ARG_SETS[0].args) {
  let lastError = null;
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ channel, args });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`No Chrome, Edge or Chromium found for Playwright (${lastError?.message ?? 'unknown error'})`);
}

/** The side-on review shot: a three-quarter view from the aircraft's own frame. */
const REVIEW_CAMERA = `
  (camera, aircraft) => {
    const forward = aircraft.controller.forward;
    const right = aircraft.controller.right;
    const up = aircraft.controller.up;
    const position = aircraft.position;
    camera.position.copy(position)
      .addScaledVector(right, 6.5)
      .addScaledVector(up, 1.1)
      .addScaledVector(forward, 4.5);
    camera.up.copy(up);
    camera.lookAt(position);
  }
`;

async function main() {
  const outDir = resolve(process.argv[2] ?? 'test-results');
  mkdirSync(outDir, { recursive: true });

  const server = await serve(join(ROOT, 'dist'), 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const logs = [];
  const errors = [];
  let browser = null;
  let page = null;

  try {
    for (const set of ARG_SETS) {
      browser = await launch(set.args);
      page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      page.on('console', (message) => {
        const line = `[${message.type()}] ${message.text()}`;
        logs.push(line);
        if (message.type() === 'error') errors.push(line);
      });
      page.on('pageerror', (error) => {
        const line = `[pageerror] ${error.stack ?? error.message}`;
        logs.push(line);
        errors.push(line);
      });
      // The connect frame only answers *.start.ng hosts; keep the test offline.
      await page.route('https://start.ng/**', (route) => route.abort());

      await page.goto(`${base}/?perf`, { waitUntil: 'load' });
      try {
        await page.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
        console.log(`Browser: ${set.name} rendering`);
        break;
      } catch {
        console.log(`No WebGL context with the "${set.name}" configuration; trying the next one.`);
        await browser.close();
        browser = null;
        page = null;
      }
    }

    if (!page) throw new Error('The game never became ready in a headless browser.');

    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(outDir, 'menu.png') });
    const menu = await page.evaluate(() => window.__sky.telemetry());

    await page.click('[data-action="start"]');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(outDir, 'flight.png') });
    const flight = await page.evaluate(() => window.__sky.telemetry());

    // A fixed three-quarter view, for reviewing the airframe itself.
    await page.evaluate(`window.__sky.game.setCameraOverride(${REVIEW_CAMERA})`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(outDir, 'aircraft.png') });

    console.log(`menu:    ${JSON.stringify(menu)}`);
    console.log(`flight:  ${JSON.stringify(flight)}`);
    console.log(`screenshots written to ${outDir}/`);

    const expected = process.env.EXPECT_MODEL_SOURCE;
    if (expected && flight.modelSource !== expected) {
      errors.push(`[assert] expected modelSource "${expected}" but the game used "${flight.modelSource}"`);
    }

    if (errors.length > 0) {
      console.error(`\n${errors.length} console error(s):`);
      for (const line of errors) console.error(`  ${line}`);
      process.exitCode = 1;
    } else {
      console.log('\nNo console errors.');
    }
  } finally {
    writeFileSync(join(outDir, 'console.log'), logs.join('\n'));
    await browser?.close();
    server.close();
  }
}

// Run only when invoked directly, so tools/cover.mjs can import `launch` without
// this file also running a full smoke test.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
