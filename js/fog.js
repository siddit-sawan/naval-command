import * as THREE from 'three';
import { FOG, MAP } from './config.js';
import { FOG_DENSITY, NOISE_GLSL, NOISE_TEXTURE } from './sky.js';

// Sea fog: banks that drift across the map hiding the ships inside them, and now and then a fog
// front that rolls in and shrinks everyone's sight to a few ship lengths.

const rand = ([a, b]) => a + Math.random() * (b - a);
const PUFFS = 18;
const FRONT_DENSITY = 0.0055;
const BANK_DENSITY = 0.007;
const EDGE = MAP.bounds + 160;

const puffMaterial = () => new THREE.ShaderMaterial({
  uniforms: {
    uNoise: { value: NOISE_TEXTURE },
    uTime: { value: 0 },
    uFogDensity: { value: FOG_DENSITY },
  },
  vertexShader: /* glsl */ `
    attribute float aAlpha;
    attribute float aSeed;
    varying vec2 vUv;
    varying float vAlpha;
    varying float vSeed;
    varying float vDist;
    void main() {
      // Camera-facing quad centered on the instance.
      vec4 world = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float size = length(instanceMatrix[0].xyz);
      vec4 view = viewMatrix * world;
      view.xy += position.xy * size * vec2(1.0, 0.55);
      vDist = length(view.xyz);
      // Thin out near the camera (no giant blobs in your face) and right at the waterline.
      vAlpha = aAlpha * smoothstep(12.0, 60.0, vDist);
      vUv = uv;
      vSeed = aSeed;
      gl_Position = projectionMatrix * view;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uFogDensity;
    varying vec2 vUv;
    varying float vAlpha;
    varying float vSeed;
    varying float vDist;
    ${NOISE_GLSL}
    void main() {
      vec2 c = vUv * 2.0 - 1.0;
      float r = length(c);
      if (r > 1.0) discard;
      vec2 q = vUv * 3.0 + vec2(vSeed * 7.3 + uTime * 0.02, vSeed * 3.1);
      float n = noised(q).x * 0.6 + noised(q * 2.1).x * 0.4;
      float a = (1.0 - smoothstep(0.15, 1.0, r + (n - 0.5) * 0.5)) * vAlpha;
      // Lit from above: brighter tops, grey undersides.
      vec3 col = mix(vec3(0.58, 0.63, 0.68), vec3(0.88, 0.9, 0.92), clamp(c.y * 0.5 + 0.6, 0.0, 1.0));
      float fog = 1.0 - exp(-pow(vDist * uFogDensity, 2.0));
      col = mix(col, vec3(0.5, 0.6, 0.7), fog);
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
  transparent: true,
  depthWrite: false,
});

export function createWeather(scene) {
  const count = FOG.banks * PUFFS;
  const geo = new THREE.PlaneGeometry(2, 2);
  const alpha = new Float32Array(count);
  const seed = new Float32Array(count).map(() => Math.random());
  geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(alpha, 1));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  const material = puffMaterial();
  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  scene.add(mesh);

  const wind = { x: 0, z: 0 };
  const banks = [];
  const state = { mist: 0, target: 0, nextFront: 0, frontEnds: 0, time: 0 };
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  function placeBank(b, upwind) {
    b.r = rand(FOG.bankRadius);
    if (upwind) {
      // Enter from the upwind edge so banks keep sweeping across the battle.
      const across = (Math.random() * 2 - 1) * MAP.bounds;
      const wx = wind.x / FOG.drift, wz = wind.z / FOG.drift;
      b.x = -wx * EDGE - wz * across;
      b.z = -wz * EDGE + wx * across;
    } else {
      b.x = (Math.random() * 2 - 1) * MAP.bounds;
      b.z = (Math.random() * 2 - 1) * MAP.bounds * 0.75;
    }
    b.phase = Math.random() * 10;
    b.puffs = Array.from({ length: PUFFS }, () => {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 0.85;
      return { a, d, y: 5 + Math.random() * 14, size: 26 + Math.random() * 30, alpha: 0.35 + Math.random() * 0.35 };
    });
  }

  function reset() {
    const a = Math.random() * Math.PI * 2;
    wind.x = Math.cos(a) * FOG.drift;
    wind.z = Math.sin(a) * FOG.drift;
    banks.length = 0;
    for (let i = 0; i < FOG.banks; i++) {
      const b = { thick: 1 };
      placeBank(b, false);
      banks.push(b);
    }
    Object.assign(state, { mist: 0, target: 0, time: 0, nextFront: rand(FOG.firstFront), frontEnds: 0 });
  }
  reset();

  // 0 outside every bank, 1 deep inside one.
  function coverAt(x, z) {
    let c = 0;
    for (const b of banks) {
      const d = Math.hypot(x - b.x, z - b.z);
      c = Math.max(c, THREE.MathUtils.clamp((b.r - d) / (b.r * 0.4), 0, 1));
    }
    return c;
  }

  return {
    banks,
    reset,
    coverAt,
    get mist() { return state.mist; },

    // How far away a ship at (x, z) can be seen from.
    sightAt(x, z) {
      let sight = Infinity;
      if (state.mist > 0.5) sight = FOG.frontSight;
      if (coverAt(x, z) > 0.5) sight = Math.min(sight, FOG.bankSight);
      return sight;
    },

    // Fog density for an eye at this point: thicker in a front, thickest down inside a bank.
    density(x, z, height = 0) {
      const inBank = coverAt(x, z) * THREE.MathUtils.clamp(1 - (height - 15) / 60, 0, 1);
      return FOG_DENSITY + (FRONT_DENSITY - FOG_DENSITY) * state.mist + BANK_DENSITY * inBank;
    },

    // Advances the weather; returns 'front' when a fog front starts rolling in and 'clear' when it lifts.
    step(dt) {
      if (dt <= 0) return null;
      state.time += dt;
      let event = null;
      if (state.target === 0 && state.time >= state.nextFront) {
        state.target = 1;
        state.frontEnds = state.time + rand(FOG.frontLength);
        event = 'front';
      } else if (state.target === 1 && state.time >= state.frontEnds) {
        state.target = 0;
        state.nextFront = state.time + rand(FOG.frontEvery);
        event = 'clear';
      }
      state.mist += THREE.MathUtils.clamp(state.target - state.mist, -dt / 10, dt / 7);

      for (const b of banks) {
        b.x += wind.x * dt;
        b.z += wind.z * dt;
        // Gone downwind off the map: bring it back in from the other side.
        if ((b.x * wind.x + b.z * wind.z) / FOG.drift > EDGE + b.r) placeBank(b, true);
      }
      return event;
    },

    // Rebuild the puff billboards. Cheap: a hundred-odd matrices.
    update(t) {
      material.uniforms.uTime.value = t;
      let i = 0;
      for (const b of banks) {
        const breathe = 1 + 0.08 * Math.sin(t * 0.15 + b.phase);
        for (const p of b.puffs) {
          const a = p.a + t * 0.01;
          pos.set(b.x + Math.cos(a) * p.d * b.r * breathe, p.y + Math.sin(t * 0.3 + p.a) * 1.5, b.z + Math.sin(a) * p.d * b.r * breathe);
          scl.setScalar(p.size * breathe);
          m4.compose(pos, quat, scl);
          mesh.setMatrixAt(i, m4);
          alpha[i] = p.alpha * b.thick;
          i++;
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    },

    setFogDensity(d) {
      material.uniforms.uFogDensity.value = d;
    },
  };
}
