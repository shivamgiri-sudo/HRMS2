/**
 * Redispatch_Dead_Kits — one-off recovery for employees whose joining kit's
 * Luckpay session has already reached a terminal state (failed/expired), with
 * no path back: resendKitEsignLink and the automated reminder both correctly
 * refuse to touch these (see kitEsignSessionIsAlive in
 * joiningKitDispatch.service.ts) since minting another internal link to a
 * dead provider session would just be a second useless email.
 *
 * Investigated live 2026-09-06: 20 employees are stuck this way — their kit
 * sits at status='sent' (never signed, never marked dead itself), while the
 * Luckpay transaction behind it independently reads status='FAILED'. 5 of
 * these had already been sent a (silently useless) resend the day before this
 * gap was found and fixed.
 *
 * This is the one path that deliberately re-bills the provider:
 * redispatchDeadEsignKit -> redispatchDeadKit abandons the dead kit (clears
 * open_marker so a real new one can be queued) and runs the full
 * queue+dispatch path a brand-new employee takes — a fresh, separately billed
 * Luckpay session and a newly assembled document package the employee has to
 * open and sign again from scratch.
 *
 * Must run on the production host: Luckpay whitelists only the deploy host's
 * egress IP, and the credentials to call it live only in that host's .env.
 *
 *   # on the server, from /var/www/HRMS2/backend
 *   npm run redispatch:dead-esign-kits -- --actor-user-id <ID>              # list only, dispatches nothing
 *   npm run redispatch:dead-esign-kits -- --actor-user-id <ID> --confirm     # actually redispatches, bills the provider
 *   npm run redispatch:dead-esign-kits -- --actor-user-id <ID> --employee-id <ID> --confirm
 *
 * List-only by default (no --confirm): enumerates the eligible employees
 * without calling redispatchDeadEsignKit at all, so nothing is abandoned,
 * queued or billed. --actor-user-id is mandatory, matching every other bulk
 * script in this directory: the operator behind a bulk remediation is
 * stated, not inferred.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";

type RedispatchReportEntry = {
  employee_id: string;
  employee_code: string;
  status: string;
  message: string;
};

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(entries: RedispatchReportEntry[]): string {
  const columns: (keyof RedispatchReportEntry)[] = ["employee_id", "employee_code", "status", "message"];
  return (
    [
      columns.join(","),
      ...entries.map((e) => columns.map((c) => csvField(String(e[c] ?? ""))).join(",")),
    ].join("\n") + "\n"
  );
}

function parseArgs(argv: string[]): {
  actorUserId: string | null;
  employeeId: string | null;
  reportPath: string | null;
  confirm: boolean;
} {
  let actorUserId: string | null = null;
  let employeeId: string | null = null;
  let reportPath: string | null = null;
  let confirm = false;

  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--actor-user-id":
        actorUserId = argv[++i] ?? null;
        break;
      case "--employee-id":
        employeeId = argv[++i] ?? null;
        break;
      case "--report":
        reportPath = argv[++i] ?? null;
        break;
      case "--confirm":
        confirm = true;
        break;
      default:
        break;
    }
  }
  return { actorUserId, employeeId, reportPath, confirm };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.actorUserId?.trim()) {
    console.error(
      "Refusing to run without --actor-user-id.\n" +
        "  npm run redispatch:dead-esign-kits -- --actor-user-id <ID> [--employee-id <ID>] [--report <path.csv>] [--confirm]",
    );
    process.exit(1);
    return;
  }

  const { db } = await import("../src/db/mysql.js");
  const { redispatchDeadKit } = await import("../src/modules/employees/joiningKitDispatch.service.js");

  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT k.employee_id, e.employee_code
         FROM employee_joining_esign_kit k
         JOIN employee_document_esign_transaction t ON t.kit_id = k.id
         JOIN employees e ON e.id = k.employee_id
        WHERE k.status = 'sent' AND k.signed_file_id IS NULL
          AND t.status IN ('failed','expired','cancelled','abandoned_unresolved')
          ${args.employeeId ? "AND k.employee_id = ?" : ""}`,
      args.employeeId ? [args.employeeId] : [],
    );
    const targets = (rows as RowDataPacket[]).map((r) => ({
      employeeId: String(r.employee_id),
      employeeCode: String(r.employee_code),
    }));

    console.log(args.confirm ? "MODE: CONFIRMED (will redispatch — bills the provider)" : "MODE: LIST ONLY (nothing will be dispatched)");
    console.log(`Actor: ${args.actorUserId}`);
    console.log(`Eligible employees: ${targets.length}`);

    if (!args.confirm) {
      targets.forEach((t) => console.log(`  ${t.employeeCode}  ${t.employeeId}`));
      console.log("\nLIST ONLY — nothing was dispatched. Re-run with --confirm to actually redispatch.");
      return;
    }

    const entries: RedispatchReportEntry[] = [];
    let sent = 0;
    let failed = 0;
    for (const target of targets) {
      try {
        const result = await redispatchDeadKit(target.employeeId, args.actorUserId.trim());
        if (result.status === "sent") sent++; else failed++;
        entries.push({
          employee_id: target.employeeId,
          employee_code: target.employeeCode,
          status: result.status,
          message: result.message,
        });
      } catch (e) {
        failed++;
        entries.push({
          employee_id: target.employeeId,
          employee_code: target.employeeCode,
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    console.log(`\nDone: ${sent} redispatched, ${failed} not sent, out of ${targets.length}.\n`);
    entries.forEach((e) => console.log(`  ${e.status === "sent" ? "SENT " : "SKIP "} ${e.employee_code}  ${e.message}`));

    if (args.reportPath) {
      const resolved = path.resolve(args.reportPath);
      mkdirSync(path.dirname(resolved), { recursive: true });
      writeFileSync(resolved, toCsv(entries));
      console.log(`\nCSV written: ${resolved}`);
    }

    if (failed > 0) process.exitCode = 1;
  } finally {
    await db.end().catch(() => undefined);
  }
}

if (process.argv[1] && /redispatch-dead-esign-kits\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
