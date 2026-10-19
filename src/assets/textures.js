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
import { CanvasTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';

/** Small deterministic PRNG, so the same seed always paints the same airframe. */
function seededRandom(seed = 1) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

function createCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
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
  drawPanelLayout(paint, layout, size, { alpha: 0.22 });
  paintWeathering(paint, size, random, livery, { accentStripe: marked });
  if (marked) paintMarkings(paint, size, livery, markings, random);

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
 * Sea surface maps.
 *
 * Today that is a wave normal map built from summed sine waves, so it tiles
 * seamlessly. There is deliberately no colour map yet: a tinted map tiles visibly
 * from altitude, and a proper depth-and-foam water shader belongs in Stage 4 with
 * the rest of the environment work.
 */
export function createSeaTextureSet({ size = 512, seed = 11 } = {}) {
  const random = seededRandom(seed);
  const waves = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = random() * Math.PI * 2;
    /*
     * Long, gentle swell only. Fine detail in a tiled normal map cannot survive
     * being viewed at a grazing angle from 400 m up: the sampling aliases into a
     * visible grating. Stage 4 replaces this with a water shader that fades its
     * detail out with distance, which is the only honest way to have both.
     */
    const wavelength = 40 + random() * 150;
    waves.push({
      kx: (Math.cos(angle) * Math.PI * 2) / wavelength,
      ky: (Math.sin(angle) * Math.PI * 2) / wavelength,
      amplitude: 0.3 + random() * 0.7,
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

