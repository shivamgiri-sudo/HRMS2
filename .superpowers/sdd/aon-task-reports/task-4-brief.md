## Global Constraints

- Active employee is `active_status = 1 AND LOWER(COALESCE(employment_status,'active')) = 'active'` — expected live count **1,091**, never 1,121.
- `LOWER()` is mandatory on `employment_status`: reactivation writes `'Active'`, and the column holds `'Active'` 273 / `'active'` 1,039.
- Never use `date_of_exit IS NULL` alone as an active test — 28,426 inactive employees have no exit date.
- Bucket list is exactly five, in this order: `In Training`, `0-30`, `31-60`, `61-90`, `90+`.
- All tenure DATEDIFFs are wrapped in `GREATEST(..., 0)` so negative AON is impossible.
- Backend tests run from `backend/`: `npx vitest run <path>`. Frontend typecheck runs from repo root: `npm run typecheck`.
- Never run a full backend `tsc` — the repo has ~94 pre-existing errors and orphan files; check only the files you touched.
- Commit per task, path-scoped (`git add <exact files>`). This is a shared working tree with other sessions active — never `git commit -a`.

### Task 4: COO gets org-wide reporting scope

**Files:**
- Modify: `backend/src/modules/reporting/reporting.scope.ts:13`
- Test: `backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts`

**Interfaces:**
- Consumes: nothing. Produces: nothing — behavioural change only.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Who sees the whole organisation in reports.
 *
 * SUPER_ADMIN_ROLES was ['super_admin','admin','ceo'], so a COO would have been restricted to
 * their own branch by the `emp?.branch_id` fallback — the opposite of the intent, and
 * inconsistent with SENSITIVE_ROLES in the same module, which already listed coo.
 *
 * No coo users existed when this was written (verified live 2026-08-26), so the defect was
 * latent: it would appear the first time the role was granted.
 */
const SRC = readFileSync(resolve(process.cwd(), "src/modules/reporting/reporting.scope.ts"), "utf8");
const roleList = () => /const SUPER_ADMIN_ROLES\s*=\s*\[([^\]]*)\]/.exec(SRC)?.[1] ?? "";

describe("reporting scope roles", () => {
  it("grants org-wide scope to super_admin, admin, ceo and coo", () => {
    for (const role of ["super_admin", "admin", "ceo", "coo"]) {
      expect(roleList(), `${role} must have org-wide report scope`).toContain(`'${role}'`);
    }
  });

  it("does not quietly grant org-wide scope to branch or functional roles", () => {
    // branch_admin in this system also carries admin and finance_head grants, so org-wide
    // access must stay an explicit allow-list rather than being inferred.
    for (const role of ["branch_admin", "branch_head", "hr", "operations_manager"]) {
      expect(roleList(), `${role} must NOT be org-wide`).not.toContain(`'${role}'`);
    }
  });

  it("still fails closed for a user with no scope row and no branch", () => {
    expect(SRC).toContain("NO_BRANCH_SCOPE_SENTINEL");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts`
Expected: FAIL — `coo must have org-wide report scope`

- [ ] **Step 3: Add the role**

Replace line 13 of `backend/src/modules/reporting/reporting.scope.ts`:

```ts
const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo'];
```

with:

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

- [ ] **Step 4: Run the reporting suite**

Run: `cd backend && npx vitest run src/modules/reporting/__tests__/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/reporting/reporting.scope.ts backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts
git commit -m "fix(reporting): give COO org-wide report scope"
```

---

