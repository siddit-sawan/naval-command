import { profile } from './profile.js';
import { sfx } from '../audio/audio.js';
import { t } from './i18n.js';

// First-time tutorials for Fleet and Manual mode. Each step either waits for Next (or Enter, which
// works while the mouse is captured in first person) or for the player to actually do the thing, then
// moves on by itself. Enemies hold position until it's over. Finished or skipped tutorials are
// remembered and don't play again (they can be replayed from How to Play).

/**
 * ctx: live game state for the step checks:
 *   game(), selected() -> ships, shipCamMode(), look() -> { yaw, pitch }, locked(), goal() -> camera rig
 */
function steps(mode, ctx) {
  const g = () => ctx.game();
  if (mode === 'fleet') {
    return [
      {
        title: t('Welcome, Commander'),
        text: t('Your harbor is at the bottom of the map (blue). Destroy the <b>enemy harbor</b> (red) at the top to win. The enemy will wait until you finish this tutorial.'),
      },
      {
        title: t('Move the camera'),
        text: t('Pan with <b>WASD</b> or by pushing the mouse against a screen edge, <b>zoom</b> with the wheel, and <b>right-drag</b> to rotate.'),
        start: () => ({ ...ctx.goal() }),
        done: (s) => {
          const q = ctx.goal();
          return Math.hypot(q.x - s.x, q.z - s.z) > 40 || Math.abs(q.yaw - s.yaw) > 0.4 || Math.abs(q.dist - s.dist) > 40;
        },
      },
      {
        title: t('Select your ships'),
        text: t('<b>Left-click</b> one of your ships, or <b>drag a box</b> around several. Ctrl+A selects the whole fleet.'),
        done: () => ctx.selected().length > 0,
      },
      {
        title: t('Give an order'),
        text: t('<b>Right-click</b> on the water to send the selected ships there.'),
        done: () => ctx.selected().some((u) => u.mode === 'move' || u.mode === 'attackmove' || u.mode === 'attack'),
      },
      {
        title: t('Build a fleet'),
        text: t('Ships are built at your harbor with gold. Use the buttons below or keys <b>1–4</b>. Try building a <b>Corvette</b>.'),
        highlight: '#build',
        start: () => g().teams.player.built,
        done: (built) => g().teams.player.queue.length > 0 || g().teams.player.built > built,
      },
      {
        title: t('Capture outposts'),
        text: t('The diamond forts out at sea are <b>outposts</b>. Keep ships inside a ring to capture it and earn more gold. The minimap shows who holds each one.'),
        highlight: '#minimap',
      },
      {
        title: t('Ride along'),
        text: t('With a ship selected, press <b>V</b> or use the camera bar to follow it: Chase, Orbit, Waterline or its <b>Bridge</b>. <b>Esc</b> brings you back to the overview.'),
        highlight: '#camBar',
        done: () => ctx.shipCamMode() !== 'overview',
      },
      {
        title: t('Into battle'),
        text: t('<b>Right-click</b> an enemy ship or the red harbor to attack. Shells fly flat, so ships need a clear line of fire. <b>Fog banks</b> hide ships until they are close. Battleships launch a <b>scout bomber</b> on their own every 20-30 seconds. Good luck!'),
        finish: true,
      },
    ];
  }
  return [
    {
      title: t('Team deathmatch'),
      text: t('Five ships a side. <b>Sink every enemy ship</b> to win. You command the flagship from its bridge; your other four ships fight alongside you. The enemy waits until you finish this tutorial.'),
    },
    {
      title: t('Get under way'),
      text: t('<b>W</b> / <b>S</b> for ahead and astern, <b>A</b> / <b>D</b> to turn. Give it some speed.'),
      done: () => g().helm && Math.abs(g().helm.speed) > 1.2,
    },
    {
      title: t('Look around'),
      text: t('<b>Click the screen</b> to take control of the mouse, then look around. <b>Esc</b> releases it. (Q / E also turn your head.)'),
      start: () => ({ ...ctx.look() }),
      done: (s) => Math.abs(ctx.look().yaw - s.yaw) > 0.5 || Math.abs(ctx.look().pitch - s.pitch) > 0.25,
    },
    {
      title: t('Capture an outpost'),
      text: t('Your weapons are <b>offline</b> until your fleet holds an outpost. Sail into the ring around the nearest diamond fort (see the minimap) and stay there until it turns blue. <b>One</b> outpost arms your main weapon, <b>two</b> arm everything. Lose them all and your guns go quiet again.'),
      highlight: '#minimap',
      done: () => g().outpostsHeld('player') > 0,
    },
    {
      title: t('Choose a weapon'),
      text: t('Your ship\'s weapons are listed on the left. Switch with <b>1–3</b>. Each has its own range and reload. Battleships also carry a <b>scout bomber</b>: launch it, then click a ship to bomb or a spot to patrol.'),
      highlight: '#weapons',
      start: () => g().helm && g().helm.weaponIdx,
      done: (i) => g().helm && g().helm.weaponIdx !== i,
    },
    {
      title: t('Open fire'),
      text: t('<b>Click</b> (or Space) to fire where the crosshair points. Shells fly flat and fast: <b>lead moving ships</b> and aim a little high at long range. The range and flight time are under the crosshair. Missiles need a <b>lock</b>: hold the crosshair on a ship.'),
      done: () => g().helm && g().helm.wcool.some((c) => c > 0),
    },
    {
      title: t('Views and binoculars'),
      text: t('Scroll the <b>wheel</b> or right-click for binoculars. <b>V</b> switches to a chase camera, <b>Tab</b> takes command of another of your ships.'),
    },
    {
      title: t('Battle stations'),
      text: t('The enemy fleet is waiting across the water. Use the fog, focus your fire, and keep your flagship alive. Good hunting!'),
      finish: true,
    },
  ];
}

export function createTutorial(ctx) {
  const el = document.getElementById('tutorial');
  let mode = null, list = [], index = 0, state = null, doneAt = 0, highlighted = null;

  function render() {
    const step = list[index];
    if (highlighted) highlighted.classList.remove('tut-highlight');
    highlighted = step.highlight ? document.querySelector(step.highlight) : null;
    if (highlighted) highlighted.classList.add('tut-highlight');
    const action = !!step.done;
    el.innerHTML = `
      <div class="tut-head"><span>${t('Tutorial · {i} / {n}', { i: index + 1, n: list.length })}</span><button class="tut-skip">${t('Skip tutorial')}</button></div>
      <h3>${step.title}</h3>
      <p>${step.text}</p>
      <div class="tut-foot">
        ${action
          ? `<span class="tut-todo">${t('▶ Try it to continue')}</span><button class="btn small tut-next">${t('Skip step')}</button>`
          : `<span class="tut-key">${t('or press Enter ↵')}</span><button class="btn small primary tut-next">${step.finish ? t('Start') : t('Next')}</button>`}
      </div>`;
    el.querySelector('.tut-skip').onclick = () => { sfx.click(); stop(true); };
    el.querySelector('.tut-next').onclick = () => { sfx.click(); next(); };
    state = step.start ? step.start() : null;
    doneAt = 0;
  }

  // force: replay even if this mode's tutorial was already seen.
  function start(m, force = false) {
    if (!force && profile.tutorialSeen(m)) return false;
    mode = m;
    list = steps(m, ctx);
    index = 0;
    el.classList.remove('hidden');
    render();
    return true;
  }

  // finished: true when completed or skipped (it won't play again); false when the match ended early.
  function stop(finished = false) {
    if (!mode) return;
    if (finished) profile.markTutorial(mode);
    mode = null;
    el.classList.add('hidden');
    if (highlighted) highlighted.classList.remove('tut-highlight');
    highlighted = null;
  }

  function next() {
    if (!mode) return;
    if (index >= list.length - 1) { stop(true); return; }
    index++;
    render();
  }

  return {
    start,
    stop,
    next,
    get active() { return !!mode; },
    // Called a few times a second: completes action steps once the player has done them.
    update() {
      if (!mode) return;
      const step = list[index];
      if (!step.done || doneAt) {
        if (doneAt && performance.now() - doneAt > 900) next();
        return;
      }
      if (step.done(state)) {
        doneAt = performance.now();
        sfx.captured();
        const todo = el.querySelector('.tut-todo');
        if (todo) {
          todo.textContent = t('✓ Nicely done');
          todo.classList.add('ok');
        }
      }
    },
  };
}
