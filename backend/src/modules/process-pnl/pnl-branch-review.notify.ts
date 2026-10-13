import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";
import { inboxService } from "../inbox/inbox.service.js";
import { logger } from "../../logger.js";

/**
 * Work Inbox items for the branch P&L review. Best effort: a notification failure must never undo the
 * query or the resolution it announces, so everything here swallows and logs.
 */
const ENTITY = "pnl_branch_review_query";
const link = (period: string, branchId: string) => `/finance/process-pnl?period=${period}&branchId=${branchId}&tab=review`;

async function branchName(branchId: string): Promise<string> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT branch_name FROM branch_master WHERE id = ? LIMIT 1", [branchId]);
  return r[0]?.branch_name ? String(r[0].branch_name) : "a branch";
}

const SECTION_TEXT: Record<string, string> = { revenue: "revenue", people_cost: "people cost", non_people_cost: "non-people cost", other: "the P&L" };

/** Finance Head (company-wide) and Accounts Head hear about a new query. */
export async function notifyQueryRaised(i: { queryId: string; branchId: string; period: string; section: string; message: string }): Promise<number> {
  try {
    const name = await branchName(i.branchId);
    const ids = new Set<string>();
    for (const role of ["finance_head", "accounts_head"]) {
      for (const u of await resolveRoleHolderUserIds(role, null).catch(() => [] as string[])) ids.add(u);
    }
    for (const userId of ids) {
      await inboxService.createItem({
        user_id: userId, type: "PNL_BRANCH_QUERY",
        title: `${name} queried ${SECTION_TEXT[i.section] ?? "the P&L"} for ${i.period}`,
        description: i.message.slice(0, 300), entity_type: ENTITY, entity_id: i.queryId, action_url: link(i.period, i.branchId), priority: "normal",
      });
    }
    return ids.size;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[pnl-branch-review] notify raised failed");
    return 0;
  }
}

/** The person who raised the query, and the branch's heads, hear that Finance resolved it. */
export async function notifyQueryResolved(i: { queryId: string; branchId: string; period: string; raisedBy: string | null; note: string }): Promise<number> {
  try {
    const name = await branchName(i.branchId);
    const ids = new Set<string>();
    if (i.raisedBy) ids.add(i.raisedBy);
    for (const u of await resolveRoleHolderUserIds("branch_head", i.branchId).catch(() => [] as string[])) ids.add(u);
    for (const userId of ids) {
      await inboxService.createItem({
        user_id: userId, type: "PNL_BRANCH_QUERY_RESOLVED",
        title: `Finance resolved your ${name} P&L query for ${i.period}`,
        description: i.note.slice(0, 300), entity_type: ENTITY, entity_id: i.queryId, action_url: link(i.period, i.branchId), priority: "normal",
      });
    }
    return ids.size;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[pnl-branch-review] notify resolved failed");
    return 0;
  }
}
