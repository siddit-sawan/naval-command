import * as THREE from 'three';

// Static models are built from many small meshes. Baking them into one vertex-colored mesh turns
// dozens of draw calls into one. Children marked userData.keep (animated parts) are left alone,
// as are meshes with non-standard materials (glowing lamps, flags, shader effects).

const materials = new Map();
function bakedMaterial(side) {
  if (!materials.has(side)) {
    materials.set(side, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, side }));
  }
  return materials.get(side);
}

const isPlain = (m) => m.isMeshStandardMaterial && !m.transparent && !m.map;
const cache = new Map();

export function bake(root, cacheKey) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const victims = [];
  (function walk(o) {
    for (const c of o.children) {
      if (c.userData.keep) continue;
      if (c.isMesh && (Array.isArray(c.material) ? c.material : [c.material]).every(isPlain)) victims.push(c);
      walk(c);
    }
  })(root);
  if (victims.length < 2) return root;

  const side = victims.some((v) => [v.material].flat().some((m) => m.side === THREE.DoubleSide))
    ? THREE.DoubleSide : THREE.FrontSide;

  let geo = cacheKey ? cache.get(cacheKey) : null;
  if (!geo) {
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
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    if (cacheKey) cache.set(cacheKey, geo);
  }

  for (const v of victims) v.parent.remove(v);
  root.add(new THREE.Mesh(geo, bakedMaterial(side)));
  return root;
}
