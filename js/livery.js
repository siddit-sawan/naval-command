import * as THREE from 'three';
import { mulberry32 } from './scenery.js';

// Painted liveries, drawn once per ship class and scheme onto canvases.
// Hull side texture layout (rows): starboard side, port side, transom. u runs stern -> bow.

/**
 * Paint schemes. style picks the camouflage painter; price is in coins, or `ads` = rewarded ads to
 * unlock. bow: 'chevron' | 'shark' | null. deck: air-recognition panel, 'star' or 'bars'.
 */
export const LIVERIES = {
  dazzle: {
    name: 'Atlantic Dazzle', price: 0, style: 'dazzle', bow: 'chevron', deck: 'star',
    base: '#5d7a96', camo: ['#1f3348', '#c9d6df', '#8fa6ba', '#3d5a78', '#e6edf2'], accent: '#3fa2ff',
    desc: 'Standard issue. Bold panels confuse enemy rangefinders.',
  },
  arctic: {
    name: 'Arctic Splinter', price: 300, style: 'splinter', bow: 'chevron', deck: 'star',
    base: '#d6dfe5', camo: ['#ffffff', '#9fb0bd', '#6b7d8b', '#c4d0d8', '#3e4c57'], accent: '#5cc8ff',
    desc: 'Ice-white shards for northern convoys.',
  },
  jungle: {
    name: 'Jungle Raider', price: 450, style: 'blotch', bow: null, deck: 'star',
    base: '#4f5f3a', camo: ['#2f3a22', '#7a8a4f', '#a59a6a', '#1e2416'], accent: '#c8e05a',
    desc: 'River-patrol greens that melt into the shoreline.',
  },
  desert: {
    name: 'Desert Storm', price: 600, style: 'blotch', bow: 'chevron', deck: 'star',
    base: '#c2a676', camo: ['#a88a5c', '#e0cba0', '#8c6f47', '#d6b98a'], accent: '#e0772c',
    desc: 'Sun-bleached sand for gulf operations.',
  },
  royal: {
    name: 'Royal Classic', price: 750, style: 'classic', bow: null, deck: 'bars',
    base: '#8f979e', camo: ['#2b2f33', '#e8ecef'], accent: '#d8343a',
    desc: 'Parade-ground grey with a gleaming white sheer and red boot-topping.',
  },
  midnight: {
    name: 'Midnight Gold', price: 1000, style: 'pinstripe', bow: 'chevron', deck: 'star',
    base: '#16191e', camo: ['#22262c', '#0e1013'], accent: '#f0b429',
    desc: 'Black hull, gold trim. For captains who want to be noticed.',
  },
  tiger: {
    name: 'Tiger Shark', price: 1500, style: 'tiger', bow: 'shark', deck: 'bars',
    base: '#e0772c', camo: ['#14110e'], accent: '#ffb347',
    desc: 'Orange stripes and a mouthful of teeth.',
  },
  neon: {
    name: 'Neon Strike', ads: 3, style: 'digital', bow: 'chevron', deck: 'star',
    base: '#1b1030', camo: ['#ff3df2', '#3df2ff', '#2a1850', '#7b2cff', '#120a22'], accent: '#ff3df2',
    desc: 'Digital camo straight out of an arcade. Unlock by watching ads.',
  },
  // The enemy fleet's scheme; not for sale.
  enemy: {
    name: 'Crimson Fleet', hidden: true, style: 'splinter', bow: 'shark', deck: 'bars', hazard: true,
    base: '#5e3434', camo: ['#2b2b2e', '#8c4a44', '#3a1f1f', '#a8645a', '#4a4446'], accent: '#ff5a4f',
    outline: '#7d0b0b',
  },
};
export const STORE_ORDER = ['dazzle', 'arctic', 'jungle', 'desert', 'royal', 'midnight', 'tiger', 'neon'];

const COMMON = { boot: '#15191d', oxide: '#7a2a22', streak: 'rgba(40,50,60,0.18)' };
const livery = (id) => ({ ...COMMON, outline: '#14263a', ...(LIVERIES[id] || LIVERIES.dazzle) });

const W = 1024;
const SIDE_H = 160;
const TRANSOM_H = 64;
const H = SIDE_H * 2 + TRANSOM_H;
const PAD = 2 / H;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// ---------- Camouflage painters: (ctx, w, h, livery, rng), h = height of the painted area ----------
const PAINTERS = {
  // Bold slanted panels running the full height of the hull, the classic WW1/WW2 dazzle look.
  dazzle(ctx, w, h, p, rng) {
    let x = -40;
    while (x < w + 40) {
      const width = 40 + rng() * 90;
      const lean = (rng() - 0.5) * 120;
      ctx.fillStyle = pick(p.camo, rng);
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x + width, 0); ctx.lineTo(x + width + lean, h); ctx.lineTo(x + lean, h);
      ctx.fill();
      if (rng() < 0.55) {
        ctx.fillStyle = pick(p.camo, rng);
        const top = rng() < 0.5;
        ctx.beginPath();
        ctx.moveTo(x + width * 0.2, top ? 0 : h);
        ctx.lineTo(x + width * (0.6 + rng() * 0.6), top ? 0 : h);
        ctx.lineTo(x + width * 0.5 + lean * 0.5, h * (0.35 + rng() * 0.3));
        ctx.fill();
      }
      x += width * (0.6 + rng() * 0.3);
    }
  },
  // Long thin jagged shards.
  splinter(ctx, w, h, p, rng) {
    for (let i = 0; i < (w * h) / 2300; i++) {
      const len = 40 + rng() * 120, thick = 8 + rng() * 26;
      ctx.fillStyle = pick(p.camo, rng);
      ctx.save();
      ctx.translate(rng() * w, rng() * h);
      ctx.rotate((rng() - 0.5) * 0.9);
      ctx.beginPath();
      ctx.moveTo(-len / 2, 0); ctx.lineTo(-len * 0.1, -thick / 2); ctx.lineTo(len / 2, -thick * 0.1); ctx.lineTo(len * 0.15, thick / 2);
      ctx.fill();
      ctx.restore();
    }
  },
  // Soft-edged organic blotches.
  blotch(ctx, w, h, p, rng) {
    for (let i = 0; i < (w * h) / 1800; i++) {
      const cx = rng() * w, cy = rng() * h, r = 10 + rng() * 26;
      ctx.fillStyle = pick(p.camo, rng);
      ctx.beginPath();
      for (let k = 0; k <= 10; k++) {
        const a = (k / 10) * Math.PI * 2, rr = r * (0.65 + rng() * 0.5);
        ctx.lineTo(cx + Math.cos(a) * rr * 1.6, cy + Math.sin(a) * rr);
      }
      ctx.fill();
    }
  },
  // Dark lower hull, light upper band.
  classic(ctx, w, h, p) {
    ctx.fillStyle = p.camo[1];
    ctx.fillRect(0, 0, w, h * 0.22);
    ctx.fillStyle = p.camo[0];
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
  },
  // Plain hull with fine trim lines.
  pinstripe(ctx, w, h, p) {
    ctx.fillStyle = p.accent;
    ctx.fillRect(0, h * 0.16, w, 2);
    ctx.fillRect(0, h * 0.2, w, 5);
    ctx.fillRect(0, h * 0.86, w, 3);
  },
  // Raked tiger stripes.
  tiger(ctx, w, h, p, rng) {
    ctx.fillStyle = p.camo[0];
    for (let x = 10; x < w; x += 34 + rng() * 26) {
      const len = h * (0.35 + rng() * 0.55), top = rng() < 0.5;
      const lean = 18 + rng() * 14;
      ctx.beginPath();
      if (top) {
        ctx.moveTo(x, 0); ctx.lineTo(x + 12, 0); ctx.lineTo(x + lean, len);
      } else {
        ctx.moveTo(x, h); ctx.lineTo(x + 12, h); ctx.lineTo(x - lean, h - len);
      }
      ctx.fill();
    }
  },
  // Pixelated "digital" camouflage.
  digital(ctx, w, h, p, rng) {
    const s = 8;
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        if (rng() < 0.55) continue;
        ctx.fillStyle = pick(p.camo, rng);
        const run = 1 + Math.floor(rng() * 4);
        ctx.fillRect(x, y, s * run, s);
        x += s * (run - 1);
      }
    }
  },
};

// Shark mouth and eye at the bow. `aspect` undoes the texture's horizontal stretch on the hull.
function sharkMouth(ctx, w, water, aspect) {
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(aspect, 1);
  const mh = water * 0.5, my = water * 0.52, mw = mh * 2.1;
  ctx.fillStyle = '#7d0b0b';
  ctx.beginPath();
  ctx.moveTo(-4, my - mh * 0.1);
  ctx.quadraticCurveTo(-mw * 0.6, my - mh * 0.55, -mw, my);
  ctx.quadraticCurveTo(-mw * 0.6, my + mh * 0.6, -4, my + mh * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f4f1ea';
  const teeth = 7;
  const curve = (kk) => Math.sin(kk * Math.PI) * mh * 0.25;
  for (let i = 0; i < teeth; i++) {
    const k = i / teeth, k2 = (i + 1) / teeth;
    const x0 = -4 - mw * k, x1 = -4 - mw * k2;
    ctx.beginPath();
    ctx.moveTo(x0, my - mh * 0.1 - curve(k));
    ctx.lineTo(x1, my - mh * 0.1 - curve(k2));
    ctx.lineTo((x0 + x1) / 2, my + mh * 0.12 - curve((k + k2) / 2));
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x0, my + mh * 0.35 + curve(k) * 0.6);
    ctx.lineTo(x1, my + mh * 0.35 + curve(k2) * 0.6);
    ctx.lineTo((x0 + x1) / 2, my + mh * 0.12 + curve((k + k2) / 2) * 0.6);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(-mw * 1.15, my - mh * 0.55, mh * 0.22, mh * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(-mw * 1.12, my - mh * 0.55, mh * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function chevron(ctx, w, water, aspect, color) {
  ctx.fillStyle = color;
  ctx.save();
  ctx.translate(w * 0.9, water * 0.5);
  ctx.scale(aspect, 1);
  const s = water * 0.42;
  ctx.beginPath();
  ctx.moveTo(-s, -s); ctx.lineTo(0, 0); ctx.lineTo(-s, s);
  ctx.lineTo(-s * 1.45, s); ctx.lineTo(-s * 0.45, 0); ctx.lineTo(-s * 1.45, -s);
  ctx.fill();
  ctx.restore();
}

// One hull side: bow at the right (x = w), deck edge at the top, waterline at y = water.
function paintSide(ctx, p, w, h, water, aspect, rng) {
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, w, h);
  PAINTERS[p.style](ctx, w, water, p, rng);

  // Hull plating seams, weathering streaks from the scuppers, and portholes.
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  for (let x = 14; x < w; x += 30) ctx.fillRect(x, 0, 1.5, water);
  ctx.fillRect(0, water * 0.45, w, 1.5);
  for (let i = 0; i < 26; i++) {
    const x = rng() * w, len = water * (0.25 + rng() * 0.6);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, p.streak);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 4, 2 + rng() * 3, len);
  }
  ctx.fillStyle = 'rgba(12,16,20,0.85)';
  for (let x = w * 0.3; x < w * 0.75; x += 26) {
    ctx.beginPath();
    ctx.ellipse(x, water * 0.22, 3 * aspect, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (p.bow === 'chevron') chevron(ctx, w, water, aspect, p.accent);
  if (p.bow === 'shark') sharkMouth(ctx, w, water, aspect);
  if (p.hazard) {
    // Hazard stripes on the stern quarter.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w * 0.07, water);
    ctx.clip();
    for (let x = -water, i = 0; x < w * 0.07 + water; x += 22, i++) {
      ctx.fillStyle = i % 2 ? '#141414' : '#c43a2f';
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x + 11, 0); ctx.lineTo(x + 11 + water, water); ctx.lineTo(x + water, water);
      ctx.fill();
    }
    ctx.restore();
  }

  // White sheer line under the deck edge, boot-topping at the waterline, anti-fouling red below.
  ctx.fillStyle = p.style === 'pinstripe' ? p.accent : 'rgba(235,240,244,0.85)';
  ctx.fillRect(0, 3, w, 3);
  ctx.fillStyle = p.style === 'classic' ? p.accent : p.boot;
  ctx.fillRect(0, water - 10, w, 10);
  ctx.fillStyle = p.oxide;
  ctx.fillRect(0, water, w, h - water);
}

function paintTransom(ctx, p, top, water) {
  ctx.fillStyle = p.base;
  ctx.fillRect(0, top, W, TRANSOM_H);
  const wy = top + (water / SIDE_H) * TRANSOM_H;
  ctx.fillStyle = p.boot;
  ctx.fillRect(0, wy - 4, W, 4);
  ctx.fillStyle = p.oxide;
  ctx.fillRect(0, wy, W, top + TRANSOM_H - wy);
  // Emblem in the middle of the stern: a roundel, or a star for star-less schemes.
  const cx = W / 2, cy = top + (wy - top) * 0.5, r = (wy - top) * 0.32;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(0.25, 1);
  if (p.deck === 'star') {
    for (const [rr, col] of [[r, '#f4f6f8'], [r * 0.66, p.accent], [r * 0.3, '#1f3348']]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.fill();
  }
  ctx.restore();
}

function paintDeck(type, p, len, beam, seed) {
  const c = canvas(W, 256);
  const ctx = c.getContext('2d');
  const rng = mulberry32(len * 31 + seed);
  const pxU = W / len; // pixels per world unit along the ship
  if (type === 'battleship') {
    // Teak planking with staggered butt joints.
    for (let y = 0; y < 256; y += 8) {
      const shade = 140 + rng() * 30;
      ctx.fillStyle = `rgb(${shade + 20},${shade - 10},${shade - 50})`;
      ctx.fillRect(0, y, W, 8);
      ctx.fillStyle = 'rgba(40,25,10,0.55)';
      ctx.fillRect(0, y + 7, W, 1);
      for (let x = rng() * 120; x < W; x += 90 + rng() * 60) ctx.fillRect(x, y, 1, 7);
    }
  } else {
    // Grey non-skid with a speckle.
    ctx.fillStyle = '#62696f';
    ctx.fillRect(0, 0, W, 256);
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
      ctx.fillRect(rng() * W, rng() * 256, 2, 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 0; x < W; x += 40) ctx.fillRect(x, 0, 1, 256);
  }
  // Centerline and edge safety lines.
  ctx.fillStyle = 'rgba(240,240,230,0.8)';
  for (let x = 20; x < W * 0.95; x += 34) ctx.fillRect(x, 127, 18, 2);
  ctx.fillStyle = 'rgba(240,200,40,0.7)';
  ctx.fillRect(0, 14, W, 3);
  ctx.fillRect(0, 239, W, 3);

  // Helicopter pad on the destroyer's stern.
  if (type === 'destroyer') {
    ctx.save();
    ctx.translate((-9.6 + len / 2) * pxU, 128);
    ctx.scale(pxU / (256 / beam), 1);
    ctx.strokeStyle = '#f2f2ea';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 80, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f2f2ea';
    ctx.font = 'bold 110px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.rotate(Math.PI / 2);
    ctx.fillText('H', 0, 6);
    ctx.restore();
  }

  // Air-recognition panel on the foredeck.
  const fx = W * 0.72, fw = W * 0.08;
  if (p.deck === 'star') {
    ctx.fillStyle = p.accent;
    ctx.fillRect(fx, 70, fw, 116);
    ctx.fillStyle = '#f4f6f8';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 16 : 40;
      ctx.lineTo(fx + fw / 2 + Math.cos(a) * r * (fw / 100), 128 + Math.sin(a) * r);
    }
    ctx.fill();
  } else {
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#f4f1ea' : p.accent;
      ctx.fillRect(fx + (i * fw) / 6, 70, fw / 6, 116);
    }
  }
  return texture(c);
}

const sideCache = new Map();
const seedOf = (id) => [...id].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) % 9973;

/**
 * Livery materials for a surface hull: [deck, sides] to go with hullUVs().
 * len/beam/depth/y describe the hull box (y = keel height, local).
 */
export function hullLivery(type, liveryId, { len, beam, depth, y }, finish) {
  const key = `${type}-${liveryId}`;
  if (!sideCache.has(key)) {
    const p = livery(liveryId);
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    const rng = mulberry32(len * 97 + seedOf(liveryId));
    // Where the waterline (local y = 0.1) falls on the band, in pixels from the deck edge.
    const water = Math.round(SIDE_H * (1 - (0.1 - y) / depth));
    // Pixels per world unit horizontally vs vertically, to keep round shapes round on the hull.
    const aspect = (SIDE_H / depth) / (W / len);
    for (const top of [0, SIDE_H]) {
      ctx.save();
      ctx.translate(0, top);
      ctx.beginPath();
      ctx.rect(0, 0, W, SIDE_H);
      ctx.clip();
      paintSide(ctx, p, W, SIDE_H, water, aspect, rng);
      ctx.restore();
    }
    paintTransom(ctx, p, SIDE_H * 2, water);
    sideCache.set(key, [
      new THREE.MeshStandardMaterial({ map: paintDeck(type, p, len, beam, seedOf(liveryId)), roughness: 0.8, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ map: texture(c), ...finish }),
    ]);
  }
  return sideCache.get(key);
}

// Map an extruded hull (see models.js hullGeo) onto the livery layout.
export function hullUVs(geo, len, beam, depth) {
  const L = len / 2, B = beam / 2;
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  const bands = [
    [1 - SIDE_H / H, 1], // starboard (+z)
    [1 - (2 * SIDE_H) / H, 1 - SIDE_H / H], // port (-z)
    [0, TRANSOM_H / H], // transom
  ];
  const vOf = (band, yy) => {
    const [lo, hi] = bands[band];
    return lo + PAD + (hi - lo - 2 * PAD) * THREE.MathUtils.clamp(yy / depth, 0, 1);
  };
  for (const g of geo.groups) {
    for (let i = g.start; i < g.start + g.count; i += 3) {
      if (g.materialIndex === 0) {
        for (let k = i; k < i + 3; k++) uv.setXY(k, (p.getX(k) + L) / len, (p.getZ(k) + B) / beam);
        continue;
      }
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      const transom = cx < -L * 0.98 && Math.abs(p.getX(i) - p.getX(i + 1)) < 0.01 && Math.abs(p.getX(i) - p.getX(i + 2)) < 0.01;
      const band = transom ? 2 : cz >= 0 ? 0 : 1;
      for (let k = i; k < i + 3; k++) {
        const u = transom ? (p.getZ(k) + B) / beam : (p.getX(k) + L) / len;
        uv.setXY(k, u, vOf(band, p.getY(k)));
      }
    }
  }
  uv.needsUpdate = true;
  return geo;
}

// Submarine skin: anechoic tiles tinted by the scheme, a band near the bow and draught marks.
const subCache = new Map();
export function subLivery(liveryId, finish) {
  if (!subCache.has(liveryId)) {
    const p = livery(liveryId);
    const c = canvas(256, 1024);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1d2227';
    ctx.fillRect(0, 0, 256, 1024);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = p.base;
    ctx.fillRect(0, 0, 256, 1024);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < 1024; y += 14) ctx.fillRect(0, y, 256, 1.5);
    for (let x = 0; x < 256; x += 10) ctx.fillRect(x, 0, 1.5, 1024);
    const rng = mulberry32(seedOf(liveryId));
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 400; i++) ctx.fillRect(Math.floor(rng() * 26) * 10, Math.floor(rng() * 73) * 14, 10, 14);
    ctx.fillStyle = p.accent;
    ctx.fillRect(0, 1024 - 150, 256, 14);
    ctx.fillRect(0, 1024 - 172, 256, 5);
    ctx.fillStyle = 'rgba(230,230,220,0.7)';
    for (let y = 80; y < 1000; y += 140) ctx.fillRect(120, y, 16, 4);
    subCache.set(liveryId, new THREE.MeshStandardMaterial({ map: texture(c), ...finish }));
  }
  return subCache.get(liveryId);
}

// Pennant number decal, unique per ship. Returns { material, dispose }.
export function pennantDecal(text, liveryId) {
  const c = canvas(256, 128);
  const ctx = c.getContext('2d');
  ctx.font = 'bold 86px "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 10;
  ctx.strokeStyle = livery(liveryId).outline;
  ctx.strokeText(text, 128, 68);
  ctx.fillStyle = '#f4f6f8';
  ctx.fillText(text, 128, 68);
  const map = texture(c);
  const material = new THREE.MeshStandardMaterial({
    map, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4,
  });
  return { material, dispose() { map.dispose(); material.dispose(); } };
}

/**
 * A side-on profile of a destroyer in this scheme, for the store. Draws into `c` (any size).
 */
export function drawPreview(c, liveryId) {
  const p = livery(liveryId);
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);
  const deckY = h * 0.5, water = h * 0.72, sx = w * 0.06, ex = w * 0.95;
  const hullW = ex - sx, hullH = water - deckY;

  // Superstructure, mast and funnel in grey with the accent band.
  ctx.fillStyle = '#9aa3ab';
  ctx.fillRect(sx + hullW * 0.42, deckY - hullH * 0.9, hullW * 0.22, hullH * 0.9);
  ctx.fillRect(sx + hullW * 0.5, deckY - hullH * 1.55, hullW * 0.12, hullH * 0.7);
  ctx.fillStyle = '#1d2b38';
  ctx.fillRect(sx + hullW * 0.6, deckY - hullH * 1.4, hullW * 0.02, hullH * 0.18);
  ctx.fillStyle = '#9aa3ab';
  ctx.fillRect(sx + hullW * 0.32, deckY - hullH * 1.25, hullW * 0.06, hullH * 1.25);
  ctx.fillStyle = p.accent;
  ctx.fillRect(sx + hullW * 0.32, deckY - hullH * 0.95, hullW * 0.06, hullH * 0.16);
  ctx.fillStyle = '#22282e';
  ctx.fillRect(sx + hullW * 0.32, deckY - hullH * 1.3, hullW * 0.06, hullH * 0.12);
  ctx.fillRect(sx + hullW * 0.545, deckY - hullH * 2.5, 2, hullH * 1.0);
  ctx.fillStyle = p.accent;
  ctx.fillRect(sx + hullW * 0.545 - 9, deckY - hullH * 2.5, 9, 6);
  // Gun turrets fore and aft.
  ctx.fillStyle = '#9aa3ab';
  for (const [fx, dir] of [[0.78, 1], [0.12, -1]]) {
    ctx.fillRect(sx + hullW * fx, deckY - hullH * 0.35, hullW * 0.06, hullH * 0.35);
    ctx.fillStyle = '#22282e';
    ctx.fillRect(sx + hullW * (fx + (dir > 0 ? 0.06 : -0.06)), deckY - hullH * 0.25, hullW * 0.06, 2);
    ctx.fillStyle = '#9aa3ab';
  }

  // Hull silhouette (raked bow, square stern) filled with the side paint.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, deckY);
  ctx.lineTo(ex, deckY - hullH * 0.25);
  ctx.lineTo(ex - hullW * 0.06, h * 0.92);
  ctx.lineTo(sx + hullW * 0.02, h * 0.92);
  ctx.closePath();
  ctx.clip();
  ctx.translate(sx, deckY - hullH * 0.25);
  const ph = h * 0.92 - (deckY - hullH * 0.25);
  const pwater = water - (deckY - hullH * 0.25);
  paintSide(ctx, p, hullW, ph, pwater, 1, mulberry32(seedOf(liveryId)));
  ctx.restore();

  // Sea.
  const g = ctx.createLinearGradient(0, water, 0, h);
  g.addColorStop(0, 'rgba(18,70,100,0.85)');
  g.addColorStop(1, 'rgba(6,30,48,0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(0, water, w, h - water);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, water, w, 1.5);
}
