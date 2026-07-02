# PeopleOS Walk-in Candidate Journey Memory

Date: 30-May-2026
Status: Mandatory product memory for ATS to HRMS lifecycle.

## Core outcomes

Walk-in candidate journey has two outcomes:

1. Selected path: registration -> checks -> screening -> assessment -> interview -> selection -> offer -> pre-joining -> document verification -> HR approval -> employee ID generation -> employee page/stat card -> training/LMS -> roster/attendance/payroll -> active employee lifecycle -> resignation workflow -> clearance/F&F/relieving.
2. Non-selected path: registration -> checks -> screening/assessment/interview -> final non-selection status -> reason captured -> communication -> cooling/reprocess status -> candidate journey closed in ATS only.

Candidate becomes an employee only after HR-approved conversion and employee ID generation. Until then, the person remains a candidate record. If final decision is not selected, employee ID, employee page, payroll mapping, roster mapping and LMS employee mapping must not be created.

## Common stages before decision

1. Walk-in registration
- Page: Walk-in Registration / Candidate Intake
- Capture: name, mobile, email, branch visited, process applied, role applied, source, timestamp, education, experience, shift preference, joining availability.
- Output: Candidate ID, queue token, journey event, status Registered.
- Config: Branch Master, Process Master, Designation Master, Candidate Source Master, Communication Template Master.

2. Duplicate / reprocess / ex-employee check
- Check: mobile, email, candidate history, previous application status, cooling period, employee history, rehire eligibility.
- Output: clear, duplicate review, reprocess allowed, reprocess not allowed, ex-employee review, active employee review.
- Config: Duplicate Rule Master, Cooling Period Rule, Rehire Rule, Employee Master, ATS Candidate History.

3. Queue allocation
- Page: Recruiter Queue / Walk-in Queue
- Action: assign recruiter by branch/process/availability, start SLA timer, show in queue.
- Config: Recruiter Availability, Queue SLA Rule, Branch/Process Scope.

4. Recruiter screening
- Validate: communication, education, experience, salary fit, shift comfort, location comfort, process fit, stability, document availability, joining availability.
- Outcomes: pass, fail, hold, re-screen, candidate not interested, no-show.
- Config: Screening Parameter Master, Process Eligibility Rule, Reason Master.

5. Assessment / skill test
- Types: typing, communication, reading, AI/Pehchan, Excel, sales simulation, language, process skill.
- Capture: type, score, result, evaluator, remarks, timestamp, evidence if applicable.
- Config: Assessment Type Master, Cutoff Rule, Process Assessment Rule.

6. Interview
- Interviewers: recruiter, TL, AM, process manager, QA/trainer, client panel, senior operations panel.
- Outcomes: selected, non-selected, hold, client round pending, re-interview, no-show.
- Config: Interview Round Master, Panel Mapping, Interview Decision Rule, Reason Master.

## Selected path configuration

1. Selection
- Status becomes Selected.
- Offer and pre-joining are triggered.
- Notify candidate, recruiter, HR and process manager where required.
- Config: Offer Template Master, Pre-Joining Rule, Communication Template.

2. Offer
- Checks: branch, process, LOB, cost centre, designation, salary/CTC, offer template, joining date, approval requirement.
- Candidate action: view, acknowledge, accept/decline, e-sign/consent where configured.
- Config: Offer Template, Cost Centre Config, Designation Master, Salary Rule, Approval Matrix, Communication Template, Consent Ledger.

3. Pre-joining portal
- Pages: /prejoining/login, /prejoining/:token, Pre-Joining Wizard, Resume Upload / Photo Capture, Review & Submit.
- Autofill from ATS: name, mobile, email, branch, process, role/designation, recruiter, interview result, offer details.
- Candidate completes: basic, contact, personal, education, experience, family, address, bank, statutory, emergency contact, documents, declarations, review.
- Resume/photo parsing creates draft values only. Candidate must validate/correct.
- Config: Pre-Joining Checklist, Privacy Notice, Resume Parsing Consent, Consent Ledger, Document Checklist.

4. Document verification
- Scope: branch, process, LOB, cost centre, role/designation, client requirement.
- Status: pending, uploaded, verified, correction required, waived by approval, on hold.
- Mandatory items must be accepted or approved by override before conversion.
- Config: Document Checklist, Verification Rule, Approval Matrix, Privacy Audit.

5. HR joining approval
- Confirm: offer accepted if mandatory, pre-joining submitted, mandatory documents accepted/overridden, BGV acceptable by rule, branch/process/LOB/cost centre mapping, designation, employee ID rule, duplicate/rejoin clear.
- If any item missing, do not create employee yet; show blocker list.
- Config: Joining Gate Rule, Employee ID Rule, Branch/Process/LOB/Cost Centre Master.

6. Employee ID and employee creation
- Rule priority: Cost Centre -> LOB -> Process -> Client -> Branch -> Global.
- Action: resolve rule, lock sequence, generate employee code, check uniqueness, log ID, create employee, stat card, assignment history, cost-centre history, journey event, user/portal mapping.
- Config: Employee ID Rule, Employee ID Generation Log, Employee Master, Audit.

7. Employee page/stat card
- Route: /employees/:employeeId
- Show: employee ID, name, current designation, designation history, system roles, branch, client, process, LOB, cost centre, department, manager/TL/AM/PM, joining date, source, offer/document/BGV/training status, roster eligibility, attendance, payroll readiness, performance, quality, assets, journey timeline.
- Rule: every internal person is an Employee entity; designation and system role are separate.

8. LMS / training / certification
- Action: map to existing LMS, assign batch, track training attendance, learning progress and certification.
- Outcomes: certified, not certified, hold, re-training, dropped/pullout by rule.
- Config: LMS Mapping, Certification Rule, Training Batch Config.

9. Roster / attendance / payroll
- Checks: employee active, branch/process/LOB/cost centre mapped, shift eligibility, certification if required, roster builder rule.
- Week-off preference is allowed but not guaranteed. Operations requirement comes first.
- Approved leave is roster exclusion. Pending/unapproved leave is alert only.
- Config: Roster Builder, Week-Off Rule, Leave Policy, Shift Master, Workforce Mandate, Communication Template.

10. Active employee lifecycle
- Events: attendance, leave, roster, payroll, training, certification, performance, quality, coaching, PIP, promotion, transfer, designation change, salary revision, incentive, assets, helpdesk.
- Every major event updates Employee Journey Timeline and Employee Stat Snapshot.

11. Resignation / clearance / F&F / relieving
- Employee submits resignation with reason, requested LWD and remarks.
- Statuses: submitted, manager review, HR review, notice period, clearance pending, F&F pending, relieving pending, completed.
- Owners: manager, HR, payroll, admin, IT, assets, training/compliance where needed.
- F&F includes unpaid salary, leave encashment if applicable, recoveries, approved incentives, deductions, gratuity if applicable, final settlement.
- Preserve employee page and full history according to retention/compliance rules.

## Non-selected path configuration

1. Possible stages
- Screening, assessment, interview round, client round, eligibility/document stage, candidate not interested, no-show, duplicate/cooling review.

2. Required reasons
- Communication issue, typing score low, assessment failed, process mismatch, salary mismatch, shift mismatch, location issue, qualification not fit, experience mismatch, client not selected, no-show, candidate not interested, duplicate review not cleared, cooling period not complete.

3. Candidate closure
- Update candidate status, current stage, final outcome, stage reason and remarks where configured.
- Write candidate journey event, productivity update, decision log, communication event, cooling/reprocess eligibility.

4. Communication
- Channels: portal, email, WhatsApp where configured.
- Message: application status, reprocess eligibility, cooling period if applicable, contact/reapply information if allowed.

5. Reprocess status
- Reprocess eligible, cooling period active, not eligible for reprocess, no-show can reschedule, hold for HR review.

6. Employee record rule
- For non-selected candidate: do not create employee ID, employee page, payroll mapping, roster mapping or LMS employee mapping.
- If candidate is ex-employee, old employee page remains historical; new application remains candidate/reprocess journey.

## UI and architecture rules

Preserve current PeopleOS design and layout. Do not rewrite DashboardLayout broadly. Do not remove existing navigation. Do not change global theme. Use existing cards, tables, filters, forms and page shell. New pages must follow current layout pattern.

Do not create new Supabase business tables. All new business workflow data must use MySQL mas_hrms through backend APIs.

## Developer instruction

Build the Walk-in Candidate Journey exactly as documented here. Cover selected -> joined -> employee page -> training/roster/payroll -> resignation/clearance/F&F/relieving, and non-selected -> reason captured -> communication -> cooling/reprocess -> ATS-only closure. Candidate becomes employee only after HR-approved conversion, mandatory checks and employee ID generation. Preserve current UI/layout, enforce backend role/scope checks, write journey events, audit sensitive actions, and protect Employee Page as mandatory after joining.
