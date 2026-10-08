/**
 * Why a user is refused a TPZ company dashboard. READ-ONLY (SELECTs only).
 *
 * Prints the user's roles, own branch/process, whether the role-based process scope reaches the
 * company's process codes, the user's explicit TPZ grants, and where those processes sit.
 *
 *   npx tsx scripts/process-scope-diagnose.ts "<name or email>" [companyKey=bellavita]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { resolveProcessScope, tpzCompanyAllowed } from "../src/modules/dashboards/process-scope-guards.js";
import { getTpzAccess } from "../src/modules/tpz-access/tpz-access.service.js";
import { canTpz } from "../src/modules/tpz-access/tpz-access.resolver.js";
import { tpzCompany } from "../src/modules/tpz-access/tpz-access.catalog.js";

const WHO = String(process.argv[2] ?? "").trim();
const COMPANY = String(process.argv[3] ?? "bellavita").trim();
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as RowDataPacket[];

(async () => {
  if (!WHO) throw new Error("usage: process-scope-diagnose.ts <name or email> [company]");
  const company = tpzCompany(COMPANY);
  console.log(`company ${COMPANY}: process codes ${JSON.stringify(company?.processCodes ?? null)}`);
  if (company?.processCodes.length) {
    const ph = company.processCodes.map(() => "?").join(",");
    console.log("== company processes ==");
    console.table(await q(
      `SELECT p.process_code, p.process_name, p.active_status, b.branch_name
         FROM process_master p LEFT JOIN branch_master b ON b.id = p.branch_id
        WHERE p.process_code IN (${ph})`, company.processCodes));
  }

  const users = await q(
    `SELECT DISTINCT u.id, u.email, e.employee_code, e.full_name, e.active_status,
            b.branch_name, p.process_code, p.process_name
       FROM auth_user u
       LEFT JOIN employees e ON e.user_id = u.id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE u.email = ? OR e.full_name LIKE ?
      LIMIT 5`, [WHO, `%${WHO}%`]);
  for (const u of users) {
    console.log(`\n== ${u.full_name} ${u.employee_code} <${u.email}> branch=${u.branch_name} process=${u.process_code} active=${u.active_status}`);
    const roles = (await q(`SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`, [u.id])).map((r) => String(r.role_key));
    console.log("roles:", roles.join(", ") || "(none)");
    console.log("assignment scope rows:");
    console.table(await q(`SELECT * FROM user_assignment_scope WHERE user_id = ?`, [u.id]).catch((e) => [{ err: (e as Error).message }]));
    const scope = await resolveProcessScope(String(u.id));
    console.log("process scope:", scope.orgWide ? "ORG-WIDE" : `${scope.processCodes.size} processes`,
      scope.orgWide ? "" : JSON.stringify([...scope.processCodes].slice(0, 40)));
    console.log(`role-based scope allows ${COMPANY}:`, tpzCompanyAllowed(scope, COMPANY));
    const access = await getTpzAccess(String(u.id), roles);
    console.log("tpz access: roleFullView =", access.roleFullView,
      `| grant dashboards ${COMPANY} =`, canTpz(access, COMPANY, "dashboards"));
    console.log("tpz grants:", JSON.stringify(access.companies?.[COMPANY] ?? null));
  }
  if (!users.length) console.log("no user matched");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
