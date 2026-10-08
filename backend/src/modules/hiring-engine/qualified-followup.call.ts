/**
 * Follow-up pipeline, call step: one gap after the WhatsApp attempt, only 09:00 to under 20:00 IST. A bot call is queued only for
 * sources on QUAL_FOLLOWUP_BOT_SOURCES with Superbot configured; every other row goes to 'in_file' for the calling-file batch.
 * Every selected row leaves 'pending' except a transient bot failure (retried, at most 3 attempts then 'in_file') or a paused kill switch.
 * Nothing here marks a row terminal beyond 'skipped'/'queued'/'in_file', so the batch failure path can reset in_file -> pending.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { displayFirstName } from "./he-name.js";
import { superbotConfig } from "./he-secrets.service.js";
import { queueSuperbotCall } from "./he-superbot.service.js";
import { sbDate, sbTime } from "./he-superbot.js";
import { placeVoiceCall } from "./he-voice.service.js";
import { emptyCounts, loadSendContext, ROW_COLUMNS, toFollowupRow, type FollowupRow, type StepCounts } from "./qualified-followup.context.js";
import { rowTag, type FollowupSwitches, type RowTag } from "./qualified-followup.policy.js";
import { afterFailure, followupRef } from "./qualified-followup.rules.js";
import { withinSendWindow } from "./qualified-followup.schedule.js";
import { bestOfferSkipSql } from "./he-best-offer.js";
import { offerHolds } from "./he-best-offer.service.js";
import { valueAddOn } from "./he-valueadd-switches.js";

/** Provider text can echo the number; never store a full phone. */
const scrub = (m: string) => m.replace(/\+?\d[\d ]{8,}\d/g, "[number]").slice(0, 255);

export async function runCallStep(s: FollowupSwitches, tag: RowTag, now: Date, limit = 200): Promise<StepCounts> {
  const counts = emptyCounts();
  if (rowTag(s) !== tag || !withinSendWindow(now)) return counts;
  if (tag !== "dry_run" && s.sendsPaused) return counts;
  if (tag === "test" && (s.testMisconfigured || !s.testPhone)) return counts;
  const paused = [...s.pausedSources];
  const bestOffer = valueAddOn("best_offer");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${ROW_COLUMNS} FROM qualified_followup qf
      WHERE qf.mode_at_enqueue = ? AND qf.call_state = 'pending' AND qf.stopped_reason IS NULL
        AND qf.call_due_at IS NOT NULL AND qf.call_due_at <= ? AND qf.owner = 'pipeline'${bestOfferSkipSql(bestOffer)}
        AND (qf.email_due_at IS NULL OR (qf.email_status IS NOT NULL AND qf.email_status <> 'sending')) AND qf.wa_status IS NOT NULL AND qf.wa_status <> 'sending'
        ${paused.length ? `AND qf.source_type NOT IN (${paused.map(() => "?").join(",")})` : ""}
      ORDER BY qf.call_due_at LIMIT ${Math.max(1, Math.floor(limit))}`,
    [tag, now, ...paused]);
  const list = rows.map(toFollowupRow);
  const holds = bestOffer ? await offerHolds(list, tag) : null;
  const botOn = tag !== "dry_run" && s.botSources.size > 0 && (await superbotConfig()) !== null;
  for (const row of list) {
    if (holds?.held.has(row.id)) { counts.held++; continue; }
    try {
      await processRow(s, tag, now, row, botOn, counts);
    } catch (err) {
      logger.warn({ rowId: row.id, err: scrub((err as Error).message) }, "[qualified-followup] call step failed for row");
    }
  }
  return counts;
}

async function toFile(row: FollowupRow, error: string | null, counts: StepCounts, dry: boolean): Promise<void> {
  const [res] = await db.execute<any>(
    "UPDATE qualified_followup SET call_state = 'in_file', call_error = ? WHERE id = ? AND call_state IN ('pending','queued') AND stopped_reason IS NULL AND owner = 'pipeline'", [error, row.id]);
  if (Number(res?.affectedRows ?? 0) === 0) return;
  counts.processed++;
  if (dry) counts.dryRun++;
}

async function processRow(s: FollowupSwitches, tag: RowTag, now: Date, row: FollowupRow, botOn: boolean, counts: StepCounts): Promise<void> {
  if (tag === "dry_run" || !botOn || !s.botSources.has(row.sourceType)) return toFile(row, null, counts, tag === "dry_run");
  const isTest = tag === "test";
  const useVoice = row.sourceType === "he";
  // Test mode cannot redirect placeVoiceCall (it calls the match's own lead), so he rows go to the file instead.
  if (useVoice && isTest) return toFile(row, null, counts, false);

  let matchId: string | null = null;
  let params: { name: string; role: string; interview_date: string; interview_time: string; branch_address: string } | null = null;
  const ctx = await loadSendContext(row, { assignSlot: false, now });
  if (useVoice) {
    matchId = ctx.matchId;
    if (!matchId) return toFile(row, "no_match", counts, false);
  } else {
    if (!ctx.slot || !ctx.branchAddress) return toFile(row, ctx.slot ? "no_branch_address" : "no_slot", counts, false);
    params = { name: displayFirstName(row.fullName), role: row.roleName ?? "the role", interview_date: sbDate(ctx.slot.date), interview_time: sbTime(ctx.slot.time), branch_address: ctx.branchAddress };
  }

  // Claim before the provider call: a crash afterwards leaves 'queued', never a second bot call. Stop or another process wins the race otherwise.
  const [claim] = await db.execute<any>(
    "UPDATE qualified_followup SET call_state = 'queued', call_error = NULL WHERE id = ? AND call_state = 'pending' AND stopped_reason IS NULL AND owner = 'pipeline'", [row.id]);
  if (Number(claim?.affectedRows ?? 0) === 0) { counts.held++; return; }
  counts.processed++;

  let result: { kind: "placed" } | { kind: "skip"; reason: string } | { kind: "fail"; error: string; transient: boolean } | { kind: "paused" };
  try {
    if (matchId) {
      const p = await placeVoiceCall(matchId, { dryRun: false });
      if (p.status === "placed") result = { kind: "placed" };
      else if (p.status === "failed") result = { kind: "fail", error: p.error, transient: true };
      else if (p.status === "dry_run") result = { kind: "fail", error: "voice_dry_run", transient: false };
      else if (p.reason === "already_queued") result = { kind: "placed" };
      else if (p.reason === "paused") result = { kind: "paused" };
      // A person must not phone someone who opted out, was dropped, or whose requisition closed.
      else if (/^lead_|^requisition_closed$|^no_consent$/.test(p.reason)) result = { kind: "skip", reason: p.reason };
      else result = { kind: "fail", error: p.reason, transient: false };
    } else {
      const q = await queueSuperbotCall({ referenceId: followupRef(row.id), mobile10: isTest ? (s.testPhone as string) : row.mobile10, params: params! });
      result = q.ok ? { kind: "placed" } : { kind: "fail", error: `${q.reason}: ${q.error}`, transient: q.reason === "provider_error" };
    }
  } catch (err) {
    result = { kind: "fail", error: (err as Error).message, transient: true };
  }

  // The provider call is done: record it in its own try so a recording failure never changes the outcome (row stays 'queued').
  try {
    if (result.kind === "placed") {
      counts.sent++;
    } else if (result.kind === "skip") {
      await db.execute("UPDATE qualified_followup SET call_state = 'skipped', call_error = ? WHERE id = ? AND call_state = 'queued'", [scrub(result.reason), row.id]);
      counts.blocked++;
    } else if (result.kind === "paused") {
      await db.execute("UPDATE qualified_followup SET call_state = 'pending' WHERE id = ? AND call_state = 'queued'", [row.id]);
      counts.held++; counts.processed--;
    } else {
      counts.failed++;
      const f = result.transient ? afterFailure(row.callAttempts, result.error, now) : { status: "failed" as const, attempts: row.callAttempts + 1, retryAt: null };
      if (f.status === null) {
        await db.execute(
          "UPDATE qualified_followup SET call_state = 'pending', call_due_at = ?, call_attempts = ?, call_error = ? WHERE id = ? AND call_state = 'queued'",
          [f.retryAt, f.attempts, scrub(result.error), row.id]);
      } else {
        await db.execute(
          "UPDATE qualified_followup SET call_state = 'in_file', call_attempts = ?, call_error = ? WHERE id = ? AND call_state = 'queued'",
          [f.attempts, scrub(result.error), row.id]);
      }
    }
  } catch (err) {
    logger.warn({ rowId: row.id, err: scrub((err as Error).message) }, "[qualified-followup] call placed/decided but recording failed; row left queued");
  }
}
