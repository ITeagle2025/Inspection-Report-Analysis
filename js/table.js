/* ==========================================================================
   table.js — Data Extraction tab: paginated, sortable, column-selectable
   Only one page of rows is ever in the DOM.
   ========================================================================== */
(function () {
  const C = IPR.CONFIG, F = IPR.fmt, U = IPR.dateUtil;
  const T = IPR.Table = { page: 0, size: C.TABLE_PAGE, sort: null, cols: [], order: null };

  /** Display text for a cell (original value; dates formatted for reading only). */
  IPR.cellText = function (ds, i, key) {
    const v = ds.rows[i][ds.map[key]];
    if (v == null) return '';
    if (C.DATE_KEYS.includes(key)) { const ms = key === 'scannedAt' ? ds.ts[i] : (ds.woTs ? ds.woTs[i] : NaN); return isNaN(ms) ? String(v) : U.isoTime(ms); }
    return String(v);
  };
  const textByCol = (ds, i, c) => { if (c.key) return IPR.cellText(ds, i, c.key); const v = ds.rows[i][c.index]; return v == null ? '' : String(v); };

  /** columns = every header in the file (excluding the running "#" column) */
  T.init = function (ds) {
    T.page = 0; T.sort = null; T.order = null;
    const keyOf = {}; Object.keys(ds.map).forEach(k => keyOf[ds.map[k]] = k);
    T.all = ds.headers.map((h, i) => ({ index: i, header: h || ('Column ' + (i + 1)), key: keyOf[i] || null })).filter(c => c.header !== '#' && c.header !== '');
    const def = new Set(C.DEFAULT_TABLE_COLS.filter(k => ds.has(k)).map(k => ds.map[k]));
    T.selected = new Set(T.all.filter(c => def.has(c.index)).map(c => c.index));
    // display order follows the file; default selected first is not needed
    const cb = document.getElementById('colList');
    cb.innerHTML = T.all.map(c => '<label class="fopt"><input type="checkbox" data-i="' + c.index + '"' + (T.selected.has(c.index) ? ' checked' : '') + '><span class="fotxt">' + F.esc(c.header) + '</span></label>').join('');
  };
  T.visibleCols = () => T.all.filter(c => T.selected.has(c.index));

  T.render = function (ds) {
    const total = ds.n, idx = T.order || ds.idx, n = idx.length;
    document.getElementById('extCount').innerHTML = 'Showing <b>' + F.int(n) + '</b> of <b>' + F.int(total) + '</b> records';
    const cols = T.visibleCols(), size = T.size, pages = Math.max(1, Math.ceil(n / size)); if (T.page >= pages) T.page = pages - 1;
    const from = T.page * size, to = Math.min(n, from + size);
    let h = '<thead><tr><th class="rowno">#</th>' + cols.map(c => '<th data-i="' + c.index + '" class="sortable" aria-sort="' + (T.sort && T.sort.index === c.index ? (T.sort.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + F.esc(c.header) + '<span class="sarrow">' + (T.sort && T.sort.index === c.index ? (T.sort.dir > 0 ? '▲' : '▼') : '') + '</span></th>').join('') + '</tr></thead><tbody>';
    for (let j = from; j < to; j++) {
      const i = idx[j];
      h += '<tr' + (ds.infested[i] ? ' class="rinf"' : '') + '><td class="rowno">' + (j + 1) + '</td>' + cols.map(c => '<td title="' + F.esc(textByCol(ds, i, c)).slice(0, 300) + '">' + F.esc(textByCol(ds, i, c)) + '</td>').join('') + '</tr>';
    }
    if (n === 0) h += '<tr><td colspan="' + (cols.length + 1) + '" class="emptyrow">No records match the current filters.</td></tr>';
    document.getElementById('extTable').innerHTML = h + '</tbody>';
    document.getElementById('pgInfo').textContent = n ? 'Rows ' + F.int(from + 1) + '–' + F.int(to) + ' · Page ' + (T.page + 1) + ' of ' + F.int(pages) : 'No rows';
    document.getElementById('pgPrev').disabled = T.page <= 0; document.getElementById('pgNext').disabled = T.page >= pages - 1;
    document.getElementById('pgFirst').disabled = T.page <= 0; document.getElementById('pgLast').disabled = T.page >= pages - 1;
  };

  T.sortBy = function (ds, index) {
    const col = T.all.find(c => c.index === index);
    T.sort = (T.sort && T.sort.index === index) ? { index, dir: -T.sort.dir } : { index, dir: 1 };
    const idx = Array.from(ds.idx), dir = T.sort.dir;
    const val = i => { const v = ds.rows[i][index]; return v; };
    const isDate = col.key && C.DATE_KEYS.includes(col.key);
    idx.sort((a, b) => {
      let x = isDate ? (col.key === 'scannedAt' ? ds.ts[a] : ds.woTs[a]) : val(a), y = isDate ? (col.key === 'scannedAt' ? ds.ts[b] : ds.woTs[b]) : val(b);
      if (x == null || x === '' || x !== x) return 1; if (y == null || y === '' || y !== y) return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y), 'en', { numeric: true }) * dir;
    });
    T.order = Int32Array.from(idx); T.page = 0;
  };
  T.invalidate = () => { T.order = null; T.sort = null; T.page = 0; };

  /** Column-ordered header/value matrix for export (original values; dates as Excel dates in xlsx). */
  T.exportMatrix = function (ds, allCols) {
    const cols = allCols ? T.all : T.visibleCols(), idx = T.order || ds.idx;
    return { cols, idx };
  };
})();
