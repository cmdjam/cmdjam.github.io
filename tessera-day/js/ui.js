// Small DOM helpers shared by the views.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);

// Category colours are stored once; in dark mode they're lifted towards white so they don't sink.
export function tint(hex, dark) {
  if (!dark) return hex;
  const n = parseInt(hex.slice(1), 16), k = 0.22;
  const ch = s => Math.round(((n >> s) & 255) * (1 - k) + 255 * k);
  return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('');
}

let toastTimer;
export function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : '');
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.run(); };
  // A popover sits in the top layer, so the toast shows above open dialogs too.
  if (el.showPopover) { try { el.hidePopover(); } catch { /* not open */ } el.showPopover(); }
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2600);
}

// Promise-based confirm in a <dialog>. Resolves true when the user confirms.
export function ask(message, { ok = 'OK', danger = false, title = '' } = {}) {
  const dlg = $('#askDialog');
  dlg.innerHTML = `<form method="dialog" class="modal-card">
      ${title ? `<h2 class="modal-title">${esc(title)}</h2>` : ''}
      <p class="modal-body">${esc(message)}</p>
      <div class="modal-actions">
        <button class="btn" value="no">Cancel</button>
        <button class="btn ${danger ? 'danger-solid' : 'primary'}" value="yes">${esc(ok)}</button>
      </div></form>`;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise(res => dlg.addEventListener('close', () => res(dlg.returnValue === 'yes'), { once: true }));
}
