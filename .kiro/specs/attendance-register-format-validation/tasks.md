# Implementation Plan

## Overview

This plan implements the design in `design.md` for the Attendance Register Format Validation spec. It has three parts: (1) a pure day-label helper function written once per project (frontend and backend, since they share no package) that turns month-agnostic `day_N` columns into "Mon-DD" labels at render/export time; (2) wiring that helper into the on-screen preview and the XLSX export so both show identical calendar-date headers; and (3) a documented validation pass that spot-checks the executor's attendance-status mapping and summary arithmetic against real staging data. No changes are made to the executor's SQL, pagination logic, or either catalog's role arrays.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": [1, 3, 6, 9],
      "description": "No dependencies on other tasks in this plan: the two helper modules, the backend catalog column-list expansion, and the staging data validation script can all start immediately and in parallel."
    },
    {
      "wave": 2,
      "tasks": [2, 4, 5, 7],
      "description": "Depend on wave 1: unit tests for each helper (2 depends on 1, 4 depends on 3), the frontend wiring (5 depends on 1), and the backend export route change (7 depends on 3 and 6)."
    },
    {
      "wave": 3,
      "tasks": [8],
      "description": "Depends on 6 and 7: the header-parity contract test asserts the set-membership and column-declaration state those tasks create."
    },
    {
      "wave": 4,
      "tasks": [10, 11],
      "description": "Depends on all of 1-9: the full test suite and typecheck run only make sense once every prior change is in place. Task 11 (found during Task 7/10 review) closes the same header-parity gap for the async worker export path and has the same dependency on Tasks 3 and 6."
    }
  ],
  "edges": [
    { "from": 1, "to": 2 },
    { "from": 1, "to": 5 },
    { "from": 3, "to": 4 },
    { "from": 3, "to": 7 },
    { "from": 6, "to": 7 },
    { "from": 6, "to": 8 },
    { "from": 7, "to": 8 },
    { "from": 1, "to": 10 },
    { "from": 2, "to": 10 },
    { "from": 3, "to": 10 },
    { "from": 4, "to": 10 },
    { "from": 5, "to": 10 },
    { "from": 6, "to": 10 },
    { "from": 7, "to": 10 },
    { "from": 8, "to": 10 },
    { "from": 9, "to": 10 }, { "from": 3, "to": 11 }, { "from": 6, "to": 11 }
  ]
}
```

Tasks 1 and 3 (the two helper modules) have no dependencies on each other and can be done in either order or in parallel. Task 6 must land before Task 7, since Task 7''s `withDayColumnLabels` call is a no-op without the day-column keys Task 6 adds to the backend catalog. Task 9 is independent of the header-format work and can run at any point once the staging DB is reachable.
## Tasks
- [x] 1. Create frontend day-label helper module
  - Create `src/lib/attendance-register-columns.ts` with the fixed `SHORT_MONTHS` literal array (`Jan`..`Dec`), and exported functions `buildDayColumnLabel(month: number, day: number): string` (returns `"Mon-DD"`, 1-indexed month, zero-padded 2-digit day), `daysInMonth(year: number, month: number): number` (mirrors `new Date(year, month, 0).getDate()`), and the generic `withDayColumnLabels<T extends { key: string; label: string }>(columns: T[], monthStr: string | undefined): T[]`.
  - `withDayColumnLabels` must: return `columns` unchanged when `monthStr` is `undefined` or fails `/^\d{4}-\d{2}$/`; for every column whose `key` matches `/^day_(\d+)$/`, drop it if its day number exceeds `daysInMonth(year, month)`, otherwise return a copy with `label` overridden to the `buildDayColumnLabel` result; pass every non-matching column through with its original label unchanged.
  - Add a top-of-file comment cross-referencing `backend/src/modules/reporting/attendance-register-columns.ts` and stating the two files must be kept logically identical.
  - _Requirements: 3.1, 3.2, 3.4_

- [x] 2. Write unit tests for the frontend day-label helper
  - Create `src/lib/attendance-register-columns.test.ts` (Vitest, matching the project's existing frontend test runner).
  - Cover: a normal 31-day month (`"2026-07"`) mapping `day_1`→`"Jul-01"` and `day_31`→`"Jul-31"`, with no output label containing the substring `"Day"`; a non-leap February (`"2025-02"`) where `day_28`→`"Feb-28"` and `day_29`/`day_30`/`day_31` are absent from the output; a leap February (`"2024-02"`) where `day_29`→`"Feb-29"` and `day_30`/`day_31` are absent; a 30-day month (`"2026-04"`) where `day_30`→`"Apr-30"` and `day_31` is absent.
  - Assert calling the function twice with two different month strings on the same base columns produces two different label sets.
  - Assert non-day columns (`sno`, `emp_code`, ..., `total`) pass through with their original label unchanged for every month case above.
  - Assert malformed/missing month input (`undefined`, `""`, `"2026"`) returns the input columns array unchanged.
  - Run the test file and confirm it passes before moving on.
  - _Requirements: 3.1, 3.2, 3.4_

- [x] 3. Create backend day-label helper module
  - Create `backend/src/modules/reporting/attendance-register-columns.ts` with an implementation logically identical to the frontend module from Task 1: same `SHORT_MONTHS` array, same `buildDayColumnLabel`, `daysInMonth`, and `withDayColumnLabels<T extends { key: string; label: string }>` signatures and behavior.
  - Add a top-of-file comment cross-referencing `src/lib/attendance-register-columns.ts` and stating the two files must be kept logically identical.
  - _Requirements: 3.1, 3.2, 3.4, 3.5_

- [x] 4. Write unit tests for the backend day-label helper
  - Create `backend/src/modules/reporting/__tests__/attendance-register-columns.test.ts` (Vitest, matching the `__tests__` convention already used in that directory).
  - Use the same fixture table of `(monthStr, dayNum) -> expectedLabel` cases as Task 2's frontend test file (31-day month, non-leap February, leap February, 30-day month, non-day passthrough, malformed/missing month input) so the two test files assert against identical expectations.
  - Run the test file and confirm it passes before moving on.
  - _Requirements: 3.1, 3.2, 3.4, 3.5_

- [x] 5. Wire the frontend helper into ReportLibraryView.tsx
  - In `src/components/reports/views/ReportLibraryView.tsx`, import `withDayColumnLabels` from `@/lib/attendance-register-columns`.
  - Add a memoized `displayColumns` derived value: `useMemo(() => withDayColumnLabels(selectedReport?.columns ?? [], filterValues.month), [selectedReport, filterValues.month])`, placed alongside the component's other `useMemo` declarations.
  - Replace both existing `selectedReport.columns.map(col => ...)` call sites (the header `<th>` row and the body `<td>` row) with `displayColumns.map(col => ...)`, keeping all existing className/alignment/formatting logic unchanged.
  - Verify the change compiles/typechecks and does not alter rendering for any report other than `attendance-register-monthly` (no other catalog entry declares `day_N` keys today).
  - Fix (found during implementation, not in original design): the header `<th>` row applies a global `uppercase` CSS class to every report equally, which would visually render "Jul-01" as "JUL-01" on screen, mismatching the exported file's literal casing and Requirement 3.1's exact "Mon-DD" format. At the header `<th>` render call site only, make the `uppercase` class conditional so it is omitted when `col.key` matches `/^day_(\d+)$/`, leaving every other column and every other report's header styling unaffected.
  - _Requirements: 3.1, 3.2, 3.3, 3.5_

- [x] 6. Extend the backend catalog's column list for attendance-register-monthly
  - In `backend/src/modules/reporting/report-catalog.ts`, locate the `attendance-register-monthly` entry's `columns` array (around line 4590-4620).
  - Replace the partial column list with the full column set matching the frontend catalog's (`src/lib/report-catalog.ts`) keys, labels, and order exactly: `sno`, `emp_code`, `bio_code`, `emp_name`, `department`, `designation`, `profile`, `cost_center`, `emp_location`, `billable`, `day_1` through `day_31` (placeholder `"Day N"` labels, `format: "text"`, `width: 150`), `absent_count`, `present_count`, `od_count`, `hd_count`, `leave_count`, `holiday_count`, `weekoff_count`, `sal_days`, `total`.
  - Do not modify `viewRoles`, `exportRoles`, `filters`, `sourceTables`, `branchScoped`, `processScoped`, `sensitivityLevel`, or `containsPII` on this entry — only the `columns` array changes.
  - _Requirements: 1.2, 1.3, 1.4, 7.1_

- [x] 7. Extend the backend export route to use label-verbatim export for attendance-register-monthly
  - In `backend/src/modules/reporting/report-suite.routes.ts`, add `"attendance-register-monthly"` to the `CATALOG_FORMAT_CODES` set (line ~45), alongside the existing `"leave-utilization"` entry.
  - Import `withDayColumnLabels` from `./attendance-register-columns.js`.
  - At the `CATALOG_FORMAT_CODES.has(code)` branch (~line 321), compute `exportColumns` as `withDayColumnLabels(catalogEntry.columns, filters.month)` when `code === "attendance-register-monthly"`, otherwise `catalogEntry.columns` unchanged, and pass `exportColumns` (not `catalogEntry.columns`) as the `columns` argument to `buildCatalogWorkbook`.
  - Do not change any other logic in the export handler (row fetching, pagination, caps, filename, audit logging).
  - _Requirements: 1.4, 3.3, 3.5_

- [x] 8. Write the header-parity contract test
  - Create `backend/src/modules/reporting/__tests__/attendance-register-header-parity.contract.test.ts`, following the source-parsing style of the existing `catalog-frontend-parity.contract.test.ts` (no live DB).
  - Assert the backend catalog's `attendance-register-monthly` entry declares `day_1` through `day_31` keys in its `columns` array (so `withDayColumnLabels` has a full month's worth of columns to act on).
  - Assert `"attendance-register-monthly"` is present in the `CATALOG_FORMAT_CODES` set declared in `backend/src/modules/reporting/report-suite.routes.ts`.
  - Run the test and confirm it passes.
  - _Requirements: 3.5_

- [x] 9. Write and run the data validation script against staging
  - Create `backend/scripts/validate-attendance-register-format.ts`, runnable manually (e.g. via `tsx`) against the staging `mas_hrms` database using the existing `backend/.env` credentials.
  - Implement: (a) query `employees` for 3-5 active employee IDs with at least one `attendance_daily_record` row in a chosen real month, across a mix of departments/branches; (b) for each sampled employee, query `attendance_daily_record` directly for `record_date`/`attendance_status` in that month, tally counts per status in JS using the same status map the executor uses (`present`→P, `absent`→A, `half_day`→HD, `week_off`→W, `holiday`→H, `leave_approved`→L, `on_duty`→OD, `unreconciled`→A), and compute expected `SalDays` as `present + half_day*0.5 + on_duty + holiday + week_off`; (c) call `attendanceRegisterMonthly(...)` (or the `/api/reports/suite/attendance-register-monthly` endpoint) for the same employees/month and diff the returned `day_N` codes and summary counts against the independent tally; (d) log any mismatch with employee ID/code, date, expected vs. actual status or count; (e) confirm at least one sampled employee has a day with no `attendance_daily_record` row and that it renders as an empty string in `day_N`, not a fabricated code.
  - Run the script against the staging `mas_hrms` database (host `122.184.128.90`) and record its output.
  - Append the findings (pass/fail per check, and details of any mismatch: employee, date/month, expected vs. actual value) to a `validation-findings.md` file alongside this spec's `design.md`, triaging any mismatch as either a mapping defect (out of this spec's header-format scope) or a pre-existing data-quality issue (documented, not remediated).
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.2, 5.3_

- [x] 10. Run the full test suite and typecheck
  - Run the backend test suite (`cd backend && npx vitest run`) and confirm all tests pass, including the new unit tests (Task 4) and contract test (Task 8), and that no existing test (e.g. `catalog-frontend-parity.contract.test.ts`, `emitted-columns-are-catalogued.contract.test.ts`) regresses due to the catalog column-list change in Task 6.
  - Run the frontend test suite covering `src/lib/attendance-register-columns.test.ts` (Task 2) and confirm it passes.
  - Run backend typecheck (`cd backend && npm run typecheck`) to confirm the route and catalog changes compile cleanly.
  - _Requirements: 1.1, 1.2, 1.3, 6.3, 7.1, 7.2_

- [x] 11. Extend the async report-generation worker for label-verbatim export parity
  - Found during Task 7/10 review, not in the original design: `backend/src/workers/report-generation.worker.ts` (used for scheduled/emailed report deliveries, separate from the immediate `/export` route fixed in Task 7) calls `buildSecureXlsxBuffer` directly with no `CATALOG_FORMAT_CODES` check, so an emailed or scheduled export of `attendance-register-monthly` would still show uppercased raw keys (`DAY_1`, `DAY_2`, ...) instead of "Mon-DD" labels, bypassing Task 7's fix entirely.
  - In `backend/src/workers/report-generation.worker.ts`, import `buildCatalogWorkbook` from `../modules/reporting/catalog-workbook.js` and `withDayColumnLabels` from `../modules/reporting/attendance-register-columns.js`. Import or reuse the `CATALOG_FORMAT_CODES` set � since it is currently a local `const` inside `report-suite.routes.ts` and not exported, either (a) export it from that file and import it here, or (b) declare an equivalent local set in the worker scoped to the same codes (`"leave-utilization"`, `"attendance-register-monthly"`) with a comment cross-referencing `report-suite.routes.ts` so the two stay in sync. Prefer option (a) if it does not require restructuring the router file's exports beyond adding `export` to the existing declaration.
  - Before the `buildSecureXlsxBuffer` call (around line 372), branch on whether `req.report_code` is in the catalog-format set: if so, look up the matching `REPORT_CATALOG` entry (already imported in this file) by `report_code`, compute `exportColumns` the same way Task 7 did (`withDayColumnLabels(catalogEntry.columns, filters.month)` when the code is `"attendance-register-monthly"`, otherwise `catalogEntry.columns` unchanged), call `buildCatalogWorkbook({ rows: allRows, columns: exportColumns, sheetName: catalogEntry.name })` instead of `buildSecureXlsxBuffer`, and use that buffer for the rest of the existing flow (file storage, audit logging, etc. � unchanged). Otherwise, fall through to the existing `buildSecureXlsxBuffer` call unchanged.
  - Confirm `filters.month` is available in scope at this point in the worker (check how `filters` is constructed earlier in the same function/file).
  - Do not change any other logic in this worker (chunking, row limits, retry logic, file storage, audit events).
  - _Requirements: 3.5_
## Notes

- Tasks 1-8 and 10 are pure code changes with no live-database dependency; they can be verified with the existing test runners (Vitest on both frontend and backend) without staging DB access.
- Task 9 requires reachability to the staging `mas_hrms` database (host `122.184.128.90`, credentials in `backend/.env`) � if that connection is unavailable when this task is picked up, note the blocker rather than skipping the finding write-up silently.
- No task in this plan touches `viewRoles`, `exportRoles`, the executor's SQL, or the pagination/worker-mode slicing logic in `attendanceRegisterMonthly()` � those are fixed constraints from Requirements 4, 6, and 7, and any task implementation that appears to require touching them should be flagged for re-scoping rather than proceeding.
- If Task 7's move to `buildCatalogWorkbook` produces an export file whose visual styling looks unexpectedly different (no metadata sheet, plain borders), this is an anticipated and accepted change per `design.md`'s Risk and Rollback Notes, not a defect � rollback is a one-line removal from `CATALOG_FORMAT_CODES` if it proves unacceptable.