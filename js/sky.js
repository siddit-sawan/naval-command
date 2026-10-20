import * as THREE from 'three';

// Low golden-hour sun so the water picks up long glints.
export const SUN_DIR = new THREE.Vector3(-0.55, 0.15, -0.8).normalize();
export const FOG_DENSITY = 0.00068;
export const HORIZON = new THREE.Color().setRGB(0.5, 0.6, 0.7, THREE.LinearSRGBColorSpace);

// Value noise with analytic derivatives, baked once into a tiling texture so shaders pay one
// texture read per lookup instead of hashing four corners every pixel.
// Texel layout: R = value, G/B = d/dx, d/dy packed as d * 0.25 + 0.5.
const NOISE_CELLS = 32;
const NOISE_RES = 256;

function bakeNoiseTexture() {
  const hash = (x, y) => {
    const s = Math.sin(((x % NOISE_CELLS) + NOISE_CELLS) % NOISE_CELLS * 127.1
      + (((y % NOISE_CELLS) + NOISE_CELLS) % NOISE_CELLS) * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const data = new Uint8Array(NOISE_RES * NOISE_RES * 4);
  const scale = NOISE_CELLS / NOISE_RES;
  for (let py = 0; py < NOISE_RES; py++) {
    for (let px = 0; px < NOISE_RES; px++) {
      const x = (px + 0.5) * scale, y = (py + 0.5) * scale;
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const dux = 6 * fx * (1 - fx), duy = 6 * fy * (1 - fy);
      const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
      const k = a - b - c + d;
      const o = (py * NOISE_RES + px) * 4;
      data[o] = Math.round((a + (b - a) * ux + (c - a) * uy + k * ux * uy) * 255);
      data[o + 1] = Math.round(THREE.MathUtils.clamp(dux * (b - a + k * uy) * 0.25 + 0.5, 0, 1) * 255);
      data[o + 2] = Math.round(THREE.MathUtils.clamp(duy * (c - a + k * ux) * 0.25 + 0.5, 0, 1) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, NOISE_RES, NOISE_RES, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
export const NOISE_TEXTURE = bakeNoiseTexture();

// Returns (value, d/dx, d/dy) like the analytic version it replaces.
export const NOISE_GLSL = /* glsl */ `
uniform sampler2D uNoise;
vec3 noised(vec2 x) {
  vec3 n = texture2D(uNoise, x * ${(1 / NOISE_CELLS).toFixed(6)}).rgb;
  return vec3(n.r, (n.gb - 0.5) * 4.0);
}
`;

// Shared by the sky dome, water reflections and the water's distance fog so the horizon is seamless.
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
vec3 skyColor(vec3 dir) {
  float y = max(dir.y, 0.0);
  vec3 col = mix(vec3(0.50, 0.60, 0.70), vec3(0.05, 0.17, 0.42), pow(y, 0.5));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += vec3(1.0, 0.55, 0.25) * (pow(sd, 8.0) * 0.18 + pow(sd, 64.0) * 0.45);
  return col;
}
`;

export function createSky() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMist: { value: 0 },
      uSunDir: { value: SUN_DIR },
      uNoise: { value: NOISE_TEXTURE },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uMist;
      varying vec3 vDir;
      ${NOISE_GLSL}
      ${SKY_GLSL}
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noised(p).x; p *= 2.03; a *= 0.5; }
        return v;
      }
      float fbmCoarse(vec2 p) {
        return 0.5 * noised(p).x + 0.25 * noised(p * 2.03).x + 0.25;
      }
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyColor(d);
        float sd = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.85, 0.6) * smoothstep(0.99975, 0.9999, sd) * 15.0;

        if (d.y > 0.0) {
          // Project onto a cloud layer and let it drift with the wind.
          vec2 uv = d.xz / (d.y + 0.12) * 1.2 + vec2(uTime * 0.006, uTime * 0.0025);
          float c = fbm(uv);
          float cover = smoothstep(0.5, 0.78, c) * smoothstep(0.0, 0.2, d.y);
          float shade = cover > 0.0 ? smoothstep(0.5, 0.9, fbmCoarse(uv + vec2(0.08, 0.05))) : 0.0;
          vec3 cloud = mix(vec3(0.95, 0.92, 0.9), vec3(0.55, 0.6, 0.7), shade);
          cloud += vec3(1.0, 0.6, 0.3) * pow(sd, 5.0) * 0.8;
          col = mix(col, cloud, cover * 0.9);
        }
        // A fog front greys out the sky, most of all near the horizon.
        col = mix(col, vec3(0.5, 0.6, 0.7), uMist * (0.65 + 0.35 * (1.0 - max(d.y, 0.0))));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  return {
    mesh,
    update(t, cameraPosition, mist = 0) {
      material.uniforms.uTime.value = t;
      material.uniforms.uMist.value = mist;
      mesh.position.copy(cameraPosition);
    },
  };
}
