# Task 2 Report: Company Feed Domain Types and Validation

Status: DONE

Files changed:

- `backend/src/modules/engagement/company-posts.types.ts`
  - Added the required company post status and moderation-state unions.
  - Added post, media, feed-item, creator-access, and moderation DTOs plus service input aliases.
- `backend/src/modules/engagement/company-posts.validation.ts`
  - Added company post status/moderation schemas.
  - Added create, moderate, grant, and revoke schemas.
  - Enforced text-or-image content, 5,000-character text maximum, four-image maximum, image-only v1 media, and UUID validation for employee/user/post/actor IDs when supplied.
- `backend/src/modules/engagement/engagement.types.ts`
  - Re-exported company feed types using the module's NodeNext `.js` import convention.
- `backend/src/modules/engagement/engagement.validation.ts`
  - Re-exported company feed validation schemas using the module's NodeNext `.js` import convention.
- `backend/src/modules/engagement/__tests__/company-posts.service.test.ts`
  - Added focused validation contract tests for valid posts, content requirements, media limits, UUIDs, and moderation actions.

Tests run:

- `cd backend && npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts`
  - PASS: 1 test file, 6 tests.
- `cd backend && npx tsc --noEmit --pretty false --incremental false`
  - PASS: exit code 0.

Concerns:

- Service logic, routes, and frontend remain intentionally unimplemented and untouched for the later company feed tasks.

## Review Finding Fixes

- Made `post_id` required in `ModerateCompanyPostDTO` and `ModerateCompanyPostSchema`, since moderation must target a specific post.
- Added request-specific `CreateCompanyPostMediaDTO` and updated `CreateCompanyPostDTO` to prevent response-only media fields such as `id` and moderation metadata from being supplied by create callers.
- Expanded `company-posts.service.test.ts` to cover missing moderation targets and compile-time rejection of server-managed create-media fields.

Tests rerun:

- `cd backend && npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts`
  - PASS: 1 test file, 7 tests.
- `cd backend && npx tsc --noEmit --pretty false --incremental false`
  - PASS: exit code 0.

## Final Fix Loop

- Made the create-post media object strict so server-managed and other unknown media fields are rejected at runtime instead of silently stripped.
- Added a targeted runtime validation test proving a server-managed `id` field is rejected.

Test rerun:

- `cd backend && npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts`
  - PASS: 1 test file, 8 tests.

## Review outcome

- task reviewer final re-review: `spec PASS`, `quality PASS`, `verdict ACCEPT`
