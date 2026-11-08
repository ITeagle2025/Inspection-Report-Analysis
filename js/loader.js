/* ==========================================================================
   loader.js — read the workbook, find the report sheet + header row, map headers
   ========================================================================== */
(function () {
  const C = IPR.CONFIG;
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

  // alias lookup: normalised header -> canonical key
  const ALIAS = {};
  Object.keys(C.COLUMNS).forEach(k => C.COLUMNS[k].aliases.forEach(a => { ALIAS[norm(a)] = ALIAS[norm(a)] || k; }));

  function scoreRow(row) {
    let hits = 0; const seen = new Set();
    for (const v of row) {
      if (typeof v !== 'string') continue;
      const k = ALIAS[norm(v)];
      if (k && !seen.has(k)) { seen.add(k); hits++; }
    }
    return hits;
  }

  /** Find the header row in the first rows of a sheet (tolerates titles / blank rows). */
  function findHeader(aoa) {
    let best = { row: -1, score: 0 };
    const lim = Math.min(aoa.length, 60);
    for (let i = 0; i < lim; i++) {
      const s = scoreRow(aoa[i] || []);
      if (s > best.score) best = { row: i, score: s };
    }
    return best;
  }

  /** Similar-column suggestions for the error panel. */
  function similar(headers, key) {
    const words = { scannedAt: ['scan', 'date', 'time'], infestation: ['infest', 'pest', 'result'] }[key] || [norm(key)];
    return headers.filter(h => h && words.some(w => norm(h).includes(w))).slice(0, 5);
  }

  /** Reads an ArrayBuffer -> { sheetName, headerRow, headers, map, aoa(data rows), fileInfo } or throws {userMessage,…} */
  IPR.loadWorkbook = function (buf, fileName) {
    let wb;
    try { wb = XLSX.read(buf, { type: 'array', dense: true, cellDates: false }); }
    catch (e) { throw { title: 'Unable to read file', reason: 'The file could not be opened as an Excel workbook (.xlsx / .xls).', detail: String(e && e.message || e) }; }

    let best = null;
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) continue;
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
      const h = findHeader(aoa);
      if (h.score > 0 && (!best || h.score > best.h.score || (h.score === best.h.score && aoa.length > best.aoa.length))) best = { name, aoa, h };
    }
    if (!best || best.h.score < 2) {
      throw { title: 'Unable to generate report', reason: 'No worksheet with a recognisable inspection report table was found.',
        detail: 'Sheets checked: ' + wb.SheetNames.join(', ') + '. Expected headers such as: Scanned At, Infestation, Area, Team, Work Order No.' };
    }

    const headers = (best.aoa[best.h.row] || []).map(v => v == null ? '' : String(v).trim());
    const map = {}, dup = [];
    headers.forEach((h, i) => {
      const k = ALIAS[norm(h)];
      if (!k) return;
      if (map[k] != null) dup.push(h); else map[k] = i;
    });

    // Required columns
    for (const k of Object.keys(C.COLUMNS)) {
      if (C.COLUMNS[k].required && map[k] == null) {
        throw { title: 'Unable to generate report', reason: 'Required column not found:', code: C.COLUMNS[k].label,
          similar: similar(headers, k), detail: 'Worksheet "' + best.name + '", header row ' + (best.h.row + 1) + '. The mapping is only applied when unambiguous.' };
      }
    }

    const rows = best.aoa.slice(best.h.row + 1).filter(r => r && r.some(v => v != null && v !== ''));
    return {
      fileName, sheetName: best.name, sheetNames: wb.SheetNames, headerRowNumber: best.h.row + 1,
      headers, map, duplicateHeaders: dup, rows
    };
  };
})();
