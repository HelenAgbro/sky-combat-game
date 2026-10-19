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

## What was inspected, and what the licences actually say

Every asset in this project is either generated in code or not here at all. Before
building anything, the obvious sources were checked against their own published terms.
These are quotations, not inferences — no licence in this table is assumed.

| Source | What it has | Licence, as published | Why it is not used here |
| --- | --- | --- | --- |
| [Kenney](https://kenney.nl/support) | Stylised low-poly vehicles, a space kit | **CC0.** "all game assets on the asset pages are public domain licensed (CC0)… Attribution is not required." | No detailed aircraft. The vehicles are cartoon-simple, which would be a step down from the code-built airframe |
| [Quaternius](https://quaternius.com/license.html) | Spaceships, tanks, cars, trains | **Not CC0.** The Quaternius Asset License (QAL) v1.0 grants commercial use with no credit, but forbids redistributing the assets themselves: "you may not resell or redistribute the Assets… as a standalone asset, asset pack, stock file, template, or similar product" | No modern fighter airframe, and a committed `dist/` ships the model inside a distributable build — the kind of redistribution the licence is aimed at |
| [OpenGameArt, "fighter jets"](https://opengameart.org/content/fighter-jets) | Lo-poly aircraft | **CC0** (author Captain_Ahab_62): "cc-0, but it'd be nice if you gave me credit" | Distributed as `.blend` only, described by the author as "relatively lo-poly aircraft originally for ysflight". It would need a Blender conversion step that cannot be verified here, for less detail than already exists |
| [NASA 3D Resources](https://www.nasa.gov/3d-resources/) | Spacecraft, rovers, the ISS | "All of these resources are free to download and use", subject to NASA's usage guidelines; NASA's insignia and identity are protected | No modern fighter airframe, and putting NASA's identity into a combat game is what those guidelines exist to prevent |

**Also considered, not verified in this pass:** Poly Haven (CC0, environments and props),
Poly Pizza and Sketchfab (per-asset licences that mix CC0, CC-BY, CC-BY-SA and
"editorial use only"). Each would need its licence read per model, and a model whose
embedded textures push the packed payload past start.ng's limits would be rejected at
publish time regardless. **Nothing from any of these is in this repository.**

**Conclusion: no suitable licensed fighter airframe is available.** The airframes stay
built in code, they stay labelled temporary in the menu and in this document, and the
sections below record what a replacement would have to be.

## What a replacement model has to satisfy

If a licensed model is provided, it needs to meet all of these to be usable:

| Requirement | Value | Why |
| --- | --- | --- |
| Format | glTF 2.0 binary, one `.glb`, no sidecars | `tools/pack-models.mjs` base64s a single file into `models/<id>.json`. A `.gltf` referencing external `.bin` or texture files cannot be packed as one payload |
| Licence | CC0 preferred; CC-BY acceptable if the author, source URL and licence text are recorded here and shown in the credits | This repository is MIT, and `dist/` is committed and republished |
| Payload size | ≤ 8 MB as a `.glb` | base64 adds a third on top, and start.ng enforces a published size budget |
| Textures | ≤ 2048², PNG or JPEG, embedded in the GLB | A single 4K set can exceed the whole budget, and start.ng does not serve `.ktx2` |
| Triangle count | 15,000–60,000 for the player aircraft | Below that it is not an upgrade on what is already here; above it the frame budget goes on the model instead of the sky |
| Orientation | Nose along **−Z**, up along **+Y**, origin at the centre of gravity | The flight model, the chase camera, the boundaries and the engine glow all assume this |
| Scale | Metres, wingspan 8–14 m | The camera's framing check and the 60 m floor are tuned to a real-world scale |
| Materials | PBR metallic-roughness, embedded | The lighting, the environment map and the tone mapping are built for it |
| Nice to have | Named `nozzle` and `aileron_l` / `elevator_r` / `rudder` nodes | Stage 5 could drive the exhaust and the moving surfaces from them. **Nothing reads them today**: the glow comes from `data/aircraft.js` and the surfaces are built by `assets/models/Fighter.js` |

A model that meets the above drops in with no code change: put it in `assets/`, run
`npm run models`, then `npm run build`. `AircraftFactory` prefers a packed model and
falls back to the code-built airframe, so a bad payload cannot stop the game starting.

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
- details are lofted too: the canopy bubble and its two frame arches, the intake duct and
  its dark throat, the petal-ribbed nozzles, under-wing pylons and stores, wingtip
  missiles with fins, ventral fins, an air-data probe on the nose and a gun muzzle at
  the wing root;
- the **moving surfaces are separate objects hinged where they belong**: all-moving
  stabilators pivoting at 30% of their root chord, flaperons on the wing's trailing edge
  from 22% to 96% of the half-span, and a rudder on each fin's trailing edge. Each is
  built in a pivot group whose origin is its hinge, so `aircraft/surfaces.js` can deflect
  it and the surface moves about the hinge rather than about the aircraft's origin;
- **navigation lights** — red to port, green to starboard, white on the tail — as three
  unlit, un-tone-mapped spheres, which is the cheapest thing that reads as a light at the
  distance the chase camera sits.

The flaperons are lofted at the wing's own spanwise parameters (`spanFraction`,
`chordScale`, `chordShift` in `buildLiftingSurface`), so they follow the wing's taper,
sweep and dihedral exactly instead of approximating them. `tests/assets.test.mjs` asserts
that each hinge lands on the edge it claims to: the flaperon's trailing edge coincides
with the wing's to within a millionth of a metre, and the rudder's with the fin's.

`src/assets/loft.js` does the geometry and is covered by unit tests: a lofted cylinder
is asserted to be closed, correctly wound (positive signed volume), the right size, and
to survive mirroring across the centreline with its winding reversed so lighting stays
correct.

**Materials are generated, not loaded.** `src/assets/textures.js` paints a paint map, a
roughness map and a panel-line normal map into a canvas at runtime from a seeded random
generator, so a build is identical every time and the game ships **no image files at
all**. The albedo is built up in layers, in the order a real airframe acquires them:

1. base paint, then soft tonal mottling so a flat colour never reads as plastic;
2. **repainted panels** — a handful of large patches in a slightly different tone, which
   is what an airframe looks like after a few years of depot maintenance;
3. panel lines, longitudinal joints, access hatches and rivet rows;
4. exhaust staining, dirt streaks and the walkway along the spine;
5. **gun-gas staining** aft of the muzzle;
6. **paint chipped along the panel lines and fastener rows**, exposing primer;
7. the roundel, the serial, the squadron flash, the ejection warning triangle, a DANGER
   band and a fuel cap.

The normal map is derived from a height canvas with a Sobel filter, so the panel lines and
rivets carry real relief. The fuselage gets the marked set; wings and fins get the same
panel layout without the markings, because their UVs run across the span and a fuselage
stencil lands in the wrong place on a wing.

**Texture sizes are a quality tier, not a download.** Every map is painted at start-up, so
the tier decides the canvas size rather than which file to fetch:

| Tier | Airframe paint map | Unmarked (wing/fin) map | Cloud and cirrus cards |
| --- | --- | --- | --- |
| low | 512² | 256² | 128² |
| medium | 1024² | 512² | 256² |
| high | 1024² | 512² | 256² |

A low-tier device therefore paints a quarter of the texels of a high-tier one, and pays a
fraction of the start-up cost. The upshot of all of it: four distinct aircraft, no
licensing questions, no asset files, and a bundle that is essentially Three.js.

## The environment and the atmosphere (also generated)

Nothing in the sky, on the water or on the land is loaded either:

| Element | How it is made | What it costs |
| --- | --- | --- |
| Sky, sun and environment map | One gradient dome in a shader (`scene/Sky.js`): a compressed horizon gradient, a haze band, forward scatter around the sun and a sun disc. The same dome is rendered into a PMREM environment map for reflections | 1 draw call, one shader |
| Cumulus | A single `InstancedMesh` of camera-facing cards (`scene/Clouds.js`) with one generated card shared by all of them, recycled in a ring around the aircraft | 1 draw call for the whole field (10–30 cards) |
| Cirrus | One large card high above, following the camera and drifting, with a generated wisp texture | 1 draw call |
| Land | Low-poly radial heightfields (`scene/Terrain.js`) placed on a deterministic hash grid: eight shared geometries, a fixed pool of meshes, flat-shaded with vertex-colour bands | 6–14 draw calls, no shadow casting |
| Sea | One plane with two generated wave-normal layers — a long swell, and a fine ripple that fades out with distance | 1 draw call, two texture samples per pixel on the water |
| Sea detail fade | Injected into the standard material's own normal pass, so Three's lighting, fog, environment reflections and tone mapping are left untouched | — |

Two things are deliberately absent. There are **no volumetric clouds and no cloud
shadows**: a cloud layer that costs a second shadow pass is not worth the frame time on a
phone. And there is **no terrain collision** — the land is scenery around the edge of the
play area, low enough that the aircraft's normal altitude band clears it, but a determined
dive to the floor can pass through an island. Making the terrain part of the level design,
with collision, belongs with the scenery zones in Stage 8.

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

Every row is generated by this project at runtime or at build time. There is no
third-party content of any kind in this repository.

| Asset | Source | Licence |
| --- | --- | --- |
| All four aircraft (`falcon`, `viper`, `titan`, `phantom`) | Generated in code by this project, `src/assets/models/Fighter.js` | MIT, same as this repository |
| Airframe paint, roughness and normal maps | Generated at runtime by this project, `src/assets/textures.js` | MIT, same as this repository |
| Cloud and cirrus cards | Generated at runtime by this project, `src/assets/textures.js` | MIT, same as this repository |
| Island geometry | Generated in code by this project, `src/scene/Terrain.js` | MIT, same as this repository |
| Sea swell and ripple normal maps | Generated at runtime by this project, `src/assets/textures.js` | MIT, same as this repository |
| Sky, sun and environment map | Generated at runtime by this project, `src/scene/Sky.js` | MIT, same as this repository |
| Engine glow, afterburner and shock diamonds | Generated in code by this project, `src/scene/Effects.js` | MIT, same as this repository |
| Cover image | Rendered from the game itself by `tools/cover.mjs` | MIT, same as this repository |

If a licensed model is added under `assets/`, record it in this table with its author,
source URL and licence, and keep the licence text alongside the file. `assets/` is source
art: it is never copied into `dist/` and never served.

## What is deliberately not here yet

- **A licensed aircraft model.** Nothing suitable exists that could be verified; see the
  inspection above. The airframes are temporary and are labelled as such in the menu.
- **Contrails and world-space exhaust trails.** The afterburner plume is a local effect
  that belongs to the nozzle, which is correct and cheap. A trail is a different thing: it
  has to live in world space rather than on the aircraft, which means a second
  scene-level system with its own ring buffer. It belongs with the combat effects, where
  missiles and impacts need the same machinery.
- **A sea surface with real height.** The water is flat with two normal layers. Real
  displacement, foam at the shoreline and a depth gradient need a custom water shader and
  a depth pass; neither is worth the frame time for a game played at 400 m.
- **Cloud shadows on the water.** Would need the cloud field to cast into the shadow map.
  Deliberately skipped: one shadow pass, not two.
- **Terrain collision.** See above — the land is scenery, not level geometry.
