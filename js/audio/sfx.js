// Built-in sound effects, synthesised in code (no files, no downloads): footsteps, digging, chopping, pouring water,
// claps, thuds ... They are placed automatically from the actions in the story and are mixed into the exported video.

import { getAction } from '../engine/actions.js';
import { occurrences, STEP_SFX } from '../engine/actionfx.js';
import { moveFrac, depthScale } from '../engine/motion.js';
import { getScene } from '../engine/scenes/index.js';
import { rng } from '../engine/util.js';

export const SFX_NAMES = ['step_soft', 'step_hard', 'dig', 'chop', 'pour', 'swish', 'sizzle', 'munch', 'gulp', 'shutter', 'clap', 'thud', 'clang', 'punch', 'gasp'];

function invMove(f, dur) { let lo = 0, hi = dur; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (moveFrac(m, dur) < f) lo = m; else hi = m; } return (lo + hi) / 2; }

/** Every sound effect of the project: [{ t (global seconds), type, gain }] sorted by time. */
export function collectSfx(project) {
  const out = []; let s0 = 0;
  for (const sc of project.scenes) {
    const def = getScene(sc.background);
    for (const a of sc.actors || []) {
      for (const s of a.actions || []) {
        const act = getAction(s.action); const end = s.end ?? s.start + 2; const dur = Math.max(0.1, end - s.start);
        for (const o of occurrences(act, dur, 0, dur)) if (o.e.sfx) out.push({ t: s0 + s.start + o.T, type: o.e.sfx, gain: o.e.gain ?? 0.8 });
        const sg = STEP_SFX[act.id];
        if (sg && act.stride) {
          const type = def.indoor ? 'step_hard' : 'step_soft';
          const D = s.toX != null || s.toY != null ? Math.hypot((s.toX ?? a.x) - a.x, (s.toY ?? a.y) - a.y) : 0;
          if (D > 20 && s.toX != null) {
            const stepLen = act.stride * (a.scale || 1) * depthScale(def, a.y) / 2; const n = Math.min(80, Math.floor(D / stepLen));
            for (let k = 1; k <= n; k++) out.push({ t: s0 + s.start + invMove(Math.min(1, (k * stepLen) / D), dur), type, gain: sg * 0.6 });
          } else if (!(s.toX != null)) {
            for (let T = act.duration / 4; T < dur && out.length < 8000; T += act.duration / 2) out.push({ t: s0 + s.start + T, type, gain: sg * 0.6 });
          }
        }
      }
    }
    s0 += sc.duration;
  }
  out.sort((p, q) => p.t - q.t);
  return out.slice(0, 8000);
}

// ---------- synthesis ----------
function make(ctx, dur, fn) {
  const sr = ctx.sampleRate, n = Math.ceil(dur * sr); const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
  fn(d, sr, n);
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i])); if (peak > 0) for (let i = 0; i < n; i++) d[i] = (d[i] / peak) * 0.9;
  const fade = Math.min(n, Math.floor(sr * 0.004)); for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade; // no click at the end
  return buf;
}
const exp = (t, k) => Math.exp(-t * k);
function noise(seed) { const r = rng(seed); return () => r() * 2 - 1; }
function lp(a) { let y = 0; return (x) => (y += a * (x - y)); }

const SYNTH = {
  step_soft: (c) => make(c, 0.16, (d, sr, n) => { const w = noise(11), f = lp(0.12); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += (2 * Math.PI * 70) / sr; d[i] = f(w()) * exp(t, 26) * 1.4 + Math.sin(ph) * exp(t, 38) * 0.5; } }),
  step_hard: (c) => make(c, 0.13, (d, sr, n) => { const w = noise(12), f = lp(0.5); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; const x = w(); ph += (2 * Math.PI * 120) / sr; d[i] = (x - f(x)) * exp(t, 60) * 0.8 + Math.sin(ph) * exp(t, 55) * 0.5; } }),
  dig: (c) => make(c, 0.38, (d, sr, n) => { const w = noise(13), f = lp(0.3); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += (2 * Math.PI * (95 - 50 * Math.min(1, t * 6))) / sr; d[i] = Math.sin(ph) * exp(t, 14) * 0.9 + f(w()) * exp(t, 8) * 0.55; } }),
  chop: (c) => make(c, 0.42, (d, sr, n) => { const w = noise(14), f = lp(0.6); let ph = 0, p2 = 0; for (let i = 0; i < n; i++) { const t = i / sr; const x = w(); ph += (2 * Math.PI * (190 - 70 * Math.min(1, t * 8))) / sr; p2 += (2 * Math.PI * 380) / sr; d[i] = (x - f(x)) * exp(t, 110) * 0.9 + Math.sin(ph) * exp(t, 20) * 0.7 + Math.sin(p2) * exp(t, 32) * 0.25; } }),
  pour: (c) => make(c, 0.6, (d, sr, n) => { const w = noise(15), f1 = lp(0.5), f2 = lp(0.07); for (let i = 0; i < n; i++) { const t = i / sr; const x = w(); const band = f1(x) - f2(x); const fl = 0.65 + 0.35 * Math.sin(2 * Math.PI * 13 * t + Math.sin(t * 40)); const env = Math.min(1, t * 14) * Math.min(1, (0.6 - t) * 10); d[i] = band * fl * env; } }),
  swish: (c) => make(c, 0.3, (d, sr, n) => { const w = noise(16), f1 = lp(0.6), f2 = lp(0.1); for (let i = 0; i < n; i++) { const t = i / sr / 0.3; const x = w(); d[i] = (f1(x) - f2(x)) * Math.pow(Math.sin(Math.PI * t), 1.6); } }),
  sizzle: (c) => make(c, 0.55, (d, sr, n) => { const w = noise(17), f = lp(0.55); for (let i = 0; i < n; i++) { const t = i / sr; const x = w(); const pop = Math.abs(w()) > 0.985 ? 1.6 : 0; d[i] = ((x - f(x)) * 0.5 + pop * w()) * Math.min(1, t * 25) * Math.min(1, (0.55 - t) * 9); } }),
  munch: (c) => make(c, 0.2, (d, sr, n) => { const w = noise(18), f = lp(0.18); for (let i = 0; i < n; i++) { const t = i / sr; d[i] = f(w()) * (exp(t, 38) + (t > 0.09 ? exp(t - 0.09, 38) : 0)); } }),
  gulp: (c) => make(c, 0.26, (d, sr, n) => { let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += (2 * Math.PI * (170 - 90 * t / 0.26)) / sr; d[i] = Math.sin(ph) * Math.sin(Math.PI * t / 0.26) * 0.9; } }),
  shutter: (c) => make(c, 0.14, (d, sr, n) => { const w = noise(19); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += (2 * Math.PI * 2600) / sr; const a = exp(t, 140) * w() + Math.sin(ph) * exp(t, 110) * 0.4; const t2 = t - 0.05; d[i] = a + (t2 > 0 ? (exp(t2, 140) * w() + Math.sin(ph) * exp(t2, 110) * 0.4) * 0.8 : 0); } }),
  clap: (c) => make(c, 0.24, (d, sr, n) => { const w = noise(20), f = lp(0.35); for (let i = 0; i < n; i++) { const t = i / sr; const x = w(); d[i] = (x - f(x)) * (exp(t, 48) * 0.9 + exp(t, 12) * 0.18); } }),
  thud: (c) => make(c, 0.32, (d, sr, n) => { const w = noise(21), f = lp(0.15); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += (2 * Math.PI * (72 - 34 * Math.min(1, t * 6))) / sr; d[i] = Math.sin(ph) * exp(t, 12) * 0.95 + f(w()) * exp(t, 30) * 0.35; } }),
  clang: (c) => make(c, 0.7, (d, sr, n) => { const w = noise(22); let a = 0, b = 0, e = 0; for (let i = 0; i < n; i++) { const t = i / sr; a += (2 * Math.PI * 1850) / sr; b += (2 * Math.PI * 2620) / sr; e += (2 * Math.PI * 3430) / sr; d[i] = (Math.sin(a) * exp(t, 7) + Math.sin(b) * exp(t, 9) * 0.7 + Math.sin(e) * exp(t, 12) * 0.5) * 0.5 + w() * exp(t, 150) * 0.8; } }),
  punch: (c) => make(c, 0.24, (d, sr, n) => { const w = noise(23), f = lp(0.2); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += (2 * Math.PI * (110 - 55 * Math.min(1, t * 10))) / sr; d[i] = Math.sin(ph) * exp(t, 20) + f(w()) * exp(t, 38) * 0.6; } }),
  gasp: (c) => make(c, 0.38, (d, sr, n) => { const w = noise(24), f1 = lp(0.45), f2 = lp(0.08); for (let i = 0; i < n; i++) { const t = i / sr / 0.38; const x = w(); d[i] = (f1(x) - f2(x)) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 1.4); } }),
};

const cache = new WeakMap();
export function sfxBuffer(ctx, type) {
  let m = cache.get(ctx); if (!m) { m = new Map(); cache.set(ctx, m); }
  if (!m.has(type)) { const f = SYNTH[type]; m.set(type, f ? f(ctx) : null); }
  return m.get(type);
}

export const sfxEnabled = (project) => project.sfx !== false;
export const sfxVolume = (project) => (project.sfxVolume ?? 0.55);

/** Add every sound effect to an (offline) audio context for the export mix. */
export function addSfxToMix(ctx, project, total) {
  if (!sfxEnabled(project)) return 0; let n = 0; const vol = sfxVolume(project);
  for (const e of collectSfx(project)) {
    if (e.t >= total) break; const buf = sfxBuffer(ctx, e.type); if (!buf) continue;
    const src = ctx.createBufferSource(); src.buffer = buf; const g = ctx.createGain(); g.gain.value = vol * e.gain; src.connect(g); g.connect(ctx.destination); src.start(Math.max(0, e.t)); n++;
  }
  return n;
}
