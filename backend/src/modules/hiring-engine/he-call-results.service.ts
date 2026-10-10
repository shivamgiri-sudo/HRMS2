/**
 * Applies results reported by the third-party calling tool. Each row goes through recordVoiceResult - the same capture
 * path as an engine call - so it lands in the call log, signals, lead status, the Meta lead mirror and the insight.
 * Re-importing the same file is harmless (one row per provider call id).
 */
import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { addEvent, upsertLead } from "./he-lead.service.js";
import { recordVoiceResult } from "./he-ingest.service.js";
import { parseResultRows, type ResultRowOut } from "./he-call-results.js";

export interface ResultPreviewRow extends ResultRowOut { knownLead: boolean }

export async function previewCallResults(raw: Array<Record<string, unknown>>) {
  const p = parseResultRows(raw);
  const rows: ResultPreviewRow[] = [];
  for (const r of p.rows) {
    let known = false;
    if (r.mobile10) { const [l] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_lead WHERE mobile10 = ? LIMIT 1", [r.mobile10]); known = l.length > 0; }
    rows.push({ ...r, knownLead: known });
  }
  const count = (o: string) => rows.filter((r) => r.ok && r.outcome === o).length;
  return {
    missingColumns: p.missingColumns, tooMany: p.tooMany, rows,
    summary: { total: rows.length, valid: rows.filter((r) => r.ok).length, rejected: rows.filter((r) => !r.ok).length,
      confirmed: count("WALKIN_CONFIRMED_YES"), rescheduled: count("WALKIN_RESCHEDULED"), declined: rows.filter((r) => r.ok && r.outcome === "WALKIN_DECLINED_NEEDS_FOLLOWUP" && !r.undecided).length, noAnswer: count("NO_ANSWER"), undecided: rows.filter((r) => r.ok && r.undecided).length, wrongPerson: count("WRONG_PERSON_REACHED"), failed: count("CALL_FAILED"), newLeads: rows.filter((r) => r.ok && !r.knownLead).length },
  };
}

export async function applyCallResults(raw: Array<Record<string, unknown>>, o: { userId: string | null; source?: string }): Promise<{ applied: number; duplicates: number; rejected: number; newLeads: number; failedRows: number[] }> {
  const p = parseResultRows(raw);
  if (p.missingColumns.length) throw Object.assign(new Error(`Missing columns: ${p.missingColumns.join(", ")}`), { statusCode: 400 });
  if (p.tooMany) throw Object.assign(new Error("Too many rows in one import"), { statusCode: 400 });
  const out = { applied: 0, duplicates: 0, rejected: p.rows.filter((r) => !r.ok).length, newLeads: 0, failedRows: [] as number[] };
  for (const r of p.rows.filter((x) => x.ok && x.voice && x.mobile10)) {
    try {
      const lead = await upsertLead({ mobile: r.mobile10!, source: o.source ?? "calling_tool", linkMeta: true });
      if (!lead) { out.failedRows.push(r.rowNo); continue; }
      if (lead.created) out.newLeads++;
      // Without a vendor call id, key on phone + call time + outcome + duration so a repeat call on another day still counts.
      const providerCallId = r.callId ?? `imp:${createHash("sha1").update(`${r.mobile10}|${r.startedAt ?? ""}|${r.outcome}|${r.durationS ?? ""}`).digest("hex").slice(0, 24)}`;
      // "Confirmed" carries no date in the tool's report, so use the slot we put in the file (latest hand-over within 5 days).
      let confirmedSlotAt: string | null = null;
      if (r.outcome === "WALKIN_CONFIRMED_YES") {
        const [ev] = await db.execute<RowDataPacket[]>("SELECT meta_json FROM he_lead_event WHERE lead_id = ? AND event_type = 'exported_for_calling' AND meta_json IS NOT NULL AND created_at > DATE_SUB(NOW(), INTERVAL 5 DAY) ORDER BY id DESC LIMIT 1", [lead.id]);
        try { const mj = ev[0]?.meta_json; const j = typeof mj === "string" ? JSON.parse(mj) : mj; confirmedSlotAt = j?.interviewAt ?? null; } catch { confirmedSlotAt = null; }
      }
      // Answered without a decision on the walk-in, or a result older than a day (the interview day has passed): recorded in the call
      // log and the response list, but no state change and nothing is sent to the candidate.
      const historical = r.startedAt ? Date.now() - new Date(`${r.startedAt.replace(" ", "T")}+05:30`).getTime() > 24 * 3600_000 : false;
      const res = await recordVoiceResult({ leadId: lead.id, providerCallId, startedAt: r.startedAt ?? null, result: r.voice!, summary: r.remarks ?? null, offeredSlotAt: r.newInterviewAt ?? null, confirmedSlotAt, source: "call_import", reference: r.referenceId ?? null, incomplete: Boolean(r.undecided), historical });
      if (res?.outcome === "duplicate") out.duplicates++;
      else { out.applied++; await addEvent(lead.id, "call_result_imported", { channel: "voice", actor: o.userId, detail: `${r.outcome}${r.remarks ? " - " + r.remarks : ""}`.slice(0, 480) }); }
    } catch { out.failedRows.push(r.rowNo); }
  }
  return out;
}

/** Record that these candidates were handed to the calling tool, so the next prepared list does not repeat them. */
export async function markExportedForCalling(mobiles: string[], o: { userId: string | null; label?: string; slots?: Record<string, string>; names?: Record<string, string> }): Promise<{ marked: number }> {
  let marked = 0;
  for (const m of Array.from(new Set(mobiles)).slice(0, 2000)) {
    const lead = await upsertLead({ mobile: m, fullName: o.names?.[m]?.slice(0, 150) || null, source: "calling_tool", linkMeta: true });
    if (!lead) continue;
    // The interview slot written into the file is remembered, so when the tool reports "confirmed" the HRMS knows WHICH slot was confirmed.
    const slot = o.slots?.[m];
    await addEvent(lead.id, "exported_for_calling", { channel: "voice", actor: o.userId, detail: (o.label ?? "calling file").slice(0, 200), meta: slot && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(slot) ? { interviewAt: slot } : undefined });
    marked++;
  }
  return { marked };
}
