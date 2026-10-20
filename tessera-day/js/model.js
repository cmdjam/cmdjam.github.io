// Pure data helpers: dates, quanta, resampling, stats, validation. No DOM, so it runs in node tests.
// The data model is documented in ../CLAUDE.md.

export const QUANTA = [5, 10, 15, 30, 60];
export const LAYERS = ['plan', 'actual'];
export const CLEAR = '';             // stored "nothing here": hides the baseline (plan) or the plan (actual)
export const RESTORE = '~baseline';  // painter tool that puts the baseline back (never a category id)
export const GHOST = '~ghost';       // stands in for a ghost tile while an actual is edited (never stored)
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
    version: 2,
    settings: { ...DEFAULT_SETTINGS },
    categories: STARTER.map(([name, color], i) => ({ id: newId(), name, color, order: i + 1 })),
    baselines: [],
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

export const isLossless = (arr, from, to) => sameArr(resample(resample(arr, from, to), to, from), arr);

// ---------- days ----------

export const isEmptyLayer = arr => !arr || arr.every(v => v == null);
export const sameArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export const isEmptyDay = day => !day || LAYERS.every(l => isEmptyLayer(day[l]));

export function convertDay(day, to) {
  return { q: to, plan: resample(day.plan, day.q, to), actual: resample(day.actual, day.q, to) };
}

// ---------- weekday baselines ----------
// baselines: [{ from: 'YYYY-MM-DD', q, days: [layer|null x 7] }], sorted by `from`, days indexed by
// JS weekday (0 = Sunday). A date uses the latest version whose `from` is on or before it, so
// editing a baseline creates a version from today and past days keep the plan they had.

export function baselineAt(baselines, key) {
  let found = null;
  for (const b of baselines) { if (b.from <= key) found = b; else break; }
  return found;
}

// A day's plan as shown: overrides on top of the baseline (both at the day's q; base may be null).
export const composePlan = (overrides, base) =>
  overrides.map((v, i) => (v === CLEAR ? null : v ?? (base ? base[i] : null)));

// The overrides that turn `base` into `effective`: null where they agree, CLEAR where a base tile was removed.
export const planOverrides = (effective, base) => effective.map((v, i) => {
  const b = base ? base[i] : null;
  return (v ?? null) === (b ?? null) ? null : v ?? CLEAR;
});

// ---------- actuals against the plan ----------
// A stored actual holds category ids (painted), CLEAR (erased: nothing happened, never refilled)
// and null (a gap). A day is tracked once anything is stored. When a tracked day has ended, its
// gaps fill from the plan; until then, gaps (and whole untracked days) only show the plan as a ghost.

export const isTracked = stored => !!stored && stored.some(v => v != null);

export function composeActual(stored, plan, ended) {
  const fill = ended && plan && isTracked(stored);
  return stored.map((v, i) => (v === CLEAR ? null : v ?? (fill ? plan[i] : null)));
}

// Plan tiles to show faintly where nothing real is recorded (null where there's no ghost).
export function ghostActual(stored, plan, ended) {
  if (!plan || (ended && isTracked(stored))) return null;
  return plan.map((p, i) => (stored && stored[i] != null ? null : p));
}

// What to store after an edit turned the shown actual `before` into `after`. Untouched tiles keep
// what was stored (so gaps stay gaps); changed tiles store the id, or CLEAR where a planned tile was emptied.
export const actualOverrides = (after, before, stored, plan) => after.map((v, i) =>
  v === before[i] ? stored[i] ?? null : v ?? (plan && plan[i] ? CLEAR : null));

// Baselines after setting weekday `wd` to `arr` (null clears it) from date `from` onwards, at
// tessera length q. Edits on the same date update that version; an edit that makes it match the
// version before is dropped. The edited version is re-gridded to q (older versions keep theirs).
export function withBaseline(baselines, from, wd, arr, q) {
  const list = baselines.map(b => ({ ...b, days: b.days.slice() }));
  const regrid = b => b.days.map(d => d && resample(d, b.q, q));
  let cur = baselineAt(list, from);
  if (!cur || cur.from !== from) {
    cur = { from, q, days: cur ? regrid(cur) : Array(7).fill(null) };
    list.push(cur);
    list.sort((a, b) => (a.from < b.from ? -1 : 1));
  } else if (cur.q !== q) {
    cur.days = regrid(cur);
    cur.q = q;
  }
  cur.days[wd] = isEmptyLayer(arr) ? null : resample(arr, 1440 / arr.length, cur.q);
  const i = list.indexOf(cur), prev = list[i - 1];
  const same = (a, b) => (a && b ? sameArr(a, b) : a === b);
  const redundant = prev ? prev.q === cur.q && cur.days.every((d, k) => same(d, prev.days[k])) : cur.days.every(d => !d);
  if (redundant) list.splice(i, 1);
  return list;
}

// ---------- stats ----------

export function minutesByCat(arr, q, into = {}) {
  if (arr) for (const v of arr) if (v) into[v] = (into[v] || 0) + q;
  return into;
}
export const sumMinutes = totals => Object.values(totals).reduce((a, b) => a + b, 0);

// Plan vs actual: of the planned minutes, how many were spent as planned. Arrays share tessera length q.
export function matchStats(plan, actual, q) {
  let planned = 0, matched = 0;
  if (plan) plan.forEach((v, i) => { if (v) { planned += q; if (actual && actual[i] === v) matched += q; } });
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
  const cleanLayer = (a, q, allowClear) =>
    Array.isArray(a) && a.length === 1440 / q ? a.map(v => (ids.has(v) || (allowClear && v === CLEAR) ? v : null)) : null;

  const byFrom = new Map();
  for (const b of Array.isArray(raw.baselines) ? raw.baselines : []) {
    if (!b || !isKey(b.from) || !QUANTA.includes(+b.q) || !Array.isArray(b.days)) continue;
    const days = Array.from({ length: 7 }, (_, wd) => {
      const a = cleanLayer(b.days[wd], +b.q, false);
      return a && !isEmptyLayer(a) ? a : null;
    });
    byFrom.set(b.from, { from: b.from, q: +b.q, days });   // a repeated date keeps the last one
  }
  const baselines = [...byFrom.values()].sort((a, b) => (a.from < b.from ? -1 : 1));

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
    for (const l of LAYERS) day[l] = cleanLayer(d[l], q, true) || emptyLayer(q);
    if (!isEmptyDay(day)) days[k] = day;
  }

  return { version: 2, settings, categories, baselines, days };
}
