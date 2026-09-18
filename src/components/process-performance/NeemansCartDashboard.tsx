import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  IndianRupee, ShoppingCart, Users, TrendingUp, UserCog, CalendarDays, Layers, PhoneCall, Search, ListFilter, Rows3,
} from "lucide-react";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DateRangeToolbar, DashboardExportMenu,
  currentMonthRange, formatINR, formatShortDate, formatDDMMYYYY, type ExportSlide,
} from "./DashboardKit";

interface CartRecord {
  id: number;
  cartId: string;
  customerName: string;
  phoneNumber: string;
  emailId: string;
  lineItems: string;
  amount: number;
  agent: string;
  disposition: string;
  subDisposition: string;
  callDate: string | null;
  status: string;
}

interface DashboardData {
  headline: {
    totalCarts: number;
    totalCartValue: number;
    avgCartValue: number;
    uniqueCustomers: number;
    activeAgents: number;
  };
  from: string;
  to: string;
  dateWiseTrend: Array<{ date: string; cartCount: number; cartValue: number }>;
  dispositionBreakdown: Array<{ disposition: string; count: number; value: number; pct: number }>;
  statusBreakdown: Array<{ status: string; count: number; pct: number }>;
  agentPerformance: Array<{ agent: string; cartCount: number; cartValue: number; topDisposition: string }>;
  records: CartRecord[];
  recordsTotal: number;
  recordsTruncated: boolean;
}

type TabKey = "overview" | "agents" | "records";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Agent-wise" },
  { key: "records", label: "Records" },
];

/** Deterministic color coding for open-ended categorical values (disposition,
 * status, sub-disposition) -- since db_masmis.neemans_cart currently holds 0
 * rows there is no confirmed value domain to map to a "good/bad" meaning
 * (e.g. no way to know today whether a future "PTP" disposition is positive
 * or negative), so this assigns each distinct string a consistent color from
 * a fixed palette by hashing the string, rather than guessing at semantics.
 * The same string always gets the same color, so a viewer can visually group
 * repeated values across a wide table without reading every cell. */
const BADGE_TONES = [
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
  "bg-fuchsia-100 text-fuchsia-700",
];
const BADGE_HEX = ["#059669", "#0284c7", "#d97706", "#7c3aed", "#e11d48", "#0d9488", "#4f46e5", "#c026d3"];
function hashIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}
function Badge({ label }: { label: string }) {
  if (!label) return <span className="text-slate-300">—</span>;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_TONES[hashIndex(label, BADGE_TONES.length)]}`}>
      {label}
    </span>
  );
}

/**
 * Neemans' "Abandoned Cart" dashboard — every number here is a live
 * aggregate over db_masmis.neemans_cart (the table NEEMANS_CART_MASMIS
 * writes into), via GET /api/process-performance/neemans-cart-dashboard.
 * As of build time that table holds 0 rows (registered but never used by
 * any upload yet), so every section below renders its own real empty
 * state until a Cart export is uploaded through the Neemans Cart Data
 * uploader — nothing here is a placeholder or a fabricated number.
 *
 * disposition/status are grouped by whatever distinct values the real
 * uploaded data contains, not a hardcoded "Converted/Recovered" mapping —
 * with no live rows yet there is no confirmed value domain to map from.
 *
 * Built on the same shared visual/export kit (DashboardKit) as the
 * Bellavita/GNC sibling dashboards — DashboardHero, tone-based KpiCard/
 * SectionCard, DateRangeToolbar, DashboardExportMenu — instead of a
 * locally-duplicated KpiCard/Spinner, so this reads as one product with
 * the rest of Process Performance V2 rather than an older, plainer page.
 *
 * A "Records" tab lists the individual cart rows behind the aggregates
 * (capped server-side at 1,000, most recent first) -- the raw-data view a
 * proper MIS report needs alongside its summary tables, matching the same
 * table this app's uploader writes into field-for-field.
 */
export function NeemansCartDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [tab, setTab] = useState<TabKey>("overview");
  const [agentSearch, setAgentSearch] = useState("");
  const [recordSearch, setRecordSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(
        `/api/process-performance/neemans-cart-dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Neemans cart dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const filteredAgents = useMemo(() => {
    const rows = data?.agentPerformance ?? [];
    const q = agentSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agent.toLowerCase().includes(q));
  }, [data, agentSearch]);

  const filteredRecords = useMemo(() => {
    const rows = data?.records ?? [];
    const q = recordSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.cartId.toLowerCase().includes(q) ||
      r.customerName.toLowerCase().includes(q) ||
      r.phoneNumber.toLowerCase().includes(q) ||
      r.agent.toLowerCase().includes(q) ||
      r.disposition.toLowerCase().includes(q) ||
      r.status.toLowerCase().includes(q));
  }, [data, recordSearch]);

  /** Export slides for "Download Snap"/"Download Excel" — one per tab, each
   * mirroring exactly what that tab renders below (same fields, same
   * order), so the download is never a re-derived or reduced view of the
   * dashboard. */
  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const overview: ExportSlide = {
      title: "Overview",
      kpis: [
        { label: "Abandoned Carts", value: data.headline.totalCarts.toLocaleString("en-IN") },
        { label: "Total Cart Value", value: formatINR(data.headline.totalCartValue) },
        { label: "Avg. Cart Value", value: formatINR(data.headline.avgCartValue) },
        { label: "Unique Customers", value: data.headline.uniqueCustomers.toLocaleString("en-IN") },
        { label: "Active Agents", value: data.headline.activeAgents.toLocaleString("en-IN") },
      ],
      tables: [
        {
          title: "Date-wise Cart Count & Value",
          columns: ["Date", "Cart Count", "Cart Value"],
          rows: data.dateWiseTrend.map((r) => [formatShortDate(r.date), r.cartCount, formatINR(r.cartValue)]),
        },
        {
          title: "Disposition-wise Breakdown",
          columns: ["Disposition", "Count", "Value", "Share"],
          rows: data.dispositionBreakdown.map((d) => [d.disposition, d.count, formatINR(d.value), `${d.pct}%`]),
        },
        {
          title: "Status-wise Breakdown",
          columns: ["Status", "Count", "Share"],
          rows: data.statusBreakdown.map((s) => [s.status, s.count, `${s.pct}%`]),
        },
      ],
    };
    const agents: ExportSlide = {
      title: "Agent-wise",
      tables: [{
        title: "Agent-wise Cart Handling",
        columns: ["Agent", "Carts Handled", "Cart Value", "Top Disposition"],
        rows: data.agentPerformance.map((a) => [a.agent, a.cartCount, formatINR(a.cartValue), a.topDisposition]),
      }],
    };
    const records: ExportSlide = {
      title: "Records",
      tables: [{
        title: data.recordsTruncated
          ? `Cart Records (latest ${data.records.length} of ${data.recordsTotal.toLocaleString("en-IN")})`
          : "Cart Records",
        columns: ["Cart ID", "Call Date", "Customer", "Phone", "Amount", "Agent", "Disposition", "Sub Disposition", "Status"],
        rows: data.records.map((r) => [
          r.cartId, formatDDMMYYYY(r.callDate), r.customerName, r.phoneNumber, formatINR(r.amount),
          r.agent, r.disposition, r.subDisposition, r.status,
        ]),
      }],
    };
    return [overview, agents, records];
  }, [data]);

  if (loading && !data) return <Spinner />;

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>
    );
  }
  if (!data) return null;

  const { headline } = data;

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={ShoppingCart} eyebrow="Neemans · Process Performance" title="Abandoned Cart Performance"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-violet-600 via-purple-600 to-violet-700"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DashboardExportMenu
          reportTitle="Neemans — Abandoned Cart Performance"
          fileBaseName="Neemans_Abandoned_Cart"
          subtitle={`${from} to ${to}`}
          slides={exportSlides}
          activeSlideTitle={tab === "overview" ? "Overview" : tab === "agents" ? "Agent-wise" : "Records"}
        />
        <DateRangeToolbar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
          accentFocus="focus:border-violet-400"
        />
      </div>

      {tab === "overview" && (
      <>
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard icon={ShoppingCart} label="Abandoned Carts" value={headline.totalCarts.toLocaleString("en-IN")} tone="violet" />
        <KpiCard icon={IndianRupee} label="Total Cart Value" value={formatINR(headline.totalCartValue)} tone="emerald" />
        <KpiCard icon={TrendingUp} label="Avg. Cart Value" value={formatINR(headline.avgCartValue)} tone="sky" />
        <KpiCard icon={Users} label="Unique Customers" value={headline.uniqueCustomers.toLocaleString("en-IN")} tone="amber" />
        <KpiCard icon={UserCog} label="Active Agents" value={headline.activeAgents.toLocaleString("en-IN")} sub="worked a cart in range" tone="indigo" />
      </div>

      {/* Date-wise trend */}
      <SectionCard icon={CalendarDays} title="Date-wise Cart Count & Value" tone="violet">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data.dateWiseTrend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
            <Tooltip
              labelFormatter={(v: unknown) => formatShortDate(String(v))}
              formatter={(value: number, name: string) => (name === "Cart Value" ? formatINR(value) : value)}
              contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="left" type="monotone" dataKey="cartCount" name="Cart Count" stroke="#7c3aed" strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="cartValue" name="Cart Value" stroke="#059669" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        {data.dateWiseTrend.length === 0 && (
          <p className="py-6 text-center text-xs text-slate-400">No cart data for this period.</p>
        )}
      </SectionCard>

      {/* Disposition + Status breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Layers} title="Disposition-wise Breakdown" tone="teal">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Disposition</th>
                  <th className="py-2 pr-3 text-right font-semibold">Count</th>
                  <th className="py-2 pr-3 text-right font-semibold">Value</th>
                  <th className="py-2 pr-0 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.dispositionBreakdown.map((d) => (
                  <tr key={d.disposition} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-teal-50/40">
                    <td className="py-2.5 pr-3"><Badge label={d.disposition} /></td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{d.count.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(d.value)}</td>
                    <td className="py-2.5 pr-0 text-right font-semibold text-slate-800">{d.pct}%</td>
                  </tr>
                ))}
                {data.dispositionBreakdown.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">No data for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard icon={PhoneCall} title="Status-wise Breakdown" tone="amber">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.statusBreakdown} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="status" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Bar dataKey="count" name="Carts" radius={[6, 6, 0, 0]}>
                {data.statusBreakdown.map((s) => (
                  <Cell key={s.status} fill={BADGE_HEX[hashIndex(s.status, BADGE_HEX.length)]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {data.statusBreakdown.length === 0 && (
            <p className="py-6 text-center text-xs text-slate-400">No data for this period.</p>
          )}
        </SectionCard>
      </div>
      </>
      )}

      {tab === "agents" && (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search agent..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-violet-400 focus:outline-none"
            />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />{filteredAgents.length} of {data.agentPerformance.length} agents
          </span>
        </div>

        <SectionCard icon={Users} title="Agent-wise Cart Handling" tone="violet">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Agent</th>
                  <th className="py-2 pr-3 text-right font-semibold">Carts Handled</th>
                  <th className="py-2 pr-3 text-right font-semibold">Cart Value</th>
                  <th className="py-2 pr-0 font-semibold">Top Disposition</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((a) => (
                  <tr key={a.agent} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-violet-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{a.agent}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{a.cartCount.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(a.cartValue)}</td>
                    <td className="py-2.5 pr-0"><Badge label={a.topDisposition} /></td>
                  </tr>
                ))}
                {filteredAgents.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">No agents match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
      )}

      {tab === "records" && (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={recordSearch}
              onChange={(e) => setRecordSearch(e.target.value)}
              placeholder="Search cart ID, customer, phone, agent..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-violet-400 focus:outline-none"
            />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />{filteredRecords.length} of {data.records.length} shown
          </span>
        </div>

        <SectionCard
          icon={Rows3}
          title={data.recordsTruncated
            ? `Cart Records — latest ${data.records.length.toLocaleString("en-IN")} of ${data.recordsTotal.toLocaleString("en-IN")} in range`
            : "Cart Records"}
          tone="violet"
          footnote={data.recordsTruncated
            ? "This range has more carts than fit here — narrow the date range to see every row, or use Export → Download All for the full aggregates."
            : undefined}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Cart ID</th>
                  <th className="py-2 pr-3 font-semibold">Call Date</th>
                  <th className="py-2 pr-3 font-semibold">Customer</th>
                  <th className="py-2 pr-3 font-semibold">Phone</th>
                  <th className="py-2 pr-3 text-right font-semibold">Amount</th>
                  <th className="py-2 pr-3 font-semibold">Agent</th>
                  <th className="py-2 pr-3 font-semibold">Disposition</th>
                  <th className="py-2 pr-0 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-violet-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{r.cartId}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{formatDDMMYYYY(r.callDate)}</td>
                    <td className="py-2.5 pr-3 text-slate-600" title={r.lineItems || undefined}>{r.customerName || "—"}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{r.phoneNumber || "—"}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(r.amount)}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{r.agent}</td>
                    <td className="py-2.5 pr-3"><Badge label={r.disposition} /></td>
                    <td className="py-2.5 pr-0"><Badge label={r.status} /></td>
                  </tr>
                ))}
                {filteredRecords.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-slate-400">No cart records match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
      )}
    </div>
  );
}
