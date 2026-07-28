# Performance Ingestion Platform

This module is the canonical route for bringing operations and quality performance data into HRMS2 when a process uses an external database, Google Sheet, Excel workbook, or CSV report.

## Safety model

1. External database credentials remain in the existing encrypted Integration Hub.
2. Database queries must begin with `SELECT` or `WITH`; mutating and multi-statement SQL is rejected.
3. Every new or edited dataset starts in `draft` status.
4. Preview writes raw staging, validations, reconciliation, and mapping exceptions, but does not write KPI facts.
5. Publication is allowed only after an administrator approves an effective-dated mapping version.
6. Published KPI facts include source dataset, source record, mapping version, ingestion run, and publication batch lineage.
7. Duplicate Excel/CSV publication is blocked using the uploaded file SHA-256 hash.
8. Dataset lists, run evidence, reference data, and mapping exceptions are filtered by the existing HRMS backend scope engine.
9. Every staging, mapping, approval, status, and publication mutation requires backend write access.
10. Republishing a correction window supersedes only that source's current lineage; other approved source contributions remain.

## Install the additive schema

From `backend` in a staging environment:

```bash
npm run performance:install-ingestion-schema
```

The installer refuses to execute unless its internal `--apply` guard is present. The package command includes that flag. Review `sql/520_performance_ingestion_platform.sql` and `sql/521_performance_multi_source_lineage.sql` before production execution.

## Performance Hub administration

Authorised roles see a **Performance data administration** workspace inside Performance Hub.

The workspace includes:

- **Sources**: create, edit, activate, deactivate, preview, approve, and publish datasets.
- **Run history**: review every preview/publication window and its validation, reconciliation, exception, and publication evidence.
- **Mapping exceptions**: resolve employee and process identifiers with effective-dated mappings, or close/ignore intentional source values.
- **Reference data**: employees, processes, branches, and KPI metric codes are supplied only from the caller's authorised scope.

Role behaviour:

| Role | View sources/runs | Preview | Create/edit/publish | Approve mapping | Resolve mappings |
|---|---:|---:|---:|---:|---:|
| Super Admin / Admin | Yes | Yes | Yes | Yes | Yes |
| Process Manager / QA Manager | Assigned scope | Yes | Assigned scope | No | Assigned scope |
| HR | Assigned scope | Yes | No | No | Assigned scope |
| Quality Lead | Assigned scope | Yes | No | No | No |

Demo/read-only sessions cannot mutate staging or published facts because every mutation uses `requireWriteAccess`.

## API root

```text
/api/performance-hub/ingestion
```

Key routes:

```text
GET   /reference-data
GET   /datasets
GET   /datasets/:id
POST  /datasets
PATCH /datasets/:id/status
POST  /datasets/:id/approve
POST  /datasets/:id/preview
POST  /datasets/:id/publish
GET   /datasets/:id/runs
GET   /runs/:runId
POST  /identity-maps
POST  /process-maps
GET   /mapping-exceptions
POST  /mapping-exceptions/:id/resolve
```

Excel and CSV preview/publish requests use multipart form data with fields `from`, `to`, and `file`.

## Effective-dated approval

Approval requires an explicit start date:

```json
{
  "effectiveFrom": "2026-07-01"
}
```

When a revised mapping is approved:

1. The previous open mapping version receives `effective_to = effectiveFrom - 1 day`.
2. A new immutable mapping version is created.
3. Publication resolves the correct approved mapping separately for every performance date.
4. Historical facts keep their original mapping-version lineage.

A revised source configuration or mapping automatically returns the dataset to `draft` and clears its approval until it is previewed and approved again.

## Dataset mapping contract

```json
{
  "employeeIdentifierField": "employee_code",
  "employeeIdentifierType": "client_login",
  "eventDateField": "performance_date",
  "sourceRecordKeyField": "record_id",
  "externalProcessField": "process_name",
  "metrics": [
    {
      "metricCode": "EXTRACTION_ACCURACY",
      "numeratorField": "correct_fields",
      "denominatorField": "total_fields",
      "aggregation": "ratio",
      "ratioMultiplier": 100,
      "sourceRecordCountField": "total_fields"
    },
    {
      "metricCode": "PRODUCTIVITY",
      "valueField": "completed_cases",
      "aggregation": "sum"
    }
  ]
}
```

Supported aggregation methods:

- `sum`: totals values across the selected date range.
- `average`: averages row values.
- `ratio`: sums numerator and denominator before calculating the result.
- `latest`: uses the most recent value.

## MySQL source configuration

```json
{
  "queryMysql": "SELECT employee_code, performance_date, correct_fields, total_fields, completed_cases FROM reporting_view WHERE performance_date BETWEEN ? AND ?",
  "queryParams": ["from", "to"],
  "maxRows": 10000
}
```

## SQL Server source configuration

```json
{
  "queryMssql": "SELECT employee_code, performance_date, correct_fields, total_fields, completed_cases FROM reporting_view WHERE performance_date BETWEEN @from AND @to",
  "maxRows": 10000
}
```

Only `@from`, `@to`, and `@checkpoint` named values are bound by the SQL Server adapter.

## Google Sheet source configuration

Use the HTTPS CSV export URL of an approved reporting tab:

```json
{
  "csvUrl": "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=TAB_GID",
  "maxRows": 10000
}
```

For private Sheets, publish through an organisation-controlled export endpoint rather than exposing credentials in dataset JSON. Google export hosts and redirects are allow-listed.

## Excel and CSV sources

Set source type to `excel` or `csv`. The first workbook tab is read. Header names are matched case-insensitively. The file name and SHA-256 hash are retained on the ingestion run; raw row JSON is stored for audit and replay.

## Employee identity mapping

Mapping priority:

1. Verified `performance_identity_map` record effective on the event date.
2. Exact, unique HRMS employee code.
3. Exact, unique biometric code.
4. Open mapping exception requiring manual resolution.

Names are never used for automatic publication.

Example identity mapping:

```json
{
  "sourceKey": "onfido_quality",
  "externalIdentifier": "client.user.1024",
  "identifierType": "client_login",
  "employeeId": "HRMS_EMPLOYEE_UUID",
  "processId": "HRMS_PROCESS_UUID",
  "effectiveFrom": "2026-07-01",
  "effectiveTo": null
}
```

## Mapping exception workflow

An exception is created when an external identifier cannot be safely published.

Supported resolution actions:

- `map_employee`: create or update an effective-dated employee identity map.
- `map_process`: create or update an effective-dated process map.
- `resolve`: close the exception after the client report or KPI master is corrected.
- `ignore`: close an intentional source value without creating a mapping.

Resolution is transactional. The target employee/process must remain inside the operator's backend-authorised scope. Resolution action, notes, actor ID, and timestamp are appended to the exception evidence.

## Run evidence and reconciliation

Each run records:

- Source rows
- Staged rows
- Mapped rows
- Invalid rows
- Generated/published facts
- Validation issues
- Reconciliation results
- Mapping exceptions
- Publication batch and superseded lineage counts

The administration workspace exposes this evidence through **Run history**. Run detail is also backend scoped; guessing another run ID cannot bypass dataset permissions.

## Process-specific metrics

Create each metric in KPI master, then configure target and weightage in `kpi_process_config`. Performance Hub reads active metrics dynamically; adding a process metric no longer requires editing frontend or backend metric enums.

Recommended examples:

### Operations analyst

- Productivity
- AHT or processing time
- Utilisation
- Adherence
- Rework
- Attendance

### Quality analyst performance

- Weighted quality score
- Fatal error rate
- Audit sample size
- Parameter accuracy
- Repeat defect rate

### Quality auditor performance

- Audits completed
- Audit turnaround time
- Calibration score
- Dispute reversal rate
- Sampling coverage

### Team leader and manager

These are aggregated from authorised employee facts and displayed according to the existing HRMS dashboard scope engine. Overall achievement is calculated using configured process metric weightage, not a simple average.

## Pilot sequence

1. Apply migrations 520 and 521 in staging.
2. Create or verify read-only external database credentials.
3. Create one dataset in draft status and assign its process/branch scope.
4. Preview a one-day window.
5. Review run evidence and resolve every employee/process/metric exception.
6. Compare source totals, staged totals, classified totals, and generated facts.
7. Approve the mapping from the intended historical effective date.
8. Publish the one-day correction window.
9. Verify employee, Team Leader, Manager, Quality, Branch, and leadership scopes.
10. Repeat with one SQL Server source and one Excel/Sheet source.
11. Backfill in small date windows only after reconciliation passes.
