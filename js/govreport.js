/* ==========================================================================
   govreport.js — "Government Report" (Observation Report › Overall Areas › 3rd mode)
   Program: SCH. SERVICE FOR GOVERMENT FACILITIES. One row per Account Site / Area.
   Total = sum of the "Count" values (once per inspection point); Infestation = count of infested points.
   ========================================================================== */
(function () {
  const F = IPR.fmt, Gov = IPR.Gov = { st: { f: { site: new Set(), area: new Set(), grp: new Set(), day: new Set() }, ver: null } };
  const PROG = /GOVERN?MENT FACILITIES/i;
  const AG = { 'Al Nouf (Bu Saha Island)': 'A2', 'Mshayrif': 'A5', 'Rabdan': 'A2', 'Mohamed Bin Zayed City': 'A2', 'Al Shawamekh': 'A4', 'Shakbout City': 'A3', 'Al Mirad': 'A3', 'Madinat Al Riyad': 'A3', 'Al Adlah': 'A5', 'Al Asheesh': 'A5', 'Al Fayah': 'A5', 'Al Haffar': 'A5', 'Al Khatm': 'A5', 'Al Nahdah': 'A4', 'Al Wathba': 'A4', 'Baniyas': 'A4', 'Dhaharat Al Teeb': 'A5', 'Dihan': 'A5', 'Jarn Yafour': 'A5', 'Al Sout': 'A1', 'Al Mizn': 'A4', 'Al Shamkhah': 'A3', 'Zayed City': 'A2', 'Al Shinayin': 'A1', 'Al Khidayrah': 'A1', 'Al Bihouth': 'A1', 'Al Aryam Island': 'A1', 'Abu Al Abyad Island': 'A1', 'Al Halah Island': 'A1', 'Al Selmiyyah': 'A1', 'Musaffah': 'A1', 'Al Futasi Island': 'A1', 'Abu Dhabi Industrial City': 'A1' };
  const AGL = {}; Object.keys(AG).forEach(k => AGL[k.toLowerCase()] = AG[k]);
  const L = a => a.map(x => x.toLowerCase());
  const MOS = L(['Mosquito Culex', 'Mosquito Aedes', 'Mosquito Anopheles']), FLY = L(['House Flies', 'Drain Flies', 'Fruit Flies']), RAT = L(['Roof Rat', 'Norway Rat']), ROA = L(['American Roaches']);
  const RULES = [
    [/STORM WATER LINE/, 'M', 'sw', MOS],
    [/ETISALAT CHAMBER|ELECTRICITY CHAMBER|ELECTRIC CHAMBER|STAGNANT WATER|MOSQUITO TRAP|BREEDING SITES? FOR MOSQUIT|ELECTRIC ROOM/, 'M', 'ob', MOS],
    [/LARGE BINS|FLIES TRAP|BINS FOR FLIES/, 'F', 'bin', FLY],
    [/SEWAGE MANHOLE/, 'R', 'mh', RAT],
    [/RODENT BAIT STATION/, 'R', 'bait', RAT],
    [/\bTREE\b|BURROWS/, 'R', 'tb', RAT],
    [/SEWAGE MANHOLE/, 'C', 'cm', ROA]];
  const COLN = { sw: 'Storm water lines', ob: 'Other breeding sites', bin: 'Bins & breeding sites', mh: 'Sewage manhole (Rats)', bait: 'Bait station', tb: 'Trees + burrows', cm: 'Sewage manhole (American Cockroach)' };
  const lab = (ds, k, i) => { const d = ds.dims[k]; return d ? d.values[d.codes[i]] : null; };
  const raw = (ds, k, i) => { if (!ds.has(k)) return ''; const v = ds.rows[i][ds.map[k]]; return v == null ? '' : String(v).trim(); };
  const dmy = d => { const x = new Date(d * 86400000); return String(x.getUTCDate()).padStart(2, '0') + '/' + String(x.getUTCMonth() + 1).padStart(2, '0') + '/' + x.getUTCFullYear(); };
  const nat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const esc = F.esc, num = v => v ? F.int(v) : '';
  const parts = s => { s = String(s || '').trim(); if (!s) return []; return s.split(/Observations?:\s*/i).map(x => x.trim()).filter(Boolean).map(t => { const m = t.match(/^(.*?)[,\s]*Count:\s*(\d+(?:\.\d+)?)/i); return m ? { n: m[1].trim().toUpperCase(), v: +m[2] } : { n: t.replace(/[,\s]+$/, '').toUpperCase(), v: 1 }; }); };

  /* ---------- build records from the filtered dataset ---------- */
  function build(ds) {
    const rows = new Map(), unm = new Set(); let used = 0, total = 0;
    const hasD = ds.has('program');
    for (let j = 0; j < ds.idx.length; j++) {
      const i = ds.idx[j]; if (hasD && !PROG.test(lab(ds, 'program', i) || '')) continue; total++;
      const area = (lab(ds, 'area', i) || '').trim(), site = raw(ds, 'accountSite', i) || '(no account site)', pest = raw(ds, 'targetPest', i), pl = pest.toLowerCase();
      const grp = AGL[area.toLowerCase()] || '?'; if (grp === '?') unm.add(area);
      const k = area + '|' + site; let R = rows.get(k); if (!R) rows.set(k, R = { site, area, grp, all: [] });
      const base = { pest, inf: !!ds.infested[i], note: raw(ds, 'obsNotes', i), bc: raw(ds, 'barcode', i), wo: raw(ds, 'wo', i), day: ds.day[i], team: raw(ds, 'team', i).replace(/\s+/g, ' '), imgs: (raw(ds, 'images', i).match(/https?:\/\/[^\s"']+/g) || []) };
      for (const p of parts(ds.rows[i][ds.map.observation])) {
        let hit = false;
        for (const [re, sec, col, ps] of RULES) if (re.test(p.n) && ps.includes(pl)) { hit = true; R.all.push({ ...base, o: p.n, val: p.v, sec, col, key: [base.wo, base.bc, col].join('|') }); }
        if (!hit) R.all.push({ ...base, o: p.n, val: p.v, sec: null, col: null, key: [base.wo, base.bc, p.n].join('|') });
        else used++;
      }
    }
    Gov.rows = Array.from(rows.values()); Gov.unm = unm; Gov.stat = { total, used };
  }
  function compute(R) {
    const ds = Gov.st.f.day, recs = R.all.filter(x => !ds.size || ds.has(x.day)), u = {}, p = {}, seen = new Set(), days = new Set(), mapped = recs.filter(x => x.col);
    for (const x of mapped) {
      days.add(x.day); const U = u[x.col] || (u[x.col] = {}), q = U[x.key] || (U[x.key] = { v: 0, inf: false }); q.v = Math.max(q.v, x.val); q.inf = q.inf || x.inf;
      const pb = x.sec === 'M' ? 'M' : (x.sec === 'R' ? x.col : null);
      if (x.inf && pb && !seen.has(x.key + x.pest)) { seen.add(x.key + x.pest); const l = x.pest.replace('Mosquito ', ''); (p[pb] || (p[pb] = {}))[l] = ((p[pb] || {})[l] || 0) + 1; }
    }
    return { R, recs, mapped, u, p, days: Array.from(days).filter(d => d >= 0).sort((a, b) => a - b) };
  }
  const tot = (C, c) => Object.values(C.u[c] || {}).reduce((a, x) => a + x.v, 0), infc = (C, c) => Object.values(C.u[c] || {}).filter(x => x.inf).length;
  const ptxt = (C, b) => Object.entries(C.p[b] || {}).map(([k, v]) => k + ' (' + v + ')').join(', ');

  /* ---------- table ---------- */
  function table() {
    const f = Gov.st.f, list = Gov.rows.filter(R => (!f.site.size || f.site.has(R.site)) && (!f.area.size || f.area.has(R.area)) && (!f.grp.size || f.grp.has(R.grp))).sort((a, b) => nat(a.grp, b.grp) || nat(a.area, b.area) || nat(a.site, b.site));
    const T = {}; Object.keys(COLN).forEach(c => T[c] = [0, 0]); Gov.out = [];
    const cell = (C, c, sb, fl) => { const t = tot(C, c), i = infc(C, c); T[c][0] += t; T[c][1] += i; return '<td class="' + (sb ? 'sb' : '') + '">' + num(t) + (fl ? '<br><small class="fl">' + fl + '</small>' : '') + '</td><td class="' + (i ? 'inf' : '') + '">' + num(i) + '</td>'; };
    let body = '';
    for (const R of list) {
      const C = compute(R); if (!C.recs.length) continue; Gov.out.push(C); const ix = Gov.out.length - 1, d = C.days, mm = tot(C, 'mh') !== tot(C, 'cm');
      const dc = [d[0], d[1], d[2], d.slice(3).join(',')].map((x, j) => '<td class="d' + (j ? '' : ' sb') + '">' + (x === undefined || x === '' ? '' : String(x).split(',').map(y => dmy(+y)).join(', ')) + '</td>').join('');
      const nn = new Set(C.recs.filter(x => x.note).map(x => x.key + x.note)).size;
      body += '<tr><td class="l"><a class="sl" data-gs="' + ix + '">' + esc(R.site) + '</a></td><td class="l">' + esc(R.area) + '</td><td>' + R.grp + '</td>' + dc +
        cell(C, 'sw', 1) + cell(C, 'ob') + '<td class="t">' + esc(ptxt(C, 'M')) + '</td>' + cell(C, 'bin', 1) +
        cell(C, 'mh', 1, mm ? '≠ Cockroach ' + tot(C, 'cm') : '') + '<td class="t">' + esc(ptxt(C, 'mh')) + '</td>' + cell(C, 'bait') + '<td class="t">' + esc(ptxt(C, 'bait')) + '</td>' + cell(C, 'tb') + '<td class="t">' + esc(ptxt(C, 'tb')) + '</td>' +
        cell(C, 'cm', 1, mm ? '≠ Rats ' + tot(C, 'mh') : '') + '<td class="sb">' + (nn ? '<button class="nb" data-gn="' + ix + '">Notes (' + nn + ')</button>' : '') + '</td></tr>';
    }
    const tp = 'Infested target pest & count', th = (t, c) => '<th class="' + (c || '') + '">' + t + '</th>';
    const H2 = [['Account Site'], ['Area'], ['Area Group Name'], ['Date 1', 'sb'], ['Date 2'], ['Date 3'], ['Date 4'], ['Total storm water lines', 'sb'], ['Storm water lines infested'], ['Other breeding sites'], ['Infested other breeding sites'], [tp], ['Bins & breeding sites', 'sb'], ['Infested bins & breeding sites'], ['Sewage manhole', 'sb'], ['Infested sewage manhole'], [tp], ['Bait station'], ['Infested bait station'], [tp], ['Trees + burrows'], ['Infested trees + burrows'], [tp], ['Sewage manhole', 'sb'], ['Infested sewage manhole'], ['Notes', 'sb']];
    const head = '<thead><tr><th colspan="3"></th><th class="s sb" colspan="4">Dates</th><th class="s sb" colspan="5">Mosquitoes</th><th class="s sb" colspan="2">Flies</th><th class="s sb" colspan="9">Rats</th><th class="s sb" colspan="2">American Cockroach</th><th class="s sb"></th></tr><tr>' + H2.map(h => th(h[0], h[1])).join('') + '</tr></thead>';
    const tc = (c, sb) => '<td class="' + (sb ? 'sb' : '') + '">' + num(T[c][0]) + '</td><td>' + num(T[c][1]) + '</td>';
    const foot = '<tr class="tot"><td class="l" colspan="7">Total (' + Gov.out.length + ' rows)</td>' + tc('sw', 1) + tc('ob') + '<td></td>' + tc('bin', 1) + tc('mh', 1) + '<td></td>' + tc('bait') + '<td></td>' + tc('tb') + '<td></td>' + tc('cm', 1) + '<td class="sb"></td></tr>';
    return '<table class="gvt" id="gvTable">' + head + '<tbody>' + body + foot + '</tbody></table>';
  }

  /* ---------- multi-select dropdown (search + checkboxes) ---------- */
  function ms(host, key, title, vals, L) {
    const sel = Gov.st.f[key], div = document.createElement('div'); div.className = 'gvms'; L = L || (v => v);
    div.innerHTML = '<button type="button" class="btn ghost small">' + title + ' <span class="gvn"></span> ▾</button><div class="gvpn" hidden><input type="text" placeholder="Search…"><div class="gvac"><a data-a="all">Select all shown</a><a data-a="none">Clear</a></div><div class="gvls"></div></div>';
    const btn = div.children[0], pn = div.children[1], q = pn.children[0], ls = pn.children[2], cnt = () => div.querySelector('.gvn').textContent = sel.size || 'All';
    ls.innerHTML = vals.map((v, i) => '<label data-t="' + esc(String(L(v))).toLowerCase() + '"><input type="checkbox" data-i="' + i + '"' + (sel.has(v) ? ' checked' : '') + '><span>' + esc(String(L(v))) + '</span></label>').join(''); cnt();
    btn.onclick = e => { e.stopPropagation(); document.querySelectorAll('.gvpn').forEach(p => { if (p !== pn) p.hidden = true; }); pn.hidden = !pn.hidden; if (!pn.hidden) q.focus(); };
    pn.onclick = e => e.stopPropagation();
    q.oninput = () => { const t = q.value.toLowerCase(); ls.querySelectorAll('label').forEach(l => l.style.display = l.dataset.t.includes(t) ? '' : 'none'); };
    ls.onchange = e => { const v = vals[e.target.dataset.i]; e.target.checked ? sel.add(v) : sel.delete(v); cnt(); paint(); };
    pn.querySelector('.gvac').onclick = e => { const a = e.target.dataset.a; if (!a) return; ls.querySelectorAll('label').forEach(l => { if (l.style.display === 'none') return; const c = l.firstChild, v = vals[c.dataset.i]; c.checked = a === 'all'; a === 'all' ? sel.add(v) : sel.delete(v); }); cnt(); paint(); };
    host.appendChild(div);
  }
  document.addEventListener('click', () => document.querySelectorAll('.gvpn').forEach(p => p.hidden = true));

  /* ---------- popups ---------- */
  function modal(title, html) {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="modalbox gvbox"><div class="gvm-h"><b></b><button type="button" class="btn ghost small">Close</button></div><div class="gvm-b">' + html + '</div></div>';
    m.querySelector('b').textContent = title; const close = () => { m.remove(); document.removeEventListener('keydown', esck); }, esck = e => { if (e.key === 'Escape') close(); };
    m.querySelector('button').onclick = close; m.onclick = e => { if (e.target === m) close(); }; document.addEventListener('keydown', esck); document.body.appendChild(m);
  }
  function sitePopup(C) {
    const byD = new Map();
    for (const x of C.recs) {
      let d = byD.get(x.day); if (!d) byD.set(x.day, d = { teams: new Set(), obs: new Map(), imgs: new Set() });
      if (x.team) d.teams.add(x.team); x.imgs.forEach(u => d.imgs.add(u));
      const k = x.o + '|' + (x.col || ''); let o = d.obs.get(k); if (!o) d.obs.set(k, o = { o: x.o, col: x.col, pts: new Map(), p: new Map(), seen: new Set() });
      let q = o.pts.get(x.key); if (!q) o.pts.set(x.key, q = { v: 0, inf: false }); q.v = Math.max(q.v, x.val); q.inf = q.inf || x.inf;
      if (x.inf && !o.seen.has(x.key + x.pest)) { o.seen.add(x.key + x.pest); const l = x.pest.replace('Mosquito ', ''); o.p.set(l, (o.p.get(l) || 0) + 1); }
    }
    let h = '';
    for (const dk of Array.from(byD.keys()).sort((a, b) => a - b)) {
      const d = byD.get(dk);
      h += '<div class="gvdt">Date: ' + (dk >= 0 ? dmy(dk) : '(no date)') + '</div><div class="gvtm">Team: ' + (Array.from(d.teams).map(esc).join(', ') || '-') + '</div><table class="gvdtb"><tr><th>Observation</th><th>Value</th><th>Infestation count</th><th>Infestation target</th></tr>' +
        Array.from(d.obs.values()).map(o => { const pts = Array.from(o.pts.values()), v = pts.reduce((a, x) => a + x.v, 0), n = pts.filter(x => x.inf).length; return '<tr><td>' + esc(o.o) + (o.col ? '<br><small>' + COLN[o.col] + '</small>' : '<br><small class="muted">not in report</small>') + '</td><td>' + num(v) + '</td><td>' + num(n) + '</td><td>' + (Array.from(o.p).map(([k, c]) => k + ' (' + c + ')').join(', ')) + '</td></tr>'; }).join('') + '</table>' +
        (d.imgs.size ? '<details class="gvph"><summary>Show photos (' + d.imgs.size + ')</summary>' + Array.from(d.imgs).map((u, i) => '<div><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Photo ' + (i + 1) + ' ↗</a><br><img src="' + esc(u) + '" loading="lazy" alt="" onerror="this.remove()"></div>').join('') + '</details>' : '');
    }
    modal(C.R.site + ' · ' + C.R.area + ' · ' + C.R.grp, h || 'No data.');
  }
  function notesPopup(C) {
    const byD = new Map();
    for (const x of C.recs) { let d = byD.get(x.day); if (!d) byD.set(x.day, d = new Map()); const lb = x.col ? COLN[x.col] : x.o; let m = d.get(lb); if (!m) d.set(lb, m = new Map()); const o = m.get(x.key) || { bc: x.bc, inf: false, pests: new Set(), note: '', v: 0 }; o.inf = o.inf || x.inf; o.v = Math.max(o.v, x.val); o.pests.add(x.pest.replace('Mosquito ', '')); if (x.note) o.note = x.note; m.set(x.key, o); }
    let h = '';
    for (const dk of Array.from(byD.keys()).sort((a, b) => a - b)) {
      h += '<div class="gvdt">Date: ' + (dk >= 0 ? dmy(dk) : '(no date)') + '</div>';
      for (const [lb, m] of byD.get(dk)) {
        const arr = Array.from(m.values()), wn = arr.filter(x => x.note); if (!wn.length) continue;
        h += '<div class="gvc">' + esc(lb) + ' <small>· total ' + num(arr.reduce((a, x) => a + x.v, 0)) + ' · infested ' + num(arr.filter(x => x.inf).length) + ' · with notes ' + wn.length + '</small></div>';
        wn.sort((a, b) => b.inf - a.inf).forEach(x => h += '<div class="gvnt' + (x.inf ? ' i' : '') + '"><em>' + esc(x.bc) + ' · ' + Array.from(x.pests).join(', ') + ' · ' + (x.inf ? 'Infested' : 'Not infested') + '</em><br>' + esc(x.note) + '</div>');
      }
    }
    modal('Notes — ' + C.R.site + ' · ' + C.R.area, h || 'No notes.');
  }

  /* ---------- view ---------- */
  function paint() {
    const w = Gov.box.querySelector('.gv-wrap'); w.innerHTML = table();
    const t = w.querySelector('thead'); if (t) { const h = t.rows[0].offsetHeight; Array.from(t.rows[1].cells).forEach(c => c.style.top = h + 'px'); }
    Gov.box.querySelector('.gv-info').textContent = Gov.stat.total + ' government-facilities records · ' + Gov.stat.used + ' used in the report · ' + Gov.out.length + ' site rows';
  }
  Gov.view = function (el, ds) {
    if (Gov.st.ver !== IPR.Filters.version) { Object.values(Gov.st.f).forEach(s => s.clear()); Gov.st.ver = IPR.Filters.version; }
    build(ds);
    const box = Gov.box = document.createElement('div'); box.className = 'gv';
    box.innerHTML = '<p class="csub">Program: SCH. SERVICE FOR GOVERMENT FACILITIES · one row per Account Site · totals = sum of the “Count” values, infested = infested points · blank = 0 · click an Account Site for team / date / observation details and photos</p>' +
      (Gov.unm.size ? '<div class="gv-warn">Area not in the Area Group table (shown as “?”): ' + Array.from(Gov.unm).map(esc).join(', ') + '</div>' : '') +
      '<div class="gv-filters"></div><div class="gv-bar"><button type="button" class="btn primary small" data-gx="1">Export Excel</button><button type="button" class="btn ghost small" data-gc="1">Clear filters</button><span class="csub gv-info"></span></div><div class="gv-wrap"></div>';
    el.appendChild(box);
    const fh = box.querySelector('.gv-filters'), u = k => Array.from(new Set(Gov.rows.map(r => r[k]))).sort(nat);
    ms(fh, 'site', 'Account Site', u('site')); ms(fh, 'area', 'Area', u('area')); ms(fh, 'grp', 'Area Group Name', u('grp'));
    ms(fh, 'day', 'Dates', Array.from(new Set(Gov.rows.flatMap(r => r.all.map(x => x.day)).filter(d => d >= 0))).sort((a, b) => a - b), dmy);
    box.onclick = e => {
      const s = e.target.closest('[data-gs]'); if (s) return sitePopup(Gov.out[+s.dataset.gs]);
      const n = e.target.closest('[data-gn]'); if (n) return notesPopup(Gov.out[+n.dataset.gn]);
      if (e.target.closest('[data-gc]')) { Object.values(Gov.st.f).forEach(x => x.clear()); fh.innerHTML = ''; ms(fh, 'site', 'Account Site', u('site')); ms(fh, 'area', 'Area', u('area')); ms(fh, 'grp', 'Area Group Name', u('grp')); ms(fh, 'day', 'Dates', Array.from(new Set(Gov.rows.flatMap(r => r.all.map(x => x.day)).filter(d => d >= 0))).sort((a, b) => a - b), dmy); return paint(); }
      if (e.target.closest('[data-gx]')) { const t = box.querySelector('#gvTable').cloneNode(true); t.querySelectorAll('.nb').forEach(b => b.parentNode.textContent = ''); const wb = XLSX.utils.table_to_book(t, { sheet: 'Government Report' }); XLSX.writeFile(wb, 'Government_Facilities_Report.xlsx'); }
    };
    paint();
  };
})();
