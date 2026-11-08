/* ==========================================================================
   validate.js — data validation / quality report (never repairs data silently)
   Returns { checks:[{level:'ok'|'warn'|'info'|'error', text, detail?}], summary }
   ========================================================================== */
(function () {
  const C = IPR.CONFIG, F = IPR.fmt;

  IPR.validate = function (ds) {
    const checks = [], add = (level, text, detail) => checks.push({ level, text, detail });
    const n = ds.n;

    add('ok', 'Excel loaded — ' + ds.fileName, 'Worksheet "' + ds.sheetName + '", header found on row ' + ds.headerRowNumber + '.');
    add('ok', F.int(n) + ' records detected');

    const optional = Object.keys(C.COLUMNS).filter(k => !C.COLUMNS[k].required);
    const missingOpt = optional.filter(k => !ds.has(k));
    add('ok', 'Required columns detected (' + Object.keys(C.COLUMNS).filter(k => C.COLUMNS[k].required).map(k => C.COLUMNS[k].label).join(', ') + ')');
    if (missingOpt.length) add('info', missingOpt.length + ' optional column(s) not in this file — related filters/analysis are hidden', missingOpt.map(k => C.COLUMNS[k].label).join(', '));

    if (ds.badDates) add('warn', F.int(ds.badDates) + ' records have a missing or unreadable Scanned At date', 'These records are kept, but are excluded from date filters and trends.');
    if (ds.dayList.length) {
      add('ok', 'Reporting period detected — ' + ds.period.label, ds.period.activeDays + ' active date(s).' + (ds.period.hasGaps ? ' Dates are separated by gaps of more than ' + C.GAP_DAYS + ' days, so the period is shown in segments.' : ''));
    } else add('error', 'No valid dates found in Scanned At');

    // coordinates
    if (ds.hasCoords) {
      const bad = ds.missingCoords + ds.invalidCoords;
      add('ok', 'Coordinates detected (' + F.int(n - bad) + ' mappable records)');
      if (ds.missingCoords) add('warn', F.int(ds.missingCoords) + ' records missing coordinates');
      if (ds.invalidCoords) add('warn', F.int(ds.invalidCoords) + ' records have invalid coordinates (outside valid range or 0,0)');
    } else add('info', 'No Latitude/Longitude columns — Map tab is disabled');

    // blanks in geography / team
    const blank = (k, label) => { const d = ds.dims[k]; if (!d) return; const b = d.blankCode >= 0 ? d.counts[d.blankCode] : 0; if (b) add('warn', F.int(b) + ' records missing ' + label, 'Shown as "(Blank)" in filters; not repaired.'); };
    blank('area', 'Area'); blank('sector', 'Sector'); blank('team', 'Team');

    // ambiguous teams
    if (ds.hasTeamType) {
      const d = ds.dims.team; const un = []; let unRecs = 0;
      d.values.forEach((v, i) => { if (ds.teamTypeOfCode[i] === 2 && v !== ds.BLANK) { un.push(v); unRecs += d.counts[i]; } });
      if (un.length) add('warn', un.length + ' team value(s) could not be classified as Operation or Survey (' + F.int(unRecs) + ' records)', un.slice(0, 8).join(' · ') + (un.length > 8 ? ' …' : '') + ' — shown as "Unclassified", never counted as Survey or treatment.');
      else add('ok', 'All team values classified as Operation or Survey');
      if (ds.mergedVariants.team) add('info', ds.mergedVariants.team + ' team value(s) differ only by spacing characters and were grouped for analysis', 'Original text is preserved in the extraction table and exports.');
    }
    if (ds.mergedVariants.area) add('info', ds.mergedVariants.area + ' Area value(s) differ only by spacing and were grouped');
    if (ds.mergedVariants.sector) add('info', ds.mergedVariants.sector + ' Sector value(s) differ only by spacing and were grouped');

    // duplicates
    if (ds.dupCount) add('warn', F.int(ds.dupCount) + ' duplicate record(s) detected (' + ds.dupGroups + ' group(s))', 'Same WO#, Barcode and Scanned At. Duplicates are NOT removed — they are included in all counts.');
    else if (ds.has('wo')) add('ok', 'No duplicate records (WO# + Barcode + Scanned At)');

    // date consistency
    if (ds.woTs) {
      let early = 0, ex = null;
      for (let i = 0; i < n; i++) if (!isNaN(ds.ts[i]) && !isNaN(ds.woTs[i]) && ds.ts[i] < ds.woTs[i] - 86400000) { early++; if (!ex) ex = i; }
      if (early) add('warn', F.int(early) + ' records were scanned more than 1 day before their Work Order Date', 'Example row #' + (ex + 1) + '. Dates are shown as supplied.');
    }
    if (ds.dayList.length > 3 && ds.period.hasGaps) {
      add('warn', 'Scan dates contain gaps of more than ' + C.GAP_DAYS + ' days', 'Segments: ' + ds.period.segments.map(s => IPR.dateUtil.dayLong(s.start) + (s.end !== s.start ? ' – ' + IPR.dateUtil.dayLong(s.end) : '')).join(' | '));
    }
    const now = Date.now() + 86400000; if (ds.maxTs > now) add('warn', 'Some Scanned At values are in the future');

    // infestation values
    if (ds.unrecognisedInf.size) add('warn', 'Unrecognised Infestation values (treated as not infested)', Array.from(ds.unrecognisedInf).map(([k, v]) => k + ' (' + v + ')').join(' · '));
    if (ds.cancelled && Array.prototype.some.call(ds.cancelled, x => x)) {
      const c = ds.cancelled.reduce((a, b) => a + b, 0);
      add('info', F.int(c) + ' cancelled record(s) are included in Inspected counts', 'Each row is one inspection-point record; cancelled records are not removed.');
    }
    if (ds.surveyWithMaterials) add('warn', F.int(ds.surveyWithMaterials) + ' Survey-team record(s) carry a Materials value', 'Not counted as treatment (Survey = inspection only).');

    // master area reference
    if (ds.dims.area) {
      const master = new Set(C.MASTER_AREAS.map(a => a.toUpperCase()));
      const off = ds.dims.area.values.filter(v => v !== ds.BLANK && !master.has(v.toUpperCase()));
      if (off.length) add('info', off.length + ' Area name(s) not found in the brand-guideline master list', off.join(' · '));
      else add('ok', 'All Area names match the master reference');
    }
    // sector under multiple areas
    if (ds.dims.sector && ds.dims.area) {
      const m = new Map(); const sc = ds.dims.sector, ac = ds.dims.area;
      for (let i = 0; i < n; i++) { if (sc.codes[i] === sc.blankCode) continue; let s = m.get(sc.codes[i]); if (!s) m.set(sc.codes[i], s = new Set()); s.add(ac.codes[i]); }
      const multi = []; m.forEach((s, c) => { if (s.size > 1) multi.push(sc.values[c] + ' (' + Array.from(s).map(a => ac.values[a]).join(' / ') + ')'); });
      ds.sectorMultiArea = multi;
      if (multi.length) add('info', multi.length + ' Sector value(s) appear under more than one Area', multi.slice(0, 6).join(' · ') + (multi.length > 6 ? ' …' : ''));
    }
    if (!ds.hasTreatment) add('info', 'Treatment cannot be derived (no Materials or Activity Type column)');

    const summary = { error: checks.filter(c => c.level === 'error').length, warn: checks.filter(c => c.level === 'warn').length };
    return { checks, summary };
  };
})();
