import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";

/**
 * Bell notification for a GRN awaiting a stage.
 *
 * Extracted from grn.service.ts (where it originated 2026-09-09) so grn-smart.service.ts and
 * grn-validation-control.service.ts can share it without importing grn.service.ts — that would
 * create an import cycle, since grn.service.ts already imports grnSmartService.
 *
 * This module previously lived only in grn.service.ts's reviewGrn()/submit(), which turned out
 * to be dead for this purpose: smartGrnRouter is mounted at /grns ahead of grnRouter's own
 * /grns/:id/submit and /grns/:id/review (grn.routes.ts:226-230), and its own /:id/submit route
 * hard-requires allocations (requireAllocationsForSubmit, grn-smart.routes.ts:164-179) rather
 * than falling through — so every submission reaches grnValidationControlService.submit(), and
 * every review of an allocation-aware GRN (onlyWhenSmart falls through only when there are NO
 * allocations) reaches grnSmartService.review(). Neither of those called this. Confirmed live:
 * `work_inbox_item` held zero rows of type 'grn_approval_pending', ever, while
 * `finance_approval_event` showed 83 real Branch Head approvals in the same window — the
 * notification code existed, it was just wired to a code path nothing was actually taking.
 *
 * Non-fatal by design — a notification failure must never roll back or block the GRN
 * transition that triggered it.
 */
const STAGE_LABEL: Record<"branch_head" | "accounts_head" | "finance_head", string> = {
  branch_head: "Branch Head",
  accounts_head: "Accounts Head",
  finance_head: "Finance Head",
};

export async function notifyGrnStage(
  grnId: string,
  grnNumber: string | null,
  branchId: string | null,
  vendorName: string | null,
  amount: number | null,
  // Accounts Head added as a genuine mid-chain stage (owner ruling, 2026-09-12) — see
  // finance-workflow-role.ts's resolveFinanceStageRole for the full 3-stage chain this mirrors.
  role: "branch_head" | "accounts_head" | "finance_head",
) {
  try {
    const { inboxService } = await import("../inbox/inbox.service.js");
    const userIds = await resolveRoleHolderUserIds(role, branchId);
    const amountLabel = amount != null ? `₹${Number(amount).toLocaleString("en-IN")}` : "";
    for (const userId of userIds) {
      await inboxService.createItem({
        user_id: userId,
        type: "grn_approval_pending",
        title: `[ACTION REQUIRED] GRN ${grnNumber ?? ""}${vendorName ? ` — ${vendorName}` : ""}`,
        description: `Awaiting your ${STAGE_LABEL[role]} review${amountLabel ? ` (${amountLabel})` : ""}.`,
        entity_type: "grn_request",
        entity_id: grnId,
        action_url: "/finance/grn",
        priority: "high",
      });
    }
  } catch {
    // Non-fatal — notification failure must not block the GRN transition.
  }
}

/** The decision is made — close the bell alert(s) raised for this GRN, at any stage. */
export async function resolveGrnNotifications(grnId: string) {
  try {
    const { inboxService } = await import("../inbox/inbox.service.js");
    await inboxService.resolveItems({
      entity_type: "grn_request",
      entity_id: grnId,
      types: ["grn_approval_pending"],
    });
  } catch {
    // Non-fatal.
  }
}

/**
 * A Head Office GRN reached final approval and part of its cost landed on other branches: tell each
 * receiving branch's Branch Head what they now carry, on which Back Office cost centre. An alert,
 * not an approval step (owner ruling 2026-10-07: Head Office's chain approves; branches are told).
 * One bell item per Branch Head per GRN (the inbox de-duplicates on user + type + entity + url).
 * Non-fatal, like notifyGrnStage.
 */
export async function notifyBranchShares(grnId: string, grnNumber: string | null, vendorName: string | null) {
  try {
    const { inboxService } = await import("../inbox/inbox.service.js");
    const [rows] = (await db.execute(
      `SELECT a.branch_id, bm.branch_name,
              SUM(a.amount_with_tax) AS amount,
              GROUP_CONCAT(DISTINCT ccm.cost_centre_code ORDER BY ccm.cost_centre_code SEPARATOR ', ') AS cost_centres
         FROM grn_cost_allocation a
         JOIN grn_request g ON g.id = a.grn_request_id
         LEFT JOIN branch_master bm ON bm.id = a.branch_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = a.cost_centre_id
        WHERE a.grn_request_id = ? AND a.branch_id <> g.branch_id
        GROUP BY a.branch_id, bm.branch_name`,
      [grnId],
    )) as [RowDataPacket[], unknown];
    for (const row of rows) {
      const userIds = await resolveRoleHolderUserIds("branch_head", String(row.branch_id));
      const amount = `₹${Number(row.amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
      for (const userId of userIds) {
        await inboxService.createItem({
          user_id: userId,
          type: "grn_branch_share",
          title: `Head Office bill charged to ${row.branch_name ?? "your branch"} — ${amount}`,
          description: `GRN ${grnNumber ?? ""}${vendorName ? ` (${vendorName})` : ""}: ${amount} landed on ${row.cost_centres ?? "your Back Office cost centre"}. For information — Head Office's approval chain already approved it.`,
          entity_type: "grn_request",
          entity_id: grnId,
          action_url: "/finance/grn",
          priority: "medium",
        });
      }
    }
  } catch {
    // Non-fatal — a notification failure must not block the GRN transition.
  }
}
