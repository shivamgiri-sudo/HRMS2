/**
 * Single intake for every pool (walk-in, Meta, calling, job website, WorkIndia / Naukri / Apna / Indeed / other portal
 * exports, referral, vendor). Columns are recognised automatically (he-intake.ts); HR can correct the mapping in the
 * preview and it is remembered for that header layout. Each row goes through upsertLead (number = person, email and
 * alternate number recorded as identities, clashes flagged), the profile table and the history refresh, so a new feed
 * can never create a duplicate person. Consent is stored only when the file attests it per row.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { eduRank } from "../meta-campaign/lead-screener.service.js";
import { grantConsent, upsertLead } from "./he-lead.service.js";
import { recordIdentities } from "./he-identity.service.js";
import { detectColumns, FIELD_LABEL, FIELDS, headerSignature, mapIntakeRows, type Field, type IntakeSource, type Mapping } from "./he-intake.js";
import { parseJdText } from "./he-jd-parse.js";
import { refreshLeadHistory } from "./he-master.service.js";

export interface IntakeResult { received: number; created: number; updated: number; rejected: Array<{ rowNo: number; reason: string }>; consentRecorded: number; mappingSaved: boolean; batchId: string | null; blocked: Record<string, number> }

/** Who in a set of mobiles the engine would never contact (opted out, joined / employee, former employee who did not leave cleanly), plus under-18 rows from the file itself. */
async function blockedCounts(mobiles: string[], underAge: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (underAge) out.under_18 = underAge;
  const add = (k: string, n: number) => { if (n) out[k] = (out[k] ?? 0) + n; };
  for (let i = 0; i < mobiles.length; i += 1000) {
    const part = mobiles.slice(i, i + 1000), q = part.map(() => "?").join(",");
    const [a] = await db.execute<RowDataPacket[]>(`SELECT SUM(status = 'opted_out') AS oo, SUM(is_employee = 1) AS emp, SUM(final_status = 'joined') AS jn FROM he_lead WHERE mobile10 IN (${q})`, part);
    add("opted_out", Number(a[0]?.oo ?? 0)); add("current_employee", Number(a[0]?.emp ?? 0)); add("already_joined", Number(a[0]?.jn ?? 0));
    const [b] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM he_ex_employee WHERE clean_voluntary = 0 AND mobile10 IN (${q})`, part);
    add("former_employee_not_eligible", Number(b[0]?.n ?? 0));
  }
  return out;
}

async function savedMapping(signature: string): Promise<Mapping | null> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT mapping FROM he_import_mapping WHERE signature = ? LIMIT 1", [signature]);
  if (!r[0]) return null;
  try { return (typeof r[0].mapping === "string" ? JSON.parse(r[0].mapping) : r[0].mapping) as Mapping; } catch { return null; }
}

function cleanMapping(m: unknown, headers: string[]): Mapping {
  const out: Mapping = {};
  if (!m || typeof m !== "object") return out;
  for (const [f, h] of Object.entries(m as Record<string, unknown>)) {
    if ((FIELDS as readonly string[]).includes(f) && typeof h === "string" && headers.includes(h)) out[f as Field] = h;
  }
  return out;
}

/** What the system understood from the file, before anything is written. */
export async function previewCandidates(raw: Array<Record<string, unknown>>) {
  const headers = [...new Set(raw.slice(0, 200).flatMap((r) => Object.keys(r)))];
  const signature = headerSignature(headers);
  const saved = await savedMapping(signature);
  const d = detectColumns(raw, saved);
  const p = mapIntakeRows(raw, d.mapping);
  const ok = p.rows.filter((r) => r.ok);
  const mobiles = ok.map((r) => r.mobile10!).slice(0, 5000);
  let existing = 0;
  for (let i = 0; i < mobiles.length; i += 1000) {
    const part = mobiles.slice(i, i + 1000);
    const [e] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM he_lead WHERE mobile10 IN (${part.map(() => "?").join(",")})`, part);
    existing += Number(e[0]?.n ?? 0);
  }
  const reasons: Record<string, number> = {};
  for (const r of p.rows) if (!r.ok) reasons[r.reason ?? "invalid"] = (reasons[r.reason ?? "invalid"] ?? 0) + 1;
  const blocked = await blockedCounts(mobiles, ok.filter((r) => r.age != null && r.age < 18).length);
  return {
    signature, savedMapping: Boolean(saved), blocked, headers, guesses: d.guesses, mapping: d.mapping,
    fields: FIELDS.map((f) => ({ field: f, label: FIELD_LABEL[f] })),
    summary: { rows: raw.length, valid: ok.length, rejected: p.rows.length - ok.length, rejectedBy: reasons, alreadyKnown: existing, newPeople: ok.length - existing },
    sample: ok.slice(0, 5).map((r) => ({ ...r, mobile10: r.mobile10 ? r.mobile10.slice(0, 2) + "xxxxxx" + r.mobile10.slice(-2) : r.mobile10 })),
    missingMobile: !d.mapping.mobile,
  };
}

export async function ingestCandidates(raw: Array<Record<string, unknown>>, source: IntakeSource, o: { dryRun?: boolean; mapping?: unknown; saveMapping?: boolean; userId?: string | null; label?: string | null; fileName?: string | null; consentAttested?: boolean } = {}): Promise<IntakeResult> {
  const headers = [...new Set(raw.slice(0, 200).flatMap((r) => Object.keys(r)))];
  const signature = headerSignature(headers);
  const chosen = cleanMapping(o.mapping, headers);
  const mapping = chosen.mobile ? chosen : (await savedMapping(signature)) ?? undefined;
  const p = mapIntakeRows(raw, mapping);
  if (p.tooMany) throw Object.assign(new Error("Too many rows in one upload (max 5000)"), { statusCode: 400 });
  if (p.missingColumns.length) throw Object.assign(new Error("No mobile number column found. Pick the column that holds the mobile number."), { statusCode: 400 });
  const out: IntakeResult = { received: raw.length, created: 0, updated: 0, rejected: [], consentRecorded: 0, mappingSaved: false, batchId: null, blocked: {} };
  // One row per real upload: who uploaded what, the counts, and the link from every person in the file to it (campaigns can launch from a batch).
  if (!o.dryRun) {
    const [u] = await db.execute<RowDataPacket[]>("SELECT UUID() AS id");
    out.batchId = String(u[0].id);
    await db.execute("INSERT INTO he_import_batch (id, label, file_name, source, consent_attested, rows_total, uploaded_by) VALUES (?,?,?,?,?,?,?)",
      [out.batchId, (o.label?.trim() || `${source} upload ${new Date().toISOString().slice(0, 10)}`).slice(0, 160), o.fileName ? o.fileName.slice(0, 255) : null, source, o.consentAttested ? 1 : 0, raw.length, o.userId ?? null]);
  }
  const batchMobiles: string[] = []; let underAge = 0;
  if (!o.dryRun && (o.saveMapping ?? true) && headers.length) {
    await db.execute(
      `INSERT INTO he_import_mapping (signature, source, headers, mapping, uses, updated_by) VALUES (?,?,?,?,1,?)
       ON DUPLICATE KEY UPDATE source = VALUES(source), mapping = VALUES(mapping), uses = uses + 1, updated_by = VALUES(updated_by)`,
      [signature, source, JSON.stringify(headers), JSON.stringify(p.mapping), o.userId ?? null]);
    out.mappingSaved = true;
  }
  for (const r of p.rows) {
    if (!r.ok) { out.rejected.push({ rowNo: r.rowNo, reason: r.reason ?? "invalid" }); continue; }
    if (o.dryRun) continue;
    const edu = r.education ? eduRank(r.education) : 0;
    const lead = await upsertLead({
      mobile: r.mobile10!, fullName: r.name, email: r.email, age: r.age, educationRank: edu > 0 ? edu : null,
      experienceYears: r.experienceYears, pincode: r.pincode, locality: r.city, source, linkMeta: true, nightShiftOk: r.nightShiftOk ?? null,
    });
    if (!lead) { out.rejected.push({ rowNo: r.rowNo, reason: "invalid_mobile" }); continue; }
    if (lead.created) out.created++; else out.updated++;
    if (out.batchId) {
      await db.execute("INSERT IGNORE INTO he_lead_batch (lead_id, batch_id) VALUES (?,?)", [lead.id, out.batchId]);
      batchMobiles.push(r.mobile10!); if (r.age != null && r.age < 18) underAge++;
    }
    if (r.altMobile10) await recordIdentities(lead.id, { altMobiles: [r.altMobile10], source });
    const certs = r.skills ? parseJdText(r.skills).certifications : [];
    const skillsText = [r.skills, r.prevIndustry, r.lastEmployer, r.education, r.process].filter(Boolean).join('; ').slice(0, 1000) || null;
    if (skillsText || r.gender || r.languages || r.expectedSalary || certs.length || r.educationStatus || r.stream || r.lastSalary || r.prevIndustry || r.state || r.address || r.dob || r.lastEmployer) {
      await db.execute(
        `INSERT INTO he_lead_profile (lead_id, gender, languages, certifications, salary_expectation, education_status, stream, last_salary, prev_industry, last_employer, state, address, dob, skills_text)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE gender = COALESCE(VALUES(gender), gender), languages = COALESCE(VALUES(languages), languages),
           certifications = COALESCE(VALUES(certifications), certifications), salary_expectation = COALESCE(VALUES(salary_expectation), salary_expectation),
           education_status = COALESCE(VALUES(education_status), education_status), stream = COALESCE(VALUES(stream), stream),
           last_salary = COALESCE(VALUES(last_salary), last_salary), prev_industry = COALESCE(VALUES(prev_industry), prev_industry),
           last_employer = COALESCE(VALUES(last_employer), last_employer), state = COALESCE(VALUES(state), state),
           address = COALESCE(VALUES(address), address), dob = COALESCE(VALUES(dob), dob), skills_text = COALESCE(VALUES(skills_text), skills_text)`,
        [lead.id, r.gender ?? null, r.languages ? JSON.stringify(r.languages) : null, certs.length ? JSON.stringify(certs) : null, r.expectedSalary ?? null,
          r.educationStatus ?? null, r.stream ?? null, r.lastSalary ?? null, r.prevIndustry ?? null, r.lastEmployer ?? null, r.state ?? null, r.address ?? null, r.dob ?? null, skillsText]);
    }
    if (r.consent) { await grantConsent(lead.id, "whatsapp_contact", "intake_attested_v1", `intake_${source}`); out.consentRecorded++; }
    await refreshLeadHistory(r.mobile10!);
  }
  if (out.batchId) {
    // Batch-level consent attestation: the uploader confirms these people agreed to be contacted. Never overrides a STOP: opted-out people and anyone
    // with a revoked consent are skipped.
    if (o.consentAttested) {
      const [r] = await db.execute<import("mysql2").ResultSetHeader>(
        `INSERT INTO he_consent (lead_id, consent_type, text_version, source)
         SELECT l.id, 'whatsapp_contact', 'batch_attested_v1', ? FROM he_lead_batch lb JOIN he_lead l ON l.id = lb.lead_id
          WHERE lb.batch_id = ? AND l.status <> 'opted_out'
            AND NOT EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = l.id AND c.consent_type = 'whatsapp_contact')`, [`batch_${out.batchId!.slice(0, 8)}`, out.batchId]);
      out.consentRecorded += r.affectedRows;
    }
    out.blocked = await blockedCounts(batchMobiles, underAge);
    await db.execute("UPDATE he_import_batch SET created_count = ?, enriched_count = ?, rejected_count = ?, blocked_json = ? WHERE id = ?",
      [out.created, out.updated, out.rejected.length, JSON.stringify(out.blocked), out.batchId]);
  }
  return out;
}
