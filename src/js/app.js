// UI: intro → setup questions → review → report. All state stays in this browser tab (and localStorage).
(function (TR) {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const U = TR.util, H = U.H, DAY = U.DAY;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MODE_LABEL = { car: 'Car', bike: 'Motorbike', bus: 'Bus', train: 'Train', cycle: 'Bicycle', walk: 'Walking', flight: 'Flight', other: 'Other', ignore: 'Not a trip' };
  const MODE_COLOR = m => `var(--mode-${m === 'ignore' ? 'other' : m})`;
  const USER_MODES = ['car', 'bike', 'bus', 'train', 'cycle', 'walk'];

  const st = { raw: null, data: null, stays: [], stayIdx: 0, S: null, edits: null, stayNames: {}, step: 0, r: null, sample: false };

  // ---------- formatting
  const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  const n0 = v => nf0.format(Math.round(v || 0));
  const n1 = v => nf1.format(v || 0);
  const money = v => esc(st.S.currency) + n0(v);
  const loc = ms => new Date(ms + st.S.off * 60000);
  const fmt = (ms, o) => new Intl.DateTimeFormat(undefined, Object.assign({ timeZone: 'UTC' }, o)).format(loc(ms));
  const dShort = ms => fmt(ms, { day: 'numeric', month: 'short' });
  const dLong = ms => fmt(ms, { day: 'numeric', month: 'long', year: 'numeric' });
  const tHM = ms => fmt(ms, { hour: '2-digit', minute: '2-digit', hour12: false });
  const keyDate = (key, o) => new Intl.DateTimeFormat(undefined, Object.assign({ timeZone: 'UTC' }, o)).format(new Date(key + 'T00:00:00Z'));
  const hm = h => h === null ? '–' : `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
  const dur = h => h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${n1(h)} h` : `${n1(h / 24)} days`;
  const offLabel = off => `UTC${off >= 0 ? '+' : '−'}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? ':' + String(Math.abs(off) % 60).padStart(2, '0') : ''}`;
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
  const plural = (n, w, p) => `${n0(n)} ${n === 1 ? w : (p || w + 's')}`;

  // ---------- persistence
  const storeKey = () => 'timeline-report:v2:' + st.data.fingerprint;
  function save() {
    if (st.sample) return;
    try { localStorage.setItem(storeKey(), JSON.stringify({ S: st.S, edits: st.edits, stayNames: st.stayNames, stayIdx: st.stayIdx, mapView: st.mapView })); } catch (e) { /* storage full or blocked */ }
  }
  function restore() {
    try { const v = JSON.parse(localStorage.getItem(storeKey()) || 'null'); return v && v.S ? v : null; } catch (e) { return null; }
  }

  // ---------- screens
  function show(id) {
    ['intro', 'setup', 'report'].forEach(s => $('#' + s).classList.toggle('hidden', s !== id));
    window.scrollTo(0, 0);
  }

  // ---------- intro
  function initIntro() {
    const drop = $('#drop'), input = $('#file');
    ['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', ev => { const f = ev.dataTransfer.files[0]; if (f) readFile(f); });
    input.addEventListener('change', () => { if (input.files[0]) readFile(input.files[0]); });
    $('#try-sample').addEventListener('click', () => load(TR.makeSample(), true));
    $('#how-toggle').addEventListener('click', () => $('#howto').classList.toggle('hidden'));
  }
  function readFile(f) {
    const drop = $('#drop'); drop.classList.add('busy'); $('#drop-big').textContent = 'Reading ' + f.name + '…';
    const rd = new FileReader();
    rd.onload = () => {
      try { load(JSON.parse(rd.result), false); }
      catch (e) { fail(e instanceof SyntaxError ? 'That file isn\'t valid JSON. Pick the Timeline.json exported from Google Maps.' : e.message); }
    };
    rd.onerror = () => fail('Couldn\'t read that file.');
    rd.readAsText(f);
  }
  function fail(msg) {
    const drop = $('#drop'); drop.classList.remove('busy'); $('#drop-big').textContent = 'Drop your Timeline.json here';
    $('#error').textContent = msg; $('#error').classList.remove('hidden');
  }

  function load(json, sample) {
    let data;
    try { data = TR.parseTimeline(json); } catch (e) { fail(e.message); return; }
    st.data = data; st.sample = sample;
    st.stays = TR.findStays(data);
    if (!st.stays.length) { fail('We couldn\'t find any visits in this file.'); return; }
    const saved = sample ? null : restore();
    if (saved) {
      Object.assign(st, { S: saved.S, edits: saved.edits, stayNames: saved.stayNames || {}, stayIdx: Math.min(saved.stayIdx || 0, st.stays.length - 1), mapView: saved.mapView || null });
      buildReport();
      return;
    }
    st.S = TR.defaultSettings();
    st.S.currency = null; setCurrency(guessCurrency());
    st.edits = { modes: {}, placeNames: {}, areaNames: {} };
    st.stayNames = {};
    if (sample) {
      ['London', 'Porto', 'London'].forEach((n, i) => { st.stayNames[i] = n; });
      setCurrency('€'); st.S.vehicles.car.kmpl = 16; st.S.vehicles.bike.kmpl = 40;
      const ids = new Set(data.segs.filter(s => s.kind === 'visit').map(s => s.placeId));
      ids.forEach(id => { const m = id.match(/^ChIJsample\d{4}(\w+)$/); if (m && m[1] !== 'home') { const n = m[1][0].toUpperCase() + m[1].slice(1); st.edits.placeNames[id] = n; st.edits.areaNames[id] = n; } });
    }
    const recent = st.stays.map((s, i) => i).filter(i => st.stays[i].days >= 14);
    st.stayIdx = recent.length ? recent[recent.length - 1] : st.stays.reduce((b, s, i) => (s.hours > st.stays[b].hours ? i : b), 0);
    pickStay(st.stayIdx);
    show('setup'); renderSetup();
  }
  const PRICE_DEFAULTS = { '₹': { fuel: 103, home: 8, pub: 20 }, '€': { fuel: 1.75, home: 0.25, pub: 0.55 }, '$': { fuel: 1, home: 0.16, pub: 0.45 }, '£': { fuel: 1.45, home: 0.25, pub: 0.7 } };
  function setCurrency(c) {
    const S = st.S, was = PRICE_DEFAULTS[S.currency], now = PRICE_DEFAULTS[c];
    S.currency = c;
    if (!now) return;
    const same = (v, k) => !was || Math.abs(v - was[k]) < 1e-9;
    ['car', 'bike'].forEach(m => { if (same(S.vehicles[m].price, 'fuel')) S.vehicles[m].price = now.fuel; });
    if (same(S.ev.homeRate, 'home')) S.ev.homeRate = now.home;
    if (same(S.ev.publicRate, 'pub')) S.ev.publicRate = now.pub;
  }
  function guessCurrency() {
    const l = (navigator.language || '').toLowerCase();
    if (/-in$|^hi|^ta|^te|^ml|^kn|^bn|^mr/.test(l)) return '₹';
    if (/-gb$/.test(l)) return '£';
    if (/-us$|-ca$|-au$/.test(l)) return '$';
    return '€';
  }
  function pickCustom(from, to) {
    if (!from || !to || to < from) return false;
    const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z') + DAY;
    let best = -Infinity, bi = st.stayIdx;
    st.stays.forEach((s, i) => { const ov = Math.min(b, s.end) - Math.max(a, s.start); if (ov > best) { best = ov; bi = i; } });
    const stay = st.stays[bi];
    st.stayIdx = bi;
    Object.assign(st.S, { off: stay.off, home: TR.detectHome(st.data, stay), start: a - stay.off * 60000, end: b - stay.off * 60000, custom: { from, to } });
    return true;
  }
  const spansStays = () => st.stays.filter(s => s.end > st.S.start && s.start < st.S.end).length > 1;
  const isoDay = ms => loc(ms).toISOString().slice(0, 10);
  function pickStay(i) {
    st.stayIdx = i;
    st.S.custom = null;
    const stay = st.stays[i];
    const home = TR.detectHome(st.data, stay), w = TR.defaultWindow(st.data, stay, home);
    Object.assign(st.S, { off: stay.off, home, start: w.start, end: w.end });
  }

  // ---------- setup: one page of plain questions
  // Candidate homes: places in range, with spots under 250 m apart merged (Google often splits one home in two),
  // and a count of the nights you were there at 3 am.
  function homeCandidates(range) {
    const P = {}, vs = st.data.segs.filter(s => s.kind === 'visit' && s.level === 0 && s.end > range.start && s.start < range.end);
    vs.forEach(s => {
      const p = P[s.placeId] = P[s.placeId] || { id: s.placeId, lat: s.lat, lng: s.lng, h: 0, n: 0 };
      p.h += (Math.min(s.end, range.end) - Math.max(s.start, range.start)) / H; p.n++;
    });
    const groups = [], of = {};
    Object.values(P).sort((a, b) => b.h - a.h).forEach(p => {
      const g = groups.find(g => U.hav([g.lat, g.lng], [p.lat, p.lng]) < 0.25);
      if (g) { g.h += p.h; g.n += p.n; g.ids.push(p.id); of[p.id] = g; }
      else { const ng = { lat: p.lat, lng: p.lng, h: p.h, n: p.n, ids: [p.id], nights: 0 }; groups.push(ng); of[p.id] = ng; }
    });
    let nights = 0;
    for (let t = U.dayStart(U.dayKey(range.start, st.S.off), st.S.off) + 3 * H; t < range.end; t += DAY) {
      if (t < range.start) continue;
      nights++;
      const v = vs.find(s => s.start <= t && t < s.end);
      if (v && of[v.placeId]) of[v.placeId].nights++;
    }
    groups.sort((a, b) => b.nights - a.nights || b.h - a.h);
    return { groups, nights };
  }
  const mapsLink = (lat, lng) => `<a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" rel="noopener noreferrer">See on Google Maps ↗</a>`;
  function rawModeStats() {
    const o = {};
    st.data.segs.forEach(s => {
      if (s.kind !== 'move' || s.start < st.S.start || s.start >= st.S.end) return;
      const m = o[s.mode] = o[s.mode] || { n: 0, km: 0 }; m.n++; m.km += s.km;
    });
    return o;
  }
  const QA = (n, q, hint, body) => `<section class="qa"><h3 class="qa-q"><span class="qa-n">${n}</span>${q}</h3>${hint ? `<p class="qa-hint">${hint}</p>` : ''}${body}</section>`;
  const numField = (id, label, val, unit) => `<div class="field"><label>${label}<small class="warn" id="${id}-warn"></small></label><div class="ctl"><input type="number" id="${id}" value="${val}" min="0" step="any"><span class="unit">${unit}</span></div></div>`;
  const SANE = { 'car-kmpl': [5, 35, 'Most cars do 8–30 km on a litre. Is this the motorbike’s figure?'], 'bike-kmpl': [15, 120, 'Most motorbikes do 25–90 km on a litre.'] };
  function checkSane(id, v) {
    const w = $('#' + id + '-warn'), r = SANE[id]; if (!w || !r) return;
    w.textContent = v < r[0] || v > r[1] ? r[2] : '';
  }
  const CHECK_MODES = ['bike', 'bus', 'train', 'cycle'];
  const MODE_PLAIN = { bike: 'By motorbike', bus: 'By bus', train: 'By train', cycle: 'By bicycle' };

  function renderSetup() {
    const S = st.S, host = $('#setup-body');
    const isoD = (ms, off) => new Date(ms + off * 60000).toISOString().slice(0, 10);
    // 1 — dates
    const trips = st.stays.map((s, i) => ({ s, i })).filter(x => x.s.days >= 2).reverse();
    const fmtD = (ms, off) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms + off * 60000));
    const tripRows = trips.map(({ s, i }) => `<div class="choice ${i === st.stayIdx && !S.custom ? 'on' : ''}" data-stay="${i}" role="button" tabindex="0"><span class="dot"></span>
      <span><div class="t1">${fmtD(s.start, s.off)} – ${fmtD(s.end, s.off)}</div><div class="t2">${plural(s.days, 'day')}${stayName(i) ? ' · ' + esc(stayName(i)) : ''}</div></span><span class="aside"></span></div>`).join('');
    const custom = `<div class="choice ${S.custom ? 'on' : ''}" data-stay="custom" role="button" tabindex="0"><span class="dot"></span><span><div class="t1">Other dates</div><div class="t2">Choose any start and end date</div></span><span class="aside"></span></div>`;
    const customFields = S.custom ? `<div class="pair"><label>From <input type="date" id="c-from" min="${isoD(st.data.first, S.off)}" max="${isoD(st.data.last, S.off)}" value="${S.custom.from}"></label><label>To <input type="date" id="c-to" min="${isoD(st.data.first, S.off)}" max="${isoD(st.data.last, S.off)}" value="${S.custom.to}"></label></div>` : '';
    const q1 = QA(1, 'Which dates?', 'Each line is one trip in your file, split where you took a flight.', `<div class="choices">${tripRows}${custom}</div>${customFields}`);
    // 2 — car
    const cur = ['₹', '€', '$', '£'];
    const q2 = QA(2, 'Your car', 'Used only to work out what you spent on petrol.',
      `${numField('car-kmpl', 'How many km does it do on one litre?', S.vehicles.car.kmpl, 'km')}
       ${numField('car-price', 'What does a litre of petrol cost?', S.vehicles.car.price, esc(S.currency))}
       <div class="cur">Currency ${cur.map(c => `<button class="chip ${S.currency === c ? 'on' : ''}" data-cur="${c}">${c}</button>`).join('')}</div>`);
    // 3 — Google's guesses
    const stats = rawModeStats();
    const rows = CHECK_MODES.filter(m => stats[m] && stats[m].km >= 1).map(m => {
      const yes = S.modesUsed[m] !== false;
      return `<div class="mq"><div class="mq-l"><div class="mq-t">${MODE_PLAIN[m]}</div><div class="mq-s">${plural(stats[m].n, 'journey')} · ${n0(stats[m].km)} km</div></div>
        <div class="seg"><button class="chip ${yes ? 'on' : ''}" data-used="${m}:1">Yes, that’s right</button><button class="chip ${yes ? '' : 'on'}" data-used="${m}:0">No, it was my car</button></div>
        ${m === 'bike' && yes ? `<div class="mq-more">${numField('bike-kmpl', 'How many km does the motorbike do on one litre?', S.vehicles.bike.kmpl, 'km')}${numField('bike-price', 'Petrol price for the motorbike', S.vehicles.bike.price, esc(S.currency))}</div>` : ''}</div>`;
    }).join('');
    const q3 = rows ? QA(3, 'Did you really travel like this?', 'Google guesses how you got around, and often gets it wrong. Answer “No” for anything you didn’t do, and we’ll count those journeys as your car.', rows) : '';
    // more options
    const { groups, nights } = homeCandidates(S.custom ? { start: S.start, end: S.end } : st.stays[st.stayIdx]);
    const curH = [S.home.lat, S.home.lng];
    const homeRows = groups.slice(0, 5).map(g => {
      const on = U.hav([g.lat, g.lng], curH) < 0.25, nm = g.ids.map(id => st.edits.placeNames[id]).find(Boolean);
      const t = nm ? esc(nm) : g.nights ? `Slept here ${g.nights} of ${nights} nights` : `${n0(g.h)} hours here`;
      return `<div class="choice ${on ? 'on' : ''}" data-home="${g.lat},${g.lng}" role="button" tabindex="0"><span class="dot"></span><span><div class="t1">${t}</div><div class="t2">${esc(autoPlace(g.lat, g.lng))} · ${mapsLink(g.lat, g.lng)}</div></span><span class="aside"></span></div>`;
    }).join('');
    const more = `<details class="more" id="more"><summary>More options</summary>
      <div class="sub-q">Home</div><p class="qa-hint">We picked the place you slept most. Time at home and trips away are measured from here.</p><div class="choices">${homeRows}</div>
      <div class="sub-q">What counts as a trip away?</div><p class="qa-hint">Going further than <b id="rad-v">${S.radiusKm} km</b> from home.</p><input type="range" id="rad" min="5" max="100" step="5" value="${S.radiusKm}" aria-label="Distance">
      <div class="sub-q">Electric car comparison</div>
      ${numField('ev-eff', 'Km per unit of electricity (kWh)', S.ev.kmPerKwh, 'km')}
      ${numField('ev-home', 'Price of a unit at home', S.ev.homeRate, esc(S.currency))}
      ${numField('ev-public', 'Price of a unit at a fast charger', S.ev.publicRate, esc(S.currency))}
      ${numField('ev-share', 'How much charging happens at home', Math.round(S.ev.homeShare * 100), '%')}
    </details>`;
    const wasOpen = $('#more') && $('#more').open;
    host.innerHTML = `<div class="step narrow"><div class="q-num">Before your report</div><h2 class="question">A few quick questions.</h2><p class="hint">So the numbers come out right. Everything else we work out for you, and you can change any answer later.</p>${q1}${q2}${q3}${more}</div>`;
    if (wasOpen) $('#more').open = true;
    bindSetup(host);
  }

  function bindSetup(host) {
    const S = st.S;
    host.onclick = e => {
      if (e.target.closest('a, summary, input')) return;
      const t = e.target.closest('[data-stay]');
      if (t) { if (t.dataset.stay === 'custom') { if (!S.custom) pickCustom(isoDay(S.start), isoDay(S.end - 1)); } else pickStay(+t.dataset.stay); renderSetup(); return; }
      const c = e.target.closest('[data-cur]'); if (c) { setCurrency(c.dataset.cur); renderSetup(); return; }
      const u = e.target.closest('[data-used]');
      if (u) { const [m, v] = u.dataset.used.split(':'); S.modesUsed[m] = v === '1'; renderSetup(); return; }
      const h = e.target.closest('[data-home]');
      if (h) { const [lat, lng] = h.dataset.home.split(',').map(Number); S.home = { lat, lng }; if (!S.custom) { const w = TR.defaultWindow(st.data, st.stays[st.stayIdx], S.home); S.start = w.start; S.end = w.end; } renderSetup(); }
    };
    const cf = $('#c-from', host), ct = $('#c-to', host);
    if (cf) [cf, ct].forEach(i => i.addEventListener('change', () => { if (pickCustom(cf.value, ct.value)) renderSetup(); }));
    const bind = (id, fn) => { const i = $('#' + id, host); if (!i) return; checkSane(id, parseFloat(i.value)); i.addEventListener('input', () => { const v = parseFloat(i.value); checkSane(id, v); if (!isNaN(v) && v > 0) fn(v); }); };
    bind('car-kmpl', v => { S.vehicles.car.kmpl = v; }); bind('car-price', v => { S.vehicles.car.price = v; });
    bind('bike-kmpl', v => { S.vehicles.bike.kmpl = v; }); bind('bike-price', v => { S.vehicles.bike.price = v; });
    bind('ev-eff', v => { S.ev.kmPerKwh = v; }); bind('ev-home', v => { S.ev.homeRate = v; }); bind('ev-public', v => { S.ev.publicRate = v; });
    bind('ev-share', v => { S.ev.homeShare = Math.min(100, v) / 100; });
    const rad = $('#rad', host); rad.addEventListener('input', () => { S.radiusKm = +rad.value; $('#rad-v').textContent = rad.value + ' km'; });
  }

  const primaryReason = f => ['stationary', 'too-fast', 'reassigned', 'unsure'].find(x => f.reasons.includes(x));
  function flagRow(f) {
    const m = f.m, s = m.seg;
    const cur = TR.effectiveMode(s, st.S, st.edits);
    const why = `Google said <strong>${MODE_LABEL[s.mode].toLowerCase()}</strong>${s.prob < 1 ? ` (${Math.round(s.prob * 100)}% sure)` : ''} · ${n1(m.km)} km in ${dur(f.h)}${f.speed ? ` · ${n0(f.speed)} km/h` : ''}`;
    return `<div class="flag"><div class="when"><b>${dShort(m.st)}</b>${tHM(m.st)}–${tHM(m.en)}</div><div class="what">${why}</div>${chips(s.id, cur)}</div>`;
  }
  function chips(id, cur) {
    const opts = USER_MODES.filter(m => st.S.modesUsed[m] !== false || m === cur).concat(['ignore']);
    if (!opts.includes(cur)) opts.unshift(cur);
    return `<div class="modechips" data-seg="${id}">${opts.map(m => `<button class="chip ${m === cur ? 'on' : ''}" data-set="${m}">${MODE_LABEL[m]}</button>`).join('')}</div>`;
  }
  function applySuggestions(r) {
    r.flags.forEach(f => {
      if (st.edits.modes[f.id] === undefined && (f.reasons.includes('stationary') || f.reasons.includes('too-fast')) && f.suggest) st.edits.modes[f.id] = f.suggest;
    });
  }

  function fixesHTML(r) {
    const groups = [
      { key: 'stationary', title: 'Parked, not driving', text: 'Long “journeys” that barely moved: your phone sitting still. Not counted.' },
      { key: 'too-fast', title: 'Impossibly fast', text: 'GPS glitches with impossible speeds. Not counted.' },
      { key: 'reassigned', title: 'Counted as your car', text: 'Google labelled these with a way of travelling you said you don’t use.' },
      { key: 'unsure', title: 'Google wasn’t sure', text: 'Low-confidence guesses over 2 km, biggest first. Change any that look wrong.' },
    ];
    return groups.map(g => {
      let items = r.flags.filter(f => primaryReason(f) === g.key);
      const total = items.length;
      if (g.key === 'unsure') items = items.sort((a, b) => b.m.km - a.m.km).slice(0, 12);
      if (!items.length) return '';
      return `<div class="flag-group"><h3>${g.title} <span class="faint" style="font-size:.6em">${total}</span></h3><p>${g.text}</p>${items.map(flagRow).join('')}</div>`;
    }).join('');
  }

  function initSetup() {
    $('#step-next').addEventListener('click', () => {
      if (st.S.end <= st.S.start) { alert('The end date must be after the start date.'); return; }
      applySuggestions(TR.analyze(st.data, st.S, st.edits));
      save(); buildReport();
    });
    $('#setup-home').addEventListener('click', () => location.reload());
  }

  // ---------- report
  let mapCtl = null;
  function placeName(id, home) { return st.edits.placeNames[id] || (home ? 'Home' : ''); }
  function placeLabel(v) {
    const nm = placeName(v.placeId, v.home);
    if (nm) return esc(nm);
    const d = U.hav(v.p, st.r.HOME);
    return `${esc(autoPlace(v.p[0], v.p[1]))} <span class="faint" style="font-family:var(--sans);font-size:13px">${d < 1 ? Math.round(d * 1000) + ' m' : n1(d) + ' km'} from home</span>`;
  }
  const areaTitle = a => esc(a.name || a.auto);
  const stayName = i => st.stayNames[i] || (TR.regionName ? TR.regionName(st.stays[i].lat, st.stays[i].lng) : '');
  const autoPlace = (lat, lng) => (TR.geoName ? TR.geoName(lat, lng).label : '') || 'Unnamed place';

  function buildReport() {
    st.r = TR.analyze(st.data, st.S, st.edits);
    show('report');
    renderReport();
  }

  function renderReport(keepScroll) {
    const y = window.scrollY, r = st.r, S = st.S;
    const name = spansStays() ? '' : stayName(st.stayIdx);
    const nDays = r.days.length;
    const homePct = pct(r.totals.home, r.windowHours);
    const kicker = `${dLong(r.A)} – ${dLong(r.B - 1)}`;
    const title = name ? `${nDays <= 12 ? WORDS[nDays] : n0(nDays)} days in <em>${esc(name)}</em>` : `${nDays <= 12 ? WORDS[nDays] : n0(nDays)} days, <em>mapped</em>`;
    const fuelModes = ['car', 'bike'].filter(m => r.byMode[m].km > 0);
    const outShare = pct(r.outCost, r.fuelCost);
    const travelModes = Object.keys(r.byMode).filter(m => m !== 'flight' && r.byMode[m].km > 0.5).sort((a, b) => r.byMode[b].km - r.byMode[a].km);
    const maxModeKm = Math.max.apply(null, travelModes.map(m => r.byMode[m].km).concat([1]));

    const chapters = [];
    const chapter = (id, num, t, lede, body, nav) => chapters.push({ id, nav, html: `<section class="chapter" id="${id}"><div class="wrap"><div class="chapter-head reveal"><div class="chapter-num">${num}</div><h2 class="chapter-title">${t}</h2><p class="chapter-lede">${lede}</p></div><div class="chapter-body reveal">${body}</div></div></section>` });

    // 01 — cost
    const assume = ['car', 'bike'].filter(m => r.byMode[m].km > 0).map(m => `${MODE_LABEL[m].toLowerCase()} at ${n1(S.vehicles[m].kmpl)} km per litre`).join(', ');
    chapter('cost', 'One', 'What it cost', `<b>${money(r.fuelCost)}</b> on fuel, about ${money(r.fuelCost / Math.max(1, r.windowHours / 24))} a day, for ${n0(r.fuelLitres)} litres. Worked out with the ${assume}, and petrol at ${money(S.vehicles.car.price)} a litre. <a href="#" data-goto="car">Change these</a>`,
      `<div class="figure-pair">
        <div class="fig"><div class="fig-title">By vehicle</div><div class="lines">${fuelModes.map(m => `<div class="line"><span class="k">${MODE_LABEL[m]} · ${n0(r.byMode[m].km)} km · ${n0(r.byMode[m].litres)} l at ${n1(S.vehicles[m].kmpl)} km/l</span><span class="v num">${money(r.byMode[m].cost)}</span><span class="bar"><i style="width:${pct(r.byMode[m].cost, r.fuelCost)}%;background:${MODE_COLOR(m)}"></i></span></div>`).join('') || '<p class="muted">No car or motorbike journeys in this period.</p>'}</div></div>
        <div class="fig"><div class="fig-title">By month</div><div id="ch-month"></div></div>
      </div>
      ${r.trips.length ? `<p class="callout">Trips out of town took <span class="hl">${money(r.outCost)}</span> <span class="dim">— ${outShare}% of the total — while everyday running around came to ${money(r.fuelCost - r.outCost)}.</span></p>` : ''}
      <div class="figure-pair">
        ${r.shortCar.n && S.modesUsed.bike !== false ? `<div class="fig"><div class="fig-title">Short hops</div><p style="font-size:17px;margin:0">${plural(r.shortCar.n, 'car journey')} around town were under 5 km (${n0(r.shortCar.km)} km in all). On the motorbike they’d have cost <b>${money(r.shortCar.saving)}</b> less.</p></div>` : ''}
        ${r.byMode.car.km > 0 ? `<div class="fig"><div class="fig-title">If the car were electric</div><p style="font-size:17px;margin:0">The same ${n0(r.byMode.car.km)} km would have cost about <b>${money(r.ev.cost)}</b> instead of ${money(r.byMode.car.cost)}.</p><p class="fig-note">${n1(S.ev.kmPerKwh)} km per unit, ${Math.round(S.ev.homeShare * 100)}% charged at home at ${money(S.ev.homeRate)} and the rest at ${money(S.ev.publicRate)}, plus 10% charging losses. <a href="#" data-goto="more">Change</a></p></div>` : ''}
      </div>`, 'Cost');

    // 02 — trips
    chapter('trips', 'Two', 'Where you went', r.trips.length ? `<b>${plural(r.trips.length, 'trip')}</b> beyond ${S.radiusKm} km from home, to ${plural(r.areas.length, 'destination')}. Name them — we only know the coordinates.` : `No trips beyond ${S.radiusKm} km from home in this period.`,
      r.areas.map(a => `<div class="area">
        <div class="area-head"><div><input class="area-name" data-area="${esc(a.key)}" value="${esc(a.name)}" placeholder="${esc(a.auto)}" aria-label="Name this destination"><div class="area-meta">${a.distLabel || ''} · ${n0(a.km)} km driven · ${money(a.cost)} · ${dur(a.hours)} away <span class="edit">· click the name to change it</span></div></div>
        <div class="area-count num">${a.trips.length}<small>${a.trips.length === 1 ? 'trip' : 'trips'}</small></div></div>
        <table class="ledger"><thead><tr><th>When</th><th class="r">Away</th><th class="r">Stops</th><th class="r">Distance</th><th class="r">Fuel</th></tr></thead><tbody>
        ${a.trips.map(t => `<tr class="click" data-day="${U.dayKey(t.start, r.off)}"><td><span class="t-big">${dShort(t.start)}${U.dayKey(t.start, r.off) !== U.dayKey(t.end, r.off) ? ' – ' + dShort(t.end) : ''}</span> <span class="faint">${tHM(t.start)}</span></td><td class="r num">${dur((t.end - t.start) / H)}</td><td class="r num">${t.stops.length}</td><td class="r num">${n0(t.totalKm)} km</td><td class="r num">${money(t.cost)}</td></tr>`).join('')}
        </tbody></table></div>`).join(''), 'Trips');

    // 03 — time
    const T = r.totals, tSum = T.home + T.town + T.away + T.road || 1;
    const tParts = [['home', 'At home'], ['town', 'Elsewhere nearby'], ['away', 'Out of town'], ['road', 'On the move']];
    const mid = r.rhythm.midnight, nights = r.days.length - 1;
    chapter('time', 'Three', 'Where the hours went', `<b>${homePct}%</b> of your time at home. A typical day out began at <b>${hm(r.rhythm.leaveMed)}</b> and ended at <b>${hm(r.rhythm.retMed)}</b>.`,
      `<div class="fig"><div class="stack">${tParts.map(([k, l]) => `<div style="flex:${T[k]};background:var(--t-${k})" data-tip="<b>${l}</b><br>${n0(T[k])} hours · ${pct(T[k], tSum)}%"></div>`).join('')}</div>
        <div class="legend">${tParts.map(([k, l]) => `<span><i style="background:var(--t-${k})"></i>${l} <b>${pct(T[k], tSum)}%</b></span>`).join('')}</div></div>
      <div class="fig"><div class="fig-title">Week by week, hours</div><div id="ch-weeks"></div></div>
      <div class="fig clock">
        <div><div class="fig-title">First out the door</div><div class="bignum num">${hm(r.rhythm.leaveMed)}</div><div class="cap">On most days between ${hm(r.rhythm.leaveQ[0])} and ${hm(r.rhythm.leaveQ[1])}.</div></div>
        <div><div class="fig-title">Last back home</div><div class="bignum num">${hm(r.rhythm.retMed)}</div><div class="cap">Usually between ${hm(r.rhythm.retQ[0])} and ${hm(r.rhythm.retQ[1])}. After midnight on ${plural(r.rhythm.lateNights.length, 'night')}.</div></div>
      </div>
      <p class="callout">At midnight you were home on <span class="hl">${mid.home} of ${nights}</span> nights<span class="dim">${mid.town ? `, out nearby on ${mid.town}` : ''}${mid.away ? `, away on ${mid.away}` : ''}${mid.road ? `, on the road for ${mid.road}` : ''}.</span></p>
      <div class="fig"><div class="fig-title">What kind of days</div><div class="daycats">${r.cats.map(c => `<div><div class="v num">${c.days.length}</div><div class="l">${c.label}</div></div>`).join('')}</div></div>`, 'Time');

    // 04 — travel
    const car = r.byMode.car;
    chapter('travel', 'Four', 'On the move', `<b>${n0(r.totalKm)} km</b> in all. ${car.n ? `${plural(car.n, 'car journey')}, ${n0(car.h)} hours behind the wheel.` : ''}`,
      `<div class="figure-pair">
        <div class="fig"><div class="fig-title">How you travelled</div><div class="lines">${travelModes.map(m => `<div class="line"><span class="k">${MODE_LABEL[m]} · ${plural(r.byMode[m].n, 'journey')} · ${n0(r.byMode[m].h)} h</span><span class="v num">${n0(r.byMode[m].km)} km</span><span class="bar"><i style="width:${(r.byMode[m].km / maxModeKm * 100).toFixed(1)}%;background:${MODE_COLOR(m)}"></i></span></div>`).join('')}</div></div>
        ${car.n ? `<div class="fig"><div class="fig-title">Car, around town vs away</div><table class="ledger"><thead><tr><th></th><th class="r">Around town</th><th class="r">Out of town</th></tr></thead><tbody>
          <tr><td>Journeys</td><td class="r num">${n0(r.driving.local.n)}</td><td class="r num">${n0(r.driving.out.n)}</td></tr>
          <tr><td>Distance</td><td class="r num">${n0(r.driving.local.km)} km</td><td class="r num">${n0(r.driving.out.km)} km</td></tr>
          <tr><td>Typical journey</td><td class="r num">${n1(r.driving.local.medKm)} km · ${n0(r.driving.local.medMin)} min</td><td class="r num">${n1(r.driving.out.medKm)} km · ${n0(r.driving.out.medMin)} min</td></tr>
          <tr><td>Average speed</td><td class="r num">${n0(r.driving.local.speed)} km/h</td><td class="r num">${n0(r.driving.out.speed)} km/h</td></tr>
          </tbody></table></div>` : ''}
      </div>
      ${car.n ? `<div class="figure-pair"><div class="fig"><div class="fig-title">Car distance by time of day</div><div id="ch-hour"></div></div><div class="fig"><div class="fig-title">Average car distance per weekday</div><div id="ch-wd"></div></div></div>` : ''}`, 'Travel');

    // 05 — places
    const top = r.places.slice(0, 15);
    chapter('places', 'Five', 'Your places', `<b>${plural(r.places.length, 'place')}</b>, ${n0(r.oneOffs.length)} of them visited only once. Give the regulars a name — it stays on this device.`,
      `<table class="ledger"><thead><tr><th>Place</th><th class="r">Visits</th><th class="r">Days</th><th class="r">Hours</th><th class="r">From home</th></tr></thead><tbody>
      ${top.map(p => `<tr><td><input class="place-name" data-place="${esc(p.id)}" value="${esc(placeName(p.id, p.home))}" placeholder="${esc(autoPlace(p.lat, p.lng))}"><div class="coord">${mapsLink(p.lat, p.lng)}</div></td><td class="r num">${p.n}</td><td class="r num">${p.nDays}</td><td class="r num">${n0(p.h)}</td><td class="r num">${p.home ? '—' : p.dh < 1 ? Math.round(p.dh * 1000) + ' m' : n1(p.dh) + ' km'}</td></tr>`).join('')}
      </tbody></table>`, 'Places');

    // 06 — map
    chapter('map', 'Six', 'The map', 'Every route and every stop, drawn on this device. Scroll to zoom, drag to move, hover for details.',
      `<div class="mapbox" id="mapbox"><div class="map-tools"><button class="iconbtn" data-map="all">Everything</button><button class="iconbtn" data-map="home">Around home</button></div>
       <div class="map-legend">${travelModes.map(m => `<label data-layer="${m}"><i style="background:${MODE_COLOR(m)}"></i>${MODE_LABEL[m]}</label>`).join('')}<label data-layer="places"><i style="background:var(--ink);height:8px;width:8px;border-radius:50%"></i>Places</label></div>
       <div class="scalebar"></div></div>
       <p class="fig-note">Coastlines, rivers, borders, main roads and towns are built in, so the map works offline. Your own routes show the smaller roads you used. The dashed ring marks ${S.radiusKm} km from home. Map data: Natural Earth.</p>`, 'Map');

    // 07 — days
    const nFix = r.flags.filter(f => f.reasons.some(x => x !== 'unsure')).length;
    chapter('days', 'Seven', 'Day by day', 'Darker days covered more ground. Open any day to see it hour by hour, and fix whatever Google got wrong.',
      `${r.flags.length ? `<p class="fixnote">${nFix ? `We corrected ${plural(nFix, 'journey')} Google got wrong` : 'Google was unsure about some journeys'}. <button class="linkish" data-act="fixes">See what we changed</button></p>` : ''}<div class="cal" id="cal"></div>
       <div class="seq-legend">Less ${[0, 1, 2, 3, 4, 5, 6].map(i => `<i style="background:var(--seq-${i})"></i>`).join('')} More</div>`, 'Days');

    // 08 — stays
    chapter('stays', 'Eight', 'Where you’ve been', `Your whole file, ${dLongAny(st.data.first)} to ${dLongAny(st.data.last)}, split into stays by your flights.`,
      `<table class="ledger"><thead><tr><th>Stay</th><th>From</th><th>To</th><th class="r">Calendar days</th></tr></thead><tbody>
      ${st.stays.map((s, i) => `<tr><td class="t-big">${stayName(i) ? esc(stayName(i)) : `<span class="it faint">Unnamed · ${offLabel(s.off)}</span>`}</td><td>${dAny(s.start, s.off)}</td><td>${dAny(s.end, s.off)}</td><td class="r num">${s.days}</td></tr>`).join('')}
      </tbody></table>
      <p class="fig-note">Counts include the days you arrived and left. Google’s location is an estimate — useful as supporting evidence, but passports and tickets are what officially count.</p>`, 'Stays');

    $('#report').innerHTML = `
      <header class="topbar" id="topbar"><div class="wrap"><span class="wordmark">Timeline <i>Report</i></span>
        <nav>${chapters.map(c => `<a href="#${c.id}">${c.nav}</a>`).join('')}</nav>
        <div class="tools"><button class="iconbtn" data-act="settings">Settings</button><button class="iconbtn" data-act="print">Print</button></div></div></header>
      <section class="r-hero"><div class="wrap">
        <div class="kicker reveal">${kicker}${st.sample ? ' · sample data' : ''}</div>
        <h1 class="display reveal">${title}</h1>
        <p class="sub reveal">You covered ${n0(r.totalKm)} km${r.fuelCost ? `, spent ${money(r.fuelCost)} on fuel (car at ${n1(S.vehicles.car.kmpl)} km per litre, petrol ${money(S.vehicles.car.price)})` : ''} and made ${plural(r.trips.length, 'trip')} out of town. Here’s the whole story.</p>
        <div class="stats reveal">
          <div class="stat"><div class="v num">${n0(r.totalKm)}</div><div class="l">kilometres travelled</div></div>
          <div class="stat"><div class="v num">${money(r.fuelCost)}</div><div class="l">spent on fuel</div></div>
          <div class="stat"><div class="v num">${r.trips.length}</div><div class="l">${r.trips.length === 1 ? 'trip' : 'trips'} out of town</div></div>
          <div class="stat"><div class="v num">${homePct}%</div><div class="l">of the time at home</div></div>
        </div></div></section>
      ${chapters.map(c => c.html).join('')}
      <footer class="end"><div class="wrap">
        <p class="callout reveal">Made on this device. <em>Nothing left it.</em></p>
        <div class="pills no-print"><button class="pill" data-act="csv-days">Daily diary · CSV</button><button class="pill" data-act="csv-trips">Trips · CSV</button><button class="pill" data-act="csv-places">Places · CSV</button><button class="pill" data-act="print">Save as PDF</button><button class="pill" data-act="restart">Open another file</button></div>
        <div class="colophon"><span class="lock">Runs offline. No uploads, no tracking, no AI.</span><span>Town names from GeoNames (CC BY 4.0) · Set in Instrument Serif &amp; Sans (SIL OFL)</span></div>
      </div></footer>`;

    drawCharts();
    drawCalendar();
    drawTheMap();
    bindReport();
    if (keepScroll) window.scrollTo(0, y);
  }
  const dAny = (ms, off) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms + off * 60000));
  const dLongAny = ms => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms));

  function drawCharts() {
    const r = st.r, cs = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const mh = $('#ch-month');
    if (mh) {
      const fm = ['car', 'bike'].filter(m => r.byMode[m].km > 0);
      TR.barChart(mh, {
        cats: r.months.map(m => keyDate(m.key + '-01', { month: 'short' })), height: 220, fmt: v => money(v),
        series: fm.map(m => ({ label: MODE_LABEL[m], color: cs('--mode-' + m), values: r.months.map(o => (o.km[m] || 0) / st.S.vehicles[m].kmpl * st.S.vehicles[m].price) })),
        tipTitle: i => keyDate(r.months[i].key + '-01', { month: 'long', year: 'numeric' }),
      });
    }
    const wk = $('#ch-weeks');
    if (wk) {
      const parts = [['home', 'At home'], ['town', 'Elsewhere nearby'], ['away', 'Out of town'], ['road', 'On the move']];
      TR.barChart(wk, {
        cats: r.weeks.map(w => keyDate(w.key, { day: 'numeric', month: 'short' })), height: 240, fmt: v => n0(v) + ' h',
        series: parts.map(([k, l]) => ({ label: l, color: cs('--t-' + k), values: r.weeks.map(w => w[k]) })),
        tipTitle: i => 'Week of ' + keyDate(r.weeks[i].key, { day: 'numeric', month: 'long' }),
      });
    }
    const hr = $('#ch-hour');
    if (hr) TR.barChart(hr, {
      cats: r.driving.byHour.map(b => String(b.from).padStart(2, '0')), height: 200, fmt: v => n0(v) + ' km',
      series: [{ label: 'Car', color: cs('--mode-car'), values: r.driving.byHour.map(b => b.km) }],
      tipTitle: i => `${String(r.driving.byHour[i].from).padStart(2, '0')}:00–${String(r.driving.byHour[i].from + 3).padStart(2, '0')}:00 · ${plural(r.driving.byHour[i].n, 'journey')}`,
    });
    const wd = $('#ch-wd');
    if (wd) {
      const names = [1, 2, 3, 4, 5, 6, 7].map(d => keyDate(`2024-01-0${d}`, { weekday: 'short' }));
      TR.hBars(wd, r.driving.byWeekday.map((w, i) => ({ label: names[i], v: w.days ? w.km / w.days : 0, tip: `<b>${names[i]}</b><br>${n0(w.km)} km over ${w.days} days · ${plural(w.n, 'journey')}` })), { color: cs('--mode-car'), fmt: v => n0(v) + ' km' });
    }
  }

  function drawCalendar() {
    const r = st.r, host = $('#cal'); if (!host) return;
    const kms = r.days.map(k => r.D[k].totalKm).filter(v => v > 0).sort((a, b) => a - b);
    const q = [0.2, 0.4, 0.6, 0.8, 0.95].map(f => kms.length ? kms[Math.floor((kms.length - 1) * f)] : 0);
    const step = v => (v <= 0.05 ? 0 : 1 + q.filter(t => v > t).length);
    const inRange = new Set(r.days);
    const months = [...new Set(r.days.map(k => k.slice(0, 7)))];
    const wds = [1, 2, 3, 4, 5, 6, 7].map(d => keyDate(`2024-01-0${d}`, { weekday: 'narrow' }));
    host.innerHTML = months.map(mk => {
      const first = new Date(mk + '-01T00:00:00Z'), lead = (first.getUTCDay() + 6) % 7;
      const nd = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      let cells = wds.map(w => `<div class="wd">${w}</div>`).join('') + '<div class="cal-cell empty"></div>'.repeat(lead);
      for (let d = 1; d <= nd; d++) {
        const key = `${mk}-${String(d).padStart(2, '0')}`;
        if (!inRange.has(key)) { cells += `<button class="cal-cell out" tabindex="-1">${d}</button>`; continue; }
        const D = r.D[key], s = step(D.totalKm);
        cells += `<button class="cal-cell ${s >= 4 ? 'dark' : ''}" style="background:var(--seq-${s})" data-day="${key}" data-tip="<b>${esc(keyDate(key, { weekday: 'long', day: 'numeric', month: 'long' }))}</b><br>${n0(D.totalKm)} km · ${D.stops.length} stops · ${n1(D.out)} h out${D.fuel ? ' · ' + esc(money(D.fuel)) : ''}">${d}</button>`;
      }
      return `<div class="cal-month"><h4>${keyDate(mk + '-01', { month: 'long', year: 'numeric' })}</h4><div class="cal-grid">${cells}</div></div>`;
    }).join('');
  }

  function routePts(m) {
    const P = st.data.paths; let lo = 0, hi = P.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (P[mid].t < m.st) lo = mid + 1; else hi = mid; }
    const pts = [m.p1];
    for (let i = lo; i < P.length && P[i].t <= m.en; i++) pts.push([P[i].lat, P[i].lng]);
    pts.push(m.p2);
    return pts;
  }
  let saveViewT;
  function drawTheMap() {
    const host = $('#mapbox'); if (!host) return;
    const r = st.r, cs = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const colors = {}; ['car', 'bike', 'bus', 'train', 'cycle', 'walk', 'other', 'flight'].forEach(m => { colors[m] = cs('--mode-' + m); });
    const routes = r.moves.filter(m => !m.ignored && m.mode !== 'flight').map(m => ({ mode: m.mode, pts: routePts(m), tip: `<b>${MODE_LABEL[m.mode]} · ${n1(m.km)} km</b><br>${esc(dShort(m.st))}, ${tHM(m.st)}–${tHM(m.en)}` }));
    const places = r.places.map(p => ({ lat: p.lat, lng: p.lng, h: p.h, home: p.home, tip: `<b>${esc(placeName(p.id, p.home) || autoPlace(p.lat, p.lng))}</b><br>${plural(p.n, 'visit')} · ${n0(p.h)} hours<br>${esc(dShort(p.first))}${p.n > 1 ? ' – ' + esc(dShort(p.last)) : ''}` }));
    const viewKey = st.S.start + ':' + st.S.end; // a saved view belongs to one date range
    mapCtl = TR.drawMap(host, { routes, places, home: r.HOME, homeRadiusKm: st.S.radiusKm, colors,
      view: st.mapView && st.mapView.key === viewKey ? st.mapView : null,
      onView: v => { st.mapView = Object.assign({ key: viewKey }, v); clearTimeout(saveViewT); saveViewT = setTimeout(save, 400); } });
  }

  // ---------- day drawer
  function openDay(key) {
    const r = st.r, D = r.D[key]; if (!D) return;
    const a = U.dayStart(key, r.off), b = a + DAY;
    const items = r.visits.filter(v => v.en > a && v.st < b).concat(r.moves.filter(m => m.en > a && m.st < b)).sort((x, y) => x.st - y.st);
    $('#drawer-body').innerHTML = `<button class="iconbtn close" data-act="close">Close</button>
      <div class="kicker" style="margin-top:6px">${keyDate(key, { weekday: 'long' })}</div>
      <h2>${keyDate(key, { day: 'numeric', month: 'long' })}</h2>
      <div class="sum">${plural(D.stops.length, 'stop')} · ${n0(D.totalKm)} km${D.fuel ? ' · ' + money(D.fuel) + ' fuel' : ''} · ${n1(D.out)} hours away from home</div>
      <div class="tl">${items.map(e => e.k === 'v'
        ? `<div class="tl-item"><div class="tl-time">${tHM(Math.max(e.st, a))}${e.st < a ? ' (from the day before)' : ''} – ${e.en > b ? 'next day' : tHM(e.en)}</div><div class="tl-place">${placeLabel(e)}</div></div>`
        : `<div class="tl-item mv ${e.ignored ? 'ignored' : ''}" style="--c:${MODE_COLOR(e.mode)}"><div class="tl-time">${tHM(e.st)} – ${tHM(e.en)}</div><div class="tl-move"><span>${n1(e.km)} km${e.mode !== e.raw || e.seg.prob < 0.6 ? ` · <span class="faint">Google said ${MODE_LABEL[e.raw].toLowerCase()} (${Math.round(e.seg.prob * 100)}%)</span>` : ''}</span>${e.mode === 'flight' ? '<span>Flight</span>' : chips(e.seg.id, e.mode)}</div></div>`).join('') || '<p class="muted">Nothing recorded.</p>'}</div>`;
    $('#drawer').dataset.day = key;
    $('#drawer').classList.add('on'); $('#scrim').classList.add('on');
  }
  function openFixes() {
    $('#drawer-body').innerHTML = `<button class="iconbtn close" data-act="close">Close</button><div class="kicker" style="margin-top:6px">Corrections</div><h2>What we changed</h2><div class="sum">Pick the right answer for anything that looks wrong. The report updates as you go.</div>${fixesHTML(st.r)}`;
    $('#drawer').dataset.day = '';
    $('#drawer').classList.add('on'); $('#scrim').classList.add('on');
  }
  function closeDay() { $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); }

  function recompute() {
    save();
    st.r = TR.analyze(st.data, st.S, st.edits);
    renderReport(true);
    const d = $('#drawer'); if (d.classList.contains('on')) { if (d.dataset.day) openDay(d.dataset.day); else openFixes(); }
  }

  // ---------- CSV
  function download(name, rows) {
    const csv = rows.map(r => r.map(v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const iso = ms => loc(ms).toISOString().slice(0, 16).replace('T', ' ');
  function exportCSV(kind) {
    const r = st.r;
    if (kind === 'days') download('daily-diary.csv', [['date', 'weekday', 'stops', 'hours_home', 'hours_nearby', 'hours_out_of_town', 'hours_on_move', 'car_km', 'bike_km', 'other_km', 'total_km', 'farthest_km_from_home', 'first_left_home', 'last_back_home', 'fuel_cost']].concat(r.days.map(k => {
      const d = r.D[k], o = d.totalKm - (d.km.car || 0) - (d.km.bike || 0);
      return [k, keyDate(k, { weekday: 'short' }), d.stops.length, d.home.toFixed(1), d.town.toFixed(1), d.away.toFixed(1), d.road.toFixed(1), (d.km.car || 0).toFixed(1), (d.km.bike || 0).toFixed(1), o.toFixed(1), d.totalKm.toFixed(1), d.far.toFixed(1), d.leave ? tHM(d.leave) : '', d.ret ? tHM(d.ret) : '', Math.round(d.fuel)];
    })));
    if (kind === 'trips') download('trips.csv', [['trip', 'destination', 'start', 'end', 'type', 'mode', 'km', 'hours', 'lat', 'lon', 'place_name', 'fuel_cost']].concat(...r.trips.map(t => {
      const area = r.areas.find(a => a.key === t.areaKey);
      return t.stops.concat(t.legs).sort((x, y) => x.st - y.st).map(e => [t.i + 1, area ? (area.name || area.auto) : '', iso(e.st), iso(e.en), e.k === 'v' ? 'stop' : 'travel', e.k === 'a' ? e.mode : '', e.k === 'a' ? e.km.toFixed(1) : '', ((e.en - e.st) / H).toFixed(2), (e.k === 'v' ? e.p : e.p2)[0], (e.k === 'v' ? e.p : e.p2)[1], e.k === 'v' ? placeName(e.placeId, e.home) : '', e.k === 'a' ? '' : '']);
    })));
    if (kind === 'places') download('places.csv', [['name', 'visits', 'days', 'hours', 'first_visit', 'last_visit', 'km_from_home', 'lat', 'lon', 'google_maps']].concat(r.places.map(p => [placeName(p.id, p.home), p.n, p.nDays, p.h.toFixed(1), iso(p.first), iso(p.last), p.dh.toFixed(1), p.lat, p.lng, /^ChIJ/.test(p.id) && !/sample/.test(p.id) ? `https://www.google.com/maps/place/?q=place_id:${p.id}` : ''])));
  }

  // ---------- report bindings
  function bindReport() {
    const rep = $('#report');
    rep.onclick = e => {
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'settings') { show('setup'); renderSetup(); }
        else if (a === 'fixes') openFixes();
        else if (a === 'print') window.print();
        else if (a === 'restart') location.reload();
        else if (a.startsWith('csv-')) exportCSV(a.slice(4));
        return;
      }
      const go = e.target.closest('[data-goto]');
      if (go) { e.preventDefault(); show('setup'); renderSetup(); const m = $('#more'); if (m && go.dataset.goto === 'more') m.open = true; return; }
      const day = e.target.closest('[data-day]'); if (day) { openDay(day.dataset.day); return; }
      const mp = e.target.closest('[data-map]'); if (mp && mapCtl) { mp.dataset.map === 'all' ? mapCtl.fitAll() : mapCtl.fitHome(); return; }
      const ly = e.target.closest('[data-layer]');
      if (ly && mapCtl) { const off = ly.classList.toggle('off'); ly.dataset.layer === 'places' ? mapCtl.togglePlaces(!off) : mapCtl.toggle(ly.dataset.layer, !off); }
    };
    rep.onmousemove = e => { const t = e.target.closest('[data-tip]'); if (t) TR.tip.show(t.dataset.tip, e.clientX, e.clientY); else if (!e.target.closest('svg')) TR.tip.hide(); };
    rep.onmouseleave = TR.tip.hide;
    $$('[data-area]', rep).forEach(i => i.addEventListener('change', () => { st.edits.areaNames[i.dataset.area] = i.value.trim(); recompute(); }));
    $$('[data-place]', rep).forEach(i => i.addEventListener('change', () => { st.edits.placeNames[i.dataset.place] = i.value.trim(); recompute(); }));
    $$('input.area-name, input.place-name', rep).forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); }));
    // reveal on scroll + nav highlight
    const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -8% 0px' });
    $$('.reveal', rep).forEach(n => io.observe(n));
    const links = $$('.topbar nav a', rep);
    const so = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) links.forEach(l => l.classList.toggle('on', l.getAttribute('href') === '#' + x.target.id)); }), { rootMargin: '-45% 0px -50% 0px' });
    $$('.chapter', rep).forEach(c => so.observe(c));
  }

  function initDrawer() {
    $('#scrim').addEventListener('click', closeDay);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDay(); });
    $('#drawer').addEventListener('click', e => {
      if (e.target.closest('[data-act="close"]')) { closeDay(); return; }
      const c = e.target.closest('[data-set]'); if (!c) return;
      st.edits.modes[c.closest('[data-seg]').dataset.seg] = c.dataset.set;
      recompute();
    });
  }

  addEventListener('scroll', () => { const t = $('#topbar'); if (t) t.classList.toggle('scrolled', scrollY > 10); }, { passive: true });
  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (st.r && !$('#report').classList.contains('hidden')) { drawCharts(); drawTheMap(); } }, 200); });

  document.addEventListener('DOMContentLoaded', () => {
    initIntro(); initSetup(); initDrawer();
    $$('#intro .reveal').forEach((n, i) => setTimeout(() => n.classList.add('in'), 80 + i * 110));
  });
})(globalThis.TR = globalThis.TR || {});
