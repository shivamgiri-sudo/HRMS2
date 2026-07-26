# Employee Journey Event Gaps

_Verified 2026-07-26. Sources checked against migration files in backend/sql/._

## Purpose
Documents which journey activity stages from the Interview-to-Exit spec have missing or incomplete event evidence in the current schema.

## Method
For each journey stage, checked whether an immutable event record is created with timestamp + actor evidence in the current schema.

## Gap Table

| ACTIVITY | CURRENT TABLE | TIMESTAMP STORED | ACTOR EVIDENCE | MISSING EVENT EVIDENCE | RECOMMENDED AUDIT INSERT | BACKFILL POSSIBLE | DATA LOSS RISK |
|---|---|---|---|---|---|---|---|
| REQUISITION CREATED | ats_requisition | created_at ✓ | created_by (verify column name) | No requisition stage-log entry; only current state stored | Add requisition to journey UNION when created_by verified | YES | Low |
| REQUISITION APPROVED | ats_requisition | No separate approved_at column found | No approval log for requisitions | Approval event not stored | Requires future migration to add approval_log or approval_workflow link | NO — not stored | Medium |
| CANDIDATE SOURCED | ats_candidate | created_at ✓ | sourcing_channel ✓ | Sourcer user identity not in ats_candidate (no sourced_by column) | Add sourced_by to ats_candidate in future migration | NO | Medium |
| CALLING / CONTACT ATTEMPT | ats_candidate_stage_log | stage_date ✓ | updated_by ✓ | Contact attempt details not granular; stage log covers the movement | Acceptable — stage log is sufficient evidence | YES | Low |
| WALK-IN REGISTRATION | ats_candidate | created_at ✓ | sourcing_channel = WALK_IN | Walk-in vs portal not always distinguishable; depends on sourcing_channel being populated | Filter by sourcing_channel = 'WALK_IN' | YES | Low |
| OFFER CREATED | ats_offer | created_at ✓ | prepared_by ✓ | Now covered by ATS_OFFER source addition | — | YES | None |
| OFFER APPROVED | ats_offer | No separate approved_at event log | approved_by field only (no approval timestamp) | Offer approval timestamp not stored; only the approver ID | Add approval_workflow link for offer approvals in future migration | Partial | Medium |
| BGV INITIATED / CHECK / EXCEPTION | No bgv_request or bgv_result table found in migrations | — | — | BGV event tables completely absent from schema | Future Phase 10 migration needed for bgv_* tables | NO | High — compliance gap |
| OTP / CONSENT DURING ONBOARDING | employee_onboarding table has basic onboarding steps (verify exact columns) | — | — | Consent timestamp and OTP verification not stored | Future migration: add consent_timestamp, otp_verified_at to onboarding | NO | High |
| SYSTEM ACCESS CREATED | No it_access_log or it_provisioning table found in migrations | — | — | IT provisioning events completely absent from schema | Future Phase 10: add it_access_provisioning table | NO | High |
| TRAINING BATCH ASSIGNED | lms_batch_assignment (via LMS integration sync — verify) | sync_date (if exists) | — | LMS is external system; event comes via sync, not native event | Integration layer sync record only; not a native HRMS event | Partial | Medium |
| TRAINING ATTENDANCE | lms_learning_progress_snapshot (via LMS sync) | updated_at | — | Daily attendance at LMS level; HRMS sees only snapshots | Acceptable via LMS integration | Partial | Low |
| ASSESSMENT / CERTIFICATION | lms_certification_sync (verify) | — | — | Certification decision lives in external LMS | Integration layer sync only | Partial | Low |
| PAYSLIP RELEASE | salary_payslip | generated_at (verify column name in 007_payroll.sql) | — | Only run-level timestamp; payslip-level actor not stored | Join to salary_prep_run for actor | YES | Low |
| GRIEVANCE | No employee_grievance table found in migrations | — | — | Grievance events completely absent | Future Phase phase 9/10 | NO | High |
| DISCIPLINARY ACTION | No disciplinary_action table found in migrations | — | — | Disciplinary events completely absent | Future Phase 9/10 | NO | High — POSH Act |
| NOTICE PERIOD TRACKING | exit_request | last_working_day ✓ | — | Day-by-day notice serving not tracked | Derive from LWD minus notice_period_days from exit_request | YES | Low |

## Summary of Gaps by Severity

### HIGH DATA LOSS RISK (evidence never stored)
- BGV events: `bgv_request`, `bgv_result` — no tables in schema
- Disciplinary action: no table in schema — POSH Act compliance risk
- Requisition approval: no approval log or approval_workflow link for ats_requisition
- IT access provisioning: no tables in schema
- Grievance events: no table in schema

### MEDIUM DATA LOSS RISK (partial or no evidence)
- OTP/consent during onboarding: not stored
- Offer approval timestamp: approver stored but not approval date
- Candidate sourcer identity: no sourced_by in ats_candidate

### LOW RISK (evidence exists or derivable)
- Payslip release: derivable from salary_prep_run join
- Notice period: derivable from exit_request
- Walk-in registration: sourcing_channel filter sufficient
- Training/LMS events: covered by integration layer

## Journey Source Coverage After This PR

| SOURCE_KEY | TABLE | STATUS | STAGES COVERED |
|---|---|---|---|
| ATS_CANDIDATE | ats_candidate | VERIFIED | APPLICATION CREATED |
| ATS_STAGE_LOG | ats_candidate_stage_log | VERIFIED | INTERVIEW STAGE MOVEMENTS |
| ATS_OFFER | ats_offer | VERIFIED (added in PR #59) | OFFER CREATED/STATUS |
| ONBOARDING_BRIDGE | ats_onboarding_bridge | VERIFIED | EMPLOYEE CODE LINKAGE |
| EMPLOYEE_JOURNEY | employee_journey_log | VERIFIED | EMPLOYEE LIFECYCLE EVENTS |
| LIFECYCLE_EVENT | employee_lifecycle_event | VERIFIED | PROMOTION/TRANSFER/CONFIRMATION |
| JOB_HISTORY | employee_job_history | VERIFIED | POSITION HISTORY |
| COACHING | coaching_session | VERIFIED | COACHING |
| PIP | pip_record | VERIFIED | PIP |
| LETTER | generated_letter | VERIFIED | LETTER ISSUANCE |
| ASSET_ASSIGNMENT | asset_assignment | VERIFIED | ASSET ISSUE/RETURN |
| LEAVE_REQUEST | leave_request | VERIFIED (added in PR #59) | LEAVE APPLIED/STATUS |
| SALARY_RUN | salary_prep_run | VERIFIED (added in PR #59) | PAYROLL RUN |
| REGULARISATION | attendance_regularization | VERIFIED (added in PR #59) | REGULARISATION |
| EXIT_REQUEST | exit_request | VERIFIED | RESIGNATION/TERMINATION |
| EXIT_APPROVAL | exit_approval_log | VERIFIED | EXIT APPROVALS |
| EXIT_CLEARANCE | exit_clearance_checklist | VERIFIED | DEPARTMENT CLEARANCES |
| SENSITIVE_ACTION | sensitive_action_log | VERIFIED | SENSITIVE DATA CHANGES |
| AUDIT_LOG | audit_log | VERIFIED | SYSTEM ACTIVITY |
| BGV | bgv_* | TABLE_MISSING | BGV EVENTS — NOT EVIDENCED |
| IT_ACCESS | it_access_* | TABLE_MISSING | PROVISIONING — NOT EVIDENCED |
| GRIEVANCE | employee_grievance | TABLE_MISSING | GRIEVANCES — NOT EVIDENCED |
| DISCIPLINARY | disciplinary_action | TABLE_MISSING | DISCIPLINE — NOT EVIDENCED |
