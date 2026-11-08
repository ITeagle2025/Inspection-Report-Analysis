/* ==========================================================================
   analytics.js — KPIs, group-bys, time series, findings, attention items
   Definitions (see README):
     Inspected  = every inspection-point record in the (filtered) data
     Infested   = records whose Infestation value is "Infested"
     Rate       = Infested / Inspected x 100 (only when Inspected > 0)
     Treated    = non-Survey records with Materials applied (or Activity Type "Treatment")
     Survey     = Team classified as Survey; never counted as treatment
   Results are memoised per filter version.
   ========================================================================== */
(function () {
  const C = IPR.CONFIG, F = IPR.fmt;
  const cache = new Map();
  let cacheVer = -1;
  const memo = (key, fn) => { if (cacheVer !== IPR.Filters.version) { cache.clear(); cacheVer = IPR.Filters.version; } if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
  const A = IPR.Analytics = {};

  A.totals = ds => memo('totals', () => {
    const idx = ds.idx, t = { inspected: idx.length, infested: 0, treated: 0, groups: [0, 1, 2].map(() => ({ inspected: 0, infested: 0, treated: 0 })) };
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j], g = t.groups[ds.teamType[i]];
      g.inspected++; if (ds.infested[i]) { t.infested++; g.infested++; }
      if (ds.treated[i]) { t.treated++; g.treated++; }
    }
    t.rate = F.rate(t.infested, t.inspected);
    t.operation = t.groups[0]; t.survey = t.groups[1]; t.unclassified = t.groups[2];
    return t;
  });

  /** Group by a dimension. Returns rows [{code,label,inspected,infested,treated,rate}] (all codes present in the filtered data). */
  A.groupBy = (ds, key) => memo('g:' + key, () => {
    const d = ds.dims[key]; if (!d) return [];
    const k = d.values.length, ins = new Int32Array(k), inf = new Int32Array(k), tr = new Int32Array(k);
    for (let j = 0; j < ds.idx.length; j++) { const i = ds.idx[j], c = d.codes[i]; ins[c]++; if (ds.infested[i]) inf[c]++; if (ds.treated[i]) tr[c]++; }
    const out = [];
    for (let c = 0; c < k; c++) if (ins[c] > 0) out.push({ code: c, label: d.values[c], inspected: ins[c], infested: inf[c], treated: tr[c], rate: F.rate(inf[c], ins[c]) });
    return out;
  });

  /** Time series by 'day' | 'week' | 'month' -> [{key, label, inspected, infested, rate}] ordered by time. */
  A.series = (ds, grain) => memo('s:' + grain, () => {
    const m = new Map(), U = IPR.dateUtil;
    for (let j = 0; j < ds.idx.length; j++) {
      const i = ds.idx[j], dd = ds.day[i]; if (dd < 0) continue;
      const key = grain === 'week' ? U.weekStart(dd) : grain === 'month' ? U.monthStart(dd) : dd;
      let r = m.get(key); if (!r) m.set(key, r = { key, inspected: 0, infested: 0 });
      r.inspected++; if (ds.infested[i]) r.infested++;
    }
    const arr = Array.from(m.values()).sort((a, b) => a.key - b.key);
    arr.forEach(r => {
      r.rate = F.rate(r.infested, r.inspected);
      r.label = grain === 'month' ? U.MONTH_ABBR[new Date(r.key * 86400000).getUTCMonth()] + ' ' + new Date(r.key * 86400000).getUTCFullYear() : (grain === 'week' ? 'Wk ' + U.dayLabel(r.key) : U.dayLabel(r.key));
    });
    return arr;
  });

  /** Repeat-infestation inspection points */
  A.repeatPoints = ds => memo('repeat', () => {
    const bi = ds.has('barcode') ? ds.map.barcode : (ds.has('inspPoint') ? ds.map.inspPoint : -1); if (bi < 0) return [];
    const m = new Map();
    for (let j = 0; j < ds.idx.length; j++) { const i = ds.idx[j]; if (!ds.infested[i]) continue; const b = ds.rows[i][bi]; if (b == null || b === '') continue; m.set(b, (m.get(b) || 0) + 1); }
    return Array.from(m).filter(([, c]) => c >= C.REPEAT_POINT_MIN).sort((a, b) => b[1] - a[1]).map(([b, c]) => ({ point: b, infested: c }));
  });

  const rank = (rows, f) => rows.slice().sort((a, b) => f(b) - f(a));
  const zScore = (inf, n, p0) => (p0 > 0 && p0 < 1 && n > 0) ? ((inf / n) - p0) / Math.sqrt(p0 * (1 - p0) / n) : 0;
  A.zScore = zScore;

  /** Key findings — each sentence is computed directly from the filtered data. */
  A.findings = ds => memo('findings', () => {
    const t = A.totals(ds), out = [], pct = F.pct;
    if (!t.inspected) return ['No records match the current filters.'];
    const per = IPR.describePeriod(Array.from(new Set(Array.from(ds.idx, i => ds.day[i]).filter(d => d >= 0))).sort((a, b) => a - b));
    out.push('The selected dataset contains <b>' + F.int(t.inspected) + '</b> inspected records and <b>' + F.int(t.infested) + '</b> infested records, an infestation rate of <b>' + pct(t.rate) + '</b>' + (per.activeDays ? ' across ' + per.activeDays + ' active date(s) (' + per.label + ').' : '.'));
    const top = (key, noun, rateToo) => {
      const g = A.groupBy(ds, key); if (g.length < 1) return;
      const bi = rank(g.filter(r => r.label !== ds.BLANK), r => r.inspected)[0]; if (!bi) return;
      const share = bi.inspected / t.inspected * 100;
      out.push('<b>' + F.esc(bi.label) + '</b> recorded the highest number of inspections by ' + noun + ' (' + F.int(bi.inspected) + ', ' + pct(share, 1) + ' of the selection).');
      return g;
    };
    const ga = top('area', 'Area');
    if (ga && ga.length > 1) {
      const eligible = ga.filter(r => r.inspected >= C.MIN_BASE && r.label !== ds.BLANK);
      const mi = rank(ga.filter(r => r.label !== ds.BLANK), r => r.infested)[0];
      if (mi && mi.infested > 0) out.push('<b>' + F.esc(mi.label) + '</b> has the highest number of infested records (' + F.int(mi.infested) + ').');
      const mr = rank(eligible, r => r.rate || 0)[0];
      if (mr && mr.infested > 0) out.push('<b>' + F.esc(mr.label) + '</b> has the highest infestation rate among areas with at least ' + C.MIN_BASE + ' inspections (' + pct(mr.rate) + ').');
    }
    const gs = A.groupBy(ds, 'sector').filter(r => r.label !== ds.BLANK);
    if (gs.length > 1) { const s = rank(gs, r => r.infested)[0]; if (s && s.infested > 0) out.push('Sector <b>' + F.esc(s.label) + '</b> recorded the most infested records (' + F.int(s.infested) + ', rate ' + pct(s.rate) + ').'); }
    const gt = A.groupBy(ds, 'team').filter(r => r.label !== ds.BLANK);
    if (gt.length > 1) out.push('Team <b>' + F.esc(rank(gt, r => r.inspected)[0].label) + '</b> recorded the highest inspection volume (' + F.int(rank(gt, r => r.inspected)[0].inspected) + ').');
    if (ds.hasTeamType && t.survey.inspected + t.operation.inspected > 0) {
      out.push('Operation teams recorded <b>' + F.int(t.operation.inspected) + '</b> inspections (' + F.int(t.operation.infested) + ' infested)' + (ds.hasTreatment ? ' and <b>' + F.int(t.operation.treated) + '</b> treated records' : '') + '; Survey teams recorded <b>' + F.int(t.survey.inspected) + '</b> inspections (' + F.int(t.survey.infested) + ' infested) with no treatment counted.');
    }
    const gp = A.groupBy(ds, 'targetPest').filter(r => r.label !== ds.BLANK);
    if (gp.length) { const p = rank(gp, r => r.infested)[0]; if (p && p.infested > 0) out.push('<b>' + F.esc(p.label) + '</b> accounts for the most infested records by target pest (' + F.int(p.infested) + ').'); }
    const days = A.series(ds, 'day'); if (days.length > 1) {
      const pk = rank(days, r => r.inspected)[0]; out.push('Peak inspection day was <b>' + IPR.dateUtil.dayLong(pk.key) + '</b> (' + F.int(pk.inspected) + ' inspected).');
      const pi = rank(days, r => r.infested)[0]; if (pi.infested > 0) out.push('Most infested records in a single day: <b>' + IPR.dateUtil.dayLong(pi.key) + '</b> (' + F.int(pi.infested) + ').');
    }
    const gr = A.groupBy(ds, 'infRank'); if (gr.length) { const hi = gr.find(r => /^high$/i.test(r.label)); if (hi) out.push('<b>' + F.int(hi.inspected) + '</b> record(s) carry an Infestation Ranking of High.'); }
    return out;
  });

  /** Attention Required — plain-language, but every statement comes from a calculation on the filtered data. */
  A.attention = ds => memo('attention', () => {
    const t = A.totals(ds), items = [], base = C.MIN_BASE, pctTxt = v => F.pct(v);
    if (!t.inspected) return items;
    const p0 = t.infested / t.inspected;
    // "higher than usual": rate is far above the overall rate (z-score >= Z_FLAG, i.e. very unlikely to be chance)
    const flagRates = (key, noun) => {
      A.groupBy(ds, key).filter(r => r.label !== ds.BLANK && r.inspected >= base).map(r => ({ r, z: zScore(r.infested, r.inspected, p0) })).filter(x => x.z >= C.Z_FLAG && x.r.infested > 0)
        .sort((a, b) => b.z - a.z).slice(0, 4).forEach(x => {
          const times = x.r.rate / t.rate;
          items.push({ level: 'alert', title: noun + ' ' + x.r.label + ' has a higher infestation rate than usual',
            detail: pctTxt(x.r.rate) + ' of inspections here found an infestation (' + F.int(x.r.infested) + ' of ' + F.int(x.r.inspected) + '), compared with ' + pctTxt(t.rate) + ' overall — about ' + (times >= 10 ? Math.round(times) : times.toFixed(1)) + ' times higher. A gap this large is very unlikely to be a coincidence, so it needs a closer look.',
            filter: { key, label: x.r.label } });
        });
    };
    flagRates('area', 'Area'); flagRates('sector', 'Sector'); flagRates('team', 'Team');

    const rp = A.repeatPoints(ds);
    if (rp.length) items.push({ level: 'alert', title: F.int(rp.length) + ' inspection point(s) found infestation ' + C.REPEAT_POINT_MIN + ' or more times',
      detail: 'Most repeated: ' + rp.slice(0, 3).map(x => x.point + ' (' + x.infested + ' times)').join(', ') + '. When the same point keeps getting infested, it is worth checking whether the treatment there is working.' });

    // unusual daily volume: compared with the typical (median) active day, using a robust measure
    const days = A.series(ds, 'day');
    if (days.length >= 7) {
      const v = days.map(d => d.inspected).sort((a, b) => a - b), med = v[v.length >> 1];
      const dev = v.map(x => Math.abs(x - med)).sort((a, b) => a - b), mad = dev[dev.length >> 1] * 1.4826;
      if (mad > 0) {
        const hi = days.filter(d => (d.inspected - med) / mad > 3.5), lo = days.filter(d => (d.inspected - med) / mad < -3.5);
        if (hi.length) items.push({ level: 'warn', title: 'Much busier than a typical day on ' + hi.length + ' day(s)', detail: hi.slice(0, 4).map(d => IPR.dateUtil.dayLabel(d.key) + ' (' + F.int(d.inspected) + ' inspections)').join(', ') + '. A typical active day has about ' + F.int(med) + ' inspections.' });
        if (lo.length) items.push({ level: 'warn', title: 'Much quieter than a typical day on ' + lo.length + ' day(s)', detail: lo.slice(0, 6).map(d => IPR.dateUtil.dayLabel(d.key) + ' (' + F.int(d.inspected) + ')').join(', ') + (lo.length > 6 ? ' and others' : '') + '. A typical active day has about ' + F.int(med) + ' inspections.' });
      }
    }

    // data issues within the current selection
    let noCoord = 0, noArea = 0, noSector = 0, dup = 0, canc = 0, high = 0;
    const ad = ds.dims.area, sd = ds.dims.sector, rk = ds.dims.infRank;
    for (let j = 0; j < ds.idx.length; j++) {
      const i = ds.idx[j];
      if (ds.hasCoords && !ds.validCoord[i]) noCoord++;
      if (ad && ad.codes[i] === ad.blankCode) noArea++;
      if (sd && sd.codes[i] === sd.blankCode) noSector++;
      if (ds.isDup[i]) dup++; if (ds.cancelled[i]) canc++;
      if (rk && /^high$/i.test(rk.values[rk.codes[i]])) high++;
    }
    if (high) items.push({ level: 'alert', title: F.int(high) + ' record(s) ranked "High" for infestation', detail: 'In the Data Extraction tab, add the Infestation Ranking column to review them.' });
    if (noCoord) items.push({ level: 'warn', title: F.int(noCoord) + ' record(s) have no map location', detail: 'They are counted in all totals but cannot be shown on the map.' });
    if (noArea) items.push({ level: 'warn', title: F.int(noArea) + ' record(s) have no Area', detail: 'They are counted in the totals but cannot be assigned to an area.' });
    if (noSector) items.push({ level: 'warn', title: F.int(noSector) + ' record(s) have no Sector', detail: 'They are counted in the totals and shown as "(Blank)" in the Sector tables.' });
    if (dup) items.push({ level: 'warn', title: F.int(dup) + ' record(s) look like duplicates', detail: 'The same work order, inspection point and scan time appear more than once. All of them are counted — please check whether they are genuine repeats.' });
    if (canc) items.push({ level: 'info', title: F.int(canc) + ' cancelled record(s) are included in Inspected' });
    if (t.unclassified.inspected) items.push({ level: 'warn', title: F.int(t.unclassified.inspected) + ' record(s) belong to teams that are neither Operation nor Survey', detail: 'They are reported separately and are never counted as treatment.' });
    return items;
  });

  /** Reconciliation checks (final automated validation). */
  A.reconcile = ds => {
    const t = A.totals(ds), res = [];
    const sum = (rows, f) => rows.reduce((a, r) => a + r[f], 0);
    const chk = (name, a, b) => res.push({ name, ok: a === b, a, b });
    chk('KPI inspected = filtered record count', t.inspected, ds.idx.length);
    chk('Operation + Survey + Unclassified inspected = total', t.groups[0].inspected + t.groups[1].inspected + t.groups[2].inspected, t.inspected);
    chk('Operation + Survey + Unclassified infested = total', t.groups[0].infested + t.groups[1].infested + t.groups[2].infested, t.infested);
    ['area', 'sector', 'team', 'targetPest'].forEach(k => { if (ds.dims[k]) { const g = A.groupBy(ds, k); chk('Sum by ' + k + ' (inspected) = total', sum(g, 'inspected'), t.inspected); chk('Sum by ' + k + ' (infested) = total', sum(g, 'infested'), t.infested); } });
    const s = A.series(ds, 'day'); const dated = Array.from(ds.idx).filter(i => ds.day[i] >= 0).length;
    chk('Daily trend inspected = dated records', sum(s, 'inspected'), dated);
    chk('Survey treated = 0', t.survey.treated, 0);
    return res;
  };
})();
