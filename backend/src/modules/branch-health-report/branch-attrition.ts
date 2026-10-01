/**
 * Branch Health Report - attrition & retention-risk section.
 *
 * Reads the same scored population and calibrated backtest the AON & Attrition page uses, so the
 * email and the page can never disagree. Everything here is optional: if the analytics sources are
 * slow or down, the section is simply left out and the rest of the report still goes out.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getModel, getPopulation, loadSnapshotModel, probabilityFor } from "../analytics/attrition-hub.service.js";

export interface BranchAttritionPerson { code: string; name: string; process: string | null; aonDays: number; score: number; tier: string; reasons: string[]; absentStreak: number }
export interface BranchAttrition {
  headcount: number; critical: number; high: number; medium: number; low: number;
  expectedExits30: number | null;
  absentStreak: number; newJoinerRisk: number;
  exits30: number; exitsPrev30: number; exits90: number; earlyExitSharePct: number | null;
  monthlyExits: { month: string; exits: number }[];
  byProcess: { process: string; headcount: number; highRisk: number; absentStreak: number }[];
  topRisk: BranchAttritionPerson[];
  calibrationNote: string | null;
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null) as Promise<T | null>;

export async function fetchBranchAttrition(branchId: string, reportDate: string): Promise<BranchAttrition | null> {
  try {
    const pop = await withTimeout(getPopulation(), 90_000);
    if (!pop) return null;
    const model = (await withTimeout(getModel(), 8_000)) ?? (await loadSnapshotModel());
    const here = pop.people.filter((p) => p.branchId === branchId);
    const live = here.filter((p) => !p.inNotice);
    const tier = (t: string) => live.filter((p) => p.tier === t).length;
    const expected = model ? live.reduce((s, p) => s + (probabilityFor(model, p.tier) ?? model.baseRatePct / 100), 0) : null;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(date_of_exit, '%Y-%m') AS m, COUNT(*) AS n,
              SUM(date_of_exit > DATE_SUB(?, INTERVAL 30 DAY)) AS e30,
              SUM(date_of_exit > DATE_SUB(?, INTERVAL 60 DAY) AND date_of_exit <= DATE_SUB(?, INTERVAL 30 DAY)) AS ep30,
              SUM(date_of_exit > DATE_SUB(?, INTERVAL 90 DAY)) AS e90,
              SUM(date_of_exit > DATE_SUB(?, INTERVAL 90 DAY) AND DATEDIFF(date_of_exit, COALESCE(salary_start_date, date_of_joining)) <= 90) AS early90
         FROM employees
        WHERE branch_id = ? AND date_of_exit IS NOT NULL AND date_of_exit >= date_of_joining
          AND date_of_exit > DATE_SUB(?, INTERVAL 6 MONTH) AND date_of_exit <= ?
        GROUP BY m ORDER BY m`,
      [reportDate, reportDate, reportDate, reportDate, reportDate, branchId, reportDate, reportDate] as never[],
    );
    const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    const e90 = sum("e90");

    const procs = new Map<string, { process: string; headcount: number; highRisk: number; absentStreak: number }>();
    for (const p of live) {
      const k = p.process ?? "Unassigned";
      const g = procs.get(k) ?? procs.set(k, { process: k, headcount: 0, highRisk: 0, absentStreak: 0 }).get(k)!;
      g.headcount++; if (p.tier === "HIGH" || p.tier === "CRITICAL") g.highRisk++; if ((p.features.absentStreak ?? 0) >= 3) g.absentStreak++;
    }
    return {
      headcount: here.length, critical: tier("CRITICAL"), high: tier("HIGH"), medium: tier("MEDIUM"), low: tier("LOW"),
      expectedExits30: expected == null ? null : Math.round(expected * 10) / 10,
      absentStreak: live.filter((p) => (p.features.absentStreak ?? 0) >= 3).length,
      newJoinerRisk: live.filter((p) => p.aonDays <= 90 && (p.tier === "HIGH" || p.tier === "CRITICAL")).length,
      exits30: sum("e30"), exitsPrev30: sum("ep30"), exits90: e90,
      earlyExitSharePct: e90 ? Math.round((sum("early90") / e90) * 1000) / 10 : null,
      monthlyExits: rows.map((r) => ({ month: String(r.m), exits: Number(r.n) })),
      byProcess: [...procs.values()].filter((g) => g.headcount >= 5).sort((a, b) => b.highRisk - a.highRisk || b.absentStreak - a.absentStreak).slice(0, 8),
      topRisk: [...live].sort((a, b) => b.score - a.score).slice(0, 8).map((p) => ({
        code: p.code, name: p.name, process: p.process, aonDays: p.aonDays, score: Math.round(p.score), tier: p.tier,
        reasons: p.reasons.slice(0, 3).map((r) => r.label), absentStreak: p.features.absentStreak ?? 0,
      })),
      calibrationNote: model
        ? `30-day exit rate seen in past data: Critical ${model.calibration.find((c) => c.tier === "CRITICAL")?.observedRatePct ?? "n/a"}%, High ${model.calibration.find((c) => c.tier === "HIGH")?.observedRatePct ?? "n/a"}%.`
        : null,
    };
  } catch (err) {
    console.error("[branch-health] attrition section unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}
