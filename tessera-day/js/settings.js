// Settings dialog: tessera length, week start, theme, and data export / import / erase.
import * as M from './model.js';
import * as store from './store.js';
import { $, esc, ask, toast } from './ui.js';

let bound = false;

export function openSettings(app) {
  const dlg = $('#settingsDialog');
  draw(app, dlg);
  if (!bound) { bind(app, dlg); bound = true; }
  dlg.showModal();
}

function draw(app, dlg) {
  const s = app.settings, n = Object.keys(app.data.days).length;
  const opt = (v, label, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
  dlg.innerHTML = `<form method="dialog" class="modal-card settings">
    <h2 class="modal-title">Settings</h2>
    <label class="field"><span>Tessera length</span>
      <select name="quantum">${M.QUANTA.map(q => opt(q, `${q} minutes`, s.quantum)).join('')}</select></label>
    <p class="hint">Used for days you haven't started yet. Days you've already painted keep their own length; open one to convert it.</p>
    <label class="field"><span>Week starts on</span>
      <select name="weekStart">${opt(1, 'Monday', s.weekStart)}${opt(0, 'Sunday', s.weekStart)}</select></label>
    <label class="field"><span>Theme</span>
      <select name="theme">${opt('auto', 'Match system', s.theme)}${opt('light', 'Light', s.theme)}${opt('dark', 'Dark', s.theme)}</select></label>

    <div class="row"><button type="button" class="btn" data-baseline="">Edit weekday baselines</button></div>
    <p class="hint">A typical plan for each weekday. Each day's plan starts from it, and you only paint what's different.</p>

    <h3 class="label section">Data</h3>
    <p class="hint">${n} day${n === 1 ? '' : 's'} recorded. ${store.isPersistent()
      ? 'Saved automatically in this browser.'
      : '<b class="warn">Storage is unavailable, so nothing is being saved. Export to keep your data.</b>'}</p>
    <div class="row">
      <button type="button" class="btn" data-export>⇩ Export JSON</button>
      <button type="button" class="btn" data-import>⇧ Import JSON</button>
      <input type="file" accept="application/json,.json" hidden>
    </div>
    <div class="row"><button type="button" class="btn danger" data-erase>Erase all data</button></div>
    <div class="modal-actions"><button class="btn primary" value="done">Done</button></div>
  </form>`;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bind(app, dlg) {
  dlg.addEventListener('change', async e => {
    const el = e.target, s = app.settings;
    if (el.name === 'quantum') s.quantum = +el.value;
    else if (el.name === 'weekStart') s.weekStart = +el.value;
    else if (el.name === 'theme') s.theme = el.value;
    else if (el.type === 'file' && el.files[0]) {
      const file = el.files[0];
      el.value = '';
      let data;
      try { data = store.parseImport(await file.text()); } catch (err) { toast(err.message); return; }
      const n = Object.keys(data.days).length;
      if (!(await ask(`Replace everything with "${file.name}" (${n} day${n === 1 ? '' : 's'}, ${data.categories.length} categories)? Export first if you want a backup of what's here now.`,
        { title: 'Import data?', ok: 'Replace', danger: true }))) return;
      app.replaceData(data);
      draw(app, dlg);
      toast(`Imported ${n} day${n === 1 ? '' : 's'}`);
      return;
    } else return;
    app.saveMeta();
    app.render();
  });

  dlg.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-export')) {
      download(`tessera-day-${M.todayKey()}.json`, store.exportJSON(app.data));
    } else if (b.hasAttribute('data-import')) {
      dlg.querySelector('input[type=file]').click();
    } else if (b.hasAttribute('data-erase')) {
      if (!(await ask('Delete every day and reset categories and settings to the starter set? This cannot be undone.',
        { title: 'Erase all data?', ok: 'Erase', danger: true }))) return;
      app.replaceData(M.starterData());
      draw(app, dlg);
      toast('All data erased');
    }
  });
}
