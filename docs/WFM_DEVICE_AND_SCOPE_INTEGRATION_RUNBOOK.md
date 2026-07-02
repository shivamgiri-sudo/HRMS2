# WFM Device, Scope and External Database Integration Runbook

## Purpose

This runbook explains how WFM Live Tracker should work when it is connected to:

1. Native HRMS employee master
2. Branch / process / team access scope
3. Existing facial punch device API
4. Existing external attendance database that will be migrated later

---

## 1. Shift Master delete behavior

Shift Master uses soft delete, not physical delete.

When a shift is deactivated:

```text
active_status = false
deleted_at = timestamp
deletion_reason = user-entered reason
```

Why soft delete:

- Historical roster records remain intact
- Old attendance reports do not break
- Past shift references remain auditable
- Shift can be restored later

---

## 2. Role-wise WFM visibility

WFM visibility is controlled by:

```text
wfm_user_access_scope
```

Supported scope types:

| Scope | Meaning |
|---|---|
| all | Can see full WFM tracker |
| branch | Can see one branch only |
| process | Can see one process only |
| team | Can see one team only |
| employee | Can see one employee only |

Example usage:

| User Type | Recommended scope |
|---|---|
| CEO / Admin | all |
| Branch Head | branch = Okaya / AHM / TPZ etc. |
| Process Manager | process = Onfido / Bella Vita etc. |
| Team Leader | team = Team name or TL mapped team |
| Employee | employee = own employee id |

If no user-specific scope exists, the page currently shows all permitted authenticated data. For production hard lock, Supabase RLS can later enforce these scopes at database level.

---

## 3. Facial punch device sync

Device metadata is stored in:

```text
wfm_facial_device_master
```

Important security rule:

Do not store API passwords/API keys directly in the table.

Store only secret names:

```text
api_key_secret_name
connection_secret_name
```

Actual values should go into Supabase Edge Function secrets or server environment variables.

---

## 4. Facial punch staging

Raw device punches first go into:

```text
wfm_external_punch_staging
```

Required payload fields:

```json
{
  "source_system": "FACIAL_DEVICE_API",
  "external_punch_id": "device_unique_punch_id",
  "device_code": "DEVICE_01",
  "employee_code": "MCN001",
  "biometric_user_code": "1001",
  "punch_time": "2026-05-17T09:01:00+05:30",
  "punch_type": "AUTO",
  "branch_name": "Okaya",
  "process_name": "Onfido",
  "team_name": "Team A"
}
```

Supported punch types:

```text
AUTO
IN
OUT
BREAK_IN
BREAK_OUT
```

---

## 5. Applying staged punches

The function:

```sql
public.native_wfm_apply_pending_punches(p_limit integer)
```

Processes staged punches into:

```text
wfm_attendance_session
wfm_break_log
```

AUTO behavior:

```text
If no session exists for employee/date → IN
If session exists → OUT
```

For accurate break tracking, device API should send:

```text
BREAK_IN
BREAK_OUT
```

If the device only sends generic punches, break logic should remain manual or a later rule engine should classify punches.

---

## 6. Existing external database migration

External database source inventory is stored in:

```text
wfm_external_db_source
```

Migration batches:

```text
wfm_legacy_migration_batch
wfm_legacy_migration_row
```

Use this only to register the source and validate migration runs.

Actual DB credentials should stay in:

```text
Supabase Edge Function secrets
Backend environment variables
```

Not inside database text fields.

---

## 7. Recommended API architecture

```text
Facial Device API / Existing DB
↓
Supabase Edge Function / Backend Cron
↓
Insert raw rows into wfm_external_punch_staging
↓
Call native_wfm_apply_pending_punches()
↓
wfm_attendance_session + wfm_break_log
↓
Live Tracker / Reports
```

---

## 8. Production checks before live device sync

Before real device sync is enabled, validate:

1. Every biometric user code maps to an employee code.
2. Device timezone is India time or converted before insert.
3. Duplicate punch ID is stable and unique.
4. Roster exists for employee/date, or system allows non-rostered punch capture.
5. Night shift boundary rules are finalized.
6. Break classification logic is confirmed.
7. Branch/process/team mapping is filled.
8. RLS scope is tested with Branch Head, Process Manager and Team Leader users.

---

## 9. Current status

Implemented now:

- Shift soft delete and restore
- Branch/process/team mapping on shifts and roster
- WFM scope table
- Live tracker filters
- Facial device master
- Punch staging table
- Punch apply function
- External DB source registry
- Legacy migration batch/row staging

Still pending for final production:

- Real Edge Function to call actual device API
- Real external DB connector/cron
- Hard RLS policy enforcement by scope
- Night shift advanced boundary rules
- Automated daily 7 AM break report email
