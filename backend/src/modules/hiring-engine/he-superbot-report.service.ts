/**
 * Applies a downloaded Superbot call report to the Hiring Engine: each row is one finished call, found through its HRMS-001 style reference,
 * and recorded exactly as the live webhook would (confirmed -> confirmed + confirmation sent, declined -> hand-off, unreached -> retry path,
 * early hang-up -> noted, nobody marked declined). Calls are deduped on Superbot's unique call id, so the same file can be uploaded twice safely.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { addEvent } from "./he-lead.service.js";
import { recordVoiceResult } from "./he-ingest.service.js";
import { matchForRef } from "./he-call-ref.service.js";
import { mapSuperbotFeedback } from "./he-superbot.js";
import { reportRowToFeedback } from "./he-superbot-report.js";
import { callOutcome } from "./he-signals.js";

export interface ReportSummary {
  rows: number; matched: number; unmatched: number; unreadable: number; alreadyLoaded: number;
  outcomes: Record<string, number>; humanFollowUps: number; problems: Array<{ row: number; reason: string }>;
}
const label = (o: string, incomplete: boolean) => incomplete ? "Ended early (needs a person)" : ({
  WALKIN_CONFIRMED_YES: "Will attend (confirmed)", WALKIN_RESCHEDULED: "Rescheduled", WALKIN_DECLINED_NEEDS_FOLLOWUP: "Will not attend (hand-off)",
  NO_ANSWER: "Not reached (hung up or no answer)", CALL_FAILED: "Call failed", WRONG_PERSON_REACHED: "Wrong person",
} as Record<string, string>)[o] ?? o;

export async function applySuperbotReport(rows: Array<Record<string, unknown>>, o: { dryRun: boolean; actor: string | null }): Promise<ReportSummary> {
  const sum: ReportSummary = { rows: rows.length, matched: 0, unmatched: 0, unreadable: 0, alreadyLoaded: 0, outcomes: {}, humanFollowUps: 0, problems: [] };
  for (let i = 0; i < rows.length; i++) {
    const rr = reportRowToFeedback(rows[i]);
    if (!rr) { sum.unreadable++; continue; }
    const mapped = mapSuperbotFeedback(rr.feedback);
    const matchId = await matchForRef(rr.feedback.reference_id);
    let lead: { id: string; mobile10: string } | null = null;
    if (matchId) {
      const [m] = await db.execute<RowDataPacket[]>("SELECT l.id, l.mobile10 FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.id = ? LIMIT 1", [matchId]);
      if (m[0]) lead = { id: String(m[0].id), mobile10: String(m[0].mobile10) };
    }
    if (!lead) { sum.unmatched++; if (sum.problems.length < 20) sum.problems.push({ row: i + 2, reason: `reference ${rr.feedback.reference_id ?? "(none)"} is not one of ours` }); continue; }
    if (rr.phone10 && rr.phone10 !== lead.mobile10) { sum.unmatched++; if (sum.problems.length < 20) sum.problems.push({ row: i + 2, reason: `${rr.feedback.reference_id} belongs to a different number` }); continue; }
    sum.matched++;
    const providerCallId = (rr.uniqueCallId ?? mapped.providerCallId).slice(0, 120);
    const [dup] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_call WHERE provider_call_id = ? LIMIT 1", [providerCallId]);
    if (dup.length) { sum.alreadyLoaded++; continue; }
    const bucket = label(callOutcome(mapped.result), mapped.incomplete);
    sum.outcomes[bucket] = (sum.outcomes[bucket] ?? 0) + 1;
    if (mapped.humanFollowUp) sum.humanFollowUps++;
    if (o.dryRun) continue;
    try {
      const out = await recordVoiceResult({ leadId: lead.id, providerCallId, attemptNo: rr.attemptNo ?? 1, startedAt: rr.dialTime, result: mapped.result, summary: mapped.summary, recordingUrl: mapped.recordingUrl, incomplete: mapped.incomplete });
      if (mapped.humanFollowUp && out && out.outcome !== "duplicate") await addEvent(lead.id, "human_followup_needed", { channel: "voice", detail: mapped.humanFollowUp, meta: { matchId, disposition: rr.feedback.disposition ?? null, source: "report_upload", by: o.actor } });
    } catch (e) { sum.problems.push({ row: i + 2, reason: (e instanceof Error ? e.message : String(e)).slice(0, 120) }); }
  }
  return sum;
}
