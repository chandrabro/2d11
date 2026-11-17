// Frame renderer: draws one frame of a project at a global time. Pure function of
// (project, time) so preview and export produce identical pixels.

import { drawSubtitle, showsSubtitle, defaultSubtitles } from './subtitles.js';
import { STAGE_W, STAGE_H, CHAR_PX_PER_UNIT, clamp, lerp, ease, smoothstep, hash, rgba, roundRect, wrapText, fillRound, radGrad, linGrad } from './util.js';
import { getScene } from './scenes/index.js';
import { getAction, poseAt } from './actions.js';
import { drawCharacter, proportions, lerpPose } from './character.js';
import { EXPRESSIONS } from './face.js';
import { groundShadow, rain, snow, fog, vignette, todOf, sunRays } from './scenery.js';
import { actorStateAt, actorPlaceAt, itemTimeline } from './motion.js';
import { drawActorFx, drawGroundMarks, drawGroundItems, drawFootprints, drawBreath } from './effects.js';
import { castShadow, ambientLife } from './ambient.js';
import { addLife, lifeStrength, talkLayer, listenLayer, lookAt, emotionFor, LISTENER_FACE, GESTURE_OK } from './life.js';

export { CHAR_PX_PER_UNIT, actorStateAt };

/** Camera presets. Values are in stage coordinates. zoom 1 = full stage. */
export const CAMERA_PRESETS = {
  wide:      { name: 'Wide shot',       start: { x: 640, y: 360, zoom: 1 },    end: { x: 640, y: 360, zoom: 1 } },
  medium:    { name: 'Medium shot',     start: { x: 640, y: 420, zoom: 1.5 },  end: { x: 640, y: 420, zoom: 1.5 } },
  closeup:   { name: 'Close-up',        start: { x: 640, y: 400, zoom: 2.6 },  end: { x: 640, y: 400, zoom: 2.6 } },
  low:       { name: 'Low angle',       start: { x: 640, y: 480, zoom: 1.35 }, end: { x: 640, y: 480, zoom: 1.35 } },
  high:      { name: 'High angle',      start: { x: 640, y: 300, zoom: 1.25 }, end: { x: 640, y: 300, zoom: 1.25 } },
  pan_lr:    { name: 'Pan left → right', start: { x: 480, y: 400, zoom: 1.4 }, end: { x: 800, y: 400, zoom: 1.4 } },
  pan_rl:    { name: 'Pan right → left', start: { x: 800, y: 400, zoom: 1.4 }, end: { x: 480, y: 400, zoom: 1.4 } },
  zoom_in:   { name: 'Slow zoom in',    start: { x: 640, y: 380, zoom: 1 },    end: { x: 640, y: 420, zoom: 1.8 } },
  zoom_out:  { name: 'Zoom out',        start: { x: 640, y: 420, zoom: 1.8 },  end: { x: 640, y: 380, zoom: 1 } },
  dolly:     { name: 'Dolly up',        start: { x: 640, y: 440, zoom: 1.4 },  end: { x: 640, y: 340, zoom: 1.1 } },
  shake:     { name: 'Handheld shake',  start: { x: 640, y: 400, zoom: 1.3 },  end: { x: 640, y: 400, zoom: 1.3 }, shake: 1 },
  custom:    { name: 'Custom',          start: { x: 640, y: 360, zoom: 1 },    end: { x: 640, y: 360, zoom: 1 } },
};

export const TRANSITIONS = [['cut', 'Cut'], ['fade', 'Fade to black'], ['dissolve', 'Cross dissolve'], ['slide', 'Slide (push)'], ['zoom', 'Zoom dissolve'], ['wipe', 'Wipe'], ['circle', 'Circle iris']];
export const WEATHER = [['none', 'None'], ['rain', 'Rain'], ['snow', 'Snow'], ['fog', 'Fog'], ['sunrays', 'Sun rays'], ['leaves', 'Falling leaves']];
export const TODS = [['day', 'Day'], ['dawn', 'Dawn'], ['sunset', 'Sunset'], ['night', 'Night']];

// ---------- timeline helpers ----------
export function sceneStart(project, index) {
  let t = 0;
  for (let i = 0; i < index; i++) t += project.scenes[i].duration;
  return t;
}
export function totalDuration(project) { return project.scenes.reduce((a, s) => a + s.duration, 0); }
export function sceneAt(project, time) {
  let t = 0;
  for (let i = 0; i < project.scenes.length; i++) {
    const s = project.scenes[i];
    if (time < t + s.duration || i === project.scenes.length - 1) return { index: i, scene: s, local: Math.min(time - t, s.duration) };
    t += s.duration;
  }
  return { index: 0, scene: project.scenes[0], local: 0 };
}

/** Camera state at local scene time. */
export function cameraAt(scene, local) {
  const cam = scene.camera || { preset: 'wide' };
  const preset = CAMERA_PRESETS[cam.preset] || CAMERA_PRESETS.wide;
  const start = cam.preset === 'custom' ? (cam.start || preset.start) : preset.start;
  const end = cam.preset === 'custom' ? (cam.end || cam.start || preset.end) : preset.end;
  const dur = Math.max(0.001, scene.duration);
  const u = ease.sine(clamp(local / dur, 0, 1));
  let x = lerp(start.x, end.x, u), y = lerp(start.y, end.y, u), zoom = lerp(start.zoom, end.zoom, u);
  const shake = preset.shake || cam.shake || 0;
  if (shake) { x += Math.sin(local * 13.1) * 6 * shake + Math.sin(local * 7.3) * 3 * shake; y += Math.cos(local * 11.7) * 5 * shake; }
  // a still shot is never dead still: a very slow push-in / drift (off for moving cameras, keyed screens and when cam.drift === false)
  const still = start.x === end.x && start.y === end.y && start.zoom === end.zoom;
  if (still && !shake && cam.drift !== false && dur >= 4 && !getScene(scene.background).chroma) {
    const d = clamp(local / dur, 0, 1), dir = (scene.seed || 1) % 2 ? 1 : -1;
    zoom *= 1 + 0.035 * d; x += dir * 14 * d; y -= 4 * d;
  }
  return { x, y, zoom };
}

/**
 * Auto-fit camera for narrow frames (9:16, 1:1, 4:5): pans horizontally so the speaking / moving character
 * stays in view. The target is averaged over a short time window, so the pan is smooth and still a pure
 * function of time (frame-exact exports stay deterministic). Landscape output is left untouched.
 */
export function autoFitCamera(scene, local, cam, aspect) {
  const visW0 = STAGE_H * aspect;
  if (visW0 >= STAGE_W * 0.98 || !scene.actors || !scene.actors.length) return cam;
  const visW = visW0 / cam.zoom;
  const focusAt = (t) => {
    const xs = scene.actors.map((a) => actorPlaceAt(a, t, scene).x);
    const min = Math.min(...xs), max = Math.max(...xs);
    if (max - min <= visW * 0.85) return (min + max) / 2; // everyone fits
    for (const d of scene.dialogs || []) { // follow the speaker
      if (d.actor >= 0 && d.actor < xs.length && t >= d.start && t < d.start + (d.duration || 2)) return xs[d.actor];
    }
    let mover = -1, best = 0; // else follow whoever is travelling the most
    scene.actors.forEach((a, i) => { const s0 = actorPlaceAt(a, t, scene), s1 = actorPlaceAt(a, t + 0.4, scene); const v = Math.abs(s1.x - s0.x); if (v > best) { best = v; mover = i; } });
    if (mover >= 0 && best > 1) return xs[mover];
    return xs.reduce((p, q) => p + q, 0) / xs.length;
  };
  const N = 13, win = 2.4; let fx = 0;
  for (let k = 0; k < N; k++) fx += focusAt(clamp(local + (k / (N - 1) - 0.5) * win, 0, scene.duration));
  fx /= N;
  return { ...cam, x: clamp(fx, visW / 2, STAGE_W - visW / 2) };
}

// ---------- actor evaluation: see motion.js (easing, blending, objects) ----------

// ---------- speech ----------
export function activeDialog(scene, actorIndex, local, audioInfo) {
  for (const d of scene.dialogs || []) {
    if (d.actor !== actorIndex) continue;
    const dur = dialogDuration(d, audioInfo);
    if (local >= d.start && local < d.start + dur) return { dialog: d, u: (local - d.start) / dur, elapsed: local - d.start };
  }
  return null;
}
export function dialogDuration(d, audioInfo) {
  if (d.source === 'tts' || !d.audioId) return d.duration || estimateTtsDuration(d.text, d.rate || 1);
  const info = audioInfo && audioInfo[d.audioId];
  return (d.trimEnd != null && d.trimEnd > 0) ? Math.max(0.1, d.trimEnd - (d.trimStart || 0)) : (info ? info.duration : d.duration || 2);
}
export function estimateTtsDuration(text, rate = 1) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const chars = String(text || '').length;
  return Math.max(0.8, (words * 0.38 + chars * 0.012 + 0.4) / rate);
}
/** Mouth openness 0..1 for a dialog at elapsed seconds. Uses the audio envelope when available. */
export function mouthAt(d, elapsed, audioInfo) {
  const info = d.audioId && audioInfo && audioInfo[d.audioId];
  if (info && info.envelope) {
    const i = Math.floor((elapsed + (d.trimStart || 0)) * info.envelopeRate);
    const v = info.envelope[Math.min(i, info.envelope.length - 1)] || 0;
    return clamp(v * (info.gain || 1), 0, 1);
  }
  // synthetic: pseudo-syllables from text
  const text = String(d.text || '');
  const syl = Math.max(1, Math.round(text.length / 3.2));
  const dur = dialogDuration(d, audioInfo);
  const ph = (elapsed / dur) * syl;
  const s = Math.sin(ph * Math.PI * 2) * 0.5 + 0.5;
  const pauses = (hash(text) % 7) + 3;
  const gate = Math.sin(elapsed * pauses * 0.6 + hash(text) % 10) > -0.6 ? 1 : 0;
  return clamp(s * 0.9 * gate, 0, 1);
}

// ---------- main render ----------
/**
 * Render a frame.
 * @param ctx target 2d context
 * @param project project data
 * @param time global time in seconds
 * @param opts { width, height, audioInfo, selection: {sceneIndex, actorIndex}, showGuides }
 */
export function renderFrame(ctx, project, time, opts = {}) {
  const W = opts.width || ctx.canvas.width, H = opts.height || ctx.canvas.height;
  const { index, scene, local } = sceneAt(project, time);
  ctx.save();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  // transitions (into this scene)
  const tr = scene.transition || 'cut';
  const trDur = Math.min(scene.transitionDuration || 0.6, scene.duration / 2);
  const active = tr !== 'cut' && index > 0 && local < trDur && !opts.noTransitions;
  const u = active ? ease.sine(clamp(local / trDur, 0, 1)) : 1;
  const boxed = (fn) => { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); fn(); ctx.restore(); };
  const prev = active ? project.scenes[index - 1] : null; const prevOpts = { ...opts, selection: null };
  if (active && tr === 'slide') { // push: the old scene slides out while the new one slides in
    boxed(() => { ctx.translate(-u * W, 0); renderScene(ctx, project, index - 1, prev.duration, W, H, prevOpts); });
    boxed(() => { ctx.translate((1 - u) * W, 0); renderScene(ctx, project, index, local, W, H, opts); });
  } else if (active && tr === 'zoom') {
    boxed(() => { const k = 1.07 - 0.07 * u; ctx.translate(W / 2, H / 2); ctx.scale(k, k); ctx.translate(-W / 2, -H / 2); renderScene(ctx, project, index, local, W, H, opts); });
    boxed(() => { const k = 1 + 0.12 * u; ctx.globalAlpha = 1 - u; ctx.translate(W / 2, H / 2); ctx.scale(k, k); ctx.translate(-W / 2, -H / 2); renderScene(ctx, project, index - 1, prev.duration, W, H, prevOpts); });
  } else {
    renderScene(ctx, project, index, local, W, H, opts);
    if (active) {
      if (tr === 'fade') { ctx.fillStyle = `rgba(0,0,0,${1 - u})`; ctx.fillRect(0, 0, W, H); }
      else if (tr === 'dissolve' || tr === 'wipe' || tr === 'circle') {
        ctx.save();
        if (tr === 'dissolve') ctx.globalAlpha = 1 - u;
        if (tr === 'wipe') { ctx.beginPath(); ctx.rect(u * W, 0, W, H); ctx.clip(); }
        if (tr === 'circle') { ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(W / 2, H / 2, u * Math.hypot(W, H) / 2, 0, Math.PI * 2, true); ctx.clip('evenodd'); }
        renderScene(ctx, project, index - 1, prev.duration, W, H, prevOpts);
        ctx.restore();
      }
    }
  }
  // fade out at the very end of the movie
  const total = totalDuration(project);
  if (project.fadeOut && time > total - 1) { ctx.fillStyle = `rgba(0,0,0,${clamp(time - (total - 1), 0, 1)})`; ctx.fillRect(0, 0, W, H); }
  // captions
  for (const c of scene.captions || []) {
    if (local >= c.start && local < c.end) drawCaption(ctx, c, W, H, local - c.start, c.end - local);
  }
  { // burned-in subtitles (narrator lines by default; see project.subtitles)
    const sub = project.subtitles || defaultSubtitles();
    for (const d of scene.dialogs || []) {
      if (!showsSubtitle(sub, d)) continue;
      const dur = dialogDuration(d, opts.audioInfo);
      if (local < d.start || local >= d.start + dur) continue;
      let who = '';
      if (d.actor === -1) who = 'Narrator'; else { const ac = scene.actors[d.actor]; const c = ac && project.characters.find((x) => x.id === ac.characterId); who = c ? c.name : ''; }
      drawSubtitle(ctx, sub, d.text, who, local - d.start, dur, W, H);
      break;
    }
  }
  if (project.watermark) { ctx.font = `${Math.round(H * 0.025)}px sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.textAlign = 'right'; ctx.fillText(project.watermark, W - 16, H - 14); ctx.textAlign = 'left'; }
  ctx.restore();
  return { index, scene, local };
}

function renderScene(ctx, project, index, local, W, H, opts) {
  const scene = project.scenes[index];
  const def = getScene(scene.background);
  const env = { W: STAGE_W, H: STAGE_H, t: local + (scene.timeOffset || 0) + index * 7.3, tod: scene.tod || 'day', seed: scene.seed || index + 1, weather: scene.weather || 'none', chroma: scene.chroma };
  const keyed = !!def.chroma; // green / blue screen: keep the key colour perfectly flat (no tint, shadow, weather, filter or vignette)
  if (keyed) { env.weather = 'none'; env.tod = 'day'; }
  let cam = cameraAt(scene, local);
  if (project.autoFit !== false) cam = autoFitCamera(scene, local, cam, W / H);
  // The stage (1280x720) is mapped to the output: scale so the stage height fills the output height at zoom 1,
  // then apply camera zoom around (cam.x, cam.y).
  const baseScale = H / STAGE_H;
  const stageW = W / baseScale; // visible stage width at zoom 1
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(baseScale * cam.zoom, baseScale * cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  // clamp: nothing to clamp; backgrounds are drawn beyond the stage edge by painters? Fill letterbox colour first
  ctx.fillStyle = keyed ? (scene.chroma || '#00b140') : '#000'; ctx.fillRect(-STAGE_W, -STAGE_H, STAGE_W * 3, STAGE_H * 3);
  // background (painted at stage size, extend edges by mirroring). It trails the camera a little (parallax),
  // so a pan shows depth: far scenery moves less than the characters.
  const shift = keyed ? 0 : clamp((cam.x - STAGE_W / 2) * 0.1, -70, 70);
  ctx.save(); ctx.translate(shift, 0);
  ctx.save();
  def.paint(ctx, env);
  ctx.restore();
  // mirrored edges so panning/portrait outputs never show black at the sides
  ctx.save(); ctx.translate(0, 0); ctx.scale(-1, 1); ctx.beginPath(); ctx.rect(0, 0, STAGE_W, STAGE_H); ctx.clip(); def.paint(ctx, env); ctx.restore();
  ctx.save(); ctx.translate(STAGE_W * 2, 0); ctx.scale(-1, 1); ctx.beginPath(); ctx.rect(0, 0, STAGE_W, STAGE_H); ctx.clip(); def.paint(ctx, env); ctx.restore();
  if (project.ambient !== false) ambientLife(ctx, env, def, scene);
  ctx.restore();

  // weather behind actors (fog) & lighting tint
  if (env.weather === 'fog') fog(ctx, env, STAGE_H * 0.55, 0.35);
  if (env.weather === 'sunrays') sunRays(ctx, env, STAGE_W * 0.8, -20, 7, 1400, 0.1);

  // actors sorted by depth (y)
  const audioInfo = opts.audioInfo || {};
  const tl = itemTimeline(scene);
  const fxOn = project.fx !== false && !keyed, actOn = project.acting !== false;
  const groundY = def.groundY * STAGE_H, horizonY = def.horizonY * STAGE_H;
  const list = (scene.actors || []).map((a, i) => ({ a, i, st: actorStateAt(a, local, scene, tl), talk: activeDialog(scene, i, local, audioInfo) }));
  const speaker = list.find((q) => q.talk && !q.talk.dialog.silent);
  const spkEmotion = speaker ? emotionOf(project, speaker.talk.dialog) : null;
  list.sort((p, q) => p.st.y - q.st.y);
  if (fxOn) {
    drawGroundMarks(ctx, scene, local, project); drawGroundItems(ctx, scene, tl, local);
    if (!def.indoor && (env.weather === 'snow' || env.weather === 'rain')) drawFootprints(ctx, scene, local, env.weather);
  }
  for (const { a, i, st, talk } of list) {
    const ch = project.characters.find((c) => c.id === a.characterId);
    if (!ch) continue;
    const depth = clamp((st.y - horizonY) / Math.max(1, groundY - horizonY), 0, 1.2); // 0 = far, 1 = front
    const scale = CHAR_PX_PER_UNIT * (a.scale || 1) * lerp(0.62, 1, depth);
    const P = proportions(ch.appearance);
    const tClock = local + i * 1.7, seed = i * 1.37 + index * 0.71;
    let pose = st.pose;
    if (actOn) pose = addLife(pose, tClock, seed, lifeStrength(st.action.id));
    let mouthOpen = pose.mouthOpen || 0;
    const speaking = talk && !talk.dialog.silent;
    if (speaking) {
      const d = talk.dialog; const el = talk.elapsed, dur = el / Math.max(0.001, talk.u);
      mouthOpen = Math.max(mouthOpen, mouthAt(d, el, audioInfo));
      // when idle and speaking, use the talking gesture so the actor looks alive (blended in and out)
      if (st.action.id === 'idle' && a.autoGesture !== false) {
        const w = smoothstep(clamp(Math.min(el / 0.25, (dur - el) / 0.25), 0, 1));
        pose = lerpPose(pose, poseAt(getAction('talk'), el), w);
      }
      if (actOn) {
        const energy = (mouthAt(d, el, audioInfo) + mouthAt(d, Math.max(0, el - 0.06), audioInfo) + mouthAt(d, Math.max(0, el - 0.12), audioInfo)) / 3;
        const emo = emotionOf(project, d);
        pose = talkLayer(pose, { energy, elapsed: el, u: talk.u, text: d.text, emotion: emo, seed, gesture: GESTURE_OK.has(st.action.id) });
        if (emo && EXPRESSIONS[emo] && ['neutral', 'happy'].includes(pose.face)) { const k = smoothstep(clamp(Math.min(el / 0.2, (dur - el) / 0.3), 0, 1)); pose = { ...pose, faceFrom: pose.face, face: emo, faceK: k }; }
      }
    } else if (actOn && speaker && STILL_FACE.has(st.action.id)) {
      pose = listenLayer(pose, speaker.talk.elapsed, seed);
      const lf = LISTENER_FACE[spkEmotion]; const el = speaker.talk.elapsed;
      if (lf && ['neutral', 'happy'].includes(pose.face) && el > 0.5) pose = { ...pose, faceFrom: pose.face, face: lf, faceK: smoothstep(clamp((el - 0.5) / 0.4, 0, 1)) };
    }
    if (actOn) { // eyes: look at the speaker; the speaker looks at the nearest listener; others follow whoever moves
      let target = null;
      if (speaking) { let best = 1e9; for (const q of list) if (q.i !== i) { const dd = Math.abs(q.st.x - st.x); if (dd < best) { best = dd; target = q.st; } } }
      else if (speaker && speaker.i !== i) target = speaker.st;
      else { for (const q of list) if (q.i !== i) { const q1 = actorPlaceAt(q.a, local + 0.4, scene); if (Math.abs(q1.x - q.st.x) > 6) target = q.st; } }
      const lk = lookAt(st, target, tClock, seed); pose = { ...pose, lookX: lk.x, lookY: lk.y, headTilt: (pose.headTilt || 0) + (target ? lk.x * 1.2 : 0) };
    }
    if (st.action.id === 'drink' && pose.prop && pose.prop.type === 'glass') pose = { ...pose, prop: { ...pose.prop, level: 0.8 - 0.7 * st.segProgress } };
    // shadow
    const lying = Math.abs(pose.rot || 0) > 45;
    if (!keyed) castShadow(ctx, st.x, st.y + 2, (lying ? 52 : 14) * scale * P.s, 4 * scale * P.s, env.tod, lying);
    drawCharacter(ctx, ch.appearance, pose, { x: st.x, y: st.y, scale, facing: st.facing, orientation: st.orientation, t: tClock, mouthOpen, blinkSeed: i + index });
    if (fxOn) {
      drawActorFx(ctx, scene, a, local, P.s);
      if (!def.indoor && env.weather === 'snow' && !lying) drawBreath(ctx, st.x, st.y - 89 * scale * P.s, st.facing, scale * P.s, local, i);
    }
    // speech bubble
    if (talk && talk.dialog.bubble !== false && talk.dialog.text && !(project.subtitles && project.subtitles.mode === 'all' && project.subtitles.hideBubbles)) {
      const headY = st.y - 100 * scale * P.s - 12 * scale * P.s;
      drawSpeechBubble(ctx, talk.dialog, st.x, headY, st.facing, cam.zoom, project.bubbleStyle || 'rounded');
    }
    // selection outline (editor only)
    if (opts.selection && opts.selection.sceneIndex === index && opts.selection.actorIndex === i) {
      ctx.save(); ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 3 / cam.zoom; ctx.setLineDash([8, 6]);
      roundRect(ctx, st.x - 40 * scale * P.s / CHAR_PX_PER_UNIT * CHAR_PX_PER_UNIT / 3.2, st.y - 104 * scale * P.s, 80 * scale * P.s, 108 * scale * P.s, 10); ctx.stroke(); ctx.restore();
    }
  }
  // foreground layer
  if (def.paintFront) { ctx.save(); ctx.translate(-shift * 0.6, 0); def.paintFront(ctx, env); ctx.restore(); }
  // weather in front
  if (env.weather === 'rain') rain(ctx, env, 1);
  if (env.weather === 'snow') snow(ctx, env, 1);
  if (env.weather === 'leaves') leaves(ctx, env);
  // colour grading
  const p = todOf(env);
  if (p.tint && !def.indoor && !keyed) { ctx.fillStyle = p.tint; ctx.fillRect(-STAGE_W, -STAGE_H, STAGE_W * 3, STAGE_H * 3); }
  if (!keyed && scene.filter && scene.filter !== 'none') applyFilter(ctx, scene.filter, env);
  ctx.restore();
  if (!keyed && scene.vignette !== false) vignette(ctx, { W, H }, scene.vignette === 'strong' ? 0.55 : 0.3);
  if (opts.showGuides) {
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(baseScale * cam.zoom, baseScale * cam.zoom); ctx.translate(-cam.x, -cam.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, STAGE_W, STAGE_H);
    ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(STAGE_W, groundY); ctx.moveTo(0, horizonY); ctx.lineTo(STAGE_W, horizonY); ctx.stroke();
    ctx.restore();
  }
}

const STILL_FACE = new Set(['idle', 'talk', 'sit', 'sit_talk', 'look_around', 'think', 'nod', 'shake_head']);
function emotionOf(project, d) {
  if (d.emotion && EXPRESSIONS[d.emotion]) return d.emotion;
  return project.autoEmotion === false ? null : emotionFor(d.text);
}

function leaves(ctx, env) {
  const n = 40;
  for (let i = 0; i < n; i++) {
    const s = hash('leaf' + i) / 4294967296;
    const x = ((s * STAGE_W + env.t * (20 + s * 30) + Math.sin(env.t * 1.5 + i) * 25) % (STAGE_W + 60)) - 30;
    const y = ((s * 7919 % STAGE_H) + env.t * (40 + s * 40)) % (STAGE_H + 40) - 20;
    ctx.save(); ctx.translate(x, y); ctx.rotate(env.t * 2 + i);
    ctx.fillStyle = ['#e67e22', '#d35400', '#f1c40f', '#c0392b'][i % 4];
    ctx.beginPath(); ctx.ellipse(0, 0, 7, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}
function applyFilter(ctx, filter, env) {
  const full = () => ctx.fillRect(-STAGE_W, -STAGE_H, STAGE_W * 3, STAGE_H * 3);
  if (filter === 'warm') { ctx.fillStyle = 'rgba(255,160,60,0.12)'; full(); }
  else if (filter === 'cool') { ctx.fillStyle = 'rgba(60,120,255,0.12)'; full(); }
  else if (filter === 'sepia') { ctx.globalCompositeOperation = 'color'; ctx.fillStyle = 'rgba(112,66,20,1)'; full(); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(112,66,20,0.18)'; full(); }
  else if (filter === 'bw') { ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#808080'; full(); ctx.globalCompositeOperation = 'source-over'; }
  else if (filter === 'dream') { ctx.fillStyle = 'rgba(255,200,240,0.14)'; full(); }
  else if (filter === 'dark') { ctx.fillStyle = 'rgba(0,0,20,0.3)'; full(); }
}

export function drawSpeechBubble(ctx, d, x, topY, facing, zoom, style = 'rounded') {
  const text = d.text || '';
  const s = 1 / Math.max(0.6, Math.sqrt(zoom)); // keep readable
  ctx.save();
  ctx.font = `600 ${Math.round(22 * s)}px "Nunito", "Segoe UI", sans-serif`;
  const maxW = 300 * s;
  const lines = wrapText(ctx, text, maxW);
  const lh = 27 * s, pad = 14 * s;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * lh + pad * 1.6;
  let bx = x - w / 2, by = topY - h - 18 * s;
  bx = clamp(bx, 8, STAGE_W - w - 8); by = Math.max(8, by);
  const bg = d.bubbleColor || (style === 'thought' ? '#ffffff' : '#ffffff');
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 12 * s; ctx.shadowOffsetY = 4 * s;
  ctx.fillStyle = bg;
  if (style === 'thought') { roundRect(ctx, bx, by, w, h, h / 2); ctx.fill(); ctx.shadowColor = 'transparent'; ctx.beginPath(); ctx.arc(x, by + h + 10 * s, 6 * s, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(x + 4 * s, by + h + 22 * s, 3.5 * s, 0, 7); ctx.fill(); }
  else if (style === 'shout') { ctx.beginPath(); const n = 18; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const r = i % 2 ? 1 : 1.12; ctx.lineTo(bx + w / 2 + Math.cos(a) * (w / 2) * r, by + h / 2 + Math.sin(a) * (h / 2 + 6 * s) * r); } ctx.closePath(); ctx.fill(); }
  else if (style === 'box') { ctx.fillRect(bx, by, w, h); ctx.shadowColor = 'transparent'; ctx.beginPath(); ctx.moveTo(x - 8 * s, by + h); ctx.lineTo(x, by + h + 14 * s); ctx.lineTo(x + 8 * s, by + h); ctx.fill(); }
  else { roundRect(ctx, bx, by, w, h, 14 * s); ctx.fill(); ctx.shadowColor = 'transparent'; ctx.beginPath(); ctx.moveTo(clamp(x - 9 * s, bx + 12, bx + w - 30), by + h - 1); ctx.lineTo(clamp(x, bx + 20, bx + w - 20), by + h + 16 * s); ctx.lineTo(clamp(x + 9 * s, bx + 30, bx + w - 12), by + h - 1); ctx.fill(); }
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = d.textColor || '#1c1c28'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad * 0.8 + i * lh));
  ctx.restore();
}

function drawCaption(ctx, c, W, H, sinceStart, untilEnd) {
  ctx.save();
  const a = Math.min(1, sinceStart / 0.3, untilEnd / 0.3);
  ctx.globalAlpha = a;
  const size = Math.round(H * (c.size || 0.05));
  const family = c.font === 'display' ? '"Bricolage Grotesque", "Nunito", sans-serif' : '"Nunito", "Segoe UI", sans-serif';
  ctx.font = `800 ${size}px ${family}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = wrapText(ctx, c.text || '', W * 0.86);
  const pos = c.position || 'bottom';
  const y0 = pos === 'top' ? H * 0.12 : pos === 'center' ? H / 2 - (lines.length - 1) * size * 0.6 : H * 0.88 - (lines.length - 1) * size * 1.2;
  lines.forEach((l, i) => {
    const y = y0 + i * size * 1.2;
    if (c.style === 'title') { ctx.lineWidth = size * 0.18; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(l, W / 2, y); ctx.fillStyle = c.color || '#ffd166'; ctx.fillText(l, W / 2, y); }
    else { const tw = ctx.measureText(l).width; ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(ctx, W / 2 - tw / 2 - size * 0.4, y - size * 0.65, tw + size * 0.8, size * 1.3, size * 0.3); ctx.fill(); ctx.fillStyle = c.color || '#fff'; ctx.fillText(l, W / 2, y); }
  });
  ctx.restore();
}

/** Convert a point in output pixels to stage coordinates for the current camera. */
export function outputToStage(project, time, px, py, W, H) {
  const { scene, local } = sceneAt(project, time);
  const cam = cameraAt(scene, local);
  const baseScale = H / STAGE_H;
  const sx = (px - W / 2) / (baseScale * cam.zoom) + cam.x;
  const sy = (py - H / 2) / (baseScale * cam.zoom) + cam.y;
  return { x: sx, y: sy };
}
