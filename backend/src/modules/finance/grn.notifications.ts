/**
 * GRN approval-chain email notifications.
 *
 * Owner directive (2026-09-17): the GRN approval chain (Branch Head -> Accounts Head ->
 * Finance Head) had zero email at any stage — only the in-app bell in grn-notify.ts. This
 * adds email for the two handoffs asked for: Branch Head is told when a GRN is raised, and
 * Accounts Head is told once the Branch Head approves. grn-approval-reminder.worker.ts calls
 * notifyGrnApprovalOverdue() when either stage sits unactioned for 24h.
 *
 * Deliberately NOT wired: the Accounts Head -> Finance Head handoff. Not asked for, and a
 * clean follow-on once these two are proven live (add a grn_finance_head_pending event on
 * the same shape and one more call site in grn.service.ts/grn-smart.service.ts's review()).
 *
 * Fire-and-forget throughout, same contract as every other *.notifications.ts in this
 * codebase: a mail failure must never roll back or block the GRN transition that triggered
 * it — grn-notify.ts's bell already follows this, and grn.service.ts's approve/reject calls
 * both unconditionally.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { notificationGateway } from "../communication/notification.gateway.js";
import type { RecipientSpec } from "../../shared/recipient-resolver.types.js";

function frontendBaseUrl(): string {
  return String(env.FRONTEND_URL ?? "https://mcnhrms.teammas.in").replace(/\/+$/, "");
}

/** Deep link to the GRN screen — there is no per-record route today, so this opens the queue. */
function grnActionUrl(grnId: string): string {
  return `${frontendBaseUrl()}/finance/grn?id=${grnId}`;
}

/**
 * A stand-in reference for a GRN that has not reached Finance Head approval yet.
 *
 * grn_number is deliberately assigned only at final (Finance Head) approval — see
 * grn.service.ts's submitForApproval() comment — so every earlier-stage email needs
 * something else to identify the record by. Short, stable, and matches the id the action
 * link itself carries.
 */
function grnReference(grnId: string, grnNumber: string | null): string {
  return grnNumber || `GRN-REQ-${grnId.slice(0, 8).toUpperCase()}`;
}

interface GrnContext extends RowDataPacket {
  id: string;
  grn_number: string | null;
  branch_id: string | null;
  process_id: string | null;
  branch_name: string | null;
  head: string | null;
  sub_head: string | null;
  bill_date: string | null;
  vendor_name: string | null;
  amount: number | null;
  remarks: string | null;
  status: string;
  raised_by_name: string | null;
}

async function loadGrnContext(grnId: string): Promise<GrnContext | null> {
  const [rows] = await db.execute<GrnContext[]>(
    `SELECT g.id, g.grn_number, g.branch_id, g.process_id, g.status,
            b.branch_name,
            g.head, g.sub_head, g.bill_date, g.vendor_name,
            COALESCE(g.amount_with_tax, g.amount) AS amount,
            g.remarks,
            COALESCE(NULLIF(TRIM(raiser.full_name), ''), raiser.employee_code) AS raised_by_name
       FROM grn_request g
       LEFT JOIN branch_master b ON b.id = g.branch_id
       LEFT JOIN auth_user au ON au.id = g.submitted_by
       LEFT JOIN employees raiser ON raiser.user_id = au.id
      WHERE g.id = ?
      LIMIT 1`,
    [grnId],
  );
  return rows[0] ?? null;
}

function formatAmount(amount: number | null): string {
  return amount == null ? "—" : `₹${Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function baseData(ctx: GrnContext) {
  return {
    grn_reference: grnReference(ctx.id, ctx.grn_number),
    branch_name: ctx.branch_name ?? "—",
    amount: formatAmount(ctx.amount),
    head: ctx.head ?? "—",
    sub_head: ctx.sub_head ?? "—",
    bill_date: formatDate(ctx.bill_date),
    vendor_name: ctx.vendor_name ?? "—",
    remarks: ctx.remarks?.trim() || "—",
    action_url: grnActionUrl(ctx.id),
  };
}

/** GRN raised — To: the branch's Branch Head (recipient_spec's own `branch_head` selector). */
export async function notifyGrnSubmittedEmail(grnId: string): Promise<void> {
  try {
    const ctx = await loadGrnContext(grnId);
    if (!ctx) return;
    await notificationGateway.notify({
      eventCode: "grn_submitted",
      dedupeKey: `grn_request:${grnId}:submitted`,
      context: { branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: "grn_request",
      entityId: grnId,
      correlationId: `grn:${grnId}`,
      data: { ...baseData(ctx), raised_by: ctx.raised_by_name ?? "—" },
    });
  } catch (err) {
    console.error(`[grn-notify-email] submitted ${grnId}:`, (err as Error).message);
  }
}

/**
 * Branch Head approved — To: Accounts Head. role_scope, not the dedicated `branch_head`
 * selector kind: Accounts Head has no per-branch scoping in this org (2 holders total,
 * confirmed live), so `scope: { type: 'all' }` is correct, not a branch-limited fallback.
 */
export async function notifyGrnAccountsHeadPendingEmail(grnId: string): Promise<void> {
  try {
    const ctx = await loadGrnContext(grnId);
    if (!ctx) return;
    await notificationGateway.notify({
      eventCode: "grn_accounts_head_pending",
      dedupeKey: `grn_request:${grnId}:accounts_head_pending`,
      context: { branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: "grn_request",
      entityId: grnId,
      correlationId: `grn:${grnId}`,
      data: baseData(ctx),
    });
  } catch (err) {
    console.error(`[grn-notify-email] accounts_head_pending ${grnId}:`, (err as Error).message);
  }
}

const STAGE_LABEL: Record<"branch_head" | "accounts_head", string> = {
  branch_head: "Branch Head",
  accounts_head: "Accounts Head",
};

/**
 * Reminder for a GRN still sitting at whichever stage currently owns it.
 *
 * `stage` is passed by the caller (grn-approval-reminder.worker.ts), which already knows it
 * from grn_request.status — re-deriving it here from ctx.status would just be a second,
 * possibly-stale read of the same fact the caller already has fresh.
 *
 * specOverride, not the DB row's own recipient_spec: this is one event covering two
 * different recipient kinds (branch_head is branch-scoped, accounts_head is role_scope/all),
 * the same reason noc.notifications.ts's stageSpec() exists for the 8-signatory NOC chain.
 * The kill switch, cooldown, dedupe and audit trail all still apply — specOverride only
 * changes who is addressed, never whether the send is governed.
 */
export async function notifyGrnApprovalOverdue(
  grnId: string,
  stage: "branch_head" | "accounts_head",
  reminderNo: number,
): Promise<boolean> {
  try {
    const ctx = await loadGrnContext(grnId);
    if (!ctx) return false;
    const spec: RecipientSpec =
      stage === "branch_head"
        ? { to: [{ kind: "branch_head", branchId: ctx.branch_id ?? undefined }] }
        : { to: [{ kind: "role_scope", roleKeys: ["accounts_head"], scope: { type: "all" }, limit: 10 }] };

    const outcome = await notificationGateway.notify({
      eventCode: "grn_approval_overdue",
      // Reminder number in the key: each successive nudge is its own claim, or the first
      // would permanently suppress the rest.
      dedupeKey: `grn_request:${grnId}:overdue:${reminderNo}`,
      context: { branchId: ctx.branch_id, processId: ctx.process_id },
      entityType: "grn_request",
      entityId: grnId,
      correlationId: `grn:${grnId}`,
      specOverride: spec,
      data: { ...baseData(ctx), pending_stage: STAGE_LABEL[stage], reminder_no: reminderNo },
    });
    return outcome.outcome === "sent" || outcome.outcome === "shadow";
  } catch (err) {
    console.error(`[grn-notify-email] overdue ${grnId}:`, (err as Error).message);
    return false;
  }
}
