import { useState, useEffect, useCallback } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { ShoppingCart, Inbox } from "lucide-react";
import { DashboardHero, DateRangeToolbar, currentMonthRange, localDateStr } from "./DashboardKit";
import { BellavitaCartOverview } from "./BellavitaCartOverview";
import { BellavitaCartSnapshot } from "./BellavitaCartSnapshot";
import { BellavitaCartAgents } from "./BellavitaCartAgents";

const CART_API = "/api/process-performance/bellavita-cart-dashboard";

/**
 * Bellavita's real Cart (abandoned-cart recovery) dashboard -- live
 * aggregates over db_masmis.bb_cart (69,868 rows, confirmed live
 * 2026-09-17), via GET /api/process-performance/bellavita-cart-dashboard.
 * Also embeds an Allocation section over db_masmis.bvo_repeat_allocation
 * (Bellavita's existing "Repeat Allocation" upload type) -- 0 rows live
 * right now, so it renders as an honest empty state rather than a chart
 * full of zeros; it's wired to real data and will fill in the moment
 * someone uploads through that type, no code change needed.
 *
 * See the backend service's own header comment for why "Connected %" uses
 * `disposition` and not the far messier `same_day_connect` column (which
 * mixes several unrelated tagging schemes across upload batches), and why
 * `status` is shown as a Discount Code breakdown rather than a
 * connectivity status.
 */

export interface CartHeadline {
  totalCarts: number; cartValue: number; aov: number;
  connectedCount: number; connectedPct: number;
  uniqueCustomers: number; activeAgents: number;
  workableCases: number; dndCases: number;
  uniqueCallCount: number; uniqueCallConnectedCount: number; uniqueCallConnectedPct: number;
  abandonCartRevenue: number; abandonCartSaleCount: number; abandonCartAov: number;
  target: number | null; achievementPct: number | null;
  ncConnectCount: number;
  sameDayUniqueAttempt: number; sameDayUniqueConnect: number; sameDayUniqueConnectPct: number;
  codOrderCount: number; paidOrderCount: number; rtoOrderCount: number;
}
export interface CartTrendRow {
  date: string; cartCount: number; cartValue: number;
  connectedCount: number; uniqueCustomers: number; activeAgents: number;
  workableCases: number; dndCases: number;
  uniqueCallCount: number; uniqueCallConnectedCount: number;
  abandonCartRevenue: number; abandonCartSaleCount: number;
}
export interface CartTopProduct {
  product: string; baseCount: number; cartValue: number;
  uniqueAttempted: number; uniqueConnected: number; connectedPct: number;
  saleCount: number | null; revenue: number | null; aov: number | null;
}
interface DashboardData {
  headline: CartHeadline; from: string; to: string; targetMonth: string; canSetTarget: boolean;
  dateWiseTrend: CartTrendRow[];
  dispositionBreakdown: Array<{ disposition: string; count: number; pct: number }>;
  discountBreakdown: Array<{ code: string; count: number }>;
  topProducts: CartTopProduct[];
  latestAvailableDate: string | null;
}

/** The original "Overview" and "Agent-wise" tabs were removed (2026-09-22)
 * because Snapshot and Agent Performance covered the same ground with their
 * own live data. Re-added (2026-09-23, explicit request) as a fresh KPI
 * dashboard -- not a revert of the removed code -- since Snapshot/Agent
 * Performance are sheet-style tables and this dashboard had no page at all
 * showing the headline KPIs the backend already computes (cart counts,
 * connect%, DND cases, Abandon Cart Revenue, ...) with a quick click-through
 * to their own date-wise/week-wise trend. The always-visible Monthly target
 * editor and the Date-wise Target view were both removed 2026-09-23 (explicit
 * request) -- Target/Achievement% still show as their own KPI card inside
 * the Overview tab (see BellavitaCartOverview.tsx), just not as a separate
 * always-visible editor above every tab. The backend's target read/write
 * endpoints are untouched; only this page's own editor UI was removed. */
type TabKey = "overview" | "snapshot" | "agentperf";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "snapshot", label: "Snapshot" },
  { key: "agentperf", label: "Agent Performance" },
];

export function BellavitaCartDashboard() {
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");

  // Feeds the Overview tab's KPI cards -- Snapshot/Agent Performance fetch
  // their own data independently.
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `/api/process-performance/bellavita-cart-dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Bellavita Cart dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={ShoppingCart} eyebrow="Bellavita · Process Performance" title="Bellavita Abandon Cart"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-fuchsia-600 via-rose-500 to-fuchsia-700"
      />

      <DateRangeToolbar
        from={from} to={to} onFrom={setFrom} onTo={setTo}
        onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
        resetLabel="This Month" accentFocus="focus:border-fuchsia-400"
      />

      {loading && !data && <p className="text-xs text-slate-400">Loading…</p>}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {data && data.headline.totalCarts === 0 && data.latestAvailableDate && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
          <span className="inline-flex items-center gap-2"><Inbox className="h-4 w-4" />
            No carts between {from} and {to} — the newest uploaded cart is from{" "}
            <strong>{data.latestAvailableDate}</strong>, so this window is real, just outside where the data currently ends.
          </span>
          <button
            type="button"
            onClick={() => {
              const end = new Date(data.latestAvailableDate!);
              const start = new Date(end);
              start.setDate(start.getDate() - 6);
              setFrom(localDateStr(start));
              setTo(localDateStr(end));
            }}
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-amber-700"
          >
            Show last 7 days of available data
          </button>
        </div>
      )}

      {tab === "overview" && data && <BellavitaCartOverview data={data} />}

      {tab === "snapshot" && (
        <BellavitaCartSnapshot
          apiPath={CART_API} from={from} to={to}
          onOpenPeriod={(f, t) => { setFrom(f); setTo(t); setTab("agentperf"); }}
        />
      )}
      {tab === "agentperf" && <BellavitaCartAgents apiPath={CART_API} from={from} to={to} />}
    </div>
  );
}
