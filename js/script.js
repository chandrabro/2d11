// Plain-text script  <->  scenes (speech, characters, movement, camera).
//
//   # Scene title | background name                 new scene (background optional: "Kitchen" or "vegetable_farm")
//   @time sunset · @weather rain · @camera zoom in · @filter sepia · @transition cut · @title Big title   (scene settings)
//   Narrator: voice-over text
//   Ram: a line spoken by the character called Ram
//   Sita (f, old): tags create a NEW character – gender f/m · age old/child/teen/tall · role king/minister/farmer/...
//   Ram [wave]: Hello!                              the action is played while he speaks (default: talk)
//   [Ram: walk to right]                            stage direction – happens now, the story waits until it is finished
//   [Ram: walk to Sita]  [Ram: sit for 4]  [Sita: face camera]
//   [+Sita: laugh]                                  "+" = at the same time as the next line (does not wait)
//   // comment

import { newScene, newActor, newAction, newDialog, newCharacter } from './state.js';
import { SCENES, getScene } from './engine/scenes/index.js';
import { estimateTtsDuration, CAMERA_PRESETS, TRANSITIONS, WEATHER, TODS } from './engine/renderer.js';
import { ACTIONS } from './engine/actions.js';
import { STAGE_H } from './engine/util.js';
import { roleAppearance, variantAppearance, isRoleWord } from './lookbook.js';

const NARR = /^(narrator|narration|voice[- ]?over|नरेटर|वाचक|सूत्रधार|कथावाचक|नैरेटर)$/i;
const AGES = { old: 'elder', elder: 'elder', elderly: 'elder', grandpa: 'elder', grandma: 'elder', child: 'child', kid: 'child', young: 'teen', teen: 'teen', teenager: 'teen', tall: 'tall' };
const GEN = { f: 'f', female: 'f', woman: 'f', girl: 'f', m: 'm', male: 'm', man: 'm', boy: 'm' };
const norm = (s) => String(s || '').trim().toLowerCase();
const r2 = (x) => Math.round(x * 100) / 100;

// ---------- words -> action ----------
const ACTION_ALIAS = {
  walk: 'walk', walks: 'walk', walking: 'walk', go: 'walk', goes: 'walk', move: 'walk', moves: 'walk', come: 'walk', comes: 'walk',
  run: 'run', runs: 'run', running: 'run', rush: 'run', rushes: 'run', sprint: 'run',
  stand: 'idle', stands: 'idle', wait: 'idle', waits: 'idle', stay: 'idle',
  sit: 'sit', sits: 'sit', sitting: 'sit', seated: 'sit',
  talk: 'talk', talks: 'talk', speak: 'talk', speaks: 'talk',
  laugh: 'laugh', laughs: 'laugh', laughing: 'laugh', smile: 'laugh', smiles: 'laugh',
  cry: 'cry', cries: 'cry', crying: 'cry', weep: 'cry', weeps: 'cry',
  angry: 'angry', angrily: 'angry', shout: 'angry', shouts: 'angry',
  scared: 'scared', frightened: 'scared', tremble: 'scared', trembles: 'scared',
  think: 'think', thinks: 'think', thinking: 'think', ponder: 'think', ponders: 'think',
  surprised: 'surprised', shocked: 'surprised', gasp: 'surprised', gasps: 'surprised',
  wave: 'wave', waves: 'wave', greet: 'wave', greets: 'wave',
  handshake: 'handshake', shakehands: 'handshake', hug: 'hug', hugs: 'hug', embrace: 'hug', embraces: 'hug',
  point: 'point', points: 'point', clap: 'clap', claps: 'clap', applaud: 'clap', applauds: 'clap',
  bow: 'bow', bows: 'bow', salute: 'salute', salutes: 'salute', namaste: 'namaste', kneel: 'kneel', kneels: 'kneel', pray: 'pray', prays: 'pray',
  cheer: 'cheer', cheers: 'cheer', jump: 'jump_joy', jumps: 'jump_joy', dance: 'dance', dances: 'dance',
  eat: 'eat', eats: 'eat', drink: 'drink', drinks: 'drink', read: 'read', reads: 'read', write: 'write', writes: 'write',
  sleep: 'sleep', sleeps: 'sleep', nod: 'nod', nods: 'nod', shrug: 'shrug', shrugs: 'shrug', sigh: 'sad_walk', sighs: 'sad_walk', sad: 'sad_walk',
  work: 'dig', dig: 'dig', digs: 'dig', plough: 'dig', cook: 'cook', cooks: 'cook', sweep: 'sweep', sweeps: 'sweep', chop: 'chop', chops: 'chop',
  fall: 'trip_fall', falls: 'trip_fall', trip: 'trip_fall', trips: 'trip_fall', climb: 'climb', climbs: 'climb', fight: 'fight_stance', whisper: 'whisper', whispers: 'whisper',
  look: 'look_around', looks: 'look_around', phone: 'phone_call', call: 'phone_call', calls: 'phone_call', kneeling: 'kneel', praying: 'pray',
};
const ACTION_IDS = new Set(ACTIONS.map((a) => a.id));
/** First action word found in the text -> action id, or null. */
export function actionFromWords(text) {
  const words = norm(text).replace(/[^\p{L}\p{N}\s_-]/gu, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const two = words[i] + '_' + (words[i + 1] || '');
    if (ACTION_IDS.has(two)) return two;
    const w = words[i];
    if (ACTION_ALIAS[w]) return ACTION_ALIAS[w];
    if (ACTION_IDS.has(w) && w !== 'idle') return w;
  }
  return null;
}
const OPTION = (list, q) => {                                           // match a typed value against [id,label] pairs
  const clean = (x) => norm(x).replace(/\bto\b/g, '').replace(/[^a-z0-9]+/g, '');
  const n = clean(q); if (!n) return null;
  const hit = list.find(([id, label]) => clean(id) === n || clean(label) === n) || list.find(([id, label]) => clean(label).includes(n));
  return hit ? hit[0] : null;
};
const CAMERAS = Object.entries(CAMERA_PRESETS).map(([k, v]) => [k, v.name]);
const FILTERS = [['none', 'None'], ['warm', 'Warm'], ['cool', 'Cool'], ['sepia', 'Sepia'], ['bw', 'Black & white'], ['dream', 'Dreamy'], ['dark', 'Dark']];

export function findBackground(q) {
  const n = norm(q); if (!n) return null;
  return SCENES.find((s) => s.id === n) || SCENES.find((s) => norm(s.name) === n) || SCENES.find((s) => norm(s.name).includes(n) || s.id.includes(n.replace(/\s+/g, '_'))) || null;
}

// ---------- parsing ----------
/** Blocks: [{ title, background, settings:{}, items:[{type:'say'|'dir', ...}] }] + warnings. */
export function parseScript(text) {
  const blocks = []; const warnings = []; let cur = null;
  const start = (title = '', bg = null) => { cur = { title, background: bg, settings: {}, items: [] }; blocks.push(cur); return cur; };
  String(text || '').replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim(); if (!line || line.startsWith('//')) return;
    if (line.startsWith('#')) {
      const [t, b] = line.replace(/^#+\s*/, '').split('|');
      const bg = b ? findBackground(b) : null; if (b && !bg) warnings.push(`Line ${i + 1}: background "${b.trim()}" not found – the previous one is used.`);
      start((t || '').trim(), bg); return;
    }
    if (!cur) start('');
    if (line.startsWith('@')) {
      const m = /^@(\w+)\s*(.*)$/.exec(line); if (!m) return;
      const key = m[1].toLowerCase(); const val = m[2].trim();
      const set = (k, list) => { const id = OPTION(list, val); if (id) cur.settings[k] = id; else warnings.push(`Line ${i + 1}: "${val}" is not a valid ${key}.`); };
      if (key === 'time' || key === 'tod') set('tod', TODS); else if (key === 'weather') set('weather', WEATHER); else if (key === 'camera') set('camera', CAMERAS);
      else if (key === 'filter') set('filter', FILTERS); else if (key === 'transition') set('transition', TRANSITIONS); else if (key === 'title') cur.settings.title = val;
      else warnings.push(`Line ${i + 1}: unknown setting @${key}.`);
      return;
    }
    if (line.startsWith('[')) {                                         // stage direction
      const m = /^\[\s*(\+?)\s*(.+?)\s*\]$/.exec(line); if (!m) { warnings.push(`Line ${i + 1}: stage direction needs a closing ].`); return; }
      cur.items.push({ type: 'dir', parallel: !!m[1], text: m[2] }); return;
    }
    const m = /^([^:：]{1,60}?)\s*[:：]\s*(.+)$/.exec(line);
    if (!m) { cur.items.push({ type: 'say', who: 'narrator', text: line }); return; }
    let name = m[1].trim(); let gender = null, age = null, role = null, action = null;
    const am = /\s*\[([^\]]*)\]\s*$/.exec(name); if (am) { action = actionFromWords(am[1]) || null; if (!action) warnings.push(`Line ${i + 1}: action "${am[1]}" not understood.`); name = name.replace(am[0], '').trim(); }
    const g = /\s*\(([^)]*)\)\s*$/.exec(name);
    if (g) {
      for (const tag of g[1].split(/[,/;]|\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
        if (GEN[tag]) gender = GEN[tag];
        if (AGES[tag]) age = AGES[tag];
        if ((tag === 'girl' || tag === 'boy') && !age) age = 'child';
        if (!AGES[tag] && !GEN[tag] && isRoleWord(tag)) role = tag;
      }
      name = name.replace(g[0], '').trim();
    }
    cur.items.push({ type: 'say', who: NARR.test(name) ? 'narrator' : name, gender, age, role, action, text: m[2].trim() });
  });
  return { blocks: blocks.filter((b) => b.items.length || Object.keys(b.settings).length), warnings };
}

// ---------- building ----------
export function buildScenes(project, parsed, { createCharacters = true } = {}) {
  const warnings = [...parsed.warnings]; const created = [];
  const findChar = (name) => { const n = norm(name); if (!n) return null; return project.characters.find((c) => norm(c.name) === n) || project.characters.find((c) => norm(c.name).startsWith(n) || n.startsWith(norm(c.name))) || project.characters.find((c) => norm(c.name).includes(n)) || null; };
  const out = [];
  let bg = project.scenes.length ? project.scenes[project.scenes.length - 1].background : 'living_room';

  parsed.blocks.forEach((b, bi) => {
    if (b.background) bg = b.background.id;
    const sc = newScene(bg, { name: b.title || `Scene ${project.scenes.length + out.length + 1}`, transition: out.length || project.scenes.length ? 'fade' : 'cut' });
    const def = getScene(bg); const y = Math.round((def.groundY * STAGE_H + def.horizonY * STAGE_H) / 2 + 40);
    const S = b.settings;
    if (S.tod) sc.tod = S.tod; if (S.weather) sc.weather = S.weather; if (S.filter) sc.filter = S.filter; if (S.transition) sc.transition = S.transition;
    if (S.camera) { const c = CAMERA_PRESETS[S.camera]; sc.camera = { preset: S.camera, start: { ...c.start }, end: { ...c.end }, shake: c.shake || 0 }; }

    // 1) who is on stage (speakers + names in stage directions), max 3
    const slot = new Map(); const order = [];
    const ensureChar = (name, info) => {
      let ch = findChar(name);
      if (!ch && createCharacters && info) {
        let fem = info.gender === 'f';
        const ra = info.role ? roleAppearance(info.role, fem) : null;
        ch = newCharacter(info.age === 'elder' ? (fem ? 'grandma' : 'grandpa') : info.age === 'child' ? (fem ? 'girl_kid' : 'boy_kid') : fem ? 'custom_female' : 'custom_male', name);
        if (ra) { ch.appearance = ra; ch.appearance.name = name; if (ra.gender === 'female') fem = true; }
        else if (!info.age || info.age === 'teen' || info.age === 'tall') ch.appearance = variantAppearance(ch.appearance, name, project.characters.length);
        else { const v = variantAppearance(ch.appearance, name, project.characters.length); ch.appearance.skin = v.skin; ch.appearance.outfit.topColor = v.outfit.topColor; ch.appearance.outfit.bottomColor = v.outfit.bottomColor; }
        if (info.age && info.age !== 'child') ch.appearance.build = info.age;
        project.characters.push(ch); created.push(ch.name);
      } else if (ch && info && info.age && ch.appearance) ch.appearance.build = info.age;      // an age tag on an existing character updates it
      return ch;
    };
    const stageIndex = (ch) => {
      if (slot.has(ch.id)) return slot.get(ch.id);
      if (slot.size >= 3) return -2;
      slot.set(ch.id, slot.size); order.push(ch.id); return slot.get(ch.id);
    };
    const scriptNames = new Set(b.items.filter((x) => x.type === 'say' && x.who !== 'narrator').map((x) => x.who));
    const resolveDir = (text) => {                                    // "Ram: walk to right" / "Coach Dev sits"
      const colon = /^([^:：]{1,60})[:：]\s*(.*)$/.exec(text);
      if (colon) return { name: colon[1].trim(), rest: colon[2] };
      const low = norm(text); let best = '';
      for (const n of [...scriptNames, ...project.characters.map((c) => c.name)]) if (low.startsWith(norm(n)) && norm(n).length > best.length) best = n;
      return best ? { name: best, rest: text.slice(best.length).trim() } : { name: text.split(/\s+/)[0], rest: text.split(/\s+/).slice(1).join(' ') };
    };
    for (const it of b.items) if (it.type === 'say' && it.who !== 'narrator') ensureChar(it.who, it);     // create characters first, so a stage direction may come before their first line
    const lines = [];       // resolved items
    for (const it of b.items) {
      if (it.type === 'say') {
        if (it.who === 'narrator') { lines.push({ ...it, actor: -1 }); continue; }
        const ch = ensureChar(it.who, it);
        if (!ch) { warnings.push(`Scene ${bi + 1}: no character called "${it.who}" – line skipped.`); continue; }
        const idx = stageIndex(ch);
        if (idx === -2) { warnings.push(`Scene ${bi + 1}: more than 3 characters – "${it.who}" skipped (split the scene with a # line).`); continue; }
        lines.push({ ...it, actor: idx });
      } else {
        const { name, rest } = resolveDir(it.text);
        const ch = ensureChar(name, null);
        if (!ch) { warnings.push(`Scene ${bi + 1}: stage direction for unknown "${name}" skipped.`); continue; }
        const idx = stageIndex(ch);
        if (idx === -2) { warnings.push(`Scene ${bi + 1}: more than 3 characters – direction for "${name}" skipped.`); continue; }
        lines.push({ ...it, actor: idx, rest });
      }
    }
    // 2) actors
    const n = slot.size; const xs = n === 1 ? [640] : n === 2 ? [420, 860] : [300, 640, 980];
    order.forEach((id, k) => {
      const a = newActor(id, xs[k], y); a.facing = k < n / 2 ? 1 : -1;
      if (project.faceCamera) a.orientation = 'front';
      sc.actors.push(a);
    });
    const curX = sc.actors.map((a) => a.x);
    const nameOf = (i) => { const c = project.characters.find((x) => x.id === sc.actors[i].characterId); return c ? c.name : ''; };
    const busy = (a, s, e) => a.actions.some((g) => g.start < e - 0.05 && (g.end ?? g.start + 2) > s + 0.05);

    // 3) timeline
    let t = 0.3;
    for (const it of lines) {
      if (it.type === 'say') {
        const d = newDialog(it.actor, it.text, r2(t));
        sc.dialogs.push(d);
        if (it.actor >= 0) {
          const a = sc.actors[it.actor]; const end = r2(d.start + d.duration);
          const seg = newAction(it.action || 'talk', d.start, end);
          if (it.action === 'walk' || it.action === 'run') { seg.toX = curX[it.actor]; }
          if (!busy(a, d.start, end) || it.action) a.actions.push(seg);
        }
        t = d.start + d.duration + 0.5;
      } else {
        const a = sc.actors[it.actor]; const rest = it.rest || '';
        const action = actionFromWords(rest) || (/(face|faces|facing|turn)/i.test(rest) ? 'idle' : null);
        const low = norm(rest);
        let dur = (low.match(/for\s+(\d+(?:\.\d+)?)/) || [])[1]; dur = dur ? parseFloat(dur) : null;
        let toX = null;
        const tm = /\b(?:to|towards?|near|beside|next to)\s+(.+?)(?:\s+for\s+\d.*)?$/.exec(low);
        if (tm) {
          const w = tm[1].trim();
          if (/^(left|far left)$/.test(w)) toX = /far/.test(w) ? 160 : 260; else if (/^(right|far right)$/.test(w)) toX = /far/.test(w) ? 1120 : 1020; else if (/^(center|centre|middle|centre stage)$/.test(w)) toX = 640;
          else if (/^\d+$/.test(w)) toX = Math.max(60, Math.min(1220, parseInt(w, 10)));
          else { const tc = findChar(w.replace(/\s+for.*$/, '')); const ti = tc ? sc.actors.findIndex((x) => x.characterId === tc.id) : -1; if (ti >= 0 && ti !== it.actor) toX = curX[ti] + (curX[ti] > curX[it.actor] ? -150 : 150); else warnings.push(`Scene ${bi + 1}: "${w}" is not a position or a character on stage.`); }
        }
        const moving = toX != null && Math.abs(toX - curX[it.actor]) > 8;
        const id = action && action !== 'idle' ? action : moving ? 'walk' : action;
        if (!id) { warnings.push(`Scene ${bi + 1}: action not understood in "[${it.text}]".`); continue; }
        const speed = id === 'run' ? 330 : 190;
        if (dur == null) dur = moving && (id === 'walk' || id === 'run') ? Math.max(1.2, Math.abs(toX - curX[it.actor]) / speed) : id === 'idle' ? 1 : 2.2;
        dur = r2(dur);
        const seg = newAction(id, r2(t), r2(t + dur));
        if (toX != null && (id === 'walk' || id === 'run' || id === 'sneak' || id === 'sad_walk')) { seg.toX = Math.round(toX); curX[it.actor] = seg.toX; }
        if (/\b(camera|front|audience)\b/.test(low)) seg.orientation = 'front'; else if (/\bface\w*\s+left|\bleft\b.*\bface/.test(low) && toX == null) seg.facing = -1; else if (/\bface\w*\s+right/.test(low) && toX == null) seg.facing = 1;
        // an action that starts while another of the same actor runs replaces the overlap
        a.actions = a.actions.filter((g) => !(g.action === 'talk' && g.start >= seg.start - 0.05 && (g.end ?? g.start + 2) <= seg.end + 0.05 && !it.parallel));
        a.actions.push(seg);
        if (!it.parallel) t += dur + 0.2;
      }
    }
    for (const a of sc.actors) a.actions.sort((p, q) => p.start - q.start);
    const last = Math.max(t, ...sc.dialogs.map((d) => d.start + d.duration), ...sc.actors.flatMap((a) => a.actions.map((g) => g.end || 0)));
    sc.duration = Math.max(5, Math.ceil(last + 0.8));
    if (S.title) sc.captions.push({ id: 'cp' + Math.random().toString(36).slice(2, 8), text: S.title, start: 0.2, end: Math.min(sc.duration, 3.5), style: 'title', position: 'center', size: 0.1, color: '#ffffff', font: 'display' });
    out.push(sc);
  });
  project.scenes.push(...out);
  return { scenes: out.length, characters: created, warnings };
}

/** The current story as a readable script: speech, scene settings and movement (walks / actions) as stage directions. */
export function projectToScript(project) {
  const lines = [];
  for (const s of project.scenes) {
    lines.push(`# ${s.name || 'Scene'} | ${getScene(s.background).name}`);
    const nm = (a) => { const c = project.characters.find((x) => x.id === a.characterId); return c ? c.name : 'Unknown'; };
    const ev = [];
    for (const d of s.dialogs) if (String(d.text || '').trim()) ev.push({ t: d.start, line: `${d.actor >= 0 && s.actors[d.actor] ? nm(s.actors[d.actor]) : 'Narrator'}: ${String(d.text).trim()}`, order: 1 });
    for (const a of s.actors) for (const g of a.actions) {
      if (['talk', 'idle', 'sit_talk'].includes(g.action)) continue;
      const pos = g.toX != null ? (g.toX < 420 ? ' to left' : g.toX > 860 ? ' to right' : ' to center') : '';
      ev.push({ t: g.start, line: `[+${nm(a)}: ${g.action.replace(/_/g, ' ')}${pos}${g.end ? ' for ' + r2(g.end - g.start) : ''}]`, order: 0 });
    }
    ev.sort((p, q) => p.t - q.t || p.order - q.order).forEach((e) => lines.push(e.line));
    lines.push('');
  }
  return lines.join('\n');
}
