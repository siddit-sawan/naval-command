import * as THREE from 'three';
import { MAP } from './config.js';
import { t, upper } from './i18n.js';

// The ship's bridge in first-person view: a wrap-around wheelhouse with tall raked windows on every
// side, a ceiling with light strips and hanging monitors, wipers, and a low curved console with four
// live screens (weapons, tactical radar, navigation, status). Built around the eye at the origin
// with +x forward, then shrunk so it sits just around the camera and never touches the ship model.

const SCALE = 0.32;
const N = 18; // window bays around the wheelhouse
const HEADER = 0.52;
const CEILING = 0.7;
const LEAN = 1.1; // window tops lean outward, like a real bridge
const RADAR_RANGE = 320;

// Top-view outline: longer toward the bow than the stern, and wide.
function outlineAt(theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c * (c > 0 ? 1.9 : 1.45), s * 2.3];
}
// Windows reach lower at the front so you can see the bow.
const sillAt = (theta) => -0.7 - 0.28 * Math.max(Math.cos(theta), 0);

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.3, fog: false, side: THREE.DoubleSide, ...extra });

// A band of quads around (part of) the outline between two heights and two outline scales.
function band(from, to, steps, y0, k0, y1, k1) {
  const pos = [];
  for (let i = 0; i < steps; i++) {
    const a = from + ((to - from) * i) / steps, b = from + ((to - from) * (i + 1)) / steps;
    const [ax, az] = outlineAt(a), [bx, bz] = outlineAt(b);
    const ya0 = typeof y0 === 'function' ? y0(a) : y0, yb0 = typeof y0 === 'function' ? y0(b) : y0;
    const ya1 = typeof y1 === 'function' ? y1(a) : y1, yb1 = typeof y1 === 'function' ? y1(b) : y1;
    const p = [
      [ax * k0, ya0, az * k0], [bx * k0, yb0, bz * k0], [bx * k1, yb1, bz * k1], [ax * k1, ya1, az * k1],
    ];
    pos.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A thin rod between two points.
function rod(a, b, r, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 6), material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

function screen(name) {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 220;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { name, canvas: c, ctx: c.getContext('2d'), tex };
}

export function createBridge(scene) {
  const group = new THREE.Group();
  group.visible = false;
  const frameMat = mat(0x1e252c);
  const trimMat = mat(0x39434d);
  const consoleMat = mat(0x262d34, { roughness: 0.85 });
  const ceilingMat = mat(0x2c343c, { roughness: 0.9 });
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.5), fog: false });

  // Window frame: sill shelf, the wall below it, header band and ceiling.
  group.add(new THREE.Mesh(band(0, Math.PI * 2, 72, sillAt, 1, (t) => sillAt(t) - 0.03, 0.9), trimMat));
  group.add(new THREE.Mesh(band(0, Math.PI * 2, 72, (t) => sillAt(t) - 0.03, 0.9, -2.2, 0.9), frameMat));
  group.add(new THREE.Mesh(band(0, Math.PI * 2, 72, HEADER, LEAN, CEILING, LEAN * 0.97), frameMat));
  const ceil = band(0, Math.PI * 2, 72, CEILING, LEAN * 0.97, CEILING + 0.02, 0);
  group.add(new THREE.Mesh(ceil, ceilingMat));
  // Light strips in the ceiling.
  for (const z of [-0.9, 0, 0.9]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.02, 0.08), lightMat);
    strip.position.set(0, CEILING - 0.01, z);
    group.add(strip);
  }

  // Window posts at every bay boundary, raked outward toward the top, and a top rail.
  for (let i = 0; i < N; i++) {
    const t = ((i + 0.5) / N) * Math.PI * 2;
    const [x, z] = outlineAt(t);
    const bottom = new THREE.Vector3(x, sillAt(t), z);
    const top = new THREE.Vector3(x * LEAN, HEADER, z * LEAN);
    group.add(rod(bottom, top, Math.abs(Math.cos(t)) > 0.95 ? 0.025 : 0.035, frameMat));
  }

  // Monitors hanging from the ceiling at the front corners.
  for (const side of [-1, 1]) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.3), consoleMat);
    box.position.set(1.15, HEADER - 0.12, side * 1.35);
    box.rotation.y = side * 0.5;
    group.add(box);
    group.add(rod(new THREE.Vector3(1.15, CEILING, side * 1.35), new THREE.Vector3(1.15, HEADER - 0.03, side * 1.35), 0.01, frameMat));
  }

  // Curved console across the front: desk top and front face.
  const deskFrom = -1.05, deskTo = 1.05;
  const deskY = -0.86;
  group.add(new THREE.Mesh(band(deskFrom, deskTo, 30, (t) => sillAt(t) - 0.04, 0.9, deskY, 0.62), consoleMat));
  group.add(new THREE.Mesh(band(deskFrom, deskTo, 30, deskY, 0.62, -2.2, 0.62), frameMat));

  // Screens standing on the desk, angled up at the captain, with a gap in the middle for the bow.
  const screens = [];
  const layout = [['WEAPONS', -0.66], ['TACTICAL', -0.29], ['NAV', 0.29], ['STATUS', 0.66]];
  const target = new THREE.Vector3(0, 0, 0);
  for (const [name, t] of layout) {
    const s = screen(name);
    const [x, z] = outlineAt(t);
    const k = 0.78;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.33, 0.03), consoleMat);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.295), new THREE.MeshBasicMaterial({ map: s.tex, fog: false, toneMapped: false }));
    const holder = new THREE.Group();
    holder.position.set(x * k, deskY + 0.15, z * k);
    group.add(holder);
    holder.lookAt(target);
    holder.add(bezel);
    panel.position.z = 0.017;
    holder.add(panel);
    screens.push(s);
  }

  // Throttle lever in the middle of the desk.
  const leverBase = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.12), consoleMat);
  leverBase.position.set(1.08, deskY + 0.02, 0);
  group.add(leverBase);
  const lever = new THREE.Group();
  lever.position.set(1.08, deskY + 0.04, 0);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6).translate(0, 0.07, 0), trimMat);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc43a2f, roughness: 0.4, fog: false }));
  knob.position.y = 0.14;
  lever.add(handle, knob);
  group.add(lever);

  group.scale.setScalar(SCALE);
  scene.add(group);

  // ---------- Screen painters ----------
  const GREEN = '#4cd68a', AMBER = '#f0b429', RED = '#ff5a4f', CYAN = '#7fd0ff', DIM = '#2f6f86';

  function frameScreen(s, title) {
    const c = s.ctx;
    c.fillStyle = '#03101a';
    c.fillRect(0, 0, 320, 220);
    c.strokeStyle = DIM;
    c.lineWidth = 2;
    c.strokeRect(4, 4, 312, 212);
    c.fillStyle = CYAN;
    c.font = 'bold 15px Consolas, monospace';
    c.textAlign = 'left';
    c.fillText(title, 12, 22);
    c.fillStyle = DIM;
    c.fillRect(12, 28, 296, 1.5);
  }

  function bar(c, x, y, w, h, frac, color) {
    c.fillStyle = '#0b2230';
    c.fillRect(x, y, w, h);
    c.fillStyle = color;
    c.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
    c.strokeStyle = DIM;
    c.strokeRect(x, y, w, h);
  }

  // Every weapon the ship carries, with the selected one highlighted and its reload bar.
  function paintWeapons(s, helm, game) {
    frameScreen(s, t('WEAPONS'));
    const c = s.ctx;
    const list = helm.weapons || [{ name: helm.stats.weapon === 'torpedo' ? 'Torpedoes' : 'Main guns', reload: helm.stats.reload }];
    const rowH = list.length > 2 ? 58 : 80;
    list.forEach((w, i) => {
      const y = 40 + i * rowH;
      const sel = !helm.weapons || i === helm.weaponIdx;
      const cd = helm.wcool ? helm.wcool[i] : helm.cooldown;
      const online = !helm.weapons || game.weaponsOnline(helm.team, i);
      const ready = cd <= 0 && online;
      if (sel) {
        c.fillStyle = 'rgba(127,208,255,0.12)';
        c.fillRect(10, y, 300, rowH - 6);
      }
      c.font = `bold ${sel ? 16 : 14}px Consolas, monospace`;
      c.textAlign = 'left';
      c.fillStyle = sel ? '#e6f2fa' : CYAN;
      c.fillText(`${i + 1} ${upper(w.name)}`, 18, y + 20);
      c.textAlign = 'right';
      c.fillStyle = !online ? RED : ready ? GREEN : AMBER;
      c.fillText(!online ? t('OFFLINE') : ready ? t('READY') : `${cd.toFixed(1)}s`, 302, y + 20);
      bar(c, 18, y + 30, 284, 10, ready ? 1 : 1 - cd / w.reload, ready ? GREEN : AMBER);
    });
  }

  function paintTactical(s, helm, game, time) {
    frameScreen(s, t('TACTICAL'));
    const c = s.ctx;
    const cx = 160, cy = 124, r = 86;
    const scale = r / RADAR_RANGE;
    c.strokeStyle = '#0f4a3a';
    c.lineWidth = 1;
    for (const k of [1, 2 / 3, 1 / 3]) {
      c.beginPath();
      c.arc(cx, cy, r * k, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r);
    c.stroke();
    // Sweep.
    const sweep = time * 2.2;
    const g = c.createConicGradient ? c.createConicGradient(sweep - Math.PI / 2, cx, cy) : null;
    if (g) {
      g.addColorStop(0, 'rgba(76,214,138,0.35)');
      g.addColorStop(0.12, 'rgba(76,214,138,0)');
      g.addColorStop(1, 'rgba(76,214,138,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();
    }
    // Heading-up: forward is up the screen.
    const ch = Math.cos(helm.heading), sh = Math.sin(helm.heading);
    const plot = (x, z) => {
      const dx = x - helm.x, dz = z - helm.z;
      const fwd = dx * ch + dz * sh, right = -dx * sh + dz * ch;
      return [cx + right * scale, cy - fwd * scale, Math.hypot(fwd, right) < RADAR_RANGE];
    };
    c.save();
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(201,178,122,0.6)';
    for (const is of MAP.islands) {
      const [x, y] = plot(is.x, is.z);
      c.beginPath();
      c.arc(x, y, is.r * scale, 0, Math.PI * 2);
      c.fill();
    }
    for (const o of game.outposts) {
      const [x, y] = plot(o.x, o.z);
      c.fillStyle = o.owner === 'player' ? CYAN : o.owner === 'enemy' ? RED : '#c9d6df';
      c.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const u of game.units) {
      if (!u.alive || u === helm || !game.visibleTo(u, 'player')) continue;
      const [x, y] = plot(u.x, u.z);
      c.fillStyle = u.team === 'player' ? GREEN : RED;
      c.beginPath();
      c.arc(x, y, u.team === 'player' ? 3 : 4, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    c.fillStyle = GREEN;
    c.beginPath();
    c.moveTo(cx, cy - 6); c.lineTo(cx + 4, cy + 4); c.lineTo(cx - 4, cy + 4);
    c.fill();
    c.font = '12px Consolas, monospace';
    c.fillStyle = DIM;
    c.textAlign = 'right';
    c.fillText(`${RADAR_RANGE} m`, 308, 212);
  }

  function paintNav(s, helm, input) {
    frameScreen(s, t('NAVIGATION'));
    const c = s.ctx;
    const bearing = ((Math.atan2(Math.cos(helm.heading), -Math.sin(helm.heading)) * 180) / Math.PI + 360) % 360;
    // Heading tape.
    c.save();
    c.beginPath();
    c.rect(12, 36, 296, 44);
    c.clip();
    c.strokeStyle = CYAN;
    c.fillStyle = CYAN;
    c.font = '12px Consolas, monospace';
    c.textAlign = 'center';
    for (let d = Math.floor(bearing / 10) * 10 - 60; d <= bearing + 60; d += 10) {
      const x = 160 + (d - bearing) * 2.4;
      const major = ((d % 30) + 30) % 30 === 0;
      c.fillRect(x, 70 - (major ? 14 : 7), 1.5, major ? 14 : 7);
      if (major) {
        const v = ((d % 360) + 360) % 360;
        c.fillText({ 0: t('N'), 90: t('E'), 180: t('S'), 270: t('W') }[v] || String(v).padStart(3, '0'), x, 50);
      }
    }
    c.restore();
    c.fillStyle = AMBER;
    c.beginPath();
    c.moveTo(160, 78); c.lineTo(154, 88); c.lineTo(166, 88);
    c.fill();
    c.font = 'bold 30px Consolas, monospace';
    c.textAlign = 'left';
    c.fillStyle = '#e6f2fa';
    c.fillText(`${String(Math.round(bearing) % 360).padStart(3, '0')}°`, 22, 126);
    c.textAlign = 'right';
    c.fillText(`${Math.round(Math.abs(helm.speed) * 2)} kn`, 298, 126);
    c.font = '13px Consolas, monospace';
    c.fillStyle = DIM;
    c.textAlign = 'left';
    c.fillText(t('HEADING'), 22, 144);
    c.textAlign = 'right';
    c.fillText(helm.speed < -0.2 ? t('SPEED (ASTERN)') : t('SPEED'), 298, 144);
    // Engine order and rudder.
    c.textAlign = 'left';
    c.fillStyle = CYAN;
    c.fillText(t('ENGINE'), 22, 172);
    const order = input.throttle > 0 ? t('FULL AHEAD') : input.throttle < 0 ? t('ASTERN') : t('STOP');
    c.fillStyle = input.throttle > 0 ? GREEN : input.throttle < 0 ? RED : AMBER;
    c.font = 'bold 15px Consolas, monospace';
    c.fillText(order, 90, 172);
    c.font = '13px Consolas, monospace';
    c.fillStyle = CYAN;
    c.fillText(t('RUDDER'), 22, 200);
    bar(c, 90, 189, 200, 14, 0, GREEN);
    c.fillStyle = AMBER;
    c.fillRect(190 + input.rudder * 96 - 3, 187, 6, 18);
    c.fillStyle = DIM;
    c.fillRect(189, 186, 2, 20);
  }

  function paintStatus(s, helm, game) {
    frameScreen(s, t('STATUS'));
    const c = s.ctx;
    const hp = helm.hp / helm.maxHp;
    c.font = 'bold 18px Consolas, monospace';
    c.fillStyle = '#e6f2fa';
    c.textAlign = 'left';
    c.fillText(upper(t('HMS {name}', { name: helm.name || '' })), 14, 56);
    c.font = '13px Consolas, monospace';
    c.fillStyle = DIM;
    c.fillText(upper(helm.stats.label), 14, 74);
    c.fillStyle = CYAN;
    c.fillText(t('HULL INTEGRITY'), 14, 104);
    const col = hp > 0.6 ? GREEN : hp > 0.3 ? AMBER : RED;
    bar(c, 14, 112, 292, 20, hp, col);
    c.font = 'bold 16px Consolas, monospace';
    c.fillStyle = col;
    c.textAlign = 'right';
    c.fillText(`${Math.round(hp * 100)}%`, 306, 104);
    c.textAlign = 'left';
    c.font = '13px Consolas, monospace';
    c.fillStyle = CYAN;
    const fleet = game.alive('player').length;
    const owned = game.outposts.filter((o) => o.owner === 'player').length;
    c.fillText(`${t('FLEET')}     ${fleet} ${t('SHIPS')}`, 14, 160);
    c.fillText(`${t('OUTPOSTS')}  ${owned} / ${game.outposts.length}`, 14, 180);
    c.fillText(`${t('TREASURY')}  ${Math.floor(game.teams.player.gold)}`, 14, 200);
    if (game.weather && game.weather.mist > 0.5) {
      c.fillStyle = AMBER;
      c.textAlign = 'right';
      c.fillText(t('FOG'), 306, 200);
    }
  }

  let paintT = 0;
  let leverAngle = 0;
  return {
    group,
    /**
     * visible: bridge view active. eye: world position of the eye; helm: the ship (its mesh gives the
     * orientation, so the wheelhouse pitches and rolls with the hull).
     */
    update(visible, helm, eye, game, input, time, dt) {
      group.visible = visible;
      if (!visible) return;
      group.position.copy(eye);
      group.quaternion.copy(helm.mesh.quaternion);
      leverAngle += ((input.throttle > 0 ? -0.6 : input.throttle < 0 ? 0.5 : 0) - leverAngle) * (1 - Math.exp(-dt * 6));
      lever.rotation.z = leverAngle;
      paintT -= dt;
      if (paintT > 0) return;
      paintT = 0.12;
      paintWeapons(screens[0], helm, game);
      paintTactical(screens[1], helm, game, time);
      paintNav(screens[2], helm, input);
      paintStatus(screens[3], helm, game);
      for (const s of screens) s.tex.needsUpdate = true;
    },
  };
}
