# BPO Master Reports — Production-Schema UAT Matrix

## Purpose

This checklist validates the 11 comprehensive BPO master reports against the connected production-like HRMS database before the pull request is marked ready or deployed.

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
- A zero is shown only when the source query successfully returns zero.
- Missing tables/columns are shown in the unavailable-column list.
- Branch-restricted users cannot see another Branch.
- A user without Branch scope receives no company-wide data.
- Sensitive fields are masked in API responses for view-only users.
- Full Excel export is rejected for users without export authority.
- Excel uses the same uppercase headers and field order as the screen.
- The report can run for a full month without timing out.

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
- View-only employee where applicable

## 1. BPO Operations & Productivity Master

**Filters:** one date, seven-day range, one Branch, one Process, one employee.

Validate:

- one row per employee/date/Process-LOB;
- roster shift and scheduled time against WFM roster;
- login/logout and productive minutes against attendance/session sources;
- received, assigned, completed, pending and rejected volume against the production source;
- productivity target and achieved remain separate;
- AHT target and achieved remain separate;
- quality score, audit count and fatal errors reconcile with Quality;
- shrinkage and adherence reconcile with the WFM report;
- action owner, due date and status reconcile with Business Actions.

## 2. BPO Employee Performance 360 Master

**Filters:** current month, previous month, one employee, one team/Process.

Validate:

- one row per employee/report month;
- snapshot is not filtered by employee `updated_at`;
- attendance counts reconcile with the WFM master report;
- productivity and quality reconcile with Operations and Quality masters;
- previous-month movement and three-month average use the correct periods;
- PIP, coaching, feedback, training and certification values match source modules;
- incentive amount is masked for a view-only role and visible only to authorised exporters.

## 3. BPO Client SLA, Delivery & Commercial Master

**Filters:** one Client, one Process/LOB, one date and full month.

Validate:

- `EMPLOYEE_CODE = AGGREGATE`;
- one row per Client/Process-LOB/date;
- forecast and actual volume are separate;
- opening and closing backlog reconcile day to day;
- planned, rostered, present and productive FTE reconcile with WFM;
- SLA, TAT, AHT, Quality, CSAT and NPS match client governance figures;
- revenue, penalty, direct cost and margin reconcile with Finance;
- commercial values are restricted to authorised roles.

## 4. BPO WFM, Attendance & Shrinkage Master

**Filters:** one date, night-shift date, one employee, one Process and one month.

Validate:

- one row per employee/attendance date;
- roster version, shift and scheduled minutes are correct;
- first/last biometric punch and processed attendance remain separate;
- leave, week off and holiday flags are correct;
- late, early logout, short attendance and overtime are calculated correctly;
- mini/long break counts use configured thresholds;
- regularisation approval and timestamp are visible;
- payable day and LWP impact reconcile with Payroll;
- cross-midnight shifts are assigned to the correct attendance date.

## 5. BPO HR Workforce & Employee Lifecycle Master

**Filters:** current as-of date, one Branch, active/inactive employees and one employee.

Validate:

- one row per employee/as-of date;
- organisation, manager, grade, band and employment type match employee master;
- probation, confirmation and contract dates match lifecycle tables;
- promotion, increment and transfer dates match job history;
- document, PAN, UAN, ESIC and bank statuses reconcile with source records;
- BGV and onboarding percentages are accurate;
- resignation, LWD, clearance and F&F statuses reconcile with exit modules;
- PII is masked for unauthorised roles.

## 6. BPO Payroll, Compensation & Statutory Master

**Filters:** one payroll month, one run, one Branch and one employee.

Validate:

- one row per employee/month/run;
- attendance and payable-day inputs reconcile with the WFM master;
- all earning components sum to gross earnings;
- all deduction components sum to total deductions;
- gross minus deductions equals net pay;
- PF, ESIC, PT and TDS eligibility and values are correct;
- bank, UAN, ESIC and PAN values are masked as configured;
- calculated, payslip and disbursal statuses remain separate;
- UTR and disbursal date reconcile with payment evidence;
- month-on-month variance is mathematically correct.

## 7. BPO Finance, P&L & Profitability Master

**Filters:** one finance month, Branch, Client and Process/LOB.

Validate:

- `EMPLOYEE_CODE = AGGREGATE`;
- one row per Branch/Client/Process-LOB/month;
- planned and actual billing units remain separate;
- planned revenue, recognised revenue, unbilled and deferred revenue remain separate;
- payroll, incentive, overtime, training, recruitment, facility, technology and vendor costs are distinct;
- direct cost plus overhead equals total cost;
- revenue minus total cost equals gross profit;
- margin percentages are correct;
- budget, GRN, P&L-recognised cost, vendor payable and cash paid are not collapsed;
- outstanding receivable/payable and DSO reconcile with Finance records;
- period-close snapshot and blockers are correct.

## 8. BPO Quality, Risk & Compliance Master

**Filters:** one employee, one audit date range, fatal errors only and one Process.

Validate:

- one row per employee/audit ID;
- audit form version and sample type are correct;
- score is calculated from passed/failed checkpoints correctly;
- error category, subcategory, field and severity match audit details;
- fatal, customer-impact, compliance and privacy flags are correct;
- dispute and calibration outcomes reconcile with source modules;
- RCA, corrective action, owner, due date and verification are complete;
- recurrence and 30-day repeat counts are accurate;
- restricted risk/financial-impact fields are masked when required.

## 9. BPO Recruitment, Onboarding & Training Readiness Master

**Filters:** one requisition, recruiter, source, batch and joining month.

Validate:

- one row per candidate/requisition;
- pre-join rows use `PENDING EMPLOYEE CODE`;
- joined rows use the generated employee code;
- requisition demand, source, recruiter and all interview stages are accurate;
- offer, expected joining, actual joining and no-show values are correct;
- time-to-hire and time-to-join are correct;
- document and BGV statuses reconcile with onboarding;
- training attendance, assessment, certification and OJT results are accurate;
- production release and time-to-productivity are correct;
- offered CTC and candidate PII are restricted.

## 10. BPO Admin, Asset, IT & Facility Master

**Filters:** one employee, one asset category, active custody and exit-pending recovery.

Validate:

- one row per employee/item/date;
- asset tag, serial, make/model and condition match inventory;
- assignment and return dates match custody records;
- IT provisioning, application/VPN access and approver are correct;
- access-review due and deprovision dates are correct;
- open/overdue helpdesk counts reconcile with Helpdesk;
- seat, access card, parking and locker allocation match facilities;
- service due, warranty and AMC status are correct;
- exit recovery reconciles with clearance.

## 11. BPO Executive Management Master

**Filters:** one month, Branch, Client and Process/LOB.

Validate:

- `EMPLOYEE_CODE = AGGREGATE`;
- one row per Branch/Client/Process-LOB/month;
- workforce, joiners, exits and attrition reconcile with HR;
- absenteeism, shrinkage and adherence reconcile with WFM;
- productivity, AHT and SLA reconcile with Operations;
- Quality, fatal, CSAT and NPS reconcile with Quality/Client reports;
- payroll cost, revenue, total cost, profit and margin reconcile with Finance;
- risks, actions and management decisions have owners and dates;
- overall business-health score has a documented calculation.

## Final release decision

The PR may be marked ready only when:

- focused TypeScript/build/contract workflow is green on the latest head;
- representative production-schema UAT is complete for all 11 reports;
- Branch-scope and sensitive-data tests pass;
- no report shows fabricated zero values;
- data owners sign off Operations, HR, Payroll, Finance and Quality reconciliations.
