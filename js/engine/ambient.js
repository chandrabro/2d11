// Depth and life around the characters: time-of-day shadows, birds, fireflies, dust in the sunlight, tree sway.
// Deterministic (functions of the scene clock), so exports match the preview.

import { clamp, rng, hash, rgba, fillCircle, fillEllipse, radGrad, ellipse, STAGE_W } from './util.js';

/** Shadow under a character. The sun is low at dawn / sunset (long, leaning shadow), high at noon (short), faint at night. */
export function castShadow(ctx, x, y, w, h, tod, lying) {
  const long = tod === 'sunset' ? 1.9 : tod === 'dawn' ? 1.6 : 1;
  const lean = tod === 'sunset' ? -0.6 : tod === 'dawn' ? 0.6 : 0.12;
  const a = tod === 'night' ? 0.2 : tod === 'day' ? 0.3 : 0.26;
  const rx = w * long, ry = h * (tod === 'day' ? 1 : 0.8);
  const cx = x + lean * rx * 0.6;
  ctx.fillStyle = radGrad(ctx, cx, y, 0, rx, [[0, `rgba(0,0,0,${a})`], [0.65, `rgba(0,0,0,${a * 0.5})`], [1, 'rgba(0,0,0,0)']]);
  ellipse(ctx, cx, y, rx, ry); ctx.fill();
  if (!lying) { ctx.fillStyle = radGrad(ctx, x, y, 0, w * 0.55, [[0, `rgba(0,0,0,${a * 1.5})`], [1, 'rgba(0,0,0,0)']]); ellipse(ctx, x, y, w * 0.55, h * 0.7); ctx.fill(); } // tight contact shadow under the feet
}

function bird(ctx, x, y, s, flap) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.strokeStyle = 'rgba(40,40,50,0.8)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-10, flap * -5); ctx.quadraticCurveTo(-4, flap * -9 - 2, 0, 0); ctx.quadraticCurveTo(4, flap * -9 - 2, 10, flap * -5); ctx.stroke(); ctx.restore();
}

/** Birds by day, fireflies by night, drifting dust in an indoor sunbeam. `def` = background definition. */
export function ambientLife(ctx, env, def, scene) {
  if (def.chroma) return;
  const t = env.t; const tod = env.tod; const W = STAGE_W;
  const rainy = env.weather === 'rain' || env.weather === 'fog';
  if (!def.indoor && !rainy && tod !== 'night' && def.horizonY > 0.2 && def.sky !== false && !/space|underwater|cave|moon|ocean_floor/.test(def.id || '')) {
    const r = rng(hash('birds' + (scene.seed || 1)));
    const n = 3;
    for (let i = 0; i < n; i++) {
      const period = 26 + r() * 14, off = r() * period, dir = i % 2 ? -1 : 1;
      const ph = ((t + off) % period) / period; if (ph > 0.55) continue; // crosses the sky, then pauses
      const u = ph / 0.55; const x = dir > 0 ? -60 + u * (W + 120) : W + 60 - u * (W + 120);
      const y = def.horizonY * 720 * (0.18 + r() * 0.35) + Math.sin(u * 9 + i) * 12;
      for (let k = 0; k < 2; k++) bird(ctx, x - dir * k * 26, y + k * 10, 1 - k * 0.2, Math.sin(t * 9 + i * 2 + k));
    }
  }
  if (!def.indoor && tod === 'night' && !rainy && def.horizonY > 0.2 && !/space|underwater|cave|moon/.test(def.id || '')) {
    const r = rng(hash('fireflies' + (scene.seed || 1)));
    for (let i = 0; i < 16; i++) {
      const bx = r() * W, by = (0.55 + r() * 0.35) * 720; const x = bx + Math.sin(t * 0.4 + i) * 40, y = by + Math.cos(t * 0.5 + i * 1.3) * 22;
      const glow = Math.max(0, Math.sin(t * 1.6 + i * 2.1)); if (glow < 0.05) continue;
      ctx.fillStyle = radGrad(ctx, x, y, 0, 9, [[0, `rgba(220,255,120,${0.8 * glow})`], [1, 'rgba(220,255,120,0)']]); ellipse(ctx, x, y, 9, 9); ctx.fill(); fillCircle(ctx, x, y, 1.3, `rgba(255,255,200,${glow})`);
    }
  }
  if (def.indoor && tod === 'day') {
    const r = rng(hash('motes' + (scene.seed || 1)));
    for (let i = 0; i < 22; i++) {
      const x = ((r() * W + Math.sin(t * 0.3 + i) * 20) % W + W) % W, y = (((r() * 720 - t * (3 + r() * 5)) % 720) + 720) % 720;
      ctx.globalAlpha = 0.12 + 0.12 * Math.sin(t + i); fillCircle(ctx, x, y, 1.2 + r() * 1.2, '#fffbe6');
    }
    ctx.globalAlpha = 1;
  }
}

/** Skew a drawing around its base so it sways in the wind. Use as: sway(ctx, env, x, y, () => draw()). */
export function sway(ctx, env, x, y, draw, amp = 0.012) {
  const k = Math.sin(env.t * 1.25 + x * 0.019) * amp + Math.sin(env.t * 0.47 + x * 0.007) * amp * 0.6;
  ctx.save(); ctx.translate(x, y); ctx.transform(1, 0, -k, 1, 0, 0); ctx.translate(-x, -y); draw(); ctx.restore();
}
