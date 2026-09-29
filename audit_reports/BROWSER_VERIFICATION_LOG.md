# Browser Verification Log

Every UI-affecting change is opened in a real browser after building, and recorded here (rule: `CLAUDE.md` → "VERIFY IN A REAL BROWSER"). Newest first.

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
