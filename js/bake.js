import * as THREE from 'three';

// Static models are built from many small meshes. Baking merges them into at most two
// vertex-colored meshes (lit surfaces, and unlit glowing parts like lamps), turning dozens of
// draw calls into one or two. Children marked userData.keep (animated parts) are left alone, as
// are meshes with special materials (transparent effects, shader materials).

const materials = new Map();
function bakedMaterial(kind, side, finish) {
  const key = `${kind}|${side}|${finish.roughness}|${finish.metalness}`;
  if (!materials.has(key)) {
    materials.set(key, kind === 'glow'
      ? new THREE.MeshBasicMaterial({ vertexColors: true, side })
      : new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side, ...finish }));
  }
  return materials.get(key);
}

const plain = (m) => !m.transparent && !m.map && m.blending === THREE.NormalBlending;
function kindOf(mesh) {
  const mats = [mesh.material].flat();
  if (mats.every((m) => m.isMeshStandardMaterial && plain(m))) return 'lit';
  if (mats.every((m) => m.isMeshBasicMaterial && plain(m))) return 'glow';
  return null;
}

const cache = new Map();
const DEFAULT_FINISH = { roughness: 0.85, metalness: 0 };

function mergeGeometry(victims, inv) {
  const pos = [], col = [];
  const m = new THREE.Matrix4();
  for (const v of victims) {
    const g = v.geometry.index ? v.geometry.toNonIndexed() : v.geometry.clone();
    g.applyMatrix4(m.multiplyMatrices(inv, v.matrixWorld));
    const p = g.attributes.position;
    const mats = [v.material].flat();
    const vc = mats[0].vertexColors && g.attributes.color;
    const groups = Array.isArray(v.material) && g.groups.length ? g.groups : [{ start: 0, count: p.count, materialIndex: 0 }];
    for (const grp of groups) {
      const c = mats[grp.materialIndex].color;
      for (let i = grp.start; i < grp.start + grp.count && i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        // Already-baked meshes carry their colors per vertex.
        if (vc) col.push(vc.getX(i), vc.getY(i), vc.getZ(i));
        else col.push(c.r, c.g, c.b);
      }
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Merge the static meshes under `root`. `cacheKey` reuses the merged geometry for identical
 * models (e.g. every destroyer of a team). `finish` sets roughness/metalness of the lit surface.
 */
export function bake(root, cacheKey, finish = DEFAULT_FINISH) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = { lit: [], glow: [] };
  (function walk(o) {
    for (const c of o.children) {
      if (c.userData.keep) continue;
      const kind = c.isMesh && kindOf(c);
      if (kind) buckets[kind].push(c);
      walk(c);
    }
  })(root);

  for (const [kind, victims] of Object.entries(buckets)) {
    if (victims.length < 2) continue;
    const side = victims.some((v) => [v.material].flat().some((m) => m.side === THREE.DoubleSide))
      ? THREE.DoubleSide : THREE.FrontSide;
    const key = cacheKey && `${cacheKey}|${kind}`;
    let geo = key ? cache.get(key) : null;
    if (!geo) {
      geo = mergeGeometry(victims, inv);
      if (key) cache.set(key, geo);
    }
    for (const v of victims) v.parent.remove(v);
    root.add(new THREE.Mesh(geo, bakedMaterial(kind, side, kind === 'lit' ? finish : DEFAULT_FINISH)));
  }
  return root;
}
