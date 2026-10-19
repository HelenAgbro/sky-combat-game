/**
 * Sky Combat — merging an airframe down to one mesh per material.
 *
 * The player's aircraft is built as a few dozen separate meshes, because its control
 * surfaces have to move independently. An enemy aircraft does not need that, and seven of
 * them at forty meshes each would be three hundred draw calls spent on things the player
 * is trying to shoot.
 *
 * This walks a built airframe, applies each mesh's transform into its geometry, and
 * merges everything that shares a material. What comes back renders identically and costs
 * one draw call per material instead of one per part.
 *
 * Anything inside a `keep` subtree is left alone, so a model whose parts move can be
 * merged around them.
 */
import { Float32BufferAttribute, Group, Mesh } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The attributes every lofted geometry has, and the only ones worth merging. */
const ATTRIBUTES = ['position', 'normal', 'uv'];

/**
 * @param {import('three').Object3D} root the built airframe
 * @param {{keep?: Set<object>}} [options] subtrees to leave untouched
 * @returns {Group} a group with one mesh per material
 */
export function mergeStaticParts(root, { keep = new Set() } = {}) {
  root.updateMatrixWorld(true);

  const byMaterial = new Map();
  const originals = [];

  root.traverse((child) => {
    if (!child.isMesh) return;
    // Leave anything inside a kept subtree alone: a control surface has to stay separate.
    for (let node = child; node && node !== root; node = node.parent) {
      if (keep.has(node)) return;
    }
    originals.push(child);
  });

  for (const mesh of originals) {
    const geometry = toMergeable(mesh.geometry, mesh.matrixWorld);
    if (!geometry) continue;
    if (!byMaterial.has(mesh.material)) byMaterial.set(mesh.material, []);
    byMaterial.get(mesh.material).push(geometry);
  }

  const merged = new Group();
  merged.name = `${root.name}:merged`;

  for (const [material, geometries] of byMaterial) {
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);

    // A merge can fail if a geometry is not compatible with the rest (an odd attribute
    // layout, or a mismatch between indexed and non-indexed). Falling back to the parts
    // costs a draw call and keeps the model correct, which is the right way round.
    if (!geometry) {
      for (const piece of geometries) merged.add(new Mesh(piece, material));
      continue;
    }

    if (geometries.length > 1) for (const piece of geometries) piece.dispose();

    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    merged.add(mesh);
  }

  // Drop the parts that were merged away. Their geometries are disposed here because the
  // merged copies are new geometry; the originals are not shared with anything.
  for (const mesh of originals) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }

  // Carry anything the caller attached to the root (the moving-surface handles) across.
  merged.userData = root.userData;
  return merged;
}

/**
 * A copy of one mesh's geometry in the root's frame, carrying only the attributes every
 * lofted geometry shares — a merged mesh needs one attribute layout, not the union of all
 * of them.
 */
function toMergeable(source, matrixWorld) {
  if (!source.getAttribute('position')) return null;

  const geometry = source.clone();
  geometry.applyMatrix4(matrixWorld);

  for (const name of Object.keys(geometry.attributes)) {
    if (!ATTRIBUTES.includes(name)) geometry.deleteAttribute(name);
  }
  if (!geometry.getAttribute('uv')) {
    // A geometry with no UVs would fail the merge against one that has them.
    geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();

  geometry.morphAttributes = {};
  geometry.clearGroups();
  return geometry;
}
