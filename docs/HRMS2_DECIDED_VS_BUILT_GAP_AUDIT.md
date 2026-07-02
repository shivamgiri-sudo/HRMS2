# HRMS2 Decided vs Built — Gap Audit

**Date:** 2026-06-24  
**Purpose:** Honest engineering record of what was decided in the PeopleOS charter vs what actually exists in code and DB. Used to scope the next implementation sprint.  
**Method:** Direct codebase inspection — backend routes, DB migrations, frontend pages, service files.  
**Scope:** 13 modules across ATS/Onboarding, Payroll, Dashboard, Exit, Privacy, and cross-cutting concerns.

---

## Summary Table

| # | Module | Coverage | Priority |
|---|--------|----------|----------|
| 1 | Candidate Onboarding /onboard-full | PARTIAL | P1 |
| 2 | Joining Control Room / Payroll HR Validation | PARTIAL | P1 |
| 3 | Dashboard System | MISSING (engine) | P1 |
| 4 | Incentive Approval Workflow | PARTIAL | P1 |
| 5 | Appointment Letter E-sign | PARTIAL | P2 |
| 6 | DPDP Withdrawal Workflow | PARTIAL | P2 |
| 7 | TAT + Escalation Matrix | MISSING | P2 |
| 8 | Candidate Name Consistency Matrix | MISSING | P1 |
| 9 | Resignation Discussion Flow | PARTIAL | P2 |
| 10 | Work Inbox | PARTIAL (UI only) | P1 |
| 11 | Role/Branch/Process Data Scope | PARTIAL | P1 |
| 12 | Page Access | PARTIAL | P1 |
| 13 | Notifications and Audit Logs | PARTIAL | P2 |

---

## Module 1: Candidate Onboarding /onboard-full

| Field | Detail |
|-------|--------|
| **Module** | Candidate Onboarding /onboard-full |
| **What Was Decided** | 17-step mobile-first journey: OTP verify, autosave every step, all personal/bank/qualification/experience/family/language/statutory fields, BGV consent, Aadhaar e-sign, step progress panel |
| **Existing Page/Route** | `/onboard-full` → `CandidateOnboardingFullPage.tsx` (rebuilt, 10 steps) |
| **Existing API** | `POST /api/ats/onboarding-full/validate-token`, `/status`, `/employee-details`, `/bank`, `/qualification`, `/experience`, `/family`, `/languages`, `/otp/send`, `/otp/verify`, `/autosave`, `/statutory`, `/documents`, `/submit` |
| **Existing DB Table/Column** | `candidate_onboarding_profile` (otp_verified, mother_name, emergency_contact, nationality, statutory fields — mig 289); `candidate_onboarding_otp`; `candidate_onboarding_language`; `candidate_onboarding_autosave` |
| **Existing Component/Service** | `CandidateOnboardingFullPage.tsx` — no `OnboardingMobileShell`, no `OnboardingStepper`, no `OnboardingProgressPanel` |
| **Coverage** | PARTIAL — fields and APIs complete; mobile wrapper and stepper components absent |
| **Business Impact** | Candidate self-service blocked on mobile; drop-off risk on 10+ step journey without visual progress |
| **Compliance Impact** | OTP backend done but email-only fallback; SMS OTP not wired; BGV consent capture present |
| **UX Impact** | No persistent step progress panel; stepper is inline, not a dedicated reusable component |
| **Mobile Impact** | HIGH — journey is mobile-first by design; shell component missing means no safe-area handling, no sticky nav |
| **Fix Required** | Create `OnboardingMobileShell.tsx`, `OnboardingStepper.tsx`, `OnboardingProgressPanel.tsx`; wire SMS OTP fallback |
| **Priority** | P1 |

---

## Module 2: Joining Control Room / Payroll HR Validation

| Field | Detail |
|-------|--------|
| **Module** | Joining Control Room (JCR) / Payroll HR Validation |
| **What Was Decided** | Onboarding submission triggers JCR view with section completion scores, BGV status badge, name consistency check, salary start date gate, DOJ gate before payroll HR approval |
| **Existing Page/Route** | `/hr/onboarding-requests` → `NativeHROnboardingRequests.tsx`; `/payroll/hr-validation` → `NativePayrollHRValidation.tsx`; `NativeATSOnboardingBridge.tsx` |
| **Existing API** | `GET /api/ats/onboarding-full/requests`, `/candidate/:id`, `POST /candidate/:id/review` |
| **Existing DB Table/Column** | `ats_onboarding_bridge`, `candidate_onboarding_profile`, `candidate_bgv_check` |
| **Existing Component/Service** | `NativeHROnboardingRequests.tsx`, `NativePayrollHRValidation.tsx`, `NativeATSOnboardingBridge.tsx` |
| **Coverage** | PARTIAL — basic review flow works; section completeness scoring absent from API response; name consistency matrix not called; salary start date / DOJ gate not enforced |
| **Business Impact** | Payroll HR can approve without confirmed DOJ or salary start date — creates payroll run risk |
| **Compliance Impact** | No name consistency check before approval means mismatched statutory documents can reach payroll |
| **UX Impact** | JCR page shows candidate list but no per-section completion bars; BGV status is a field, not a visual gate |
| **Mobile Impact** | LOW — JCR is desktop HR tool |
| **Fix Required** | Add completeness-scoring fields to `/candidate/:id` response; build name consistency matrix routes (see Module 8); add salary start date + DOJ gate to `/candidate/:id/review` |
| **Priority** | P1 |

---

## Module 3: Dashboard System

| Field | Detail |
|-------|--------|
| **Module** | Dashboard System |
| **What Was Decided** | Role-wise command dashboards (CEO, Management, Operations, Quality, HR, Payroll, Branch Head, WFM) with scope engine, metric catalog, drilldown API, good/bad insight engine, work inbox widget |
| **Existing Page/Route** | `/dashboard` → `Dashboard.tsx` (generic); `NativeCEOCommandCenter.tsx`; `NativeManagementDashboard.tsx`; `NativeOperationsDashboard.tsx`; `NativeQualityDashboard.tsx` |
| **Existing API** | None under `/api/dashboards/*` or `/api/work-inbox` |
| **Existing DB Table/Column** | NO `dashboard_metric_catalog`; NO `work_item`; NO `dashboard_scope_config` |
| **Existing Component/Service** | Individual dashboard pages exist as shallow UI shells; no shared engine or data layer |
| **Coverage** | MISSING central engine — individual pages exist but fetch no real data; no scope enforcement; no metric catalog |
| **Business Impact** | Leadership has no unified real-time visibility; branch heads cannot self-serve operational insight |
| **Compliance Impact** | No scope enforcement means dashboard pages could surface cross-branch data |
| **UX Impact** | Dashboards are static placeholders; no drilldown, no trend charts backed by real data |
| **Mobile Impact** | MEDIUM — management dashboards consumed on mobile; no responsive data layer |
| **Fix Required** | Create `dashboard-engine` backend service; `dashboard_metric_catalog` and `work_item` migrations; scope-aware API; wire each role dashboard to real queries |
| **Priority** | P1 |

---

## Module 4: Incentive Approval Workflow

| Field | Detail |
|-------|--------|
| **Module** | Incentive Approval Workflow |
| **What Was Decided** | WFM uploads incentive file → Branch Head approves → Ops Head approves → Finance Head approves → Payroll Register locked (4-tier) |
| **Existing Page/Route** | `/payroll/incentives` → `NativeIncentives.tsx` (1127 lines, has batch/line/approval UI) |
| **Existing API** | `POST /api/payroll/incentives/batches`, `/batches/:id/approve` — 2-tier only (HR → Finance) |
| **Existing DB Table/Column** | `incentive_master`, `incentive_upload_batch`, `incentive_upload_line`, `incentive_approval_log` |
| **Existing Component/Service** | `NativeIncentives.tsx` — substantial UI; approval flow rendered but only 2 tiers active |
| **Coverage** | PARTIAL — 2-tier approval works; Branch Head and Ops Head steps missing; payroll register lock table missing; per-step role enforcement absent |
| **Business Impact** | Finance can mark incentives approved without Branch Head or Ops Head sign-off — compliance and financial control failure |
| **Compliance Impact** | No per-step role enforcement means any user with Finance role can skip Branch Head tier |
| **UX Impact** | UI shows 4-tier stepper visually but only 2 tiers are functional — misleads approvers |
| **Mobile Impact** | LOW — approval is desktop finance workflow |
| **Fix Required** | Add `incentive_approval_step` table; add branch head and ops head approval routes; add `incentive_payroll_register` table; enforce `approval_role` per step in middleware |
| **Priority** | P1 |

---

## Module 5: Appointment Letter E-sign

| Field | Detail |
|-------|--------|
| **Module** | Appointment Letter E-sign |
| **What Was Decided** | Generate PDF → candidate Aadhaar e-sign via provider (Setu/Digio) → company digital signature → PDF locked → stored in document vault |
| **Existing Page/Route** | No dedicated candidate-facing e-sign page |
| **Existing API** | `PATCH /api/it-provisioning/appointment-letters/:id/aadhaar-signed`, `/company-signed`, `/complete` |
| **Existing DB Table/Column** | `appointment_letter_request`, `appointment_letter_audit_log` |
| **Existing Component/Service** | State machine in `it-provisioning` module; no PDF generation service; no vault service |
| **Coverage** | PARTIAL — state transitions exist in DB and routes; Setu/Digio API call not implemented; PDF generation absent; `employee_document_vault` table missing; candidate e-sign URL generation missing |
| **Business Impact** | Letters cannot be legally signed or stored; appointment letter issuance stalled |
| **Compliance Impact** | No locked PDF in vault means document tamper risk; no audit-proof Aadhaar e-sign |
| **UX Impact** | Candidate has no self-service e-sign URL; HR has no vault viewer |
| **Mobile Impact** | HIGH — candidate signs on mobile; missing mobile e-sign page |
| **Fix Required** | Add `employee_document_vault` table; integrate e-sign provider (Setu or Digio stub); add PDF generation + lock service; add candidate e-sign URL route; add manual override with reason route |
| **Priority** | P2 |

---

## Module 6: DPDP Withdrawal Workflow

| Field | Detail |
|-------|--------|
| **Module** | DPDP Consent Withdrawal Workflow |
| **What Was Decided** | Employee requests withdrawal → selects scope (marketing/analytics/third-party) → HR reviews → processing hold applied → approve/reject → access restriction enforced → full audit trail |
| **Existing Page/Route** | No dedicated withdrawal admin page |
| **Existing API** | `POST /api/privacy/consent/withdraw` (basic, no scope selection or review step) |
| **Existing DB Table/Column** | `dpdp_consent_log`, `dpdp_config`, `dpdp_processing_notice`, `data_rights_request` |
| **Existing Component/Service** | Privacy module with basic consent APIs; no review workflow service |
| **Coverage** | PARTIAL — basic withdrawal record created; scope selection absent; processing hold table missing; formal approve/reject review cycle missing; access restriction not enforced by middleware |
| **Business Impact** | DPDP compliance risk — withdrawals are recorded but not acted upon operationally |
| **Compliance Impact** | HIGH — DPDP Act 2023 requires demonstrable processing halt on withdrawal; no evidence of enforcement |
| **UX Impact** | No employee-facing scope selector; no HR review queue page |
| **Mobile Impact** | LOW |
| **Fix Required** | Add `dpdp_consent_withdrawal` table; add `dpdp_processing_hold` table; add 8 routes (scope submit, HR review queue, approve, reject, hold apply, hold lift, access restrict, audit export); add withdrawal admin page and employee scope-selection page |
| **Priority** | P2 |

---

## Module 7: TAT + Escalation Matrix

| Field | Detail |
|-------|--------|
| **Module** | TAT + Escalation Matrix |
| **What Was Decided** | Configurable TAT per task type (onboarding, BGV, IT provisioning, exit clearance); escalation levels with named escalatees; automated notification queue on breach |
| **Existing Page/Route** | None |
| **Existing API** | None |
| **Existing DB Table/Column** | `it_provisioning_task.due_date` is hardcoded +3 days; no `tat_matrix_master`; no `escalation_matrix_master` |
| **Existing Component/Service** | None |
| **Coverage** | MISSING — no TAT configuration exists anywhere in the system |
| **Business Impact** | No SLA tracking; escalations are manual; onboarding and exit delays invisible to management |
| **Compliance Impact** | BGV and DPDP workflows have regulatory timelines that cannot be enforced without TAT |
| **UX Impact** | HR has no visibility into overdue tasks; no escalation dashboard |
| **Mobile Impact** | MEDIUM — escalation notifications go to mobile |
| **Fix Required** | Create `tat_matrix_master`, `escalation_matrix_master`, `task_tat_instance` tables; create TAT service with breach detection; add 10 routes (CRUD config, breach query, escalation trigger, notification dispatch); add TAT config page and escalation dashboard page |
| **Priority** | P2 |

---

## Module 8: Candidate Name Consistency Matrix

| Field | Detail |
|-------|--------|
| **Module** | Candidate Name Consistency Matrix |
| **What Was Decided** | Cross-source name matching across: onboarding form, Aadhaar, PAN, Bank account, EPFO, education certificate, appointment letter — flags mismatches before employee code generation |
| **Existing Page/Route** | None |
| **Existing API** | None |
| **Existing DB Table/Column** | None — no `candidate_name_match_summary`, no `candidate_document_name_source` |
| **Existing Component/Service** | None |
| **Coverage** | MISSING |
| **Business Impact** | Employee code can be generated with mismatched names across statutory documents — causes PF/ESIC rejection and payroll errors |
| **Compliance Impact** | EPFO and ESIC registration rejections due to name mismatch are a known compliance failure mode |
| **UX Impact** | JCR has no visual name mismatch alert; HR must manually cross-check documents |
| **Mobile Impact** | LOW |
| **Fix Required** | Create `candidate_name_match_summary`, `candidate_document_name_source`, `name_mismatch_override_log` tables; add 6 routes (submit source name, run match, get summary, override with reason, audit export, JCR integration); add `NameConsistencyMatrix.tsx` component wired into JCR page |
| **Priority** | P1 — blocks employee code generation gate |

---

## Module 9: Resignation Discussion Flow

| Field | Detail |
|-------|--------|
| **Module** | Resignation Discussion Flow |
| **What Was Decided** | Resignation → Manager formal discussion (before acceptance) → HR discussion → Retention offer → Accept/Withdraw resignation → Notice period → Clearance → F&F |
| **Existing Page/Route** | `/exit/exit-management` → `NativeExitManagement.tsx`; `/exit/command-center` → `NativeExitCommandCenter.tsx` |
| **Existing API** | `POST /api/exit/:id/retention` (manager discussion via actionType); `POST /api/exit/:id/interview`; `PATCH /api/exit/:id/status` |
| **Existing DB Table/Column** | `exit_request`, `exit_retention_action`, `exit_interview_response`, `exit_clearance_task` |
| **Existing Component/Service** | `NativeExitManagement.tsx`, `NativeExitCommandCenter.tsx` — functional for post-acceptance flow |
| **Coverage** | PARTIAL — retention and interview routes exist; formal manager discussion step BEFORE acceptance is absent; `resignation_discussion` table missing; structured retention offer table missing |
| **Business Impact** | Manager discussion is skipped — attrition intervention happens too late |
| **Compliance Impact** | LOW direct compliance impact; labour law risk if discussion records absent in dispute |
| **UX Impact** | Exit flow jumps from resignation submission to HR queue without manager acknowledgement gate |
| **Mobile Impact** | MEDIUM — manager discussion notification goes to mobile |
| **Fix Required** | Add `resignation_discussion`, `resignation_discussion_note`, `retention_offer` tables; add manager-discussion routes before resignation acceptance; add discussion timeline to exit management UI |
| **Priority** | P2 |

---

## Module 10: Work Inbox

| Field | Detail |
|-------|--------|
| **Module** | Work Inbox |
| **What Was Decided** | Cross-module actionable work items generated by all state-changing workflows (onboarding approvals, incentive approvals, exit clearances, DPDP withdrawals, TAT escalations); single queue per role |
| **Existing Page/Route** | `/work-inbox` → `NativeWorkInbox.tsx` (339 lines, UI shell) |
| **Existing API** | NO `/api/work-inbox` routes — page fetches from `/api/inbox` (basic notification inbox, not actionable work items) |
| **Existing DB Table/Column** | NO `work_item` table; NO `work_item_audit_log` |
| **Existing Component/Service** | `NativeWorkInbox.tsx` — renders notification-style list, not actionable items with context |
| **Coverage** | PARTIAL — UI shell exists; backend is entirely missing |
| **Business Impact** | Approvers must navigate to each module independently; no unified action queue; approval delays expected |
| **Compliance Impact** | No audit trail for work item assignment, acknowledgement, or SLA |
| **UX Impact** | HIGH — work inbox is the primary action surface for Branch Head, Ops Head, Finance; shell without backend is a dead end |
| **Mobile Impact** | HIGH — approvers act on mobile; work inbox is the expected mobile action surface |
| **Fix Required** | Create `work_inbox` backend module with `work_item` and `work_item_audit_log` tables; wire item creation from incentive, exit, onboarding, DPDP, TAT modules; add role-scoped query routes; update `NativeWorkInbox.tsx` to consume real API |
| **Priority** | P1 |

---

## Module 11: Role/Branch/Process Data Scope

| Field | Detail |
|-------|--------|
| **Module** | Role/Branch/Process Data Scope Engine |
| **What Was Decided** | 6-level scope: ORG_ALL, BRANCH_ALL, PROCESS_ALL, TEAM_ONLY, SELF_ONLY, CUSTOM_SCOPE — enforced consistently across all dashboard and report APIs |
| **Existing Page/Route** | N/A (middleware/service concern) |
| **Existing API** | `scopeAccess.ts` defines: all / branch / process / branch_process / lob / department / team / self (8 types) |
| **Existing DB Table/Column** | No `dashboard_scope_config`; scope types in `scopeAccess.ts` are not consistently applied across dashboard API handlers |
| **Existing Component/Service** | `backend/src/shared/scopeAccess.ts` — exists and has broad coverage; no central `dashboardScope.ts` wrapper |
| **Coverage** | PARTIAL — scope engine exists but is not the single enforced entry point; CUSTOM_SCOPE absent; dashboard APIs bypass scope or use ad-hoc filters |
| **Business Impact** | Branch heads may see other branches' data; scope leakage is a real risk in multi-branch BPO context |
| **Compliance Impact** | HIGH — PII leakage across branches violates DPDP and internal data governance rules |
| **UX Impact** | LOW direct UX impact; invisible to user but affects data correctness |
| **Mobile Impact** | LOW |
| **Fix Required** | Create `dashboardScope.ts` wrapping `scopeAccess.ts` as single enforced entry point; add CUSTOM_SCOPE support with `custom_scope_config` DB table; audit all dashboard API handlers and enforce scope middleware consistently |
| **Priority** | P1 |

---

## Module 12: Page Access

| Field | Detail |
|-------|--------|
| **Module** | Page Access / Role-Based UI Gating |
| **What Was Decided** | Every new workflow page registered in `page_access` table with a `page_code`; role-based access control enforced at route and UI level |
| **Existing Page/Route** | All new module pages (incentives, DPDP withdrawal, TAT matrix, name consistency, work inbox, JCR, onboarding bridge) |
| **Existing API** | `page_access` table exists; existing codes populated |
| **Existing DB Table/Column** | `page_access` — missing codes: `PAYROLL_INCENTIVE_UPLOAD`, `DPDP_WITHDRAWAL`, `TAT_MATRIX`, `NAME_CONSISTENCY_MATRIX`, `WORK_INBOX`, `JCR_REVIEW`, `ONBOARDING_BRIDGE`, `APPOINTMENT_ESIGN`, `RESIGNATION_DISCUSSION`, `SCOPE_CONFIG`, `ESCALATION_MATRIX`, and ~11 others for new module pages |
| **Existing Component/Service** | Page access middleware exists and is applied to existing routes |
| **Coverage** | PARTIAL — framework exists; ~22 new page codes for modules built in this sprint are absent from DB |
| **Business Impact** | New pages are accessible without role gating until codes are seeded |
| **Compliance Impact** | MEDIUM — sensitive pages (payroll incentives, DPDP admin) accessible to wrong roles until seeded |
| **UX Impact** | LOW direct impact; side-nav visibility based on page access will show or hide incorrectly |
| **Mobile Impact** | LOW |
| **Fix Required** | Single additive migration to insert 22 new `page_access` rows with correct default role mappings |
| **Priority** | P1 |

---

## Module 13: Notifications and Audit Logs

| Field | Detail |
|-------|--------|
| **Module** | Notifications and Audit Logs |
| **What Was Decided** | Every state-changing action produces an audit log entry; notifications triggered for all workflow transitions; work inbox escalation notifications automated |
| **Existing Page/Route** | N/A (cross-cutting service) |
| **Existing API** | `auditLogRouter` exists; `logCandidateAction()` used throughout ATS/onboarding; notification routes exist |
| **Existing DB Table/Column** | `audit_log`, `notification_preference`, `notification_record` |
| **Existing Component/Service** | Audit logging consistent in ATS/onboarding; absent in incentive approval, DPDP withdrawal, TAT breach, work inbox transitions |
| **Coverage** | PARTIAL — audit pattern established and used in older modules; new modules (incentive, DPDP, TAT, work inbox) not wired to audit or notification services |
| **Business Impact** | New workflows are not auditable — creates compliance exposure for incentive approvals and DPDP actions specifically |
| **Compliance Impact** | HIGH for DPDP (legally required); HIGH for payroll incentives (financial audit trail); HIGH for resignation (labour dispute protection) |
| **UX Impact** | LOW direct UX impact; audit export and notification delivery are downstream features |
| **Mobile Impact** | MEDIUM — push notifications for approval requests go to mobile; new workflows will be silent without wiring |
| **Fix Required** | Wire `logCandidateAction` pattern (or equivalent) into: incentive approval steps, DPDP withdrawal state changes, TAT breach events, work item creation/completion, resignation discussion records; wire notification dispatch to work inbox creation |
| **Priority** | P2 |

---

## Critical Path

The following is the minimum ordered sequence to unblock production readiness. Each step either gates the next or resolves a compliance hard-stop.

**Sprint 1 — Unblock employee code generation and payroll**

1. **Module 8 first**: Build candidate name consistency matrix (tables + routes + JCR component). Gates employee code generation.
2. **Module 2**: Add completeness scoring and DOJ/salary-start gate to JCR API. Gates Payroll HR approval.
3. **Module 12**: Run the 22-row `page_access` migration. Unblocks role gating for all new pages.
4. **Module 11**: Create `dashboardScope.ts` and audit dashboard API scope enforcement. Closes cross-branch PII leakage.

**Sprint 2 — Unblock approval workflows and work inbox**

5. **Module 10**: Build `work_inbox` backend module (tables + routes). Wire from incentive, exit, onboarding modules. Update `NativeWorkInbox.tsx`.
6. **Module 4**: Add `incentive_approval_step` table, branch head + ops head routes, payroll register lock. Fix 4-tier enforcement.
7. **Module 13**: Wire audit logging and notifications into incentive, DPDP, work inbox, and resignation modules.

**Sprint 3 — Compliance workflows and mobile onboarding**

8. **Module 1**: Create `OnboardingMobileShell.tsx`, `OnboardingStepper.tsx`, `OnboardingProgressPanel.tsx`. Wire SMS OTP fallback.
9. **Module 6**: Build DPDP withdrawal scope selection, processing hold, approve/reject routes and pages.
10. **Module 9**: Add `resignation_discussion` and `retention_offer` tables and routes; gate acceptance on manager discussion.

**Sprint 4 — Infrastructure and legal**

11. **Module 7**: Build TAT matrix config, task instance tracking, breach detection, escalation dispatch.
12. **Module 5**: Integrate e-sign provider, PDF generation + lock, `employee_document_vault` table.
13. **Module 3**: Build dashboard engine service, metric catalog, scope-aware drilldown API; wire role dashboards to real data.
