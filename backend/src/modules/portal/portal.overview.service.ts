import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { ProcessCard, HeadlineMetric, PortalRag } from "./portal.types.js";
import { getKpiScorecardsForProcessId } from "../process-performance/kpi-scorecard.service.js";
import { portalKpiEngine } from "./portal.kpi-engine.service.js";

const HEADLINE_METRICS = ["CSAT", "AHT", "FCR"];

function computeRag(achievementPct: number): "green" | "amber" | "red" {
  if (achievementPct >= 100) return "green";
  if (achievementPct >= 85) return "amber";
  return "red";
}

/** kpi-scorecard.service.ts's good/warn/crit vocabulary -> this file's green/amber/red. */
function mapScorecardRag(rag: "good" | "warn" | "crit" | null): "green" | "amber" | "red" | null {
  if (rag === "good") return "green";
  if (rag === "warn") return "amber";
  if (rag === "crit") return "red";
  return null;
}

/**
 * Only a REAL reading (red/amber/green) may move a card off "no_data" -- and once it has
 * a real reading, only a MORE urgent one may replace it, never a calmer one overwriting a
 * worse one already found.
 *
 * The card's rag starts at "no_data" (priority 2), which sits between amber (1) and green
 * (3) specifically so an unmeasured process never LOOKS calmer than an amber one that is at
 * least being watched. But comparing every incoming reading's priority against the card's
 * CURRENT priority breaks the very first transition: a green reading (3) is never "more
 * urgent" than no_data (2), so a process whose only real readings are green could never
 * clear "no_data" -- confirmed live for GS1, whose two real headline metrics are both green
 * (achievement >= 100%) yet the card stayed "no_data" until this fix. No process on the
 * platform could ever show a true "green" card because of this.
 *
 * Fix: "no_data" is not a real classification and must never be compared against as if it
 * were one. The first real reading always sets the card's rag outright; every reading after
 * that follows the real red/amber/green urgency ordering (RAG_PRIORITY_REAL) among themselves.
 */
const RAG_PRIORITY_REAL: Record<"red" | "amber" | "green", number> = { red: 0, amber: 1, green: 2 };
function escalate(card: ProcessCard, rag: "green" | "amber" | "red"): void {
  if (card.rag === "no_data") {
    card.rag = rag;
    return;
  }
  if (card.rag !== "red" && card.rag !== "amber" && card.rag !== "green") return;
  if (RAG_PRIORITY_REAL[rag] < RAG_PRIORITY_REAL[card.rag]) card.rag = rag;
}

function computeAchievement(actual: number, target: number, direction: string): number {
  if (target === 0) return 0;
  const raw = direction === "higher_is_better" ? (actual / target) * 100 : (target / actual) * 100;
  return Math.min(Math.round(raw * 100) / 100, 120);
}

export const portalOverviewService = {
  async getOverview(processIds: string[]): Promise<ProcessCard[]> {
    if (processIds.includes("p-demo-1")) {
      return [
        {
          process_id: "p-demo-1",
          process_name: "Customer Support L2",
          client_name: "Airtel India",
          rag: "amber",
          headline_metrics: [
            { metric_code: "CSAT", metric_name: "Customer Satisfaction", unit: "%", actual: 88.5, target: 90.0, achievement_pct: 98.33, rag: "green" },
            { metric_code: "AHT", metric_name: "Average Handle Time", unit: "s", actual: 320, target: 280, achievement_pct: 87.5, rag: "amber" },
            { metric_code: "FCR", metric_name: "First Contact Resolution", unit: "%", actual: 74.0, target: 80.0, achievement_pct: 92.5, rag: "green" }
          ],
          last_updated: new Date().toISOString()
        }
      ];
    }
    if (processIds.length === 0) return [];

    const placeholders = processIds.map(() => "?").join(",");

    // First: get all active processes (even without KPI data)
    const [processRows] = await db.execute<RowDataPacket[]>(
      `SELECT p.id AS process_id, p.process_name, cm.client_name
       FROM process_master p
       JOIN client_master cm ON cm.id = p.client_id
       WHERE p.id IN (${placeholders}) AND p.active_status = 1
       ORDER BY p.process_name`,
      processIds
    );

    const processMap = new Map<string, ProcessCard>();
    for (const row of processRows as RowDataPacket[]) {
      processMap.set(row.process_id, {
        process_id: row.process_id,
        process_name: row.process_name,
        client_name: row.client_name,
        // Default is "no_data", not "green": a process nothing has ever measured
        // is not the same claim as "on track", and every process on this
        // platform used to default to a false "green" until at least one real
        // reading (from either KPI pipeline below) said otherwise.
        rag: "no_data",
        headline_metrics: [],
        last_updated: null,
      });
    }

    // If no processes found, return empty
    if (processMap.size === 0) return [];

    // Second: try to enrich with KPI data (optional - may be empty)
    const currentPeriod = new Date().toISOString().slice(0, 7);
    try {
      const [scoreRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           p.id AS process_id,
           m.metric_code,
           m.metric_name,
           m.unit,
           m.direction,
           tm.target_value,
           ks.actual_value,
           ks.created_at AS last_updated
         FROM process_master p
         JOIN kpi_assignment ka ON ka.designation_id IS NULL AND ka.department_id IS NULL AND ka.employee_id IS NULL
         JOIN kpi_template_metric tm ON tm.template_id = ka.template_id
         JOIN kpi_metric_master m ON m.id = tm.metric_id
         LEFT JOIN kpi_score ks ON ks.metric_id = m.id AND ks.period = ?
         WHERE p.id IN (${placeholders}) AND p.active_status = 1
         ORDER BY p.id, m.metric_code`,
        [currentPeriod, ...processIds]
      );

      for (const row of scoreRows as RowDataPacket[]) {
        const card = processMap.get(row.process_id);
        if (!card) continue;
        if (row.last_updated && (!card.last_updated || row.last_updated > card.last_updated)) {
          card.last_updated = row.last_updated;
        }
        if (HEADLINE_METRICS.includes(row.metric_code) && row.actual_value != null) {
          // Only a real actual_value is a real reading. A null one used to be
          // scored as achievement 0 -> rag "red", which put every unconfigured
          // process's legacy headline metrics in "red" rather than leaving them
          // out -- indistinguishable from a process that IS measured and IS
          // failing badly.
          const ach = computeAchievement(row.actual_value, row.target_value, row.direction);
          const rag = computeRag(ach);
          card.headline_metrics.push({
            metric_code: row.metric_code,
            metric_name: row.metric_name,
            unit: row.unit,
            actual: row.actual_value,
            target: row.target_value,
            achievement_pct: ach,
            rag,
          });
          escalate(card, rag);
        }
      }
    } catch {
      // KPI data unavailable - processes still show without metrics
    }

    // Third: enrich from the real kpi_daily_actual pipeline (kpi-metric-registry.ts's
    // 4 registered processes) -- a second, newer source alongside the legacy
    // kpi_assignment/kpi_score one above, never a replacement for it, since other
    // processes may only ever have legacy data.
    //
    // Window MUST match portal.kpi.service.ts's periodToRange (current month + 6 months
    // back). This used to query only the current calendar month: a process whose latest
    // reading landed a few days into a prior month (confirmed live for GS1, whose most
    // recent kpi_daily_actual rows are dated in August while this ran in September) showed
    // "no_data" on the Executive Home overview while the same process's own Performance
    // tab, reading the wider window, showed real green metrics -- two pages of the same
    // portal disagreeing about whether a process has any data at all.
    const [cpYear, cpMonth] = currentPeriod.split("-").map(Number);
    const lastDayOfMonth = new Date(cpYear, cpMonth, 0).getDate();
    const sixMonthsBackDate = new Date(cpYear, cpMonth - 1 - 6, 1);
    const sixMonthWindow = {
      from: `${sixMonthsBackDate.getFullYear()}-${String(sixMonthsBackDate.getMonth() + 1).padStart(2, "0")}-01`,
      to: `${currentPeriod}-${String(lastDayOfMonth).padStart(2, "0")}`,
    };
    // Fetched in parallel rather than one process at a time -- each call does several DB
    // round trips (kpi_daily_actual, process_metric_actual, and for some registry entries a
    // dialer_db CDR lookup on a remote host), so a sequential loop scaled the whole
    // overview's latency linearly with process count. A client with 5 processes was paying
    // 5x the per-process round-trip cost serially; Promise.all collapses that to the cost
    // of the slowest single process instead.
    const processIdList = Array.from(processMap.keys());
    const scorecardResults = await Promise.all(
      processIdList.map((processId) => getKpiScorecardsForProcessId(processId, sixMonthWindow).catch(() => null))
    );
    for (let i = 0; i < processIdList.length; i++) {
      const rows = scorecardResults[i];
      if (!rows) continue;
      const card = processMap.get(processIdList[i])!;
      for (const r of rows) {
        if (r.availability !== "ok") continue; // no real reading -- must not move the card
        const rag = mapScorecardRag(r.rag);
        if (!rag) continue;
        card.headline_metrics.push({
          metric_code: r.metricKey,
          metric_name: r.label,
          unit: r.unit,
          actual: r.actual,
          target: r.target,
          achievement_pct: r.actual == null ? null
            : Math.min(Math.round((r.direction === "higher_is_better" ? r.actual / r.target : r.target / r.actual) * 10000) / 100, 120),
          rag,
        });
        escalate(card, rag);
      }
    }

    // Fourth: portal.kpi-engine.service.ts -- the same real, generalizable engine now
    // powering the Performance tab (portal.kpi.service.ts's tryKpiEngine) for every
    // process outside the 4-process registry above. Without this pass, a process like
    // Onfido would show real KPI scorecards on its own Performance tab (computed by this
    // exact engine) while its Overview card stayed stuck on "no_data" forever, because
    // this file's two enrichment passes above only ever look at the dead
    // kpi_assignment/kpi_template_metric path and the 4-process registry -- the same class
    // of "two pages of the same portal disagreeing" bug this file's own escalate()/window
    // comments already document and fixed once before. Uses computeHeadlineMetrics
    // (worst-RAG-first, built for exactly this) rather than the full metric set, since a
    // card only has room for a small headline, same as the registry pass above.
    //
    // Deliberately does NOT gate on whether the registry pass already found something for
    // this process: a process could have BOTH a registry entry that itself supplies no
    // headline metrics for the current window (registry entries with notTrackedNote, or a
    // gap in that specific pipeline) and real engine-computed data, and the card should
    // show whichever pass found something real, following the same non-destructive
    // escalate() merge every earlier pass in this function already uses.
    const engineResults = await Promise.all(
      processIdList.map((processId) => portalKpiEngine.computeHeadlineMetrics(processId, currentPeriod).catch(() => null)),
    );
    for (let i = 0; i < processIdList.length; i++) {
      const metrics = engineResults[i];
      if (!metrics) continue;
      const card = processMap.get(processIdList[i])!;
      for (const m of metrics) {
        if (m.rag === "no_data" || m.actual == null) continue; // no real reading -- must not move the card
        card.headline_metrics.push({
          metric_code: m.metric_code,
          metric_name: m.metric_name,
          unit: m.unit,
          actual: m.actual,
          target: m.target,
          achievement_pct: m.achievement_pct,
          rag: m.rag,
        });
        escalate(card, m.rag);
      }
    }

    const cards = Array.from(processMap.values());
    const order: Record<PortalRag, number> = { red: 0, amber: 1, no_data: 2, green: 3 };
    return cards.sort((a, b) => order[a.rag] - order[b.rag]);
  },
};
