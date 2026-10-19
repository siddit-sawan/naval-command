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
  click() { tone([660], { duration: 0.06, volume: 0.08, type: 'triangle' }); },
  order() { tone([520, 780], { duration: 0.08, volume: 0.07, type: 'triangle', gap: 0.05 }); },
  denied() { tone([220, 180], { duration: 0.12, volume: 0.1, type: 'square', gap: 0.1 }); },
  built() { tone([523, 659, 784], { duration: 0.18, volume: 0.1 }); },
  captured() { tone([392, 523, 659, 784], { duration: 0.22, volume: 0.12 }); },
  lost() { tone([523, 415, 330], { duration: 0.25, volume: 0.12, type: 'triangle' }); },
  victory() { tone([523, 659, 784, 1047], { duration: 0.5, volume: 0.15, gap: 0.16 }); },
  defeat() { tone([392, 330, 262, 196], { duration: 0.6, volume: 0.15, type: 'triangle', gap: 0.22 }); },
};
