# Task 1 Brief: Company Feed Database Foundation

Read this first. It is the requirements source for this task.

Plan file:
- `docs/superpowers/plans/2026-07-18-company-feed.md`

Task:
- Add the company feed database foundation using an additive SQL migration.

Files in scope:
- Create: `backend/sql/451_company_feed_foundation.sql`
- Modify if needed: `backend/sql/000_run_all.sql`
- Modify if needed: `backend/src/db/runPendingMigrations.ts`
- Create or modify test: `backend/src/modules/engagement/__tests__/company-posts.service.test.ts`

Must produce these tables:
- `company_posts`
- `company_post_media`
- `company_post_creator_access`
- `company_post_audit_log`

Must preserve these statuses:
- `draft`
- `pending_approval`
- `borderline_flagged`
- `approved`
- `rejected`
- `auto_rejected`
- `deleted`

Constraints:
- additive migration only
- do not change existing engagement functionality
- if the local schema runner manifest requires explicit inclusion, add `SOURCE sql/451_company_feed_foundation.sql;`
- do not run live SQL
- use the repo's existing migration conventions

Deliverable:
- SQL migration file created
- manifest updated only if required
- runtime migration manifest updated if it is the authoritative startup manifest
- targeted service test file added or updated to assert the expected table/status contract

Verification required:
- run `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts` from `backend`

Report file:
- `.superpowers/sdd/company-feed-task-1-report.md`

Return format:
- status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- files changed
- tests run and results
- any concerns
