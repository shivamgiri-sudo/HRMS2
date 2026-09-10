import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Upload, TrendingUp, PhoneCall, Home, Building2, Target,
  CheckCircle, X, Download, Calendar, Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

// ── Shared helpers ───────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
    </div>
  );
}

function fmt(n: number | undefined | null, decimals = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function fmtCur(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

interface Filters { startDate?: string; endDate?: string; tlName?: string; agentName?: string }

function KpiCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className={`mb-2 inline-flex rounded-xl p-2 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function FilterBar({ filters, setFilters, tlOptions }: { filters: Filters; setFilters: (f: Filters) => void; tlOptions: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
      <Calendar className="h-4 w-4 text-slate-400" />
      <input type="date" value={filters.startDate ?? ""} onChange={e => setFilters({ ...filters, startDate: e.target.value || undefined })}
        className="rounded-lg border border-slate-200 px-2 py-1 text-sm" />
      <span className="text-slate-400 text-sm">to</span>
      <input type="date" value={filters.endDate ?? ""} onChange={e => setFilters({ ...filters, endDate: e.target.value || undefined })}
        className="rounded-lg border border-slate-200 px-2 py-1 text-sm" />
      <select value={filters.tlName ?? ""} onChange={e => setFilters({ ...filters, tlName: e.target.value || undefined })}
        className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700">
        <option value="">All TLs</option>
        {tlOptions.map(tl => <option key={tl} value={tl}>{tl}</option>)}
      </select>
      {(filters.startDate || filters.endDate || filters.tlName) && (
        <button onClick={() => setFilters({})} className="text-xs font-semibold text-blue-600 hover:underline">Clear filters</button>
      )}
    </div>
  );
}

// ── Drill-down drawer (CLAUDE.md Drill-Down Mandate) ─────────────────────────
function AgentDrawer({ agent, onClose }: { agent: Record<string, unknown> | null; onClose: () => void }) {
  if (!agent) return null;
  const rows = Object.entries(agent).filter(([k]) => k !== "agentKey");
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Agent Detail</p>
            <h2 className="text-lg font-bold text-slate-800">{String(agent.agent ?? agent.agentKey ?? "—")}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Full Record</p>
          <div className="grid grid-cols-2 gap-3">
            {rows.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">{k}</p>
                <p className="text-sm font-semibold text-slate-700">
                  {typeof v === "number"
                    ? (k.toLowerCase().includes("pct") ? fmtPct(v) : k.toLowerCase().includes("value") || k.toLowerCase().includes("sale") && !k.toLowerCase().includes("sales)") ? fmt(v) : fmt(v))
                    : String(v ?? "—")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentTable({ agents }: { agents: Record<string, unknown>[] }) {
  const [sortKey, setSortKey] = useState<string>("salesValue");
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [search, setSearch] = useState("");

  const cols = agents[0] ? Object.keys(agents[0]).filter(k => k !== "agentKey") : [];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const base = term ? agents.filter(a => String(a.agent ?? "").toLowerCase().includes(term)) : agents;
    return [...base].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return bv - av;
      return String(av ?? "").localeCompare(String(bv ?? ""));
    });
  }, [agents, sortKey, search]);

  const exportCsv = () => {
    const header = cols.join(",");
    const lines = filtered.map(a => cols.map(c => JSON.stringify(a[c] ?? "")).join(","));
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "agent-performance.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  if (agents.length === 0) return <p className="py-8 text-center text-sm text-slate-400">No agent data for the selected filters.</p>;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-700">Agent Performance ({filtered.length})</h3>
        <div className="flex items-center gap-2">
          <input placeholder="Search agent…" value={search} onChange={e => setSearch(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm" />
          <select value={sortKey} onChange={e => setSortKey(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
            {cols.map(c => <option key={c} value={c}>Sort: {c}</option>)}
          </select>
          <button onClick={exportCsv} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              {cols.map(c => <th key={c} className="py-2 pr-3">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.map((a, i) => (
              <tr key={i} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={() => setSelected(a)}>
                {cols.map(c => (
                  <td key={c} className="py-1.5 pr-3 text-slate-600">
                    {typeof a[c] === "number"
                      ? (c.toLowerCase().includes("pct") ? fmtPct(a[c] as number) : fmt(a[c] as number))
                      : String(a[c] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AgentDrawer agent={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function DailyTrendChart({ trend }: { trend: Array<{ date: string; salesValue?: number; calls?: number }> }) {
  if (!trend || trend.length === 0) return null;
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-slate-700">Daily Trend</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={trend}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="salesValue" stroke="#059669" strokeWidth={2} dot={false} name="Sales Value" />
          <Line type="monotone" dataKey="calls" stroke="#2563eb" strokeWidth={2} dot={false} name="Calls" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function UploadCard({ label, endpoint, onUploaded }: { label: string; endpoint: string; onUploaded: () => void }) {
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setBusy(true); setStatus(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await hrmsApi.postForm<{ success: boolean; data: { totalRows: number; validRows: number; recognizedColumns: string[]; additionalColumns: string[] } }>(endpoint, form);
      const d = res.data;
      setStatus({ ok: true, msg: `File processed successfully. ${d.recognizedColumns.length} recognized columns${d.additionalColumns.length ? ` and ${d.additionalColumns.length} additional column(s) ignored` : ""}. ${d.validRows} of ${d.totalRows} rows loaded.` });
      onUploaded();
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <p className="mb-2 text-sm font-bold text-slate-700">{label}</p>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-6 text-slate-400 hover:border-blue-300 hover:text-blue-500">
        <Upload className="h-6 w-6" />
        <span className="text-xs">{busy ? "Uploading…" : "Click to upload .xlsx / .csv"}</span>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={busy}
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      </label>
      {status && (
        <div className={`mt-2 rounded-lg p-2 text-xs ${status.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {status.ok && <CheckCircle className="mr-1 inline h-3.5 w-3.5" />}
          {status.msg}
        </div>
      )}
    </div>
  );
}

// ── Housing Owner ─────────────────────────────────────────────────────────────
function useFilterOptions(base: string) {
  const [tlOptions, setTlOptions] = useState<string[]>([]);
  const load = useCallback(() => {
    void hrmsApi.get<{ data: { tlNames: string[] } }>(`${base}/filter-options`).then(r => setTlOptions(r.data.tlNames ?? [])).catch(() => {});
  }, [base]);
  useEffect(() => { load(); }, [load]);
  return { tlOptions, reload: load };
}

function qs(filters: Filters): string {
  const p = new URLSearchParams();
  if (filters.startDate) p.set("startDate", filters.startDate);
  if (filters.endDate) p.set("endDate", filters.endDate);
  if (filters.tlName) p.set("tlName", filters.tlName);
  return p.toString() ? `?${p.toString()}` : "";
}

function HousingOwnerOverview({ filters, setFilters, tlOptions, refreshKey }: { filters: Filters; setFilters: (f: Filters) => void; tlOptions: string[]; refreshKey: number }) {
  const [overview, setOverview] = useState<any>(null);
  const [agents, setAgents] = useState<Record<string, unknown>[]>([]);
  const [trend, setTrend] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const query = qs(filters);
    Promise.all([
      hrmsApi.get<{ data: any }>(`/api/housing-dashboards/housing-owner/overview${query}`),
      hrmsApi.get<{ data: Record<string, unknown>[] }>(`/api/housing-dashboards/housing-owner/agent-performance${query}`),
      hrmsApi.get<{ data: any[] }>(`/api/housing-dashboards/housing-owner/daily-trend${query}`),
    ]).then(([o, a, t]) => { setOverview(o.data); setAgents(a.data); setTrend(t.data); }).finally(() => setLoading(false));
  }, [filters, refreshKey]);

  if (loading) return <Spinner />;
  if (!overview) return <p className="py-8 text-center text-sm text-slate-400">No Housing Owner data yet. Upload Sale Raw and CDR files to get started.</p>;

  return (
    <div className="space-y-5">
      <FilterBar filters={filters} setFilters={setFilters} tlOptions={tlOptions} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total Sales Value" value={fmtCur(overview.sales.totalSalesValue)} icon={Home} color="bg-emerald-50 text-emerald-600" />
        <KpiCard label="Average Sale Value" value={fmtCur(overview.sales.averageSaleValue)} icon={TrendingUp} color="bg-blue-50 text-blue-600" />
        <KpiCard label="Total Calls" value={fmt(overview.calling.totalCalls)} icon={PhoneCall} color="bg-indigo-50 text-indigo-600" />
        <KpiCard label="Connection Rate" value={fmtPct(overview.calling.connectionRatePct)} icon={Users} color="bg-amber-50 text-amber-600" />
      </div>
      {overview.conversion && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <KpiCard label="Sales Conversion %" value={fmtPct(overview.conversion.salesConversionPct)} icon={Target} color="bg-pink-50 text-pink-600" />
          <KpiCard label="Revenue / Connected Call" value={fmtCur(overview.conversion.revenuePerConnectedCall)} icon={Building2} color="bg-slate-50 text-slate-600" />
          <KpiCard label="Revenue / Handled Call" value={fmtCur(overview.conversion.revenuePerHandledCall)} icon={Building2} color="bg-slate-50 text-slate-600" />
        </div>
      )}
      <DailyTrendChart trend={trend} />
      <AgentTable agents={agents} />
    </div>
  );
}

function HousingPremiumOverview({ filters, setFilters, tlOptions, refreshKey }: { filters: Filters; setFilters: (f: Filters) => void; tlOptions: string[]; refreshKey: number }) {
  const [overview, setOverview] = useState<any>(null);
  const [agents, setAgents] = useState<Record<string, unknown>[]>([]);
  const [trend, setTrend] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const query = qs(filters);
    Promise.all([
      hrmsApi.get<{ data: any }>(`/api/housing-dashboards/housing-premium/overview${query}`),
      hrmsApi.get<{ data: Record<string, unknown>[] }>(`/api/housing-dashboards/housing-premium/agent-performance${query}`),
      hrmsApi.get<{ data: any[] }>(`/api/housing-dashboards/housing-premium/daily-trend${query}`),
    ]).then(([o, a, t]) => { setOverview(o.data); setAgents(a.data); setTrend(t.data); }).finally(() => setLoading(false));
  }, [filters, refreshKey]);

  if (loading) return <Spinner />;
  if (!overview) return <p className="py-8 text-center text-sm text-slate-400">No Housing Premium data yet. Upload Sale Raw and CDR files to get started.</p>;

  return (
    <div className="space-y-5">
      <FilterBar filters={filters} setFilters={setFilters} tlOptions={tlOptions} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total Sales Value" value={fmtCur(overview.sales.totalSalesValue)} icon={Home} color="bg-emerald-50 text-emerald-600" />
        <KpiCard label="Total Calls" value={fmt(overview.calling.totalCalls)} icon={PhoneCall} color="bg-indigo-50 text-indigo-600" />
        <KpiCard label="Answer Rate" value={fmtPct(overview.calling.answerRatePct)} icon={Users} color="bg-amber-50 text-amber-600" />
        <KpiCard label="Target Achievement" value={fmtPct(overview.target.achievementPct)} icon={Target} color="bg-pink-50 text-pink-600" />
      </div>
      {overview.conversion && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <KpiCard label="Call → Sale Conversion %" value={fmtPct(overview.conversion.conversionPct)} icon={TrendingUp} color="bg-blue-50 text-blue-600" />
          <KpiCard label="Revenue / Answered Call" value={fmtCur(overview.conversion.revenuePerAnsweredCall)} icon={Building2} color="bg-slate-50 text-slate-600" />
          <KpiCard label="Target Gap" value={fmtCur(overview.target.targetGap)} icon={Building2} color="bg-slate-50 text-slate-600" />
        </div>
      )}
      <DailyTrendChart trend={trend} />
      <AgentTable agents={agents} />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type HousingTab = "owner" | "premium" | "upload";

export default function NativeHousingDashboards() {
  const { hasAnyRole } = useWorkforceAccess();
  const canAccess = hasAnyRole("super_admin", "admin", "ceo", "coo", "process_manager", "operations_manager", "branch_head", "hr", "manager");
  const canUpload = hasAnyRole("super_admin", "admin", "process_manager", "operations_manager");

  const [tab, setTab] = useState<HousingTab>("owner");
  const [ownerFilters, setOwnerFilters] = useState<Filters>({});
  const [premiumFilters, setPremiumFilters] = useState<Filters>({});
  const [refreshKey, setRefreshKey] = useState(0);

  const { tlOptions: ownerTls } = useFilterOptions("/api/housing-dashboards/housing-owner");
  const { tlOptions: premiumTls } = useFilterOptions("/api/housing-dashboards/housing-premium");

  if (!canAccess) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <div className="rounded-2xl border border-red-100 bg-red-50 px-8 py-6 text-center">
            <p className="font-semibold text-red-700">Access Restricted</p>
            <p className="mt-1 text-sm text-red-500">You don't have permission to view Housing dashboards.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const TABS: { id: HousingTab; label: string }[] = [
    { id: "owner", label: "Housing Owner" },
    { id: "premium", label: "Housing Premium" },
    ...(canUpload ? [{ id: "upload" as const, label: "Upload Data" }] : []),
  ];

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800">
            <Home className="h-5 w-5 text-emerald-600" /> Housing Sales &amp; CDR Dashboards
          </h1>
          <p className="text-sm text-slate-500">Housing Owner and Housing Premium sales + calling performance</p>
        </div>

        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${tab === t.id ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "owner" && (
          <HousingOwnerOverview filters={ownerFilters} setFilters={setOwnerFilters} tlOptions={ownerTls} refreshKey={refreshKey} />
        )}
        {tab === "premium" && (
          <HousingPremiumOverview filters={premiumFilters} setFilters={setPremiumFilters} tlOptions={premiumTls} refreshKey={refreshKey} />
        )}
        {tab === "upload" && canUpload && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <UploadCard label="Housing Owner — Sale Raw" endpoint="/api/housing-dashboards/housing-owner/upload/sale-raw" onUploaded={() => setRefreshKey(k => k + 1)} />
            <UploadCard label="Housing Owner — CDR Data" endpoint="/api/housing-dashboards/housing-owner/upload/cdr-raw" onUploaded={() => setRefreshKey(k => k + 1)} />
            <UploadCard label="Housing Premium — Sale Raw" endpoint="/api/housing-dashboards/housing-premium/upload/sale-raw" onUploaded={() => setRefreshKey(k => k + 1)} />
            <UploadCard label="Housing Premium — CDR Raw" endpoint="/api/housing-dashboards/housing-premium/upload/cdr-raw" onUploaded={() => setRefreshKey(k => k + 1)} />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
