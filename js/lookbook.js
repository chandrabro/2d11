// Gives script / auto-created characters their OWN look (so they are not all the same blue-shirt person),
// understands role words in script tags ("Akbar (m, king)") and can repair look-alike characters.

import { PRESETS, presetAppearance } from './engine/presets.js';

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const SKINS = ['#f0c29b', '#e0ac7e', '#c98e5f', '#b17446', '#8d5a34'];
const HAIR = ['#141414', '#2b1b0e', '#4a2c17', '#7a4a21'];
const TOPS_M = ['#3498db', '#c0392b', '#27ae60', '#8e44ad', '#e67e22', '#16a085', '#2c3e50', '#d35400', '#7f8c8d', '#f1c40f'];
const TOPS_F = ['#e91e63', '#9c27b0', '#009688', '#ff7043', '#3f51b5', '#c62828', '#00897b', '#f06292'];
const BOTTOMS = ['#2c3e50', '#37474f', '#5d4037', '#1a237e', '#263238', '#4e342e'];
const STYLES_M = ['short', 'side_part', 'spiky', 'buzz', 'curly'];
const STYLES_F = ['long', 'bun', 'braid', 'ponytail', 'bob'];

/** Role word -> preset id + changes. Any preset id / name is also accepted as a role word. */
const ROLES = {
  king: { m: 'king', patch: { facialHair: 'goatee', hair: { style: 'short', color: '#141414' }, outfit: { top: 'robe', topColor: '#f3e3b8', trimColor: '#d4af37', bottomColor: '#f3e3b8', hat: 'turban', hatColor: '#a31515', accessories: ['necklace', 'medal'] } } },
  queen: { f: 'queen' },
  minister: { m: 'groom', patch: { facialHair: 'mustache', outfit: { top: 'kurta', topColor: '#f5eedc', trimColor: '#c9a227', bottomColor: '#f5eedc', hat: 'turban', hatColor: '#e65100', scarfColor: '#e65100' } } },
  merchant: { m: 'shopkeeper', patch: { weight: 'heavy', facialHair: 'mustache', outfit: { top: 'robe', topColor: '#1b7a43', trimColor: '#d4af37', bottomColor: '#14532d', shoes: 'formal', hat: 'turban', hatColor: '#1b7a43', accessories: ['necklace', 'medal'] } } },
  farmer: { m: 'nepali_farmer', f: 'nepali_woman' },
  worker: { m: 'indian_farmer', patch: { outfit: { top: 'kurta', topColor: '#a1887f', trimColor: '#6d4c41', bottomColor: '#d7ccc8' } }, f: 'indian_farmer_woman' },
  police: { m: 'nepali_police', f: 'nepali_policewoman' },
  teacher: { m: 'scientist', f: 'teacher' },
  student: { m: 'student_boy', f: 'student_girl' },
};
const ALIAS = { raja: 'king', emperor: 'king', badshah: 'king', sultan: 'king', rani: 'queen', advisor: 'minister', courtier: 'minister', wazir: 'minister', mantri: 'minister', seth: 'merchant', rich: 'merchant', trader: 'merchant', businessman: 'merchant', kisan: 'farmer', villager: 'farmer', labourer: 'worker', laborer: 'worker', majdur: 'worker', policeman: 'police', policewoman: 'police', guard: 'soldier' };

export function isRoleWord(w) { const k = ALIAS[w] || w; return !!ROLES[k] || PRESETS.some((p) => p.id === k); }

const merge = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') merge(a[k], v); else a[k] = clone(v); } return a; };

/** Appearance for a role word (or null when unknown). */
export function roleAppearance(word, female) {
  const k = ALIAS[word] || word; const r = ROLES[k];
  if (r) {
    const id = female ? (r.f || r.m) : (r.m || r.f); const a = presetAppearance(id);
    if (r.patch && (!female || !r.f)) merge(a, r.patch);
    return a;
  }
  const p = PRESETS.find((x) => x.id === k); return p ? presetAppearance(p.id) : null;
}

/** A distinct everyday look from the name + position (skin, hair, clothes colours). */
export function variantAppearance(base, name, index = 0) {
  const a = clone(base); const h = (hash(name) + index * 7919) >>> 0; const fem = a.gender === 'female';
  a.skin = SKINS[h % SKINS.length];
  a.hair = { ...(a.hair || {}), style: (fem ? STYLES_F : STYLES_M)[(h >>> 3) % 5], color: HAIR[(h >>> 5) % HAIR.length] };
  const o = (a.outfit ||= {});
  o.topColor = (fem ? TOPS_F : TOPS_M)[(h + index * 3) % (fem ? TOPS_F : TOPS_M).length];
  o.bottomColor = BOTTOMS[(h >>> 7) % BOTTOMS.length];
  if (!fem) { a.facialHair = ['none', 'mustache', 'stubble', 'none', 'beard'][(h >>> 9) % 5]; o.top = ['tshirt', 'shirt', 'hoodie', 'shirt'][(h >>> 11) % 4]; o.sleeves = o.top === 'tshirt' ? 'short' : 'long'; }
  a.glasses = (h >>> 13) % 5 === 0 ? 'glasses' : 'none';
  return a;
}

/** Characters that look exactly the same get new looks. Returns how many were changed. */
export function diversify(project) {
  const seen = new Map(); let n = 0;
  project.characters.forEach((c, i) => {
    const { name, ...rest } = c.appearance || {}; const key = JSON.stringify(rest);
    if (seen.has(key)) { const keepBuild = c.appearance.build; c.appearance = variantAppearance(c.appearance, c.name, i); c.appearance.build = keepBuild; n++; } else seen.set(key, c.id);
  });
  return n;
}
