# Design Document

## Overview

The Attendance Register (`attendance-register-monthly`) already works end to end: the executor pivots `attendance_daily_record` into `day_1..day_31` per employee, the frontend catalog declares the column order, and export/preview both render. What's wrong is format, not function:

- Day column headers read "Day 1".."Day 31" instead of the calendar date ("Jul-01".."Jul-31") ? Requirement 3.
- The backend catalog's declared column list for this report is a partial stub (no day columns, no `Profile` column) ? Requirement 1.4.
- The XLSX export path for this report goes through the generic `buildSecureXlsxBuffer`, which ignores catalog labels entirely and uppercases raw keys (`day_1` ? `DAY_1`), so the exported file's headers do not match what the on-screen preview shows even after the preview is fixed ? Requirement 3.5.
- The day-code mapping and summary arithmetic have never been checked against real `mas_hrms` data, only against code review ? Requirements 2 and 5.

This design fixes the header format and the catalog gap, adds the export path to use the same label-verbatim workbook builder already proven for `leave-utilization`, and defines a concrete data-validation procedure against staging data. It deliberately does not touch the executor's SQL, status mapping, summary arithmetic, pagination logic, or the two catalogs' `viewRoles`/`exportRoles` arrays ? those are fixed constraints per Requirements 4, 5.4, 6.3, and 7.

## Architecture

Three layers are involved, and the fix touches the labeling seam of two of them without changing the data seam of any:

```
                        +----------------------------+
                        ? attendance.executor.ts      ?
                        ? attendanceRegisterMonthly() ?  <- UNCHANGED (Req 6.3)
                        ? emits day_1..day_N (N=days  ?
                        ? in selected month), keyed   ?
                        ? by month-agnostic keys      ?
                        +----------------------------+
                                    ? rows: {day_1: "P", ...}
                    +-------------------------------+
                    ?                                ?
         preview: GET /suite/:code          export: GET /suite/:code/export
                    ?                                ?
                    ?                                ?
      ReportLibraryView.tsx                report-suite.routes.ts
      renders selectedReport.columns        picks workbook builder by code
      (frontend catalog, static)            set membership
                    ?                                ?
      +---------------------------+      +------------------------+
      ? NEW: derive day_N labels  ?      ? NEW: attendance-register-?
      ? as "Mon-DD" using         ?      ? monthly added to        ?
      ? filterValues.month,       ?      ? CATALOG_FORMAT_CODES;   ?
      ? before mapping columns    ?      ? derive day_N labels the ?
      ? to <th>/<td>              ?      ? same way before calling ?
      ?                           ?      ? buildCatalogWorkbook()  ?
      +---------------------------+      +-------------------------+
```

Both derivations run at request/render time because the static catalogs have no notion of "which month is selected" ? only the request (backend) or the filter state (frontend) knows that. The label computation is duplicated in two small, independent, unit-tested functions rather than shared, because the frontend (`src/`) and backend (`backend/src/`) are separate compiled TypeScript projects with no shared package boundary in this repo today.

The backend catalog's declared column list (Requirement 1.4) is a static edit ? it doesn't need request-time computation, only the addition of a `profile` entry (and, per the derived-label approach above, the day columns don't need to be individually declared there any more than they are today, since `buildCatalogWorkbook` receives the *derived* columns array at request time, not `catalogEntry.columns` directly).

## Components and Interfaces

### 1. Frontend: day-label helper ? `src/lib/attendance-register-columns.ts` (new file)

```ts
/** Fixed English 3-letter month names ? never locale-dependent. */
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Builds the "Mon-DD" label for a given calendar day.
 * `month` is 1-indexed (1 = January), matching the "YYYY-MM" filter format
 * already used by attendanceRegisterMonthly's `month` filter.
 */
export function buildDayColumnLabel(month: number, day: number): string {
  const mm = SHORT_MONTHS[month - 1];
  return `${mm}-${String(day).padStart(2, "0")}`;
}

/** Number of days in a given YYYY-MM month, mirroring the executor's own computation. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Given the base column list and a "YYYY-MM" month string, returns a new column array
 * where every day_N (N from 1..daysInMonth) column's label is overridden to "Mon-DD",
 * and any day_N beyond the actual days in that month is dropped (Requirement 3.4).
 * Non-day columns pass through unchanged. Returns the input unmodified if `monthStr`
 * is missing or malformed.
 */
export function withDayColumnLabels<T extends { key: string; label: string }>(
  columns: T[],
  monthStr: string | undefined
): T[] {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return columns;
  const [year, month] = monthStr.split("-").map(Number);
  const dim = daysInMonth(year, month);
  const dayKeyRe = /^day_(\d+)$/;

  return columns.reduce<T[]>((out, col) => {
    const m = dayKeyRe.exec(col.key);
    if (!m) { out.push(col); return out; }
    const dayNum = Number(m[1]);
    if (dayNum > dim) return out; // drop day columns past the month's actual length
    out.push({ ...col, label: buildDayColumnLabel(month, dayNum) });
    return out;
  }, []);
}
```

Call site in `src/components/reports/views/ReportLibraryView.tsx`: replace the two `selectedReport.columns.map(...)` calls (header row ~line 1421, body cells ~line 1441) with a memoized derived array:

```ts
import { withDayColumnLabels } from "@/lib/attendance-register-columns";

const displayColumns = useMemo(
  () => withDayColumnLabels(selectedReport?.columns ?? [], filterValues.month),
  [selectedReport, filterValues.month]
);
```

then render `displayColumns.map(col => ...)` in both places instead of `selectedReport.columns.map(...)`. This is generic on the `day_(\d+)` key pattern rather than gated on `selectedReport.code === "attendance-register-monthly"`, so it's a no-op for every other report (none of which declare `day_N` keys today) and needs no per-report branching ? satisfying Requirement 3.3's "implement at whichever layer(s) are necessary" without special-casing the component.

`filterValues.month` is confirmed as the correct key: `MONTH_FILTER` is declared as `{ key: "month", ... }` in `ReportLibraryView.tsx`, and `buildFiltersForReport("attendance-register-monthly")` returns `[MONTH_FILTER, ...]` via the `monthFilter` array, matching the executor's own `filters.month` ? Requirement 3.2's month-change reactivity falls out of this being a `useMemo` keyed on `filterValues.month`.

### 2. Backend: day-label helper ? `backend/src/modules/reporting/attendance-register-columns.ts` (new file)

Logically identical to the frontend version (same `SHORT_MONTHS` table, same `buildDayColumnLabel`/`daysInMonth`/`withDayColumnLabels` signatures), duplicated because there is no shared package between `src/` and `backend/src/`:

```ts
const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function buildDayColumnLabel(month: number, day: number): string { /* identical body */ }
export function daysInMonth(year: number, month: number): number { /* identical body */ }
export function withDayColumnLabels<T extends { key: string; label: string }>(
  columns: T[],
  monthStr: string | undefined
): T[] { /* identical body */ }
```

A code comment at the top of each file cross-references the other's path and states they must be kept logically identical, with the paired unit tests (see Testing Strategy) as the enforcement mechanism in lieu of a shared module.

### 3. Backend export route ? `backend/src/modules/reporting/report-suite.routes.ts`

Two changes at the export handler (`GET /:code/export`):

a) Extend the catalog-format set (line ~45):

```ts
const CATALOG_FORMAT_CODES = new Set(["leave-utilization", "attendance-register-monthly"]);
```

b) At the `CATALOG_FORMAT_CODES.has(code)` branch (~line 321), build derived columns from `filters.month` (already parsed at line ~249, in scope here) before calling `buildCatalogWorkbook`:

```ts
import { withDayColumnLabels } from "./attendance-register-columns.js";

if (CATALOG_FORMAT_CODES.has(code)) {
  const exportColumns = code === "attendance-register-monthly"
    ? withDayColumnLabels(catalogEntry.columns, filters.month)
    : catalogEntry.columns;

  const catalogBuffer = await buildCatalogWorkbook({
    rows,
    columns: exportColumns,
    sheetName: catalogEntry.name,
  });
  // ...unchanged from here
}
```

Because `catalogEntry.columns` for `attendance-register-monthly` in the **backend** catalog does not currently declare `day_1..day_31` individually (see Component 4 below), `withDayColumnLabels` is a no-op on those unless the backend catalog also declares them under keys matching `day_(\d+)`. This requires the backend catalog to declare the same full day-column set the frontend catalog does ? see Component 4. `buildCatalogWorkbook` already writes `cell.value = c.label` verbatim (confirmed in `catalog-workbook.ts`), so once `exportColumns` carries "Mon-DD" labels, the exported header text matches the preview exactly, satisfying Requirement 3.5.

This reuses `buildCatalogWorkbook`, already in production for `leave-utilization`, rather than modifying the generic `buildSecureXlsxBuffer` (which many other reports still depend on for its metadata sheet and styled table). This is the lower-risk path: it changes behavior for exactly one report code and leaves the generic builder, and every other report using it, untouched.

### 4. Backend catalog column-list fix ? `backend/src/modules/reporting/report-catalog.ts`

Requirement 1.4 requires the `Profile` column to be declared, and the export change above (Component 3) requires the day columns to be declared too (previously they were "generated dynamically" per a code comment and never individually listed ? which was fine while export went through the generic builder, but `buildCatalogWorkbook` needs an explicit `columns` array to know what to render and label). Replace the current partial column list for `attendance-register-monthly` (around line 4590-4620) with the full set, matching the frontend catalog's order and keys exactly (Requirement 1.3: the two catalogs must agree):

```ts
columns: [
  { key: "sno", label: "SNo", format: "number", width: 50, align: "right" },
  { key: "emp_code", label: "EmpCode", format: "text", width: 100 },
  { key: "bio_code", label: "BioCode", format: "text", width: 90 },
  { key: "emp_name", label: "EmpName", format: "text", width: 180 },
  { key: "department", label: "Department", format: "text", width: 130 },
  { key: "designation", label: "Designation", format: "text", width: 130 },
  { key: "profile", label: "Profile", format: "text", width: 100 },
  { key: "cost_center", label: "CostCenter", format: "text", width: 130 },
  { key: "emp_location", label: "EmpLocation", format: "text", width: 100 },
  { key: "billable", label: "Billable", format: "text", width: 70 },
  { key: "day_1", label: "Day 1", format: "text", width: 150 },
  // ... day_2 .. day_31, same pattern, labels are placeholders overwritten by
  // withDayColumnLabels() at export time ? see Component 3
  { key: "day_31", label: "Day 31", format: "text", width: 150 },
  { key: "absent_count", label: "A", format: "number", width: 40, align: "center" },
  { key: "present_count", label: "P", format: "number", width: 40, align: "center" },
  { key: "od_count", label: "OD", format: "number", width: 40, align: "center" },
  { key: "hd_count", label: "HD/DH/FTP", format: "number", width: 70, align: "center" },
  { key: "leave_count", label: "L", format: "number", width: 40, align: "center" },
  { key: "holiday_count", label: "H", format: "number", width: 40, align: "center" },
  { key: "weekoff_count", label: "W", format: "number", width: 40, align: "center" },
  { key: "sal_days", label: "SalDays", format: "number", width: 70, align: "right" },
  { key: "total", label: "Total", format: "number", width: 50, align: "center" },
],
```

`viewRoles`/`exportRoles`/`filters`/`sourceTables`/`branchScoped`/`processScoped`/`sensitivityLevel`/`containsPII` on this entry are left untouched ? only the `columns` array changes, satisfying Requirement 7.1's "remain unchanged" constraint by construction (the diff touches one field).

The placeholder "Day N" labels in the backend catalog's static declaration are harmless: nothing reads the backend catalog's labels for preview (preview headers come only from the frontend catalog per the investigation), and the export path overwrites them via `withDayColumnLabels` before they ever reach `buildCatalogWorkbook`. They exist only so the column *keys* are present for `buildCatalogWorkbook` to iterate and for `withDayColumnLabels` to have something to override.

### 5. Frontend catalog ? `src/lib/report-catalog.ts`

The `day_1`..`day_31` entries' static `label` fields ("Day 1".."Day 31") are left as-is in the catalog source; Requirement 3.1's removal of the generic label is satisfied by the *rendering* layer (Component 1) never using `selectedReport.columns` directly, only the derived `displayColumns`. An alternative would be editing the static labels to something neutral (e.g. empty string) since they're always overridden ? but leaving them as descriptive fallback text means any future code path that reads `selectedReport.columns` directly without going through `withDayColumnLabels` fails safe with a recognizable placeholder instead of an empty header. No changes needed to `viewRoles`/`exportRoles` here either (Requirement 7.2).

## Data Models

No database schema changes. The only new "model" is the derived column-label mapping, which is a pure function of `(monthStr) -> Map<dayColumnKey, "Mon-DD">`, applied as an in-memory transform over the existing `ColumnDef[]` / `CatalogWorkbookColumn[]` shapes ? no new persisted or transmitted data structure. Both frontend and backend versions operate on structurally compatible column-array shapes (`{ key: string; label: string; ...}`), so the same `withDayColumnLabels<T>` generic signature works on `ColumnDef[]` (frontend) and `CatalogWorkbookColumn[]` (backend) without a shared type.

Example mapping for `month = "2026-07"`:

| key | pre-transform label | post-transform label |
|---|---|---|
| `day_1` | `Day 1` | `Jul-01` |
| `day_15` | `Day 15` | `Jul-15` |
| `day_31` | `Day 31` | `Jul-31` |

Example for `month = "2026-02"` (28-day month, non-leap):

| key | pre-transform label | post-transform label |
|---|---|---|
| `day_28` | `Day 28` | `Feb-28` |
| `day_29` | `Day 29` | *(column dropped from output ? Requirement 3.4)* |
| `day_30` | `Day 30` | *(dropped)* |
| `day_31` | `Day 31` | *(dropped)* |

## Error Handling

- **Missing or malformed `month` filter**: `withDayColumnLabels` returns the input columns unchanged when `monthStr` is `undefined` or doesn't match `/^\d{4}-\d{2}$/`. On the frontend this means the day columns fall back to showing "Day 1".."Day 31" until a month is picked ? acceptable since the report already requires a month to produce any rows (the executor calls `monthParam(filters.month)`, which itself defaults; see existing `defaultFilters: { month: new Date().toISOString().slice(0,7) }` in the frontend catalog, so in practice `filterValues.month` is populated before first run). On the backend export path, the same fallback means `catalogEntry.columns`' placeholder "Day N" labels would be sent if `filters.month` is somehow absent ? this can't actually happen in practice because `attendanceRegisterMonthly()` itself calls `monthParam(filters.month)` and would use the same default, but the label function degrades gracefully rather than throwing either way.
- **Month with fewer than 31 days**: handled by construction ? `withDayColumnLabels` drops any `day_N` column where `N > daysInMonth(year, month)`, so a 30-day month's exported/rendered table simply has 30 day columns, not 31 blank ones (Requirement 3.4). This mirrors the executor's own `daysInMonth = new Date(yr, mo, 0).getDate()` computation, duplicated as `daysInMonth()` in the new helper files rather than imported (executor is backend-only; frontend needs its own copy regardless).
- **Catalog mismatch between frontend and backend for this report**: existing contract tests (`catalog-frontend-parity.contract.test.ts`, `emitted-columns-are-catalogued.contract.test.ts`) already assert cross-catalog and SQL-to-catalog agreement for mandatory identity columns; adding the full column list to the backend catalog (Component 4) brings `attendance-register-monthly` into alignment with what these tests already expect of other reports, reducing rather than adding risk of triggering them.
- **Export row cap / file size cap**: unaffected. `EXPORT_ROW_CAP`/`EXPORT_BYTE_CAP` checks in `report-suite.routes.ts` run against `result.rows.length` and the built buffer's length identically regardless of which workbook builder produced the buffer, so switching `attendance-register-monthly` to `buildCatalogWorkbook` does not change when those caps trigger.

## Testing Strategy

### Unit tests (both copies of the label helper)

New test files: `src/lib/attendance-register-columns.test.ts` (frontend, Vitest/Jest ? match existing project runner) and `backend/src/modules/reporting/__tests__/attendance-register-columns.test.ts` (backend, Vitest, matching the `__tests__` convention already used in that directory).

Each file asserts, independently on its own copy of the helper:

- **Validates: Requirement 3.1** ? for a normal 31-day month (e.g. `"2026-07"`), `day_1` ? `"Jul-01"`, `day_31` ? `"Jul-31"`; no output label contains the substring `"Day"`.
- **Validates: Requirements 3.4** ? February non-leap year (`"2025-02"`, 28 days): `day_28` present and labeled `"Feb-28"`; `day_29`, `day_30`, `day_31` absent from the output array entirely.
- **Validates: Requirements 3.4** ? February leap year (`"2024-02"`, 29 days): `day_29` present as `"Feb-29"`; `day_30`, `day_31` absent.
- **Validates: Requirements 3.4** ? a 30-day month (e.g. `"2026-04"`, April): `day_30` present as `"Apr-30"`; `day_31` absent.
- **Validates: Requirement 3.2** ? calling the function twice with two different month strings on the same base columns produces two different label sets (proves labels are month-derived, not cached/static).
- Non-day columns (`sno`, `emp_code`, ..., `total`) pass through with their original label unchanged, for every month case above.
- Malformed/missing month input (`undefined`, `""`, `"2026"`) returns the input columns array unchanged (error-handling case above).

A parity note (not an automated cross-project test, since frontend and backend are separate test runners/projects): both test files use an identical table of `(monthStr, dayNum) -> expectedLabel` fixtures, so a reviewer diffing the two test files can see the two implementations are asserted against the same expectations, even without a shared test harness.

### Contract/integration-style verification (Requirement 3.5: preview/export header parity)

Add `backend/src/modules/reporting/__tests__/attendance-register-header-parity.contract.test.ts`, following the existing `.contract.test.ts` pattern in that directory (source-level checks, no live DB): asserts that the backend catalog's `attendance-register-monthly` entry declares `day_1` through `day_31` keys (so `withDayColumnLabels` has something to act on for every day of the longest month), and that `attendance-register-monthly` is present in the `CATALOG_FORMAT_CODES` set in `report-suite.routes.ts` (so the export path actually uses the label-verbatim builder rather than silently falling through to the generic one). This pins the two structural preconditions the header-parity guarantee depends on, in the same lightweight source-parsing style as `catalog-frontend-parity.contract.test.ts`.

Manual verification (documented, not automated, since it requires an actual XLSX render): generate one export for a known month via the running app, open it, and confirm the day column headers read "Mon-DD" and match the on-screen preview for the same month, for at least one 28/29/30/31-day month each. Document the result (pass/fail per month) as a finding in the validation notes for this spec.

### Data validation against real `mas_hrms` data (Requirements 2 and 5)

This is validation work, not new production code, and is scoped as a one-off documented procedure rather than an automated suite, matching how the requirements describe spot-checking rather than exhaustive coverage.

New script: `backend/scripts/validate-attendance-register-format.ts`, run manually against the staging `mas_hrms` DB (host `122.184.128.90`, credentials from `backend/.env`, already configured):

1. **Pick a sample**: query `employees` for 3-5 active employee IDs with at least one `attendance_daily_record` row in a chosen real month (e.g. the most recently completed month), across a mix of departments/branches if possible.
2. **Independent tally**: for each sampled employee, run a direct SQL query against `attendance_daily_record` for that employee/month:
   ```sql
   SELECT record_date, attendance_status
   FROM attendance_daily_record
   WHERE employee_id = ? AND record_date BETWEEN ? AND ?
   ORDER BY record_date;
   ```
   Manually (in the script, in JS) tally counts per `attendance_status`, apply the same `statusCode` map the executor uses (`present`?P, `absent`?A, `half_day`?HD, `week_off`?W, `holiday`?H, `leave_approved`?L, `on_duty`?OD, `unreconciled`?A), and compute the expected `SalDays` per the documented formula (`present + half_day*0.5 + on_duty + holiday + week_off`).
3. **Compare against the executor**: call `attendanceRegisterMonthly(...)` (or hit the `/api/reports/suite/attendance-register-monthly` endpoint) for the same employees/month, and diff the returned `day_N` codes and summary counts against the independent tally from step 2.
4. **Document findings**: for any mismatch, record employee ID/code, date, expected vs. actual status (Requirement 2.4), or expected vs. actual summary count (Requirement 5.3), in a findings section appended to this spec's validation notes (e.g. a `validation-findings.md` alongside this design, or inline in the script's own output log). Findings are triaged as either a mapping defect (fix separately, outside this spec's header-format scope) or a pre-existing data-quality issue (documented, not remediated, consistent with the `Billable` column precedent in Requirement 4).
5. **Empty-day check** (Requirement 2.3): confirm at least one sampled employee has a day with no `attendance_daily_record` row in the month, and confirm that day renders as an empty string in `day_N`, not a fabricated code ? this falls directly out of the executor's `emp[`day_${row.day_num}`] ?? ""` fallback and is checked by inspection of the pivot output for that employee/day.

## Correctness Properties

These are the invariants the implementation must hold, independent of any specific test case:

### Property 1: Date-label determinism

For a fixed (year, month, day) input, buildDayColumnLabel SHALL always produce the same Mon-DD string, with no locale, timezone, or system-clock dependency. This is why SHORT_MONTHS is a fixed literal array rather than Date.prototype.toLocaleDateString.

**Validates: Requirements 3.1**

### Property 2: No day beyond the month

For any valid (year, month), withDayColumnLabels SHALL never emit a column for day_N where N is greater than daysInMonth(year, month), and SHALL always emit one for every day_N from 1 up to daysInMonth(year, month). The output day-column count SHALL exactly equal daysInMonth(year, month) -- never more, never fewer (Requirement 3.4).

**Validates: Requirements 3.4**

### Property 3: Label exclusivity

No column label produced by withDayColumnLabels SHALL contain the substring 'Day' (case-sensitive) followed by a digit, for any valid month input. This is the direct, checkable negation of Requirement 3.1's rule that headers SHALL NOT contain the literal words Day 1, Day 2.

**Validates: Requirements 3.1**

### Property 4: Non-day passthrough is lossless

For any column whose key does not match the day_N pattern, withDayColumnLabels SHALL return that column with an identical label to its input. The transform only ever touches day columns, never sno, emp_code, profile, billable, or any summary column (protects Requirement 5.4's rule against adding, removing, or renaming summary columns).

**Validates: Requirements 4.1, 5.4**

### Property 5: Preview/export label equality

For the same (month, dayNum) input, the frontend and backend copies of buildDayColumnLabel SHALL produce byte-identical output strings, enforced by the shared fixture table used in both test files (see Testing Strategy), since there is no shared module to enforce it structurally.

**Validates: Requirements 3.5**

### Property 6: Catalog field isolation

The backend catalog edit (Component 4) SHALL change only the columns array on the attendance-register-monthly entry. Every other field on that entry (viewRoles, exportRoles, filters, sourceTables, sensitivityLevel, etc.) SHALL be byte-for-byte identical before and after the change (Requirement 7.1).

**Validates: Requirements 7.1**

### Property 7: Executor output untouched

No change in this design SHALL alter what attendanceRegisterMonthly() returns for a given (filters, scope, options) input. The row data, pagination slicing, and sno numbering SHALL be identical before and after this spec's changes (Requirement 6.3). Only the labels applied to columns at render/export time change; the underlying row values never do.

**Validates: Requirements 6.3**


- **Header CSS case-transform gap (found during Task 5 implementation, not caught in initial design)**: `ReportLibraryView.tsx`'s shared `<th>` className applies `uppercase` unconditionally to every report's header text. Since `withDayColumnLabels` produces mixed-case labels ("Jul-01"), the on-screen preview would render "JUL-01" while the exported XLSX (which writes `cell.value` verbatim with no CSS) shows "Jul-01" — violating both Requirement 3.1's exact casing and Requirement 3.5's preview/export parity. Fix: at the header `<th>` render call site only, conditionally omit the `uppercase` class when `col.key` matches `/^day_(\d+)$/` (the same pattern `withDayColumnLabels` itself uses), leaving every other column and every other report's headers unaffected.
- **Async worker export path gap (found during Task 7/10 review, not in the original design)**: `backend/src/workers/report-generation.worker.ts`, used for scheduled/emailed report deliveries, is a SEPARATE code path from the immediate `/export` route fixed in Component 3 — it calls `buildSecureXlsxBuffer` directly with no `CATALOG_FORMAT_CODES` check at all, so an emailed/scheduled export of `attendance-register-monthly` would still show `DAY_1`, `DAY_2` uppercased, bypassing the fix entirely. Fixed under Task 11: the worker gets the same `CATALOG_FORMAT_CODES` branch — look up the report's catalog entry (already imports `REPORT_CATALOG`), compute `exportColumns` via `withDayColumnLabels` the same way the route does, and call `buildCatalogWorkbook` instead of `buildSecureXlsxBuffer` for codes in that set.
## Risk and Rollback Notes

- Moving `attendance-register-monthly`'s export from `buildSecureXlsxBuffer` to `buildCatalogWorkbook` is an intentional visual change beyond just headers: `buildCatalogWorkbook` has no metadata sheet and uses plain thin borders/Calibri 11 styling, versus the generic builder's styled Excel table and metadata sheet. Requirement 6 only requires row-count and pagination behavior parity (Requirements 6.1, 6.2, 6.4), not visual/styling parity, so this is in scope and acceptable ? but should be visually spot-checked once (open the exported file, confirm it's readable and the data is intact) rather than assumed identical to today's export appearance.
- If the header-parity contract test or manual spot-check reveals the backend catalog's day-column labels leaking through unexpectedly (e.g. `withDayColumnLabels` receiving a code path where `filters.month` isn't populated), rollback is a single-line revert: remove `"attendance-register-monthly"` from `CATALOG_FORMAT_CODES`, which reverts the export to the pre-existing `buildSecureXlsxBuffer` path (uppercased keys, but functionally unchanged from today) without touching the executor or either catalog's data-bearing fields.
- The frontend rendering change (Component 1) is purely additive/derived (a `useMemo` producing a new array) and does not mutate `selectedReport.columns` or the underlying catalog import, so it cannot affect any other report's rendering ? rollback there is deleting the new helper import and reverting the two `.map()` call sites to use `selectedReport.columns` directly.
- Backend catalog column-list expansion (Component 4) only adds entries to `columns`; it doesn't touch `viewRoles`, `exportRoles`, or any other field on the entry, so Requirement 7.1's "byte-for-byte unchanged" constraint is satisfied by the shape of the diff itself, not by a separate verification step.
