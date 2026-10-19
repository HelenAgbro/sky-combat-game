# Asset pipeline

## The constraint

start.ng serves a fixed list of file types:

```
html htm css js mjs json map txt svg png jpg jpeg gif webp avif ico woff woff2 ttf otf mp3 ogg wav mp4 webm wasm
```

**`.glb`, `.gltf`, `.bin`, `.hdr`, `.ktx2` and `.exr` are not on that list**, and
anything not on it is skipped when the game is published. A model shipped as
`assets/falcon.glb` would simply not exist on the live site, and the game would load
nothing. This was checked against the live platform: none of the live 3D games on
start.ng ship a `.glb` either.

So the project has two paths, and `AircraftFactory` picks between them per aircraft:

```
AircraftFactory.create(id)
  ├─ 1. assets/modelRegistry.js → fetch models/<id>.json → GLTFLoader.parse  (licensed model)
  ├─ 2. assets/models/Fighter.js → build the airframe in code                (default)
  └─ 3. if a payload exists but fails to parse: warn, fall back to 2, never crash
```

## Path A — the airframe is built in code (temporary, what ships today)

> **This is temporary artwork.** No licensed aircraft model is available yet, and
> start.ng cannot serve `.glb`/`.gltf` files in any case. The airframes below are
> complete, fully-modelled shapes rather than placeholder primitives, but they stand
> in for real artwork and the main menu labels them as temporary. Replacing them with
> path B below requires no code changes.

Every aircraft in `src/data/aircraft.js` is described by numbers, and
`src/assets/models/Fighter.js` turns those numbers into a real mesh:

- the fuselage is a **lofted hull**: ten cross-sections along the length, each a
  superellipse ring, joined into a closed surface with caps;
- wings, tailplanes, foreplanes and fins are **real airfoils** (NACA-style thickness
  distribution, cosine-spaced points) lofted along their span, with sweep, dihedral,
  taper and camber taken from the data;
- details are lofted too: the canopy bubble, the intake duct and its dark throat, the
  petal-ribbed nozzles, under-wing pylons and stores, and wingtip missiles with fins.

`src/assets/loft.js` does the geometry and is covered by unit tests: a lofted cylinder
is asserted to be closed, correctly wound (positive signed volume), the right size, and
to survive mirroring across the centreline with its winding reversed so lighting stays
correct.

**Materials are generated, not loaded.** `src/assets/textures.js` paints a paint map, a
roughness map and a panel-line normal map into a canvas at runtime from a seeded random
generator, so a build is identical every time and the game ships **no image files at
all**. The normal map is derived from a height canvas with a Sobel filter, so the panel
lines and rivets carry real relief. The fuselage gets the marked set (roundel, stencils,
squadron flash); wings and fins get the same panel layout without the markings, because
their UVs run across the span and a fuselage stencil lands in the wrong place on a wing.

The upshot: four distinct aircraft, no licensing questions, no asset files, and a bundle
that is essentially Three.js.

## Path B — a licensed model, packed for start.ng

If a licensed model is provided, it is converted at build time into a file type start.ng
*does* serve:

```bash
# put falcon.glb in assets/ (source art, never shipped), then:
npm run models      # → public/models/falcon.json  {"format":"glb","bytes":N,"data":"<base64>"}
npm run build       # → dist/models/falcon.json
```

- `tools/pack-models.mjs` wraps the GLB bytes in base64 inside a **`.json`** file. The
  payload deliberately lives in a *data* file rather than a `.js` module: start.ng
  refuses files that run "code hidden in an encoded string" (`obfuscated_code`), and a
  JSON payload is data, not code.
- A GLB is self-contained — geometry, materials and textures in one binary — so a single
  `.json` file carries the whole model and no sidecar files are needed.
- `src/assets/base64.js` decodes it (using `Uint8Array.fromBase64` where the browser has
  it, otherwise in chunks so a large model cannot overflow the call stack) and hands the
  `ArrayBuffer` to `GLTFLoader.parse`, which reads a GLB from its magic header.
- `vite.config.js` scans `public/models/` and injects the list as `__PACKED_MODELS__`, so
  the game never asks for a payload that is not there — a speculative fetch would log a
  404 in the player's console for nothing.
- A payload that exists but will not parse is reported and the procedural airframe is
  used instead. A bad model can never stop the game from starting.

**Verify the path before committing to it.** `npm run models:probe` writes a tiny
synthetic GLB (a single triangle) as `public/models/probe.json`. Build, push to a branch
and run `npm run startng:check`: if start.ng accepts it, path B is proven. The unit tests
in `tests/assets.test.mjs` already validate the GLB's structure (magic number, version,
chunk lengths, buffer views, accessor types) and that the base64 payload decodes back to
the original bytes.

## Provenance

| Asset | Source | Licence |
| --- | --- | --- |
| All four aircraft (`falcon`, `viper`, `titan`, `phantom`) | Generated in code by this project (`src/assets/models/Fighter.js`) | MIT, same as this repository |
| Paint, roughness and normal maps | Generated at runtime by this project (`src/assets/textures.js`) | MIT, same as this repository |
| Sea wave normal map | Generated at runtime by this project | MIT, same as this repository |
| Sky, sun and environment map | Generated at runtime by this project (`src/scene/Sky.js`) | MIT, same as this repository |

There are currently **no third-party assets in this project**. If a licensed model is
added under `assets/`, record it in this table with its author, source URL and licence,
and keep the licence text alongside the file. `assets/` is source art: it is never copied
into `dist/` and never served.

## What is deliberately not here yet

- **A water shader.** The sea is a flat surface with a tiled wave normal map. Fine detail
  in a tiled normal map cannot survive being viewed at a grazing angle from 400 m up — it
  aliases into a visible grating — so the normals are kept subtle. A shader that fades its
  detail with distance is the honest fix, and it belongs in Stage 4 with the rest of the
  environment work.
- **Terrain.** The zones in `src/data/zones.js` carry their palettes and atmosphere, which
  the sky and the surface already use. Geometry arrives in Stage 4.
