// Mosaic view: a month (calendar) or a whole year of days drawn on one canvas, each day shrunk to
// its tile pattern so the period reads as one large mosaic. Tap a day to open it.
// Year layout: months as rows and days as columns when wide; transposed on narrow screens.
import * as M from '../model.js';
import { statsHTML, totalsFor } from '../stats.js';
import { setupCanvas, paintStyle, drawDay } from '../tiles.js';
import { layerSegHTML, bindLayerSeg } from './day.js';

const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';

export function mosaicKeys(app) {
  const d = M.parseKey(app.ui.date), y = d.getFullYear();
  const months = app.ui.scope === 'year' ? [...Array(12).keys()] : [d.getMonth()];
  return months.flatMap(m => Array.from({ length: M.daysInMonth(y, m) }, (_, i) => M.dateKey(new Date(y, m, i + 1))));
}

export function renderMosaic(app, root) {
  const scope = app.ui.scope, layer = app.ui.layer === 'compare' ? 'actual' : app.ui.layer;
  const d = M.parseKey(app.ui.date), keys = mosaicKeys(app);
  const title = scope === 'year' ? String(d.getFullYear()) : d.toLocaleDateString(undefined, { month: 'long' });
  root.innerHTML = `<div class="dayview">
    <div class="maincol">
      <div class="layerrow">
        <div class="seg scope" role="group" aria-label="Period">${['month', 'year'].map(s =>
          `<button type="button" data-scope="${s}" class="${s === scope ? 'on' : ''}" aria-pressed="${s === scope}">${s}</button>`).join('')}</div>
        ${layerSegHTML(app, { compare: false })}
      </div>
      <div class="panel mosaicpanel"><canvas class="mosaic" role="img"
        aria-label="${title} ${layer} mosaic. Use the day view to read or edit a day."></canvas></div>
      <p class="hint">Each block is one day, midnight at the top. Tap a day to open it.</p>
    </div>
    <aside class="sidecol">${statsHTML(app, keys, title, layer)}</aside>
  </div>`;
  bindLayerSeg(app, root);
  root.querySelector('.seg.scope').addEventListener('click', e => {
    const b = e.target.closest('[data-scope]');
    if (!b) return;
    app.ui.scope = b.dataset.scope;
    app.saveUi();
    app.go('mosaic', app.ui.date);
  });

  const cv = root.querySelector('canvas.mosaic');
  const rects = draw(app, cv, keys, layer);
  cv.cells = rects; // for tests: where each day landed
  const hit = e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return rects.find(o => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h);
  };
  cv.addEventListener('click', e => { const o = hit(e); if (o) app.go('day', o.key); });
  cv.addEventListener('mousemove', e => {
    const o = hit(e);
    cv.style.cursor = o ? 'pointer' : '';
    cv.title = o ? `${M.parseKey(o.key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${M.fmtDur(M.sumMinutes(totalsFor(app, [o.key], layer)))} logged` : '';
  });
}

// Lays out and draws the period; returns day hit-rects in CSS px.
function draw(app, cv, keys, layer) {
  const W = Math.floor(cv.getBoundingClientRect().width);
  const st = paintStyle(app), cs = getComputedStyle(document.documentElement);
  const faint = cs.getPropertyValue('--faint').trim(), ink = cs.getPropertyValue('--ink').trim();
  const today = M.todayKey(), q = app.settings.quantum;
  const cells = [], labels = [];   // cells: {key, x, y, w, h}; labels: [text, x, y, align, strong]

  if (app.ui.scope === 'month') {
    const first = M.parseKey(keys[0]), off = (first.getDay() - app.settings.weekStart + 7) % 7;
    const gap = W < 500 ? 4 : 8, headH = 18, numH = 15;
    const cw = (W - 6 * gap) / 7, ch = Math.round(cw * 1.2);
    for (let i = 0; i < 7; i++) {
      const wd = new Date(2024, 0, 7 + app.settings.weekStart + i); // a week starting on a Sunday
      labels.push([wd.toLocaleDateString(undefined, { weekday: W < 500 ? 'narrow' : 'short' }), i * (cw + gap) + cw / 2, 12, 'center']);
    }
    keys.forEach((key, i) => {
      const col = (off + i) % 7, row = Math.floor((off + i) / 7);
      const x = col * (cw + gap), y = headH + row * (numH + ch + gap);
      labels.push([String(i + 1), x + 1, y + 11, 'left', key === today]);
      cells.push({ key, x, y: y + numH, w: cw, h: ch });
    });
  } else if (W >= 640) {
    const lw = 36, gap = 2, gy = 4, headH = 14;
    const cw = (W - lw - 30 * gap) / 31, ch = Math.max(12, Math.round(cw * 1.3));
    [1, 5, 10, 15, 20, 25, 30].forEach(n => labels.push([String(n), lw + (n - 1) * (cw + gap) + cw / 2, 10, 'center']));
    keys.forEach(key => {
      const d = M.parseKey(key), m = d.getMonth(), y = headH + m * (ch + gy);
      if (d.getDate() === 1) labels.push([d.toLocaleDateString(undefined, { month: 'short' }), 0, y + ch / 2 + 4, 'left']);
      cells.push({ key, x: lw + (d.getDate() - 1) * (cw + gap), y, w: cw, h: ch });
    });
  } else {
    const lw = 20, gap = 3, gy = 2, headH = 16;
    const cw = (W - lw - 11 * gap) / 12, ch = Math.max(10, Math.round(cw * 0.8));
    keys.forEach(key => {
      const d = M.parseKey(key), m = d.getMonth(), x = lw + m * (cw + gap), y = headH + (d.getDate() - 1) * (ch + gy);
      if (d.getDate() === 1) labels.push([d.toLocaleDateString(undefined, { month: 'narrow' }), x + cw / 2, 11, 'center']);
      if (m === 0 && (d.getDate() === 1 || d.getDate() % 5 === 0)) labels.push([String(d.getDate()), lw - 5, y + ch / 2 + 4, 'right']);
      cells.push({ key, x, y, w: cw, h: ch });
    });
  }

  const H = Math.ceil(Math.max(...cells.map(c => c.y + c.h))) + 2;
  const { g, dpr } = setupCanvas(cv, W, H);
  for (const c of cells) drawDay(g, dpr, c.x * dpr, c.y * dpr, c.w * dpr, c.h * dpr, app.day(c.key), layer, st, q);
  for (const [text, x, y, align, strong] of labels) {
    g.font = `${strong ? 700 : 500} ${10 * dpr}px ${MONO}`;
    g.fillStyle = strong ? ink : faint;
    g.textAlign = align;
    g.fillText(text, x * dpr, y * dpr);
  }
  const t = cells.find(c => c.key === today);
  if (t) {
    g.strokeStyle = ink;
    g.lineWidth = 2 * dpr;
    g.strokeRect((t.x - 2) * dpr, (t.y - 2) * dpr, (t.w + 4) * dpr, (t.h + 4) * dpr);
  }
  return cells;
}
