import { useState, useEffect, useCallback } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { ShoppingCart, Target } from "lucide-react";
import { SectionCard, DashboardHero, DateRangeToolbar, formatINR, currentMonthRange } from "./DashboardKit";
import { BellavitaCartSnapshot } from "./BellavitaCartSnapshot";
import { BellavitaCartAgents } from "./BellavitaCartAgents";
import { BellavitaCartDailyTarget } from "./BellavitaCartDailyTarget";

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

/** Only the target/achievement fields are used here now -- the backend still
 * returns the rest of the Overview headline (cart counts, connect%, etc.),
 * but nothing on this page renders them anymore since the Overview and
 * Agent-wise tabs were removed (Snapshot/Agent Performance cover the same
 * ground with their own live data). */
interface Headline { target: number | null; achievementPct: number | null }
interface DashboardData { headline: Headline; from: string; to: string; targetMonth: string; canSetTarget: boolean }

/** "September 2026" from a "2026-09" month key, for the target editor's label. */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The original "Overview" and "Agent-wise" tabs were removed (2026-09-22,
 * explicit request) -- Snapshot and Agent Performance are the sheet-style
 * views that already cover the same ground with their own live data, so the
 * older pair was redundant. The Overview tab's one piece that had no home
 * anywhere else -- the Abandon Cart Revenue target editor -- was NOT
 * removed with it: it now renders always, above both remaining tabs, so
 * setting/editing the target doesn't depend on which tab is open. */
type TabKey = "snapshot" | "agentperf";
const TABS: Array<{ key: TabKey; label: string }> = [
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
  const [tab, setTab] = useState<TabKey>("snapshot");
  const [targetMonth, setTargetMonth] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [targetBusy, setTargetBusy] = useState(false);
  const [targetMsg, setTargetMsg] = useState("");

  // Feeds only the always-visible target editor below, so it loads
  // regardless of which tab is open -- Snapshot/Agent Performance fetch
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

  // Keep the target editor's month field in step with the selected date
  // range's own month, so "Save" without touching the field sets the month
  // currently on screen.
  useEffect(() => { if (data) setTargetMonth(data.targetMonth); }, [data?.targetMonth]);

  async function saveTarget() {
    setTargetBusy(true);
    setTargetMsg("");
    try {
      await hrmsApi.put(`${CART_API}/monthly-target`, { month: targetMonth, target: Number(targetValue) });
      setTargetValue("");
      setTargetMsg(`Saved target for ${monthLabel(targetMonth)}.`);
      await load();
    } catch (err) {
      setTargetMsg(err instanceof Error ? err.message : "Could not save the target.");
    } finally {
      setTargetBusy(false);
    }
  }

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

      {/* Always visible regardless of tab, per explicit request -- this is the
       * one place to view/edit the Abandon Cart Revenue target. */}
      {loading && !data && <p className="text-xs text-slate-400">Loading target…</p>}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {data && (
        <>
          <SectionCard
            icon={Target} title={`Monthly target — ${monthLabel(data.targetMonth)}`} tone="amber"
            footnote="The target applies to Abandon Cart Revenue for the calendar month shown, same as the date range's own month. It's a business commitment, so it's entered by an admin rather than derived from data."
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
              <span>Current target: <b className="text-slate-800">{data.headline.target !== null ? formatINR(data.headline.target) : "not set"}</b></span>
              {data.headline.target !== null && <span>Achievement: <b className="text-slate-800">{data.headline.achievementPct}%</b></span>}
            </div>
            {data.canSetTarget ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="month" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)} aria-label="Target month"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm focus:border-amber-400 focus:outline-none"
                />
                <input
                  type="number" min={1} inputMode="numeric" value={targetValue} onChange={(e) => setTargetValue(e.target.value)}
                  placeholder={data.headline.target !== null ? `Now ${formatINR(data.headline.target)}` : "Target amount (₹)"}
                  aria-label="Abandon Cart Revenue target for the month"
                  className="w-48 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="button" onClick={() => void saveTarget()} disabled={targetBusy || !(Number(targetValue) > 0) || !targetMonth}
                  className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {targetBusy ? "Saving…" : "Save"}
                </button>
                {targetMsg && <span className="text-[11px] text-slate-500">{targetMsg}</span>}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-slate-400">Ask an admin to set the monthly target.</p>
            )}
          </SectionCard>

          <BellavitaCartDailyTarget from={from} to={to} />
        </>
      )}

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
