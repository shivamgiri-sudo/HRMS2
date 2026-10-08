/**
 * No-show and decline reasons (HE_OUTCOME_REASONS). The only write is one guarded, idempotent upsert into he_match_outcome_reason, keyed by
 * match (last tap wins). Scope is checked on the branch of the match's requisition; a record outside scope is "not_found". The list never
 * throws: a failed read is partial with no rows. Logs carry the section and error code only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { OUTCOME_REASONS, type OutcomeReasonCode } from "./he-outcome-reason.js";
import { maskMobile } from "./qualified-followup.rules.js";
import { SOURCE_TYPES } from "./he-drive-analytics.js";
import { readAgg } from "./he-drive-trend.service.js";
import type { SourceType } from "./qualified-followup.types.js";
import { valueAddOn } from "./he-valueadd-switches.js";
import { creditJoinsSql } from "./he-source-attribution.js";
import { PersonFacts, TYPE_KEY_GROUP, typeKeyColsSql } from "./he-person-facts.service.js";
import { loadLiveFrom } from "./he-source-attribution.service.js";

const COLL = "COLLATE utf8mb4_unicode_ci";
const LIST_CAP = 300;
const noTable = (err: unknown): boolean => (err as { code?: unknown })?.code === "ER_NO_SUCH_TABLE";

export type RecordResult =
  | { status: "saved"; outcome: "no_show" | "declined"; reason: OutcomeReasonCode; note: string | null }
  | { status: "not_found" }
  | { status: "wrong_state" };

const PROBE_SQL = `SELECT m.id, m.state, jr.branch_name FROM he_match m JOIN job_requisition jr ON jr.id = m.requisition_id ${COLL} WHERE m.id = ?`;
const UPSERT_SQL = `INSERT INTO he_match_outcome_reason (match_id, outcome, reason_code, note, requisition_id, drive_id, recorded_by)
SELECT m.id, m.state, ?, ?, m.requisition_id, m.drive_id, ? FROM he_match m WHERE m.id = ? AND m.state IN ('no_show','declined') ON DUPLICATE KEY UPDATE outcome = VALUES(outcome), reason_code = VALUES(reason_code), note = VALUES(note), recorded_by = VALUES(recorded_by)`;

export async function recordOutcomeReason(
  matchId: string, body: { reason: OutcomeReasonCode; note: string | null }, scope: BranchScope, userId: string | null,
): Promise<RecordResult> {
  if (!scope.all && !scope.branchName) return { status: "not_found" };
  const [rows] = await db.execute<RowDataPacket[]>(PROBE_SQL, [matchId]);
  const m = rows[0];
  if (!m) return { status: "not_found" };
  if (!scope.all && String(m.branch_name) !== scope.branchName) return { status: "not_found" };
  const state = String(m.state);
  if (state !== "no_show" && state !== "declined") return { status: "wrong_state" };
  const [res] = await db.execute<RowDataPacket[]>(UPSERT_SQL, [body.reason, body.note, userId, matchId]);
  if (Number((res as unknown as { affectedRows?: number }).affectedRows ?? 0) === 0) return { status: "wrong_state" };
  return { status: "saved", outcome: state, reason: body.reason, note: body.note };
}

export interface OutcomeRow {
  matchId: string; leadId: string; name: string | null; mobileMasked: string; driveId: string; driveDate: string; branch: string;
  requisitionCode: string; outcome: "no_show" | "declined"; slotAt: string | null; reason: OutcomeReasonCode | null; note: string | null;
}
export interface OutcomeList { enabled: boolean; rows: OutcomeRow[]; truncated: boolean; partial: boolean }

// STRAIGHT_JOIN: start from the drives in the window (idx_he_drive_date), then reach their matches by idx_he_match_drive, never a scan of he_match.
const listSql = (withReason: boolean, scoped: boolean): string => `SELECT STRAIGHT_JOIN m.id AS match_id, m.lead_id, l.full_name, l.mobile10, d.id AS drive_id, d.drive_date, jr.branch_name, jr.requisition_code,
       m.state AS outcome, m.slot_at, ${withReason ? "r.reason_code, r.note" : "NULL AS reason_code, NULL AS note"}
  FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id ${COLL}
  JOIN he_match m ON m.drive_id = d.id AND m.state IN ('no_show','declined')
  JOIN he_lead l ON l.id = m.lead_id${withReason ? `
  LEFT JOIN he_match_outcome_reason r ON r.match_id = m.id` : ""}
 WHERE d.drive_date BETWEEN ? AND ?${scoped ? ` AND jr.branch_name = ? ${COLL}` : ""}
 ORDER BY d.drive_date DESC, m.slot_at, m.id LIMIT ${LIST_CAP + 1}`;

const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));
const wall = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 19).replace("T", " ") : String(v).slice(0, 19).replace("T", " "));

export async function listOutcomes(o: { from: string; to: string }, scope: BranchScope): Promise<OutcomeList> {
  const empty: OutcomeList = { enabled: true, rows: [], truncated: false, partial: false };
  if (!valueAddOn("outcome_reasons")) return { enabled: false, rows: [], truncated: false, partial: false };
  if (!scope.all && !scope.branchName) return empty;
  const params: unknown[] = scope.all ? [o.from, o.to] : [o.from, o.to, scope.branchName];
  let rows: RowDataPacket[];
  try {
    try { rows = (await db.execute<RowDataPacket[]>(listSql(true, !scope.all), params))[0]; } catch (err) {
      if (!noTable(err)) throw err;
      rows = (await db.execute<RowDataPacket[]>(listSql(false, !scope.all), params))[0];
    }
  } catch (err) {
    logger.error({ section: "outcome:list", code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-outcome] section failed");
    return { ...empty, partial: true };
  }
  const reasonOf = (v: unknown): OutcomeReasonCode | null => OUTCOME_REASONS.find((c) => c === v) ?? null;
  return {
    enabled: true, partial: false, truncated: rows.length > LIST_CAP,
    rows: rows.slice(0, LIST_CAP).map((r) => ({
      matchId: String(r.match_id), leadId: String(r.lead_id), name: r.full_name == null || r.full_name === "" ? null : String(r.full_name),
      mobileMasked: maskMobile(String(r.mobile10 ?? "")), driveId: String(r.drive_id), driveDate: day(r.drive_date), branch: String(r.branch_name),
      requisitionCode: String(r.requisition_code ?? ""), outcome: r.outcome === "declined" ? "declined" : "no_show", slotAt: wall(r.slot_at),
      reason: reasonOf(r.reason_code), note: r.note == null || r.note === "" ? null : String(r.note),
    })),
  };
}

type Counts = Partial<Record<OutcomeReasonCode, number>>;
export type ReasonCounts = Record<SourceType, { no_show: Counts; declined: Counts }>;

// Typed by the shared source rule: the row signals next to the lead id, typed in JS by PersonFacts (he-person-facts.service.ts).
const countsSql = (n: number, streams: boolean, liveFrom: string): string => `SELECT ${typeKeyColsSql({ streams, d: "d", leadId: "m.lead_id", ref: "d.drive_date", liveFrom })}, r.outcome, r.reason_code, COUNT(*) AS n
  FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id AND m.state IN ('no_show','declined')
  JOIN he_match_outcome_reason r ON r.match_id = m.id
  ${creditJoinsSql({ streams, match: "m", requisition: "d.requisition_id" })}
 WHERE d.requisition_id IN (${Array(n).fill("?").join(",")}) AND d.drive_date BETWEEN ? AND ? AND r.outcome = m.state
 GROUP BY ${TYPE_KEY_GROUP}, r.outcome, r.reason_code`;

/** Reason counts per source type for the given requisitions and drive dates. A missing table counts zero; other errors are thrown for the caller's section handling. */
export async function outcomeReasonCounts(ids: string[], from: string, to: string, liveFrom?: string, facts?: PersonFacts): Promise<ReasonCounts> {
  const out = Object.fromEntries(SOURCE_TYPES.map((t) => [t, { no_show: {}, declined: {} }])) as ReasonCounts;
  if (!ids.length) return out;
  let rows: RowDataPacket[] = [];
  const lf = liveFrom ?? await loadLiveFrom();
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const b = ids.slice(i, i + 200);
      rows = rows.concat(await readAgg((st) => countsSql(b.length, st, lf), [...b, from, to]));
    }
  } catch (err) {
    if (noTable(err)) return out;
    throw err;
  }
  const pf = facts ?? new PersonFacts(lf);
  await pf.loadRows(rows);
  for (const r of rows) {
    const rt = pf.typeOf(r);
    const t = SOURCE_TYPES.find((x) => x === rt), code = OUTCOME_REASONS.find((c) => c === r.reason_code);
    const o = r.outcome === "declined" ? "declined" : r.outcome === "no_show" ? "no_show" : null;
    const n = Number(r.n);
    if (!t || !code || !o || !Number.isFinite(n) || n <= 0) continue;
    out[t][o][code] = (out[t][o][code] ?? 0) + n;
  }
  return out;
}
