/**
 * Single intake for every pool (walk-in, Meta, calling, job website, portals, referral, vendor). Each row goes through
 * upsertLead (number = person, email recorded as identity, clashes flagged) and the history refresh, so a new feed can
 * never create a duplicate person. Consent is stored only when the source attests it per row.
 */
import { eduRank } from "../meta-campaign/lead-screener.service.js";
import { grantConsent, upsertLead } from "./he-lead.service.js";
import { mapIntakeRows, type IntakeSource } from "./he-intake.js";
import { refreshLeadHistory } from "./he-master.service.js";

export interface IntakeResult { received: number; created: number; updated: number; rejected: Array<{ rowNo: number; reason: string }>; consentRecorded: number }

export async function ingestCandidates(raw: Array<Record<string, unknown>>, source: IntakeSource, o: { dryRun?: boolean } = {}): Promise<IntakeResult> {
  const p = mapIntakeRows(raw);
  if (p.tooMany) throw Object.assign(new Error("Too many rows in one upload (max 5000)"), { statusCode: 400 });
  if (p.missingColumns.length) throw Object.assign(new Error(`Missing column: ${p.missingColumns.join(", ")}`), { statusCode: 400 });
  const out: IntakeResult = { received: raw.length, created: 0, updated: 0, rejected: [], consentRecorded: 0 };
  for (const r of p.rows) {
    if (!r.ok) { out.rejected.push({ rowNo: r.rowNo, reason: r.reason ?? "invalid" }); continue; }
    if (o.dryRun) continue;
    const edu = r.education ? eduRank(r.education) : 0;
    const lead = await upsertLead({
      mobile: r.mobile10!, fullName: r.name, email: r.email, age: r.age, educationRank: edu > 0 ? edu : null,
      experienceYears: r.experienceYears, pincode: r.pincode, locality: r.city, source, linkMeta: true,
    });
    if (!lead) { out.rejected.push({ rowNo: r.rowNo, reason: "invalid_mobile" }); continue; }
    if (lead.created) out.created++; else out.updated++;
    if (r.consent) { await grantConsent(lead.id, "whatsapp_contact", "intake_attested_v1", `intake_${source}`); out.consentRecorded++; }
    await refreshLeadHistory(r.mobile10!);
  }
  return out;
}
