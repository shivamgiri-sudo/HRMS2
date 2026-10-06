/**
 * Walk-in drives: turn a requisition's open positions into a dated drive with a slot calendar, suggest the
 * best-fit leads for it, and reserve slots atomically (the drive row is locked, so two simultaneous invites
 * or voice calls can never be handed the same last seat).
 */
import { randomBytes } from "node:crypto";
import { applyEligibilityGate, type LeadFactsRow } from "./he-eligibility.service.js";
import { refreshHistoryChunk } from "./he-master.service.js";
import { loadProfiles } from "./he-profile.service.js";
import { getRequisitionJd } from "./he-jd.service.js";
import { parseJdText } from "./he-jd-parse.js";
import { learnedBonus } from "./he-learn.js";
import { branchLocationTokens, locationRegex } from "./he-location-match.js";
import { loadMatchParams } from "./he-showup.service.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { eduRank } from "../meta-campaign/lead-screener.service.js";
import { industriesForProcess, rankRequisitions, scoreLead, type MatchRequisition } from "./he-matcher.js";
import { driveCapacity, inviteTarget, nextFreeSlot, nowIst, type SlotConfig } from "./he-slots.js";
import { addEvent } from "./he-lead.service.js";

export interface DriveInput {
  requisitionId: string;
  driveDate: string; // YYYY-MM-DD
  slotStart?: string;
  slotEnd?: string;
  slotMinutes?: number;
  slotCapacity?: number;
  showRatePct?: number;
  autoSend?: boolean;
  createdBy?: string | null;
}

export interface ReqRow extends RowDataPacket {
  id: string; branch_name: string; process_name: string | null; designation_name: string;
  requested_headcount: number; fulfilled_headcount: number; approval_status: string; active_status: number;
  meta_target_age_min: number | null; meta_target_age_max: number | null; meta_target_radius_km: number | null;
  education_requirement: string | null; experience_min_years: number | null; night_shift_required: number;
  salary_max?: number | null; meta_screening_config?: unknown; skills_required?: string | null;
  blat: number | null; blng: number | null; bcity?: string | null; bstate?: string | null;
}

/** JD requirements beyond age/education: gender, languages, certifications, typing, written English (MetaScreeningConfig). */
function screeningOf(raw: unknown): Pick<MatchRequisition, "gender" | "languages" | "certifications" | "minTypingWpm" | "englishLevel"> {
  let c: Record<string, unknown> = {};
  try { c = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown> ?? {}; } catch { c = {}; }
  const g = c.gender === "male" || c.gender === "female" ? c.gender : null;
  const langs = Array.isArray(c.language_requirements) ? (c.language_requirements as Array<{ language?: string }>).map((l) => String(l.language ?? "").toLowerCase()).filter(Boolean) : [];
  const certs = Array.isArray(c.certifications) ? (c.certifications as unknown[]).map((x) => String(x).toUpperCase()).filter(Boolean) : [];
  const wpm = Number(c.min_typing_speed_wpm);
  const eng = c.written_english_level;
  return {
    gender: g as "male" | "female" | null, languages: langs.length ? langs : null, certifications: certs.length ? certs : null,
    minTypingWpm: Number.isFinite(wpm) && wpm > 0 ? wpm : null,
    englishLevel: eng === "basic" || eng === "intermediate" || eng === "advanced" ? eng : null,
  };
}

export function toMatchRequisition(r: ReqRow): MatchRequisition & { id: string } {
  const edu = r.education_requirement ? eduRank(r.education_requirement) : 0;
  return {
    id: r.id,
    ageMin: r.meta_target_age_min, ageMax: r.meta_target_age_max,
    minEducationRank: edu > 0 ? edu : null,
    minExperienceYears: r.experience_min_years,
    nightShift: Boolean(r.night_shift_required),
    branchLat: r.blat, branchLng: r.blng, maxDistanceKm: r.meta_target_radius_km,
    processName: r.process_name,
    salaryMax: r.salary_max != null && Number(r.salary_max) > 0 ? Number(r.salary_max) : null,
    branchCity: r.bcity ?? null, branchState: r.bstate ?? null, goodIndustries: industriesForProcess(r.process_name),
    ...withJdText(screeningOf(r.meta_screening_config), r),
  };
}

/**
 * The uploaded JD's free text ("Female candidates only", "Graduation required", "night shifts", "DRA certified") fills
 * whatever the requisition form and screening config left empty. Form values always win.
 */
function withJdDocText<T extends ReturnType<typeof toMatchRequisition>>(base: T, text: string | null | undefined): T {
  if (!text) return base;
  const jd = parseJdText(text);
  return {
    ...base,
    gender: base.gender ?? jd.gender,
    languages: base.languages?.length ? base.languages : jd.languages.length ? jd.languages : base.languages,
    certifications: base.certifications?.length ? base.certifications : jd.certifications.length ? jd.certifications : base.certifications,
    minTypingWpm: base.minTypingWpm ?? jd.minTypingWpm,
    englishLevel: base.englishLevel ?? jd.englishLevel,
    nightShift: base.nightShift ?? (jd.nightShift ? true : base.nightShift),
    minEducationRank: base.minEducationRank ?? jd.minEducationRank,
    streams: base.streams?.length ? base.streams : jd.streams.length ? jd.streams : base.streams,
  };
}

/** Configured screening wins; anything left empty is filled from the requisition's free-text skills/education. */
function withJdText(cfg: ReturnType<typeof screeningOf>, r: ReqRow): ReturnType<typeof screeningOf> & Pick<MatchRequisition, "nightShift" | "minExperienceYears" | "streams" | "minEducationRank"> {
  const jd = parseJdText(`${r.skills_required ?? ""}. ${r.education_requirement ?? ""}`);
  return {
    gender: cfg.gender ?? jd.gender,
    languages: cfg.languages ?? (jd.languages.length ? jd.languages : null),
    certifications: cfg.certifications ?? (jd.certifications.length ? jd.certifications : null),
    minTypingWpm: cfg.minTypingWpm ?? jd.minTypingWpm,
    englishLevel: cfg.englishLevel ?? jd.englishLevel,
    streams: jd.streams.length ? jd.streams : null,
    ...(r.night_shift_required ? {} : jd.nightShift ? { nightShift: true } : {}),
    ...(r.experience_min_years == null && jd.minExperienceYears != null ? { minExperienceYears: jd.minExperienceYears } : {}),
    ...(!r.education_requirement && jd.minEducationRank ? { minEducationRank: jd.minEducationRank } : {}),
  };
}

async function loadRequisition(id: string): Promise<ReqRow | null> {
  const [rows] = await db.execute<ReqRow[]>(
    `SELECT jr.id, jr.branch_name, jr.process_name, jr.designation_name, jr.requested_headcount, jr.fulfilled_headcount,
            jr.approval_status, jr.active_status, jr.meta_target_age_min, jr.meta_target_age_max, jr.meta_target_radius_km,
            jr.education_requirement, jr.experience_min_years, jr.night_shift_required, jr.salary_max, jr.meta_screening_config, jr.skills_required,
            bm.latitude AS blat, bm.longitude AS blng, bm.city AS bcity, bm.state AS bstate
       FROM job_requisition jr LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE jr.id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export async function createDrive(i: DriveInput): Promise<{ id: string; invites: number; targetShows: number; capacity: number }> {
  const req = await loadRequisition(i.requisitionId);
  if (!req) throw new Error("Requisition not found");
  if (req.approval_status !== "approved" || !req.active_status) throw new Error("Requisition is not open for hiring");
  const open = req.requested_headcount - req.fulfilled_headcount;
  if (open <= 0) throw new Error("Requisition has no open positions");
  const cfg: SlotConfig = { date: i.driveDate, start: i.slotStart ?? "10:00", end: i.slotEnd ?? "17:30", minutes: i.slotMinutes ?? 30, capacity: i.slotCapacity ?? 6 };
  const cap = driveCapacity(cfg);
  const { targetShows, invites } = inviteTarget({ openPositions: open, showRatePct: i.showRatePct ?? 40, capacity: cap });
  const [r] = await db.execute<ResultSetHeader>(
    `INSERT INTO he_drive (requisition_id, branch_name, drive_date, slot_start, slot_end, slot_minutes, slot_capacity, target_shows, show_rate_pct, status, auto_send, created_by)
     VALUES (?,?,?,?,?,?,?,?,?, 'draft', ?, ?)
     ON DUPLICATE KEY UPDATE slot_start = VALUES(slot_start), slot_end = VALUES(slot_end), slot_minutes = VALUES(slot_minutes),
       slot_capacity = VALUES(slot_capacity), target_shows = VALUES(target_shows), show_rate_pct = VALUES(show_rate_pct),
       -- creating a drive for a requisition + date whose drive was closed means "run it again": reopen it as a draft instead of
       -- updating a closed drive that can never be started (the other statuses are left alone)
       status = IF(status = 'closed', 'draft', status)`,
    [i.requisitionId, req.branch_name, i.driveDate, `${cfg.start}:00`.slice(0, 8), `${cfg.end}:00`.slice(0, 8), cfg.minutes, cfg.capacity, targetShows, i.showRatePct ?? 40, i.autoSend ? 1 : 0, i.createdBy ?? null]);
  const [row] = await db.execute<RowDataPacket[]>("SELECT id FROM he_drive WHERE requisition_id = ? AND branch_name = ? AND drive_date = ?", [i.requisitionId, req.branch_name, i.driveDate]);
  void r;
  return { id: row[0].id as string, invites, targetShows, capacity: cap };
}

export async function setDriveStatus(id: string, status: "draft" | "active" | "paused" | "closed"): Promise<void> {
  await db.execute("UPDATE he_drive SET status = ? WHERE id = ?", [status, id]);
}

interface DriveRow extends RowDataPacket {
  id: string; requisition_id: string; branch_name: string; drive_date: string; slot_start: string; slot_end: string;
  slot_minutes: number; slot_capacity: number; target_shows: number; show_rate_pct: number; status: string; auto_send: number;
}
const slotCfg = (d: DriveRow): SlotConfig => ({ date: String(d.drive_date).slice(0, 10), start: String(d.slot_start).slice(0, 5), end: String(d.slot_end).slice(0, 5), minutes: d.slot_minutes, capacity: d.slot_capacity });

/**
 * Score open, eligible leads against the drive's requisition and store the best as `suggested` matches.
 * A lead already booked into another live drive is skipped (no double booking); leads that cleared a round
 * for this process before get a bonus. Returns how many matches were written.
 */
export interface SuggestResult { suggested: number; blockedByReason: Record<string, number>; considered: number; location?: string[] | null }

export async function suggestMatches(driveId: string, limit?: number): Promise<number> {
  return (await suggestMatchesDetailed(driveId, limit)).suggested;
}

/** Same as suggestMatches but also reports why people were not shortlisted (joined, employee, rejected in this process...). */
export async function suggestMatchesDetailed(driveId: string, limit?: number): Promise<SuggestResult> {
  const [dr] = await db.execute<DriveRow[]>("SELECT * FROM he_drive WHERE id = ? LIMIT 1", [driveId]);
  const drive = dr[0];
  if (!drive) throw new Error("Drive not found");
  const req = await loadRequisition(drive.requisition_id);
  if (!req) throw new Error("Requisition not found");
  // JD (uploaded document in BMS format, else the requisition's own text) adds skills and fills gaps in the form fields.
  const jd = await getRequisitionJd(req.id);
  const base = withJdDocText(toMatchRequisition(req), jd?.text);
  const mreq = {
    ...base, strict: true,
    mandatorySkills: jd?.parsed.mandatorySkills.length ? jd.parsed.mandatorySkills : null,
    preferredSkills: jd?.parsed.preferredSkills.length ? jd.parsed.preferredSkills : null,
    minExperienceYears: base.minExperienceYears ?? jd?.parsed.minExperience ?? null,
    salaryMax: base.salaryMax ?? jd?.parsed.salaryMonthly ?? null,
  };
  const cfg = slotCfg(drive);
  const { invites } = inviteTarget({ openPositions: Math.max(1, req.requested_headcount - req.fulfilled_headcount), showRatePct: drive.show_rate_pct, capacity: driveCapacity(cfg) });
  const want = limit ?? invites;

  // Hard requirements go into the SQL pre-filter (unknown values still pass, same rule as the scorer), so the 5,000 rows
  // scored are all potentially eligible instead of an arbitrary slice of a pool that can be 100k+ strong.
  const pre: string[] = [];
  const preArgs: unknown[] = [];
  // Strict drive shortlists: a required level must be on record, so unknowns do not crowd the scored pool.
  if (mreq.minEducationRank != null) { pre.push("l.education_rank >= ?"); preArgs.push(mreq.minEducationRank); }
  if (mreq.ageMin != null) { pre.push("l.age >= ?"); preArgs.push(mreq.ageMin); }
  if (mreq.ageMax != null) { pre.push("l.age <= ?"); preArgs.push(mreq.ageMax); }
  if (mreq.nightShift === true) pre.push("l.night_shift_ok = 1");
  // Walk-ins only work if people can reach the branch: shortlist only those whose records place them in the branch's
  // city/region (lead locality, ATS branch/address, Meta form location or campaign branch, recruiter-call branch), or
  // who applied to this very requisition. Unknown location = left out of a city drive.
  const locRe = locationRegex(branchLocationTokens(req.branch_name, req.bcity ?? null));
  const selectCandidates = async () => (await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.mobile10, l.ats_candidate_id, l.status, l.primary_source, l.final_status, l.is_employee, l.walkin_count, l.last_attempt_date, l.last_outcome,
            l.history_refreshed_at, l.locality, l.age, l.education_rank, l.experience_years, l.night_shift_ok, l.lat, l.lng, COALESCE(i.engagement_score, 0) AS eng,
            EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = l.id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NULL) AS has_consent
       FROM he_lead l LEFT JOIN he_lead_insight i ON i.lead_id = l.id
       LEFT JOIN ats_candidate ac ON ac.id = l.ats_candidate_id
       LEFT JOIN meta_lead_raw mr ON mr.id = l.meta_lead_id
       LEFT JOIN job_requisition jrm ON jrm.id = mr.requisition_id
      WHERE l.status IN ('new','contacted','interested','declined','no_show')
        AND l.is_employee = 0 AND l.final_status <> 'joined'
        -- Already booked: an invite on a LIVE drive, or a confirmation anywhere. An invite that sits on a closed drive (the drive was
        -- replaced or abandoned) no longer holds anyone, so that person can be lined up again; a confirmed person keeps their date.
        AND NOT EXISTS (SELECT 1 FROM he_match m LEFT JOIN he_drive dd ON dd.id = m.drive_id
                         WHERE m.lead_id = l.id AND m.slot_at >= NOW()
                           AND ((m.state IN ('invited','confirmed') AND (dd.id IS NULL OR dd.status <> 'closed')) OR m.state = 'confirmed'))
        AND NOT EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = l.id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NOT NULL)
        ${locRe ? `AND (mr.requisition_id = ?
             OR LOWER(CONCAT_WS(' ', l.locality, ac.applied_for_branch, ac.current_address, ac.address, ac.permanent_address, mr.parsed_location, jrm.branch_name)) REGEXP ?
             OR EXISTS (SELECT 1 FROM ats_recruiter_hiring_activity a WHERE a.mobile10 = l.mobile10
                          AND LOWER(CONCAT_WS(' ', a.branch_name, a.location_name, a.candidate_location)) REGEXP ?))` : ""}
        ${pre.map((c) => `AND ${c}`).join("\n        ")}
      ORDER BY (mr.requisition_id <=> ?) DESC, has_consent DESC, eng DESC, (l.education_rank IS NOT NULL) + (l.age IS NOT NULL) + (l.night_shift_ok IS NOT NULL) DESC LIMIT 5000`,
    [...(locRe ? [req.id, locRe, locRe] : []), ...preArgs, req.id]))[0];
  let leads = await selectCandidates();
  // The rollup columns decide who is an employee / already joined. Refresh any prefix whose rollup is missing or a day old
  // before trusting it, so a never-refreshed lead cannot slip through the gate.
  const staleCut = Date.now() - 86_400_000;
  const stalePrefixes = [...new Set(leads.filter((l) => !l.history_refreshed_at || new Date(l.history_refreshed_at).getTime() < staleCut).map((l) => String(l.mobile10).slice(0, 2)))];
  if (stalePrefixes.length) {
    for (const prefix of stalePrefixes) await refreshHistoryChunk({ prefix });
    leads = await selectCandidates();
  }
  const gate = await applyEligibilityGate(leads as unknown as LeadFactsRow[], { id: req.id, processName: req.process_name ?? null });
  const allowed = leads.filter((l) => gate.verdicts.get(l.id)?.eligible);
  const profiles = await loadProfiles(allowed.map((l) => l.id as string));
  const learned = await loadMatchParams();
  const scored = allowed
    .map((l) => ({ id: l.id as string, priority: gate.verdicts.get(l.id)!.priority, consented: Number(l.has_consent) === 1, res: scoreLead({ age: l.age, educationRank: l.education_rank, experienceYears: l.experience_years == null ? null : Number(l.experience_years), nightShiftOk: l.night_shift_ok == null ? null : Boolean(l.night_shift_ok), lat: l.lat == null ? null : Number(l.lat), lng: l.lng == null ? null : Number(l.lng), city: l.locality ?? null, ...profiles.get(l.id as string) }, mreq), eng: Number(l.eng) }))
    .filter((x) => x.res.eligible)
    .map((x) => {
      // Learned from past walk-ins of this process: profiles that tend to get selected here move up, others down.
      const l = allowed.find((a) => a.id === x.id)!;
      const lb = learnedBonus(learned, req.process_name, { edu: l.education_rank == null ? null : Number(l.education_rank), expYears: l.experience_years == null ? null : Number(l.experience_years), source: l.primary_source ? String(l.primary_source) : null });
      if (!lb.bonus) return x;
      const score = Math.max(1, Math.min(100, x.res.score + lb.bonus));
      return { ...x, res: { ...x.res, score, rankScore: Math.round(score * (0.6 + 0.4 * x.res.confidence) * 10) / 10, reasons: [...x.res.reasons, ...lb.reasons] } };
    })
    // Reachable people first (only consented leads can be messaged), then eligibility priority (ex-employees always last), then fit.
    // rankScore = fit weighted by how much of the JD we actually know, so a phone-only record does not outrank a proven fit.
    .sort((a, b) => (Number(b.consented) * 1000 - b.priority * 10 + b.res.rankScore + b.eng * 0.2) - (Number(a.consented) * 1000 - a.priority * 10 + a.res.rankScore + a.eng * 0.2))
    .slice(0, want);
  for (const s of scored) {
    await db.execute(
      `INSERT INTO he_match (lead_id, requisition_id, drive_id, score, reasons_json, distance_km, state, token)
       VALUES (?,?,?,?,?,?, 'suggested', ?)
       ON DUPLICATE KEY UPDATE
         -- moved to a new drive (the old one was closed, or its slot is past): back to 'suggested' with no slot, so it is invited
         -- afresh for the new date. Order matters: slot_at and state read the OLD drive_id before it is overwritten.
         slot_at = IF(drive_id <=> VALUES(drive_id) OR state NOT IN ('invited','confirmed','slot_released'), slot_at, NULL),
         state = IF(drive_id <=> VALUES(drive_id) OR state NOT IN ('invited','confirmed','slot_released'), state, 'suggested'),
         drive_id = VALUES(drive_id), score = VALUES(score), reasons_json = VALUES(reasons_json), distance_km = VALUES(distance_km)`,
      [s.id, drive.requisition_id, driveId, s.res.score, JSON.stringify({ reasons: s.res.reasons, unknown: s.res.unknown, confidence: s.res.confidence, priority: s.priority }), s.res.distanceKm, randomBytes(16).toString("hex")]);
  }
  // Earlier suggestions that no longer qualify (e.g. before the location rule) are dropped; contacted people are kept.
  if (scored.length) {
    const keep = scored.map((x) => x.id);
    await db.execute(`DELETE FROM he_match WHERE drive_id = ? AND state = 'suggested' AND lead_id NOT IN (${keep.map(() => "?").join(",")})`, [driveId, ...keep]);
  } else await db.execute("DELETE FROM he_match WHERE drive_id = ? AND state = 'suggested'", [driveId]);
  return { suggested: scored.length, blockedByReason: { ...gate.blockedByReason, ...(locRe ? {} : { no_branch_location_known: 0 }) }, considered: leads.length, location: locRe ? branchLocationTokens(req.branch_name, req.bcity ?? null).slice(0, 6) : null };
}

/** Other open requisitions a declined lead fits (feeds the "other role" offer). Same branch ranked first by score. */
/** The rules a drive for this requisition applies (form fields + screening config + JD text/document), for display. */
export async function loadRequisitionForMatching(requisitionId: string) {
  const req = await loadRequisition(requisitionId);
  if (!req) return null;
  const jd = await getRequisitionJd(requisitionId);
  const base = withJdDocText(toMatchRequisition(req), jd?.text);
  return {
    ...base, branchName: req.branch_name, processName: req.process_name,
    mandatorySkills: jd?.parsed.mandatorySkills ?? [], preferredSkills: jd?.parsed.preferredSkills ?? [],
    minExperienceYears: base.minExperienceYears ?? jd?.parsed.minExperience ?? null, salaryMax: base.salaryMax ?? jd?.parsed.salaryMonthly ?? null,
    locationTokens: branchLocationTokens(req.branch_name, req.bcity ?? null).slice(0, 8),
  };
}

/** All open requisitions in matcher shape (with code/process/branch for display). One query, reused across many leads. */
export async function loadOpenRequisitionsForMatching(): Promise<Array<ReturnType<typeof toMatchRequisition> & { code: string; process: string | null; branch: string; role: string }>> {
  const [reqs] = await db.execute<ReqRow[]>(
    `SELECT jr.id, jr.requisition_code, jr.branch_name, jr.process_name, jr.designation_name, jr.requested_headcount, jr.fulfilled_headcount, jr.approval_status, jr.active_status,
            jr.meta_target_age_min, jr.meta_target_age_max, jr.meta_target_radius_km, jr.education_requirement, jr.experience_min_years, jr.night_shift_required, jr.salary_max, jr.meta_screening_config, jr.skills_required,
            bm.latitude AS blat, bm.longitude AS blng, bm.city AS bcity, bm.state AS bstate
       FROM job_requisition jr LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE jr.approval_status = 'approved' AND jr.active_status = 1 AND jr.fulfilled_headcount < jr.requested_headcount LIMIT 300`);
  return reqs.map((r) => ({ ...toMatchRequisition(r), code: String(r.requisition_code ?? ""), process: r.process_name, branch: r.branch_name, role: r.designation_name }));
}

export async function alternativeRequisitions(leadId: string, excludeRequisitionId: string, limit = 3): Promise<Array<{ requisitionId: string; score: number; reasons: string[] }>> {
  const [lr] = await db.execute<RowDataPacket[]>("SELECT age, education_rank, experience_years, night_shift_ok, lat, lng FROM he_lead WHERE id = ? LIMIT 1", [leadId]);
  const l = lr[0];
  if (!l) return [];
  const [reqs] = await db.execute<ReqRow[]>(
    `SELECT jr.id, jr.branch_name, jr.process_name, jr.designation_name, jr.requested_headcount, jr.fulfilled_headcount, jr.approval_status, jr.active_status,
            jr.meta_target_age_min, jr.meta_target_age_max, jr.meta_target_radius_km, jr.education_requirement, jr.experience_min_years, jr.night_shift_required, jr.salary_max, jr.meta_screening_config, jr.skills_required,
            bm.latitude AS blat, bm.longitude AS blng, bm.city AS bcity, bm.state AS bstate
       FROM job_requisition jr LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE jr.approval_status = 'approved' AND jr.active_status = 1 AND jr.fulfilled_headcount < jr.requested_headcount AND jr.id <> ? LIMIT 200`, [excludeRequisitionId]);
  const prof = (await loadProfiles([leadId])).get(leadId) ?? {};
  const ranked = rankRequisitions(
    { age: l.age, educationRank: l.education_rank, experienceYears: l.experience_years == null ? null : Number(l.experience_years), nightShiftOk: l.night_shift_ok == null ? null : Boolean(l.night_shift_ok), lat: l.lat == null ? null : Number(l.lat), lng: l.lng == null ? null : Number(l.lng), ...prof },
    reqs.map(toMatchRequisition), limit);
  return ranked.map((x) => ({ requisitionId: x.req.id, score: x.result.score, reasons: x.result.reasons }));
}

/**
 * Reserve the next free slot for a match. Locks the drive row so concurrent callers serialise; the slot is
 * held the moment it is returned (BRD: "immediately reserves that slot"). Returns null when the drive is full.
 * Only a REPLACEMENT slot logs `slot_offered`: he-ingest counts those to decide when a second decline goes to a
 * human, so the first invite slot must not count (it logs `slot_assigned`).
 */
export async function reserveSlot(matchId: string, isReplacement = false): Promise<string | null> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [m] = await conn.execute<RowDataPacket[]>("SELECT id, lead_id, drive_id FROM he_match WHERE id = ? FOR UPDATE", [matchId]);
    if (!m[0]?.drive_id) { await conn.rollback(); return null; }
    const [d] = await conn.execute<DriveRow[]>("SELECT * FROM he_drive WHERE id = ? FOR UPDATE", [m[0].drive_id]);
    const drive = d[0];
    if (!drive || drive.status === "closed") { await conn.rollback(); return null; }
    const [b] = await conn.execute<RowDataPacket[]>(
      "SELECT slot_at, COUNT(*) AS n FROM he_match WHERE drive_id = ? AND slot_at IS NOT NULL AND state IN ('invited','confirmed') AND id <> ? GROUP BY slot_at", [drive.id, matchId]);
    const booked: Record<string, number> = {};
    for (const r of b) booked[String(r.slot_at).slice(0, 19)] = Number(r.n);
    const slot = nextFreeSlot(slotCfg(drive), booked, nowIst());
    if (!slot) { await conn.rollback(); return null; }
    await conn.execute("UPDATE he_match SET slot_at = ? WHERE id = ?", [slot, matchId]);
    await conn.commit();
    await addEvent(m[0].lead_id as string, isReplacement ? "slot_offered" : "slot_assigned", { driveId: drive.id, detail: slot });
    return slot;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function releaseSlot(matchId: string): Promise<void> {
  await db.execute("UPDATE he_match SET slot_at = NULL WHERE id = ?", [matchId]);
}
