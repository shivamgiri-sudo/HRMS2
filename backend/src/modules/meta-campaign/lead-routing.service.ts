/**
 * Best-fit routing of a Live Meta lead in a multi-requisition campaign (WS3 B1, decision C2 as amended: one engine, pass > review > fail),
 * and the HR override. Switch: META_MULTI_REQ_ROUTING = off (default) | all | comma list of campaign ids. It is an env switch on purpose
 * (as SELECTION_CRITERIA_LINEUP): while off, Meta ingest issues not one extra statement (pinned).
 * Routing code on the form still wins (unchanged rule); fewer than two open links = the primary, as today; nothing passing or in review
 * = held for HR on the primary (no automatic outreach).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { compileCriteria } from "../selection/compile-criteria.js";
import { LOAD_ROW_SQL, toCriteriaRow } from "../selection/criteria-row.js";
import { evaluate } from "../selection/evaluate.js";
import { normaliseFacts } from "../selection/facts-normalise.js";
import { pickBestRequisition, type FitAlternative } from "../selection/best-fit.js";
import { listCampaignRequisitions, linkedRequisitionIds } from "./campaign-requisition.service.js";
import { leadContacted } from "./lead-contact-lock.js";

export type RoutedBy = "form" | "routing_code" | "best_fit" | "hold" | "hr";
export interface RoutingLead { rawPayload: unknown; education: string | null; location: string | null; experienceYears: number | null; phone: string | null }
export interface RoutingResult { requisitionId: string | null; routedBy: RoutedBy; candidates: FitAlternative[] }

const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export function multiReqRoutingOn(campaignId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.META_MULTI_REQ_ROUTING ?? "").trim();
  if (!v || /^(off|0|false)$/i.test(v)) return false;
  if (/^(all|1|true|on)$/i.test(v)) return true;
  return v.split(",").map((s) => s.trim()).includes(campaignId);
}

/** The columns ingest screens with (same names as its campaign lookup), for a requisition the lead was routed to. */
export const ROUTED_SCREENING_SQL = `SELECT id AS requisition_id, meta_target_age_min, meta_target_age_max, education_requirement, experience_min_years, experience_max_years,
       designation_name, branch_name, process_name, meta_screening_config FROM job_requisition WHERE id = ? LIMIT 1`;

export async function routeLeadRequisition(a: { campaignId: string; primaryRequisitionId: string | null; lead: RoutingLead; now: Date }): Promise<RoutingResult> {
  const links = await listCampaignRequisitions(a.campaignId, a.now);
  const open = links.filter((l) => !l.openReason && !l.endedReason);
  if (open.length < 2) return { requisitionId: a.primaryRequisitionId, routedBy: "form", candidates: [] };
  const ids = open.map((l) => l.requisitionId);
  const [rows] = await db.execute<RowDataPacket[]>(LOAD_ROW_SQL.replace("WHERE jr.id = ? LIMIT 1", `WHERE jr.id IN (${ph(ids.length)})`), ids);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const facts = normaliseFacts({
    sourceKind: "meta_live", subSource: "meta_live", mobile: String(a.lead.phone ?? ""), ats: null, lead: null, profile: null,
    meta: { rawPayload: a.lead.rawPayload, parsedEducation: a.lead.education, parsedLocation: a.lead.location, parsedExperienceYr: a.lead.experienceYears, createdAt: a.now.toISOString() },
    dra: null, system: { eligibility: { ok: true, blocks: [], priority: 1 }, inOtherJourney: null, bookedFor: null, exEmployee: null, rejectedOtherProcess: false },
    contact: { lastFirstContactAt: null },
  }, a.now);
  // A new lead's phone may be malformed; routing judges criteria fit only (the system rules apply later, at enrolment).
  const f = { ...facts, mobileValid: true };
  const cands = open.filter((l) => byId.has(l.requisitionId))
    .map((l) => ({ requisitionId: l.requisitionId, seatsLeft: l.seatsLeft, e: evaluate(f, compileCriteria(toCriteriaRow(byId.get(l.requisitionId)!)), a.now) }));
  const best = pickBestRequisition(cands);
  const all = cands.map((c) => ({ requisitionId: c.requisitionId, verdict: c.e.verdict, score: c.e.score, reasons: [...c.e.failed.map((r) => r.label), ...c.e.reviewReasons].slice(0, 5) }));
  if (!best.requisitionId) return { requisitionId: a.primaryRequisitionId, routedBy: "hold", candidates: all };
  return { requisitionId: best.requisitionId, routedBy: "best_fit", candidates: all };
}

/** HR places a lead on one of its campaign's requisitions. Refused once the lead was contacted (review focus 2). */
export async function overrideLeadRequisition(a: { metaLeadId: string; requisitionId: string; actor: string; rescreen: (leadId: string) => Promise<unknown> }): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT id, campaign_id, requisition_id, parsed_phone FROM meta_lead_raw WHERE id = ? LIMIT 1", [a.metaLeadId]);
  const lead = rows[0];
  if (!lead) throw fail(404, "Lead not found");
  if (await leadContacted(a.metaLeadId)) throw fail(409, "This person has already been contacted for their requisition; it cannot be changed");
  const linked = lead.campaign_id ? await linkedRequisitionIds(String(lead.campaign_id)) : [];
  if (!linked.includes(a.requisitionId)) throw fail(409, "Pick one of the campaign's requisitions");
  if (String(lead.requisition_id ?? "") === a.requisitionId) return;
  await db.execute("UPDATE meta_lead_raw SET requisition_id = ?, routed_by = 'hr', routed_at = NOW() WHERE id = ?", [a.requisitionId, a.metaLeadId]);
  await a.rescreen(a.metaLeadId);
}

const maskMobile = (m: string): string => (/^\d{10}$/.test(m) ? `${m.slice(0, 2)}xxxxxx${m.slice(-2)}` : "xxxxxxxxxx");

/** How a campaign's leads were routed (counts by routed_by) and the leads held for HR (masked, first name only, newest first, at most 200). */
export async function campaignRoutingSummary(campaignId: string): Promise<{ counts: Record<string, number>; held: Array<{ id: string; name: string; maskedMobile: string; requisitionId: string | null; at: string }> }> {
  const [c] = await db.execute<RowDataPacket[]>(
    "SELECT COALESCE(routed_by, 'legacy') AS k, COUNT(*) AS n FROM meta_lead_raw WHERE campaign_id = ? GROUP BY COALESCE(routed_by, 'legacy')", [campaignId]);
  const [held] = await db.execute<RowDataPacket[]>(
    "SELECT id, parsed_name, parsed_phone, requisition_id, created_at FROM meta_lead_raw WHERE campaign_id = ? AND routed_by = 'hold' ORDER BY created_at DESC LIMIT 200", [campaignId]);
  return {
    counts: Object.fromEntries(c.map((r) => [String(r.k), Number(r.n)])),
    held: held.map((r) => ({ id: String(r.id), name: String(r.parsed_name ?? "").trim().split(/\s+/)[0] ?? "", maskedMobile: maskMobile(String(r.parsed_phone ?? "").replace(/\D/g, "").slice(-10)),
      requisitionId: r.requisition_id ? String(r.requisition_id) : null, at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? "") })),
  };
}
