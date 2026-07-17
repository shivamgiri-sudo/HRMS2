# Backend Test Baseline - 2026-07-17

This note captures the current backend test baseline after the ATS Candidate Assessment and TensorFlow WASM fixes landed.
It is meant to separate the known baseline from new regressions during future reconciliation work.

## Current Summary

Cached full-suite results from the latest validated backend runs:

- Base on PR #30 merge commit `8f066d4cbeb6d03e54e390b12de3d900d6fcffc9`
  - `273 failed`
  - `1226 passed`
  - `108 skipped`
  - `4 todo`
- Branch on PR #31 commit `2933e54042f420d24e0269142ac0175de970af20`
  - `273 failed`
  - `1233 passed`
  - `108 skipped`
  - `4 todo`

The branch introduced no new failing file/test pairs compared with the base.

## Failing Test Files By Module

The cached Vitest logs show the following top-level failing suites:

### ATS

- `src/modules/ats/__tests__/ats.joiningDocumentsTracker.routes.test.ts`

### Customization

- `src/modules/customization/__tests__/customization-api.test.ts`

## Likely Failure Categories

- stale auth mocks
- schema drift
- test isolation leaks
- outdated fixtures
- module-level route assumptions that no longer match the current backend
- shared mock state crossing test files

## Proposed Phased Repair Order

1. Authentication test fixture migration
2. ATS and WFM tests
3. Payroll tests
4. Access-control tests
5. Database and schema-dependent tests
6. Shared mock isolation
7. CI test grouping

## Follow-Up Backlog

Use this as the backlog list for the repair work that should stay out of the deployment workflow PR:

- Authentication test fixture migration
- ATS and WFM tests
- Payroll tests
- Access-control tests
- Database and schema-dependent tests
- Shared mock isolation
- CI test grouping

## Regression Note

PR #31 did not introduce any new failing file/test pairs relative to the PR #30 baseline.
The summary counts differ, but the failing file/test pair set is unchanged.

