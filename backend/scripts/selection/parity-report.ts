/**
 * Read-only parity report (selection criteria S8): for every Meta lead linked to a requisition, today's screenLead (recomputed
 * from the stored payload and the requisition's current criteria) against the selection engine in legacy mode.
 * Prints counts only (no names, no numbers). The session is READ ONLY; nothing is written.
 *   DB_HOST=... DB_PORT=... DB_USER=... DB_PASSWORD=... DB_NAME=... npx tsx scripts/selection/parity-report.ts [--limit 5000]
 */
import mysql from "mysql2/promise";
import { screenLead } from "../../src/modules/meta-campaign/lead-screener.service.js";
import { parseLead } from "../../src/modules/meta-campaign/meta-lead.parser.js";
import { compileCriteria } from "../../src/modules/selection/compile-criteria.js";
import { LOAD_ROW_SQL, toCriteriaRow } from "../../src/modules/selection/criteria-row.js";
import { evaluate } from "../../src/modules/selection/evaluate.js";
import { normaliseFacts } from "../../src/modules/selection/facts-normalise.js";

const limitArg = process.argv.indexOf("--limit");
const LIMIT = Math.min(Math.max(Number(limitArg > 0 ? process.argv[limitArg + 1] : 5000) || 5000, 1), 50000);
const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
await conn.query("SET SESSION TRANSACTION READ ONLY");
await conn.query("START TRANSACTION READ ONLY");
const NOW = new Date();
const out = { leads: 0, skipped_unparseable: 0, skipped_screener_error: 0, agree: 0, differ: 0, stored_vs_recomputed_differ: 0, differ_by_rule: {} as Record<string, number>, engine: { pass: 0, review: 0, fail: 0 } };
const rows = new Map<string, ReturnType<typeof compileCriteria> | null>();
const SYS = { eligibility: { ok: true, blocks: [], priority: 1 }, inOtherJourney: null, bookedFor: null, exEmployee: null, rejectedOtherProcess: false };

let after = "";
// Legacy mode only, and it must run before migration 2145 exists: the criteria row is read without selection_rules.
const ROW_SQL = LOAD_ROW_SQL.replace("jr.selection_rules, ", "");
for (;;) {
  const [leads] = await conn.query<mysql.RowDataPacket[]>(
    "SELECT id, requisition_id, raw_payload, screening_result, created_at FROM meta_lead_raw WHERE requisition_id IS NOT NULL AND id > ? ORDER BY id LIMIT 1000", [after]);
  if (!leads.length || out.leads >= LIMIT) break;
  for (const l of leads) {
    if (out.leads >= LIMIT) break;
    out.leads++;
    if (!rows.has(l.requisition_id)) {
      const [r] = await conn.execute<mysql.RowDataPacket[]>(ROW_SQL, [l.requisition_id]);
      rows.set(l.requisition_id, r[0] ? compileCriteria({ ...toCriteriaRow(r[0]), selectionRules: null }) : null);
    }
    const c = rows.get(l.requisition_id);
    let payload: unknown = l.raw_payload;
    try { if (typeof payload === "string") payload = JSON.parse(payload); } catch { payload = null; }
    if (!c || !payload || !Array.isArray((payload as { field_data?: unknown }).field_data)) { out.skipped_unparseable++; continue; }
    const p = parseLead(payload as never);
    const [rq] = await conn.execute<mysql.RowDataPacket[]>("SELECT meta_target_age_min, meta_target_age_max, education_requirement, experience_min_years, experience_max_years, meta_screening_config FROM job_requisition WHERE id = ?", [l.requisition_id]);
    const q = rq[0];
    const cfg = typeof q.meta_screening_config === "string" ? JSON.parse(q.meta_screening_config) : q.meta_screening_config;
    let qualified: boolean;
    try {
      qualified = screenLead({ parsedAge: p.age, parsedEducation: p.education, parsedExperienceYr: p.experienceYears, parsedGender: p.gender, rawFields: p.rawFields }, {
        metaTargetAgeMin: q.meta_target_age_min == null ? null : Number(q.meta_target_age_min), metaTargetAgeMax: q.meta_target_age_max == null ? null : Number(q.meta_target_age_max),
        educationRequirement: q.education_requirement ?? null, experienceMinYears: q.experience_min_years == null ? null : Number(q.experience_min_years),
        experienceMaxYears: q.experience_max_years == null ? null : Number(q.experience_max_years), screeningConfig: cfg ?? null }).qualified;
    } catch { out.skipped_screener_error++; continue; } // e.g. language_requirements stored as plain strings: screenLead itself throws
    if ((l.screening_result === "qualified") !== qualified && l.screening_result !== "pending") out.stored_vs_recomputed_differ++;
    const e = evaluate(normaliseFacts({ sourceKind: "meta_old", subSource: "meta_old", mobile: p.phone ?? "0", ats: null, lead: null, profile: null,
      meta: { rawPayload: payload, parsedEducation: null, parsedLocation: null, parsedExperienceYr: null, createdAt: String(l.created_at) }, dra: null, system: SYS, contact: { lastFirstContactAt: null } }, NOW), c, NOW);
    out.engine[e.verdict]++;
    if ((e.verdict === "fail") === !qualified) out.agree++;
    else { out.differ++; const k = e.failed[0]?.key ?? "none"; out.differ_by_rule[k] = (out.differ_by_rule[k] ?? 0) + 1; }
  }
  after = String(leads[leads.length - 1].id);
}
await conn.query("ROLLBACK");
await conn.end();
console.log(JSON.stringify(out));
process.exit(out.differ ? 1 : 0);
