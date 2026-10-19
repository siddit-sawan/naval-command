import * as THREE from 'three';
import { sampleOcean } from './ocean.js';

const FLOAT = 1; // sticks to the water surface
const GRAVITY = 2; // falls under gravity

// One pool of soft round sprites for wakes, spray, splashes and funnel smoke.
export class Effects {
  constructor(scene, max = 3000) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.flags = new Uint8Array(max);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec3 aColor;
        attribute float aAlpha;
        attribute float aSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
          vColor = aColor;
          vAlpha = aAlpha;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5)) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Expanding rings for splashes.
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.85, 1.0, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
      }));
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, age: 0, life: 1, x: 0, z: 0, grow: 10 });
    }
  }

  setScale(drawingBufferHeight, fovDeg) {
    this.material.uniforms.uScale.value = drawingBufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(x, y, z, vx, vy, vz, { life = 1, size0 = 1, size1 = size0, alpha = 1, color = 1, flags = 0 } = {}) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    const [r, g, b] = typeof color === 'number' ? [color, color, color] : color;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.alpha0[i] = alpha;
    this.flags[i] = flags;
    this.size[i] = size0;
    this.alpha[i] = alpha;
  }

  ring(x, z, { life = 1.4, grow = 10 } = {}) {
    const r = this.rings.find((r) => !r.mesh.visible);
    if (!r) return;
    Object.assign(r, { x, z, age: 0, life, grow });
    r.mesh.visible = true;
  }

  splash(x, z, t, power = 1) {
    const y = sampleOcean(x, z, t);
    const n = Math.round(45 * power);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = (1 + Math.random() * 3) * power;
      this.emit(x, y + 0.3, z, Math.cos(a) * h, (5 + Math.random() * 7) * power, Math.sin(a) * h, {
        life: 0.9 + Math.random() * 0.6, size0: 0.9 * power, size1: 0.4, alpha: 0.95, flags: GRAVITY,
      });
    }
    for (let i = 0; i < 10 * power; i++) {
      const a = Math.random() * Math.PI * 2;
      this.emit(x + Math.cos(a), y + 0.2, z + Math.sin(a), Math.cos(a) * 2, 0, Math.sin(a) * 2, {
        life: 3, size0: 2 * power, size1: 6 * power, alpha: 0.5, flags: FLOAT,
      });
    }
    this.ring(x, z, { grow: 10 * power });
    this.ring(x, z, { life: 2, grow: 6 * power });
  }

  update(t, dt) {
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }
      const i3 = i * 3;
      const f = this.flags[i];
      if (f & GRAVITY) this.vel[i3 + 1] -= 18 * dt;
      const drag = f & FLOAT ? Math.exp(-dt * 0.8) : 1;
      this.vel[i3] *= drag;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (f & FLOAT) {
        this.pos[i3 + 1] = sampleOcean(this.pos[i3], this.pos[i3 + 2], t) + 0.25;
      } else {
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        // Droplets disappear once they fall back into the sea.
        if ((f & GRAVITY) && this.vel[i3 + 1] < 0 && this.pos[i3 + 1] < -0.5) {
          this.kill(i);
          continue;
        }
      }
      const k = this.age[i] / this.life[i];
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * k;
      this.alpha[i] = this.alpha0[i] * (1 - k) * Math.min(1, this.age[i] * 8);
      i++;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.count);
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = this.alphaAttr.needsUpdate = this.sizeAttr.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) { r.mesh.visible = false; continue; }
      const s = 1 + r.grow * Math.sqrt(k);
      r.mesh.scale.set(s, 1, s);
      r.mesh.position.set(r.x, sampleOcean(r.x, r.z, t) + 0.3, r.z);
      r.mesh.material.opacity = 0.8 * (1 - k) * (1 - k);
    }
  }

  // Swap the last live particle into this slot.
  kill(i) {
    const j = --this.count;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3;
    for (let c = 0; c < 3; c++) {
      this.pos[i3 + c] = this.pos[j3 + c];
      this.vel[i3 + c] = this.vel[j3 + c];
      this.col[i3 + c] = this.col[j3 + c];
    }
    this.age[i] = this.age[j]; this.life[i] = this.life[j];
    this.size0[i] = this.size0[j]; this.size1[i] = this.size1[j];
    this.alpha0[i] = this.alpha0[j]; this.flags[i] = this.flags[j];
    this.size[i] = this.size[j]; this.alpha[i] = this.alpha[j];
  }
}

Effects.FLOAT = FLOAT;
Effects.GRAVITY = GRAVITY;
