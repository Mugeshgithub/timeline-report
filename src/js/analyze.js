// Pure analysis: turns parsed timeline + user settings + user edits into report numbers.
(function (TR) {
  'use strict';

  const H = 3600000, DAY = 86400000;
  const MODES = ['car', 'bike', 'bus', 'train', 'cycle', 'walk', 'flight', 'other'];
  const FUEL_MODES = { car: 'car', bike: 'bike' };
  const SPEED_LIMIT = { car: 150, bike: 130, bus: 110, train: 250, cycle: 40, walk: 9, other: 200 };
  const CHARGING_LOSS = 1.1;

  function hav(a, b) {
    const r = Math.PI / 180, la1 = a[0] * r, la2 = b[0] * r, dla = la2 - la1, dlo = (b[1] - a[1]) * r;
    const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function compass(from, to) {
    const r = Math.PI / 180, y = Math.sin((to[1] - from[1]) * r) * Math.cos(to[0] * r);
    const x = Math.cos(from[0] * r) * Math.sin(to[0] * r) - Math.sin(from[0] * r) * Math.cos(to[0] * r) * Math.cos((to[1] - from[1]) * r);
    const deg = (Math.atan2(y, x) / r + 360) % 360;
    return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
  }
  const dayKey = (ms, off) => new Date(ms + off * 60000).toISOString().slice(0, 10);
  const localHour = (ms, off) => { const d = new Date(ms + off * 60000); return d.getUTCHours() + d.getUTCMinutes() / 60; };
  const dayStart = (key, off) => Date.parse(key + 'T00:00:00Z') - off * 60000;
  const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const quart = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

  function topVisits(data) { return data.segs.filter(s => s.kind === 'visit' && s.level === 0); }

  // Split the whole file into stays separated by flights.
  TR.findStays = function (data) {
    const flights = data.segs.filter(s => s.kind === 'move' && s.mode === 'flight');
    const visits = topVisits(data);
    const cuts = [-Infinity].concat(flights.map(f => f.start), [Infinity]);
    const stays = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const lo = i === 0 ? -Infinity : flights[i - 1].end, hi = cuts[i + 1];
      const vs = visits.filter(v => v.start >= lo && v.start < hi);
      if (!vs.length) continue;
      const hours = vs.reduce((t, v) => t + (v.end - v.start) / H, 0);
      if (hours < 12) continue;
      const byPlace = {};
      vs.forEach(v => {
        const p = byPlace[v.placeId] = byPlace[v.placeId] || { h: 0, lat: v.lat, lng: v.lng, home: 0 };
        p.h += (v.end - v.start) / H;
        if (/HOME/.test(v.semantic)) p.home += (v.end - v.start) / H;
      });
      const places = Object.values(byPlace);
      const top = places.reduce((a, b) => (b.h > a.h ? b : a));
      const offs = {};
      vs.forEach(v => { offs[v.offStart] = (offs[v.offStart] || 0) + (v.end - v.start); });
      const off = Number(Object.keys(offs).reduce((a, b) => (offs[b] > offs[a] ? b : a)));
      const start = vs[0].start, end = vs.reduce((m, v) => Math.max(m, v.end), 0);
      stays.push({
        index: stays.length, start, end, off, lat: top.lat, lng: top.lng, hours,
        days: Math.round((dayStart(dayKey(end, off), off) - dayStart(dayKey(start, off), off)) / DAY) + 1,
        arrivedByFlight: i > 0, leftByFlight: i < cuts.length - 2,
      });
    }
    return stays;
  };

  // Best guess of home inside a stay: where you were at 3 am on the most nights
  // (spots under 250 m apart count as one place, since Google often splits a home in two).
  TR.detectHome = function (data, stay) {
    const vs = topVisits(data).filter(v => v.end > stay.start && v.start < stay.end);
    if (!vs.length) return { lat: stay.lat, lng: stay.lng };
    const groups = [];
    const groupOf = v => {
      let g = groups.find(g => hav([g.lat, g.lng], [v.lat, v.lng]) < 0.25);
      if (!g) { g = { lat: v.lat, lng: v.lng, nights: 0, h: 0, best: 0 }; groups.push(g); }
      return g;
    };
    vs.forEach(v => { const g = groupOf(v), h = (Math.min(v.end, stay.end) - Math.max(v.start, stay.start)) / H; g.h += h; });
    for (let t = dayStart(dayKey(stay.start, stay.off), stay.off) + 3 * H; t < stay.end; t += DAY) {
      const v = vs.find(v => v.start <= t && t < v.end);
      if (v) groupOf(v).nights++;
    }
    // use the most visited exact spot inside the winning group as the home point
    const win = groups.reduce((a, g) => (g.nights > a.nights || (g.nights === a.nights && g.h > a.h) ? g : a));
    const spots = {};
    vs.forEach(v => { if (hav([win.lat, win.lng], [v.lat, v.lng]) < 0.25) { const k = v.lat + ',' + v.lng; spots[k] = (spots[k] || 0) + (v.end - v.start); } });
    const k = Object.keys(spots).reduce((a, b) => (spots[b] > spots[a] ? b : a));
    const [lat, lng] = k.split(',').map(Number);
    return { lat, lng };
  };

  // Default report window: first arrival home → last departure from home within the stay.
  TR.defaultWindow = function (data, stay, home) {
    // Trim the airport run at each end: start at the first arrival home and stop at the last departure,
    // but only when that is within a day and a half of the trip's ends (otherwise keep the whole trip).
    const vs = topVisits(data).filter(v => v.start >= stay.start && v.end <= stay.end && hav([v.lat, v.lng], [home.lat, home.lng]) < 0.25);
    if (!vs.length) return { start: stay.start, end: stay.end };
    const first = vs[0].start, last = vs.reduce((m, v) => Math.max(m, v.end), 0), slack = 36 * H;
    return { start: first - stay.start < slack ? first : stay.start, end: stay.end - last < slack ? last : stay.end };
  };

  TR.defaultSettings = function () {
    return {
      radiusKm: 20,
      modesUsed: { car: true, bike: true, bus: true, train: true, cycle: true, walk: true },
      reassignTo: 'car',
      vehicles: { car: { kmpl: 15, price: 100 }, bike: { kmpl: 45, price: 100 } },
      currency: '₹',
      ev: { kmPerKwh: 7.5, homeRate: 8, publicRate: 20, homeShare: 0.7 },
    };
  };

  TR.effectiveMode = function (seg, S, edits) {
    const e = edits && edits.modes && edits.modes[seg.id];
    if (e) return e;
    if (seg.mode === 'flight' || seg.mode === 'other') return seg.mode;
    if (S.modesUsed[seg.mode] === false) return S.reassignTo;
    return seg.mode;
  };

  TR.analyze = function (data, S, edits) {
    edits = edits || { modes: {}, placeNames: {}, areaNames: {} };
    const off = S.off, A = S.start, B = S.end, HOME = [S.home.lat, S.home.lng], R = S.radiusKm;
    const dh = p => hav(p, HOME);
    const isHome = p => dh(p) < 0.25;

    // ---- events in window
    const visits = [], moves = [];
    data.segs.forEach(s => {
      if (s.end <= A || s.start >= B) return;
      if (s.kind === 'visit' && s.level === 0) {
        const p = [s.lat, s.lng];
        visits.push({ seg: s, k: 'v', st: Math.max(s.start, A), en: Math.min(s.end, B), p, dh: dh(p), home: isHome(p), placeId: s.placeId });
      } else if (s.kind === 'move' && s.start >= A) {
        const mode = TR.effectiveMode(s, S, edits);
        moves.push({ seg: s, k: 'a', st: s.start, en: s.end, mode, raw: s.mode, ignored: mode === 'ignore', km: s.km, p1: s.from, p2: s.to,
          far: Math.max(dh(s.from), dh(s.to)) > R });
      }
    });
    const ev = visits.concat(moves).sort((a, b) => a.st - b.st);
    const live = moves.filter(m => !m.ignored);
    const cost = m => {
      const v = FUEL_MODES[m.mode] && S.vehicles[FUEL_MODES[m.mode]];
      return v && v.kmpl > 0 ? m.km / v.kmpl * v.price : 0;
    };
    const litres = m => { const v = FUEL_MODES[m.mode] && S.vehicles[FUEL_MODES[m.mode]]; return v && v.kmpl > 0 ? m.km / v.kmpl : 0; };

    // ---- totals by mode
    const byMode = {};
    MODES.forEach(k => { byMode[k] = { n: 0, km: 0, h: 0, litres: 0, cost: 0 }; });
    live.forEach(m => { const b = byMode[m.mode] || byMode.other; b.n++; b.km += m.km; b.h += (m.en - m.st) / H; b.litres += litres(m); b.cost += cost(m); });
    const fuelCost = byMode.car.cost + byMode.bike.cost, fuelLitres = byMode.car.litres + byMode.bike.litres;

    // ---- excursions
    const exc = []; let cur = null;
    ev.forEach(e => {
      if (e.k === 'a') {
        if (e.ignored) return;
        if (e.far && e.mode !== 'flight') { if (!cur) { cur = []; exc.push(cur); } cur.push(e); }
        else cur = null;
      } else if (cur) { if (e.dh > R) cur.push(e); else cur = null; }
    });
    const trips = exc.map((x, i) => {
      const acts = x.filter(e => e.k === 'a'), vs = x.filter(e => e.k === 'v');
      acts.forEach(e => { e.trip = i; });
      const km = {}; acts.forEach(e => { km[e.mode] = (km[e.mode] || 0) + e.km; });
      const main = vs.length ? vs.reduce((a, b) => ((b.en - b.st) > (a.en - a.st) ? b : a)) : null;
      const farPt = vs.concat(acts).reduce((best, e) => {
        const p = e.k === 'v' ? e.p : (dh(e.p1) > dh(e.p2) ? e.p1 : e.p2);
        return dh(p) > best.d ? { d: dh(p), p } : best;
      }, { d: 0, p: HOME });
      return {
        i, start: x[0].st, end: x[x.length - 1].en, km, totalKm: acts.reduce((t, e) => t + e.km, 0),
        cost: acts.reduce((t, e) => t + cost(e), 0), stops: vs, legs: acts, far: farPt.d,
        main, anchor: main ? main.p : farPt.p,
      };
    });
    // group trips into destination areas (single-linkage on anchor points)
    const areaOf = trips.map((_, i) => i);
    const find = i => (areaOf[i] === i ? i : (areaOf[i] = find(areaOf[i])));
    for (let i = 0; i < trips.length; i++) for (let j = i + 1; j < trips.length; j++) {
      if (hav(trips[i].anchor, trips[j].anchor) < 25) areaOf[find(i)] = find(j);
    }
    const areaMap = {};
    trips.forEach((t, i) => { const r = find(i); (areaMap[r] = areaMap[r] || []).push(t); });
    const areas = Object.values(areaMap).map(ts => {
      const best = ts.filter(t => t.main).reduce((a, t) => (!a || (t.main.en - t.main.st) > (a.main.en - a.main.st) ? t : a), null) || ts[0];
      const key = best.main ? best.main.placeId : 'area' + best.i;
      const d = dh(best.anchor);
      const region = TR.regionName ? TR.regionName(best.anchor[0], best.anchor[1]) : '';
      const auto = region || `${Math.round(d / 5) * 5} km ${compass(HOME, best.anchor)}`;
      const distLabel = `${Math.round(d / 5) * 5} km from home`;
      ts.forEach(t => { t.areaKey = key; });
      return { key, name: (edits.areaNames && edits.areaNames[key]) || '', auto, distLabel, anchor: best.anchor, trips: ts,
        km: ts.reduce((s, t) => s + t.totalKm, 0), cost: ts.reduce((s, t) => s + t.cost, 0),
        hours: ts.reduce((s, t) => s + (t.end - t.start) / H, 0) };
    }).sort((a, b) => b.trips.length - a.trips.length || b.km - a.km);
    const outKm = trips.reduce((t, x) => t + x.totalKm, 0), outCost = trips.reduce((t, x) => t + x.cost, 0);

    // ---- days
    const days = [];
    for (let k = dayKey(A, off); dayStart(k, off) < B; k = dayKey(dayStart(k, off) + DAY + H, off)) days.push(k);
    const D = {};
    days.forEach(k => { D[k] = { key: k, home: 0, town: 0, away: 0, road: 0, km: {}, fuel: 0, stops: [], far: 0, carH: 0 }; });
    const split = (st, en, fn) => {
      while (st < en) {
        const k = dayKey(st, off), nd = dayStart(k, off) + DAY, e2 = Math.min(en, nd);
        if (D[k]) fn(D[k], (e2 - st) / H);
        st = e2;
      }
    };
    visits.forEach(v => {
      split(v.st, v.en, (d, h) => { d[v.home ? 'home' : v.dh <= R ? 'town' : 'away'] += h; });
      if (!v.home) { const d = D[dayKey(v.st, off)]; if (d) d.stops.push(v); }
    });
    live.forEach(m => {
      split(m.st, m.en, (d, h) => { d.road += h; if (m.mode === 'car') d.carH += h; });
      const d = D[dayKey(m.st, off)];
      if (d) { d.km[m.mode] = (d.km[m.mode] || 0) + m.km; d.fuel += cost(m); d.far = Math.max(d.far, dh(m.p1), dh(m.p2)); }
    });
    days.forEach(k => { const d = D[k], s0 = dayStart(k, off); d.span = (Math.min(B, s0 + DAY) - Math.max(A, s0)) / H; d.totalKm = Object.values(d.km).reduce((a, b) => a + b, 0); d.out = Math.max(0, d.span - d.home); });

    // ---- rhythm (a "day" runs 04:00 → 04:00)
    const homeV = visits.filter(v => v.home);
    const firstLeave = [], lastReturn = [], lateNights = [];
    days.forEach(k => {
      const s4 = dayStart(k, off) + 4 * H, e4 = s4 + DAY;
      const dep = homeV.filter(v => v.en >= s4 && v.en < e4 && v.en < B).map(v => v.en);
      const ret = homeV.filter(v => v.st > s4 && v.st < e4).map(v => v.st);
      const d = D[k];
      d.leave = dep.length ? Math.min.apply(null, dep) : null;
      d.ret = ret.length ? Math.max.apply(null, ret) : null;
      if (d.leave) firstLeave.push((d.leave - s4) / H + 4);
      if (d.ret) { lastReturn.push((d.ret - s4) / H + 4); if (d.ret >= s4 + 20 * H) lateNights.push(k); }
    });
    const at = t => { for (const e of ev) if (e.st <= t && t < e.en && !e.ignored) return e; return null; };
    const where = e => (!e ? 'unknown' : e.k === 'a' ? 'road' : e.home ? 'home' : e.dh <= R ? 'town' : 'away');
    const midnight = { home: 0, town: 0, away: 0, road: 0, unknown: 0 };
    days.slice(1).forEach(k => { midnight[where(at(dayStart(k, off)))]++; });

    // ---- day categories (full days only)
    const fullDays = days.filter(k => dayStart(k, off) >= A && dayStart(k, off) + DAY <= B);
    const cats = [
      { key: 'in', label: 'Stayed in', test: o => o < 0.5 },
      { key: 'short', label: 'Out under 3 hours', test: o => o < 3 },
      { key: 'half', label: 'Out 3–8 hours', test: o => o < 8 },
      { key: 'long', label: 'Out 8–20 hours', test: o => o < 20 },
      { key: 'away', label: 'Away all day', test: () => true },
    ].map(c => Object.assign(c, { days: [] }));
    fullDays.forEach(k => { cats.find(c => c.test(D[k].out)).days.push(k); });

    // ---- weeks
    const weeks = {};
    days.forEach(k => {
      const dt = new Date(k + 'T00:00:00Z'), wk = new Date(dt - ((dt.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
      const w = weeks[wk] = weeks[wk] || { key: wk, home: 0, town: 0, away: 0, road: 0, km: 0 };
      ['home', 'town', 'away', 'road'].forEach(f => { w[f] += D[k][f]; });
      w.km += D[k].totalKm;
    });

    // ---- months
    const months = {};
    live.forEach(m => {
      const k = dayKey(m.st, off).slice(0, 7);
      const o = months[k] = months[k] || { key: k, km: {}, cost: 0, litres: 0 };
      o.km[m.mode] = (o.km[m.mode] || 0) + m.km; o.cost += cost(m); o.litres += litres(m);
    });

    // ---- driving pattern (car)
    const car = live.filter(m => m.mode === 'car');
    const byHour = Array.from({ length: 8 }, (_, i) => ({ from: i * 3, n: 0, km: 0, h: 0 }));
    const byWeekday = Array.from({ length: 7 }, (_, i) => ({ wd: i, n: 0, km: 0, h: 0, days: 0 }));
    days.forEach(k => { byWeekday[(new Date(k + 'T00:00:00Z').getUTCDay() + 6) % 7].days++; });
    car.forEach(m => {
      const b = byHour[Math.floor(localHour(m.st, off) / 3)], w = byWeekday[(new Date(dayKey(m.st, off) + 'T00:00:00Z').getUTCDay() + 6) % 7], h = (m.en - m.st) / H;
      b.n++; b.km += m.km; b.h += h; w.n++; w.km += m.km; w.h += h;
    });
    const localCar = car.filter(m => m.trip === undefined), outCar = car.filter(m => m.trip !== undefined);
    const shortCar = localCar.filter(m => m.km < 5 && m.km > 0.05);
    const shortKm = shortCar.reduce((t, m) => t + m.km, 0);
    const cv = S.vehicles.car, bv = S.vehicles.bike;
    const bikeSaving = cv.kmpl > 0 && bv.kmpl > 0 ? shortKm * (cv.price / cv.kmpl - bv.price / bv.kmpl) : 0;

    // ---- places
    const P = {};
    visits.forEach(v => {
      const key = v.home ? 'home' : v.placeId; // Google often splits home into several spots; show it once
      const r = P[key] = P[key] || { id: key, n: 0, h: 0, first: v.st, last: v.st, lat: v.home ? HOME[0] : v.p[0], lng: v.home ? HOME[1] : v.p[1], dh: v.home ? 0 : v.dh, home: false, days: new Set() };
      r.n++; r.h += (v.en - v.st) / H; r.last = v.st; r.days.add(dayKey(v.st, off)); if (v.home) r.home = true;
    });
    const places = Object.values(P).map(r => Object.assign(r, { nDays: r.days.size, name: (edits.placeNames && edits.placeNames[r.id]) || '' }))
      .sort((a, b) => b.n - a.n || b.h - a.h);

    // ---- flags for review
    const flags = [];
    moves.forEach(m => {
      if (m.raw === 'flight') return;
      const s = m.seg, h = (m.en - m.st) / H, speed = h > 0 ? m.km / h : 0, reasons = [], base = TR.effectiveMode(s, S, null);
      let suggest = null;
      if (S.modesUsed[s.mode] === false) { reasons.push('reassigned'); suggest = S.reassignTo; }
      if (h > 1.5 && speed < 4 && m.raw !== 'walk') { reasons.push('stationary'); suggest = 'ignore'; }
      if (speed > (SPEED_LIMIT[base] || 200) && m.km > 1) { reasons.push('too-fast'); suggest = suggest || 'ignore'; }
      if (s.prob < 0.6 && m.km > 2 && !reasons.length) reasons.push('unsure');
      if (reasons.length) flags.push({ id: s.id, m, reasons, suggest, speed, h });
    });

    // ---- EV comparison
    const carKm = byMode.car.km, EV = S.ev;
    const evRate = EV.homeRate * EV.homeShare + EV.publicRate * (1 - EV.homeShare);
    const evKwh = EV.kmPerKwh > 0 ? carKm / EV.kmPerKwh * CHARGING_LOSS : 0;

    return {
      S, off, A, B, HOME, days, D, fullDays, cats, weeks: Object.values(weeks), months: Object.values(months).sort((a, b) => a.key.localeCompare(b.key)),
      byMode, fuelCost, fuelLitres, trips, areas, outKm, outCost,
      totalKm: live.filter(m => m.mode !== 'flight').reduce((t, m) => t + m.km, 0),
      totals: ['home', 'town', 'away', 'road'].reduce((o, f) => { o[f] = days.reduce((t, k) => t + D[k][f], 0); return o; }, {}),
      rhythm: { leaveMed: median(firstLeave), leaveQ: [quart(firstLeave, 0.25), quart(firstLeave, 0.75)], retMed: median(lastReturn), retQ: [quart(lastReturn, 0.25), quart(lastReturn, 0.75)], lateNights, midnight },
      driving: { byHour, byWeekday, local: summarise(localCar), out: summarise(outCar), topDays: days.slice().sort((a, b) => (D[b].km.car || 0) - (D[a].km.car || 0)).slice(0, 5), noCarDays: fullDays.filter(k => !(D[k].km.car > 0.1)).length },
      shortCar: { n: shortCar.length, km: shortKm, saving: bikeSaving },
      places, oneOffs: places.filter(p => p.n === 1), flags, visits, moves, ev: { cost: evKwh * evRate, rate: evRate, kwh: evKwh },
      windowHours: (B - A) / H,
    };
    function summarise(ms) {
      const km = ms.reduce((t, m) => t + m.km, 0), h = ms.reduce((t, m) => t + (m.en - m.st) / H, 0);
      return { n: ms.length, km, h, speed: h ? km / h : 0, medKm: median(ms.map(m => m.km)) || 0, medMin: median(ms.map(m => (m.en - m.st) / 60000)) || 0 };
    }
  };

  TR.util = { hav, compass, dayKey, dayStart, localHour, H, DAY, MODES };
})(globalThis.TR = globalThis.TR || {});
