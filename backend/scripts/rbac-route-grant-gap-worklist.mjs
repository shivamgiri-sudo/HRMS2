#!/usr/bin/env node
/**
 * RBAC route/grant gap — the decision worklist.
 *
 * THE GAP. A page opens only if BOTH agree: the route's own `roles={[...]}` prop lets the user
 * reach the URL, and role_page_access grants that role the page code so the Gate renders it.
 * Where the route admits a role the DB does not grant, the user reaches the page and is refused.
 * The sidebar now hides those links (PAGE_CODE_BY_ROUTE was completed for this reason), so the
 * symptom is quieter than it was — but the underlying disagreement is unchanged: a role the source
 * code says should have the page does not have it.
 *
 * WHY THIS IS A LIST AND NOT A FIX. Migration 1230 set the precedent: it treated each route's own
 * roles prop as "what the source code already documents as intended" and backfilled the DB to
 * match. That is right for an ordinary operational screen and wrong for a privileged one — the
 * same reasoning would have handed Access Control to `admin` and the Security Centre to `hr`.
 * 1230 therefore did 15 pages after checking each individually, and explicitly excluded
 * SUPER_ADMIN_POLICY_ENGINE. This script does the checking part and leaves the ruling to a person.
 *
 * WHAT EACH ROW TELLS YOU:
 *
 *   page / path        which screen
 *   missing            roles the route admits that hold no active view grant, with live user counts
 *                      (a role nobody holds is noise; a role 18 people hold is a live lockout)
 *   sensitivity        PRIVILEGED pages administer access, security, audit or money movement, and
 *                      must not be widened by a backfill. Everything else is ORDINARY.
 *   recommendation     GRANT for ordinary pages where the route already documents the intent;
 *                      RULE for privileged ones, which need an explicit decision.
 *
 * Sensitivity is judged from the page code, and deliberately errs toward PRIVILEGED — a screen
 * wrongly held back costs an access request, one wrongly opened costs a security incident.
 *
 * READ-ONLY. Writes nothing. Reads role_page_access and user_roles, and a route inventory
 * extracted from src/config/routes by the caller (rbac_routes.json).
 *
 * Usage:
 *   node scripts/rbac-route-grant-gap-worklist.mjs [--csv] [--routes <path>]
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config();

const args = process.argv.slice(2);
const csvMode = args.includes("--csv");
const routesPath = (() => {
  const i = args.indexOf("--routes");
  return i >= 0 ? args[i + 1] : path.resolve(process.cwd(), "..", "rbac_routes.json");
})();

if (!fs.existsSync(routesPath)) {
  console.error(`route inventory not found at ${routesPath}`);
  console.error("Generate it from src/config/routes first (see this file's header).");
  process.exit(1);
}
const routes = JSON.parse(fs.readFileSync(routesPath, "utf8"));

/**
 * Pages whose grants administer access, security, audit or money movement.
 *
 * Matched on the page code because that is the stable identifier — page names and paths get
 * renamed, codes rarely do. Substring matching, so a new SECURITY_* or *_APPROVAL code is caught
 * without anyone remembering to add it here.
 */
const PRIVILEGED = [
  "ACCESS", "SECURITY", "AUDIT", "ADMIN", "PERMISSION", "ROLE", "POLICY", "RBAC",
  "PAYROLL", "SALARY", "BANK", "DISBURSAL", "STATUTORY", "TDS", "PF_", "ESI",
  "APPROVAL", "MIGRATION", "CONFIGURATION", "CONTROL_TOWER", "DPDP",
];
const isPrivileged = (code) => PRIVILEGED.some((p) => code.includes(p));

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const [grantRows] = await conn.execute(
  `SELECT page_code, role_key FROM role_page_access WHERE can_view = 1 AND active_status = 1`,
);
const grants = new Map();
for (const g of grantRows) {
  if (!grants.has(g.page_code)) grants.set(g.page_code, new Set());
  grants.get(g.page_code).add(g.role_key);
}

const [userRows] = await conn.execute(
  `SELECT role_key, COUNT(DISTINCT user_id) AS n FROM user_roles WHERE active_status = 1 GROUP BY role_key`,
);
const holders = new Map(userRows.map((r) => [r.role_key, Number(r.n)]));

// A page absent from page_catalog, or inactive there, cannot be opened by anyone regardless of
// grants — reported separately rather than mixed in with grant gaps, since the fix is different.
const [catalogRows] = await conn.execute(
  `SELECT page_code, active_status FROM page_catalog`,
);
const catalog = new Map(catalogRows.map((r) => [r.page_code, Number(r.active_status)]));

const worklist = [];
for (const r of routes) {
  const granted = grants.get(r.page) ?? new Set();
  // super_admin is elevated to every active page in access.service.ts, so it never needs a grant
  // and its absence is not a gap.
  const missing = r.routeRoles
    .filter((role) => role !== "super_admin" && !granted.has(role))
    .map((role) => ({ role, users: holders.get(role) ?? 0 }))
    .sort((a, b) => b.users - a.users);
  if (!missing.length) continue;
  const live = missing.filter((m) => m.users > 0);
  worklist.push({
    page: r.page,
    path: r.path,
    catalog: catalog.has(r.page) ? (catalog.get(r.page) === 1 ? "active" : "INACTIVE") : "ABSENT",
    missing, live,
    affected: live.reduce((s, m) => s + m.users, 0),
    privileged: isPrivileged(r.page),
  });
}

// Ordered by how many real people are affected: a lockout nobody hits can wait.
worklist.sort((a, b) => b.affected - a.affected);

const ordinary = worklist.filter((w) => !w.privileged && w.live.length);
const privileged = worklist.filter((w) => w.privileged && w.live.length);
const dormant = worklist.filter((w) => !w.live.length);

if (csvMode) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  console.log(["page_code","path","catalog","sensitivity","recommendation","users_affected","missing_roles"].join(","));
  for (const w of [...ordinary, ...privileged, ...dormant]) {
    console.log([
      w.page, w.path, w.catalog,
      w.privileged ? "PRIVILEGED" : "ORDINARY",
      !w.live.length ? "NO-OP (no holders)" : w.privileged ? "RULE" : "GRANT",
      w.affected,
      w.missing.map((m) => `${m.role}(${m.users})`).join(" "),
    ].map(esc).join(","));
  }
} else {
  const fmt = (w) => {
    const cat = w.catalog === "active" ? "" : `  [page_catalog: ${w.catalog}]`;
    console.log(`   ${w.page.padEnd(30)} ${w.path}${cat}`);
    console.log(`     missing: ${w.missing.map((m) => `${m.role}(${m.users} user${m.users === 1 ? "" : "s"})`).join(", ")}`);
  };
  console.log(`\nRBAC ROUTE/GRANT GAP WORKLIST`);
  console.log(`${worklist.length} of ${routes.length} gated routes admit a role the database does not grant.\n`);

  console.log(`-- ORDINARY pages, real people affected — the route already documents the intent`);
  console.log(`   ${ordinary.length} pages, ${ordinary.reduce((s, w) => s + w.affected, 0)} role-assignments blocked`);
  console.log(`   Recommendation: GRANT, matching each route's own roles prop (migration 1230's precedent).\n`);
  ordinary.forEach(fmt);

  console.log(`\n-- PRIVILEGED pages — these administer access, security, audit or money`);
  console.log(`   ${privileged.length} pages. Recommendation: RULE explicitly. A backfill here is how`);
  console.log(`   Access Control ends up granted to admin and the Security Centre to hr.\n`);
  privileged.forEach(fmt);

  if (dormant.length) {
    console.log(`\n-- NO-OP — the missing roles have no holders, so nobody is affected today`);
    console.log(`   ${dormant.length} pages. Worth aligning eventually so the gap does not surprise`);
    console.log(`   someone the day the role is first assigned, but nothing is broken now.\n`);
    dormant.forEach(fmt);
  }

  console.log(`\nNothing has been changed. Each line is a decision; the evidence is the route's own`);
  console.log(`roles prop, the live grant table, and how many people actually hold each role.\n`);
}

await conn.end();
