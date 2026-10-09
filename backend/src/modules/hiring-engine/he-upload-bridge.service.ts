/**
 * Bring the ATS imports (Naukri / WorkIndia / candidate rows) into the Hiring Engine pool (WS3 D2), so the selection preview and HR's
 * shortlist approval can work on them. Nothing is contacted from here: the people only become previewable, and enrolment still needs
 * HR approval (S13) and every switch.
 *  - Only record_type candidate / naukri_import / workindia_import is ever read (bound per statement): legacy_employee and test never.
 *  - One he_import_batch per source file (record_type + source_details), consent_attested = 0; every bridged person linked to it.
 *  - Dedupe by mobile (normalizeMobile10): one pool row per person; a repeat within the run is counted, the person written once.
 *  - Existing pool rows are enriched with COALESCE only (never overwritten); rows already linked to a legacy / test record and current
 *    employees are skipped.
 *  - Facts come from the selection normaliser (S6): WorkIndia's constant "Graduate" and placeholders such as "ccc" stay unknown.
 *  - Current employees are matched on the normalised mobile (read once per run); former employees not eligible for rehire
 *    (he_ex_employee.clean_voluntary = 0, the intake rule) are skipped.
 *  - Chunked by id within each record type (default 2,000), capped per call with a resume cursor: a dry run reads up to maxRows
 *    (default 60,000); a real run writes at most REAL_RUN_MAX_ROWS per request, one transaction per chunk. One run at a time (GET_LOCK).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { normalizeMobile10 } from "./he-phone.js";
import { normaliseFacts } from "../selection/facts-normalise.js";
import type { SubSource } from "../selection/selection-types.js";

export const BRIDGE_RECORD_TYPES = ["candidate", "naukri_import", "workindia_import"] as const;
export type BridgeRecordType = (typeof BRIDGE_RECORD_TYPES)[number];
export type SkipReason = "legacy_employee" | "test" | "no_mobile" | "employee" | "ex_employee" | "duplicate_mobile";
/** A real run inside one HTTP request is bounded: the caller continues from `next`. */
export const REAL_RUN_MAX_ROWS = 4000;
export interface BridgeInput {
  recordTypes: BridgeRecordType[]; sourceDetails?: string[]; dryRun: boolean; actorId: string | null;
  chunk?: number; maxRows?: number; after?: { recordType: BridgeRecordType; afterId: string } | null; now?: Date;
}
export interface BridgeBatch { recordType: string; sourceDetails: string; batchId: string | null; scanned: number; inserted: number; enriched: number; skipped: Record<SkipReason, number> }
export interface BridgeResult { dryRun: boolean; batches: BridgeBatch[]; totals: Omit<BridgeBatch, "recordType" | "sourceDetails" | "batchId">; next: { recordType: BridgeRecordType; afterId: string } | null }

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");
const zero = (): Record<SkipReason, number> => ({ legacy_employee: 0, test: 0, no_mobile: 0, employee: 0, ex_employee: 0, duplicate_mobile: 0 });
type Ex = { execute: <T extends RowDataPacket[]>(sql: string, p?: unknown[]) => Promise<[T, unknown]> };
const LOCK = "he_upload_bridge";

const ATS_SQL = (details: number) => `SELECT ac.id, ac.mobile, ac.full_name, ac.email, ac.record_type, ac.source_details, ac.education, ac.date_of_birth, ac.experience,
       ac.annual_salary, ac.current_employer, ac.current_designation, ac.current_address, ac.address, ac.created_at
  FROM ats_candidate ac WHERE ac.record_type = ? AND ac.id > ?${details ? ` AND ac.source_details IN (${ph(details)})` : ""} ORDER BY ac.id LIMIT ?`;
const LEADS_SQL = (n: number) => `SELECT l.id, l.mobile10, l.is_employee, a.record_type AS linked_type FROM he_lead l LEFT JOIN ats_candidate a ON a.id = l.ats_candidate_id
 WHERE l.mobile10 IN (${ph(n)})`;
// Normalised like he-master (a stored "+91 98765-43210" is the same person); read once per run.
const EMPLOYEES_SQL = "SELECT DISTINCT RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', ''), 10) AS m FROM employees WHERE active_status = 1 AND mobile IS NOT NULL AND mobile <> ''";
const EX_EMPLOYEES_SQL = (n: number) => `SELECT mobile10 FROM he_ex_employee WHERE clean_voluntary = 0 AND mobile10 IN (${ph(n)})`;

interface Person { mobile10: string; row: RowDataPacket; key: string; existing: boolean; values: unknown[]; profile: unknown[] | null }

function personValues(row: RowDataPacket, mobile10: string, now: Date): { lead: unknown[]; profile: unknown[] | null } {
  const rt = String(row.record_type);
  const f = normaliseFacts({ sourceKind: "he", subSource: rt as SubSource, mobile: mobile10, ats: row, lead: null, profile: null, meta: null, dra: null,
    system: { eligibility: { ok: true, blocks: [], priority: 1 }, inOtherJourney: null, bookedFor: null, exEmployee: null, rejectedOtherProcess: false },
    contact: { lastFirstContactAt: null } }, now);
  const ok = <T>(v: { value: T | null; quality: string }) => (v.quality === "ok" ? v.value : null);
  const name = row.full_name == null ? null : String(row.full_name).trim().slice(0, 150) || null;
  const lead = [mobile10, name, ok(f.email), ok(f.age), ok(f.educationRank), ok(f.experienceYears), rt, JSON.stringify([rt]), String(row.id)];
  const employer = ok(f.employers)?.[0] ?? null;
  const salary = !f.salaryIsExpectation ? ok(f.salaryMonthly) : null;
  const designation = f.designation ? ok(f.designation) : null;
  const profile = employer || salary || designation ? [employer ? employer.slice(0, 150) : null, salary == null ? null : Math.round(salary), designation ? designation.slice(0, 1000) : null] : null;
  return { lead, profile };
}

export async function bridgeAtsUpload(i: BridgeInput): Promise<BridgeResult> {
  const types = [...new Set(i.recordTypes)];
  if (!types.length || types.some((t) => !(BRIDGE_RECORD_TYPES as readonly string[]).includes(t))) throw fail(400, "Pick candidate, naukri_import or workindia_import");
  const chunk = Math.max(1, Math.min(i.chunk ?? 2000, 5000));
  const maxRows = i.dryRun ? Math.max(1, Math.min(i.maxRows ?? 60_000, 100_000)) : Math.max(1, Math.min(i.maxRows ?? REAL_RUN_MAX_ROWS, REAL_RUN_MAX_ROWS));
  const details = (i.sourceDetails ?? []).filter((d) => typeof d === "string" && d.length <= 255).slice(0, 200);
  const now = i.now ?? new Date();
  const conn = i.dryRun ? null : await db.getConnection();
  try {
    if (conn) {
      const [l] = await conn.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS l", [LOCK]);
      if (Number(l[0]?.l) !== 1) throw fail(409, "A pool bridge run is already going; try again when it ends");
    }
    const batches = new Map<string, BridgeBatch>();
    const seen = new Set<string>();
    const [emps] = await db.execute<RowDataPacket[]>(EMPLOYEES_SQL);
    const employees = new Set(emps.map((e) => String(e.m)));
    let scanned = 0;
    let next: BridgeResult["next"] = null;
    const startAt = i.after ? types.indexOf(i.after.recordType) : 0;
    for (let t = Math.max(0, startAt); t < types.length && !next; t++) {
      const rt = types[t];
      let after = i.after && i.after.recordType === rt ? i.after.afterId : "";
      for (;;) {
        const limit = Math.min(chunk, maxRows - scanned);
        const [rows] = await db.execute<RowDataPacket[]>(ATS_SQL(details.length), [rt, after, ...details, limit]);
        if (!rows.length) break;
        scanned += rows.length;
        after = String(rows[rows.length - 1].id);
        if (conn) await inTx(conn, (ex) => bridgeChunk(rows, { batches, seen, employees, dryRun: false, actorId: i.actorId, now, ex }));
        else await bridgeChunk(rows, { batches, seen, employees, dryRun: true, actorId: i.actorId, now, ex: db as unknown as Ex });
        if (rows.length < limit) break;
        if (scanned >= maxRows) { next = { recordType: rt, afterId: after }; break; }
      }
    }
    const list = [...batches.values()];
    if (conn) {
      await inTx(conn, async (ex) => { for (const b of list) {
        if (!b.batchId) continue;
        await ex.execute("UPDATE he_import_batch SET rows_total = rows_total + ?, created_count = created_count + ?, enriched_count = enriched_count + ?, rejected_count = rejected_count + ?, blocked_json = ? WHERE id = ?",
          [b.scanned, b.inserted, b.enriched, Object.values(b.skipped).reduce((a, n) => a + n, 0), JSON.stringify(b.skipped), b.batchId]);
      } });
    }
    const totals = { scanned, inserted: 0, enriched: 0, skipped: zero() };
    for (const b of list) {
      totals.inserted += b.inserted; totals.enriched += b.enriched;
      for (const k of Object.keys(totals.skipped) as SkipReason[]) totals.skipped[k] += b.skipped[k];
    }
    return { dryRun: i.dryRun, batches: list, totals, next };
  } finally {
    if (conn) {
      try { await conn.execute("SELECT RELEASE_LOCK(?) AS l", [LOCK]); } catch { /* the session ends with the connection */ }
      conn.release();
    }
  }
}

async function inTx(conn: Ex & { beginTransaction(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void> }, fn: (ex: Ex) => Promise<void>): Promise<void> {
  await conn.beginTransaction();
  try { await fn(conn); await conn.commit(); } catch (err) { await conn.rollback().catch(() => undefined); throw err; }
}

async function bridgeChunk(rows: RowDataPacket[], s: { batches: Map<string, BridgeBatch>; seen: Set<string>; employees: Set<string>; dryRun: boolean; actorId: string | null; now: Date; ex: Ex }): Promise<void> {
  const batchOf = (row: RowDataPacket): BridgeBatch => {
    const rt = String(row.record_type), sd = row.source_details == null || String(row.source_details).trim() === "" ? "(no file name)" : String(row.source_details).trim();
    const key = `${rt}|${sd}`;
    let b = s.batches.get(key);
    if (!b) { b = { recordType: rt, sourceDetails: sd, batchId: null, scanned: 0, inserted: 0, enriched: 0, skipped: zero() }; s.batches.set(key, b); }
    return b;
  };
  const candidates: Array<{ row: RowDataPacket; m: string; b: BridgeBatch }> = [];
  for (const row of rows) {
    const b = batchOf(row);
    b.scanned++;
    const m = normalizeMobile10(row.mobile);
    if (!m) { b.skipped.no_mobile++; continue; }
    if (s.seen.has(m)) { b.skipped.duplicate_mobile++; continue; }
    s.seen.add(m);
    candidates.push({ row, m, b });
  }
  if (!candidates.length) return;
  const mobiles = candidates.map((c) => c.m);
  const [leads] = await s.ex.execute<RowDataPacket[]>(LEADS_SQL(mobiles.length), mobiles);
  const [exRows] = await s.ex.execute<RowDataPacket[]>(EX_EMPLOYEES_SQL(mobiles.length), mobiles);
  const leadBy = new Map(leads.map((l) => [String(l.mobile10), l]));
  const employees = s.employees;
  const notRehirable = new Set(exRows.map((x) => String(x.mobile10)));
  const people: Person[] = [];
  for (const c of candidates) {
    const l = leadBy.get(c.m);
    if (l && (l.linked_type === "legacy_employee" || l.linked_type === "test")) { c.b.skipped[l.linked_type === "test" ? "test" : "legacy_employee"]++; continue; }
    if ((l && Number(l.is_employee) === 1) || employees.has(c.m)) { c.b.skipped.employee++; continue; }
    if (notRehirable.has(c.m)) { c.b.skipped.ex_employee++; continue; }
    const v = personValues(c.row, c.m, s.now);
    people.push({ mobile10: c.m, row: c.row, key: `${c.b.recordType}|${c.b.sourceDetails}`, existing: !!l, values: v.lead, profile: v.profile });
    if (l) c.b.enriched++; else c.b.inserted++;
  }
  if (s.dryRun || !people.length) return;

  await s.ex.execute(
    `INSERT INTO he_lead (mobile10, full_name, email, age, education_rank, experience_years, primary_source, sources_json, ats_candidate_id)
     VALUES ${people.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}
     ON DUPLICATE KEY UPDATE full_name = COALESCE(he_lead.full_name, VALUES(full_name)), email = COALESCE(he_lead.email, VALUES(email)),
       age = COALESCE(he_lead.age, VALUES(age)), education_rank = COALESCE(he_lead.education_rank, VALUES(education_rank)),
       experience_years = COALESCE(he_lead.experience_years, VALUES(experience_years)),
       ats_candidate_id = COALESCE(he_lead.ats_candidate_id, VALUES(ats_candidate_id)),
       sources_json = IF(JSON_CONTAINS(COALESCE(he_lead.sources_json, JSON_ARRAY()), JSON_QUOTE(VALUES(primary_source))), he_lead.sources_json,
                         JSON_ARRAY_APPEND(COALESCE(he_lead.sources_json, JSON_ARRAY()), '$', VALUES(primary_source)))`,
    people.flatMap((p) => p.values));
  const [ids] = await s.ex.execute<RowDataPacket[]>(`SELECT id, mobile10 FROM he_lead WHERE mobile10 IN (${ph(people.length)})`, people.map((p) => p.mobile10));
  const idBy = new Map(ids.map((r) => [String(r.mobile10), String(r.id)]));

  // one batch per source file, created the first time a person of that file is written
  for (const p of people) {
    const b = s.batches.get(p.key)!;
    if (b.batchId) continue;
    const [u] = await s.ex.execute<RowDataPacket[]>("SELECT UUID() AS id");
    b.batchId = String(u[0].id);
    await s.ex.execute("INSERT INTO he_import_batch (id, label, file_name, source, consent_attested, rows_total, uploaded_by) VALUES (?,?,?,?,?,?,?)",
      [b.batchId, `${b.sourceDetails} (${b.recordType})`.slice(0, 160), b.sourceDetails.slice(0, 255), b.recordType.slice(0, 30), 0, 0, s.actorId]);
  }
  const links = people.map((p) => [idBy.get(p.mobile10), s.batches.get(p.key)!.batchId]).filter((x): x is [string, string] => !!x[0] && !!x[1]);
  if (links.length) await s.ex.execute(`INSERT IGNORE INTO he_lead_batch (lead_id, batch_id) VALUES ${links.map(() => "(?,?)").join(",")}`, links.flat());
  const prof = people.filter((p) => p.profile && idBy.has(p.mobile10));
  if (prof.length) {
    await s.ex.execute(
      `INSERT INTO he_lead_profile (lead_id, last_employer, last_salary, skills_text) VALUES ${prof.map(() => "(?,?,?,?)").join(",")}
       ON DUPLICATE KEY UPDATE last_employer = COALESCE(he_lead_profile.last_employer, VALUES(last_employer)),
         last_salary = COALESCE(he_lead_profile.last_salary, VALUES(last_salary)), skills_text = COALESCE(he_lead_profile.skills_text, VALUES(skills_text))`,
      prof.flatMap((p) => [idBy.get(p.mobile10), ...p.profile!]));
  }
}

/** The import files that can be bridged, with how many rows and how many are already in the pool (for the preview card). */
export async function bridgeSources(): Promise<Array<{ recordType: string; sourceDetails: string; rows: number; inPool: number }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ac.record_type, COALESCE(NULLIF(TRIM(ac.source_details), ''), '(no file name)') AS sd, COUNT(*) AS n, COUNT(l.id) AS in_pool
       FROM ats_candidate ac LEFT JOIN he_lead l ON l.ats_candidate_id = ac.id
      WHERE ac.record_type IN ('candidate', 'naukri_import', 'workindia_import')
      GROUP BY ac.record_type, sd ORDER BY ac.record_type, n DESC LIMIT 500`);
  return rows.map((r) => ({ recordType: String(r.record_type), sourceDetails: String(r.sd), rows: Number(r.n), inPool: Number(r.in_pool) }));
}
