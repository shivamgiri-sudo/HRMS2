/**
 * Follow-up pipeline, WhatsApp step: one gap after the email attempt, only 09:00 to under 20:00 IST, T1 (walk-in invite) when the
 * slot, branch address and BMI link exist, else T8 (win-back). A row whose wa_sent_at is set is never selected or claimed again.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { buildParams } from "./he-template-catalog.js";
import { dateLabel, sendTemplateToLead, timeLabel } from "./he-send.service.js";
import { displayFirstName } from "./he-name.js";
import { emptyCounts, ensureHeLead, loadSendContext, ROW_COLUMNS, toFollowupRow, type FollowupRow, type SendContext, type StepCounts } from "./qualified-followup.context.js";
import { rowTag, type FollowupSwitches, type RowTag } from "./qualified-followup.policy.js";
import { afterFailure, chooseWaTemplate, nextStepDue, nextWorkingDayIst } from "./qualified-followup.rules.js";
import { assessmentText } from "./qualified-followup.cadence.js";
import { releasePerson } from "./followup-person.service.js";
import { withinSendWindow } from "./qualified-followup.schedule.js";
import { bestOfferSkipSql } from "./he-best-offer.js";
import { markHeldBestOffer, notInIdsSql, selectWithOfferHolds } from "./he-best-offer.service.js";
import { afterFirstSend, beginJourney, gate, scopeFilter, type StepScope } from "./qualified-followup.stagea.js";
import { valueAddOn } from "./he-valueadd-switches.js";

const IST_MS = 5.5 * 3600_000;
/** Provider text can echo an address or number; neither is stored or logged. */
const scrub = (m: string) => m.replace(/[^\s@<>"',;:()]+@[^\s@<>"',;()]+/g, "[email]").replace(/\+?\d[\d ]{8,}\d/g, "[number]");
const env = (k: string, d: string) => (process.env[k]?.trim() ? process.env[k]!.trim() : d);

/** WhatsApp sends of this tag since IST midnight; the worker subtracts it from the daily budget. */
export async function pipelineWaSentToday(tag: RowTag, now: Date): Promise<number> {
  const midnight = new Date(Math.floor((now.getTime() + IST_MS) / 86_400_000) * 86_400_000).toISOString().slice(0, 10) + " 00:00:00";
  const [r] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM qualified_followup WHERE mode_at_enqueue = ? AND wa_status IN ('sent','test_sent') AND wa_sent_at >= ?", [tag, midnight]);
  return Number(r[0]?.n ?? 0);
}

/** `o` is the legacy daily budget (number) or the unified worker's StepScope (shared budget, this tick's sources, guard chain). */
export async function runWhatsappStep(s: FollowupSwitches, tag: RowTag, now: Date, o: number | StepScope, limit = 200): Promise<StepCounts> {
  const counts = emptyCounts();
  const scope = typeof o === "object" ? o : null;
  const budget = scope ? scope.budget.waLeft : (o as number);
  if (scope) limit = scope.limit ?? limit;
  // Inert unless the effective mode owns this tag; sends also need the window, budget and an unpaused kill switch. In the unified
  // method the guard chain holds out-of-window rows to the next opening instead.
  if (scope) { if (tag !== "dry_run" && s.killSwitch) return counts; }
  else if (rowTag(s) !== tag || !withinSendWindow(now)) return counts;
  if (tag !== "dry_run" && (s.sendsPaused || budget <= 0)) return counts;
  if (tag === "test" && (s.testMisconfigured || !s.testPhone)) return counts;
  const take = Math.max(1, Math.floor(tag === "dry_run" ? limit : Math.min(limit, budget)));
  const paused = [...s.pausedSources];
  const bestOffer = scope ? true : valueAddOn("best_offer");
  const sc = scope ? scopeFilter(scope) : { sql: "", params: [] as string[] };
  // Backfill refills held slots only: the merged set never exceeds `take`, so the daily budget still bounds the sends.
  const select = async (ids: string[], lim: number) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${ROW_COLUMNS} FROM qualified_followup qf
      WHERE qf.mode_at_enqueue = ? AND qf.wa_status IS NULL AND qf.wa_sent_at IS NULL AND qf.stopped_reason IS NULL
        AND qf.wa_due_at IS NOT NULL AND qf.wa_due_at <= ? AND (qf.email_due_at IS NULL OR qf.email_status IS NOT NULL) AND qf.owner = 'pipeline'${bestOfferSkipSql(bestOffer)}${sc.sql}
        ${paused.length ? `AND qf.source_type NOT IN (${paused.map(() => "?").join(",")})` : ""}${ids.length ? notInIdsSql(ids) : ""}
      ORDER BY qf.wa_due_at LIMIT ${lim}`,
      [tag, now, ...sc.params, ...paused, ...ids]);
    return rows.map(toFollowupRow);
  };
  // T12 (re-invite) approval: read once per step run, and only when a re-invite row is due.
  let t12: Promise<boolean> | null = null;
  const t12Approved = () => (t12 ??= db.execute<RowDataPacket[]>(
    "SELECT 1 AS hit FROM he_template WHERE template_key LIKE 'he_reinvite:%' AND approval_state = 'approved' AND pinbot_name IS NOT NULL LIMIT 1")
    .then(([r]) => r.length > 0, () => false));
  let list = await select([], take);
  let held: Set<string> | null = null;
  if (bestOffer) ({ rows: list, held } = await selectWithOfferHolds(list, tag, paused, select));
  if (scope && held && tag !== "dry_run") await markHeldBestOffer(held);
  for (const row of list) {
    if (held?.has(row.id)) { counts.held++; continue; }
    try {
      await processRow(s, tag, now, row, counts, t12Approved, scope);
    } catch (err) {
      logger.warn({ rowId: row.id, err: scrub((err as Error).message) }, "[qualified-followup] whatsapp step failed for row");
    }
  }
  if (scope) await runMissedCallT9(s, tag, now, scope, counts, limit, sc);
  return counts;
}

/**
 * T9 ("we tried to call you") once for a journey whose call was missed twice, then stage A is over: no more cadence touches, the person
 * is released for other requisitions and the journey waits for a re-invite (unless they replied meanwhile). Sent or not, it is not retried.
 */
async function runMissedCallT9(s: FollowupSwitches, tag: RowTag, now: Date, scope: StepScope, counts: StepCounts, limit: number, sc: { sql: string; params: string[] }): Promise<void> {
  const isDry = tag === "dry_run";
  if (!isDry && scope.budget.waLeft <= 0) return;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${ROW_COLUMNS} FROM qualified_followup qf
      WHERE qf.mode_at_enqueue = ? AND qf.missed_call_due_at IS NOT NULL AND qf.missed_call_due_at <= ? AND qf.stopped_reason IS NULL AND qf.owner = 'pipeline'${sc.sql}
      ORDER BY qf.missed_call_due_at LIMIT ${Math.max(1, Math.floor(isDry ? limit : Math.min(limit, scope.budget.waLeft)))}`,
    [tag, now, ...sc.params]);
  for (const row of rows.map(toFollowupRow)) {
    try {
      const g = await gate(s, tag, row, "whatsapp", now, scope, { firstContact: false, templateKey: "he_missed_call", dueColumn: "missed_call_due_at" });
      if (g.action === "held" || g.action === "ended") { counts.held += g.action === "held" ? 1 : 0; continue; }
      if (g.action === "send") {
        const leadId = row.heLeadId ?? (tag === "test" ? null : await ensureHeLead(row));
        if (leadId) {
          const r = await sendTemplateToLead({
            leadId, key: "he_missed_call", matchId: row.matchId, requisitionId: row.requisitionId, followupStep: true, sentBy: "followup",
            redirectTo: tag === "test" ? (s.testPhone ?? "") : undefined,
          });
          if (r.status === "sent") { counts.sent++; scope.budget.waLeft--; } else if (r.status === "failed") counts.failed++; else counts.blocked++;
        }
      } else counts.dryRun++;
      await db.execute(
        "UPDATE qualified_followup SET missed_call_due_at = NULL, stage_a_ended_at = ?, journey_state = IF(journey_state IN ('enrolled','reach'), 'reinvite_wait', journey_state) WHERE id = ?",
        [now, row.id]);
      if (!isDry) await releasePerson(row.mobile10, row.id);
      counts.processed++;
    } catch (err) {
      logger.warn({ rowId: row.id, err: scrub((err as Error).message) }, "[qualified-followup] missed-call message failed for row");
    }
  }
}

function buildExtra(row: FollowupRow, ctx: SendContext, key: "he_walkin_invite" | "he_winback" | "he_reinvite", now: Date, placeholderSlot: boolean) {
  const t1 = key !== "he_winback";
  const date = t1 && ctx.slot ? ctx.slot.date : nextWorkingDayIst(now);
  return {
    role: row.roleName, branch_name: row.branchName, branch_address: ctx.branchAddress,
    drive_date: dateLabel(date),
    slot_time: ctx.slot ? timeLabel(`${ctx.slot.date}T${ctx.slot.time}`) : placeholderSlot ? "10:00 AM" : null,
    maps_link: ctx.mapsLink, assessment_link: assessmentText(ctx.bmiLink),
  };
}

async function processRow(s: FollowupSwitches, tag: RowTag, now: Date, row0: FollowupRow, counts: StepCounts, t12Approved: () => Promise<boolean>, scope: StepScope | null): Promise<void> {
  let row = row0;
  const firstContact = row.journeyState !== "reach";
  if (scope) {
    const begun = await beginJourney(s, tag, row, now);
    if (begun.held) { counts.held++; return; }
    row = begun.row;
  }
  const isDry = tag === "dry_run";
  const isTest = tag === "test";
  if (!isDry) {
    // The engine already sent this person a WhatsApp first contact for this requisition (e.g. its follow-up record was lost and a later
    // form fill enqueued a pipeline row): a second T1/T8 is never sent. A failing read holds the row (fail closed).
    let engineInvited: boolean;
    try {
      const [m] = await db.execute<RowDataPacket[]>(
        `SELECT 1 AS hit FROM he_message WHERE mobile10 = ? AND requisition_id = ? AND direction = 'out'
            AND (template_key LIKE 'he_walkin_invite:%' OR template_key LIKE 'he_winback:%') AND delivery_status <> 'failed'${row.reinviteNo > 0 ? " AND created_at >= DATE_SUB(?, INTERVAL 7 DAY)" : ""} LIMIT 1`,
        [row.mobile10, row.requisitionId, ...(row.reinviteNo > 0 ? [now] : [])]);
      engineInvited = m.length > 0;
    } catch (err) {
      logger.warn({ rowId: row.id, err: scrub((err as Error).message) }, "[qualified-followup] engine-invite check failed; holding the row");
      counts.held++;
      return;
    }
    if (engineInvited) {
      const [b] = await db.execute<any>(
        "UPDATE qualified_followup SET wa_status = 'blocked', wa_error = ?, call_due_at = ? WHERE id = ? AND wa_status IS NULL AND wa_sent_at IS NULL AND stopped_reason IS NULL",
        ["engine_already_invited", nextStepDue(now), row.id]);
      if (Number(b?.affectedRows ?? 0) > 0) { counts.processed++; counts.blocked++; } else counts.held++;
      return;
    }
  }
  const ctx = await loadSendContext(row, { assignSlot: tag === "live", now });
  // Dry run does not assign a slot; live would when the address and BMI link exist.
  const wouldAssign = isDry && !ctx.slot && row.sourceType !== "he" && Boolean(ctx.branchAddress && ctx.bmiLink);
  // One meaning for every source: T1 when booked with a branch address (assessment = BMI link or "given at the branch"), else T8.
  const reinvite = row.reinviteNo > 0;
  const pick = chooseWaTemplate({ booked: Boolean(ctx.slot) || wouldAssign, hasBranchAddress: Boolean(ctx.branchAddress), reinvite, t12Approved: reinvite && (await t12Approved()) });
  const missing = pick.missing.join(",") || null;
  const extra = buildExtra(row, ctx, pick.key, now, wouldAssign);
  const next = nextStepDue(now);

  if (scope) {
    const g = await gate(s, tag, row, "whatsapp", now, scope, { firstContact, templateKey: pick.key });
    if (g.action === "held") { counts.held++; return; }
    if (g.action === "ended") { counts.processed++; counts.blocked++; return; }
    if (g.action === "skipped") {
      const [b] = await db.execute<any>("UPDATE qualified_followup SET wa_status = 'skipped', wa_error = ?, call_due_at = ? WHERE id = ? AND wa_status IS NULL", [g.reason, next, row.id]);
      if (Number(b?.affectedRows ?? 0) > 0) { counts.processed++; counts.blocked++; }
      return;
    }
  }

  if (isDry) {
    let error: string | null = null;
    try {
      buildParams(pick.key, "en", { candidate_name: displayFirstName(row.fullName), company: env("HE_COMPANY_NAME", "MAS Callnet"), docs_list: env("HE_DOCS_LIST", "Aadhaar, PAN, 12th marksheet"), ...extra });
    } catch (e) { error = scrub((e as Error).message).slice(0, 255); }
    const [res] = await db.execute<any>(
      "UPDATE qualified_followup SET wa_status = 'dry_run', wa_error = ?, missing_details = ?, call_due_at = ? WHERE id = ? AND wa_status IS NULL AND wa_sent_at IS NULL", [error, missing, next, row.id]);
    if (Number(res?.affectedRows ?? 0) === 0) return;
    counts.processed++; counts.dryRun++;
    return;
  }

  const [claim] = await db.execute<any>(
    "UPDATE qualified_followup SET wa_status = 'sending', step_claimed_at = NOW() WHERE id = ? AND wa_status IS NULL AND wa_sent_at IS NULL AND stopped_reason IS NULL AND owner = 'pipeline'", [row.id]);
  if (Number(claim?.affectedRows ?? 0) === 0) { counts.held++; return; }
  counts.processed++;

  const final = async (status: string, error: string | null, sent: boolean, messageId: string | null = null) => {
    await db.execute(
      `UPDATE qualified_followup SET wa_status = ?, wa_error = ?, missing_details = ?${sent ? ", wa_sent_at = NOW(), wa_message_id = ?, wa_template_key = ?" : ""}, call_due_at = ?, step_claimed_at = NULL WHERE id = ?`,
      [status, error, missing, ...(sent ? [messageId, pick.key] : []), next, row.id]);
  };

  // Test mode never writes he_lead: it only reads an existing link.
  let leadId = row.heLeadId;
  if (!leadId) {
    if (isTest) {
      const [l] = await db.execute<RowDataPacket[]>("SELECT id FROM he_lead WHERE mobile10 = ? COLLATE utf8mb4_unicode_ci LIMIT 1", [row.mobile10]);
      leadId = l[0]?.id ? String(l[0].id) : null;
    } else leadId = await ensureHeLead(row);
  }
  if (!leadId) { await final("blocked", "no_he_lead", false); counts.blocked++; return; }
  if (ctx.leadStatus === "opted_out") { await final("blocked", "opted_out", false); counts.blocked++; return; }

  const r = await sendTemplateToLead({
    leadId, key: pick.key, matchId: ctx.matchId, requisitionId: row.requisitionId, followupStep: true, extra,
    redirectTo: isTest ? (s.testPhone ?? "") : undefined, ...(scope ? { sentBy: "followup" as const } : {}),
  });
  if (r.status === "sent") {
    await final(isTest ? "test_sent" : "sent", null, true, r.messageId || null);
    counts.sent++;
    if (scope) { scope.budget.waLeft--; await afterFirstSend(s, tag, row, "whatsapp", now, scope); }
  } else if (r.status === "blocked") {
    if (r.reason === "quiet_hours" || r.reason === "paused") {
      await db.execute("UPDATE qualified_followup SET wa_status = NULL, step_claimed_at = NULL WHERE id = ? AND wa_status = 'sending'", [row.id]);
      counts.held++; counts.processed--;
    } else { await final("blocked", scrub(String(r.reason)).slice(0, 255), false); counts.blocked++; }
  } else if (r.status === "failed") {
    const err = scrub(r.error);
    const f = afterFailure(row.waAttempts, err, now);
    counts.failed++;
    if (f.status === null) {
      await db.execute(
        "UPDATE qualified_followup SET wa_status = NULL, wa_due_at = ?, wa_attempts = ?, wa_error = ?, step_claimed_at = NULL WHERE id = ?",
        [f.retryAt, f.attempts, err.slice(0, 255), row.id]);
    } else {
      await db.execute(
        "UPDATE qualified_followup SET wa_status = 'failed', wa_attempts = ?, wa_error = ?, missing_details = ?, call_due_at = ?, step_claimed_at = NULL WHERE id = ?",
        [f.attempts, err.slice(0, 255), missing, next, row.id]);
    }
  } else {
    // dry_run result cannot occur (dryRun is never passed); treat as a release rather than guess.
    await db.execute("UPDATE qualified_followup SET wa_status = NULL, step_claimed_at = NULL WHERE id = ? AND wa_status = 'sending'", [row.id]);
  }
}
