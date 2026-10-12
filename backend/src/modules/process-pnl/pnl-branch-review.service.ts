import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { refuse } from "./finance-error.js";
import { getPnlReconciliation, type PnlBranchRollup } from "./pnl-reconciliation.service.js";

/**
 * Branch review of the monthly P&L. The figures come from the same reconciliation the P&L page uses
 * (revenue, people cost, GRN spend per branch), so what a branch reviews is what the CEO sees.
 * Status is derived, never stored: open queries win, then an acknowledgement whose snapshot still
 * matches, then an acknowledgement the figures have moved away from, then pending.
 */
export const QUERY_SECTIONS = ["revenue", "people_cost", "non_people_cost", "other"] as const;
export type QuerySection = (typeof QUERY_SECTIONS)[number];
export type ReviewStatus = "pending" | "queried" | "acknowledged" | "changed_after_acknowledgement";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Rupee tolerance before a figure counts as changed since acknowledgement (rounding noise). */
const CHANGE_TOLERANCE = 1;

export interface BranchReviewQuery {
  id: string; section: QuerySection; costCentreId: string | null; message: string; status: "open" | "resolved";
  raisedBy: string; raisedAt: string; resolvedBy: string | null; resolvedAt: string | null; resolutionNote: string | null;
}
export interface BranchReviewRow {
  branchId: string; branchName: string; status: ReviewStatus;
  revenue: number; cost: number; operatingProfit: number; marginPct: number | null;
  /** Reconciliation flags the branch should know before signing (missing sources, estimates ...). */
  issues: string[];
  acknowledgedAt: string | null; acknowledgedBy: string | null; comment: string | null;
  snapshot: { revenue: number; cost: number; operatingProfit: number } | null;
  openQueries: number; queries: BranchReviewQuery[];
}
export interface BranchReviewResult {
  period: string; mode: string; blockers: string[]; generatedAt: string;
  totals: { branches: number; pending: number; queried: number; acknowledged: number; changed: number };
  branches: BranchReviewRow[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export function assertPeriod(period: string): void {
  if (!PERIOD_RE.test(period)) throw refuse(400, "PERIOD_INVALID", "Period must look like 2026-09");
}

/** Pure: revenue, cost and profit of a branch rollup as the review shows them. cost = revenue - profit, so it can never disagree with the P&L. */
export function reviewFigures(b: Pick<PnlBranchRollup, "revenue" | "operatingProfit" | "marginPct">) {
  const revenue = r2(Number(b.revenue ?? 0));
  const operatingProfit = r2(Number(b.operatingProfit ?? 0));
  return { revenue, operatingProfit, cost: r2(revenue - operatingProfit), marginPct: b.marginPct ?? null };
}

/** Pure: derived review status. */
export function deriveStatus(
  openQueries: number,
  ack: { revenue: number; cost: number; operatingProfit: number } | null,
  now: { revenue: number; cost: number; operatingProfit: number },
): ReviewStatus {
  if (openQueries > 0) return "queried";
  if (!ack) return "pending";
  const moved = ["revenue", "cost", "operatingProfit"].some(
    (k) => Math.abs((ack as Record<string, number>)[k] - (now as Record<string, number>)[k]) > CHANGE_TOLERANCE,
  );
  return moved ? "changed_after_acknowledgement" : "acknowledged";
}

/** branchIds null = every branch. */
export async function getBranchReview(period: string, branchIds: string[] | null): Promise<BranchReviewResult> {
  assertPeriod(period);
  const rec = await getPnlReconciliation(period, { branchIds: branchIds ?? [] });
  const rollups = rec.branches.filter((b) => b.branchId && (!branchIds || branchIds.includes(b.branchId)));
  const [acks] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM pnl_branch_review WHERE period_code = ?", [period]);
  const [qs] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM pnl_branch_review_query WHERE period_code = ? ORDER BY raised_at DESC", [period]);
  const ackBy = new Map(acks.map((a) => [String(a.branch_id), a]));
  const qBy = new Map<string, BranchReviewQuery[]>();
  for (const q of qs) {
    const row: BranchReviewQuery = {
      id: String(q.id), section: q.section, costCentreId: q.cost_centre_id ? String(q.cost_centre_id) : null, message: String(q.message),
      status: q.status, raisedBy: String(q.raised_by), raisedAt: iso(q.raised_at)!, resolvedBy: q.resolved_by ? String(q.resolved_by) : null,
      resolvedAt: iso(q.resolved_at), resolutionNote: q.resolution_note ?? null,
    };
    const list = qBy.get(String(q.branch_id)) ?? [];
    list.push(row);
    qBy.set(String(q.branch_id), list);
  }
  const branches: BranchReviewRow[] = rollups.map((b) => {
    const id = String(b.branchId);
    const f = reviewFigures(b);
    const a = ackBy.get(id);
    const queries = qBy.get(id) ?? [];
    const open = queries.filter((q) => q.status === "open").length;
    const snapshot = a ? { revenue: Number(a.snapshot_revenue), cost: Number(a.snapshot_cost), operatingProfit: Number(a.snapshot_operating_profit) } : null;
    return {
      branchId: id, branchName: b.branchName, status: deriveStatus(open, snapshot, f),
      revenue: f.revenue, cost: f.cost, operatingProfit: f.operatingProfit, marginPct: f.marginPct, issues: b.issues ?? [],
      acknowledgedAt: a ? iso(a.acknowledged_at) : null, acknowledgedBy: a ? String(a.acknowledged_by) : null, comment: a?.comment ?? null,
      snapshot, openQueries: open, queries,
    };
  }).sort((x, y) => x.branchName.localeCompare(y.branchName));
  const count = (s: ReviewStatus) => branches.filter((b) => b.status === s).length;
  return {
    period, mode: rec.mode, blockers: rec.blockers, generatedAt: rec.generatedAt,
    totals: { branches: branches.length, pending: count("pending"), queried: count("queried"), acknowledged: count("acknowledged"), changed: count("changed_after_acknowledgement") },
    branches,
  };
}

async function currentFigures(period: string, branchId: string) {
  const rec = await getPnlReconciliation(period, { branchIds: [branchId] });
  const b = rec.branches.find((x) => x.branchId === branchId);
  if (!b) throw refuse(404, "BRANCH_NOT_IN_PNL", "This branch has no P&L for the period");
  return { figures: reviewFigures(b), mode: rec.mode, blockers: rec.blockers };
}

export async function acknowledgeBranch(branchId: string, period: string, userId: string, comment: string | null) {
  assertPeriod(period);
  const { figures, mode, blockers } = await currentFigures(period, branchId);
  if (mode === "BLOCKED") throw refuse(409, "PNL_BLOCKED", `The P&L for ${period} is blocked: ${blockers.join("; ") || "a source is missing"}`);
  const [open] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM pnl_branch_review_query WHERE branch_id = ? AND period_code = ? AND status = 'open'", [branchId, period]);
  if (Number(open[0]?.n ?? 0) > 0) throw refuse(409, "OPEN_QUERIES", "Finance has to resolve the open queries before you can acknowledge");
  await db.execute(
    `INSERT INTO pnl_branch_review (id, branch_id, period_code, acknowledged_by, acknowledged_at, comment, snapshot_revenue, snapshot_cost, snapshot_operating_profit, snapshot_mode)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE acknowledged_by = VALUES(acknowledged_by), acknowledged_at = NOW(), comment = VALUES(comment),
       snapshot_revenue = VALUES(snapshot_revenue), snapshot_cost = VALUES(snapshot_cost),
       snapshot_operating_profit = VALUES(snapshot_operating_profit), snapshot_mode = VALUES(snapshot_mode)`,
    [randomUUID(), branchId, period, userId, comment?.trim() || null, figures.revenue, figures.cost, figures.operatingProfit, mode]);
  return figures;
}

export async function raiseQuery(
  input: { branchId: string; period: string; section: string; costCentreId?: string | null; message: string }, userId: string,
) {
  assertPeriod(input.period);
  if (!(QUERY_SECTIONS as readonly string[]).includes(input.section)) throw refuse(400, "SECTION_INVALID", `Section must be one of ${QUERY_SECTIONS.join(", ")}`);
  const message = input.message?.trim() ?? "";
  if (message.length < 5) throw refuse(400, "MESSAGE_REQUIRED", "Describe what looks wrong (at least a few words)");
  if (message.length > 2000) throw refuse(400, "MESSAGE_TOO_LONG", "Keep the query under 2000 characters");
  if (input.costCentreId) {
    const [cc] = await db.execute<RowDataPacket[]>("SELECT branch_id FROM cost_centre_master WHERE id = ? LIMIT 1", [input.costCentreId]);
    if (!cc[0] || String(cc[0].branch_id) !== input.branchId) throw refuse(400, "COST_CENTRE_MISMATCH", "That cost centre does not belong to this branch");
  }
  const id = randomUUID();
  await db.execute(
    `INSERT INTO pnl_branch_review_query (id, branch_id, period_code, section, cost_centre_id, message, raised_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.branchId, input.period, input.section, input.costCentreId || null, message, userId]);
  // A new query withdraws a standing acknowledgement: the branch is no longer content with the month.
  await db.execute("DELETE FROM pnl_branch_review WHERE branch_id = ? AND period_code = ?", [input.branchId, input.period]);
  return { id };
}

export async function getQueryBranch(queryId: string): Promise<{ branchId: string; status: string } | null> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT branch_id, status FROM pnl_branch_review_query WHERE id = ? LIMIT 1", [queryId]);
  return rows[0] ? { branchId: String(rows[0].branch_id), status: String(rows[0].status) } : null;
}

export async function resolveQuery(queryId: string, userId: string, note: string | null) {
  const trimmed = note?.trim() ?? "";
  if (trimmed.length < 3) throw refuse(400, "RESOLUTION_REQUIRED", "Say what was checked or changed");
  const [r] = await db.execute<ResultSetHeader>(
    `UPDATE pnl_branch_review_query SET status = 'resolved', resolved_by = ?, resolved_at = NOW(), resolution_note = ? WHERE id = ? AND status = 'open'`,
    [userId, trimmed, queryId]);
  if (!r.affectedRows) throw refuse(409, "QUERY_NOT_OPEN", "This query is already resolved");
}
