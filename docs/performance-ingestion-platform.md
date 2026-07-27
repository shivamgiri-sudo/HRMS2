# Performance Ingestion Platform

This module is the canonical route for bringing operations and quality performance data into HRMS2 when a process uses an external database, Google Sheet, Excel workbook, or CSV report.

## Safety model

1. External database credentials remain in the existing encrypted Integration Hub.
2. Database queries must begin with `SELECT` or `WITH`; mutating and multi-statement SQL is rejected.
3. Every new dataset starts in `draft` status.
4. Preview writes raw staging, validations, reconciliation, and mapping exceptions, but does not write KPI facts.
5. Publication is allowed only after an administrator approves the mapping version.
6. Published KPI facts include source dataset, source record, mapping version, ingestion run, and publication batch lineage.
7. Duplicate Excel/CSV publication is blocked using the uploaded file SHA-256 hash.

## Install the additive schema

From `backend` in a staging environment:

```bash
npm run performance:install-ingestion-schema
```

The installer refuses to execute unless its internal `--apply` guard is present. The package command includes that flag. Review `sql/520_performance_ingestion_platform.sql` before production execution.

## API root

```text
/api/performance-hub/ingestion
```

Key routes:

```text
GET  /datasets
POST /datasets
POST /datasets/:id/approve
POST /datasets/:id/preview
POST /datasets/:id/publish
GET  /runs/:runId
POST /identity-maps
POST /process-maps
GET  /mapping-exceptions
```

Excel and CSV preview/publish requests use multipart form data with fields `from`, `to`, and `file`.

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

For private Sheets, publish through an organisation-controlled export endpoint rather than exposing credentials in dataset JSON.

## Excel and CSV sources

Set source type to `excel` or `csv`. The first workbook tab is read. Header names are matched case-insensitively. The file is retained in the ingestion run through its name and SHA-256 hash; raw row JSON is stored for audit and replay.

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

## Process-specific metrics

Create each metric in KPI master, then configure target and weightage in `kpi_process_config`. Performance Hub now reads active metrics dynamically; adding a process metric no longer requires editing frontend or backend metric enums.

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

1. Apply the schema in staging.
2. Create or verify read-only external database credentials.
3. Create one dataset in draft status.
4. Preview a one-day window.
5. Resolve all employee/process/metric exceptions.
6. Compare source totals, staged totals, classified totals, and generated facts.
7. Approve the mapping.
8. Publish the one-day window.
9. Verify employee, team leader, manager, quality, and leadership scopes.
10. Backfill in small date windows only after reconciliation passes.
