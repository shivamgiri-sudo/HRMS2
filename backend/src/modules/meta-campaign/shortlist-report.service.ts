/**
 * Shortlist report — "who would HRMS shortlist, and why", computed read-only.
 *
 * Every META lead is re-parsed from its stored raw payload and screened against the batch
 * requisition it maps to, using exactly the rules ingest and rescreenLead use (parseLead +
 * screenLead + requisitionClosedReason). Nothing is written: the stored screening_result is shown
 * next to the result HRMS would reach today, so the gap between the two is visible before anyone
 * re-screens.
 *
 * Requisition mapping mirrors rescreenLead: a hidden requisition_code on the form wins over the
 * stored link; otherwise the stored requisition_id is used; otherwise the lead is "unmapped" and
 * cannot be screened at all.
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { parseLead } from './meta-lead.parser.js';
import type { ParsedLead } from './meta-lead.parser.js';
import { requisitionClosedReason, screenLead } from './lead-screener.service.js';
import type { MetaScreeningConfig } from '../job-requisition/job-requisition.types.js';
import type { MetaLeadDetail } from './meta-campaign.types.js';

export type CurrentResult = 'pending' | 'qualified' | 'disqualified';
/** unmapped = no requisition to screen against; no_data = raw payload unusable (Graph fetch failed). */
export type ProposedResult = 'qualified' | 'disqualified' | 'unmapped' | 'no_data';
export type MappingSource = 'routing_code' | 'stored' | 'none';

export interface RequisitionInfo {
  id: string;
  code: string | null;
  designation: string | null;
  branch: string | null;
  process: string | null;
  ageMin: number | null;
  ageMax: number | null;
  education: string | null;
  experienceMin: number | null;
  experienceMax: number | null;
  screeningConfig: MetaScreeningConfig | null;
  approvalStatus: string | null;
  activeStatus: number | null;
  closedAt: string | null;
  requestedHeadcount: number | null;
  fulfilledHeadcount: number | null;
}

export interface ShortlistEvaluation {
  leadId: string;
  name: string | null;
  phone: string | null;
  createdAt: string | null;
  currentResult: CurrentResult;
  notified: boolean;
  mappingSource: MappingSource;
  requisitionId: string | null;
  requisitionCode: string | null;
  designation: string | null;
  branch: string | null;
  process: string | null;
  proposedResult: ProposedResult;
  /** Why the lead would be disqualified (null otherwise). */
  reason: string | null;
  /** Checks that could not be evaluated — what HRMS did NOT verify for this lead. */
  skipped: string[];
  /** Set when the batch is closed/filled: qualified leads are then not messaged. */
  closedReason: string | null;
  /** Qualified AND the batch is still open: the leads HRMS would actually contact. */
  outreachEligible: boolean;
  /** Stored result differs from the proposed one (only meaningful when the lead is mappable). */
  changed: boolean;
  /** The form's requisition code points at a different requisition than the stored link. */
  relink: boolean;
}

export interface LeadRow {
  id: string;
  meta_form_id?: string | null;
  requisition_id: string | null;
  raw_payload: unknown;
  parsed_name: string | null;
  parsed_phone: string | null;
  screening_result: string | null;
  notification_sent_at: unknown;
  created_at: unknown;
}

export interface RequisitionIndex {
  byId: Map<string, RequisitionInfo>;
  byCode: Map<string, RequisitionInfo>;
}

const asNumber = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const asIso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export function indexRequisitions(list: RequisitionInfo[]): RequisitionIndex {
  const byId = new Map<string, RequisitionInfo>();
  const byCode = new Map<string, RequisitionInfo>();
  for (const r of list) {
    byId.set(r.id, r);
    if (r.code) byCode.set(r.code.toUpperCase(), r);
  }
  return { byId, byCode };
}

function parseRawPayload(raw: unknown): MetaLeadDetail | null {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (obj && typeof obj === 'object' && Array.isArray((obj as MetaLeadDetail).field_data)) {
      return obj as MetaLeadDetail;
    }
  } catch {
    /* unusable payload */
  }
  return null;
}

/** Resolve which requisition a lead belongs to, in the same precedence rescreenLead uses. */
export function resolveRequisition(
  parsed: ParsedLead | null,
  storedId: string | null,
  index: RequisitionIndex
): { requisition: RequisitionInfo | null; source: MappingSource } {
  const routed = parsed?.routingCode ? index.byCode.get(parsed.routingCode.toUpperCase()) : undefined;
  if (routed) return { requisition: routed, source: 'routing_code' };
  const stored = storedId ? index.byId.get(storedId) : undefined;
  if (stored) return { requisition: stored, source: 'stored' };
  return { requisition: null, source: 'none' };
}

export function screenAgainst(parsed: ParsedLead, r: RequisitionInfo) {
  return screenLead(
    {
      parsedAge: parsed.age,
      parsedEducation: parsed.education,
      parsedExperienceYr: parsed.experienceYears,
      parsedGender: parsed.gender,
      rawFields: parsed.rawFields,
    },
    {
      metaTargetAgeMin: r.ageMin,
      metaTargetAgeMax: r.ageMax,
      educationRequirement: r.education,
      experienceMinYears: r.experienceMin,
      experienceMaxYears: r.experienceMax,
      screeningConfig: r.screeningConfig,
    }
  );
}

export function closedReasonFor(r: RequisitionInfo): string | null {
  return requisitionClosedReason({
    approvalStatus: r.approvalStatus,
    activeStatus: r.activeStatus,
    closedAt: r.closedAt,
    requestedHeadcount: r.requestedHeadcount,
    fulfilledHeadcount: r.fulfilledHeadcount,
  });
}

/** Pure: evaluate one stored lead row. No I/O. */
export function evaluateLeadRow(row: LeadRow, index: RequisitionIndex): ShortlistEvaluation {
  const current = (['pending', 'qualified', 'disqualified'].includes(String(row.screening_result))
    ? row.screening_result
    : 'pending') as CurrentResult;

  const base = {
    leadId: String(row.id),
    name: row.parsed_name,
    phone: row.parsed_phone,
    createdAt: asIso(row.created_at),
    currentResult: current,
    notified: Boolean(row.notification_sent_at),
  };

  const detail = parseRawPayload(row.raw_payload);
  const parsed = detail ? parseLead(detail) : null;
  const { requisition, source } = resolveRequisition(parsed, row.requisition_id, index);

  const reqFields = {
    mappingSource: source,
    requisitionId: requisition?.id ?? null,
    requisitionCode: requisition?.code ?? null,
    designation: requisition?.designation ?? null,
    branch: requisition?.branch ?? null,
    process: requisition?.process ?? null,
  };

  if (!parsed) {
    return { ...base, ...reqFields, proposedResult: 'no_data', reason: null, skipped: [], closedReason: null, outreachEligible: false, changed: false, relink: false };
  }
  if (!requisition) {
    return { ...base, ...reqFields, proposedResult: 'unmapped', reason: null, skipped: [], closedReason: null, outreachEligible: false, changed: false, relink: false };
  }

  const result = screenAgainst(parsed, requisition);
  const proposed: ProposedResult = result.qualified ? 'qualified' : 'disqualified';
  const closedReason = closedReasonFor(requisition);
  return {
    ...base,
    ...reqFields,
    proposedResult: proposed,
    reason: result.reason,
    skipped: result.skipped,
    closedReason,
    outreachEligible: result.qualified && !closedReason,
    changed: current !== proposed,
    relink: source === 'routing_code' && row.requisition_id !== requisition.id,
  };
}

// ── Loading ───────────────────────────────────────────────────────────────────────────────────

const PAGE = 500;

export async function loadRequisitionIndex(): Promise<RequisitionIndex> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, requisition_code, designation_name, branch_name, process_name,
            meta_target_age_min, meta_target_age_max, education_requirement,
            experience_min_years, experience_max_years, meta_screening_config,
            approval_status, active_status, closed_at, requested_headcount, fulfilled_headcount
       FROM job_requisition`
  );
  return indexRequisitions(
    rows.map((r) => {
      const cfg = r.meta_screening_config;
      let screeningConfig: MetaScreeningConfig | null = null;
      if (cfg) {
        try {
          screeningConfig = typeof cfg === 'string' ? JSON.parse(cfg) : cfg;
        } catch {
          screeningConfig = null;
        }
      }
      return {
        id: String(r.id),
        code: (r.requisition_code as string | null) ?? null,
        designation: (r.designation_name as string | null) ?? null,
        branch: (r.branch_name as string | null) ?? null,
        process: (r.process_name as string | null) ?? null,
        ageMin: asNumber(r.meta_target_age_min),
        ageMax: asNumber(r.meta_target_age_max),
        education: (r.education_requirement as string | null) ?? null,
        experienceMin: asNumber(r.experience_min_years),
        experienceMax: asNumber(r.experience_max_years),
        screeningConfig,
        approvalStatus: (r.approval_status as string | null) ?? null,
        activeStatus: asNumber(r.active_status),
        closedAt: asIso(r.closed_at),
        requestedHeadcount: asNumber(r.requested_headcount),
        fulfilledHeadcount: asNumber(r.fulfilled_headcount),
      };
    })
  );
}

/** Evaluate every stored lead, keyset-paged so the raw payloads are never all in memory at once. */
export async function evaluateAllLeads(): Promise<{ evaluations: ShortlistEvaluation[]; index: RequisitionIndex }> {
  const index = await loadRequisitionIndex();
  const evaluations: ShortlistEvaluation[] = [];
  let after = '';
  for (;;) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, requisition_id, raw_payload, parsed_name, parsed_phone,
              screening_result, notification_sent_at, created_at
         FROM meta_lead_raw
        WHERE id > ?
        ORDER BY id
        LIMIT ${PAGE}`,
      [after]
    );
    if (!rows.length) break;
    for (const r of rows) evaluations.push(evaluateLeadRow(r as unknown as LeadRow, index));
    after = String(rows[rows.length - 1]!.id);
    if (rows.length < PAGE) break;
  }
  return { evaluations, index };
}

// ── Cache (the full pass reads every payload; the page asks several questions of it) ───────────

const CACHE_TTL_MS = 60_000;
let cache: { at: number; value: { evaluations: ShortlistEvaluation[]; index: RequisitionIndex } } | null = null;

export async function getEvaluations(force = false) {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const value = await evaluateAllLeads();
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateShortlistCache(): void {
  cache = null;
}

// ── Reporting ─────────────────────────────────────────────────────────────────────────────────

export interface ShortlistFilters {
  /** Restrict to one branch (used for branch-scoped callers; unmapped leads are then excluded). */
  branchName?: string;
  requisitionId?: string;
  proposed?: ProposedResult | 'all';
  current?: CurrentResult | 'all';
  changedOnly?: boolean;
  outreachEligibleOnly?: boolean;
  search?: string;
}

export function filterEvaluations(list: ShortlistEvaluation[], f: ShortlistFilters): ShortlistEvaluation[] {
  const q = f.search?.trim().toLowerCase();
  return list.filter((e) => {
    if (f.branchName && e.branch !== f.branchName) return false;
    if (f.requisitionId && e.requisitionId !== f.requisitionId) return false;
    if (f.proposed && f.proposed !== 'all' && e.proposedResult !== f.proposed) return false;
    if (f.current && f.current !== 'all' && e.currentResult !== f.current) return false;
    if (f.changedOnly && !e.changed) return false;
    if (f.outreachEligibleOnly && !e.outreachEligible) return false;
    if (q && !`${e.name ?? ''} ${e.phone ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const top = (m: Map<string, number>, n: number) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }));

/** Numbers vary per lead ("Age 16 below minimum 18"); group reasons by their shape. */
const reasonKey = (reason: string) => reason.replace(/\d+(\.\d+)?/g, 'N').replace(/"[^"]*"/g, '"…"');

export interface ShortlistSummary {
  totalLeads: number;
  proposed: Record<ProposedResult, number>;
  current: Record<CurrentResult, number>;
  /** Leads whose stored result would change on re-screen (mappable leads only). */
  wouldChange: number;
  /** Stored requisition link differs from the form's requisition code. */
  wouldRelink: number;
  /** Would move from pending/disqualified to qualified. */
  newlyQualified: number;
  /** Would move from qualified to disqualified. */
  newlyDisqualified: number;
  /** Qualified and batch open: the leads HRMS would contact. */
  outreachEligible: number;
  /** Qualified but the batch is closed/filled. */
  qualifiedButBatchClosed: number;
  alreadyNotified: number;
  topDisqualificationReasons: Array<{ label: string; count: number }>;
  topUnverifiedChecks: Array<{ label: string; count: number }>;
  byRequisition: Array<{
    requisitionId: string;
    requisitionCode: string | null;
    designation: string | null;
    branch: string | null;
    process: string | null;
    closedReason: string | null;
    requestedHeadcount: number | null;
    fulfilledHeadcount: number | null;
    total: number;
    qualified: number;
    disqualified: number;
    outreachEligible: number;
  }>;
}

export function summarise(list: ShortlistEvaluation[], index: RequisitionIndex): ShortlistSummary {
  const proposed: Record<ProposedResult, number> = { qualified: 0, disqualified: 0, unmapped: 0, no_data: 0 };
  const current: Record<CurrentResult, number> = { pending: 0, qualified: 0, disqualified: 0 };
  const reasons = new Map<string, number>();
  const skipped = new Map<string, number>();
  const perReq = new Map<string, ShortlistSummary['byRequisition'][number]>();
  let wouldChange = 0;
  let newlyQualified = 0;
  let wouldRelink = 0;
  let newlyDisqualified = 0;
  let outreachEligible = 0;
  let qualifiedButBatchClosed = 0;
  let alreadyNotified = 0;

  for (const e of list) {
    proposed[e.proposedResult] += 1;
    current[e.currentResult] += 1;
    if (e.notified) alreadyNotified += 1;
    if (e.changed) {
      wouldChange += 1;
      if (e.proposedResult === 'qualified') newlyQualified += 1;
      if (e.proposedResult === 'disqualified' && e.currentResult === 'qualified') newlyDisqualified += 1;
    }
    if (e.relink) wouldRelink += 1;
    if (e.outreachEligible) outreachEligible += 1;
    if (e.proposedResult === 'qualified' && e.closedReason) qualifiedButBatchClosed += 1;
    if (e.reason) bump(reasons, reasonKey(e.reason));
    for (const s of e.skipped) bump(skipped, reasonKey(s));

    if (e.requisitionId) {
      const req = index.byId.get(e.requisitionId);
      let row = perReq.get(e.requisitionId);
      if (!row) {
        row = {
          requisitionId: e.requisitionId,
          requisitionCode: e.requisitionCode,
          designation: e.designation,
          branch: e.branch,
          process: e.process,
          closedReason: req ? closedReasonFor(req) : null,
          requestedHeadcount: req?.requestedHeadcount ?? null,
          fulfilledHeadcount: req?.fulfilledHeadcount ?? null,
          total: 0,
          qualified: 0,
          disqualified: 0,
          outreachEligible: 0,
        };
        perReq.set(e.requisitionId, row);
      }
      row.total += 1;
      if (e.proposedResult === 'qualified') row.qualified += 1;
      if (e.proposedResult === 'disqualified') row.disqualified += 1;
      if (e.outreachEligible) row.outreachEligible += 1;
    }
  }

  return {
    totalLeads: list.length,
    proposed,
    current,
    wouldChange,
    wouldRelink,
    newlyQualified,
    newlyDisqualified,
    outreachEligible,
    qualifiedButBatchClosed,
    alreadyNotified,
    topDisqualificationReasons: top(reasons, 10),
    topUnverifiedChecks: top(skipped, 10),
    byRequisition: [...perReq.values()].sort((a, b) => b.total - a.total),
  };
}

/** One lead in full: what was read from the form, what the requisition demands, what was decided. */
export async function getLeadShortlistDetail(leadId: string) {
  const index = await loadRequisitionIndex();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, requisition_id, raw_payload, parsed_name, parsed_phone,
            screening_result, notification_sent_at, created_at
       FROM meta_lead_raw WHERE id = ? LIMIT 1`,
    [leadId]
  );
  const row = rows[0];
  if (!row) return null;
  const evaluation = evaluateLeadRow(row as unknown as LeadRow, index);
  const detail = parseRawPayload(row.raw_payload);
  const parsed = detail ? parseLead(detail) : null;
  const requisition = evaluation.requisitionId ? index.byId.get(evaluation.requisitionId) ?? null : null;
  return {
    evaluation,
    requisition,
    lead: parsed && {
      age: parsed.age,
      education: parsed.education,
      experienceYears: parsed.experienceYears,
      gender: parsed.gender,
      location: parsed.location,
      routingCode: parsed.routingCode,
      answers: parsed.rawFields,
    },
  };
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────

const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection from candidate-authored text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(list: ShortlistEvaluation[]): string {
  const header = [
    'Lead ID', 'Name', 'Phone', 'Requisition', 'Designation', 'Branch', 'Process', 'Mapped via',
    'Current result', 'Proposed result', 'Would change', 'Outreach eligible', 'Batch status',
    'Disqualification reason', 'Not verified', 'Already notified', 'Applied on',
  ];
  const lines = list.map((e) =>
    [
      e.leadId, e.name, e.phone, e.requisitionCode, e.designation, e.branch, e.process, e.mappingSource,
      e.currentResult, e.proposedResult, e.changed ? 'yes' : 'no', e.outreachEligible ? 'yes' : 'no',
      e.closedReason ?? (e.requisitionId ? 'open' : ''), e.reason, e.skipped.join('; '),
      e.notified ? 'yes' : 'no', e.createdAt,
    ].map(csvCell).join(',')
  );
  return [header.map(csvCell).join(','), ...lines].join('\r\n');
}
