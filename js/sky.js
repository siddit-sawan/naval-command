import * as THREE from 'three';

// Low golden-hour sun so the water picks up long glints.
export const SUN_DIR = new THREE.Vector3(-0.55, 0.15, -0.8).normalize();
export const FOG_DENSITY = 0.00068;
export const HORIZON = new THREE.Color().setRGB(0.5, 0.6, 0.7, THREE.LinearSRGBColorSpace);

// Value noise with analytic derivatives: returns (value, d/dx, d/dy).
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 noised(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y,
              du * (vec2(b - a, c - a) + k * u.yx));
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
      uSunDir: { value: SUN_DIR },
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
      varying vec3 vDir;
      ${NOISE_GLSL}
      ${SKY_GLSL}
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noised(p).x; p *= 2.03; a *= 0.5; }
        return v;
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
          float shade = smoothstep(0.5, 0.9, fbm(uv + vec2(0.08, 0.05)));
          vec3 cloud = mix(vec3(0.95, 0.92, 0.9), vec3(0.55, 0.6, 0.7), shade);
          cloud += vec3(1.0, 0.6, 0.3) * pow(sd, 5.0) * 0.8;
          col = mix(col, cloud, cover * 0.9);
        }
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
    update(t, cameraPosition) {
      material.uniforms.uTime.value = t;
      mesh.position.copy(cameraPosition);
    },
  };
}
