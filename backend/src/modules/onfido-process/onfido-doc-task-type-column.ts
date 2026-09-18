import type { NextFunction, Request, Response } from "express";
import { getOnfidoPool } from "../../db/onfidoDb.js";

/**
 * The dashboard's DOC average-AHT queries read onfido_doc_raw.doc_task_type_old, a VIRTUAL generated
 * column over raw_data."Task Information Task Type Old" (see scripts/onfido-add-doc-task-type-index.ts,
 * which also builds the covering index). Production already has both; this guard only adds the
 * column — an INSTANT, non-locking change — on a database that lacks it (a fresh dev copy), so the
 * queries never fail with "Unknown column". The heavy index is deliberately NOT built here.
 */
let ready: Promise<void> | null = null;

async function ensureColumn(): Promise<void> {
  const pool = await getOnfidoPool();
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'onfido_doc_raw' AND column_name = 'doc_task_type_old'`
  );
  if ((rows as unknown[]).length > 0) return;
  try {
    await pool.query(
      `ALTER TABLE onfido_doc_raw ADD COLUMN doc_task_type_old VARCHAR(100)
         GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."Task Information Task Type Old"'))) VIRTUAL,
         ALGORITHM = INSTANT`
    );
  } catch (err) {
    // Another process may have added it between the check and the ALTER (errno 1060).
    if ((err as { errno?: number }).errno !== 1060) throw err;
  }
}

export function ensureDocTaskTypeColumn(_req: Request, _res: Response, next: NextFunction): void {
  ready ??= ensureColumn().catch((err) => { ready = null; throw err; });
  ready.then(() => next(), next);
}
