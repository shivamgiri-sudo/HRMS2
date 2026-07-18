# Task 4 Brief: Company Feed Lifecycle and Moderation Logic

Read this first. It is the requirements source for this task.

Plan file:
- `docs/superpowers/plans/2026-07-18-company-feed.md`

Task:
- Implement the company post lifecycle, moderation status mapping, and visibility-safe feed query logic in the service layer.

Files in scope:
- Modify: `backend/src/modules/engagement/company-posts.service.ts`
- Modify: `backend/src/modules/engagement/__tests__/company-posts.service.test.ts`
- Report: `.superpowers/sdd/company-feed-task-4-report.md`

Must produce:
- `createCompanyPost(...)`
- `listApprovedCompanyFeed(...)`
- `listMyCompanyPosts(...)`
- `listCompanyPostApprovals(...)`
- `approveCompanyPost(...)`
- `rejectCompanyPost(...)`
- `deleteCompanyPost(...)`

Required moderation behavior:
- clear violations -> `auto_rejected`
- borderline content -> `borderline_flagged`
- otherwise -> `pending_approval`

Required visibility behavior:
- public/all-employee feed shows only `approved` posts
- creator view can include own non-approved posts
- approval queue shows pending/borderline content for authorized moderators

Required deletion behavior:
- soft delete only
- set status to `deleted`
- preserve auditability

Required audit behavior:
- write audit events for approve, reject, delete, and auto-reject paths handled in this task

Constraints:
- do not add routes or controllers yet
- keep work in service + tests only
- moderation evaluator can be deterministic/stubbed for v1, but must map to the exact required statuses
- use the existing permission helpers from Task 3

Verification required:
- run `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts` from `backend`

Report file:
- `.superpowers/sdd/company-feed-task-4-report.md`

Return format:
- status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- files changed
- tests run and results
- any concerns
