# Dashboard access and scope validation

## Change set

- Branch: `codex/dashboard-remediation-access-scope`
- Base: `origin/main` at `ae9372b1`
- Production touched: **No**
- Database writes or migrations: **None**
- Deployment, PM2, or Nginx changes: **None**

## Automated evidence

The focused Vitest suite covers:

- all twelve unique dashboard definitions;
- explicit admin and super-admin behavior;
- role alias normalization;
- the complete primary role-dashboard access matrix;
- self filters by resolved employee ID;
- direct/indirect team filters by resolved employee IDs;
- employee-linked domain filters;
- fail-closed empty team/self filters.

Command:

```text
cd backend
node ./node_modules/vitest/vitest.mjs run \
  src/modules/dashboards/__tests__/dashboard-access-registry.test.ts \
  src/modules/dashboards/__tests__/dashboard-scope-filter.test.ts
```

Verified result (2026-07-23): 2 test files, 10 tests, all passing.

Backend and frontend TypeScript checks must also pass before review:

```text
cd backend && npm run typecheck
cd .. && npm run typecheck
```

## Authorization behavior

- Unknown dashboard code: HTTP 404.
- Known but unauthorized dashboard code: HTTP 403.
- Missing required scope mapping: HTTP 409 with
  `errorCode: "DASHBOARD_SCOPE_NOT_CONFIGURED"`.
- Invalid requested branch/process: fail-closed custom scope (`1=0`).
- Frontend route, tab selection and backend API all read the same canonical
  dashboard registry.

## Rollback

No database rollback is required. Revert only the access/scope branch changes,
then rebuild the frontend and backend in a non-production environment. Because no
migration or persisted-data change is part of this PR, rollback is code-only.
