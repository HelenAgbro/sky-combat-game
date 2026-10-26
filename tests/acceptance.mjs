/*
 * Acceptance checks for the criteria the prototype has to meet.
 *
 * These need a real browser, so they live apart from the unit tests:
 *   1. the camera keeps the ENTIRE aircraft inside the frame, sampled across a full
 *      weave so every bank angle is covered, at six viewport shapes;
 *   2. resizing keeps the drawing buffer, the CSS size and the camera aspect in step;
 *   3. a browser without WebGL gets the failure panel rather than a blank canvas;
 *   4. the keyboard flies the aircraft and does not scroll the page;
 *   5. the on-screen controls work on a phone-sized viewport, and a real tap reaches them;
 *   6. pause holds the simulation without duplicating the animation loop;
 *   7. the aircraft moves smoothly on a display faster than the 60 Hz simulation;
 *   8. the cloud field, the land, the water and the moving control surfaces stay inside
 *      their budget — nothing is created or destroyed in flight;
 *   9. a scenery zone transition runs end to end;
 *  10. the fight works: firing, hits, kills and one collision's worth of damage;
 *  11. coins, fuel and power-ups work, and a new run forgets them;
 *  12. the run's lifecycle holds — distance climbs with the aircraft, difficulty follows
 *      distance, a pause freezes every clock, one run ends once, and a replay starts clean
 *      while the local record survives it;
 *  13. renderer cleanup stops the loop and releases its resources without throwing.
 *
 * This is not decoration. Check 1 caught the wingtips leaving the frame on a phone while
 * the camera offset was a fixed distance; check 8 is what would catch a scene that leaks
 * a geometry per frame and falls over after a minute of flying.
 *
 *   npm run test:acceptance
 */
import { chromium } from 'playwright-core';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../tools/serve.mjs';
import { COMBAT } from '../src/game/config.js';
import { formatDistance } from '../src/run/distance.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** One hazard's worth of damage, for the "one collision, one hit" check. */
const OBSTACLE_DAMAGE = COMBAT.obstacles.damage;

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

      /*
       * Fly it hard, by hand, while measuring. A continuous climb and hard turn
       * exercises the camera far more than the scripted menu backdrop, and it is
       * what a player will actually do.
       */
      const held = viewport.width < viewport.height ? ['KeyS', 'KeyA'] : ['KeyW', 'KeyD'];
      for (const key of held) await page.keyboard.down(key);

      // Sample across a full weave, so every bank angle is covered.
      let worst = null;
      for (let i = 0; i < 34; i += 1) {
        await page.waitForTimeout(200);
        const sample = await page.evaluate(MEASURE);
        const extent = Math.max(-sample.ndc.minX, sample.ndc.maxX, -sample.ndc.minY, sample.ndc.maxY);
        if (!worst || extent > worst.extent) worst = { ...sample, extent };
      }

      for (const key of held) await page.keyboard.up(key);

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
          `  holding ${held.join('+') || 'nothing'}`,
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

    // --------------------------------------------------------------- keyboard
    console.log('\n4. Do the keyboard controls fly the aircraft, and does the page stay put?');
    const kb = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await kb.route('https://start.ng/**', (route) => route.abort());
    await kb.goto(`${base}/`, { waitUntil: 'load' });
    await kb.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
    await kb.click('[data-action="start"]');
    await kb.waitForTimeout(900);

    // Registered after the game's own listener, so it sees whether the browser's
    // default was suppressed.
    await kb.evaluate(() => {
      window.__probe = { prevented: {}, scrollBefore: window.scrollY };
      for (const code of ['ArrowDown', 'ArrowLeft', 'Space']) {
        window.addEventListener('keydown', (event) => {
          if (event.code === code) window.__probe.prevented[code] = event.defaultPrevented;
        });
      }
    });

    const pitch = () => kb.evaluate(() => window.__sky.telemetry().pitch);
    const bank = () => kb.evaluate(() => window.__sky.telemetry().bank);
    const hold = async (key, ms) => {
      await kb.keyboard.down(key);
      await kb.waitForTimeout(ms);
      const value = { pitch: await pitch(), bank: await bank() };
      await kb.keyboard.up(key);
      await kb.waitForTimeout(350);
      return value;
    };

    const level = { pitch: await pitch(), bank: await bank() };
    const climbing = await hold('KeyW', 1100);
    const diving = await hold('ArrowDown', 1100);
    const rightRoll = await hold('KeyD', 600);
    const leftRoll = await hold('ArrowLeft', 600);
    // Space is wired for the combat stage; pressing it here proves the browser's own
    // page-down is suppressed.
    await hold('Space', 250);
    const probe = await kb.evaluate(() => ({ ...window.__probe, scrollAfter: window.scrollY }));

    console.log(
      `   W: pitch ${level.pitch.toFixed(2)} -> ${climbing.pitch.toFixed(2)}` +
        `   down arrow: -> ${diving.pitch.toFixed(2)}`,
    );
    console.log(
      `   D: bank -> ${rightRoll.bank.toFixed(2)}` +
        `   left arrow: bank -> ${leftRoll.bank.toFixed(2)}` +
        ` (a leftward change of ${(leftRoll.bank - rightRoll.bank).toFixed(2)})`,
    );
    console.log(
      `   browser default suppressed — down arrow: ${probe.prevented.ArrowDown},` +
        ` left arrow: ${probe.prevented.ArrowLeft}, space: ${probe.prevented.Space}` +
        `   page scroll: ${probe.scrollBefore} -> ${probe.scrollAfter}`,
    );

    if (climbing.pitch < level.pitch + 0.1) problems.push('W did not raise the nose');
    if (diving.pitch > climbing.pitch - 0.1) problems.push('the down arrow did not lower the nose');
    if (rightRoll.bank > -0.3) problems.push('D did not bank the aircraft to the right');
    // Measured as a change, because the aircraft may already be banked hard the other way.
    if (leftRoll.bank - rightRoll.bank < 0.3) problems.push('the left arrow did not roll the aircraft left');
    for (const code of ['ArrowDown', 'ArrowLeft', 'Space']) {
      if (probe.prevented[code] !== true) problems.push(`the browser default was not suppressed for ${code}`);
    }
    if (probe.scrollAfter !== probe.scrollBefore) problems.push('the page scrolled while flying');

    // ------------------------------------------------------------------ touch
    console.log('\n5. Do the on-screen controls work on a phone-sized viewport?');
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await mobile.route('https://start.ng/**', (route) => route.abort());
    await mobile.goto(`${base}/?touch`, { waitUntil: 'load' });
    await mobile.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
    await mobile.click('[data-action="start"]');
    await mobile.waitForTimeout(700);

    const layout = await mobile.evaluate(() => {
      const size = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { w: Math.round(rect.width), h: Math.round(rect.height) };
      };
      const zone = document.querySelector('.touch-zone');
      return {
        visible: document.querySelector('.touch')?.classList.contains('is-visible') ?? false,
        touchAction: zone ? getComputedStyle(zone).touchAction : null,
        fire: size('.touch-fire'),
        boost: size('.touch-boost'),
        pause: size('.touch-pause'),
      };
    });

    console.log(
      `   controls visible: ${layout.visible}   touch-action: ${layout.touchAction}` +
        `   fire ${layout.fire?.w}x${layout.fire?.h}  boost ${layout.boost?.w}x${layout.boost?.h}` +
        `  pause ${layout.pause?.w}x${layout.pause?.h}`,
    );

    if (!layout.visible) problems.push('the touch controls did not appear on a coarse-pointer device');
    if (layout.touchAction !== 'none') problems.push('the stick zone would let the page scroll');
    for (const [name, size] of Object.entries({ fire: layout.fire, boost: layout.boost, pause: layout.pause })) {
      if (!size || size.w < 44 || size.h < 44) problems.push(`the ${name} button is smaller than a 44 px target`);
    }

    // Drag the stick right and up: the aircraft should roll right and climb.
    const stick = await mobile.evaluate(() => {
      const zone = document.querySelector('.touch-zone');
      const rect = zone.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const send = (type, x, y) => {
        const event = new PointerEvent(type, {
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        });
        zone.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const prevented = send('pointerdown', cx, cy);
      send('pointermove', cx + 70, cy - 70);
      return { prevented, controls: window.__sky.controls };
    });

    await mobile.waitForTimeout(900);
    const touchFlight = await mobile.evaluate(() => ({
      telemetry: window.__sky.telemetry(),
      controls: window.__sky.controls,
    }));

    await mobile.evaluate(() => {
      const zone = document.querySelector('.touch-zone');
      zone.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
        }),
      );
    });
    await mobile.waitForTimeout(200);
    const released = await mobile.evaluate(() => window.__sky.controls);

    console.log(
      `   stick drag: page scrolled ${stick.prevented ? 'no' : 'YES'}` +
        `   controls roll ${stick.controls.roll.toFixed(2)} pitch ${stick.controls.pitch.toFixed(2)}`,
    );
    console.log(
      `   aircraft: bank ${touchFlight.telemetry.bank.toFixed(2)}` +
        ` pitch ${touchFlight.telemetry.pitch.toFixed(2)}` +
        `   released -> roll ${released.roll.toFixed(2)} pitch ${released.pitch.toFixed(2)}`,
    );

    if (stick.prevented !== true) problems.push('the stick drag reached the page instead of being captured');
    if (stick.controls.roll < 0.5 || stick.controls.pitch < 0.5) {
      problems.push(`the stick did not report full deflection (${JSON.stringify(stick.controls)})`);
    }
    if (touchFlight.telemetry.bank > -0.2) problems.push('the touch stick did not bank the aircraft');
    if (touchFlight.telemetry.pitch < 0.1) problems.push('the touch stick did not raise the nose');
    if (released.roll !== 0 || released.pitch !== 0) problems.push('releasing the stick did not centre it');

    // The fire button is wired for the combat stage: it must report a press.
    const firePress = await mobile.evaluate(() => {
      const button = document.querySelector('.touch-fire');
      const rect = button.getBoundingClientRect();
      const send = (type) => {
        const event = new PointerEvent(type, {
          pointerId: 9,
          pointerType: 'touch',
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        });
        button.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const prevented = send('pointerdown');
      const pressed = window.__sky.controls.fire;
      send('pointerup');
      return { prevented, pressed, released: window.__sky.controls.fire };
    });

    console.log(
      `   fire button: page scrolled ${firePress.prevented ? 'no' : 'YES'}` +
        `  pressed ${firePress.pressed}  released ${firePress.released}`,
    );
    if (firePress.prevented !== true) problems.push('the fire button let the page scroll');
    if (firePress.pressed !== true) problems.push('the fire button did not report a press');
    if (firePress.released !== false) problems.push('the fire button stayed pressed after release');

    // A real touch, through the browser's own touch pipeline, must reach the controls.
    const fireBox = await mobile.locator('.touch-fire').boundingBox();
    await mobile.touchscreen.tap(fireBox.x + fireBox.width / 2, fireBox.y + fireBox.height / 2);
    await mobile.waitForTimeout(150);
    const afterTap = await mobile.evaluate(() => window.__sky.controls.fire);
    if (afterTap !== false) problems.push('a real tap left the fire button stuck down');

    await mobile.close();

    // ------------------------------------------------------------------ pause
    console.log('\n6. Does pause and resume work without duplicating anything?');
    const stateOf = () => kb.evaluate(() => window.__sky.game.state.current);
    const framesPerSecond = async (ms) => {
      const before = await kb.evaluate(() => window.__sky.game.frameCount);
      await kb.waitForTimeout(ms);
      const after = await kb.evaluate(() => window.__sky.game.frameCount);
      return ((after - before) / ms) * 1000;
    };

    const flyingRate = await framesPerSecond(1000);
    await kb.keyboard.press('KeyP');
    await kb.waitForTimeout(300);
    const pausedState = await stateOf();
    const frozenBefore = await kb.evaluate(() => window.__sky.telemetry().distance);
    await kb.waitForTimeout(700);
    const frozenAfter = await kb.evaluate(() => window.__sky.telemetry().distance);

    await kb.keyboard.press('KeyP');
    await kb.waitForTimeout(300);
    const resumedState = await stateOf();
    const resumedRate = await framesPerSecond(1000);

    console.log(
      `   one press: flying -> ${pausedState}, another: -> ${resumedState}` +
        `   distance while paused: ${frozenBefore.toFixed(1)} -> ${frozenAfter.toFixed(1)}`,
    );
    console.log(
      `   frames per second: ${flyingRate.toFixed(0)} before, ${resumedRate.toFixed(0)} after resuming`,
    );

    if (pausedState !== 'paused') problems.push('one press of P did not pause (or toggled twice)');
    if (resumedState !== 'flying') problems.push('the second press of P did not resume');
    if (Math.abs(frozenAfter - frozenBefore) > 1e-6) problems.push('the aircraft kept flying while paused');
    if (Math.abs(resumedRate - flyingRate) > Math.max(6, flyingRate * 0.4)) {
      problems.push(
        `the frame rate changed from ${flyingRate.toFixed(0)} to ${resumedRate.toFixed(0)} across pause: ` +
          'a duplicated animation loop',
      );
    }
    await kb.close();

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
    console.log('\n7. Is the aircraft smooth on a display faster than the 60 Hz simulation?');
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

    /*
     * Stage 4's scene systems — the cloud field, the land, the water detail and the
     * moving control surfaces — all recycle a fixed pool of objects rather than growing.
     * That is the property worth measuring, because a scene that leaks one geometry per
     * frame runs perfectly for a minute and then falls over.
     */
    console.log('\n8. Do the new scene systems stay inside their budget?');
    const budget = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await budget.route('https://start.ng/**', (route) => route.abort());
    await budget.goto(`${base}/`, { waitUntil: 'load' });
    await budget.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
    await budget.click('[data-action="start"]');
    await budget.waitForTimeout(1500);

    /*
     * Count what the scene actually holds, not what the GPU has uploaded. The renderer's
     * own counters rise as objects first come into view — a hidden island geometry is not
     * uploaded until the aircraft turns toward it — which is a one-off cost, not a leak,
     * and would make the check flaky. The scene graph is the deterministic measure: if
     * anything is created per frame, this finds it.
     */
    const snapshot = () =>
      budget.evaluate(() => {
        const game = window.__sky.game;
        const geometries = new Set();
        const materials = new Set();
        const textures = new Set();

        game.scene.traverse((object) => {
          if (object.geometry) geometries.add(object.geometry.uuid);
          const list = Array.isArray(object.material)
            ? object.material
            : object.material
              ? [object.material]
              : [];
          for (const material of list) {
            materials.add(material.uuid);
            for (const value of Object.values(material)) {
              if (value && value.isTexture) textures.add(value.uuid);
            }
          }
        });

        return {
          geometries: geometries.size,
          materials: materials.size,
          textures: textures.size,
          gpuGeometries: game.renderer.info.memory.geometries,
          gpuTextures: game.renderer.info.memory.textures,
          programs: game.renderer.info.programs?.length ?? 0,
          hasClouds: Boolean(game.scene.getObjectByName('clouds')),
          hasTerrain: Boolean(game.scene.getObjectByName('terrain')),
          hasRidge: Boolean(game.scene.getObjectByName('ridge')),
          hasCombat: Boolean(game.scene.getObjectByName('combat')),
          zone: game.telemetry().zone,
          ...game.telemetry(),
        };
      });

    const before = await snapshot();

    // Fly hard for eight seconds: the terrain changes cell, clouds recycle, and every
    // control surface is driven to its stop and back several times.
    for (const key of ['KeyW', 'KeyD', 'ShiftLeft']) await budget.keyboard.down(key);
    await budget.waitForTimeout(3000);

    const rolling = await budget.evaluate(() => {
      const { surfaces } = window.__sky.game.aircraft;
      return {
        flaperonRight: surfaces.flaperon.right.rotation.x,
        flaperonLeft: surfaces.flaperon.left.rotation.x,
        stabilator: surfaces.stabilator.right.rotation.x,
      };
    });

    await budget.waitForTimeout(3000);
    for (const key of ['KeyW', 'KeyD', 'ShiftLeft']) await budget.keyboard.up(key);
    await budget.waitForTimeout(1200);

    const centred = await budget.evaluate(() => {
      const { surfaces } = window.__sky.game.aircraft;
      return {
        flaperonRight: surfaces.flaperon.right.rotation.x,
        flaperonLeft: surfaces.flaperon.left.rotation.x,
        stabilator: surfaces.stabilator.right.rotation.x,
      };
    });
    const after = await snapshot();

    console.log(
      `   scene holds ${before.geometries} geometries, ${before.materials} materials,` +
        ` ${before.textures} textures -> ${after.geometries} / ${after.materials} / ${after.textures}`,
    );
    console.log(
      `   clouds ${after.clouds}  islands ${after.islands}/${after.islandCapacity}` +
        `  control surfaces: ${after.controlSurfaces}`,
    );
    console.log(
      `   flaperons under roll: right ${rolling.flaperonRight.toFixed(2)}` +
        ` left ${rolling.flaperonLeft.toFixed(2)}  stabilator ${rolling.stabilator.toFixed(2)}` +
        `   centred again: ${centred.flaperonRight.toFixed(3)} / ${centred.flaperonLeft.toFixed(3)}`,
    );

    if (!before.hasClouds) problems.push('the cloud layer is not in the scene');
    if (!before.hasTerrain) problems.push('the terrain is not in the scene');
    if (!before.hasRidge) problems.push('the horizon band is not in the scene');
    if (!before.hasCombat) problems.push('the combat systems are not in the scene');
    if (!before.controlSurfaces) problems.push('the airframe has no moving control surfaces');
    if (after.clouds <= 0) problems.push('the cloud field is empty');
    if (after.islands <= 0) problems.push('no land is being placed');
    if (after.islands > after.islandCapacity) problems.push('the terrain placed more islands than it owns');

    // Nothing may be created while flying.
    if (after.geometries !== before.geometries) {
      problems.push(`geometries changed while flying: ${before.geometries} -> ${after.geometries}`);
    }
    if (after.materials !== before.materials) {
      problems.push(`materials changed while flying: ${before.materials} -> ${after.materials}`);
    }
    if (after.textures !== before.textures) {
      problems.push(`textures changed while flying: ${before.textures} -> ${after.textures}`);
    }
    if (after.programs !== before.programs) {
      problems.push(`shader programs changed while flying: ${before.programs} -> ${after.programs}`);
    }

    // The surfaces move with the input, in opposite directions, and come back.
    if (Math.abs(rolling.flaperonRight) < 0.08) problems.push('the flaperons did not deflect under roll');
    if (rolling.flaperonRight * rolling.flaperonLeft >= 0) {
      problems.push('the two flaperons moved the same way instead of differentially');
    }
    if (Math.abs(centred.flaperonRight) > 0.05 || Math.abs(centred.flaperonLeft) > 0.05) {
      problems.push('the flaperons did not return to neutral when the stick was centred');
    }
    if (!(rolling.stabilator < -0.05)) problems.push('the stabilator did not deflect with nose-up input');

    await budget.close();

    /*
     * Stage 5's architecture: one call moves the whole world to another zone, and every
     * module cross-fades together. Only the coastal zone is polished, but the machinery
     * has to work for the rest of them to be data.
     */
    console.log('\n9. Does a scenery zone transition run end to end?');
    const zones = await browser.newPage({ viewport: { width: 1024, height: 640 } });
    await zones.route('https://start.ng/**', (route) => route.abort());
    await zones.goto(`${base}/`, { waitUntil: 'load' });
    await zones.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
    await zones.click('[data-action="start"]');
    await zones.waitForTimeout(900);

    const beforeZone = await zones.evaluate(() => {
      const game = window.__sky.game;
      return {
        zone: game.telemetry().zone,
        zenith: game.sky.mesh.material.uniforms.uZenith.value.getHexString(),
        fogNear: game.scene.fog.near,
        exposure: game.renderer.toneMappingExposure,
      };
    });

    const started = await zones.evaluate(() => window.__sky.setZone('storm', { seconds: 2 }));
    await zones.waitForTimeout(500);
    const midway = await zones.evaluate(() => ({
      transitioning: window.__sky.game.zones.transitioning,
      progress: window.__sky.game.zones.progress,
      zenith: window.__sky.game.sky.mesh.material.uniforms.uZenith.value.getHexString(),
    }));

    await zones.waitForTimeout(2200);
    const afterZone = await zones.evaluate(() => {
      const game = window.__sky.game;
      return {
        zone: game.telemetry().zone,
        zenith: game.sky.mesh.material.uniforms.uZenith.value.getHexString(),
        fogNear: game.scene.fog.near,
        exposure: game.renderer.toneMappingExposure,
        transitioning: game.zones.transitioning,
        swaps: game.zones.swaps,
      };
    });

    // And back again, to prove the transition is not a one-way trip.
    await zones.evaluate(() => window.__sky.setZone('coastal', { seconds: 1 }));
    await zones.waitForTimeout(1400);
    const returned = await zones.evaluate(() => window.__sky.telemetry().zone);

    console.log(
      `   ${beforeZone.zone} -> storm: midway progress ${midway.progress.toFixed(2)}` +
        ` (transitioning ${midway.transitioning}), arrived as "${afterZone.zone}"`,
    );
    console.log(
      `   sky zenith ${beforeZone.zenith} -> ${afterZone.zenith} -> back as "${returned}"` +
        `   fog near ${beforeZone.fogNear} -> ${afterZone.fogNear}` +
        `   exposure ${beforeZone.exposure.toFixed(2)} -> ${afterZone.exposure.toFixed(2)}`,
    );

    if (!started) problems.push('the zone transition refused to start');
    if (!midway.transitioning) problems.push('the transition did not report itself as running');
    if (!(midway.progress > 0 && midway.progress < 1)) {
      problems.push(`the transition jumped rather than blending (progress ${midway.progress})`);
    }
    if (midway.zenith === beforeZone.zenith) problems.push('the sky did not change during the transition');
    if (afterZone.zone !== 'storm') problems.push(`the transition did not arrive (${afterZone.zone})`);
    if (afterZone.zenith === beforeZone.zenith) problems.push('the sky is unchanged at the destination');
    if (afterZone.fogNear === beforeZone.fogNear) problems.push('the fog did not change with the zone');
    if (afterZone.transitioning) problems.push('the transition never finished');
    if (afterZone.swaps < 1) problems.push('the scenery kind never swapped');
    if (returned !== 'coastal') problems.push(`could not transition back (${returned})`);

    await zones.close();

    /*
     * The fight. Everything here is driven through the real systems — a real enemy spawned
     * by the spawner, real shots from the gun, a real collision — rather than by calling
     * the collision code directly, so what is checked is the game rather than the maths
     * (which the unit tests already cover).
     */
    console.log('\n10. Does the fight work: firing, hits, kills and collisions?');
    const fight = await browser.newPage({ viewport: { width: 1024, height: 640 } });
    await fight.route('https://start.ng/**', (route) => route.abort());
    await fight.goto(`${base}/`, { waitUntil: 'load' });
    await fight.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
    await fight.click('[data-action="start"]');
    await fight.waitForTimeout(1000);

    // Enemies arrive on their own, without being asked.
    const spawnedOnTheirOwn = await fight.evaluate(
      () =>
        new Promise((resolve) => {
          const game = window.__sky.game;
          const started = performance.now();
          const check = () => {
            if (game.combat.telemetry().enemies > 0) resolve(true);
            else if (performance.now() - started > 12000) resolve(false);
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        }),
    );

    // Firing, and a shot that lands. A stationary enemy is placed in the gun's line so the
    // result is deterministic rather than a matter of luck.
    const aimed = await fight.evaluate(() => {
      const game = window.__sky.game;
      const combat = game.combat;
      const player = game.aircraft.controller;

      // Clear the natural traffic, so nothing else can be hit or shoot back.
      combat.enemies.releaseAll();

      const enemy = combat.enemies.spawn(player);
      if (!enemy) return { spawned: false, before: combat.telemetry() };

      enemy.position.copy(player.position).addScaledVector(player.forward, 500);
      enemy.speed = 0;
      enemy.pattern = 'patrol';
      enemy.fireCooldown = 1e6;

      return { spawned: true, before: combat.telemetry() };
    });

    await fight.keyboard.down('Space');
    await fight.waitForTimeout(2600);
    await fight.keyboard.up('Space');

    const fought = await fight.evaluate(() => window.__sky.game.combat.telemetry());

    // And a hazard, flown into deliberately.
    const hazard = await fight.evaluate(() => {
      const game = window.__sky.game;
      const player = game.aircraft.controller;
      game.combat.enemies.releaseAll();
      const before = game.combat.telemetry().hull;

      const obstacle = game.combat.obstacles.spawn(player);
      if (!obstacle) return { spawned: false, before };
      obstacle.position.copy(player.position);
      obstacle.anchorY = obstacle.position.y;
      return { spawned: true, before };
    });

    await fight.waitForTimeout(700);
    const afterHazard = await fight.evaluate(() => window.__sky.game.combat.telemetry());

    // Responsiveness while the fight is running.
    const fpsBefore = await fight.evaluate(() => window.__sky.game.frameCount);
    await fight.waitForTimeout(2000);
    const fpsAfter = await fight.evaluate(() => window.__sky.game.frameCount);
    const fightFps = (fpsAfter - fpsBefore) / 2;

    // Everything given back once it is no longer needed.
    await fight.waitForTimeout(2000);
    const settled = await fight.evaluate(() => window.__sky.game.combat.telemetry());

    console.log(
      `   enemies arrive on their own: ${spawnedOnTheirOwn}` +
        `   aimed shot: ${aimed.spawned ? 'placed' : 'NOT PLACED'}`,
    );
    console.log(
      `   shots fired ${aimed.before.shotsFired} -> ${fought.shotsFired}` +
        `   hits ${aimed.before.shotsHit} -> ${fought.shotsHit}` +
        `   kills ${aimed.before.kills} -> ${fought.kills}   score ${fought.score}`,
    );
    console.log(
      `   hazard: ${hazard.spawned ? 'placed on the aircraft' : 'NOT PLACED'}` +
        `   hull ${hazard.before} -> ${afterHazard.hull}`,
    );
    console.log(
      `   frame rate during the fight: ${fightFps.toFixed(0)} fps` +
        `   shots still in the air: ${settled.playerShots}` +
        `   enemies ${settled.enemies}/${settled.enemyCapacity}` +
        `   hazards ${settled.obstacles}/${settled.obstacleCapacity}`,
    );

    if (!spawnedOnTheirOwn) problems.push('no enemy appeared on its own within twelve seconds');
    if (!aimed.spawned) problems.push('could not place an enemy to shoot at');

    if (fought.shotsFired <= aimed.before.shotsFired) problems.push('holding fire did not fire the gun');
    if (fought.shotsHit <= aimed.before.shotsHit) problems.push('no shot ever hit the target ahead');
    if (fought.kills <= aimed.before.kills) problems.push('the target was hit but never destroyed');

    // One enemy, one reward: a burst that lands many hits must not score more than once.
    const awarded = fought.kills - aimed.before.kills;
    if (awarded > 1) problems.push(`${awarded} kills were awarded for a single enemy`);

    if (!hazard.spawned) problems.push('could not place a hazard');
    else {
      const damage = hazard.before - afterHazard.hull;
      if (damage <= 0) problems.push('flying into a hazard did no damage');
      // One collision, one hit: the grace window and the burst-on-contact rule mean the
      // hull must fall by about one hazard's worth, not by several.
      else if (damage > OBSTACLE_DAMAGE * 1.5) {
        problems.push(`one hazard took ${damage} off the hull, which is more than one collision's worth`);
      }
    }

    if (fightFps < 30) problems.push(`the game ran at ${fightFps.toFixed(0)} fps during the fight`);
    if (settled.playerShots !== 0) {
      problems.push(`${settled.playerShots} shots were never recycled after the firing stopped`);
    }
    if (settled.enemies > settled.enemyCapacity) problems.push('more enemies alive than the pool holds');
    if (settled.obstacles > settled.obstacleCapacity) problems.push('more hazards alive than the pool holds');

    await fight.close();

    /*
     * The run's resources. Coins, fuel and power-ups are driven through the real systems: a
     * real coin pattern placed by the pickups, a real pass through it by a flying aircraft,
     * the real fuel burn in the flight model, and the real HUD. What is checked is that a coin
     * is only ever counted once, that fuel falls and can be put back, that an empty tank ends
     * the run, that a power-up starts and stops on time, and that starting again leaves none
     * of it behind.
     */
    console.log('\n11. Do coins, fuel and power-ups work, and does a new run forget them?');
    const resources = await browser.newPage({ viewport: { width: 1024, height: 640 } });
    await resources.route('https://start.ng/**', (route) => route.abort());
    await resources.goto(`${base}/`, { waitUntil: 'load' });
    await resources.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
    await resources.click('[data-action="start"]');
    await resources.waitForTimeout(800);

    // A coin, dead ahead on the flight line, flown through for real.
    const coins = await resources.evaluate(() => {
      const game = window.__sky.game;
      const player = game.aircraft.controller;
      // Clear the fight, so nothing shoots the test aircraft while it is being measured.
      game.combat.enemies.releaseAll();
      game.combat.obstacles.releaseAll();
      game.pickups.releaseAll();

      game.pickups.spawnCoins(player);
      const coin = game.pickups.coinPool.active[0];
      if (!coin) return { placed: false };

      // 120 m ahead: about a second of flight at cruise, well outside the collection radius.
      coin.position.copy(player.position).addScaledVector(player.forward, 120);
      return { placed: true, before: game.telemetry().coins, inAir: game.pickups.coinsActive };
    });

    await resources.waitForTimeout(1600);
    const collected = await resources.evaluate(() => ({
      coins: window.__sky.telemetry().coins,
      inAir: window.__sky.game.pickups.coinsActive,
      hudCoins: document.querySelector('.hud-coins b')?.textContent ?? '',
    }));

    // And the same coin, offered twice in one step: the second pass must credit nothing.
    const doubleTake = await resources.evaluate(() => {
      const game = window.__sky.game;
      const player = game.aircraft.controller;
      game.pickups.releaseAll();
      game.pickups.spawnCoins(player);

      const coin = game.pickups.coinPool.active[0];
      coin.position.copy(player.position);

      const first = game.pickups.collect(player).coins;
      const second = game.pickups.collect(player).coins;
      return { first, second };
    });

    // Fuel: it burns while flying, and a canister puts it back.
    const fuelBefore = await resources.evaluate(() => window.__sky.telemetry().fuel);
    await resources.waitForTimeout(2500);
    const fuelBurned = await resources.evaluate(() => window.__sky.telemetry().fuel);

    const refuelled = await resources.evaluate(() => {
      const game = window.__sky.game;
      const player = game.aircraft.controller;
      const before = player.fuel;

      const canister = game.pickups.spawnFuel(player);
      if (!canister) return { placed: false, before };
      // 40 m ahead, so it is collected within a couple of frames of flying.
      canister.position.copy(player.position).addScaledVector(player.forward, 40);
      canister.age = 0;
      return { placed: true, before };
    });

    await resources.waitForTimeout(600);
    const afterRefuel = await resources.evaluate(() => ({
      fuel: window.__sky.telemetry().fuel,
      hudFuel: document.querySelector('.hud-fuel b')?.textContent ?? '',
    }));

    // A power-up: on for its duration, then off, with its chip following it.
    const powerup = await resources.evaluate(() => {
      const game = window.__sky.game;
      const player = game.aircraft.controller;
      game.pickups.releaseAll();
      game.run.reset();

      const orb = game.pickups.spawnPower(player, 'boost');
      if (!orb) return { placed: false };
      orb.position.copy(player.position).addScaledVector(player.forward, 40);
      return { placed: true };
    });

    await resources.waitForTimeout(600);
    const boosted = await resources.evaluate(() => {
      const game = window.__sky.game;
      return {
        active: game.run.isActive('boost'),
        speedScale: game.aircraft.controller.speedScale,
        chip: Boolean(document.querySelector('.hud-power[data-power="boost"]')),
        chipText: document.querySelector('.hud-power[data-power="boost"] .hud-power-time')?.textContent ?? '',
        remaining: game.run.remaining('boost'),
      };
    });

    // Shorten it to a fraction of a second, and watch it go.
    await resources.evaluate(() => window.__sky.game.run.activatePowerup('boost', 0.3));
    await resources.waitForTimeout(900);
    const expired = await resources.evaluate(() => {
      const game = window.__sky.game;
      return {
        active: game.run.isActive('boost'),
        speedScale: game.aircraft.controller.speedScale,
        chip: Boolean(document.querySelector('.hud-power[data-power="boost"]')),
      };
    });

    // Heavy rounds load the gun, and unload it when they run out.
    const ammo = await resources.evaluate(async () => {
      const game = window.__sky.game;
      game.run.activatePowerup('special', 0.3);
      // One frame, so the game has applied the effect to the fight.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        ammo: game.combat.specialAmmo,
        chip: Boolean(document.querySelector('.hud-power[data-power="special"]')),
      };
    });
    await resources.waitForTimeout(900);
    const ammoOff = await resources.evaluate(() => ({
      ammo: window.__sky.game.combat.specialAmmo,
      chip: Boolean(document.querySelector('.hud-power[data-power="special"]')),
    }));

    // An empty tank ends the run — and the summary says why.
    const ranDry = await resources.evaluate(async () => {
      const game = window.__sky.game;
      game.combat.enemies.releaseAll();
      game.aircraft.controller.fuel = 0.0002;

      const started = performance.now();
      while (game.state.current === 'flying' && performance.now() - started < 4000) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      // A frame for the interface to show the summary.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        state: game.state.current,
        title: document.querySelector('.results-title')?.textContent ?? '',
      };
    });

    // Start again: none of it is inherited.
    await resources.evaluate(() => window.__sky.game.start());
    await resources.waitForTimeout(400);
    const restarted = await resources.evaluate(() => {
      const game = window.__sky.game;
      return {
        state: game.state.current,
        coins: game.telemetry().coins,
        fuel: game.telemetry().fuel,
        powerups: game.run.powerups.filter((slot) => slot.active).length,
        chips: document.querySelectorAll('.hud-power').length,
        speedScale: game.aircraft.controller.speedScale,
        special: game.combat.specialAmmo,
        hudCoins: document.querySelector('.hud-coins b')?.textContent ?? '',
      };
    });

    console.log(
      `   coin placed: ${coins.placed}   coins ${coins.before} -> ${collected.coins}` +
        `   HUD "${collected.hudCoins}"   still in the air: ${collected.inAir}`,
    );
    console.log(
      `   the same coin twice: ${doubleTake.first} then ${doubleTake.second}` +
        `   fuel ${fuelBefore.toFixed(3)} -> ${fuelBurned.toFixed(3)}` +
        ` -> canister -> ${afterRefuel.fuel.toFixed(3)}   HUD "${afterRefuel.hudFuel}"`,
    );
    console.log(
      `   boost: ${powerup.placed ? 'placed' : 'NOT PLACED'} -> active ${boosted.active}` +
        ` sc${boosted.speedScale.toFixed(2)} chip "${boosted.chipText}"` +
        `   after expiry: ${expired.active} sc${expired.speedScale}`,
    );
    console.log(
      `   heavy rounds: ${ammo.ammo} (chip ${ammo.chip}) -> ${ammoOff.ammo} (chip ${ammoOff.chip})` +
        `   empty tank: ${ranDry.state} "${ranDry.title}"`,
    );
    console.log(
      `   restart: coins ${restarted.coins} fuel ${restarted.fuel.toFixed(2)}` +
        ` power-ups ${restarted.powerups} chips ${restarted.chips}` +
        ` sc${restarted.speedScale} ammo ${restarted.special}   HUD "${restarted.hudCoins}"`,
    );

    if (!coins.placed) problems.push('no coin pattern could be placed to fly through');
    else {
      if (coins.inAir < 2) problems.push('a coin pattern was not laid out as a pattern');
      const gained = collected.coins - coins.before;
      if (gained <= 0) problems.push('flying through a coin credited nothing');
      if (gained > 1) problems.push(`flying through one coin credited ${gained} coins`);
      if (collected.hudCoins !== String(collected.coins)) {
        problems.push('the HUD coin count is not the run count');
      }
    }

    if (doubleTake.first !== 1) problems.push('a coin in reach was not credited');
    if (doubleTake.second !== 0) problems.push('the same coin was credited twice in one step');

    if (!(fuelBurned < fuelBefore)) problems.push('fuel did not fall while flying');
    if (!refuelled.placed) problems.push('could not place a fuel canister');
    else if (!(afterRefuel.fuel > fuelBurned)) problems.push('a fuel canister did not put fuel back');
    if (afterRefuel.fuel > 1) problems.push('a canister filled the tank past full');
    if (afterRefuel.hudFuel !== String(Math.round(afterRefuel.fuel * 100))) {
      problems.push('the HUD fuel readout does not match the tank');
    }

    if (!powerup.placed) problems.push('could not place a power-up orb');
    else {
      if (!boosted.active) problems.push('collecting a boost orb did not start the boost');
      if (!(boosted.speedScale > 1)) problems.push('the boost did not change the airframe');
      if (!boosted.chip) problems.push('no HUD chip appeared for the running power-up');
      if (!(boosted.remaining > 0)) problems.push('the power-up started with no time on it');
    }
    if (expired.active) problems.push('the power-up never expired');
    if (expired.speedScale !== 1) problems.push('the airframe kept the boost after it expired');
    if (expired.chip) problems.push('the HUD chip outlived the power-up');

    if (!ammo.ammo) problems.push('the special ammunition power-up did not load the gun');
    if (!ammo.chip) problems.push('no HUD chip appeared for the special ammunition');
    if (ammoOff.ammo) problems.push('the special ammunition never unloaded');
    if (ammoOff.chip) problems.push('the special ammunition chip outlived the effect');

    if (ranDry.state !== 'results') problems.push(`an empty tank left the game in "${ranDry.state}"`);
    if (!/out of fuel/i.test(ranDry.title)) problems.push(`the summary said "${ranDry.title}"`);

    if (restarted.state !== 'flying') problems.push('could not start a second run');
    if (restarted.coins !== 0) problems.push(`a new run started with ${restarted.coins} coins`);
    // A full tank, less whatever the four hundred milliseconds since the restart burned.
    if (!(restarted.fuel > 0.98)) problems.push(`a new run started with ${restarted.fuel} fuel`);
    if (restarted.powerups !== 0) problems.push('a new run inherited a running power-up');
    if (restarted.chips !== 0) problems.push('a new run inherited a HUD power-up chip');
    if (restarted.speedScale !== 1) problems.push('a new run inherited the boost');
    if (restarted.special) problems.push('a new run started with the gun still loaded');

    await resources.close();

    /*
     * The run's lifecycle. Everything here is driven through the real game — the start button,
     * the state machine, the flight model's own odometer, the fight's ramp, a tank running dry
     * and the Fly again button — rather than by calling the rules directly. What is checked is
     * that distance climbs with the aircraft, that difficulty follows distance rather than the
     * clock, that a pause holds every clock, that one run ends once, and that a replay starts
     * clean while the local record survives it.
     */
    console.log('\n12. Does the run lifecycle hold: distance, difficulty, pause, one ending, a clean replay?');
    const life = await browser.newPage({ viewport: { width: 1024, height: 640 } });
    await life.route('https://start.ng/**', (route) => route.abort());
    await life.goto(`${base}/`, { waitUntil: 'load' });
    await life.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });

    // A fresh page: no record left behind by another check, then boot again so it is read.
    await life.evaluate(() => localStorage.clear());
    await life.reload({ waitUntil: 'load' });
    await life.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
    await life.click('[data-action="start"]');
    await life.waitForTimeout(600);

    // (a) Distance climbs with the aircraft, at the rate the aircraft is flying.
    const sampleDistance = () =>
      life.evaluate(() => {
        const game = window.__sky.game;
        // Clear the fight, so nothing shoots or rams the aircraft being measured.
        game.combat.enemies.releaseAll();
        game.combat.obstacles.releaseAll();
        return {
          distance: window.__sky.telemetry().distance,
          speed: game.aircraft.controller.speed,
          at: performance.now(),
          hud: document.querySelector('.hud [data-field="distance"]')?.textContent ?? '',
        };
      });

    const distanceStart = await sampleDistance();
    await life.waitForTimeout(2000);
    const distanceEnd = await sampleDistance();

    /** `'4.3 km'` or `'840 m'` as metres, for comparing the readout with the odometer. */
    const hudMetres = (text) => {
      const value = Number.parseFloat(text);
      if (!Number.isFinite(value)) return Number.NaN;
      return text.trim().endsWith('km') ? value * 1000 : value;
    };

    // (b) Difficulty follows distance, not the clock.
    const difficultyOpening = await life.evaluate(() => window.__sky.telemetry().difficulty);
    const difficultyRamp = await life.evaluate(async () => {
      const game = window.__sky.game;
      // Half-way up the ramp after a few seconds of flying: only distance can explain it.
      game.aircraft.controller.distance = 1200 + 12000 / 2;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        level: window.__sky.telemetry().difficulty,
        elapsed: game.aircraft.controller.elapsed,
      };
    });
    // Put it back, so the ending below is measured from a known place.
    await life.evaluate(() => {
      window.__sky.game.aircraft.controller.distance = 0;
    });

    // (c) A pause holds every clock, not just the position.
    const pauseCheck = await life.evaluate(async () => {
      const game = window.__sky.game;
      game.run.activatePowerup('boost', 5);
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const sample = () => ({
        state: game.state.current,
        distance: game.telemetry().distance,
        fuel: game.telemetry().fuel,
        elapsed: game.aircraft.controller.elapsed,
        boost: game.run.remaining('boost'),
        enemies: game.combat.telemetry().enemies,
      });

      const paused = game.pause();
      const before = sample();
      await new Promise((resolve) => setTimeout(resolve, 700));
      const after = sample();
      game.resume();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const resumed = sample();
      return { paused, before, after, resumed };
    });

    // (d) One run, one ending — even when the tank empties on the same step as a collision.
    const ending = await life.evaluate(async () => {
      const game = window.__sky.game;
      const baseline = game.listeners.get('destroyed')?.size ?? 0;
      let reports = 0;
      const off = game.on('destroyed', () => {
        reports += 1;
      });

      const player = game.aircraft.controller;
      game.combat.enemies.releaseAll();
      game.combat.obstacles.releaseAll();
      game.pickups.releaseAll();
      game.run.addCoins(7);
      game.run.activatePowerup('boost', 30); // an effect that must not outlive the run
      player.distance = 4321;
      player.fuel = 0.0001;

      // A hazard dropped on the aircraft in the same step, to try to end the run twice.
      const hazard = game.combat.obstacles.spawn(player);
      if (hazard) {
        hazard.position.copy(player.position);
        hazard.anchorY = hazard.position.y;
      }

      const started = performance.now();
      while (game.state.current === 'flying' && performance.now() - started < 4000) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const reported = window.__sky.telemetry();
      const stopped = {
        distance: reported.distance,
        enemies: reported.enemies,
        shots: reported.playerShots,
        elapsed: reported.elapsed,
      };
      await new Promise((resolve) => setTimeout(resolve, 600));
      const later = window.__sky.telemetry();
      off();

      return {
        state: game.state.current,
        baseline,
        reports,
        reason: reported.reason,
        distance: stopped.distance,
        elapsed: stopped.elapsed,
        coins: reported.coins,
        kills: reported.kills,
        bestDistance: later.bestDistance,
        newBest: later.newBest,
        stored: localStorage.getItem('sky-combat.bestDistance.v1'),
        // The airframe, not telemetry: `speedScale` lives on the controller.
        boost: player.speedScale,
        coasted: later.distance,
        stopped,
        later,
        title: document.querySelector('.results-title')?.textContent ?? '',
        shownDistance: document.querySelector('.results [data-field="distance"]')?.textContent ?? '',
        shownBest: document.querySelector('.results [data-field="best"]')?.textContent ?? '',
        shownCoins: document.querySelector('.results [data-field="coins"]')?.textContent ?? '',
        recordShown: !document.querySelector('.results [data-role="record"]')?.hidden,
        placeholders: ['hangar', 'shop', 'leaderboard'].map((action) =>
          Boolean(document.querySelector(`.results [data-action="${action}"]`)?.disabled),
        ),
        pauseAfter: game.pause(),
      };
    });

    // (e) Fly again: a clean run that keeps the record.
    await life.click('[data-action="again"]');
    await life.waitForTimeout(350);
    const replay = await life.evaluate(() => {
      const game = window.__sky.game;
      const telemetry = window.__sky.telemetry();
      return {
        state: game.state.current,
        distance: telemetry.distance,
        coins: telemetry.coins,
        kills: telemetry.kills,
        enemies: game.combat.telemetry().enemies,
        obstacles: game.combat.telemetry().obstacles,
        shots: game.combat.telemetry().playerShots + game.combat.telemetry().enemyShots,
        powerups: game.run.powerups.filter((slot) => slot.active).length,
        speedScale: game.aircraft.controller.speedScale,
        special: game.combat.specialAmmo,
        bestDistance: telemetry.bestDistance,
        newBest: telemetry.newBest,
        listeners: game.listeners.get('destroyed')?.size ?? 0,
        resultsHidden: Boolean(document.querySelector('.results.is-hidden')),
        hud: document.querySelector('.hud [data-field="distance"]')?.textContent ?? '',
        hudRecord: Boolean(document.querySelector('.hud-distance.is-record')),
      };
    });

    // (f) The record survives a reload, and a worse run does not touch it.
    await life.reload({ waitUntil: 'load' });
    await life.waitForFunction(() => window.__sky?.ready, null, { timeout: 60000 });
    const afterReload = await life.evaluate(() => ({
      best: window.__sky.telemetry().bestDistance,
      menuBest: document.querySelector('[data-role="best"]')?.textContent ?? '',
    }));

    await life.click('[data-action="start"]');
    await life.waitForTimeout(400);
    const shorter = await life.evaluate(async () => {
      const game = window.__sky.game;
      const player = game.aircraft.controller;
      game.combat.enemies.releaseAll();
      game.combat.obstacles.releaseAll();
      player.distance = 300;
      player.fuel = 0.0001;

      const started = performance.now();
      while (game.state.current === 'flying' && performance.now() - started < 4000) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const telemetry = window.__sky.telemetry();
      return {
        best: telemetry.bestDistance,
        newBest: telemetry.newBest,
        recordShown: !document.querySelector('.results [data-role="record"]')?.hidden,
        shownBest: document.querySelector('.results [data-field="best"]')?.textContent ?? '',
      };
    });

    const flown = distanceEnd.distance - distanceStart.distance;
    const seconds = (distanceEnd.at - distanceStart.at) / 1000;
    const expectedMetres = ((distanceStart.speed + distanceEnd.speed) / 2) * seconds;

    console.log(
      `   distance: ${distanceStart.distance.toFixed(0)} m -> ${distanceEnd.distance.toFixed(0)} m` +
        ` in ${seconds.toFixed(2)} s at ~${distanceStart.speed.toFixed(0)} m/s` +
        ` (expected ~${expectedMetres.toFixed(0)} m)   HUD "${distanceEnd.hud}"`,
    );
    console.log(
      `   difficulty: ${difficultyOpening.toFixed(2)} at the start ->` +
        ` ${difficultyRamp.level.toFixed(2)} at 7.2 km, after only` +
        ` ${difficultyRamp.elapsed.toFixed(1)} s of flight`,
    );
    console.log(
      `   pause: ${pauseCheck.paused ? 'held' : 'NOT HELD'}` +
        `   distance ${pauseCheck.before.distance.toFixed(1)} -> ${pauseCheck.after.distance.toFixed(1)}` +
        `   fuel ${pauseCheck.before.fuel.toFixed(4)} -> ${pauseCheck.after.fuel.toFixed(4)}` +
        `   boost ${pauseCheck.before.boost.toFixed(2)} s -> ${pauseCheck.after.boost.toFixed(2)} s` +
        `   resumed at ${pauseCheck.resumed.state} with ${pauseCheck.resumed.boost.toFixed(2)} s left`,
    );
    console.log(
      `   ending: ${ending.state} after ${ending.reports} report(s), reason "${ending.reason}"` +
        ` — "${ending.title}"   distance frozen at ${ending.distance.toFixed(0)} m` +
        ` (coasted to ${ending.coasted.toFixed(0)} m)   coins ${ending.coins}` +
        `   boost left on: ${ending.boost}`,
    );
    console.log(
      `   record: ${ending.bestDistance} m stored as "${ending.stored}"` +
        `   panel "${ending.shownDistance}" best "${ending.shownBest}"` +
        ` new ${ending.recordShown}   placeholders disabled: ${ending.placeholders.join('/')}`,
    );
    console.log(
      `   replay: ${replay.state} at ${replay.distance.toFixed(0)} m, ${replay.coins} coins,` +
        ` ${replay.kills} kills, ${replay.enemies} enemies, ${replay.shots} shots,` +
        ` ${replay.powerups} power-ups, boost ×${replay.speedScale}` +
        `   record kept at ${replay.bestDistance} m   listeners ${replay.listeners}`,
    );
    console.log(
      `   reload: record ${afterReload.best} m, menu "${afterReload.menuBest}"` +
        `   shorter run: kept ${shorter.best} m, new best ${shorter.newBest},` +
        ` shown "${shorter.shownBest}"`,
    );

    if (!(flown > 0)) problems.push('distance did not increase while flying');
    else if (Math.abs(flown - expectedMetres) > expectedMetres * 0.2) {
      problems.push(
        `distance grew by ${flown.toFixed(0)} m in ${seconds.toFixed(2)} s, but the aircraft was` +
          ` flying at ~${distanceStart.speed.toFixed(0)} m/s (expected ~${expectedMetres.toFixed(0)} m)`,
      );
    }
    if (Math.abs(hudMetres(distanceEnd.hud) - distanceEnd.distance) > 5) {
      problems.push(`the HUD shows "${distanceEnd.hud}" for ${distanceEnd.distance.toFixed(0)} m`);
    }

    if (difficultyOpening > 0.02) problems.push(`a run started at difficulty ${difficultyOpening}`);
    if (!(difficultyRamp.level > 0.45 && difficultyRamp.level < 0.55)) {
      problems.push(`7.2 km of distance put the ramp at ${difficultyRamp.level}, not half-way`);
    }
    if (difficultyRamp.elapsed > 20) {
      problems.push('the ramp was measured against the clock, not the distance');
    }

    if (!pauseCheck.paused) problems.push('the game refused to pause while flying');
    if (pauseCheck.after.state !== 'paused') problems.push('pause did not hold the state');
    for (const field of ['distance', 'fuel', 'elapsed', 'boost', 'enemies']) {
      if (pauseCheck.after[field] !== pauseCheck.before[field]) {
        problems.push(`"${field}" kept moving while paused`);
      }
    }
    if (pauseCheck.resumed.state !== 'flying') problems.push('could not resume after pausing');
    if (!(pauseCheck.resumed.boost < pauseCheck.before.boost)) {
      problems.push('the power-up clock did not restart after resuming');
    }

    if (ending.state !== 'results') problems.push(`the run ended in "${ending.state}"`);
    if (ending.reports !== 1) problems.push(`one run produced ${ending.reports} game-over reports`);
    if (ending.reason !== 'fuel') problems.push(`an empty tank reported "${ending.reason}"`);
    if (!/out of fuel/i.test(ending.title)) problems.push(`the summary said "${ending.title}"`);
    if (!(ending.distance > 4300)) problems.push(`the run's distance was ${ending.distance}`);
    if (ending.coasted !== ending.distance) {
      problems.push(
        `the distance kept climbing after the run ended (${ending.distance} -> ${ending.coasted})`,
      );
    }
    if (ending.coins !== 7) problems.push(`the summary counted ${ending.coins} coins, not 7`);
    if (ending.shownCoins !== '7') problems.push(`the panel showed ${ending.shownCoins} coins`);
    if (ending.boost !== 1) problems.push('the speed boost survived the end of the run');
    if (ending.pauseAfter) problems.push('a finished run could still be paused');
    if (ending.stopped.enemies !== ending.later.enemies) {
      problems.push('the fight kept spawning after the run ended');
    }
    if (ending.stopped.shots !== ending.later.playerShots) {
      problems.push('shots kept flying after the run ended');
    }
    if (ending.stopped.elapsed !== ending.later.elapsed) {
      problems.push('the run clock kept counting after the run ended');
    }

    if (ending.bestDistance !== Math.round(ending.distance)) {
      problems.push(`the record is ${ending.bestDistance} m for a ${ending.distance.toFixed(1)} m run`);
    }
    if (ending.stored !== String(ending.bestDistance)) {
      problems.push(`the stored record is "${ending.stored}", not ${ending.bestDistance}`);
    }
    if (!ending.newBest) problems.push('the first run of a new browser was not a new record');
    if (!ending.recordShown) problems.push('the summary did not say the record had fallen');
    if (ending.shownDistance !== formatDistance(ending.distance)) {
      problems.push(`the panel showed "${ending.shownDistance}" for ${ending.distance.toFixed(1)} m`);
    }
    if (ending.shownBest !== formatDistance(ending.bestDistance)) {
      problems.push(`the panel showed "${ending.shownBest}" as the best`);
    }
    if (ending.placeholders.some((disabled) => !disabled)) {
      problems.push('the hangar, shop or leaderboard placeholder looks usable');
    }

    if (replay.state !== 'flying') problems.push(`Fly again left the game in "${replay.state}"`);
    if (!(replay.distance < 200)) problems.push(`a new run started ${replay.distance} m in`);
    if (replay.coins !== 0) problems.push(`a new run started with ${replay.coins} coins`);
    if (replay.kills !== 0) problems.push('a new run inherited kills');
    if (replay.enemies !== 0) problems.push('a new run started with the old enemies still up');
    if (replay.obstacles !== 0) problems.push('a new run started with the old hazards still up');
    if (replay.shots !== 0) problems.push('a new run started with shots still in the air');
    if (replay.powerups !== 0) problems.push('a new run inherited a running power-up');
    if (replay.speedScale !== 1) problems.push('a new run inherited the boost');
    if (replay.special) problems.push('a new run started with the gun loaded');
    if (replay.bestDistance !== ending.bestDistance) {
      problems.push(
        `the record changed from ${ending.bestDistance} to ${replay.bestDistance} on replay`,
      );
    }
    if (replay.newBest) problems.push('a fresh run claimed a new record before flying');
    if (replay.listeners !== ending.baseline) {
      problems.push(`replaying added a game-over listener (${ending.baseline} -> ${replay.listeners})`);
    }
    if (!replay.resultsHidden) problems.push('the summary stayed up over the new run');
    if (replay.hudRecord) problems.push('a new run started already past the record');
    if (Math.abs(hudMetres(replay.hud) - replay.distance) > 5) {
      problems.push(`the HUD shows "${replay.hud}" ${replay.distance.toFixed(0)} m into a new run`);
    }

    if (afterReload.best !== ending.bestDistance) {
      problems.push(`the record did not survive a reload (${afterReload.best})`);
    }
    if (afterReload.menuBest !== `Best flight: ${formatDistance(ending.bestDistance)}`) {
      problems.push(`the menu said "${afterReload.menuBest}"`);
    }
    if (shorter.best !== ending.bestDistance) {
      problems.push(`a worse run changed the record to ${shorter.best}`);
    }
    if (shorter.newBest) problems.push('a worse run claimed a new record');
    if (shorter.recordShown) problems.push('a worse run was announced as a record');
    if (shorter.shownBest !== formatDistance(ending.bestDistance)) {
      problems.push(`the panel showed "${shorter.shownBest}" as the best after a worse run`);
    }

    await life.close();

    // ---------------------------------------------------------------- teardown
    console.log('\n13. Does renderer cleanup run cleanly?');


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
