# CLAUDE_ACTIVE_CONTEXT

**Purpose:** Token-efficient active execution context for Claude Code. Read this first. Do **not** re-read the full master charter every turn unless this file is unclear, conflicts appear, or a hard gate needs interpretation.

**Last updated:** 30-May-2026

---

## 1. Permanent Execution Rule

Start every user-facing Claude instruction/work cycle with:

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

Do not stop for routine source code, additive unexecuted migrations, local tests, PR creation, green PR merge, or starting the next package.

---

## 4. Current Merged Baseline

Merged completed work:
- PR #12–#13: Phase 0 schema/security foundation.
- PR #14: organisation/workflow/audit foundation.
- PR #15: employee lifecycle/assets/helpdesk/letters.
- PR #16: ATS + WFM extensions/security fixes.
- PR #17/#19: payroll/F&F foundation plus safety corrections.
- PR #18: management surfaces + portal hardening.
- PR #20: Roster & Shift Governance completed and merged.

PR #20 final rules:
- Process Manager + WFM jointly own weekly roster draft→publish in mapped `user_assignment_scope`.
- TL/AM monitor and raise/resolve coverage actions only.
- TL/AM cannot freely edit published roster truth.
- Employee sees/acknowledges own roster only.
- Client Portal receives aggregate roster readiness only.

---

## 5. Current Open / Next Work

Current open package:
- **PR #21 — Package C: Attendance, Leave, WFM and RTA Completion**
- Branch: `package-c/attendance-leave-wfm-rta`
- Reported validation: 50 test files, 711 tests, 0 failures; frontend/backend builds clean.
- Migration: `021_attendance_leave_rta.sql` additive and unexecuted.

Next action:
1. Review PR #21.
2. If full validation is green and no hard gate exists, squash-merge PR #21 to `main` and delete branch.
3. Start urgent CEO demo branch.

---

## 6. Urgent CEO Demo Branch

Create branch after PR #21 merge:

```text
demo/ceo-access-capacity-readiness
```

Goal: demo-ready role access + staffing intelligence without SQL execution or deployment.

Build:
1. `shivam.giri@teammas.in` Super Admin via safe source-only seed/runbook.
2. Demo users/role matrix for Super Admin, HR Admin, Recruiter, Employee, WFM, Process Manager, AM, TL, QA, Trainer, Payroll/Finance, Branch Head, CEO, Client User.
3. Temporary demo password source: `PEOPLEOS_DEMO_PASSWORD`; fallback `Demo@12345!` only outside production; no plaintext password storage.
4. Account control foundation: forgot password, admin reset link/temp reset, force reset, unlock, disable, revoke sessions, audit.
5. Workforce Mandate & Capacity demo: mandate HC, buffer %, shortage/surplus, production vs support HC, support role split, training/joining pipeline, certified pending, on-notice, risk status.
6. Demo cards/pages for CEO, WFM, Process Manager and Client Portal.
7. Client Portal aggregate staffing readiness only; no employee/payroll/PII leakage.

---

## 7. New Packages Added

Package M — Account Control / Password Recovery:
- Supabase Auth + MySQL audit bridge.
- Employee forgot password.
- Admin reset/unlock/disable/revoke session.
- No plaintext passwords.

Package N — Workforce Mandate & Capacity Planning:
- Client/process/branch/LOB/role-group mandate.
- Buffer/shrinkage/attrition/training buffer.
- Production vs Support HC.
- Support roles: TL, QA, RTM/RTA, SME, AM, Process Manager, Manager, Trainer, WFM, MIS, HR, IT.
- Target HC, active eligible HC, pipeline, training projection, shortage/surplus and risk.
- Client Portal aggregate only.

---

## 8. Standard Validation Gate

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
- no Vercel deployment;
- no external DB/LMS access;
- no secrets committed;
- no sensitive data leakage.

---

## 9. Token-Saving Rule

Use this file for normal continuation. Read the full charter only when:
- this file is incomplete;
- package scope is unclear;
- there is a conflict;
- a hard gate decision is needed;
- a new major product pillar is introduced.

After every successful package merge, update only this file with the new PR/package status and next action.
