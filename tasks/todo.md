# Role Page RBAC Cleanup Todo

## Task 1: Add Typed Role-Page Matrix
**Description:** Create a single TypeScript role-to-page matrix that groups page codes by business role and can be reused by tests, demo access, and SQL generation.

**Acceptance criteria:**
- [ ] Every active business role has an explicit allowed page-code list.
- [ ] `admin` is system/config only by default.
- [ ] `super_admin` is the only role with all active pages.

**Verification:**
- [ ] Matrix unit test confirms sensitive modules are absent for unrelated roles.
- [ ] Typecheck passes: `npm run typecheck`.

**Dependencies:** None

**Files likely touched:**
- `src/lib/rbacPageMatrix.ts`
- `src/tests/rbac-page-matrix.test.ts`

**Estimated scope:** Medium

## Task 2: Add RBAC Audit Script
**Description:** Add a read-only script that connects using existing backend env config and reports live `role_page_access` drift from the matrix.

**Acceptance criteria:**
- [ ] Script prints keep/add/revoke counts per role.
- [ ] Script does not write to the database.
- [ ] Script masks or avoids printing credentials.

**Verification:**
- [ ] Run script against `mas_hrms` and save/report summary.

**Dependencies:** Task 1

**Files likely touched:**
- `scripts/audit-rbac-page-access.mjs`
- `package.json`

**Estimated scope:** Small

## Task 3: Review Dry-Run Report
**Description:** Run the audit and review risky revokes before implementation proceeds to live cleanup.

**Acceptance criteria:**
- [ ] Report identifies over-broad grants for `admin`, WFM, Finance, Payroll, HR, Recruiter, Manager, and Employee.
- [ ] Business exceptions are listed separately.

**Verification:**
- [ ] Dry-run output reviewed before SQL migration is applied.

**Dependencies:** Task 2

**Files likely touched:** None, unless saving report under `tasks/`.

**Estimated scope:** Small

## Task 4: Align Sidebar With Page Codes
**Description:** Make sidebar visibility use page-code permissions for business pages and remove broad role fallbacks that show irrelevant pages.

**Acceptance criteria:**
- [ ] Business nav items have `pageCode` or are explicitly self-service public.
- [ ] `roles` alone cannot show Payroll, Finance, ATS, HR admin, WFM, or Quality pages.
- [ ] Parent groups appear only when at least one child is allowed.

**Verification:**
- [ ] RBAC nav tests pass.
- [ ] Browser smoke verifies role-specific menus.

**Dependencies:** Task 1

**Files likely touched:**
- `src/components/layout/navConfig.tsx`
- `src/components/layout/CompactDashboardLayout.tsx`
- `src/tests/demo-access-contract.test.ts`

**Estimated scope:** Medium

## Task 5: Gate Direct Routes
**Description:** Add `WorkforcePageGate` to business routes that are currently role-only or auth-only so direct URLs match sidebar access.

**Acceptance criteria:**
- [ ] Every protected business route has a page-code gate.
- [ ] Legacy `ProtectedRoute roles` is only an additional restriction, not the sole permission source.
- [ ] Direct unauthorized URLs show access denied.

**Verification:**
- [ ] Route composition test passes: `npm run verify:routes`.
- [ ] Targeted browser direct-URL smoke tests pass.

**Dependencies:** Task 1

**Files likely touched:**
- `src/config/routes/*.routes.tsx`
- `scripts/app-route-composition.test.tsx`

**Estimated scope:** Medium

## Task 6: Align Demo Credentials
**Description:** Update demo role page lists to use the canonical matrix so local/demo RBAC mirrors real access.

**Acceptance criteria:**
- [ ] Demo admin no longer receives business pages by default.
- [ ] Demo department roles receive only matrix-approved pages.
- [ ] Demo super admin receives all active page codes.

**Verification:**
- [ ] Demo access contract tests pass.

**Dependencies:** Task 1

**Files likely touched:**
- `src/lib/demoCreds.ts`
- `src/tests/demo-access-contract.test.ts`

**Estimated scope:** Small

## Task 7: Create Idempotent SQL Cleanup Migration
**Description:** Generate SQL that soft-disables irrelevant role-page rows and inserts/updates approved grants according to the matrix.

**Acceptance criteria:**
- [ ] SQL is idempotent.
- [ ] SQL soft-disables rows instead of deleting history.
- [ ] SQL preserves `user_page_access` overrides.

**Verification:**
- [ ] Dry-run audit before and after against a non-production copy or reviewed transaction.

**Dependencies:** Tasks 1-3

**Files likely touched:**
- `backend/sql/56x_role_page_rbac_cleanup.sql`

**Estimated scope:** Medium

## Task 8: Apply Live DB Cleanup After Approval
**Description:** Apply the reviewed SQL migration to the real `mas_hrms` database.

**Acceptance criteria:**
- [ ] User approval is recorded before any write.
- [ ] Migration output shows expected affected rows.
- [ ] Audit after migration has no unexpected broad grants.

**Verification:**
- [ ] Read-only audit confirms matrix alignment.

**Dependencies:** Task 7 and approval

**Files likely touched:** Database only.

**Estimated scope:** Small

## Task 9: Final Verification and Push
**Description:** Verify the fixed RBAC behavior locally/live, then commit and push code changes to `main`.

**Acceptance criteria:**
- [ ] Frontend and backend typechecks pass.
- [ ] Targeted RBAC tests pass.
- [ ] Browser smoke validates admin, employee, HR, WFM, finance, payroll, manager, and recruiter.
- [ ] Code changes are pushed to GitHub main after verification.

**Verification:**
- [ ] `npm run typecheck`
- [ ] `npm --prefix backend run typecheck`
- [ ] Targeted vitest commands
- [ ] Browser smoke screenshots/API checks

**Dependencies:** Tasks 4-8

**Files likely touched:** Git metadata only after verified code changes.

**Estimated scope:** Medium
