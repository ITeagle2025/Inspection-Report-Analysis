/* ==========================================================================
   export.js — filtered Excel/CSV export + management report (HTML, print to PDF)
   File names come from the actual dates in the EXPORTED records.
   ========================================================================== */
(function () {
  const C = IPR.CONFIG, F = IPR.fmt, U = IPR.dateUtil, A = IPR.Analytics;
  const Ex = IPR.Export = {};

  const periodOf = (ds, idx) => { const s = new Set(); for (let j = 0; j < idx.length; j++) { const d = ds.day[idx[j]]; if (d >= 0) s.add(d); } return Array.from(s).sort((a, b) => a - b); };
  Ex.periodOfSelection = ds => periodOf(ds, ds.idx);

  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }

  function filterLines() {
    const s = IPR.Filters.summary();
    return s.length ? s.map(f => f.label + ': ' + f.values.map(v => v.text).join('; ')) : ['No filters (all records)'];
  }

  Ex.excel = function (ds, allCols) {
    const { cols, idx } = IPR.Table.exportMatrix(ds, allCols);
    const days = periodOf(ds, idx), per = IPR.describePeriod(days);
    const aoa = [cols.map(c => c.header)];
    const ws = {}; const R = idx.length;
    // build cells directly to keep dates as true Excel dates and numbers as numbers
    cols.forEach((c, ci) => { ws[XLSX.utils.encode_cell({ r: 0, c: ci })] = { t: 's', v: c.header }; });
    for (let r = 0; r < R; r++) {
      const i = idx[r];
      for (let ci = 0; ci < cols.length; ci++) {
        const c = cols[ci], v = ds.rows[i][c.index]; if (v == null || v === '') continue;
        const ref = XLSX.utils.encode_cell({ r: r + 1, c: ci });
        if (typeof v === 'number') ws[ref] = (c.key && C.DATE_KEYS.includes(c.key)) ? { t: 'n', v, z: 'yyyy-mm-dd hh:mm:ss' } : { t: 'n', v };
        else ws[ref] = { t: 's', v: String(v) };
      }
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: R, c: Math.max(0, cols.length - 1) } });
    ws['!cols'] = cols.map(c => ({ wch: Math.min(40, Math.max(10, c.header.length + 2)) }));
    ws['!autofilter'] = { ref: ws['!ref'] };
    const t = A.totals(ds);
    const info = [['ADPHC × Eagle — Inspection Point Report'], ['Reporting period', per.label], ['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ')], ['Source file', ds.fileName], ['Records exported', R], ['Total records in source', ds.n], ['Inspected', t.inspected], ['Infested', t.infested], ['Infestation rate %', t.rate == null ? 'n/a' : +t.rate.toFixed(2)], [], ['Filters applied']].concat(filterLines().map(l => [l]));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Inspection Points'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Report Info');
    XLSX.writeFile(wb, IPR.fileName(days, 'xlsx'), { compression: true });
  };

  Ex.csv = function (ds, allCols) {
    const { cols, idx } = IPR.Table.exportMatrix(ds, allCols);
    const days = periodOf(ds, idx);
    const q = s => { s = String(s); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const out = [cols.map(c => q(c.header)).join(',')];
    for (let r = 0; r < idx.length; r++) {
      const i = idx[r]; out.push(cols.map(c => { const v = ds.rows[i][c.index]; if (v == null) return ''; return q((c.key && C.DATE_KEYS.includes(c.key)) ? IPR.cellText(ds, i, c.key) : v); }).join(','));
    }
    download(new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' }), IPR.fileName(days, 'csv'));
  };

  /* ---------------- management report ---------------- */
  async function toDataURL(src) { const r = await fetch(src); const b = await r.blob(); return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); }

  Ex.managementReport = async function (ds) {
    const t = A.totals(ds), days = periodOf(ds, ds.idx), per = IPR.describePeriod(days), K = C.COLORS, Ch = IPR.Charts;
    let logoA, logoE; try { logoA = await toDataURL('assets/logos/adphc-logo.png'); logoE = await toDataURL('assets/logos/eagle-logo.png'); } catch (e) { logoA = document.getElementById('logoAdphc').src; logoE = document.getElementById('logoEagle').src; }
    const needs = { area_insp: 'area', area_rate: 'area', sector_insp: 'sector', sector_rate: 'sector', pest: 'targetPest', opsurvey: 'team' };
    const mk = (k, o) => (needs[k] && !ds.dims[needs[k]]) ? null : Ch.toImage(k, ds, o);
    const imgs = {
      trend_insp: mk('trend_insp', { w: 900 }), trend_inf: mk('trend_inf', { w: 900 }), opsurvey: mk('opsurvey', { w: 520 }),
      area_insp: mk('area_insp', { limit: 10, w: 520 }), area_rate: mk('area_rate', { limit: 10, w: 520 }),
      sector_insp: mk('sector_insp', { limit: 10, w: 520 }), sector_rate: mk('sector_rate', { limit: 10, w: 520 }),
      pest: mk('pest', { limit: 15, countOnly: true, w: 900 })
    };
    let map = null, mapReal = false;
    if (ds.hasCoords) { try { map = await IPR.Map.staticMapImage(ds, 900, 480); } catch (e) { map = null; } mapReal = !!map; if (!map) map = IPR.Map.staticImage(ds, 720, 400); }
    const tbl = (rows, head) => '<table><thead><tr>' + head.map((h, i) => '<th' + (i ? ' class="n"' : '') + '>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="n"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    const gRows = key => A.groupBy(ds, key).sort((a, b) => b.inspected - a.inspected).slice(0, 15).map(r => [F.esc(r.label), F.int(r.inspected), F.int(r.infested), F.pct(r.rate)]);
    const fig = (k, title, cap) => imgs[k] ? '<figure><h3 class="ft">' + title + '</h3><img src="' + imgs[k].url + '" alt="' + F.esc(title) + '">' + (cap ? '<figcaption>' + cap + '</figcaption>' : '') + '</figure>' : '';
    const att = A.attention(ds).slice(0, 14), find = A.findings(ds);
    const lvl = { alert: ['REVIEW', 'alert'], warn: ['CHECK', 'warn'], info: ['NOTE', 'info'] };
    const grain = Ch.grain === 'day' ? 'Day' : (Ch.grain === 'week' ? 'Week' : 'Month');
    const rateCap = 'Infestation rate = infested ÷ inspected × 100. Only those with at least ' + C.MIN_BASE + ' inspections are ranked.';
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>ADPHC × Eagle Inspection Report — ' + per.label + '</title><style>' +
      '@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:13px/1.45 Inter,Segoe UI,Arial,sans-serif;color:' + K.ink + ';margin:0;background:#eef1f4}' +
      '.bar{position:sticky;top:0;background:#fff;border-bottom:1px solid #dde2e7;padding:10px 20px;display:flex;gap:12px;align-items:center;justify-content:space-between;z-index:5}.bar button{background:' + K.adphc + ';color:#fff;border:0;border-radius:6px;padding:8px 16px;font-weight:600;cursor:pointer}' +
      '.page{max-width:980px;margin:18px auto;background:#fff;padding:28px 34px;box-shadow:0 1px 4px rgba(0,0,0,.12)}header{display:grid;grid-template-columns:1fr 2fr 1fr;align-items:center;border-bottom:3px solid ' + K.adphc + ';padding-bottom:12px;margin-bottom:16px}header img{height:70px;width:auto}header .r{text-align:right}header h1{margin:0;text-align:center;font-size:22px;letter-spacing:.04em;color:' + K.adphc + '}header p{margin:2px 0 0;text-align:center;color:' + K.muted + ';font-size:12px}' +
      '.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.kpi{border:1px solid #dde2e7;border-top:4px solid ' + K.adphc + ';border-radius:6px;padding:10px 12px}.kpi.i{border-top-color:' + K.alert + '}.kpi.r{border-top-color:' + K.teal + '}.kpi.t{border-top-color:' + K.green + '}.kpi b{display:block;font-size:26px;font-weight:800;color:' + K.adphc + '}.kpi span{font-size:11px;color:' + K.muted + ';text-transform:uppercase;letter-spacing:.05em;font-weight:600}.kpi small{display:block;color:' + K.muted + ';font-size:10.5px;margin-top:2px}' +
      'h2{font-size:16px;color:' + K.adphc + ';border-bottom:2px solid ' + K.adphc + ';padding-bottom:4px;margin:24px 0 12px}h3.ft{font-size:14px;font-weight:800;margin:0 0 6px;color:' + K.ink + '}ul{margin:0;padding-left:18px}li{margin:3px 0}.g2{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:12px}figure{margin:0 0 10px;break-inside:avoid}figure img{width:100%;height:auto;display:block}figcaption{font-size:10.5px;color:' + K.muted + ';margin-top:3px}table{border-collapse:collapse;width:100%;font-size:11.5px}th,td{padding:4px 6px;border-bottom:1px solid #e8ecef;text-align:left}th{background:#f4f6f8;font-weight:600}.n{text-align:right;font-variant-numeric:tabular-nums}' +
      '.att li{list-style:none;margin:0 0 9px -18px;padding-left:0;break-inside:avoid}.tag{display:inline-block;font-size:10px;font-weight:700;padding:1px 7px;border-radius:9px;margin-right:6px;color:#fff;letter-spacing:.04em}.alert{background:' + K.alert + '}.warn{background:#C98A1B}.info{background:' + K.gray + '}.att small{display:block;color:' + K.muted + ';font-size:11.5px;margin-top:1px}.note{font-size:11px;color:' + K.muted + ';margin-top:6px}' +
      'footer{margin-top:22px;border-top:1px solid #dde2e7;padding-top:8px;font-size:10.5px;color:' + K.muted + ';display:flex;justify-content:space-between}section{break-inside:avoid}@media print{body{background:#fff}.bar{display:none}.page{box-shadow:none;margin:0;padding:0;max-width:none}h2{break-after:avoid}}' +
      '</style></head><body><div class="bar"><span>Management report preview — use <b>Print / Save as PDF</b></span><button onclick="window.print()">Print / Save as PDF</button></div><div class="page">' +
      '<header><div><img src="' + logoA + '" alt="ADPHC"></div><div><h1>INSPECTION POINT REPORT</h1><p>Reporting Period: <b>' + F.esc(per.label) + '</b></p></div><div class="r"><img src="' + logoE + '" alt="Eagle"></div></header>' +
      '<p style="margin:0;color:' + K.muted + '">' + F.int(ds.idx.length) + ' of ' + F.int(ds.n) + ' records · ' + F.esc(filterLines().join(' | ')) + '</p>' +
      '<div class="kpis"><div class="kpi"><span>Total Inspected</span><b>' + F.int(t.inspected) + '</b><small>Operation ' + F.int(t.operation.inspected) + ' · Survey ' + F.int(t.survey.inspected) + '</small></div><div class="kpi i"><span>Total Infested</span><b>' + F.int(t.infested) + '</b><small>Operation ' + F.int(t.operation.infested) + ' · Survey ' + F.int(t.survey.infested) + '</small></div><div class="kpi r"><span>Infestation Rate</span><b>' + F.pct(t.rate) + '</b><small>Infested ÷ Inspected × 100</small></div><div class="kpi t"><span>Treatment</span><b>' + (ds.hasTreatment ? F.int(t.treated) : 'n/a') + '</b><small>' + (ds.hasTreatment ? 'Operation records with materials applied' : 'Not available in source data') + '</small></div></div>' +
      '<h2>Key findings</h2><ul>' + find.map(f => '<li>' + f + '</li>').join('') + '</ul>' +
      '<h2>Trend</h2>' + fig('trend_insp', 'Inspected per ' + grain, '') + fig('trend_inf', 'Infested per ' + grain, '') +
      (ds.hasTeamType ? '<h2>Operation vs Survey</h2><div class="g2">' + fig('opsurvey', 'Operation vs Survey', 'Survey = inspection only; no treatment counted.') + '<div>' + tbl([['Operation', F.int(t.operation.inspected), F.int(t.operation.infested), F.pct(F.rate(t.operation.infested, t.operation.inspected))], ['Survey', F.int(t.survey.inspected), F.int(t.survey.infested), F.pct(F.rate(t.survey.infested, t.survey.inspected))]], ['Team type', 'Inspected', 'Infested', 'Rate']) + '</div></div>' : '') +
      (imgs.area_insp ? '<h2>Area analysis</h2><div class="g2">' + fig('area_insp', 'Top 10 Areas by Inspected', 'Number of inspection records per area.') + fig('area_rate', 'Top 10 Areas by Infestation Rate', rateCap) + '</div>' + tbl(gRows('area'), ['Area', 'Inspected', 'Infested', 'Rate']) : '') +
      (imgs.sector_insp ? '<h2>Sector analysis</h2><div class="g2">' + fig('sector_insp', 'Top 10 Sectors by Inspected', 'Number of inspection records per sector.') + fig('sector_rate', 'Top 10 Sectors by Infestation Rate', rateCap) + '</div>' + tbl(gRows('sector'), ['Sector', 'Inspected', 'Infested', 'Rate']) : '') +
      (imgs.pest ? '<h2>Target pest</h2>' + fig('pest', 'Infested Records by Target Pest', 'Number of infested records per target pest, largest to smallest.') : '') +
      (map ? '<h2>Geographic distribution</h2><figure><h3 class="ft">Inspection Points Map</h3><img src="' + map + '" alt="Inspection points map"><figcaption>Fixed map for visual reference: coral = infested inspection point, blue = other inspection points' + (mapReal ? '; names shown for the busiest areas.' : ' (street-map background could not be loaded, so points are shown on a plain background).') + '</figcaption></figure>' : '') +
      '<h2>Attention required</h2>' + (att.length ? '<ul class="att">' + att.map(a => '<li><span class="tag ' + lvl[a.level][1] + '">' + lvl[a.level][0] + '</span><b>' + F.esc(a.title) + '</b>' + (a.detail ? '<small>' + F.esc(a.detail) + '</small>' : '') + '</li>').join('') + '</ul><p class="note">Only areas, sectors and teams with at least ' + C.MIN_BASE + ' inspections are compared. “Higher than usual” means the gap is very unlikely to be chance alone.</p>' : '<p>No items flagged for the current selection.</p>') +
      '<footer><span>Source: ' + F.esc(ds.fileName) + ' · Period: ' + F.esc(per.label) + '</span><span>Generated ' + new Date().toISOString().slice(0, 10) + '</span></footer></div></body></html>';
    const blob = new Blob([html], { type: 'text/html' }), url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) download(blob, 'ADPHC_Eagle_Management_Report_' + per.file + '.html');
  };

  /* ---------------- export list (checkbox modal) ---------------- */
  const OPTIONS = [
    { id: 'pivot',   group: 'Observation Report', title: 'Area 1–5', desc: 'One sheet per area: Program › Area › Team (flag counts, hours) › Observation + map links', needs: 'obs' },
    { id: 'survey',  group: 'Observation Report', title: 'Survey — S1–S8', desc: 'Same layout for survey teams (sheet “SURVEY”)', needs: 'obs' },
    { id: 'overall', group: 'Observation Report', title: 'Overall Areas', desc: 'By Program: Area, Sector, Observation, Value Count, Infestation Count', needs: 'obs' },
    { id: 'geoinf', group: 'Observation Report — extras', title: 'Geotags — infestations', desc: 'Every infested point with latitude/longitude and a clickable map link', needs: 'obs' },
    { id: 'geoall',  group: 'Observation Report — extras', title: 'Geotags — all inspections', desc: 'All inspection points with map links (large file)', needs: 'obs' },
    { id: 'report', group: 'Observation Report', title: 'Overall Areas — Report Style', desc: 'One sheet per program: Area Name | Sector | Date × observation (Value Count | Infestation Count | Infested Target Pest)', needs: 'obs' },
    { id: 'hours',  group: 'Observation Report — extras', title: 'Team hours in system', desc: 'Per team (total, average, per day) and per sector with first/last scan, gap and area/program details', needs: 'obs' },
    { id: 'flags',   group: 'Observation Report — extras', title: 'All flags', desc: 'Every flag in one sheet: No chemical, No photos, Multi-observation', needs: 'obs' },
    { id: 'timing',  group: 'Observation Report — extras', title: 'Sector timing', desc: 'First/last scan, time in sector, gap to next sector per team, day and sector', needs: 'obs' },
    { id: 'photos',  group: 'Observation Report — extras', title: 'Sector photos', desc: 'Clickable photo links per team, day and sector', needs: 'obs' },
    { id: 'multi',   group: 'Observation Report — extras', title: 'Multi-observation records', desc: 'Records with several observations in one cell (mistakes)', needs: 'obs' },
    { id: 'xlsx',    group: 'Filtered records', title: 'Filtered records — Excel', desc: 'Every record matching the filters, selected columns, with a Report Info sheet' },
    { id: 'csv',     group: 'Filtered records', title: 'Filtered records — CSV', desc: 'Same records as plain CSV' },
    { id: 'report',  group: 'Management report', title: 'Management report — PDF', desc: 'Branded one-document summary (opens a page: Print / Save as PDF)' }
  ];
  Ex.openModal = function (ds) {
    const $ = id => document.getElementById(id), obsOk = IPR.Obs.available(ds);
    let lastGroup = '';
    $('expList').innerHTML = OPTIONS.map(o => { const dis = o.needs === 'obs' && !obsOk; const head = o.group !== lastGroup ? '<div class="expgroup">' + o.group + '</div>' : ''; lastGroup = o.group;
      return head + '<label class="expopt' + (dis ? ' off' : '') + '"><input type="checkbox" data-x="' + o.id + '"' + (dis ? ' disabled' : '') + '><span><b>' + o.title + '</b><small>' + (dis ? 'Needs Team and Observation columns' : o.desc) + '</small></span></label>'; }).join('');
    $('expCount').textContent = F.int(ds.idx.length); $('expStatus').textContent = ''; $('exportModal').hidden = false;
    const boxes = () => Array.from($('expList').querySelectorAll('input:not(:disabled)'));
    const sync = () => { const n = boxes().filter(b => b.checked).length; $('expRun').disabled = !n; $('expRun').textContent = n ? 'Export ' + n + ' selected' : 'Export selected'; };
    $('expList').onchange = sync; sync();
    $('expAll').onclick = () => { boxes().forEach(b => b.checked = true); sync(); };
    $('expNone').onclick = () => { boxes().forEach(b => b.checked = false); sync(); };
    const close = () => { $('exportModal').hidden = true; };
    $('expClose').onclick = close; $('exportModal').onclick = e => { if (e.target.id === 'exportModal') close(); };
    $('expRun').onclick = async () => {
      const sel = {}; boxes().forEach(b => { if (b.checked) sel[b.dataset.x] = true; });
      const run = $('expRun'); run.disabled = true; const done = [], st = t => $('expStatus').textContent = t, pause = () => new Promise(r => setTimeout(r, 400));
      try {
        if (sel.report) { st('Preparing management report…'); await Ex.managementReport(ds); done.push('Management report'); await pause(); }
        if (sel.pivot || sel.survey || sel.overall || sel.report || sel.hours || sel.geoinf || sel.geoall || sel.flags || sel.timing || sel.photos || sel.multi) { st('Building observation workbook…'); await new Promise(r => setTimeout(r, 30)); const n = await IPR.Obs.exportWorkbook(ds, sel); done.push(n); await pause(); }
        if (sel.xlsx) { st('Building filtered Excel…'); await new Promise(r => setTimeout(r, 30)); Ex.excel(ds, false); done.push('Filtered Excel'); await pause(); }
        if (sel.csv) { st('Building CSV…'); Ex.csv(ds, false); done.push('Filtered CSV'); }
        st('✓ Done: ' + done.join(' · '));
      } catch (e) { console.error(e); st('Export failed: ' + (e && e.message || e)); }
      finally { run.disabled = false; }
    };
  };
})();
