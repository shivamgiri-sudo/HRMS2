/**
 * Client Portal — Live Dashboard (real-time-ish call/campaign metrics).
 *
 * Closes a real gap: 12 named clients (Bla Bli Blu, Reginald, Finnable, Billing, GS1, GNC,
 * Bella-Vita, Clovia, Neemans, Viega, Exicom, DU Digital) each have a bespoke "Live Dashboard"
 * on the internal ProcessOperationsPage.tsx (backed by process-live-dashboard.routes.ts /
 * dialler_db + inbound_cdr_daily_actual), and every one of those 12 has a real, active portal
 * client_user login -- confirmed live 2026-09-19. None of those 12 ever had any client-facing
 * equivalent: "Live Dashboard" was 100% internal-only despite serving a client that has a
 * portal account specifically for their own process.
 *
 * Scope, decided per this session's established rules (same ones getWorkforce and
 * getMetricDrilldownForPortal already follow):
 *   - Aggregate call/campaign metrics (offered, connected, AHT, SL%, utilisation%,
 *     dispositions, sales revenue that is the CLIENT'S OWN order revenue) -- INCLUDED.
 *     This is the same class of data already flowing through Operations/Quality tabs,
 *     just from dialler_db/inbound_cdr_daily_actual instead of process_metric_actual.
 *   - Per-agent/per-analyst rows (getInboundAgents, getCartAnalysts, getAprAgents, GS1's
 *     byAnalyst/byCompany) -- EXCLUDED. Real employee names attached to individual
 *     performance numbers is exactly the PII boundary getMetricDrilldownForPortal already
 *     draws (raw rows/analyst breakdown stay internal-only).
 *   - Domestic Billing -- EXCLUDED ENTIRELY. billingAmount/fteRate/variance/approvedHC
 *     are MAS's own internal cost/billing figures against a client, the exact category
 *     getWorkforce's own comment already bars from anything client-facing ("internal cost
 *     and profitability data"). Not given a portal route at all, not even an aggregate one.
 *
 * detectLiveDashboard (this process module's own name-matcher, shared with the frontend's
 * detectDiallerProcess so scope never drifts between the two) resolves which of the 12
 * dashboards a given process maps to; unmapped processes get null, same "not every process
 * has one" behaviour the internal page already has.
 */
import { db } from "../../db/mysql.js";
import { detectLiveDashboard, type LiveDashboard } from "../process-live-dashboard/live-dashboard-keys.js";
import { getInboundSummary, getInboundMonthly, getInboundDaily } from "../process-live-dashboard/inbound.service.js";
import { getCartSummary, getCartMonthly, getCartDaily, getCartSales } from "../process-live-dashboard/reginald-cart.service.js";
import { getAprSummary, getAprDaily, type EmailProcess } from "../process-live-dashboard/apr.service.js";
import { getGs1Overview, getGs1Email, getGs1DataKart, getGs1Approval } from "../process-live-dashboard/gs1.service.js";
import {
  getCdrStagingSummary, getCdrStagingDaily, getCdrStagingMonthly, type CdrClientCode,
} from "../process-live-dashboard/cdr-staging.service.js";

const CDR_CODE_BY_DASHBOARD: Partial<Record<LiveDashboard, CdrClientCode>> = {
  gnc: "GNC", "bella-vita": "BELLAVITA", clovia: "CLOVIA", neemans: "NEEMANS",
  viega: "VIEGA", exicom: "EXICOM", "du-digital": "DU_BANGLADESH",
};

const EMAIL_PROCESS_BY_DASHBOARD: Partial<Record<LiveDashboard, EmailProcess>> = {
  "molecular-email": "molecular", "reginald-email": "reginald-email", finnable: "finnable",
};

export interface PortalLiveDashboard {
  dashboard: LiveDashboard;
  summary: unknown;
  daily: unknown[];
  monthly: unknown[] | null;
  /** Only set for Reginald's cart dashboard -- the client's own order revenue, not MAS's billing figures. */
  sales: unknown | null;
}

/**
 * Returns null when this process has no live dashboard at all (most processes don't --
 * this is a small, named list) OR when it maps to billing (deliberately excluded, see
 * this file's header comment) -- both cases render identically to the client as "no
 * live dashboard for this process", which is the honest answer either way.
 */
export async function getLiveDashboardForPortal(
  processId: string,
  range: { from?: string; to?: string },
): Promise<PortalLiveDashboard | null> {
  const [procRows] = await db.execute(
    "SELECT process_name, process_code FROM process_master WHERE id = ? LIMIT 1",
    [processId]
  ) as unknown as [Array<{ process_name: string; process_code: string | null }>, unknown];
  const proc = procRows[0];
  if (!proc) return null;

  const dashboard = detectLiveDashboard(proc.process_name, proc.process_code);
  if (!dashboard || dashboard === "billing" || dashboard === "dalmia") return null;

  if (dashboard === "inbound") {
    const [summary, daily, monthly] = await Promise.all([
      getInboundSummary(range), getInboundDaily(range), getInboundMonthly(range),
    ]);
    return { dashboard, summary, daily, monthly, sales: null };
  }

  if (dashboard === "reginald-cart") {
    const [summary, daily, monthly, sales] = await Promise.all([
      getCartSummary(range), getCartDaily(range), getCartMonthly(range), getCartSales(range),
    ]);
    return { dashboard, summary, daily, monthly, sales };
  }

  const emailProcess = EMAIL_PROCESS_BY_DASHBOARD[dashboard];
  if (emailProcess) {
    const [summary, daily] = await Promise.all([
      getAprSummary(emailProcess, range), getAprDaily(emailProcess, range),
    ]);
    return { dashboard, summary, daily, monthly: null, sales: null };
  }

  if (dashboard === "gs1") {
    // GS1's 4 sub-tabs (Overview/Email/Data Kart/Approval) each have their own
    // aggregate KPIs -- the client-safe subset is the aggregates from all four,
    // minus each one's byAnalyst/byCompany rows (per-employee/per-company PII).
    const [overview, email, dataKart, approval] = await Promise.all([
      getGs1Overview(range), getGs1Email(range), getGs1DataKart(range), getGs1Approval(range),
    ]);
    return {
      dashboard,
      summary: {
        overview,
        email: { tasks: email.tasks, gtin: email.gtin, images: email.images, sla15Pct: email.sla15Pct, daily: email.daily },
        dataKart: { tasks: dataKart.tasks, gtin: dataKart.gtin, withinTatPct: dataKart.withinTatPct, avgGtinPerTask: dataKart.avgGtinPerTask, daily: dataKart.daily },
        approval: { totalSku: approval.totalSku, auditCount: approval.auditCount, auditErrors: approval.auditErrors, errorRate: approval.errorRate, uniqueGcp: approval.uniqueGcp, daily: approval.daily },
      },
      daily: [],
      monthly: null,
      sales: null,
    };
  }

  const cdrCode = CDR_CODE_BY_DASHBOARD[dashboard];
  if (cdrCode) {
    const [summary, daily, monthly] = await Promise.all([
      getCdrStagingSummary(cdrCode, range), getCdrStagingDaily(cdrCode, range), getCdrStagingMonthly(cdrCode, range),
    ]);
    return { dashboard, summary, daily, monthly, sales: null };
  }

  return null;
}
