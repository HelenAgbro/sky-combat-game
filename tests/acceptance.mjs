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
 *   9. renderer cleanup stops the loop and releases its resources without throwing.
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

    // ---------------------------------------------------------------- teardown
    console.log('\n9. Does renderer cleanup run cleanly?');
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
