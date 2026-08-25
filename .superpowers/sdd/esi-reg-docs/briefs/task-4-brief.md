# Task 4 Brief: Mount Router in app.ts

## Context
Task 4 of 6. A single-file edit: add import + mount line to `backend/src/app.ts`.

## What to build

### Step 1: Add import
In `backend/src/app.ts`, after the existing payroll imports (around lines 27–30), add:

```typescript
import { esiRegDocsRouter } from "./modules/payroll/esi-reg-docs.routes.js";
```

The existing nearby imports look like:
```typescript
import { payrollExtendedRouter } from "./modules/payroll/payroll-extended.routes.js";
import { payrollMoreRouter } from "./modules/payroll/payroll-more.routes.js";
```

### Step 2: Mount router
After line 387 (`app.use("/api/payroll", listEndpointLimiter, payrollMoreRouter);`), add:

```typescript
app.use("/api/payroll", listEndpointLimiter, esiRegDocsRouter);
```

## Steps

```bash
# TypeScript check — must be zero errors in app.ts
cd backend && npx tsc --noEmit 2>&1 | head -20

# Stage only app.ts
git add backend/src/app.ts
git commit -m "feat(payroll): mount esiRegDocsRouter under /api/payroll"
```

## Global constraints
- Mount after `payrollMoreRouter` (line 387)
- Use `listEndpointLimiter` in the middleware chain (same as adjacent mounts)
- Do NOT add `requireAuth` at the mount — the router itself calls `esiRegDocsRouter.use(requireAuth)` internally (already done in Task 2)
- Stage ONLY `backend/src/app.ts`

## Report file
Write to: `c:/Users/ADMIN/Desktop/HRMS2-latest/.superpowers/sdd/esi-reg-docs/briefs/task-4-report.md`
Return only: DONE/BLOCKED, commit SHA, tsc result.
