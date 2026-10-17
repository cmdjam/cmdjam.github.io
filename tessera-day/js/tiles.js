// Canvas rendering of day mosaics, shared by the week and mosaic views.
// Work happens in device pixels so tile edges land on whole pixels at any zoom.
// Bevel size rule (same as the CSS): tiles at least 6 CSS px tall get a 1px gap and a bevel;
// smaller tiles are drawn flat and edge to edge so the mosaic reads as one picture.

export const BEVEL_MIN = 6;

export function setupCanvas(cv, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(cssW * dpr);
  cv.height = Math.round(cssH * dpr);
  cv.style.width = cssW + 'px';
  cv.style.height = cssH + 'px';
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  return { g, dpr };
}

// Theme colours the canvas needs, read once per render from the CSS variables.
export function paintStyle(app, el = document.documentElement) {
  const cs = getComputedStyle(el);
  const v = n => cs.getPropertyValue(n).trim();
  return { empty: v('--empty'), hi: v('--hi'), lo: v('--lo'), ink: v('--ink'), color: id => app.color(id) };
}

// Draw one day's layer into the device-pixel rect (x, y, w, h). `day` may be null (empty day).
export function drawDay(g, dpr, x, y, w, h, day, layer, st, fallbackQ = 60) {
  const q = day ? day.q : fallbackQ, arr = day ? day[layer] : null;
  const cols = 60 / q, tw = w / cols, th = h / 24;
  const big = th / dpr >= BEVEL_MIN;
  if (!arr && !big) { g.fillStyle = st.empty; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); return; }
  const gap = big ? Math.max(1, Math.round(dpr)) : 0;
  const hi = Math.max(1, Math.round(dpr)), lo = Math.max(1, Math.round(2 * dpr));
  for (let r = 0; r < 24; r++) {
    const y0 = Math.round(y + r * th), y1 = Math.round(y + (r + 1) * th) - gap;
    for (let c = 0; c < cols; c++) {
      const x0 = Math.round(x + c * tw), x1 = Math.round(x + (c + 1) * tw) - gap;
      const v = arr && arr[r * cols + c];
      g.fillStyle = v ? st.color(v) : st.empty;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (big && v) {
        g.fillStyle = st.hi; g.fillRect(x0, y0, x1 - x0, hi);
        g.fillStyle = st.lo; g.fillRect(x0, y1 - lo, x1 - x0, lo);
      }
    }
  }
}
