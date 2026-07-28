# Performance Manual Upload Certification

This phase certifies Excel and CSV performance uploads before they can be trusted as canonical HRMS KPI facts.

## What is now enforced

### File-level preflight

- CSV datasets accept plain-text `.csv` content only.
- Excel datasets accept `.xlsx` or `.xls` workbook content only.
- The configured worksheet must exist when `config.sheetName` is set.
- The first populated row must be a complete header row.
- Blank header names between populated columns are rejected.
- Duplicate headers are rejected case-insensitively.
- Every configured employee, date, record-key, process, branch and metric field must exist.
- The configured row limit is a hard safety limit. The system rejects oversized sources instead of silently truncating them.
- A SHA-256 file hash is generated for evidence and duplicate-publication protection.

### Database certification

A completed preview or publication can be certified through the UI or CLI. Certification verifies:

1. The run reached `preview_complete` or `published`.
2. Extracted source rows equal persisted raw records.
3. The staged counter equals persisted raw evidence.
4. Mapped plus invalid rows classify every staged row.
5. Every invalid row has an error-level validation record.
6. No unresolved invalid rows remain.
7. Required reconciliation controls executed.
8. Every reconciliation control passed.
9. For publication, the publication batch committed.
10. The run and batch fact counters match.
11. Every published fact has a lineage row.
12. Every published fact reached `kpi_daily_actual` for the run.

## Operator workflow

1. Open **Performance Hub → Manual upload certification**.
2. Select the Excel or CSV dataset.
3. Download the governed CSV template.
4. Prepare the source file without changing required column names.
5. Run **File preflight**.
6. Resolve file-type, sheet, header, duplicate-column, missing-column or row-limit errors.
7. Use **Performance data administration** to run **Preview and validate**.
8. Download the validation-error CSV when invalid rows exist.
9. Resolve employee and process mapping exceptions.
10. Re-run preview until invalid rows are zero and reconciliation passes.
11. Approve the effective-dated mapping if it is not already active.
12. Publish a one-day controlled window.
13. Select the run under **Run database certification** and click **Certify**.
14. Expand to a wider period only after the one-day run is certified.

## CLI verification

Run this on the staging backend host after a preview or publication:

```bash
cd backend
npm ci
npm run performance:verify-manual-upload -- --run-id <RUN_UUID>
```

Machine-readable output:

```bash
npm run performance:verify-manual-upload -- --run-id <RUN_UUID> --json
```

The command is read-only. It exits with status `1` when any certification control fails.

## Required manual test matrix

### File format

- Valid CSV
- Valid XLSX
- Valid legacy XLS
- CSV renamed as XLSX
- XLSX renamed as CSV
- Empty file
- Workbook with no sheet
- Configured sheet missing
- Header-only file
- File larger than 20 MB
- Row count above configured maximum

### Header and mapping

- Exact required headers
- Header case differences
- Header leading/trailing spaces
- Missing employee identifier
- Missing event date
- Missing metric value
- Missing numerator or denominator for ratio metrics
- Duplicate headers with different case
- Blank column name between populated headers
- Additional harmless source columns

### Row validation

- Valid employee code
- Valid biometric code fallback
- Unmapped employee
- Duplicate/ambiguous employee identifier
- Invalid date
- Date outside the selected window
- Unmapped process
- Missing process context
- Inactive KPI metric
- Blank numeric value
- Invalid numeric value
- Percentage with `%`
- Number with thousands separators
- Ratio with zero denominator
- Multiple metrics where one metric fails; no partial row facts should be produced

### Publication and correction

- Preview with zero invalid rows
- Preview with invalid rows
- Publish blocked by invalid rows
- Publish with an approved mapping version
- Publish blocked without an effective mapping version
- Duplicate file publication blocked
- Correction-window republish supersedes only the selected source
- Removed source row withdrawal
- Other approved source contributions remain current
- Sum aggregation
- Weighted average aggregation
- Ratio aggregation
- Latest-value aggregation
- Canonical row deletion only when no approved source remains

### Scope and security

- Employee cannot access source administration
- Allowed reader can inspect schema and template
- Process manager sees only authorised datasets
- Branch restrictions are enforced by the backend
- Only approved manager roles can publish
- Only Super Admin/Admin can approve mappings or enable exceptional partial/empty publication
- Error exports and certification endpoints enforce dataset scope
- CSV exports neutralise spreadsheet formula injection characters

### Frontend

- Dataset selector lists only Excel/CSV sources
- Governed template downloads with correct file name
- File picker respects accepted extensions
- Preflight success shows row, column, file and worksheet evidence
- Preflight failure displays the backend reason
- Warning appears for header-only files
- Run list refreshes after preview/publication
- Validation errors download successfully
- Certification shows every PASS/FAIL control
- Mobile and narrow-screen layout remains usable

## Staging acceptance rule

A process is not ready for backfill or scheduled operations until:

- a one-day manual upload preview has zero invalid rows;
- the source/staging/classification reconciliations pass;
- a one-day publication is certified;
- employee, Team Leader, Manager, QA, Branch and leadership views match the source totals;
- a correction-file republish is tested;
- the database verifier returns `PASS`;
- the complete evidence is retained with the run ID and source-file hash.
