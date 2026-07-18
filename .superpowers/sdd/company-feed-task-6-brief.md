# Task 6 Brief: Company Feed Frontend Data Hooks

Read this first. It is the requirements source for this task.

Plan file:
- `docs/superpowers/plans/2026-07-18-company-feed.md`

Task:
- Build the shared frontend query/mutation hook layer for company feed pages using existing `hrmsApi` and TanStack Query patterns.

Files in scope:
- Create: `src/hooks/useCompanyFeed.ts`
- Report: `.superpowers/sdd/company-feed-task-6-report.md`

Must produce:
- `useCompanyFeed(params?)`
- `useMyCompanyPosts(params?)`
- `useCreateCompanyPost()`
- `useApprovalQueue(params?)`
- `useApproveCompanyPost()`
- `useRejectCompanyPost()`
- `useDeleteCompanyPost()`
- `useCompanyPostCreators()`
- `useGrantCompanyPostCreator()`
- `useRevokeCompanyPostCreator()`

Required behavior:
- Use `hrmsApi` for all API calls.
- Follow existing React Query conventions already used in this repo.
- Keep company-feed query keys stable and explicit.
- Invalidate the right company-feed queries after create/approve/reject/delete/grant/revoke mutations.
- Do not add UI yet.
- Keep the hook file focused and typed enough for the upcoming pages.

Constraints:
- Work only in the hook file plus the report file.
- Do not modify page files yet.
- Preserve existing app patterns; do not introduce a new API client or state library.

Verification required:
- run `npm run typecheck`
- if full repo typecheck is noisy from unrelated existing issues, report exactly what happened and still verify the new hook file as far as possible

Report file:
- `.superpowers/sdd/company-feed-task-6-report.md`

Return format:
- status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- files changed
- tests run and results
- any concerns
