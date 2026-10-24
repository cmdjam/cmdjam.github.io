// App controller: state, routing, top bar, saving. Views live in ./views/.
import * as M from './model.js';
import * as store from './store.js';
import { $, $$, tint, toast } from './ui.js';
import { openSettings } from './settings.js';
import { renderDay } from './views/day.js';
import { renderWeek, weekKeys } from './views/week.js';
import { renderMosaic } from './views/mosaic.js';
import { renderBaseline, weekdayName } from './views/baseline.js';

const fmt = (k, o) => M.parseKey(k).toLocaleDateString(undefined, o);
const thisYear = k => M.parseKey(k).getFullYear() === new Date().getFullYear();

// Each view: render(app, root), its top-bar text, how far prev/next move, and whether it shows today.
const VIEWS = {
  day: {
    render: renderDay,
    head: k => ({
      eyebrow: k === M.todayKey() ? 'Today' : fmt(k, { weekday: 'long' }),
      title: fmt(k, { weekday: 'short', day: 'numeric', month: 'short', ...(thisYear(k) ? {} : { year: 'numeric' }) }),
    }),
    step: (k, dir) => M.addDays(k, dir),
    hasToday: k => k === M.todayKey(),
  },
  week: {
    render: renderWeek,
    head: () => {
      const keys = weekKeys(app), b = keys[6];
      const f = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', ...(thisYear(b) ? {} : { year: 'numeric' }) });
      return { eyebrow: 'Week', title: f.formatRange(M.parseKey(keys[0]), M.parseKey(b)) }; // e.g. "Oct 12 – 18"
    },
    step: (k, dir) => M.addDays(k, 7 * dir),
    hasToday: () => weekKeys(app).includes(M.todayKey()),
  },
  mosaic: {
    render: renderMosaic,
    head: k => app.ui.scope === 'year'
      ? { eyebrow: 'Mosaic · Year', title: k.slice(0, 4) }
      : { eyebrow: 'Mosaic · Month', title: fmt(k, { month: 'long', year: 'numeric' }) },
    step: (k, dir) => {
      const d = M.parseKey(k);
      return M.dateKey(app.ui.scope === 'year' ? new Date(d.getFullYear() + dir, 0, 1) : new Date(d.getFullYear(), d.getMonth() + dir, 1));
    },
    hasToday: k => M.todayKey().slice(0, app.ui.scope === 'year' ? 4 : 7) === k.slice(0, app.ui.scope === 'year' ? 4 : 7),
    // URL argument: 2026-10 for a month, 2026 for a year.
    arg: k => k.slice(0, app.ui.scope === 'year' ? 4 : 7),
  },
  // The weekday baseline editor works on a weekday (0 = Sunday), not a date: #/baseline/1.
  baseline: {
    render: renderBaseline,
    head: () => ({ eyebrow: 'Baseline', title: weekdayName(app.ui.wd) }),
    cur: () => app.ui.wd,
    step: (wd, dir) => (wd + dir + 7) % 7,
    today: () => new Date().getDay(),
    hasToday: () => app.ui.wd === new Date().getDay(),
  },
};
const UI_KEY = 'tessera-day-ui-v1';
// The theme setting is mirrored here so index.html can apply it before the data loads.
const THEME_KEY = 'tessera-day-theme';
const darkMQ = matchMedia('(prefers-color-scheme: dark)');

export const app = {
  data: M.starterData(),
  // planEdit: the date whose plan is unlocked for per-day changes ("Change this day's plan"), else null.
  ui: { view: 'day', date: M.todayKey(), layer: 'actual', cat: null, scope: 'month', wd: new Date().getDay(), planEdit: null },
  dark: false,
  colors: new Map(),
  // Undo stack: { key, prev } with the day record before the change (or null),
  // or { baselines } with the baseline list before a baseline edit.
  history: [],
  baseCache: new Map(),   // resampled baseline layers; cleared whenever baselines change

  get settings() { return this.data.settings; },
  cat(id) { return this.data.categories.find(c => c.id === id) || null; },
  color(id) { return this.colors.get(id) || 'transparent'; },
  day(key) { return this.data.days[key] || null; },
  dayQ(key) { return this.day(key)?.q ?? this.settings.quantum; },

  // The weekday baseline in force on `key`, resampled to tessera length q (null if there is none).
  basePlan(key, q = this.dayQ(key)) {
    const b = M.baselineAt(this.data.baselines, key), wd = M.parseKey(key).getDay(), arr = b?.days[wd];
    if (!arr) return null;
    const ck = `${b.from}|${wd}|${q}`;
    if (!this.baseCache.has(ck)) this.baseCache.set(ck, M.resample(arr, b.q, q));
    return this.baseCache.get(ck);
  },
  // A layer as shown. The plan is the day's variations on top of its baseline. The actual is what
  // was recorded, with gaps filled from the plan once a tracked day has ended (see composeActual).
  layer(key, layer) {
    const day = this.day(key), q = this.dayQ(key);
    const plan = M.composePlan(day?.plan ?? M.emptyLayer(q), this.basePlan(key, q));
    if (layer === 'plan') return plan;
    return M.composeActual(day?.actual ?? M.emptyLayer(q), plan, key < M.todayKey());
  },
  planIfAny(key) {
    const p = this.layer(key, 'plan');
    return p.some(Boolean) ? p : null;
  },
  // Plan tiles to show faintly on the actual layer where nothing real is recorded, or null.
  ghost(key) {
    return M.ghostActual(this.day(key)?.actual, this.planIfAny(key), key < M.todayKey());
  },
  // The actual as the painter edits it: ghost tiles are M.GHOST, so erasing one is a change.
  actualForEdit(key) {
    const a = this.layer(key, 'actual'), g = this.ghost(key);
    return g ? a.map((v, i) => (g[i] ? M.GHOST : v)) : a;
  },
  // Like layer(), but null when there's nothing to draw (lets canvas views skip empty days).
  layerIfAny(key, layer) {
    if (!this.day(key) && (layer === 'actual' || !this.basePlan(key))) return null;
    return this.layer(key, layer);
  },

  // arr is the layer as shown; plan edits are stored as variations from the baseline.
  setLayer(key, layer, arr) {
    const q = 1440 / arr.length;
    const day = this.day(key) ? { ...this.day(key) } : { q, plan: M.emptyLayer(q), actual: M.emptyLayer(q) };
    day[layer] = layer === 'plan'
      ? M.planOverrides(arr, this.basePlan(key, q))
      : M.actualOverrides(arr, this.actualForEdit(key), day.actual, this.planIfAny(key)); // arr is from the painter
    this.putDay(key, day);
  },
  // "Went as planned": record the plan wherever nothing is recorded yet.
  wentAsPlanned(key) {
    const plan = this.planIfAny(key);
    if (!plan) return;
    const q = 1440 / plan.length, day = this.day(key) || { q, plan: M.emptyLayer(q), actual: M.emptyLayer(q) };
    this.putDay(key, { ...day, actual: day.actual.map((v, i) => v ?? plan[i] ?? null) });
  },
  // Forget everything recorded for the day; it goes back to showing the plan as a ghost.
  untrack(key) {
    const day = this.day(key);
    if (day) this.putDay(key, { ...day, actual: M.emptyLayer(day.q) });
  },
  resetPlan(key) {
    const day = this.day(key);
    if (day) this.putDay(key, { ...day, plan: M.emptyLayer(day.q) });
  },
  // Weekday baseline edits apply from today on; past days keep the version they had.
  setBaseline(wd, arr) {
    this.pushHistory({ baselines: this.data.baselines });
    this.data.baselines = M.withBaseline(this.data.baselines, M.todayKey(), wd, arr, this.settings.quantum);
    this.baselinesChanged();
  },
  baselinesChanged() {
    this.baseCache.clear();
    this.saveMeta();
    this.render();
  },
  pushHistory(h) {
    this.history.push(h);
    if (this.history.length > 100) this.history.shift();
  },
  putDay(key, day, { undoable = true } = {}) {
    if (undoable) this.pushHistory({ key, prev: this.data.days[key] || null });
    if (M.isEmptyDay(day)) delete this.data.days[key];
    else this.data.days[key] = day;
    store.saveDay(key, this.data.days[key] || null);
    this.render();
  },
  undo() {
    const h = this.history.pop();
    if (!h) return;
    if (h.baselines) {
      this.data.baselines = h.baselines;
      this.baselinesChanged();
    } else {
      this.putDay(h.key, h.prev || {}, { undoable: false });
      if (this.ui.view === 'day' && h.key !== this.ui.date) this.go('day', h.key);
    }
    toast('Undone');
  },
  convertDay(key, q) {
    this.putDay(key, M.convertDay(this.day(key), q));
  },
  replaceData(data) {
    this.data = data;
    this.history = [];
    this.baseCache.clear();
    if (!this.cat(this.ui.cat)) this.ui.cat = data.categories[0]?.id ?? null;
    store.saveAll(data);
    this.saveUi();
    this.render();
  },

  deleteCategory(id) {
    this.data.categories = this.data.categories.filter(c => c.id !== id);
    this.data.categories.forEach((c, i) => { c.order = i + 1; });
    for (const [key, day] of Object.entries(this.data.days)) {
      if (!M.LAYERS.some(l => day[l].includes(id))) continue;
      // Cleared, not handed back to the baseline or plan.
      day.actual = day.actual.map(v => (v === id ? M.CLEAR : v));
      day.plan = day.plan.map(v => (v === id ? M.CLEAR : v));
      if (M.isEmptyDay(day)) delete this.data.days[key];
    }
    this.data.baselines = this.data.baselines
      // Keep versions even if they end up empty: an empty version still means "no baseline from here on".
      .map(b => ({ ...b, days: b.days.map(a => (a && a.includes(id) ? a.map(v => (v === id ? null : v)) : a)).map(a => (M.isEmptyLayer(a) ? null : a)) }));
    this.baseCache.clear();
    this.history = []; // older snapshots may still reference the deleted id
    store.saveAll(this.data);
    this.render();
  },

  saveMeta() { store.saveMeta(this.data); },
  saveUi() {
    const { cat, layer, scope } = this.ui;
    try { localStorage.setItem(UI_KEY, JSON.stringify({ cat, layer, scope })); } catch { /* private mode */ }
  },

  refreshColors() {
    this.dark = this.settings.theme === 'dark' || (this.settings.theme === 'auto' && darkMQ.matches);
    this.colors = new Map(this.data.categories.map(c => [c.id, tint(c.color, this.dark)]));
  },

  go(view, key) { location.hash = `#/${view}/${VIEWS[view].arg?.(key) ?? key}`; },

  render() {
    const { ui } = this;
    document.documentElement.dataset.theme = this.settings.theme === 'auto' ? '' : this.settings.theme;
    try { if (localStorage.getItem(THEME_KEY) !== this.settings.theme) localStorage.setItem(THEME_KEY, this.settings.theme); } catch { /* private mode */ }
    this.refreshColors();
    $('meta[name="theme-color"]').content = this.dark ? '#12161C' : '#ECEFF3';
    // The restore brush paints the plan back onto actuals, or the baseline onto a plan being changed.
    if (ui.planEdit && (ui.view !== 'day' || ui.planEdit !== ui.date)) ui.planEdit = null;
    const restoreOk = ui.view === 'day' && (ui.layer !== 'plan' || ui.planEdit === ui.date);
    if (ui.cat === M.RESTORE ? !restoreOk : ui.cat !== null && !this.cat(ui.cat)) ui.cat = this.data.categories[0]?.id ?? null;

    const view = VIEWS[ui.view], head = view.head(ui.date);
    $('#eyebrow').textContent = 'Tessera Day · ' + head.eyebrow;
    $('#title').textContent = head.title;
    document.title = `${head.title} · Tessera Day`;
    $('#today').disabled = view.hasToday(ui.date);
    $$('#tabs [data-view]').forEach(a => a.classList.toggle('on', a.dataset.view === ui.view));

    view.render(this, $('#view'));
  },
};

// ---------- routing: #/day/2026-10-16, #/week/2026-10-16, #/mosaic/2026-10, #/mosaic/2026 ----------

function route() {
  const [, view, arg = ''] = location.hash.split('/');
  const { ui } = app;
  ui.view = VIEWS[view] ? view : 'day';
  if (ui.view === 'baseline') {
    ui.wd = /^[0-6]$/.test(arg) ? +arg : new Date().getDay();
  } else if (ui.view === 'mosaic') {
    // Keep the focused date when it's inside the requested period, else use the period's first day.
    const m = arg.match(/^(\d{4})(?:-(\d{2}))?$/);
    if (m) {
      ui.scope = m[2] ? 'month' : 'year';
      const start = m[2] ? `${m[1]}-${m[2]}-01` : `${m[1]}-01-01`;
      if (M.isKey(start) && !ui.date.startsWith(arg)) ui.date = start;
    }
  } else {
    ui.date = M.isKey(arg) ? arg : M.todayKey();
  }
  app.render();
}

function step(dir) {
  const v = VIEWS[app.ui.view];
  app.go(app.ui.view, v.step(v.cur ? v.cur() : app.ui.date, dir));
}

$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);
$('#today').onclick = () => app.go(app.ui.view, VIEWS[app.ui.view].today?.() ?? M.todayKey());
$('#settingsBtn').onclick = () => openSettings(app);
$('#tabs').addEventListener('click', e => {
  const a = e.target.closest('[data-view]');
  if (!a) return;
  e.preventDefault();
  app.go(a.dataset.view, app.ui.date);
});
// Links to the baseline editor anywhere in the page (data-baseline="<weekday>").
document.addEventListener('click', e => {
  const a = e.target.closest('[data-baseline]');
  if (!a) return;
  e.preventDefault();
  a.closest('dialog')?.close();
  app.go('baseline', a.dataset.baseline || new Date().getDay());
});

darkMQ.addEventListener('change', () => app.render());
// Canvas views size themselves from the layout, so redraw them when it changes.
let resizeTimer, lastW = innerWidth;
addEventListener('resize', () => {
  if (innerWidth === lastW) return; // ignore mobile URL-bar height changes
  lastW = innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (app.ui.view !== 'day') app.render(); }, 150);
});
addEventListener('hashchange', route);

// Keyboard: 1-9 pick a category, 0 the eraser, B the baseline brush (plan), P/A/C the layer,
// arrows step, T today, Ctrl/Cmd+Z undo.
addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select, dialog[open]')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); return app.undo(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[1-9]$/.test(k) && app.data.categories[k - 1]) app.ui.cat = app.data.categories[k - 1].id;
  else if (k === '0') app.ui.cat = null;
  else if (k === 'b' && app.ui.view === 'day') app.ui.cat = M.RESTORE; // render() drops it where it doesn't apply
  else if (k === 'p' || k === 'a' || k === 'c') app.ui.layer = { p: 'plan', a: 'actual', c: 'compare' }[k];
  else if (k === 'arrowleft') return step(-1);
  else if (k === 'arrowright') return step(1);
  else if (k === 't') return $('#today').click();
  else return;
  app.saveUi();
  app.render();
});

store.onWriteError(e => toast('Could not save: ' + (e?.message || e)));
const loaded = await store.load();
app.data = loaded.data;
if (loaded.memoryOnly) toast('Storage is unavailable, so changes will not be saved. Use Export to keep them.');
else store.requestPersistence();

let saved = {};
try { saved = JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { /* ignore */ }
app.ui.cat = saved.cat === null || saved.cat === M.RESTORE || app.cat(saved.cat) ? saved.cat : app.data.categories[0]?.id ?? null;
if (['plan', 'actual', 'compare'].includes(saved.layer)) app.ui.layer = saved.layer;
if (saved.scope === 'year') app.ui.scope = 'year';
route();

// Offline support (needs http(s); ES modules don't load from file:// anyway).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered', e));
}
