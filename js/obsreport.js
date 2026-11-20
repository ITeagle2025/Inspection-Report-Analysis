/* ==========================================================================
   obsreport.js — Observation Report tab (ported from the standalone
   "Inspection Points Report Generator") + its Excel export.
   * Uses the dataset already loaded and the GLOBAL filters (ds.idx).
   * Groups are detected from Team text: A<n> = "AREA n", S<n> = "SURVEY", anything else = "OTHER TEAMS".
   * Report date = Work Order Date (when the column exists); details use Scanned At.
   ========================================================================== */
(function () {
  const F = IPR.fmt, U = IPR.dateUtil;
  const Obs = IPR.Obs = { sub: 'overall', team: null, pick: null, filters: {}, ver: -1, groups: null, host: null };
  const stripObs = v => String(v).replace(/^Observation:\s*/i, '').trim();
  const BLANK = '(Blank)';

  Obs.available = ds => !!(ds.dims.team && ds.dims.observation);
  Obs.reset = () => { Obs.sub = 'overall'; Obs.team = null; Obs.pick = null; Obs.filters = {}; Obs.ver = -1; Obs.groups = null; Obs.tg = null; if (Obs.host) Obs.host.innerHTML = ''; };

  function teamGroups(ds) {
    if (Obs.tg && Obs.tgDs === ds) return Obs.tg;
    Obs.tgDs = ds;
    return Obs.tg = ds.dims.team.values.map(v => {
      const m = v.match(/^\s*([AS])\s*(\d+)\b/i);
      if (!m) return { key: 'O', label: 'OTHER TEAMS', order: 999 };
      return m[1].toUpperCase() === 'A' ? { key: 'A' + (+m[2]), label: 'AREA ' + (+m[2]), order: +m[2] } : { key: 'S', label: 'SURVEY', order: 500, sn: +m[2] };
    });
  }

  /** Split filtered rows into groups (memoised per filter version). */
  function compute(ds) {
    if (Obs.ver === IPR.Filters.version && Obs.groups) return Obs.groups;
    const tg = teamGroups(ds), tc = ds.dims.team.codes, m = new Map();
    const sn = new Set();
    for (let j = 0; j < ds.idx.length; j++) {
      const i = ds.idx[j], g = tg[tc[i]];
      let o = m.get(g.key); if (!o) m.set(g.key, o = { key: g.key, label: g.label, order: g.order, rows: [], teams: new Set() });
      o.rows.push(i); o.teams.add(tc[i]);
      if (g.sn) sn.add(g.sn);
    }
    const list = Array.from(m.values()).sort((a, b) => a.order - b.order);
    list.forEach(g => { if (g.key === 'S') {
      const mx = Math.max(8, ...Array.from(sn)); g.max = mx; g.label = 'SURVEY · S1–S' + mx;
      g.counts = new Map(); for (const i of g.rows) { const n = tg[tc[i]].sn; g.counts.set(n, (g.counts.get(n) || 0) + 1); }
    } });
    Obs.ver = IPR.Filters.version; Obs.groups = list; return list;
  }
  Obs.groupsOf = ds => compute(ds);

  const obsLabel = (ds, i) => { const d = ds.dims.observation, v = d.values[d.codes[i]]; return v === BLANK ? BLANK : stripObs(v); };
  const lab = (ds, k, i) => { const d = ds.dims[k]; return d ? d.values[d.codes[i]] : null; };

  function levels(ds) { return ['program', 'area', 'team', 'observation'].filter(k => ds.dims[k]); }
  const sortNodes = m => Array.from(m.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  function makeTree(ds, rows) {
    const lv = levels(ds), root = new Map();
    for (const i of rows) {
      let m = root;
      for (const k of lv) { const name = k === 'observation' ? obsLabel(ds, i) : lab(ds, k, i); let n = m.get(name); if (!n) m.set(name, n = { name, count: 0, children: new Map() }); n.count++; m = n.children; }
    }
    return sortNodes(root);
  }
  function flatten(nodes) { const out = []; (function walk(list, level) { for (const n of list) { out.push({ name: n.name, count: n.count, level }); if (n.children.size) walk(sortNodes(n.children), level + 1); } })(nodes, 0); return out; }
  Obs.makeTree = makeTree; Obs.flatten = flatten;

  /* ---------------------------- render ---------------------------- */
  function woPeriod(ds) {
    const s = new Set();
    for (let j = 0; j < ds.idx.length; j++) { const i = ds.idx[j]; const t = ds.woTs ? ds.woTs[i] : ds.ts[i]; if (!isNaN(t)) s.add(Math.floor(t / 86400000)); }
    return IPR.describePeriod(Array.from(s).sort((a, b) => a - b));
  }
  Obs.periodInfo = woPeriod;

  Obs.render = function (host, ds) {
    Obs.host = host;
    const groups = compute(ds), per = woPeriod(ds);
    const areaTeams = groups.filter(g => /^A/.test(g.key)).reduce((a, g) => a + g.teams.size, 0), surveyTeams = (groups.find(g => g.key === 'S') || { teams: new Set() }).teams.size;
    const tabs = [{ key: 'overall', label: 'OVERALL AREAS' }].concat(groups.map(g => ({ key: g.key, label: g.label })));
    if (!tabs.some(t => t.key === Obs.sub)) { Obs.sub = 'overall'; Obs.team = null; }
    host.innerHTML =
      '<section class="card obsintro"><div class="obsstats"><div><span>Records in selection</span><b>' + F.int(ds.idx.length) + '</b></div><div><span>' + (ds.woTs ? 'Work Order Date' : 'Scanned Date') + '</span><b class="sm">' + F.esc(per.label) + '</b></div><div><span>Area teams</span><b>' + areaTeams + '</b></div><div><span>Survey teams</span><b>' + surveyTeams + '</b></div></div></section>' +
      '<div class="subnav obstabs" id="obsTabs">' + tabs.map(t => '<button data-os="' + t.key + '" class="' + (t.key === Obs.sub ? 'on' : '') + '">' + F.esc(t.label) + '</button>').join('') + '</div>' +
      '<section class="card obsbody" id="obsBody"></section>';
    host.querySelector('#obsTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; Obs.sub = b.dataset.os; Obs.team = null; Obs.pick = null; Obs.filters = {}; Obs.render(host, ds); };
    host.querySelector('#obsBody').addEventListener('click', e => onBodyClick(e, ds));
    host.querySelector('#obsBody').addEventListener('input', e => { if (e.target.matches('[data-ofilter]')) applyFilters(e.target); });
    body(ds);
  };

  function body(ds) {
    const el = Obs.host.querySelector('#obsBody'), groups = compute(ds);
    if (Obs.sub === 'overall') return overall(el, ds, groups);
    const g = groups.find(x => x.key === Obs.sub); if (!g) { el.innerHTML = '<p class="muted">No records for this group in the current selection.</p>'; return; }
    if (Obs.team != null) return teamDetail(el, ds, g, Obs.team);
    pivot(el, ds, g);
  }

  /* overall: Area + Sector + Observation */
  function overall(el, ds, groups) {
    const m = new Map();
    for (let j = 0; j < ds.idx.length; j++) { const i = ds.idx[j]; const a = lab(ds, 'area', i) || '—', s = lab(ds, 'sector', i) || '—', o = obsLabel(ds, i), k = a + '\u001f' + s + '\u001f' + o; let r = m.get(k); if (!r) m.set(k, r = { area: a, sector: s, obs: o, count: 0 }); r.count++; }
    Obs.overallRows = Array.from(m.values()).sort((a, b) => a.area.localeCompare(b.area) || a.sector.localeCompare(b.sector, undefined, { numeric: true }) || a.obs.localeCompare(b.obs));
    el.innerHTML = '<div class="chead"><div><h3 class="ctitle">Overall Areas</h3><p class="csub">Every record grouped by Area + Sector + Observation · Value Count = matching records</p></div></div><div class="tablewrap short"><table class="mini obstable" id="ovTable"><thead><tr><th>Area</th><th>Sector</th><th>Observation</th><th class="num">Value Count</th></tr><tr class="frow2">' + ['Area', 'Sector', 'Observation', 'Count'].map((h, i) => '<th><input data-ofilter="' + i + '" placeholder="Filter ' + h + '…"></th>').join('') + '</tr></thead><tbody></tbody></table></div><p class="csub" id="ovNote"></p>';
    fillOverall(el);
  }
  const OV_CAP = 1000;
  function fillOverall(el) {
    const q = Array.from(el.querySelectorAll('[data-ofilter]')).map(i => i.value.trim().toLowerCase());
    const rows = Obs.overallRows.filter(r => [r.area, r.sector, r.obs, String(r.count)].every((v, i) => !q[i] || v.toLowerCase().includes(q[i])));
    el.querySelector('tbody').innerHTML = rows.slice(0, OV_CAP).map(r => '<tr><td>' + F.esc(r.area) + '</td><td>' + F.esc(r.sector) + '</td><td>' + F.esc(r.obs) + '</td><td class="num">' + F.int(r.count) + '</td></tr>').join('') || '<tr><td colspan="4" class="emptyrow">No matching records.</td></tr>';
    el.querySelector('#ovNote').textContent = F.int(rows.length) + ' of ' + F.int(Obs.overallRows.length) + ' rows' + (rows.length > OV_CAP ? ' — showing the first ' + F.int(OV_CAP) + '; use the filters to narrow down (the Excel export contains every row).' : '');
  }

  /* group pivot */
  function surveyRows(ds, g) { if (g.key !== 'S' || Obs.pick == null) return g.rows; const tg = teamGroups(ds), tc = ds.dims.team.codes; return g.rows.filter(i => tg[tc[i]].sn === Obs.pick); }
  function chips(g) {
    if (g.key !== 'S') return '';
    let h = '<div class="snrow"><button type="button" data-sn="all" class="' + (Obs.pick == null ? 'on' : '') + '">All <b>' + F.int(g.rows.length) + '</b></button>';
    for (let n = 1; n <= g.max; n++) { const c = g.counts.get(n) || 0; h += '<button type="button" data-sn="' + n + '" class="' + (Obs.pick === n ? 'on' : '') + (c ? '' : ' zero') + '"' + (c ? '' : ' disabled title="No S' + n + ' records in the current selection"') + '>S' + n + ' <b>' + F.int(c) + '</b></button>'; }
    return h + '</div>';
  }
  function pivot(el, ds, g) {
    const rowsSel = surveyRows(ds, g);
    const flat = flatten(makeTree(ds, rowsSel)), lv = levels(ds), tl = lv.indexOf('team');
    el.innerHTML = '<div class="chead"><div><h3 class="ctitle">' + F.esc(g.label) + (Obs.pick != null ? ' › S' + Obs.pick : '') + '</h3><p class="csub">' + F.int(rowsSel.length) + ' records · hierarchy ' + lv.map(k => IPR.CONFIG.COLUMNS[k].label).join(' › ') + ' · click a team name to open its sector details</p></div></div>' + chips(g) + '<div class="tablewrap short"><table class="mini obstable"><thead><tr><th>Observation hierarchy</th><th class="num">TOTAL OBSERVATION</th></tr><tr class="frow2"><th><input data-ofilter="p0" placeholder="Filter program, area, team or observation…"></th><th><input data-ofilter="p1" placeholder="Filter count…"></th></tr></thead><tbody>' +
      flat.map(it => '<tr class="lv' + Math.min(it.level, 3) + '"><td>' + (it.level === tl ? '<button class="teamlink" type="button" data-team="' + F.esc(it.name) + '">' + F.esc(it.name) + '</button>' : F.esc(it.name)) + '</td><td class="num">' + F.int(it.count) + '</td></tr>').join('') +
      '<tr class="grand"><td>Grand Total</td><td class="num">' + F.int(rowsSel.length) + '</td></tr></tbody></table></div>';
  }
  function applyFilters(inp) {
    const el = Obs.host.querySelector('#obsBody');
    if (Obs.sub === 'overall') return fillOverall(el);
    const q = el.querySelector('[data-ofilter=p0]').value.toLowerCase(), n = el.querySelector('[data-ofilter=p1]').value.toLowerCase();
    el.querySelectorAll('tbody tr:not(.grand)').forEach(tr => tr.classList.toggle('hidden', !tr.textContent.toLowerCase().includes(q) || !tr.cells[1].textContent.toLowerCase().includes(n)));
  }

  /* team detail: sector cards > observation cards > dates > times (Scanned At) */
  function teamDetail(el, ds, g, teamName) {
    const rows = g.rows.filter(i => lab(ds, 'team', i) === teamName);
    const bySector = new Map(); rows.forEach(i => { const s = lab(ds, 'sector', i) || '(No sector)'; (bySector.get(s) || bySector.set(s, []).get(s)).push(i); });
    const sectors = Array.from(bySector.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const areas = Array.from(new Set(rows.map(i => lab(ds, 'area', i) || BLANK))).sort();
    let h = '<div class="detailhead"><div><span class="eyebrow">Team account details</span><h3 class="ctitle big">' + F.esc(teamName) + '</h3><p class="csub">' + sectors.length + ' sector' + (sectors.length === 1 ? '' : 's') + ' · ' + F.int(rows.length) + ' team records · ' + F.esc(areas.join(', ')) + '</p></div><button class="btn ghost small" type="button" data-back="1">← Back to teams</button></div>';
    sectors.forEach((s, si) => {
      const srows = bySector.get(s), om = new Map(); srows.forEach(i => { const o = obsLabel(ds, i); (om.get(o) || om.set(o, []).get(o)).push(i); });
      const items = Array.from(om, ([name, r]) => ({ name, rows: r })).sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
      h += '<section class="sectorcard"><div class="sechead2"><span class="eyebrow">SECTOR ' + (si + 1) + '</span><span class="chipx">' + F.esc(s) + '</span><span class="sectotal">' + F.int(srows.length) + ' <small>total observation</small></span></div><div class="obsgrid">';
      items.forEach((o, oi) => {
        const dm = new Map(); o.rows.forEach(i => { const d = ds.day[i] >= 0 ? ds.day[i] : -1; (dm.get(d) || dm.set(d, []).get(d)).push(i); });
        const dates = Array.from(dm).sort((a, b) => b[0] - a[0]);
        h += '<div class="obscard"><button type="button" class="obstoggle" data-tg="o' + si + '_' + oi + '"><span>' + F.esc(o.name) + '</span><b>' + F.int(o.rows.length) + '</b></button><div class="obsdates" id="o' + si + '_' + oi + '" hidden>';
        dates.forEach(([d, items2], di) => {
          const tc = new Map(); items2.forEach(i => { if (!isNaN(ds.ts[i])) { const t = U.isoTime(ds.ts[i]).slice(11, 16); tc.set(t, (tc.get(t) || 0) + 1); } });
          h += '<div class="daterow"><button type="button" class="datetoggle" data-tg="d' + si + '_' + oi + '_' + di + '"><span>' + (d >= 0 ? U.dayLong(d) : 'Date unavailable') + '</span><span>' + F.int(items2.length) + ' records ⌄</span></button><div class="datetimes" id="d' + si + '_' + oi + '_' + di + '" hidden>' +
            (tc.size ? Array.from(tc).sort((a, b) => a[0].localeCompare(b[0])).map(([t, c]) => '<div class="timeline"><span>' + t + '</span><b>' + c + '</b></div>').join('') : '<div class="timeline"><span>Scanned time unavailable</span><b>' + items2.length + '</b></div>') + '</div></div>';
        });
        h += '</div></div>';
      });
      h += '</div></section>';
    });
    el.innerHTML = h;
  }

  function onBodyClick(e, ds) {
    const sn = e.target.closest('[data-sn]'); if (sn && !sn.disabled) { Obs.pick = sn.dataset.sn === 'all' ? null : +sn.dataset.sn; return body(ds); }
    const t = e.target.closest('[data-team]'); if (t) { Obs.team = t.dataset.team; return body(ds); }
    if (e.target.closest('[data-back]')) { Obs.team = null; return body(ds); }
    const g = e.target.closest('[data-tg]'); if (g) { const x = Obs.host.querySelector('#' + g.dataset.tg); if (x) x.hidden = !x.hidden; }
  }

  /* ---------------------------- Excel export ---------------------------- */
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  function styleHeader(row) { row.height = 22; row.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }; c.fill = fill('FF1C477F'); c.alignment = { vertical: 'middle', horizontal: 'left' }; c.border = { bottom: { style: 'thin', color: { argb: 'FF173A68' } } }; }); }
  function styleCells(a, b, level) {
    const st = [{ font: { bold: true, size: 12, color: { argb: 'FF173B70' } }, fill: fill('FFE8EEF7') }, { font: { bold: true, size: 11, color: { argb: 'FF29466E' } }, fill: fill('FFF4F7FB') }, { font: { size: 10, color: { argb: 'FF26364B' } } }, { font: { size: 10, color: { argb: 'FF5B687B' } } }][Math.min(level, 3)];
    [a, b].forEach(c => { c.font = st.font; if (st.fill) c.fill = st.fill; c.alignment = { vertical: 'top', horizontal: c === b ? 'right' : 'left', wrapText: true, indent: c === a ? level : 0 }; });
  }
  function pivotSheet(wb, ds, name, sections, title) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
    ws.getCell('A1').value = title + ' Data Inspection'; ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF183B68' } };
    sections.forEach((s, i) => {
      const c = 1 + i * 3; ws.getColumn(c).width = 62; ws.getColumn(c + 1).width = 19; if (i) ws.getColumn(c - 1).width = 3;
      const hr = ws.getRow(3); hr.getCell(c).value = s.label; hr.getCell(c + 1).value = 'TOTAL OBSERVATION'; styleHeader(hr);
      let r = 4; for (const it of flatten(makeTree(ds, s.rows))) { const rr = ws.getRow(r++); rr.getCell(c).value = it.name; rr.getCell(c + 1).value = it.count; styleCells(rr.getCell(c), rr.getCell(c + 1), it.level); }
      const rr = ws.getRow(r); rr.getCell(c).value = 'Grand Total'; rr.getCell(c + 1).value = s.rows.length;
      [rr.getCell(c), rr.getCell(c + 1)].forEach(cell => { cell.font = { bold: true, size: 11, color: { argb: 'FF176A3D' } }; cell.fill = fill('FFE8F4EC'); cell.border = { top: { style: 'medium', color: { argb: 'FF9BC9AA' } } }; cell.alignment = { horizontal: cell.col === c + 1 ? 'right' : 'left', vertical: 'middle' }; });
    });
  }

  /** parts: {pivot, survey, overall}. Resolves with the downloaded file name. */
  Obs.exportWorkbook = async function (ds, parts) {
    const groups = compute(ds), per = woPeriod(ds);
    const wb = new ExcelJS.Workbook(); wb.creator = 'ADPHC × Eagle Inspection Point Report'; wb.created = new Date();
    if (parts.pivot) { const areas = groups.filter(g => /^A/.test(g.key)); pivotSheet(wb, ds, 'PIVOT TABLE', areas.length ? areas : groups.filter(g => g.key !== 'S'), per.label); }
    if (parts.survey) {
      const sg = groups.find(g => g.key === 'S');
      if (sg) { const tg = teamGroups(ds), tc = ds.dims.team.codes, secs = [];
        for (let n = 1; n <= sg.max; n++) { const rows = sg.rows.filter(i => tg[tc[i]].sn === n); if (rows.length) secs.push({ label: 'S' + n, rows }); }
        pivotSheet(wb, ds, 'SURVEY', secs, per.label); }
    }
    if (parts.overall) {
      const m = new Map(); for (let j = 0; j < ds.idx.length; j++) { const i = ds.idx[j], a = lab(ds, 'area', i) || '—', s = lab(ds, 'sector', i) || '—', o = obsLabel(ds, i), k = a + '\u001f' + s + '\u001f' + o; let r = m.get(k); if (!r) m.set(k, r = { area: a, sector: s, obs: o, count: 0 }); r.count++; }
      const rows = Array.from(m.values()).sort((a, b) => a.area.localeCompare(b.area) || a.sector.localeCompare(b.sector, undefined, { numeric: true }) || a.obs.localeCompare(b.obs));
      const ov = wb.addWorksheet('Overall Areas', { views: [{ state: 'frozen', ySplit: 1 }] });
      ov.columns = [{ header: 'Area', key: 'area', width: 28 }, { header: 'Sector', key: 'sector', width: 22 }, { header: 'Observation', key: 'obs', width: 62 }, { header: 'Value Count', key: 'count', width: 16 }];
      ov.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fill('FF1C477F'); });
      rows.forEach(r => ov.addRow(r)); ov.autoFilter = { from: 'A1', to: 'D1' }; ov.getColumn(4).alignment = { horizontal: 'right' }; ov.eachRow((r, i) => { if (i > 1) r.getCell(4).numFmt = '#,##0'; });
    }
    const buf = await wb.xlsx.writeBuffer(); const name = 'ADPHC_Eagle_Observation_Report_' + per.file + '.xlsx';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); return name;
  };
})();
