// Persistence: one JSON document in localStorage, sanitised on load and import by normalize().
// Changing the shape means bumping KEY or migrating in normalize().
import { UNITS } from './rules.js';

export const KEY = 'umpire-v1';
export const COLOURS = ['#1F6F6B', '#C2410C', '#7C3AED', '#2563EB', '#B45309', '#BE185D', '#15803D', '#475569'];

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function empty() {
  return { children: [], rules: [], strikes: [] };
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const id = v => (typeof v === 'string' && v ? v.slice(0, 40) : uid());

function normExpiry(e) {
  if (!e || typeof e !== 'object') return null;
  const amount = Math.round(num(e.amount) || 0);
  if (amount < 1 || !UNITS.includes(e.unit)) return null;
  return { amount: Math.min(amount, 999), unit: e.unit };
}

function normCall(c) {
  if (!c || typeof c !== 'object') return null;
  const threshold = Math.round(num(c.threshold) || 0);
  if (threshold < 1) return null;
  const enforcements = (Array.isArray(c.enforcements) ? c.enforcements : [])
    .filter(e => e && num(e.at) !== null)
    .map(e => ({ at: e.at, note: str(e.note, 500) }))
    .sort((a, b) => a.at - b.at);
  return { id: id(c.id), threshold: Math.min(threshold, 999), consequence: str(c.consequence) || 'Consequence', enforcements };
}

// Sanitises loaded or imported data: drops anything malformed or orphaned, fills defaults.
export function normalize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const children = (Array.isArray(d.children) ? d.children : [])
    .filter(c => c && typeof c === 'object')
    .map((c, i) => ({
      id: id(c.id),
      name: str(c.name, 60) || 'Player',
      colour: typeof c.colour === 'string' && /^#[0-9a-f]{6}$/i.test(c.colour) ? c.colour : COLOURS[i % COLOURS.length],
      order: num(c.order) ?? i,
    }))
    .sort((a, b) => a.order - b.order);
  const childIds = new Set(children.map(c => c.id));
  const rules = (Array.isArray(d.rules) ? d.rules : [])
    .filter(r => r && typeof r === 'object' && childIds.has(r.childId))
    .map(r => ({
      id: id(r.id),
      childId: r.childId,
      name: str(r.name, 120) || 'Rule',
      expiry: normExpiry(r.expiry),
      calls: (Array.isArray(r.calls) ? r.calls : []).map(normCall).filter(Boolean),
      archived: r.archived === true,
      createdAt: num(r.createdAt) ?? Date.now(),
    }));
  const ruleIds = new Set(rules.map(r => r.id));
  const strikes = (Array.isArray(d.strikes) ? d.strikes : [])
    .filter(s => s && typeof s === 'object' && ruleIds.has(s.ruleId) && num(s.at) !== null)
    .map(s => ({ id: id(s.id), ruleId: s.ruleId, at: s.at, note: str(s.note, 500) }));
  return { children, rules, strikes };
}

export function load(storage = globalThis.localStorage) {
  try {
    const text = storage && storage.getItem(KEY);
    return text ? normalize(JSON.parse(text)) : empty();
  } catch {
    return empty();
  }
}

export function save(data, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
