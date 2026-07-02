# MAS Callnet PeopleOS — Revised Claude-Assisted Build Roadmap

**Revised:** 2026-05-29  
**Critical correction:** LMS is already deployed internally and will be integrated, not rebuilt.

## 1. How to Use This Roadmap

The repository is a hybrid production foundation, not a blank project. Use Claude Code phase-by-phase. Every phase starts with inspection in Plan mode, a precise file list and a rollback plan. Implementation must happen only after approval.

## 2. Current Baseline

| Domain | Current Position |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind/shadcn |
| Backend | Express + TypeScript under `/backend` |
| Operations data | MySQL `mas_hrms` foundation |
| Authentication/files | Supabase Auth and Storage; some transitional Supabase-native flows remain |
| Built backend foundations | employees, ATS, leave, payroll, WFM/roster, KPI, client portal, exit, integration hub, processes and migration |
| Deployed external module | Internal LMS; integrate only |
| Incomplete/needs validation | security/scopes, local MySQL testing, payroll statutory completeness, assets/documents backend convergence, full ATS/WFM/ERP extensions |

## 3. Delivery Principles

- Preserve all current working flows until tested replacements/integrations exist.
- Keep a single authoritative owner for each business entity.
- Never run production migrations or deployments without approval.
- Do not commit secrets or live employee/candidate/client data.
- Treat payroll, PII, client isolation and access controls as high-risk work.
- Do not rebuild LMS inside HRMS.
- Do not create a Store Manager role.

## 4. Delivery Phases

### Phase 0 — Stabilisation and Safety

**Goal:** make the current repository safe to extend.

| Work Package | Required Outcome |
|---|---|
| Architecture/source-of-truth audit | Verified map of Express/MySQL versus Supabase flows and LMS integration boundary |
| Local/staging MySQL strategy | Repeatable non-production backend/schema test environment |
| SQL migration runner verification | Clean schema creates every mounted backend dependency |
| Backend role/scope security matrix | No sensitive API relies on frontend gate alone |
| Payroll foundation contract review | Statutory configuration/calculation contract is correct or defect recorded and fixed |
| Route/native page review | Existing wrappers/pages understood before any refactor |

**Claude gate:** no feature build until P0 blockers and test strategy are approved.

### Phase 1 — Enterprise Masters, Role Scope, Audit and Workflow

Build/complete company/legal entity, client, branch, process, LOB, campaign, cost centre, designation/grade, reporting hierarchy, shared approval rules, policy master and full audit/event logging.

### Phase 2 — Employee Lifecycle, Documents, Assets and Helpdesk

Complete joining-to-exit employee journey, document metadata/access/expiry, asset issue/transfer/recovery/repair, HR service tickets, grievance controls and letters. Existing Supabase-backed working flows must continue until their backend convergence is validated.

### Phase 3 — ATS and Joining Ecosystem

Complete manpower requisition, approval, vacancy portal, process screening, skill assessment integration, interviews, offer/BGV, candidate-to-employee conversion and recruiter/source analytics. Preserve and integrate existing candidate and recruiter tools.

### Phase 4 — Attendance, Leave and Complete WFM

Complete shift/roster operations, attendance and regularisation, leave rules, roster conflicts/swaps/approval, staffing demand, live tracking, shrinkage, attrition, adherence and capacity alerts.

### Phase 5 — Payroll, Statutory and Full-and-Final

Complete salary components, incentives/OT/claims/advances, LOP linkage, payslips, PF/UAN/ESIC/PT/LWF where applicable, TDS and Form 16-ready data, gratuity, exit/F&F, approvals, bank payout/export and reconciliation.

**Until passed:** label current payroll as a payroll/pre-payroll foundation, not completed statutory payroll.

### Phase 6 — LMS Integration Layer — No LMS Rebuild

Build only the controlled integration with the already deployed LMS:

- determine secured API/scheduled sync/read-only connector approach;
- employee-to-learner and batch/process mappings;
- progress/MCQ/certification/handover/risk snapshot sync;
- Integration Hub run/audit/error/retry visibility;
- secure launch/deep-link/SSO feasibility;
- employee, manager and management summary surfaces;
- approved aggregate client-portal training visibility.

The deployed LMS continues to own curriculum, content, assessments, learning operations and certification decisions.

### Phase 7 — Operations, Quality, Call Master and Performance

Integrate Operational KPI and Quality KPI as separate score families, AI/manual call audit evidence, coaching/CAPA, PIP/review/calibration, approved incentive linkage and management command-centre drilldowns. LMS certification/readiness summaries may be consumed here after Phase 6 sync is approved.

### Phase 8 — Client Portal Production Hardening

Strengthen query-level process isolation, data masking, approved exports, access/export audit logs, SLA/governance reporting, approved training aggregate visibility and cross-client negative tests.

### Phase 9 — Controlled ERP Extension

Add expenses/reimbursements, procurement, vendors, contracts/SOWs, client billing, budgets/cost centres and finance-system integration. Do not attempt a full accounting replacement until PeopleOS is stable.

### Phase 10 — Migration, Security, UAT and Deployment Readiness

Perform role/security negative testing, migration reconciliation, payroll parallel validation, WFM reconciliation, ATS conversion validation, LMS sync reconciliation, client isolation tests, backup/rollback drills, staging UAT and approved production deployment.

## 5. Phase Completion Template for Claude

Claude must provide this before approval of any implementation:

1. Scope implemented and scope intentionally not implemented.
2. Exact files changed and reason.
3. Existing working flows preserved.
4. Database changes and safe migration/rollback steps.
5. API/frontend/routes/roles affected.
6. Build and automated test results.
7. Security and scope tests, including denied cases.
8. Data reconciliation checks where applicable.
9. Known limitations and next recommended phase.
10. Confirmation that no production SQL, deploy, secret exposure, GitHub push or merge occurred without approval.

## 6. First Claude Prompt

Use the prompt supplied in `PHASE_0_CLAUDE_START_PROMPT.md`. It is intentionally an audit-only prompt and includes the LMS integration correction.
