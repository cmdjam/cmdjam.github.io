// Pointer painting on a tile grid (tiles are `.t[data-i]` inside `grid`).
// A stroke covers the continuous time range from the first tile to the tile under the pointer;
// moving back shrinks it. A stroke paints, unless it starts on a tile that already has the
// selected category (then it clears that category in the range) or the eraser is selected
// (then it clears everything in the range). Mouse, touch and pen all go through pointer events;
// the CSS sets `touch-action: none` on tiles so dragging paints instead of scrolling.
//
// opts: {
//   getCat()          selected category id, or null for the eraser
//   values()          the layer array as currently stored
//   render(i, v)      show value v on tile i (preview)
//   status(s|null)    s = {a, b, erase, cat} while a stroke is active
//   commit(arr)       stroke finished with changes
// }
export function attachPainter(grid, opts) {
  let st = null;

  const tileAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const t = el && el.closest('.t[data-i]');
    return t && grid.contains(t) ? +t.dataset.i : -1;
  };

  function update(i) {
    if (i === st.cur) return;
    st.cur = i;
    const a = Math.min(st.start, i), b = Math.max(st.start, i);
    for (let j = 0; j < st.base.length; j++) {
      let v = st.base[j];
      if (j >= a && j <= b) v = !st.erase ? st.cat : st.cat == null || v === st.cat ? null : v;
      if (st.out[j] !== v) { st.out[j] = v; opts.render(j, v); }
    }
    opts.status({ a, b, erase: st.erase, cat: st.cat });
  }

  function finish(keep) {
    if (!st) return;
    const s = st;
    st = null;
    opts.status(null);
    const changed = s.out.some((v, j) => v !== s.base[j]);
    if (keep && changed) opts.commit(s.out);
    else if (changed) s.base.forEach((v, j) => { if (s.out[j] !== v) opts.render(j, v); });
  }

  grid.addEventListener('pointerdown', e => {
    if (st || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const t = e.target.closest('.t[data-i]');
    if (!t) return;
    e.preventDefault();
    const i = +t.dataset.i, base = opts.values().slice(), cat = opts.getCat();
    st = { id: e.pointerId, start: i, cur: -1, base, out: base.slice(), cat, erase: cat == null || base[i] === cat };
    try { grid.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    update(i);
  });
  grid.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.id) return;
    const i = tileAt(e.clientX, e.clientY);
    if (i >= 0) update(i);
  });
  grid.addEventListener('pointerup', e => { if (st && e.pointerId === st.id) finish(true); });
  grid.addEventListener('pointercancel', e => { if (st && e.pointerId === st.id) finish(false); });
  grid.addEventListener('lostpointercapture', e => { if (st && e.pointerId === st.id) finish(true); });
  grid.addEventListener('contextmenu', e => e.preventDefault());
}
