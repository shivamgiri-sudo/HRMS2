# Browser Verification Log

Every UI-affecting change is opened in a real browser after building, and recorded here (rule: `CLAUDE.md` → "VERIFY IN A REAL BROWSER"). Newest first.

---

## 2026-09-30 — Remaining tabs + single Export button

**Method:** temporary Vite harness with mocked API, headless Playwright Chromium; harness removed afterwards.

| Page | Result |
|---|---|
| Alerts | 3 error-rate rows filled green/amber/red; the non-error "AHT" alert row correctly left uncoloured |
| Outliers & Actions | 2 value cells filled (red 2.4%, amber 0.9%) |
| POA (Internal/External) legacy layout (entity-month grids, day-wise, breakdown, KPIs) | 28 cells filled across all three colours |
| Audit Sampling / Stack Ranking | Only one "Export (Excel)" button now (redundant CSV pill removed); .xlsx downloads; no "Failed to load" text |
| Console / page errors | None on any of the above |

**Not verified:** live site (login required); Client & Document tab and Trends tab rendered only via code; Client Escalations rate intentionally not colour-coded (not clearly an error rate).

---

## 2026-09-29 (later) — Quality colour code on every error-rate section

**Method:** temporary Vite harness with mocked API (error rates 0.5 / 0.9 / 1.6 / 2.2), headless Playwright Chromium, full-page screenshot reviewed; harness removed afterwards.

| Section | Result |
|---|---|
| Overview → Internal / External / POA Quality matrices | 9 cells filled (3 sections x 3 periods) |
| Quality → KPI cards (Overall, FAR, Int, POA, POA Ext) | 5 filled |
| Quality → Metric Trend table, Breakdown (client/doc/TL/AM), Analyst Quality + Top 20 tables | filled green/amber/red |
| Quality → Error Rate trend chart | dashed reference lines at 0.75% and 1%; y-axis always reaches 1.2% |
| Console / page errors | None |

**Also changed (not opened in browser):** Analyst ranking + performance tables, POA tables, Client & Document error-rate tables, POA External, Outliers value column, Alerts value column (only rows whose metric contains "Error"), KPI cards on POA and POA External tabs. Same shared `qualityPctStyle()`.

**Not verified:** live site (login); Outliers, Alerts, Trends, POA tabs rendered only via code, not in the browser.

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

## 2026-09-30 — Operations Command (`/operations-dashboard` rebuild)

**Commit:** not committed (no git repo at this path; working tree only).

**Method:** Vite dev server + temporary harness rendering `OperationsCommand` with mocked `/api/operations-command/*` responses, driven by headless Playwright Chromium. Harness deleted afterwards. Backend service functions (`computeTotals`, `computeGroups` for every dimension, `computeTrend`, `computeFilterOptions`, `computePerformance`, `computeRecords` for all 11 domains, `computeEmployeeDetail`) were run against a local `mysql:8` seeded with 48 employees / 1,260 attendance rows / 714 roster rows / 7 exit requests / mandate / requisition / warning, `ONLY_FULL_GROUP_BY` on. Hand checks: 42 active HC, 6 exits, attrition 6 / avg HC 36 = 16.67%, notice 1, branch-scoped HC 21 = branch row HC 21, Kolkata mandate 20 vs HC 21 = 105% fill.

| Area | Result |
|---|---|
| Overview: filters, 8 KPI tiles with prev-period deltas, trend, drill table | Renders |
| Tabs Shrinkage / Attrition / Process Performance / Attendance | Switch, render |
| Row click drill | URL becomes `?tab=attrition&branch=…&by=process` |
| Day heatmap (Attendance/Shrinkage), cell click | Renders, opens list drawer |
| Analyst row -> Agent 360 drawer | Calendar strip, day-by-day roster vs actual, flags, "None" placeholders |
| Console / page errors | None |

**Not verified:**
- Real production data and the login-gated page (no credentials in session).
- Endpoints over HTTP with a real JWT / role scope; scope logic exercised only via `ORG_ALL` and `BRANCH_ALL` scope objects passed to the service.
- **`/heatmap` and `/employee/:id/days` SQL was written after the local MySQL container and `backend/.env.bla-local` disappeared from this machine (removed outside this session). Those two queries are type-checked only, never executed.**
- External `db_audit` call-quality feed (absent locally; failure path exercised, success path not).
- Productivity / break / LMS / live-session SQL ran against empty tables (syntax only).
- Migration `1915_operations_command_indexes.sql` applied to the local DB only, not production.
