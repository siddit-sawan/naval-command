import * as THREE from 'three';
import { SUN_DIR, FOG_DENSITY, NOISE_GLSL, SKY_GLSL, NOISE_TEXTURE } from './sky.js';

// [dirX, dirZ, steepness, wavelength]. Steepness must sum below 1 or crests loop over themselves.
// Wavelengths and directions are deliberately irregular so the swell doesn't tile into a grid.
const WAVE_DEFS = [
  [1.0, 0.25, 0.13, 83],
  [0.62, 0.8, 0.12, 57],
  [0.15, 1.0, 0.11, 37],
  [-0.55, 0.85, 0.1, 23.7],
  [0.95, -0.4, 0.09, 15.3],
  [-0.85, -0.2, 0.08, 10.1],
  [0.4, -0.9, 0.07, 7.3],
  [-0.2, 0.95, 0.06, 5.2],
];

export const WAVES = WAVE_DEFS.map(([x, z, steep, len]) => {
  const l = Math.hypot(x, z);
  const k = (2 * Math.PI) / len;
  return { dx: x / l, dz: z / l, steep, len, k, c: Math.sqrt(9.8 / k) };
});

// Islands calm the water around them and get a foam line. Filled in by the scenery.
export const ISLANDS = [];
const MAX_ISLANDS = 8;
const SHELTER_RANGE = 50;

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

function shelter(x, z) {
  let f = 1;
  for (const is of ISLANDS) {
    const dx = x - is.x, dz = z - is.z;
    const reach = is.r + SHELTER_RANGE;
    if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    f = Math.min(f, 0.25 + 0.75 * smoothstep(is.r, is.r + SHELTER_RANGE, d));
  }
  return f;
}

// CPU copy of the vertex shader so floating objects ride the same waves. Returns surface height.
export function sampleOcean(x, z, t, outNormal) {
  // Gerstner waves also push water sideways, so find the rest point that ends up at (x, z).
  let px = x, pz = z;
  for (let iter = 0; iter < 4; iter++) {
    const sh = shelter(px, pz);
    let ox = 0, oz = 0;
    for (const w of WAVES) {
      const a = (w.steep * sh) / w.k;
      const co = Math.cos(w.k * (w.dx * px + w.dz * pz - w.c * t));
      ox += w.dx * a * co;
      oz += w.dz * a * co;
    }
    px = x - ox;
    pz = z - oz;
  }

  const sh = shelter(px, pz);
  let h = 0;
  let tx = 1, ty = 0, tz = 0, bx = 0, by = 0, bz = 1;
  for (const w of WAVES) {
    const steep = w.steep * sh;
    const f = w.k * (w.dx * px + w.dz * pz - w.c * t);
    const s = Math.sin(f), co = Math.cos(f);
    h += (steep / w.k) * s;
    tx -= w.dx * w.dx * steep * s; ty += w.dx * steep * co; tz -= w.dx * w.dz * steep * s;
    bx -= w.dx * w.dz * steep * s; by += w.dz * steep * co; bz -= w.dz * w.dz * steep * s;
  }
  if (outNormal) {
    outNormal.set(by * tz - bz * ty, bz * tx - bx * tz, bx * ty - by * tx).normalize();
  }
  return h;
}

// Cheaper height for thousands of foam particles. Only the big swells matter at that scale (the
// short waves are a few centimetres tall), and one correction pass with the three largest is enough.
const BIG_WAVES = WAVES.slice(0, 5);
const SWELLS = WAVES.slice(0, 3);
export function sampleHeightFast(x, z, t) {
  const sh = ISLANDS.length ? shelter(x, z) : 1;
  let ox = 0, oz = 0;
  for (const w of SWELLS) {
    const a = (w.steep * sh) / w.k;
    const co = Math.cos(w.k * (w.dx * x + w.dz * z - w.c * t));
    ox += w.dx * a * co;
    oz += w.dz * a * co;
  }
  const px = x - ox, pz = z - oz;
  let h = 0;
  for (const w of BIG_WAVES) h += ((w.steep * sh) / w.k) * Math.sin(w.k * (w.dx * px + w.dz * pz - w.c * t));
  return h;
}

// Grid that is dense near the middle and stretches out toward the horizon, cut into tiles so the
// GPU only runs the wave math for tiles inside the camera's view.
function buildTiles(halfSize, segs, tiles) {
  const remap = (u) => Math.sign(u) * halfSize * Math.abs(u) * (0.065 + 0.935 * Math.abs(u));
  const coord = Array.from({ length: segs + 1 }, (_, i) => remap((i / segs) * 2 - 1));
  const per = segs / tiles;
  const geos = [];
  for (let tj = 0; tj < tiles; tj++) {
    for (let ti = 0; ti < tiles; ti++) {
      const i0 = ti * per, j0 = tj * per;
      const n = per + 1;
      const positions = new Float32Array(n * n * 3);
      let o = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          positions[o++] = coord[i0 + i];
          positions[o++] = 0;
          positions[o++] = coord[j0 + j];
        }
      }
      const index = new Uint16Array(per * per * 6);
      o = 0;
      for (let j = 0; j < per; j++) {
        for (let i = 0; i < per; i++) {
          const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
          index[o++] = a; index[o++] = c; index[o++] = b;
          index[o++] = b; index[o++] = c; index[o++] = d;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      // Pad the bounds by the largest wave displacement so tiles aren't culled while visible.
      const x0 = coord[i0], x1 = coord[i0 + per], z0 = coord[j0], z1 = coord[j0 + per];
      geo.boundingSphere = new THREE.Sphere(
        new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2),
        Math.hypot(x1 - x0, z1 - z0) / 2 + 8,
      );
      geos.push(geo);
    }
  }
  return geos;
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec4 uWaves[WAVE_COUNT];   // dir.xy, steepness, wavelength
  uniform vec4 uWaveK[WAVE_COUNT];   // k, angular speed, 1/k (precomputed on the CPU)
  uniform vec4 uIslands[MAX_ISLANDS];
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vJacobian;
  varying float vHeight;

  float shelter(vec2 p) {
    float f = 1.0;
    for (int i = 0; i < MAX_ISLANDS; i++) {
      vec4 is = uIslands[i];
      if (is.z <= 0.0) continue;
      vec2 dp = p - is.xy;
      float reach = is.z + SHELTER_RANGE;
      if (dot(dp, dp) > reach * reach) continue;
      f = min(f, 0.25 + 0.75 * smoothstep(is.z, reach, length(dp)));
    }
    return f;
  }

  void main() {
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    float camDist = distance(cameraPosition, p);
    float sh = shelter(p.xz);
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec3 disp = vec3(0.0);

    for (int i = 0; i < WAVE_COUNT; i++) {
      vec4 w = uWaves[i];
      // Fade short waves with distance; the grid is too coarse out there to draw them.
      float steep = w.z * sh * (1.0 - smoothstep(w.w * 25.0, w.w * 70.0, camDist));
      if (steep <= 0.0) continue;
      vec4 wk = uWaveK[i];
      vec2 d = w.xy;
      float f = wk.x * dot(d, p.xz) - wk.y * uTime;
      float a = steep * wk.z;
      float s = sin(f), co = cos(f);
      tangent += vec3(-d.x * d.x * steep * s, d.x * steep * co, -d.x * d.y * steep * s);
      binormal += vec3(-d.x * d.y * steep * s, d.y * steep * co, -d.y * d.y * steep * s);
      disp += vec3(d.x * a * co, a * s, d.y * a * co);
    }

    p += disp;
    vNormal = normalize(cross(binormal, tangent));
    // Where the surface is squeezed together the crest is breaking, which is where foam goes.
    vJacobian = tangent.x * binormal.z - tangent.z * binormal.x;
    vHeight = disp.y;
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uFogDensity;
  uniform vec4 uIslands[MAX_ISLANDS];
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vJacobian;
  varying float vHeight;
  ${NOISE_GLSL}
  ${SKY_GLSL}

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / dist;
    vec2 p = vWorld.xz;

    // Small scrolling ripples on top of the geometric waves.
    float detail = 1.0 - smoothstep(80.0, 700.0, dist);
    // A broad, slowly drifting undulation that survives into the distance and breaks up repetition.
    vec2 broad = noised(p * 0.012 + vec2(uTime * 0.01, -uTime * 0.008)).yz * 0.012 * 9.0
               + noised(p * 0.031 - vec2(uTime * 0.02, 0.0)).yz * 0.031 * 4.0;
    vec2 g = broad * (1.0 - smoothstep(1500.0, 2500.0, dist));
    // Fine ripples only near the camera; beyond 700 they have faded out anyway.
    if (detail > 0.0) {
      g += (noised(p * 0.07 + vec2(uTime * 0.10, uTime * 0.04)).yz * 0.07
          + noised(p * 0.19 + vec2(-uTime * 0.08, uTime * 0.13)).yz * 0.19 * 0.55
          + noised(p * 0.53 + vec2(uTime * 0.21, -uTime * 0.17)).yz * 0.53 * 0.3) * detail;
    }
    vec3 N = normalize(normalize(vNormal) + vec3(-g.x, 0.0, -g.y) * 0.55);

    vec3 L = uSunDir;
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = skyColor(R);

    // Water body: brighter in crests, and glowing green where the sun shines through them.
    float crest = clamp(vHeight * 0.22 + 0.4, 0.0, 1.0);
    float back = pow(max(dot(-V, L), 0.0), 4.0);
    vec3 water = vec3(0.003, 0.03, 0.065) + vec3(0.01, 0.10, 0.13) * crest
               + vec3(0.04, 0.32, 0.28) * back * crest * crest * 0.8;
    water *= 0.55 + 0.45 * max(dot(N, L), 0.0);

    float fn = noised(p * 0.3 + vec2(uTime * 0.15, 0.0)).x * 0.6
             + noised(p * 1.1 - vec2(0.0, uTime * 0.25)).x * 0.4;

    // Shallows and surf rolling in around the islands.
    float shore = 0.0, shallow = 0.0;
    for (int i = 0; i < MAX_ISLANDS; i++) {
      vec4 isl = uIslands[i];
      if (isl.z <= 0.0) continue;
      float d = length(p - isl.xy) - isl.z;
      if (d > 22.0) continue;
      shallow = max(shallow, 1.0 - smoothstep(-2.0, 22.0, d));
      float surf = 0.5 + 0.5 * sin(d * 0.8 + uTime * 1.8 + fn * 2.0);
      shore = max(shore, (1.0 - smoothstep(0.0, 10.0, d)) * smoothstep(0.55, 0.95, surf * 0.7 + fn * 0.5));
      shore = max(shore, 1.0 - smoothstep(-1.0, 1.5, d));
    }
    water = mix(water, vec3(0.04, 0.30, 0.30), shallow * 0.55);

    float crestFoam = smoothstep(0.62, 0.28, vJacobian);
    float foam = crestFoam * smoothstep(0.3, 0.7, fn + crestFoam * 0.35);
    foam = max(foam, shore) * (1.0 - 0.6 * smoothstep(300.0, 1500.0, dist));

    vec3 col = mix(water, sky, fresnel);
    float rl = max(dot(R, L), 0.0);
    col += vec3(1.0, 0.82, 0.6) * (pow(rl, 900.0) * 40.0 + pow(rl, 90.0) * 0.6) * (1.0 - foam);
    col = mix(col, vec3(0.85, 0.9, 0.95) * (0.65 + 0.35 * max(dot(N, L), 0.0)), foam * 0.9);

    float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    col = mix(col, skyColor(normalize(vec3(-V.x, 0.001, -V.z))), fog);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// segments: grid resolution (multiple of 8). 320 is about 200k triangles, most packed near the camera.
export function createOcean(segments = 320) {
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: SUN_DIR },
    uFogDensity: { value: FOG_DENSITY },
    uNoise: { value: NOISE_TEXTURE },
    uWaves: { value: WAVES.map((w) => new THREE.Vector4(w.dx, w.dz, w.steep, w.len)) },
    uWaveK: { value: WAVES.map((w) => new THREE.Vector4(w.k, w.k * w.c, 1 / w.k, 0)) },
    uIslands: { value: Array.from({ length: MAX_ISLANDS }, () => new THREE.Vector4()) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    defines: {
      WAVE_COUNT: WAVES.length,
      MAX_ISLANDS,
      SHELTER_RANGE: SHELTER_RANGE.toFixed(1),
    },
  });

  // Cut into 8x8 tiles; typically
  // well under half are in view, and the rest are skipped by frustum culling.
  const mesh = new THREE.Group();
  for (const geo of buildTiles(2600, segments, 8)) mesh.add(new THREE.Mesh(geo, material));

  return {
    mesh,
    syncIslands() {
      ISLANDS.slice(0, MAX_ISLANDS).forEach((is, i) => uniforms.uIslands.value[i].set(is.x, is.z, is.r, 0));
    },
    // The mesh follows the camera so the sea never ends; snapping keeps vertices from swimming.
    update(t, focus) {
      uniforms.uTime.value = t;
      mesh.position.set(Math.round(focus.x / 8) * 8, 0, Math.round(focus.z / 8) * 8);
    },
  };
}
