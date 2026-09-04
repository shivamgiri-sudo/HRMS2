/**
 * Resend_Stuck_Kit_Links — one-off resend of the joining-kit signing link for
 * every candidate whose eSign has sat at Luckpay's own "INITIATED, 0 pages
 * opened" state, because the kit dispatch only ever emails the link once.
 *
 * Investigated live 2026-09-04: 24 kit-scoped transactions were stuck this way,
 * every one of them still emailed successfully at dispatch time — the gap was
 * never a delivery failure, it was a candidate population that does not
 * reliably open a personal inbox and a flow with no second channel and no
 * second attempt. This script is that second attempt, run in bulk rather than
 * one Payroll HR click at a time (the same underlying function backs both: see
 * resendEsignLink in joining-control-room.service.ts).
 *
 * Must run on the production host: emailService's SMTP path and the whole
 * point of this remediation both depend on the network path this box has and
 * a local dev machine does not.
 *
 *   # on the server, from /var/www/HRMS2/backend
 *   npm run resend:stuck-esign-links -- --actor-user-id <ID>              # list only, sends nothing
 *   npm run resend:stuck-esign-links -- --actor-user-id <ID> --confirm     # actually sends
 *   npm run resend:stuck-esign-links -- --actor-user-id <ID> --candidate-id <ID> --confirm
 *
 * List-only by default (no --confirm): enumerates the eligible candidates
 * without calling resendEsignLink at all, so nothing is minted or emailed.
 * There is no cheaper "ask the provider" dry run to offer here the way the
 * eSign backfill script has — a resend either mints a token and sends an
 * email, or it does neither.
 *
 * --actor-user-id is mandatory, matching backfill-stranded-joining-kits.ts:
 * the operator behind a bulk remediation is stated, not inferred.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";

type ResendReportEntry = {
  candidate_id: string;
  resent: boolean;
  message: string;
  emailed_to: string;
};

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(entries: ResendReportEntry[]): string {
  const columns: (keyof ResendReportEntry)[] = ["candidate_id", "resent", "message", "emailed_to"];
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
        "  npm run resend:stuck-esign-links -- --actor-user-id <ID> [--candidate-id <ID>] [--report <path.csv>] [--confirm]",
    );
    process.exit(1);
    return;
  }

  const { db } = await import("../src/db/mysql.js");
  const { resendEsignLink } = await import("../src/modules/ats/joining-control-room.service.js");

  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      args.candidateId
        ? `SELECT DISTINCT candidate_id FROM employee_document_esign_transaction
            WHERE status = 'pending' AND scope = 'kit' AND candidate_id = ?`
        : `SELECT DISTINCT candidate_id FROM employee_document_esign_transaction
            WHERE status = 'pending' AND scope = 'kit' AND candidate_id IS NOT NULL`,
      args.candidateId ? [args.candidateId] : [],
    );
    const candidateIds = (rows as RowDataPacket[]).map((r) => String(r.candidate_id));

    console.log(args.confirm ? "MODE: CONFIRMED (will send)" : "MODE: LIST ONLY (nothing will be sent)");
    console.log(`Actor: ${args.actorUserId}`);
    console.log(`Eligible candidates: ${candidateIds.length}`);

    if (!args.confirm) {
      candidateIds.forEach((id) => console.log(`  ${id}`));
      console.log("\nLIST ONLY — nothing was sent. Re-run with --confirm to actually resend.");
      return;
    }

    const entries: ResendReportEntry[] = [];
    let resent = 0;
    let failed = 0;
    for (const candidateId of candidateIds) {
      try {
        const result = await resendEsignLink(candidateId, args.actorUserId.trim());
        if (result.resent) resent++; else failed++;
        entries.push({
          candidate_id: candidateId,
          resent: result.resent,
          message: result.message,
          emailed_to: (result.emailedTo ?? []).join(";"),
        });
      } catch (e) {
        failed++;
        entries.push({
          candidate_id: candidateId,
          resent: false,
          message: e instanceof Error ? e.message : String(e),
          emailed_to: "",
        });
      }
    }

    console.log(`\nDone: ${resent} sent, ${failed} not sent, out of ${candidateIds.length}.\n`);
    entries.forEach((e) => console.log(`  ${e.resent ? "SENT " : "SKIP "} ${e.candidate_id}  ${e.message}`));

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

if (process.argv[1] && /resend-stuck-esign-links\.(ts|js)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
