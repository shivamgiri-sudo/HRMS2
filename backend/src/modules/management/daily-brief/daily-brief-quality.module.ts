/**
 * Quality module for the D-1 Daily Manager Briefing Engine.
 *
 * Sibling to daily-brief-aggregator.service.ts, NOT wired into it yet.
 * Reuses `db_audit.call_quality_assessment` via the SAME read-only upstream-DB
 * boundary as modules/quality-dashboard/quality-dashboard-v2.service.ts: the
 * `querySource()` helper (db/sourceDb.js), never a write. Its `User` column
 * matches `employees.employee_code` exactly (verified live by that service),
 * so identity/scope resolution happens in application code, mirroring
 * QualityDashboardV2Service.employeesByCode / scopedUserRows.
 *
 * PASS/FAIL RULE — VERIFIED, NOT INVENTED:
 *   quality-dashboard-v2.service.ts computes only a raw average quality_percentage
 *   with no pass/fail rule and no minimum-sample gate. Checked further:
 *   - quality-qa.service.ts: no pass/fail or min-sample constant either.
 *   - quality-manager.service.ts DOES define a live bucket scheme
 *     (excellent >=90, good 80-89.99, average 70-79.99, poor <70) and uses
 *     `quality_pct < 70` as `coaching_needed` — but that is per-employee-average
 *     coaching triggering on an arbitrary days-back window, a different question
 *     from "is this D-1 quality reading trustworthy". Not reused here as a
 *     pass/fail gate — see report for why.
 *   - modules/quality-dashboard/coaching-trigger.ts DOES define a genuine,
 *     already-live minimum-sample constant for treating a quality score as a
 *     trend rather than noise: `MIN_SAMPLE_FOR_TREND = 3` ("One audit is an
 *     incident, not a pattern"). That constant is REUSED here (not re-invented)
 *     as MIN_SCORED_CALLS_FOR_SIGNAL, applied to a new context (a team-scope
 *     D-1 snapshot rather than a per-employee coaching decision) — flagged
 *     explicitly in the build report per the governing prompt for this module.
 *
 * No pass/fail rule on individual scores exists anywhere in the codebase, so
 * this module reports avg%, scored-call count, and audit coverage only. It
 * never renders "pass" or "fail".
 *
 * Every query is wrapped so a failure yields SourceHealthState.ERROR, never a
 * silent zero, matching daily-brief-aggregator.service.ts's convention.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { querySource } from "../../../db/sourceDb.js";
import type { SourceHealth } from "./daily-brief.types.js";
import {
  QUALITY_MIN_SCORED_CALLS_FOR_SIGNAL as MIN_SCORED_CALLS_FOR_SIGNAL,
  MATERIAL_DELTA_POINTS,
} from "./daily-brief-editorial-constants.js";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type QualityDetailLevel = "summary" | "diagnostic";

export interface QualityTopPerformer {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  avgQualityPct: number;
  scoredCalls: number;
}

export interface QualityParameterFailRate {
  parameter: string;
  failRatePct: number;
  /** Assessed (non-null) sample this fail rate is computed over. */
  sampleCount: number;
}

export interface QualityModuleResult {
  detailLevel: QualityDetailLevel;
  teamSize: number;
  auditedEmployeeCount: number;
  auditCoveragePct: number | null;
  avgQualityPct: number | null;
  scoredCallCount: number;
  topPerformers: QualityTopPerformer[];
  trailingBaseline: {
    avgQualityPct: number | null;
    scoredCallCount: number;
  } | null;
  deterioration: {
    isMaterial: boolean;
    deltaPoints: number | null;
    note: string;
  } | null;
  /** Only populated when detailLevel === 'diagnostic'. */
  parameterFailRates: QualityParameterFailRate[] | null;
  sourceHealth: SourceHealth[];
}

type PerUserAgg = { user: string; scoreSum: number; scoredCalls: number };

/**
 * D-1 window: [reportingDate, reportingDate + 1 day).
 * Baseline window: the 7 calendar days strictly before reportingDate,
 * i.e. [reportingDate - 7 days, reportingDate).
 */
async function perUserAggregates(
  reportingDate: string,
  window: "d1" | "baseline",
  userCodes: string[],
): Promise<PerUserAgg[]> {
  if (userCodes.length === 0) return [];
  const placeholders = userCodes.map(() => "?").join(",");
  const whereClause = window === "d1"
    ? "CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)"
    : "CallDate >= DATE_SUB(?, INTERVAL 7 DAY) AND CallDate < ?";
  const rows = await querySource<{ User: string; score_sum: string | null; scored_calls: number }>(
    `SELECT User,
            SUM(CASE WHEN quality_percentage IS NOT NULL THEN quality_percentage ELSE 0 END) AS score_sum,
            SUM(quality_percentage IS NOT NULL) AS scored_calls
       FROM db_audit.call_quality_assessment
      WHERE ${whereClause}
        AND User IN (${placeholders})
      GROUP BY User`,
    [reportingDate, reportingDate, ...userCodes],
  );
  return rows.map((r) => ({
    user: r.User,
    scoreSum: Number(r.score_sum) || 0,
    scoredCalls: Number(r.scored_calls) || 0,
  }));
}

function emptyResult(detailLevel: QualityDetailLevel, teamSize: number): QualityModuleResult {
  return {
    detailLevel,
    teamSize,
    auditedEmployeeCount: 0,
    auditCoveragePct: null,
    avgQualityPct: null,
    scoredCallCount: 0,
    topPerformers: [],
    trailingBaseline: null,
    deterioration: null,
    parameterFailRates: null,
    sourceHealth: [],
  };
}

export async function buildQualityModule(
  teamEmployeeIds: string[],
  reportingDate: string,
  detailLevel: QualityDetailLevel,
): Promise<QualityModuleResult> {
  const teamSize = teamEmployeeIds.length;
  if (teamSize === 0) {
    const result = emptyResult(detailLevel, 0);
    result.sourceHealth = [
      { module: "quality", state: "NOT_APPLICABLE", detail: "No team members in scope", asOfDate: reportingDate },
    ];
    return result;
  }

  try {
    // Resolve employee_code for the team — db_audit.call_quality_assessment is
    // keyed by employee_code (`User`), not employee_id.
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code, full_name
         FROM employees
        WHERE id IN (${teamEmployeeIds.map(() => "?").join(",")})`,
      teamEmployeeIds,
    );
    type Emp = { id: string; employeeCode: string; fullName: string };
    const employees = (empRows as RowDataPacket[]).map((r) => ({
      id: String(r.id),
      employeeCode: String(r.employee_code),
      fullName: String(r.full_name),
    })) as Emp[];
    const codeToEmp = new Map(employees.map((e) => [e.employeeCode, e]));
    const codes = employees.map((e) => e.employeeCode);

    if (codes.length === 0) {
      const result = emptyResult(detailLevel, teamSize);
      result.sourceHealth = [
        { module: "quality", state: "NO_DATA", detail: "No resolvable employee codes for this team", asOfDate: reportingDate },
      ];
      return result;
    }

    const [d1PerUser, baselinePerUser] = await Promise.all([
      perUserAggregates(reportingDate, "d1", codes),
      perUserAggregates(reportingDate, "baseline", codes),
    ]);

    const auditedUsers = d1PerUser.filter((r) => r.scoredCalls > 0);
    const totalScoreSum = auditedUsers.reduce((sum, r) => sum + r.scoreSum, 0);
    const totalScoredCalls = auditedUsers.reduce((sum, r) => sum + r.scoredCalls, 0);
    const avgQualityPct = totalScoredCalls > 0 ? round1(totalScoreSum / totalScoredCalls) : null;
    const auditedEmployeeCount = auditedUsers.length;
    const auditCoveragePct = teamSize > 0 ? round1((auditedEmployeeCount / teamSize) * 100) : null;

    const topPerformers: QualityTopPerformer[] = auditedUsers
      .filter((r) => r.scoredCalls >= MIN_SCORED_CALLS_FOR_SIGNAL)
      .map((r) => {
        const emp = codeToEmp.get(r.user);
        return {
          employeeId: emp?.id ?? "",
          employeeCode: r.user,
          fullName: emp?.fullName ?? r.user,
          avgQualityPct: round1(r.scoreSum / r.scoredCalls),
          scoredCalls: r.scoredCalls,
        };
      })
      .sort((a, b) => b.avgQualityPct - a.avgQualityPct)
      .slice(0, 3);

    const baselineScoredCalls = baselinePerUser.reduce((sum, r) => sum + r.scoredCalls, 0);
    const baselineScoreSum = baselinePerUser.reduce((sum, r) => sum + r.scoreSum, 0);
    const baselineAvg = baselineScoredCalls > 0 ? round1(baselineScoreSum / baselineScoredCalls) : null;
    const trailingBaseline = baselineScoredCalls > 0
      ? { avgQualityPct: baselineAvg, scoredCallCount: baselineScoredCalls }
      : null;

    let deterioration: QualityModuleResult["deterioration"] = null;
    if (
      avgQualityPct !== null
      && totalScoredCalls >= MIN_SCORED_CALLS_FOR_SIGNAL
      && baselineAvg !== null
      && baselineScoredCalls >= MIN_SCORED_CALLS_FOR_SIGNAL
    ) {
      const deltaPoints = round1(avgQualityPct - baselineAvg);
      const isMaterial = deltaPoints <= -MATERIAL_DELTA_POINTS;
      deterioration = {
        isMaterial,
        deltaPoints,
        note: isMaterial
          ? `Quality down ${Math.abs(deltaPoints)} points vs 7-day baseline (editorial ${MATERIAL_DELTA_POINTS}-point floor — needs product sign-off).`
          : deltaPoints < 0
            ? `Quality down ${Math.abs(deltaPoints)} points vs 7-day baseline — below the material-change floor.`
            : `Quality at or above the 7-day baseline (${deltaPoints >= 0 ? "+" : ""}${deltaPoints} points).`,
      };
    }

    let parameterFailRates: QualityParameterFailRate[] | null = null;
    if (detailLevel === "diagnostic") {
      const paramRows = await querySource<Record<string, number | null>>(
        `SELECT
            SUM(call_answered_within_5_seconds = 0) AS callopen_fail, SUM(call_answered_within_5_seconds IS NOT NULL) AS callopen_n,
            SUM(professionalism_maintained = 0) AS prof_fail, SUM(professionalism_maintained IS NOT NULL) AS prof_n,
            SUM(active_listening = 0) AS listen_fail, SUM(active_listening IS NOT NULL) AS listen_n,
            SUM(proper_call_closure = 0) AS closure_fail, SUM(proper_call_closure IS NOT NULL) AS closure_n,
            SUM(correct_and_complete_information = 0) AS info_fail, SUM(correct_and_complete_information IS NOT NULL) AS info_n
           FROM db_audit.call_quality_assessment
          WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
            AND User IN (${codes.map(() => "?").join(",")})`,
        [reportingDate, reportingDate, ...codes],
      ).catch(() => []);
      const p = paramRows[0];
      if (p) {
        const rate = (fail: unknown, n: unknown): QualityParameterFailRate["failRatePct"] => {
          const nn = numberValue(n);
          return nn > 0 ? round1((numberValue(fail) / nn) * 100) : 0;
        };
        const defs: Array<[string, string, string]> = [
          ["Call opened within 5s", "callopen_fail", "callopen_n"],
          ["Professionalism maintained", "prof_fail", "prof_n"],
          ["Active listening", "listen_fail", "listen_n"],
          ["Proper call closure", "closure_fail", "closure_n"],
          ["Accuracy / complete information", "info_fail", "info_n"],
        ];
        parameterFailRates = defs.map(([label, failKey, nKey]) => ({
          parameter: label,
          failRatePct: rate(p[failKey], p[nKey]),
          sampleCount: numberValue(p[nKey]),
        }));
      } else {
        parameterFailRates = [];
      }
    }

    const state = totalScoredCalls === 0
      ? "NO_DATA"
      : totalScoredCalls < MIN_SCORED_CALLS_FOR_SIGNAL
        ? "INSUFFICIENT_SAMPLE"
        : "AVAILABLE";

    return {
      detailLevel,
      teamSize,
      auditedEmployeeCount,
      auditCoveragePct,
      avgQualityPct,
      scoredCallCount: totalScoredCalls,
      topPerformers,
      trailingBaseline,
      deterioration,
      parameterFailRates,
      sourceHealth: [
        {
          module: "quality",
          state,
          detail: state === "INSUFFICIENT_SAMPLE"
            ? `Only ${totalScoredCalls} scored call(s) for D-1 — below the editorial ${MIN_SCORED_CALLS_FOR_SIGNAL}-call floor reused from coaching-trigger.ts's MIN_SAMPLE_FOR_TREND.`
            : undefined,
          asOfDate: reportingDate,
        },
      ],
    };
  } catch (err) {
    const result = emptyResult(detailLevel, teamSize);
    result.sourceHealth = [
      {
        module: "quality",
        state: "ERROR",
        detail: `Quality query failed: ${errMessage(err)}`,
        asOfDate: reportingDate,
      },
    ];
    return result;
  }
}
