// Generates a realistic, entirely made-up Timeline export (Android format) for demos.
// Fictional person living in Porto, Portugal. No real data.
(function (TR) {
  'use strict';

  TR.makeSample = function () {
    let seed = 20260701;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pick = a => a[Math.floor(rnd() * a.length)];
    const OFF = 60; // Portugal summer time
    const H = 3600000, M = 60000;
    const P = {
      home: [41.1579, -8.6291], office: [41.1780, -8.5980], gym: [41.1532, -8.6410], cafe: [41.1470, -8.6110],
      market: [41.1620, -8.6200], parents: [41.1200, -8.6100], beach: [41.1650, -8.6850], friend: [41.1850, -8.6600],
      bookshop: [41.1468, -8.6148], park: [41.1590, -8.6720], braga: [41.5454, -8.4265], aveiro: [40.6405, -8.6538],
      coimbra: [40.2033, -8.4103], guimaraes: [41.4425, -8.2918], airport: [41.2481, -8.6814], lhr: [51.4700, -0.4543],
    };
    const ids = {}; Object.keys(P).forEach((k, i) => { ids[k] = 'ChIJsample' + String(i).padStart(4, '0') + k; });
    const segs = [];
    const iso = t => { const d = new Date(t + OFF * M); return d.toISOString().replace('Z', '+01:00'); };
    const km = (a, b) => { const r = Math.PI / 180; const h = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
    const ll = p => `${p[0].toFixed(7)}°, ${p[1].toFixed(7)}°`;
    const jit = p => [p[0] + (rnd() - 0.5) * 0.0008, p[1] + (rnd() - 0.5) * 0.0008];
    const visit = (t0, t1, place, sem) => segs.push({
      startTime: iso(t0), endTime: iso(t1), startTimeTimezoneUtcOffsetMinutes: OFF, endTimeTimezoneUtcOffsetMinutes: OFF,
      visit: { hierarchyLevel: 0, probability: 0.9, topCandidate: { placeId: ids[place], semanticType: sem || (place === 'home' ? 'INFERRED_HOME' : place === 'office' ? 'INFERRED_WORK' : 'UNKNOWN'), probability: 0.8, placeLocation: { latLng: ll(P[place]) } } },
    });
    const move = (t0, from, to, type, opts) => {
      opts = opts || {};
      const a = P[from], b = P[to], d = km(a, b) * (opts.detour || 1.3);
      const speed = opts.speed || { IN_PASSENGER_VEHICLE: 28, MOTORCYCLING: 24, WALKING: 4.5, CYCLING: 14, IN_BUS: 30, FLYING: 750 }[type];
      const dur = opts.minutes ? opts.minutes * M : Math.max(4 * M, d / speed * H);
      const t1 = t0 + dur;
      segs.push({
        startTime: iso(t0), endTime: iso(t1), startTimeTimezoneUtcOffsetMinutes: OFF, endTimeTimezoneUtcOffsetMinutes: OFF,
        activity: { start: { latLng: ll(jit(a)) }, end: { latLng: ll(jit(b)) }, distanceMeters: (opts.km || d) * 1000, probability: 0.95, topCandidate: { type: opts.label || type, probability: opts.prob || 0.85 } },
      });
      if (type !== 'FLYING') {
        const n = Math.max(2, Math.round(d / 2)), pts = [], curve = (rnd() - 0.5) * 0.35, wob = (rnd() - 0.5) * 0.06;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        for (let i = 1; i < n; i++) {
          const f = i / n, bend = Math.sin(f * Math.PI) * curve + Math.sin(f * Math.PI * 3) * wob;
          pts.push({ point: ll([a[0] + dx * f - dy * bend, a[1] + dy * f + dx * bend]), time: iso(t0 + dur * f) });
        }
        segs.push({ startTime: iso(t0), endTime: iso(t1), timelinePath: pts });
      }
      return t1;
    };

    const day0 = Date.parse('2026-06-28T00:00:00+01:00');
    // arrival from London
    let t = day0 + 9 * H;
    visit(day0 - 30 * H, t, 'lhr');
    t = move(t, 'lhr', 'airport', 'FLYING', { km: 1580, minutes: 150 });
    visit(t, t + 50 * M, 'airport'); t += 50 * M;
    t = move(t, 'airport', 'home', 'IN_PASSENGER_VEHICLE');
    let at = 'home', since = t;
    const go = (to, type, opts) => { visit(since, t, at); t = move(t, at, to, type, opts); at = to; since = t; };
    const wait = h => { t += h * H; };

    const excursions = { 3: 'braga', 10: 'aveiro', 17: 'guimaraes', 24: 'coimbra', 31: 'braga', 38: 'aveiro', 45: 'braga' };
    for (let d = 1; d <= 54; d++) {
      const base = day0 + d * 24 * H, wd = new Date(base + OFF * M).getUTCDay();
      t = Math.max(t, base + (7.5 + rnd() * 1.5) * H);
      if (excursions[d]) {
        const dest = excursions[d];
        go('cafe', 'IN_PASSENGER_VEHICLE'); wait(0.3);
        if (d === 24) go(dest, 'IN_PASSENGER_VEHICLE', { label: 'IN_BUS', prob: 0.46 }); // mislabelled drive
        else go(dest, 'IN_PASSENGER_VEHICLE', { detour: 1.2, speed: 75 });
        wait(3 + rnd() * 4);
        if (d === 38) { go('aveiro', 'IN_PASSENGER_VEHICLE', { km: 3.1, minutes: 14 * 60 }); } // parked phone logged as a drive
        go('home', 'IN_PASSENGER_VEHICLE', { detour: 1.2, speed: d === 31 ? 260 : 72 }); // d31: GPS glitch speed
        continue;
      }
      if (wd >= 1 && wd <= 5) {
        go('office', rnd() < 0.8 ? 'IN_PASSENGER_VEHICLE' : 'MOTORCYCLING'); wait(4 + rnd());
        if (rnd() < 0.5) { go('cafe', 'WALKING', { km: 0.6, minutes: 9 }); wait(0.7); go('office', 'WALKING', { km: 0.6, minutes: 9 }); }
        wait(3.5 + rnd());
        if (rnd() < 0.45) { go('gym', 'IN_PASSENGER_VEHICLE'); wait(1.2); }
        if (rnd() < 0.3) { go('market', 'IN_PASSENGER_VEHICLE'); wait(0.4); }
        go('home', at === 'office' && rnd() < 0.3 ? 'MOTORCYCLING' : 'IN_PASSENGER_VEHICLE');
        if (rnd() < 0.25) { wait(2); go('friend', 'MOTORCYCLING'); wait(2.5 + rnd() * 2); go('home', 'MOTORCYCLING'); }
      } else if (rnd() < 0.3) {
        t += 14 * H; // lazy day at home
      } else {
        t += 2 * H;
        const plan = [pick(['parents', 'beach', 'park', 'bookshop']), pick(['cafe', 'market', 'friend'])];
        go(plan[0], plan[0] === 'park' ? 'CYCLING' : 'IN_PASSENGER_VEHICLE'); wait(2 + rnd() * 3);
        if (rnd() < 0.7) { go(plan[1], 'IN_PASSENGER_VEHICLE'); wait(1 + rnd() * 2); }
        go('home', at === 'park' ? 'CYCLING' : 'IN_PASSENGER_VEHICLE');
      }
      if (d % 9 === 4) { wait(1); go('cafe', 'IN_BUS', { prob: 0.41 }); wait(1.5); go('home', 'IN_PASSENGER_VEHICLE'); }
    }
    // departure
    t = Math.max(t, day0 + 55 * 24 * H + 6 * H);
    go('airport', 'IN_PASSENGER_VEHICLE'); wait(2);
    visit(since, t, 'airport');
    t = move(t, 'airport', 'lhr', 'FLYING', { km: 1580, minutes: 155 });
    visit(t, t + 40 * H, 'lhr', 'INFERRED_HOME');
    return {
      semanticSegments: segs,
      rawSignals: [],
      userLocationProfile: { frequentPlaces: [{ placeId: ids.home, placeLocation: ll(P.home), label: 'HOME' }, { placeId: ids.office, placeLocation: ll(P.office), label: 'WORK' }] },
    };
  };
})(globalThis.TR = globalThis.TR || {});
