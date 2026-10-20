// Weekday baseline editor (#/baseline/<weekday>, 0 = Sunday). Each weekday has a typical plan;
// a day's plan is its baseline plus that day's variations. Edits apply from today on, so past
// days keep the plan they had (see withBaseline in model.js).
import * as M from '../model.js';
import { paletteHTML, bindPalette } from '../palette.js';
import { baselineStatsHTML } from '../stats.js';
import { esc } from '../ui.js';
import { tilesHTML, bindTiles, undoButtonHTML } from './day.js';

// 7 Jan 2024 was a Sunday, so 7 + wd lands on weekday wd.
export const weekdayName = (wd, style = 'long') => new Date(2024, 0, 7 + wd).toLocaleDateString(undefined, { weekday: style });

const current = app => M.baselineAt(app.data.baselines, M.todayKey());

// Things to copy into this weekday's baseline: other weekdays' baselines, and the last four
// occurrences of this weekday (their actual or plan).
function copySources(app, wd) {
  const out = [], cur = current(app);
  cur?.days.forEach((a, d) => { if (a && d !== wd) out.push({ label: `${weekdayName(d)} baseline`, arr: a }); });
  let k = M.todayKey();
  while (M.parseKey(k).getDay() !== wd) k = M.addDays(k, -1);
  for (let n = 0; n < 4; n++, k = M.addDays(k, -7)) {
    const date = M.parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    for (const layer of ['actual', 'plan']) {
      const a = app.layerIfAny(k, layer);
      if (a && !M.isEmptyLayer(a)) out.push({ label: `${layer === 'actual' ? 'Actual' : 'Plan'}, ${date}`, arr: a });
    }
  }
  return out;
}

export function renderBaseline(app, root) {
  // Shown and edited at the current tessera length, whatever length the version was saved at.
  const wd = app.ui.wd, name = weekdayName(wd), cur = current(app), q = app.settings.quantum;
  const layerAtQ = () => {
    const b = current(app), a = b?.days[wd];
    return a ? M.resample(a, b.q, q) : M.emptyLayer(q);
  };
  const arr = layerAtQ();
  const order = Array.from({ length: 7 }, (_, i) => (app.settings.weekStart + i) % 7);
  const sources = copySources(app, wd);
  root.innerHTML = `<div class="dayview">
    <div class="maincol">
      <div class="layerrow">
        <div class="seg wdays" role="group" aria-label="Weekday">${order.map(d =>
          `<button type="button" data-wd="${d}" class="${d === wd ? 'on' : ''}${cur?.days[d] ? ' has' : ''}" aria-pressed="${d === wd}"
             title="${weekdayName(d)}${cur?.days[d] ? '' : ' (no baseline yet)'}">${weekdayName(d, 'short')}</button>`).join('')}</div>
        ${undoButtonHTML(app)}
      </div>
      <div class="planbar"><span>Every ${esc(name)} plan starts from this. Changes apply from today; past days keep the plan they had.</span>
        <span class="planbar-actions">
          ${sources.length ? `<select class="pick" data-copy aria-label="Copy into the ${esc(name)} baseline">
            <option value="">Copy from…</option>${sources.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('')}</select>` : ''}
          <button type="button" class="btn small" data-clear ${cur?.days[wd] ? '' : 'disabled'}>Clear</button>
        </span></div>
      ${paletteHTML(app)}
      <section class="panel gridpanel">
        <div class="gridhead"><span class="label">${esc(name)} baseline</span><span class="status">Tap or drag to paint</span></div>
        ${tilesHTML(app, arr, q)}
      </section>
    </div>
    <aside class="sidecol">${baselineStatsHTML(app, cur)}</aside>
  </div>`;

  bindPalette(app, root);
  root.querySelector('[data-undo]').addEventListener('click', () => app.undo());
  root.querySelector('.seg.wdays').addEventListener('click', e => {
    const b = e.target.closest('[data-wd]');
    if (b) app.go('baseline', +b.dataset.wd);
  });
  root.querySelector('[data-copy]')?.addEventListener('change', e => {
    const s = sources[+e.target.value];
    if (s) app.setBaseline(wd, s.arr);
  });
  root.querySelector('[data-clear]').addEventListener('click', () => app.setBaseline(wd, null));
  bindTiles(app, root.querySelector('.tgrid'), root.querySelector('.gridpanel .status'), {
    values: layerAtQ,
    commit: a => app.setBaseline(wd, a),
  });
}
