// Offline place names: nearest town or city from a bundled GeoNames list. No network.
(function (TR) {
  'use strict';
  let towns = null, grid = null;
  function load() {
    if (towns) return;
    towns = (TR.GAZ || '').split(';').filter(Boolean).map(s => { const p = s.split('|'); return { name: p[0], lat: +p[1], lng: +p[2], pop: +p[3] * 1000 }; });
    grid = {};
    towns.forEach(t => { const k = Math.floor(t.lat) + ',' + Math.floor(t.lng); (grid[k] = grid[k] || []).push(t); });
  }
  function near(lat, lng, radiusKm) {
    load();
    const out = [], la = Math.floor(lat), lo = Math.floor(lng);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) (grid[(la + i) + ',' + (lo + j)] || []).forEach(t => {
      const d = TR.util.hav([lat, lng], [t.lat, t.lng]);
      if (d <= radiusKm) out.push({ t, d });
    });
    return out.sort((a, b) => a.d - b.d);
  }
  const cache = {};
  // { town, city, label }: town = best nearby town; city = a big city (1M+) the place belongs to, if any.
  TR.geoName = function (lat, lng) {
    const key = lat.toFixed(3) + ',' + lng.toFixed(3);
    if (cache[key]) return cache[key];
    const c = near(lat, lng, 40);
    let town = null, city = null;
    if (c.length && c[0].d <= 25) {
      const within = c.filter(x => x.d <= Math.max(3, c[0].d * 1.5));
      town = within.reduce((a, b) => (b.t.pop > a.t.pop ? b : a)).t.name;
    }
    const big = c.filter(x => x.t.pop >= 1e6)[0];
    if (big) city = big.t.name;
    const label = town ? (city && city !== town ? `${town}, ${city}` : town) : (city || '');
    return (cache[key] = { town, city, label });
  };
  // Short name for a region (a stay or a destination): the big city if there is one, otherwise the town.
  TR.regionName = function (lat, lng) { const g = TR.geoName(lat, lng); return g.city || g.town || ''; };
})(globalThis.TR = globalThis.TR || {});
// Towns inside a [south, west, north, east] box, biggest first (for map labels).
(function (TR) {
  TR.townsIn = function (box) {
    TR.geoName(0, 0); // ensure loaded
    return (TR.GAZ || '').split(';').filter(Boolean).map(s => { const p = s.split('|'); return { name: p[0], lat: +p[1], lng: +p[2], pop: +p[3] * 1000 }; })
      .filter(t => t.lat >= box[0] && t.lat <= box[2] && t.lng >= box[1] && t.lng <= box[3]).sort((a, b) => b.pop - a.pop);
  };
})(globalThis.TR = globalThis.TR || {});
