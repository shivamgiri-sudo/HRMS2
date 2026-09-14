/**
 * Request_Bank_Resubmit — one-off email to every candidate/employee whose
 * verified bank account number was lost to two now-fixed write bugs (a
 * missing SET-list column, and a resave that wiped the number to NULL).
 *
 * Investigated live 2026-09-07: 31 rows, all dated before the 2026-09-03 fix,
 * none since — the fix holds, but the encrypted value for these 31 was
 * genuinely lost (only a hash and last-4 survive in the audit trail, neither
 * reversible), so the only real recovery is the person re-typing it. 19 of
 * the 31 are already employees.
 *
 * Sends sendBankResubmitRequest's own targeted email (not the generic
 * "complete your onboarding" one — most of these people finished onboarding
 * weeks or months ago) with a freshly-minted 15-day token. The frontend's
 * Step6Bank already shows "Bank details previously saved ... Re-enter
 * account number to update" whenever bank_name is present and account_no is
 * not — exactly this population's state — so no other change was needed for
 * the portal to prompt correctly.
 *
 * Must run on the production host: SMTP credentials live only in that host's
 * .env, same reason as every other email-sending script in this directory.
 *
 *   # on the server, from /var/www/HRMS2/backend
 *   npm run request:bank-resubmit -- --actor-user-id <ID>              # list only, sends nothing
 *   npm run request:bank-resubmit -- --actor-user-id <ID> --confirm     # actually sends
 *   npm run request:bank-resubmit -- --actor-user-id <ID> --candidate-id <ID> --confirm
 *
 * List-only by default (no --confirm). --actor-user-id is mandatory, same
 * rule as every bulk script in this directory.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";

type ReportEntry = {
  candidate_id: string;
  name: string;
  email_sent: boolean;
  sent_to: string;
  message: string;
};

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(entries: ReportEntry[]): string {
  const columns: (keyof ReportEntry)[] = ["candidate_id", "name", "email_sent", "sent_to", "message"];
  return (
    [
      columns.join(","),
      ...entries.map((e) => columns.map((c) => csvField(String(e[c] ?? ""))).join(",")),
    ].join("\n") + "\n"
  );
}

function parseArgs(argv: string[]): {
  actorUserId: string | null;
  candidateId: string | null;
  reportPath: string | null;
  confirm: boolean;
} {
  let actorUserId: string | null = null;
  let candidateId: string | null = null;
  let reportPath: string | null = null;
  let confirm = false;

  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--actor-user-id":
        actorUserId = argv[++i] ?? null;
        break;
      case "--candidate-id":
        candidateId = argv[++i] ?? null;
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
  return { actorUserId, candidateId, reportPath, confirm };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.actorUserId?.trim()) {
    console.error(
      "Refusing to run without --actor-user-id.\n" +
        "  npm run request:bank-resubmit -- --actor-user-id <ID> [--candidate-id <ID>] [--report <path.csv>] [--confirm]",
    );
    process.exit(1);
    return;
  }

  const { db } = await import("../src/db/mysql.js");
  const { sendBankResubmitRequest } = await import("../src/modules/ats/ats.onboarding.service.js");

  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      args.candidateId
        ? `SELECT c.id, c.full_name FROM candidate_onboarding_bank_detail b
             JOIN ats_candidate c ON c.id = b.candidate_id
            WHERE b.verification_status='verified' AND b.account_no_encrypted IS NULL AND c.id = ?`
        : `SELECT c.id, c.full_name FROM candidate_onboarding_bank_detail b
             JOIN ats_candidate c ON c.id = b.candidate_id
            WHERE b.verification_status='verified' AND b.account_no_encrypted IS NULL`,
      args.candidateId ? [args.candidateId] : [],
    );
    const targets = (rows as RowDataPacket[]).map((r) => ({ id: String(r.id), name: String(r.full_name ?? "") }));

    console.log(args.confirm ? "MODE: CONFIRMED (will send)" : "MODE: LIST ONLY (nothing will be sent)");
    console.log(`Actor: ${args.actorUserId}`);
    console.log(`Eligible: ${targets.length}`);

    if (!args.confirm) {
      targets.forEach((t) => console.log(`  ${t.name}  ${t.id}`));
      console.log("\nLIST ONLY — nothing was sent. Re-run with --confirm to actually send.");
      return;
    }

    const entries: ReportEntry[] = [];
    let sent = 0;
    let failed = 0;
    for (const target of targets) {
      try {
        const result = await sendBankResubmitRequest(target.id, args.actorUserId.trim());
        if (result.emailSent) sent++; else failed++;
        entries.push({
          candidate_id: target.id,
          name: target.name,
          email_sent: result.emailSent,
          sent_to: result.sentTo ?? "",
          message: result.emailError ?? "ok",
        });
      } catch (e) {
        failed++;
        entries.push({
          candidate_id: target.id,
          name: target.name,
          email_sent: false,
          sent_to: "",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    console.log(`\nDone: ${sent} sent, ${failed} not sent, out of ${targets.length}.\n`);
    entries.forEach((e) => console.log(`  ${e.email_sent ? "SENT " : "SKIP "} ${e.name}  ${e.message}`));

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

if (process.argv[1] && /request-bank-resubmit\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
