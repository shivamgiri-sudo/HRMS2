import { db } from "../../db/mysql.js";

/**
 * Satya Retail's real dashboard -- live aggregates over
 * db_masmis.satya_allocation (beat/shop calling allocation -- one row per
 * shop assigned to an agent on a beat) and db_masmis.satya_cdr (call
 * detail/case log -- one row per call attempt against a case), via GET
 * /api/process-performance/satya-retail-dashboard.
 *
 * This is a field-sales beat-calling process, not a direct-sale process
 * like GNC/Housing -- there's no LOB/campaign, no TL column in either
 * table (confirmed via SHOW COLUMNS), and `order_value`/`same_day_connected`
 * are real columns that happen to be 0/NULL on every row uploaded so far.
 * Warehouse (the real organisational grouping present in the data) stands
 * in for a TL-wise view.
 *
 * Column caveats found while building this, kept as-is rather than
 * silently "fixed":
 * - satya_allocation.agent_name is NULL on every row; the real agent name
 *   lives in agent_name_2 instead (source-file quirk, not a bug here).
 * - satya_cdr.agent_name actually holds the agent's employee CODE (e.g.
 *   "MAS62145"), not a person's name -- there's no name column on that
 *   table at all, so this dashboard maps it through satya_allocation's
 *   agent_id -> agent_name_2 to show a real name where possible.
 * - satya_cdr.call_date mixes "M/D/YYYY H:mm" and "M/D/YY H:mm" in the same
 *   upload; report_date ("D-Mon-YY") is used for date logic instead since
 *   it's consistently formatted across both tables.
 *
 * Confirmed live 2026-09-17: satya_allocation has 9 rows, satya_cdr has 8
 * rows, all dated 1-Sep-26 -- genuinely thin, single-day data. No date
 * range filter for that reason (a picker over one real day would be
 * theatre); add one once more days are uploaded.
 */

export interface SatyaHeadline {
  totalAllocation: number;
  allocationConnected: number;
  allocationConnectedPct: number;
  uniqueShops: number;
  orderValue: number;
  totalCdrCalls: number;
  cdrConnected: number;
  cdrConnectedPct: number;
  activeAgents: number;
  avgAttempts: number;
}

export interface SatyaWarehouseRow {
  warehouse: string;
  allocation: number;
  connected: number;
  connectedPct: number;
  uniqueShops: number;
  orderValue: number;
}

export interface SatyaAgentRow {
  agentId: string;
  agentName: string;
  allocation: number;
  allocConnected: number;
  allocConnectedPct: number;
  cdrCalls: number;
  cdrConnected: number;
  cdrConnectedPct: number;
  orderValue: number;
  avgAttempts: number;
}

export interface SatyaDashboardData {
  headline: SatyaHeadline;
  byWarehouse: SatyaWarehouseRow[];
  agents: SatyaAgentRow[];
  dispositionBreakdown: { disposition: string; count: number }[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;
}
function normalizeName(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

export async function getSatyaRetailDashboard(): Promise<SatyaDashboardData> {
  const [allocRawRows] = await db.execute<any[]>(
    `SELECT id, report_date, uid, unique_flag, warehouse, beat_name, shop_phone, agent_id, agent_name_2, disposition, order_value
     FROM db_masmis.satya_allocation`,
  );
  // An earlier test upload left 9 exact copies (same date + uid + flag) of rows in the full
  // upload; keep the newest copy only, same rule as the Calling & Order Tracking report.
  const newestAllocId = new Map<string, number>();
  for (const r of allocRawRows as any[]) {
    const uid = String(r.uid ?? "").trim();
    if (!uid) continue;
    const k = `${r.report_date}|${uid}|${r.unique_flag ?? ""}`;
    if ((newestAllocId.get(k) ?? -1) < Number(r.id)) newestAllocId.set(k, Number(r.id));
  }
  const allocRows = (allocRawRows as any[]).filter((r) => {
    const uid = String(r.uid ?? "").trim();
    return !uid || newestAllocId.get(`${r.report_date}|${uid}|${r.unique_flag ?? ""}`) === Number(r.id);
  });
  const [cdrRows] = await db.execute<any[]>(
    `SELECT scenario, sub_scenario_1, agent_name, attempt
     FROM db_masmis.satya_cdr`,
  );

  const agentNameById = new Map<string, string>();
  for (const r of allocRows as any[]) {
    const id = normalizeName(r.agent_id);
    const name = normalizeName(r.agent_name_2);
    if (id && name) agentNameById.set(id, name);
  }

  const shopSet = new Set<string>();
  const allocByWarehouse = new Map<string, { allocation: number; connected: number; shops: Set<string>; orderValue: number }>();
  const allocByAgent = new Map<string, { allocation: number; connected: number; orderValue: number }>();
  let allocationConnected = 0;
  let orderValueTotal = 0;

  for (const r of allocRows as any[]) {
    const warehouse = normalizeName(r.warehouse) || "Unknown";
    const agentId = normalizeName(r.agent_id) || "Unknown";
    const connected = normalizeName(r.disposition).toLowerCase() === "connected";
    const shopPhone = normalizeName(r.shop_phone);
    // order_value is text with thousands separators ("1,292"); Number() of that is NaN -> 0.
    const orderValue = num(String(r.order_value ?? "").replace(/,/g, ""));
    if (shopPhone) shopSet.add(shopPhone);
    if (connected) allocationConnected += 1;
    orderValueTotal += orderValue;

    const wCur = allocByWarehouse.get(warehouse) ?? { allocation: 0, connected: 0, shops: new Set<string>(), orderValue: 0 };
    wCur.allocation += 1;
    if (connected) wCur.connected += 1;
    if (shopPhone) wCur.shops.add(shopPhone);
    wCur.orderValue += orderValue;
    allocByWarehouse.set(warehouse, wCur);

    const aCur = allocByAgent.get(agentId) ?? { allocation: 0, connected: 0, orderValue: 0 };
    aCur.allocation += 1;
    if (connected) aCur.connected += 1;
    aCur.orderValue += orderValue;
    allocByAgent.set(agentId, aCur);
  }

  const dispositionMap = new Map<string, number>();
  const cdrByAgent = new Map<string, { calls: number; connected: number; attemptSum: number; attemptCount: number }>();
  let cdrConnectedTotal = 0;

  for (const r of cdrRows as any[]) {
    const connected = normalizeName(r.scenario).toLowerCase() === "connected";
    if (connected) cdrConnectedTotal += 1;
    const disp = normalizeName(r.sub_scenario_1) || normalizeName(r.scenario) || "Unknown";
    dispositionMap.set(disp, (dispositionMap.get(disp) ?? 0) + 1);

    const agentId = normalizeName(r.agent_name) || "Unknown"; // satya_cdr's "agent_name" column actually holds the agent code
    const attempt = num(r.attempt);
    const cur = cdrByAgent.get(agentId) ?? { calls: 0, connected: 0, attemptSum: 0, attemptCount: 0 };
    cur.calls += 1;
    if (connected) cur.connected += 1;
    if (attempt > 0) { cur.attemptSum += attempt; cur.attemptCount += 1; }
    cdrByAgent.set(agentId, cur);
  }

  const agentIds = new Set<string>([...allocByAgent.keys(), ...cdrByAgent.keys()]);
  const agents: SatyaAgentRow[] = [...agentIds].map((agentId) => {
    const alloc = allocByAgent.get(agentId);
    const cdr = cdrByAgent.get(agentId);
    return {
      agentId,
      agentName: agentNameById.get(agentId) ?? agentId,
      allocation: alloc?.allocation ?? 0,
      allocConnected: alloc?.connected ?? 0,
      allocConnectedPct: pct(alloc?.connected ?? 0, alloc?.allocation ?? 0),
      cdrCalls: cdr?.calls ?? 0,
      cdrConnected: cdr?.connected ?? 0,
      cdrConnectedPct: pct(cdr?.connected ?? 0, cdr?.calls ?? 0),
      orderValue: alloc?.orderValue ?? 0,
      avgAttempts: cdr && cdr.attemptCount > 0 ? Math.round((cdr.attemptSum / cdr.attemptCount) * 100) / 100 : 0,
    };
  }).sort((a, b) => b.allocation - a.allocation);

  const byWarehouse: SatyaWarehouseRow[] = [...allocByWarehouse.entries()]
    .map(([warehouse, v]) => ({
      warehouse, allocation: v.allocation, connected: v.connected,
      connectedPct: pct(v.connected, v.allocation), uniqueShops: v.shops.size, orderValue: v.orderValue,
    }))
    .sort((a, b) => b.allocation - a.allocation);

  const dispositionBreakdown = [...dispositionMap.entries()]
    .map(([disposition, count]) => ({ disposition, count }))
    .sort((a, b) => b.count - a.count);

  const totalAllocation = allocRows.length;
  const totalCdrCalls = cdrRows.length;
  const allAttempts = (cdrRows as any[]).map((r) => num(r.attempt)).filter((a) => a > 0);

  const headline: SatyaHeadline = {
    totalAllocation,
    allocationConnected,
    allocationConnectedPct: pct(allocationConnected, totalAllocation),
    uniqueShops: shopSet.size,
    orderValue: orderValueTotal,
    totalCdrCalls,
    cdrConnected: cdrConnectedTotal,
    cdrConnectedPct: pct(cdrConnectedTotal, totalCdrCalls),
    // 'VDCL' is the pending-queue sentinel, not a person.
    activeAgents: [...agentIds].filter((id) => id !== "VDCL" && id !== "Unknown").length,
    avgAttempts: allAttempts.length > 0 ? Math.round((allAttempts.reduce((s, a) => s + a, 0) / allAttempts.length) * 100) / 100 : 0,
  };

  return { headline, byWarehouse, agents, dispositionBreakdown };
}
