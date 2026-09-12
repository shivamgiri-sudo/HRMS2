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
