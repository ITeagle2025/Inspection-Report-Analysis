/* ==========================================================================
   filters.js — global filter state, mask computation, multi-select UI
   Model: for each dimension a Set of selected codes. Empty set or "all
   selected" = no restriction. Scanned At = timestamp range.
   Result of apply(): ds.idx (Int32Array of passing row indexes) + version.
   ========================================================================== */
(function () {
  const C = IPR.CONFIG, F = IPR.fmt;
  const Filters = IPR.Filters = { state: {}, range: null, quick: 'all', version: 0, listeners: [] };

  Filters.reset = function (ds) {
    Filters.ds = ds; Filters.state = {}; Filters.range = null; Filters.quick = 'all'; Filters.version++;
    Filters.activeKeys().forEach(k => Filters.state[k] = new Set());
  };
  Filters.activeKeys = () => (Filters.ds ? C.PRIMARY_FILTERS.concat(C.MORE_FILTERS).filter(k => k === 'scannedAt' || Filters.ds.dims[k]) : []);
  Filters.onChange = fn => Filters.listeners.push(fn);

  Filters.isActive = function (k) {
    if (k === 'scannedAt') return !!Filters.range;
    const s = Filters.state[k], d = Filters.ds.dims[k];
    return !!s && s.size > 0 && s.size < d.values.length;
  };

  /** Compute passing indexes. */
  Filters.apply = function () {
    const ds = Filters.ds, n = ds.n;
    const active = Object.keys(Filters.state).filter(k => k !== 'scannedAt' && Filters.isActive(k));
    const luts = active.map(k => { const d = ds.dims[k], lut = new Uint8Array(d.values.length); Filters.state[k].forEach(c => lut[c] = 1); return { codes: d.codes, lut }; });
    const r = Filters.range;
    const out = new Int32Array(n); let m = 0;
    for (let i = 0; i < n; i++) {
      let ok = true;
      for (let j = 0; j < luts.length; j++) { const L = luts[j]; if (!L.lut[L.codes[i]]) { ok = false; break; } }
      if (ok && r) { const t = ds.ts[i]; if (isNaN(t) || t < r.from || t > r.to) ok = false; }
      if (ok) out[m++] = i;
    }
    ds.idx = out.subarray(0, m); Filters.version++;
    return ds.idx;
  };

  Filters.notify = function () { Filters.apply(); Filters.listeners.forEach(fn => fn()); };
  let timer; Filters.notifyDebounced = function () { clearTimeout(timer); timer = setTimeout(Filters.notify, 60); };

  Filters.setSelected = function (k, valueLabels) {
    const d = Filters.ds.dims[k]; const s = new Set();
    valueLabels.forEach(v => { const c = d.values.indexOf(v); if (c >= 0) s.add(c); });
    Filters.state[k] = s; Filters.syncUI(); Filters.notify();
  };
  Filters.clearAll = function () {
    Object.keys(Filters.state).forEach(k => Filters.state[k] = new Set());
    Filters.range = null; Filters.quick = 'all'; Filters.syncUI(); Filters.notify();
  };
  Filters.clearOne = function (k) { if (k === 'scannedAt') { Filters.range = null; Filters.quick = 'all'; } else Filters.state[k] = new Set(); Filters.syncUI(); Filters.notify(); };
  Filters.removeValue = function (k, code) {
    const d = Filters.ds.dims[k]; let s = Filters.state[k];
    if (s.size === 0 || s.size === d.values.length) return;
    s.delete(code); Filters.syncUI(); Filters.notify();
  };
  Filters.activeCount = () => Filters.activeKeys().filter(Filters.isActive).length;

  /** Human summary of active filters: [{key,label,values:[{code,text}]}] */
  Filters.summary = function () {
    const ds = Filters.ds, out = [];
    Filters.activeKeys().forEach(k => {
      if (!Filters.isActive(k)) return;
      if (k === 'scannedAt') { out.push({ key: k, label: 'Scanned At', values: [{ code: -1, text: IPR.dateUtil.isoTime(Filters.range.from).slice(0, 16) + ' → ' + IPR.dateUtil.isoTime(Filters.range.to).slice(0, 16) }] }); return; }
      const d = ds.dims[k], vals = Array.from(Filters.state[k]).sort((a, b) => a - b).map(c => ({ code: c, text: d.values[c] }));
      out.push({ key: k, label: C.COLUMNS[k].label, values: vals });
    });
    return out;
  };

  /* ------------------------------ UI ------------------------------ */
  const widgets = {};
  Filters.syncUI = function () { Object.values(widgets).forEach(w => w.refresh()); };

  function closeAll(except) { Object.values(widgets).forEach(w => { if (w !== except) w.close(); }); }
  document.addEventListener('click', e => { if (!e.target.closest('.fdd')) closeAll(); });

  function buildMulti(k) {
    const ds = Filters.ds, d = ds.dims[k], label = C.COLUMNS[k].label;
    const wrap = document.createElement('div'); wrap.className = 'fdd'; wrap.dataset.key = k;
    wrap.innerHTML = '<span class="flabel">' + F.esc(label) + '</span><button type="button" class="fbtn" aria-haspopup="listbox"><span class="ftxt">All</span><span class="fcaret">▾</span></button>' +
      '<div class="fpanel" hidden><input class="fsearch" type="search" placeholder="Search ' + F.esc(label) + '…"><div class="factions"><button type="button" data-a="all">Select All</button><button type="button" data-a="clear">Clear</button><span class="fcount"></span></div><div class="flist" role="listbox"></div></div>';
    const btn = wrap.querySelector('.fbtn'), panel = wrap.querySelector('.fpanel'), list = wrap.querySelector('.flist'), search = wrap.querySelector('.fsearch'), cnt = wrap.querySelector('.fcount');
    const LIMIT = 250; let q = '';
    const sel = () => Filters.state[k];

    function matches() { const ql = q.toLowerCase(); const r = []; for (let i = 0; i < d.values.length; i++) if (!ql || d.values[i].toLowerCase().includes(ql)) r.push(i); return r; }
    function renderList() {
      const m = matches(), shown = m.slice(0, LIMIT);
      list.innerHTML = shown.map(c => '<label class="fopt"><input type="checkbox" data-c="' + c + '"' + (sel().has(c) ? ' checked' : '') + '><span class="fotxt" title="' + F.esc(d.values[c]) + '">' + F.esc(d.values[c]) + '</span><span class="fon">' + F.int(d.counts[c]) + '</span></label>').join('') +
        (m.length > LIMIT ? '<div class="fmore">' + F.int(m.length - LIMIT) + ' more — type to search</div>' : '') + (m.length === 0 ? '<div class="fmore">No matches</div>' : '');
      cnt.textContent = sel().size + ' of ' + d.values.length + ' selected';
    }
    function curLabel() {
      const s = sel(), t = d.values.length;
      return (s.size === 0 || s.size === t) ? 'All' : (s.size === 1 ? d.values[Array.from(s)[0]] : s.size + ' selected');
    }
    function refresh() { btn.querySelector('.ftxt').textContent = curLabel(); btn.classList.toggle('active', Filters.isActive(k)); if (!panel.hidden) renderList(); }
    function close() { panel.hidden = true; wrap.classList.remove('open'); }
    btn.addEventListener('click', e => { e.stopPropagation(); const open = panel.hidden; closeAll(w); panel.hidden = !open; wrap.classList.toggle('open', open); if (open) { q = ''; search.value = ''; renderList(); search.focus(); } });
    panel.addEventListener('click', e => e.stopPropagation());
    search.addEventListener('input', () => { q = search.value; renderList(); });
    list.addEventListener('change', e => { const c = +e.target.dataset.c; if (e.target.checked) sel().add(c); else sel().delete(c); refresh(); Filters.notifyDebounced(); });
    wrap.querySelector('.factions').addEventListener('click', e => {
      const a = e.target.dataset.a; if (!a) return;
      if (a === 'all') matches().forEach(c => sel().add(c)); else sel().clear();
      refresh(); Filters.notifyDebounced();
    });
    const w = { el: wrap, refresh, close }; widgets[k] = w; return wrap;
  }

  function buildDate() {
    const ds = Filters.ds;
    const wrap = document.createElement('div'); wrap.className = 'fdd fdate'; wrap.dataset.key = 'scannedAt';
    wrap.innerHTML = '<span class="flabel">Date (Scanned At)</span><button type="button" class="fbtn"><span class="ftxt">All Dates</span><span class="fcaret">▾</span></button>' +
      '<div class="fpanel fdatepanel" hidden><div class="fquick"></div><div class="fdrow"><label>From<input type="datetime-local" class="dfrom" step="60"></label><label>To<input type="datetime-local" class="dto" step="60"></label></div><div class="fhint"></div></div>';
    const btn = wrap.querySelector('.fbtn'), panel = wrap.querySelector('.fpanel'), qk = wrap.querySelector('.fquick'), from = wrap.querySelector('.dfrom'), to = wrap.querySelector('.dto'), hint = wrap.querySelector('.fhint');
    const Q = [['all', 'All Dates'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['last7', 'Last 7 Days'], ['month', 'This Month'], ['lastday', 'Last Data Day'], ['custom', 'Custom']];
    qk.innerHTML = Q.map(([v, t]) => '<button type="button" data-q="' + v + '">' + t + '</button>').join('');
    const pad = n => String(n).padStart(2, '0');
    const toInput = ms => { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };
    const fromInput = s => { const m = s && s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : NaN; };
    const dayStart = day => day * 86400000, dayEnd = day => day * 86400000 + 86399999;
    // "today" uses the viewer's calendar date (local clock) expressed as a naive date
    const nowL = new Date(); const todayDay = Date.UTC(nowL.getFullYear(), nowL.getMonth(), nowL.getDate()) / 86400000;

    function setRange(q) {
      Filters.quick = q;
      let a, b;
      if (q === 'all') { Filters.range = null; }
      else {
        if (q === 'today') { a = dayStart(todayDay); b = dayEnd(todayDay); }
        else if (q === 'yesterday') { a = dayStart(todayDay - 1); b = dayEnd(todayDay - 1); }
        else if (q === 'last7') { a = dayStart(todayDay - 6); b = dayEnd(todayDay); }
        else if (q === 'month') { a = dayStart(IPR.dateUtil.monthStart(todayDay)); b = dayEnd(todayDay); }
        else if (q === 'lastday') { const L = ds.dayList[ds.dayList.length - 1]; a = dayStart(L); b = dayEnd(L); }
        else if (q === 'custom') { a = fromInput(from.value); b = fromInput(to.value); if (isNaN(a)) a = ds.minTs; if (isNaN(b)) b = ds.maxTs; }
        Filters.range = { from: a, to: b };
      }
      refresh(); Filters.notify();
    }
    function refresh() {
      const r = Filters.range;
      btn.classList.toggle('active', !!r);
      qk.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.q === Filters.quick));
      if (r) { from.value = toInput(r.from); to.value = toInput(r.to); } else { from.value = toInput(ds.minTs); to.value = toInput(ds.maxTs); }
      btn.querySelector('.ftxt').textContent = !r ? 'All Dates' : (Filters.quick !== 'custom' && Filters.quick !== 'all' ? Q.find(x => x[0] === Filters.quick)[1] : IPR.dateUtil.iso(r.from).slice(5) + ' → ' + IPR.dateUtil.iso(r.to).slice(5));
      hint.textContent = 'Data: ' + IPR.dateUtil.isoTime(ds.minTs).slice(0, 16) + ' → ' + IPR.dateUtil.isoTime(ds.maxTs).slice(0, 16) + '. Today / Yesterday / Last 7 Days / This Month use the current calendar date.';
    }
    btn.addEventListener('click', e => { e.stopPropagation(); const open = panel.hidden; closeAll(w); panel.hidden = !open; wrap.classList.toggle('open', open); });
    panel.addEventListener('click', e => e.stopPropagation());
    qk.addEventListener('click', e => { const q = e.target.dataset.q; if (q) setRange(q); });
    const custom = () => { const a = fromInput(from.value), b = fromInput(to.value); if (isNaN(a) || isNaN(b)) return; Filters.quick = 'custom'; Filters.range = { from: Math.min(a, b), to: Math.max(a, b) }; refresh(); Filters.notifyDebounced(); };
    from.addEventListener('change', custom); to.addEventListener('change', custom);
    refresh();
    const w = { el: wrap, refresh, close() { panel.hidden = true; wrap.classList.remove('open'); } }; widgets.scannedAt = w; return wrap;
  }

  /** Build all filter widgets into the two containers. Missing columns are simply skipped. */
  Filters.buildUI = function (primaryEl, moreEl, moreBtn) {
    Object.keys(widgets).forEach(k => delete widgets[k]);
    primaryEl.innerHTML = ''; moreEl.innerHTML = '';
    C.PRIMARY_FILTERS.forEach(k => { if (k === 'scannedAt') primaryEl.appendChild(buildDate()); else if (Filters.ds.dims[k]) primaryEl.appendChild(buildMulti(k)); });
    let moreCount = 0;
    C.MORE_FILTERS.forEach(k => { if (Filters.ds.dims[k]) { moreEl.appendChild(buildMulti(k)); moreCount++; } });
    moreBtn.hidden = moreCount === 0; moreEl.hidden = true; moreBtn.textContent = '+ More Filters';
    moreBtn.setAttribute('aria-expanded', 'false');
    Filters.syncUI();
  };
})();
