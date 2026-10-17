// App controller: state, routing, top bar, saving. Views live in ./views/.
import * as M from './model.js';
import * as store from './store.js';
import { $, $$, tint, toast } from './ui.js';
import { openSettings } from './settings.js';
import { renderDay } from './views/day.js';
import { renderWeek, weekKeys } from './views/week.js';
import { renderMosaic } from './views/mosaic.js';

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
};
const UI_KEY = 'tessera-day-ui-v1';
const darkMQ = matchMedia('(prefers-color-scheme: dark)');

export const app = {
  data: M.starterData(),
  ui: { view: 'day', date: M.todayKey(), layer: 'actual', cat: null, scope: 'month' },
  dark: false,
  colors: new Map(),
  history: [],   // undo stack: { key, prev } where prev is the day record before the change (or null)

  get settings() { return this.data.settings; },
  cat(id) { return this.data.categories.find(c => c.id === id) || null; },
  color(id) { return this.colors.get(id) || 'transparent'; },
  day(key) { return this.data.days[key] || null; },
  dayQ(key) { return this.day(key)?.q ?? this.settings.quantum; },
  layer(key, layer) { return this.day(key)?.[layer] ?? M.emptyLayer(this.dayQ(key)); },

  setLayer(key, layer, arr) {
    const q = 1440 / arr.length;
    const day = this.day(key) ? { ...this.day(key) } : { q, plan: M.emptyLayer(q), actual: M.emptyLayer(q) };
    day[layer] = arr;
    this.putDay(key, day);
  },
  putDay(key, day, { undoable = true } = {}) {
    if (undoable) {
      this.history.push({ key, prev: this.data.days[key] || null });
      if (this.history.length > 100) this.history.shift();
    }
    if (M.isEmptyDay(day)) delete this.data.days[key];
    else this.data.days[key] = day;
    store.saveDay(key, this.data.days[key] || null);
    this.render();
  },
  undo() {
    const h = this.history.pop();
    if (!h) return;
    this.putDay(h.key, h.prev || {}, { undoable: false });
    if (this.ui.view === 'day' && h.key !== this.ui.date) this.go('day', h.key);
    toast('Undone');
  },
  convertDay(key, q) {
    this.putDay(key, M.convertDay(this.day(key), q));
  },
  replaceData(data) {
    this.data = data;
    this.history = [];
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
      for (const l of M.LAYERS) day[l] = day[l].map(v => (v === id ? null : v));
      if (M.isEmptyDay(day)) delete this.data.days[key];
    }
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
    this.refreshColors();
    $('meta[name="theme-color"]').content = this.dark ? '#12161C' : '#ECEFF3';
    if (ui.cat !== null && !this.cat(ui.cat)) ui.cat = this.data.categories[0]?.id ?? null;

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
  if (ui.view === 'mosaic') {
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
  app.go(app.ui.view, VIEWS[app.ui.view].step(app.ui.date, dir));
}

$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);
$('#today').onclick = () => app.go(app.ui.view, M.todayKey());
$('#settingsBtn').onclick = () => openSettings(app);
$('#tabs').addEventListener('click', e => {
  const a = e.target.closest('[data-view]');
  if (!a) return;
  e.preventDefault();
  app.go(a.dataset.view, app.ui.date);
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

// Keyboard: 1-9 pick a category, 0 the eraser, P/A/C the layer, arrows step, T today, Ctrl/Cmd+Z undo.
addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select, dialog[open]')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); return app.undo(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[1-9]$/.test(k) && app.data.categories[k - 1]) app.ui.cat = app.data.categories[k - 1].id;
  else if (k === '0') app.ui.cat = null;
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
app.ui.cat = saved.cat === null || app.cat(saved.cat) ? saved.cat : app.data.categories[0]?.id ?? null;
if (['plan', 'actual', 'compare'].includes(saved.layer)) app.ui.layer = saved.layer;
if (saved.scope === 'year') app.ui.scope = 'year';
route();

// Offline support (needs http(s); ES modules don't load from file:// anyway).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered', e));
}
