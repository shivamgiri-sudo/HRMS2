/**
 * "How many did we actually recruit through the Meta campaigns?" - counted from the REQUISITION side, with the same
 * rules the requisition funnel uses, not from the lead's stage label (the Meta page reads current_stage and shows 0
 * selected while the requisition has 15 recorded selections).
 *
 * A Meta lead is matched to an ATS candidate by the stored link OR by phone (the branch often creates the candidate
 * without the link). Then, per candidate:
 *   walked in   = walk_in_date set, or has a queue token
 *   selected    = requisition outcome selected/offer_declined, or stage Selected/Offered/Joined/Converted
 *   onboarding  = onboarding bridge started (status not pending, documents > 0, or HR-approved)
 *   joined      = onboarding bridge has an employee
 * Branch scoped (see getMetaRecruitment).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { normalizeMobile10 } from "./he-phone.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";

export interface RecruitmentCounts { leads: number; qualified: number; invited: number; applied: number; walkedIn: number; selected: number; onboarding: number; joined: number }
export interface CampaignRecruitment extends RecruitmentCounts { campaignId: string; campaignName: string; status: string; requisitionCode: string | null; branchName: string | null }

const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");
const chunks = <T,>(xs: T[], n = 1000): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const SELECTED_STAGES = new Set(["selected", "offered", "joined", "converted"]);

type MetaRecruitment = { campaigns: CampaignRecruitment[]; total: RecruitmentCounts };
type CandFacts = { walked: boolean; selected: boolean; onboarding: boolean; joined: boolean };
/** Everything the per-scope answer needs; computed once and shared by every scope. */
type Base = { camps: Array<{ meta: Omit<CampaignRecruitment, keyof RecruitmentCounts>; n: RecruitmentCounts; ids: string[] }>; facts: Map<string, CandFacts> };
let _cache: { at: number; data: Base } | null = null;
let _inflight: Promise<Base> | null = null;
// HE_META_CACHE_MS overrides the 5 min cache (0 = always fresh, used by the test environment).
const CACHE_MS = Number.isFinite(Number(process.env.HE_META_CACHE_MS)) && process.env.HE_META_CACHE_MS !== undefined ? Number(process.env.HE_META_CACHE_MS) : 5 * 60_000;
const empty = (): RecruitmentCounts => ({ leads: 0, qualified: 0, invited: 0, applied: 0, walkedIn: 0, selected: 0, onboarding: 0, joined: 0 });

/**
 * Branch scoped like the other HE reads: org-wide callers see every campaign (the default, as he-meta-funnel uses it), a branch caller only
 * the campaigns whose requisition is at their branch (not the unlinked ones), a caller with no branch nothing. The total is over the
 * campaigns shown, a person in two of them counted once. Cached for 5 minutes (stale-while-revalidate): the strip sits on every tab and the
 * numbers move slowly; one cached computation serves every scope.
 */
export async function getMetaRecruitment(scope: BranchScope = { all: true }): Promise<MetaRecruitment> {
  if (!scope.all && !scope.branchName) return { campaigns: [], total: empty() };
  return project(await loadBase(), scope);
}

async function loadBase(): Promise<Base> {
  if (CACHE_MS <= 0) return computeBase();
  const fresh = _cache && Date.now() - _cache.at < CACHE_MS;
  if (_cache && !fresh && !_inflight) _inflight = computeBase().then((d) => { _cache = { at: Date.now(), data: d }; return d; }).finally(() => { _inflight = null; });
  if (_cache) return _cache.data;
  if (!_inflight) _inflight = computeBase().then((d) => { _cache = { at: Date.now(), data: d }; return d; }).finally(() => { _inflight = null; });
  return _inflight;
}

const branchKey = (v: string | null | undefined): string => String(v ?? "").trim().toLowerCase();

function project(base: Base, scope: BranchScope): MetaRecruitment {
  // Branch names are compared trimmed and case-insensitively (the user's branch_master name vs the requisition's); a blank one matches nothing.
  const want = scope.all ? "" : branchKey(scope.branchName);
  const shown = base.camps.filter((c) => scope.all || (want !== "" && branchKey(c.meta.branchName) === want));
  const fill = (n: RecruitmentCounts, ids: Iterable<string>) => {
    for (const id of ids) {
      const f = base.facts.get(id);
      if (!f) continue;
      n.applied++;
      if (f.walked) n.walkedIn++;
      if (f.selected) n.selected++;
      if (f.onboarding) n.onboarding++;
      if (f.joined) n.joined++;
    }
  };
  const total = empty();
  const everyone = new Set<string>();
  const campaigns = shown.map((c): CampaignRecruitment => {
    const n = { ...c.n };
    fill(n, c.ids);
    total.leads += c.n.leads; total.qualified += c.n.qualified; total.invited += c.n.invited;
    for (const id of c.ids) everyone.add(id);
    return { ...c.meta, ...n };
  });
  fill(total, everyone); // a person who appears in two campaigns is counted once in the total
  return { campaigns, total };
}

async function computeBase(): Promise<Base> {
  const [camps] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.campaign_name, c.campaign_status, jr.requisition_code, jr.branch_name
       FROM meta_campaign c LEFT JOIN job_requisition jr ON jr.id = c.requisition_id ORDER BY c.campaign_name`);
  const [leads] = await db.execute<RowDataPacket[]>("SELECT campaign_id, ats_candidate_id, screening_result, notification_sent_at, parsed_phone FROM meta_lead_raw WHERE campaign_id IS NOT NULL");

  const mob = (l: RowDataPacket) => normalizeMobile10(String(l.parsed_phone ?? "").replace(/^p:/i, ""));
  const linkedIds = Array.from(new Set(leads.map((l) => l.ats_candidate_id as string | null).filter((x): x is string => Boolean(x))));
  const phones = Array.from(new Set(leads.map(mob).filter((x): x is string => Boolean(x))));

  // Candidates by link OR phone (chunked so a big pool never builds an enormous statement).
  const cand = new Map<string, { m: string | null; walked: boolean; stage: string }>();
  const byPhone = new Map<string, string[]>();
  const load = async (ids: string[]) => {
    for (const part of chunks(ids)) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT c.id, RIGHT(REGEXP_REPLACE(c.mobile, '[^0-9]', ''), 10) AS m, (c.walk_in_date IS NOT NULL) AS walked, c.current_stage FROM ats_candidate c WHERE c.id IN (${ph(part.length)})`, part);
      for (const r of rows) {
        cand.set(r.id as string, { m: (r.m as string | null) ?? null, walked: Number(r.walked) === 1, stage: String(r.current_stage ?? "").toLowerCase() });
        if (r.m) byPhone.set(r.m as string, [...(byPhone.get(r.m as string) ?? []), r.id as string]);
      }
    }
  };
  await load(linkedIds);
  // Phones are stored in many formats ("+91 98111 00002", "98111-00004"), so they are normalised in one pass over ats_candidate (the old
  // per-chunk REGEXP scans took ~20 s in production). The pass reads only id / mobile / walk_in_date, which the (mobile, walk_in_date) index
  // covers, and normalises here exactly as RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', ''), 10) does; reading current_stage for all ~95k rows
  // made it a full-row scan (about 6 s cold on prod). The stage is then read by key for the matched ids only.
  if (phones.length) {
    const want = new Set(phones);
    const [all] = await db.execute<RowDataPacket[]>(
      "SELECT c.id, c.mobile, (c.walk_in_date IS NOT NULL) AS walked FROM ats_candidate c WHERE c.mobile IS NOT NULL AND c.mobile <> ''");
    const matched: string[] = [];
    for (const r of all) {
      const m = String(r.mobile ?? "").replace(/[^0-9]/g, "").slice(-10);
      if (m && want.has(m) && !cand.has(r.id as string)) matched.push(r.id as string);
    }
    await load(matched);
  }
  const allIds = Array.from(cand.keys());

  const selectedByReq = new Set<string>(), tokenned = new Set<string>(), onboarding = new Set<string>(), joined = new Set<string>();
  for (const c of chunks(allIds)) {
    const [jrc] = await db.execute<RowDataPacket[]>(`SELECT DISTINCT candidate_id FROM job_requisition_candidate WHERE outcome IN ('selected','offer_declined') AND candidate_id IN (${ph(c.length)})`, c);
    for (const r of jrc) selectedByReq.add(r.candidate_id as string);
    const [qt] = await db.execute<RowDataPacket[]>(`SELECT DISTINCT candidate_id FROM ats_queue_token WHERE candidate_id IN (${ph(c.length)})`, c);
    for (const r of qt) tokenned.add(r.candidate_id as string);
    const [ob] = await db.execute<RowDataPacket[]>(
      `SELECT candidate_id, employee_id, status, joining_document_completion_pct AS docs, hr_approved_at FROM ats_onboarding_bridge WHERE candidate_id IN (${ph(c.length)})`, c);
    for (const r of ob) {
      if (r.employee_id) joined.add(r.candidate_id as string);
      if (r.status !== "pending" || Number(r.docs ?? 0) > 0 || r.hr_approved_at) onboarding.add(r.candidate_id as string);
    }
  }
  const facts = new Map<string, CandFacts>();
  for (const [id, c] of cand) {
    facts.set(id, { walked: c.walked || tokenned.has(id), selected: selectedByReq.has(id) || SELECTED_STAGES.has(c.stage), onboarding: onboarding.has(id), joined: joined.has(id) });
  }

  const perCamp = new Map<string, { n: RecruitmentCounts; ids: Set<string> }>();
  for (const c of camps) perCamp.set(c.id as string, { n: empty(), ids: new Set() });
  for (const l of leads) {
    const p = perCamp.get(l.campaign_id as string); if (!p) continue;
    p.n.leads++;
    if (l.screening_result === "qualified") p.n.qualified++;
    if (l.notification_sent_at) p.n.invited++;
    const m = mob(l);
    const ids = new Set<string>([...(l.ats_candidate_id ? [l.ats_candidate_id as string] : []), ...(m ? byPhone.get(m) ?? [] : [])]);
    for (const id of ids) if (cand.has(id)) p.ids.add(id);
  }
  return {
    facts,
    camps: camps.map((c) => ({
      meta: { campaignId: c.id as string, campaignName: c.campaign_name as string, status: c.campaign_status as string, requisitionCode: (c.requisition_code as string | null) ?? null, branchName: (c.branch_name as string | null) ?? null },
      n: perCamp.get(c.id as string)!.n,
      ids: [...perCamp.get(c.id as string)!.ids],
    })),
  };
}
