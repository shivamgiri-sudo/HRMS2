import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { notDialDeskProcessSql, ownCompanyBranchSql } from "../../shared/ownCompanyCostCentre.js";

export type CoverageTier = "full" | "inbound_quality" | "outbound_sale" | "baseline" | "not_wired";

export interface BranchProcess {
  processId: string;
  processCode: string;
  processName: string;
  costCentres: string[];
  viaLink: boolean;
  mandatedSeats: number | null;
  headcount: number;
  tier: CoverageTier;
  latestMetricDate: string | null;
  /** Idle BSS_* process that only mirrors a cost centre for billing. */
  billingMirror: boolean;
  /** Selected branch ids from which this process is drillable (active MAS cost centre, primary or link, or headcount there). */
  branchIds: string[];
}
export interface ProcessGroups { active: BranchProcess[]; unmapped: BranchProcess[] }
export interface DrillRow { employeeCode: string; name: string; value: number | null; metric: string }

/** Coverage tier from the metric keys that carried a value in the last 45 days. */
export function coverageTier(metricKeys: string[]): CoverageTier {
  if (metricKeys.length === 0) return "not_wired";
  const has = (f: (k: string) => boolean) => metricKeys.some(f);
  const funnel = has((k) => k.startsWith("FUNNEL_"));
  const qa = has((k) => k.startsWith("QA_"));
  const risk = has((k) => k.startsWith("RISK_"));
  const inbound = has((k) => k.startsWith("INBOUND_") || k.startsWith("AHT") || k.startsWith("CHAT_"));
  void risk; // RISK_ is optional for "full"
  if (funnel && qa) return "full";
  if (inbound && qa) return "inbound_quality";
  if (funnel && !qa) return "outbound_sale";
  return "baseline";
}

const dateStr = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export async function listBranchProcesses(branchIds: string[]): Promise<ProcessGroups> {
  if (branchIds.length === 0) return { active: [], unmapped: [] };

  // Cost centres of the selected MAS branches, with the process each one bills (directly or via link).
  const [ccRows] = await db.query<RowDataPacket[]>(
    `SELECT cc.id AS cc_id, cc.branch_id AS branch_id, cc.cost_centre_code AS cc_code, cc.mandated_seats, x.process_id, x.via_link
       FROM cost_centre_master cc
       JOIN branch_master b ON b.id = cc.branch_id
       JOIN (
         SELECT c.id AS cc_id, c.process_id AS process_id, 0 AS via_link
           FROM cost_centre_master c WHERE c.process_id IS NOT NULL
         UNION ALL
         SELECT l.cost_centre_id, l.process_id, 1
           FROM cost_centre_process_link l WHERE l.active_status = 1
       ) x ON x.cc_id = cc.id
      WHERE cc.branch_id IN (?) AND cc.active_status = 1 AND b.active_status = 1 AND b.close_date IS NULL
        AND ${ownCompanyBranchSql("b")}`,
    [branchIds],
  );
  const linkedIds = [...new Set(ccRows.map((r) => String(r.process_id)))];

  const [procRows] = await db.query<RowDataPacket[]>(
    `SELECT p.id, p.process_code, p.process_name,
            (SELECT COUNT(*) FROM employees e
              WHERE e.process_id = p.id AND e.active_status = 1 AND e.branch_id IN (?)) AS headcount
       FROM process_master p
       LEFT JOIN branch_master b ON b.id = p.branch_id
       LEFT JOIN branch_master nb ON 1 = 0
      WHERE p.active_status = 1 AND (
        (b.id IS NOT NULL AND b.active_status = 1 AND b.close_date IS NULL AND ${notDialDeskProcessSql("p", "b")}
          AND (p.branch_id IN (?)
               OR EXISTS (SELECT 1 FROM employees e2 WHERE e2.process_id = p.id AND e2.active_status = 1 AND e2.branch_id IN (?))))
        OR (p.id IN (?) AND ${notDialDeskProcessSql("p", "nb")})
      )`,
    [branchIds, branchIds, branchIds, linkedIds.length ? linkedIds : [""]],
  );

  const ids = [...new Set(procRows.map((r) => String(r.id)))];
  const [metricRows] = ids.length
    ? await db.query<RowDataPacket[]>(
        `SELECT process_id, metric_key, MAX(score_date) AS latest
           FROM process_metric_actual
          WHERE process_id IN (?) AND actual_value IS NOT NULL AND score_date >= DATE_SUB(CURDATE(), INTERVAL 45 DAY)
          GROUP BY process_id, metric_key`,
        [ids],
      )
    : [[] as RowDataPacket[]];

  // Branches (among the selected ones) where each process has headcount: one query for all processes.
  const [hcRows] = ids.length
    ? await db.query<RowDataPacket[]>(
        `SELECT e.process_id, e.branch_id
           FROM employees e
          WHERE e.active_status = 1 AND e.branch_id IN (?) AND e.process_id IN (?)
          GROUP BY e.process_id, e.branch_id`,
        [branchIds, ids],
      )
    : [[] as RowDataPacket[]];
  const branchesBy = new Map<string, Set<string>>();
  const addBranch = (pid: string, bid: unknown) => {
    if (bid == null) return;
    (branchesBy.get(pid) ?? branchesBy.set(pid, new Set()).get(pid)!).add(String(bid));
  };
  for (const r of ccRows) addBranch(String(r.process_id), r.branch_id);
  for (const r of hcRows) addBranch(String(r.process_id), r.branch_id);

  const keysBy = new Map<string, string[]>();
  const latestBy = new Map<string, string>();
  for (const m of metricRows) {
    const id = String(m.process_id);
    (keysBy.get(id) ?? keysBy.set(id, []).get(id)!).push(String(m.metric_key));
    const d = dateStr(m.latest);
    if (!latestBy.has(id) || d > latestBy.get(id)!) latestBy.set(id, d);
  }

  // Per-process cost-centre data, de-duplicated by cost centre id.
  const ccBy = new Map<string, Map<string, { code: string; seats: string | null; link: boolean }>>();
  for (const r of ccRows) {
    const pid = String(r.process_id);
    const cid = String(r.cc_id);
    const m = ccBy.get(pid) ?? ccBy.set(pid, new Map()).get(pid)!;
    const prev = m.get(cid);
    const link = Number(r.via_link) === 1;
    m.set(cid, { code: String(r.cc_code ?? ""), seats: r.mandated_seats == null ? null : String(r.mandated_seats), link: prev ? prev.link && link : link });
  }

  const seen = new Map<string, RowDataPacket>();
  for (const r of procRows) if (!seen.has(String(r.id))) seen.set(String(r.id), r);

  const isBssIdle = (r: RowDataPacket) => String(r.process_code ?? "").toUpperCase().startsWith("BSS_") && Number(r.headcount) === 0;
  const hasPrimary = (pid: string) => [...(ccBy.get(pid)?.values() ?? [])].some((c) => !c.link);
  const active: BranchProcess[] = [];
  const unmapped: BranchProcess[] = [];
  for (const [pid, r] of seen) {
    const mirror = isBssIdle(r);
    const ccs = ccBy.get(pid);
    const headcount = Number(r.headcount) || 0;
    const codes = new Set<string>();
    let seats = 0;
    let anySeat = false;
    let linkOnly = !!ccs && ccs.size > 0;
    for (const [, c] of ccs ?? []) {
      if (c.code) codes.add(c.code);
      if (!c.link) linkOnly = false;
      if (c.seats != null && /^\s*\d+(\.\d+)?\s*$/.test(c.seats)) { seats += Number(c.seats); anySeat = true; }
    }
    const keys = keysBy.get(pid) ?? [];
    const bp: BranchProcess = {
      processId: pid,
      processCode: String(r.process_code ?? ""),
      processName: String(r.process_name ?? ""),
      costCentres: [...codes],
      viaLink: linkOnly,
      mandatedSeats: anySeat ? seats : null,
      headcount,
      tier: coverageTier(keys),
      latestMetricDate: latestBy.get(pid) ?? null,
      billingMirror: mirror && hasPrimary(pid),
      branchIds: branchIds.filter((b) => branchesBy.get(pid)?.has(String(b))),
    };
    const isActive = mirror ? hasPrimary(pid) : (ccs && ccs.size > 0) || headcount > 0;
    (isActive ? active : unmapped).push(bp);
  }
  const byCode = (a: BranchProcess, b: BranchProcess) => a.processCode.localeCompare(b.processCode);
  return { active: active.sort(byCode), unmapped: unmapped.sort(byCode) };
}

/** Per-agent latest value of one metric (last 45 days). The only place agent names are returned. */
export async function getProcessDrilldown(branchId: string, processId: string, metric: string): Promise<DrillRow[]> {
  const [own] = await db.query<RowDataPacket[]>(
    `SELECT p.id FROM process_master p
       LEFT JOIN branch_master b ON b.id = p.branch_id
       LEFT JOIN branch_master nb ON 1 = 0
      WHERE p.id = ? AND p.active_status = 1 AND (
        (EXISTS (SELECT 1 FROM cost_centre_master cc JOIN branch_master cb ON cb.id = cc.branch_id
                  WHERE cc.branch_id = ? AND cc.active_status = 1 AND cb.active_status = 1 AND cb.close_date IS NULL
                    AND ${ownCompanyBranchSql("cb")}
                    AND (cc.process_id = p.id OR EXISTS (SELECT 1 FROM cost_centre_process_link l
                          WHERE l.cost_centre_id = cc.id AND l.process_id = p.id AND l.active_status = 1)))
         AND ${notDialDeskProcessSql("p", "nb")})
        OR (b.id IS NOT NULL AND b.active_status = 1 AND b.close_date IS NULL AND ${notDialDeskProcessSql("p", "b")}
            AND EXISTS (SELECT 1 FROM employees e0 WHERE e0.process_id = p.id AND e0.active_status = 1 AND e0.branch_id = ?))
      ) LIMIT 1`,
    [processId, branchId, branchId],
  );
  if (own.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT e.employee_code, e.first_name, e.last_name, a.actual_value AS value
       FROM employees e
       LEFT JOIN process_metric_employee_actual a
         ON a.employee_id = e.id AND a.process_id = ? AND a.metric_key = ?
        AND a.score_date = (SELECT MAX(a2.score_date) FROM process_metric_employee_actual a2
                             WHERE a2.employee_id = e.id AND a2.process_id = a.process_id AND a2.metric_key = a.metric_key
                               AND a2.actual_value IS NOT NULL AND a2.score_date >= DATE_SUB(CURDATE(), INTERVAL 45 DAY))
      WHERE e.process_id = ? AND e.active_status = 1 AND e.branch_id = ?
      ORDER BY (a.actual_value IS NULL), e.employee_code`,
    [processId, metric, processId, branchId],
  );
  return rows.map((r) => ({
    employeeCode: String(r.employee_code ?? ""),
    name: [r.first_name, r.last_name].filter(Boolean).join(" "),
    value: r.value == null ? null : Number(r.value),
    metric,
  }));
}
