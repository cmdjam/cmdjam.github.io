// The app: state, hash routing, views and actions.
//   #/                 the board: every player's rules
//   #/rule/<id>        one rule: marks, call ladder, log a strike, history
//   #/edit/<id>        edit a rule;  #/new/<childId>  a new rule for a player
//   #/players          add, rename, recolour, remove players
//   #/settings         backup: JSON export and import
import * as R from './rules.js';
import { load, save, normalize, uid, COLOURS } from './store.js';
import { h, fmtDate, fmtDateTime, localInputValue, plural, strikeMarks, nextLine, callLadder } from './ui.js';

let data = load();
const app = document.getElementById('app');
const dialog = document.getElementById('dialog');
const toastEl = document.getElementById('toast');
const showArchived = new Set();   // child ids whose archived rules are shown on the board

function commit() {
  if (!save(data)) toast('Could not save: browser storage is full or blocked');
  render();
}

const child = id => data.children.find(c => c.id === id);
const rule = id => data.rules.find(r => r.id === id);

// ---- Toast and dialogs ------------------------------------------------------------------

let toastTimer;
function toast(text, actions = []) {
  clearTimeout(toastTimer);
  toastEl.replaceChildren(h('span', null, text), actions.map(([label, fn]) => h('button', { onclick: () => { hideToast(); fn(); } }, label)));
  toastEl.hidden = false;
  toastTimer = setTimeout(hideToast, 6000);
}
function hideToast() { toastEl.hidden = true; }

// Opens the dialog with `body` (fields) and resolves with the form's FormData on OK, or null.
function ask(title, body, okLabel = 'OK', okClass = 'primary') {
  return new Promise(resolve => {
    const form = h('form', { method: 'dialog' },
      h('h2', null, title),
      body,
      h('div', { class: 'actions' },
        h('button', { type: 'button', onclick: () => dialog.close('') }, 'Cancel'),
        h('button', { class: okClass, value: 'ok' }, okLabel),
      ),
    );
    dialog.replaceChildren(form);
    dialog.onclose = () => resolve(dialog.returnValue === 'ok' ? new FormData(form) : null);
    dialog.returnValue = '';
    dialog.showModal();
    const first = form.querySelector('input,select,textarea');
    if (first) first.focus();
  });
}

// ---- Actions ----------------------------------------------------------------------------

function addStrike(r, at = Date.now(), note = '') {
  const before = R.ruleStatus(r, data.strikes, Date.now());
  const s = { id: uid(), ruleId: r.id, at, note };
  data.strikes.push(s);
  commit();
  const after = R.ruleStatus(r, data.strikes, Date.now());
  const newlyDue = after.due.filter(d => !before.due.some(b => b.call.id === d.call.id));
  const msg = newlyDue.length
    ? `Strike! Call due: ${newlyDue.map(d => d.call.consequence).join(', ')}`
    : `Strike logged · ${plural(after.count, 'strike')}${after.limit ? ' of ' + after.limit : ''}`;
  toast(msg, [
    ['Add note', () => editStrikeNote(s)],
    ['Undo', () => { data.strikes = data.strikes.filter(x => x !== s); commit(); }],
  ]);
}

async function logStrikeWithDetails(r) {
  const fd = await ask(`Strike: ${r.name}`, [
    h('label', null, 'When', h('input', { type: 'datetime-local', name: 'at', value: localInputValue(Date.now()), max: localInputValue(Date.now()), required: true })),
    h('label', null, 'Note (optional)', h('input', { name: 'note', placeholder: 'e.g. both crusts, plus the apple' })),
  ], 'Log strike');
  if (!fd) return;
  const at = new Date(fd.get('at')).getTime();
  if (!Number.isFinite(at)) return;
  addStrike(r, Math.min(at, Date.now()), String(fd.get('note')).trim());
}

async function editStrikeNote(s) {
  const fd = await ask('Note', h('label', null, 'Note', h('input', { name: 'note', value: s.note })), 'Save');
  if (!fd) return;
  s.note = String(fd.get('note')).trim();
  commit();
}

function deleteStrike(s) {
  data.strikes = data.strikes.filter(x => x !== s);
  commit();
  toast('Strike removed', [['Undo', () => { data.strikes.push(s); commit(); }]]);
}

async function enforce(r, call) {
  const fd = await ask(`Enforce: ${call.consequence}`, [
    h('p', { class: 'muted small' }, `${r.name} · ${child(r.childId).name} reached ${plural(call.threshold, 'strike')}. Enforcing records the call; the strikes keep counting.`),
    h('label', null, 'Note (optional)', h('input', { name: 'note', placeholder: 'e.g. told them at dinner, starts Monday' })),
  ], 'Enforce', 'enforce');
  if (!fd) return;
  const e = { at: Date.now(), note: String(fd.get('note')).trim() };
  call.enforcements.push(e);
  commit();
  toast('Call enforced', [['Undo', () => { call.enforcements = call.enforcements.filter(x => x !== e); commit(); }]]);
}

function deleteEnforcement(call, e) {
  call.enforcements = call.enforcements.filter(x => x !== e);
  commit();
  toast('Enforcement removed', [['Undo', () => { call.enforcements.push(e); call.enforcements.sort((a, b) => a.at - b.at); commit(); }]]);
}

async function copyRule(r) {
  const others = data.children.filter(c => c.id !== r.childId);
  if (!others.length) { toast('Add another player first'); return; }
  const fd = await ask(`Copy "${r.name}"`, [
    h('p', { class: 'muted small' }, 'The copy has the same calls and window, and its own empty tally.'),
    h('label', null, 'To player', h('select', { name: 'child' }, others.map(c => h('option', { value: c.id }, c.name)))),
  ], 'Copy');
  if (!fd) return;
  const copy = {
    ...r, id: uid(), childId: String(fd.get('child')), archived: false, createdAt: Date.now(),
    calls: r.calls.map(c => ({ id: uid(), threshold: c.threshold, consequence: c.consequence, enforcements: [] })),
  };
  data.rules.push(copy);
  commit();
  toast(`Copied to ${child(copy.childId).name}`, [['Open', () => go('#/rule/' + copy.id)]]);
}

function deleteRule(r) {
  if (!confirm(`Delete "${r.name}" and its whole history? Archive it instead to keep the record.`)) return;
  data.rules = data.rules.filter(x => x !== r);
  data.strikes = data.strikes.filter(s => s.ruleId !== r.id);
  commit();
  go('#/');
}

const go = hash => { location.hash = hash; };

// ---- Views ------------------------------------------------------------------------------

function ruleCard(r, now) {
  const st = R.ruleStatus(r, data.strikes, now);
  return h('article', { class: 'card rule-card' + (st.due.length ? ' has-due' : '') },
    h('a', { class: 'rule-open', href: '#/rule/' + r.id },
      h('div', { class: 'row spread' }, h('strong', null, r.name), r.archived ? h('span', { class: 'state pending' }, 'Archived') : null),
      h('span', { class: 'small muted' }, R.describeExpiry(r.expiry)),
    ),
    h('div', { class: 'row spread' },
      strikeMarks(st),
      r.archived ? null : h('button', { class: 'strike', onclick: () => addStrike(r) }, '+ Strike'),
    ),
    st.due.length ? st.due.map(d => dueBanner(r, d)) : h('div', { class: 'next muted' }, nextLine(st)),
  );
}

function dueBanner(r, d) {
  return h('div', { class: 'due' },
    h('span', { class: 'cardchip ' + (d.final ? 'red' : 'yellow'), 'aria-hidden': 'true' }),
    h('div', { class: 'what' }, 'Call due: ' + d.call.consequence, h('small', null, `${plural(d.call.threshold, 'strike')} reached`)),
    h('button', { class: 'enforce', onclick: () => enforce(r, d.call) }, 'Enforce'),
  );
}

function boardView() {
  const now = Date.now();
  if (!data.children.length) {
    return h('section', { class: 'card empty' },
      h('h2', null, 'Who are you umpiring?'),
      h('p', { class: 'muted' }, 'Add a player, then set a rule: what counts as a strike, the limit, and the call when it is reached.'),
      h('a', { class: 'btn primary', href: '#/players' }, 'Add a player'),
    );
  }
  return data.children.map(c => {
    const rules = data.rules.filter(r => r.childId === c.id);
    const archived = rules.filter(r => r.archived);
    const visible = rules.filter(r => !r.archived || showArchived.has(c.id));
    const toggle = () => { showArchived.has(c.id) ? showArchived.delete(c.id) : showArchived.add(c.id); render(); };
    return h('section', { class: 'player' },
      h('div', { class: 'player-head' },
        h('span', { class: 'dot', style: { background: c.colour } }),
        h('h2', null, c.name),
        h('a', { class: 'btn', href: '#/new/' + c.id }, '+ Rule'),
      ),
      visible.length ? visible.map(r => ruleCard(r, now)) : h('p', { class: 'muted small' }, 'No rules yet.'),
      archived.length ? h('button', { class: 'link small', onclick: toggle }, showArchived.has(c.id) ? 'Hide archived' : `Show ${plural(archived.length, 'archived rule')}`) : null,
    );
  });
}

function ruleView(r) {
  const now = Date.now();
  const st = R.ruleStatus(r, data.strikes, now);
  const c = child(r.childId);
  const ladderAction = x => {
    if (x.state === 'due') return h('button', { class: 'enforce', onclick: () => enforce(r, x.call) }, 'Enforce');
    if (x.state === 'enforced' && x.final && st.overLimit) return h('button', { class: 'icon small', onclick: () => enforce(r, x.call) }, 'Enforce again');
    return null;
  };
  const items = R.history(r, data.strikes, now);
  return h('div', { class: 'stack' },
    h('div', null, h('a', { href: '#/', class: 'small' }, '← Board')),
    h('section', { class: 'card stack' + (st.due.length ? ' rule-card has-due' : '') },
      h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: c.colour } }), h('span', { class: 'muted small' }, c.name)),
      h('h2', { style: { fontSize: '22px' } }, r.name),
      h('div', { class: 'small muted' }, R.describeExpiry(r.expiry), r.archived ? ' · Archived' : ''),
      strikeMarks(st, { big: true }),
      h('div', { class: 'next' }, `${plural(st.count, 'live strike')} · ${nextLine(st)}`),
      r.archived ? null : h('div', { class: 'row' },
        h('button', { class: 'strike', onclick: () => addStrike(r) }, '+ Strike now'),
        h('button', { onclick: () => logStrikeWithDetails(r) }, 'Strike with date or note…'),
      ),
    ),
    h('h3', null, 'Calls'),
    st.calls.length ? callLadder(st, ladderAction) : h('p', { class: 'muted' }, 'No calls yet. Edit the rule to add one.'),
    h('h3', null, 'History'),
    items.length ? h('ul', { class: 'history card' }, items.map(e => historyItem(r, e, now))) : h('p', { class: 'muted' }, 'Clean sheet so far.'),
    h('h3', null, 'Rule'),
    h('div', { class: 'row' },
      h('a', { class: 'btn', href: '#/edit/' + r.id }, 'Edit'),
      h('button', { onclick: () => copyRule(r) }, 'Copy to player…'),
      h('button', { onclick: () => { r.archived = !r.archived; commit(); } }, r.archived ? 'Unarchive' : 'Archive'),
      h('button', { class: 'danger', onclick: () => deleteRule(r) }, 'Delete'),
    ),
  );
}

function historyItem(r, e, now) {
  if (e.kind === 'enforced') {
    return h('li', { class: 'enforced' },
      h('span', { class: 'ico', 'aria-hidden': 'true' }, '✔'),
      h('div', { class: 'body' },
        h('div', null, h('strong', null, 'Enforced: '), e.call.consequence),
        h('div', { class: 'when' }, fmtDateTime(e.at, now)),
        e.enforcement.note ? h('div', { class: 'note' }, e.enforcement.note) : null,
      ),
      h('button', { class: 'icon', 'aria-label': 'Remove enforcement', onclick: () => deleteEnforcement(e.call, e.enforcement) }, 'Remove'),
    );
  }
  const s = e.strike;
  const expiry = !r.expiry ? '' : e.expired ? ` · expired ${fmtDate(e.expiresAt, now)}` : ` · expires ${fmtDate(e.expiresAt, now)}`;
  return h('li', { class: e.expired ? 'expired' : '' },
    h('span', { class: 'ico', 'aria-hidden': 'true' }, h('span', { class: 'mark' + (e.expired ? '' : ' on') }, '✕')),
    h('div', { class: 'body' },
      h('div', null, h('strong', null, 'Strike')),
      h('div', { class: 'when' }, fmtDateTime(s.at, now) + expiry),
      s.note ? h('div', { class: 'note' }, s.note) : null,
    ),
    h('button', { class: 'icon', 'aria-label': 'Edit note', onclick: () => editStrikeNote(s) }, 'Note'),
    h('button', { class: 'icon', 'aria-label': 'Remove strike', onclick: () => deleteStrike(s) }, 'Remove'),
  );
}

// New or edit. The form works on a draft and writes back on Save.
function editView(existing, childId) {
  const draft = existing
    ? { name: existing.name, childId: existing.childId, expiry: existing.expiry && { ...existing.expiry }, calls: existing.calls.map(c => ({ ...c })) }
    : { name: '', childId, expiry: null, calls: [{ id: uid(), threshold: 3, consequence: '', enforcements: [] }] };

  const callsBox = h('div', { class: 'stack' });
  const drawCalls = () => {
    callsBox.replaceChildren(...draft.calls.map((c, i) => h('div', { class: 'call-edit' },
      h('label', null, 'Strikes', h('input', { type: 'number', min: 1, max: 999, value: c.threshold, required: true, oninput: e => { c.threshold = Math.round(+e.target.value); } })),
      h('label', null, i === 0 ? 'Call (consequence)' : 'Then', h('input', { value: c.consequence, required: true, placeholder: i === 0 ? 'e.g. hot school lunches instead' : 'e.g. no packed lunch all term', oninput: e => { c.consequence = e.target.value; } })),
      h('button', { type: 'button', class: 'icon', 'aria-label': 'Remove call', disabled: draft.calls.length === 1, onclick: () => { draft.calls.splice(i, 1); drawCalls(); } }, '✕'),
    )));
  };
  drawCalls();

  const amount = h('input', { type: 'number', min: 1, max: 999, value: draft.expiry ? draft.expiry.amount : 4, oninput: e => { if (draft.expiry) draft.expiry.amount = Math.round(+e.target.value); } });
  const unit = h('select', { onchange: e => { if (draft.expiry) draft.expiry.unit = e.target.value; } }, R.UNITS.map(u => h('option', { value: u, selected: draft.expiry && draft.expiry.unit === u }, u + 's')));
  const rolling = h('div', { class: 'row', hidden: !draft.expiry }, h('span', { class: 'small muted' }, 'Each strike counts for'), amount, unit);
  if (!draft.expiry) unit.value = 'week';
  const windowSel = h('select', {
    onchange: e => {
      draft.expiry = e.target.value === 'never' ? null : { amount: Math.round(+amount.value) || 1, unit: unit.value };
      rolling.hidden = !draft.expiry;
    },
  }, h('option', { value: 'never', selected: !draft.expiry }, 'Never: strikes count forever'), h('option', { value: 'rolling', selected: !!draft.expiry }, 'Rolling: strikes expire'));

  const onsubmit = e => {
    e.preventDefault();
    const calls = draft.calls.filter(c => c.threshold >= 1 && c.consequence.trim());
    const thresholds = calls.map(c => c.threshold);
    if (!draft.name.trim() || !calls.length) { toast('Give the rule a name and at least one call'); return; }
    if (new Set(thresholds).size !== thresholds.length) { toast('Each call needs a different number of strikes'); return; }
    const fields = { name: draft.name.trim(), childId: draft.childId, expiry: draft.expiry, calls: calls.map(c => ({ ...c, consequence: c.consequence.trim() })) };
    if (existing) Object.assign(existing, fields);
    else data.rules.push({ id: uid(), archived: false, createdAt: Date.now(), ...fields });
    data = normalize(data);
    commit();
    go('#/rule/' + (existing ? existing.id : data.rules[data.rules.length - 1].id));
  };

  return h('form', { class: 'stack', onsubmit },
    h('div', null, h('a', { href: existing ? '#/rule/' + existing.id : '#/', class: 'small' }, '← Back')),
    h('section', { class: 'card stack' },
      h('h2', null, existing ? 'Edit rule' : 'New rule'),
      h('label', null, 'Player', h('select', { onchange: e => { draft.childId = e.target.value; } }, data.children.map(c => h('option', { value: c.id, selected: c.id === draft.childId }, c.name)))),
      h('label', null, 'What counts as a strike?', h('input', { value: draft.name, required: true, placeholder: 'e.g. Crusts left in lunchbox', oninput: e => { draft.name = e.target.value; } })),
      h('label', null, 'Window', windowSel),
      rolling,
    ),
    h('section', { class: 'card stack' },
      h('h2', null, 'Calls'),
      h('p', { class: 'small muted', style: { margin: 0 } }, 'What happens at each limit. Add more to escalate; the highest is the final (red card) call.'),
      callsBox,
      h('div', null, h('button', { type: 'button', onclick: () => {
        const top = Math.max(0, ...draft.calls.map(c => c.threshold));
        draft.calls.push({ id: uid(), threshold: top + 2, consequence: '', enforcements: [] });
        drawCalls();
      } }, '+ Escalate')),
      existing ? h('p', { class: 'small muted', style: { margin: 0 } }, 'Changing a limit re-checks what is due. Past enforcements stay in the history.') : null,
    ),
    h('div', { class: 'row' }, h('button', { class: 'primary' }, existing ? 'Save' : 'Create rule')),
  );
}

function playersView() {
  const add = async () => {
    const fd = await ask('New player', h('label', null, 'Name', h('input', { name: 'name', required: true, maxLength: 60 })), 'Add');
    const name = fd && String(fd.get('name')).trim();
    if (!name) return;
    const used = new Set(data.children.map(c => c.colour));
    data.children.push({ id: uid(), name, colour: COLOURS.find(c => !used.has(c)) || COLOURS[data.children.length % COLOURS.length], order: data.children.length });
    commit();
  };
  const remove = c => {
    const n = data.rules.filter(r => r.childId === c.id).length;
    if (!confirm(`Remove ${c.name}${n ? ` and their ${plural(n, 'rule')} with all history` : ''}?`)) return;
    const ruleIds = new Set(data.rules.filter(r => r.childId === c.id).map(r => r.id));
    data.children = data.children.filter(x => x !== c);
    data.rules = data.rules.filter(r => !ruleIds.has(r.id));
    data.strikes = data.strikes.filter(s => !ruleIds.has(s.ruleId));
    commit();
  };
  return h('div', { class: 'stack' },
    h('div', null, h('a', { href: '#/', class: 'small' }, '← Board')),
    h('h2', null, 'Players'),
    data.children.map(c => h('section', { class: 'card stack' },
      h('label', null, 'Name', h('input', { value: c.name, maxLength: 60, onchange: e => { c.name = e.target.value.trim() || c.name; commit(); } })),
      h('div', { class: 'swatches', role: 'group', 'aria-label': 'Colour' }, COLOURS.map(col => h('button', {
        class: 'swatch', style: { background: col }, 'aria-label': col, 'aria-pressed': String(c.colour === col),
        onclick: () => { c.colour = col; commit(); },
      }))),
      h('div', null, h('button', { class: 'danger', onclick: () => remove(c) }, 'Remove player')),
    )),
    h('div', null, h('button', { class: 'primary', onclick: add }, '+ Add player')),
  );
}

function settingsView() {
  const json = () => JSON.stringify({ app: 'umpire', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2);
  const area = h('textarea', { placeholder: 'Paste a backup here to import it' });
  const download = () => {
    const a = h('a', { href: URL.createObjectURL(new Blob([json()], { type: 'application/json' })), download: `umpire-${localInputValue(Date.now()).slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const copy = () => navigator.clipboard.writeText(json()).then(() => toast('Backup copied'), () => { area.value = json(); toast('Copied into the box below instead'); });
  const restore = text => {
    let parsed;
    try { parsed = JSON.parse(text); } catch { toast('That is not valid JSON'); return; }
    const next = normalize(parsed);
    if (!confirm(`Replace everything here with ${plural(next.children.length, 'player')}, ${plural(next.rules.length, 'rule')} and ${plural(next.strikes.length, 'strike')}?`)) return;
    const prev = data;
    data = next;
    commit();
    toast('Backup imported', [['Undo', () => { data = prev; commit(); }]]);
  };
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: e => { const f = e.target.files[0]; if (f) f.text().then(restore); e.target.value = ''; } });
  return h('div', { class: 'stack' },
    h('div', null, h('a', { href: '#/', class: 'small' }, '← Board')),
    h('h2', null, 'Backup'),
    h('section', { class: 'card stack' },
      h('p', { class: 'small muted', style: { margin: 0 } }, 'Everything is stored in this browser only. Export a backup to keep it safe or move it to another device.'),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: download }, 'Download backup'), h('button', { onclick: copy }, 'Copy backup')),
    ),
    h('section', { class: 'card stack' },
      h('h2', null, 'Import'),
      area,
      h('div', { class: 'row' }, h('button', { onclick: () => restore(area.value) }, 'Import pasted'), h('button', { onclick: () => file.click() }, 'Import file…'), file),
    ),
  );
}

// ---- Routing ----------------------------------------------------------------------------

function render() {
  const [, view, id] = (location.hash || '#/').split('/');
  // Re-rendering a form would drop what is being typed, so forms render once per visit.
  if ((view === 'edit' || view === 'new') && app.dataset.route === location.hash) return;
  let out;
  if (view === 'rule' && rule(id)) out = ruleView(rule(id));
  else if (view === 'edit' && rule(id)) out = editView(rule(id));
  else if (view === 'new' && child(id)) out = editView(null, id);
  else if (view === 'players') out = playersView();
  else if (view === 'settings') out = settingsView();
  else out = boardView();
  app.dataset.route = location.hash;
  app.replaceChildren(...[out].flat());
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
// Strikes expire with time, so keep the counts current while the app stays open.
setInterval(() => { if (!dialog.open && document.visibilityState === 'visible') render(); }, 60_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
// Another tab saved: pick up its data.
window.addEventListener('storage', () => { data = load(); render(); });
render();

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered', e));
}
