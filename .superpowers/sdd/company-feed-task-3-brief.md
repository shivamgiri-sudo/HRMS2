# Task 3 Brief: Company Feed Creator Access and Permission Checks

Read this first. It is the requirements source for this task.

Plan file:
- `docs/superpowers/plans/2026-07-18-company-feed.md`

Task:
- Implement creator-access permission checks and moderation-role authorization in the company feed service layer.

Files in scope:
- Create or modify: `backend/src/modules/engagement/company-posts.service.ts`
- Create or modify test: `backend/src/modules/engagement/__tests__/company-posts.service.test.ts`
- Report: `.superpowers/sdd/company-feed-task-3-report.md`

Must produce:
- `assertCanCreateCompanyPost(userId: string): Promise<void>`
- `assertCanModerateCompanyPosts(userId: string): Promise<void>`
- `grantCompanyPostCreator(...)`
- `revokeCompanyPostCreator(...)`
- `listCompanyPostCreators()`

Authorization rules:
- only users with active creator access can create posts
- only `hr_head`, `admin`, and `super_admin` can moderate posts
- only `super_admin` can grant or revoke creator access

Required behavior:
- creator access should read from `company_post_creator_access`
- moderation-role checks should use normalized backend roles, not brittle literals
- grant/revoke should be auditable with existing audit utilities
- do not implement feed lifecycle, post creation, or moderation outcomes yet beyond permission helpers and creator access operations

Constraints:
- keep write scope narrow
- follow existing engagement service patterns
- run targeted tests from `backend`

Verification required:
- run `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts` from `backend`

Report file:
- `.superpowers/sdd/company-feed-task-3-report.md`

Return format:
- status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- files changed
- tests run and results
- any concerns
