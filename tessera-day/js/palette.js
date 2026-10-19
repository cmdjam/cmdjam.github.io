// Category palette: the chip row used to pick what to paint, and the category editor dialog.
import * as M from './model.js';
import { $, esc, ask, toast } from './ui.js';

// restore: offer the baseline brush (plan layers only).
export function paletteHTML(app, { restore = false } = {}) {
  const chips = app.data.categories.map((c, i) =>
    `<button type="button" class="chip${app.ui.cat === c.id ? ' on' : ''}" data-cat="${c.id}" style="--c:${app.color(c.id)}"
       aria-pressed="${app.ui.cat === c.id}" title="${esc(c.name)}${i < 9 ? ` (${i + 1})` : ''}"><i></i>${esc(c.name)}</button>`).join('');
  return `<div class="pal" role="toolbar" aria-label="Categories">${chips}
    <button type="button" class="chip eraser${app.ui.cat === null ? ' on' : ''}" data-cat="" aria-pressed="${app.ui.cat === null}" title="Eraser (0)"><i></i>Eraser</button>
    ${restore ? `<button type="button" class="chip restore${app.ui.cat === M.RESTORE ? ' on' : ''}" data-cat="${M.RESTORE}" aria-pressed="${app.ui.cat === M.RESTORE}"
       title="Paint the baseline back over a range (B)"><i></i>Baseline</button>` : ''}
    <button type="button" class="chip ghost" data-edit title="Add, rename, recolour, reorder or delete categories">✎ Edit</button>
  </div>`;
}

export function bindPalette(app, root) {
  root.querySelector('.pal').addEventListener('click', e => {
    if (e.target.closest('[data-edit]')) return openCategories(app);
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    app.ui.cat = b.dataset.cat || null;
    app.saveUi();
    app.render();
  });
}

// Tiles and days that use each category, across both layers.
function usage(data) {
  const u = {};
  for (const day of Object.values(data.days)) {
    const seen = new Set();
    for (const l of M.LAYERS) for (const v of day[l]) if (v) {
      const x = u[v] || (u[v] = { tiles: 0, days: 0, min: 0 });
      x.tiles++; x.min += day.q;
      if (!seen.has(v)) { seen.add(v); x.days++; }
    }
  }
  return u;
}

// ---------- editor dialog ----------

let bound = false;

export function openCategories(app) {
  const dlg = $('#catDialog');
  draw(app, dlg);
  if (!bound) { bind(app, dlg); bound = true; }
  dlg.showModal();
}

function draw(app, dlg, focusSel) {
  const cats = app.data.categories, u = usage(app.data);
  const used = new Set(cats.map(c => c.color.toUpperCase()));
  const next = M.PRESET_COLORS.find(c => !used.has(c)) || M.PRESET_COLORS[cats.length % M.PRESET_COLORS.length];
  const prevName = dlg.querySelector('#newName')?.value ?? '';
  dlg.innerHTML = `<form method="dialog" class="modal-card catedit">
    <h2 class="modal-title">Categories</h2>
    <ul class="catlist">${cats.map((c, i) => `
      <li data-id="${c.id}">
        <input type="color" class="cc" value="${c.color.toLowerCase()}" aria-label="Colour of ${esc(c.name)}">
        <input type="text" class="cn" value="${esc(c.name)}" maxlength="40" aria-label="Name">
        <span class="use">${u[c.id] ? M.fmtDur(u[c.id].min) : ''}</span>
        <button type="button" class="btn icon small" data-move="-1" aria-label="Move ${esc(c.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn icon small" data-move="1" aria-label="Move ${esc(c.name)} down" ${i === cats.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="btn icon small danger" data-del aria-label="Delete ${esc(c.name)}">✕</button>
      </li>`).join('') || '<li class="none">No categories yet. Add one below.</li>'}
    </ul>
    <div class="addcat">
      <input type="color" id="newColor" value="${next.toLowerCase()}" aria-label="New category colour">
      <input type="text" id="newName" placeholder="New category" maxlength="40" value="${esc(prevName)}">
      <button type="button" class="btn primary" data-add>Add</button>
    </div>
    <div class="swatches" aria-label="Preset colours">${M.PRESET_COLORS.map(c =>
      `<button type="button" data-swatch="${c}" style="--c:${c}" aria-label="Use ${c}"></button>`).join('')}</div>
    <p class="hint">Times are totals across plan and actual. Deleting a category clears its tesserae.</p>
    <div class="modal-actions"><button class="btn primary" value="done">Done</button></div>
  </form>`;
  if (focusSel) dlg.querySelector(focusSel)?.focus();
}

function bind(app, dlg) {
  const cat = el => app.cat(el.closest('li[data-id]')?.dataset.id);
  let frame = 0;
  const live = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => app.render()); };

  dlg.addEventListener('input', e => {
    if (e.target.matches('.cc')) { cat(e.target).color = e.target.value.toUpperCase(); live(); }
  });
  dlg.addEventListener('change', e => {
    const c = e.target.matches('.cc, .cn') && cat(e.target);
    if (!c) return;
    if (e.target.matches('.cn')) {
      const name = e.target.value.trim().slice(0, 40);
      if (name) c.name = name; else e.target.value = c.name;
    }
    app.saveMeta();
    app.render();
  });
  dlg.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('input[type=text]')) return;
    e.preventDefault(); // don't submit (close) the form
    if (e.target.id === 'newName') add();
    else e.target.blur();
  });

  function add() {
    const name = dlg.querySelector('#newName').value.trim().slice(0, 40);
    if (!name) { dlg.querySelector('#newName').focus(); return; }
    const c = { id: M.newId(), name, color: dlg.querySelector('#newColor').value.toUpperCase(), order: app.data.categories.length + 1 };
    app.data.categories.push(c);
    app.ui.cat = c.id;
    dlg.querySelector('#newName').value = '';
    app.saveMeta(); app.saveUi(); app.render();
    draw(app, dlg, '#newName');
  }

  dlg.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.swatch) { dlg.querySelector('#newColor').value = b.dataset.swatch.toLowerCase(); return; }
    if (b.hasAttribute('data-add')) return add();
    const c = cat(b);
    if (!c) return;
    const list = app.data.categories, i = list.indexOf(c);
    if (b.dataset.move) {
      const j = i + +b.dataset.move;
      [list[i], list[j]] = [list[j], list[i]];
      list.forEach((x, k) => { x.order = k + 1; });
      app.saveMeta(); app.render();
      draw(app, dlg, `li[data-id="${c.id}"] [data-move="${b.dataset.move}"]:not(:disabled)`);
    } else if (b.hasAttribute('data-del')) {
      const u = usage(app.data)[c.id];
      if (u && !(await ask(`"${c.name}" is used on ${u.tiles} tesserae across ${u.days} day${u.days === 1 ? '' : 's'}. Deleting it clears them.`,
        { title: 'Delete category?', ok: 'Delete', danger: true }))) return;
      app.deleteCategory(c.id);
      draw(app, dlg);
      toast(`Deleted "${c.name}"`);
    }
  });
}
