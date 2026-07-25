# BPO Master Reports — Source Accuracy & Production-Schema UAT Matrix

## Purpose

This checklist validates all 14 comprehensive BPO master reports against the connected production-like HRMS database before the pull request is marked ready or deployed. Build success proves code compatibility only; it does not certify business-value accuracy.

## Mandatory live validation endpoint

Run the restricted endpoint for the selected reporting period before manual UAT:

`GET /api/reports/bpo-master/validation/source-accuracy?month=YYYY-MM`

It executes all reports with a minimal sample and reports:

- runtime SQL failures;
- missing source tables or columns;
- exact, derived and unavailable field counts;
- source row count and distinct report-grain count;
- duplicate grain keys;
- no-data conditions;
- coverage percentage;
- reports that still require value reconciliation.

The endpoint intentionally returns `valueAccuracyCertified: false` until source totals, report totals and business-owner sign-off are completed.

## Global acceptance criteria

Every report must satisfy all of these checks:

- `EMPLOYEE_CODE` is present as the first identity field.
- Employee-level rows contain a real HRMS employee code.
- Pre-join candidate rows contain `PENDING EMPLOYEE CODE` only when no employee code exists yet.
- Aggregate reports contain `AGGREGATE` and never an invented employee identity.
- `REPORT_DATE` is populated and displayed as `DD-MMM-YYYY`.
- Monthly periods display as `MMM-YYYY`.
- All headers are uppercase.
- The declared primary key does not duplicate unexpectedly.
- A zero is shown only when a successfully executed source calculation returns zero.
- Missing tables/columns are shown as unavailable; they are never replaced with guessed synonyms.
- Every populated field exposes exact or derived lineage with source schema/table/column and transformation.
- Source record IDs are retained in event/audit reports.
- Source row count, report row count and distinct grain count reconcile.
- Source totals and report totals reconcile for all numeric measures.
- Source maximum timestamp and report freshness are within the agreed SLA.
- Orphan employee, Branch, Process, Client and candidate mappings are zero or formally accepted.
- Branch-restricted users cannot see another Branch.
- A user without Branch scope receives no company-wide data.
- Pre-join candidates with an unresolved Branch mapping are hidden from Branch-scoped users.
- Sensitive fields are masked in API responses for view-only users.
- Full Excel export is rejected for users without export authority.
- Excel uses the same uppercase headers and field order as the screen.
- The report can run for a full month without timing out.
- Operations/HR/Payroll/Finance/Quality/Audit owners sign the reconciliation evidence.

## Role test accounts

Validate with representative users for:

- Super Admin
- CEO/COO
- Branch Head
- HR Head and Branch HR
- Operations Manager / Process Manager / Team Leader
- WFM
- Quality / QA
- Payroll Head / Payroll Branch
- Finance Head / Accounts
- Recruiter / Recruitment Head
- Trainer / Training
- IT Manager / Facility / Security
- Compliance Head / Internal Auditor

## 1. BPO Operations & Productivity Master

**Filters:** one date, seven-day range, one Branch, one Process, one employee.

Validate:

- one row per employee/date/Process-LOB;
- roster shift and scheduled time against `wfm_roster_assignment` and `wfm_shift_master`;
- login/logout against `wfm_attendance_session`;
- productive minutes against final attendance/reconciliation;
- break minutes against `break_daily_summary`;
- productivity metrics only use exact Productivity/Tasks Completed KPI codes; Dials are not substituted;
- AHT, Quality, SLA, CSAT and NPS use exact KPI metric codes;
- KPI actuals use `kpi_daily_actual.score_date` where present;
- targets use `kpi_employee_resolved` and remain separate from achieved values;
- shrinkage/adherence reconcile with the WFM report;
- no source column is populated from an unrelated semantic field.

## 2. BPO Employee Performance 360 Master

**Filters:** current month, previous month, one employee, one team/Process.

Validate:

- one row per employee/report month;
- snapshot is not filtered by employee `updated_at`;
- attendance counts reconcile with final attendance;
- KPI values reconcile with Operations/Quality;
- management summary uses `period`, `overall_score`, `rank_position` and `trend` where available;
- unavailable previous-score/rolling-average fields remain unavailable unless a real source exists;
- PIP, coaching, training and certification values match source modules;
- incentive amount is masked for a view-only role and visible only to authorised exporters.

## 3. BPO Client SLA, Delivery & Commercial Master

**Filters:** one Client, one Process/LOB, one date and full month.

Validate:

- `EMPLOYEE_CODE = AGGREGATE`;
- one row per Client/Process-LOB/date;
- output comes from the canonical allocation-aware BPO P&L/delivery engine;
- forecast and actual volume are separate;
- opening and closing backlog reconcile day to day;
- planned, rostered, present and productive FTE reconcile with WFM;
- SLA, TAT, AHT, Quality, CSAT and NPS match client governance figures;
- revenue, penalties, direct cost and margin reconcile with Finance;
- commercial values are restricted to authorised roles.

## 4. BPO WFM, Attendance & Shrinkage Master

**Filters:** one date, night-shift date, one employee, one Process and one month.

Validate:

- one row per employee/attendance date;
- roster version, shift and scheduled minutes are correct;
- first/last biometric punch and processed attendance remain separate;
- source hierarchy is documented: final attendance, roster, biometric, session, break and reconciliation;
- leave, week off and holiday flags are correct;
- late, early logout, short attendance and overtime are calculated correctly;
- mini/long break counts use `break_daily_summary` and configured thresholds;
- regularisation approval and timestamp are visible;
- payable day and LWP impact reconcile with Payroll;
- cross-midnight shifts are assigned to the correct attendance date.

## 5. BPO HR Workforce & Employee Lifecycle Master

**Filters:** current as-of date, one Branch, active/inactive employees and one employee.

Validate:

- one row per employee/as-of date;
- organisation and manager match employee master and organisation masters;
- address comes from `employee_address`, not guessed employee columns;
- emergency contact comes from `employee_emergency_contact`;
- probation/confirmation comes from `employee_probation`;
- contract terms come from `employee_contract`;
- promotion/increment/transfer dates come from `employee_lifecycle_event`/job history;
- document, PAN, UAN, ESIC and bank statuses reconcile with exact sources;
- BGV uses the ATS onboarding bridge and candidate BGV checks;
- resignation, LWD and clearance reconcile with exit modules;
- PII is masked for unauthorised roles.

## 6. BPO Payroll, Compensation & Statutory Master

**Filters:** one payroll month, one run, one Branch and one employee.

Validate:

- one row per employee/month/run;
- `salary_prep_line` and `salary_prep_run` are the primary payroll truth;
- attendance and payable-day inputs reconcile with WFM;
- Basic uses `basic`, Net Pay uses `net_salary`, Leave uses `leave_days`;
- extended columns are used only when present in runtime schema;
- all earning components sum to gross earnings;
- all deduction components sum to total deductions;
- gross minus deductions equals net pay;
- PF, ESIC, PT and TDS eligibility/values are correct;
- bank, UAN, ESIC and PAN values are masked as configured;
- calculated, payslip and disbursal statuses remain separate;
- UTR remains unavailable unless an exact payment-evidence source exists;
- month-on-month variance is mathematically correct where sourced.

## 7. BPO Finance, P&L & Profitability Master

**Filters:** one finance month, Branch, Client and Process/LOB.

Validate:

- `EMPLOYEE_CODE = AGGREGATE`;
- one row per Branch/Client/Process-LOB/month;
- canonical allocation-aware BPO P&L service is the only calculation engine;
- planned/actual billing units remain separate;
- planned, earned, recognised, invoiced, collected, unbilled and deferred revenue remain separate;
- payroll, DSC, BMC, GRN/vendor and allocated costs remain distinct;
- contribution, EBITDA, EBIT, PBT and PAT reconcile to the canonical P&L screen/export;
- budget, reserved, consumed and available amounts reconcile;
- commercial fields are restricted.

## 8. BPO Quality, Risk & Compliance Master

**Filters:** one employee, one audit date range, fatal errors only and one Process.

Validate:

- one row per employee/audit ID;
- source is fully qualified `db_audit.call_quality_assessment`;
- employee mapping uses the audit User/agent code and HRMS employee code;
- audit score uses `quality_percentage`/verified exact source;
- fatal rule matches the existing quality engine: score below 50 plus Professionalism or Active Listening failure;
- checkpoint counts include only columns existing in runtime schema;
- error category, evidence, feedback and risk fields remain unavailable unless exact source columns exist;
- no fabricated dispute/calibration/CAPA values are returned;
- restricted impact values are masked.

## 9. BPO Recruitment, Onboarding & Training Readiness Master

**Filters:** one recruiter/source/Branch/Process and joining month.

Validate:

- one row per candidate/report date;
- pre-join rows use `PENDING EMPLOYEE CODE`;
- joined rows use the ATS onboarding bridge employee code;
- Branch scope resolves by bridged employee Branch or exact ATS Branch-name match to `branch_master`;
- unmatched Branch candidates are hidden from Branch-scoped users;
- candidate stage history comes from `ats_candidate_stage_log`;
- offer data comes from the latest `ats_offer_letters` record;
- BGV comes from candidate BGV checks;
- LMS readiness is populated only after an employee bridge exists;
- offered CTC and candidate PII are restricted;
- requisition/interviewer/training fields remain unavailable when no exact source contract exists.

## 10. BPO Admin, Asset, IT & Facility Master

**Filters:** one employee, one asset category, active custody and exit-pending recovery.

Validate:

- one row per employee/asset assignment/date;
- asset tag, serial, make/model and status match `asset_master`;
- assignment and return dates match `asset_assignment`;
- IT provisioning uses `it_provisioning_request`;
- application access uses `auth_user`;
- open/overdue helpdesk counts reconcile with `helpdesk_ticket`;
- facility fields stay unavailable until exact facility sources exist;
- exit recovery is not inferred unless an actual exit date and return evidence exist.

## 11. BPO Executive Management Master

**Filters:** one month, Branch, Client and Process/LOB.

Validate:

- `EMPLOYEE_CODE = AGGREGATE`;
- one row per Branch/Client/Process-LOB/month;
- values reuse the canonical BPO P&L engine;
- workforce/delivery/revenue/cost/profit metrics reconcile with their domain masters;
- risks and actions do not invent owners or dates;
- unavailable management dimensions remain clearly unavailable.

## 12. BPO Audit, Compliance, Risk & Control Master

**Filters:** one date range, module, actor, employee and action type.

Validate:

- one row per source table/source record/activity timestamp;
- events include `audit_action_log`, `sensitive_action_log` and approval actions where available;
- source schema, table and record ID are never blank for populated events;
- actor raw ID, employee code, name and role resolve correctly;
- subject employee/candidate identity resolves correctly;
- old/new/change values remain masked for unauthorised roles;
- non-JSON approval summaries never break JSON extraction;
- policy, privacy, statutory, risk, evidence and CAPA fields populate only when present in valid metadata;
- Branch scope is fail-closed;
- evidence and verification status reconcile with actual records.

## 13. BPO Interview-to-Exit Journey & Activity Ledger

**Filters:** one candidate, one employee, one Branch and full lifecycle date range.

Validate:

- one row per person/event timestamp/source table/source record;
- chronology includes candidate creation, interview-stage transitions, offer, onboarding bridge, BGV, employee creation, lifecycle, leave/regularisation, coaching/PIP, payroll, exit approvals and clearance;
- each event includes activity timestamp, actor, approver, status, previous/new state and source record ID where sourced;
- `EVENT_SEQUENCE` is chronological per person;
- `DAYS_FROM_PREVIOUS_EVENT` uses raw event timestamps;
- candidate events link to the employee after onboarding bridge creation;
- pre-join events retain `PENDING EMPLOYEE CODE`;
- Branch-scoped users do not receive unresolvable pre-join events;
- no event timestamp is replaced by record-update time unless that is the only authoritative event timestamp;
- missing activity domains are exposed in lineage/UAT, not fabricated.

## 14. BPO Report Data Lineage, Reconciliation & Accuracy Master

**Filters:** one report code and full suite.

Validate:

- one row per report field/source contract;
- runtime table and column existence uses `information_schema`;
- unqualified tables resolve to the current HRMS database before external schemas;
- external Quality table is referenced fully qualified;
- exact columns and derived fields are clearly distinguished;
- missing fields are marked derived/unavailable;
- null and zero policies are stated;
- duplicate grain, source/report counts and reconciliation status are shown;
- `UAT_STATUS` remains pending until authenticated source/report comparison and owner sign-off;
- this report never claims 100% value accuracy from schema checks alone.

## Final release decision

The PR may be marked ready only when:

- focused TypeScript/build/contract workflow is green on the latest head;
- `/validation/source-accuracy` has no runtime query failures or duplicate-grain failures;
- representative production-schema UAT is complete for all 14 reports;
- Branch-scope and sensitive-data tests pass;
- no report shows fabricated zero values or guessed source mappings;
- numeric source totals reconcile exactly or have approved documented variance;
- Operations, HR, Payroll, Finance, Quality, Recruitment, Admin and Audit/Compliance owners sign their sections;
- the lineage report shows UAT complete for all release-critical fields.
