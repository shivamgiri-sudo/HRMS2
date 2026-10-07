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
import { branchLocationTokens, locationRegex, negationRegex, placedInBranchArea, RESIDENCE_SQL } from "./he-location-match.js";
import { loadMatchParams } from "./he-showup.service.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { eduRank } from "../meta-campaign/lead-screener.service.js";
import { industriesForProcess, rankRequisitions, scoreLead, type MatchRequisition } from "./he-matcher.js";
import { driveCapacity, inviteTarget, invitesForTarget, nextFreeSlot, nowIst, type SlotConfig } from "./he-slots.js";
import { addEvent } from "./he-lead.service.js";
import { logger } from "../../logger.js";
import { enqueueMatchedFollowups } from "./qualified-followup.service.js";
import { followupMode } from "./qualified-followup.schedule.js";
import type { FollowupStreamRef } from "./qualified-followup.types.js";

/** Who a drive is lined up from. pool = everyone eligible; meta = anyone who filled a Meta form; campaign = those Meta campaigns' qualified leads; batch = those upload batches. */
export interface DriveAudience { kind: "pool" | "meta" | "campaign" | "batch"; ids?: string[]; maxLeadAgeDays?: number | null; label?: string | null; reinvite?: boolean }

export interface DriveInput {
  requisitionId: string;
  audience?: DriveAudience;
  driveDate: string; // YYYY-MM-DD
  slotStart?: string;
  slotEnd?: string;
  slotMinutes?: number;
  slotCapacity?: number;
  showRatePct?: number;
  /** Walk-ins wanted for the day. When given, invites = this / show rate (capped by the seats); otherwise it follows the open positions. */
  targetShows?: number;
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
  const { targetShows, invites } = i.targetShows && i.targetShows > 0 ? invitesForTarget({ targetShows: i.targetShows, showRatePct: i.showRatePct ?? 40, capacity: cap }) : inviteTarget({ openPositions: open, showRatePct: i.showRatePct ?? 40, capacity: cap });
  const [r] = await db.execute<ResultSetHeader>(
    `INSERT INTO he_drive (requisition_id, branch_name, drive_date, slot_start, slot_end, slot_minutes, slot_capacity, target_shows, show_rate_pct, status, auto_send, created_by,
                           source_kind, source_ids, max_lead_age_days, run_label, reinvite)
     VALUES (?,?,?,?,?,?,?,?,?, 'draft', ?, ?, ?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       -- the audience is only rewritten when the drive was closed (a re-run); a live drive keeps the audience it was made for
       source_kind = IF(status = 'closed', VALUES(source_kind), source_kind), source_ids = IF(status = 'closed', VALUES(source_ids), source_ids),
       max_lead_age_days = IF(status = 'closed', VALUES(max_lead_age_days), max_lead_age_days), run_label = IF(status = 'closed', VALUES(run_label), run_label),
       reinvite = IF(status = 'closed', VALUES(reinvite), reinvite),
       slot_start = VALUES(slot_start), slot_end = VALUES(slot_end), slot_minutes = VALUES(slot_minutes),
       slot_capacity = VALUES(slot_capacity), target_shows = VALUES(target_shows), show_rate_pct = VALUES(show_rate_pct),
       -- creating a drive for a requisition + date whose drive was closed means "run it again": reopen it as a draft instead of
       -- updating a closed drive that can never be started (the other statuses are left alone)
       status = IF(status = 'closed', 'draft', status)`,
    [i.requisitionId, req.branch_name, i.driveDate, `${cfg.start}:00`.slice(0, 8), `${cfg.end}:00`.slice(0, 8), cfg.minutes, cfg.capacity, targetShows, i.showRatePct ?? 40, i.autoSend ? 1 : 0, i.createdBy ?? null,
      i.audience?.kind ?? "pool", i.audience?.ids?.length ? JSON.stringify(i.audience.ids) : null, i.audience?.maxLeadAgeDays ?? null, i.audience?.label?.slice(0, 120) ?? null, i.audience?.reinvite ? 1 : 0]);
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
  source_kind: string; source_ids: unknown; max_lead_age_days: number | null; run_label: string | null; reinvite: number;
}
const slotCfg = (d: DriveRow): SlotConfig => ({ date: String(d.drive_date).slice(0, 10), start: String(d.slot_start).slice(0, 5), end: String(d.slot_end).slice(0, 5), minutes: d.slot_minutes, capacity: d.slot_capacity });

/**
 * Score open, eligible leads against the drive's requisition and store the best as `suggested` matches.
 * A lead already booked into another live drive is skipped (no double booking); leads that cleared a round
 * for this process before get a bonus. Returns how many matches were written.
 */
export interface SuggestResult { suggested: number; blockedByReason: Record<string, number>; considered: number; location?: string[] | null; leadIds: string[] }

/** The audience a line-up filters on: the drive's own columns, or a stream's. */
export interface AudienceSpec { source_kind: string; source_ids: unknown; max_lead_age_days: number | null }

/** Every option is off by default and then the line-up is exactly the one the drive's own audience gets (snapshot-tested). */
export interface LineUpOptions {
  limit?: number; metaOnly?: boolean;
  /** Replaces the drive's own audience (a stream's source). */
  audience?: AudienceSpec;
  /**
   * Leave out people who already have a match row on this drive (another stream's first touch) or are queued on another live drive of
   * this requisition that has not passed (he_match is one row per person and requisition: lining them up here would re-point them, and
   * two days' top-ups would pass them back and forth). Implies keepOtherSuggestions.
   */
  excludeOnDrive?: boolean;
  /** Do not delete the drive's other `suggested` matches (they belong to other streams). Always on with excludeOnDrive. */
  keepOtherSuggestions?: boolean;
  /** false = preview: nothing is refreshed, inserted or deleted. */
  write?: boolean;
  followupStream?: FollowupStreamRef | null;
}

export function audienceSql(d: AudienceSpec, opts: { metaOnly?: boolean }): { sql: string; args: unknown[] } {
  let ids: string[] = [];
  try { const raw = d.source_ids; ids = Array.isArray(raw) ? raw.map(String) : raw ? JSON.parse(String(raw)) : []; } catch { ids = []; }
  const age = d.max_lead_age_days && d.max_lead_age_days > 0 ? Math.floor(d.max_lead_age_days) : 0;
  const kind = d.source_kind === "pool" && opts.metaOnly ? "meta" : d.source_kind;
  const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");
  // Only QUALIFIED Meta form fills count (a rejected or pending lead is never lined up), newest fill first decides the age window.
  const fill = (extra: string, args: unknown[]) => ({
    sql: `AND EXISTS (SELECT 1 FROM he_lead_campaign lc JOIN meta_lead_raw q ON q.id = lc.meta_lead_id AND q.screening_result = 'qualified'
                       WHERE lc.lead_id = l.id ${extra} ${age ? "AND lc.form_filled_at >= DATE_SUB(NOW(), INTERVAL ? DAY)" : ""})`,
    args: [...args, ...(age ? [age] : [])],
  });
  // A campaign / batch drive whose audience cannot be read must match NOBODY, never fall back to the whole pool.
  if ((kind === "campaign" || kind === "batch") && !ids.length) return { sql: "AND 1 = 0", args: [] };
  if (kind === "campaign" && ids.length) return fill(`AND lc.campaign_id IN (${ph(ids.length)})`, ids);
  if (kind === "batch" && ids.length) return { sql: `AND EXISTS (SELECT 1 FROM he_lead_batch lb WHERE lb.lead_id = l.id AND lb.batch_id IN (${ph(ids.length)}))`, args: ids };
  if (kind === "meta") return fill("", []);
  return { sql: "", args: [] };
}

export async function suggestMatches(driveId: string, limit?: number, opts: { metaOnly?: boolean } = {}): Promise<number> {
  return (await suggestMatchesDetailed(driveId, limit, opts)).suggested;
}

/** Same as suggestMatches but also reports why people were not shortlisted (joined, employee, rejected in this process...). */
export async function suggestMatchesDetailed(driveId: string, limit?: number, opts: { metaOnly?: boolean } = {}): Promise<SuggestResult> {
  return lineUpCandidates(driveId, { limit, metaOnly: opts.metaOnly });
}

export async function lineUpCandidates(driveId: string, o: LineUpOptions = {}): Promise<SuggestResult> {
  const { limit, write = true } = o;
  const opts = { metaOnly: o.metaOnly };
  const [dr] = await db.execute<DriveRow[]>("SELECT * FROM he_drive WHERE id = ? LIMIT 1", [driveId]);
  const drive = dr[0];
  if (!drive) throw new Error("Drive not found");
  const req = await loadRequisition(drive.requisition_id);
  if (!req) throw new Error("Requisition not found");
  // JD (uploaded document in BMS format, else the requisition's own text) adds skills and fills gaps in the form fields.
  const jd = await getRequisitionJd(req.id);
  const base = withJdDocText(toMatchRequisition(req), jd?.text);
  const audience: AudienceSpec = o.audience ?? drive;
  const mreq = {
    ...base, strict: true,
    // Meta form leads never state a night-shift preference: for a Meta / campaign audience that one unknown does not block them (the invite and call ask).
    unknownOk: audience.source_kind === "campaign" || audience.source_kind === "meta" ? ["night_shift"] : undefined,
    mandatorySkills: jd?.parsed.mandatorySkills.length ? jd.parsed.mandatorySkills : null,
    preferredSkills: jd?.parsed.preferredSkills.length ? jd.parsed.preferredSkills : null,
    minExperienceYears: base.minExperienceYears ?? jd?.parsed.minExperience ?? null,
    salaryMax: base.salaryMax ?? jd?.parsed.salaryMonthly ?? null,
  };
  const cfg = slotCfg(drive);
  // The drive remembers the walk-ins it was created for (from the owner's target or the open positions); invites follow from that.
  const { invites } = drive.target_shows > 0
    ? invitesForTarget({ targetShows: drive.target_shows, showRatePct: drive.show_rate_pct, capacity: Number.MAX_SAFE_INTEGER }) // lined up for the walk-ins wanted, as before; seats are enforced when sending
    : inviteTarget({ openPositions: Math.max(1, req.requested_headcount - req.fulfilled_headcount), showRatePct: drive.show_rate_pct, capacity: driveCapacity(cfg) });
  const want = limit ?? invites;


  // Hard requirements go into the SQL pre-filter (unknown values still pass, same rule as the scorer), so the 5,000 rows
  // scored are all potentially eligible instead of an arbitrary slice of a pool that can be 100k+ strong.
  const pre: string[] = [];
  const preArgs: unknown[] = [];
  // Strict drive shortlists: a required level must be on record, so unknowns do not crowd the scored pool.
  if (mreq.minEducationRank != null) { pre.push("l.education_rank >= ?"); preArgs.push(mreq.minEducationRank); }
  if (mreq.ageMin != null) { pre.push("l.age >= ?"); preArgs.push(mreq.ageMin); }
  if (mreq.ageMax != null) { pre.push("l.age <= ?"); preArgs.push(mreq.ageMax); }
  if (mreq.nightShift === true) pre.push(mreq.unknownOk?.includes("night_shift") ? "(l.night_shift_ok = 1 OR l.night_shift_ok IS NULL)" : "l.night_shift_ok = 1");
  // Walk-ins only work if people can reach the branch: shortlist only those whose records place them in the branch's
  // city/region (lead locality, ATS branch/address, Meta form location or campaign branch, recruiter-call branch), or
  // who applied to this very requisition. Unknown location = left out of a city drive.
  // The drive's own audience (a campaign re-run, an upload batch, Meta-only) is applied on EVERY call, including the scheduler's
  // re-line-up, so a launch can never widen back to the whole pool. `opts.metaOnly` (daily plan flag) still works for pool drives.
  const aud = audienceSql(audience, opts);
  const locTokens = branchLocationTokens(req.branch_name, req.bcity ?? null);
  const locRe = locationRegex(locTokens), negRe = negationRegex(locTokens);
  const selectCandidates = async () => (await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.mobile10, l.ats_candidate_id, l.status, l.primary_source, l.final_status, l.is_employee, l.walkin_count, l.last_attempt_date, l.last_outcome,
            l.history_refreshed_at, l.locality, l.age, l.education_rank, l.experience_years, l.night_shift_ok, l.lat, l.lng, COALESCE(i.engagement_score, 0) AS eng,
            EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = l.id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NULL) AS has_consent
       FROM he_lead l LEFT JOIN he_lead_insight i ON i.lead_id = l.id
       LEFT JOIN ats_candidate ac ON ac.id = l.ats_candidate_id
       LEFT JOIN meta_lead_raw mr ON mr.id = l.meta_lead_id
       LEFT JOIN he_lead_profile lp ON lp.lead_id = l.id
      WHERE l.status IN ('new','contacted','interested','declined','no_show')
        AND l.is_employee = 0 AND l.final_status <> 'joined'
        ${aud.sql}${o.excludeOnDrive ? "\n        AND NOT EXISTS (SELECT 1 FROM he_match mx LEFT JOIN he_drive dx ON dx.id = mx.drive_id WHERE mx.lead_id = l.id AND (mx.drive_id = ? OR (mx.requisition_id = ? AND dx.status <> 'closed' AND dx.drive_date >= CURDATE())))" : ""}
        -- Already booked: an invite on a LIVE drive, or a confirmation anywhere. An invite that sits on a closed drive (the drive was
        -- replaced or abandoned) no longer holds anyone, so that person can be lined up again; a confirmed person keeps their date.
        AND NOT EXISTS (SELECT 1 FROM he_match m LEFT JOIN he_drive dd ON dd.id = m.drive_id
                         WHERE m.lead_id = l.id AND m.slot_at >= NOW()
                           AND ((m.state IN ('invited','confirmed') AND (dd.id IS NULL OR dd.status <> 'closed')) OR m.state = 'confirmed'))
        AND NOT EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = l.id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NOT NULL)
        -- WHERE THE PERSON LIVES decides (RESIDENCE_SQL: city, addresses, Meta form answer, profile, recruiter-noted location). The branch they applied to
        -- and their campaign's branch say where the JOB is, so they never count. A named-but-ruled-out city ("No Noida location") does not count either.
        -- Only when the records hold NO residence text at all is a person of this very requisition trusted (the form's own ad targeting).
        ${locRe ? `AND ((${RESIDENCE_SQL} REGEXP ? AND NOT ${RESIDENCE_SQL} REGEXP ?) OR (TRIM(${RESIDENCE_SQL}) = '' AND mr.requisition_id = ?))` : ""}
        ${pre.map((c) => `AND ${c}`).join("\n        ")}
      ORDER BY (mr.requisition_id <=> ?) DESC, has_consent DESC, eng DESC, (l.education_rank IS NOT NULL) + (l.age IS NOT NULL) + (l.night_shift_ok IS NOT NULL) DESC LIMIT 5000`,
    [...aud.args, ...(o.excludeOnDrive ? [driveId, drive.requisition_id] : []), ...(locRe ? [locRe, negRe ?? "$^", req.id] : []), ...preArgs, req.id]))[0];
  let leads = await selectCandidates();
  // The rollup columns decide who is an employee / already joined. Refresh any prefix whose rollup is missing or a day old
  // before trusting it, so a never-refreshed lead cannot slip through the gate.
  const staleCut = Date.now() - 86_400_000;
  const stalePrefixes = [...new Set(leads.filter((l) => !l.history_refreshed_at || new Date(l.history_refreshed_at).getTime() < staleCut).map((l) => String(l.mobile10).slice(0, 2)))];
  if (write && stalePrefixes.length) {
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
  // Follow-up records: only people newly on this drive, and only when the pipeline is switched on (mode off makes no extra query).
  const trackFollowups = write && scored.length > 0 && followupMode() !== "off";
  let newLeadIds: string[] = [];
  if (trackFollowups) {
    try {
      const ids = scored.map((x) => x.id);
      const [on] = await db.execute<RowDataPacket[]>(`SELECT lead_id FROM he_match WHERE drive_id = ? AND lead_id IN (${ids.map(() => "?").join(",")})`, [driveId, ...ids]);
      const had = new Set(on.map((r) => String(r.lead_id)));
      newLeadIds = ids.filter((id) => !had.has(id));
    } catch (err) { logger.warn({ driveId, err: String((err as Error).message).replace(/\d{6,}/g, "#") }, "[qualified-followup] line-up pre-check failed"); }
  }
  if (write) for (const s of scored) {
    await db.execute(
      `INSERT INTO he_match (lead_id, requisition_id, drive_id, score, reasons_json, distance_km, state, token)
       VALUES (?,?,?,?,?,?, 'suggested', ?)
       ON DUPLICATE KEY UPDATE
         -- moved to a new drive (the old one was closed, or its slot is past): back to 'suggested' with no slot, so it is invited
         -- afresh for the new date. Order matters: slot_at and state read the OLD drive_id before it is overwritten.
         -- a no-show of an earlier drive is invited afresh for a NEW drive (same-drive rows keep their state)
         slot_at = IF(drive_id <=> VALUES(drive_id) OR state NOT IN ('invited','confirmed','slot_released','no_show'), slot_at, NULL),
         state = IF(drive_id <=> VALUES(drive_id) OR state NOT IN ('invited','confirmed','slot_released','no_show'), state, 'suggested'),
         drive_id = VALUES(drive_id), score = VALUES(score), reasons_json = VALUES(reasons_json), distance_km = VALUES(distance_km)`,
      [s.id, drive.requisition_id, driveId, s.res.score, JSON.stringify({ reasons: s.res.reasons, unknown: s.res.unknown, confidence: s.res.confidence, priority: s.priority }), s.res.distanceKm, randomBytes(16).toString("hex")]);
  }
  if (trackFollowups && newLeadIds.length) {
    void enqueueMatchedFollowups({ id: driveId, requisitionId: drive.requisition_id, sourceKind: drive.source_kind, runLabel: drive.run_label, driveDate: String(drive.drive_date).slice(0, 10) }, newLeadIds, o.followupStream ?? null)
      .catch((err) => logger.warn({ driveId, err: String((err as Error).message).replace(/\d{6,}/g, "#") }, "[qualified-followup] matched enqueue failed"));
  }
  // Earlier suggestions that no longer qualify (e.g. before the location rule) are dropped; contacted people are kept.
  // excludeOnDrive means a per-stream line-up: the people it left out are other streams' and must never be deleted here.
  if (!write || o.keepOtherSuggestions || o.excludeOnDrive) { /* preview, or other streams' suggestions stay */ } else if (scored.length) {
    const keep = scored.map((x) => x.id);
    await db.execute(`DELETE FROM he_match WHERE drive_id = ? AND state = 'suggested' AND lead_id NOT IN (${keep.map(() => "?").join(",")})`, [driveId, ...keep]);
  } else await db.execute("DELETE FROM he_match WHERE drive_id = ? AND state = 'suggested'", [driveId]);
  return { suggested: scored.length, blockedByReason: { ...gate.blockedByReason, ...(locRe ? {} : { no_branch_location_known: 0 }) }, considered: leads.length, leadIds: scored.map((x) => x.id), location: locRe ? branchLocationTokens(req.branch_name, req.bcity ?? null).slice(0, 6) : null };
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

/** Everything the records say about where each lead lives or applied (lead, ATS, Meta form, recruiter calls), lower-cased. */
export async function leadLocationTexts(leadIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!leadIds.length) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, ${RESIDENCE_SQL} AS loc
       FROM he_lead l LEFT JOIN ats_candidate ac ON ac.id = l.ats_candidate_id LEFT JOIN meta_lead_raw mr ON mr.id = l.meta_lead_id LEFT JOIN he_lead_profile lp ON lp.lead_id = l.id
      WHERE l.id IN (${leadIds.map(() => "?").join(",")})`, leadIds);
  for (const r of rows) out.set(String(r.id), String(r.loc ?? ""));
  return out;
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
  // A requisition is only an alternative when the candidate's records place them in that branch's area (same rule as the drive shortlist).
  const loc = (await leadLocationTexts([leadId])).get(leadId) ?? "";
  const inArea = reqs.filter((r) => placedInBranchArea(loc, r.branch_name, r.bcity));
  const ranked = rankRequisitions(
    { age: l.age, educationRank: l.education_rank, experienceYears: l.experience_years == null ? null : Number(l.experience_years), nightShiftOk: l.night_shift_ok == null ? null : Boolean(l.night_shift_ok), lat: l.lat == null ? null : Number(l.lat), lng: l.lng == null ? null : Number(l.lng), ...prof },
    inArea.map(toMatchRequisition), limit);
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
