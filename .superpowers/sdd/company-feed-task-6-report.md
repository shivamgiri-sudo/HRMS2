status: DONE

files changed
- `src/hooks/useCompanyFeed.ts`
- `.superpowers/sdd/company-feed-task-6-report.md`

tests run and results
- `npm run typecheck`
- PASS

concerns
- The current backend feed routes do not yet consume query params, so the hooks accept and forward optional params now for stable page integration later, but filtering/pagination behavior depends on later backend support.
- Follow-up alignment completed during review: the backend delete controller now accepts `reason` from either request body or query params, so `useDeleteCompanyPost()` is integration-safe with the current `hrmsApi.delete()` helper.
- Follow-up cache fix completed during review: mutation invalidation now targets the full `feed`, `mine`, and `approvals` query families, including filtered and paginated variants.
