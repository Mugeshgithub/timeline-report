// Small hand-built SVG charts and an offline map. No libraries, no network.
(function (TR) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // ---------- tooltip
  let tipEl;
  TR.tip = {
    show(html, x, y) {
      if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
      tipEl.innerHTML = html;
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      let left = x + 16, top = y - h - 12;
      if (left + w > innerWidth - 8) left = x - w - 16;
      if (top < 8) top = y + 18;
      tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
      tipEl.classList.add('on');
    },
    hide() { if (tipEl) tipEl.classList.remove('on'); },
  };
  TR.svgEl = el;

  // rect with only the top corners rounded (data end), anchored to baseline
  function topRounded(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    if (h <= 0) return '';
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function rightRounded(x, y, w, h, r) {
    r = Math.min(r, h / 2, w);
    if (w <= 0) return '';
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }
  const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p; return 10 * p; };

  // Vertical (optionally stacked) bar chart.
  // opts: { cats: [label], series: [{label, color, values}], height, fmt, tipTitle(i), onClick(i) }
  TR.barChart = function (host, opts) {
    host.innerHTML = '';
    const W = Math.max(280, host.clientWidth || 600), Hh = opts.height || 240, padL = 48, padB = 30, padT = 10;
    const svg = el('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: 'img', 'aria-label': opts.label || 'chart' }, host);
    const n = opts.cats.length;
    const totals = opts.cats.map((_, i) => opts.series.reduce((t, s) => t + (s.values[i] || 0), 0));
    const max = niceMax(Math.max.apply(null, totals.concat([0])));
    const plotH = Hh - padB - padT, plotW = W - padL - 4, slot = plotW / n, bw = Math.max(3, Math.min(42, slot * 0.62));
    const y = v => padT + plotH - (v / max) * plotH;
    const hair = css('--hair'), ink3 = css('--ink-3');
    [0, 0.5, 1].forEach(f => {
      el('line', { x1: padL, x2: W, y1: y(max * f), y2: y(max * f), stroke: f === 0 ? css('--hair-2') : hair, 'stroke-width': 1 }, svg);
      const t = el('text', { x: padL - 10, y: y(max * f) + 4, 'text-anchor': 'end', 'font-size': 11, fill: ink3 }, svg);
      t.textContent = (opts.axisFmt || opts.fmt)(max * f);
    });
    const every = Math.ceil(n / Math.floor(plotW / 54));
    opts.cats.forEach((c, i) => {
      const cx = padL + slot * i + slot / 2;
      let base = 0; const segs = opts.series.filter(s => (s.values[i] || 0) > 0);
      segs.forEach((s, j) => {
        const v = s.values[i], y0 = y(base), y1 = y(base + v), top = j === segs.length - 1;
        const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
        if (h > 0) el('path', { d: top ? topRounded(cx - bw / 2, y1, bw, h, 4) : `M${cx - bw / 2},${y1}h${bw}v${h}h${-bw}Z`, fill: s.color }, svg);
        base += v;
      });
      if (i % every === 0) {
        const t = el('text', { x: cx, y: Hh - 10, 'text-anchor': 'middle', 'font-size': 11, fill: ink3 }, svg);
        t.textContent = c;
      }
      const hit = el('rect', { x: padL + slot * i, y: padT, width: slot, height: plotH, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', e => {
        const rows = opts.series.filter(s => s.values[i]).map(s => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:6px"></span>${s.label}: <b>${opts.fmt(s.values[i])}</b>`);
        TR.tip.show(`<b>${opts.tipTitle ? opts.tipTitle(i) : c}</b><br>${rows.join('<br>') || 'Nothing'}${opts.series.length > 1 && rows.length > 1 ? `<br>Total: <b>${opts.fmt(totals[i])}</b>` : ''}`, e.clientX, e.clientY);
      });
      hit.addEventListener('mouseleave', TR.tip.hide);
      if (opts.onClick) { hit.style.cursor = 'pointer'; hit.addEventListener('click', () => opts.onClick(i)); }
    });
  };

  // Horizontal single-series bars with labels.
  TR.hBars = function (host, rows, opts) {
    host.innerHTML = '';
    const W = Math.max(280, host.clientWidth || 500), rowH = 30, labW = opts.labelWidth || 56, valW = 90;
    const Hh = rows.length * rowH;
    const svg = el('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh }, host);
    const max = Math.max.apply(null, rows.map(r => r.v).concat([0.0001]));
    rows.forEach((r, i) => {
      const yy = i * rowH, w = (W - labW - valW) * (r.v / max);
      const t = el('text', { x: 0, y: yy + 19, 'font-size': 13, fill: css('--ink-2') }, svg); t.textContent = r.label;
      el('rect', { x: labW, y: yy + 11, width: W - labW - valW, height: 8, rx: 4, fill: css('--wash') }, svg);
      if (w > 0) el('path', { d: rightRounded(labW, yy + 11, w, 8, 4), fill: opts.color }, svg);
      const v = el('text', { x: W, y: yy + 19, 'text-anchor': 'end', 'font-size': 13, fill: css('--ink') }, svg); v.textContent = opts.fmt(r.v);
      const hit = el('rect', { x: 0, y: yy, width: W, height: rowH, fill: 'transparent' }, svg);
      if (r.tip) { hit.addEventListener('mousemove', e => TR.tip.show(r.tip, e.clientX, e.clientY)); hit.addEventListener('mouseleave', TR.tip.hide); }
    });
  };

  // ---------- offline map
  TR.drawMap = function (host, model) {
    // model: { routes:[{mode, pts:[[lat,lng]], tip}], places:[{lat,lng,h,home,tip}], home:[lat,lng], homeRadiusKm, colors:{mode:css} }
    host.querySelectorAll('svg').forEach(s => s.remove());
    const W = host.clientWidth, Hh = host.clientHeight;
    const svg = el('svg', { viewBox: `0 0 ${W} ${Hh}` });
    host.insertBefore(svg, host.firstChild);
    const r = Math.PI / 180;
    const mx = lng => lng * r, my = lat => -Math.log(Math.tan(Math.PI / 4 + lat * r / 2));
    const all = model.places.map(p => [p.lat, p.lng]);
    model.routes.forEach(rt => rt.pts.forEach(p => all.push(p)));
    if (!all.length) return;
    const xs = all.map(p => mx(p[1])), ys = all.map(p => my(p[0]));
    const bx = [Math.min.apply(null, xs), Math.max.apply(null, xs)], by = [Math.min.apply(null, ys), Math.max.apply(null, ys)];
    const F = Math.min((W - 80) / Math.max(1e-6, bx[1] - bx[0]), (Hh - 80) / Math.max(1e-6, by[1] - by[0]));
    const ox = (W - (bx[1] - bx[0]) * F) / 2 - bx[0] * F, oy = (Hh - (by[1] - by[0]) * F) / 2 - by[0] * F;
    const P = (lat, lng) => [mx(lng) * F + ox, my(lat) * F + oy];
    const g = el('g', {}, svg);
    const gHalo = el('g', {}, g), gRoutes = el('g', {}, g), gPlaces = el('g', {}, g);
    // home radius ring
    const hp = P(model.home[0], model.home[1]);
    const ringR = model.homeRadiusKm / (6371 * Math.cos(model.home[0] * r)) * F;
    el('circle', { cx: hp[0], cy: hp[1], r: ringR, fill: 'none', stroke: css('--hair-2'), 'stroke-dasharray': '3 5', 'vector-effect': 'non-scaling-stroke' }, gHalo);
    const layers = {};
    model.routes.forEach(rt => {
      if (rt.pts.length < 2) return;
      const lg = layers[rt.mode] = layers[rt.mode] || el('g', { 'data-mode': rt.mode }, gRoutes);
      const d = rt.pts.map((p, i) => { const q = P(p[0], p[1]); return (i ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join('');
      const path = el('path', { d, fill: 'none', stroke: model.colors[rt.mode] || model.colors.other, 'stroke-width': 1.6, 'stroke-opacity': 0.72, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }, lg);
      path.addEventListener('mousemove', e => { path.setAttribute('stroke-width', 4); path.setAttribute('stroke-opacity', 1); TR.tip.show(rt.tip, e.clientX, e.clientY); });
      path.addEventListener('mouseleave', () => { path.setAttribute('stroke-width', 1.6); path.setAttribute('stroke-opacity', 0.72); TR.tip.hide(); });
    });
    const dots = [];
    model.places.slice().sort((a, b) => b.h - a.h).forEach(p => {
      const q = P(p.lat, p.lng), base = Math.max(3, Math.min(16, 2.5 + Math.sqrt(p.h) * 1.1));
      const c = el('circle', { cx: q[0], cy: q[1], r: base, fill: p.home ? css('--ink') : css('--ink'), 'fill-opacity': p.home ? 1 : 0.55, stroke: css('--surface'), 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, gPlaces);
      if (p.home) el('circle', { cx: q[0], cy: q[1], r: base + 5, fill: 'none', stroke: css('--ink'), 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, gPlaces);
      dots.push([c, base, p.home ? gPlaces.lastChild : null]);
      c.addEventListener('mousemove', e => TR.tip.show(p.tip, e.clientX, e.clientY));
      c.addEventListener('mouseleave', TR.tip.hide);
    });
    // view state
    let k = 1, tx = 0, ty = 0;
    const scaleEl = host.querySelector('.scalebar');
    function apply() {
      g.setAttribute('transform', `translate(${tx},${ty}) scale(${k})`);
      dots.forEach(([c, b, ring]) => { c.setAttribute('r', b / Math.sqrt(k)); if (ring) ring.setAttribute('r', (b + 5) / Math.sqrt(k)); });
      if (scaleEl) {
        const mPerPx = 6371000 * Math.cos(model.home[0] * r) / (F * k);
        let len = 1; const target = 110 * mPerPx;
        for (const m of [1, 2, 5]) for (let e = 0; e < 8; e++) { const v = m * Math.pow(10, e); if (v <= target) len = Math.max(len, v); }
        scaleEl.innerHTML = `${len >= 1000 ? len / 1000 + ' km' : len + ' m'}<i style="width:${(len / mPerPx).toFixed(0)}px"></i>`;
      }
    }
    function zoomAt(f, sx, sy) { const nk = Math.max(0.5, Math.min(4000, k * f)); tx = sx - (sx - tx) * (nk / k); ty = sy - (sy - ty) * (nk / k); k = nk; apply(); }
    svg.addEventListener('wheel', e => { e.preventDefault(); const b = svg.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - b.left, e.clientY - b.top); }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, tx, ty }; host.classList.add('drag'); svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', e => { if (!drag) return; tx = drag.tx + e.clientX - drag.x; ty = drag.ty + e.clientY - drag.y; apply(); });
    const end = () => { drag = null; host.classList.remove('drag'); };
    svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', e => { const b = svg.getBoundingClientRect(); zoomAt(2, e.clientX - b.left, e.clientY - b.top); });
    function fitTo(cx, cy, halfW) { // screen-space fit around a projected point
      k = Math.max(0.5, Math.min(4000, Math.min(W, Hh) / 2 / halfW)); tx = W / 2 - cx * k; ty = Hh / 2 - cy * k; apply();
    }
    apply();
    return {
      fitAll() { k = 1; tx = 0; ty = 0; apply(); },
      fitHome() { fitTo(hp[0], hp[1], ringR * 1.15); },
      toggle(mode, on) { if (layers[mode]) layers[mode].style.display = on ? '' : 'none'; },
      togglePlaces(on) { gPlaces.style.display = on ? '' : 'none'; },
    };
  };
})(globalThis.TR = globalThis.TR || {});
