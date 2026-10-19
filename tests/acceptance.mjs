/*
 * Acceptance checks for the criteria the prototype has to meet.
 *
 * These need a real browser, so they live apart from the unit tests:
 *   1. the camera keeps the ENTIRE aircraft inside the frame, sampled across a full
 *      weave so every bank angle is covered;
 *   2. the same holds at phone, tablet, desktop and ultrawide aspect ratios;
 *   3. resizing keeps the drawing buffer, the CSS size and the camera aspect in step;
 *   4. a browser without WebGL gets the failure panel rather than a blank canvas;
 *   5. renderer cleanup stops the loop and releases its resources without throwing.
 *
 * This is not decoration: check 1 caught the wingtips leaving the frame on a phone
 * while the camera offset was a fixed distance.
 *
 *   npm run test:acceptance
 */
import { chromium } from 'playwright-core';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../tools/serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VIEWPORTS = [
  { name: 'desktop 16:9', width: 1280, height: 720 },
  { name: 'laptop 16:10', width: 1440, height: 900 },
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'phone landscape', width: 844, height: 390 },
  { name: 'tablet 4:3', width: 1024, height: 768 },
  { name: 'ultrawide 21:9', width: 2560, height: 1080 },
];

/** Measure how much of the frame the aircraft occupies, in normalised device coords. */
const MEASURE = `
  (() => {
    const game = window.__sky.game;
    const camera = game.camera;
    const model = game.aircraft.object3D;
    const canvas = document.getElementById('viewport');
    const v = camera.position.clone();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;

    model.updateWorldMatrix(true, true);
    model.traverse((child) => {
      if (!child.isMesh) return;
      const geometry = child.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const { min, max } = geometry.boundingBox;
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) {
            v.set(x, y, z);
            child.localToWorld(v);
            v.project(camera);
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
            minZ = Math.min(minZ, v.z);
          }
        }
      }
    });

    return {
      ndc: { minX, maxX, minY, maxY, minZ },
      fullyInside: minX >= -1 && maxX <= 1 && minY >= -1 && maxY <= 1 && minZ >= -1,
      canvas: {
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        bufferWidth: canvas.width,
        bufferHeight: canvas.height,
      },
      cameraAspect: camera.aspect,
      tier: game.quality.tier,
      renderScale: game.quality.renderScale,
      bank: game.aircraft.controller.bankAngle,
      state: game.state.current,
    };
  })()
`;

async function main() {
  const server = await serve(join(ROOT, 'dist'), 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser = null;
  const problems = [];

  try {
    browser = await chromium.launch({
      channel: 'chrome',
      args: ['--ignore-gpu-blocklist', '--use-angle=metal'],
    });

    // ---------------------------------------------------------------- framing
    console.log('1. Does the camera keep the whole aircraft in frame?');
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await page.route('https://start.ng/**', (route) => route.abort());
      await page.goto(`${base}/?perf`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
      await page.click('[data-action="start"]');

      // Sample across a full weave, so every bank angle is covered.
      let worst = null;
      for (let i = 0; i < 34; i += 1) {
        await page.waitForTimeout(200);
        const sample = await page.evaluate(MEASURE);
        const extent = Math.max(-sample.ndc.minX, sample.ndc.maxX, -sample.ndc.minY, sample.ndc.maxY);
        if (!worst || extent > worst.extent) worst = { ...sample, extent };
      }

      const { ndc, canvas } = worst;
      const width = (ndc.maxX - ndc.minX) / 2;
      const height = (ndc.maxY - ndc.minY) / 2;
      const verdict = worst.fullyInside ? 'INSIDE' : 'CLIPPED';
      if (!worst.fullyInside) problems.push(`${viewport.name}: aircraft leaves the frame ${JSON.stringify(ndc)}`);

      console.log(
        `   ${viewport.name.padEnd(16)} ${verdict.padEnd(8)}` +
          ` x[${ndc.minX.toFixed(2)}, ${ndc.maxX.toFixed(2)}]` +
          ` y[${ndc.minY.toFixed(2)}, ${ndc.maxY.toFixed(2)}]` +
          `  ${(width * 100).toFixed(0)}%x${(height * 100).toFixed(0)}% of half-frame` +
          `  bank ${(worst.bank * 57.3).toFixed(0)}deg`,
      );
      await page.close();
    }

    // ----------------------------------------------------------------- resize
    console.log('\n2. Does resizing keep the scene intact?');
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.route('https://start.ng/**', (route) => route.abort());
    await page.goto(`${base}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
    await page.click('[data-action="start"]');
    await page.waitForTimeout(800);

    for (const [width, height] of [
      [1280, 720],
      [600, 900],
      [1920, 600],
      [390, 844],
      [1280, 720],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(450);
      const m = await page.evaluate(MEASURE);
      const expectedAspect = width / height;
      const aspectOk = Math.abs(m.cameraAspect - expectedAspect) < 0.02;
      const bufferOk =
        m.canvas.bufferWidth >= Math.floor(m.canvas.cssWidth * 0.5) &&
        m.canvas.bufferWidth <= Math.ceil(m.canvas.cssWidth * 2.1) &&
        m.canvas.bufferHeight > 0;
      if (!aspectOk) problems.push(`resize ${width}x${height}: aspect ${m.cameraAspect} != ${expectedAspect}`);
      if (!bufferOk) problems.push(`resize ${width}x${height}: buffer ${m.canvas.bufferWidth}x${m.canvas.bufferHeight}`);
      console.log(
        `   ${`${width}x${height}`.padEnd(10)} css ${m.canvas.cssWidth}x${m.canvas.cssHeight}` +
          `  buffer ${m.canvas.bufferWidth}x${m.canvas.bufferHeight}` +
          `  aspect ${m.cameraAspect.toFixed(3)} ${aspectOk ? 'ok' : 'WRONG'}` +
          `  aircraft ${m.fullyInside ? 'framed' : 'CLIPPED'}`,
      );
    }
    await page.close();

    // ------------------------------------------------------ WebGL failure path
    console.log('\n3. Does a browser without WebGL get a clear failure state?');
    const noGl = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await noGl.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
        if (String(type).startsWith('webgl') || String(type) === 'experimental-webgl') return null;
        return original.call(this, type, ...rest);
      };
    });
    await noGl.goto(`${base}/`, { waitUntil: 'load' });
    await noGl.waitForTimeout(1800);
    const failure = await noGl.evaluate(() => {
      const panel = document.querySelector('.fatal');
      return {
        visible: Boolean(panel),
        title: panel?.querySelector('.fatal-title')?.textContent ?? null,
        hasRetry: Boolean(panel?.querySelector('button')),
        loadingHidden: document.querySelector('.loading')?.classList.contains('is-hidden') ?? null,
      };
    });
    console.log(`   panel: ${failure.visible}  title: "${failure.title}"  retry: ${failure.hasRetry}`);
    console.log(`   loading screen hidden: ${failure.loadingHidden}`);
    if (!failure.visible || !failure.hasRetry) problems.push('the WebGL failure state did not appear');
    if (!failure.loadingHidden) problems.push('the loading screen stayed over the failure panel');
    await noGl.close();

    // ----------------------------------------------------------------- judder
    /*
     * The aircraft is simulated on a fixed 60 Hz step. If its rendered transform is
     * not interpolated between steps, a display that refreshes faster than 60 Hz shows
     * the jet holding one position for several frames and then jumping — which reads as
     * a shiver or a ghosted, doubled aircraft while the background slides smoothly.
     *
     * The frame-rate limit is lifted for this check so the mismatch is unmistakable:
     * at several hundred frames a second, an un-interpolated aircraft should stand
     * still for most frames and lurch on the rest.
     */
    console.log('\n5. Is the aircraft smooth on a display faster than the 60 Hz simulation?');
    const fast = await chromium.launch({
      channel: 'chrome',
      args: [
        '--ignore-gpu-blocklist',
        '--use-angle=metal',
        '--disable-frame-rate-limit',
        '--disable-gpu-vsync',
      ],
    });
    const judderPage = await fast.newPage({ viewport: { width: 1024, height: 640 } });
    await judderPage.route('https://start.ng/**', (route) => route.abort());
    await judderPage.goto(`${base}/`, { waitUntil: 'load' });
    await judderPage.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
    await judderPage.click('[data-action="start"]');
    await judderPage.waitForTimeout(1200);

    const motion = await judderPage.evaluate(
      () =>
        new Promise((resolve) => {
          const game = window.__sky.game;
          const frames = [];
          let previous = null;
          let previousTime = 0;

          function tick(now) {
            const position = game.aircraft.object3D.position;
            const dt = previousTime ? Math.min(0.25, (now - previousTime) / 1000) : 0;

            if (previous && dt > 0) {
              frames.push({
                dt,
                moved: Math.hypot(
                  position.x - previous.x,
                  position.y - previous.y,
                  position.z - previous.z,
                ),
                speed: game.aircraft.controller.speed,
              });
            }

            previous = { x: position.x, y: position.y, z: position.z };
            previousTime = now;

            if (frames.length < 150) requestAnimationFrame(tick);
            else resolve(frames);
          }
          requestAnimationFrame(tick);
        }),
    );

    /*
     * Compare what each frame actually moved with what it should have moved for its
     * own duration. This is cadence-independent: it does not care how many times the
     * display refreshed per simulation step, only whether the rendered position
     * tracks time. A frame that moved nothing while time passed is a stall.
     */
    let stalled = 0;
    let ratios = 0;
    for (const frame of motion) {
      const expected = frame.speed * frame.dt;
      if (expected < 0.002) continue;
      ratios += 1;
      if (frame.moved < expected * 0.45) stalled += 1;
    }

    const stalledFraction = ratios === 0 ? 0 : stalled / ratios;
    const meanRatio =
      ratios === 0
        ? 0
        : motion.reduce((sum, frame) => {
            const expected = frame.speed * frame.dt;
            return sum + (expected < 0.002 ? 0 : frame.moved / expected);
          }, 0) / ratios;

    console.log(
      `   ${motion.length} rendered frames measured against the 60 Hz simulation` +
        `  mean move/expected ${meanRatio.toFixed(2)} (1.00 is perfect)`,
    );
    console.log(
      `   frames that moved less than half of what their own duration required: ` +
        `${(stalledFraction * 100).toFixed(0)}%`,
    );
    if (stalledFraction > 0.15) {
      problems.push(
        `the aircraft stalls on ${(stalledFraction * 100).toFixed(0)}% of frames: the rendered ` +
          'transform is not interpolated between simulation steps',
      );
    }
    await fast.close();

    // ---------------------------------------------------------------- teardown
    console.log('\n4. Does renderer cleanup run cleanly?');
    const teardown = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const teardownErrors = [];
    teardown.on('pageerror', (error) => teardownErrors.push(error.message));
    await teardown.route('https://start.ng/**', (route) => route.abort());
    await teardown.goto(`${base}/`, { waitUntil: 'load' });
    await teardown.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
    await teardown.waitForTimeout(600);
    const disposed = await teardown.evaluate(() => {
      window.__sky.dispose();
      return { started: window.__sky.game.started, frames: window.__sky.game.frameCount };
    });
    await teardown.waitForTimeout(700);
    const framesAfter = await teardown.evaluate(() => window.__sky.game.frameCount);
    console.log(
      `   loop stopped: ${!disposed.started}  frames frozen: ${framesAfter === disposed.frames}` +
        `  errors: ${teardownErrors.length}`,
    );
    if (disposed.started) problems.push('dispose() did not stop the animation loop');
    if (framesAfter !== disposed.frames) problems.push('the loop kept rendering after dispose()');
    if (teardownErrors.length > 0) problems.push(`dispose() threw: ${teardownErrors.join('; ')}`);
    await teardown.close();

    console.log(`\n${problems.length === 0 ? 'ALL CHECKS PASSED' : `${problems.length} PROBLEM(S):`}`);
    for (const problem of problems) console.log(`   - ${problem}`);
    process.exitCode = problems.length === 0 ? 0 : 1;
  } finally {
    await browser?.close();
    server.close();
  }
}

await main();
