/* ==========================================================================
   normalize.js — turn raw rows into a fast columnar dataset
   * Original cell values are kept untouched in ds.rows (used for display/export).
   * Typed arrays / dictionary codes are DERIVED copies used only for analysis.
   * Display labels collapse whitespace only (e.g. non-breaking / double spaces);
     this is reported in Data Quality when it merges variants.
   ========================================================================== */
(function () {
  const C = IPR.CONFIG;
  const BLANK = '(Blank)';
  const cleanLabel = v => (v == null || v === '') ? '' : String(v).replace(/[\s ]+/g, ' ').trim();

  function parseDateCell(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return IPR.dateUtil.excelToMs(v);
    if (v instanceof Date) return v.getTime() - v.getTimezoneOffset() * 60000;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/); // dd/mm/yyyy (UAE)
    if (m) return Date.UTC(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return NaN;
  }

  function classifyTeam(label) {
    if (!label) return 2;
    if (C.TEAM_RULES.survey.some(r => r.test(label))) return 1;
    if (C.TEAM_RULES.operation.some(r => r.test(label))) return 0;
    return 2;
  }

  /** Dictionary-encode one column. Returns {codes:Int32Array, values:[], counts:[]} */
  function encode(rows, idx, n) {
    const codes = new Int32Array(n), dict = new Map(), values = [], counts = [];
    for (let i = 0; i < n; i++) {
      let lab = cleanLabel(rows[i][idx]);
      if (lab === '') lab = BLANK;
      let c = dict.get(lab);
      if (c === undefined) { c = values.length; dict.set(lab, c); values.push(lab); counts.push(0); }
      codes[i] = c; counts[c]++;
    }
    // sort values alphabetically (blank last) and remap codes
    const order = values.map((v, i) => i).sort((a, b) => {
      if (values[a] === BLANK) return 1; if (values[b] === BLANK) return -1;
      return values[a].localeCompare(values[b], 'en', { numeric: true, sensitivity: 'base' });
    });
    const remap = new Int32Array(values.length);
    order.forEach((old, nw) => remap[old] = nw);
    for (let i = 0; i < n; i++) codes[i] = remap[codes[i]];
    return { codes, values: order.map(o => values[o]), counts: order.map(o => counts[o]), blankCode: values.indexOf(BLANK) < 0 ? -1 : remap[values.indexOf(BLANK)] };
  }

  IPR.buildDataset = function (wbInfo) {
    const { rows, map, headers } = wbInfo;
    const n = rows.length;
    const has = k => map[k] != null;
    const ds = { n, rows, headers, map, fileName: wbInfo.fileName, sheetName: wbInfo.sheetName, headerRowNumber: wbInfo.headerRowNumber, has, BLANK };

    // ---- dates (naive clock time as UTC ms) ----
    const ts = new Float64Array(n), day = new Int32Array(n);
    const sc = map.scannedAt;
    let badDates = 0, minTs = Infinity, maxTs = -Infinity;
    for (let i = 0; i < n; i++) {
      const t = parseDateCell(rows[i][sc]);
      ts[i] = t;
      if (isNaN(t)) { day[i] = -1; badDates++; } else { day[i] = Math.floor(t / 86400000); if (t < minTs) minTs = t; if (t > maxTs) maxTs = t; }
    }
    ds.ts = ts; ds.day = day; ds.badDates = badDates; ds.minTs = minTs; ds.maxTs = maxTs;
    ds.dayList = Array.from(new Set(Array.from(day).filter(d => d >= 0))).sort((a, b) => a - b);
    if (has('woDate')) { ds.woTs = new Float64Array(n); for (let i = 0; i < n; i++) ds.woTs[i] = parseDateCell(rows[i][map.woDate]); }

    // ---- coordinates ----
    ds.hasCoords = has('lat') && has('lng');
    if (ds.hasCoords) {
      ds.lat = new Float64Array(n); ds.lng = new Float64Array(n); ds.validCoord = new Uint8Array(n);
      let miss = 0, invalid = 0;
      for (let i = 0; i < n; i++) {
        const la = rows[i][map.lat], lo = rows[i][map.lng];
        const a = la === null || la === '' ? NaN : +la, b = lo === null || lo === '' ? NaN : +lo;
        ds.lat[i] = a; ds.lng[i] = b;
        if (isNaN(a) || isNaN(b)) miss++;
        else if (Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) invalid++;
        else ds.validCoord[i] = 1;
      }
      ds.missingCoords = miss; ds.invalidCoords = invalid;
    }

    // ---- infestation flag (do not guess: unknown values are reported) ----
    ds.infested = new Uint8Array(n); ds.unrecognisedInf = new Map();
    const ic = map.infestation;
    for (let i = 0; i < n; i++) {
      const raw = rows[i][ic]; const s = cleanLabel(raw).toLowerCase().replace(/[\s_-]/g, '');
      if (s === '') continue;
      if (s === 'infested' || s === 'yes' || s === 'true' || s === '1') ds.infested[i] = 1;
      else if (s === 'notinfested' || s === 'noninfested' || s === 'no' || s === 'false' || s === '0' || s === 'clear' || s === 'none') ds.infested[i] = 0;
      else ds.unrecognisedInf.set(cleanLabel(raw), (ds.unrecognisedInf.get(cleanLabel(raw)) || 0) + 1);
    }

    // ---- dimensions (dictionary encoded) ----
    ds.dims = {};
    const dimKeys = new Set([].concat(C.PRIMARY_FILTERS, C.MORE_FILTERS, ['targetPest', 'locationType', 'activityType', 'infRank', 'lot']));
    dimKeys.forEach(k => { if (k !== 'scannedAt' && has(k)) ds.dims[k] = encode(rows, map[k], n); });
    // Observation column in this system is long free text — still a dimension
    // whitespace-merge report (original distinct raw values vs. cleaned labels)
    ds.mergedVariants = {};
    ['team', 'area', 'sector'].forEach(k => {
      if (!has(k)) return;
      const raw = new Set(); for (let i = 0; i < n; i++) { const v = rows[i][map[k]]; if (v != null && v !== '') raw.add(String(v)); }
      const diff = raw.size - (ds.dims[k].values.length - (ds.dims[k].blankCode >= 0 ? 1 : 0));
      if (diff > 0) ds.mergedVariants[k] = diff;
    });

    // ---- team type: 0 Operation, 1 Survey, 2 Unclassified ----
    ds.teamType = new Uint8Array(n).fill(2); ds.hasTeamType = has('team');
    if (ds.hasTeamType) {
      const d = ds.dims.team; const typeOfCode = d.values.map(v => v === BLANK ? 2 : classifyTeam(v));
      ds.teamTypeOfCode = typeOfCode;
      for (let i = 0; i < n; i++) ds.teamType[i] = typeOfCode[d.codes[i]];
    }

    // ---- treatment: Operation/unclassified records with materials applied or Activity Type = Treatment ----
    ds.hasTreatment = has('materials') || has('activityType');
    ds.treated = new Uint8Array(n); ds.surveyWithMaterials = 0;
    if (ds.hasTreatment) {
      const mi = has('materials') ? map.materials : -1, ai = has('activityType') ? map.activityType : -1;
      for (let i = 0; i < n; i++) {
        const m = mi >= 0 && rows[i][mi] != null && String(rows[i][mi]).trim() !== '';
        const a = ai >= 0 && /^treat/i.test(cleanLabel(rows[i][ai]));
        if (m || a) { if (ds.teamType[i] === 1) ds.surveyWithMaterials++; else ds.treated[i] = 1; }
      }
    }

    // ---- infestation ranking, status flags ----
    ds.cancelled = new Uint8Array(n);
    if (has('status')) { const d = ds.dims.status; const cc = d.values.map(v => /cancel/i.test(v)); for (let i = 0; i < n; i++) ds.cancelled[i] = cc[d.codes[i]] ? 1 : 0; }

    // ---- scanned-at pseudo dimension: numeric ----
    // ---- duplicates: same WO + point/barcode + Scanned At ----
    ds.dupCount = 0; ds.dupGroups = 0; ds.isDup = new Uint8Array(n);
    if (has('wo') && (has('barcode') || has('inspPoint')) ) {
      const bi = has('barcode') ? map.barcode : map.inspPoint, seen = new Map();
      for (let i = 0; i < n; i++) {
        const key = rows[i][map.wo] + '|' + rows[i][bi] + '|' + rows[i][sc];
        const g = seen.get(key);
        if (g === undefined) seen.set(key, [i]); else g.push(i);
      }
      seen.forEach(g => { if (g.length > 1) { ds.dupGroups++; ds.dupCount += g.length - 1; g.forEach(i => ds.isDup[i] = 1); } });
    }

    ds.period = IPR.describePeriod(ds.dayList);
    return ds;
  };

  IPR.cleanLabel = cleanLabel;
})();
