/**
 * Stage A of the unified follow-up (email -> WhatsApp -> call) for every source: the journey is booked and the person claimed before
 * its first send, every send passes the one guard chain with the shared WhatsApp budget and canary caps, dry_run writes shadow rows
 * instead of sending, and the first successful send records the first contact. The step modules call these helpers.
 */
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { checkFollowupGuards, type GuardReason, type GuardStep } from "./followup-guards.js";
import { branchFirstContactsToday, recordGuardSkip } from "./followup-guards.service.js";
import { loadGuardFacts } from "./followup-guard-facts.service.js";
import { bookJourney, markInvitedAfterSend } from "./followup-booking.service.js";
import { claimPerson, notePersonFirstContact, personFacts, releasePerson } from "./followup-person.service.js";
import { canaryCapFor, type FollowupSwitches } from "./qualified-followup.policy.js";
import { recordShadow } from "./qualified-followup.shadow.js";
import type { FollowupRow } from "./qualified-followup.context.js";
import type { RowTag, SourceType } from "./qualified-followup.types.js";

/** Shared across stage B then stage A within one tick. */
export interface BudgetState { waLeft: number; branchLeft: Map<string, number> }
export interface StepScope { sources: SourceType[]; budget: BudgetState; limit?: number }
export type GateResult = { action: "send" } | { action: "held" | "skipped" | "ended"; reason: GuardReason } | { action: "shadowed"; verdict: "would_send" | GuardReason };

export const newBudget = (waLeft: number): BudgetState => ({ waLeft: Math.max(0, waLeft), branchLeft: new Map() });

/** Rows of this tick's sources, still in stage A. */
export function scopeFilter(o: StepScope): { sql: string; params: string[] } {
  return { sql: ` AND qf.source_type IN (${o.sources.map(() => "?").join(",")}) AND qf.journey_state IN ('enrolled','reach')`, params: [...o.sources] };
}

const DUE: Record<Exclude<GuardStep, "call_file">, string> = { email: "email_due_at", whatsapp: "wa_due_at", call: "call_due_at" };
const RETRY_MIN = 15;

/** Before a journey's first send: book it (simulated for dry_run and test rows other than the owner's phone), then claim the person. */
export async function beginJourney(s: FollowupSwitches, tag: RowTag, row: FollowupRow, now: Date): Promise<{ row: FollowupRow; held: boolean }> {
  if (row.journeyState !== "enrolled" && row.journeyState !== "held_best_offer") return { row, held: false };
  let r = row;
  if (!r.matchId) {
    const simulate = tag === "dry_run" || (tag === "test" && r.mobile10 !== s.testPhone);
    const b = await bookJourney(r, { now, simulate });
    if (b.status === "booked") r = { ...r, matchId: b.matchId, driveId: b.driveId };
  }
  if (tag === "dry_run") {
    const holder = (await personFacts(r.mobile10)).activeFollowupId;
    return { row: r, held: holder !== null && holder !== r.id };
  }
  if (!(await claimPerson(r.mobile10, r.id))) {
    await db.execute("UPDATE qualified_followup SET journey_state = 'held_best_offer' WHERE id = ? AND journey_state IN ('enrolled','held_best_offer')", [r.id]);
    return { row: r, held: true };
  }
  return { row: r, held: false };
}

async function branchCapLeft(s: FollowupSwitches, tag: RowTag, row: FollowupRow, now: Date, scope: StepScope, firstContact: boolean): Promise<number | null> {
  if (tag !== "canary" || !firstContact) return null;
  const { prefix, cap } = canaryCapFor(s, row.branchName);
  if (!scope.budget.branchLeft.has(prefix)) scope.budget.branchLeft.set(prefix, cap - (prefix ? await branchFirstContactsToday(prefix, now) : 0));
  return scope.budget.branchLeft.get(prefix) as number;
}

/** One guard decision for a stage A step; applies hold / end itself, returns skip for the step to record. */
export async function gate(
  s: FollowupSwitches, tag: RowTag, row: FollowupRow, step: Exclude<GuardStep, "call_file">, now: Date, scope: StepScope,
  o: { firstContact: boolean; templateKey: string | null },
): Promise<GateResult> {
  const facts = await loadGuardFacts({
    row, step, now, transactional: false, firstContact: o.firstContact, cadenceStep: true, stage: "A",
    killSwitch: s.killSwitch, sourcePaused: s.pausedSources.has(row.sourceType), waBudgetLeft: scope.budget.waLeft,
    branchCapLeft: await branchCapLeft(s, tag, row, now, scope, o.firstContact), uploadWaAllowed: s.uploadWa,
  });
  const v = checkFollowupGuards(facts);
  if (tag === "dry_run") {
    await recordShadow(row, step, v.ok ? "would_send" : v.reason, o.templateKey, now);
    return { action: "shadowed", verdict: v.ok ? "would_send" : v.reason };
  }
  if (v.ok) return { action: "send" };
  await recordGuardSkip(row.id, row.heLeadId, step, v.reason, now).catch((err: unknown) => logger.warn({ rowId: row.id, err: (err as Error).message }, "[qualified-followup] skip audit failed"));
  if (v.kind === "hold") {
    await db.execute(`UPDATE qualified_followup SET ${DUE[step]} = ? WHERE id = ?`, [v.retryAt ?? new Date(now.getTime() + RETRY_MIN * 60_000), row.id]);
    return { action: "held", reason: v.reason };
  }
  if (v.kind === "end_journey") {
    await db.execute(
      "UPDATE qualified_followup SET stopped_reason = ?, stopped_at = NOW(), journey_state = 'stopped', call_state = IF(call_state = 'pending', 'skipped', call_state) WHERE id = ? AND stopped_reason IS NULL",
      [v.reason, row.id]);
    await releasePerson(row.mobile10, row.id);
    return { action: "ended", reason: v.reason };
  }
  return { action: "skipped", reason: v.reason };
}

/** The Meta funnel's "Notified" keeps working: the first successful step stamps notification_sent_at and appends its channel. */
export async function mirrorNotified(row: FollowupRow, channel: "email" | "whatsapp" | "call", at: Date): Promise<void> {
  if (!row.metaLeadId) return;
  await db.execute(
    "UPDATE meta_lead_raw SET notification_sent_at = COALESCE(notification_sent_at, ?), notification_channels = JSON_ARRAY_APPEND(COALESCE(notification_channels, JSON_ARRAY()), '$', ?) WHERE id = ? AND NOT JSON_CONTAINS(COALESCE(notification_channels, JSON_ARRAY()), JSON_QUOTE(?))",
    [at, channel, row.metaLeadId, channel]);
}

/** After a successful stage A send (live / canary / test). Test rows reached the owner, not the person: nothing about the person is recorded. */
export async function afterFirstSend(s: FollowupSwitches, tag: RowTag, row: FollowupRow, channel: "email" | "whatsapp" | "call", now: Date, scope: StepScope): Promise<void> {
  const first = row.journeyState !== "reach";
  if (first) await db.execute("UPDATE qualified_followup SET journey_state = 'reach' WHERE id = ? AND journey_state = 'enrolled'", [row.id]);
  if (tag === "test") return;
  if (first) {
    await notePersonFirstContact(row.mobile10, now, { reinvite: row.reinviteNo > 0 });
    if (row.matchId) await markInvitedAfterSend(row.matchId);
    if (tag === "canary") {
      const { prefix } = canaryCapFor(s, row.branchName);
      const left = scope.budget.branchLeft.get(prefix);
      if (left !== undefined) scope.budget.branchLeft.set(prefix, left - 1);
    }
  }
  await mirrorNotified(row, channel, now);
}
