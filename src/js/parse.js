// Reads a Google Timeline export into one normalised shape.
// Supported: Android on-device export ({semanticSegments}) and iPhone export (top-level array).
(function (TR) {
  'use strict';

  const MODE_MAP = {
    IN_PASSENGER_VEHICLE: 'car', IN_VEHICLE: 'car', DRIVING: 'car', IN_TAXI: 'car', IN_CAR: 'car',
    MOTORCYCLING: 'bike',
    IN_BUS: 'bus',
    IN_TRAIN: 'train', IN_SUBWAY: 'train', IN_TRAM: 'train', IN_RAIL_VEHICLE: 'train',
    WALKING: 'walk', RUNNING: 'walk', ON_FOOT: 'walk', HIKING: 'walk',
    CYCLING: 'cycle', ON_BICYCLE: 'cycle',
    FLYING: 'flight',
    IN_FERRY: 'other', SAILING: 'other', SKIING: 'other', UNKNOWN_ACTIVITY_TYPE: 'other',
  };

  function modeOf(type) {
    if (!type) return 'other';
    const key = String(type).trim().toUpperCase().replace(/\s+/g, '_');
    return MODE_MAP[key] || 'other';
  }

  // "11.95°, 79.82°" or "geo:11.95,79.82"
  function latLng(s) {
    if (!s) return null;
    if (typeof s === 'object') s = s.latLng || s.LatLng || s.point || '';
    const m = String(s).replace('geo:', '').match(/(-?\d+(?:\.\d+)?)\D+?(-?\d+(?:\.\d+)?)/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  }

  function isoOffset(s) {
    const m = String(s).match(/([+-])(\d\d):?(\d\d)$/);
    if (!m) return /Z$/.test(s) ? 0 : null;
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  }

  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));

  function parseAndroid(json) {
    const segs = [], paths = [];
    let lastOff = null;
    json.semanticSegments.forEach((s, i) => {
      const start = Date.parse(s.startTime), end = Date.parse(s.endTime);
      if (isNaN(start) || isNaN(end)) return;
      let offS = s.startTimeTimezoneUtcOffsetMinutes, offE = s.endTimeTimezoneUtcOffsetMinutes;
      if (offS === undefined) offS = lastOff;
      if (offE === undefined) offE = offS;
      if (offS !== null && offS !== undefined) lastOff = offE;
      const base = { id: 'a' + i, start, end, offStart: offS, offEnd: offE };
      if (s.visit) {
        const c = s.visit.topCandidate || {};
        const p = latLng(c.placeLocation);
        if (!p) return;
        segs.push(Object.assign(base, {
          kind: 'visit', level: num(s.visit.hierarchyLevel, 0), placeId: c.placeId || ('p' + p.join(',')),
          lat: p[0], lng: p[1], semantic: c.semanticType || 'UNKNOWN', prob: num(c.probability, 1),
        }));
      } else if (s.activity) {
        const a = s.activity, c = a.topCandidate || {};
        const p1 = latLng(a.start), p2 = latLng(a.end);
        if (!p1 || !p2) return;
        segs.push(Object.assign(base, {
          kind: 'move', rawType: c.type || 'UNKNOWN', mode: modeOf(c.type), prob: num(c.probability, 1),
          km: num(a.distanceMeters, 0) / 1000, from: p1, to: p2,
        }));
      } else if (s.timelinePath) {
        s.timelinePath.forEach(q => {
          const p = latLng(q.point), t = Date.parse(q.time);
          if (p && !isNaN(t)) paths.push({ t, lat: p[0], lng: p[1] });
        });
      } else if (s.timelineMemory && s.timelineMemory.trip) {
        segs.push(Object.assign(base, { kind: 'memory', kmFromOrigin: num(s.timelineMemory.trip.distanceFromOriginKms, 0) }));
      }
    });
    let home = null;
    const fp = (json.userLocationProfile && json.userLocationProfile.frequentPlaces) || [];
    const h = fp.find(p => p.label === 'HOME');
    if (h) { const p = latLng(h.placeLocation); if (p) home = { lat: p[0], lng: p[1] }; }
    return { segs, paths, home };
  }

  function parseIOS(arr) {
    const segs = [], paths = [];
    arr.forEach((s, i) => {
      const start = Date.parse(s.startTime), end = Date.parse(s.endTime);
      if (isNaN(start) || isNaN(end)) return;
      const base = { id: 'i' + i, start, end, offStart: isoOffset(s.startTime), offEnd: isoOffset(s.endTime) };
      if (s.visit) {
        const c = s.visit.topCandidate || {};
        const p = latLng(c.placeLocation);
        if (!p) return;
        segs.push(Object.assign(base, {
          kind: 'visit', level: num(s.visit.hierarchyLevel, 0), placeId: c.placeID || c.placeId || ('p' + p.join(',')),
          lat: p[0], lng: p[1], semantic: (c.semanticType || 'Unknown').toUpperCase().replace(/\s+/g, '_'), prob: num(c.probability, 1),
        }));
      } else if (s.activity) {
        const a = s.activity, c = a.topCandidate || {};
        const p1 = latLng(a.start), p2 = latLng(a.end);
        if (!p1 || !p2) return;
        segs.push(Object.assign(base, {
          kind: 'move', rawType: c.type || 'unknown', mode: modeOf(c.type), prob: num(c.probability, 1),
          km: num(a.distanceMeters, 0) / 1000, from: p1, to: p2,
        }));
      } else if (s.timelinePath) {
        s.timelinePath.forEach(q => {
          const p = latLng(q.point);
          if (p) paths.push({ t: start + num(q.durationMinutesOffsetFromStartTime, 0) * 60000, lat: p[0], lng: p[1] });
        });
      } else if (s.timelineMemory) {
        segs.push(Object.assign(base, { kind: 'memory', kmFromOrigin: 0 }));
      }
    });
    return { segs, paths, home: null };
  }

  TR.parseTimeline = function (json) {
    let out, format;
    if (json && Array.isArray(json.semanticSegments)) { out = parseAndroid(json); format = 'Android'; }
    else if (Array.isArray(json) && json.some(s => s && s.startTime && (s.visit || s.activity || s.timelinePath))) { out = parseIOS(json); format = 'iPhone'; }
    else if (json && (json.locations || json.timelineObjects)) {
      throw new Error('This looks like an older Google Takeout file. This tool reads the newer export made from the Google Maps app on your phone (Settings → Location → Timeline → Export Timeline data).');
    } else {
      throw new Error('This file doesn\'t look like a Google Timeline export.');
    }
    out.segs.sort((a, b) => a.start - b.start);
    out.paths.sort((a, b) => a.t - b.t);
    // fill missing offsets from neighbours
    let last = null;
    out.segs.forEach(s => { if (s.offStart === null || s.offStart === undefined) s.offStart = last; else last = s.offEnd; if (s.offEnd === null || s.offEnd === undefined) s.offEnd = s.offStart; });
    const firstKnown = (out.segs.find(s => s.offStart !== null && s.offStart !== undefined) || {}).offStart || 0;
    out.segs.forEach(s => { if (s.offStart === null || s.offStart === undefined) s.offStart = firstKnown; if (s.offEnd === null || s.offEnd === undefined) s.offEnd = s.offStart; });
    out.format = format;
    out.first = out.segs.length ? out.segs[0].start : null;
    out.last = out.segs.length ? out.segs.reduce((m, s) => Math.max(m, s.end), 0) : null;
    out.fingerprint = format + ':' + out.segs.length + ':' + out.first + ':' + out.last;
    return out;
  };
  TR.modeOf = modeOf;
})(globalThis.TR = globalThis.TR || {});
