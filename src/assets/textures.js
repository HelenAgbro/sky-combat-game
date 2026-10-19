/**
 * Sky Combat — procedural texture factory.
 *
 * start.ng serves only a fixed list of file types and the game ships no image
 * files at all, so every material map is painted into a canvas at runtime:
 * paint, panel lines, rivets, hatches, stencils, weathering, plus the roughness
 * and normal maps derived from the same deterministic layout. A seeded random
 * generator keeps a build identical every time it runs.
 *
 * This module is browser-only (it uses <canvas>), which is why it is never
 * imported by the unit tests.
 */
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearSRGBColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { createSeededRandom } from '../game/math.js';

/** The seeded generator lives in `game/math.js` so the layout modules share it. */
const seededRandom = createSeededRandom;

function createCanvas(size, height = size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = height;
  return canvas;
}

/** A texture that tiles seamlessly and is ready to hand to a material. */
function toTexture(canvas, { srgb = false, repeat = 1 } = {}) {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
  return texture;
}

/** Sobel filter over a greyscale height canvas, producing a tangent-space normal map. */
function heightToNormal(heightCanvas, strength = 2.4) {
  const size = heightCanvas.width;
  const source = heightCanvas.getContext('2d').getImageData(0, 0, size, size).data;
  const target = createCanvas(size);
  const context = target.getContext('2d');
  const output = context.createImageData(size, size);

  const height = (x, y) => {
    const cx = ((x % size) + size) % size;
    const cy = ((y % size) + size) % size;
    return source[(cy * size + cx) * 4] / 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx =
        height(x - 1, y - 1) + 2 * height(x - 1, y) + height(x - 1, y + 1) -
        (height(x + 1, y - 1) + 2 * height(x + 1, y) + height(x + 1, y + 1));
      const dy =
        height(x - 1, y - 1) + 2 * height(x, y - 1) + height(x + 1, y - 1) -
        (height(x - 1, y + 1) + 2 * height(x, y + 1) + height(x + 1, y + 1));
      const index = (y * size + x) * 4;
      output.data[index] = 128 + Math.max(-127, Math.min(127, dx * strength * 255 * 0.25));
      output.data[index + 1] = 128 + Math.max(-127, Math.min(127, dy * strength * 255 * 0.25));
      output.data[index + 2] = 255;
      output.data[index + 3] = 255;
    }
  }

  context.putImageData(output, 0, 0);
  return target;
}

/**
 * The panel layout of an airframe: transverse frames, longitudinal joints,
 * access hatches and rivet rows. Generated once and drawn into every map so the
 * albedo, roughness and normal agree with each other.
 */
function generatePanelLayout(size, random) {
  const frames = [];
  let at = size * 0.06;
  while (at < size) {
    frames.push({ at, width: random() < 0.25 ? 2 : 1.1, depth: 0.55 + random() * 0.45 });
    at += size * (0.12 + random() * 0.15);
  }

  const longitudinals = [];
  at = size * 0.3;
  while (at < size * 0.95) {
    longitudinals.push({ at, width: random() < 0.3 ? 1.8 : 1, depth: 0.4 + random() * 0.5 });
    at += size * (0.22 + random() * 0.12);
  }

  const hatches = [];
  for (let i = 0; i < 4; i += 1) {
    hatches.push({
      x: random() * size * 0.88,
      y: random() * size * 0.88,
      w: size * (0.05 + random() * 0.08),
      h: size * (0.03 + random() * 0.05),
    });
  }

  const rivets = [];
  for (let i = 0; i < 4; i += 1) {
    rivets.push({ y: random() * size, count: 10 + Math.floor(random() * 14), inset: size * 0.08 });
  }

  return { frames, longitudinals, hatches, rivets };
}

/** Draw the panel layout. `alpha` and `shade` control whether it reads as paint or as height. */
function drawPanelLayout(context, layout, size, { alpha, shade = '#000000' }) {
  context.save();
  context.strokeStyle = shade;
  context.globalAlpha = alpha;

  for (const frame of layout.frames) {
    context.lineWidth = frame.width;
    context.beginPath();
    context.moveTo(0, frame.at);
    context.lineTo(size, frame.at);
    context.stroke();
  }
  for (const line of layout.longitudinals) {
    context.lineWidth = line.width;
    context.beginPath();
    context.moveTo(line.at, 0);
    context.lineTo(line.at, size);
    context.stroke();
  }

  context.globalAlpha = alpha * 0.8;
  for (const hatch of layout.hatches) {
    context.lineWidth = 1.6;
    context.beginPath();
    context.roundRect(hatch.x, hatch.y, hatch.w, hatch.h, 3);
    context.stroke();
  }

  context.globalAlpha = alpha * 0.55;
  context.fillStyle = shade;
  for (const row of layout.rivets) {
    for (let i = 0; i < row.count; i += 1) {
      const x = row.inset + (i / row.count) * (size - row.inset * 2);
      context.beginPath();
      context.arc(x, row.y, 1.1, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.restore();
}
/** Soft tonal variation across the paint, so a flat colour never looks like plastic. */
function paintMottle(context, size, random, amount = 0.06) {
  for (let i = 0; i < 180; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = size * (0.03 + random() * 0.12);
    const light = random() > 0.5;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(
      0,
      `rgba(${light ? '255,255,255' : '0,0,0'},${amount * (0.4 + random() * 0.6)})`,
    );
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

/** Exhaust staining, dirt streaks and a walkway along the spine. */
function paintWeathering(context, size, random, livery, { accentStripe = true } = {}) {
  context.save();

  const stain = context.createLinearGradient(0, size * 0.72, 0, size);
  stain.addColorStop(0, 'rgba(20,18,16,0)');
  stain.addColorStop(1, 'rgba(20,18,16,0.5)');
  context.fillStyle = stain;
  context.fillRect(0, size * 0.72, size, size * 0.28);

  for (let i = 0; i < 60; i += 1) {
    const x = random() * size;
    const y = random() * size * 0.85;
    const length = size * (0.02 + random() * 0.09);
    const gradient = context.createLinearGradient(x, y, x, y + length);
    gradient.addColorStop(0, `rgba(30,28,26,${0.1 + random() * 0.16})`);
    gradient.addColorStop(1, 'rgba(30,28,26,0)');
    context.fillStyle = gradient;
    context.fillRect(x, y, 1 + random() * 2.5, length);
  }

  context.fillStyle = 'rgba(24,24,26,0.18)';
  context.fillRect(size * 0.46, size * 0.2, size * 0.08, size * 0.6);

  // The squadron flash runs along the forward fuselage only: on a wing or fin the
  // UVs run the other way, so it is left off the unmarked material.
  if (accentStripe) {
    context.fillStyle = livery.accent;
    context.globalAlpha = 0.85;
    context.beginPath();
    context.moveTo(0, size * 0.055);
    context.lineTo(size * 0.22, size * 0.075);
    context.lineTo(size * 0.22, size * 0.095);
    context.lineTo(0, size * 0.082);
    context.closePath();
    context.fill();
  }

  context.restore();
}

/** Low-visibility roundel, serial number and stencil lettering. */
function paintMarkings(context, size, livery, markings, random) {
  context.save();

  const cx = size * 0.5;
  const cy = size * 0.82;
  const radius = size * 0.055;
  context.globalAlpha = 0.75;
  context.strokeStyle = markings.roundel ?? '#d7d9d4';
  context.lineWidth = size * 0.012;
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = livery.accent;
  context.globalAlpha = 0.7;
  context.beginPath();
  context.arc(cx, cy, radius * 0.42, 0, Math.PI * 2);
  context.fill();

  context.globalAlpha = 0.5;
  context.fillStyle = '#e6e7e3';
  context.font = `700 ${Math.round(size * 0.028)}px system-ui, sans-serif`;
  context.fillText(markings.title ?? 'SKY COMBAT', size * 0.06, size * 0.35);
  context.font = `600 ${Math.round(size * 0.019)}px system-ui, sans-serif`;
  context.fillText(markings.serial ?? 'SC-001', size * 0.06, size * 0.395);

  context.globalAlpha = 0.32;
  context.font = `700 ${Math.round(size * 0.014)}px system-ui, sans-serif`;
  context.fillText('NO STEP', size * 0.6, size * 0.62);
  context.fillText('RESCUE', size * 0.28, size * 0.94);

  context.restore();
}

/**
 * Repainted panels: a handful of large patches in a slightly different tone, which
 * is what a real airframe looks like after a few years of depot maintenance. Painted
 * with soft edges so they read as paint rather than as decals.
 */
function paintPatches(context, size, random, livery) {
  context.save();
  for (let i = 0; i < 5; i += 1) {
    const x = random() * size * 0.8;
    const y = random() * size * 0.8;
    const w = size * (0.12 + random() * 0.2);
    const h = size * (0.06 + random() * 0.14);
    context.globalAlpha = 0.1 + random() * 0.1;
    context.fillStyle = random() > 0.5 ? livery.paint : livery.dark;
    context.fillRect(x, y, w, h);
  }
  context.restore();
}

/**
 * Paint chipped along panel lines and fastener rows, exposing primer underneath.
 * Small and sparse on purpose: at the distance the chase camera sits, the effect has
 * to be felt rather than seen, and heavy chipping looks like noise.
 */
function paintChips(context, layout, size, random) {
  context.save();
  context.globalAlpha = 0.3;
  context.fillStyle = '#b9b4a8';

  const chipAt = (x, y, radius) => {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  };

  for (let i = 0; i < 220; i += 1) {
    const frame = layout.frames[Math.floor(random() * layout.frames.length)];
    if (!frame) break;
    chipAt(random() * size, frame.at + (random() - 0.5) * 3, 0.8 + random() * 1.5);
  }
  for (let i = 0; i < 120; i += 1) {
    const line = layout.longitudinals[Math.floor(random() * layout.longitudinals.length)];
    if (!line) break;
    chipAt(line.at + (random() - 0.5) * 3, random() * size, 0.8 + random() * 1.4);
  }

  context.restore();
}

/** Maintenance stencils: the ejection triangle, a danger band and a fuel cap. */
function paintStencils(context, size, random) {
  context.save();
  context.globalAlpha = 0.42;
  context.fillStyle = '#e8e6df';
  context.strokeStyle = '#e8e6df';
  context.lineWidth = Math.max(1, size * 0.0035);

  // The ejection warning triangle, just below the cockpit.
  const tx = size * 0.34;
  const ty = size * 0.48;
  const tr = size * 0.028;
  context.beginPath();
  context.moveTo(tx, ty - tr);
  context.lineTo(tx + tr * 0.9, ty + tr * 0.7);
  context.lineTo(tx - tr * 0.9, ty + tr * 0.7);
  context.closePath();
  context.stroke();
  context.font = `700 ${Math.round(size * 0.016)}px system-ui, sans-serif`;
  context.fillText('EJECT', tx - tr * 0.62, ty + tr * 0.55);

  context.font = `700 ${Math.round(size * 0.013)}px system-ui, sans-serif`;
  context.fillText('DANGER', size * 0.72, size * 0.3);
  context.fillText('INTAKE', size * 0.72, size * 0.325);

  // A fuel cap: a ring with a small bar across it.
  const fx = size * (0.15 + random() * 0.5);
  const fy = size * 0.62;
  const fr = size * 0.018;
  context.beginPath();
  context.arc(fx, fy, fr, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(fx - fr, fy);
  context.lineTo(fx + fr, fy);
  context.stroke();

  context.restore();
}

/** Gun-gas staining: a dark smudge aft of the muzzle, forward of the wing root. */
function paintGunGas(context, size, random) {
  context.save();
  const x = size * 0.44;
  const y = size * 0.6;
  const gradient = context.createRadialGradient(x, y, 0, x, y, size * 0.16);
  gradient.addColorStop(0, 'rgba(18,16,14,0.4)');
  gradient.addColorStop(0.5, 'rgba(18,16,14,0.16)');
  gradient.addColorStop(1, 'rgba(18,16,14,0)');
  context.fillStyle = gradient;
  context.fillRect(x - size * 0.2, y - size * 0.2, size * 0.4, size * 0.4);

  for (let i = 0; i < 18; i += 1) {
    const streak = size * (0.03 + random() * 0.1);
    context.fillStyle = `rgba(16,14,12,${0.1 + random() * 0.14})`;
    context.fillRect(x + (random() - 0.5) * size * 0.05, y, 1 + random() * 2, streak);
  }
  context.restore();
}

/**
 * The full material set for one airframe: paint, roughness and panel-line relief.
 *
 * `markings: false` omits the roundel, the stencils and the squadron flash. That is
 * used for wings, tailplanes and fins, whose UVs run across the span rather than
 * along the fuselage — stencils painted for a fuselage land in the wrong place on a
 * wing, where they read as stray patches rather than markings.
 *
 * @param {{paint:string, accent:string, dark:string}} livery
 * @param {{size?:number, seed?:number, markings?:object|false}} [options]
 * @returns {{map:CanvasTexture, roughnessMap:CanvasTexture, normalMap:CanvasTexture}}
 */
export function createPaintTextureSet(livery, { size = 1024, seed = 7, markings = {} } = {}) {
  const random = seededRandom(seed);
  const layout = generatePanelLayout(size, random);
  const marked = markings !== false;

  const albedo = createCanvas(size);
  const paint = albedo.getContext('2d');
  paint.fillStyle = livery.paint;
  paint.fillRect(0, 0, size, size);
  paintMottle(paint, size, random);
  paintPatches(paint, size, random, livery);
  drawPanelLayout(paint, layout, size, { alpha: 0.22 });
  paintWeathering(paint, size, random, livery, { accentStripe: marked });
  if (marked) paintGunGas(paint, size, random);
  paintChips(paint, layout, size, random);
  if (marked) {
    paintMarkings(paint, size, livery, markings, random);
    paintStencils(paint, size, random);
  }

  // Roughness: worn paint and grime are rougher than fresh paint.
  const roughness = createCanvas(size);
  const rough = roughness.getContext('2d');
  rough.fillStyle = '#c8c8c8';
  rough.fillRect(0, 0, size, size);
  paintMottle(rough, size, random, 0.14);
  drawPanelLayout(rough, layout, size, { alpha: 0.2, shade: '#ffffff' });
  const grime = rough.createLinearGradient(0, size * 0.7, 0, size);
  grime.addColorStop(0, 'rgba(255,255,255,0)');
  grime.addColorStop(1, 'rgba(255,255,255,0.35)');
  rough.fillStyle = grime;
  rough.fillRect(0, size * 0.7, size, size * 0.3);

  // Height: panel lines and hatches recessed, rivet rows raised.
  const height = createCanvas(size);
  const relief = height.getContext('2d');
  relief.fillStyle = '#808080';
  relief.fillRect(0, 0, size, size);
  drawPanelLayout(relief, layout, size, { alpha: 0.5, shade: '#3a3a3a' });
  relief.globalAlpha = 0.35;
  relief.fillStyle = '#a8a8a8';
  for (const row of layout.rivets) {
    for (let i = 0; i < row.count; i += 1) {
      const x = row.inset + (i / row.count) * (size - row.inset * 2);
      relief.beginPath();
      relief.arc(x, row.y, 1.4, 0, Math.PI * 2);
      relief.fill();
    }
  }

  return {
    map: toTexture(albedo, { srgb: true }),
    roughnessMap: toTexture(roughness),
    normalMap: toTexture(heightToNormal(height, 1.0)),
  };
}

/**
 * A soft radial glow, for engine exhaust and impact flashes.
 * White at the centre fading to transparent, so it can be tinted and added.
 */
export function createGlowTexture({ size = 128 } = {}) {
  const canvas = createCanvas(size);
  const context = canvas.getContext('2d');
  const half = size / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A card, not a surface: clouds and cirrus must not tile, so their edges clamp. */
function toCard(canvas, { srgb = false } = {}) {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
  return texture;
}

/** Cut the alpha down to a soft-edged shape so a billboard has no visible border. */
function fadeEdges(context, width, height, inset = 0.06) {
  context.save();
  context.globalCompositeOperation = 'destination-in';
  const cx = width * 0.5;
  const cy = height * 0.5;
  const radius = Math.max(width, height) * 0.5;
  const gradient = context.createRadialGradient(cx, cy, radius * (1 - inset * 2.2), cx, cy, radius);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.72, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.restore();
}

/**
 * A cumulus card: puffs stacked into a flat-bottomed, rounded-topped silhouette, lit
 * from above, with the edges feathered away so the quad never shows a hard border.
 *
 * The card is wider than it is tall because clouds are wider than they are tall from
 * the air, and one card is shared by every cloud in the field.
 *
 * @param {{size?:number, seed?:number, puffs?:number}} [options]
 */
export function createCloudTexture({ size = 256, seed = 3, puffs = 30 } = {}) {
  const random = seededRandom(seed);
  const width = size;
  const height = Math.round(size * 0.6);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  for (let i = 0; i < puffs; i += 1) {
    const t = i / Math.max(1, puffs - 1);
    const x = width * (0.14 + random() * 0.72);
    // Taller toward the middle of the card, flatter at the ends: a dome, not a bar.
    const dome = Math.sin(Math.PI * t) ** 0.7;
    const y = height * (0.74 - dome * 0.36 * random() - random() * 0.1);
    const radius = width * (0.09 + random() * 0.12) * (0.65 + dome * 0.7);

    const gradient = context.createRadialGradient(x, y - radius * 0.25, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.5, 'rgba(246,249,255,0.52)');
    gradient.addColorStop(1, 'rgba(222,232,246,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  // Shade the underside: a cloud lit from above is bright on top and grey beneath.
  const shade = context.createLinearGradient(0, height * 0.45, 0, height);
  shade.addColorStop(0, 'rgba(140,156,178,0)');
  shade.addColorStop(1, 'rgba(126,142,166,0.42)');
  context.globalCompositeOperation = 'source-atop';
  context.fillStyle = shade;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = 'source-over';

  fadeEdges(context, width, height, 0.04);
  return toCard(canvas, { srgb: true });
}

/**
 * A cirrus card: long, thin, semi-transparent wisps for the high layer. Drawn as
 * soft ellipses so the streaks have no hard ends, then feathered at the edges.
 *
 * @param {{size?:number, seed?:number, streaks?:number}} [options]
 */
export function createCirrusTexture({ size = 512, seed = 5, streaks = 110 } = {}) {
  const random = seededRandom(seed);
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');

  for (let i = 0; i < streaks; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const length = size * (0.1 + random() * 0.42);
    const thickness = size * (0.004 + random() * 0.016);
    const alpha = 0.12 + random() * 0.24;

    context.save();
    context.translate(x, y);
    context.rotate((random() - 0.5) * 0.5);

    const gradient = context.createLinearGradient(-length * 0.5, 0, length * 0.5, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.4, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.9})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(0, 0, length * 0.5, thickness, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  fadeEdges(context, size, size, 0.12);
  return toCard(canvas, { srgb: true });
}

/**
 * Sea surface maps.
 *
 * A wave normal map built from summed sine waves, so it tiles seamlessly. Two sets
 * are generated: a long swell, and a fine ripple at a much shorter wavelength. The
 * fine set is only used close to the camera — `scene/World.js` blends it out with
 * distance — because fine detail in a tiled normal map cannot survive being viewed at
 * a grazing angle from 400 m up: the sampling aliases into a visible grating.
 *
 * There is still deliberately no colour map: a tinted map tiles visibly from altitude,
 * and the water reads better as a tinted, reflective surface with a normal map than as
 * a repeating photograph.
 *
 * @param {{size?:number, seed?:number, waveScale?:number, amplitude?:number}} [options]
 */
export function createSeaTextureSet({ size = 512, seed = 11, waveScale = 1, amplitude = 1 } = {}) {
  const random = seededRandom(seed);
  const waves = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = random() * Math.PI * 2;
    const wavelength = (40 + random() * 150) * waveScale;
    waves.push({
      kx: (Math.cos(angle) * Math.PI * 2) / wavelength,
      ky: (Math.sin(angle) * Math.PI * 2) / wavelength,
      amplitude: (0.3 + random() * 0.7) * amplitude,
      phase: random() * Math.PI * 2,
    });
  }

  const normalCanvas = createCanvas(size);
  const normalContext = normalCanvas.getContext('2d');
  const image = normalContext.createImageData(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let dx = 0;
      let dy = 0;
      for (const wave of waves) {
        const slope = wave.amplitude * Math.cos(wave.kx * x + wave.ky * y + wave.phase);
        dx += slope * wave.kx;
        dy += slope * wave.ky;
      }
      // A low slope keeps the sea reading as water rather than a woven texture.
      const nx = -dx * 0.45;
      const ny = -dy * 0.45;
      const length = Math.hypot(nx, ny, 1);
      const index = (y * size + x) * 4;
      image.data[index] = 128 + (nx / length) * 127;
      image.data[index + 1] = 128 + (ny / length) * 127;
      image.data[index + 2] = 128 + (1 / length) * 127;
      image.data[index + 3] = 255;
    }
  }
  normalContext.putImageData(image, 0, 0);

  return { normalMap: toTexture(normalCanvas) };
}

