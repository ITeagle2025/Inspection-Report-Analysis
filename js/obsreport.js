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
  Obs.reset = () => { Obs.sub = 'overall'; Obs.team = null; Obs.pick = null; Obs.filters = {}; Obs.ver = -1; Obs.groups = null; Obs.tg = null; Obs.hierKey = null; Obs.flagVer = null; Obs.flagOff = new Set(); if (Obs.host) Obs.host.innerHTML = ''; };

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
      const mx = Math.max(8, ...Array.from(sn)); g.max = mx; g.label = 'SURVEY';
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
    const tabs = [{ key: 'overall', label: 'OVERALL AREAS' }].concat(groups.map(g => ({ key: g.key, label: g.label })), [{ key: 'flags', label: '⚑ ALL FLAGS' }]);
    if (!tabs.some(t => t.key === Obs.sub)) { Obs.sub = 'overall'; Obs.team = null; }
    host.innerHTML =
      '<section class="card obsintro"><div class="obsstats"><div><span>Records in selection</span><b>' + F.int(ds.idx.length) + '</b></div><div><span>' + (ds.woTs ? 'Work Order Date' : 'Scanned Date') + '</span><b class="sm">' + F.esc(per.label) + '</b></div><div><span>Area teams</span><b>' + areaTeams + '</b></div><div><span>Survey teams</span><b>' + surveyTeams + '</b></div></div></section>' +
      '<div class="subnav obstabs" id="obsTabs">' + tabs.map(t => '<button data-os="' + t.key + '" class="' + (t.key === Obs.sub ? 'on' : '') + '">' + F.esc(t.label) + '</button>').join('') + '</div>' +
      '<section class="card obsbody" id="obsBody"></section>';
    host.querySelector('#obsTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; Obs.sub = b.dataset.os; Obs.team = null; Obs.pick = null; Obs.filters = {}; Obs.flagOff = new Set(); Obs.render(host, ds); };
    host.querySelector('#obsBody').addEventListener('click', e => onBodyClick(e, ds));
    host.querySelector('#obsBody').addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.closest('.ph').classList.add('broken'); }, true);
    body(ds);
  };

  /* ---------------------------- observation parsing ---------------------------- */
  const SEP = '\u001f';
  const parseCache = new Map();
  /** "Observation: NAME, Count: 1 Observation: NAME2, Count: 2" -> parts. More than one part = multi-observation mistake (X). */
  function parseObs(raw) {
    const s = raw == null ? '' : String(raw).trim();
    if (!s) return { parts: [{ name: BLANK, n: 0 }], multi: false, raw: '' };
    let c = parseCache.get(s); if (c) return c;
    let segs = s.split(/Observations?:\s*/i).map(x => x.trim()).filter(Boolean); if (!segs.length) segs = [s];
    const parts = segs.map(t => { const m = t.match(/^(.*?)[,\s]*Count:\s*(\d+(?:\.\d+)?)/i); return m ? { name: m[1].trim() + ', Count:', n: +m[2] } : { name: t.replace(/[,\s]+$/, ''), n: 1 }; });
    c = { parts, multi: parts.length > 1, raw: s }; parseCache.set(s, c); return c;
  }
  const recObs = (ds, i) => parseObs(ds.rows[i][ds.map.observation]);
  const rawVal = (ds, k, i) => { if (!ds.has(k)) return ''; const v = ds.rows[i][ds.map[k]]; return v == null ? '' : String(v).trim(); };
  const URL_RE = /https?:\/\/[^\s,;"'<>]+/g;
  function photosOf(ds, i) { const s = rawVal(ds, 'images', i); if (!s) return { has: false, urls: [] }; const urls = s.match(URL_RE) || []; return { has: urls.length > 0 || s !== '0', urls }; }
  const pestText = m => Array.from(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => k + ' ' + v).join(' · ');
  const addPest = (m, ds, i) => { const p = rawVal(ds, 'targetPest', i) || '(No target pest)'; m.set(p, (m.get(p) || 0) + 1); };
  const hrs = ms => (ms / 3600000).toFixed(1);
  /** Hours in system = per day, first scan -> last scan of the team (summed over days). */
  function teamHours(ds, rows) {
    const m = new Map();
    for (const i of rows) { const t = ds.ts[i]; if (isNaN(t)) continue; const d = ds.day[i]; let o = m.get(d); if (!o) m.set(d, o = { day: d, first: t, last: t }); if (t < o.first) o.first = t; if (t > o.last) o.last = t; }
    const days = Array.from(m.values()).sort((a, b) => a.day - b.day); days.forEach(x => x.ms = x.last - x.first);
    const total = days.reduce((a, x) => a + x.ms, 0); return { days, total, avg: days.length ? total / days.length : 0 };
  }
  Obs.teamHours = teamHours;
  const EVENT_RE = (IPR.CONFIG.EVENT_PROGRAMS || [/PEST SURVEILLANCE/i]);
  const SITE_RE = (IPR.CONFIG.SITE_PROGRAMS || [/GOVERNMENT FACILITIES/i]);
  const isEventProg = p => EVENT_RE.some(r => r.test(p));
  const mins = ms => Math.round(ms / 60000);
  const dur = ms => { const m = mins(ms); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
  const hhmm = ms => isNaN(ms) ? '—' : U.isoTime(ms).slice(11, 16);
  const dayText = d => d >= 0 ? U.dayLong(d) : 'Date unavailable';

  /* ---------------------------- program sections (Overall / Area / Survey, screen + Excel) ---------------------------- */
  function buildSections(ds, rows, withTeam) {
    const pm = new Map();
    for (const i of rows) {
      const prog = lab(ds, 'program', i) || '(No program)';
      let s = pm.get(prog); if (!s) pm.set(prog, s = { program: prog, map: new Map(), hasEvent: isEventProg(prog), hasSite: SITE_RE.some(r => r.test(prog)), value: 0, inf: 0, count: 0 });
      const site = rawVal(ds, 'accountSite', i); if (site) s.hasSite = true;
      const ev = s.hasEvent ? rawVal(ds, 'event', i) : '';
      const area = lab(ds, 'area', i) || '—', sector = lab(ds, 'sector', i) || '—', team = withTeam ? (lab(ds, 'team', i) || '—') : '';
      const rec = recObs(ds, i), inf = ds.infested[i];
      for (const p of rec.parts) {
        const k = [area, sector, team, ev, site, p.name].join(SEP); let r = s.map.get(k);
        if (!r) s.map.set(k, r = { area, sector, team, event: ev, site, obs: p.name, value: 0, inf: 0, pests: new Map(), multi: 0 });
        r.value += p.n; if (inf) { r.inf++; addPest(r.pests, ds, i); } if (rec.multi) r.multi++;
      }
    }
    const nat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    const out = Array.from(pm.values()).map(s => { s.rows = Array.from(s.map.values()).sort((a, b) => nat(a.area, b.area) || nat(a.sector, b.sector) || nat(a.team, b.team) || nat(a.obs, b.obs)); delete s.map; s.rows.forEach(r => { s.value += r.value; s.inf += r.inf; }); return s; });
    return out.sort((a, b) => b.value - a.value || a.program.localeCompare(b.program));
  }
  function colsOf(s, withTeam) {
    const c = [{ k: 'area', h: 'AREA', w: 26 }, { k: 'sector', h: 'SECTOR', w: 20 }];
    if (withTeam) c.push({ k: 'team', h: 'TEAM', w: 14 });
    if (s.hasEvent) c.push({ k: 'event', h: 'EVENT', w: 36 });
    if (s.hasSite) c.push({ k: 'site', h: 'ACCOUNT SITE', w: 34 });
    c.push({ k: 'obs', h: 'OBSERVATION', w: 58 }, { k: 'value', h: 'VALUE COUNT', w: 14, num: 1 }, { k: 'inf', h: 'INFESTATION COUNT', w: 18, num: 1 }, { k: 'pest', h: 'INFESTED TARGET PEST', w: 36 });
    return c;
  }
  Obs.buildSections = buildSections;
  const SEC_CAP = 1500;
  function sectionHTML(s, si, withTeam, open) {
    return '<section class="psec"><button type="button" class="ptoggle" data-ps="' + si + '"><span class="pname">' + F.esc(s.program) + '</span><span class="pmeta">' + F.int(s.rows.length) + ' rows · Value Count <b>' + F.int(s.value) + '</b> · Infested <b class="' + (s.inf ? 'redtxt' : '') + '">' + F.int(s.inf) + '</b> <i>' + (open ? '⌃' : '⌄') + '</i></span></button><div class="pbody" id="ps' + si + '"' + (open ? '' : ' hidden') + '>' + (open ? sectionTable(s, withTeam) : '') + '</div></section>';
  }
  function sectionTable(s, withTeam) {
    const cols = colsOf(s, withTeam), shown = s.rows.slice(0, SEC_CAP);
    let h = '<div class="tablewrap short"><table class="mini obstable"><thead><tr>' + cols.map(c => '<th' + (c.num ? ' class="num"' : '') + '>' + c.h + '</th>').join('') + '</tr></thead><tbody>';
    for (const r of shown) {
      h += '<tr>' + cols.map(c => {
        if (c.k === 'team') return '<td><button class="teamlink" type="button" data-team="' + F.esc(r.team) + '">' + F.esc(r.team) + '</button></td>';
        if (c.k === 'obs') return '<td>' + F.esc(r.obs) + (r.multi ? ' <span class="xmark" title="' + r.multi + ' record(s) here had several observations in one cell — counted separately, flagged as a mistake">✖ ' + r.multi + '</span>' : '') + '</td>';
        if (c.k === 'value') return '<td class="num">' + F.int(r.value) + '</td>';
        if (c.k === 'inf') return '<td class="num">' + (r.inf ? '<b class="redtxt">' + F.int(r.inf) + '</b>' : '<span class="muted">0</span>') + '</td>';
        if (c.k === 'pest') return '<td>' + (r.inf ? F.esc(pestText(r.pests)) : '') + '</td>';
        return '<td>' + F.esc(r[c.k] || '') + '</td>';
      }).join('') + '</tr>';
    }
    const lead = cols.findIndex(c => c.k === 'value');
    h += '<tr class="grand"><td colspan="' + lead + '">Subtotal — ' + F.esc(s.program) + '</td><td class="num">' + F.int(s.value) + '</td><td class="num">' + F.int(s.inf) + '</td><td></td></tr></tbody></table></div>';
    if (s.rows.length > SEC_CAP) h += '<p class="csub">Showing the first ' + F.int(SEC_CAP) + ' of ' + F.int(s.rows.length) + ' rows — narrow with the main filters (the Excel export has every row).</p>';
    return h;
  }
  function renderSections(el, ds, rows, withTeam, head) {
    Obs.secs = buildSections(ds, rows, withTeam); Obs.secTeam = withTeam;
    el.innerHTML = head + (Obs.secs.length ? Obs.secs.map((s, i) => sectionHTML(s, i, withTeam, i === 0)).join('') : '<p class="muted">No records in the current selection.</p>');
  }

  /* ---------------------------- Report Style (per program: Area | Sector | Date × observation blocks) ---------------------------- */
  const dmy = d => { const x = new Date(d * 86400000); return x.getUTCDate() + '/' + (x.getUTCMonth() + 1) + '/' + x.getUTCFullYear(); };
  function buildReport(ds, rows) {
    const pm = new Map();
    for (const i of rows) {
      const prog = lab(ds, 'program', i) || '(No program)'; let P = pm.get(prog); if (!P) pm.set(prog, P = { label: prog, obs: new Set(), rows: new Map(), tot: new Map(), value: 0 });
      const area = lab(ds, 'area', i) || '—', sector = lab(ds, 'sector', i) || '—', k = area + SEP + sector; let R = P.rows.get(k); if (!R) P.rows.set(k, R = { area, sector, days: new Set(), cells: new Map() });
      if (ds.day[i] >= 0) R.days.add(ds.day[i]);
      for (const p of recObs(ds, i).parts) {
        const name = p.name.replace(/,\s*Count:\s*$/i, ''); P.obs.add(name);
        for (const m of [R.cells, P.tot]) { let c = m.get(name); if (!c) m.set(name, c = { value: 0, inf: 0, pests: new Map() }); c.value += p.n; if (ds.infested[i]) { c.inf++; addPest(c.pests, ds, i); } }
        P.value += p.n;
      }
    }
    return Array.from(pm.values()).map(P => ({ label: P.label, value: P.value, obs: Array.from(P.obs).sort(natc), tot: P.tot, rows: Array.from(P.rows.values()).sort((a, b) => natc(a.area, b.area) || natc(a.sector, b.sector)) })).sort((a, b) => b.value - a.value);
  }
  const datesOf = R => Array.from(R.days).sort((a, b) => a - b).map(dmy);
  function reportTable(P) {
    const cap = 1500, cell = (c, tot) => c ? '<td>' + F.int(c.value) + '</td><td class="rinf">' + (c.inf ? '<b>' + F.int(c.inf) + '</b>' : '') + '</td><td>' + (c.inf ? F.esc(pestText(c.pests)) : '') + '</td>' : '<td></td><td class="rinf"></td><td></td>';
    let h = '<div class="tablewrap rwrap"><table class="rtable"><thead><tr><th rowspan="2" class="rleft c1">Area Name</th><th rowspan="2" class="rleft c2">Sector</th><th rowspan="2" class="rleft c3">Date</th>' + P.obs.map(o => '<th colspan="3" class="rgrp">' + F.esc(o) + '</th>').join('') + '</tr><tr>' + P.obs.map(() => '<th class="rsub">VALUE COUNT</th><th class="rsub">INFESTATION COUNT</th><th class="rsub">INFESTED TARGET PEST</th>').join('') + '</tr></thead><tbody>';
    for (const R of P.rows.slice(0, cap)) h += '<tr><td class="c1">' + F.esc(R.area) + '</td><td class="c2">' + F.esc(R.sector) + '</td><td class="c3 rdate">' + datesOf(R).join('\n') + '</td>' + P.obs.map(o => cell(R.cells.get(o))).join('') + '</tr>';
    h += '<tr class="rtot"><td colspan="3" class="c1">TOTAL</td>' + P.obs.map(o => cell(P.tot.get(o))).join('') + '</tr></tbody></table></div>';
    return h + (P.rows.length > cap ? '<p class="csub">Showing the first ' + F.int(cap) + ' of ' + F.int(P.rows.length) + ' rows — the Excel export has all of them.</p>' : '');
  }
  function reportView(el, ds) {
    Obs.rep = buildReport(ds, Array.from(ds.idx));
    el.insertAdjacentHTML('beforeend', '<p class="csub">Per Program · one row per Area and Sector · dates scanned are stacked in the Date cell · each observation has VALUE COUNT | INFESTATION COUNT | INFESTED TARGET PEST</p>' + (Obs.rep.length ? Obs.rep.map((P, i) => '<section class="psec"><button type="button" class="ptoggle" data-rp="' + i + '"><span class="pname">' + F.esc(P.label) + '</span><span class="pmeta">' + P.rows.length + ' rows · ' + P.obs.length + ' observations · Value Count <b>' + F.int(P.value) + '</b> <i>' + (i === 0 ? '⌃' : '⌄') + '</i></span></button><div class="pbody" id="rp' + i + '"' + (i === 0 ? '' : ' hidden') + '>' + (i === 0 ? reportTable(P) : '') + '</div></section>').join('') : '<p class="muted">No records in the current selection.</p>'));
  }
  function overall(el, ds) {
    if (Obs.ovMode === 'report') { el.innerHTML = '<div class="snrow subtabs"><button type="button" data-ov="table">Overall Areas</button><button type="button" data-ov="report" class="on">Report Style</button></div>'; return reportView(el, ds); }
    overallTable(el, ds); el.insertAdjacentHTML('afterbegin', '<div class="snrow subtabs"><button type="button" data-ov="table" class="on">Overall Areas</button><button type="button" data-ov="report">Report Style</button></div>');
  }
  function overallTable(el, ds) {
    renderSections(el, ds, Array.from(ds.idx), false, '<div class="chead"><div><h3 class="ctitle">Overall Areas</h3><p class="csub">Separated by Program · Value Count = sum of the “Count” numbers · Infestation Count = infested records (not a sum)</p></div></div>');
  }
  function surveyRows(ds, g) { if (g.key !== 'S' || Obs.pick == null) return g.rows; const tg = teamGroups(ds), tc = ds.dims.team.codes; return g.rows.filter(i => tg[tc[i]].sn === Obs.pick); }
  function chips(g) {
    return '';
    let h = '<div class="snrow"><button type="button" data-sn="all" class="' + (Obs.pick == null ? 'on' : '') + '">All <b>' + F.int(g.rows.length) + '</b></button>';
    for (let n = 1; n <= g.max; n++) { const c = g.counts.get(n) || 0; h += '<button type="button" data-sn="' + n + '" class="' + (Obs.pick === n ? 'on' : '') + (c ? '' : ' zero') + '"' + (c ? '' : ' disabled title="No S' + n + ' records in the current selection"') + '>S' + n + ' <b>' + F.int(c) + '</b></button>'; }
    return h + '</div>';
  }

  /* ---------------------------- hierarchy: Program > Area > Team > Sector (time, gap, flags) > Observation ---------------------------- */
  const natc = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const newFl = () => ({ chem: 0, photo: 0, multi: 0 });
  const addFl = (a, b) => { a.chem += b.chem; a.photo += b.photo; a.multi += b.multi; };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  function buildHier(ds, rows) {
    const byProg = new Map();
    for (const i of rows) { const p = lab(ds, 'program', i) || '(No program)'; (byProg.get(p) || byProg.set(p, []).get(p)).push(i); }
    const progs = Array.from(byProg, ([prog, prs]) => {
      const P = { kind: 'program', label: prog, rows: prs, hoursMs: 0, hasEvent: isEventProg(prog), hasSite: SITE_RE.some(r => r.test(prog)), value: 0, inf: 0, fl: newFl(), areas: [] };
      const byArea = new Map(); prs.forEach(i => { const a = lab(ds, 'area', i) || '—'; (byArea.get(a) || byArea.set(a, []).get(a)).push(i); });
      Array.from(byArea.keys()).sort(natc).forEach(a => {
        const ar = byArea.get(a), A = { kind: 'area', label: a, rows: ar, hoursMs: 0, value: 0, inf: 0, fl: newFl(), teams: [] };
        const byTeam = new Map(); ar.forEach(i => { const t = lab(ds, 'team', i) || '—'; (byTeam.get(t) || byTeam.set(t, []).get(t)).push(i); });
        Array.from(byTeam.keys()).sort(natc).forEach(t => {
          const tr = byTeam.get(t), visits = buildVisits(ds, tr), bs = new Map(); visits.forEach(v => (bs.get(v.sector) || bs.set(v.sector, []).get(v.sector)).push(v));
          const T = { kind: 'team', label: t, rows: tr, hours: teamHours(ds, tr), value: 0, inf: 0, fl: newFl(), sectors: [] };
          Array.from(bs.keys()).sort(natc).forEach(sn => {
            const vs = bs.get(sn).sort((x, y) => x.day - y.day || x.first - y.first), om = new Map();
            const S = { kind: 'sector', label: sn, visits: vs, value: 0, inf: 0, pests: new Map(), time: 0, hasTime: false, fl: newFl(), obs: [] };
            let chem = 0, ph = 0; const op = vs[0].op;
            vs.forEach(v => {
              chem += v.chem; ph += v.photoRecs; S.fl.multi += v.multi.length;
              if (!isNaN(v.first)) { S.time += v.last - v.first; S.hasTime = true; }
              v.rows.forEach(i => { const ev = P.hasEvent ? rawVal(ds, 'event', i) : '', site = rawVal(ds, 'accountSite', i), rec = recObs(ds, i); if (site) P.hasSite = true;
                for (const p of rec.parts) { const k = [ev, site, p.name].join(SEP); let o = om.get(k); if (!o) om.set(k, o = { kind: 'obs', label: p.name, event: ev, site, value: 0, inf: 0, pests: new Map(), multi: 0 }); o.value += p.n; if (ds.infested[i]) { o.inf++; addPest(o.pests, ds, i); } if (rec.multi) o.multi++; } });
            });
            S.fl.chem = ds.has('materials') && op && chem === 0 ? 1 : 0; S.fl.photo = ds.has('images') && ph === 0 ? 1 : 0;
            S.obs = Array.from(om.values()).sort((x, y) => y.value - x.value || x.label.localeCompare(y.label));
            S.obs.forEach(o => { S.value += o.value; S.inf += o.inf; o.pests.forEach((c, k) => S.pests.set(k, (S.pests.get(k) || 0) + c)); });
            T.sectors.push(S); T.value += S.value; T.inf += S.inf; addFl(T.fl, S.fl);
          });
          A.teams.push(T); A.hoursMs += T.hours.total; A.value += T.value; A.inf += T.inf; addFl(A.fl, T.fl);
        });
        P.areas.push(A); P.hoursMs += A.hoursMs; P.value += A.value; P.inf += A.inf; addFl(P.fl, A.fl);
      });
      return P;
    });
    return progs.sort((a, b) => b.rows.length - a.rows.length || natc(a.label, b.label));
  }
  Obs.buildHier = buildHier;
  /** area / team / program summary: "2 sectors no photos · 5 sectors no chemical · 3 multi-observation records" */
  const flSummary = fl => [fl.photo && plural(fl.photo, 'sector') + ' no photos', fl.chem && plural(fl.chem, 'sector') + ' no chemical', fl.multi && plural(fl.multi, 'multi-observation record')].filter(Boolean);
  const flHTML = fl => flSummary(fl).map(t => '<span class="flag red">' + F.esc(t) + '</span>').join('');
  const secFlags = fl => [fl.chem && 'No chemical', fl.photo && 'No photos', fl.multi && '✖ ' + fl.multi + ' multi-observation'].filter(Boolean);
  const secFlHTML = fl => secFlags(fl).map(t => '<span class="flag red">' + F.esc(t) + '</span>').join('');
  const gapPlain = v => isNaN(v.gap) ? '' : (v.gap >= 0 ? dur(v.gap) + ' → ' + v.next : 'overlap ' + dur(-v.gap) + ' → ' + v.next);
  const timePlain = v => isNaN(v.first) ? '' : hhmm(v.first) + '–' + hhmm(v.last) + ' · ' + dur(v.last - v.first);
  const centre = (ds, rows) => { if (!ds.hasCoords) return null; let a = [], b = [], c = [], d = []; for (const i of rows) if (ds.validCoord[i]) { a.push(ds.lat[i]); b.push(ds.lng[i]); if (ds.infested[i]) { c.push(ds.lat[i]); d.push(ds.lng[i]); } } const la = c.length ? c : a, lo = c.length ? d : b; if (!la.length) return null; const m = x => x.reduce((s, v) => s + v, 0) / x.length; return [m(la), m(lo)]; };

  function progTableHTML(P, pi, canLink, ds) {
    const nx = (P.hasEvent ? 1 : 0) + (P.hasSite ? 1 : 0), pad = n => '<td></td>'.repeat(n), map = ds.hasCoords;
    const infc = n => n ? '<b class="redtxt">' + F.int(n) + '</b>' : '<span class="muted">0</span>';
    const mb = ref => map ? ' <button class="mapbtn" type="button" data-map="' + ref + '">🗺 Map</button>' : '';
    let h = '<div class="tablewrap short"><table class="mini obstable htable"><thead><tr><th>Area › Team › Sector › Observation</th>' + (P.hasEvent ? '<th>Event</th>' : '') + (P.hasSite ? '<th>Account Site</th>' : '') + '<th class="num">Value Count</th><th class="num">Infestation Count</th><th>Infested Target Pest</th><th class="num">Hours in system</th><th>Time in sector</th><th>Gap to next sector</th><th>Flags</th></tr></thead><tbody>';
    P.areas.forEach((A, ai) => {
      h += '<tr class="lv0"><td>' + F.esc(A.label) + mb(pi + '.' + ai) + '</td>' + pad(nx) + '<td class="num">' + F.int(A.value) + '</td><td class="num">' + infc(A.inf) + '</td><td></td><td></td><td></td><td></td><td>' + flHTML(A.fl) + '</td></tr>';
      A.teams.forEach((T, ti) => {
        h += '<tr class="lv1"><td>' + (canLink ? '<button class="teamlink" type="button" data-team="' + F.esc(T.label) + '" title="Open team details (photos, observations by date)">' + F.esc(T.label) + '</button>' : F.esc(T.label)) + '</td>' + pad(nx) + '<td class="num">' + F.int(T.value) + '</td><td class="num">' + infc(T.inf) + '</td><td></td><td class="num"><b>' + hrs(T.hours.total) + ' h</b></td><td></td><td></td><td>' + flHTML(T.fl) + '</td></tr>';
        for (const S of T.sectors) {
          h += '<tr class="lv2"><td>' + F.esc(S.label) + '</td>' + pad(nx) + '<td class="num">' + F.int(S.value) + '</td><td class="num">' + infc(S.inf) + '</td><td>' + (S.inf ? F.esc(pestText(S.pests)) : '') + '</td><td></td><td><b>' + (S.hasTime ? dur(S.time) : '—') + '</b></td><td></td><td>' + secFlHTML(S.fl) + '</td></tr>';
          for (const v of S.visits) h += '<tr class="vday"><td>' + dayText(v.day) + '</td>' + pad(nx) + '<td></td><td></td><td></td><td></td><td>' + (isNaN(v.first) ? '—' : hhmm(v.first) + '–' + hhmm(v.last) + ' · ' + dur(v.last - v.first)) + '</td><td>' + gapText(v) + '</td><td></td></tr>';
          for (const o of S.obs) h += '<tr class="lv3"><td>' + F.esc(o.label) + (o.multi ? ' <span class="xmark" title="' + o.multi + ' record(s) had several observations in one cell">✖ ' + o.multi + '</span>' : '') + '</td>' + (P.hasEvent ? '<td>' + F.esc(o.event) + '</td>' : '') + (P.hasSite ? '<td>' + F.esc(o.site) + '</td>' : '') + '<td class="num">' + F.int(o.value) + '</td><td class="num">' + infc(o.inf) + '</td><td>' + (o.inf ? F.esc(pestText(o.pests)) : '') + '</td><td></td><td></td><td></td><td></td></tr>';
        }
      });
    });
    return h + '</tbody></table></div>';
  }
  function pivot(el, ds, g) {
    const rows = g.rows, key = Obs.ver + '|' + g.key;
    if (Obs.hierKey !== key) { Obs.hier = buildHier(ds, rows); Obs.hierKey = key; }
    const hier = Obs.hier;
    el.innerHTML = '<div class="chead"><div><h3 class="ctitle">' + F.esc(g.label) + '</h3><p class="csub">' + F.int(rows.length) + ' records · Program › Area › Team › Sector (time in sector, gap to the next sector, flags) › Observation · 🗺 Map shows the geotags of an area or team · click a team name for photos and dates</p></div></div>' +
      (hier.length ? hier.map((P, pi) => '<section class="psec"><button type="button" class="ptoggle" data-pa="' + pi + '"><span class="pname">' + F.esc(P.label) + '</span><span class="pmeta">' + P.areas.length + ' area' + (P.areas.length === 1 ? '' : 's') + ' · Value Count <b>' + F.int(P.value) + '</b> · Infested <b class="' + (P.inf ? 'redtxt' : '') + '">' + F.int(P.inf) + '</b> ' + flHTML(P.fl) + ' <i>' + (pi === 0 ? '⌃' : '⌄') + '</i></span></button><div class="pbody" id="pa' + pi + '"' + (pi === 0 ? '' : ' hidden') + '>' + (pi === 0 ? progTableHTML(P, pi, true, ds) : '') + '</div></section>').join('') : '<p class="muted">No records in the current selection.</p>');
  }

  /* ---------------------------- geotag map popup (per program › area / team) ---------------------------- */
  const OM = { map: null, layer: null };
  const BASE = { dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', light: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', street: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' };
  function openMap(ds, rows, title) {
    let m = document.getElementById('obsMap');
    if (!m) {
      m = document.createElement('div'); m.id = 'obsMap'; m.className = 'modal'; m.hidden = true;
      m.innerHTML = '<div class="modalbox mapbox"><div class="mhead"><h3 id="omTitle"></h3><button type="button" class="btn ghost small" id="omClose">✕ Close</button></div><div class="mctl"><label>Map <select id="omBase"><option value="dark">Dark</option><option value="light">Light</option><option value="street">Street</option><option value="sat">Satellite</option></select></label><label>View <select id="omMode"><option value="pts">Points</option><option value="hi">Heatmap — inspections</option><option value="hf">Heatmap — infestations</option></select></label><label id="omPl"><input type="checkbox" id="omInsp" checked> <span class="dot t"></span> Inspections</label><label id="omPf"><input type="checkbox" id="omInf" checked> <span class="dot r"></span> Infestations</label><span id="omStat" class="csub"></span></div><div id="omMap"></div></div>';
      document.body.appendChild(m);
      m.onclick = e => { if (e.target === m || e.target.id === 'omClose') m.hidden = true; };
    }
    m.hidden = false; m.querySelector('#omTitle').textContent = title;
    const pts = rows.filter(i => ds.validCoord[i]), nInf = pts.filter(i => ds.infested[i]).length;
    m.querySelector('#omStat').textContent = F.int(rows.length) + ' records · ' + F.int(pts.length) + ' with geotag · ' + F.int(nInf) + ' infested' + (rows.length - pts.length ? ' · ' + F.int(rows.length - pts.length) + ' without valid coordinates' : '');
    if (!OM.map) { OM.map = L.map('omMap', { preferCanvas: true }); OM.base = L.tileLayer(BASE.dark, { attribution: 'Tiles © Esri', maxZoom: 19 }).addTo(OM.map); OM.canvas = L.canvas({ padding: .5 }); }
    const draw = () => {
      if (OM.layer) OM.layer.remove(); OM.layer = L.layerGroup().addTo(OM.map);
      const mode = m.querySelector('#omMode').value; m.querySelector('#omPl').hidden = m.querySelector('#omPf').hidden = mode !== 'pts';
      if (mode !== 'pts') { const hp = pts.filter(i => mode === 'hf' ? ds.infested[i] : true).map(i => [ds.lat[i], ds.lng[i], mode === 'hf' ? 1 : .6]); if (hp.length && L.heatLayer) L.heatLayer(hp, { radius: mode === 'hf' ? 22 : 14, blur: 18, maxZoom: 17, gradient: mode === 'hf' ? { .3: '#FFD166', .6: '#FF8A3D', 1: '#FF3B30' } : { .25: '#1CC8D8', .55: '#27D17F', .8: '#FFD166', 1: '#FF3B30' } }).addTo(OM.layer); return; }
      const showI = m.querySelector('#omInsp').checked, showF = m.querySelector('#omInf').checked, tip = i => { const sec = lab(ds, 'sector', i) || '', t = lab(ds, 'team', i) || ''; return '<b>' + (ds.infested[i] ? 'Infested' : 'Inspected') + '</b><br>' + F.esc(t) + (sec ? ' · ' + F.esc(sec) : '') + '<br>' + F.esc(U.isoTime(ds.ts[i]).replace('T', ' ').slice(0, 16)) + (ds.infested[i] ? '<br>' + F.esc(rawVal(ds, 'targetPest', i) || '') : '') + '<br>' + F.esc(recObs(ds, i).parts.map(p => p.name).join(' + ')); };
      if (showI) for (const i of pts) if (!ds.infested[i]) L.circleMarker([ds.lat[i], ds.lng[i]], { renderer: OM.canvas, radius: 3, weight: 0, fillColor: '#1CC8D8', fillOpacity: .55 }).bindPopup(() => tip(i)).addTo(OM.layer);
      if (showF) for (const i of pts) if (ds.infested[i]) L.circleMarker([ds.lat[i], ds.lng[i]], { renderer: OM.canvas, radius: 6, weight: 1.5, color: '#fff', fillColor: '#FF4D3D', fillOpacity: .95 }).bindPopup(() => tip(i)).addTo(OM.layer);
    };
    m.querySelector('#omInsp').onchange = m.querySelector('#omInf').onchange = m.querySelector('#omMode').onchange = draw;
    m.querySelector('#omBase').onchange = e => { OM.base.remove(); OM.base = L.tileLayer(BASE[e.target.value], { attribution: 'Tiles © Esri', maxZoom: 19 }).addTo(OM.map); OM.base.bringToBack(); };
    setTimeout(() => { OM.map.invalidateSize(); draw(); if (pts.length) OM.map.fitBounds(L.latLngBounds(pts.map(i => [ds.lat[i], ds.lng[i]])).pad(.1), { maxZoom: 17 }); else OM.map.setView([24.45, 54.4], 9); }, 50);
  }
  const nodeAt = ref => { const p = ref.split('.').map(Number); let n = Obs.hier[p[0]]; const path = [n.label]; if (p.length > 1) { n = n.areas[p[1]]; path.push(n.label); } if (p.length > 2) { n = n.teams[p[2]]; path.push(n.label); } return { n, title: path.join(' › ') }; };

  /* ---------------------------- ALL FLAGS tab ---------------------------- */
  const pc = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';
  const FCOL = { chem: '#FF6B3D', photo: '#F5B942', multi: '#8E7CFF' };
  function mkChart(el, id, cfg) { const c = new Chart(el.querySelector('#' + id), cfg); (Obs.charts = Obs.charts || []).push(c); return c; }
  function flagsView(el, ds) {
    const bar = '<div class="snrow subtabs"><button type="button" data-fm="list" class="' + (Obs.flMode !== 'overview' ? 'on' : '') + '">Flag list</button><button type="button" data-fm="overview" class="' + (Obs.flMode === 'overview' ? 'on' : '') + '">Overview flags</button></div>';
    if (Obs.flMode === 'overview') { flagOverview(el, ds); el.insertAdjacentHTML('afterbegin', bar); } else { flagList(el, ds); el.insertAdjacentHTML('afterbegin', bar); }
  }
  function flagOverview(el, ds) {
    buildFlags(ds); const st = Obs.flagStats, T = st.total, U2 = IPR.UI;
    const rowsOf = m => Array.from(m, ([k, o]) => ({ k, ...o, tot: o.chem + o.photo + o.multi }));
    const teams = rowsOf(st.teams).sort((a, b) => b.tot - a.tot).slice(0, 20), areas = rowsOf(st.areas).sort((a, b) => b.tot - a.tot).slice(0, 20), groups = rowsOf(st.groups), days = rowsOf(st.days).filter(x => x.k >= 0).sort((a, b) => a.k - b.k);
    const worst = rowsOf(st.teams).filter(x => x.visits >= 5).sort((a, b) => b.flagged / b.visits - a.flagged / a.visits).slice(0, 15);
    const kp = (l, v, sub, c) => '<div class="ovc"><span>' + l + '</span><b style="color:' + c + '">' + v + '</b><small>' + sub + '</small></div>';
    el.innerHTML = '<div class="chead"><div><h3 class="ctitle">Overview flags</h3><p class="csub">How often the flags happen — rates use sector visits (a team, a sector, a day) as the base; Multi-observation uses records. “No chemical” excludes Survey and Aedes Aegypti teams.</p></div></div>' +
      '<div class="ovk">' + kp('Sector visits checked', F.int(T.visits), F.int(T.records) + ' records', '#fff') + kp('Visits with at least one flag', pc(T.flagged, T.visits), F.int(T.flagged) + ' visits', '#FF8A8A') + kp('No chemical', pc(T.chem, T.elig), F.int(T.chem) + ' of ' + F.int(T.elig) + ' operation visits', FCOL.chem) + kp('No photos', pc(T.photo, T.visits), F.int(T.photo) + ' visits', FCOL.photo) + kp('Multi-observation', pc(T.multi, T.records), F.int(T.multi) + ' of ' + F.int(T.records) + ' records', FCOL.multi) + '</div>' +
      '<div class="ovgrid"><div class="card ovcard"><h4>Flags by type</h4><div class="ovbox"><canvas id="ovType"></canvas></div></div><div class="card ovcard"><h4>Mistake rate by group (%)</h4><div class="ovbox"><canvas id="ovGroup"></canvas></div></div>' +
      '<div class="card ovcard wide"><h4>Flags per team — top 20</h4><div class="ovbox tall"><canvas id="ovTeam"></canvas></div></div><div class="card ovcard wide"><h4>Flags per area — top 20</h4><div class="ovbox tall"><canvas id="ovArea"></canvas></div></div><div class="card ovcard wide"><h4>Flags per day</h4><div class="ovbox"><canvas id="ovDay"></canvas></div></div></div>' +
      '<h4 class="ovh">Mistake rate by group</h4><div class="tablewrap"><table class="mini obstable"><thead><tr><th>Group</th><th class="num">Sector visits</th><th class="num">Visits with a flag</th><th class="num">% with a flag</th><th class="num">No chemical %</th><th class="num">No photos %</th><th class="num">Multi-observation %</th></tr></thead><tbody>' + groups.map(x => '<tr><td>' + F.esc(x.k) + '</td><td class="num">' + F.int(x.visits) + '</td><td class="num">' + F.int(x.flagged) + '</td><td class="num"><b>' + pc(x.flagged, x.visits) + '</b></td><td class="num">' + pc(x.chem, x.elig) + '</td><td class="num">' + pc(x.photo, x.visits) + '</td><td class="num">' + pc(x.multi, x.records) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<h4 class="ovh">Teams with the highest mistake rate <small>(at least 5 sector visits)</small></h4><div class="tablewrap"><table class="mini obstable"><thead><tr><th>Team</th><th class="num">Sector visits</th><th class="num">% with a flag</th><th class="num">No chemical</th><th class="num">No photos</th><th class="num">Multi-observation</th></tr></thead><tbody>' + worst.map(x => '<tr><td>' + F.esc(x.k) + '</td><td class="num">' + F.int(x.visits) + '</td><td class="num"><b class="redtxt">' + pc(x.flagged, x.visits) + '</b></td><td class="num">' + F.int(x.chem) + '</td><td class="num">' + F.int(x.photo) + '</td><td class="num">' + F.int(x.multi) + '</td></tr>').join('') + '</tbody></table></div>';
    const ax = { ticks: { color: U2.muted }, grid: { color: U2.grid } }, leg = { labels: { color: U2.ink, boxWidth: 12 } };
    const short = t => String(t).length > 30 ? String(t).slice(0, 29) + '…' : String(t);
    const stack = (rows, id, horiz) => mkChart(el, id, { type: 'bar', data: { labels: rows.map(x => short(x.k instanceof Number || typeof x.k === 'number' ? dayText(x.k) : x.k)), datasets: [{ label: 'No chemical', data: rows.map(x => x.chem), backgroundColor: FCOL.chem }, { label: 'No photos', data: rows.map(x => x.photo), backgroundColor: FCOL.photo }, { label: 'Multi-observation', data: rows.map(x => x.multi), backgroundColor: FCOL.multi }] }, options: { indexAxis: horiz ? 'y' : 'x', responsive: true, maintainAspectRatio: false, plugins: { legend: leg }, scales: { x: { ...ax, stacked: true }, y: { ...ax, stacked: true } } } });
    mkChart(el, 'ovType', { type: 'doughnut', data: { labels: ['No chemical', 'No photos', 'Multi-observation'], datasets: [{ data: [T.chem, T.photo, T.multi], backgroundColor: [FCOL.chem, FCOL.photo, FCOL.multi], borderColor: '#0A2342' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: leg } } });
    const rate = (a, b) => b ? +(100 * a / b).toFixed(1) : 0;
    mkChart(el, 'ovGroup', { type: 'bar', data: { labels: groups.map(x => x.k), datasets: [{ label: 'No chemical %', data: groups.map(x => rate(x.chem, x.elig)), backgroundColor: FCOL.chem }, { label: 'No photos %', data: groups.map(x => rate(x.photo, x.visits)), backgroundColor: FCOL.photo }, { label: 'Multi-observation %', data: groups.map(x => rate(x.multi, x.records)), backgroundColor: FCOL.multi }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: leg }, scales: { x: ax, y: { ...ax, beginAtZero: true, ticks: { color: U2.muted, callback: v => v + '%' } } } } });
    stack(teams, 'ovTeam', true); stack(areas, 'ovArea', true);
    mkChart(el, 'ovDay', { type: 'bar', data: { labels: days.map(x => U.dayLabel ? U.dayLabel(x.k) : dayText(x.k)), datasets: [{ label: 'No chemical', data: days.map(x => x.chem), backgroundColor: FCOL.chem }, { label: 'No photos', data: days.map(x => x.photo), backgroundColor: FCOL.photo }, { label: 'Multi-observation', data: days.map(x => x.multi), backgroundColor: FCOL.multi }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: leg }, scales: { x: { ...ax, stacked: true }, y: { ...ax, stacked: true } } } });
  }
  const FLAG_TYPES = ['No chemical', 'No photos', 'Multi-observation'];
  function buildFlags(ds) {
    if (Obs.flagVer === Obs.ver + '|' + IPR.Filters.version && Obs.flagList) return Obs.flagList;
    const out = [], groups = compute(ds), hasMat = ds.has('materials');
    const mkst = () => ({ visits: 0, elig: 0, records: 0, chem: 0, photo: 0, multi: 0, flagged: 0 });
    const st = { total: mkst(), groups: new Map(), teams: new Map(), areas: new Map(), days: new Map() };
    const bump = (m, key, v) => { let o = m.get(key); if (!o) m.set(key, o = mkst()); o.visits++; if (hasMat && v.op) o.elig++; o.records += v.rows.length; if (v.noChem) o.chem++; if (v.noPhoto) o.photo++; o.multi += v.multi.length; if (v.noChem || v.noPhoto || v.multi.length) o.flagged++; };
    for (const g of groups) {
      const gl = g.label.replace(/ ·.*/, '');
      for (const v of buildVisits(ds, g.rows)) {
        const ar0 = lab(ds, 'area', v.rows[0]) || '—'; bump(st.groups, gl, v); bump(st.teams, v.team, v); bump(st.areas, ar0, v); bump(st.days, v.day, v); bump({ get: () => st.total, set: () => {} }, 'x', v);
        const base = { gkey: g.key, group: gl, area: lab(ds, 'area', v.rows[0]) || '—', team: v.team, day: v.day, sector: v.sector, time: timePlain(v) };
        if (v.noChem) out.push({ ...base, type: 'No chemical', detail: 'No Materials in any of ' + v.rows.length + ' records' });
        if (v.noPhoto) out.push({ ...base, type: 'No photos', detail: 'No Images in any of ' + v.rows.length + ' records' });
        for (const i of v.multi) out.push({ ...base, time: hhmm(ds.ts[i]), type: 'Multi-observation', detail: recObs(ds, i).raw.replace(/\s*\n\s*/g, '  |  ') });
      }
    }
    out.sort((a, b) => natc(a.team, b.team) || a.day - b.day || natc(a.sector, b.sector));
    Obs.flagStats = st; Obs.flagList = out; Obs.flagVer = Obs.ver + '|' + IPR.Filters.version; return out;
  }
  Obs.buildFlags = buildFlags;
  function flagList(el, ds) {
    const all = buildFlags(ds); if (!Obs.flagOff) Obs.flagOff = new Set();
    const cnt = {}; all.forEach(f => cnt[f.type] = (cnt[f.type] || 0) + 1);
    const rows = all.filter(f => !Obs.flagOff.has(f.type)), CAP = 3000;
    el.innerHTML = '<div class="chead"><div><h3 class="ctitle">All flags</h3><p class="csub">Every flag across Area 1–5, Survey and other teams for the current filters · tick a type to show or hide it · click a team to open its details</p></div></div><div class="snrow">' +
      FLAG_TYPES.map(t => '<button type="button" data-ft="' + t + '" class="' + (Obs.flagOff.has(t) ? '' : 'on') + (cnt[t] ? '' : ' zero') + '">' + t + ' <b>' + F.int(cnt[t] || 0) + '</b></button>').join('') + '</div>' +
      '<div class="tablewrap short"><table class="mini obstable"><thead><tr><th>Group</th><th>Area</th><th>Team</th><th>Date</th><th>Sector</th><th>Flag</th><th>Time</th><th>Detail</th></tr></thead><tbody>' +
      (rows.slice(0, CAP).map(f => '<tr><td>' + F.esc(f.group) + '</td><td>' + F.esc(f.area) + '</td><td><button class="teamlink" type="button" data-fl="' + F.esc(f.gkey) + '" data-team="' + F.esc(f.team) + '">' + F.esc(f.team) + '</button></td><td>' + F.esc(dayText(f.day)) + '</td><td>' + F.esc(f.sector) + '</td><td><span class="flag red">' + F.esc(f.type) + '</span></td><td>' + F.esc(f.time) + '</td><td>' + F.esc(f.detail) + '</td></tr>').join('') || '<tr><td colspan="8" class="emptyrow">No flags.</td></tr>') + '</tbody></table></div>' +
      (rows.length > CAP ? '<p class="csub">Showing the first ' + F.int(CAP) + ' of ' + F.int(rows.length) + ' — the Excel export has all of them.</p>' : '<p class="csub">' + F.int(rows.length) + ' flag' + (rows.length === 1 ? '' : 's') + '</p>');
  }

  /* ---------------------------- sector visits (timing, chemicals, photos, mistakes) ---------------------------- */
  function buildVisits(ds, rows) {
    const hasMat = ds.has('materials'), hasImg = ds.has('images'), tcode = ds.dims.team.codes, m = new Map(), out = [];
    for (const i of rows) { const k = tcode[i] + '|' + ds.day[i]; (m.get(k) || m.set(k, []).get(k)).push(i); }
    for (const list of m.values()) {
      const byS = new Map();
      for (const i of list) {
        const s = lab(ds, 'sector', i) || '(No sector)';
        let v = byS.get(s); if (!v) byS.set(s, v = { team: lab(ds, 'team', i), day: ds.day[i], sector: s, first: NaN, last: NaN, rows: [], inf: 0, pests: new Map(), chem: 0, photos: [], photoRecs: 0, multi: [], op: ds.teamType[i] === 0 && !/aedes/i.test(lab(ds, 'team', i) || ''), gap: NaN, next: '' });
        v.rows.push(i); const t = ds.ts[i]; if (!isNaN(t)) { if (isNaN(v.first) || t < v.first) v.first = t; if (isNaN(v.last) || t > v.last) v.last = t; }
        if (ds.infested[i]) { v.inf++; addPest(v.pests, ds, i); }
        if (hasMat && rawVal(ds, 'materials', i)) v.chem++;
        if (hasImg) { const p = photosOf(ds, i); if (p.has) v.photoRecs++; for (const u of p.urls) v.photos.push({ url: u, i }); }
        if (recObs(ds, i).multi) v.multi.push(i);
      }
      const arr = Array.from(byS.values()).sort((a, b) => (isNaN(a.first) ? 1e18 : a.first) - (isNaN(b.first) ? 1e18 : b.first));
      const timed = list.filter(i => !isNaN(ds.ts[i])).sort((a, b) => ds.ts[a] - ds.ts[b]);
      arr.forEach(v => {
        if (!isNaN(v.last)) { let lo = 0, hi = timed.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (ds.ts[timed[mid]] <= v.last) lo = mid + 1; else hi = mid; }
          for (let k = lo; k < timed.length; k++) { const sc = lab(ds, 'sector', timed[k]) || '(No sector)'; if (sc !== v.sector) { v.gap = ds.ts[timed[k]] - v.last; v.next = sc; break; } } }
        v.noChem = hasMat && v.op && v.chem === 0; v.noPhoto = hasImg && v.photoRecs === 0; });
      out.push(...arr);
    }
    return out;
  }
  const flagChips = v => (v.noChem ? '<span class="flag red">No chemical</span>' : '') + (v.noPhoto ? '<span class="flag red">No photos</span>' : '') + (v.multi.length ? '<span class="flag red">✖ ' + v.multi.length + ' multi-observation</span>' : '');
  const gapText = v => isNaN(v.gap) ? '<span class="muted">—</span>' : (v.gap >= 0 ? '<b>' + dur(v.gap) + '</b> → ' + F.esc(v.next) : '<span class="redtxt">overlap ' + dur(-v.gap) + '</span> → ' + F.esc(v.next));

  function teamDetail(el, ds, g, teamName) {
    const rows = g.rows.filter(i => lab(ds, 'team', i) === teamName);
    const visits = buildVisits(ds, rows), bySector = new Map();
    visits.forEach(v => (bySector.get(v.sector) || bySector.set(v.sector, []).get(v.sector)).push(v));
    const sectors = Array.from(bySector.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const areas = Array.from(new Set(rows.map(i => lab(ds, 'area', i) || BLANK))).sort();
    const hasImg = ds.has('images'), hasMat = ds.has('materials');
    let h = '<div class="detailhead"><div><span class="eyebrow">Team account details</span><h3 class="ctitle big">' + F.esc(teamName) + '</h3><p class="csub">' + sectors.length + ' sector' + (sectors.length === 1 ? '' : 's') + ' · ' + F.int(rows.length) + ' team records · ' + F.esc(areas.join(', ')) + '</p></div><div class="dbtns">' + (ds.hasCoords ? '<button class="btn small" type="button" data-mapteam="1">🗺 Map</button>' : '') + '<button class="btn ghost small" type="button" data-back="1">← Back to teams</button></div></div>';
    Obs.teamRows = rows; Obs.teamTitle = g.label + ' › ' + teamName;
    const th = teamHours(ds, rows);
    h += '<div class="sinfo hoursbox"><span>Hours in system: <b>' + hrs(th.total) + ' h</b> over ' + th.days.length + ' day' + (th.days.length === 1 ? '' : 's') + ' · average <b>' + hrs(th.avg) + ' h/day</b> <small>(first scan → last scan of each day)</small></span></div><details class="photos"><summary>Hours per day</summary><table class="mini obstable"><thead><tr><th>Date</th><th>First scan</th><th>Last scan</th><th class="num">Hours</th></tr></thead><tbody>' + th.days.map(x => '<tr><td>' + dayText(x.day) + '</td><td>' + hhmm(x.first) + '</td><td>' + hhmm(x.last) + '</td><td class="num">' + hrs(x.ms) + '</td></tr>').join('') + '</tbody></table></details>';
    sectors.forEach((s, si) => {
      const vs = bySector.get(s).sort((a, b) => a.day - b.day || a.first - b.first), srows = [].concat(...vs.map(v => v.rows));
      const agg = { inf: 0, pests: new Map(), chem: 0, photoRecs: 0, photos: [], multi: [], op: vs[0].op };
      vs.forEach(v => { agg.inf += v.inf; v.pests.forEach((c, k) => agg.pests.set(k, (agg.pests.get(k) || 0) + c)); agg.chem += v.chem; agg.photoRecs += v.photoRecs; agg.photos.push(...v.photos); agg.multi.push(...v.multi); });
      agg.noChem = hasMat && agg.op && agg.chem === 0; agg.noPhoto = hasImg && agg.photoRecs === 0;
      let val = 0; const om = new Map();
      srows.forEach(i => { for (const p of recObs(ds, i).parts) { val += p.n; let o = om.get(p.name); if (!o) om.set(p.name, o = { name: p.name, value: 0, rows: [] }); o.value += p.n; o.rows.push(i); } });
      const items = Array.from(om.values()).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
      h += '<section class="sectorcard' + (agg.noChem || agg.noPhoto || agg.multi.length ? ' warn' : '') + '"><div class="sechead2"><span class="eyebrow">SECTOR ' + (si + 1) + '</span><span class="chipx">' + F.esc(s) + '</span>' + flagChips(agg) + '<span class="sectotal">' + F.int(val) + ' <small>value count</small></span></div>';
      h += '<div class="sinfo"><span>Infested: ' + (agg.inf ? '<b class="redtxt">' + F.int(agg.inf) + '</b> · ' + F.esc(pestText(agg.pests)) : '<b>0</b>') + '</span>' + (hasMat ? '<span>Records with chemical: <b>' + F.int(agg.chem) + '</b></span>' : '') + (hasImg ? '<span>Records with photos: <b>' + F.int(agg.photoRecs) + '</b></span>' : '') + '</div>';
      h += '<div class="tablewrap"><table class="mini obstable vtable"><thead><tr><th>Date</th><th>First scan</th><th>Last scan</th><th>Time in sector</th><th class="num">Records</th><th class="num">Infested</th><th>Gap to next sector</th><th>Flags</th></tr></thead><tbody>' +
        vs.map(v => '<tr><td>' + dayText(v.day) + '</td><td>' + hhmm(v.first) + '</td><td>' + hhmm(v.last) + '</td><td>' + (isNaN(v.first) ? '—' : dur(v.last - v.first)) + '</td><td class="num">' + F.int(v.rows.length) + '</td><td class="num">' + F.int(v.inf) + '</td><td>' + gapText(v) + '</td><td>' + (flagChips(v) || '<span class="muted">OK</span>') + '</td></tr>').join('') + '</tbody></table></div>';
      if (hasImg && agg.photos.length) {
        const seen = new Set(), ph = agg.photos.filter(p => !seen.has(p.url) && seen.add(p.url));
        h += '<details class="photos"><summary>📷 ' + F.int(ph.length) + ' photo' + (ph.length === 1 ? '' : 's') + ' (click to open the compiled list)</summary><div class="phgrid">' + ph.slice(0, 300).map((p, k) => '<a class="ph" href="' + F.esc(p.url) + '" target="_blank" rel="noopener" title="' + F.esc(hhmm(ds.ts[p.i])) + '"><img loading="lazy" referrerpolicy="no-referrer" src="' + F.esc(p.url) + '" alt=""><span>Photo ' + (k + 1) + ' · ' + hhmm(ds.ts[p.i]) + '</span></a>').join('') + '</div>' + (ph.length > 300 ? '<p class="csub">First 300 shown — the Excel export lists all.</p>' : '') + '</details>';
      }
      if (agg.multi.length) h += '<details class="photos multi" open><summary class="redtxt">✖ ' + agg.multi.length + ' record(s) with several observations in one cell (mistake)</summary><ul class="mlist">' + agg.multi.slice(0, 50).map(i => '<li><b>' + hhmm(ds.ts[i]) + '</b> ' + recObs(ds, i).parts.map(p => F.esc(p.name + ' ' + p.n)).join(' <i>+</i> ') + '</li>').join('') + '</ul></details>';
      h += '<div class="obsgrid">';
      items.forEach((o, oi) => {
        const dm = new Map(); o.rows.forEach(i => { const d = ds.day[i] >= 0 ? ds.day[i] : -1; (dm.get(d) || dm.set(d, []).get(d)).push(i); });
        const dates = Array.from(dm).sort((a, b) => b[0] - a[0]);
        h += '<div class="obscard"><button type="button" class="obstoggle" data-tg="o' + si + '_' + oi + '"><span>' + F.esc(o.name) + '</span><b>' + F.int(o.value) + '</b></button><div class="obsdates" id="o' + si + '_' + oi + '" hidden>';
        dates.forEach(([d, items2], di) => {
          const tc = new Map(); items2.forEach(i => { if (!isNaN(ds.ts[i])) { const t = hhmm(ds.ts[i]); tc.set(t, (tc.get(t) || 0) + 1); } });
          h += '<div class="daterow"><button type="button" class="datetoggle" data-tg="d' + si + '_' + oi + '_' + di + '"><span>' + dayText(d) + '</span><span>' + F.int(items2.length) + ' records ⌄</span></button><div class="datetimes" id="d' + si + '_' + oi + '_' + di + '" hidden>' +
            (tc.size ? Array.from(tc).sort((a, b) => a[0].localeCompare(b[0])).map(([t, c]) => '<div class="timeline"><span>' + t + '</span><b>' + c + '</b></div>').join('') : '<div class="timeline"><span>Scanned time unavailable</span><b>' + items2.length + '</b></div>') + '</div></div>';
        });
        h += '</div></div>';
      });
      h += '</div></section>';
    });
    el.innerHTML = h;
  }

  function body(ds) {
    (Obs.charts || []).forEach(c => c.destroy()); Obs.charts = [];
    const el = Obs.host.querySelector('#obsBody'), groups = compute(ds);
    if (Obs.sub === 'overall') return overall(el, ds);
    if (Obs.sub === 'flags') return flagsView(el, ds);
    const g = groups.find(x => x.key === Obs.sub); if (!g) { el.innerHTML = '<p class="muted">No records for this group in the current selection.</p>'; return; }
    if (Obs.team != null) return teamDetail(el, ds, g, Obs.team);
    pivot(el, ds, g);
  }
  function onBodyClick(e, ds) {
    const fl = e.target.closest('[data-fl]'); if (fl) { Obs.sub = fl.dataset.fl; Obs.team = fl.dataset.team; Obs.pick = null; return Obs.render(Obs.host, ds); }
    const sn = e.target.closest('[data-sn]'); if (sn && !sn.disabled) { Obs.pick = sn.dataset.sn === 'all' ? null : +sn.dataset.sn; return body(ds); }
    const t = e.target.closest('[data-team]'); if (t) { Obs.team = t.dataset.team; return body(ds); }
    if (e.target.closest('[data-back]')) { Obs.team = null; return body(ds); }
    if (e.target.closest('[data-mapteam]')) return openMap(ds, Obs.teamRows, Obs.teamTitle);
    const ov = e.target.closest('[data-ov]'); if (ov) { Obs.ovMode = ov.dataset.ov; return body(ds); }
    const fm = e.target.closest('[data-fm]'); if (fm) { Obs.flMode = fm.dataset.fm; return body(ds); }
    const rp = e.target.closest('[data-rp]'); if (rp) { const ri = +rp.dataset.rp, bx = Obs.host.querySelector('#rp' + ri); if (!bx.innerHTML) bx.innerHTML = reportTable(Obs.rep[ri]); bx.hidden = !bx.hidden; const ic = rp.querySelector('i'); if (ic) ic.textContent = bx.hidden ? '⌄' : '⌃'; return; }
    const mp = e.target.closest('[data-map]'); if (mp) { const r = nodeAt(mp.dataset.map); return openMap(ds, r.n.rows, r.title); }
    const ft = e.target.closest('[data-ft]'); if (ft) { if (!Obs.flagOff) Obs.flagOff = new Set(); const k = ft.dataset.ft; Obs.flagOff.has(k) ? Obs.flagOff.delete(k) : Obs.flagOff.add(k); return body(ds); }
    const pa = e.target.closest('[data-pa]'); if (pa) {
      const ai = +pa.dataset.pa, box = Obs.host.querySelector('#pa' + ai); if (!box.innerHTML) box.innerHTML = progTableHTML(Obs.hier[ai], ai, true, ds);
      box.hidden = !box.hidden; const ic = pa.querySelector('i'); if (ic) ic.textContent = box.hidden ? '⌄' : '⌃'; return;
    }
    const ps = e.target.closest('[data-ps]'); if (ps) {
      const si = +ps.dataset.ps, box = Obs.host.querySelector('#ps' + si); if (!box.innerHTML) box.innerHTML = sectionTable(Obs.secs[si], Obs.secTeam);
      box.hidden = !box.hidden; const ic = ps.querySelector('i'); if (ic) ic.textContent = box.hidden ? '⌄' : '⌃'; return;
    }
    const g = e.target.closest('[data-tg]'); if (g) { const x = Obs.host.querySelector('#' + g.dataset.tg); if (x) x.hidden = !x.hidden; }
  }

  /* ---------------------------- Excel export ---------------------------- */
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const RED = { font: { bold: true, color: { argb: 'FFB3261E' } }, fill: fill('FFFDE7E5') };
  function styleHeader(row) { row.height = 22; row.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }; c.fill = fill('FF1C477F'); c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }; }); }
  function sectionsSheet(wb, ds, name, rows, withTeam, title) {
    const ws = wb.addWorksheet(name.slice(0, 31)), secs = buildSections(ds, rows, withTeam), widths = [];
    ws.getCell('A1').value = title; ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF183B68' } };
    let r = 3;
    for (const s of secs) {
      const cols = colsOf(s, withTeam);
      const t = ws.getRow(r++); t.getCell(1).value = s.program + '  —  ' + s.rows.length + ' rows'; t.eachCell(c => { c.font = { bold: true, size: 12, color: { argb: 'FF173B70' } }; }); for (let k = 1; k <= cols.length; k++) t.getCell(k).fill = fill('FFE8EEF7');
      const hr = ws.getRow(r++); cols.forEach((c, k) => { hr.getCell(k + 1).value = c.h; widths[k] = Math.max(widths[k] || 0, c.w); }); styleHeader(hr);
      for (const x of s.rows) {
        const row = ws.getRow(r++);
        cols.forEach((c, k) => { const cell = row.getCell(k + 1); cell.value = c.k === 'pest' ? (x.inf ? pestText(x.pests) : '') : (c.k === 'value' || c.k === 'inf' ? x[c.k] : (x[c.k] || '')); if (c.num) { cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right' }; } if (c.k === 'inf' && x.inf) cell.font = RED.font; if (c.k === 'obs' && x.multi) { cell.value = x.obs + '  ✖ ' + x.multi + ' multi-observation record(s)'; cell.font = RED.font; } });
      }
      const tr = ws.getRow(r++), lead = cols.findIndex(c => c.k === 'value');
      tr.getCell(1).value = 'Subtotal — ' + s.program; tr.getCell(lead + 1).value = s.value; tr.getCell(lead + 2).value = s.inf;
      for (let k = 1; k <= cols.length; k++) { const c = tr.getCell(k); c.font = { bold: true, color: { argb: 'FF176A3D' } }; c.fill = fill('FFE8F4EC'); c.border = { top: { style: 'thin', color: { argb: 'FF9BC9AA' } } }; if (k > lead && k <= lead + 2) { c.numFmt = '#,##0'; c.alignment = { horizontal: 'right' }; } }
      r++;
    }
    widths.forEach((w, k) => ws.getColumn(k + 1).width = w);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
  }
  function hierSheet(wb, ds, name, rows, title) {
    const ws = wb.addWorksheet(name.slice(0, 31)), hier = buildHier(ds, rows), anyEv = hier.some(p => p.hasEvent), anySite = hier.some(p => p.hasSite);
    ws.getCell('A1').value = title; ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF183B68' } };
    const hr = ws.getRow(3); ['Program › Area › Team › Observation', 'Event', 'Account Site', 'Value Count', 'Infestation Count', 'Infested Target Pest', 'Hours in system', 'Flags', 'Map (centre of infestations)'].forEach((h, k) => hr.getCell(k + 1).value = h); styleHeader(hr);
    [64, anyEv ? 34 : 3, anySite ? 34 : 3, 13, 16, 36, 14, 52, 26].forEach((w, k) => ws.getColumn(k + 1).width = w);
    let r = 4;
    const SMALLRED = { size: 8, color: { argb: 'FFB3261E' } };
    const put = (vals, style, indent) => { const row = ws.getRow(r++); vals.forEach((v, k) => { const c = row.getCell(k + 1); c.value = v; if (style.font) c.font = style.font; if (style.fill) c.fill = style.fill; if (k === 0) c.alignment = { indent }; if (k === 3 || k === 4) { c.numFmt = '#,##0'; c.alignment = { horizontal: 'right' }; } if (k === 6) { c.numFmt = '0.0'; c.alignment = { horizontal: 'right' }; } }); return row; };
    const mapCell = (row, rws) => { const c = centre(ds, rws); if (c) { const cell = row.getCell(9); cell.value = { text: '🗺 Open map', hyperlink: 'https://www.google.com/maps?q=' + c[0].toFixed(6) + ',' + c[1].toFixed(6) }; cell.font = { color: { argb: 'FF1155CC' }, underline: true }; } };
    const BAND = [{ font: { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }, fill: fill('FF1C477F') }, { font: { bold: true, size: 12, color: { argb: 'FF173B70' } }, fill: fill('FFD9E5F5') }, { font: { bold: true, size: 11, color: { argb: 'FF29466E' } }, fill: fill('FFEEF3FA') }];
    const flagCell = row => { row.getCell(8).font = SMALLRED; row.getCell(8).alignment = { wrapText: true }; };
    for (const P of hier) {
      const pr = put([P.label, '', '', P.value, P.inf, '', '', flSummary(P.fl).join(' · '), ''], BAND[0], 0); pr.getCell(8).font = { size: 8, color: { argb: 'FFFFC9C4' } };
      for (const A of P.areas) {
        const ar = put([A.label, '', '', A.value, A.inf, '', '', flSummary(A.fl).join(' · '), ''], BAND[1], 1); flagCell(ar); mapCell(ar, A.rows);
        for (const T of A.teams) {
          const tr = put([T.label, '', '', T.value, T.inf, '', +(T.hours.total / 3600000).toFixed(1), flSummary(T.fl).join(' · '), ''], BAND[2], 2); flagCell(tr); mapCell(tr, T.rows);
          const om = new Map();
          for (const S of T.sectors) for (const o of S.obs) { const k = [o.event, o.site, o.label].join(SEP); let x = om.get(k); if (!x) om.set(k, x = { label: o.label, event: o.event, site: o.site, value: 0, inf: 0, pests: new Map(), multi: 0 }); x.value += o.value; x.inf += o.inf; x.multi += o.multi; o.pests.forEach((c, pp) => x.pests.set(pp, (x.pests.get(pp) || 0) + c)); }
          Array.from(om.values()).sort((x, y) => y.value - x.value || x.label.localeCompare(y.label)).forEach(o => { const row = put([o.label + (o.multi ? '  ✖ ' + o.multi : ''), o.event, o.site, o.value, o.inf, o.inf ? pestText(o.pests) : '', '', '', ''], { font: { size: 10, color: { argb: 'FF26364B' } } }, 3); if (o.multi) row.getCell(1).font = RED.font; if (o.inf) row.getCell(5).font = RED.font; });
        }
      }
    }
    ws.views = [{ state: 'frozen', ySplit: 3 }];
  }
  function reportSheets(wb, ds) {
    const used = new Set(), prs = buildReport(ds, Array.from(ds.idx)), thin = { style: 'thin', color: { argb: 'FF222222' } }, bd = { top: thin, left: thin, bottom: thin, right: thin };
    for (const P of prs) {
      let nm = ('RS ' + P.label.replace(/^SCH\.?\s*(PUBLIC\s+)?(TREATMENT\s+)?SERVICE\s+FOR\s+/i, '').replace(/[\\/?*\[\]:]/g, ' ')).slice(0, 31), n = 2; while (used.has(nm.toLowerCase())) nm = nm.slice(0, 28) + ' ' + n++; used.add(nm.toLowerCase());
      const ws = wb.addWorksheet(nm, { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] }), nc = 3 + P.obs.length * 3;
      ws.mergeCells(1, 1, 1, Math.max(nc, 4)); const t = ws.getCell(1, 1); t.value = P.label + '  —  Report Style'; t.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }; t.fill = fill('FF1F3864'); t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }; ws.getRow(1).height = 28;
      ['Area Name', 'Sector', 'Date'].forEach((h, k) => { ws.mergeCells(3, k + 1, 4, k + 1); const c = ws.getCell(3, k + 1); c.value = h; c.font = { bold: true, size: 11 }; c.fill = fill('FF9DC3E6'); c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.border = bd; ws.getCell(4, k + 1).border = bd; });
      ws.getColumn(1).width = 28; ws.getColumn(2).width = 18; ws.getColumn(3).width = 14;
      P.obs.forEach((o, k) => { const c0 = 4 + k * 3; ws.mergeCells(3, c0, 3, c0 + 2); const g = ws.getCell(3, c0); g.value = o; g.font = { bold: true, size: 11 }; g.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; g.border = bd; for (let q = 0; q < 3; q++) ws.getCell(3, c0 + q).border = bd;
        ['VALUE COUNT', 'INFESTATION COUNT', 'INFESTED TARGET PEST'].forEach((h, q) => { const c = ws.getCell(4, c0 + q); c.value = h; c.font = { bold: true, size: 9 }; c.fill = fill('FF36C0CC'); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = bd; });
        ws.getColumn(c0).width = 12; ws.getColumn(c0 + 1).width = 14; ws.getColumn(c0 + 2).width = 26; });
      ws.getRow(3).height = 34; ws.getRow(4).height = 30;
      let r = 5;
      const line = (vals, bold) => { const row = ws.getRow(r++); vals.forEach((v, k) => { const c = row.getCell(k + 1); c.value = v; c.border = bd; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.font = { size: 10, bold: !!bold }; if (k >= 3 && (k - 3) % 3 === 1) { c.fill = fill('FFE0F6F8'); } }); return row; };
      const vals = c => c ? [c.value, c.inf || '', c.inf ? pestText(c.pests) : ''] : ['', '', ''];
      for (const R of P.rows) { const ds2 = datesOf(R), row = line([R.area, R.sector, ds2.join('\n')].concat(...P.obs.map(o => vals(R.cells.get(o))))); row.height = Math.max(16, 14 * Math.max(1, ds2.length)); }
      const tr = line(['TOTAL', '', ''].concat(...P.obs.map(o => vals(P.tot.get(o)))), true); tr.eachCell(c => { c.fill = fill('FF9DC3E6'); });
    }
  }
  function hoursSheets(wb, ds, groups) {
    const S = wb.addWorksheet('TEAM HOURS', { views: [{ state: 'frozen', ySplit: 1 }] }), D = wb.addWorksheet('TEAM HOURS BY DAY', { views: [{ state: 'frozen', ySplit: 1 }] });
    S.columns = [['Group', 16], ['Team', 40], ['Days worked', 12], ['Total hours in system', 18], ['Average hours / day', 18]].map(([header, width]) => ({ header, width })); styleHeader(S.getRow(1));
    D.columns = [['Group', 16], ['Team', 40], ['Date', 14], ['First scan', 11], ['Last scan', 11], ['Hours', 10]].map(([header, width]) => ({ header, width })); styleHeader(D.getRow(1));
    for (const g of groups) {
      const by = new Map(); g.rows.forEach(i => { const t = lab(ds, 'team', i) || '—'; (by.get(t) || by.set(t, []).get(t)).push(i); });
      for (const t of Array.from(by.keys()).sort(natc)) {
        const th = teamHours(ds, by.get(t)), gl = g.label.replace(/ ·.*/, '');
        const row = S.addRow([gl, t, th.days.length, +(th.total / 3600000).toFixed(1), +(th.avg / 3600000).toFixed(1)]); row.getCell(4).numFmt = '0.0'; row.getCell(5).numFmt = '0.0';
        th.days.forEach(x => { const r2 = D.addRow([gl, t, U.iso(x.day * 86400000), hhmm(x.first), hhmm(x.last), +(x.ms / 3600000).toFixed(1)]); r2.getCell(6).numFmt = '0.0'; });
      }
    }
    const X = wb.addWorksheet('TEAM HOURS BY SECTOR', { views: [{ state: 'frozen', ySplit: 1 }] });
    X.columns = [['Group', 14], ['Program', 38], ['Area', 22], ['Team', 38], ['Date', 12], ['Sector', 16], ['First scan', 10], ['Last scan', 10], ['Hours in sector', 12], ['Records', 9], ['Infested', 9], ['Gap to next sector (min)', 14], ['Next sector', 16], ['Team first scan (day)', 12], ['Team last scan (day)', 12], ['Team hours that day', 12]].map(([header, width]) => ({ header, width })); styleHeader(X.getRow(1));
    for (const g of groups) {
      const gl = g.label.replace(/ ·.*/, ''), th = new Map(), vs = buildVisits(ds, g.rows);
      vs.sort((a, b) => natc(a.team, b.team) || a.day - b.day || (a.first - b.first));
      for (const v of vs) {
        let T = th.get(v.team); if (!T) { T = new Map(); teamHours(ds, g.rows.filter(i => lab(ds, 'team', i) === v.team)).days.forEach(x => T.set(x.day, x)); th.set(v.team, T); }
        const d = T.get(v.day) || {}, row = X.addRow([gl, lab(ds, 'program', v.rows[0]) || '', lab(ds, 'area', v.rows[0]) || '', v.team, v.day >= 0 ? U.iso(v.day * 86400000) : '', v.sector, hhmm(v.first), hhmm(v.last), isNaN(v.first) ? '' : +((v.last - v.first) / 3600000).toFixed(2), v.rows.length, v.inf, isNaN(v.gap) ? '' : mins(v.gap), v.next, d.first ? hhmm(d.first) : '', d.last ? hhmm(d.last) : '', d.ms != null ? +(d.ms / 3600000).toFixed(1) : '']);
        row.getCell(9).numFmt = '0.00'; row.getCell(16).numFmt = '0.0';
      }
    }
    X.autoFilter = { from: 'A1', to: 'P1' };
    S.autoFilter = { from: 'A1', to: 'E1' }; D.autoFilter = { from: 'A1', to: 'F1' };
  }
  function geoSheet(wb, ds, name, onlyInf) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] }), tg = teamGroups(ds), tc = ds.dims.team.codes;
    ws.columns = [['Group', 16], ['Program', 40], ['Area', 24], ['Team', 36], ['Sector', 16], ['Date', 12], ['Time', 8], ['Result', 14], ['Target pest', 26], ['Observation', 50], ['Latitude', 12], ['Longitude', 12], ['Map (click)', 12]].map(([header, width]) => ({ header, width })); styleHeader(ws.getRow(1));
    for (let j = 0; j < ds.idx.length; j++) {
      const i = ds.idx[j]; if (!ds.validCoord[i] || (onlyInf && !ds.infested[i])) continue;
      const lat = +ds.lat[i].toFixed(6), lng = +ds.lng[i].toFixed(6);
      const row = ws.addRow([tg[tc[i]].label.replace(/ ·.*/, ''), lab(ds, 'program', i) || '', lab(ds, 'area', i) || '', lab(ds, 'team', i) || '', lab(ds, 'sector', i) || '', ds.day[i] >= 0 ? U.iso(ds.day[i] * 86400000) : '', hhmm(ds.ts[i]), ds.infested[i] ? 'Infested' : 'Not infested', ds.infested[i] ? (rawVal(ds, 'targetPest', i) || '') : '', recObs(ds, i).parts.map(p => p.name).join(' + '), lat, lng, { formula: 'HYPERLINK("https://www.google.com/maps?q=' + lat + ',' + lng + '","Map")' }]);
      if (ds.infested[i]) row.getCell(8).font = RED.font;
    }
    ws.autoFilter = { from: 'A1', to: 'M1' };
  }
  function extraSheets(wb, ds, gs, parts) {
    const hasImg = ds.has('images'), dateOf = v => v.day >= 0 ? U.iso(v.day * 86400000) : '', gl = g => g.label.replace(/ ·.*/, '');
    const mk = (name, cols) => { const w = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] }); w.columns = cols.map(([header, width]) => ({ header, width })); styleHeader(w.getRow(1)); return w; };
    const T = parts.timing ? mk('SECTOR TIMING', [['Group', 16], ['Team', 14], ['Date', 14], ['Sector', 16], ['First scan', 11], ['Last scan', 11], ['Time in sector (min)', 14], ['Gap to next sector (min)', 14], ['Next sector', 16], ['Records', 10], ['Infested', 10], ['Infested target pest', 34], ['Records with chemical', 12], ['Records with photos', 12], ['Multi-observation records', 14], ['Flags', 34]]) : null;
    const P = parts.photos && hasImg ? mk('SECTOR PHOTOS', [['Group', 16], ['Team', 14], ['Date', 14], ['Sector', 16], ['Time', 9], ['Photo (click)', 60]]) : null;
    const M = parts.multi ? mk('MULTI-OBSERVATION', [['Group', 16], ['Team', 14], ['Date', 14], ['Time', 9], ['Sector', 16], ['Observation text (as recorded)', 110]]) : null;
    for (const g of gs) for (const v of buildVisits(ds, g.rows)) {
      const date = dateOf(v), flags = [v.noChem && 'No chemical', v.noPhoto && 'No photos', v.multi.length && 'Multi-observation ✖'].filter(Boolean).join(' · ');
      if (T) {
        const row = T.addRow([gl(g), v.team, date, v.sector, hhmm(v.first), hhmm(v.last), isNaN(v.first) ? '' : mins(v.last - v.first), isNaN(v.gap) ? '' : mins(v.gap), v.next, v.rows.length, v.inf, v.inf ? pestText(v.pests) : '', ds.has('materials') ? v.chem : '', hasImg ? v.photoRecs : '', v.multi.length, flags]);
        if (v.noChem) row.getCell(13).font = RED.font, row.getCell(13).fill = RED.fill;
        if (v.noPhoto) row.getCell(14).font = RED.font, row.getCell(14).fill = RED.fill;
        if (v.multi.length) row.getCell(15).font = RED.font, row.getCell(15).fill = RED.fill;
        if (flags) row.getCell(16).font = RED.font; if (!isNaN(v.gap) && v.gap < 0) row.getCell(8).font = RED.font;
      }
      if (P) { const seen = new Set(); for (const p of v.photos) { if (seen.has(p.url)) continue; seen.add(p.url); const pr = P.addRow([gl(g), v.team, date, v.sector, hhmm(ds.ts[p.i]), { text: p.url, hyperlink: p.url }]); pr.getCell(6).font = { color: { argb: 'FF1155CC' }, underline: true }; } }
      if (M) for (const i of v.multi) M.addRow([gl(g), v.team, date, hhmm(ds.ts[i]), v.sector, recObs(ds, i).raw.replace(/\s*\n\s*/g, '  |  ')]);
    }
    if (T) T.autoFilter = { from: 'A1', to: 'P1' };
    if (parts.flags) {
      const Fw = mk('ALL FLAGS', [['Group', 16], ['Area', 26], ['Team', 36], ['Date', 14], ['Sector', 18], ['Flag', 20], ['Time', 22], ['Detail', 100]]);
      for (const f of buildFlags(ds)) { const row = Fw.addRow([f.group, f.area, f.team, f.day >= 0 ? U.iso(f.day * 86400000) : '', f.sector, f.type, f.time, f.detail]); row.getCell(6).font = RED.font; row.getCell(6).fill = RED.fill; }
      Fw.autoFilter = { from: 'A1', to: 'H1' };
    }
  }

  /** parts: {pivot, survey, overall}. Resolves with the downloaded file name. */
  Obs.exportWorkbook = async function (ds, parts) {
    const groups = compute(ds), per = woPeriod(ds), used = [];
    const wb = new ExcelJS.Workbook(); wb.creator = 'ADPHC × Eagle Inspection Point Report'; wb.created = new Date();
    if (parts.overall) sectionsSheet(wb, ds, 'Overall Areas', Array.from(ds.idx), false, 'Overall Areas — ' + per.label);
    if (parts.pivot) { const areas = groups.filter(g => /^A/.test(g.key)), list = areas.length ? areas : groups.filter(g => g.key !== 'S'); list.forEach(g => hierSheet(wb, ds, g.label, g.rows, g.label + ' — ' + per.label)); }
    if (parts.survey) { const sg = groups.find(g => g.key === 'S'); if (sg) hierSheet(wb, ds, 'SURVEY', sg.rows, 'SURVEY S1–S' + sg.max + ' — ' + per.label); }
    if (parts.report) reportSheets(wb, ds);
    if (parts.hours) hoursSheets(wb, ds, groups);
    if (parts.geoinf) geoSheet(wb, ds, 'GEOTAGS INFESTED', true);
    if (parts.geoall) geoSheet(wb, ds, 'GEOTAGS ALL', false);
    if (parts.timing || parts.photos || parts.multi || parts.flags) extraSheets(wb, ds, groups, parts);
    const buf = await wb.xlsx.writeBuffer(); const name = 'ADPHC_Eagle_Observation_Report_' + per.file + '.xlsx';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); return name;
  };
})();
