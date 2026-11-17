// What actions leave in the world: flying soil, chips, water, dust, sparks; holes and piles; sprouting seeds;
// wet ground; a split log; footprints in snow and mud; dropped objects. Everything is a pure function of time
// (ballistic maths + seeded randomness), so the preview and the exported video are identical.

import { getAction } from './actions.js';
import { occurrences } from './actionfx.js';
import { actorPlaceAt, unitPx, moveFrac, groundStyle } from './motion.js';
import { drawProp } from './props.js';
import { clamp, lerp, smoothstep, rng, rgba, groundShadow, fillCircle, fillEllipse, fillRound, fillRect, strokeLine, ellipse, linGrad, TAU } from './util.js';

const MAX_LIFE = 2.2;
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

// ---------- particles ----------
/** Draw one occurrence. Origin (0,0) = spawn point; units are character units; +x = the way the actor faced. */
function particle(ctx, kind, i, age, r, e) {
  switch (kind) {
    case 'dirt': {
      const vx = lerp(6, 30, r()), vy = -lerp(55, 100, r()), g = 250, s = lerp(1.1, 2.3, r()), col = pick(r, ['#6d4c41', '#8d6e63', '#5d4037', '#7b5a43']);
      const yl = -(e.y || 0) + r() * 1.6; const tl = (-vy + Math.sqrt(vy * vy + 2 * g * yl)) / g;
      const a = Math.min(age, tl); const x = vx * a, y = vy * a + 0.5 * g * a * a;
      const fade = clamp(1 - (age - 0.9) / 0.5, 0, 1); if (fade <= 0) return;
      ctx.globalAlpha = fade; fillCircle(ctx, x, Math.min(y, yl), s, col); fillCircle(ctx, x - s * 0.25, Math.min(y, yl) - s * 0.3, s * 0.4, 'rgba(255,255,255,0.18)'); break; }
    case 'chips': {
      const vx = lerp(-10, 36, r()), vy = -lerp(45, 90, r()), g = 240, s = lerp(1, 1.9, r()), col = pick(r, ['#e0c392', '#c9a46a', '#f0dcb4']);
      const yl = -(e.y || 0); const tl = (-vy + Math.sqrt(vy * vy + 2 * g * yl)) / g; const a = Math.min(age, tl);
      const x = vx * a, y = vy * a + 0.5 * g * a * a; const fade = clamp(1 - (age - 0.8) / 0.4, 0, 1); if (fade <= 0) return;
      ctx.save(); ctx.globalAlpha = fade; ctx.translate(x, Math.min(y, yl)); ctx.rotate(a * lerp(-14, 14, r())); ctx.fillStyle = col; ctx.fillRect(-s, -s * 0.5, s * 2, s); ctx.restore(); break; }
    case 'stream': {
      const vx = lerp(15, 24, r()), vy = lerp(-14, 3, r()), g = 330; const yl = -(e.y || 0); const tl = (-vy + Math.sqrt(vy * vy + 2 * g * yl)) / g;
      if (age < tl) { const x = vx * age, y = vy * age + 0.5 * g * age * age; ctx.globalAlpha = 0.9; ctx.fillStyle = '#4fc3f7'; ctx.beginPath(); ctx.ellipse(x, y, 0.7, 1.5, Math.atan2(vy + g * age, vx) - Math.PI / 2, 0, TAU); ctx.fill(); }
      else { const a = age - tl; if (a < 0.45) { const xl = vx * tl; ctx.globalAlpha = (1 - a / 0.45) * 0.8; ctx.strokeStyle = '#b3e5fc'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.ellipse(xl, yl, 1 + a * 9, 0.4 + a * 2.5, 0, 0, TAU); ctx.stroke(); for (let k = 0; k < 2; k++) { const sx = xl + (k ? 1 : -1) * a * 14, sy = yl - Math.sin(a / 0.45 * Math.PI) * 5; fillCircle(ctx, sx, sy, 0.5, '#e1f5fe'); } } }
      break; }
    case 'seeds': {
      const vx = lerp(6, 26, r()), vy = -lerp(8, 34, r()), g = 260, yl = -(e.y || 0) + r() * 2; const tl = (-vy + Math.sqrt(vy * vy + 2 * g * yl)) / g; const a = Math.min(age, tl);
      const fade = clamp(1 - (age - 1.6) / 0.6, 0, 1); if (fade <= 0) return; ctx.globalAlpha = fade; fillCircle(ctx, vx * a, vy * a + 0.5 * g * a * a, 0.8, pick(r, ['#8d6e63', '#d7b98a', '#a1887f'])); break; }
    case 'dust': case 'puff': case 'skid': {
      const big = kind !== 'dust'; const life = big ? 1.1 : 0.9; if (age > life) return; const u = age / life;
      const vx = kind === 'skid' ? lerp(8, 46, r()) : lerp(big ? -32 : -14, big ? 32 : 14, r()); const vy = -lerp(2, big ? 16 : 12, r());
      const rad = ((big ? 2 : 1.4) + age * (big ? 7 : 5)) * (e.size || 1);
      ctx.globalAlpha = (kind === 'dust' ? 0.5 : 0.6) * (1 - u); fillCircle(ctx, vx * age * (1 - u * 0.5), vy * age, rad, '#cdbfa5'); break; }
    case 'bubble': {
      const life = 1.4; if (age > life) return; const u = age / life; const x = Math.sin(age * 5 + i * 2) * 2 + age * 6, y = -age * 10, rad = 1.3 + (i % 3) * 0.5 + (u > 0.85 ? (u - 0.85) * 8 : 0);
      ctx.globalAlpha = (1 - u) * 0.9; ctx.fillStyle = 'rgba(200,235,255,0.35)'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 0.35; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill(); ctx.stroke(); break; }
    case 'spark': {
      const life = 0.5; if (age > life) return; const vx = lerp(-60, 60, r()), vy = -lerp(8, 60, r()), g = 260; const x = vx * age, y = vy * age + 0.5 * g * age * age;
      ctx.globalAlpha = 1 - age / life; ctx.strokeStyle = pick(r, ['#fff59d', '#ffffff', '#ffcc80']); ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - vx * 0.04, y - (vy + g * age) * 0.04); ctx.stroke(); break; }
    default: break;
  }
}
const KIND_LIFE = { dirt: 1.4, chips: 1.2, stream: 1.0, seeds: 2.3, dust: 0.95, puff: 1.15, skid: 1.15, bubble: 1.5, spark: 0.55 };

/** Particles of every recent action of one actor. */
export function drawActorFx(ctx, scene, actor, local, sBuild) {
  const segs = actor.actions || [];
  for (const s of segs) {
    if (local < s.start) continue;
    const act = getAction(s.action); if (!act.events.length && !act.endFx) continue;
    const segDur = Math.max(0.1, (s.end ?? s.start + 2) - s.start); const tau = local - s.start;
    if (tau - segDur > MAX_LIFE) continue;
    const list = occurrences(act, segDur, Math.max(0, tau - MAX_LIFE), Math.min(tau, segDur));
    if (act.endFx && tau >= segDur && s.toX != null) list.push({ T: segDur, e: { fx: act.endFx, x: 0, y: -1, n: 8 }, key: 999000 });
    for (const o of list) {
      const e = o.e; if (!e.fx) continue; const age = tau - o.T; if (age < 0 || age > (KIND_LIFE[e.fx] || 1.2)) continue;
      const pl = actorPlaceAt(actor, s.start + o.T, scene); const cs = unitPx(scene, actor, pl.y) * sBuild;
      ctx.save(); ctx.translate(pl.x + pl.facing * (e.x || 0) * cs, pl.y + (e.y || 0) * cs); ctx.scale(pl.facing * cs, cs);
      const n = e.n || 1;
      for (let i = 0; i < n; i++) { ctx.save(); particle(ctx, e.fx, i + (o.key % 7), age, rng((o.key + 3) * 7919 + i * 104729 + (s.start * 100 | 0)), e); ctx.restore(); }
      ctx.restore();
    }
  }
}

// ---------- marks left on the ground ----------
function invMove(f, dur) { let lo = 0, hi = dur; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (moveFrac(m, dur) < f) lo = m; else hi = m; } return (lo + hi) / 2; }

export function drawGroundMarks(ctx, scene, local, project) {
  (scene.actors || []).forEach((actor, ai) => {
    for (const s of actor.actions || []) {
      if (local < s.start) continue;
      const act = getAction(s.action); if (!act.mark) continue;
      const end = s.end ?? s.start + 2; const dur = Math.max(0.2, end - s.start);
      const p = clamp((local - s.start) / dur, 0, 1); if (p <= 0) continue;
      const pl = actorPlaceAt(actor, s.start + 0.01, scene); const cs = unitPx(scene, actor, pl.y); const f = pl.facing;
      const x0 = pl.x, y0 = pl.y;
      ctx.save();
      switch (act.mark) {
        case 'dig': { const hx = x0 + f * 34 * cs, px = x0 + f * 66 * cs; const q = smoothstep(p);
          ctx.fillStyle = rgba('#2a1a10', 0.9); ellipse(ctx, hx, y0 + 1 * cs, (4 + 15 * q) * cs, (1.2 + 4 * q) * cs); ctx.fill();
          ctx.fillStyle = rgba('#120a05', 0.8); ellipse(ctx, hx, y0 + 1.4 * cs, (3 + 11 * q) * cs, (0.8 + 2.6 * q) * cs); ctx.fill();
          ctx.strokeStyle = rgba('#9a7a56', 0.7); ctx.lineWidth = 0.5 * cs; ellipse(ctx, hx, y0 + 1 * cs, (4 + 15 * q) * cs, (1.2 + 4 * q) * cs); ctx.stroke();
          const w = (5 + 19 * q) * cs, hgt = (1.5 + 13 * q) * cs;
          ctx.fillStyle = linGrad(ctx, px - w, y0 - hgt, px + w, y0, [[0, '#9a7656'], [1, '#5d4037']]); ctx.beginPath(); ctx.moveTo(px - w, y0 + 1.5 * cs); ctx.quadraticCurveTo(px - w * 0.5, y0 - hgt * 1.5, px, y0 - hgt); ctx.quadraticCurveTo(px + w * 0.5, y0 - hgt * 1.4, px + w, y0 + 1.5 * cs); ctx.closePath(); ctx.fill();
          const rr = rng(ai * 77 + 5); for (let k = 0; k < 8 * q; k++) fillCircle(ctx, px + (rr() - 0.5) * w * 1.6, y0 + 1 * cs - rr() * hgt * 0.6, (0.5 + rr()) * cs, rr() > 0.5 ? '#6d4c41' : '#8d6e63');
          break; }
        case 'chop': { const sx = x0 + f * 32 * cs; const split = smoothstep(clamp((p - 0.85) / 0.15, 0, 1));
          fillEllipse(ctx, sx, y0 + 0.5 * cs, 8.5 * cs, 2.2 * cs, rgba('#000', 0.18));
          fillRound(ctx, sx - 6 * cs, y0 - 7 * cs, 12 * cs, 7.5 * cs, 1 * cs, '#8a5a2b'); fillEllipse(ctx, sx, y0 - 7 * cs, 6 * cs, 1.8 * cs, '#c9a06a'); strokeLine(ctx, sx - 3 * cs, y0 - 7 * cs, sx + 3 * cs, y0 - 7 * cs, rgba('#8a5a2b', 0.6), 0.4 * cs);
          const lw = 5.2 * cs, lh = 13 * cs, base = y0 - 7.6 * cs;
          if (split <= 0.001) { ctx.fillStyle = '#a77740'; ctx.fillRect(sx - lw, base - lh, lw * 2, lh); ctx.fillStyle = '#d2a468'; ctx.fillRect(sx - lw, base - lh, lw * 2, 1.3 * cs); }
          else for (const side of [-1, 1]) { ctx.save(); ctx.translate(sx + side * split * 4 * cs, base); ctx.rotate(side * split * 0.5); const x1 = side < 0 ? -lw : 0; ctx.fillStyle = side < 0 ? '#a77740' : '#94672f'; ctx.fillRect(x1, -lh, lw, lh); ctx.fillStyle = '#d2a468'; ctx.fillRect(x1, -lh, lw, 1.3 * cs); ctx.restore(); }
          const rr = rng(ai * 31 + 9); for (let k = 0; k < 7 * smoothstep(p); k++) fillRect(ctx, sx + (rr() - 0.5) * 30 * cs, y0 + (rr() * 2 - 0.5) * cs, 1.5 * cs, 0.8 * cs, '#e0c392');
          break; }
        case 'water': { const wx = x0 + f * 43 * cs; const q = smoothstep(clamp(p * 1.4, 0, 1));
          ctx.fillStyle = rgba('#2a1a0c', 0.34 * q); ellipse(ctx, wx, y0 + 1 * cs, (5 + 11 * q) * cs, (1.3 + 2.7 * q) * cs); ctx.fill();
          ctx.fillStyle = rgba('#b3e5fc', 0.18 * q); ellipse(ctx, wx - 2 * cs, y0 + 0.4 * cs, (2.5 + 5 * q) * cs, (0.5 + 1 * q) * cs); ctx.fill(); break; }
        case 'cook': { const fade = local <= end ? 1 : clamp(1 - (local - end) / 1.2, 0, 1); if (fade <= 0) break; const fx = x0 + f * 44 * cs; ctx.globalAlpha = fade;
          fillEllipse(ctx, fx, y0 + 0.5 * cs, 10 * cs, 2.4 * cs, rgba('#000', 0.2));
          ctx.fillStyle = '#8d5a3c'; ctx.beginPath(); ctx.moveTo(fx - 8 * cs, y0); ctx.lineTo(fx - 6 * cs, y0 - 9 * cs); ctx.lineTo(fx + 6 * cs, y0 - 9 * cs); ctx.lineTo(fx + 8 * cs, y0); ctx.closePath(); ctx.fill(); fillEllipse(ctx, fx, y0 - 9 * cs, 6 * cs, 1.6 * cs, '#2b1a10');
          for (let k = 0; k < 4; k++) { const ph = local * 14 + k * 1.7; fillEllipse(ctx, fx + (k - 1.5) * 2.2 * cs, y0 - 11 * cs, (1.5 + (k % 2) * 0.5) * cs, (3.2 + Math.sin(ph) * 1.1) * cs, ['#ff5722', '#ff9800', '#ffc107', '#ff7043'][k]); }
          for (let k = 0; k < 3; k++) { const ph = (local * 0.6 + k / 3) % 1; ctx.globalAlpha = fade * (1 - ph) * 0.45; fillCircle(ctx, fx + Math.sin(ph * 6 + k) * 2.4 * cs, y0 - 15 * cs - ph * 24 * cs, (1.6 + ph * 3.4) * cs, '#cfd8dc'); } break; }
        case 'sow': { const moving = s.toX != null && Math.abs(s.toX - x0) > 6; const n = moving ? Math.max(4, Math.min(24, Math.round(Math.abs(s.toX - x0) / (28 * cs)))) : 7;
          for (let k = 0; k < n; k++) { const fr = (k + 0.5) / n; const t0 = moving ? s.start + invMove(fr, dur) : s.start + dur * fr; const age = local - t0; if (age < 0.5) continue;
            const px = moving ? lerp(x0, s.toX, fr) + f * 14 * cs : x0 + f * (18 + k * 9) * cs; const py = (moving ? lerp(y0, s.toY ?? y0, fr) : y0) + (k % 2 ? 1.4 : 0.2) * cs; const g = clamp((age - 0.5) / 6, 0, 1);
            if (g < 0.06) { fillCircle(ctx, px, py, 0.7 * cs, '#5d4037'); continue; }
            const hgt = (2 + 9 * smoothstep(g)) * cs; ctx.strokeStyle = '#4caf50'; ctx.lineWidth = 0.7 * cs; ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + 0.8 * cs, py - hgt * 0.6, px + 0.3 * cs, py - hgt); ctx.stroke();
            fillEllipse(ctx, px - 1.6 * cs, py - hgt * 0.8, 1.9 * cs, 0.8 * cs, '#66bb6a', -0.5); fillEllipse(ctx, px + 2 * cs, py - hgt * 0.95, 1.9 * cs, 0.8 * cs, '#43a047', 0.5); }
          break; }
        default: break;
      }
      ctx.restore();
    }
  });
}

// ---------- objects lying on the ground ----------
export function drawGroundItems(ctx, scene, tl, local) {
  for (const it of tl.ground) {
    if (local < it.t0 || local >= it.t1) continue;
    const g = groundStyle(it.type); const act0 = scene.actors && scene.actors[0]; const cs = unitPx(scene, act0 || { scale: 1 }, it.y);
    groundShadow(ctx, it.x, it.y + 1, 9 * cs, 2 * cs, 0.25);
    ctx.save(); ctx.translate(it.x, it.y); ctx.scale(cs, cs);
    if (g.lying) { ctx.rotate(Math.PI / 2 * 0.97); ctx.translate(-4, 0); } else ctx.translate(0, g.dy);
    drawProp(ctx, { type: it.type, color: it.color }, null, local); ctx.restore();
  }
}

// ---------- footprints (snow / rain) and breath ----------
export function drawFootprints(ctx, scene, local, weather) {
  const col = weather === 'snow' ? 'rgba(120,140,170,0.55)' : 'rgba(40,28,18,0.28)';
  (scene.actors || []).forEach((actor) => {
    for (const s of actor.actions || []) {
      if (s.toX == null || local < s.start) continue; const act = getAction(s.action); if (!act.stride) continue;
      const end = s.end ?? s.start + 2; const dur = Math.max(0.2, end - s.start); const pl0 = actorPlaceAt(actor, s.start + 0.001, scene);
      const total = Math.hypot((s.toX ?? pl0.x) - pl0.x, (s.toY ?? pl0.y) - pl0.y); if (total < 20) continue;
      const cs = unitPx(scene, actor, pl0.y); const step = act.stride * (actor.scale || 1) * (cs / (3.2 * (actor.scale || 1))) / 2;
      const n = Math.min(60, Math.floor(total / step));
      for (let k = 1; k <= n; k++) {
        const fr = (k * step) / total; const T = s.start + invMove(Math.min(1, fr), dur); const age = local - T; if (age < 0 || age > 9) continue;
        const px = lerp(pl0.x, s.toX, fr), py = lerp(pl0.y, s.toY ?? pl0.y, fr) + (k % 2 ? 2.2 : -2.2) * cs;
        ctx.globalAlpha = clamp(1 - (age - 5) / 4, 0, 1); ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(px, py, 3.6 * cs, 1.1 * cs, 0, 0, TAU); ctx.fill();
      }
    }
  });
  ctx.globalAlpha = 1;
}
export function drawBreath(ctx, x, y, facing, cs, t, seed) {
  const cyc = 3.6, ph = ((t + seed * 0.9) % cyc) / cyc; if (ph > 0.42) return; const u = ph / 0.42;
  for (let k = 0; k < 3; k++) { const q = clamp(u - k * 0.12, 0, 1); if (q <= 0) continue; ctx.globalAlpha = (1 - q) * 0.55; fillCircle(ctx, x + facing * (12 + q * 26 + k * 3) * cs, y - (q * 5 - k) * cs, (1.2 + q * 4) * cs, '#ffffff'); }
  ctx.globalAlpha = 1;
}
