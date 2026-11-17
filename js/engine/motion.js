// Where an actor is and what pose it has at a given time.
//  - movement eases in and out (no instant start / stop) and the feet follow the ground speed
//  - changing from one action to the next blends smoothly instead of snapping
//  - a small settle (weight shift) after walking / running
//  - objects: pick up -> carry -> put down / give to someone. Held and dropped objects are derived from the
//    action segments themselves, so a story only needs   [Ram: pick up basket]  ...  [Ram: put down]
// Pure function of (scene, time): preview and export give identical frames.

import { getAction, poseAt } from './actions.js';
import { lerpPose } from './character.js';
import { getScene } from './scenes/index.js';
import { clamp, lerp, ease, smoothstep, CHAR_PX_PER_UNIT } from './util.js';
import { LOCOMOTION } from './actionfx.js';

export const BLEND = 0.28; // seconds to blend from one action into the next

/** Fraction of the distance covered after `tau` seconds of a `dur` second move: soft start, steady middle, soft stop. */
export function moveFrac(tau, dur) {
  if (dur <= 0.001) return 1;
  const r = Math.min(0.45, dur * 0.3);
  tau = clamp(tau, 0, dur);
  const D = dur - r;
  let p;
  if (tau < r) p = (tau * tau) / (2 * r);
  else if (tau <= dur - r) p = r / 2 + (tau - r);
  else { const k = dur - tau; p = D - (k * k) / (2 * r); }
  return clamp(p / D, 0, 1);
}

export function depthScale(def, y) {
  const groundY = def.groundY * 720, horizonY = def.horizonY * 720;
  const depth = clamp((y - horizonY) / Math.max(1, groundY - horizonY), 0, 1.2);
  return lerp(0.62, 1, depth);
}
/** Pixels per character unit for an actor standing at y (before the build scale). */
export function unitPx(scene, actor, y) { return CHAR_PX_PER_UNIT * (actor.scale || 1) * depthScale(getScene(scene.background), y); }

// ---------- position ----------
export function actorPlaceAt(actor, local, scene) {
  const segs = sortedSegs(actor);
  let x = actor.x, y = actor.y, facing = actor.facing || 1;
  let current = null, prevEnd = null;
  for (const s of segs) {
    const end = s.end ?? s.start + 2;
    if (local >= end) {
      const px = x;
      if (s.toX != null) x = s.toX; if (s.toY != null) y = s.toY;
      if (s.toX != null && Math.abs(s.toX - px) > 2) facing = s.toX >= px ? 1 : -1;
      if (s.facing) facing = s.facing;
      prevEnd = s; continue;
    }
    if (local >= s.start) current = s;
    break;
  }
  let orientation = actor.orientation || 'side';
  let fromX = x, fromY = y, dist = 0, moved = false, u = 0;
  if (current) {
    const end = current.end ?? current.start + 2;
    const dur = Math.max(0.001, end - current.start);
    if (current.toX != null || current.toY != null) {
      const tx = current.toX ?? fromX, ty = current.toY ?? fromY;
      u = moveFrac(local - current.start, dur);
      x = lerp(fromX, tx, u); y = lerp(fromY, ty, u);
      dist = Math.hypot(x - fromX, y - fromY); moved = Math.hypot(tx - fromX, ty - fromY) > 2;
      if (Math.abs(tx - fromX) > 2 && !current.facing) facing = tx > fromX ? 1 : -1;
      if (Math.abs(tx - fromX) > 2 && orientation === 'front' && !current.orientation) orientation = 'side'; // turn to walk, face the camera again when stopped
    }
    if (current.facing) facing = current.facing;
    if (current.orientation) orientation = current.orientation;
  }
  return { x, y, facing, orientation, current, prevEnd, fromX, fromY, dist, moved, u };
}
function sortedSegs(actor) {
  const segs = (actor.actions || []).slice().sort((a, b) => a.start - b.start);
  return segs;
}

// ---------- objects ----------
const CARRY_ARM_OK = new Set(['idle', 'talk', 'walk', 'sad_walk', 'sit', 'sit_talk', 'look_around', 'nod', 'shake_head', 'sneak', 'think', 'run', 'receive', 'put_down', 'surprised', 'shrug', 'point', 'wave', 'give', 'pick_up']);
const TOOLS = new Set(['shovel', 'hoe', 'sickle', 'axe', 'hammer', 'broom', 'umbrella', 'flag', 'torch', 'sword', 'wand', 'wrench', 'telescope', 'guitar']);
const TWO_HANDED = { big_box: { dx: 14, dy: -50 }, pot: { dx: 14, dy: -52 }, basket: null };
export function holdStyle(type) {
  if (type === 'big_box') return { both: true, dx: 14, dy: -50, angle: 0, armN: [75, 60], armF: [70, 65] };
  if (TOOLS.has(type)) return { angle: -15, dx: 0, dy: 0, armN: [22, 28] };
  if (['book', 'phone', 'paper', 'map', 'tablet', 'key', 'magnifier', 'camera', 'gift', 'trophy', 'cake', 'plate', 'cup', 'glass', 'bottle', 'flower', 'ball', 'balloon', 'ice_cream', 'microphone', 'binoculars', 'spoon'].includes(type)) return { angle: 0, dx: 0, dy: 0, armN: [48, 78] };
  return { angle: 0, dx: 0, dy: 2, armN: [10, 44] }; // hanging items: basket, bag, bucket, grain_bag, pot ...
}
// resting offset (character units) so a dropped object stands on the ground, and whether it lies down
const REST = { basket: -9, bag: -12, bucket: -14, grain_bag: -12, big_box: -8, pot: -12, gift: -8, book: -10, ball: -5, cake: -7, trophy: -6, bottle: -6, glass: -4, cup: -2, plate: -3, phone: -4, map: -6, paper: -7, tablet: -8, key: -8, flower: 0, balloon: 0, laptop: -2, camera: -4 };
export function groundStyle(type) { return { dy: REST[type] ?? -8, lying: TOOLS.has(type) && !['flag', 'torch'].includes(type) }; }

/** Everything that happens to objects in a scene: who holds what when, what lies on the ground, who reaches out. */
export function itemTimeline(scene) {
  const actors = scene.actors || [];
  const held = actors.map(() => []); const ground = []; const reach = [];
  const def = getScene(scene.background);
  const ev = [];
  actors.forEach((a, ai) => { for (const s of a.actions || []) if (s.action === 'pick_up' || s.action === 'put_down' || s.action === 'give') ev.push({ ai, s, a }); });
  (scene.items || []).forEach((it) => ground.push({ type: it.type, color: it.color, x: it.x, y: it.y, t0: -1, t1: Infinity }));
  if (!ev.length) return { held, ground, reach };
  ev.sort((p, q) => p.s.start - q.s.start);
  const now = actors.map(() => null);
  for (const { ai, s, a } of ev) {
    const end = s.end ?? s.start + 2; const dur = Math.max(0.2, end - s.start);
    const tMid = s.start + 0.55 * dur;
    const pl = actorPlaceAt(a, s.start, scene);
    const cs = CHAR_PX_PER_UNIT * (a.scale || 1) * depthScale(def, pl.y);
    const gx = pl.x + pl.facing * 26 * cs, gy = pl.y;
    if (s.action === 'pick_up') {
      const type = s.item || 'basket'; const color = s.itemColor;
      const there = ground.find((g) => g.t1 === Infinity && g.t0 <= s.start && Math.abs(g.x - gx) < 80 && Math.abs(g.y - gy) < 60);
      if (there) { there.t1 = tMid; now[ai] = { type: there.type, color: there.color }; }
      else { ground.push({ type, color, x: gx, y: gy, t0: -1, t1: tMid }); now[ai] = { type, color }; }
      held[ai].push({ t: tMid, ...now[ai] });
    } else if (s.action === 'put_down') {
      const it = now[ai] || { type: s.item || 'basket', color: s.itemColor };
      ground.push({ type: it.type, color: it.color, x: gx, y: gy, t0: tMid, t1: Infinity });
      held[ai].push({ t: tMid, type: null }); now[ai] = null;
    } else { // give
      const it = now[ai] || (s.item ? { type: s.item, color: s.itemColor } : null);
      const to = Number.isInteger(s.to) && s.to >= 0 && s.to < actors.length && s.to !== ai ? s.to : -1;
      held[ai].push({ t: tMid, type: null }); now[ai] = null;
      if (it && to >= 0) { held[to].push({ t: tMid, ...it }); now[to] = it; reach.push({ actor: to, t0: s.start + 0.1 * dur, t1: tMid + 0.7 }); }
      else if (it) ground.push({ type: it.type, color: it.color, x: gx, y: gy, t0: tMid, t1: Infinity });
    }
  }
  for (const h of held) h.sort((p, q) => p.t - q.t);
  return { held, ground, reach };
}
export function heldAt(tl, ai, local) {
  const list = tl.held[ai]; if (!list || !list.length) return null;
  let cur = null; for (const e of list) { if (e.t <= local) cur = e; else break; }
  return cur && cur.type ? cur : null;
}
function applyHeld(pose, item, action) {
  if (!item || (pose.prop && pose.prop.type)) return pose;
  const h = holdStyle(item.type); const p = { ...pose };
  p.prop = h.both ? { type: item.type, color: item.color, hand: 'both', center: true, dx: h.dx, dy: h.dy, angle: h.angle } : { type: item.type, color: item.color, hand: 'N', angle: h.angle, dx: h.dx, dy: h.dy };
  p.handN = 'grip'; if (h.both) p.handF = 'grip';
  if (CARRY_ARM_OK.has(action.id)) { if (action.id === 'walk' || action.id === 'run' || action.id === 'sad_walk' || action.id === 'sneak') { p.armN = h.armN.slice(); if (h.both) p.armF = h.armF.slice(); } else if (!['wave', 'point', 'shrug'].includes(action.id)) { p.armN = h.armN.slice(); if (h.both) p.armF = h.armF.slice(); } }
  return p;
}

// ---------- full state ----------
function rawState(actor, ai, local, scene, tl, def) {
  const pl = actorPlaceAt(actor, local, scene);
  const cur = pl.current;
  let actionId = actor.idleAction || 'idle', actionTime = local;
  if (cur) {
    actionId = cur.action; actionTime = local - cur.start;
    const act = getAction(actionId);
    if (act.stride && pl.moved) actionTime = (pl.dist / (act.stride * (actor.scale || 1) * depthScale(def, pl.y))) * act.duration; // feet follow the ground
  } else if (pl.prevEnd && pl.prevEnd.holdLast !== false) {
    const act = getAction(pl.prevEnd.action);
    if (!act.loop && pl.prevEnd.hold !== false) { actionId = pl.prevEnd.action; actionTime = act.duration; }
  }
  const action = getAction(actionId);
  let pose = poseAt(action, actionTime);
  const item = heldAt(tl, ai, local);
  if (item) pose = applyHeld(pose, item, action);
  return { pl, action, actionTime, pose, item };
}

/**
 * Returns { x, y, facing, orientation, pose, action, actionTime, segment, segProgress, held } at local scene time.
 * `tl` (itemTimeline) can be passed in to save work when many actors are evaluated for one frame.
 */
export function actorStateAt(actor, local, scene, tl) {
  const ai = (scene.actors || []).indexOf(actor);
  tl = tl || itemTimeline(scene);
  const def = getScene(scene.background);
  const raw = rawState(actor, ai, local, scene, tl, def);
  const { pl } = raw; let pose = raw.pose;
  const cur = pl.current;
  // blend from the previous action into this one (and from an action into the idle gap after it)
  const phaseStart = cur ? cur.start : pl.prevEnd ? (pl.prevEnd.end ?? pl.prevEnd.start + 2) : null;
  if (phaseStart != null && phaseStart > 0.05 && local - phaseStart < BLEND && local >= phaseStart) {
    const before = rawState(actor, ai, phaseStart - 0.002, scene, tl, def).pose;
    pose = lerpPose(before, pose, ease.sine(clamp((local - phaseStart) / BLEND, 0, 1)));
  }
  // settle after a walk / run: a small weight shift instead of a dead stop
  const pe = pl.prevEnd;
  if (pe && !cur && pe.toX != null && LOCOMOTION.has(pe.action)) {
    const tau = local - (pe.end ?? pe.start + 2);
    if (tau >= 0 && tau < 0.8) {
      const k = Math.exp(-5 * tau) * Math.sin(tau * 15) * (pe.action === 'run' ? 1.7 : 1);
      pose = { ...pose, torso: (pose.torso || 0) + k * 5, bodyY: (pose.bodyY || 0) + Math.abs(k) * 0.6, armN: [pose.armN[0] + k * 12, pose.armN[1]], armF: [pose.armF[0] - k * 12, pose.armF[1]] };
    }
  }
  // someone is handing us something: arms out
  for (const r of tl.reach) {
    if (r.actor !== ai || local < r.t0 - 0.05 || local > r.t1 + 0.3) continue;
    if (!['idle', 'talk', 'sit', 'sit_talk', 'look_around', 'nod'].includes(raw.action.id)) continue;
    const w = smoothstep(clamp(Math.min((local - r.t0) / 0.3, (r.t1 + 0.3 - local) / 0.3), 0, 1));
    const rp = poseAt(getAction('receive'), clamp((local - r.t0) / Math.max(0.1, r.t1 - r.t0), 0, 1) * 1.8);
    const keepProp = pose.prop; pose = lerpPose(pose, { ...rp, prop: keepProp }, w);
  }
  let segProgress = 0;
  if (cur) segProgress = clamp((local - cur.start) / Math.max(0.001, (cur.end ?? cur.start + 2) - cur.start), 0, 1); else if (pl.prevEnd) segProgress = 1;
  return { x: pl.x, y: pl.y, facing: pl.facing, orientation: pl.orientation, pose, action: raw.action, actionTime: raw.actionTime, segment: cur, segProgress, held: raw.item, place: pl };
}
