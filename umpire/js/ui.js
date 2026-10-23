// View building blocks. strikeMarks and callLadder take a ruleStatus() and nothing else from
// the app, so a read-only child scoreboard can reuse them.

// h('div', {class: 'x', onclick: fn}, 'text', child, [more]) builds an element.
// Strings become text nodes, so user text is never parsed as HTML.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

export function fmtDate(t, now = Date.now()) {
  const d = new Date(t);
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export function fmtDateTime(t, now = Date.now()) {
  return `${fmtDate(t, now)}, ${new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

// The value a datetime-local input wants, in local time.
export function localInputValue(t) {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const MAX_SLOTS = 12;

// One slot per strike up to the limit, call thresholds outlined in their card colour, and
// red "+n" slots for strikes past the final call.
export function strikeMarks(status, { big = false } = {}) {
  const { count, calls, limit, overLimit } = status;
  const colourAt = new Map(calls.map(c => [c.call.threshold, c.final ? 'red' : 'yellow']));
  const slots = Math.max(limit, count - overLimit);
  const wrap = h('div', { class: 'marks' + (big ? ' big' : ''), role: 'img', 'aria-label': `${plural(count, 'strike')} of ${limit}` });
  if (slots > MAX_SLOTS) {
    wrap.append(h('span', { class: 'mark on' }, count), h('span', { class: 'count' }, `of ${limit}`));
    return wrap;
  }
  for (let i = 1; i <= slots; i++) {
    const at = colourAt.get(i);
    wrap.append(h('span', { class: `mark${i <= count ? ' on' : ''}${at ? ' at-' + at : ''}` }, i <= count ? '✕' : at ? i : ''));
  }
  if (overLimit) wrap.append(h('span', { class: 'mark over', title: 'Over the limit' }, '+' + overLimit));
  return wrap;
}

export function nextLine(status) {
  if (!status.calls.length) return 'No calls set';
  if (status.next) {
    const left = status.next.call.threshold - status.count;
    return `${plural(left, 'strike')} to ${status.next.call.consequence}`;
  }
  return status.overLimit ? `Over the limit by ${status.overLimit}` : 'At the limit';
}

export function stateLabel(c, status, lastAt) {
  if (c.state === 'due') return 'Call due';
  if (c.state === 'enforced') return `Enforced ${fmtDate(lastAt)}`;
  // Pending means below the threshold. One with past enforcements has re-armed as strikes expired.
  const togo = `${plural(c.call.threshold - status.count, 'strike')} to go`;
  return c.call.enforcements.length ? `Re-armed · ${togo}` : togo;
}

// The thresholds in order, each with its card, consequence and state. `action(c)` may
// return a button for a row (the parent view's Enforce); without it the ladder is read-only.
export function callLadder(status, action) {
  return h('ol', { class: 'ladder' }, status.calls.map(c => {
    const last = c.call.enforcements[c.call.enforcements.length - 1];
    return h('li', { class: 'state-' + c.state },
      h('span', { class: 'cardchip ' + (c.final ? 'red' : 'yellow'), 'aria-hidden': 'true' }),
      h('div', { class: 'body' },
        h('strong', null, c.call.consequence),
        h('span', { class: 'small muted' }, `at ${plural(c.call.threshold, 'strike')}`, ' · '),
        h('span', { class: 'state ' + c.state }, stateLabel(c, status, last && last.at)),
      ),
      action ? action(c) : null,
    );
  }));
}
