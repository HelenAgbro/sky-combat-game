# assets/ — source art, never shipped

This folder is for **source art that is not part of the published game**: licensed
`.glb` models, their textures, and the licence files that go with them.

Nothing here is copied into `dist/`, and nothing here is served by start.ng — the
served file types do not include `.glb` or `.gltf`. A model placed here is converted by
`tools/pack-models.mjs` into a base64 payload in `public/models/<id>.json`, which the
game fetches at runtime and hands to `GLTFLoader.parse`. See [docs/ASSETS.md](../docs/ASSETS.md).

Record every model's author, source URL and licence in the provenance table in
`docs/ASSETS.md`, and keep the licence text next to the file.
