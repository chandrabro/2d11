// Acting layer: breathing and weight shifts, nods and gestures that follow the voice, facial expression that
// follows the meaning of a line, and eyes that look at who is speaking. All deterministic (pure of time).

import { clamp, smoothstep } from './util.js';

/** Actions in which a person stands / sits still enough to breathe, shift weight and glance around. */
export const STILL_ACTIONS = new Set(['idle', 'talk', 'sit', 'sit_talk', 'look_around', 'think', 'shrug', 'whisper', 'read', 'phone', 'phone_call', 'point', 'wave', 'salute', 'namaste', 'pray', 'kneel', 'nod', 'shake_head', 'thumbs_up', 'watch', 'binoculars', 'telescope', 'receive', 'give', 'photo', 'write', 'type', 'surprised', 'scared', 'cry', 'sleep', 'lie_down', 'pick_up', 'put_down']);
export const GESTURE_OK = new Set(['idle', 'talk', 'sit', 'sit_talk', 'look_around']);

export function lifeStrength(actionId) {
  if (actionId === 'sleep' || actionId === 'lie_down') return 0.25;
  if (['scared', 'cry'].includes(actionId)) return 0.3;
  return STILL_ACTIONS.has(actionId) ? 1 : 0;
}

/** Small, never-repeating-looking idle motion. k = strength 0..1, seed per actor. */
export function addLife(pose, t, seed, k) {
  if (k <= 0) return pose;
  const s = seed * 1.7 + 0.4; const breath = Math.sin(t * 1.75 + s);
  const lying = Math.abs(pose.rot || 0) > 30;
  const p = { ...pose };
  p.bodyY = (pose.bodyY || 0) + breath * 0.35 * k;
  p.torso = (pose.torso || 0) + (breath * 0.5 + Math.sin(t * 0.4 + s * 2) * 0.6) * k;
  if (!pose.sit && !lying) p.bodyX = (pose.bodyX || 0) + Math.sin(t * 0.45 + s * 3) * 0.9 * k; // weight shifts from foot to foot
  p.head = (pose.head || 0) + Math.sin(t * 0.8 + s) * 1.2 * k;
  p.headTilt = (pose.headTilt || 0) + Math.sin(t * 0.53 + s * 2.3) * 1.6 * k;
  p.armN = [pose.armN[0] + Math.sin(t * 1.1 + s) * 1.4 * k, pose.armN[1]];
  p.armF = [pose.armF[0] + Math.sin(t * 1.3 + s + 1) * 1.4 * k, pose.armF[1]];
  return p;
}

// ---------- emotion from the words ----------
const EN = [
  ['angry', /\b(angry|furious|hate|stupid|idiot|shut up|get out|how dare|liar|cheat|thief|fool|nonsense|enough)\b|!{2,}/i],
  ['scared', /\b(help|save me|danger|fire|ghost|afraid|scared|terrified|please don't|don't hurt|run away|monster|snake|tiger)\b/i],
  ['sad', /\b(sorry|crying|cry|tears|died|dead|death|lost|miss you|alone|sad|hungry|poor|forgive|suffer|pain|unfortunately|sorrow)\b/i],
  ['surprised', /\b(wow|amazing|can't believe|cannot believe|unbelievable|what\?!|really\?|oh my|incredible|impossible|suddenly|shocking)\b/i],
  ['bigsmile', /\b(thank|thanks|love|happy|great|wonderful|congratulations|well done|welcome|blessed|beautiful|won|victory|hooray|bravo|lovely|delighted|proud|glad|joy)\b/i],
];
const IN = [
  ['angry', /गुस्स|क्रोध|चुप रहो|निकल जा|झूठ|धोखा|मूर्ख|बेवकूफ|रिस|मूर्ख|चोर|बस करो/],
  ['scared', /बचाओ|मदद|डर|भूत|आग|भाग|सहायता|बचाउ|खतरा|साँप|सांप|शेर|राक्षस/],
  ['sad', /माफ|रो |रोत|आँसू|आंसू|मर गय|मृत्यु|दुख|दुःख|अकेल|भूख|गरीब|गल्ती|ग़लती|पीड़ा|पीडा|दुःखी|दुखी|खोया|खोई/],
  ['surprised', /अरे|वाह|सच में|क्या\?!|विश्वास नहीं|अविश्वसनीय|अचानक|हैरान/],
  ['bigsmile', /धन्यवाद|शुक्रिया|खुश|खुसी|प्यार|माया|बधाई|स्वागत|शाबाश|जीत|आशीर्वाद|वाहवाही|सुन्दर|सुंदर|मंगल/],
];
export function emotionFor(text) {
  const t = String(text || ''); if (!t.trim()) return null;
  for (const [id, re] of EN) if (re.test(t)) return id;
  for (const [id, re] of IN) if (re.test(t)) return id;
  if (/\?\s*$/.test(t)) return 'thinking';
  if (/!\s*$/.test(t)) return 'happy';
  return null;
}
/** How a listener reacts to the emotion of the speaker. */
export const LISTENER_FACE = { sad: 'sad', scared: 'scared', angry: 'surprised', bigsmile: 'happy', surprised: 'surprised', happy: 'happy' };

/** Nods, beat gestures and posture for a speaker. o: { energy, elapsed, u, text, emotion, seed, gesture } */
export function talkLayer(pose, o) {
  const p = { ...pose }; const e = clamp(o.energy, 0, 1); const ex = /!\s*$/.test(o.text || '') ? 1.35 : 1;
  p.head = (pose.head || 0) + (e - 0.3) * 5 * ex + Math.sin(o.elapsed * 2.3 + o.seed) * 0.8;
  p.torso = (pose.torso || 0) + e * 1.4 * ex;
  p.headTilt = (pose.headTilt || 0) + Math.sin(o.elapsed * 1.2 + o.seed) * 1.6;
  if (/\?\s*$/.test(o.text || '') && o.u > 0.65) p.headTilt += 7 * smoothstep(clamp((o.u - 0.65) / 0.25, 0, 1)); // a question ends with a curious tilt
  if (o.gesture) { p.armN = [pose.armN[0] + e * 16 * ex, pose.armN[1] + e * 10 * ex]; p.armF = [pose.armF[0] + e * 8 * ex, pose.armF[1] + e * 6]; }
  if (o.emotion === 'sad') { p.head += 7; p.torso += 4; }
  else if (o.emotion === 'angry') { p.torso += 3; p.handN = 'fist'; }
  else if (o.emotion === 'scared') p.bodyX = (pose.bodyX || 0) + Math.sin(o.elapsed * 34) * 0.5;
  else if (o.emotion === 'bigsmile') p.bodyY = (pose.bodyY || 0) - e * 0.8;
  return p;
}
/** A person who listens nods now and then. */
export function listenLayer(pose, elapsed, seed) {
  const pulse = Math.pow(Math.max(0, Math.sin(elapsed * 1.15 + seed * 3.1)), 8);
  return { ...pose, head: (pose.head || 0) + pulse * 5, torso: (pose.torso || 0) + pulse * 0.8 };
}

/** Where the eyes look (-1..1 in the actor's own forward direction). */
export function lookAt(selfState, targetState, t, seed) {
  const sac = Math.sin(t * 0.7 + seed * 2) * 0.12 + Math.sin(t * 1.9 + seed) * 0.06; // tiny natural eye drift
  if (!targetState) return { x: sac, y: Math.sin(t * 0.5 + seed) * 0.05 };
  const dx = (targetState.x - selfState.x) * selfState.facing;
  const x = clamp(dx / 160, -1, 1) * 0.9 + sac * 0.5;
  const y = clamp((targetState.y - selfState.y) / 400, -0.4, 0.4);
  return { x, y };
}
