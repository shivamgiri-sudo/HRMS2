/**
 * Inbox reconciliation runner.
 *
 *   npm run inbox:reconcile           # dry run — counts only, writes nothing
 *   npm run inbox:reconcile -- --apply
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { runInboxReconciliation, INBOX_RESOLUTION_RULES } from "../src/modules/inbox/inbox-reconciliation.js";
import { db } from "../src/db/mysql.js";

const apply = process.argv.includes("--apply");

/**
 * Capture every row an apply run is about to close, and emit the SQL that
 * would put it back. All candidate rows are is_actioned = 0 by definition, so
 * is_read is the only other field the close overwrites.
 */
async function backupAffectedRows(stamp: string): Promise<number> {
  const rows: Array<{ id: string; is_read: number; type: string }> = [];
  for (const rule of INBOX_RESOLUTION_RULES) {
    const [found] = await db.execute<any[]>(
      `SELECT id, is_read, type FROM work_inbox_item w WHERE ${rule.where}`,
    );
    rows.push(...(found as Array<{ id: string; is_read: number; type: string }>));
  }

  const dir = "./.deploy-backups";
  mkdirSync(dir, { recursive: true });
  const jsonPath = `${dir}/work_inbox_item-close-${stamp}.json`;
  const sqlPath = `${dir}/work_inbox_item-rollback-${stamp}.sql`;

  writeFileSync(jsonPath, JSON.stringify(rows, null, 1));

  const byRead = { 0: [] as string[], 1: [] as string[] };
  for (const r of rows) byRead[Number(r.is_read) === 1 ? 1 : 0].push(r.id);
  const stmts = [
    `-- Reverses the inbox reconciliation applied at ${stamp}.`,
    `-- Restores ${rows.length} rows to is_actioned = 0 with their original is_read.`,
  ];
  for (const readFlag of [0, 1] as const) {
    const ids = byRead[readFlag];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500).map((id) => `'${id}'`).join(",");
      stmts.push(
        `UPDATE work_inbox_item SET is_actioned = 0, is_read = ${readFlag} WHERE id IN (${chunk});`,
      );
    }
  }
  writeFileSync(sqlPath, stmts.join("\n") + "\n");

  console.log(`Backup written:\n  ${jsonPath}\n  ${sqlPath}`);
  return rows.length;
}

async function main(): Promise<void> {
  const [before] = await db.execute<any[]>(
    "SELECT COUNT(*) AS open_items FROM work_inbox_item WHERE is_actioned = 0",
  );
  console.log(`Open alerts before: ${before[0].open_items}`);
  console.log(apply ? "\nMODE: APPLY (writes)\n" : "\nMODE: DRY RUN (no writes)\n");

  if (apply) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backed = await backupAffectedRows(stamp);
    console.log(`Captured ${backed} row(s) before closing.\n`);
  }

  const result = await runInboxReconciliation({ dryRun: !apply });

  for (const rule of INBOX_RESOLUTION_RULES) {
    const n = result.byRule[rule.key] ?? 0;
    console.log(`  ${String(n).padStart(6)}  ${rule.key.padEnd(30)} — resolved when ${rule.resolvedWhen}`);
  }
  console.log(`\n  ${String(result.total).padStart(6)}  TOTAL`);

  const [after] = await db.execute<any[]>(
    "SELECT COUNT(*) AS open_items FROM work_inbox_item WHERE is_actioned = 0",
  );
  console.log(`\nOpen alerts after:  ${after[0].open_items}`);
  await (db as any).end?.();
}

main().catch((e) => { console.error(e); process.exit(1); });
