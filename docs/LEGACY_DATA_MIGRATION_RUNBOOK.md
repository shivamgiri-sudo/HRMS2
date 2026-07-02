# Legacy Data Migration Runbook — ATS, LMS, WFM, HRMS

This runbook explains how to move old portal data from Google Sheets / CSV / Excel into Supabase safely.

## Golden Rule

Do not import old data directly into production tables first.

Always follow:

```text
Old GSheet / Excel / CSV
→ staging table / raw import table
→ validation
→ mapping / transformation
→ production tables
→ validation dashboard
```

This prevents broken dates, duplicate employee codes, duplicate candidate IDs, wrong recruiter mapping, and missing relationships.

---

## 1. Recommended import order

### HRMS first

Import HRMS master data before ATS/LMS/WFM because all other modules eventually attach to employee IDs.

Order:

1. Departments
2. Process Master
3. Employees
4. Managers / reporting structure
5. Assets
6. Leaves / attendance / payroll opening data

### ATS second

Order:

1. Recruiters
2. Dropdown / VOC / Config
3. Candidate Intake history
4. Candidates master
5. Queue_View history/current queue
6. Recruiter Submission history
7. Candidate Confirmation
8. BGV
9. Email_Log
10. Audit_Log

### LMS third

Order:

1. Role_Access_Matrix
2. Classroom_Master
3. Module_Master
4. Content_Master
5. Assessment_Master
6. Question_Bank
7. Batch_Master
8. Trainee_Master
9. Content_Progress
10. Video_Watch_Log
11. Assessment responses / MCQ logs
12. Certification rules and handover logs

### WFM fourth

Order:

1. Employee roster master
2. Shift master
3. Roster paste/history
4. Login/logout logs
5. Break in/out logs
6. Daily reports / exception logs

---

## 2. Best source format

For each old Google Sheet tab:

```text
File → Download → CSV
```

Use one CSV per sheet/tab.

Do not combine sheets into one CSV.

Recommended file naming:

```text
ATS_Candidates_legacy_2026-05-17.csv
ATS_Recruiter_Submission_legacy_2026-05-17.csv
LMS_Batch_Master_legacy_2026-05-17.csv
WFM_Break_Log_legacy_2026-05-17.csv
HRMS_Employees_legacy_2026-05-17.csv
```

---

## 3. Supabase import methods

### Method A — Supabase Table Editor CSV import

Use for small or medium data.

1. Create staging table.
2. Open Supabase Table Editor.
3. Import CSV.
4. Review row count.
5. Run validation query.
6. Run production import SQL.

### Method B — SQL COPY

Use if using local psql.

```sql
COPY staging_table_name
FROM '/local/path/file.csv'
WITH (FORMAT csv, HEADER true);
```

### Method C — Build app-based bulk importer

Use this for production later.

Frontend uploads CSV.
Backend stores raw rows.
Validation engine shows row-level errors.
User clicks Import.
Rows move to final tables.

This is the safest long-term method and should be used for ATS/LMS/WFM old data migration.

---

## 4. ATS migration mapping

The ATS source of truth is the uploaded GSheet template.

Important sheets:

| Old GSheet sheet | Native target |
|---|---|
| Candidate Intake | `ats_candidate` + `ats_gsheet_row_mirror` |
| Candidates | `ats_candidate` + `ats_gsheet_candidates_replica` |
| Queue_View | derived from `ats_candidate` + `ats_candidate_assignment` + no final recruiter submission |
| Recruiter Submission | `ats_recruiter_submission` |
| Recruiters | `ats_recruiter_profile` |
| Config | `ats_option_category`, `ats_option_value`, future config table |
| VOC_Lookup | future `ats_voc_master` or option table |
| Candidate Confirmation | future candidate joining confirmation table |
| BGV | future BGV/onboarding table |
| Email_Log | future email log table |
| Audit_Log | `ats_candidate_status_log` or audit table |

The exact GSheet schema alignment SQL is:

```text
supabase/sql/phase7f_ats_gsheet_exact_schema_alignment.sql
```

It creates:

```text
ats_gsheet_schema_column_map
ats_gsheet_row_mirror
ats_gsheet_candidates_replica
ats_gsheet_queue_view_replica
ats_gsheet_recruiter_submission_replica
```

---

## 5. Validation after import

Run row count validation first:

```sql
SELECT 'ats_candidate' AS table_name, COUNT(*) FROM public.ats_candidate
UNION ALL SELECT 'ats_recruiter_profile', COUNT(*) FROM public.ats_recruiter_profile
UNION ALL SELECT 'ats_recruiter_submission', COUNT(*) FROM public.ats_recruiter_submission
UNION ALL SELECT 'ats_candidate_lifecycle', COUNT(*) FROM public.ats_candidate_lifecycle;
```

Check duplicate candidate IDs:

```sql
SELECT candidate_code, COUNT(*)
FROM public.ats_candidate
GROUP BY candidate_code
HAVING COUNT(*) > 1;
```

Check duplicate employee codes:

```sql
SELECT employee_code, COUNT(*)
FROM public.employees
GROUP BY employee_code
HAVING COUNT(*) > 1;
```

Check invalid recruiter mapping:

```sql
SELECT c.candidate_code, c.full_name, c.recruiter_name
FROM public.ats_candidate c
LEFT JOIN public.ats_recruiter_profile r
  ON lower(trim(r.recruiter_name)) = lower(trim(c.recruiter_name))
WHERE c.recruiter_name IS NOT NULL
  AND c.recruiter_name <> ''
  AND r.id IS NULL;
```

Check Queue_View replica:

```sql
SELECT *
FROM public.ats_gsheet_queue_view_replica
ORDER BY "WaitingMinutes" DESC
LIMIT 50;
```

---

## 6. Practical migration phases

### Phase 8A — HRMS old employee master

Goal: import all old employees into `employees` safely.

Required checks:

- EmployeeCode duplicate
- Email duplicate
- Phone duplicate
- Department exists
- Manager exists
- Status is valid enum
- Date fields parsed correctly

### Phase 8B — ATS old data

Goal: import old ATS sheets exactly.

Required checks:

- CandidateID duplicate
- Mobile duplicate logic by date if needed
- RecruiterCode/PIN exists
- Branch mapping exists
- Queue_View derived properly
- Recruiter Submission rows linked to candidate
- FinalDecision/status logic preserved

### Phase 8C — LMS old data

Goal: import all old training history, batches, trainees, LMS progress.

Required checks:

- BatchNo unique
- LMS ID / Employee ID mapping exists
- Classroom/module/content references valid
- Progress rows linked to trainee and content
- Certification status consistent

### Phase 8D — WFM old data

Goal: import roster, shifts, breaks, login/logout.

Required checks:

- Employee exists
- Shift date parsed correctly
- Night shift date boundary handled
- Break-in has break-out
- Logout after login
- Total duration recalculated

---

## 7. Do not import these directly without mapping

Avoid direct production inserts for:

- Candidate Confirmation
- BGV
- Email_Log
- Audit_Log
- LMS MCQ responses
- WFM break logs

These require parent records first.

---

## 8. Final acceptance criteria

Migration is passed only when:

1. Source row counts match staging row counts.
2. Production imported row counts match valid rows.
3. Rejected/error rows are visible with reason.
4. Dashboard reflects imported records.
5. Candidate/employee journey opens correctly.
6. No duplicate CandidateID / EmployeeCode.
7. Old Queue_View and new Queue replica match logic.
8. ATS/LMS/WFM/HRMS dashboards can filter historical data.
