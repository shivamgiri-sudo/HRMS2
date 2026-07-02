# MAS Callnet PeopleOS / HRMS — Current Project Overview

**Baseline date:** 2026-05-29  
**Purpose:** Source-of-truth guidance for controlled Claude-assisted development.

## 1. Current Architecture Baseline

| Layer | Current Baseline |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind/shadcn/Radix |
| Backend | Express + TypeScript under `/backend` |
| Operational DB direction | MySQL `mas_hrms` for operational backend modules |
| Identity / file storage | Supabase Auth and Storage; transitional native flows still exist |
| Frontend hosting direction | Vercel |
| Backend hosting direction | Railway |
| LMS | Already independently deployed internally; integrate only |

No passwords, secret keys or production connection values belong in this document or source control.

## 2. Existing Backend Foundations

The current project baseline documents working or partially built API foundations for:

| Module | Current Foundation |
|---|---|
| Employees | Employee CRUD, status handling, salary assignment hooks and journey logs |
| ATS | Candidates, stage movement/history, onboarding bridge, sourcing channels and stats |
| Leave | Types, requests, review, balance and holiday calendar |
| Attendance / WFM | Shifts, sessions, breaks, regularisation and live tracker |
| Roster | Plans, publishing, assignments and CSV upload |
| Payroll | Structures, components, salary assignment, payroll runs/calculation, advances and statutory config foundation |
| KPI | Metrics, templates, assignments, scores, summaries and leaderboard |
| Client Portal | OTP/client token foundation, mapped process overview, KPI/glide path/action/governance/attrition/commentary surfaces |
| Exit | Exit request/list/status/statistics foundation |
| Integration Hub | Connector configuration, mapping, schedules, run history and external DB sync patterns |
| Processes | Process CRUD/status management |
| Migration Console | Data-population/status checks |

## 3. Existing Frontend Surfaces

The current project includes pages for core HR, ATS, WFM/operations, quality, portal/governance, exit, migration and LMS-labelled surfaces. Existing pages must not be deleted before their data sources, access controls and replacement/integration paths are validated.

## 4. Correct LMS Position

The LMS is **not a missing HRMS backend to rebuild**. It is an independently deployed internal system.

| LMS-owned capability | HRMS responsibility |
|---|---|
| Curriculum, classroom, modules and content | No duplicate editing; secure launch/deep link only where applicable |
| Assessments and question bank | Receive approved result summaries only |
| Learner progress and completion | Sync snapshots for employee/manager dashboards |
| Certification decisions | Sync status/readiness into PeopleOS |
| Trainee/coordinator/admin LMS operations | Keep in deployed LMS |
| Training reporting | Aggregate approved synced data in HRMS dashboards and restricted client views |

## 5. Known Product Gaps / Validation Priorities

| Priority | Area | Validation / Completion Need |
|---:|---|---|
| P0 | Schema execution | Confirm clean local MySQL creation includes every mounted backend dependency, including KPI and Client Portal tables |
| P0 | Security | Audit API-level role and row-scope enforcement for sensitive modules and client mapping |
| P0 | Payroll foundation | Verify statutory configuration contract before treating calculations as reliable |
| P0 | Safe test environment | Establish isolated local/staging MySQL validation before migrations |
| P1 | Payroll completion | TDS, gratuity, F&F, advance recovery, payout/reconciliation and statutory outputs |
| P1 | Assets/Documents | Controlled backend convergence while preserving current functional flows |
| P1 | LMS | Build integration layer only, through Integration Hub patterns |
| P1 | WFM | Forecasting, shrinkage, attrition and capacity/risk analytics |
| P2 | ERP extension | Expenses, procurement, vendors, contracts, billing and finance integration |

## 6. Safety Boundary

- Never run destructive SQL or migrations on production without explicit approval.
- Never expose employee, candidate, payroll or client-sensitive data through the Client Portal.
- Never commit secrets, live connection values or production data exports.
- Never replace a working flow until a tested transition path exists.
- No Store Manager role is required in this product architecture.

For implementation guidance, read `CLAUDE.md`, `MAS_CALLNET_PEOPLEOS_REVISED_MASTER_ROADMAP.md`, `LMS_INTEGRATION_BLUEPRINT.md` and `PHASE_0_CLAUDE_START_PROMPT.md` in this folder.
