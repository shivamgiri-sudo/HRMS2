# Task 5 Brief: Company Feed Controller and Routes

Read this first. It is the requirements source for this task.

Plan file:
- `docs/superpowers/plans/2026-07-18-company-feed.md`

Task:
- Expose the approved company feed service methods through controller functions and engagement routes with backend authorization and validation-safe request handling.

Files in scope:
- Create: `backend/src/modules/engagement/company-posts.controller.ts`
- Modify: `backend/src/modules/engagement/engagement.routes.ts`
- Report: `.superpowers/sdd/company-feed-task-5-report.md`

Must produce:
- `GET /api/engagement/company-posts/feed`
- `POST /api/engagement/company-posts`
- `GET /api/engagement/company-posts/mine`
- `GET /api/engagement/company-posts/approvals`
- `POST /api/engagement/company-posts/:id/approve`
- `POST /api/engagement/company-posts/:id/reject`
- `DELETE /api/engagement/company-posts/:id`
- `GET /api/engagement/company-post-creators`
- `POST /api/engagement/company-post-creators/:employeeId/grant`
- `POST /api/engagement/company-post-creators/:employeeId/revoke`

Required behavior:
- Route handlers must delegate to the existing company post service methods from Tasks 3 and 4.
- Feed route returns approved posts only.
- Create route must use authenticated user context and service-enforced creator access.
- Approval/deletion routes must use authenticated user context and service-enforced moderator access.
- Creator access routes must rely on service-enforced super-admin-only permissions.
- Use existing engagement route patterns and error handling style.
- Do not break existing engagement endpoints.

Constraints:
- Do not add frontend work yet.
- Do not widen role access in routes beyond what the service already enforces.
- Keep work additive and scoped to the files above plus the report file only.

Verification required:
- run `npx vitest run src/modules/engagement/__tests__/company-posts.routes.test.ts` from `backend`
- if the route test file does not exist yet, create it within the route task only if truly required by the route wiring pattern; otherwise report that gap explicitly

Report file:
- `.superpowers/sdd/company-feed-task-5-report.md`

Return format:
- status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- files changed
- tests run and results
- any concerns
