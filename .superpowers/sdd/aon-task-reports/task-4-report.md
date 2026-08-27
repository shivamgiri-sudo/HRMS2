# Task 4 Report: COO gets org-wide reporting scope

## Summary
Added `coo` role to `SUPER_ADMIN_ROLES` constant in reporting.scope.ts, allowing COOs to see organisation-wide data in all reports instead of being branch-restricted.

## Files Changed
- `backend/src/modules/reporting/reporting.scope.ts` (line 13: added role + comment)
- `backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts` (new test file)

## Implementation Details

### Step 1: Test Written
Created `backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts` with three tests:
1. Verifies that super_admin, admin, ceo, and coo all appear in SUPER_ADMIN_ROLES
2. Verifies that branch/functional roles (branch_admin, branch_head, hr, operations_manager) are NOT in the list
3. Verifies the fail-closed sentinel (NO_BRANCH_SCOPE_SENTINEL) is present in the source

### Step 2: Test Ran (TDD Stage 1 - Failing)
```
cd backend && npx vitest run src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts
```

**Result: FAILED as expected**
```
FAIL  src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts > reporting scope roles > grants org-wide scope to super_admin, admin, ceo and coo
AssertionError: coo must have org-wide report scope: expected '\'super_admin\', \'admin\', \'ceo\'' to contain '\'coo\''
```

Confirms the defect: SUPER_ADMIN_ROLES was `['super_admin', 'admin', 'ceo']`, missing `coo`.

### Step 3: Implementation
Modified `backend/src/modules/reporting/reporting.scope.ts` line 13:

**Before:**
```ts
const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo'];
```

**After:**
```ts
/*
 * Roles that see the whole organisation in every report.
 *
 * 'coo' added 2026-08-26. It was absent, so a COO fell through to the `emp?.branch_id`
 * fallback and would have been branch-restricted — the opposite of the intent, and
 * inconsistent with SENSITIVE_ROLES below, which already listed coo. No coo users existed at
 * the time, so this was latent rather than a live breach.
 *
 * This is an explicit allow-list. branch_admin in this system also carries admin and
 * finance_head grants, so org-wide access must never be inferred from another role.
 */
const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo', 'coo'];
```

### Step 4: Test Ran (TDD Stage 2 - Passing)
```
cd backend && npx vitest run src/modules/reporting/__tests__/
```

**Result: PASSED**
```
 Test Files  49 passed (49)
      Tests  294 passed | 1 skipped (295)
   Start at  23:04:45
   Duration  58.13s (transform 3.93s, setup 678ms, import 7.98s, tests 754ms, environment 4ms)
```

All 49 test files in the reporting module passed, confirming:
- The new role-contract test now passes
- All existing reporting tests remain green
- No regressions introduced

### Step 5: Commit
```bash
git add backend/src/modules/reporting/reporting.scope.ts backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts
git commit -m "fix(reporting): give COO org-wide report scope"
```

**Commit SHA:** `1bb58410`

## Correctness Notes

1. **Scope of Change:** This change affects all reports in the system (not just AON Analytics), as SUPER_ADMIN_ROLES in reporting.scope.ts governs scope for every report. This is intentional and approved per the task context.

2. **Latent Defect:** No COO users existed at the time this defect was introduced, so it was latent rather than a live security issue. The fix now ensures the first COO granted that role will have correct org-wide visibility.

3. **Consistency:** The fix aligns with SENSITIVE_ROLES on line 193 of the same file, which already included `'coo'`, confirming the original intent was for COOs to have elevated privileges.

4. **Fail-Closed:** The code still fails closed for users without a scope row and no branch assignment (NO_BRANCH_SCOPE_SENTINEL check on line 61), ensuring any user without proper scope data cannot see data they shouldn't.

5. **Explicit Allow-List:** The implementation maintains the explicit allow-list pattern rather than inferring scope. This is important because branch_admin in this system carries both admin and finance_head grants, creating potential for unintended scope spillover if the mechanism were changed to infer rather than allow-list.
