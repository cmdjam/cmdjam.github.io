// Day view: the tile grid for one date, painted with pointer strokes.
import * as M from '../model.js';
import { attachPainter } from '../paint.js';
import { paletteHTML, bindPalette } from '../palette.js';
import { statsHTML } from '../stats.js';
import { ask } from '../ui.js';

const pad = n => String(n).padStart(2, '0');
let nowTimer;

// One paintable grid. Rows are hours, columns are quanta within the hour.
export function gridHTML(app, key, layer, { labels = true } = {}) {
  const q = app.dayQ(key), cols = 60 / q, arr = app.layer(key, layer);
  const now = key === M.todayKey() ? M.nowSlot(q) : -1;
  let h = `<div class="tgrid${labels ? '' : ' nolabels'}" style="--cols:${cols}" data-key="${key}" data-layer="${layer}" data-q="${q}">`;
  if (labels) h += '<span class="mh"></span>';
  for (let c = 0; c < cols; c++) h += `<span class="mh">${(c * q) % 15 === 0 ? ':' + pad(c * q) : ''}</span>`;
  for (let r = 0; r < 24; r++) {
    if (labels) h += `<span class="hr">${pad(r)}</span>`;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c, v = arr[i];
      h += `<i class="t${v ? ' f' : ''}${i === now ? ' now' : ''}" data-i="${i}"${v ? ` style="--c:${app.color(v)}"` : ''}></i>`;
    }
  }
  return h + '</div>';
}

export function bindGrid(app, grid, status) {
  const { key, layer } = grid.dataset, q = +grid.dataset.q;
  const tiles = [...grid.querySelectorAll('.t')];
  const idle = status.textContent;
  attachPainter(grid, {
    getCat: () => app.ui.cat,
    values: () => app.layer(key, layer),
    render(i, v) {
      tiles[i].classList.toggle('f', !!v);
      if (v) tiles[i].style.setProperty('--c', app.color(v));
      else tiles[i].style.removeProperty('--c');
    },
    status(s) {
      if (!s) { status.textContent = idle; return; }
      const name = s.cat ? app.cat(s.cat).name : '';
      const verb = !s.erase ? `Paint ${name}` : s.cat ? `Clear ${name}` : 'Erase';
      status.textContent = `${verb} · ${M.rangeLabel(s.a, s.b, q)} · ${M.fmtDur((s.b - s.a + 1) * q)}`;
    },
    commit: arr => app.setLayer(key, layer, arr),
  });
  // Tooltip with the tile's time and category, filled in on hover only.
  grid.addEventListener('mouseover', e => {
    const t = e.target.closest('.t');
    if (!t) return;
    const i = +t.dataset.i, v = app.layer(key, layer)[i];
    t.title = M.rangeLabel(i, i, q) + (v ? ' · ' + app.cat(v).name : '');
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
      <div class="layerrow">${layerSegHTML(app)}
        <button type="button" class="btn icon" data-undo aria-label="Undo" title="Undo (Ctrl+Z)" ${app.history.length ? '' : 'disabled'}>↶</button></div>
      ${paletteHTML(app)}
      ${grids}
    </div>
    <aside class="sidecol">${statsHTML(app, [key], key === M.todayKey() ? 'Today' : 'This day')}</aside>
  </div>`;
  bindPalette(app, root);
  bindLayerSeg(app, root);
  root.querySelector('[data-undo]').addEventListener('click', () => app.undo());
  root.querySelector('[data-convert]')?.addEventListener('click', () => convert(app, key));
  root.querySelectorAll('.gridpanel').forEach(p => bindGrid(app, p.querySelector('.tgrid'), p.querySelector('.status')));

  // Keep the "now" tile current while the page stays open.
  clearInterval(nowTimer);
  nowTimer = setInterval(() => {
    root.querySelectorAll('.tgrid').forEach(g => {
      if (g.dataset.key !== M.todayKey()) return;
      const n = M.nowSlot(+g.dataset.q);
      g.querySelectorAll('.t').forEach(t => t.classList.toggle('now', +t.dataset.i === n));
    });
  }, 30000);
}
