import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

/**
 * Training Needs Identification, derived from real audit data.
 *
 * A Training Need is not a form someone fills in — it is what falls out when an
 * agent, or a whole process, keeps failing the same audited parameter across
 * enough calls to rule out chance. Every parameter here reuses the EXACT column
 * and pass/scored definition already proven live in kpi_studio_source_field for
 * CALL_AUDIT_SHARED, so a finding always traces back to a number a manager can
 * already see on a KPI Studio scorecard — nothing here invents a new way to read
 * db_audit.call_quality_assessment.
 *
 * Two rule shapes, because two different things go wrong on a call:
 *   - A SKILL parameter (accuracy/closure/concern/empathy/listening/probing) is
 *     scored on every audited call, so it has a real rate: fails / scored. Rare
 *     evidence proves nothing, so a minimum sample gates every finding.
 *   - profanity is an EVENT, not a rate — most calls carry no opportunity for it
 *     at all, so "fails / scored" is meaningless. A small occurrence count in the
 *     window is itself the evidence.
 *
 * competitor_named and the two VOC-negative flags are deliberately NOT rules
 * here. A competitor being named, or a customer being unhappy about logistics or
 * a product, is not evidence the AGENT did anything wrong — it is evidence about
 * the call's SUBJECT, and coaching the agent on it fixes nothing. Building a
 * "training need" out of them would misdirect real training effort at a problem
 * training cannot solve; that judgement is worth writing down here rather than
 * automating.
 */

export type TniCategory = "PROCESS_KNOWLEDGE" | "SOFT_SKILLS" | "CALL_HANDLING" | "CONDUCT";
export type CoachingType = "ONE_ON_ONE" | "GROUP_SESSION" | "CONTENT_GAP_REVIEW";
export type Severity = "MEDIUM" | "HIGH" | "EXTREME_REVIEW";

export interface SkillParameterRule {
  kind: "skill";
  key: string;
  column: string;
  category: TniCategory;
  /** Below this many scored calls in the window, a fail rate is not evidence of anything. */
  minSample: number;
  /** Fail rate strictly above this raises a finding. */
  failRateThreshold: number;
}

export interface EventParameterRule {
  kind: "event";
  key: string;
  /** The count column; an occurrence is `column > 0` on a row. */
  column: string;
  category: TniCategory;
  coachingType: CoachingType;
  /** This many or more occurrences in the window raises a finding. */
  minOccurrences: number;
}

export type ParameterRule = SkillParameterRule | EventParameterRule;

/**
 * The six skill parameters map to three training categories, matched to what
 * they actually measure rather than treated as one undifferentiated "quality"
 * bucket: getting the facts right is not the same gap as being warm with a
 * customer, and neither is the same gap as closing a call properly.
 */
export const PARAMETER_RULES: ParameterRule[] = [
  { kind: "skill", key: "accuracy",  column: "correct_and_complete_information", category: "PROCESS_KNOWLEDGE", minSample: 5, failRateThreshold: 0.30 },
  { kind: "skill", key: "probing",   column: "accurate_issue_probing",           category: "PROCESS_KNOWLEDGE", minSample: 5, failRateThreshold: 0.30 },
  { kind: "skill", key: "concern",   column: "customer_concern_acknowledged",    category: "SOFT_SKILLS",       minSample: 5, failRateThreshold: 0.30 },
  { kind: "skill", key: "empathy",   column: "express_empathy",                  category: "SOFT_SKILLS",       minSample: 5, failRateThreshold: 0.30 },
  { kind: "skill", key: "listening", column: "active_listening",                 category: "SOFT_SKILLS",       minSample: 5, failRateThreshold: 0.30 },
  { kind: "skill", key: "closure",   column: "proper_call_closure",              category: "CALL_HANDLING",     minSample: 5, failRateThreshold: 0.30 },
  { kind: "event", key: "profanity", column: "agent_english_cuss_count",         category: "CONDUCT", coachingType: "ONE_ON_ONE", minOccurrences: 2 },
];

/** A fail rate this extreme on this much evidence is as likely to be a scoring/calibration problem as a real one. */
const EXTREME_FAIL_RATE = 0.90;
const EXTREME_MIN_SAMPLE = 20;

/** Above this share of a process's audited agents failing the SAME parameter, the finding is a content gap, not one person's coaching. */
const SYSTEMIC_SHARE = 0.30;
const SYSTEMIC_MIN_AGENTS = 3;

export function classifySkillFinding(
  rule: SkillParameterRule,
  scored: number,
  fails: number,
): { severity: Severity; coachingType: CoachingType } | null {
  if (scored < rule.minSample) return null;
  const failRate = fails / scored;
  if (failRate <= rule.failRateThreshold) return null;
  const severity: Severity =
    failRate >= EXTREME_FAIL_RATE && scored >= EXTREME_MIN_SAMPLE ? "EXTREME_REVIEW" : "MEDIUM";
  return { severity, coachingType: "ONE_ON_ONE" };
}

export function isSystemic(flaggedAgents: number, totalAudited: number): boolean {
  if (totalAudited <= 0 || flaggedAgents < SYSTEMIC_MIN_AGENTS) return false;
  return flaggedAgents / totalAudited >= SYSTEMIC_SHARE;
}

export function evidenceNote(
  rule: ParameterRule,
  sample: number,
  fails: number,
  from: string,
  to: string,
): string {
  const rate = sample > 0 ? Math.round((fails / sample) * 1000) / 10 : 0;
  const noun = rule.kind === "skill" ? "audits" : "incidents";
  return `${fails} of ${sample} ${noun} failed "${rule.key}" between ${from} and ${to} (${rate}%)`;
}

// ─── Live derivation ──────────────────────────────────────────────────────

interface AgentRow extends RowDataPacket {
  user_code: string;
  employee_id: string | null;
  employee_name: string | null;
  process_id: string | null;
  process_name: string | null;
  scored: number;
  fails: number;
}

interface EventRow extends RowDataPacket {
  user_code: string;
  employee_id: string | null;
  employee_name: string | null;
  process_id: string | null;
  process_name: string | null;
  occurrences: number;
}

export interface DerivedFinding {
  subjectType: "employee" | "process";
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  processId: string;
  processName: string | null;
  parameterKey: string;
  category: TniCategory;
  coachingType: CoachingType;
  severity: Severity;
  windowFrom: string;
  windowTo: string;
  sample: number;
  fails: number;
  evidenceNote: string;
}

/**
 * Scans the live audit table for one parameter over one window and returns every
 * finding it would raise — individual, and (for skill parameters) systemic. Pure
 * read; nothing is written here, so a caller can preview before persisting.
 */
export async function deriveFindingsForParameter(
  rule: ParameterRule,
  windowFrom: string,
  windowTo: string,
): Promise<DerivedFinding[]> {
  const findings: DerivedFinding[] = [];

  if (rule.kind === "skill") {
    const [rows] = await db.execute<AgentRow[]>(
      `SELECT q.User AS user_code, e.id AS employee_id, e.full_name AS employee_name,
              e.process_id AS process_id, p.process_name AS process_name,
              COUNT(*) AS scored,
              SUM(CASE WHEN q.\`${rule.column}\` = 0 THEN 1 ELSE 0 END) AS fails
         FROM db_audit.call_quality_assessment q
         LEFT JOIN employees e ON e.employee_code = q.User
         LEFT JOIN process_master p ON p.id = e.process_id
        WHERE q.CallDate BETWEEN ? AND ?
          AND q.\`${rule.column}\` IS NOT NULL
          AND q.User IS NOT NULL AND q.User <> ''
        GROUP BY q.User, e.id, e.full_name, e.process_id, p.process_name
        HAVING scored >= ?`,
      [windowFrom, windowTo, rule.minSample],
    );

    const flaggedByProcess = new Map<string, { count: number; name: string | null }>();
    const auditedByProcess = new Map<string, number>();

    for (const row of rows) {
      if (!row.process_id) continue; // an audited User with no resolvable employee/process is not attributable
      auditedByProcess.set(row.process_id, (auditedByProcess.get(row.process_id) ?? 0) + 1);
      const cls = classifySkillFinding(rule, Number(row.scored), Number(row.fails));
      if (!cls) continue;

      findings.push({
        subjectType: "employee",
        employeeId: row.employee_id,
        employeeCode: row.user_code,
        employeeName: row.employee_name,
        processId: row.process_id,
        processName: row.process_name,
        parameterKey: rule.key,
        category: rule.category,
        coachingType: cls.coachingType,
        severity: cls.severity,
        windowFrom, windowTo,
        sample: Number(row.scored),
        fails: Number(row.fails),
        evidenceNote: evidenceNote(rule, Number(row.scored), Number(row.fails), windowFrom, windowTo),
      });

      const bucket = flaggedByProcess.get(row.process_id) ?? { count: 0, name: row.process_name };
      bucket.count++;
      flaggedByProcess.set(row.process_id, bucket);
    }

    for (const [processId, bucket] of flaggedByProcess) {
      const totalAudited = auditedByProcess.get(processId) ?? 0;
      if (!isSystemic(bucket.count, totalAudited)) continue;
      findings.push({
        subjectType: "process",
        employeeId: null, employeeCode: null, employeeName: null,
        processId, processName: bucket.name,
        parameterKey: rule.key,
        category: rule.category,
        coachingType: "CONTENT_GAP_REVIEW",
        severity: "HIGH",
        windowFrom, windowTo,
        sample: totalAudited, fails: bucket.count,
        evidenceNote: `${bucket.count} of ${totalAudited} audited agents (${Math.round((bucket.count / totalAudited) * 100)}%) are failing "${rule.key}" between ${windowFrom} and ${windowTo} — a training content gap, not one person's coaching`,
      });
    }
    return findings;
  }

  // Event-shaped rule (profanity): an occurrence count, not a rate.
  const [rows] = await db.execute<EventRow[]>(
    `SELECT q.User AS user_code, e.id AS employee_id, e.full_name AS employee_name,
            e.process_id AS process_id, p.process_name AS process_name,
            COUNT(*) AS occurrences
       FROM db_audit.call_quality_assessment q
       LEFT JOIN employees e ON e.employee_code = q.User
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE q.CallDate BETWEEN ? AND ?
        AND q.\`${rule.column}\` > 0
        AND q.User IS NOT NULL AND q.User <> ''
      GROUP BY q.User, e.id, e.full_name, e.process_id, p.process_name
      HAVING occurrences >= ?`,
    [windowFrom, windowTo, rule.minOccurrences],
  );

  for (const row of rows) {
    if (!row.process_id) continue;
    findings.push({
      subjectType: "employee",
      employeeId: row.employee_id,
      employeeCode: row.user_code,
      employeeName: row.employee_name,
      processId: row.process_id,
      processName: row.process_name,
      parameterKey: rule.key,
      category: rule.category,
      coachingType: rule.coachingType,
      severity: "HIGH",
      windowFrom, windowTo,
      sample: Number(row.occurrences), fails: Number(row.occurrences),
      evidenceNote: evidenceNote(rule, Number(row.occurrences), Number(row.occurrences), windowFrom, windowTo),
    });
  }
  return findings;
}

/**
 * Persists derived findings, one OPEN row per (subject, parameter) at a time.
 * A re-scan updates the still-open finding's evidence in place rather than
 * piling up duplicates for the same unresolved gap — a manager should see one
 * row per problem, with its numbers current as of the latest scan.
 */
export async function persistFindings(
  findings: DerivedFinding[],
  createdBy: string | null,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const f of findings) {
    const failRate = f.sample > 0 ? f.fails / f.sample : null;
    const subjectCol = f.subjectType === "employee" ? "employee_id" : "process_id";
    const subjectVal = f.subjectType === "employee" ? f.employeeId : f.processId;

    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM tni_finding
        WHERE subject_type = ? AND ${subjectCol} <=> ? AND parameter_key = ?
          AND status NOT IN ('COMPLETED','VERIFIED_EFFECTIVE','VERIFIED_INEFFECTIVE','DISMISSED')
        LIMIT 1`,
      [f.subjectType, subjectVal, f.parameterKey],
    );

    if (existing.length) {
      await db.execute(
        `UPDATE tni_finding
            SET window_from = ?, window_to = ?, sample_count = ?, fail_count = ?,
                fail_rate = ?, evidence_note = ?, severity = ?, updated_at = NOW()
          WHERE id = ?`,
        [f.windowFrom, f.windowTo, f.sample, f.fails, failRate, f.evidenceNote, f.severity, existing[0].id],
      );
      updated++;
      continue;
    }

    await db.execute(
      `INSERT INTO tni_finding
         (id, subject_type, employee_id, employee_code, employee_name, process_id, process_name,
          parameter_key, tni_category, coaching_type, severity,
          window_from, window_to, sample_count, fail_count, fail_rate, evidence_note,
          status, target_completion_date, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'OPEN', DATE_ADD(CURDATE(), INTERVAL 14 DAY), ?)`,
      [
        randomUUID(), f.subjectType, f.employeeId, f.employeeCode, f.employeeName, f.processId, f.processName,
        f.parameterKey, f.category, f.coachingType, f.severity,
        f.windowFrom, f.windowTo, f.sample, f.fails, failRate, f.evidenceNote,
        createdBy,
      ],
    );
    inserted++;
  }

  return { inserted, updated };
}

/** Runs every parameter rule over one window and persists what it finds. */
export async function runTniScan(
  windowFrom: string,
  windowTo: string,
  createdBy: string | null,
): Promise<{ inserted: number; updated: number; findings: DerivedFinding[] }> {
  const all: DerivedFinding[] = [];
  for (const rule of PARAMETER_RULES) {
    all.push(...(await deriveFindingsForParameter(rule, windowFrom, windowTo)));
  }
  const { inserted, updated } = await persistFindings(all, createdBy);
  return { inserted, updated, findings: all };
}
