# MAS Callnet PeopleOS / HRMS — Claude Project Instructions

## Product Goal

Build a production-grade MAS Callnet workforce platform for a BPO/call-centre organisation:

- ATS and recruitment lifecycle
- HRMS and complete employee lifecycle
- Attendance, leave, WFM, roster and live tracking
- Payroll, salary slips, statutory compliance, gratuity, tax, PF/UAN/ESIC and full-and-final settlement
- Assets and documents
- LMS, training and certification
- Operations and Quality performance
- Resignation and exit
- Client Portal restricted to each client's mapped process/LOB performance
- Integration Hub and Migration Console
- Controlled ERP extensions: expenses, procurement, vendors, contracts, client billing and finance integration

Do **not** create a Store Manager role. Use roles such as Super Admin, HR Admin, Recruitment HR, Finance/Payroll, WFM, Branch Head, Operations Manager, Process Manager, Trainer, QA/T&Q, Employee and Client.

## Current Architecture Baseline — Preserve It

The repository currently contains:

- Frontend: React 18 + TypeScript + Vite + Tailwind + shadcn/Radix, deployed to Vercel.
- Backend: Express + TypeScript under `/backend`, intended for Railway.
- Operational DB: MySQL `mas_hrms`.
- Authentication and storage: Supabase Auth and Storage; some existing frontend-native modules still read Supabase tables.
- Current backend route modules: employees, ATS, leave, payroll foundation, WFM/roster, KPI, portal, exit, integration hub, process and migration.
- Existing Supabase/native pages and SQL foundations for LMS, WFM, Quality, Operations, ATS and access control.

Existing functional or partially functional flows must not be discarded. Add a wrapper or migration path before changing any direct-Supabase functionality.

## Protected Existing Workflows

Treat these as protected unless the user explicitly approves replacement:

1. Existing employee CRUD, onboarding/profile, attendance, leave, asset UI/hooks, reports, notifications and PWA flows.
2. Existing ATS Candidate Web Form and Recruiter Mobile App flows already used outside this repository; integrate safely, do not break or silently replace.
3. Existing LMS Apps Script/Google Sheets production flows; migrate through an integration layer and preserve business rules.
4. Existing Client Portal concept: process-scoped client access only.
5. Existing WFM/roster, KPI, exit and Integration Hub work.
6. Existing HRMS/Supabase auth and stored document flows until a tested migration is available.

## Non-Negotiable Engineering Rules

1. Work in **one narrowly scoped phase at a time**. Never attempt the entire PeopleOS build in one change.
2. Before editing, produce:
   - current behaviour summary,
   - exact files to modify/create,
   - database tables/API endpoints affected,
   - risk to working flows,
   - test/rollback plan.
3. Never delete existing functions, routes, tables, page flows, SQL migrations or user-visible options solely to simplify implementation.
4. Never run migrations, destructive SQL, seed/reset operations or deployment commands against production without the user's explicit approval.
5. Keep migrations additive and backward-compatible. Use new migration files rather than modifying already-applied production migrations unless the user confirms they were never applied.
6. Backend authorization is mandatory. UI route gating is not security.
7. All sensitive operations must enforce role and scope at API/query level:
   - payroll and statutory data: Finance/Payroll + authorised HR only,
   - candidate PII: authorised ATS/HR roles only,
   - employee data: approved HR/reporting-scope access,
   - client portal: mapped process/LOB only, with masked/no employee or candidate sensitive data.
8. Every state-changing action must be auditable: who, what, when, before/after values, module and entity.
9. Keep UI premium and usable, but do not use a UI redesign to hide missing backend functionality.
10. No mock metrics in production flows. Demo tenants/data must be isolated and visibly identified.

## Source-of-Truth Direction

Unless the user approves an alternative migration design:

| Domain | Intended Authoritative Source |
|---|---|
| Login/session identity | Supabase Auth |
| File binaries | Supabase Storage initially |
| Employee, ATS, attendance, leave, WFM, payroll, KPI, portal metrics, exit, process masters | MySQL through Express APIs |
| Existing Supabase-native modules not yet migrated | Preserve temporarily; document as transitional and migrate module-by-module |

Do not let the same operational domain be edited independently in both MySQL and Supabase without an explicit synchronisation/migration plan.

## High-Priority Issues Already Identified in the Uploaded Source

Treat these as initial audit targets; verify before implementing.

1. `backend/sql/000_run_all.sql` sources `010_kpi_migration.sql` but does not source `010_kpi.sql`; backend KPI and Client Portal services rely on KPI master tables created in `010_kpi.sql`.
2. `backend/sql/000_run_all.sql` does not source `012_client_portal.sql`, although `/api/portal` services query client portal tables.
3. `backend/src/middleware/requireRole.ts` exists, but route modules inspected use `requireAuth` without route-level `requireRole`. Do not expose payroll, integration, client-user administration, employee export or migration actions to any logged-in user.
4. `backend/src/modules/payroll/payrollCalculate.service.ts` reads `SELECT * FROM statutory_config LIMIT 1` as though it returned columns such as `pf_employee_pct`; the DDL stores key/value rows (`config_key`, `config_value`). Fix this before treating payroll calculation as reliable.
5. Several actual frontend page files exist but active routes use `NativePlaceholderPage`, including LMS Admin, LMS Management Dashboard, WFM Live Tracker, Quality Dashboard and Operations Dashboard. Do not merely switch routing: some draft page files reference `db` without an imported/defined client and must first be repaired and tested.
6. The Docker/local development configuration is Supabase/PostgreSQL-centred, while the Express operational modules require MySQL. Establish an isolated MySQL local/staging database path before running backend migrations or tests.
7. Payroll is a foundation only: TDS projection, gratuity, F&F, automated salary advance recovery, payout workflow and statutory outputs are not complete.
8. LMS, Assets and Document journeys have existing UI/Supabase foundations, but dedicated Express/MySQL backend completion/migration is not finished.

## Required Work Pattern in Claude Code

For a new phase:

1. Start in plan mode.
2. Read this `CLAUDE.md`, the active roadmap, current code, schemas and tests relevant to that phase.
3. Report verified findings; never assume documentation is accurate when the code differs.
4. Propose a small implementation plan and the exact file list.
5. Wait for user approval before changing code or database scripts.
6. Implement only the approved scope.
7. Run validation:
   - frontend: `npm run build` and relevant lint/type checks,
   - backend: `cd backend && npm run typecheck && npm run test && npm run build`,
   - database: migration test only against an isolated local/staging schema,
   - role/security acceptance tests where relevant.
8. Show the diff summary, testing output, known limitations and rollback steps.
9. Commit only after user confirms.

## Coding Expectations

- TypeScript strictness: avoid `any` for new public API contracts and services.
- Validate request payloads with Zod.
- Use service/repository/controller separation in backend modules.
- Use parameterised SQL only.
- Build pagination, filtering and scope enforcement into list endpoints.
- Do not store sensitive files or secrets in frontend state or logs.
- Preserve audit/history records; prefer soft status changes where compliance requires a trace.
- Standardise API responses and errors.
- Add automated tests for new services/routes and authorization.

## Initial Delivery Sequence

1. Phase 0: baseline audit, safe local environment, broken migration runner, payroll config defect, authorization gap and route wiring assessment.
2. Phase 1: org masters, role/scope/audit/workflow foundation.
3. Phase 2: employee lifecycle, document and asset backend completion.
4. Phase 3: ATS, hiring demand, onboarding and candidate-to-employee conversion.
5. Phase 4: attendance, leave, WFM, roster, forecasting, shrinkage and attrition.
6. Phase 5: payroll, statutory, payslip, F&F, gratuity and tax.
7. Phase 6: LMS/training/certification migration.
8. Phase 7: Operations/Quality performance and Call Master integration.
9. Phase 8: Client Portal production hardening.
10. Phase 9: ERP extensions.
11. Phase 10: data migration, security, UAT and deployment readiness.

## Claude Must Not Do Without Explicit Approval

- Deploy to Vercel, Railway or Supabase.
- Run MySQL SQL on the production host.
- Reset databases or storage.
- Modify authentication model or RLS policies broadly.
- Remove modules, pages, migrations, tables or existing business logic.
- Publish secrets, environment values or client/employee/candidate data.
- Push or merge to GitHub.
