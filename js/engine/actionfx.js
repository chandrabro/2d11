// Data only: what an action leaves behind (soil, splashes, dust ...), which sounds it makes and how far
// one walking cycle carries the character. Kept free of imports so actions.js and the audio code can use it.
//
// events: [{ at: 0..1 (phase inside one cycle) | span:[a,b] + every:seconds, fx: particle kind, x,y: where (character
//           units from the feet, +x = forward), n: particles, dir: sideways push, size, sfx: sound id }]
// mark:   what stays on the ground (hole, furrows, wet earth, log ...)   endFx: particles when the action ends

export const ACTION_FX = {
  dig:   { drop: ['dirt'], mark: 'dig', events: [{ at: 0.4, fx: 'dirt', x: 30, y: -3, n: 11, sfx: 'dig' }, { at: 0.74, fx: 'dirt', x: 24, y: -22, n: 7 }] },
  chop:  { drop: ['chips'], mark: 'chop', events: [{ at: 0.38, fx: 'chips', x: 30, y: -12, n: 9, sfx: 'chop' }] },
  water: { drop: ['water'], mark: 'water', events: [{ span: [0.3, 0.95], every: 0.05, fx: 'stream', x: 33, y: -33, n: 1 }, { span: [0.3, 0.95], every: 0.4, sfx: 'pour' }] },
  sow:   { drop: ['seeds'], mark: 'sow', stride: 70, events: [{ at: 0.5, fx: 'seeds', x: 22, y: -36, n: 6, sfx: 'swish' }] },
  feed:  { drop: ['seeds'], events: [{ at: 0.5, fx: 'seeds', x: 26, y: -30, n: 6, sfx: 'swish' }] },
  sweep: { events: [{ at: 0.5, fx: 'dust', x: 32, y: -2, n: 4, sfx: 'swish' }] },
  cook:  { mark: 'cook', events: [{ span: [0, 1], every: 0.5, sfx: 'sizzle' }] },
  wipe:  { events: [{ span: [0.05, 0.95], every: 0.28, fx: 'bubble', x: 30, y: -76, n: 1 }, { at: 0.4, sfx: 'swish' }] },
  eat:   { events: [{ at: 0.55, sfx: 'munch' }] },
  drink: { events: [{ at: 0.6, sfx: 'gulp' }] },
  photo: { events: [{ at: 0.46, sfx: 'shutter' }] },
  clap:  { events: [{ at: 0.5, sfx: 'clap' }] },
  throw: { events: [{ at: 0.55, sfx: 'swish' }] },
  catch: { events: [{ at: 0.65, sfx: 'thud' }] },
  sword: { events: [{ at: 0.4, fx: 'spark', x: 36, y: -50, n: 7, sfx: 'clang' }] },
  kick_punch: { events: [{ at: 0.25, fx: 'spark', x: 36, y: -66, n: 4, sfx: 'punch' }, { at: 0.75, fx: 'spark', x: 40, y: -50, n: 4, sfx: 'punch' }] },
  fight_stance: { events: [] },
  angry: { drop: ['dust'], events: [{ at: 0.3, fx: 'dust', x: 6, y: -1, n: 3, sfx: 'thud' }] },
  jump_joy: { drop: ['dust'], events: [{ at: 0.2, fx: 'dust', x: 0, y: -1, n: 2 }, { at: 0.8, fx: 'puff', x: 0, y: -1, n: 6, sfx: 'thud' }] },
  trip_fall: { drop: ['dust'], events: [{ at: 0.2, sfx: 'gasp' }, { at: 0.62, fx: 'puff', x: 6, y: -1, n: 9, sfx: 'thud' }] },
  run:   { stride: 250, endFx: 'skid', events: [{ at: 0.0, fx: 'dust', x: -6, y: -1, n: 2, size: 0.7 }, { at: 0.5, fx: 'dust', x: -6, y: -1, n: 2, size: 0.7 }] },
  walk:  { stride: 215 },
  sad_walk: { stride: 150 }, sneak: { stride: 110 }, crawl: { stride: 70 }, carry_heavy: { stride: 110 }, push: { stride: 90 },
  pick_up:  { events: [{ at: 0.5, fx: 'dust', x: 26, y: -1, n: 2, sfx: 'thud' }] },
  put_down: { events: [{ at: 0.55, fx: 'dust', x: 26, y: -1, n: 2, sfx: 'thud' }] },
  give:     { events: [{ at: 0.55, sfx: 'swish' }] },
};

export const LOCOMOTION = new Set(['walk', 'run', 'sad_walk', 'sneak', 'crawl', 'carry_heavy', 'push', 'sow']);
export const STEP_SFX = { walk: 0.5, run: 0.8, sad_walk: 0.35, sneak: 0.2, crawl: 0.2, carry_heavy: 0.55, push: 0.35, sow: 0.3 };

/**
 * Occurrences of an action's events inside the window [t0, t1] (seconds since the action started).
 * A looping action repeats its events every cycle; the occurrence time never goes beyond segDur.
 * Returns [{ T, e, key }]  (key is stable, used to seed the particles).
 */
export function occurrences(action, segDur, t0, t1) {
  const ev = action.events; if (!ev || !ev.length) return [];
  const dur = action.duration || 1; const out = [];
  const k0 = action.loop ? Math.max(0, Math.floor(t0 / dur) - 1) : 0;
  const k1 = action.loop ? Math.floor(t1 / dur) : 0;
  for (let k = k0; k <= k1; k++) {
    ev.forEach((e, ei) => {
      if (e.every) {
        const a = (e.span ? e.span[0] : 0) * dur, b = (e.span ? e.span[1] : 1) * dur;
        for (let j = 0, T = k * dur + a; T <= k * dur + b + 1e-9; j++, T = k * dur + a + j * e.every) if (T >= t0 && T <= t1 && T <= segDur + 1e-9) out.push({ T, e, key: k * 1000 + ei * 50 + j });
      } else {
        const T = k * dur + (e.at || 0) * dur;
        if (T >= t0 && T <= t1 && T <= segDur + 1e-9) out.push({ T, e, key: k * 1000 + ei * 50 });
      }
    });
  }
  return out;
}
