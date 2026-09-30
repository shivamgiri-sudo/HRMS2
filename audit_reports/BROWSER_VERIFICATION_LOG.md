# Browser Verification Log

Every UI-affecting change is opened in a real browser after building, and recorded here (rule: `CLAUDE.md` → "VERIFY IN A REAL BROWSER"). Newest first.

---

## 2026-09-30 (later) — Quality tab: title / subtitle overlap

**Method:** temporary Vite harness with mocked API, headless Playwright Chromium, measured the rendered gap between each card title and its sub-line; harness removed.

| Card | Gap after fix |
|---|---|
| Analyst Quality Score | +4 px (was overlapping: `h3` bottom margin zeroed inline while `.oc-card-sub` pulls up by 8 px) |
| Top 20 Performers | +4 px |
| Top 20 Defaulters | +4 px |

Console / page errors: none. Fix is one CSS rule in `onfido-central-theme.css`. **Not re-checked live** after deploy in this entry.

---

## 2026-09-30 — LIVE: Utilization bulk upload with calculated columns (deploy `f5b1e50`)

**Method:** headless Playwright Chromium, logged in as a Manager user; real CSV file through the "Bulk upload (CSV)" control on https://mcnhrms.teammas.in. Used 30-Sep-2026, a day with no manual inputs, then reverted.

| Step | Result |
|---|---|
| Upload `Utilization Forecaste=12345, Utilization with Adhoc %=77.7%, Escalated %=1.23%` | "Saved 1 day(s)." |
| Read `/utilization-report` for that day | derived forecast **12345**, with-adhoc % **77.7**, escalated % **1.23** (uploaded values shown as-is, `%` stripped) |
| Revert: upload the same date with blank values | "Saved 1 day(s)."; derived values back to null (i.e. the calculation applies again) |
| Page errors | None |

**Left in production:** one empty `onfido_utilization_daily_input` row for 2026-09-30 (all values NULL, so it changes nothing on screen) and two audit-log entries.

---

## 2026-09-30 — LIVE: Approved HC 181 + Audit Sampling paging (deploy `f5b1e50`)

**Deploy note:** the first deploy of these changes (`3ccaa50`, run 36618309461) failed its health check and the deploy script restored the previous build automatically (site stayed up). Cause: migration 449, added by another developer's merge, failed at boot because the app DB user cannot CREATE in `db_masmis`; it was unregistered in `f5b1e50`, and the re-deploy of `f5b1e50` (which contains these changes) succeeded.

**Method:** logged in as a Manager user in headless Playwright Chromium against https://mcnhrms.teammas.in.

| Check | Live result |
|---|---|
| Manage approved HC queue list | "Company total (all queues)", EWYS, POA, Encord (migration 1917 applied) |
| Entered "Company total = 181, effective 01/07/2026" | Saved; no API errors. (An EWYS 181 dated 28/09/2026 already existed but was after the data's last day, 31/08/2026, so it never counted.) |
| Overview headline + Manpower Status | Approved 181, Required 217.2, Active 199, **Buffer 9.9%, Shortfall 18.2**; "Approved HC has not been entered" warning gone |
| Audit Sampling | 100 rows per page of 3,005; "Export (Excel) includes all of them" |
| Audit Sampling Excel export | 3,007 rows (title + header + 3,005 data rows) |
| Console / page errors, 4xx/5xx | None |

**Data written to production:** one `onfido_manpower_plan` row (TOTAL, 2026-07-01, 181), entered at the owner's request. Editable via Manage approved HC.

---

## 2026-09-30 (later) — Company-wide Approved HC (181) + Audit Sampling paging

**Method:** temporary Vite harness (mocked API, 250 audit rows, canEdit=true), headless Playwright Chromium; migration 1917 on a throwaway `mysql:8`.

| Check | Result |
|---|---|
| Audit Sampling | 100 rows per page ("Showing 1-100 of 250", Page x / 3, Next disabled on last page: 50 rows) |
| Audit Sampling Excel export | One "Audit Sampling" sheet with **all 250 rows** (252 rows incl. title + header), not just the visible page |
| Manage approved HC | Queue list now starts with "Company total (all queues)" (default); Save sends `{processQueue:"TOTAL", approvedHc:"181"}` |
| Migration 1917 | Appends `TOTAL` to the ENUM, existing POA row untouched, TOTAL upsert is idempotent (one row) |
| Logic (unit tests) | 181 approved vs 199 active -> required 217.2, buffer 9.9%, shortfall 18.2; TOTAL wins over per-queue sum; not in force before its effective date |
| Console / page errors | None |

**Note:** the sheet's default "Effective from" is today; the dashboard reads approved HC as of the last day with data (31-Aug-2026 today), so the value must be effective on or before that date.

---

## 2026-09-30 — LIVE production verification (https://mcnhrms.teammas.in, deploy of `bfe2d20`)

**Method:** logged in as a real Manager user in headless Playwright Chromium; Process Operations -> Onfido; GET-only (no uploads, no saves). Session cookies deleted afterwards; credentials not stored.

| Tab | Live result |
|---|---|
| Overview | 0 failed API calls; 39 quality cells coloured; **Capacity Builder (LOB Wise) shows figures**: Doc Check 127 active (33 in NHT), ENCORD 5, POA 38 |
| Analyst Performance | 1,560 coloured cells; Excel export downloaded and is valid XML with `showGridLines="0"` (270 rows) |
| Utilization | "Bulk upload (CSV)" present and **enabled** for this role; 31 daily rows |
| Quality | 1,167 coloured cells |
| Trends, Client & Document | load, no failed calls |
| Audit Sampling | **loads real data (3,005 rows, API 0.1 s)**, every Error % cell coloured, no "Conditional formatting" line, single Export (Excel) button |
| Stack Ranking | **Analyst 316 rows, TL 23, AM 8 all load** (was "Failed to load stack ranking data."), quality cells coloured |
| Alerts, Outliers & Actions | load, no failed calls |
| POA (Internal/External) | 18 tables; pastel + solid green/amber/red fills present |
| Console / page errors | None; no 4xx/5xx on any onfido-process call |

**Observations (not bugs):** Approved HC is blank on Overview and in Capacity Builder ("Approved HC has not been entered"), so Buffer % and Shortfall show "-" until WFM enters it via "Manage approved HC". Audit Sampling renders 3,005 rows in one table (slow to paint on a weak machine; a page cap would help).

**Not verified live:** a real Utilization bulk-upload save with the calculated columns (would write production data; verified against a throwaway DB and in the browser with a mocked API instead), and migration 1916 status (Utilization page loads fine after deploy, which reads the new columns only on upload).

---

## 2026-09-30 (later) — Utilization: uploaded static values instead of formulas

**Method:** temporary Vite harness (mocked API, canEdit=true), headless Playwright Chromium, real CSV file upload; harness removed. SQL run against a throwaway `mysql:8` container (migration 1845 + new 1916, then the exact upsert/select statements taken from the service source).

| Check | Result |
|---|---|
| Utilization tab, "Bulk upload (CSV)" (canEdit=true) | Button enabled |
| CSV with `Utilization Forecaste`, `Utilization with Adhoc %`, `Escalated %` columns | "1 day(s) ready"; Save -> "Saved 1 day(s)."; PUT payload carries fixedUtilizationForecast 52447, fixedUtilizationWithAdhocPct 114.4 (the "%" stripped), fixedEscalatedPct 0.31 |
| Migration 1916 on MySQL 8 | Applies cleanly (re-run correctly errors "Duplicate column", runner records it once) |
| Upsert twice + select | Row stored/updated, all seven fixed_* values read back exactly |
| Trends tab | Both error-rate charts show 0.75% / 1% reference lines (4 lines), no errors |
| Console / page errors | None |

**Behaviour:** an uploaded value wins per column (including 0); a blank falls back to the existing calculation, so previously entered data is unchanged. The MTD row is still computed from the daily inputs.

**Not verified:** live site (login); migration on the real production DB (it runs automatically at backend boot after deploy); Client & Document tab (not modified in a way that touches error colouring).

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

### 2026-09-30 (follow-up) — Operations Command verified on REAL data

**Method:** localhost-only preview API (`scripts/ops-preview-server.mts`, ORG_ALL scope, SELECT-only) over the production `mas_hrms` read path, plus the page rendered by Vite (temporary harness, deleted afterwards) and driven by headless Playwright. DB credentials were passed as environment variables only; none written to files.

**Fixed by running on real data (all passed unit/type checks before):**
- `employees.designation` does not exist in production (join `designation_master` via `designation_id`).
- `lms_learner_progress.course_completion_pct` does not exist in production; removed from records + agent drawer.
- Performance: first build took ~100s per summary (production DB fetches wide rows slowly; a plain group-by over 30k attendance rows = 21s). Rewrote to load the scoped employee list once (scope still enforced in SQL) and scan each fact table once, both cached 5 min with stale-while-revalidate; all aggregation in memory. Now: cold first load ~27s, warm 0.6–2s.

**Endpoints exercised on production data, all OK:** definitions, filters, summary (branch/process/lob/manager/employee + branch filter), previous, trend, performance (process/branch/employee), heatmap, records (all 11 domains + single-day drill), employee detail, employee day-by-day.
**Real numbers seen (30 days to 29/09/2026):** HC 1,076; joiners 211; exits 123; attrition 11.9%; attendance 60.3%; shrinkage 39.8% = absence 18.3% + missing-punch 21.4% (unresolved punches dominate); mandate fill 131.7%; open positions 40.
**Browser:** overview, tabs, drill by branch, analyst drill, Agent 360 drawer for a real employee: zero console/page errors, zero non-200 API responses.

**Still NOT verified:** login-gated real page with a JWT and role scope (preview used ORG_ALL); BRANCH/PROCESS/TEAM scoped roles against production; migration 1915 (incl. covering attendance index `idx_ops_adr_cover`) not applied to production — cold-load time will drop once it is; nothing deployed.

### 2026-09-30 (follow-up 2) — insights, risk, cohorts, forecast, freshness, agent KPIs, export

Verified on production data via the localhost preview API + Playwright (zero console errors, zero non-200):
- Insights (14 real items, e.g. 21.4% of scheduled days have no usable punch; Onfido attrition 30.6% with 61 of 74 exits inside 90 days; NOIDA-2 49 absconding exits).
- Joiner-retention cohorts (real: only 25–36% of Apr–Jun joiners were still employed at 90 days).
- Agent retention-risk score (thresholds recalibrated on the real score distribution: high >=65, medium >=45), 14-day roster-vs-mandate forecast, data-freshness chips (Process feeds stale since 11/09 flagged red), Agent KPI matrix from kpi_daily_actual (274 agents), tiny-group attrition guard (avg HC < 10 → not shown).
- Not exercised: `/export` CSV download (auth-only route; needs JWT), scoped roles, production deploy, migration 1915.

### 2026-09-30 (follow-up 3) — scope, export, tests, bundle

- **Scoped roles on production data** (service functions with real scope objects): BRANCH_ALL NOIDA totals HC 441 = branch row 441; PROCESS_ALL Onfido 252 = 252; TEAM_ONLY (a manager's 159 reports) 152 = 152; branch-A scope asking for branch B → HC 0; empty CUSTOM_SCOPE → 0; records/heatmap/insights/cohorts honour scope; `employeeInScope` true for own branch, false for another branch's employee.
- **Export CSV** route tested with the real router (auth stubbed): formula-injection neutralised, negative numbers stay numeric, unknown columns dropped, `operations_command_export` audit written, 400 without a valid column.
- **Unit tests** `backend/tests/ops-command.test.ts` (13) + `ops-command.export.test.ts` (2): all pass. One test caught a real bug (`backfill_need` ignored the mandate gap) — fixed.
- **Frontend bundle** `vite build` succeeds (OperationsDashboard chunk emitted).
- **Still not done:** deploy to production and applying migration 1915 (server access blocked by the permission system); a login-gated run with a real JWT.

---

## 2026-09-30 — Process Operations KPI Metrics redesign (KPI Command Deck, metric drill-down, Voice of the Customer hub, All Processes)

**Method:** Real backend route (`process-operations.routes.ts`, incl. the new `/portfolio`) served from a temporary harness against the **production database, read-only** (every non-SELECT statement rejected in code; 0 blocked, 0 attempted). Dev-only demo token for auth (no real user's login used). Real frontend page `ProcessOperationsPage` in Vite, with `DashboardLayout` stubbed. Driven with Chrome DevTools MCP (visible) and headless Chrome via Playwright. Harness files deleted afterwards.

| Area | Result |
|---|---|
| KPI Command Deck (health ring, feed-stopped banner, needs-attention charts, rows / tiles / day matrix, search, filters) | Renders with live figures. Bella-Vita: 5 on target, 9 below, 32 without target; feed newest 2026-09-10 (20 days old) |
| All 45 processes with metrics, desktop 1500px and phone 390px | 88 of 90 page-loads clean on the first full pass; the 2 misses (HOUSING_COM, HUMAN_RESOURCES) rendered fine when loaded individually (load timeouts under sweep). 0 console/page errors |
| Phone layout | Found and fixed page-level horizontal overflow in 35 of 45 (legacy Executive Brief / Action Board fixed grids, sticky header). Rechecked: scrollWidth == viewport |
| All Processes view (`?view=portfolio`) | 45 processes, 682 metrics, average health 46%, all 45 feeds stopped (20–21 days), 479 metrics without a target |
| Metric drill-down popup | Width 840px of 1500px (56%). Hero stats, day-by-day chart with target / 7-day average / volume, weekday pattern, distribution, calendar, findings, readings table with gap and volume columns. Call quality: below target on 9 of 9 days |
| Voice of the Customer hub | One full-width hub with 4 tabs (Overview, Scenarios, Risk & signals, Repeat & fraud); every tab opened and rendered live content (120 audited calls that day). One "Voice of the Customer" heading; the duplicate "Customer risk flags" chart and 6 scattered panels removed |
| Misleading indicators | "100% HEALTHY" for a process with zero targets now reads "NO TARGETS SET"; green pulsing LIVE pill now amber "DATA 20d OLD" when the feed is stale |

**Not verified:** a real production login / role scoping (harness used a demo super-admin token); dark mode; the summary-tile popup (CEO strip) was widened by CSS but my automated click on it did not open it, so its width was not measured; the `/portfolio` endpoint has no unit test (no DB in tests), only live-data checks.

---

## 2026-09-30 — Business datapoints for every Process Performance V2 company, day-by-day people/team-leader drill-down, Operating % fix

**Method:** Same as the entry above (real backend routes + production database read-only through a temporary harness that rejected every non-SELECT, demo-token auth, Chrome DevTools MCP + headless Chrome; harness removed afterwards). Dialler-based sources and the P&L calculation could not run from the harness (no dialler credentials; the calculation exceeds a remote link's limit), so those were verified on the production server itself by running the deployed service code read-only.

| Area | Result |
|---|---|
| Business datapoints (14 processes) | Live: Housing Owner ₹32.1L / 845 sales; Housing Premium ₹23.5L; Appreciate Wealth ₹26.2L; Lawyer Panel 57,744 + 37,055 calls; Bella-Vita turnover ₹42.83L, 4,727 sales, ₹906 AOV, 65.5% prepaid, 13.6% RTO, identical to the TPZ Overall Dashboard; Bla Bli Blu falls back to its last upload month (Aug). Inbound (server): Bella-Vita 18,219 offered / AL 90.2% / SL 79.4%; Clovia 98.3%; Exicom 96.7%; Viega 94.7%; DU Bangladesh 91.0%; Dalmia fractions x100 confirmed |
| Presentation | Headline strip (max 4, each figure shown once), sparklines, themed collapsible sections, funnels, durations as 3m 36s, partial-failure note |
| Day-by-day drill-down | Bella-Vita shrinkage by team leader: Pooja Sidhi's team 23.5% vs 10% target, red most days; quality by person/team leader loads (slow: ~160s remote) |
| Operating % / revenue blank | Root cause found on the server: one P&L query (salary-assignment lookup, correlated subquery) ran >160s so the org-wide calculation never finished. Rewritten to one pass (identical on 13/14 processes compared; the 14th differed only by an arbitrary tie the new tie-break now reproduces). Calculation now 77s cold. After it completes: Bella-Vita revenue ₹17.46L, Operating % 35.5% (Aug payroll, labelled); Neemans ₹7.02L, 3.3% |

**Not verified:** a real production login / per-role scoping; that the app's own 60s-after-start warm-up populates the cache (verified with an equivalent cold-then-warm run in a separate process); Housing Owner Operating % (no payroll rows for Aug or Sep, a genuine data gap); Satya Retail (no process record); dark mode.

---

## 2026-09-30 — Remaining Process Performance V2 dashboards added to Business datapoints

**Method:** Same read-only harness against production (every non-SELECT rejected; 0 blocked), plus a check of every V2 route file's own endpoint for the same window. Dialler-dependent pieces (Dalmia, inbound groups) run on the production server with the deployed build. Harness and temporary server files removed afterwards.

| Check | Result |
|---|---|
| KPI page vs the V2 dashboard's own endpoint, same window | 24 of 24 compared values identical: Bella-Vita turnover ₹42,83,504, chats 39,207, chat revenue ₹3,58,873, carts 40,347, recovered revenue ₹9,42,144; GNC turnover, abandon-cart sales 940 / ₹37,23,038, chats 8,067; Housing Owner ₹32,10,033; Housing Premium ₹23,49,747; Birlanu; Clovia emails 1,965 / audit 91.14% / CSAT 93.21%; Appreciate Wealth inbound 64, outbound 6,983, dialler 3,993; Lawyer Panel 57,744 / 37,055 |
| Neemans sales, cart, productivity | V2 shows 0 for September; the KPI page shows no section for an all-zero source (by design) |
| Server: Dalmia extras | 940 tagged calls (420 query / 353 request / 167 complaint), utilisation 39.3%, after-hours leads 467, calls by language with a 10-stage share list |
| Server: Clovia channels | Emails 1,965; CSAT 93.2%; audit 91.1%; outbound 3,270 calls at 89.8% connected; rechurn 426 |
| Server: Satya Retail adapter | 10,117 shops allocated, 174 orders, ₹2,79,920 order value, 28,163 call attempts |
| Server: Bella-Vita chat / cart, GNC abandon cart | Load with funnels (4 and 5 stages) |

**Not verified:** a real production login and per-role scoping; the new sections were not re-rendered in a browser this round (same component as the earlier verified layout); Satya Retail cannot appear on the KPI page until a process record for it exists (none in process_master); Puresta has no dashboard in V2 either.
## 2026-09-30 - Roster Command Center modernisation (all tabs) - mocked-API browser run + real MySQL 8 run

**Method:** real app under Vite, Playwright Chromium at 1440 px and 375 px, fake JWT (super_admin), `/api` mocked with payload shapes read from the panels' types; ok / empty / error variants. Backend SQL exercised separately on a throwaway MySQL 8.0 (docker) with seeded edge cases: about 820 GET calls over every roster-analytics / roster-intelligence / roster-audit / wfm-compliance / intervention / roster-imports route, plus the amendment POST, intervention PATCH and digest sends.

**Pages checked:** `/wfm/roster-command-center` tabs live, team-roster, analytics, trends, compliance, shifts, interventions, audit, roster-view, comparison, capacity, fairness; old URLs `/wfm/roster-view`, `/wfm/team-comparison`, `/wfm/capacity-dashboard`, `/wfm/weekoff-fairness`, `/wfm/roster-analytics` redirect to the matching `?tab=`.

**Seen:** every tab renders with data, zero console/page errors, no "Failed to load", no horizontal overflow, one sidebar (merged pages render bare inside the console). One row per tab opens the right-hand drawer by click and Enter; empty sections show "None". Error variants show a banner with Retry. Real MySQL run: 0 SQL errors; totals agree across summary / list / detail endpoints; no NaN; percentages within 0-100.

**Bugs found by these runs and fixed:** Audit tab read a non-existent `.data` field (whole tab dead); sticky filter bar hidden under the top bar; merged tabs scrolled off-screen at 1440 px; Live tab showed "All clear" on error; `GET /wfm/roster-imports/status-summary` was shadowed by `/:batchId` (400); `workforce_mandate.shrinkage_buffer_pct` does not exist (budget silently stuck at 8%).

**NOT verified:** production data and volumes (the unbounded quality query took ~115 s on a large range in an earlier measurement); real login and per-role tab visibility (only super_admin); write actions against production; dark theme; screen reader; `db_audit` collation in production (`intervention-cases.service.ts` joins `cqa.User` to `employees.employee_code` without COLLATE, as existing code does). Mock payloads are my reading of the types, not captured responses.

## 2026-09-30 — GNC_APR source repoint + KPI compute dry-run
- Migration 1930 repointed KPI source GNC_APR from stale `db_masmis.gnc_apr` (no `pause_seconds`) to own `gnc_apr_daily_actual`; verified on prod (`source_object = gnc_apr_daily_actual`). Table is empty until GNC uploads its APR.
- Manual dry-run of `computeStudioKpis` for 2026-09-29 on prod (nothing written): 1040 definitions, 592 would be written, 87 no-data, 0 errors (the pause_seconds error is gone). One source failure: dialler table `vicidial_agent_log_11_5` is marked crashed (BELLA_AGENT_LOG) -- dialler DBA must repair.
- The compute only handles yesterday, so it does not backfill the ~20 stale days.
- Finance tiles now say "Calculating…" and re-check every 15s while the server's first P&L calculation runs (not reproduced visually after deploy).

## 2026-09-30 — WFM Capacity Dashboard: per-process coverage, mandate edit, speed
- Files: workforce.mandate.routes.ts, WFMCapacityDashboard.tsx, ops-command.indexes.ts, migration 1921.
- Checked (Playwright chromium, temp harness page, mocked /api, harness deleted): per-process rows render (mandated/required/active/available/coverage/gap), no "Failed to load", zero console/page errors. finance_head: Mandate buttons shown, Save disabled until reason entered, PATCH body correct. team_leader: no edit buttons.
- Live DB (read-only): 21 active mandates; long-leave query measured ~3.6s without a covering index.
- NOT verified: per-process GROUP BY queries and PATCH scope check against a DB through the real handler; migration 1921 and index idx_lr_capacity_cover not yet applied; login-gated real page; production data.

## 2026-09-30 — BLA/BLI/BLU dashboard placement (commits f80261c, 2705d7d)
- Cause of "not visible under Bla Bli Blu": the view only existed as a sub-tab of the Bella-Vita sales toggle; process BLA_BLI_BLU was missing from PROCESS_SALES_MAP, so its Sales Dashboard tab said "No sales dashboard". Now mapped (code or name match) and still available under Bella-Vita.
- Data on prod: bla_bli_blu_overall_sales_raw = 2,400 rows, all August 2026; bla_dash_received = 0 rows. Dashboard now opens on the latest month with data (banner says so). Server-side check: Aug = 31 days, 2,063 real-time sales, Rs 13.73L, 13 product rows; workable/target columns 0 until Received Data is uploaded; September empty.
- Not verified in a browser this time (both browser tools were locked by a stale session); verified via server-side service call and passing tests.

## 2026-09-30 — BLA/BLI/BLU sheet-by-sheet review, analytics, abandon uploader (bb2fc09 + analytics commit)
- Workbook has 6 sheets (Received Data, Overall Sales, Target Inputs, Formula Demo, Product Wise Sales, Dashboard Build PKT; none hidden, no charts). All Formula Demo formulas re-checked against bla-metrics.ts: definitions match.
- Gaps found and fixed: no analytics beyond one line chart (added funnel, campaign/payment/sale-type donuts, order status, channel, hour, weekday, manpower, agent leaderboard, insights); product table dropped the Repeat campaign (added a Repeat/other column); manpower KPIs (HC/attendance) were skipped although HRMS has them (added).
- Data gaps (prod, Aug 2026): 27% of Real Time Sales orders have no delivery status (RTO understated; now stated on the page); no attendance rows for Bla Bli Blu in Aug (present-based ratios show blank, page says so); Received Data = 0 rows; Inbound/Repeat campaigns have no targets or received data.
- Bulk Upload Hub: new type BLA_BLI_BLU_ABANDON (Received Data -> bla_dash_received, replaces by date), migration 1940.
- Verified on prod via server-side service call: Aug = 2,063 sales, Rs 13.73L, 23 agents selling, prepaid 69%, RTO 5.6% of updated orders. Not re-verified visually in a browser (browser tools locked).

## 2026-09-30 — Offer Approvals: bulk approve (/ats/offer-approvals)
- Files: src/pages/NativeBranchHeadApproval.tsx only. No backend or SQL change — each selected offer goes through the existing `POST /api/ats/onboarding/offers/:id/approve`, one after another.
- Checked (Playwright chromium, vite dev, mocked /api, fake JWT; `npm run build` passed): row checkboxes and select-all render; an offer whose salary is not validated cannot be selected; ticking a checkbox does not open the journey drawer; "Approve selected" opens a confirmation listing the candidates; Cancel sends nothing; confirm sends one approve per offer in order with that row's remark; progress text shows; result banner lists approved employee codes and the failed candidate with the server's message; the failed row stays selected; list and tab counts refresh. No "Failed to load", no page errors from the new code.
- NOT verified: real login, real production data, a real approval through the backend (approval creates an employee, so it was not exercised against production); behaviour with a very large selection.

## 2026-09-30 — Analytics catalogue + Dashboard Studio (builds 2e89b76 .. 446c41c)
- Catalogue (`/api/analytics-catalogue`, migration 1950): 5 seeded datasets. Prod queries as mas47814 matched known figures (BBB Aug sales 2,063 orders / Rs 13,73,135; Bella-Vita weekly occupancy 67.5% / 66.7%; 1,093 active employees). Asking for `ctc` on headcount -> 400 "Unknown field". NOTE: mas47814 is organisation-wide, so branch/process restriction is proven by unit tests only, not by a restricted prod user.
- Dashboard Studio (`/dashboard-builder`, `/dashboard-builder/:id`, migration 1951): on prod created a dashboard from the "Bla Bli Blu sales" template (10 widgets, real numbers), entered edit mode, selected a widget (Data/Style panel), added a Treemap (gallery shows 35 types in 8 groups), undo/redo, saved ("Dashboard saved"), reloaded (11 widgets persisted, deep link works). Click-to-filter: Orders 2,063 -> 305 for one agent -> cleared. Share dialog lists 18 roles / 395 processes. Admin Datasets screen lists datasets and 6 connections (no dataset was saved as a test).
- All 35 chart types viewed locally with sample data in light and Midnight themes (temporary gallery, deleted). Phone 390px on prod: single column, scrollWidth 390.
- Bugs found in this pass and fixed: every dashboard opened as "unsaved"; a click on a title counted as a drag and did not select; heatmap hour columns unordered; pie labels collided; bullet/progress lists clipped; breadcrumb showed the raw id.
- Not verified: sharing as a second real user; drag/resize by mouse (only programmatic layout tested); flow diagram and Sankey with production data; PDF print layout; registering a new dataset end to end.
- A test dashboard "Bla Bli Blu sales" now exists on prod under mas47814.

## 2026-09-30 — KPI Studio v2 (builds a9fac72, 6ace07e)
- Back end: authoring, previews, manual values, compute and data-source changes are refused (403 OUT_OF_SCOPE) outside the caller's assignment scope; `/compute-range` job (max 62 days, dry run unless dry_run=false); retire ends a definition by date (active_status stays 1); employee-grain query honours date_format; list returns in_force / starts_later / grain. 446 backend tests (kpi + process-operations + analytics-catalogue) and 1,061 front-end tests pass.
- Prod browser check as mas47814 (organisation-wide): Definitions shows 1,039 rules, 50 per page, status badges, actions menu (Who / History / Edit / Copy / End); Edit opens Build a KPI prefilled with the "new version from today" banner (NOT saved). Data Sources: Add form offers all six source types. Compute: range panel defaults to "Preview only".
- Range job run on prod in PREVIEW mode (nothing written): Bella-Vita 2026-09-08..09 -> both days done, 40 and 47 values would be written, 1 no-data each, 0 errors, ~320 s per day; both days report source failure BELLA_AGENT_LOG "Lock wait timeout exceeded" (dialler agent-log table, known issue). Site health stayed 200.
- Not verified on prod: any real save (definition save / end / copy, data-source save, non-preview compute); the 403 paths with a restricted user (unit and route-contract tests only); Explain drawer with real data; phone width for KPI Studio.
- Known limits: range jobs are in memory (lost on restart / deploy); one range at a time; upload/commit of employee values is not yet scope-checked per row.

## 2026-09-30 — BBB Received Data upload rules (Today_Only_Data_Upload_Logic_Requirement) (builds a005bd6 .. 77da7c7 live; eda3b33, 46adb46 NOT live)
- Built: one row per date + 10-digit number (repeat rejected as duplicate), Fresh / NC derived from the previous 1-3 days, one trashable batch per file (Trash / Restore), sales upload history + delete, "Uploaded files" panel, same rules in the dashboard uploader and Bulk Upload Hub (`BLA_BLI_BLU_ABANDON`). Migrations 1961 (structure only), 1964 (`bla_dash_received_daily`, `bbb_upload_batch`).
- Prod check as mas47814 with a fake file dated 2020-01-01..06: first upload stored 4 of 6 (1 same-day duplicate, 1 no number), statuses 1 Jan Fresh / 2 Jan NC / 6 Jan Fresh; re-upload stored 0 with 5 duplicates. Trash: 4 rows trashed, 2020 Fresh Base 3 -> 0 (503 ms). Aug 2026 overview 827 ms (Fresh Base 63,682, workable 50,872, sales 2,063), uploads list 382 ms.
- BROKEN on the live build: Restore puts the rows back (4 restored) but the summary refresh fails ("Column 'le30' cannot be null" on days with no rows), batch shows state `failed`, dashboard keeps 0 for those days. Fixed in eda3b33 (COALESCE), not deployed. Test batch bd4c2649 left in the trash.
- Outage 20:02-20:09 IST, caused by this work: migration 1961 first shipped with a bulk UPDATE over 126,612 rows, startup exceeded the health wait, pipeline rolled back. Migration made structure-only (cc616b1). Rule since: no bulk data statements in startup migrations.
- Deploy of eda3b33 (run 36736845622) failed: backend refused connections for the whole 400 s health wait, rolled back (site 502 until ~21:08 IST). Two other pending migrations (1952, 1970: new tables with a foreign key to process_master) were not applied; cause not confirmed (no server log access at the time). Not redeployed.
- Not verified: daily summary for 2026-04..07 (catch-up failed on the le30 bug; ~100 rows); Restore after the fix; sales delete with a real batch; returning number after more than 3 days is treated as Fresh (owner to confirm).
