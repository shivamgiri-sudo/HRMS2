# CLAUDE_ACTIVE_CONTEXT

**Purpose:** Token-efficient active execution context for Claude Code/Codex. Read this first. Do **not** re-read the full master charter every turn unless this file is unclear, conflicts appear, or a hard gate needs interpretation.

**Last updated:** 30-May-2026

---

## 1. Permanent Execution Rule

Start every Claude instruction/work cycle with:

```text
/using-superpowers
```

Execution mode:
- Continue from latest repo state.
- Complete the next incomplete package.
- Validate with the standard full build/test gate.
- Merge if green and no hard gate exists.
- Update this file after each merge.
- Continue to the next package without routine approval.

---

## 2. Architecture Summary

- New PeopleOS business modules are **MySQL-first** using `mas_hrms` through Node/Express APIs.
- Do **not** create new operational/business Supabase tables.
- Supabase may remain transitional for Auth and Storage only.
- Existing deployed LMS is external; build integration/snapshot layer only.
- External SQL/API/file/device sources are future read-only inputs into `mas_hrms` via Integration Hub.
- Client Portal must consume approved aggregate/published data only.
- All new modules must follow DPDP privacy/security-by-design requirements.

---

## 3. Hard Gates — Stop and Ask

Stop before any of these:

1. SQL execution on staging/live `mas_hrms`.
2. Vercel/production deployment.
3. Hosted secret/env/credential changes.
4. External production DB connection.
5. Live LMS connection/change.
6. Payroll/statutory production activation.
7. Destructive migration or data deletion.
8. Client-visible publication without masking/approval.
9. Unresolved PII/payroll/client data exposure.
10. Any Aadhaar/e-sign provider integration using live credentials.

Do not stop for routine source code, additive unexecuted migrations, local tests, PR creation, green PR merge, or starting the next package.

---

## 4. Mandatory Scope Documents

Read these before major feature work:

1. `docs/peopleos-build/PEOPLEOS_CEO_SCOPE_DPDP_ADDENDUM.md`
   - CEO scope corrections.
   - LOB/cost-centre hierarchy.
   - Document verification.
   - Roster logic master.
   - Offer acknowledgement/e-sign consent.
   - Communication engine.
   - Incentives.
   - Gamification.
   - Employee stat card.
   - DPDP compliance foundation.

2. `docs/peopleos-build/PEOPLEOS_MAS_HRMS_TABLE_MAPPING_BLUEPRINT.md`
   - Required MAS_HRMS table blueprint.
   - Table-to-table mapping logic.
   - End-to-end data flows.
   - DPDP tables.
   - SQL implementation order.

3. `docs/peopleos-build/PEOPLEOS_ROLE_MINDMAPS_AND_JOURNEYS.md`
   - Role-wise mindmaps and journeys.
   - Super Admin, HR, Candidate, Recruiter, Employee, WFM, Process Manager, AM, TL, QA, Trainer, Payroll, CEO, Client, Compliance.

4. `docs/peopleos-build/PEOPLEOS_SLICE_01_EMPLOYEE_ID_ONBOARDING_AUTOFILL.md`
   - Next controlled implementation slice.
   - Employee ID generation.
   - Pre-joining portal.
   - ATS autofill.
   - Resume photo/upload parsing.
   - Candidate validation.
   - Candidate-to-employee conversion.

---

## 5. Current Merged Baseline

Merged completed work:
- PR #12–#13: Phase 0 schema/security foundation.
- PR #14: organisation/workflow/audit foundation.
- PR #15: employee lifecycle/assets/helpdesk/letters.
- PR #16: ATS + WFM extensions/security fixes.
- PR #17/#19: payroll/F&F foundation plus safety corrections.
- PR #18: management surfaces + portal hardening.
- PR #20: Roster & Shift Governance completed and merged.
- PR #21: Attendance, Leave, WFM and RTA Completion completed and merged.
- PR #22: CEO Demo Readiness, Role Access, Account Control foundation, Workforce Mandate/Capacity foundation, CI-only validation and manual-only Vercel workflow completed and merged.

PR #22 merge SHA: `dfa17813b3aca5ad2e22b72fc06f10890b72465c`

Important PR #22 notes:
- PeopleOS CI Validation passed before merge.
- Vercel deploy workflow is manual-only (`workflow_dispatch`).
- PR validation workflow is `.github/workflows/peopleos-ci.yml`.
- Demo login still requires non-production Supabase Auth users and mapping Supabase Auth UUIDs to `mas_hrms.user_roles`; use `docs/demo/CEO_DEMO_AUTH_MAPPING_RUNBOOK.md`.

---

## 6. Current Open Work

Active open PR:
- **PR #23 — Frontend Role Journey Visibility Foundation**
- Branch: `package-frontend-role-journey-completion`
- Known issue: Vercel workflow YAML error was reported; fix workflow syntax first if still failing.
- Known demo issue: `/role-journeys` is protected and demo login is not yet reliable; public `/demo/role-journeys` route and preview-mode demo login still need completion.

Immediate repair task for PR #23:
1. Fix `.github/workflows/deploy-vercel.yml` YAML syntax on the PR branch.
2. Add public `/demo/role-journeys` route that opens without login.
3. Add preview-only demo login behind `VITE_ENABLE_DEMO_LOGIN=true`.
4. Validate with PeopleOS CI.
5. Merge only after visible browser demo works.

---

## 7. Next Controlled Build Slice After Demo Repair

After PR #23 visible-demo repair is complete, build **Slice 01 — Employee ID Generation + Pre-Joining Onboarding Autofill**.

Scope boundaries:

### Include
- Employee ID rule master migration/API/tests.
- Transaction-safe employee ID generation.
- Pre-joining portal route/page.
- ATS candidate data autofill after validation.
- Resume upload/photo capture parse job abstraction.
- Parsed draft fields and candidate validation screen.
- HR review/approval.
- Candidate-to-employee conversion service.
- Employee cost-centre assignment creation.
- Employee journey event and stat snapshot creation.

### Exclude
- Full roster engine.
- Full payroll production.
- Full DPDP control tower.
- Full communication engine.
- Full gamification.
- Full client portal expansion.

---

## 8. Deployment Workflow State

- `.github/workflows/deploy-vercel.yml` should be **manual-only** using `workflow_dispatch`.
- PR validation is handled by `.github/workflows/peopleos-ci.yml`.
- Do not use Vercel deployment as PR validation.
- Run Vercel only manually when a demo/release URL is explicitly needed.

---

## 9. Product Package Priority After Slice 01

1. Visible Vercel demo and public demo route.
2. Employee ID generation + pre-joining onboarding autofill + resume parsing.
3. DPDP Compliance Foundation.
4. Master Data Foundation expansion.
5. Employee Stat Card and Journey Timeline UI.
6. Candidate/New Joiner Document Verification integration.
7. Roster Logic Master and auto-roster draft engine.
8. Communication Engine for Email/WhatsApp events.
9. Offer Letter dispatch and acknowledgement/consent workflow.
10. Incentive Rule, Approval and Payroll Integration.
11. Gamification layer.
12. Process-wise KPI/Target/Quality/Business Rule mapping.

---

## 10. Standard Validation Gate

Run before every merge:

```bash
npm run build
cd backend
npm run typecheck
npm test
npm run build
```

Required before merge:
- frontend build pass;
- backend typecheck pass;
- all backend tests pass;
- backend production build pass;
- no SQL execution;
- no Vercel deployment unless explicitly requested;
- no external DB/LMS access;
- no secrets committed;
- no sensitive data leakage.

---

## 11. Token-Saving Rule

Use this file for normal continuation. Read the full charter only when:
- this file is incomplete;
- package scope is unclear;
- there is a conflict;
- a hard gate decision is needed;
- a new major product pillar is introduced.

After every successful package merge, update only this file with the new PR/package status and next action.
