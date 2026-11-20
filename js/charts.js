/* ==========================================================================
   charts.js — chart specs (data) + generic Chart.js renderer
   Rules from the dataviz guide: single y-scale per chart (no dual axes),
   thin bars with rounded data-ends, direct value labels, recessive grid,
   colour follows the measure (Inspected = ADPHC blue, Infested = alert,
   Treated = Eagle green, Survey = Eagle teal), table view for every chart.
   ========================================================================== */
(function () {
  const C = IPR.CONFIG, K = C.COLORS, F = IPR.fmt, A = IPR.Analytics;
  const Charts = IPR.Charts = { grain: 'day', inst: {}, specs: {} };

  /* ---------- plugin: direct value labels at the end of each bar ---------- */
  const barLabels = {
    id: 'barLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || opts.display === false) return;
      const ctx = chart.ctx; ctx.save(); ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.fillStyle = opts.color || K.ink; ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di); if (meta.hidden) return;
        meta.data.forEach((bar, i) => {
          const txt = ds.labels ? ds.labels[i] : (opts.fmt ? opts.fmt(ds.data[i]) : F.int(ds.data[i]));
          if (txt == null || txt === '') return;
          if (chart.options.indexAxis === 'y') { ctx.textAlign = 'left'; ctx.fillText(txt, bar.x + 6, bar.y); }
          else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(txt, bar.x, bar.y - 4); ctx.textBaseline = 'middle'; }
        });
      });
      ctx.restore();
    }
  };

  const top = (rows, f, n) => rows.slice().sort((a, b) => f(b) - f(a)).slice(0, n);
  const hbar = (title, sub, rows, valFn, color, labelFn, name) => ({
    title, sub, kind: 'hbar', labels: rows.map(r => r.label),
    series: [{ name, color, data: rows.map(valFn), labels: labelFn ? rows.map(labelFn) : null }]
  });

  /* ---------------- specs: each returns {title, sub, kind, labels, series, note} ---------------- */
  Charts.specs.trend_insp = ds => { const s = A.series(ds, Charts.grain); return { title: 'Inspected', sub: 'Inspection records per ' + Charts.grain, kind: 'vbar', labels: s.map(r => r.label), series: [{ name: 'Inspected', color: K.adphc, data: s.map(r => r.inspected) }], height: 190 }; };
  Charts.specs.trend_inf = ds => { const s = A.series(ds, Charts.grain); return { title: 'Infested', sub: 'Infested records per ' + Charts.grain + ' (infestation rate in table view)', kind: 'vbar', labels: s.map(r => r.label), series: [{ name: 'Infested', color: K.alert, data: s.map(r => r.infested) }], extra: s.map(r => ({ 'Infestation rate': F.pct(r.rate) })), height: 170 }; };
  Charts.specs.area_insp = (ds, o) => { const n = o.limit || 12, g = A.groupBy(ds, 'area'), r = top(g, x => x.inspected, n); return Object.assign(hbar('Inspected by Area', g.length > n ? 'Top ' + n + ' of ' + g.length + ' areas' : g.length + ' areas', r, x => x.inspected, K.adphc, null, 'Inspected'), {}); };
  Charts.specs.area_inf = (ds, o) => { const n = o.limit || 12, g = A.groupBy(ds, 'area'), r = top(g, x => x.infested, n); return hbar('Infested by Area', g.length > n ? 'Top ' + n + ' of ' + g.length + ' areas' : g.length + ' areas', r, x => x.infested, K.alert, null, 'Infested'); };
  Charts.specs.area_rate = (ds, o) => { const n = o.limit || 15, g = A.groupBy(ds, 'area').filter(x => x.inspected >= C.MIN_BASE), r = top(g, x => x.rate || 0, n); const s = hbar('Infestation Rate by Area', 'Areas with ≥ ' + C.MIN_BASE + ' inspections' + (g.length > n ? ' · top ' + n + ' of ' + g.length : ''), r, x => +(x.rate || 0).toFixed(3), K.teal, x => F.pct(x.rate) + ' (' + F.int(x.infested) + '/' + F.int(x.inspected) + ')', 'Infestation rate %'); s.fmtTable = v => v.toFixed(2) + '%'; return s; };
  Charts.specs.sector_insp = (ds, o) => { const n = o.limit || 15, g = A.groupBy(ds, 'sector'), r = top(g, x => x.inspected, n); return hbar('Inspected by Sector', g.length > n ? 'Top ' + n + ' of ' + F.int(g.length) + ' sectors' : g.length + ' sectors', r, x => x.inspected, K.adphc, null, 'Inspected'); };
  Charts.specs.sector_inf = (ds, o) => { const n = o.limit || 15, g = A.groupBy(ds, 'sector'), r = top(g, x => x.infested, n); return hbar('Infested by Sector', g.length > n ? 'Top ' + n + ' of ' + F.int(g.length) + ' sectors' : g.length + ' sectors', r, x => x.infested, K.alert, null, 'Infested'); };
  Charts.specs.pest = (ds, o) => {
    if (o.countOnly) { const g = A.groupBy(ds, 'targetPest').filter(x => x.infested > 0), r = top(g, x => x.infested, o.limit || 15); return hbar('Infested Records by Target Pest', 'Number of infested records per target pest, largest to smallest', r, x => x.infested, K.alert, null, 'Infested'); }
    const n = o.limit || 12, g = A.groupBy(ds, 'targetPest').filter(x => x.infested > 0), r = top(g, x => x.infested, n); return hbar('Infestation by Target Pest', 'Infested records · label shows infestation rate of that pest’s inspections', r, x => x.infested, K.alert, x => F.int(x.infested) + ' · ' + F.pct(x.rate), 'Infested'); };
  Charts.specs.sector_rate = (ds, o) => { const n = o.limit || 15, g = A.groupBy(ds, 'sector').filter(x => x.inspected >= C.MIN_BASE && x.label !== ds.BLANK), r = top(g, x => x.rate || 0, n); const s = hbar('Infestation Rate by Sector', 'Sectors with ≥ ' + C.MIN_BASE + ' inspections' + (g.length > n ? ' · top ' + n + ' of ' + g.length : ''), r, x => +(x.rate || 0).toFixed(3), K.teal, x => F.pct(x.rate) + ' (' + F.int(x.infested) + '/' + F.int(x.inspected) + ')', 'Infestation rate %'); s.fmtTable = v => v.toFixed(2) + '%'; return s; };
  Charts.specs.opsurvey = ds => {
    const t = A.totals(ds);
    const series = [{ name: 'Operation', color: K.adphc, data: [t.operation.inspected, t.operation.infested, ds.hasTreatment ? t.operation.treated : null] },
                    { name: 'Survey', color: K.teal, data: [t.survey.inspected, t.survey.infested, ds.hasTreatment ? 0 : null] }];
    if (t.unclassified.inspected) series.push({ name: 'Unclassified', color: K.gray, data: [t.unclassified.inspected, t.unclassified.infested, ds.hasTreatment ? t.unclassified.treated : null] });
    return { title: 'Operation vs Survey', sub: 'Survey = inspection only; no treatment counted', kind: 'groups', labels: ['Inspected', 'Infested', 'Treated'], series, height: 260 };
  };
  Charts.specs.team_insp = (ds, o) => { const n = o.limit || 15, g = A.groupBy(ds, 'team'), r = top(g, x => x.inspected, n); return hbar('Inspected by Team', 'Top ' + Math.min(n, g.length) + ' of ' + g.length + ' teams', r, x => x.inspected, K.adphc, null, 'Inspected'); };

  /* ---------------- rendering ---------------- */
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif'; Chart.defaults.color = K.muted; Chart.defaults.font.size = 11;

  function configFor(spec, theme) {
    const UI = IPR.UI, dark = theme !== 'light';
    const T = dark ? { ink: UI.ink, muted: UI.muted, grid: UI.grid, tip: UI.tipBg, sep: UI.sep, col: c => ({ [K.adphc]: UI.blue, [K.teal]: UI.teal, [K.green]: UI.green, [K.alert]: UI.alert, [K.gray]: UI.gray })[c] || c } : { ink: K.ink, muted: K.muted, grid: K.grid, tip: '#fff', sep: '#fff', col: c => c };
    const horizontal = spec.kind === 'hbar';
    const cfg = {
      type: 'bar',
      data: {
        labels: spec.labels,
        datasets: spec.series.map(s => ({
          label: s.name, data: s.data, labels: s.labels, backgroundColor: T.col(s.color), borderColor: T.sep, borderWidth: spec.kind === 'groups' ? 2 : 0,
          borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 }, borderSkipped: 'bottom',
          barThickness: horizontal ? 14 : undefined, maxBarThickness: spec.kind === 'groups' ? 34 : 26, categoryPercentage: spec.kind === 'groups' ? 0.7 : 0.8, barPercentage: 0.9
        }))
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x', responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        layout: { padding: { right: horizontal ? 90 : 6, top: horizontal ? 0 : 18 } },
        plugins: {
          legend: { display: spec.series.length > 1, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', color: T.ink } },
          tooltip: {
            backgroundColor: T.tip, titleColor: T.ink, bodyColor: T.ink, borderColor: T.grid, borderWidth: 1, padding: 10, boxPadding: 4,
            callbacks: { label: c => ' ' + c.dataset.label + ': ' + (c.dataset.labels ? c.dataset.labels[c.dataIndex] : (spec.fmtTable ? spec.fmtTable(c.parsed[horizontal ? 'x' : 'y']) : F.int(c.parsed[horizontal ? 'x' : 'y']))) }
          },
          barLabels: { display: spec.kind !== 'vbar' || spec.labels.length <= 16, color: T.ink }
        },
        scales: horizontal ? {
          x: { beginAtZero: true, grid: { color: T.grid, drawBorder: false }, border: { display: false }, ticks: { color: T.muted, callback: v => F.int(v), maxRotation: 0, maxTicksLimit: 6 } },
          y: { grid: { display: false }, border: { color: T.grid }, ticks: { color: T.ink, autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 30 ? l.slice(0, 29) + '…' : l; } } }
        } : {
          x: { grid: { display: false }, border: { color: T.grid }, ticks: { color: T.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 16 } },
          y: { beginAtZero: true, grid: { color: T.grid }, border: { display: false }, ticks: { color: T.muted, callback: v => F.int(v), maxTicksLimit: 5 } }
        }
      },
      plugins: [barLabels]
    };
    return cfg;
  }
  Charts.configFor = configFor;

  function tableHTML(spec) {
    const hasExtra = !!spec.extra; const fm = spec.fmtTable || F.int;
    let h = '<table class="mini"><thead><tr><th>' + F.esc(spec.kind === 'groups' ? 'Measure' : (spec.title.replace(/^.* by /, '') || 'Item')) + '</th>' + spec.series.map(s => '<th class="num">' + F.esc(s.name) + '</th>').join('') + (hasExtra ? '<th class="num">Infestation rate</th>' : '') + '</tr></thead><tbody>';
    spec.labels.forEach((l, i) => { h += '<tr><td>' + F.esc(l) + '</td>' + spec.series.map(s => '<td class="num">' + (s.data[i] == null ? 'n/a' : (s.labels ? F.esc(s.labels[i]) : fm(s.data[i]))) + '</td>').join('') + (hasExtra ? '<td class="num">' + spec.extra[i]['Infestation rate'] + '</td>' : '') + '</tr>'; });
    return h + '</tbody></table>';
  }

  /** Render (or re-render) all chart slots within a root element. */
  Charts.renderAll = function (root, ds) {
    Object.keys(Charts.inst).forEach(id => { const c = Charts.inst[id]; if (!c.canvas.isConnected) { c.destroy(); delete Charts.inst[id]; } });
    root.querySelectorAll('[data-chart]').forEach(el => Charts.renderSlot(el, ds));
  };
  Charts.renderSlot = function (el, ds) {
    const key = el.dataset.chart, fn = Charts.specs[key]; if (!fn) return;
    const need = { area_insp: 'area', area_inf: 'area', area_rate: 'area', sector_insp: 'sector', sector_inf: 'sector', sector_rate: 'sector', pest: 'targetPest', team_insp: 'team', opsurvey: 'team' }[key];
    if (need && !ds.dims[need]) { el.hidden = true; return; } el.hidden = false;
    const spec = fn(ds, { limit: +el.dataset.limit || 0 });
    const id = el.id || (el.id = 'ch_' + key + '_' + Math.random().toString(36).slice(2, 6));
    if (!el.dataset.built) {
      el.dataset.built = 1; el.classList.add('chartcard'); if (!el.classList.contains('flat')) el.classList.add('card');
      el.innerHTML = '<div class="chead"><div><h3 class="ctitle"></h3><p class="csub"></p></div><button type="button" class="ctoggle" aria-pressed="false">Table view</button></div><div class="cbody"><canvas></canvas></div><div class="ctable" hidden></div><p class="cempty" hidden>No data for the current filters.</p>';
      el.querySelector('.ctoggle').addEventListener('click', e => {
        const on = e.target.getAttribute('aria-pressed') !== 'true'; e.target.setAttribute('aria-pressed', on); e.target.textContent = on ? 'Chart view' : 'Table view';
        el.querySelector('.cbody').hidden = on; el.querySelector('.ctable').hidden = !on; if (!on) Charts.renderSlot(el, IPR.App.ds);
      });
    }
    el.querySelector('.ctitle').textContent = spec.title; el.querySelector('.csub').textContent = spec.sub || '';
    const empty = !spec.labels.length;
    el.querySelector('.cempty').hidden = !empty;
    const body = el.querySelector('.cbody'); body.hidden = empty || el.querySelector('.ctoggle').getAttribute('aria-pressed') === 'true';
    el.querySelector('.ctable').innerHTML = empty ? '' : tableHTML(spec);
    el.querySelector('.ctable').hidden = !(el.querySelector('.ctoggle').getAttribute('aria-pressed') === 'true') || empty;
    if (empty) { if (Charts.inst[id]) { Charts.inst[id].destroy(); delete Charts.inst[id]; } return; }
    const h = spec.height || (spec.kind === 'hbar' ? Math.max(90, spec.labels.length * 24 + 30) : 220);
    body.style.height = h + 'px';
    if (Charts.inst[id]) Charts.inst[id].destroy();
    if (!body.hidden) Charts.inst[id] = new Chart(el.querySelector('canvas'), configFor(spec));
  };

  Charts.destroyAll = function () { Object.values(Charts.inst).forEach(c => c.destroy()); Charts.inst = {}; };

  /** Render a spec offscreen to a PNG data URL (used by the management report). */
  Charts.toImage = function (key, ds, opts) {
    const spec = Charts.specs[key](ds, opts || {}); if (!spec.labels.length) return null;
    const h = spec.height || (spec.kind === 'hbar' ? Math.max(90, spec.labels.length * 24 + 30) : 220), w = (opts && opts.w) || 720;
    const div = document.createElement('div'); div.style.cssText = 'position:fixed;left:-9999px;top:0;width:' + w + 'px;height:' + h + 'px;';
    const cv = document.createElement('canvas'); div.appendChild(cv); document.body.appendChild(div);
    const cfg = configFor(spec, 'light'); cfg.options.animation = false; cfg.options.devicePixelRatio = 2;
    const ch = new Chart(cv, cfg); const url = ch.toBase64Image('image/png', 1); ch.destroy(); div.remove();
    return { url, spec, w, h };
  };
})();
