import { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Upload, TrendingUp, Package, ShoppingCart, MessageSquare,
  AlertTriangle, Download, CheckCircle, Trash2, RefreshCcw,
  Calendar, DollarSign, PercentSquare,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

// ── Types ─────────────────────────────────────────────────────────────────────
type Brand = "Bellavita" | "GNC";

interface BbDashboard {
  overall: {
    total_orders: number; rto_pct: number; cod_pct: number; paid_pct: number;
    aov: number; net_revenue_ex_gst: number;
  };
  by_campaign: Array<{
    campaign: string; orders: number; rto_pct: number; cod_pct: number;
    paid_pct: number; aov: number; net_revenue: number;
  }>;
}

interface GncDashboard {
  summary: { total_sales: number; total_revenue: number; avg_order: number; conversion_pct: number };
  by_product: Array<{ product: string; units: number; revenue: number }>;
  apr_summary: { total: number; valid_pct: number; invalid_pct: number };
}

interface UploadLog {
  id: number;
  batch_id: string;
  upload_type: string;
  month_label: string;
  row_count: number;
  uploaded_by: string;
  created_at: string;
}

type UploadType =
  | "bellavita-sales" | "gnc-sales" | "gnc-apr" | "gnc-allocation"
  | "bellavita-apr" | "bellavita-chat" | "bellavita-cart";

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
    </div>
  );
}

function fmt(n: number | undefined | null, decimals = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function fmtCur(n: number | undefined | null): string {
  if (n == null) return "—";
  return `₹${(n / 1000).toFixed(1)}K`;
}

// ── Bellavita Dashboard ───────────────────────────────────────────────────────
function BellavitaDashboard({ month }: { month: string }) {
  const [data, setData] = useState<BbDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void hrmsApi.get<{ data: BbDashboard }>(`/api/sales-upload/bellavita-dashboard?month=${month}`)
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [month]);

  if (loading) return <Spinner />;
  if (!data) return <p className="py-8 text-center text-sm text-slate-400">No Bellavita data for {month}.</p>;

  const { overall, by_campaign } = data;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Total Orders", value: fmt(overall.total_orders), icon: ShoppingCart, color: "bg-pink-50 text-pink-600" },
          { label: "RTO Rate", value: `${fmt(overall.rto_pct, 1)}%`, icon: AlertTriangle, color: "bg-red-50 text-red-600" },
          { label: "COD Share", value: `${fmt(overall.cod_pct, 1)}%`, icon: Package, color: "bg-amber-50 text-amber-600" },
          { label: "Net Revenue (ex-GST)", value: fmtCur(overall.net_revenue_ex_gst), icon: DollarSign, color: "bg-emerald-50 text-emerald-600" },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className={`mb-2 inline-flex rounded-xl p-2 ${s.color}`}>
              <s.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-bold text-slate-800">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {[
          { label: "AOV", value: fmtCur(overall.aov) },
          { label: "Paid %", value: `${fmt(overall.paid_pct, 1)}%` },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="text-2xl font-bold text-slate-800">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* By campaign */}
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-slate-700">Campaign Breakdown</p>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={by_campaign.slice(0, 10)} margin={{ top: 4, right: 8, left: -16, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="campaign" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="orders" name="Orders" fill="#EC4899" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="max-h-56 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-100">
                  <th className="text-left py-1.5">Campaign</th>
                  <th className="text-right py-1.5">Orders</th>
                  <th className="text-right py-1.5">RTO%</th>
                  <th className="text-right py-1.5">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {by_campaign.map((row, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-1.5 font-medium text-slate-700 truncate max-w-[120px]">{row.campaign}</td>
                    <td className="text-right py-1.5">{fmt(row.orders)}</td>
                    <td className={`text-right py-1.5 font-semibold ${row.rto_pct > 30 ? "text-red-500" : "text-slate-700"}`}>{fmt(row.rto_pct, 1)}%</td>
                    <td className="text-right py-1.5">{fmtCur(row.net_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── GNC Dashboard ─────────────────────────────────────────────────────────────
function GncDashboard({ month }: { month: string }) {
  const [data, setData] = useState<GncDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void hrmsApi.get<{ data: GncDashboard }>(`/api/sales-upload/gnc-dashboard?month=${month}`)
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [month]);

  if (loading) return <Spinner />;
  if (!data) return <p className="py-8 text-center text-sm text-slate-400">No GNC data for {month}.</p>;

  const { summary, by_product, apr_summary } = data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Total Sales", value: fmt(summary.total_sales), icon: TrendingUp },
          { label: "Total Revenue", value: fmtCur(summary.total_revenue), icon: DollarSign },
          { label: "Avg Order Value", value: fmtCur(summary.avg_order), icon: ShoppingCart },
          { label: "Conversion %", value: `${fmt(summary.conversion_pct, 1)}%`, icon: PercentSquare },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <s.icon className="mb-2 h-5 w-5 text-slate-400" />
            <p className="text-2xl font-bold text-slate-800">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Product Mix</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={by_product.slice(0, 10)} layout="vertical" margin={{ top: 4, right: 8, left: 60, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis dataKey="product" type="category" tick={{ fontSize: 9 }} width={60} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="units" name="Units" fill="#10B981" radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">APR Summary</p>
          <div className="space-y-3 mt-4">
            {[
              { label: "Total APR Records", value: fmt(apr_summary.total) },
              { label: "Valid %", value: `${fmt(apr_summary.valid_pct, 1)}%`, color: "text-emerald-600" },
              { label: "Invalid %", value: `${fmt(apr_summary.invalid_pct, 1)}%`, color: "text-red-500" },
            ].map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2 bg-slate-50">
                <span className="text-sm text-slate-600">{s.label}</span>
                <span className={`text-sm font-bold ${s.color ?? "text-slate-800"}`}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Upload Panel ───────────────────────────────────────────────────────────────
const UPLOAD_OPTIONS: { type: UploadType; label: string; brand: Brand; desc: string }[] = [
  { type: "bellavita-sales", label: "Bellavita Sales", brand: "Bellavita", desc: "Monthly sales data (.xlsx)" },
  { type: "bellavita-apr",   label: "Bellavita APR",   brand: "Bellavita", desc: "April performance report (.xlsx)" },
  { type: "bellavita-chat",  label: "Bellavita Chat",  brand: "Bellavita", desc: "Chat interaction data (.xlsx)" },
  { type: "bellavita-cart",  label: "Bellavita Cart",  brand: "Bellavita", desc: "Cart abandonment data (.xlsx)" },
  { type: "gnc-sales",       label: "GNC Sales",       brand: "GNC",       desc: "Monthly sales data (.xlsx)" },
  { type: "gnc-apr",         label: "GNC APR",         brand: "GNC",       desc: "April performance report (.xlsx)" },
  { type: "gnc-allocation",  label: "GNC Allocation",  brand: "GNC",       desc: "Agent allocation data (.xlsx)" },
];

function UploadPanel() {
  const [selectedType, setSelectedType] = useState<UploadType>("bellavita-sales");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [logs, setLogs] = useState<UploadLog[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadLogs = useCallback(async () => {
    try {
      const res = await hrmsApi.get<{ data: UploadLog[] }>("/api/sales-upload/logs?limit=30");
      setLogs(res.data ?? []);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  async function handleUpload() {
    if (!file) return;
    setUploading(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await hrmsApi.postForm<{ rowsInserted?: number; message?: string }>(
        `/api/sales-upload/upload/${selectedType}`, fd
      );
      setResult({ ok: true, message: `Uploaded ${(res as { rowsInserted?: number }).rowsInserted ?? "?"} rows successfully.` });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      void loadLogs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setResult({ ok: false, message: msg });
    } finally { setUploading(false); }
  }

  async function handleDelete(batchId: string) {
    if (!confirm("Delete this upload batch? This cannot be undone.")) return;
    setDeleting(batchId);
    try {
      await hrmsApi.delete(`/api/sales-upload/batch/${batchId}`);
      void loadLogs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Delete failed. Please try again.";
      setResult({ ok: false, message: msg });
    } finally { setDeleting(null); }
  }

  const typeLabel = UPLOAD_OPTIONS.find(o => o.type === selectedType)?.label ?? selectedType;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <p className="mb-4 text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Upload className="h-4 w-4 text-blue-500" /> Upload Sales Data
        </p>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Data Type</label>
            <select value={selectedType} onChange={e => setSelectedType(e.target.value as UploadType)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
              {UPLOAD_OPTIONS.map(o => (
                <option key={o.type} value={o.type}>{o.label} ({o.brand}) — {o.desc}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Excel File (.xlsx)</label>
            <input ref={fileRef} type="file" accept=".xlsx,.xls"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-blue-700" />
          </div>
          {result && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
              {result.ok ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {result.message}
            </div>
          )}
          <button onClick={handleUpload} disabled={!file || uploading}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            <Upload className="h-4 w-4" />
            {uploading ? `Uploading ${typeLabel}…` : `Upload ${typeLabel}`}
          </button>
        </div>
      </div>

      {/* Upload logs */}
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">Recent Uploads</p>
          <button onClick={loadLogs} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
            <RefreshCcw className="h-3 w-3" /> Refresh
          </button>
        </div>
        {logs.length === 0
          ? <p className="py-4 text-center text-sm text-slate-400">No uploads yet.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left py-2">Type</th>
                    <th className="text-left py-2">Month</th>
                    <th className="text-right py-2">Rows</th>
                    <th className="text-left py-2">By</th>
                    <th className="text-left py-2">Date</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-1.5 font-medium text-slate-700">{log.upload_type}</td>
                      <td className="py-1.5 text-slate-600">{log.month_label}</td>
                      <td className="py-1.5 text-right text-slate-600">{log.row_count.toLocaleString()}</td>
                      <td className="py-1.5 text-slate-500">{log.uploaded_by}</td>
                      <td className="py-1.5 text-slate-400">{new Date(log.created_at).toLocaleDateString()}</td>
                      <td className="py-1.5 text-right">
                        <button onClick={() => handleDelete(log.batch_id)} disabled={deleting === log.batch_id}
                          className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type SalesTab = "bellavita" | "gnc" | "upload";

export default function NativeSalesDashboard() {
  const { hasAnyRole } = useWorkforceAccess();
  const canAccess = hasAnyRole("super_admin","admin","ceo","manager","process_manager","operations_manager","quality_analyst","qa");
  const canUpload = hasAnyRole("super_admin","admin","process_manager","operations_manager");

  const [tab, setTab] = useState<SalesTab>("bellavita");
  const [month, setMonth] = useState(currentMonth());

  if (!canAccess) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <div className="rounded-2xl border border-red-100 bg-red-50 px-8 py-6 text-center">
            <p className="font-semibold text-red-700">Access Restricted</p>
            <p className="mt-1 text-sm text-red-500">You don't have permission to view Sales analytics.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  type TabDef = { id: SalesTab; label: string };
  const TABS: TabDef[] = [
    { id: "bellavita", label: "Bellavita" },
    { id: "gnc",       label: "GNC" },
    ...(canUpload ? [{ id: "upload" as const, label: "Upload Data" }] : []),
  ];

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-600" /> Sales Analytics
            </h1>
            <p className="text-sm text-slate-500">Bellavita and GNC brand performance with upload management</p>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-slate-400" />
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${tab === t.id ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "bellavita" && <BellavitaDashboard month={month} />}
        {tab === "gnc"       && <GncDashboard month={month} />}
        {tab === "upload"    && <UploadPanel />}
      </div>
    </DashboardLayout>
  );
}
