/**
 * Tally voucher export service: plan -> preview -> persist batch -> render XML -> mark exported.
 *
 * The XML is NOT stored. Each batch line freezes the voucher MODEL (what was staged), and the XML
 * is rendered from it at download time with the Create/Alter action decided against
 * tally_voucher_export at that moment. That is what keeps re-export safe: two batches staged
 * before either was downloaded can never both say Create for the same document.
 */

import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { logSensitiveAction } from "../../../shared/auditLog.js";
import { isValidGstin } from "../gst-export.service.js";
import { ourGstinSql } from "../invoice-party.js";
import { hasBlockingError } from "./tally-voucher-check.js";
import {
  getVoucherKind,
  listVoucherKinds,
  type BuiltVoucher,
  type Queryable,
} from "./tally-voucher-kinds.js";
import {
  buildVouchersXml,
  totalsByDrCr,
  voucherContentHash,
} from "./tally-voucher-xml.js";
import {
  CONFIG_KEY_BY_FIELD,
  DEFAULT_LEDGER_CONFIG,
  type TallyAction,
  type TallyException,
  type TallyLedgerConfig,
  type TallyVoucherKind,
  type TallyVoucherModel,
} from "./tally-voucher.types.js";

export const COMPANY_NAME_KEY = "tally_company_name";

export class TallyVoucherError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export type ExportStatus =
  "not_exported" | "exported_unchanged" | "changed_since_export";

export interface PlannedVoucher {
  model: TallyVoucherModel;
  errors: TallyException[];
  blocked: boolean;
  contentHash: string;
  action: TallyAction;
  exportStatus: ExportStatus;
  lastExportedAt: string | null;
  exportCount: number;
}

interface TrackingRow {
  guid: string;
  contentHash: string;
  lastExportedAt: string;
  exportCount: number;
}

const trackKey = (sourceType: string, sourceId: string) =>
  `${sourceType}:${sourceId}`;

function validatePlanInput(input: {
  companyGstin: string;
  periodMonth: string;
  voucherKinds: string[];
}): { companyGstin: string; periodMonth: string; kinds: TallyVoucherKind[] } {
  const companyGstin = String(input.companyGstin ?? "")
    .trim()
    .toUpperCase();
  const periodMonth = String(input.periodMonth ?? "").trim();
  if (!isValidGstin(companyGstin))
    throw new TallyVoucherError(
      `companyGstin ${companyGstin || "(blank)"} is not a valid GSTIN.`,
    );
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodMonth))
    throw new TallyVoucherError("periodMonth must be YYYY-MM");
  const requested = [...new Set(input.voucherKinds ?? [])];
  if (requested.length === 0)
    throw new TallyVoucherError("Choose at least one voucher type.");
  const kinds: TallyVoucherKind[] = [];
  for (const k of requested) {
    const mod = getVoucherKind(k);
    if (!mod)
      throw new TallyVoucherError(
        `Unknown voucher type "${k}". Available: ${listVoucherKinds()
          .map((m) => m.kind)
          .join(", ")}`,
      );
    kinds.push(mod.kind);
  }
  return { companyGstin, periodMonth, kinds };
}

async function loadConfigRows(
  q: Queryable,
  companyGstin: string,
): Promise<Map<string, { value: string; scope: string }>> {
  const out = new Map<string, { value: string; scope: string }>();
  let rows: RowDataPacket[] = [];
  try {
    [rows] = await q.execute<RowDataPacket[]>(
      `SELECT config_scope, config_key, config_value FROM tally_export_config
        WHERE config_scope IN ('*', ?) ORDER BY config_scope = '*' DESC`,
      [companyGstin],
    );
  } catch {
    // Table absent (migration not applied yet): defaults below keep preview usable.
    return out;
  }
  // '*' first, so a GSTIN-scoped row overwrites it.
  for (const r of rows)
    out.set(String(r.config_key), {
      value: String(r.config_value),
      scope: String(r.config_scope),
    });
  return out;
}

export async function loadLedgerConfig(
  q: Queryable,
  companyGstin: string,
): Promise<TallyLedgerConfig> {
  const rows = await loadConfigRows(q, companyGstin);
  const cfg = { ...DEFAULT_LEDGER_CONFIG };
  for (const field of Object.keys(CONFIG_KEY_BY_FIELD) as Array<
    keyof TallyLedgerConfig
  >) {
    const hit = rows.get(CONFIG_KEY_BY_FIELD[field]);
    if (hit) cfg[field] = hit.value;
  }
  return cfg;
}

/** Tally company: explicit config for the GSTIN, else the branch's legal-entity name. */
export async function resolveCompanyName(
  q: Queryable,
  companyGstin: string,
): Promise<string | null> {
  const rows = await loadConfigRows(q, companyGstin);
  const explicit = rows.get(COMPANY_NAME_KEY)?.value?.trim();
  if (explicit) return explicit;
  const [b] = await q.execute<RowDataPacket[]>(
    `SELECT MAX(company_name) AS company_name FROM branch_master WHERE gstin = ?`,
    [companyGstin],
  );
  const name = String(b[0]?.company_name ?? "").trim();
  if (name) return name;
  // A registration that only appears as a cost centre's own GST No. (see ourGstinSql).
  const [c] = await q.execute<RowDataPacket[]>(
    `SELECT MAX(bm.company_name) AS company_name
       FROM cost_centre_master cm JOIN branch_master bm ON bm.id = cm.branch_id
      WHERE UPPER(TRIM(cm.service_tax_no)) = ?`,
    [companyGstin],
  );
  return String(c[0]?.company_name ?? "").trim() || null;
}

async function loadTracking(
  q: Queryable,
  models: readonly TallyVoucherModel[],
): Promise<Map<string, TrackingRow>> {
  const map = new Map<string, TrackingRow>();
  for (const sourceType of new Set(models.map((m) => m.sourceType))) {
    const ids = models
      .filter((m) => m.sourceType === sourceType)
      .map((m) => m.sourceId);
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const [rows] = await q.execute<RowDataPacket[]>(
        `SELECT source_type, source_id, guid, content_hash, last_exported_at, export_count
           FROM tally_voucher_export
          WHERE source_type = ? AND source_id IN (${chunk.map(() => "?").join(",")})`,
        [sourceType, ...chunk],
      );
      for (const r of rows)
        map.set(trackKey(String(r.source_type), String(r.source_id)), {
          guid: String(r.guid),
          contentHash: String(r.content_hash),
          lastExportedAt: String(r.last_exported_at),
          exportCount: Number(r.export_count),
        });
    }
  }
  return map;
}

function annotate(
  built: BuiltVoucher,
  tracking: Map<string, TrackingRow>,
): PlannedVoucher {
  const contentHash = voucherContentHash(built.model);
  const t = tracking.get(
    trackKey(built.model.sourceType, built.model.sourceId),
  );
  const exportStatus: ExportStatus = !t
    ? "not_exported"
    : t.contentHash === contentHash
      ? "exported_unchanged"
      : "changed_since_export";
  return {
    model: built.model,
    errors: built.errors,
    blocked: hasBlockingError(built.errors),
    contentHash,
    action: t ? "Alter" : "Create",
    exportStatus,
    lastExportedAt: t?.lastExportedAt ?? null,
    exportCount: t?.exportCount ?? 0,
  };
}

async function planVouchers(
  q: Queryable,
  input: {
    companyGstin: string;
    periodMonth: string;
    kinds: TallyVoucherKind[];
  },
): Promise<{
  planned: PlannedVoucher[];
  companyName: string | null;
  config: TallyLedgerConfig;
}> {
  const config = await loadLedgerConfig(q, input.companyGstin);
  const companyName = await resolveCompanyName(q, input.companyGstin);
  const built: BuiltVoucher[] = [];
  for (const kind of input.kinds) {
    const mod = getVoucherKind(kind)!;
    built.push(
      ...(await mod.collect({
        companyGstin: input.companyGstin,
        periodMonth: input.periodMonth,
        config,
        companyName,
        query: q,
      })),
    );
  }
  const tracking = await loadTracking(
    q,
    built.map((b) => b.model),
  );
  return {
    planned: built.map((b) => annotate(b, tracking)),
    companyName,
    config,
  };
}

function summarise(planned: readonly PlannedVoucher[]) {
  let debit = 0;
  let credit = 0;
  for (const p of planned) {
    if (p.blocked) continue;
    const t = totalsByDrCr(p.model.entries);
    debit += t.debit;
    credit += t.credit;
  }
  const exceptionVouchers = planned.filter((p) => p.blocked).length;
  return {
    totalVouchers: planned.length,
    cleanVouchers: planned.length - exceptionVouchers,
    exceptionVouchers,
    warningVouchers: planned.filter((p) => !p.blocked && p.errors.length > 0)
      .length,
    totalDebit: debit / 100,
    totalCredit: credit / 100,
  };
}

function toRow(p: PlannedVoucher) {
  return {
    sourceType: p.model.sourceType,
    sourceId: p.model.sourceId,
    kind: p.model.kind,
    voucherType: p.model.voucherType,
    voucherNumber: p.model.voucherNumber,
    date: p.model.date,
    partyLedger: p.model.partyLedger,
    costCentreCode: p.model.display.costCentreCode,
    amount: p.model.display.amountPaise / 100,
    taxable: p.model.display.taxablePaise / 100,
    tax: p.model.display.taxPaise / 100,
    action: p.action,
    exportStatus: p.exportStatus,
    lastExportedAt: p.lastExportedAt,
    exportCount: p.exportCount,
    guid: p.model.guid,
    errors: p.errors,
    blocked: p.blocked,
  };
}

const actionFor =
  (tracking: ReadonlyMap<string, TrackingRow>) =>
  (m: TallyVoucherModel): TallyAction =>
    tracking.has(trackKey(m.sourceType, m.sourceId)) ? "Alter" : "Create";

export const tallyVoucherService = {
  async getConfig(companyGstin: string) {
    const gstin = String(companyGstin ?? "")
      .trim()
      .toUpperCase();
    const scope = isValidGstin(gstin) ? gstin : "*";
    const rows = await loadConfigRows(db, scope);
    const effective = await loadLedgerConfig(db, scope);
    const fields = (
      Object.keys(CONFIG_KEY_BY_FIELD) as Array<keyof TallyLedgerConfig>
    ).map((field) => {
      const key = CONFIG_KEY_BY_FIELD[field];
      const hit = rows.get(key);
      return {
        key,
        value: effective[field],
        source: hit ? (hit.scope === "*" ? "default" : "company") : "built-in",
      };
    });
    const companyHit = rows.get(COMPANY_NAME_KEY);
    return {
      scope,
      fields,
      companyName: await resolveCompanyName(db, scope),
      companyNameSource: companyHit ? "company" : "branch",
    };
  },

  /** Writes one company's override (or the '*' default when no GSTIN is given). */
  async saveConfig(
    companyGstin: string | null,
    values: Record<string, string>,
    actorUserId: string,
    actorRole: string,
  ) {
    const gstin = String(companyGstin ?? "")
      .trim()
      .toUpperCase();
    if (gstin && !isValidGstin(gstin))
      throw new TallyVoucherError(`${gstin} is not a valid GSTIN.`);
    const scope = gstin || "*";
    const allowed = new Set<string>([
      ...Object.values(CONFIG_KEY_BY_FIELD),
      ...(scope === "*" ? [] : [COMPANY_NAME_KEY]),
    ]);
    const entries = Object.entries(values);
    if (entries.length === 0)
      throw new TallyVoucherError("No configuration values supplied.");
    for (const [key, raw] of entries) {
      if (!allowed.has(key))
        throw new TallyVoucherError(`Unknown configuration key "${key}".`);
      const v = String(raw ?? "").trim();
      if (!v || v.length > 255)
        throw new TallyVoucherError(
          `${key} must be 1-255 characters (a blank ledger name would break the Tally import).`,
        );
    }
    for (const [key, raw] of entries) {
      await db.execute(
        `INSERT INTO tally_export_config (config_scope, config_key, config_value, updated_by)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by)`,
        [scope, key, String(raw).trim(), actorUserId],
      );
    }
    await logSensitiveAction({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: "TALLY_EXPORT_CONFIG_SAVED",
      module_key: "gst",
      entity_type: "tally_export_config",
      entity_id: scope,
      change_summary: { scope, keys: entries.map(([k]) => k) },
    });
    return this.getConfig(scope);
  },

  /** Nothing is written: compute what a batch would contain and the XML for its clean vouchers. */
  async preview(input: {
    companyGstin: string;
    periodMonth: string;
    voucherKinds: string[];
  }) {
    const v = validatePlanInput(input);
    const { planned, companyName } = await planVouchers(db, v);
    const clean = planned.filter((p) => !p.blocked);
    const tracking = await loadTracking(
      db,
      clean.map((p) => p.model),
    );
    const xml = buildVouchersXml(
      companyName ?? "",
      clean.map((p) => p.model),
      actionFor(tracking),
      planned.length !== clean.length
        ? `${planned.length - clean.length} voucher(s) with blocking exceptions are NOT included`
        : undefined,
    );
    return {
      companyGstin: v.companyGstin,
      periodMonth: v.periodMonth,
      companyName,
      summary: summarise(planned),
      vouchers: planned.map(toRow),
      xml,
    };
  },

  async generateBatch(
    input: {
      companyGstin: string;
      periodMonth: string;
      voucherKinds: string[];
      notes?: string;
    },
    actorUserId: string,
    actorRole: string,
  ) {
    const v = validatePlanInput(input);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const { planned, companyName } = await planVouchers(connection, v);
      const summary = summarise(planned);
      const batchId = randomUUID();
      const kindsKey = [...v.kinds].sort().join(",");

      await connection.execute(
        `UPDATE tally_voucher_batch SET status = 'superseded', superseded_by_id = ?
          WHERE company_gstin = ? AND period_month = ? AND voucher_kinds = ?
            AND status IN ('draft','validated')`,
        [batchId, v.companyGstin, v.periodMonth, kindsKey],
      );
      await connection.execute(
        `INSERT INTO tally_voucher_batch
           (id, company_gstin, period_month, voucher_kinds, company_name, status, total_vouchers,
            clean_vouchers, exception_vouchers, total_debit, total_credit, generated_by, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          batchId,
          v.companyGstin,
          v.periodMonth,
          kindsKey,
          companyName,
          summary.exceptionVouchers > 0 ? "draft" : "validated",
          summary.totalVouchers,
          summary.cleanVouchers,
          summary.exceptionVouchers,
          summary.totalDebit,
          summary.totalCredit,
          actorUserId,
          input.notes?.trim().slice(0, 500) || null,
        ],
      );
      let seq = 0;
      for (const p of planned) {
        seq += 1;
        await connection.execute(
          `INSERT INTO tally_voucher_batch_line
             (batch_id, source_type, source_id, sequence_no, voucher_kind, voucher_number, voucher_date,
              party_ledger, amount, guid, content_hash, validation_status, validation_errors, model_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            batchId,
            p.model.sourceType,
            p.model.sourceId,
            seq,
            p.model.kind,
            p.model.voucherNumber || null,
            p.model.date || null,
            p.model.partyLedger || null,
            p.model.display.amountPaise / 100,
            p.model.guid,
            p.contentHash,
            p.blocked ? "exception" : "valid",
            p.errors.length ? JSON.stringify(p.errors) : null,
            JSON.stringify(p.model),
          ],
        );
      }
      await connection.commit();
      await logSensitiveAction({
        actor_user_id: actorUserId,
        actor_role: actorRole,
        action_type: "TALLY_VOUCHER_BATCH_GENERATED",
        module_key: "gst",
        entity_type: "tally_voucher_batch",
        entity_id: batchId,
        change_summary: {
          ...summary,
          companyGstin: v.companyGstin,
          periodMonth: v.periodMonth,
          kinds: kindsKey,
        },
      });
      return {
        batchId,
        ...summary,
        status: summary.exceptionVouchers > 0 ? "draft" : "validated",
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async listBatches(filters: {
    companyGstin?: string;
    periodMonth?: string;
    limit?: number;
  }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.companyGstin) {
      where.push("company_gstin = ?");
      params.push(filters.companyGstin.toUpperCase());
    }
    if (filters.periodMonth) {
      where.push("period_month = ?");
      params.push(filters.periodMonth);
    }
    const limit = Math.min(Math.max(Number(filters.limit ?? 30), 1), 200);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM tally_voucher_batch ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY generated_at DESC LIMIT ${limit}`,
      params,
    );
    return rows;
  },

  async getBatch(batchId: string) {
    const [b] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM tally_voucher_batch WHERE id = ? LIMIT 1",
      [batchId],
    );
    if (!b[0])
      throw new TallyVoucherError("Tally voucher batch not found", 404);
    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT l.source_type, l.source_id, l.sequence_no, l.voucher_kind, l.voucher_number, l.voucher_date,
              l.party_ledger, l.amount, l.guid, l.validation_status, l.validation_errors,
              e.last_exported_at, e.export_count
         FROM tally_voucher_batch_line l
         LEFT JOIN tally_voucher_export e ON e.source_type = l.source_type AND e.source_id = l.source_id
        WHERE l.batch_id = ? ORDER BY l.sequence_no`,
      [batchId],
    );
    return { batch: b[0], lines };
  },

  /**
   * Renders the batch's XML. Refuses (409) while blocking exceptions remain unless the caller
   * asked to skip them - never silently emits a file that looks complete but is short.
   */
  async renderBatchXml(batchId: string, opts: { skipExceptions: boolean }) {
    const [b] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM tally_voucher_batch WHERE id = ? LIMIT 1",
      [batchId],
    );
    const batch = b[0];
    if (!batch)
      throw new TallyVoucherError("Tally voucher batch not found", 404);
    if (batch.status === "superseded")
      throw new TallyVoucherError(
        "This batch was superseded by a newer generation - download the newer one.",
        409,
      );
    const exceptionCount = Number(batch.exception_vouchers);
    if (exceptionCount > 0 && !opts.skipExceptions)
      throw new TallyVoucherError(
        `This batch has ${exceptionCount} voucher(s) with blocking exceptions. Resolve them, or re-request with skipExceptions=true to export only the clean vouchers.`,
        409,
      );
    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT model_json FROM tally_voucher_batch_line
        WHERE batch_id = ? AND validation_status = 'valid' ORDER BY sequence_no`,
      [batchId],
    );
    const models = lines.map(
      (l) => JSON.parse(String(l.model_json)) as TallyVoucherModel,
    );
    if (models.length === 0)
      throw new TallyVoucherError(
        "This batch has no clean vouchers to export.",
        409,
      );
    const tracking = await loadTracking(db, models);
    const companyName = String(batch.company_name ?? "").trim();
    if (!companyName)
      throw new TallyVoucherError("This batch has no Tally company name.", 409);
    const xml = buildVouchersXml(
      companyName,
      models,
      actionFor(tracking),
      exceptionCount > 0
        ? `${exceptionCount} voucher(s) with blocking exceptions were skipped`
        : undefined,
    );
    return { xml, batch, voucherCount: models.length };
  },

  /** Stamps the batch downloaded and records each clean voucher as exported (GUID + hash). */
  async markDownloaded(
    batchId: string,
    actorUserId: string,
    actorRole: string,
  ) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [b] = await connection.execute<RowDataPacket[]>(
        "SELECT status, exception_vouchers FROM tally_voucher_batch WHERE id = ? FOR UPDATE",
        [batchId],
      );
      if (!b[0])
        throw new TallyVoucherError("Tally voucher batch not found", 404);
      if (b[0].status === "superseded")
        throw new TallyVoucherError("Batch has been superseded", 409);
      const [lines] = await connection.execute<RowDataPacket[]>(
        `SELECT source_type, source_id, guid, content_hash, voucher_number
           FROM tally_voucher_batch_line WHERE batch_id = ? AND validation_status = 'valid'`,
        [batchId],
      );
      for (const l of lines) {
        await connection.execute(
          `INSERT INTO tally_voucher_export
             (source_type, source_id, guid, voucher_number, content_hash, first_exported_at,
              last_exported_at, export_count, last_batch_id)
           VALUES (?,?,?,?,?,NOW(),NOW(),1,?)
           ON DUPLICATE KEY UPDATE content_hash = VALUES(content_hash),
              voucher_number = VALUES(voucher_number), last_exported_at = NOW(),
              export_count = export_count + 1, last_batch_id = VALUES(last_batch_id)`,
          [
            l.source_type,
            l.source_id,
            l.guid,
            l.voucher_number,
            l.content_hash,
            batchId,
          ],
        );
      }
      const [res] = await connection.execute<ResultSetHeader>(
        `UPDATE tally_voucher_batch
            SET status = CASE WHEN exception_vouchers = 0 THEN 'exported' ELSE status END,
                downloaded_by = ?, downloaded_at = NOW()
          WHERE id = ?`,
        [actorUserId, batchId],
      );
      await connection.commit();
      await logSensitiveAction({
        actor_user_id: actorUserId,
        actor_role: actorRole,
        action_type: "TALLY_VOUCHER_BATCH_DOWNLOADED",
        module_key: "gst",
        entity_type: "tally_voucher_batch",
        entity_id: batchId,
        change_summary: { vouchers: lines.length, updated: res.affectedRows },
      });
      return { vouchersMarkedExported: lines.length };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /** Drill-down: live model + exceptions + XML snippet + export history for one document. */
  async getVoucherDetail(sourceType: string, sourceId: string) {
    const kind =
      sourceType === "invoice"
        ? "sales"
        : sourceType === "credit_note"
          ? "credit_note"
          : null;
    if (!kind)
      throw new TallyVoucherError(`Unsupported source type "${sourceType}"`);
    const table =
      sourceType === "invoice" ? "client_invoice" : "client_credit_note";
    const [g] = await db.execute<RowDataPacket[]>(
      `SELECT ${ourGstinSql("cm", "bm")} AS gstin FROM ${table} d
         JOIN cost_centre_master cm ON cm.id = d.cost_centre_id
         JOIN branch_master bm ON bm.id = cm.branch_id
        WHERE d.id = ? LIMIT 1`,
      [sourceId],
    );
    const gstin = String(g[0]?.gstin ?? "").toUpperCase();
    if (!gstin)
      throw new TallyVoucherError(
        "Document not found, or its branch has no GSTIN.",
        404,
      );
    const config = await loadLedgerConfig(db, gstin);
    const companyName = await resolveCompanyName(db, gstin);
    const built = await getVoucherKind(kind)!.collect({
      companyGstin: gstin,
      periodMonth: null,
      sourceId,
      config,
      companyName,
      query: db,
    });
    if (!built[0])
      throw new TallyVoucherError(
        "Document is not an approved invoice / credit note.",
        404,
      );
    const tracking = await loadTracking(db, [built[0].model]);
    const planned = annotate(built[0], tracking);
    const [history] = await db.execute<RowDataPacket[]>(
      `SELECT b.id AS batch_id, b.period_month, b.status, b.generated_at, b.downloaded_at,
              l.validation_status
         FROM tally_voucher_batch_line l JOIN tally_voucher_batch b ON b.id = l.batch_id
        WHERE l.source_type = ? AND l.source_id = ? ORDER BY b.generated_at DESC LIMIT 20`,
      [sourceType, sourceId],
    );
    const xml = buildVouchersXml(
      companyName ?? "",
      [planned.model],
      () => planned.action,
    );
    return {
      voucher: toRow(planned),
      entries: planned.model.entries.map((e) => ({
        ...e,
        amount: e.paise / 100,
      })),
      narration: planned.model.narration,
      partyGstin: planned.model.partyGstin,
      placeOfSupply: planned.model.placeOfSupply,
      history,
      xml,
    };
  },
};
