// Week view: seven mini day mosaics side by side, plus the week's totals. Tap a day to open it.
import * as M from '../model.js';
import { statsHTML, totalsFor } from '../stats.js';
import { setupCanvas, paintStyle, drawDay } from '../tiles.js';
import { layerSegHTML, bindLayerSeg } from './day.js';

export const weekKeys = app => {
  const start = M.weekStartOf(app.ui.date, app.settings.weekStart);
  return Array.from({ length: 7 }, (_, i) => M.addDays(start, i));
};

export function renderWeek(app, root) {
  const keys = weekKeys(app), today = M.todayKey(), compare = app.ui.layer === 'compare';
  const layers = compare ? ['plan', 'actual'] : [app.ui.layer];
  root.innerHTML = `<div class="dayview">
    <div class="maincol">
      <div class="layerrow">${layerSegHTML(app)}${app.ui.layer === 'actual' ? '' : '<button type="button" class="btn" data-baseline="" title="Edit the weekday baselines plans start from">Baselines</button>'}</div>
      <div class="panel weekgrid${compare ? ' cmp' : ''}">${keys.map(k => {
        // Compact per-day totals (rounded hours) so they fit narrow columns; the stats panel has exact figures.
        const short = m => (m >= 60 ? Math.round(m / 60) + 'h' : m + 'm');
        const d = M.parseKey(k), logged = layers.map(l => short(M.sumMinutes(totalsFor(app, [k], l))));
        return `<button type="button" class="wday${k === today ? ' today' : ''}${k === app.ui.date ? ' sel' : ''}" data-key="${k}"
            aria-label="Open ${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}">
          <span class="wd"><b>${d.toLocaleDateString(undefined, { weekday: 'short' })}</b> ${d.getDate()}</span>
          <span class="cvs">${layers.map(l => `<canvas data-layer="${l}"></canvas>`).join('')}</span>
          <span class="wsum">${logged.join(' · ')}</span>
        </button>`;
      }).join('')}</div>
      ${compare ? '<p class="hint">Each day shows plan on the left and actual on the right.</p>' : ''}
    </div>
    <aside class="sidecol">${statsHTML(app, keys, 'This week')}</aside>
  </div>`;
  bindLayerSeg(app, root);
  root.querySelector('.weekgrid').addEventListener('click', e => {
    const b = e.target.closest('[data-key]');
    if (b) app.go('day', b.dataset.key);
  });

  // Size canvases from the laid-out column width: tile height scales with it (5–10px).
  const st = paintStyle(app);
  root.querySelectorAll('.wday').forEach(btn => {
    const key = btn.dataset.key;
    btn.querySelectorAll('canvas').forEach(cv => {
      const w = cv.parentElement.clientWidth / layers.length - (compare ? 2 : 0);
      const th = Math.max(5, Math.min(10, Math.floor(w / 10)));
      const { g, dpr } = setupCanvas(cv, w, th * 24);
      const layer = cv.dataset.layer;
      drawDay(g, dpr, 0, 0, cv.width, cv.height, app.layerIfAny(key, layer), st, app.settings.quantum, layer === 'actual' ? app.ghost(key) : null);
    });
  });
}
