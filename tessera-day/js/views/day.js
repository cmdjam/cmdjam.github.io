// Day view: the tile grid for one date, painted with pointer strokes.
import * as M from '../model.js';
import { attachPainter } from '../paint.js';
import { paletteHTML, bindPalette } from '../palette.js';
import { statsHTML } from '../stats.js';
import { ask, esc, toast } from '../ui.js';
import { weekdayName } from './baseline.js';

const pad = n => String(n).padStart(2, '0');
let nowTimer;

// A tile is a variation when it differs from what's under it (the baseline under a plan, the plan
// under an actual).
const varied = (v, base, i) => base && (v ?? null) !== (base[i] ?? null);

// A paintable grid of one layer. Rows are hours, columns are quanta within the hour.
// base (optional): what the layer varies from; differing tiles get a corner mark.
// ghost (optional): plan tiles to show faintly where nothing is recorded.
export function tilesHTML(app, arr, q, { labels = true, now = -1, base = null, ghost = null, attrs = '' } = {}) {
  const cols = 60 / q;
  let h = `<div class="tgrid${labels ? '' : ' nolabels'}" style="--cols:${cols}" data-q="${q}" ${attrs}>`;
  if (labels) h += '<span class="mh"></span>';
  for (let c = 0; c < cols; c++) h += `<span class="mh">${(c * q) % 15 === 0 ? ':' + pad(c * q) : ''}</span>`;
  for (let r = 0; r < 24; r++) {
    if (labels) h += `<span class="hr">${pad(r)}</span>`;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c, v = arr[i], g = !v && ghost?.[i];
      const cls = (v ? ' f' : '') + (g ? ' g' : '') + (!g && varied(v, base, i) ? ' v' : '') + (i === now ? ' now' : '');
      h += `<i class="t${cls}" data-i="${i}"${v || g ? ` style="--c:${app.color(v || g)}"` : ''}></i>`;
    }
  }
  return h + '</div>';
}

// opts: { values(), commit(arr), baseline?() } as for attachPainter, or { readOnly: message }.
export function bindTiles(app, grid, status, opts) {
  const q = +grid.dataset.q, tiles = [...grid.querySelectorAll('.t')];
  const idle = status.textContent, base = opts.baseline?.();
  if (opts.readOnly) {
    grid.classList.add('ro');
    grid.addEventListener('pointerdown', e => { if (e.target.closest('.t')) toast(opts.readOnly); });
  } else attachPainter(grid, {
    getCat: () => app.ui.cat,
    ...opts,
    render(i, v) {
      const g = v === M.GHOST && opts.ghostOf?.(i);   // back to a ghost (a cancelled stroke)
      tiles[i].classList.toggle('g', !!g);
      tiles[i].classList.toggle('f', !!v && !g);
      tiles[i].classList.toggle('v', !g && !!varied(v, base, i));
      if (v && (g || v !== M.GHOST)) tiles[i].style.setProperty('--c', app.color(g || v));
      else tiles[i].style.removeProperty('--c');
    },
    status(s) {
      if (!s) { status.textContent = idle; return; }
      const name = s.cat && !s.restore ? app.cat(s.cat).name : '';
      const verb = s.restore ? (opts.restoreVerb || 'Restore') : !s.erase ? `Paint ${name}` : s.cat ? `Clear ${name}` : 'Erase';
      status.textContent = `${verb} · ${M.rangeLabel(s.a, s.b, q)} · ${M.fmtDur((s.b - s.a + 1) * q)}`;
    },
  });
  // Tooltip with the tile's time and category, filled in on hover only.
  grid.addEventListener('mouseover', e => {
    const t = e.target.closest('.t');
    if (!t) return;
    const i = +t.dataset.i, v = opts.values()[i] === M.GHOST ? null : opts.values()[i];
    const g = t.classList.contains('g') && opts.ghostOf?.(i);
    t.title = M.rangeLabel(i, i, q) + (v ? ' · ' + app.cat(v).name : g ? ` · planned: ${app.cat(g).name}` : '') +
      (t.classList.contains('v') ? ` · differs from ${opts.baseName || 'baseline'}` : '');
  });
}

// What a layer's tiles vary from: the baseline under a plan, the plan under an actual.
const underlying = (app, key, layer) => (layer === 'plan' ? app.basePlan(key) : app.planIfAny(key));

// One layer of one day.
export function gridHTML(app, key, layer, { labels = true } = {}) {
  const q = app.dayQ(key);
  return tilesHTML(app, app.layer(key, layer), q, {
    labels,
    now: key === M.todayKey() ? M.nowSlot(q) : -1,
    base: underlying(app, key, layer),
    ghost: layer === 'actual' ? app.ghost(key) : null,
    attrs: `data-key="${key}" data-layer="${layer}"`,
  });
}

export function bindGrid(app, grid, status) {
  const { key, layer } = grid.dataset;
  if (layer === 'plan' && app.ui.planEdit !== key) {
    const name = weekdayName(M.parseKey(key).getDay());
    return bindTiles(app, grid, status, {
      values: () => app.layer(key, layer),
      readOnly: `The plan comes from the ${name} baseline. Use "Change this day only" to edit just this day.`,
    });
  }
  bindTiles(app, grid, status, {
    values: () => (layer === 'actual' ? app.actualForEdit(key) : app.layer(key, layer)),
    commit: arr => app.setLayer(key, layer, arr),
    baseline: () => underlying(app, key, layer),
    restoreVerb: layer === 'plan' ? 'Restore baseline' : 'As planned',
    baseName: layer === 'plan' ? 'baseline' : 'plan',
    ghostOf: i => app.ghost(key)?.[i],
  });
}

function convertNote(app, key) {
  const q = app.dayQ(key), want = app.settings.quantum;
  if (!app.day(key) || q === want) return '';
  return `<div class="note">This day uses ${q}-minute tesserae; new days use ${want}.
    <button type="button" class="btn small" data-convert>Convert to ${want} min</button></div>`;
}

async function convert(app, key) {
  const day = app.day(key), to = app.settings.quantum;
  const lossless = M.LAYERS.every(l => M.isLossless(day[l], day.q, to));
  if (!lossless && !(await ask(`Going from ${day.q}- to ${to}-minute tesserae merges blocks, and each new tessera takes whichever category filled most of it. Some short entries will change or disappear.`,
    { title: 'Convert this day?', ok: 'Convert' }))) return;
  app.convertDay(key, to);
}

// The plan comes from the weekday baseline. Changing a single day's plan is tucked behind
// "Change this day only" (for holidays, trips and other known exceptions).
function planBarHTML(app, key) {
  const wd = M.parseKey(key).getDay(), name = weekdayName(wd), base = app.basePlan(key);
  const n = app.layer(key, 'plan').filter((v, i) => varied(v, base, i)).length;
  if (app.ui.planEdit === key) {
    return `<div class="planbar"><span><b>Changing this day's plan only</b>${n ? ` · ${n} tesserae differ from the ${esc(name)} baseline` : ''}</span>
      <span class="planbar-actions">
        <button type="button" class="btn small" data-reset ${n ? '' : 'disabled'} title="Drop this day's changes">Reset to baseline</button>
        <button type="button" class="btn small primary" data-plan-edit="">Done</button></span></div>`;
  }
  const edit = `<button type="button" class="btn small" data-baseline="${wd}">${base ? 'Edit' : 'Set up'} ${esc(name)} baseline</button>`;
  const once = `<button type="button" class="btn small" data-plan-edit="${key}" title="For holidays, trips and other one-off days">Change this day only</button>`;
  let why;
  if (base) why = `From the <b>${esc(name)} baseline</b>${n ? ` · ${n} tesserae changed for this day` : ''}`;
  else {
    const first = app.data.baselines[0]?.from;
    why = first && key < first
      ? `Baselines start on ${M.parseKey(first).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, so this day has none.`
      : `No ${esc(name)} baseline yet. Paint a typical ${esc(name)} once and every ${esc(name)} plan starts from it.`;
  }
  return `<div class="planbar"><span>${why}</span><span class="planbar-actions">${edit}${once}</span></div>`;
}

// How the day's actuals stand against the plan, with the shortcuts to fill or forget them.
function actualBarHTML(app, key) {
  const plan = app.planIfAny(key);
  if (!plan) return '';
  const today = M.todayKey(), stored = app.day(key)?.actual;
  if (key > today) return '<div class="planbar"><span>Still to come. The plan is shown faintly.</span></div>';
  const clear = '<button type="button" class="btn small" data-untrack title="Forget what was recorded for this day">Clear day</button>';
  if (!M.isTracked(stored)) {
    return `<div class="planbar"><span>Not tracked yet. The plan is shown faintly.</span>
      <span class="planbar-actions"><button type="button" class="btn small primary" data-as-planned>Went as planned</button></span></div>`;
  }
  const actual = app.layer(key, 'actual'), ghost = app.ghost(key);
  const n = actual.filter((v, i) => !ghost?.[i] && varied(v, plan, i)).length;
  const diff = n ? `${n} tesserae differ from the plan` : 'Matches the plan so far';
  return key === today
    ? `<div class="planbar"><span>${diff}. Gaps show the plan faintly and fill from it when the day ends.</span>
        <span class="planbar-actions"><button type="button" class="btn small" data-as-planned ${ghost?.some(Boolean) ? '' : 'disabled'}>Rest went as planned</button>${clear}</span></div>`
    : `<div class="planbar"><span>${n ? `${n} tesserae differed from the plan` : 'Went as planned'}; untouched time is filled from it.</span>
        <span class="planbar-actions">${clear}</span></div>`;
}

const LAYER_NAMES = { plan: 'Plan', actual: 'Actual', compare: 'Compare' };

// Plan / Actual / Compare toggle, shared with the week and mosaic views.
export function layerSegHTML(app, { compare = true } = {}) {
  const cur = !compare && app.ui.layer === 'compare' ? 'actual' : app.ui.layer;
  return `<div class="seg layer" role="group" aria-label="Layer">${Object.entries(LAYER_NAMES)
    .filter(([k]) => compare || k !== 'compare')
    .map(([k, name]) => `<button type="button" data-layer="${k}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}" title="${name} (${name[0]})">${name}</button>`)
    .join('')}</div>`;
}

export function bindLayerSeg(app, root) {
  root.querySelector('.seg.layer').addEventListener('click', e => {
    const b = e.target.closest('[data-layer]');
    if (!b) return;
    app.ui.layer = b.dataset.layer;
    app.saveUi();
    app.render();
  });
}

export const undoButtonHTML = app =>
  `<button type="button" class="btn icon" data-undo aria-label="Undo" title="Undo (Ctrl+Z)" ${app.history.length ? '' : 'disabled'}>↶</button>`;

const panel = (app, key, layer, labels) => `<section class="panel gridpanel">
    <div class="gridhead"><span class="label">${LAYER_NAMES[layer]}</span><span class="status">${labels ? 'Tap or drag to paint' : ''}</span></div>
    ${gridHTML(app, key, layer, { labels })}
  </section>`;

export function renderDay(app, root) {
  const key = app.ui.date, layer = app.ui.layer;
  const grids = layer === 'compare'
    ? `<div class="compare">${panel(app, key, 'plan', true)}${panel(app, key, 'actual', false)}</div>`
    : panel(app, key, layer, true);
  root.innerHTML = `<div class="dayview">
    <div class="maincol">
      ${convertNote(app, key)}
      <div class="layerrow">${layerSegHTML(app)}${undoButtonHTML(app)}</div>
      ${layer === 'plan' ? planBarHTML(app, key) : actualBarHTML(app, key)}
      ${paletteHTML(app, { restore: layer !== 'plan'
        ? { label: 'As planned', title: 'Paint the plan over a range' }
        : app.ui.planEdit === key ? { label: 'Baseline', title: 'Paint the baseline back over a range' } : null })}
      ${grids}
    </div>
    <aside class="sidecol">${statsHTML(app, [key], key === M.todayKey() ? 'Today' : 'This day')}</aside>
  </div>`;
  bindPalette(app, root);
  bindLayerSeg(app, root);
  root.querySelector('[data-undo]').addEventListener('click', () => app.undo());
  root.querySelector('[data-convert]')?.addEventListener('click', () => convert(app, key));
  root.querySelector('[data-reset]')?.addEventListener('click', () => app.resetPlan(key));
  root.querySelector('[data-plan-edit]')?.addEventListener('click', e => {
    app.ui.planEdit = e.currentTarget.dataset.planEdit || null;
    app.render();
  });
  root.querySelector('[data-as-planned]')?.addEventListener('click', () => app.wentAsPlanned(key));
  root.querySelector('[data-untrack]')?.addEventListener('click', () => app.untrack(key));
  root.querySelectorAll('.gridpanel').forEach(p => bindGrid(app, p.querySelector('.tgrid'), p.querySelector('.status')));

  // Keep the "now" tile current while the page stays open.
  clearInterval(nowTimer);
  nowTimer = setInterval(() => {
    root.querySelectorAll('.tgrid[data-key]').forEach(g => {
      if (g.dataset.key !== M.todayKey()) return;
      const n = M.nowSlot(+g.dataset.q);
      g.querySelectorAll('.t').forEach(t => t.classList.toggle('now', +t.dataset.i === n));
    });
  }, 30000);
}
