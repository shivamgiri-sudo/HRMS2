import { randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { hrmsRaisedGrnSql } from "../../shared/ownCompanyCostCentre.js";
import {
  buildGrnVoucher,
  DEFAULT_LEDGER_NAMES,
  wrapTallyEnvelope,
  type GrnTallyLedgerNames,
} from "./grn-tally-voucher.js";
import {
  GRN_TALLY_COLUMNS,
  loadGrnTallyContext,
  toVoucherInput,
} from "./grn-tally-context.js";

/**
 * Daily export of fully approved GRNs to a folder the Tally connector reads.
 *
 * "Fully approved" means the last approval step has happened: a vendor GRN at Finance Head approval
 * or later, an imprest GRN at 'approved' or later. GRNs imported from the legacy billing system
 * (bill_source_id set, or created by the migration's sentinel user) are left out, because the old
 * system already booked them. Nothing before
 * GRN_TALLY_EXPORT_FROM is exported, so switching this on never sends history.
 *
 * No duplicates: each GRN is reserved in grn_tally_export (primary key = the GRN) in the same
 * transaction that records the batch, and the file only becomes visible to the connector (its
 * .tmp name is renamed to .xml) after that transaction has committed. A crash in between leaves a
 * 'claimed' batch that the next run either completes (the .tmp file is there) or releases (it is not).
 */

export { hrmsRaisedGrnSql };

type Executor = { execute(sql: string, params?: any[]): Promise<[any, any]> };

const VENDOR_FINAL = [
  "finance_head_approved",
  "pending_accounts_payment",
  "partially_paid",
  "paid",
] as const;
const IMPREST_FINAL = ["approved", "paid"] as const;
const BATCH_LIMIT = 500;

export type GrnTallyConfig = {
  dir: string | null;
  from: string | null;
  company: string | null;
  names: GrnTallyLedgerNames;
};

export function readGrnTallyConfig(
  env: NodeJS.ProcessEnv = process.env,
): GrnTallyConfig {
  const from = env.GRN_TALLY_EXPORT_FROM?.trim() || null;
  return {
    dir: env.GRN_TALLY_EXPORT_DIR?.trim() || null,
    from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
    company: env.GRN_TALLY_COMPANY?.trim() || null,
    names: readLedgerNames(env),
  };
}

/**
 * Ledger names default to the MAS Callnet Tally company's own (see DEFAULT_LEDGER_NAMES); each can be
 * overridden by env, the TDS map as JSON ({"194C":"TDS CONTRACTOR 2021-22", ...}, merged over the default).
 */
function readLedgerNames(env: NodeJS.ProcessEnv): GrnTallyLedgerNames {
  const pick = (key: string, fallback: string) => env[key]?.trim() || fallback;
  let tdsLedgers = DEFAULT_LEDGER_NAMES.tdsLedgers;
  try {
    const parsed = JSON.parse(env.GRN_TALLY_TDS_LEDGERS ?? "{}");
    if (parsed && typeof parsed === "object") tdsLedgers = { ...tdsLedgers, ...parsed };
  } catch {
    /* keep the defaults when the override is malformed */
  }
  return {
    voucherType: pick("GRN_TALLY_VOUCHER_TYPE", DEFAULT_LEDGER_NAMES.voucherType),
    roundOff: pick("GRN_TALLY_ROUND_OFF_LEDGER", DEFAULT_LEDGER_NAMES.roundOff),
    inputCgst: pick("GRN_TALLY_INPUT_CGST", DEFAULT_LEDGER_NAMES.inputCgst),
    inputSgst: pick("GRN_TALLY_INPUT_SGST", DEFAULT_LEDGER_NAMES.inputSgst),
    inputIgst: pick("GRN_TALLY_INPUT_IGST", DEFAULT_LEDGER_NAMES.inputIgst),
    imprestLedgerPattern: pick("GRN_TALLY_IMPREST_LEDGER", DEFAULT_LEDGER_NAMES.imprestLedgerPattern),
    tdsLedgers,
  };
}

export function missingConfig(config: GrnTallyConfig): string[] {
  const missing: string[] = [];
  if (!config.dir)
    missing.push("GRN_TALLY_EXPORT_DIR (the folder the Tally connector reads)");
  if (!config.from)
    missing.push(
      "GRN_TALLY_EXPORT_FROM (first approval date to export, YYYY-MM-DD)",
    );
  return missing;
}

export type ExportException = {
  grnId: string;
  grnNumber: string;
  reason: string;
};

export type GrnTallyRunResult =
  | { status: "not_configured"; missing: string[] }
  | { status: "nothing_to_export"; exceptions: ExportException[] }
  | {
      status: "written";
      batchId: string;
      fileName: string;
      vouchers: number;
      totalAmount: number;
      exceptions: ExportException[];
    };

const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function selectCandidates(
  executor: Executor,
  from: string,
): Promise<RowDataPacket[]> {
  const vendorIn = VENDOR_FINAL.map(() => "?").join(",");
  const imprestIn = IMPREST_FINAL.map(() => "?").join(",");
  const [rows] = (await executor.execute(
    `SELECT ${GRN_TALLY_COLUMNS}, COALESCE(g.approved_at, g.updated_at) AS approved_on
       FROM grn_request g
      WHERE ${hrmsRaisedGrnSql("g")}
        AND g.grn_number IS NOT NULL AND TRIM(g.grn_number) <> ''
        AND ((g.grn_type = 'vendor' AND g.status IN (${vendorIn})) OR (g.grn_type = 'imprest' AND g.status IN (${imprestIn})))
        AND COALESCE(g.approved_at, g.updated_at) >= ?
      ORDER BY approved_on ASC
      LIMIT ${BATCH_LIMIT * 4}`,
    [...VENDOR_FINAL, ...IMPREST_FINAL, `${from} 00:00:00`],
  )) as [RowDataPacket[], unknown];
  return rows;
}

async function alreadyExported(
  executor: Executor,
  ids: string[],
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const [rows] = (await executor.execute(
    `SELECT grn_request_id FROM grn_tally_export WHERE grn_request_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  )) as [RowDataPacket[], unknown];
  return new Set(rows.map((r) => String(r.grn_request_id)));
}

/** Completes or releases batches a crash left half-done. */
export async function recoverClaimedBatches(dir: string): Promise<void> {
  const [batches] = (await db.execute(
    `SELECT id, file_name FROM grn_tally_export_batch WHERE status = 'claimed' AND created_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE)`,
  )) as [RowDataPacket[], unknown];
  for (const b of batches) {
    const finalPath = path.join(dir, String(b.file_name));
    const tmpPath = `${finalPath}.tmp`;
    if (existsSync(tmpPath)) {
      renameSync(tmpPath, finalPath);
      await db.execute(
        `UPDATE grn_tally_export_batch SET status = 'written', written_at = NOW() WHERE id = ?`,
        [b.id],
      );
    } else if (existsSync(finalPath)) {
      await db.execute(
        `UPDATE grn_tally_export_batch SET status = 'written', written_at = COALESCE(written_at, NOW()) WHERE id = ?`,
        [b.id],
      );
    } else {
      // No file anywhere: release the GRNs so the next run exports them.
      await db.execute(`DELETE FROM grn_tally_export WHERE batch_id = ?`, [
        b.id,
      ]);
      await db.execute(
        `UPDATE grn_tally_export_batch SET status = 'failed', error_message = 'File was never written; GRNs released' WHERE id = ?`,
        [b.id],
      );
    }
  }
}

export async function runGrnTallyExport(opts: {
  trigger: "worker" | "manual";
  actorUserId?: string | null;
  dryRun?: boolean;
}): Promise<
  | GrnTallyRunResult
  | { status: "dry_run"; wouldExport: number; exceptions: ExportException[] }
> {
  const config = readGrnTallyConfig();
  const missing = missingConfig(config);
  if (missing.length || !config.dir || !config.from)
    return { status: "not_configured", missing };

  if (!opts.dryRun) {
    mkdirSync(config.dir, { recursive: true });
    await recoverClaimedBatches(config.dir);
  }

  const candidates = await selectCandidates(db, config.from);
  const done = await alreadyExported(
    db,
    candidates.map((c) => String(c.id)),
  );
  const fresh = candidates
    .filter((c) => !done.has(String(c.id)))
    .slice(0, BATCH_LIMIT);
  if (!fresh.length)
    return opts.dryRun
      ? { status: "dry_run", wouldExport: 0, exceptions: [] }
      : { status: "nothing_to_export", exceptions: [] };

  const context = await loadGrnTallyContext(db, fresh);

  const built: { id: string; grnNumber: string; xml: string; gross: number }[] =
    [];
  const exceptions: ExportException[] = [];
  for (const row of fresh) {
    const v = buildGrnVoucher(
      toVoucherInput(row, context, config.names),
      config.names,
    );
    if (v.ok)
      built.push({
        id: v.grnId,
        grnNumber: String(row.grn_number),
        xml: v.xml,
        gross: v.gross,
      });
    else
      exceptions.push({
        grnId: v.grnId,
        grnNumber: v.grnNumber,
        reason: v.reason,
      });
  }
  if (opts.dryRun)
    return { status: "dry_run", wouldExport: built.length, exceptions };
  if (!built.length) return { status: "nothing_to_export", exceptions };

  const batchId = randomUUID();
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const fileName = `GRN_Tally_${stamp}_${batchId.slice(0, 8)}.xml`;
  const finalPath = path.join(config.dir, fileName);
  const tmpPath = `${finalPath}.tmp`;
  const total = r2(built.reduce((s, b) => s + b.gross, 0));

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO grn_tally_export_batch (id, file_name, target_dir, voucher_count, total_amount, exception_count, status, trigger_source, created_by)
       VALUES (?,?,?,?,?,?, 'claimed', ?, ?)`,
      [
        batchId,
        fileName,
        config.dir,
        built.length,
        total,
        exceptions.length,
        opts.trigger,
        opts.actorUserId ?? null,
      ],
    );
    for (const b of built) {
      // The primary key is the guard: a GRN another run already reserved makes this throw and rolls everything back.
      await connection.execute(
        `INSERT INTO grn_tally_export (grn_request_id, grn_number, batch_id, amount) VALUES (?,?,?,?)`,
        [b.id, b.grnNumber, batchId, b.gross],
      );
    }
    writeFileSync(
      tmpPath,
      wrapTallyEnvelope(
        built.map((b) => b.xml),
        config.company,
      ),
      "utf8",
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      /* the failure being reported is the original one */
    }
    throw error;
  } finally {
    connection.release();
  }

  renameSync(tmpPath, finalPath);
  await db.execute(
    `UPDATE grn_tally_export_batch SET status = 'written', written_at = NOW() WHERE id = ?`,
    [batchId],
  );
  return {
    status: "written",
    batchId,
    fileName,
    vouchers: built.length,
    totalAmount: total,
    exceptions,
  };
}
