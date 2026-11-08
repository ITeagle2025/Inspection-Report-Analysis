/* ==========================================================================
   map.js — Leaflet map with viewport grid-clustering (no 70k DOM markers)
   Modes: Inspection Points (clusters) · Infested Only · Infestation Heatmap
   Clusters are computed per zoom/pan from the filtered, mappable rows only;
   at most a few hundred canvas circle markers exist at any time.
   ========================================================================== */
(function () {
  const K = IPR.CONFIG.COLORS, F = IPR.fmt;
  const M = IPR.Map = { map: null, mode: 'points', layer: null, heat: null, ds: null };
  const BASEMAPS = {
    light: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', 'Esri World Light Gray'],
    street: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', 'Esri World Street Map'],
    sat: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Esri World Imagery']
  };

  M.init = function (el) {
    if (M.map) return;
    M.map = L.map(el, { preferCanvas: true, zoomControl: true, minZoom: 8, maxZoom: 19 }).setView([24.35, 54.55], 10);
    M.setBase('light');
    M.renderer = L.canvas({ padding: 0.5 });
    M.layer = L.layerGroup().addTo(M.map);
    M.map.on('moveend zoomend', () => M.draw());
    M.map.on('click', () => {});
  };
  M.setBase = function (k) {
    if (M.base) M.map.removeLayer(M.base);
    M.base = L.tileLayer(BASEMAPS[k][0], { attribution: 'Tiles © ' + BASEMAPS[k][1] + ' / Esri', maxZoom: 19 }).addTo(M.map);
    M.base.bringToBack();
  };

  M.setMode = function (m) { M.mode = m; M.draw(true); };

  /** Called when filters change or tab shown. */
  M.update = function (ds, fit) {
    M.ds = ds; if (!M.map) return;
    M.map.invalidateSize();
    // collect mappable filtered rows
    const idx = ds.idx, pts = []; let infested = 0;
    for (let j = 0; j < idx.length; j++) { const i = idx[j]; if (ds.validCoord[i]) { pts.push(i); if (ds.infested[i]) infested++; } }
    M.pts = Int32Array.from(pts); M.infestedCount = infested; M.unmapped = idx.length - pts.length;
    if (fit && pts.length) {
      let a = 90, b = -90, c = 180, d = -180;
      // robust fit: ignore extreme 0.5% outliers
      const lats = Array.from(M.pts, i => ds.lat[i]).sort((x, y) => x - y), lngs = Array.from(M.pts, i => ds.lng[i]).sort((x, y) => x - y);
      const lo = Math.floor(lats.length * 0.005), hi = Math.ceil(lats.length * 0.995) - 1;
      M.map.fitBounds([[lats[lo], lngs[lo]], [lats[hi], lngs[hi]]], { padding: [30, 30] });
    }
    M.draw(true);
    const st = document.getElementById('mapStats');
    if (st) st.innerHTML = '<b>' + F.int(M.pts.length) + '</b> mapped · <b>' + F.int(M.infestedCount) + '</b> infested' + (M.unmapped ? ' · <span class="warn">' + F.int(M.unmapped) + ' without coordinates</span>' : '');
  };

  const sizeFor = n => Math.min(30, 11 + Math.log10(n) * 6);

  M.draw = function () {
    if (!M.map || !M.ds || !M.pts) return;
    const ds = M.ds; M.layer.clearLayers();
    if (M.heat) { M.map.removeLayer(M.heat); M.heat = null; }
    const pts = M.pts, onlyInf = M.mode === 'infested';

    if (M.mode === 'heat') {
      const arr = []; for (let j = 0; j < pts.length; j++) { const i = pts[j]; if (ds.infested[i]) arr.push([ds.lat[i], ds.lng[i], 1]); }
      if (!arr.length || !M.map.getSize().x) return;
      M.heat = L.heatLayer(arr, { radius: 18, blur: 20, maxZoom: 15, minOpacity: 0.35, gradient: { 0.2: '#9ad3da', 0.45: '#0890A0', 0.7: '#E8A33C', 1: '#E0572F' } }).addTo(M.map);
      return;
    }

    const z = M.map.getZoom(), bounds = M.map.getBounds().pad(0.1);
    const cell = z >= 17 ? 0 : 64; // px; 0 = no clustering
    const proj = M.map.options.crs, scale = 256 * Math.pow(2, z);
    const cells = new Map(); let single = [];
    const south = bounds.getSouth(), north = bounds.getNorth(), west = bounds.getWest(), east = bounds.getEast();
    for (let j = 0; j < pts.length; j++) {
      const i = pts[j], la = ds.lat[i], ln = ds.lng[i];
      if (la < south || la > north || ln < west || ln > east) continue;
      const inf = ds.infested[i]; if (onlyInf && !inf) continue;
      if (!cell) { single.push(i); continue; }
      // web-mercator pixel coordinates at current zoom
      const x = (ln + 180) / 360 * scale, s = Math.sin(la * Math.PI / 180), y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
      const key = Math.floor(x / cell) + ':' + Math.floor(y / cell);
      let c = cells.get(key); if (!c) cells.set(key, c = { n: 0, inf: 0, sla: 0, sln: 0, first: i, la0: la, la1: la, ln0: ln, ln1: ln });
      c.n++; c.inf += inf; c.sla += la; c.sln += ln;
      if (la < c.la0) c.la0 = la; if (la > c.la1) c.la1 = la; if (ln < c.ln0) c.ln0 = ln; if (ln > c.ln1) c.ln1 = ln;
    }
    const MAX_SINGLE = 1500;
    cells.forEach(c => {
      if (c.n === 1) { single.push(c.first); return; }
      const rate = c.inf / c.n, col = c.inf === 0 ? K.adphc : (rate >= 0.1 ? K.alert : '#B0693F');
      const r = sizeFor(c.n);
      const mk = L.circleMarker([c.sla / c.n, c.sln / c.n], { renderer: M.renderer, radius: r, color: '#fff', weight: 2, fillColor: col, fillOpacity: 0.85 });
      mk.bindTooltip(F.int(c.n) + ' points · ' + F.int(c.inf) + ' infested', { direction: 'top' });
      mk.on('click', () => M.map.fitBounds([[c.la0, c.ln0], [c.la1, c.ln1]], { padding: [40, 40], maxZoom: 18 }));
      mk.addTo(M.layer);
      // count label via divIcon-free approach: small text marker
      L.marker([c.sla / c.n, c.sln / c.n], { interactive: false, icon: L.divIcon({ className: 'ccount', html: '<span>' + (c.n >= 1000 ? (c.n / 1000).toFixed(c.n >= 10000 ? 0 : 1) + 'k' : c.n) + '</span>', iconSize: [r * 2, r * 2], iconAnchor: [r, r] }) }).addTo(M.layer);
    });
    if (single.length > MAX_SINGLE) { single = single.slice(0, MAX_SINGLE); }
    single.forEach(i => {
      const inf = ds.infested[i];
      const mk = L.circleMarker([ds.lat[i], ds.lng[i]], { renderer: M.renderer, radius: inf ? 6 : 4.5, color: '#fff', weight: 1.5, fillColor: inf ? K.alert : K.adphc, fillOpacity: 0.95 });
      mk.bindPopup(() => M.popup(i), { maxWidth: 320 });
      mk.addTo(M.layer);
    });
  };

  M.popup = function (i) {
    const ds = M.ds, r = ds.rows[i], row = (label, key) => ds.has(key) && r[ds.map[key]] != null && r[ds.map[key]] !== '' ? '<tr><th>' + label + '</th><td>' + F.esc(IPR.cellText(ds, i, key)) + '</td></tr>' : '';
    const inf = ds.infested[i];
    return '<div class="pop"><div class="pophead ' + (inf ? 'inf' : '') + '">' + (inf ? 'Infested' : 'Not infested') + '</div><table>' +
      row('WO#', 'wo') + row('Inspection Point', 'inspPoint') + row('Event', 'event') + row('Scanned At', 'scannedAt') + row('Area', 'area') + row('Sector', 'sector') + row('Team', 'team') + row('Program', 'program') + row('Target Pest', 'targetPest') + row('Infestation', 'infestation') + row('Ranking', 'infRank') + row('Status', 'status') + '</table></div>';
  };

  /** Search by WO#, barcode, inspection point -> fly to first match among filtered, mappable rows. */
  M.search = function (q) {
    const ds = M.ds; q = (q || '').trim().toLowerCase(); if (!q || !M.pts) return 0;
    const keys = ['wo', 'barcode', 'inspPoint'].filter(k => ds.has(k));
    for (let j = 0; j < M.pts.length; j++) {
      const i = M.pts[j];
      for (const k of keys) { const v = ds.rows[i][ds.map[k]]; if (v != null && String(v).toLowerCase().includes(q)) {
        M.map.setView([ds.lat[i], ds.lng[i]], 18); L.popup({ maxWidth: 320 }).setLatLng([ds.lat[i], ds.lng[i]]).setContent(M.popup(i)).openOn(M.map); return 1; } }
    }
    return 0;
  };

  M.reset = function () { if (M.layer) M.layer.clearLayers(); if (M.heat && M.map) { M.map.removeLayer(M.heat); M.heat = null; } M.pts = null; M.ds = null; };

  /** Fixed (non-interactive) map for the PDF: Esri light-grey tiles stitched on a canvas,
      every filtered point drawn (infested = coral), busiest area names labelled.
      Resolves to a PNG data URL, or null if tiles cannot be loaded (caller falls back). */
  M.staticMapImage = async function (ds, w, h) {
    const idx = ds.idx, pts = [];
    for (let j = 0; j < idx.length; j++) if (ds.validCoord && ds.validCoord[idx[j]]) pts.push(idx[j]);
    if (!pts.length) return null;
    const sl = pts.map(i => ds.lat[i]).sort((a, b) => a - b), sn = pts.map(i => ds.lng[i]).sort((a, b) => a - b);
    const lo = Math.floor(pts.length * 0.005), hi = Math.ceil(pts.length * 0.995) - 1;
    const la0 = sl[lo], la1 = sl[hi], ln0 = sn[lo], ln1 = sn[hi];
    const W = w * 2, H = h * 2, pad = 50;
    const wx = (lng, z) => (lng + 180) / 360 * 256 * Math.pow(2, z);
    const wy = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); };
    let z = 17; for (; z > 6; z--) if (Math.abs(wx(ln1, z) - wx(ln0, z)) <= W - 2 * pad && Math.abs(wy(la0, z) - wy(la1, z)) <= H - 2 * pad) break;
    const cx = (wx(ln0, z) + wx(ln1, z)) / 2, cy = (wy(la0, z) + wy(la1, z)) / 2, x0 = cx - W / 2, y0 = cy - H / 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    g.fillStyle = '#EEF1F4'; g.fillRect(0, 0, W, H);
    const loadImg = src => new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; const t = setTimeout(() => res(null), 9000); im.onload = () => { clearTimeout(t); res(im); }; im.onerror = () => { clearTimeout(t); res(null); }; im.src = src; });
    const n = Math.pow(2, z), jobs = [];
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + H) / 256); ty++) for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W) / 256); tx++) {
      if (ty < 0 || ty >= n) continue;
      const url = BASEMAPS.light[0].replace('{z}', z).replace('{y}', ty).replace('{x}', ((tx % n) + n) % n);
      jobs.push(loadImg(url).then(im => { if (im) g.drawImage(im, tx * 256 - x0, ty * 256 - y0); return !!im; }));
    }
    const ok = (await Promise.all(jobs)).filter(Boolean).length;
    if (!ok) return null;
    const X = ln => wx(ln, z) - x0, Y = la => wy(la, z) - y0;
    g.fillStyle = 'rgba(0,48,96,0.45)';
    for (const i of pts) if (!ds.infested[i]) { g.beginPath(); g.arc(X(ds.lng[i]), Y(ds.lat[i]), 2.4, 0, 6.3); g.fill(); }
    g.fillStyle = K.alert; g.strokeStyle = '#fff'; g.lineWidth = 1.4;
    for (const i of pts) if (ds.infested[i]) { g.beginPath(); g.arc(X(ds.lng[i]), Y(ds.lat[i]), 5, 0, 6.3); g.fill(); g.stroke(); }
    // area names (median position of each area's points), busiest first, no overlaps
    if (ds.dims.area) {
      const d = ds.dims.area, m = new Map();
      for (const i of pts) { const c = d.codes[i]; if (c === d.blankCode) continue; let o = m.get(c); if (!o) m.set(c, o = { la: [], ln: [] }); o.la.push(ds.lat[i]); o.ln.push(ds.lng[i]); }
      const med = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
      const list = Array.from(m, ([c, o]) => ({ name: d.values[c], n: o.la.length, x: X(med(o.ln)), y: Y(med(o.la)) })).sort((a, b) => b.n - a.n).slice(0, 14);
      g.font = '700 22px Inter, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const placed = [];
      for (const a of list) {
        const tw = g.measureText(a.name).width, box = { l: a.x - tw / 2 - 4, r: a.x + tw / 2 + 4, t: a.y - 15, b: a.y + 15 };
        if (box.l < 4 || box.r > W - 4 || box.t < 4 || box.b > H - 4) continue;
        if (placed.some(p => !(box.r < p.l || box.l > p.r || box.b < p.t || box.t > p.b))) continue;
        placed.push(box); g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.strokeText(a.name, a.x, a.y); g.fillStyle = K.adphc; g.fillText(a.name, a.x, a.y);
      }
    }
    // legend + attribution
    g.textAlign = 'left'; g.font = '600 20px Inter, Arial, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillRect(14, 14, 300, 78);
    g.fillStyle = K.alert; g.beginPath(); g.arc(34, 38, 7, 0, 6.3); g.fill(); g.fillStyle = K.ink; g.fillText('Infested inspection point', 50, 39);
    g.fillStyle = 'rgba(0,48,96,0.6)'; g.beginPath(); g.arc(34, 70, 5, 0, 6.3); g.fill(); g.fillStyle = K.ink; g.fillText('Other inspection point', 50, 71);
    g.font = '500 16px Inter, Arial, sans-serif'; g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(W - 190, H - 30, 190, 30); g.fillStyle = K.muted; g.fillText('Basemap © Esri', W - 10, H - 14);
    try { return cv.toDataURL('image/png'); } catch (e) { return null; }
  };

  /** Schematic point plot (no basemap) used by the management report. Returns data URL. */
  M.staticImage = function (ds, w, h) {
    const cv = document.createElement('canvas'); cv.width = w * 2; cv.height = h * 2; const g = cv.getContext('2d'); g.scale(2, 2);
    g.fillStyle = '#F4F6F8'; g.fillRect(0, 0, w, h);
    const idx = ds.idx; let la0 = 90, la1 = -90, ln0 = 180, ln1 = -180, n = 0; const lats = [], lngs = [];
    for (let j = 0; j < idx.length; j++) { const i = idx[j]; if (ds.validCoord && ds.validCoord[i]) { lats.push(ds.lat[i]); lngs.push(ds.lng[i]); } }
    if (!lats.length) return null;
    const sl = lats.slice().sort((a, b) => a - b), sn = lngs.slice().sort((a, b) => a - b), lo = Math.floor(sl.length * 0.005), hi = Math.ceil(sl.length * 0.995) - 1;
    la0 = sl[lo]; la1 = sl[hi]; ln0 = sn[lo]; ln1 = sn[hi];
    const kx = Math.cos((la0 + la1) / 2 * Math.PI / 180), spanX = (ln1 - ln0) * kx, spanY = la1 - la0, pad = 16;
    const s = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY), ox = (w - spanX * s) / 2, oy = (h - spanY * s) / 2;
    const X = ln => ox + (ln - ln0) * kx * s, Y = la => h - oy - (la - la0) * s;
    g.strokeStyle = '#E3E7EB'; g.lineWidth = 1; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(w * i / 6, 0); g.lineTo(w * i / 6, h); g.moveTo(0, h * i / 6); g.lineTo(w, h * i / 6); g.stroke(); }
    let k = 0;
    for (let j = 0; j < idx.length; j++) { const i = idx[j]; if (!ds.validCoord[i] || ds.infested[i]) continue; g.fillStyle = 'rgba(0,48,96,0.35)'; g.fillRect(X(ds.lng[i]), Y(ds.lat[i]), 2, 2); }
    for (let j = 0; j < idx.length; j++) { const i = idx[j]; if (!ds.validCoord[i] || !ds.infested[i]) continue; g.fillStyle = K.alert; g.beginPath(); g.arc(X(ds.lng[i]), Y(ds.lat[i]), 2.6, 0, 6.3); g.fill(); }
    return cv.toDataURL('image/png');
  };
})();
