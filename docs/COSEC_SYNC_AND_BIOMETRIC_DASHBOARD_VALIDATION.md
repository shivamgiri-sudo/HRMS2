# COSEC Sync and Biometric Dashboard Validation

Branch: `fix/production-readiness-phase1`

## What was added

### Automatic COSEC migration

Files:

- `backend/src/modules/wfm/cosec-sync.service.ts`
- `backend/src/modules/wfm/cosec-sync.routes.ts`
- `backend/src/modules/wfm/cosec-sync.worker.ts`
- `backend/src/server.ts`
- `backend/src/app.ts`

The sync reads SQL Server punch data from the COSEC/Biometric table:

```text
Mx_ATDEventTrn
```

Default columns:

```text
UserID
EventDateTime
```

It groups data by employee and date, then writes HRMS1 tables:

```text
biometric_attendance_log
integration_biometric_daily
wfm_attendance_session
attendance_daily_record
```

### Biometric summary APIs

Files:

- `backend/src/modules/wfm/biometric-summary.routes.ts`
- `backend/src/app.ts`

Endpoints:

```http
GET /api/wfm/biometric-summary/adherence-summary
GET /api/wfm/biometric-summary/agent-view
GET /api/wfm/biometric-summary/reconciliation
```

### Biometric UI command center

Files:

- `src/pages/NativeBiometricCommandCenter.tsx`
- `src/App.tsx`

Routes:

```text
/wfm/live-tracker
/wfm/adherence-command-center
/wfm/agent-attendance-view
```

## Required environment values

Add to `backend/.env`:

```env
NCOSEC_DB_HOST=your-cosec-sqlserver-host
NCOSEC_DB_PORT=1433
NCOSEC_DB_USER=your-sqlserver-user
NCOSEC_DB_PASSWORD=your-sqlserver-password
NCOSEC_DB_NAME=NCOSEC
NCOSEC_DB_ENCRYPT=false
NCOSEC_DB_TRUST_CERT=true
NCOSEC_EVENT_TABLE=dbo.Mx_ATDEventTrn
NCOSEC_USER_ID_COLUMN=UserID
NCOSEC_DATETIME_COLUMN=EventDateTime
NCOSEC_SYNC_ENABLED=true
NCOSEC_SYNC_INTERVAL_MS=300000
NCOSEC_SYNC_LOOKBACK_DAYS=1
```

If your COSEC datetime column has a different name, update:

```env
NCOSEC_DATETIME_COLUMN=ActualColumnName
```

## Local validation commands

```bash
git fetch origin
git checkout fix/production-readiness-phase1
cd backend
npm install
npm run typecheck
npm run dev
```

## Manual sync test

```bash
curl -X POST http://localhost:5055/api/wfm/cosec-sync/run \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"from":"2026-06-01","to":"2026-06-15"}'
```

Expected response fields:

```json
{
  "pulledEvents": 0,
  "groupedDays": 0,
  "migratedDays": 0,
  "unmappedUsers": [],
  "failed": []
}
```

If `unmappedUsers` is not empty, map COSEC users to HRMS employees in:

```sql
SELECT * FROM employee_biometric_enrollment WHERE is_active = 1;
```

## Database checks

```sql
SELECT COUNT(*) FROM biometric_attendance_log;

SELECT COUNT(*)
FROM integration_biometric_daily
WHERE integration_key = 'cosec_sqlserver';

SELECT COUNT(*)
FROM wfm_attendance_session
WHERE punch_source = 'BIOMETRIC';

SELECT COUNT(*)
FROM attendance_daily_record
WHERE source_system LIKE '%cosec%';
```

## API checks

```bash
curl "http://localhost:5055/api/wfm/biometric-summary/adherence-summary?from=2026-06-01&to=2026-06-15" \
  -H "Authorization: Bearer YOUR_TOKEN"

curl "http://localhost:5055/api/wfm/biometric-summary/agent-view?from=2026-06-01&to=2026-06-15" \
  -H "Authorization: Bearer YOUR_TOKEN"

curl "http://localhost:5055/api/wfm/biometric-summary/reconciliation?from=2026-06-01&to=2026-06-15" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## UI checks

Open:

```text
http://localhost:8083/wfm/live-tracker
http://localhost:8083/wfm/adherence-command-center
http://localhost:8083/wfm/agent-attendance-view
```

Check:

- Page opens and is no longer a placeholder.
- Date range filters work.
- Mandate days, adherence %, late %, and mismatches populate.
- Agent Attendance View displays employee rows.
- Reconciliation exceptions show rows where imported biometric punches and HRMS attendance do not align.

## Important safety checks

- Sync must not run unless `NCOSEC_SYNC_ENABLED=true`.
- Locked attendance rows must not be overwritten.
- SQL Server credentials must stay in `.env` or encrypted secret storage only.
- Do not copy Biometric hardcoded credentials into HRMS1.
- Validate `employee_biometric_enrollment` before expecting successful migration.
