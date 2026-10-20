// CrazyGames SDK: loaded in the background so the game never waits on a third-party server; calls
// made before it arrives are queued in order. If it fails to load (offline, blocked), the game runs
// without it and ads fall back to a short placeholder so every reward flow can still be tested.

const sdkReady = new Promise((resolve) => {
  const script = document.createElement('script');
  script.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
  script.async = true;
  script.onload = async () => {
    try { await window.CrazyGames.SDK.init(); resolve(true); } catch { resolve(false); }
  };
  script.onerror = () => resolve(false);
  document.head.appendChild(script);
});

// Fire-and-forget lifecycle events: loadingStart/Stop, gameplayStart/Stop, happytime.
export function sdk(fn) {
  sdkReady.then((ok) => { if (ok) try { window.CrazyGames.SDK.game[fn]?.(); } catch { /* not available */ } });
}

let adRunning = false;
export const isAdRunning = () => adRunning;

/**
 * Show an ad. type: 'rewarded' (player opted in for a reward) or 'midgame' (between matches).
 * hooks.onStart / hooks.onEnd let the caller pause and mute the game around it.
 * Resolves true when a rewarded ad was watched to the end (midgame ads always resolve true).
 */
export async function showAd(type, hooks = {}) {
  if (adRunning) return false;
  adRunning = true;
  hooks.onStart?.();
  let ok;
  try {
    const live = await sdkReady && window.CrazyGames.SDK.environment !== 'disabled';
    ok = live ? await sdkAd(type) : null;
    if (ok === null) ok = await placeholderAd(type);
  } finally {
    adRunning = false;
    hooks.onEnd?.();
  }
  return type === 'midgame' ? true : ok;
}

// Resolves true/false from the SDK, or null if it could not serve one at all (use the placeholder).
function sdkAd(type) {
  return new Promise((resolve) => {
    try {
      window.CrazyGames.SDK.ad.requestAd(type, {
        adStarted() {},
        adFinished() { resolve(true); },
        adError(err) {
          // Out of ads or blocked: for a rewarded ad on a real portal, no reward. Locally, test with the placeholder.
          const local = window.CrazyGames.SDK.environment === 'local';
          resolve(local ? null : false);
          if (!local) console.info('Ad unavailable:', err);
        },
      });
    } catch {
      resolve(null);
    }
  });
}

// A short stand-in so reward flows work in development.
function placeholderAd(type) {
  return new Promise((resolve) => {
    const el = document.getElementById('adOverlay');
    const count = document.getElementById('adCount');
    const skip = document.getElementById('adClose');
    el.classList.remove('hidden');
    let left = type === 'rewarded' ? 4 : 2;
    count.textContent = left;
    skip.classList.add('hidden');
    const timer = setInterval(() => {
      left--;
      count.textContent = Math.max(0, left);
      if (left > 0) return;
      clearInterval(timer);
      finish(true);
    }, 1000);
    // Closing early forfeits the reward, like a real rewarded ad.
    setTimeout(() => skip.classList.remove('hidden'), 1000);
    skip.onclick = () => { clearInterval(timer); finish(false); };
    function finish(watched) {
      el.classList.add('hidden');
      resolve(watched);
    }
  });
}
