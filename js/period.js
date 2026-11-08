/* ==========================================================================
   period.js — reporting period label + export file token, from ACTUAL dates
   All dates are "naive" Excel clock times held as UTC ms (use getUTC* only).
   Rule: unique scan dates are split into segments wherever the gap between
   consecutive dates exceeds CONFIG.GAP_DAYS. Each segment is shown as a range,
   a lone date as a date; segments are joined with "and".
   ========================================================================== */
(function () {
  const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dparts = d => { const t = new Date(d * 86400000); return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() }; };

  function segmentsOf(days) {
    const segs = []; let cur = null;
    for (const d of days) {
      if (cur && d - cur.end <= IPR.CONFIG.GAP_DAYS) cur.end = d;
      else { cur = { start: d, end: d }; segs.push(cur); }
    }
    return segs;
  }

  function fmtSeg(seg, names, sep, withYear, fileMode) {
    const a = dparts(seg.start), b = dparts(seg.end);
    let s;
    if (seg.start === seg.end) s = names[a.m] + (fileMode ? '_' : ' ') + a.d;
    else if (a.y === b.y && a.m === b.m) s = names[a.m] + (fileMode ? '_' : ' ') + a.d + sep + b.d;
    else s = names[a.m] + (fileMode ? '_' : ' ') + a.d + (a.y !== b.y ? (fileMode ? '_' + a.y : ', ' + a.y) : '') + sep + names[b.m] + (fileMode ? '_' : ' ') + b.d;
    if (withYear) s += fileMode ? '_' + b.y : ', ' + b.y;
    return s;
  }

  /** @param {number[]} days sorted unique day numbers (days since 1970-01-01) */
  IPR.describePeriod = function (days) {
    if (!days || !days.length) return { label: 'No dates in selection', file: 'No_Dates', segments: [], activeDays: 0, hasGaps: false };
    let segs = segmentsOf(days);
    let note = '';
    if (segs.length > 3) { segs = [{ start: days[0], end: days[days.length - 1] }]; note = 'range with gaps'; }
    const years = new Set(segs.map(s => dparts(s.start).y).concat(segs.map(s => dparts(s.end).y)));
    const oneYear = years.size === 1;
    const build = (names, sep, fileMode, joiner) => {
      const parts = segs.map((s, i) => fmtSeg(s, names, sep, !oneYear || false, fileMode));
      let txt;
      if (parts.length === 1) txt = parts[0];
      else if (parts.length === 2) txt = parts[0] + joiner + parts[1];
      else txt = parts.slice(0, -1).join(fileMode ? '_' : ', ') + joiner + parts[parts.length - 1];
      if (oneYear) txt += fileMode ? '_' + [...years][0] : ', ' + [...years][0];
      return txt;
    };
    // display: "October 1–23, 2026"; file: "Oct_1_to_23_2026"
    const label = build(MONTH_FULL, '–', false, ' and ');
    let file = build(MONTH_ABBR, '_to_', true, '_and_');
    // file mode for ranges: "Sep_2_to_Oct_2" -> fmtSeg gives "Sep_2_to_Oct_2" (names[b.m] + '_' + b.d) ok
    return { label, file, segments: segs, activeDays: days.length, hasGaps: segs.length > 1, note };
  };

  IPR.fileName = function (days, ext) { return 'ADPHC_Eagle_Inspection_Report_' + IPR.describePeriod(days).file + '.' + ext; };

  IPR.dateUtil = {
    MONTH_ABBR, MONTH_FULL,
    iso: ms => new Date(ms).toISOString().slice(0, 10),
    isoTime: ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' '),
    dayLabel: d => { const p = dparts(d); return MONTH_ABBR[p.m] + ' ' + p.d; },
    dayLong: d => { const p = dparts(d); return MONTH_ABBR[p.m] + ' ' + p.d + ', ' + p.y; },
    weekStart: d => d - ((d + 3) % 7),            // Monday (1970-01-01 was Thursday)
    monthStart: d => { const p = dparts(d); return Date.UTC(p.y, p.m, 1) / 86400000; },
    excelToMs: s => Math.round((s - 25569) * 86400000),
    msToExcel: ms => ms / 86400000 + 25569
  };
})();
