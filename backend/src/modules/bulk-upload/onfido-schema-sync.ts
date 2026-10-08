import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import { ONFIDO_REPORT_CONFIGS, type OnfidoFieldExtract } from "./onfido-report-configs.js";

/** SQL column type for an extracted field. Shared with scripts/setup-onfido-reports.ts
 *  so a table created there and a column added here can never disagree. */
export function onfidoSqlTypeFor(extract: OnfidoFieldExtract): string {
  switch (extract.type) {
    case "date": return "DATE NULL";
    case "int": return "INT NULL";
    case "float": return "DECIMAL(8,2) NULL";
    case "ratio": return "DECIMAL(10,6) NULL";
    case "bool_yes_no": return "TINYINT(1) NULL";
    default:
      // URL/UUID-shaped dedup columns run long; everything else is a short label.
      return /url|uuid/i.test(extract.column) ? "VARCHAR(512) NULL" : "VARCHAR(255) NULL";
  }
}

const inflight = new Map<string, Promise<string[]>>();
const settled = new Set<string>();

async function syncColumns(table: string): Promise<string[]> {
  const cfg = ONFIDO_REPORT_CONFIGS.find((c) => c.table === table);
  if (!cfg) return [];

  const pool = await getOnfidoPool();
  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table]
  );
  // Table not created yet — setup-onfido-reports.ts owns CREATE TABLE; nothing to alter.
  if (existing.length === 0) return [];

  const have = new Set(existing.map((r) => String(r.COLUMN_NAME).toLowerCase()));
  const added: string[] = [];
  for (const extract of cfg.extract) {
    if (extract.column === cfg.dedupColumn || have.has(extract.column.toLowerCase())) continue;
    try {
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${extract.column}\` ${onfidoSqlTypeFor(extract)}`);
      added.push(extract.column);
    } catch (err: unknown) {
      // Another request added it between the check and the ALTER — that is the goal state.
      if ((err as { errno?: number }).errno !== 1060) throw err;
    }
  }
  return added;
}

/**
 * Adds any column the config extracts but the live table lacks. setup-onfido-reports.ts
 * uses CREATE TABLE IF NOT EXISTS, so a column added to a config afterwards (GD MCN's
 * "Doc AHT" / "POA AHT") never reached a table that already existed, and every insert
 * then failed with "Unknown column". Additive only — never drops or alters an existing
 * column — and once per table per process.
 */
export async function ensureOnfidoTableColumns(table: string): Promise<string[]> {
  if (settled.has(table)) return [];
  let pending = inflight.get(table);
  if (!pending) {
    pending = syncColumns(table)
      .then((added) => { settled.add(table); return added; })
      .finally(() => inflight.delete(table));
    inflight.set(table, pending);
  }
  return pending;
}
