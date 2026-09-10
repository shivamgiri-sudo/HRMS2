/**
 * NOC Certificate (Exit Clearance) — notification producers.
 *
 * One function per registered event, modelled on payroll.notifications.ts. Every one is
 * individually try/caught and returns rather than throws: these are called fire-and-forget from
 * paths where the state change has already committed, and a mail failure must never surface as
 * "your form did not save" or roll back a recorded signature.
 *
 * WHY THE SIGNATORY EVENTS PASS specOverride
 *
 * Each of the eight signatories is a different role, resolved against the case's own branch. The
 * stored `role_scope` selector cannot express that — its scope is a static branchIds list in the
 * JSON and it never reads context.branchId (recipient-resolver.ts). specOverride is a first-class
 * field on NotifyInput and overrides ONLY recipient resolution, so the kill switch, daily cap,
 * cooldown, dispatch claim, dedupe and audit trail all still apply. The alternatives were eight
 * events per notification type or a new selector kind touching every notification in the system.
 *
 * EMAIL IS THE ONLY CHANNEL THAT WORKS
 *
 * The spec asks for WhatsApp/SMS/Email on the invite. As at 2026-08 this system has delivered
 * 0 SMS against 901 failures and 0 WhatsApp against 903 — SmartPing rejects sends for a missing
 * DLT template, and no WhatsApp provider is configured. sendInviteSms() below therefore attempts
 * the send and reports the outcome honestly instead of pretending; the route also returns the URL
 * so HR can paste it into WhatsApp by hand, which is the only reliable non-email path today.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { notificationGateway } from "../communication/notification.gateway.js";
import type { RecipientSpec } from "../../shared/recipient-resolver.types.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";
import { inboxService } from "../inbox/inbox.service.js";

function frontendBaseUrl(): string {
  return String(env.FRONTEND_URL ?? "https://mcnhrms.teammas.in").replace(/\/+$/, "");
}

/** Deep link to the authenticated case screen — where a signatory records their decision. */
function caseUrl(caseId: string): string {
  return `${frontendBaseUrl()}/payroll/noc?case=${caseId}`;
}

interface CaseContext extends RowDataPacket {
  id: string;
  employee_id: string;
  branch_id: string | null;
  process_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  location: string | null;
  resignation_date: string | null;
  last_working_day: string | null;
  fnf_option: string | null;
  fnf_option_suggested: string | null;
  status: string;
  decline_reason: string | null;
}

async function loadCase(caseId: string): Promise<CaseContext | null> {
  const [rows] = await db.execute<CaseContext[]>(
    `SELECT id, employee_id, branch_id, process_id, employee_code, employee_name, location,
            resignation_date, last_working_day, fnf_option, fnf_option_suggested, status,
            decline_reason
       FROM noc_case WHERE id = ? LIMIT 1`,
    [caseId],
  );
  return rows[0] ?? null;
}

interface StageContext extends RowDataPacket {
  stage_key: string;
  stage_label: string;
  role_key: string;
  fallback_role_key: string | null;
  sla_due_at: string | null;
  remarks: string | null;
  acted_by_name: string | null;
}

async function loadStage(caseId: string, stageKey: string): Promise<StageContext | null> {
  const [rows] = await db.execute<StageContext[]>(
    `SELECT s.stage_key, s.stage_label, s.role_key, s.fallback_role_key, s.sla_due_at,
            s.remarks, s.acted_by_name
       FROM noc_signatory s
      WHERE s.noc_case_id = ? AND s.stage_key = ? LIMIT 1`,
    [caseId, stageKey],
  );
  return rows[0] ?? null;
}

async function stageVerifyHint(stageKey: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT verify_hint FROM noc_signatory_template WHERE stage_key = ? LIMIT 1`, [stageKey]);
  return String(rows[0]?.verify_hint ?? "Please review and record your decision.");
}

/**
 * Recipient spec for "the holders of this stage's role at this branch".
 *
 * Both role_key and fallback_role_key are included. The fallback exists because several of these
 * roles have compat aliases whose mirroring cannot be assumed to have run (045_role_compat.sql
 * mirrors tl -> team_leader and manager -> process_manager), and addressing only the canonical key
 * would silently reach nobody at an installation using the other.
 *
 * cc goes to branch HR so a stage that resolves to no role holder at all is still seen by someone.
 * roleScopeRows requires an auth_user join, so a branch with the role assigned to nobody with a
 * login yields zero recipients — and resolveRecipients throws EMPTY_TO on an empty `to`, which the
 * gateway records as undeliverable. HR in cc does not prevent that throw; it is there so the
 * common case of "role holder exists but has no company email" still reaches a human.
 */
function stageSpec(stage: StageContext, branchId: string | null): RecipientSpec {
  const roleKeys = [stage.role_key, stage.fallback_role_key].filter((r): r is string => Boolean(r));
  return {
    to: [{
      kind: "role_scope",
      roleKeys,
      scope: branchId ? { type: "branch", branchIds: [branchId] } : { type: "all" },
      limit: 10,
    }],
    cc: branchId ? [{ kind: "branch_hr", branchId }] : [],
  };
}

/**
 * In-app bell for the same recipients.
 *
 * The gateway's deliverer already mirrors email recipients into work_inbox_item, but only those it
 * could find a deliverable ADDRESS for. resolveRoleHolderUserIds exists precisely for this gap: a
 * role holder with a login but no usable email still gets the task in their inbox, which for a
 * clearance that blocks someone's salary is the difference between a delay and a silent stall.
 */
async function inboxForStage(
  stage: StageContext,
  nocCase: CaseContext,
  type: string,
  title: string,
  priority: "normal" | "high" = "normal",
): Promise<void> {
  const roleKeys = [stage.role_key, stage.fallback_role_key].filter((r): r is string => Boolean(r));
  const userIds = new Set<string>();
  for (const rk of roleKeys) {
    for (const id of await resolveRoleHolderUserIds(rk, nocCase.branch_id)) userIds.add(id);
  }
  for (const userId of userIds) {
    await inboxService.createItem({
      user_id: userId,
      type,
      title,
      description: `${nocCase.employee_name ?? ""} (${nocCase.employee_code ?? ""}) — ${stage.stage_label} clearance`,
      entity_type: "noc_case",
      entity_id: nocCase.id,
      action_url: `/payroll/noc?case=${nocCase.id}`,
      priority,
    }).catch(() => { /* the bell is a mirror; never the reason a notification fails */ });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Invite
// ─────────────────────────────────────────────────────────────────────────────

export interface InviteDelivery {
  emailed: boolean;
  channels: string[];
  smsAttempted: boolean;
  smsError: string | null;
  outcome: string;
}

/**
 * Send the employee their form link.
 *
 * The gateway is the sender, not a direct emailService call, so the invite inherits the dedupe
 * claim and the audit trail. dedupeKey carries the invite id, so a resend (which mints a new
 * token) is a genuinely new notification rather than a duplicate suppressed by the claim.
 */
export async function notifyInviteSent(
  caseId: string,
  invite: { inviteId: string; url: string; expiresAt: string; email: string | null; mobile: string | null },
): Promise<InviteDelivery> {
  const result: InviteDelivery = {
    emailed: false, channels: [], smsAttempted: false, smsError: null, outcome: "not_sent",
  };
  try {
    const nocCase = await loadCase(caseId);
    if (!nocCase) return result;

    const outcome = await notificationGateway.notify({
      eventCode: "noc_invite_sent",
      dedupeKey: `noc_case:${caseId}:invite:${invite.inviteId}`,
      context: { employeeId: nocCase.employee_id, branchId: nocCase.branch_id },
      entityType: "noc_case",
      entityId: caseId,
      correlationId: `noc_case:${caseId}`,
      data: {
        employee_name: nocCase.employee_name,
        employee_code: nocCase.employee_code,
        location: nocCase.location,
        noc_form_url: invite.url,
        expires_on: invite.expiresAt ? String(invite.expiresAt).slice(0, 10) : "",
      },
    });
    result.outcome = outcome.outcome;
    result.emailed = outcome.outcome === "sent";
    if (result.emailed) result.channels.push("email");

    await db.execute(
      `UPDATE noc_invite SET sent_at = COALESCE(sent_at, NOW()), channels_sent = ? WHERE id = ?`,
      [result.channels.join(",") || null, invite.inviteId],
    ).catch(() => undefined);

    if (invite.mobile) {
      const sms = await sendInviteSms(invite.mobile, invite.url);
      result.smsAttempted = true;
      result.smsError = sms.error;
      if (sms.sent) result.channels.push("sms");
    }
  } catch (err) {
    console.error(`[noc-notify] invite ${caseId}:`, (err as Error).message);
  }
  return result;
}

/**
 * Attempt the SMS, and report the truth about it.
 *
 * buildSMS() throws "Unknown SmartPing DLT template key" for anything not in
 * smartping-dlt-registry.ts, and there is no registered template carrying an arbitrary URL — the
 * nearest, `onboarding_link`, does not even have a URL variable. So this is expected to fail until
 * a DLT template is registered with the operator. Wired anyway, and reporting its error to the
 * caller, so the day a template exists this starts working with no code change, and until then the
 * UI can say "SMS not available" instead of implying the employee was texted.
 */
async function sendInviteSms(mobile: string, url: string): Promise<{ sent: boolean; error: string | null }> {
  try {
    const { sendSMS } = await import("../communication/sms.helper.js");
    const res = await sendSMS(mobile, "onboarding_link", { link: url });
    return { sent: Boolean(res?.success), error: res?.success ? null : (res?.error ?? "SMS provider rejected the send") };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Employee submitted
// ─────────────────────────────────────────────────────────────────────────────

export async function notifyEmployeeSubmitted(caseId: string): Promise<void> {
  try {
    const nocCase = await loadCase(caseId);
    if (!nocCase) return;

    await notificationGateway.notify({
      eventCode: "noc_employee_submitted",
      dedupeKey: `noc_case:${caseId}:employee_submitted`,
      context: { employeeId: nocCase.employee_id, branchId: nocCase.branch_id },
      entityType: "noc_case",
      entityId: caseId,
      correlationId: `noc_case:${caseId}`,
      data: {
        employee_name: nocCase.employee_name,
        employee_code: nocCase.employee_code,
        location: nocCase.location,
        resignation_date: nocCase.resignation_date,
        noc_case_url: caseUrl(caseId),
      },
    });

    // Tier 1 is open the moment the form lands, so notify it in the same breath rather than
    // waiting for someone to notice the case exists.
    const { actionableStages } = await import("./noc-case.service.js");
    for (const stage of await actionableStages(caseId)) {
      await notifySignatoryPending(caseId, stage.stage_key);
    }
  } catch (err) {
    console.error(`[noc-notify] employee_submitted ${caseId}:`, (err as Error).message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Signatory pending
// ─────────────────────────────────────────────────────────────────────────────

export async function notifySignatoryPending(caseId: string, stageKey: string): Promise<void> {
  try {
    const [nocCase, stage] = await Promise.all([loadCase(caseId), loadStage(caseId, stageKey)]);
    if (!nocCase || !stage) return;

    await notificationGateway.notify({
      eventCode: "noc_signatory_pending",
      // Stage-scoped so each of the eight is claimed independently — a single per-case key would
      // let the first stage's claim suppress the other seven.
      dedupeKey: `noc_case:${caseId}:pending:${stageKey}`,
      context: { employeeId: nocCase.employee_id, branchId: nocCase.branch_id, processId: nocCase.process_id },
      entityType: "noc_case",
      entityId: caseId,
      correlationId: `noc_case:${caseId}`,
      specOverride: stageSpec(stage, nocCase.branch_id),
      data: {
        employee_name: nocCase.employee_name,
        employee_code: nocCase.employee_code,
        location: nocCase.location,
        stage_label: stage.stage_label,
        verify_hint: await stageVerifyHint(stageKey),
        sla_due_at: stage.sla_due_at ? String(stage.sla_due_at).slice(0, 16).replace("T", " ") : "as soon as possible",
        noc_case_url: caseUrl(caseId),
      },
    });

    await db.execute(
      `UPDATE noc_signatory SET notified_at = COALESCE(notified_at, NOW())
        WHERE noc_case_id = ? AND stage_key = ?`, [caseId, stageKey]).catch(() => undefined);

    await inboxForStage(stage, nocCase, "noc_signatory_pending",
      `NOC clearance awaiting your sign-off — ${nocCase.employee_name ?? nocCase.employee_code ?? ""}`);
  } catch (err) {
    console.error(`[noc-notify] signatory_pending ${caseId}/${stageKey}:`, (err as Error).message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Signatory reminder / escalation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SLA reminder, called by the worker.
 *
 * escalate adds the Branch Head to cc. The spec asks for escalation "to the next level up", and
 * Branch Head is the common superior of every tier-5 department as well as of the operations
 * chain — resolving a true per-stage parent would need an org model this data does not carry
 * (owner_user_id is NULL on every clearance row in the sibling table, and 20% of employees have no
 * reachable reporting manager).
 *
 * dedupeKey carries the reminder ordinal so each successive reminder is its own claim; without it
 * the first would permanently suppress the rest.
 */
export async function notifySignatoryReminder(
  caseId: string,
  stageKey: string,
  reminderNo: number,
  escalate: boolean,
): Promise<boolean> {
  try {
    const [nocCase, stage] = await Promise.all([loadCase(caseId), loadStage(caseId, stageKey)]);
    if (!nocCase || !stage) return false;

    const spec = stageSpec(stage, nocCase.branch_id);
    if (escalate && nocCase.branch_id) {
      spec.cc = [...(spec.cc ?? []), { kind: "branch_head", branchId: nocCase.branch_id }];
    }

    const outcome = await notificationGateway.notify({
      eventCode: "noc_signatory_reminder",
      dedupeKey: `noc_case:${caseId}:reminder:${stageKey}:${reminderNo}`,
      context: { employeeId: nocCase.employee_id, branchId: nocCase.branch_id },
      entityType: "noc_case",
      entityId: caseId,
      correlationId: `noc_case:${caseId}`,
      specOverride: spec,
      data: {
        employee_name: nocCase.employee_name,
        employee_code: nocCase.employee_code,
        location: nocCase.location,
        stage_label: stage.stage_label,
        sla_due_at: stage.sla_due_at ? String(stage.sla_due_at).slice(0, 16).replace("T", " ") : "",
        noc_case_url: caseUrl(caseId),
      },
    });

    await inboxForStage(stage, nocCase, "noc_signatory_reminder",
      `OVERDUE: NOC clearance sign-off — ${nocCase.employee_name ?? nocCase.employee_code ?? ""}`, "high");

    return outcome.outcome === "sent" || outcome.outcome === "shadow";
  } catch (err) {
    console.error(`[noc-notify] signatory_reminder ${caseId}/${stageKey}:`, (err as Error).message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Declined
// ─────────────────────────────────────────────────────────────────────────────

export async function notifyDeclined(caseId: string, stageKey: string): Promise<void> {
  try {
    const [nocCase, stage] = await Promise.all([loadCase(caseId), loadStage(caseId, stageKey)]);
    if (!nocCase || !stage) return;

    await notificationGateway.notify({
      eventCode: "noc_declined",
      dedupeKey: `noc_case:${caseId}:declined:${stageKey}`,
      context: { employeeId: nocCase.employee_id, branchId: nocCase.branch_id },
      entityType: "noc_case",
      entityId: caseId,
      correlationId: `noc_case:${caseId}`,
      data: {
        employee_name: nocCase.employee_name,
        employee_code: nocCase.employee_code,
        location: nocCase.location,
        stage_label: stage.stage_label,
        decline_reason: nocCase.decline_reason ?? stage.remarks ?? "No reason recorded",
        noc_case_url: caseUrl(caseId),
      },
    });

    // HR owns resolution, so HR gets the bell regardless of whether an email address resolved.
    for (const userId of await resolveRoleHolderUserIds("hr", nocCase.branch_id)) {
      await inboxService.createItem({
        user_id: userId,
        type: "noc_declined",
        title: `NOC declined at ${stage.stage_label} — ${nocCase.employee_name ?? nocCase.employee_code ?? ""}`,
        description: nocCase.decline_reason ?? stage.remarks ?? "No reason recorded",
        entity_type: "noc_case",
        entity_id: caseId,
        action_url: `/payroll/noc?case=${caseId}`,
        priority: "high",
      }).catch(() => undefined);
    }
  } catch (err) {
    console.error(`[noc-notify] declined ${caseId}/${stageKey}:`, (err as Error).message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Completed
// ─────────────────────────────────────────────────────────────────────────────

const FNF_LABEL: Record<string, string> = {
  current_payroll: "Current Payroll",
  "45_days": "45 Days of Leaving Date",
  both: "Both Current Payroll & 45 Days",
};

export async function notifyCompleted(caseId: string): Promise<void> {
  try {
    const nocCase = await loadCase(caseId);
    if (!nocCase) return;

    const route = nocCase.fnf_option ?? nocCase.fnf_option_suggested;
    await notificationGateway.notify({
      eventCode: "noc_completed",
      dedupeKey: `noc_case:${caseId}:completed`,
      context: { employeeId: nocCase.employee_id, branchId: nocCase.branch_id },
      entityType: "noc_case",
      entityId: caseId,
      correlationId: `noc_case:${caseId}`,
      data: {
        employee_name: nocCase.employee_name,
        employee_code: nocCase.employee_code,
        location: nocCase.location,
        last_working_day: nocCase.last_working_day ?? "not recorded",
        fnf_option: route ? (FNF_LABEL[route] ?? route) : "to be decided by Finance",
        noc_case_url: caseUrl(caseId),
      },
    });

    // Distribution for records and audit. The completed clearance is what Payroll and MIS work
    // from, and neither is a recipient of the employee-facing email above.
    for (const role of ["hr", "payroll_head", "payroll_hr"]) {
      for (const userId of await resolveRoleHolderUserIds(role, nocCase.branch_id)) {
        await inboxService.createItem({
          user_id: userId,
          type: "noc_completed",
          title: `NOC complete — ${nocCase.employee_name ?? nocCase.employee_code ?? ""}`,
          description: `Salary and F&F release is unblocked. Settlement route: ${route ? (FNF_LABEL[route] ?? route) : "not set"}.`,
          entity_type: "noc_case",
          entity_id: caseId,
          action_url: `/payroll/noc?case=${caseId}`,
          priority: "normal",
        }).catch(() => undefined);
      }
    }

    // Close out the per-signatory inbox tasks for this case — they are done, and leaving them
    // open is how a work inbox becomes noise people stop reading.
    await inboxService.resolveItems({
      entity_type: "noc_case",
      entity_id: caseId,
      types: ["noc_signatory_pending", "noc_signatory_reminder"],
    }).catch(() => undefined);
  } catch (err) {
    console.error(`[noc-notify] completed ${caseId}:`, (err as Error).message);
  }
}
