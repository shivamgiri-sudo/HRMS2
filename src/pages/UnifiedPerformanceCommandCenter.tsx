import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type OptionRow = { id: string; label: string; code?: string };

type PerfRow = Record<string, any>;

type QuickPeriod = "today" | "yesterday" | "last_7" | "last_15" | "last_30" | "mtd" | "last_3_months" | "last_6_months" | "ytd" | "custom";
type TrendView = "daily" | "weekly" | "monthly" | "quarterly";
type PerformanceArea = "branch" | "process" | "employee" | "training" | "recruiter" | "quality" | "operations" | "wfm";

const db = supabase as any;

const areaConfig: Record<PerformanceArea, { label: string; table: string; dateColumn: string; defaultScore: string; description: string }> = {
  branch: {
    label: "Branch Performance",
    table: "branch_performance_snapshot",
    dateColumn: "metric_date",
    defaultScore: "final_score",
    description: "HRMS + ATS + LMS + WFM + Quality + Operations branch score.",
  },
  process: {
    label: "Process Performance",
    table: "process_performance_snapshot",
    dateColumn: "metric_date",
    defaultScore: "final_score",
    description: "Process-level headcount, hiring, training, quality, productivity and SLA score.",
  },
  employee: {
    label: "Analyst / Employee Performance",
    table: "employee_performance_snapshot",
    dateColumn: "metric_date",
    defaultScore: "final_score",
    description: "Employee score using attendance, productivity, quality, training and adherence.",
  },
  training: {
    label: "Training Performance",
    table: "training_performance_snapshot",
    dateColumn: "metric_date",
    defaultScore: "final_score",
    description: "Training throughput, certification, attrition, LMS completion and OPS handover.",
  },
  recruiter: {
    label: "Recruiter Performance",
    table: "recruiter_performance_snapshot",
    dateColumn: "metric_date",
    defaultScore: "final_score",
    description: "Recruiter hiring productivity, walk-in, selection and joining conversion.",
  },
  quality: {
    label: "Quality Performance",
    table: "quality_score_log",
    dateColumn: "audit_date",
    defaultScore: "qa_score",
    description: "QA score, fatal count, defects and coaching performance.",
  },
  operations: {
    label: "Operations Performance",
    table: "operations_productivity_log",
    dateColumn: "work_date",
    defaultScore: "productivity_percent",
    description: "Analyst/process productivity, output, SLA and backlog trend.",
  },
  wfm: {
    label: "WFM Performance",
    table: "wfm_performance_snapshot",
    dateColumn: "metric_date",
    defaultScore: "final_score",
    description: "Roster adherence, absenteeism, shift coverage, break outliers and shrinkage.",
  },
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toISODate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}

function subtractDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

function subtractMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
}

function resolvePeriod(period: QuickPeriod, customFrom: string, customTo: string) {
  const today = new Date();
  const yesterday = subtractDays(today, 1);

  if (period === "custom") {
    return { from: customFrom || toISODate(startOfMonth(today)), to: customTo || toISODate(today) };
  }

  if (period === "today") return { from: toISODate(today), to: toISODate(today) };
  if (period === "yesterday") return { from: toISODate(yesterday), to: toISODate(yesterday) };
  if (period === "last_7") return { from: toISODate(subtractDays(today, 6)), to: toISODate(today) };
  if (period === "last_15") return { from: toISODate(subtractDays(today, 14)), to: toISODate(today) };
  if (period === "last_30") return { from: toISODate(subtractDays(today, 29)), to: toISODate(today) };
  if (period === "mtd") return { from: toISODate(startOfMonth(today)), to: toISODate(today) };
  if (period === "last_3_months") return { from: toISODate(startOfMonth(subtractMonths(today, 2))), to: toISODate(today) };
  if (period === "last_6_months") return { from: toISODate(startOfMonth(subtractMonths(today, 5))), to: toISODate(today) };
  if (period === "ytd") return { from: toISODate(startOfYear(today)), to: toISODate(today) };
  return { from: toISODate(startOfMonth(today)), to: toISODate(today) };
}

function safeNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function monthLabel(value: string) {
  if (!value) return "-";
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-");
    return `${month}-${year}`;
  }
  return value;
}

function groupTrend(rows: PerfRow[], trendView: TrendView, scoreKey: string) {
  const grouped: Record<string, { label: string; scoreValues: number[]; count: number }> = {};

  rows.forEach((row) => {
    let key = row.metric_date || row.audit_date || row.work_date || row.created_at || "Unknown";
    if (trendView === "monthly") key = row.metric_month || String(key).slice(0, 7);
    if (trendView === "quarterly") key = row.metric_quarter || row.metric_month || String(key).slice(0, 7);
    if (trendView === "weekly") key = row.metric_week || row.metric_date || row.audit_date || row.work_date || "Unknown";

    const label = trendView === "monthly" ? monthLabel(String(key)) : String(key).slice(0, 10);
    if (!grouped[key]) grouped[key] = { label, scoreValues: [], count: 0 };
    grouped[key].scoreValues.push(safeNumber(row[scoreKey]));
    grouped[key].count += 1;
  });

  return Object.keys(grouped)
    .sort()
    .map((key) => ({
      period: grouped[key].label,
      score: Number(average(grouped[key].scoreValues).toFixed(2)),
      records: grouped[key].count,
    }));
}

function exportCsv(fileName: string, rows: PerfRow[]) {
  if (!rows.length) return;
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const text = String(row[header] ?? "");
          if (text.includes(",") || text.includes("\n") || text.includes('"')) {
            return `"${text.replace(/"/g, '""')}"`;
          }
          return text;
        })
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function UnifiedPerformanceCommandCenter() {
  const [area, setArea] = useState<PerformanceArea>("branch");
  const [period, setPeriod] = useState<QuickPeriod>("mtd");
  const [trendView, setTrendView] = useState<TrendView>("monthly");
  const [customFrom, setCustomFrom] = useState(toISODate(startOfMonth(new Date())));
  const [customTo, setCustomTo] = useState(toISODate(new Date()));
  const [branchId, setBranchId] = useState("");
  const [processId, setProcessId] = useState("");
  const [lobId, setLobId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");

  const [branches, setBranches] = useState<OptionRow[]>([]);
  const [processes, setProcesses] = useState<OptionRow[]>([]);
  const [lobs, setLobs] = useState<OptionRow[]>([]);
  const [departments, setDepartments] = useState<OptionRow[]>([]);
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = areaConfig[area];
  const range = useMemo(() => resolvePeriod(period, customFrom, customTo), [period, customFrom, customTo]);

  async function loadOptions() {
    const [branchRes, processRes, lobRes, deptRes] = await Promise.all([
      db.from("branch_master").select("id,branch_code,branch_name").eq("active_status", true).order("branch_name"),
      db.from("process_master").select("id,process_code,process_name").eq("active_status", true).order("process_name"),
      db.from("lob_master").select("id,lob_code,lob_name").eq("active_status", true).order("lob_name"),
      db.from("departments").select("id,name").eq("active_status", true).order("name"),
    ]);

    if (!branchRes.error) setBranches((branchRes.data || []).map((b: any) => ({ id: b.id, label: b.branch_name, code: b.branch_code })));
    if (!processRes.error) setProcesses((processRes.data || []).map((p: any) => ({ id: p.id, label: p.process_name, code: p.process_code })));
    if (!lobRes.error) setLobs((lobRes.data || []).map((l: any) => ({ id: l.id, label: l.lob_name, code: l.lob_code })));
    if (!deptRes.error) setDepartments((deptRes.data || []).map((d: any) => ({ id: d.id, label: d.name })));
  }

  async function loadPerformance() {
    setLoading(true);
    setError(null);

    try {
      let query = db
        .from(config.table)
        .select("*")
        .gte(config.dateColumn, range.from)
        .lte(config.dateColumn, range.to)
        .order(config.dateColumn, { ascending: true })
        .limit(5000);

      if (branchId && ["branch", "process", "employee", "training", "recruiter", "quality", "operations", "wfm"].includes(area)) {
        query = query.eq("branch_id", branchId);
      }
      if (processId && ["process", "employee", "training", "recruiter", "quality", "operations", "wfm"].includes(area)) {
        query = query.eq("process_id", processId);
      }
      if (lobId && ["process", "employee", "training", "quality", "operations"].includes(area)) {
        query = query.eq("lob_id", lobId);
      }
      if (departmentId && area === "employee") {
        query = query.eq("department_id", departmentId);
      }

      const { data, error: perfError } = await query;
      if (perfError) throw perfError;

      let filtered = (data || []) as PerfRow[];
      const q = employeeSearch.trim().toLowerCase();
      if (q) {
        filtered = filtered.filter((row) =>
          [row.employee_code, row.employee_name, row.analyst_code, row.analyst_name, row.recruiter_name, row.batch_no]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(q))
        );
      }
      setRows(filtered);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Unable to load performance data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOptions();
  }, []);

  useEffect(() => {
    loadPerformance();
  }, [area, period, trendView, branchId, processId, lobId, departmentId]);

  const trendData = useMemo(() => groupTrend(rows, trendView, config.defaultScore), [rows, trendView, config.defaultScore]);
  const avgScore = Number(average(rows.map((row) => safeNumber(row[config.defaultScore]))).toFixed(2));
  const healthyCount = rows.filter((row) => String(row.risk_status || "").toLowerCase() === "healthy").length;
  const watchCount = rows.filter((row) => ["watch", "critical", "high"].includes(String(row.risk_status || "").toLowerCase())).length;

  const scoreBreakdown = useMemo(() => {
    const keys = ["attendance_score", "productivity_score", "quality_score", "training_score", "adherence_score"];
    return keys
      .filter((key) => rows.some((row) => typeof row[key] !== "undefined"))
      .map((key) => ({ metric: key.replace(/_/g, " ").replace(/score/g, "").trim(), score: Number(average(rows.map((row) => safeNumber(row[key]))).toFixed(2)) }));
  }, [rows]);

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Performance Intelligence</p>
                <h1 className="mt-2 text-2xl font-semibold text-slate-950">Unified Performance Command Center</h1>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
                  Date, month, branch, process, LOB, employee and trend filters for Operations, Training, Quality, ATS, WFM and HRMS performance.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={loadPerformance} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Refresh
                </button>
                <button onClick={() => exportCsv(`${area}_performance_${range.from}_${range.to}.csv`, rows)} className="h-10 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">
                  Export CSV
                </button>
              </div>
            </div>
          </section>

          {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Performance Area">
                <select value={area} onChange={(e) => setArea(e.target.value as PerformanceArea)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400">
                  {Object.entries(areaConfig).map(([key, value]) => (
                    <option key={key} value={key}>{value.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Quick Period">
                <select value={period} onChange={(e) => setPeriod(e.target.value as QuickPeriod)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400">
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last_7">Last 7 Days</option>
                  <option value="last_15">Last 15 Days</option>
                  <option value="last_30">Last 30 Days</option>
                  <option value="mtd">MTD</option>
                  <option value="last_3_months">Last 3 Months</option>
                  <option value="last_6_months">Last 6 Months</option>
                  <option value="ytd">YTD</option>
                  <option value="custom">Custom Date Range</option>
                </select>
              </Field>
              <Field label="From Date">
                <input type="date" value={period === "custom" ? customFrom : range.from} onChange={(e) => { setCustomFrom(e.target.value); setPeriod("custom"); }} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400" />
              </Field>
              <Field label="To Date">
                <input type="date" value={period === "custom" ? customTo : range.to} onChange={(e) => { setCustomTo(e.target.value); setPeriod("custom"); }} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400" />
              </Field>
              <Field label="Trend View">
                <select value={trendView} onChange={(e) => setTrendView(e.target.value as TrendView)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </Field>
              <Field label="Branch">
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400">
                  <option value="">All Branches</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </Field>
              <Field label="Process">
                <select value={processId} onChange={(e) => setProcessId(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400">
                  <option value="">All Processes</option>
                  {processes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="LOB">
                <select value={lobId} onChange={(e) => setLobId(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400">
                  <option value="">All LOBs</option>
                  {lobs.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </Field>
              <Field label="Department">
                <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400">
                  <option value="">All Departments</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </Field>
              <Field label="Employee / Analyst / Batch Search">
                <input value={employeeSearch} onChange={(e) => setEmployeeSearch(e.target.value)} onBlur={loadPerformance} placeholder="Search code/name/batch" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400" />
              </Field>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Average Score" value={`${avgScore}%`} note={config.label} />
            <StatCard label="Records" value={rows.length} note={`${range.from} to ${range.to}`} />
            <StatCard label="Healthy" value={healthyCount} note="Rows marked Healthy" />
            <StatCard label="Watch / Critical" value={watchCount} note="Rows needing attention" />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-slate-950">{config.label} Trend</h2>
                <p className="mt-1 text-sm text-slate-500">{config.description}</p>
              </div>
              <div className="h-[340px]">
                {loading ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading performance trend...</div>
                ) : trendData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center text-sm text-slate-500">No performance snapshot data found for selected filters. Start importing/uploading performance data to this table.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="period" />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Line type="monotone" dataKey="score" name="Score" strokeWidth={3} dot />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-slate-950">Score Breakdown</h2>
                <p className="mt-1 text-sm text-slate-500">Available score components from selected data.</p>
              </div>
              <div className="h-[340px]">
                {scoreBreakdown.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center text-sm text-slate-500">No component scores available for this area.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={scoreBreakdown} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} />
                      <YAxis dataKey="metric" type="category" width={92} />
                      <Tooltip />
                      <Bar dataKey="score" name="Score" radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Detailed Records</h2>
                <p className="mt-1 text-sm text-slate-500">Showing latest {rows.length} records after role/date/month/filter conditions.</p>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Date</Th>
                      <Th>Month</Th>
                      <Th>Employee / Entity</Th>
                      <Th>Score</Th>
                      <Th>Risk</Th>
                      <Th>Source</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {rows.slice(0, 200).map((row, index) => (
                      <tr key={row.id || index} className="hover:bg-slate-50">
                        <Td>{row.metric_date || row.audit_date || row.work_date || "-"}</Td>
                        <Td>{row.metric_month || "-"}</Td>
                        <Td>{row.employee_name || row.employee_code || row.analyst_name || row.recruiter_name || row.batch_no || row.team_name || row.id || "-"}</Td>
                        <Td>{safeNumber(row[config.defaultScore]).toFixed(2)}%</Td>
                        <Td>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${String(row.risk_status || "Healthy").toLowerCase() === "healthy" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                            {row.risk_status || "Healthy"}
                          </span>
                        </Td>
                        <Td>{row.source_system || "-"}</Td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={6} className="p-8 text-center text-sm text-slate-500">No records found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function StatCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-4 py-3 text-slate-600">{children}</td>;
}

// Tailwind helper class used by inputs in this page.
// If your project purges dynamic classes aggressively, keep this exact class list in the file.
const _inputClassReference = "input h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400";
