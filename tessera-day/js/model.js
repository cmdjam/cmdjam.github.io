// Pure data helpers: dates, quanta, resampling, stats, validation. No DOM, so it runs in node tests.
// The data model is documented in ../CLAUDE.md.

export const QUANTA = [5, 10, 15, 30, 60];
export const LAYERS = ['plan', 'actual'];
export const DEFAULT_SETTINGS = { quantum: 15, weekStart: 1, theme: 'auto' };

export const STARTER = [
  ['Sleep', '#4A5A8C'], ['Work', '#1F6F6B'], ['Exercise', '#C7452F'],
  ['Family', '#D9A23B'], ['Leisure', '#7A5BA6'], ['Chores', '#8A7F72'],
];
export const PRESET_COLORS = [
  '#4A5A8C', '#1F6F6B', '#C7452F', '#D9A23B', '#7A5BA6', '#8A7F72',
  '#2F7FB8', '#3E8E4F', '#C2577F', '#E07B39', '#5B6675', '#9C6B3F',
];

export const slotsPerDay = q => 1440 / q;
export const emptyLayer = q => new Array(1440 / q).fill(null);

export function newId() {
  return Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-3);
}

export function starterData() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    categories: STARTER.map(([name, color], i) => ({ id: newId(), name, color, order: i + 1 })),
    days: {},
  };
}

// ---------- dates (local time, keys are YYYY-MM-DD) ----------

const pad = n => String(n).padStart(2, '0');
export const dateKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
export const isKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && dateKey(parseKey(k)) === k;
export const todayKey = (now = new Date()) => dateKey(now);
export function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); }
export function weekStartOf(k, weekStart) {
  const d = parseKey(k);
  d.setDate(d.getDate() - (d.getDay() - weekStart + 7) % 7);
  return dateKey(d);
}
export const daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();

// ---------- quanta ----------

export const nowSlot = (q, now = new Date()) => Math.floor((now.getHours() * 60 + now.getMinutes()) / q);
export function slotLabel(i, q) { const m = i * q; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
export const rangeLabel = (a, b, q) => slotLabel(a, q) + '–' + slotLabel(b + 1, q);

export function fmtDur(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

// Re-grid a layer from `from`-minute slots to `to`-minute slots via a per-minute view.
// Each new slot takes the value covering most of its minutes (null counts; ties go to the earliest).
export function resample(arr, from, to) {
  if (from === to) return arr.slice();
  const out = new Array(1440 / to);
  for (let s = 0; s < out.length; s++) {
    const counts = new Map();
    let best = null, bestN = 0;
    for (let m = s * to; m < (s + 1) * to; m++) {
      const v = arr[Math.floor(m / from)];
      const n = (counts.get(v) || 0) + 1;
      counts.set(v, n);
      if (n > bestN) { best = v; bestN = n; }
    }
    out[s] = best;
  }
  return out;
}

const sameArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export const isLossless = (arr, from, to) => sameArr(resample(resample(arr, from, to), to, from), arr);

// ---------- days ----------

export const isEmptyLayer = arr => !arr || arr.every(v => v == null);
export const isEmptyDay = day => !day || LAYERS.every(l => isEmptyLayer(day[l]));

export function convertDay(day, to) {
  return { q: to, plan: resample(day.plan, day.q, to), actual: resample(day.actual, day.q, to) };
}

// ---------- stats ----------

export function minutesByCat(arr, q, into = {}) {
  if (arr) for (const v of arr) if (v) into[v] = (into[v] || 0) + q;
  return into;
}
export const sumMinutes = totals => Object.values(totals).reduce((a, b) => a + b, 0);

// Plan vs actual: of the planned minutes, how many were spent as planned.
export function matchStats(day) {
  let planned = 0, matched = 0;
  if (day) day.plan.forEach((v, i) => { if (v) { planned += day.q; if (day.actual[i] === v) matched += day.q; } });
  return { planned, matched, pct: planned ? Math.round(100 * matched / planned) : null };
}

// ---------- validation (load / import) ----------

const HEX = /^#[0-9a-f]{6}$/i;

export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return starterData();
  const s = raw.settings || {};
  const settings = {
    quantum: QUANTA.includes(+s.quantum) ? +s.quantum : DEFAULT_SETTINGS.quantum,
    weekStart: +s.weekStart === 0 ? 0 : 1,
    theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto',
  };

  let categories;
  if (Array.isArray(raw.categories)) {
    const seen = new Set();
    categories = raw.categories
      .filter(c => c && typeof c.id === 'string' && c.id && !seen.has(c.id) && seen.add(c.id))
      .map((c, i) => ({
        id: c.id,
        name: String(c.name ?? '').trim().slice(0, 40) || 'Untitled',
        color: HEX.test(c.color) ? c.color.toUpperCase() : PRESET_COLORS[i % PRESET_COLORS.length],
        order: Number.isFinite(+c.order) ? +c.order : i + 1,
      }))
      .sort((a, b) => a.order - b.order)
      .map((c, i) => ({ ...c, order: i + 1 }));
  } else {
    categories = starterData().categories;
  }

  const ids = new Set(categories.map(c => c.id));
  const days = {};
  for (const [k, d] of Object.entries(raw.days && typeof raw.days === 'object' ? raw.days : {})) {
    if (!isKey(k) || !d || typeof d !== 'object') continue;
    let q = +d.q;
    if (!QUANTA.includes(q)) {
      const len = (Array.isArray(d.actual) ? d.actual : Array.isArray(d.plan) ? d.plan : []).length;
      q = QUANTA.find(x => 1440 / x === len);
      if (!q) continue;
    }
    const day = { q };
    for (const l of LAYERS) {
      const a = Array.isArray(d[l]) && d[l].length === 1440 / q ? d[l] : null;
      day[l] = a ? a.map(v => (ids.has(v) ? v : null)) : emptyLayer(q);
    }
    if (!isEmptyDay(day)) days[k] = day;
  }

  return { version: 1, settings, categories, days };
}
