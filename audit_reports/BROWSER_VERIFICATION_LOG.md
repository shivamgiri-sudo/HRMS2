# Browser Verification Log

Every UI-affecting change is opened in a real browser after building, and recorded here (rule: `CLAUDE.md` → "VERIFY IN A REAL BROWSER"). Newest first.

---

## 2026-09-29 (later) — Quality-% colour contrast (ui-ux-pro-max review)

**Method:** temporary Vite harness with mocked API, headless Playwright Chromium; computed WCAG contrast from the rendered cell colours; harness removed afterwards.

| Page | Green / Amber / Red cell text contrast |
|---|---|
| Analyst Performance | 5.02 / 8.26 / 6.47 (all >= 4.5 AA) |
| Audit Sampling | 5.02 / 8.26 / 6.47 |

**Why:** previous fills were white text on #f59e0b (2.15:1) and #16a34a (3.3:1). Now dark green + white, amber + near-black, dark red + white. Shared `qualityPctStyle()` also used by Stack Ranking. Console errors: none.

**Not verified:** live site; Quality tab and POA tables still colour the *text* with `--green/--orange/--red` on white (not re-measured).

---

## 2026-09-29 (later) — Analyst Performance quality-% colouring

**Method:** Vite dev + temporary harness with mocked `/analyst-report` (3 analysts at 0.5%, 0.9%, 2.0% error), headless Playwright Chromium; harness removed afterwards.

| Area | Result |
|---|---|
| Analyst Performance → Overall Error %, Internal and External quality columns | Fill green (rgb 22,163,74) at 0.5%, amber (245,158,11) at 0.9%, red (232,35,26) at 2.0%; screenshot reviewed |
| Console / page errors | None |

**Why:** the page had no quality colouring at all (an earlier commit message wrongly said it was already correct). Also applied to the analyst drill-down QualityTable and weekly table.

**Not verified:** real data on the live site (login required); analyst drill-down sheet and weekly table were not opened in the browser.

---

## 2026-09-29 — Onfido dashboard fixes (commit `4cf4c93`, deployed run 36607763350)

**Method:** Vite dev server + temporary harness page rendering `OnfidoProcessDashboard` with mocked `/api` responses; driven by headless Playwright Chromium (Playwright/Chrome DevTools MCP browsers were locked by another session). Backend SQL run against a throwaway `mysql:8` container with the Onfido tables created from `onfido-report-configs.ts` and seeded with sample rows. Harness and container removed afterwards.

| Area | Result |
|---|---|
| Overview → Capacity Builder (LOB Wise) card | Renders, LOB row visible |
| Audit Sampling | Table renders, no "Failed to load", no "Conditional formatting" line; Error % green 0.5 / amber 0.9 / red 1.8 |
| Stack Ranking | Renders, no error text |
| Utilization | Renders (after mock fixed); "Bulk upload (CSV)" button present |
| Export (Excel), every tab tried | Downloads `.xlsx`; contents match on-screen table; `showGridLines="0"` set |
| Console / page errors | None |
| Backend `getAuditSampling`, `getStackRanking` (Analyst/TL/AM) | All queries execute; attrition 1/avg HC 2 = 50%, shrinkage 1/2 = 50% match hand calculation |

**Bug found by the browser run:** `withoutGridlines()` also matched `<sheetViews>` and wrote invalid XML (`<sheetView showGridLines="0"s>`); fixed by matching only the `<sheetView` element. Unit test and build had passed despite it.

**Not verified:**
- Real production data / live site pages (login required; no credentials available to the session). After deploy only `GET /` = 200 and unauthenticated API = 401 were checked.
- Capacity Builder figures (reads LOB assignments from the main HRMS DB, not available locally).
- Whether the requester's role passes the Utilization bulk-upload permission (admin, coo, wfm, process_manager, super_admin).
- Utilization "no formula" request — derived columns are still calculated on screen; bulk upload reads typed-in values only. Awaiting owner decision.

---

## 2026-09-29 — BLA / BLI / BLU Sales Dashboard (Process Operations → Bella Vita → Sales Dashboard → "BLA / BLI / BLU")

**Method:** Real HRMS frontend (Vite dev) + real backend (`tsx src/server.ts`) against a throwaway `mysql:8` container built from the migration chain (57 migrations failed on the empty DB and were skipped with `MIGRATION_STOP_ON_FAILURE=false`; 2FA disabled and a `BELLA_VITA` process row added in that throwaway DB only). Logged in through `/auth` as a seeded demo admin using Chrome DevTools MCP. Test data was generated, not real: `bla_dash_received` uploaded through the page's own uploader (725 rows), `bla_bli_blu_overall_sales_raw` seeded by SQL (85 rows). Container and env file removed afterwards.

| Area | Result |
|---|---|
| Toggle "BLA / BLI / BLU" beside Bellavita (Fresh) / BVO | Present, switches views |
| KPI cards, Sales vs Target chart, Target vs Achievement, Sales MBR daily/weekly + MTD, Product Wise | Render; MTD 61 sales vs target 56 = 108.4%, matching the hand formula and the unit test |
| LOB switch (All / Cart ABC / Upgrade) | Filters correctly |
| Received Data upload via the page | Stores rows; re-upload of the same dates replaces, not doubles |
| Duplicate uploader | Found: the generic "Upload Bellavita Data" panel also rendered under the BLA view. Fixed; it now shows only on the Fresh/BVO views. Overall Sales is read from the existing `bla_bli_blu_overall_sales_raw` (Bulk Upload Hub) and is not uploadable a second time here |
| Console errors | None |

**Not verified:** real production data; role checks for non-admin roles; whether production's `campaign` / `business_type` values on `bla_bli_blu_overall_sales_raw` exactly equal "Cart ABC" / "Upgrade" / "Real Time Sales" (matched to the template workbook, not to live rows); Inbound (BLI) has no target definition in the workbook so shows counts only.
