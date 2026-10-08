// "Why was this person not shortlisted?" (plan 2026-10-09, S11). Search by mobile, candidate code or name (3+ characters,
// at most 10 people); for every OPEN requisition in the caller's scope: the verdict, failed and unknown rules with actual vs
// required, system blocks in words, HR overrides, the last stored decision and the follow-up state. Reads only.
// The full mobile is shown only when HR searched by that mobile; otherwise masked, first name only (S-O11).
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { normalizeMobile10 } from "../hiring-engine/he-phone.js";
import { jobRequisitionService } from "../job-requisition/job-requisition.service.js";
import { compileCriteria } from "./compile-criteria.js";
import { loadDbRow, toCriteriaRow } from "./criteria-row.js";
import { evaluate } from "./evaluate.js";
import { normaliseFacts } from "./facts-normalise.js";
import { istText, loadHePeopleByMobiles } from "./facts-loader.service.js";
import { finalVerdict } from "./funnel.js";
import { loadOverrides, withOverride, type Override } from "./override.service.js";
import { forRequisition, maskMobile } from "./preview.service.js";
import type { CandidateFacts, RuleResult, SubSource, Verdict } from "./selection-types.js";

export const SYSTEM_TEXT: Record<string, string> = {
  legacy_employee: "Never contacted: former employee record (legacy import)",
  test: "Never contacted: test record",
  invalid_mobile: "Never contacted: no valid Indian mobile on record",
  opted_out: "Never contacted: the person opted out",
  already_joined: "Already joined",
  current_employee: "Never contacted: current employee",
  already_in_this_requisition: "Already in this requisition's follow-up or booked for it",
  in_other_journey: "Being followed up for another requisition",
  already_booked: "Already booked for another walk-in",
};
export interface WhyNotRequisition {
  requisitionId: string; code: string; verdict: Verdict; systemBlock: string | null; explanation: string | null;
  failed: RuleResult[]; unknown: RuleResult[]; override: Override | null;
  lastDecision: { runId: string; status: string; versionNo: number | null; at: string } | null;
  journey: { state: string; requisitionId: string } | null;
}
export interface WhyNotPerson { person: { maskedMobile: string; fullMobileIfSearched: string | null; name: string; sources: SubSource[] }; perRequisition: WhyNotRequisition[] }

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const variants = (m: string) => [m, `+91${m}`, `91${m}`, `0${m}`];
const RANK: Record<Verdict, number> = { pass: 0, review: 1, fail: 2 };
const firstName = (n: unknown) => (n ? String(n).trim().split(/\s+/)[0].slice(0, 40) : "");

async function resolvePeople(q: string): Promise<{ mobiles: Array<{ m: string; name: string }>; searchedMobile: string | null }> {
  const t = q.trim();
  const digits = t.replace(/\D/g, "");
  if (digits.length >= 10 && /^[+\d\s-]+$/.test(t)) {
    const m = normalizeMobile10(t);
    if (!m) throw fail(400, "That is not a valid Indian mobile");
    return { mobiles: [{ m, name: "" }], searchedMobile: m };
  }
  const [byCode] = await db.execute<RowDataPacket[]>("SELECT ac.mobile, ac.full_name, ac.record_type FROM ats_candidate ac WHERE ac.candidate_code = ? LIMIT 1", [t]);
  if (byCode[0]) {
    const m = normalizeMobile10(byCode[0].mobile);
    return { mobiles: m ? [{ m, name: firstName(byCode[0].full_name) }] : [], searchedMobile: null };
  }
  if (t.length < 3) throw fail(400, "Type at least 3 characters of a name, a candidate code or a mobile");
  const like = `${t.replace(/[%_\\]/g, "")}%`;
  // full_name is not indexed: a bounded prefix scan, at most 10 people
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT x.mobile10, x.full_name FROM ((SELECT l.mobile10, l.full_name FROM he_lead l WHERE l.full_name LIKE ? LIMIT 10)
       UNION (SELECT RIGHT(REGEXP_REPLACE(ac.mobile, '[^0-9]', ''), 10) AS mobile10, ac.full_name FROM ats_candidate ac WHERE ac.full_name LIKE ? AND ac.record_type <> 'test' LIMIT 10)) x LIMIT 10`,
    [like, like]);
  const seen = new Map<string, string>();
  for (const r of rows) { const m = normalizeMobile10(r.mobile10); if (m && !seen.has(m)) seen.set(m, firstName(r.full_name)); }
  return { mobiles: [...seen].map(([m, name]) => ({ m, name })).slice(0, 10), searchedMobile: null };
}

/** Open as the approval gate means it: approved, active, not closed, seats left and not past the hiring deadline (IST day). */
export async function openRequisitionsInScope(user: NonNullable<AuthenticatedRequest["authUser"]>, requisitionId?: string, now = new Date()): Promise<string[]> {
  const today = istText(now).slice(0, 10);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT jr.id FROM job_requisition jr WHERE jr.approval_status = 'approved' AND jr.active_status = 1 AND jr.closed_at IS NULL
        AND jr.fulfilled_headcount < jr.requested_headcount AND (jr.requisition_validity IS NULL OR DATE(jr.requisition_validity) >= ?)${requisitionId ? " AND jr.id = ?" : ""}
      ORDER BY jr.created_at DESC LIMIT 200`, requisitionId ? [today, requisitionId] : [today]);
  const ids = rows.map((r) => String(r.id)).filter((id) => !requisitionId || id === requisitionId);
  const out: string[] = [];
  for (const id of ids) if (await jobRequisitionService.isRequisitionVisible(user, { id })) out.push(id);
  return out;
}

async function factsFor(m: string, now: Date): Promise<CandidateFacts[]> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT source_kind, sub_source, facts_json, facts_hash FROM selection_person_fact WHERE mobile10 = ?", [m]).catch(() => [[] as RowDataPacket[]]);
  if (rows.length) return rows.map((r) => (typeof r.facts_json === "string" ? JSON.parse(r.facts_json) : r.facts_json) as CandidateFacts);
  return (await loadHePeopleByMobiles([m], now)).map((p) => normaliseFacts(p.person, now));
}

export async function whyNot(q: string, o: { user: NonNullable<AuthenticatedRequest["authUser"]>; now?: Date; requisitionId?: string }): Promise<WhyNotPerson[]> {
  const now = o.now ?? new Date();
  const { mobiles, searchedMobile } = await resolvePeople(q);
  if (!mobiles.length) return [];
  const reqIds = await openRequisitionsInScope(o.user, o.requisitionId, now);
  const compiled = new Map<string, { code: string; c: ReturnType<typeof compileCriteria> }>();
  for (const id of reqIds) {
    const d = await loadDbRow((sql, p) => db.execute(sql, p as never) as never, id);
    if (d) compiled.set(id, { code: String(d.requisition_code ?? ""), c: compileCriteria(toCriteriaRow(d)) });
  }
  const out: WhyNotPerson[] = [];
  for (const { m, name } of mobiles) {
    const facts = await factsFor(m, now);
    const [ats] = await db.execute<RowDataPacket[]>(`SELECT ac.mobile, ac.full_name, ac.record_type FROM ats_candidate ac WHERE ac.mobile IN (?, ?, ?, ?)`, variants(m));
    const legacy = !facts.length ? ats.find((a) => a.record_type === "legacy_employee" || a.record_type === "test") : undefined;
    const [fu] = await db.execute<RowDataPacket[]>("SELECT requisition_id, stopped_reason, email_status, wa_status, call_state FROM qualified_followup WHERE mobile10 = ?", [m])
      .catch(() => [[] as RowDataPacket[]]);
    const perRequisition: WhyNotRequisition[] = [];
    for (const [id, { code, c }] of compiled) {
      const ov = (await loadOverrides(id, [m])).get(m) ?? null;
      const [dec] = await db.execute<RowDataPacket[]>(
        `SELECT sc.run_id, sc.status, sc.updated_at, v.version_no FROM shortlist_candidate sc LEFT JOIN job_requisition_criteria_version v ON v.id = sc.criteria_version_id
          WHERE sc.requisition_id = ? AND sc.mobile10 = ? ORDER BY sc.id DESC LIMIT 1`, [id, m]).catch(() => [[] as RowDataPacket[]]);
      const f = fu.find((r) => String(r.requisition_id) === id);
      const base = {
        requisitionId: id, code, override: ov,
        lastDecision: dec[0] ? { runId: String(dec[0].run_id), status: String(dec[0].status), versionNo: dec[0].version_no == null ? null : Number(dec[0].version_no), at: String(dec[0].updated_at) } : null,
        journey: f ? { state: f.stopped_reason ? `stopped: ${String(f.stopped_reason)}` : "in follow-up", requisitionId: id } : null,
      };
      if (legacy || !facts.length) {
        const block = legacy ? String(legacy.record_type) : "not_found";
        perRequisition.push({ ...base, verdict: "fail", systemBlock: block, explanation: SYSTEM_TEXT[block] ?? "No selectable record for this mobile", failed: [], unknown: [] });
        continue;
      }
      const evals = facts.map((x) => withOverride(evaluate(forRequisition(x, id), c, now), ov ?? undefined))
        .sort((a, b) => RANK[finalVerdict(a)] - RANK[finalVerdict(b)] || b.score - a.score);
      const e = evals[0];
      perRequisition.push({ ...base, verdict: finalVerdict(e), systemBlock: e.systemBlock, explanation: e.systemBlock ? SYSTEM_TEXT[e.systemBlock] ?? e.systemBlock.replace(/_/g, " ") : null,
        failed: e.failed.filter((r) => r.mode !== "prefer"), unknown: e.unknown.filter((r) => r.mode !== "prefer") });
    }
    out.push({
      person: { maskedMobile: maskMobile(m), fullMobileIfSearched: searchedMobile === m ? m : null,
        name: name || facts[0]?.firstName || firstName(ats[0]?.full_name), sources: [...new Set(facts.map((x) => x.subSource))] },
      perRequisition,
    });
  }
  return out;
}
