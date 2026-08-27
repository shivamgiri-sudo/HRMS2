diff --git a/backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts b/backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts
new file mode 100644
index 00000000..2f0fe960
--- /dev/null
+++ b/backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts
@@ -0,0 +1,36 @@
+import { readFileSync } from "node:fs";
+import { resolve } from "node:path";
+import { describe, expect, it } from "vitest";
+
+/**
+ * Who sees the whole organisation in reports.
+ *
+ * SUPER_ADMIN_ROLES was ['super_admin','admin','ceo'], so a COO would have been restricted to
+ * their own branch by the `emp?.branch_id` fallback — the opposite of the intent, and
+ * inconsistent with SENSITIVE_ROLES in the same module, which already listed coo.
+ *
+ * No coo users existed when this was written (verified live 2026-08-26), so the defect was
+ * latent: it would appear the first time the role was granted.
+ */
+const SRC = readFileSync(resolve(process.cwd(), "src/modules/reporting/reporting.scope.ts"), "utf8");
+const roleList = () => /const SUPER_ADMIN_ROLES\s*=\s*\[([^\]]*)\]/.exec(SRC)?.[1] ?? "";
+
+describe("reporting scope roles", () => {
+  it("grants org-wide scope to super_admin, admin, ceo and coo", () => {
+    for (const role of ["super_admin", "admin", "ceo", "coo"]) {
+      expect(roleList(), `${role} must have org-wide report scope`).toContain(`'${role}'`);
+    }
+  });
+
+  it("does not quietly grant org-wide scope to branch or functional roles", () => {
+    // branch_admin in this system also carries admin and finance_head grants, so org-wide
+    // access must stay an explicit allow-list rather than being inferred.
+    for (const role of ["branch_admin", "branch_head", "hr", "operations_manager"]) {
+      expect(roleList(), `${role} must NOT be org-wide`).not.toContain(`'${role}'`);
+    }
+  });
+
+  it("still fails closed for a user with no scope row and no branch", () => {
+    expect(SRC).toContain("NO_BRANCH_SCOPE_SENTINEL");
+  });
+});
diff --git a/backend/src/modules/reporting/reporting.scope.ts b/backend/src/modules/reporting/reporting.scope.ts
index ea09b91f..6a329c1f 100644
--- a/backend/src/modules/reporting/reporting.scope.ts
+++ b/backend/src/modules/reporting/reporting.scope.ts
@@ -3,21 +3,32 @@ import type { RowDataPacket } from 'mysql2';
 import type { ExecScope, DimensionScope } from './executors/types.js';
 import { demoRoleForUserId } from '../../shared/demoAuth.js';
 
 const NO_BRANCH_SCOPE_SENTINEL = '__NO_BRANCH_SCOPE__';
 
 export interface BranchScope {
   isSuperAdmin: boolean;
   branchIds: string[];  // empty = all only for super admin or explicit all-scope users
 }
 
-const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo'];
+/*
+ * Roles that see the whole organisation in every report.
+ *
+ * 'coo' added 2026-08-26. It was absent, so a COO fell through to the `emp?.branch_id`
+ * fallback and would have been branch-restricted — the opposite of the intent, and
+ * inconsistent with SENSITIVE_ROLES below, which already listed coo. No coo users existed at
+ * the time, so this was latent rather than a live breach.
+ *
+ * This is an explicit allow-list. branch_admin in this system also carries admin and
+ * finance_head grants, so org-wide access must never be inferred from another role.
+ */
+const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo', 'coo'];
 
 export async function resolveBranchScope(userId: string): Promise<BranchScope> {
   const [roleRows] = await db.execute<RowDataPacket[]>(
     `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
     [userId]
   );
   const dbRoles = (roleRows as { role_key: string }[]).map(r => r.role_key);
 
   // Same demo-identity gap as resolveFullScope below: these ids exist in DEMO_TOKEN_MAP but
   // in neither user_roles nor employees, so without this the branch scope falls through to
