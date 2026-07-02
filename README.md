# MAS Callnet PeopleOS / HRMS

A workforce operating platform for MAS Callnet, designed for a multi-branch BPO/call-centre environment. The repository combines HRMS operations, ATS, attendance/leave, WFM and roster, payroll foundation, KPI/performance foundations, exit management, Integration Hub, migration support and a process-scoped Client Portal.

## Important Product Decision: LMS Integration Only

The internal LMS has already been independently built and deployed. This repository must integrate that LMS through a controlled integration layer; it must not rebuild curriculum, content, assessment, certification or learner-operation workflows inside HRMS.

See:

- `CLAUDE.md`
- `docs/peopleos-build/LMS_INTEGRATION_BLUEPRINT.md`
- `docs/peopleos-build/MAS_CALLNET_PEOPLEOS_REVISED_MASTER_ROADMAP.md`

## Current Architecture Baseline

| Layer | Current Direction |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind/shadcn/Radix; Local/Docker deployment |
| Backend | Express + TypeScript under `/backend`; Local/Docker deployment |
| Operational data | MySQL `mas_hrms` for backend operational modules |
| Authentication / files | Supabase Auth and Storage; transitional Supabase-native flows still exist |
| LMS | Separately deployed internal tool; integrate into PeopleOS |

## Existing Foundations in This Repository

- Employees and employee journey log foundation
- ATS and onboarding bridge foundation
- Leave and attendance/WFM/roster foundation
- Payroll/pre-payroll calculation foundation
- KPI/performance foundation
- Process-scoped Client Portal foundation
- Exit management foundation
- Integration Hub and migration-console foundation
- Assets/documents/native UI flows requiring controlled convergence
- LMS-related access/dashboard surfaces to be aligned to the external deployed LMS

## Production Readiness Boundary

This repository is an active development baseline. Do not treat the following as completed until validated and implemented through approved phases:

- full statutory payroll, TDS, gratuity, F&F and payout reconciliation;
- completed backend authorization/row-scope controls across every module;
- full Asset/Document backend convergence;
- LMS integration implementation;
- complete WFM forecasting/shrinkage/attrition control;
- complete ERP procurement/billing/finance extensions.

## Claude-Assisted Development

Retain `CLAUDE.md` at the repository root. Begin with the audit-only prompt in:

```text
docs/peopleos-build/PHASE_0_CLAUDE_START_PROMPT.md
```

All implementation must happen in a new branch, with local/staging database validation first. No production SQL, deployment, GitHub merge or destructive rewrite should occur without explicit approval.

## Existing Setup Documentation

Existing project setup, migration and integration runbooks remain in `/docs` and the current codebase. Before changing runtime configuration, audit the actual backend/front-end environment requirements and preserve secrets outside source control.
