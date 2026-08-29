import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, AlertCircle, Download, Search, CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * Token-gated results view — /kpi-capture/results/:token. No login.
 *
 * The token is checked server-side against kpi_capture_access_token. A wrong token gets the same
 * 404 as a missing one, so this page cannot be used to confirm that a valid token exists.
 *
 * It carries client/process names, headcount-adjacent detail and every target, which is why it is
 * NOT on a guessable path and why it sets robots noindex on mount.
 */

type Submission = {
  id: string;
  created_at: string;
  submitter_name: string;
  submitter_email: string | null;
  cost_centre_label: string;
  designation_label: string;
  is_new_kpi: number;
  existing_metric_code: string | null;
  kpi_name: string | null;
  new_kpi_formula: string | null;
  unit: string;
  direction: string;
  aggregation_method: string;
  measure_frequency: string;
  target_value: string | number | null;
  min_threshold: string | number | null;
  max_achievement: string | number | null;
  weightage: string | number | null;
  data_source: string;
  owner_name: string;
  notes: string | null;
  status: string;
};

type WeightRow = {
  costCentre: string;
  designation: string;
  kpiCount: number;
  totalWeightage: number;
};

type Payload = {
  success: boolean;
  summary: { total: number; newKpis: number; costCentres: number; designations: number };
  weightageCheck: WeightRow[];
  submissions: Submission[];
};

/**
 * DECIMAL columns arrive from mysql2 as STRINGS, not numbers. Calling .toFixed() on them throws
 * and takes the whole page down — the failure mode that killed /quality-dashboard. Coerce at the
 * boundary, once, rather than at each render site.
 */
const n = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const fmt = (v: string | number | null | undefined, dp = 2): string => {
  const x = n(v);
  return x === null ? "—" : x.toFixed(dp).replace(/\.00$/, "");
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

function Tile({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "amber" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "amber" ? "text-amber-600" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}

export default function PublicKpiCaptureResults() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // Keep this page out of search results. It is unguessable, not secret-by-obscurity alone, but
  // an indexed URL would defeat the point entirely.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/kpi-capture/results/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || !d?.success) throw new Error(r.status === 404 ? "notfound" : d?.message || "Failed");
        return d as Payload;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [token]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data.submissions;
    return data.submissions.filter((s) =>
      [s.cost_centre_label, s.designation_label, s.kpi_name, s.owner_name, s.submitter_name, s.data_source]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }, [data, q]);

  const offWeight = useMemo(
    () => (data?.weightageCheck ?? []).filter((w) => Math.abs(w.totalWeightage - 100) > 0.01),
    [data]
  );

  function exportCsv() {
    if (!data) return;
    const cols = [
      "created_at", "submitter_name", "submitter_email", "cost_centre_label", "designation_label",
      "kpi_name", "existing_metric_code", "is_new_kpi", "new_kpi_formula", "unit", "direction",
      "aggregation_method", "measure_frequency", "target_value", "min_threshold",
      "max_achievement", "weightage", "data_source", "owner_name", "notes",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      cols.join(","),
      ...rows.map((r) => cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(",")),
    ].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kpi-capture-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-slate-400" />
          <p className="text-sm font-medium text-slate-900">
            {error === "notfound" ? "Page not found" : "Could not load results"}
          </p>
          {error !== "notfound" && <p className="mt-1 text-sm text-slate-500">{error}</p>}
        </div>
      </div>
    );
  }

  const s = data!.summary;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-7 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                MAS Callnet · HRMS
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                KPI capture — submissions
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Everything the teams have sent through the open capture form.
              </p>
            </div>
            <button
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5
                         text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-5 py-7 sm:px-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label="Submissions" value={s.total} />
          <Tile label="New KPIs proposed" value={s.newKpis} tone="amber" />
          <Tile label="Cost centres covered" value={s.costCentres} />
          <Tile label="Designations covered" value={s.designations} />
        </div>

        {/* The single most useful check on this data: a designation whose KPI weightages do not
            total 100 has an incomplete or double-counted set, which is invisible row by row. */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
            {offWeight.length === 0 ? (
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4.5 w-4.5 text-amber-500" />
            )}
            <h2 className="text-sm font-semibold text-slate-900">
              Weightage check
              <span className="ml-2 font-normal text-slate-500">
                {offWeight.length === 0
                  ? "every team totals 100%"
                  : `${offWeight.length} team${offWeight.length === 1 ? "" : "s"} do not total 100%`}
              </span>
            </h2>
          </div>
          {offWeight.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Cost centre</th>
                    <th className="px-5 py-2.5 font-medium">Designation</th>
                    <th className="px-5 py-2.5 font-medium">KPIs</th>
                    <th className="px-5 py-2.5 font-medium">Total weightage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {offWeight.map((w, i) => (
                    <tr key={i}>
                      <td className="px-5 py-2.5 text-slate-900">{w.costCentre}</td>
                      <td className="px-5 py-2.5 text-slate-600">{w.designation}</td>
                      <td className="px-5 py-2.5 text-slate-600">{w.kpiCount}</td>
                      <td className="px-5 py-2.5 font-medium text-amber-600">{w.totalWeightage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              All submissions
              <span className="ml-2 font-normal text-slate-500">{rows.length} shown</span>
            </h2>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by cost centre, KPI, owner…"
                className="w-72 rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm
                           outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">
              Nothing submitted yet. Share the capture link with the teams.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-5 py-2.5 font-medium">Date</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-medium">Cost centre</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-medium">Designation</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-medium">KPI</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-medium">Unit</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-medium">Target</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-medium">Wt %</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-medium">Freq</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-medium">Source</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-medium">Owner</th>
                    <th className="whitespace-nowrap px-5 py-2.5 font-medium">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-5 py-3 text-slate-500">{fmtDate(r.created_at)}</td>
                      <td className="px-5 py-3 text-slate-900">{r.cost_centre_label}</td>
                      <td className="px-5 py-3 text-slate-600">{r.designation_label}</td>
                      <td className="px-5 py-3">
                        <span className="text-slate-900">{r.kpi_name || "—"}</span>
                        {Number(r.is_new_kpi) === 1 && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                            NEW
                          </span>
                        )}
                        {r.new_kpi_formula && (
                          <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
                            {r.new_kpi_formula}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">{r.unit}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-900">{fmt(r.target_value)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">{fmt(r.weightage)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">{r.measure_frequency}</td>
                      <td className="px-5 py-3 text-slate-600">{r.data_source}</td>
                      <td className="px-5 py-3 text-slate-600">{r.owner_name}</td>
                      <td className="px-5 py-3 text-slate-500">{r.submitter_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
