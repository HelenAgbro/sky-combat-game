# start.ng platform notes

Everything in this file comes from the official documentation at
<https://start.ng/docs.md> (read in full) and from the live API, checked while building
Stage 2. It is the reference the project is built against — where this file and the
code disagree, the documentation wins.

## How a game is hosted

- A start.ng game is a **static website** in a **public GitHub repo**. There is no
  server code and the game never handles passwords.
- start.ng **never runs a build**. It looks for `index.html` at the repo top, then in
  `dist/`, `build/`, `docs/`, `out/` — in that order.
- A source `index.html` that loads `/src/main.js` is refused with **`needs_build`**.
- The game is served at `<name>.start.ng`, and **every push to the published branch
  updates it automatically** within a minute or two.

## Rules for files

| Rule | Detail |
| --- | --- |
| Served types | `html htm css js mjs json map txt svg png jpg jpeg gif webp avif ico woff woff2 ttf otf mp3 ogg wav mp4 webm wasm` |
| Anything else | **Skipped** (and listed in the publish reply) |
| Size | ≤ 2,000 files, ≤ 100 MB total, ≤ 25 MB per file |
| Left out | hidden files and folders, `node_modules`, symlinks |
| Paths | **relative only** (`./game.js`, `assets/hero.png`) |
| Safety | files are scanned for known malware patterns before going live |

## Leaderboard

`startng.json` sits next to `index.html` and declares 1–5 columns:

| Field | Meaning |
| --- | --- |
| `key` | what the game sends: lowercase letters, digits and `_`, starting with a letter, ≤ 24 chars |
| `label` | the column title, ≤ 30 chars |
| `order` | `"highest"` (default) or `"lowest"` |
| `format` | optional: `"number"` (default) or `"time"` (seconds, shown as `m:ss`) |

- Players are ranked by the **first** stat; the rest break ties, then whoever got there first.
- A run is a set of **whole numbers, 0 – 1,000,000,000**. Missing or extra keys are refused (422).
- Only a signed-in player's **best run** is kept. Guests can read the board but not save.
- Scores go to start.ng. `localStorage` is per-browser and is for personal bests and
  progression only — other players never see it.

**This game declares three columns:**

```json
{ "leaderboard": { "stats": [
  { "key": "distance", "label": "Distance (m)", "order": "highest" },
  { "key": "coins",    "label": "Coins",        "order": "highest" },
  { "key": "kills",    "label": "Shootdowns",   "order": "highest" }
] } }
```

Distance is the headline statistic; coins and shootdowns break ties.

## Players

start.ng owns sign-in, and every game shows the player's character.

- **Connect page (used here):** a hidden `https://start.ng/connect` iframe, talked to
  with `postMessage`. Messages: `startng:whoami` → `startng:user`,
  `startng:score` → `startng:scoreSaved`, `startng:leaderboard` → `startng:leaderboardData`.
- **Every reply must be checked** against `e.origin === 'https://start.ng'` **and**
  `e.source === frame.contentWindow`, and matched by `requestId`.
- The connect page only answers games served from `*.start.ng`, so local play must
  fall back to offline/guest without stalling.
- `GET /games/{game}/player` (HTTP API) returns `{ id, name, style }` — **no `face` and
  no `account`**. The profile card the docs require needs both, so the connect page is
  the only documented way to satisfy it. That is why this game uses the connect page.
- Guests see the guest look (`guest`) and a sign-in button. `?guest` in the address
  means the player already chose guest on start.ng's homepage — do not ask again.
- Ask again on `visibilitychange` and `focus`: the player may have signed in or out.

## Publishing

```
POST https://api.start.ng/games/check     same body as publish; publishes nothing
POST https://api.start.ng/games/publish   { "repo_url": "...", "name": "...", "branch": "..." }
```

- First publish of a repo → **202** with an `approve_url` a human opens **once**.
- After that → **200**, and pushes update the game by themselves.
- `name` is optional and defaults to the repo name. `sky-combat-game` would publish as
  `sky-combat-game`, so the name is passed explicitly: **`sky-combat`** → `sky-combat.start.ng`.
- Errors worth knowing: `needs_build`, `no_index`, `password_field`, `obfuscated_code`,
  `hidden_program`, `malware`, `file_too_big`, `too_many_files`, `repo_too_big`,
  `name_taken`, `repo_linked`, `rate_limited`.
- Warnings worth knowing: `no_cover`, `no_start_ng_player`, `external_script`,
  `insecure_link`, `leaves_start_ng`.

## Decisions this project makes because of the above

1. **No `index.html` at the repo root.** Vite's entry is `src/index.html`
   (`root: 'src'`), so the only `index.html` start.ng can find is the built
   `dist/index.html`. This avoids the documented `needs_build` refusal.
2. **`base: './'`** in `vite.config.js`, so every emitted path is relative.
3. **`dist/` is committed**, and `.gitignore` deliberately does not exclude it.
4. **No `.glb`/`.gltf` files are shipped** — they are not on the served-type list.
   See [ASSETS.md](ASSETS.md).
5. **Three.js is bundled**, not loaded from a CDN, so there is no `external_script`
   warning and no dependency on another host.
6. **`startng.json` and `cover.png` live in `public/`**, which Vite copies into
   `dist/` so they sit next to the built `index.html`.
7. **No password field, no external links, no redirects** — those are refusal
   reasons, and the game has no reason to want them.
8. **`__PACKED_MODELS__` is injected at build time** so the game only fetches model
   payloads that exist. A speculative fetch would log a 404 in the player's console.

## Checklist before publishing

- [x] Built `index.html` committed, in `dist/`, runs with no build step
- [x] Relative paths; every file type on the served list; no secrets
- [x] `startng.json` with the three columns, copied into `dist/`
- [x] `cover.png` (16:10, 1600×1000) next to `index.html`
- [x] Public GitHub repo, pushed
- [ ] `startng:whoami` on load with `e.origin` checked — **Stage 9**
- [ ] Profile card with the player's face, name and `@account` — **Stage 9**
- [ ] Guest look and a sign-in button — **Stage 9**
- [ ] `POST /games/check` clean — run `npm run startng:check`
- [ ] Published with `npm run startng:publish`, `approve_url` opened once
