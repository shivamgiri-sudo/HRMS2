# Task 4 Report: Mount Router in app.ts

DONE

- Commit SHA: e108018c
- tsc result: zero errors (no output)
- Changes: added import for `esiRegDocsRouter` after `payrollMoreRouter` import; mounted `app.use("/api/payroll", listEndpointLimiter, esiRegDocsRouter)` after `payrollMoreRouter` mount
- Staged: `backend/src/app.ts` only
