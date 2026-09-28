import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  LayoutDashboard, Plus, Trash2, Loader2, ArrowLeft, BarChart3, LineChart as LineIcon,
  PieChart as PieIcon, Hash, Table as TableIcon, Lock,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

/**
 * Dashboard Builder — a dashboard somebody assembles, not one a developer ships.
 *
 * It composes metrics that already exist (KPI Studio's, and the process
 * registry's). It deliberately does not define sources or formulas: that is
 * Studio's job, and a second place to define the same number is how two
 * disagreeing versions of it appear.
 *
 * Every widget's numbers are resolved server-side against the READER's scope,
 * so a shared dashboard cannot show somebody a client they are not entitled to.
 * A widget in that state renders as "outside your access" rather than empty,
 * because a blank tile reads as broken and invites someone to go looking.
 */

interface Dashboard {
  id: string; name: string; description: string | null;
  processId: string | null; ownerUserId: string | null;
  visibleRoles: string[]; widgetCount?: number;
}
interface RenderedWidget {
  id: string; title: string | null; widgetType: "kpi_tile" | "line" | "bar" | "pie" | "table";
  metricSource: "kpi_daily_actual" | "process_metric_actual";
  metricKey: string; processId: string | null; dateRange: string;
  gridWidth: number; gridHeight: number; position: number;
  availability: "ok" | "no_data" | "out_of_scope";
  value: number | null;
  series: Array<{ period: string; value: number | null }>;
  note?: string;
}

const CHART_TYPES = [
  { value: "kpi_tile", label: "Number", icon: Hash, hint: "One headline figure" },
  { value: "line", label: "Line", icon: LineIcon, hint: "How it moved over time" },
  { value: "bar", label: "Bar", icon: BarChart3, hint: "Compare periods" },
  { value: "pie", label: "Pie", icon: PieIcon, hint: "Share across periods" },
  { value: "table", label: "Table", icon: TableIcon, hint: "The raw periods" },
] as const;

const DATE_RANGES = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  // Longer windows exist because a metric whose data ended months ago was
  // invisible otherwise: the widget said "nothing supplied for this window",
  // which reads as missing data rather than as a window that does not reach it.
  { value: "last_90_days", label: "Last 90 days" },
  { value: "last_365_days", label: "Last 12 months" },
] as const;

const WIDTHS = [
  { value: 3, label: "Quarter" },
  { value: 4, label: "Third" },
  { value: 6, label: "Half" },
  { value: 12, label: "Full width" },
] as const;

const SHARE_ROLES = [
  "manager", "process_manager", "operations_manager", "branch_head",
  "qa", "quality_analyst", "tq_head", "ceo", "coo", "hr", "team_leader",
] as const;

// One hue, varied by lightness — a pie of consecutive months is one series, and
// giving each slice its own colour would imply they are different things.
const PIE_TONES = ["#1e3a5f", "#2b4c7e", "#3c65a0", "#5b83bd", "#8aa9d6", "#b9cbe6"];

const inputCls = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400";
const labelCls = "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";

function formatValue(v: number | null): string {
  if (v === null) return "—";
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-IN") : String(Math.round(v * 100) / 100);
}

function WidgetBody({ widget }: { widget: RenderedWidget }) {
  if (widget.availability === "out_of_scope") {
    return (
      <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1 text-slate-400">
        <Lock className="h-4 w-4" />
        <p className="text-xs">Outside your access</p>
      </div>
    );
  }
  if (widget.availability === "no_data") {
    return (
      <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1 px-3 text-center">
        <p className="text-sm font-medium text-slate-400">No data</p>
        {widget.note && <p className="text-[11px] leading-relaxed text-slate-400">{widget.note}</p>}
      </div>
    );
  }

  const data = widget.series.filter((p) => p.value != null);

  if (widget.widgetType === "kpi_tile" || data.length === 0) {
    return (
      <div className="flex h-full min-h-24 flex-col justify-center">
        <p className="text-3xl font-bold tabular-nums text-slate-900">{formatValue(widget.value)}</p>
        <p className="mt-1 text-[11px] text-slate-500">
          {data.length ? `${data.length} period${data.length > 1 ? "s" : ""}` : "single reading"}
        </p>
      </div>
    );
  }

  if (widget.widgetType === "table") {
    return (
      <div className="max-h-48 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="py-1 text-left">Period</th><th className="text-right">Value</th></tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.period} className="border-t border-slate-100">
                <td className="py-1">{p.period}</td>
                <td className="text-right tabular-nums">{formatValue(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (widget.widgetType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="period" innerRadius={38} outerRadius={62} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={PIE_TONES[i % PIE_TONES.length]} />)}
          </Pie>
          <Tooltip formatter={(v: number) => formatValue(v)} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const Chart = widget.widgetType === "bar" ? BarChart : LineChart;
  return (
    <ResponsiveContainer width="100%" height={160}>
      <Chart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(v: number) => formatValue(v)} />
        {widget.widgetType === "bar"
          ? <Bar dataKey="value" fill="#2b4c7e" radius={[4, 4, 0, 0]} />
          : <Line type="monotone" dataKey="value" stroke="#2b4c7e" strokeWidth={2} dot={{ r: 3 }} />}
      </Chart>
    </ResponsiveContainer>
  );
}

export default function DashboardBuilderPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [addingWidget, setAddingWidget] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["dashboard-builder", "list"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<Dashboard[]>>("/api/dashboard-builder"),
  });

  const rendered = useQuery({
    queryKey: ["dashboard-builder", "render", openId],
    enabled: !!openId,
    queryFn: () => hrmsApi.get<HrmsEnvelope<{ dashboard: Dashboard; widgets: RenderedWidget[] }>>(
      `/api/dashboard-builder/${openId}/render`),
  });

  const processes = useQuery({
    queryKey: ["process-kpi-dashboard", "processes"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<Array<{ processCode: string; billingName: string }>>>(
      "/api/process-kpi-dashboard/processes"),
  });

  const [draft, setDraft] = useState({ name: "", description: "", process_id: "", visible_roles: [] as string[] });
  const createDashboard = useMutation({
    mutationFn: () => hrmsApi.post<HrmsEnvelope<{ id: string }>>("/api/dashboard-builder", draft),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["dashboard-builder", "list"] });
      setCreating(false);
      setDraft({ name: "", description: "", process_id: "", visible_roles: [] });
      setOpenId(res.data.id);
    },
    onError: (e) => setError((e as Error).message),
  });

  const [widgetDraft, setWidgetDraft] = useState({
    title: "", widget_type: "kpi_tile", metric_source: "process_metric_actual",
    metric_key: "", date_range: "this_month", grid_width: 6,
  });
  const addWidget = useMutation({
    mutationFn: () => hrmsApi.post(`/api/dashboard-builder/${openId}/widgets`, {
      ...widgetDraft,
      position: (rendered.data?.data.widgets.length ?? 0) + 1,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-builder", "render", openId] });
      setAddingWidget(false);
      setWidgetDraft({ ...widgetDraft, title: "", metric_key: "" });
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
  });

  const removeWidget = useMutation({
    mutationFn: (widgetId: string) =>
      hrmsApi.delete(`/api/dashboard-builder/${openId}/widgets/${widgetId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-builder", "render", openId] }),
  });

  // ── One dashboard, open ────────────────────────────────────────────────────
  if (openId) {
    const board = rendered.data?.data;
    return (
      <DashboardLayout>
        <div className="space-y-6 p-6">
          <button onClick={() => setOpenId(null)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> All dashboards
          </button>

          <header className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{board?.dashboard.name ?? "…"}</h1>
              {board?.dashboard.description && (
                <p className="mt-1 text-sm text-slate-600">{board.dashboard.description}</p>
              )}
            </div>
            <button
              onClick={() => setAddingWidget((v) => !v)}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              <Plus className="mr-1.5 inline h-4 w-4" />
              Add a chart
            </button>
          </header>

          {addingWidget && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">New chart</h2>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-52">
                  <label className={labelCls}>Title</label>
                  <input className={inputCls} value={widgetDraft.title}
                         onChange={(e) => setWidgetDraft((d) => ({ ...d, title: e.target.value }))}
                         placeholder="Email TAT" />
                </div>
                <div className="w-44">
                  <label className={labelCls}>Chart</label>
                  <select className={inputCls} value={widgetDraft.widget_type}
                          onChange={(e) => setWidgetDraft((d) => ({ ...d, widget_type: e.target.value }))}>
                    {CHART_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label} — {c.hint}</option>)}
                  </select>
                </div>
                <div className="w-52">
                  <label className={labelCls}>Where the number lives</label>
                  <select className={inputCls} value={widgetDraft.metric_source}
                          onChange={(e) => setWidgetDraft((d) => ({ ...d, metric_source: e.target.value }))}>
                    <option value="process_metric_actual">Process metrics</option>
                    <option value="kpi_daily_actual">Per-employee KPIs</option>
                  </select>
                </div>
                <div className="w-56">
                  <label className={labelCls}>Metric key</label>
                  <input className={`${inputCls} font-mono text-xs`} value={widgetDraft.metric_key}
                         onChange={(e) => setWidgetDraft((d) => ({ ...d, metric_key: e.target.value }))}
                         placeholder="gs1_email_tat_sec" />
                </div>
                <div className="w-40">
                  <label className={labelCls}>Period</label>
                  <select className={inputCls} value={widgetDraft.date_range}
                          onChange={(e) => setWidgetDraft((d) => ({ ...d, date_range: e.target.value }))}>
                    {DATE_RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div className="w-36">
                  <label className={labelCls}>Width</label>
                  <select className={inputCls} value={widgetDraft.grid_width}
                          onChange={(e) => setWidgetDraft((d) => ({ ...d, grid_width: Number(e.target.value) }))}>
                    {WIDTHS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                  </select>
                </div>
                <button
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={!widgetDraft.metric_key.trim() || addWidget.isPending}
                  onClick={() => addWidget.mutate()}
                >
                  {addWidget.isPending ? "Adding…" : "Add"}
                </button>
              </div>
              {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
            </section>
          )}

          {rendered.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !board?.widgets.length ? (
            <p className="text-sm text-slate-500">
              No charts yet. Add one above — pick a metric that already exists and choose how to draw it.
            </p>
          ) : (
            <div className="grid grid-cols-12 gap-4">
              {board.widgets.map((w) => (
                <div
                  key={w.id}
                  className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  style={{ gridColumn: `span ${Math.min(Math.max(w.gridWidth, 1), 12)} / span ${Math.min(Math.max(w.gridWidth, 1), 12)}` }}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">{w.title || w.metricKey}</h3>
                      <p className="text-[11px] text-slate-400">
                        {DATE_RANGES.find((r) => r.value === w.dateRange)?.label ?? w.dateRange}
                      </p>
                    </div>
                    <button
                      onClick={() => removeWidget.mutate(w.id)}
                      className="text-slate-300 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100"
                      aria-label="Remove chart"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <WidgetBody widget={w} />
                </div>
              ))}
            </div>
          )}
        </div>
      </DashboardLayout>
    );
  }

  // ── The list ───────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <LayoutDashboard className="mt-1 h-6 w-6 text-slate-500" />
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Dashboard Builder</h1>
              <p className="text-sm text-slate-600">
                Build a dashboard from metrics that already exist. Everyone sees only the processes
                they are entitled to, whatever the dashboard was built from.
              </p>
            </div>
          </div>
          <button onClick={() => setCreating((v) => !v)}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            <Plus className="mr-1.5 inline h-4 w-4" /> New dashboard
          </button>
        </header>

        {creating && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <label className={labelCls}>Name</label>
                <input className={inputCls} value={draft.name}
                       onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                       placeholder="GS1 daily ops" />
              </div>
              <div className="min-w-56 flex-1">
                <label className={labelCls}>Description</label>
                <input className={inputCls} value={draft.description}
                       onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
              </div>
              <div className="w-52">
                <label className={labelCls}>Default process</label>
                <select className={inputCls} value={draft.process_id}
                        onChange={(e) => setDraft((d) => ({ ...d, process_id: e.target.value }))}>
                  <option value="">None — set per chart</option>
                  {(processes.data?.data ?? []).map((p) => (
                    <option key={p.processCode} value={p.processCode}>{p.billingName}</option>
                  ))}
                </select>
              </div>
              <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      disabled={!draft.name.trim() || createDashboard.isPending}
                      onClick={() => createDashboard.mutate()}>
                {createDashboard.isPending ? "Creating…" : "Create"}
              </button>
            </div>
            <div className="mt-3">
              <label className={labelCls}>Share with</label>
              <div className="flex flex-wrap gap-1.5">
                {SHARE_ROLES.map((role) => {
                  const on = draft.visible_roles.includes(role);
                  return (
                    <button
                      key={role}
                      onClick={() => setDraft((d) => ({
                        ...d,
                        visible_roles: on ? d.visible_roles.filter((r) => r !== role) : [...d.visible_roles, role],
                      }))}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-600 hover:border-slate-400"
                      }`}
                    >
                      {role.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Shared with nobody stays private to you. Sharing shows the layout — each person still
                sees only their own processes.
              </p>
            </div>
            {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
          </section>
        )}

        {list.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !list.data?.data.length ? (
          <p className="text-sm text-slate-500">No dashboards yet. Create one to get started.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.data.map((d) => (
              <button key={d.id} onClick={() => setOpenId(d.id)}
                      className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-slate-400">
                <h3 className="text-sm font-semibold text-slate-900">{d.name}</h3>
                {d.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{d.description}</p>}
                <p className="mt-2 text-[11px] text-slate-400">
                  {d.widgetCount ?? 0} chart{(d.widgetCount ?? 0) === 1 ? "" : "s"}
                  {d.visibleRoles.length ? ` · shared with ${d.visibleRoles.length} role${d.visibleRoles.length > 1 ? "s" : ""}` : " · private"}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
