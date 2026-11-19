// Stats panel: totals per category as a stacked bar plus a table of hours and percentages.
// Percentages are of the whole span (24h for a day, 168h for a week), so "unlogged" is visible.
import * as M from './model.js';
import { esc } from './ui.js';

// Minutes per category over some days, for one layer.
export function totalsFor(app, keys, layer) {
  const t = {};
  for (const k of keys) { const a = app.layerIfAny(k, layer); if (a) M.minutesByCat(a, 1440 / a.length, t); }
  return t;
}

const pct = (m, span) => {
  const p = (100 * m) / span;
  return p > 0 && p < 1 ? '<1%' : Math.round(p) + '%';
};

function bar(app, totals, span, label) {
  const segs = app.data.categories.filter(c => totals[c.id]).map(c =>
    `<b style="--c:${app.color(c.id)};flex:${totals[c.id]}" title="${esc(c.name)} · ${M.fmtDur(totals[c.id])}"></b>`).join('');
  const rest = span - M.sumMinutes(totals);
  return `<div class="bar" role="img" aria-label="${esc(label)}">${segs}${rest > 0 ? `<i style="flex:${rest}"></i>` : ''}</div>`;
}

// ---------- goals ----------

export const GOAL_ICON = { met: '✓', 'on-track': '→', missed: '✕' };
export const GOAL_WORD = { met: 'met', 'on-track': 'on track', missed: 'missed' };

// Actual minutes of category `id` on `key` (ghosts never count).
export function catMinutes(app, key, id) {
  const a = app.layerIfAny(key, 'actual');
  return a ? M.minutesByCat(a, 1440 / a.length)[id] || 0 : 0;
}

// The goal's periods within `keys` for category c (see M.goalUnits).
export const goalUnitsFor = (app, c, keys) =>
  M.goalUnits(c.goal, keys, k => catMinutes(app, k, c.id), M.todayKey(), app.settings.weekStart);

// Progress against each category goal over the dates in view, judged on actuals. A goal whose
// period doesn't fit the view (a per-week goal on a single day) is left out.
export function goalsHTML(app, keys) {
  const rows = app.data.categories.filter(c => c.goal).map(c => {
    const g = c.goal, units = goalUnitsFor(app, c, keys);
    if (!units.length) return '';
    const t = M.goalTally(units), target = Math.round(g.hours * 60) * units.length, m = t.minutes;
    const scale = Math.max(target, m) * 1.15 || 1;
    let text, status;
    if (units.length === 1) {
      status = units[0].status;
      text = g.kind === 'max' && m > target ? `${M.fmtDur(m)}, ${M.fmtDur(m - target)} over` : `${M.fmtDur(m)} of ${M.fmtDur(target)}`;
    } else {
      const unit = g.per, n = units.length;
      text = `${t.met} of ${n} ${unit}s met`;
      status = null; // a tally has no single status: the counts say it in words
      text += ['missed', 'on-track'].filter(s => t[s]).map(s => ` · ${t[s]} ${GOAL_WORD[s]}`).join('');
    }
    const label = `${c.name}: ${M.goalLabel(g)}. ${text}${status ? ', ' + GOAL_WORD[status] : ''}.`;
    return `<li class="goal${status ? ' ' + status : ''}" data-goal-cat="${c.id}">
      <div class="gline"><span class="gname"><i class="sw" style="--c:${app.color(c.id)}"></i>${esc(c.name)}</span><span class="gdesc">${esc(M.goalLabel(g))}</span></div>
      <div class="gbar" role="img" aria-label="${esc(label)}"><b style="--c:${app.color(c.id)};width:${(100 * m / scale).toFixed(1)}%"></b><s style="left:${(100 * target / scale).toFixed(1)}%"></s></div>
      <div class="gline"><span class="gtext">${esc(text)}</span>${status ? `<span class="gst ${status}">${GOAL_ICON[status]} ${GOAL_WORD[status]}</span>` : ''}</div>
    </li>`;
  }).join('');
  return rows ? `<div class="goals"><span class="label">Goals</span><ul>${rows}</ul></div>` : '';
}

// keys: the dates covered; title: panel heading. In compare mode shows plan and actual together.
export function statsHTML(app, keys, title, mode = app.ui.layer) {
  // Actuals over a period reaching into the future count only up to today, or to the last day
  // with data; otherwise empty future days would read as unlogged time. A plan covers the whole period.
  const today = M.todayKey(), allKeys = keys;   // goals judge whole periods themselves
  if (mode !== 'plan' && keys[keys.length - 1] > today) {
    const n = keys.findLastIndex(k => k <= today || app.day(k)) + 1;
    if (n > 0 && n < keys.length) { keys = keys.slice(0, n); title += ' so far'; }
  }
  const span = keys.length * 1440, cats = app.data.categories;
  const per = keys.length > 1 ? n => `<td class="num faint">${M.fmtDur(Math.round(n / keys.length))}</td>` : () => '';
  const perHead = keys.length > 1 ? '<th class="num">/day</th>' : '';

  if (mode !== 'compare') {
    const layer = mode, t = totalsFor(app, keys, layer), logged = M.sumMinutes(t);
    const done = layer === 'plan' ? 'planned' : 'logged', none = layer === 'plan' ? 'Unplanned' : 'Unlogged';
    const rows = cats.filter(c => t[c.id]).map(c => `<tr>
        <td><i class="sw" style="--c:${app.color(c.id)}"></i>${esc(c.name)}</td>
        <td class="num">${M.fmtDur(t[c.id])}</td>${per(t[c.id])}<td class="num">${pct(t[c.id], span)}</td></tr>`).join('');
    return `<section class="panel stats">
      <div class="stathead"><span class="label">${esc(title)} · ${layer}</span><span class="label">${M.fmtDur(logged)} ${done}</span></div>
      ${bar(app, t, span, `${layer} time by category`)}
      ${logged ? `<table class="stab"><thead><tr><th></th><th class="num">Time</th>${perHead}<th class="num">%</th></tr></thead><tbody>${rows}
        <tr class="faint"><td><i class="sw empty"></i>${none}</td><td class="num">${M.fmtDur(span - logged)}</td>${per(span - logged)}<td class="num">${pct(span - logged, span)}</td></tr>
      </tbody></table>` : `<p class="hint">Nothing painted on the ${layer} layer yet.</p>`}
      ${layer === 'actual' ? goalsHTML(app, allKeys) : ''}
    </section>`;
  }

  const p = totalsFor(app, keys, 'plan'), a = totalsFor(app, keys, 'actual');
  let planned = 0, matched = 0;
  for (const k of keys) {
    const s = M.matchStats(app.layerIfAny(k, 'plan'), app.layerIfAny(k, 'actual'), app.dayQ(k));
    planned += s.planned; matched += s.matched;
  }
  const delta = d => d === 0 ? '±0' : (d > 0 ? '+' : '−') + M.fmtDur(Math.abs(d));
  const rows = cats.filter(c => p[c.id] || a[c.id]).map(c => {
    const d = (a[c.id] || 0) - (p[c.id] || 0);
    return `<tr><td><i class="sw" style="--c:${app.color(c.id)}"></i>${esc(c.name)}</td>
      <td class="num">${p[c.id] ? M.fmtDur(p[c.id]) : '–'}</td><td class="num">${a[c.id] ? M.fmtDur(a[c.id]) : '–'}</td>
      <td class="num ${d > 0 ? 'up' : d < 0 ? 'down' : 'faint'}">${delta(d)}</td></tr>`;
  }).join('');
  return `<section class="panel stats">
    <div class="stathead"><span class="label">${esc(title)} · plan vs actual</span>
      <span class="label">${planned ? `${Math.round(100 * matched / planned)}% as planned` : 'no plan yet'}</span></div>
    <div class="barrow"><span class="label">Plan</span>${bar(app, p, span, 'planned time by category')}</div>
    <div class="barrow"><span class="label">Actual</span>${bar(app, a, span, 'actual time by category')}</div>
    ${rows ? `<table class="stab"><thead><tr><th></th><th class="num">Plan</th><th class="num">Actual</th><th class="num">Δ</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="hint">Nothing painted yet.</p>'}
    ${planned ? `<p class="hint">${M.fmtDur(matched)} of ${M.fmtDur(planned)} planned was spent as planned.</p>` : ''}
    ${goalsHTML(app, allKeys)}
  </section>`;
}

// The week the baseline version `b` describes: totals per category across all seven weekdays.
export function baselineStatsHTML(app, b) {
  const t = {}, span = 7 * 1440;
  if (b) b.days.forEach(a => { if (a) M.minutesByCat(a, b.q, t); });
  const planned = M.sumMinutes(t);
  const rows = app.data.categories.filter(c => t[c.id]).map(c => `<tr>
      <td><i class="sw" style="--c:${app.color(c.id)}"></i>${esc(c.name)}</td>
      <td class="num">${M.fmtDur(t[c.id])}</td><td class="num faint">${M.fmtDur(Math.round(t[c.id] / 7))}</td><td class="num">${pct(t[c.id], span)}</td></tr>`).join('');
  return `<section class="panel stats">
    <div class="stathead"><span class="label">Baseline week</span><span class="label">${M.fmtDur(planned)} planned</span></div>
    ${bar(app, t, span, 'baseline week by category')}
    ${planned ? `<table class="stab"><thead><tr><th></th><th class="num">/week</th><th class="num">/day</th><th class="num">%</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="hint">No baselines yet. Paint a typical day for each weekday.</p>'}
  </section>`;
}
