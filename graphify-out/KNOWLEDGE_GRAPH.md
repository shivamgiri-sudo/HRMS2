# MAS Callnet PeopleOS / HRMS — Knowledge Graph

Generated 2026-08-30 by `graphify-out/extract.mjs` (read-only over the repo) plus
`information_schema` queries against the live `mas_hrms`. Every number here is
reproducible from the TSV files in this directory.

---

## 1. Scale

| Dimension | Value |
|---|---|
| Backend modules | **127** |
| Backend source files (excl. tests) | 1,294 |
| Backend lines of code | 433,606 |
| Route handlers extracted | **3,022** |
| Router mounts in `app.ts` | 292 |
| Frontend files | 1,265 |
| SQL files (`backend/sql`) | 795 |
| Tables in `mas_hrms` | **1,032** |
| Database size | 7.2 GB |
| Approx rows | 12.0 M |
| Declared foreign keys | 607 |

Payroll — the entire subject of the earlier audit — is **1 of 127 modules**:
75 files, 33,780 LOC, 298 routes, 65 write-owned tables. It is the second-largest
module by LOC after ATS.

---

## 2. Database topology — 8 databases, one writable

```
                    ┌───────────────────────────────┐
   WRITE  ────────► │  mas_hrms   @122.184.128.90   │  MySQL 8 · 1,032 tables · 7.2GB
                    │  the only writable database   │
                    └───────────────┬───────────────┘
                                    │ reads only (no writeback)
      ┌──────────────┬──────────────┼──────────────┬──────────────┐
      ▼              ▼              ▼              ▼              ▼
  db_bill        dialer_db      db_masmis        apr           ncosec
 @14.97.30.236                                                        + lms, Shivamgiri
 MySQL 5.5.44
 404 tables
 LEGACY PAYROLL
 = source of truth
```

Host fallback (LAN → public) is centralised in `backend/scripts/lib/db-connect.mjs`:

| Database | LAN | Public |
|---|---|---|
| `mas_hrms` | 192.168.10.6 | 122.184.128.90 |
| `db_bill` | 192.168.10.22 | 14.97.30.236 |

### Which modules cross the boundary

| Upstream DB | Modules that read it |
|---|---|
| `db_bill` | payroll, employees, finance, leave, erp, legacy, migration, business-intelligence, `_workers`, `_db` |
| `dialer_db` | call-master, quality-dashboard, `_workers`, `_db` |
| `ncosec` | wfm, break-management, `_db` |
| `apr` | apr, `_db` |
| `db_masmis` | `_db` (+ sales-upload via qualified name) |
| `lms` | lms, lms-integration, job-requisition |

`db_bill` is guarded by `billQuery()` in `backend/src/db/billDb.ts`, which enforces a
SELECT/SHOW/DESCRIBE/EXPLAIN allowlist. Because db_bill is MySQL 5.5, session-level
`READ ONLY` does not exist there — **the allowlist and the account GRANTs are the only
protection**.

---

## 3. Application layers

```
backend/src/
├─ app.ts              292 router mounts, middleware chain
├─ server.ts           17 schedulers + workers bootstrapped here
├─ config/             env parsing/validation
├─ middleware/         authMiddleware · requireRole · scopeMiddleware
│                      requireClientAuth · requireWFMAccess · requireAgent
│                      rateLimiter · errorHandler
├─ platform/           domain-registry · data-governance · route-contract
│  └─ policy/          roles.ts (54 RoleKeys, alias tables) · permissions.ts
├─ modules/            127 business domains
├─ shared/             58 cross-cutting helpers (audit, PII mask, field
│                      encryption, scope, IST dates, money-event audit)
├─ db/                 mysql.ts (write) + 8 read-only pools + migration runner
├─ workers/ jobs/ cron/  background execution
└─ scripts/            migration + reconciliation CLI (dbbill-salary-mapping.mjs)
```

Request path: `helmet → cors → json → morgan → globalLimiter → requireAuth →
requireRole → [scopeMiddleware] → handler → errorHandler`.

**Authorisation is layered, and the layers are independent:**
1. `requireRole` — role membership (JS-side, after normalisation + alias expansion)
2. `scopeMiddleware` / `enterpriseScope` — row scope (branch / process / LOB)
3. `data-governance.ts` — field-level classification, payroll never leaves payroll roles
4. `privacy` / `piiMask` / `portalMask` — response redaction per audience

Holding a role is not the same as having scope. The NEFT export bug found earlier
(`admin` implying org-wide) was exactly a confusion between layers 1 and 2.

---

## 4. Core entity graph

FK in-degree identifies the real hubs:

| Table | Referenced by | Role |
|---|---|---|
| **employees** | **180 tables** | the spine of the whole platform |
| process_master | 43 | process / LOB dimension |
| branch_master | 43 | location dimension |
| ats_candidate | 26 | pre-hire spine |
| auth_user | 15 | identity, separate from `employees` |
| designation_master | 11 | |
| cost_centre_master | 11 | finance dimension |
| department_master | 10 | |

```
      auth_user ──1:1──► employees ──180 FK──► everything
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  branch_master        process_master        cost_centre_master
  (43 refs)            (43 refs)             (11 refs)
```

`ats_candidate → employees` is the conversion seam between recruitment and HR.

**FK coverage is thin: only 384 of 1,032 tables declare any foreign key. 648 have
none.** Referential integrity is therefore mostly enforced in application code, not
by the database — which is why orphan and mismatched rows are a recurring theme.

---

## 5. Domain map (top modules by size)

| Module | Files | LOC | Routes | Reads | Writes | Upstream |
|---|---|---|---|---|---|---|
| ats | 94 | 37,534 | 315 | 155 | 150 | — |
| **payroll** | 75 | 33,780 | 298 | 175 | 95 | db_bill |
| reporting | 67 | 33,206 | 38 | 202 | 8 | — |
| wfm | 79 | 29,276 | 209 | 121 | 83 | ncosec |
| process-pnl | 51 | 26,176 | 140 | 131 | 61 | — |
| employees | 47 | 20,633 | 126 | 132 | 70 | db_bill |
| finance | 36 | 17,581 | 123 | 101 | 46 | db_bill |
| ai | 37 | 11,139 | 29 | 61 | 18 | — |
| `_workers` | 48 | 9,852 | 0 | 76 | 49 | dialer_db, db_bill |
| management | 25 | 9,293 | 24 | 90 | 5 | — |

`reporting` is read-heavy by design (202 reads / 8 writes) — it is a projection layer.
`_workers` has zero routes and 49 write targets — it is the async spine.

### The 11 domains (per MODULE_JOURNEY_REGISTRY)

People · Recruitment · Workforce · Payroll · Performance · Learning ·
Employee Experience · Finance · External Portals · Platform

---

## 6. Table ownership

Ownership = which module issues writes.

| Writers | Tables | Reading |
|---|---|---|
| 1 | **732** | clean single ownership |
| 2 | 101 | acceptable |
| 3 | 30 | review |
| 4–7 | 18 | contention |
| 9, 10, 15 | 3 | hotspots |

Highest-contention tables:

| Table | Writers | Modules |
|---|---|---|
| ats_candidate | 7 | ats, ats-extensions, ats-full-parity, employees, auth, job-requisition, `_workers` |
| attendance_daily_record | 5 | attendance, leave, payroll, wfm, `_shared` |
| employee_documents | 5 | employees, it-provisioning, lifecycle, payroll, `_db` |
| auth_user | 5 | auth, account-control, employees, it-provisioning, privacy |
| employee_bank_detail | 4 | employees, onboarding, payroll, `_workers` |

`attendance_daily_record` with 5 writers is the structural reason attendance and
payroll disagree: payroll both reads and writes the table it depends on, alongside
three other modules.

---

## 7. The payroll spine (65 write-owned tables)

```
CONFIG        statutory_config · payroll_config_flags · payroll_calendar
              pt_slab_master · salary_component_master · payroll_deduction_type
                    │
PACKAGE       salary_structure_master · employee_salary_assignment
              salary_component_assignments · salary_package_master
              employee_salary_history
                    │
READINESS     payroll_branch_readiness ◄── branch WFM + branch Payroll HR gates
              salary_verification_flag · salary_employee_verification
              payroll_attendance_conflict_review
                    │
INPUT         attendance_daily_record · employee_deduction_entries
              holiday_work_request · employee_loans · salary_advance_log
              employee_reimbursement_claim · incentive_payroll_register
                    │
RUN           salary_prep_run ──1:N──► salary_prep_line ──1:N──► salary_prep_line_component
              (status varchar(50), mixed case: 'FINALIZED' vs 'approved')
                    │
STATUTORY     employee_uan · employee_epf_compliance_profile
              employee_statutory_override · tax_declaration
              tds_certificate_part_a · statutory_filing_record
                    │
OUTPUT        salary_payslip · salary_register · payroll_register_export_log
                    │
MONEY OUT     employee_bank_detail (verified flag) · payroll_bank_exception
              bank_penny_drop_log · salary_run_disbursal · payroll_disbursement
                    │
AUDIT         payroll_calculation_audit · payroll_validation_log
              salary_register_audit_log · sensitive_action_log
```

Lifecycle (from `payroll-lifecycle.ts`):
```
draft → calculating → calculated → under_review → approved → locked → disbursed
                                    ▲
        processing ─────────────────┘   (what the real calculator writes)
        finalized  → locked             (what production actually holds: 51/67 runs)
```
Two parallel status vocabularies coexist. `finalized` is the real terminal state in
production and was originally absent from both the transition map and the closed-run
set — the reason settled runs stayed editable.

---

## 8. RBAC graph

- `Role` enum defines **54 canonical role keys** (`platform/policy/roles.ts`)
- `LEGACY_ROLE_EQUIVALENTS` maps legacy labels → canonical (e.g. `wfm_spoc → wfm`, `branch_it → it`, `payroll_admin → payroll`, `management →` 6 roles)
- `ROLE_ALIASES` adds bidirectional pairs: `process_manager ↔ manager`, `team_leader ↔ tl`, `wfm ↔ wfm_analyst`
- Guards resolve **in JS**, after `normalizeRoleInputs()` (case-folds, `-`/space → `_`) then `expandRoles()`
- `super_admin` short-circuits every check
- Failure mode is **fail-closed**: any error returns 503, not 200

### Roles actually held (active, from `user_roles`)

26 distinct keys. Largest: `Employee` 1384, `process_manager` 18, `hr` 16,
`recruiter` 12, `wfm` 12, `interviewer` 11, `manager` 6.
Payroll-relevant: `payroll_hr` 7 · `payroll` 6 · `payroll_head` 2 · `finance_head` 1.

### FINDING — 20 canonical roles guard routes but no user holds them

| Role | Routes guarded | Users |
|---|---|---|
| **finance** | **201** | **0** |
| operations_manager | 51 | 0 |
| payroll_branch | 27 | 0 |
| recruitment_hr | 21 | 0 |
| dpo | 16 | 0 |
| hr_admin | 15 | 0 |
| compliance | 10 | 0 |
| wfm_analyst / wfm_spoc | 13 | 0 (resolve via alias → `wfm`) |
| tl | 5 | 0 (resolves via alias → `team_leader`) |
| sales, operations_head, quality_analyst, operations, management, coo, it_admin, branch_it, branch_hr, ho_hr | 27 | 0 |

Some resolve through the alias tables (`wfm_analyst`, `wfm_spoc`, `tl`, `branch_it`,
`it_admin`, `management`). **These do not:** `finance` (201 routes), `operations_manager`
(+`operations`, `operations_head` = 58), `payroll_branch` (27), `recruitment_hr` (21),
`dpo` (16), `compliance` (10). `finance_head` does **not** expand to `finance`, so the
single finance_head user is denied on 201 finance-guarded routes.

### FINDING — 13 guard strings are not canonical role keys at all

`agent · branch_manager · cfo · hr_head · imprest_manager · it_head · process_hr ·
quality · Quality · tq_head · trainee · training_manager · WFM`

`WFM` and `Quality` survive because `normalizeRoleInputs` case-folds. The rest can
never match anything — including `it_head` and `tq_head`, which **do** have real users
under those exact keys but are absent from the enum.

---

## 9. FINDING — 12 tables are written by code but do not exist

Every one has no lazy `CREATE TABLE IF NOT EXISTS`. These throw `ER_NO_SUCH_TABLE`
at runtime.

| Table | Written by | Migration |
|---|---|---|
| mcnmeet_meeting, _audience, _event, _invitee | mcnmeet | `1049_mcnmeet_module.sql` — **not applied** |
| client_invoice_payment_log, _status | finance | `1560_client_invoice_payment_tracking.sql` — **not applied** |
| incentive_approval_log | incentives | `136_incentive_module.sql` — **not applied** |
| leave_requests | `_shared` deprovisioning | `208_sync_leave_from_db_bill.sql` — **not applied** |
| org_chart_data_issue | org-chart | `402_org_chart_foundation.sql` — **not applied** |
| quality_audit | performance-feedback | `505_...connector_keys.sql` — **not applied** |
| employee_asset_assignment | `_shared` deprovisioning | **none** |
| tat_task_completions | inbox | **none** |
| portal_sessions | lms | **none** |
| trainee_master | lms-provisioning | **none** |
| email_queue | salary-dispute | **none** |
| ats_bgv_check | ats/mock-digilocker | **none** |

Two sit in `employeeDeprovisioning.ts` — meaning employee offboarding is partially
broken: it tries to clear assets and leave from tables that were never created.

---

## 10. FINDING — 188 orphan tables

Exist in `mas_hrms`, referenced by zero module. 21 are backups/archives
(`*_bk_*`, `*_20260829`). **167 are genuinely dead**, concentrated in `ats_*` (16),
`salary_*` (14), `employee_*` (14), `candidate_*` (8), plus 9 `v_*` views.

---

## 11. Reconciliation harness (already built, not wired in)

| Script | Purpose | Flags |
|---|---|---|
| `lib/dbbill-salary-mapping.mjs` | **authoritative** db_bill↔HRMS column map, earned-vs-entitlement rule, net identity | — |
| `lib/db-connect.mjs` | LAN→public fallback for both DBs | — |
| `audit-component-parity-vs-dbbill.mjs` | read-only per-component parity | `--month=` `--samples=` |
| `resync-diff-months-salary.mjs` | detect + re-sync divergent months | `--dry-run` `--month=` `--repair-components` |
| `sync-salary-gap-from-dbbill.mjs` | fill missing months | `--dry-run` |
| `fix-present-days-from-dbbill.mjs` | backfill `EarnedDays` | `--month=` |

All exclude `EmpCode LIKE 'IDC%'` — the deliberate IDC carve-out.

---

## 12. Files in this directory

| File | Rows | Contents |
|---|---|---|
| `graph.json` | — | full machine-readable graph |
| `routes.tsv` | 3,022 | module, method, path, roles, file |
| `table_refs.tsv` | 6,841 | module → table, read/write, file |
| `table_owners.tsv` | 891 | table → writing modules |
| `modules.tsv` | 127 | per-module metrics |
| `fk_edges.tsv` | 607 | foreign-key graph |
| `tables.tsv` | 1,032 | table, rows, MB, collation |
| `cross_db.tsv` | 41 | module → upstream database |
| `payroll_spine_real.txt` | 65 | payroll write-owned tables |
| `orphan_tables.txt` | 188 | unreferenced tables |
| `phantom_written.txt` | — | written-but-absent candidates |

### Known limits of this extraction
Regex-based, not a TypeScript parse. Table names built by string interpolation are
missed. Dynamic `requireRole(...SPREAD)` appears as `<spread>` (490 routes) and its
members are not resolved. Prose in comments can produce false positives — the
`ON DUPLICATE KEY UPDATE` case was found and fixed, which cut false table writes from
1,081 to 891. Treat the TSVs as a high-confidence map, not a proof.
