import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CalendarDays, Database, FileText, Loader, RefreshCcw, ShieldCheck } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type ApiEnvelope<T> = { success: boolean; data: T; meta?: unknown };
type AnyRecord = Record<string, any>;

type Props = {
  title: string;
  eyebrow: string;
  endpoint: string | ((params: URLSearchParams) => string);
  defaultDays?: number;
  primaryKeys?: string[];
};

function valueText(value: unknown): string {
  if (value == null) return "0";
  if (typeof value === "number") return new Intl.NumberFormat("en-IN").format(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function flattenKpis(data: AnyRecord | null, keys?: string[]) {
  if (!data) return [];
  const source = (data.kpis ?? data.summary ?? data.preview ?? data) as AnyRecord;
  const entries = keys?.length ? keys.map((key) => [key, source[key]]) : Object.entries(source);
  return entries
    .filter(([_, value]) => typeof value === "number" || typeof value === "string" || typeof value === "boolean")
    .slice(0, 8)
    .map(([key, value]) => ({ key: String(key), value }));
}

function Section({ title, value }: { title: string; value: unknown }) {
  if (value == null) return null;
  const rows = Array.isArray(value) ? value : typeof value === "object" ? Object.entries(value as AnyRecord).map(([key, item]) => ({ key, item })) : [];
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-black text-slate-950">{title}</h2>
        <FileText className="h-4 w-4 text-slate-400" />
      </div>
      {rows.length === 0 ? (
        <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{valueText(value)}</pre>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 12).map((row: any, index: number) => (
            <div key={row.key ?? index} className="rounded-xl bg-slate-50 p-3">
              {row.key && <p className="mb-1 text-xs font-black uppercase text-slate-400">{row.key}</p>}
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">{JSON.stringify(row.item ?? row, null, 2)}</pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function PeopleOSDataPage({ title, eyebrow, endpoint, defaultDays = 30, primaryKeys }: Props) {
  const [data, setData] = useState<AnyRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const from = useMemo(() => {
    const date = new Date(`${to}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - defaultDays + 1);
    return date.toISOString().slice(0, 10);
  }, [defaultDays, to]);

  const path = useMemo(() => {
    const params = new URLSearchParams({ from, to });
    return typeof endpoint === "function" ? endpoint(params) : `${endpoint}?${params.toString()}`;
  }, [endpoint, from, to]);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<ApiEnvelope<AnyRecord>>(path);
      setData(res.data ?? null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [path]);

  const kpis = flattenKpis(data, primaryKeys);
  const confidence = data?.data_confidence ?? data?.dataConfidence;
  const sectionEntries = data
    ? Object.entries(data).filter(([key, value]) => !["kpis", "summary", "preview", "data_confidence", "dataConfidence"].includes(key) && typeof value === "object")
    : [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">{eyebrow}</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">{title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-2xl border bg-white px-3 py-2 text-sm font-semibold text-slate-600">
              <CalendarDays className="h-4 w-4 text-slate-400" />
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="bg-transparent text-slate-900 outline-none" />
            </label>
            <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
              {loading ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Refresh
            </button>
          </div>
        </div>

        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
            <AlertTriangle className="h-4 w-4" />
            {message}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((item) => (
            <div key={item.key} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-slate-400">{item.key.replace(/_/g, " ")}</p>
                  <p className="mt-2 text-2xl font-black text-slate-950">{valueText(item.value)}</p>
                </div>
                <BarChart3 className="h-5 w-5 text-blue-500" />
              </div>
            </div>
          ))}
          {confidence && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-slate-400">Data Confidence</p>
                  <p className="mt-2 text-2xl font-black text-slate-950">{valueText((confidence as AnyRecord).confidence_score)}%</p>
                  <p className="mt-1 text-xs font-bold uppercase text-slate-500">{(confidence as AnyRecord).risk_level ?? "unknown"}</p>
                </div>
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
              </div>
            </div>
          )}
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center rounded-2xl border bg-white py-16">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {sectionEntries.map(([key, value]) => <Section key={key} title={key.replace(/_/g, " ")} value={value} />)}
            {data && sectionEntries.length === 0 && (
              <section className="rounded-2xl border bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <Database className="h-4 w-4 text-slate-400" />
                  <h2 className="text-base font-black text-slate-950">Response</h2>
                </div>
                <pre className="overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(data, null, 2)}</pre>
              </section>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
