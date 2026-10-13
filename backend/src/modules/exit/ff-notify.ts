/**
 * In-app tasks around an F&F settlement. Mirrors of the real state, never the control: a failed
 * inbox write must not block a settlement, so every call swallows its own errors.
 */
import { inboxService } from "../inbox/inbox.service.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";

/** An F&F has been prepared: the Payroll Head owes the approval. */
export async function notifyFfAwaitingApproval(ffId: string, exitRequestId: string, employeeLabel: string, netPayable: number): Promise<void> {
  try {
    for (const userId of await resolveRoleHolderUserIds("payroll_head", null)) {
      await inboxService.createItem({
        user_id: userId,
        type: "ff_awaiting_approval",
        title: `F&F awaiting your approval — ${employeeLabel}`,
        description: `Net payable ₹${Number(netPayable).toLocaleString("en-IN")}. Review the attendance, final-month salary and recoveries, then approve.`,
        entity_type: "full_final_calculation",
        entity_id: ffId,
        action_url: `/payroll/full-final?approvalId=${exitRequestId}`,
        priority: "high",
      }).catch(() => undefined);
    }
  } catch (err) {
    console.error("[ff-notify] awaiting approval:", (err as Error).message);
  }
}

/** The approval happened: close the Payroll Head's task. */
export async function resolveFfAwaitingApproval(ffId: string): Promise<void> {
  await inboxService
    .resolveItems({ entity_type: "full_final_calculation", entity_id: ffId, types: ["ff_awaiting_approval"] })
    .catch(() => undefined);
}

/** F&F is unlocked (NOC finally approved): tell whoever prepares it. */
export async function notifyFfUnlocked(employeeId: string, employeeLabel: string, caseId: string): Promise<void> {
  try {
    const seen = new Set<string>();
    for (const role of ["hr", "payroll"]) {
      for (const userId of await resolveRoleHolderUserIds(role, null)) {
        if (seen.has(userId)) continue;
        seen.add(userId);
        await inboxService.createItem({
          user_id: userId,
          type: "ff_unlocked",
          title: `F&F unlocked — ${employeeLabel}`,
          description: "NOC is fully cleared and approved by the Payroll Head. The F&F settlement can now be prepared.",
          entity_type: "noc_case",
          entity_id: caseId,
          action_url: "/payroll/full-final",
          priority: "normal",
        }).catch(() => undefined);
      }
    }
  } catch (err) {
    console.error("[ff-notify] unlocked:", (err as Error).message);
  }
}
