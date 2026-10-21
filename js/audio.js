// Small synthesized sound kit. Browsers only allow audio after a user gesture, so call unlock() from a click.
let ctx = null;
let master = null;
let noise = null;
let muted = false;
const lastPlayed = {};

function noiseBuffer() {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(ctx.destination);
  noise = noiseBuffer();
  startSurf();
  startMusic();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.6, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;

// Low rolling surf so the sea is never silent.
function startSurf() {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  const gain = ctx.createGain();
  gain.gain.value = 0.05;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.12;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.03;
  lfo.connect(lfoGain).connect(gain.gain);
  src.connect(lp).connect(gain).connect(master);
  src.start();
  lfo.start();
}

// Mysterious war ambience, all synthesized: a dark drone on D, slow phrygian pads, distant war drums,
// far-off gunfire rumbles and the odd sonar ping, all sent through an echoing delay so it feels like open sea and fog.
const D = 36.71; // D1
const PHRYGIAN = [1, 16 / 15, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5]; // D Eb F G A Bb C
let music = null;

function startMusic() {
  const bus = ctx.createGain();
  bus.gain.value = 0.55;
  bus.connect(master);
  // Echo that darkens each repeat.
  const echo = ctx.createDelay(2);
  echo.delayTime.value = 0.62;
  const fb = ctx.createGain();
  fb.gain.value = 0.5;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 1400;
  const wet = ctx.createGain();
  wet.gain.value = 0.6;
  echo.connect(damp).connect(fb).connect(echo);
  damp.connect(wet).connect(bus);
  music = { bus, send: echo };

  // Drone: two detuned saws and a sub sine, with a slowly breathing filter.
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 260;
  droneFilter.Q.value = 4;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.11;
  droneFilter.connect(droneGain).connect(bus);
  for (const [f, type, detune] of [[D, 'sawtooth', -6], [D, 'sawtooth', 7], [D / 2, 'sine', 0], [D * 1.5, 'triangle', 3]]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    osc.detune.value = detune;
    osc.connect(droneFilter);
    osc.start();
  }
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.045;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 170;
  lfo.connect(lfoGain).connect(droneFilter.frequency);
  lfo.start();

  const rand = (a, b) => a + Math.random() * (b - a);
  const later = (fn, min, max) => setTimeout(() => { if (ctx) fn(); }, rand(min, max) * 1000);

  // Pads: a slow swell of two or three notes from the scale.
  const pad = () => {
    if (ctx.state === 'running') {
      const root = [1, 1, 4 / 3, 6 / 5][Math.floor(Math.random() * 4)];
      const notes = [root, root * PHRYGIAN[Math.floor(rand(1, 7))], root * 2 * PHRYGIAN[Math.floor(rand(0, 5))]];
      const t0 = ctx.currentTime + 0.05;
      const len = rand(7, 11);
      for (const m of notes) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = D * 4 * m;
        osc.detune.value = rand(-8, 8);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.035, t0 + len * 0.45);
        g.gain.linearRampToValueAtTime(0, t0 + len);
        osc.connect(g);
        g.connect(bus);
        g.connect(echo);
        osc.start(t0);
        osc.stop(t0 + len + 0.1);
      }
    }
    later(pad, 6, 11);
  };

  // Distant war drum: a soft low thump or a short rolling phrase.
  const drum = () => {
    if (ctx.state === 'running') {
      const hits = Math.random() < 0.5 ? 1 : 3;
      for (let i = 0; i < hits; i++) {
        const t0 = ctx.currentTime + i * 0.42;
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(95, t0);
        osc.frequency.exponentialRampToValueAtTime(42, t0 + 0.25);
        const g = ctx.createGain();
        g.gain.setValueAtTime(i === hits - 1 ? 0.28 : 0.16, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
        osc.connect(g);
        g.connect(bus);
        g.connect(echo);
        osc.start(t0);
        osc.stop(t0 + 1);
      }
    }
    later(drum, 9, 20);
  };

  // Far-off gunfire: a low muffled boom.
  const rumble = () => {
    if (ctx.state === 'running') {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(260, ctx.currentTime);
      lp.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 2.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.6);
      src.connect(lp).connect(g);
      g.connect(bus);
      g.connect(echo);
      src.start(ctx.currentTime, Math.random() * 1.5, 2.8);
    }
    later(rumble, 7, 18);
  };

  // Sonar ping with a long echo tail.
  const ping = () => {
    if (ctx.state === 'running') {
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.frequency.value = [880, 1175, 1320][Math.floor(Math.random() * 3)];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + 1.4);
      osc.connect(g);
      g.connect(bus);
      g.connect(echo);
      osc.start(t0);
      osc.stop(t0 + 1.5);
    }
    later(ping, 14, 32);
  };

  later(pad, 0.5, 1.5);
  later(drum, 6, 10);
  later(rumble, 4, 9);
  later(ping, 10, 20);
}

// volume falls off with distance from the camera focus; rate-limited so big fights don't clip.
function burst({ duration, freq, q = 1, type = 'lowpass', volume, sweepTo, minGap = 0.04, key }) {
  if (!ctx || muted || volume <= 0.01) return;
  const now = ctx.currentTime;
  if (key && now - (lastPlayed[key] || 0) < minGap) return;
  if (key) lastPlayed[key] = now;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, now);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, now + duration);
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  src.connect(filter).connect(gain).connect(master);
  src.start(now, Math.random() * 1.5, duration + 0.05);
}

function tone(freqs, { duration = 0.12, volume = 0.15, type = 'sine', gap = 0.09 } = {}) {
  if (!ctx || muted) return;
  freqs.forEach((f, i) => {
    const t0 = ctx.currentTime + i * gap;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  });
}

export const sfx = {
  gun(vol, big = false) {
    burst({ duration: big ? 0.9 : 0.35, freq: big ? 900 : 1800, sweepTo: 120, volume: vol * (big ? 0.9 : 0.5), key: big ? 'bigGun' : 'gun', minGap: 0.05 });
  },
  explosion(vol, big = false) {
    burst({ duration: big ? 2.2 : 1.1, freq: big ? 500 : 700, sweepTo: 60, volume: vol * (big ? 1 : 0.7), key: 'boom', minGap: 0.08 });
  },
  splash(vol) {
    burst({ duration: 0.5, freq: 2500, type: 'bandpass', q: 0.7, sweepTo: 600, volume: vol * 0.35, key: 'splash', minGap: 0.06 });
  },
  torpedo(vol) {
    burst({ duration: 1.2, freq: 300, type: 'bandpass', q: 3, sweepTo: 900, volume: vol * 0.5, key: 'torp' });
  },
  // Two long, low blasts through a muffling filter.
  foghorn() {
    if (!ctx || muted) return;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.connect(master);
    for (const start of [0, 2.4]) {
      const t0 = ctx.currentTime + start;
      for (const f of [92, 138]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.09, t0 + 0.25);
        gain.gain.setValueAtTime(0.09, t0 + 1.6);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 2.1);
        osc.connect(gain).connect(lp);
        osc.start(t0);
        osc.stop(t0 + 2.2);
      }
    }
  },
  click() { tone([660], { duration: 0.06, volume: 0.08, type: 'triangle' }); },
  order() { tone([520, 780], { duration: 0.08, volume: 0.07, type: 'triangle', gap: 0.05 }); },
  denied() { tone([220, 180], { duration: 0.12, volume: 0.1, type: 'square', gap: 0.1 }); },
  built() { tone([523, 659, 784], { duration: 0.18, volume: 0.1 }); },
  captured() { tone([392, 523, 659, 784], { duration: 0.22, volume: 0.12 }); },
  lost() { tone([523, 415, 330], { duration: 0.25, volume: 0.12, type: 'triangle' }); },
  victory() { tone([523, 659, 784, 1047], { duration: 0.5, volume: 0.15, gap: 0.16 }); },
  defeat() { tone([392, 330, 262, 196], { duration: 0.6, volume: 0.15, type: 'triangle', gap: 0.22 }); },
};

// Start the sound as soon as the page loads. Browsers keep the audio context suspended until the player
// interacts, so also retry on the first click, key press or touch, and stop listening once it is running.
const GESTURES = ['pointerdown', 'keydown', 'touchstart'];
function autoStart() {
  unlock();
  if (ctx && ctx.state === 'running') {
    for (const e of GESTURES) window.removeEventListener(e, autoStart, true);
  }
}
for (const e of GESTURES) window.addEventListener(e, autoStart, true);
autoStart();
