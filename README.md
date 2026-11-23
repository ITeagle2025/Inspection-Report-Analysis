# ADPHC × Eagle — Inspection Point Reporting System

A fully client-side web app (HTML + CSS + JavaScript). Upload the Excel report downloaded from the operational system and the app validates it, detects the reporting period, builds dynamic filters, KPIs, charts, a map, analysis, filtered extraction and exports. **No server, database or login. The Excel file never leaves the browser.**

## 1. Run locally
Open `index.html` in Chrome or Edge (double-click works). If your browser blocks anything when opening from a file, run a tiny local server instead:

1. Open a terminal in this folder.
2. Run `python -m http.server 8000`
3. Open `http://localhost:8000`

All libraries (SheetJS, Chart.js, Leaflet, Leaflet.heat) and the Inter font are bundled in `assets/` — only the **map background tiles** (Esri) need internet.

## 2. Publish to GitHub Pages
1. Create a GitHub repository and upload the **contents** of this folder (so `index.html` is at the repository root).
2. Open the repository → **Settings** → **Pages**.
3. Under **Build and deployment**, set **Source** = *Deploy from a branch*, **Branch** = `main`, folder = `/ (root)`, then **Save**.
4. After about a minute the site is live at `https://<your-user>.github.io/<repository>/`.

## 3. How Excel upload works
Upload → read workbook → pick the worksheet and header row automatically (title/blank rows above the table are tolerated; header row is found by matching known column names) → map headers → normalise → validate → **Data validation** screen → dashboard.
A wrong file shows an error panel (missing required column, similar columns found) with **Upload another file**. **Upload New Excel** clears the previous dataset, filters, charts, map and table completely.

## 4. Columns
Header names are matched ignoring case, spaces and punctuation, using the alias list in `js/config.js` (`COLUMNS`).

| | Columns |
|---|---|
| **Required** | `Scanned At`, `Infestation` |
| **Optional** (feature hidden if absent) | Work Order No. (WO#), PO Number, Program, Event, Inspection Point, Barcode, Latitude, Longitude (Map), Lot, Area, Sector, Team (Operation/Survey), Location Type, Activity Type, Account Type, Target Pest, Pest Quantity Observed, Infestation Ranking, Observations, Observation Notes, Materials (Treatment), Work Order Date, Status, Attachments, Images, Videos |

If a future export renames a column, add the new name to the `aliases` list of that column in `js/config.js`.

## 5. Dynamic filters
Every filter list is built from the values in the uploaded file — nothing is hard-coded, and new Areas/Teams/Programs appear automatically. Each dropdown has search, Select All, Clear and a selected count. *Nothing selected (or everything selected) = no restriction.* **Scanned At** is a date/time range with quick options (All Dates, Today, Yesterday, Last 7 Days, This Month, Last Data Day, Custom). Main filters: Date (Scanned At), Team, Program, Event, Area, Sector, Infestation, Target Pest. **+ More Filters** adds Observation, Status, WO#, PO Number, Account Type, Location Type, Activity Type (only those present in the file). Order is set by `PRIMARY_FILTERS` / `MORE_FILTERS` in `js/config.js`. Active filters show as removable chips with a live record count. Filters drive KPIs, charts, findings, attention items, the map, the table and exports.

## 6. Business definitions
| Term | Rule |
|---|---|
| Inspected | Every inspection-point record (row) in the selection. Cancelled records are included and flagged. |
| Infested | Records where `Infestation` = Infested. |
| Infestation Rate | Infested ÷ Inspected × 100 (only when Inspected > 0). Area/sector/team rates are ranked or flagged only with ≥ 50 inspections (`MIN_BASE`). |
| Operation / Survey | Derived from the **Team** text only: `A#-T#` = Operation; `S#…`, "survey" or "smart trap" = Survey; anything else = *Unclassified* (flagged). Rules are in `TEAM_RULES` in `js/config.js`. |
| Treated | Non-Survey records with a Materials value (or Activity Type "Treatment"). Survey records are **never** counted as treatment. If neither column exists the card says *Not available in source data*. |
| Attention items | Only calculated: rate z-score ≥ 3 vs. the overall rate (≥ 50 inspections), points infested ≥ 3 times, daily volumes beyond a robust z of ±3.5, plus data-quality counts. |

## 7. Reporting-period detection
The unique **Scanned At dates** are sorted and split into segments wherever two consecutive dates are more than 7 days apart (`GAP_DAYS`). A segment is a range, a lone date is a date, and segments are joined with "and". Min/max are not used blindly.

| Dates in data | Display | File name |
|---|---|---|
| Oct 1–23, 2026 | October 1–23, 2026 | `ADPHC_Eagle_Inspection_Report_Oct_1_to_23_2026.xlsx` |
| Sep 2–Oct 2, 2026 | September 2–October 2, 2026 | `…_Sep_2_to_Oct_2_2026.xlsx` |
| Only Sep 2 and Oct 1 | September 2 and October 1, 2026 | `…_Sep_2_and_Oct_1_2026.xlsx` |

The header shows the period of the *current selection*; exports use the period of the *exported records*.

## 7b. Observation Report tab
Ported from the standalone *Inspection Points Report Generator*. It reuses the loaded data and follows the global filters. Sub-tabs: Overall Areas, Area 1…n (teams starting `A<n>`), Survey (teams starting `S<n>`) and Other Teams — all detected from the Team text, so new areas/surveys appear automatically. Pivot hierarchy = Program › Area › Team › Observation (counts = records). Click a team to open sector cards → observations → scan dates → scan times. Report date = Work Order Date (falls back to Scanned At).

## 8. Exports
Click **⬇ Export…** (top right) to open the export list. Tick one or more: Observation Report (Pivot Table, Survey, Overall Areas — combined into ONE Excel workbook, one sheet each), Filtered records (Excel, CSV), Management report (PDF page). Your browser may ask permission to download multiple files.
* **Export Filtered Excel / CSV** (Data Extraction tab) — only records matching the filters, selected columns (or all with *Export all columns*), original values; dates are real Excel dates. The Excel has a *Report Info* sheet (period, filters, totals).
* **Export Management Report** — a branded report (logos, KPIs, trend, Operation vs Survey, Top 10 Areas/Sectors by Inspected and by Infestation Rate, Target Pest infested counts, fixed point map on an Esri basemap with area names, findings, plain-language attention items; no data-quality section) that opens in a new tab: use **Print / Save as PDF**.

## 9. Replace logos
The screen design is dark/futuristic (logos sit on white plates, unaltered); the PDF report stays light. Overwrite `assets/logos/adphc-logo.png` and `assets/logos/eagle-logo.png` with the new official artwork (keep file names; PNG with transparent background). They are displayed with fixed aspect ratio — never stretched or recoloured. Brand colours are in `js/config.js` (`COLORS`) and `css/styles.css` (`:root`).

## 10. Maintenance map
| File | Responsibility |
|---|---|
| `js/config.js` | Column aliases, defaults, thresholds, team rules, brand colours |
| `js/loader.js` | Workbook read, sheet + header-row detection, required-column errors |
| `js/normalize.js` | Typed/columnar dataset, dates, coordinates, Operation/Survey, Treatment, duplicates |
| `js/validate.js` | Data-quality checks |
| `js/period.js` | Reporting-period label + file naming |
| `js/filters.js` | Filter state, filtering engine, dropdown UI |
| `js/analytics.js` | KPIs, group-bys, trends, findings, attention, reconciliation checks |
| `js/charts.js` | Chart specs + Chart.js renderer (with table view) |
| `js/map.js` | Leaflet map, viewport clustering, heatmap, search |
| `js/table.js` | Paginated, sortable, column-selectable extraction table |
| `js/obsreport.js` | Observation Report tab + its Excel export (ExcelJS) |
| `js/export.js` | Excel, CSV, management report, export list window |
| `js/app.js` | Tabs, views, wiring |

**Performance:** columnar typed arrays; only one page of table rows exists in the DOM; the map renders a few hundred clustered canvas markers instead of 70,000; aggregates are memoised per filter change.
**Built-in check:** the *Analysis → Data Quality* tab runs a reconciliation (KPI totals = sums of every chart/table) on the current filters; failures are logged to the browser console too.

## v2.0 — Observation Report update
- Overall Areas, Area 1–5 and Survey tabs (and the Excel sheets) are separated by Program: AREA | SECTOR | [TEAM] | [EVENT for PEST SURVEILLANCE] | [ACCOUNT SITE] | OBSERVATION | VALUE COUNT (sum of "Count" numbers) | INFESTATION COUNT (infested records) | INFESTED TARGET PEST.
- Programs that get Event / Account Site are set in `js/config.js` (`EVENT_PROGRAMS`, `SITE_PROGRAMS`); Account Site also appears automatically for any program whose rows carry one.
- Team account details: per sector and day — first scan, last scan, time in sector, gap to the next sector; red "No chemical" (Operation teams only), red "No photos" (all teams) with compiled clickable photos; ✖ for records holding several observations (counted separately and flagged).
- Excel adds SECTOR TIMING, SECTOR PHOTOS (clickable links) and MULTI-OBSERVATION sheets.
- Filter dropdowns always open on the top layer.

## v2.1
- Area 1–5/Survey tabs: Area › Team › Sector (time in sector, per-day first/last scan, gap to next sector, flags) › Observation, no click needed.
- New last tab "ALL FLAGS". Export list has separate checkboxes: All flags, Sector timing, Sector photos, Multi-observation records.

## v2.2
- Observation Report group tabs: Program › Area › Team › Sector › Observation; Event / Account Site columns per program; flag summaries per program/area/team; 🗺 Map popup per area and team; Survey has no S1–S8 chips; All Flags without Overlap, team clickable.
- Excel: Program level + map links, GEOTAGS INFESTED / GEOTAGS ALL sheets (separate checkboxes).

## v2.3
- Team Map moved into Team account details; map popup has Dark/Light/Street/Satellite and Heatmap views.
- Excel Area/Survey sheets: Program › Area › Team (small red flag counts, hours) › Observation. New TEAM HOURS sheets.
- Hours in system = per day first scan → last scan, summed per team.

## v2.4
- Aedes Aegypti teams are exempt from the No chemical flag. Gap to next sector = next scan (any other sector) after the last scan of the sector, by date and time.
- Hours in system only on team rows. Excel TEAM HOURS BY SECTOR sheet.
- All Flags > Overview flags (charts and mistake rates). Overall Areas > Report Style (screen + Excel, one sheet per program).
