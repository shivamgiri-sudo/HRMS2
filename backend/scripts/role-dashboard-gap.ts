/**
 * READ-ONLY diagnostic: reconcile the THREE independent gates a role must pass to see
 * a dashboard.
 *
 *   1. code registry  — shared/dashboardAccessRegistry.ts allowedRoleKeys
 *                       (enforced by ProtectedRoute and requireDashboardEntitlement)
 *   2. DB page grants — role_page_access.can_view
 *                       (enforced by WorkforcePageGate)
 *   3. a rendered layout actually existing for that dashboard code
 *
 * A role must satisfy all three. Where they disagree the user is silently blocked or
 * silently over-granted, and nothing in the app reports it. This prints the gaps.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import {
  DASHBOARD_ACCESS_REGISTRY,
  canAccessDashboard,
  normalizeDashboardRole,
} from "../src/shared/dashboardAccessRegistry.js";

const CODE_CODES = new Set(Object.keys(DASHBOARD_ACCESS_REGISTRY));

async function main() {
  const [roles] = await db.execute<RowDataPacket[]>(
    `SELECT ur.role_key, COUNT(DISTINCT ur.user_id) AS users
       FROM user_roles ur WHERE ur.active_status = 1
      GROUP BY ur.role_key ORDER BY users DESC`,
  );

  const [grants] = await db.execute<RowDataPacket[]>(
    `SELECT role_key, page_code FROM role_page_access
      WHERE active_status = 1 AND can_view = 1 AND page_code LIKE '%DASHBOARD%'`,
  );
  const grantsByRole = new Map<string, Set<string>>();
  for (const g of grants as any[]) {
    const key = String(g.role_key);
    if (!grantsByRole.has(key)) grantsByRole.set(key, new Set());
    grantsByRole.get(key)!.add(String(g.page_code));
  }

  console.log("\n══ PER-ROLE GATE RECONCILIATION (roles with real users) ══\n");
  const rows: Array<Record<string, unknown>> = [];
  for (const r of roles as any[]) {
    const roleKey = String(r.role_key);
    const normalized = normalizeDashboardRole(roleKey);
    const dbGranted = [...(grantsByRole.get(roleKey) ?? [])].sort();
    const codeGranted = Object.keys(DASHBOARD_ACCESS_REGISTRY)
      .filter((code) => canAccessDashboard(code as any, [roleKey]))
      .sort();

    // Blocked: the DB says yes, the code registry says no (for a code the code knows).
    const blocked = dbGranted.filter((code) => CODE_CODES.has(code) && !codeGranted.includes(code));
    // Gate-blocked: the code says yes, the DB withholds the page.
    const pageMissing = codeGranted.filter((code) => !dbGranted.includes(code));
    // Phantom: granted in the DB but the code implements no such dashboard.
    const phantom = dbGranted.filter((code) => !CODE_CODES.has(code));

    rows.push({
      role: roleKey,
      users: Number(r.users),
      normalized: normalized === roleKey ? "" : normalized,
      code: codeGranted.length,
      db: dbGranted.length,
      "BLOCKED by code": blocked.join(", ") || "",
      "BLOCKED by page gate": pageMissing.join(", ") || "",
      "phantom (no layout)": phantom.join(", ") || "",
    });
  }
  console.table(rows);

  console.log("\n══ DASHBOARD CODES GRANTED IN DB WITH NO IMPLEMENTATION ══");
  const allDb = new Set<string>();
  for (const set of grantsByRole.values()) for (const code of set) allDb.add(code);
  const phantoms = [...allDb].filter((code) => !CODE_CODES.has(code)).sort();
  console.log("  " + (phantoms.join("\n  ") || "(none)"));

  console.log("\n══ IMPLEMENTED DASHBOARDS NEVER GRANTED TO ANY ROLE IN DB ══");
  const ungranted = [...CODE_CODES].filter((code) => !allDb.has(code)).sort();
  console.log("  " + (ungranted.join(", ") || "(none)"));

  console.log("\n══ ROLES WITH USERS BUT NO DASHBOARD AT ALL (code side) ══");
  const orphans = (roles as any[])
    .filter((r) => Object.keys(DASHBOARD_ACCESS_REGISTRY)
      .every((code) => !canAccessDashboard(code as any, [String(r.role_key)])))
    .map((r) => `${r.role_key} (${r.users} users)`);
  console.log("  " + (orphans.join("\n  ") || "(none)"));

  process.exit(0);
}

main().catch((error) => {
  console.error("role-dashboard-gap failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
