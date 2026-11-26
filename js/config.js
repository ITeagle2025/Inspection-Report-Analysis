/* ==========================================================================
   config.js — column mapping, brand colours, business-rule constants
   Everything data-specific lives in the Excel; this file only holds the
   *vocabulary* used to recognise columns and the brand/analysis constants.
   ========================================================================== */
window.IPR = window.IPR || {};

IPR.CONFIG = {
  /* Header aliases -> canonical key. Matching is case/space/punctuation-insensitive.
     To support a renamed column in a future export, add the new header here. */
  COLUMNS: {
    wo:            { label: 'WO#',                 aliases: ['Work Order No.', 'Work Order Number', 'Work Order', 'WO#', 'WO No', 'WO Number', 'WO'] },
    po:            { label: 'PO Number',           aliases: ['PO Number', 'PO No', 'PO #', 'PO'] },
    program:       { label: 'Program',             aliases: ['Program', 'Programme'] },
    event:         { label: 'Event',               aliases: ['Event'] },
    inspPoint:     { label: 'Inspection Point',    aliases: ['Inspection Point'] },
    barcode:       { label: 'Barcode',             aliases: ['Barcode', 'Bar Code'] },
    scannedAt:     { label: 'Scanned At',          aliases: ['Scanned At', 'ScannedAt', 'Scan Date', 'Scanned Date'], required: true },
    lat:           { label: 'Latitude',            aliases: ['Latitude', 'Lat'] },
    lng:           { label: 'Longitude',           aliases: ['Longitude', 'Lng', 'Long', 'Lon'] },
    lot:           { label: 'Lot',                 aliases: ['Lot'] },
    area:          { label: 'Area',                aliases: ['Area'] },
    accountSite:   { label: 'Account Site',        aliases: ['Account Site'] },
    sector:        { label: 'Sector',              aliases: ['Sector'] },
    team:          { label: 'Team',                aliases: ['Team'] },
    vehicle:       { label: 'Vehicle',             aliases: ['Vehicle'] },
    locationType:  { label: 'Location Type',       aliases: ['Location Type'] },
    activityType:  { label: 'Activity Type',       aliases: ['Activity Type'] },
    accountType:   { label: 'Account Type',        aliases: ['Account Type'] },
    targetPest:    { label: 'Target Pest',         aliases: ['Target Pest'] },
    pestQty:       { label: 'Pest Quantity Observed', aliases: ['Pest Quantity Observed'] },
    infestation:   { label: 'Infestation',         aliases: ['Infestation'], required: true },
    infRank:       { label: 'Infestation Ranking', aliases: ['Infestation Ranking'] },
    observation:   { label: 'Observation',         aliases: ['Observations', 'Observation'] },
    obsNotes:      { label: 'Observation Notes',   aliases: ['Observation Notes'] },
    materials:     { label: 'Materials',           aliases: ['Materials'] },
    woDate:        { label: 'Work Order Date',     aliases: ['Work Order Date', 'WO Date'] },
    status:        { label: 'Status',              aliases: ['Status'] },
    attachments:   { label: 'Attachments',         aliases: ['Attachments'] },
    images:        { label: 'Images',              aliases: ['Images'] },
    videos:        { label: 'Videos',              aliases: ['Videos'] }
  },

  /* Columns that are dates (stored by Excel as serial numbers). */
  DATE_KEYS: ['scannedAt', 'woDate'],

  /* Filter definitions (order = display order). `dim` keys become dictionary-encoded dimensions. */
  // Observation Report: programs that get an extra Event / Account Site column (Account Site also appears for any program whose rows carry one)
  DUTY_HOURS: 8, // hours per date above this are shown in red
  // Report Style: programs split into one block per Event
  REPORT_EVENT_PROGRAMS: [/FARMS AND EZAB/i, /PEST SURVEILLANCE/i, /MOSQUITO ADULT & LARVAE SURVEILLANCE/i],
  EVENT_PROGRAMS: [/PEST SURVEILLANCE/i],
  SITE_PROGRAMS: [/GOVERNMENT FACILITIES/i],
  PRIMARY_FILTERS: ['scannedAt', 'team', 'program', 'event', 'area', 'sector', 'infestation', 'targetPest'],
  MORE_FILTERS:    ['observation', 'status', 'wo', 'po', 'accountType', 'locationType', 'activityType'],

  /* Default extraction columns (only those present in the file are shown). */
  DEFAULT_TABLE_COLS: ['wo', 'po', 'scannedAt', 'team', 'program', 'event', 'area', 'sector', 'status', 'infestation', 'observation', 'locationType', 'activityType'],

  /* Business rules (documented in README) */
  MIN_BASE: 50,          // min inspected records before an infestation *rate* is ranked/flagged
  Z_FLAG: 3,             // z-score (vs overall rate) above which a rate is called "significantly higher"
  GAP_DAYS: 7,           // gap (days) that splits the data into separate reporting-period segments
  REPEAT_POINT_MIN: 3,   // infested records at the same inspection point to be called "repeat"
  TABLE_PAGE: 100,

  /* Team classification — Operation = inspect + treat, Survey = inspect only.
     Derived ONLY from the Team text. Anything that matches neither is "Unclassified" and flagged. */
  TEAM_RULES: {
    survey:    [/^\s*S\d+\b/i, /\bsurvey\b/i, /\bsmart\s*trap\b/i],
    operation: [/^\s*A\d+\s*-\s*T\d+/i]
  },

  /* Validation reference only (from the brand guideline §9) — never drives filters. */
  MASTER_AREAS: ['MUSAFFAH', 'ZAYED CITY', 'MOHAMED BIN ZAYED CITY', 'RABDAN', 'AL SELMIYYAH', 'AL SHINAYIN', 'AL SOUT', 'AL KHIDAYRAH', 'AL ARYAM ISLAND', 'ABU AL ABYAD ISLAND', 'AL NOUF (BU SAHA ISLAND)', 'AL SHAMKHAH', 'AL SHAWAMEKH', 'MADINAT AL RIYAD', 'SHAKBOUT CITY', 'AL MIRAD', 'AL HAFFAR', 'AL KHATM', 'AL NAHDAH', 'AL WATHBA', 'BANIYAS', 'JARN YAFOUR', 'DIHAN', 'DHAHARAT AL TEEB', 'MSHAYRIF', 'AL ADLAH', 'AL ASHEESH', 'AL FAYAH'],

  /* Brand colours sampled from the supplied logo artwork. */
  COLORS: {
    adphc: '#003060',   // ADPHC Blue
    teal:  '#0890A0',   // Eagle Teal
    green: '#10A050',   // Eagle Green
    gray:  '#808080',   // Neutral Gray
    alert: '#E0572F',   // infestation emphasis (established EAGLE accent)
    grid:  '#E3E7EB',
    ink:   '#1B2733',
    muted: '#5F6B76'
  }
};

IPR.UI = {  // on-screen futuristic (dark) palette derived from the logo colours
  blue: '#4F9DEB', teal: '#1CC8D8', green: '#27D17F', alert: '#FF6B3D', gray: '#8FA3B8',
  ink: '#E6F1FF', muted: '#8FA8C2', grid: 'rgba(120,170,220,0.16)', tipBg: '#0A2342', sep: '#0A2342'
};

IPR.fmt = {
  int: n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US'),
  pct: (n, d = 2) => (n == null || isNaN(n)) ? 'n/a' : n.toFixed(d) + '%',
  rate: (inf, insp) => insp > 0 ? (inf / insp) * 100 : null,
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
};
