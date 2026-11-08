/* ==========================================================================
   app.js — UI state & orchestration
   Flow: upload -> load -> normalise -> validate -> filters -> render views
   ========================================================================== */
(function () {
  const C = IPR.CONFIG, F = IPR.fmt, A = IPR.Analytics, $ = id => document.getElementById(id);
  const App = IPR.App = { ds: null, tab: 'dashboard', sub: 'area', dirty: {} };
  const views = ['viewUpload', 'viewLoading', 'viewError', 'viewValidate', 'viewApp'];
  const show = v => views.forEach(x => $(x).hidden = x !== v);
  const tick = () => new Promise(r => setTimeout(r, 30));

  /* ---------------- upload handling ---------------- */
  async function handleFile(file) {
    if (!file) return;
    show('viewLoading'); $('topnav').hidden = true; $('loadTitle').textContent = 'Reading ' + file.name + '…';
    try {
      resetAll();
      $('loadStep').textContent = 'Reading file…'; await tick();
      const buf = await file.arrayBuffer();
      $('loadStep').textContent = 'Parsing workbook (large files take 10–30 seconds)…'; await tick();
      const wbInfo = IPR.loadWorkbook(buf, file.name);
      $('loadStep').textContent = 'Normalising ' + F.int(wbInfo.rows.length) + ' records…'; await tick();
      const ds = IPR.buildDataset(wbInfo);
      $('loadStep').textContent = 'Validating data…'; await tick();
      const v = IPR.validate(ds);
      App.ds = ds; App.validation = v;
      $('periodLabel').textContent = ds.period.label; $('sourceLabel').textContent = 'Uploaded Excel — ' + file.name;
      renderValidation(v); show('viewValidate');
    } catch (e) { showError(e); }
  }
  function showError(e) {
    console.error(e);
    const err = (e && e.title) ? e : { title: 'Unable to generate report', reason: 'Unexpected error while processing the file.', detail: String(e && e.message || e) };
    $('errTitle').textContent = err.title; $('errReason').textContent = err.reason;
    $('errCodeWrap').hidden = !err.code; $('errCode').textContent = err.code || '';
    $('errSimWrap').hidden = !(err.similar && err.similar.length); $('errSim').innerHTML = (err.similar || []).map(s => '<li><code>' + F.esc(s) + '</code></li>').join('');
    $('errDetail').textContent = err.detail || '';
    $('topnav').hidden = true; show('viewError');
  }
  function resetAll() {
    // clear every trace of a previous dataset
    IPR.Charts.destroyAll(); IPR.Map.reset(); App.ds = null; App.validation = null; App.dirty = {};
    document.querySelectorAll('[data-chart]').forEach(el => { el.innerHTML = ''; delete el.dataset.built; el.classList.remove('card', 'chartcard'); el.id = ''; });
    ['sub-area', 'sub-sector', 'sub-team', 'sub-pest', 'sub-trends', 'sub-quality'].forEach(id => $(id).innerHTML = '');
    $('periodLabel').textContent = '—'; $('sourceLabel').textContent = 'No file loaded'; $('findings').innerHTML = ''; $('attention').innerHTML = ''; $('kpis').innerHTML = '';
    $('extTable').innerHTML = ''; $('fileInput').value = '';
    IPR.Table.invalidate();
  }
  function renderValidation(v) {
    const ic = { ok: '✓', warn: '⚠', info: 'ℹ', error: '✕' };
    $('valList').innerHTML = v.checks.map(c => '<li class="v-' + c.level + '"><span class="vic">' + ic[c.level] + '</span><div><b>' + F.esc(c.text) + '</b>' + (c.detail ? '<small>' + F.esc(c.detail) + '</small>' : '') + '</div></li>').join('');
    $('btnContinue').disabled = v.summary.error > 0;
  }

  function enterApp() {
    const ds = App.ds;
    IPR.Filters.reset(ds); IPR.Filters.apply(); IPR.Table.init(ds);
    IPR.Filters.buildUI($('filtersPrimary'), $('filtersMore'), $('btnMore'));
    $('topnav').hidden = false; $('appFooter').hidden = false; show('viewApp');
    $('footSource').textContent = 'Data source: ' + ds.fileName; $('footPeriod').textContent = 'Reporting period: ' + ds.period.label; $('footGen').textContent = 'Generated ' + new Date().toISOString().slice(0, 10);
    document.querySelector('[data-tab="map"]').disabled = !ds.hasCoords;
    document.querySelector('[data-tab="map"]').title = ds.hasCoords ? '' : 'No Latitude/Longitude columns in this file';
    App.dirty = { dashboard: 1, map: 1, analysis: 1, extraction: 1 }; App.mapFit = true;
    switchTab('dashboard');
    updateSummary();
  }

  /* ---------------- tabs ---------------- */
  function switchTab(t) {
    App.tab = t;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.tabview').forEach(v => v.hidden = v.id !== 'tab-' + t);
    renderActive();
  }
  function renderActive() {
    const ds = App.ds; if (!ds) return;
    const t = App.tab;
    if (!App.dirty[t]) return; App.dirty[t] = 0;
    if (t === 'dashboard') renderDashboard(ds);
    else if (t === 'map') { IPR.Map.init($('map')); IPR.Map.update(ds, App.mapFit); App.mapFit = false; }
    else if (t === 'analysis') renderAnalysis(ds);
    else if (t === 'extraction') IPR.Table.render(ds);
  }

  /* ---------------- summary / chips ---------------- */
  function updateSummary() {
    const ds = App.ds, S = IPR.Filters.summary();
    $('recCount').textContent = F.int(ds.idx.length) + ' records' + (ds.idx.length !== ds.n ? ' of ' + F.int(ds.n) : '');
    $('showingText').textContent = S.length ? 'Showing: ' + S.map(f => f.values.length === 1 ? f.values[0].text : f.label + ' (' + f.values.length + ')').join(' × ') : 'Showing: all records';
    $('chips').innerHTML = S.map(f => f.values.slice(0, 6).map(v => '<span class="chip" title="' + F.esc(f.label) + '">' + F.esc(v.text.length > 34 ? v.text.slice(0, 33) + '…' : v.text) + ' <button type="button" data-k="' + f.key + '" data-c="' + v.code + '" aria-label="Remove ' + F.esc(v.text) + '">×</button></span>').join('') + (f.values.length > 6 ? '<span class="chip more" title="' + F.esc(f.label) + '">+' + (f.values.length - 6) + ' more ' + F.esc(f.label) + ' <button type="button" data-k="' + f.key + '" data-c="all" aria-label="Clear ' + F.esc(f.label) + '">×</button></span>' : '')).join('');
    $('btnClearAll').disabled = S.length === 0;
    $('periodLabel').textContent = S.length ? IPR.describePeriod(IPR.Export.periodOfSelection(ds)).label : ds.period.label;
  }

  function onFiltersChanged() {
    const ds = App.ds; if (!ds) return;
    IPR.Table.invalidate(); App.dirty = { dashboard: 1, map: 1, analysis: 1, extraction: 1 };
    updateSummary(); renderActive();
  }

  /* ---------------- dashboard ---------------- */
  function kpiCard(cls, label, value, foot, tip) {
    return '<div class="kpi ' + cls + '"' + (tip ? ' title="' + F.esc(tip) + '"' : '') + '><span class="klabel">' + label + '</span><b class="kval">' + value + '</b><span class="kfoot">' + foot + '</span></div>';
  }
  function renderDashboard(ds) {
    const t = A.totals(ds), g = ds.hasTeamType;
    const split = k => g ? 'Operation ' + F.int(t.operation[k]) + ' · Survey ' + F.int(t.survey[k]) + (t.unclassified[k] ? ' · Other ' + F.int(t.unclassified[k]) : '') : '';
    $('kpis').innerHTML =
      kpiCard('k-insp', 'Total Inspected', F.int(t.inspected), split('inspected') || 'Inspection-point records', 'Every inspection-point record in the current selection.') +
      kpiCard('k-inf', 'Total Infested', F.int(t.infested), split('infested') || 'Records marked Infested', 'Records where Infestation = Infested.') +
      kpiCard('k-rate', 'Infestation Rate', t.rate == null ? 'n/a' : F.pct(t.rate), 'Infested ÷ Inspected × 100', 'Calculated only when Inspected is greater than zero.') +
      (ds.hasTreatment ? kpiCard('k-treat', 'Treatment', F.int(t.treated), 'Operation records with materials applied · Survey excluded', 'Non-Survey records with a Materials value (or Activity Type = Treatment).') : kpiCard('k-treat na', 'Treatment', 'n/a', 'Not available in source data'));
    $('findings').innerHTML = A.findings(ds).map(f => '<li>' + f + '</li>').join('');
    const att = A.attention(ds);
    $('attention').innerHTML = att.length ? att.map((a, i) => '<li class="a-' + a.level + '"><span class="alv">' + (a.level === 'alert' ? 'REVIEW' : a.level === 'warn' ? 'CHECK' : 'NOTE') + '</span><div><b>' + F.esc(a.title) + '</b>' + (a.detail ? '<small>' + F.esc(a.detail) + '</small>' : '') + (a.filter ? ' <button class="btn link tiny" data-af="' + i + '">Show only this</button>' : '') + '</div></li>').join('') : '<li class="a-ok"><span class="alv ok">OK</span><div><b>No items flagged for the current selection.</b></div></li>';
    $('attNote').textContent = 'Only areas, sectors and teams with at least ' + C.MIN_BASE + ' inspections are compared. “Higher than usual” means the gap is very unlikely to be chance alone.';
    App.attItems = att;
    // side card: team type table + definitions
    $('dashSide').innerHTML = '<h3 class="sechead">Operation vs Survey</h3>' + (g ? '<table class="mini"><thead><tr><th>Team type</th><th class="num">Inspected</th><th class="num">Infested</th><th class="num">Rate</th><th class="num">Treated</th></tr></thead><tbody>' +
      [['Operation', t.operation, true], ['Survey', t.survey, false]].concat(t.unclassified.inspected ? [['Unclassified', t.unclassified, true]] : []).map(([n, x, tr]) => '<tr><td>' + n + '</td><td class="num">' + F.int(x.inspected) + '</td><td class="num">' + F.int(x.infested) + '</td><td class="num">' + F.pct(F.rate(x.infested, x.inspected)) + '</td><td class="num">' + (ds.hasTreatment ? (tr ? F.int(x.treated) : '—') : 'n/a') + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">No Team column in this file.</p>') +
      '<h4 class="subhead">Definitions</h4><ul class="defs"><li><b>Inspected</b> — every inspection-point record in the selection.</li><li><b>Infested</b> — records where Infestation = Infested.</li><li><b>Rate</b> — Infested ÷ Inspected × 100.</li><li><b>Operation</b> — A#-T# teams (inspect + treat). <b>Survey</b> — S# / survey / smart-trap teams (inspect only, never treated).</li><li><b>Treated</b> — Operation records with materials applied.</li></ul>';
    IPR.Charts.renderAll($('tab-dashboard'), ds);
    runReconcile(ds);
  }
  function runReconcile(ds) {
    const r = A.reconcile(ds); const bad = r.filter(x => !x.ok); App.reconcile = r;
    if (bad.length) console.warn('Reconciliation FAILED', bad); else console.info('Reconciliation OK (' + r.length + ' checks)');
  }

  /* ---------------- analysis ---------------- */
  const perfTable = (ds, key, title, opts = {}) => {
    const id = 'pt_' + key, rows = A.groupBy(ds, key);
    return '<section class="card perf" data-key="' + key + '"><div class="chead"><div><h3 class="ctitle">' + title + '</h3><p class="csub">' + F.int(rows.length) + ' ' + (opts.noun || 'values') + ' in the current selection</p></div>' +
      '<div class="sortctl"><label>Sort by <select data-sort="' + key + '"><option value="inspected">Highest Inspected</option><option value="infested">Highest Infested</option><option value="rate">Highest Infestation Rate</option><option value="label">Alphabetical</option></select></label></div></div>' +
      '<div class="tablewrap short"><table class="mini perftbl" id="' + id + '"></table></div><div class="perfmore"></div></section>';
  };
  function fillPerf(ds, key, sortBy, limit) {
    const rows = A.groupBy(ds, key).slice(), tot = A.totals(ds);
    const cmp = { inspected: (a, b) => b.inspected - a.inspected, infested: (a, b) => b.infested - a.infested || b.inspected - a.inspected, rate: (a, b) => (b.rate || 0) - (a.rate || 0) || b.inspected - a.inspected, label: (a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }) }[sortBy];
    rows.sort(cmp);
    const el = $('pt_' + key), shown = rows.slice(0, limit || 100);
    const lab = C.COLUMNS[key] ? C.COLUMNS[key].label : key;
    const max = rows.reduce((m, r) => Math.max(m, r.inspected), 1);
    el.innerHTML = '<thead><tr><th>' + F.esc(lab) + '</th><th class="num">Inspected</th><th class="num">Infested</th><th class="num">Infestation Rate</th>' + (ds.hasTreatment ? '<th class="num">Treated</th>' : '') + '</tr></thead><tbody>' +
      shown.map(r => '<tr><td>' + F.esc(r.label) + '</td><td class="num"><span class="bar" style="width:' + Math.round(r.inspected / max * 60) + 'px"></span>' + F.int(r.inspected) + '</td><td class="num">' + F.int(r.infested) + '</td><td class="num">' + F.pct(r.rate) + (r.inspected < C.MIN_BASE ? ' <sup title="Fewer than ' + C.MIN_BASE + ' inspections — rate is indicative only">*</sup>' : '') + '</td>' + (ds.hasTreatment ? '<td class="num">' + F.int(r.treated) + '</td>' : '') + '</tr>').join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="num">' + F.int(rows.reduce((a, r) => a + r.inspected, 0)) + '</td><td class="num">' + F.int(rows.reduce((a, r) => a + r.infested, 0)) + '</td><td class="num">' + F.pct(tot.rate) + '</td>' + (ds.hasTreatment ? '<td class="num">' + F.int(rows.reduce((a, r) => a + r.treated, 0)) + '</td>' : '') + '</tr></tfoot>';
    const more = el.closest('.perf').querySelector('.perfmore');
    more.innerHTML = rows.length > shown.length ? '<button class="btn link" data-showall="' + key + '">Show all ' + F.int(rows.length) + ' rows</button>' : (rows.some(r => r.inspected < C.MIN_BASE) ? '<small class="muted">* fewer than ' + C.MIN_BASE + ' inspections — rate is indicative only.</small>' : '');
  }
  function renderAnalysis(ds) {
    const S = App.sub, host = $('sub-' + S);
    document.querySelectorAll('#subnav button').forEach(b => { b.classList.toggle('on', b.dataset.s === S); const need = { area: 'area', sector: 'sector', team: 'team' }[b.dataset.s]; b.hidden = !!(need && !ds.dims[need]); });
    document.querySelectorAll('.subview').forEach(v => v.hidden = v.id !== 'sub-' + S);
    if (S === 'area' && ds.dims.area) { host.innerHTML = '<div class="grid2"><div data-chart="area_insp" data-limit="15"></div><div data-chart="area_inf" data-limit="15"></div></div><div data-chart="area_rate" data-limit="15"></div>' + perfTable(ds, 'area', 'Area performance', { noun: 'areas' }); Charts_all(host); fillPerf(ds, 'area', 'inspected'); }
    else if (S === 'sector' && ds.dims.sector) { host.innerHTML = '<div class="grid2"><div data-chart="sector_insp" data-limit="15"></div><div data-chart="sector_inf" data-limit="15"></div></div><div data-chart="sector_rate" data-limit="15"></div>' + perfTable(ds, 'sector', 'Sector performance', { noun: 'sectors' }); Charts_all(host); fillPerf(ds, 'sector', 'inspected'); }
    else if (S === 'team' && ds.dims.team) { host.innerHTML = '<div class="grid2"><div data-chart="opsurvey"></div><div data-chart="team_insp" data-limit="15"></div></div>' + perfTable(ds, 'team', 'Team performance', { noun: 'teams' }); Charts_all(host); fillPerf(ds, 'team', 'inspected'); }
    else if (S === 'pest') {
      host.innerHTML = '<div data-chart="pest" data-limit="15"></div>' + (ds.dims.targetPest ? perfTable(ds, 'targetPest', 'Target pest', { noun: 'pests' }) : '') + (ds.dims.program ? perfTable(ds, 'program', 'Program', { noun: 'programs' }) : '') + (ds.dims.locationType ? perfTable(ds, 'locationType', 'Location type', { noun: 'location types' }) : '') + (ds.dims.infRank ? perfTable(ds, 'infRank', 'Infestation ranking', { noun: 'rankings' }) : '');
      Charts_all(host); ['targetPest', 'program', 'locationType', 'infRank'].forEach(k => { if (ds.dims[k]) fillPerf(ds, k, 'inspected'); });
    }
    else if (S === 'trends') {
      const rows = A.series(ds, 'day');
      host.innerHTML = '<section class="card trend"><div class="chead"><div><h3 class="ctitle">Trend</h3></div><div class="seg" id="grainSeg2"><button data-g="day">Daily</button><button data-g="week">Weekly</button><button data-g="month">Monthly</button></div></div><div data-chart="trend_insp" class="flat"></div><div data-chart="trend_inf" class="flat"></div></section>' +
        '<section class="card"><h3 class="ctitle">Daily detail</h3><div class="tablewrap short"><table class="mini"><thead><tr><th>Date</th><th class="num">Inspected</th><th class="num">Infested</th><th class="num">Infestation Rate</th></tr></thead><tbody>' + rows.map(r => '<tr><td>' + IPR.dateUtil.dayLong(r.key) + '</td><td class="num">' + F.int(r.inspected) + '</td><td class="num">' + F.int(r.infested) + '</td><td class="num">' + F.pct(r.rate) + '</td></tr>').join('') + '</tbody></table></div></section>';
      host.querySelectorAll('#grainSeg2 button').forEach(b => b.classList.toggle('on', b.dataset.g === IPR.Charts.grain));
      Charts_all(host);
    }
    else if (S === 'quality') renderQuality(host, ds);
    else host.innerHTML = '<div class="card"><p class="muted">This analysis needs a column that is not present in the uploaded file.</p></div>';
  }
  const Charts_all = host => IPR.Charts.renderAll(host, App.ds);
  function renderQuality(host, ds) {
    const v = IPR.validate(ds), r = A.reconcile(ds), ic = { ok: '✓', warn: '⚠', info: 'ℹ', error: '✕' };
    host.innerHTML = '<section class="card"><h3 class="ctitle">Data quality</h3><p class="csub">Checks run on the full uploaded file. Data is never repaired silently.</p><ul class="vlist">' + v.checks.map(c => '<li class="v-' + c.level + '"><span class="vic">' + ic[c.level] + '</span><div><b>' + F.esc(c.text) + '</b>' + (c.detail ? '<small>' + F.esc(c.detail) + '</small>' : '') + '</div></li>').join('') + '</ul></section>' +
      '<section class="card"><h3 class="ctitle">Reconciliation (current filters)</h3><p class="csub">KPI totals must equal the sums of every chart and table.</p><ul class="vlist">' + r.map(x => '<li class="v-' + (x.ok ? 'ok' : 'error') + '"><span class="vic">' + (x.ok ? '✓' : '✕') + '</span><div><b>' + F.esc(x.name) + '</b><small>' + F.int(x.a) + ' vs ' + F.int(x.b) + '</small></div></li>').join('') + '</ul></section>';
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    const pick = () => $('fileInput').click();
    ['btnChoose', 'btnUpload', 'btnErrRetry', 'btnValAnother'].forEach(id => $(id).addEventListener('click', pick));
    $('fileInput').addEventListener('change', e => handleFile(e.target.files[0]));
    const dz = $('dropzone');
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') pick(); });
    window.addEventListener('dragover', e => e.preventDefault()); window.addEventListener('drop', e => { if (!e.target.closest('#dropzone')) { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); } });

    $('btnContinue').addEventListener('click', enterApp);
    IPR.Filters.onChange(onFiltersChanged);
    $('btnClearAll').addEventListener('click', () => IPR.Filters.clearAll());
    $('btnMore').addEventListener('click', () => { const open = $('filtersMore').hidden; $('filtersMore').hidden = !open; $('btnMore').textContent = open ? '− Fewer Filters' : '+ More Filters'; $('btnMore').setAttribute('aria-expanded', open); });
    $('chips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k; if (k === 'scannedAt' || b.dataset.c === 'all') IPR.Filters.clearOne(k); else IPR.Filters.removeValue(k, +b.dataset.c); });
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('btnReport').addEventListener('click', async () => { $('btnReport').disabled = true; $('btnReport').textContent = 'Preparing…'; try { await IPR.Export.managementReport(App.ds); } finally { $('btnReport').disabled = false; $('btnReport').textContent = 'Export Management Report'; } });

    // grain toggles (dashboard + analysis trends)
    document.addEventListener('click', e => {
      const g = e.target.closest('[data-g]'); if (g) { IPR.Charts.grain = g.dataset.g; document.querySelectorAll('[data-g]').forEach(b => b.classList.toggle('on', b.dataset.g === IPR.Charts.grain)); IPR.Charts.renderAll(document.querySelector('.tabview:not([hidden])'), App.ds); return; }
      const sa = e.target.closest('[data-showall]'); if (sa) { const k = sa.dataset.showall, sel = document.querySelector('select[data-sort="' + k + '"]'); fillPerf(App.ds, k, sel.value, 100000); sa.parentNode.innerHTML = ''; return; }
      const af = e.target.closest('[data-af]'); if (af) { const it = App.attItems[+af.dataset.af]; IPR.Filters.setSelected(it.filter.key, [it.filter.label]); }
    });
    document.addEventListener('change', e => { const s = e.target.closest('select[data-sort]'); if (s) fillPerf(App.ds, s.dataset.sort, s.value); });
    $('subnav').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; App.sub = b.dataset.s; App.dirty.analysis = 1; renderActive(); });

    // map
    $('mapMode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; document.querySelectorAll('#mapMode button').forEach(x => x.classList.toggle('on', x === b)); IPR.Map.setMode(b.dataset.m); });
    $('mapBase').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; document.querySelectorAll('#mapBase button').forEach(x => x.classList.toggle('on', x === b)); IPR.Map.setBase(b.dataset.b); });
    $('mapSearchForm').addEventListener('submit', e => { e.preventDefault(); $('mapSearchMsg').textContent = IPR.Map.search($('mapSearch').value) ? '' : 'No match in the current selection'; });

    // extraction
    $('extTable').addEventListener('click', e => { const th = e.target.closest('th.sortable'); if (!th) return; IPR.Table.sortBy(App.ds, +th.dataset.i); IPR.Table.render(App.ds); });
    const T = IPR.Table;
    $('pgFirst').onclick = () => { T.page = 0; T.render(App.ds); }; $('pgPrev').onclick = () => { T.page--; T.render(App.ds); };
    $('pgNext').onclick = () => { T.page++; T.render(App.ds); }; $('pgLast').onclick = () => { T.page = 1e9; T.render(App.ds); };
    $('pgSize').onchange = e => { T.size = +e.target.value; T.page = 0; T.render(App.ds); };
    $('btnCols').addEventListener('click', e => { e.stopPropagation(); $('colPanel').hidden = !$('colPanel').hidden; });
    $('colPanel').addEventListener('click', e => e.stopPropagation()); document.addEventListener('click', () => $('colPanel').hidden = true);
    const setCols = fn => { T.selected = new Set(T.all.filter(fn).map(c => c.index)); $('colList').querySelectorAll('input').forEach(i => i.checked = T.selected.has(+i.dataset.i)); T.render(App.ds); };
    $('colAll').onclick = () => setCols(() => true); $('colNone').onclick = () => setCols(() => false);
    $('colDefault').onclick = () => setCols(c => c.key && C.DEFAULT_TABLE_COLS.includes(c.key));
    $('colList').addEventListener('change', e => { const i = +e.target.dataset.i; if (e.target.checked) T.selected.add(i); else T.selected.delete(i); T.render(App.ds); });
    $('btnXlsx').addEventListener('click', async () => { const b = $('btnXlsx'); b.disabled = true; const t = b.textContent; b.textContent = 'Building Excel…'; await tick(); try { IPR.Export.excel(App.ds, $('expAll').checked); } finally { b.disabled = false; b.textContent = t; } });
    $('btnCsv').addEventListener('click', () => IPR.Export.csv(App.ds, $('expAll').checked));
  }

  document.addEventListener('DOMContentLoaded', () => { wire(); show('viewUpload'); });
})();
