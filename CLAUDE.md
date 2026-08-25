# MAS Callnet PeopleOS / HRMS — Claude Project Instructions

## ⛔ HARD STOP — NEVER DEPLOY WITHOUT EXPLICIT USER APPROVAL

**DO NOT run `git push`, `plink`, `pm2`, `npm run build` on the production server, or any deployment command without the user typing explicit approval in the current conversation.**

The production URL https://mcnhrms.teammas.in is live and actively used. An unsanctioned deploy — even a clean one — disrupts real users. "The code builds locally" is NOT approval to deploy. "Show me the demo" is NOT approval to deploy. Wait for the user to say something like "deploy it", "push to server", or "go live".

## Product Goal

Build a production-grade MAS Callnet workforce platform for a multi-branch BPO/call-centre organisation, while preserving the modules that already work.

The platform scope is:

- ATS and recruitment lifecycle
- HRMS and complete employee lifecycle
- Attendance, leave, WFM, roster and live tracking
- Payroll, salary slips, statutory compliance, gratuity, tax, PF/UAN/ESIC and full-and-final settlement
- Assets and document management
- Operations and Quality performance
- Resignation and exit management
- Client Portal restricted to each client's mapped process/LOB performance
- Integration Hub and Migration Console
- Controlled ERP extensions: expenses, procurement, vendors, contracts, client billing and finance integration
- Integration with the already deployed internal LMS

Do **not** create a Store Manager role. Use appropriate roles such as Super Admin, HR Admin, Recruitment HR, Finance/Payroll, WFM, Branch Head, Operations Manager, Process Manager, Trainer, QA/T&Q, Employee and Client.

## Current Architecture Baseline — Preserve It

The repository currently contains:

- Frontend: React 18 + TypeScript + Vite + Tailwind + shadcn/Radix, served locally or via nginx.
- Backend: Express + TypeScript under `/backend`, runs locally or via Docker.
- Operational DB: MySQL `mas_hrms`.
- Authentication: MySQL-based JWT auth via `/api/auth/*` endpoints.
- Current backend route modules: employees, ATS, leave, payroll foundation, WFM/roster, KPI, portal, exit, integration hub, process and migration.
- Existing pages and SQL foundations for assets, documents, LMS access surfaces, WFM, Quality, Operations, ATS and access control.

Existing functional or partially functional flows must not be discarded. Add an integration, wrapper or migration path before changing any existing functionality.

## LMS Integration Rule — Existing Deployed System

The LMS tool has already been independently built and deployed internally. It is a protected existing system and must not be rebuilt from scratch inside this HRMS repository.

The deployed LMS remains the system of record for:

- curriculum, classrooms, modules and learning content;
- learner progress and course/MCQ completion;
- MCQ assessments and question banks;
- trainee questions and answers;
- sequential unlock rules;
- direct learning assignments;
- certification rules and certification decisions;
- trainee/coordinator/admin LMS operational workflows.

HRMS / PeopleOS must integrate the existing LMS through a controlled integration layer, preferably using the existing Integration Hub patterns.

Required HRMS integration outcomes:

- employee-to-LMS learner mapping;
- branch/process/LOB/batch mapping;
- learner progress summary sync;
- MCQ completion and score summary sync;
- certification and Operations handover-readiness sync;
- training risk and attrition summary sync;
- sync audit/error/retry control;
- employee, manager and management dashboard visibility;
- approved aggregate client-portal visibility;
- secure launch/deep-link or SSO feasibility.

Do not:

- build duplicate curriculum/content/assessment/certification edit flows in HRMS;
- delete existing LMS page references until an integration replacement is verified;
- modify or deploy changes to the independently deployed LMS unless the user explicitly authorises it;
- create two competing sources of truth for training or certification data.

## Protected Existing Workflows

Treat these as protected unless the user explicitly approves replacement:

1. Existing employee CRUD, onboarding/profile, attendance, leave, asset UI/hooks, reports, notifications and PWA flows.
2. Existing ATS Candidate Web Form and Recruiter Mobile App flows already used outside this repository; integrate safely, do not break or silently replace.
3. Existing independently deployed LMS and all its working operational flows; integrate only.
4. Existing Client Portal concept: process-scoped client access only, with no payroll/PII leakage.
5. Existing WFM/roster, KPI, exit and Integration Hub work.
6. Existing HRMS authentication and stored document flows until a tested migration is available.

## Non-Negotiable Engineering Rules

1. Work in one narrowly scoped phase at a time. Never attempt the full PeopleOS build in one change.
2. Before editing, produce: current behaviour summary; exact files to modify/create; database tables/API endpoints affected; risk to working flows; test/rollback plan.
3. Never delete existing functions, routes, tables, page flows, SQL migrations or user-visible options solely to simplify implementation.
4. Never run migrations, destructive SQL, seed/reset operations or deployment commands against production without explicit user approval.
5. Keep migrations additive and backward-compatible. Add new migration files instead of editing already-applied production migrations unless confirmed safe.
6. Backend authorization is mandatory. UI route gating is not security.
7. Sensitive operations must enforce role and row scope at API/query level.
8. Every state-changing action and sensitive export must be auditable.
9. UI enhancement must not hide missing backend functionality.
10. No mock metrics in production flows. Demo tenants/data must be isolated and labelled.
11. Do not push, merge, deploy or update production without user approval.

## Concurrent Agent Rule — More Than One Claude Works Here

Several Claude sessions edit this repository at the same time, often the same
files within the same minute. Treat every change you did not make as another
agent's work in progress, and never as noise to be tidied away.

### Never do these

1. **Never revert, overwrite or discard another session's code.** Not their
   commits, not their uncommitted working-tree changes. If their change looks
   wrong, say so in your report and leave it alone — you cannot tell a mistake
   from work that is half-finished.
2. **Never force-push any shared branch**, `main` above all. A force-push here
   has already destroyed merged work; see the log below.
3. **Never use `git add -A`, `git add .`, `git commit -a`, or `git checkout --`
   across the tree.** Stage your own files by explicit path, every time. A broad
   add sweeps another agent's in-flight edits into your commit, where they are
   attributed to the wrong change and impossible to find later.
4. **Never `git stash` to "clean up"** before your own work. The stash you drop
   may not be yours.
5. **Never copy a server-side directory over the repository** to "sync
   production". A server copy is a snapshot of one moment and silently deletes
   anything merged since; see the log below.

### Always do these

1. `git fetch` and re-read `git log origin/main` immediately before you commit.
   `main` moves several times an hour.
2. `git status --porcelain` before staging. Anything dirty that is not yours,
   leave dirty, and do not include it.
3. After committing, confirm what actually landed with
   `git show --stat HEAD` — verify your files are in it and nothing else is.
4. After pushing, confirm your commit is an ancestor of `origin/main`
   (`git merge-base --is-ancestor <sha> origin/main`). A push can report success
   while your work sits outside the branch.
5. Prefer a scratch worktree for anything long-running, so a concurrent commit
   cannot absorb your half-finished files.
6. If another agent's process holds a port, a lock or a dev server, work around
   it — a different port, a different worktree. Do not kill it.

### What went wrong on 2026-07-29, so it is not repeated

- A **force-push of `main`** (`805392a` → `d465e44`) dropped four already-merged
  commits: the Mira feature, its 500-error hotfix, a deploy fix and an auth fix.
  They survived only because an unrelated branch still referenced them.
- A **"sync server-side production patches" commit** replaced `db/mysql.ts` with
  an older server copy, silently removing connection-pool idle bounds and leaving
  `main` failing its own test.
- A **broad `git add`** absorbed three in-progress backend files into an
  unrelated RBAC commit, so a streaming feature is recorded under a role-model
  change and its own commit contains only tests.

None of these were malicious. All three came from treating the repository as
though one agent owned it.

## Database Boundary Rule (Charter v1.0, 2026-05-29)

### MySQL First — Permanent Direction
- `mas_hrms` is the dedicated writable PeopleOS application database. All new business workflow data lives here.
- Build every new module (ATS, employee lifecycle, payroll, WFM, portal, LMS integration, ERP) in MySQL.

### Upstream Source Systems
- Existing production SQL databases, Call Master, attendance sources, client/source systems are upstream read-only sources.
- Future connectors read approved datapoints into `mas_hrms` only; no writeback to source systems.
- No upstream schema or data modifications without separate explicit approval.

### LMS Boundary
- The deployed internal LMS is the system of record for curriculum, content, assessments, certification operations.
- PeopleOS builds integration scaffolding only: learner/batch/progress/certification/risk snapshots, sync error controls and approved Client Portal readiness feed.
- Do not rebuild LMS operations. Do not connect to or alter the live LMS without explicit approval.

## Source-of-Truth Direction

| Domain | Authoritative Source / Direction |
|---|---|
| Login/session identity | MySQL-based JWT auth (`/api/auth/*`) |
| File binaries | Local filesystem via Express `/api/files/*` |
| Employee, ATS, attendance, leave, WFM, payroll, KPI, portal metrics, exit, process masters | MySQL through Express APIs |
| LMS course/content/assessment/certification operations | Existing deployed LMS only |
| LMS readiness and reporting snapshots in HRMS | Synced from deployed LMS through integration layer |

Do not let the same operational domain be edited independently in two systems without an explicit synchronisation/migration plan.

## High-Priority Audit Targets from the Uploaded Source

Verify these in code before implementing changes:

1. `backend/sql/000_run_all.sql` may omit KPI base schema and Client Portal schema required by mounted services.
2. `backend/src/middleware/requireRole.ts` exists, but route-level authorization and row-scope enforcement require a complete security audit.
3. `backend/src/modules/payroll/payrollCalculate.service.ts` must be reconciled with the `statutory_config` database contract before payroll is treated as reliable.
4. All modules run against MySQL `mas_hrms`. Establish isolated local/staging MySQL testing first.
5. Several `App.tsx` routes use `NativePlaceholderPage`, but that wrapper currently renders real LMS Admin, LMS Management, WFM Live Tracker, Quality and Operations components for matching titles. Do not delete it blindly; refactor only after integration/runtime testing.
6. Asset/document journeys have existing file-upload foundations; build controlled backend convergence rather than removing active flows.
7. Payroll remains a foundation until TDS, gratuity, F&F, salary-advance recovery, payout workflow and statutory outputs are complete.
8. LMS is not a missing backend to rebuild: it is an external deployed system to integrate.

## Roster Governance (First-Class Pillar)
- Weekly roster lifecycle is critical: demand → allocation → draft → publish → acknowledge → active → lock → payroll-input-ready.
- Process Manager has publication authority for their mapped process.
- Post-publication changes require mandatory reason and audit.
- Employee acknowledgement is required before production deployment.
- Client Portal receives only approved aggregate roster/shrinkage outputs; no individual employee roster or attendance reasons.

## Payroll and Statutory Safety Rules
- No payroll computation may become final payable logic unless based on approved effective-dated configuration, verified calculations, role security, reconciliation and owner approval.
- TDS projection: blocked/pending unless approved effective-dated slab configuration exists in `statutory_config`. No hardcoded fallback slabs.
- LWP deduction: configurable basis required (`lwp_deduction_basis` in config); provisional/blocked without it.
- Gratuity: configurable eligible wage base, minimum years and statutory cap required; draft only until configured.
- F&F approval blocked when `is_ff_provisional=1` — requires authorised setProvisionalFalse() override with audit reason.
- Never expose payroll/salary/tax/PF/UAN/bank data through Client Portal, management surfaces or any non-payroll endpoint.

## Drill-Down Mandate — Non-Negotiable UI Rule

Every table, list, or data grid in this platform **must** have a clickable row drill-down. This is mandatory with no exceptions.

### What the drill-down must show
1. **Full record detail** — every field stored in the database for that record, not just what fits in the table columns.
2. **Related sub-records** — items, line-items, documents, attachments, linked entities.
3. **Approval / workflow timeline** — all stage transitions with actor name, timestamp, decision, and remarks.
4. **Documents** — any uploaded files or generated PDFs must be viewable inline with a "View" / "Download" button.
5. **Audit trail** — if the record has an audit log table, show the last N audit entries.

### Implementation rules
- Row click opens a **right-side slide-over drawer** (not a new page, not a modal dialog), `max-w-2xl`, full viewport height, scrollable.
- The drawer fetches the full detail record from a dedicated `GET /api/<module>/:id` endpoint — never reuse the list payload.
- Drawer header shows: record number/ID, status badge, created date, and a close button.
- Sections are visually separated with a label (`text-xs font-bold uppercase tracking-wide text-slate-400`).
- All monetary values formatted with `₹` and Indian locale. All dates formatted as `DD/MM/YYYY HH:mm`.
- If a section has no data (e.g. no documents, no audit entries), show a compact "None" placeholder — never hide the section entirely.
- Print-eligible records show a "Print" link in the drawer header.

### Applies to all modules
This rule applies to every existing and future module: Exit Pass, ATS, Employees, Payroll, Leave, Attendance, WFM/Roster, Assets, Visitors, IT Provisioning, Documents, and all ERP modules. When you touch a page that lacks a drill-down, add it — even if it was not the original task scope.

## Database Query Rule — Always Use Real MySQL, Never MCP

**Never use the `mcp__hrms-db__*` MCP tools for database queries.** They time out and are unreliable.

Always query `mas_hrms` directly via the MySQL CLI on the production server or localhost:

```bash
mysql -u root -p mas_hrms -e "SELECT ..."
```

Or via the backend's existing `db` pool in a one-off script. The MCP DB tools are read-only wrappers that frequently time out — use real MySQL every time.

## Continuous Build Permission
- Build clean feature branches, additive MySQL migrations (unexecuted), APIs, UI and tests without stopping.
- Stop ONLY for charter hard gates: live SQL execution, deployment, credential changes, live upstream DB/LMS access, payroll activation, destructive changes, unresolved PII/security exposure.
- Squash-merge safe PRs after package quality gates pass.

## Required Work Pattern in Claude Code

For every phase:

1. Start in Plan mode.
2. Read `CLAUDE.md` and relevant files under `docs/peopleos-build/`.
3. Inspect the actual code/schemas/tests; documentation may be incomplete.
4. Report verified findings and propose a small implementation plan with exact file list.
5. Wait for approval before changing code or database scripts.
6. Implement only the approved scope.
7. Validate frontend/backend builds and relevant tests; migrations only against isolated local/staging schema.
8. Show diff summary, validation output, known limitations and rollback steps.
9. Commit or push only after user approval.

## Initial Delivery Sequence

1. Phase 0: baseline audit, safe local environment, schema runner, authorization, payroll-foundation and routing assessment.
2. Phase 1: organisation masters, role/scope/audit/workflow foundation.
3. Phase 2: employee lifecycle, document and asset backend convergence.
4. Phase 3: ATS, hiring demand, onboarding and candidate-to-employee conversion.
5. Phase 4: attendance, leave, WFM, roster, forecasting, shrinkage and attrition.
6. Phase 5: payroll, statutory, payslip, F&F, gratuity and tax.
7. Phase 6: LMS Integration Layer for the independently deployed LMS; no LMS rebuild.
8. Phase 7: Operations/Quality performance and Call Master integration.
9. Phase 8: Client Portal production hardening and approved LMS readiness summaries.
10. Phase 9: ERP extensions.
11. Phase 10: data migration, security, UAT and deployment readiness.

## Claude Must Not Do Without Explicit Approval

- Deploy to any hosting platform or the deployed LMS.
- Run MySQL SQL on the production host.
- Reset databases or storage.
- Broadly modify authentication or RLS policies.
- Remove modules, pages, migrations, tables or existing business logic.
- Publish secrets, environment values or client/employee/candidate data.
- Push or merge to GitHub.

## Package Reference
This project implements the PeopleOS Master Execution Charter (docs/peopleos-build/PEOPLEOS_MASTER_EXECUTION_CHARTER.md).
Packages A–L defined in charter §12. Current position tracked in CLAUDE_IMPLEMENTATION_TRACKER.md.

## Mandatory Skill Usage (Session Rules)

### 1. Graphify — Always-On Token Saver
Before broad codebase exploration, ALWAYS check `graphify-out/` first.
If it exists, use `/graphify query "<question>"` to answer architecture/relationship questions instead of reading many files.
If it does not exist, run `/graphify` on the project root to build the knowledge graph once.
Never read 5+ files to answer a question that a graph query can answer in one call.

### 2. Superpowers Skills — Always Invoke Before Acting
- Before ANY new feature or component: invoke `sp-brainstorming` (`/brainstorm`)
- Before writing implementation code: invoke `sp-writing-plans` then `sp-executing-plans`
- Before claiming anything is done/fixed/passing: invoke `sp-verification-before-completion` (`/verify`) — run real commands, show real output
- When debugging: invoke `sp-systematic-debugging` (`/debug`)
- When completing a branch: invoke `sp-finishing-a-development-branch`
- For parallel independent tasks: invoke `sp-dispatching-parallel-agents`

### 3. UI/UX Pro Max — Required for All UI Work
Every UI task (new page, new component, refactor, review) MUST begin with:
```bash
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "<description>" --design-system --stack shadcn -p "MAS PeopleOS"
```
Then run domain searches for specific components:
```bash
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "<component>" --domain ux --stack shadcn
```
Never implement UI without consulting the design system. Use `/ux` slash command to trigger this workflow.

### 4. Frontend Design — Distinctive Visual Decisions
Invoke `/frontend-design` whenever making aesthetic or layout choices: new page layouts, component visual style, typography decisions, color usage, or any UI that risks looking generic/templated. Use it before finalizing any new screen design.

### 5. Caveman Mode — Token Efficiency
Invoke `/caveman` when responses are getting verbose or when the user asks for brevity. Use it for terse status updates, quick summaries, and any context where token efficiency matters over prose.

### 6. Mandatory Verification Before Handover — NON-NEGOTIABLE

**Before reporting any task as complete or handing it to the user, you MUST verify both backend and frontend end-to-end. No exceptions.**

#### Backend Verification (run every time)
```bash
# 1. Hit the actual API endpoint on production or local:
curl -s -H "Authorization: Bearer <token>" https://mcnhrms.teammas.in/api/<endpoint> | jq .

# 2. Confirm the response shape matches what the frontend expects.
# 3. For DB changes: query the table directly to confirm rows/columns exist.
mysql -u shivam_user -p'qwersdfg!@#hjk' -h 122.184.128.90 mas_hrms -e "SELECT ..."
```

#### Frontend Verification (run every time)
```bash
# 1. Build must pass with zero errors:
npm run build 2>&1 | tail -5

# 2. Backend TypeScript must pass with zero errors:
cd backend && npx tsc --noEmit 2>&1 | head -10
```

#### What "verified" means before handover
- [ ] `npm run build` completed with no TypeScript errors
- [ ] `cd backend && npx tsc --noEmit` returned no errors
- [ ] The actual API endpoint was called and returned expected data (not just "route exists")
- [ ] Any new DB columns/tables confirmed to exist via MySQL query
- [ ] UI change visually confirmed in browser OR explicitly stated it cannot be tested and why

**If you skip any of these, you are not done. Do not say "done", "pushed", or "complete" until all boxes above are checked.**
