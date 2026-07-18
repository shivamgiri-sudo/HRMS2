# Task 2 Brief: Company Feed Domain Types and Validation

Read this first. It is the requirements source for this task.

Plan file:
- `docs/superpowers/plans/2026-07-18-company-feed.md`

Task:
- Define the company feed backend domain types and validation schemas.

Files in scope:
- Create: `backend/src/modules/engagement/company-posts.types.ts`
- Create: `backend/src/modules/engagement/company-posts.validation.ts`
- Modify: `backend/src/modules/engagement/engagement.types.ts`
- Modify: `backend/src/modules/engagement/engagement.validation.ts`
- Create or modify test: `backend/src/modules/engagement/__tests__/company-posts.service.test.ts`

Must produce:
- `CompanyPostStatus`
- `CompanyPostModerationState`
- DTOs for posts, feed items, creator access rows, and moderation actions
- `CreateCompanyPostSchema`
- `ModerateCompanyPostSchema`
- `GrantCompanyPostCreatorSchema`
- `RevokeCompanyPostCreatorSchema` if naturally paired

Required status values:
- `draft`
- `pending_approval`
- `borderline_flagged`
- `approved`
- `rejected`
- `auto_rejected`
- `deleted`

Validation rules to enforce:
- post must contain text or at least one image
- maximum 4 images
- image media type only for v1 media schema
- employee IDs and user IDs should use existing UUID validation patterns
- text length should be bounded, consistent with internal-company feed use

Constraints:
- follow existing engagement module conventions
- do not implement service logic yet
- do not touch routes or frontend in this task
- run the targeted test from `backend`

Verification required:
- run `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts` from `backend`

Report file:
- `.superpowers/sdd/company-feed-task-2-report.md`

Return format:
- status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- files changed
- tests run and results
- any concerns
