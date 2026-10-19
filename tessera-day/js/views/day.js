// Day view: the tile grid for one date, painted with pointer strokes.
import * as M from '../model.js';
import { attachPainter } from '../paint.js';
import { paletteHTML, bindPalette } from '../palette.js';
import { statsHTML } from '../stats.js';
import { ask, esc } from '../ui.js';
import { weekdayName } from './baseline.js';

const pad = n => String(n).padStart(2, '0');
let nowTimer;

// A tile is a variation when the plan differs from the baseline under it.
const varied = (v, base, i) => base && (v ?? null) !== (base[i] ?? null);

// A paintable grid of one layer. Rows are hours, columns are quanta within the hour.
// base (optional) is the baseline under a plan: tiles that differ from it get a corner mark.
export function tilesHTML(app, arr, q, { labels = true, now = -1, base = null, attrs = '' } = {}) {
  const cols = 60 / q;
  let h = `<div class="tgrid${labels ? '' : ' nolabels'}" style="--cols:${cols}" data-q="${q}" ${attrs}>`;
  if (labels) h += '<span class="mh"></span>';
  for (let c = 0; c < cols; c++) h += `<span class="mh">${(c * q) % 15 === 0 ? ':' + pad(c * q) : ''}</span>`;
  for (let r = 0; r < 24; r++) {
    if (labels) h += `<span class="hr">${pad(r)}</span>`;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c, v = arr[i];
      h += `<i class="t${v ? ' f' : ''}${varied(v, base, i) ? ' v' : ''}${i === now ? ' now' : ''}" data-i="${i}"${v ? ` style="--c:${app.color(v)}"` : ''}></i>`;
    }
  }
  return h + '</div>';
}

// opts: { values(), commit(arr), baseline?() } as for attachPainter.
export function bindTiles(app, grid, status, opts) {
  const q = +grid.dataset.q, tiles = [...grid.querySelectorAll('.t')];
  const idle = status.textContent, base = opts.baseline?.();
  attachPainter(grid, {
    getCat: () => app.ui.cat,
    ...opts,
    render(i, v) {
      tiles[i].classList.toggle('f', !!v);
      tiles[i].classList.toggle('v', !!varied(v, base, i));
      if (v) tiles[i].style.setProperty('--c', app.color(v));
      else tiles[i].style.removeProperty('--c');
    },
    status(s) {
      if (!s) { status.textContent = idle; return; }
      const name = s.cat && !s.restore ? app.cat(s.cat).name : '';
      const verb = s.restore ? 'Restore baseline' : !s.erase ? `Paint ${name}` : s.cat ? `Clear ${name}` : 'Erase';
      status.textContent = `${verb} · ${M.rangeLabel(s.a, s.b, q)} · ${M.fmtDur((s.b - s.a + 1) * q)}`;
    },
  });
  // Tooltip with the tile's time and category, filled in on hover only.
  grid.addEventListener('mouseover', e => {
    const t = e.target.closest('.t');
    if (!t) return;
    const i = +t.dataset.i, v = opts.values()[i];
    t.title = M.rangeLabel(i, i, q) + (v ? ' · ' + app.cat(v).name : '') + (t.classList.contains('v') ? ' · varied from baseline' : '');
  });
}

// One layer of one day.
export function gridHTML(app, key, layer, { labels = true } = {}) {
  const q = app.dayQ(key);
  return tilesHTML(app, app.layer(key, layer), q, {
    labels,
    now: key === M.todayKey() ? M.nowSlot(q) : -1,
    base: layer === 'plan' ? app.basePlan(key, q) : null,
    attrs: `data-key="${key}" data-layer="${layer}"`,
  });
}

export function bindGrid(app, grid, status) {
  const { key, layer } = grid.dataset;
  bindTiles(app, grid, status, {
    values: () => app.layer(key, layer),
    commit: arr => app.setLayer(key, layer, arr),
    ...(layer === 'plan' ? { baseline: () => app.basePlan(key) } : {}),
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

// Which baseline the plan follows, how much this day varies from it, and the way to edit or reset.
function planBarHTML(app, key) {
  const wd = M.parseKey(key).getDay(), name = weekdayName(wd), base = app.basePlan(key);
  const edit = `<button type="button" class="btn small" data-baseline="${wd}">${base ? 'Edit' : 'Set up'} ${esc(name)} baseline</button>`;
  if (!base) {
    const first = app.data.baselines[0]?.from;
    const why = first && key < first
      ? `Baselines start on ${M.parseKey(first).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, so this day has none.`
      : `No ${esc(name)} baseline yet. Paint a typical ${esc(name)} once and every ${esc(name)} starts from it.`;
    return `<div class="planbar"><span>${why}</span>${edit}</div>`;
  }
  const n = app.layer(key, 'plan').filter((v, i) => varied(v, base, i)).length;
  return `<div class="planbar"><span>Follows the <b>${esc(name)} baseline</b>${n ? ` · ${n} tesserae varied` : ''}</span>
    <span class="planbar-actions">${edit}
      <button type="button" class="btn small" data-reset ${n ? '' : 'disabled'} title="Drop this day's variations">Reset to baseline</button></span></div>`;
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
      ${layer === 'actual' ? '' : planBarHTML(app, key)}
      ${paletteHTML(app, { restore: layer !== 'actual' })}
      ${grids}
    </div>
    <aside class="sidecol">${statsHTML(app, [key], key === M.todayKey() ? 'Today' : 'This day')}</aside>
  </div>`;
  bindPalette(app, root);
  bindLayerSeg(app, root);
  root.querySelector('[data-undo]').addEventListener('click', () => app.undo());
  root.querySelector('[data-convert]')?.addEventListener('click', () => convert(app, key));
  root.querySelector('[data-reset]')?.addEventListener('click', () => app.resetPlan(key));
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
