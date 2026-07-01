import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { hrmsApi } from "@/lib/hrmsApi";

type AnyRow = Record<string, any>;

type WebData = {
  ok: boolean;
  orgName: string;
  refreshTime: string;
  todayISO: string;
  summary: AnyRow;
  trends: Record<string, AnyRow>;
  options: {
    branches: string[];
    processes: string[];
    roles: string[];
    recruiters: string[];
    sources: string[];
    statuses: string[];
    months: string[];
    slots: string[];
  };
  queueRows: AnyRow[];
  candidateRows: AnyRow[];
  dashboardRows: AnyRow[];
  branchTable: AnyRow[];
  processTable: AnyRow[];
  roleTable: AnyRow[];
  recruiterTable: AnyRow[];
  sourceTable: AnyRow[];
  slotTable: AnyRow[];
  reusablePool: AnyRow[];
};

const periods = ["ALL", "FTD", "WTD", "MTD"];
const tabs = ["Cover", "Dashboard", "Trends", "Rejections", "Recruiters", "Sourcing", "Live Queue", "Candidate Journey", "Health"];

const n = (v: unknown) => Number(v || 0).toLocaleString("en-IN");
const pct = (v: unknown) => `${Number(v || 0).toFixed(Number(v || 0) % 1 ? 1 : 0)}%`;
const mins = (v: unknown) => {
  const min = Number(v || 0);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

function Kpi({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
      {foot && <div className="mt-1 text-sm text-slate-500">{foot}</div>}
    </div>
  );
}

function SimpleTable({ rows, columns, empty = "No data" }: { rows: AnyRow[]; columns: { key: string; label: string; render?: (row: AnyRow) => ReactNode }[]; empty?: string }) {
  return (
    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
          <tr>{columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-3 text-left font-bold">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, i) => (
            <tr key={row.id || row.CandidateID || i} className="border-t border-slate-100 hover:bg-slate-50">
              {columns.map((c) => <td key={c.key} className="whitespace-nowrap px-3 py-3 text-slate-700">{c.render ? c.render(row) : String(row[c.key] ?? "-")}</td>)}
            </tr>
          )) : <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function NativeATSFullParityCommandCenter() {
  const [data, setData] = useState<WebData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Cover");
  const [period, setPeriod] = useState("ALL");
  const [branch, setBranch] = useState("");
  const [process, setProcess] = useState("");
  const [recruiter, setRecruiter] = useState("");
  const [journeyQuery, setJourneyQuery] = useState("");
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyError, setJourneyError] = useState("");
  const [journey, setJourney] = useState<AnyRow | null>(null);
  const [health, setHealth] = useState<AnyRow | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams();
      if (period) q.set("period", period);
      if (branch) q.set("branch", branch);
      if (process) q.set("process", process);
      if (recruiter) q.set("recruiter", recruiter);
      const res = await hrmsApi.get<WebData>(`/api/ats-full-parity/web-data?${q.toString()}`);
      setData(res);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [period, branch, process, recruiter]);

  const summary = data?.summary || {};
  const criticalQueue = useMemo(() => [...(data?.queueRows || [])].sort((a, b) => Number(b.WaitingMinutes || 0) - Number(a.WaitingMinutes || 0)).slice(0, 15), [data]);

  async function runJourney() {
    if (!journeyQuery.trim()) return;
    setJourneyLoading(true);
    setJourneyError("");
    setJourney(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: AnyRow }>(`/api/ats-full-parity/journey?query=${encodeURIComponent(journeyQuery.trim())}`);
      setJourney(res.data);
      if (!res.data) setJourneyError("Candidate not found.");
    } catch (e: any) {
      setJourneyError(e?.message || "Search failed.");
    } finally {
      setJourneyLoading(false);
    }
  }

  async function loadHealth() {
    setHealthLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: AnyRow }>(`/api/ats-full-parity/health`);
      setHealth(res.data);
    } catch (e: any) {
      setError(e?.message || "Health check failed.");
    } finally {
      setHealthLoading(false);
    }
  }

  async function runSla() {
    try {
      await hrmsApi.post(`/api/ats-full-parity/jobs/sla-check`, {});
      await load();
    } catch (e: any) {
      setError(e?.message || "SLA check failed.");
    }
  }

  async function runRepair() {
    try {
      await hrmsApi.post(`/api/ats-full-parity/jobs/repair`, { limit: 500 });
      await load();
    } catch (e: any) {
      setError(e?.message || "Repair failed.");
    }
  }

  async function previewDailyReport() {
    try {
      await hrmsApi.get(`/api/ats-full-parity/daily-report/snapshot?mode=preview`);
      alert("Daily report preview snapshot generated in ATS report log.");
    } catch (e: any) {
      setError(e?.message || "Daily report preview failed.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900 lg:p-6">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-black uppercase tracking-widest text-sky-100">ATS App Script Full Parity</div>
              <h1 className="mt-3 text-3xl font-black tracking-tight lg:text-5xl">ATS Command Center</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">Dashboard, live queue, SLA, recruiter productivity, sourcing, candidate journey, confirmation, BGV, notification and health parity layer migrated from Google Sheet/App Script ATS.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 text-sm text-slate-200">
              <div>Updated: <b>{data?.refreshTime || "--"}</b></div>
              <div className="mt-2 flex gap-2">
                <button onClick={load} className="rounded-xl bg-sky-400 px-4 py-2 text-sm font-black text-slate-950">Refresh</button>
                <button onClick={runSla} className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-slate-950">Run SLA</button>
                <button onClick={runRepair} className="rounded-xl bg-white/10 px-4 py-2 text-sm font-black text-white">Repair</button>
              </div>
            </div>
          </div>
        </section>

        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</div>}
        {loading && <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-500">Loading ATS command center...</div>}

        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="grid gap-3 md:grid-cols-5">
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              {periods.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">All branches</option>{(data?.options?.branches || []).map((x) => <option key={x}>{x}</option>)}</select>
            <select value={process} onChange={(e) => setProcess(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">All processes</option>{(data?.options?.processes || []).map((x) => <option key={x}>{x}</option>)}</select>
            <select value={recruiter} onChange={(e) => setRecruiter(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="">All recruiters</option>{(data?.options?.recruiters || []).map((x) => <option key={x}>{x}</option>)}</select>
            <button onClick={previewDailyReport} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white">Daily Report Preview</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => <button key={t} onClick={() => { setTab(t); if (t === "Health") loadHealth(); }} className={`rounded-xl px-4 py-2 text-sm font-black ${tab === t ? "bg-slate-900 text-white" : "bg-white text-slate-600 shadow-sm"}`}>{t}</button>)}
        </div>

        {tab === "Cover" && <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Arrivals" value={n(summary.totalArrival)} foot="Selected / rejected / pending" />
            <Kpi label="Selected" value={n(summary.totalSelection)} foot={pct(summary.selectionRate)} />
            <Kpi label="Pending" value={n(summary.pending)} foot={`${n(summary.waiting)} waiting`} />
            <Kpi label="SLA Breach" value={n(summary.slaBreach)} foot={pct(summary.slaBreachRate)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <SimpleTable rows={criticalQueue} columns={[{ key: "QToken", label: "Token" }, { key: "FullName", label: "Candidate" }, { key: "Branch", label: "Branch" }, { key: "RecruiterAssignedName", label: "Recruiter" }, { key: "WaitingMinutes", label: "Waiting", render: (r) => mins(r.WaitingMinutes) }, { key: "SLAFlag", label: "SLA" }]} />
            <SimpleTable rows={(data?.branchTable || []).slice(0, 12)} columns={[{ key: "Name", label: "Branch" }, { key: "TotalArrival", label: "Arrival" }, { key: "Selection", label: "Selected" }, { key: "Waiting", label: "Waiting" }, { key: "SlaBreach", label: "SLA" }, { key: "SelectionRate", label: "Sel %", render: (r) => pct(r.SelectionRate) }]} />
          </div>
        </>}

        {tab === "Dashboard" && <SimpleTable rows={data?.dashboardRows || []} columns={[{ key: "Date", label: "Period" }, { key: "Total Arrival", label: "Arrival" }, { key: "Selection", label: "Selected" }, { key: "Rejection", label: "Rejected" }, { key: "Pending", label: "Pending" }, { key: "SLA Breach", label: "SLA" }, { key: "Avg Time", label: "Avg", render: (r) => mins(r["Avg Time"]) }]} />}

        {tab === "Trends" && <div className="grid gap-4 lg:grid-cols-2"><SimpleTable rows={data?.processTable || []} columns={[{ key: "Name", label: "Process" }, { key: "TotalArrival", label: "Arrival" }, { key: "Selection", label: "Selected" }, { key: "Rejection", label: "Rejected" }, { key: "SelectionRate", label: "Sel %", render: (r) => pct(r.SelectionRate) }]} /><SimpleTable rows={data?.slotTable || []} columns={[{ key: "Name", label: "Slot" }, { key: "TotalArrival", label: "Arrival" }, { key: "Selection", label: "Selected" }, { key: "SlaBreach", label: "SLA" }, { key: "AvgWaitMinutes", label: "Avg Wait", render: (r) => mins(r.AvgWaitMinutes) }]} /></div>}

        {tab === "Rejections" && <SimpleTable rows={(data?.candidateRows || []).filter((r) => r._rejected || r._hardRejectReason)} columns={[{ key: "CandidateID", label: "Candidate ID" }, { key: "FullName", label: "Candidate" }, { key: "Branch", label: "Branch" }, { key: "_endStage", label: "Stage" }, { key: "_hardRejectReason", label: "Hard reason" }, { key: "rejection_voc", label: "VOC" }]} />}

        {tab === "Recruiters" && <SimpleTable rows={data?.recruiterTable || []} columns={[{ key: "Recruiter", label: "Recruiter" }, { key: "Branch", label: "Branch" }, { key: "SourcedCount", label: "Sourced" }, { key: "AttendedCount", label: "Attended" }, { key: "SlaCompliancePercent", label: "SLA %", render: (r) => pct(r.SlaCompliancePercent) }, { key: "SelectionRate", label: "Sel %", render: (r) => pct(r.SelectionRate) }, { key: "AvgWaitMinutes", label: "Avg Wait", render: (r) => mins(r.AvgWaitMinutes) }, { key: "AttentionFlag", label: "Attention" }]} />}

        {tab === "Sourcing" && <div className="grid gap-4 lg:grid-cols-2"><SimpleTable rows={data?.sourceTable || []} columns={[{ key: "Name", label: "Source" }, { key: "TotalArrival", label: "Arrival" }, { key: "Selection", label: "Selected" }, { key: "Rejection", label: "Rejected" }, { key: "SelectionRate", label: "Sel %", render: (r) => pct(r.SelectionRate) }]} /><SimpleTable rows={data?.reusablePool || []} columns={[{ key: "CandidateID", label: "Candidate ID" }, { key: "FullName", label: "Candidate" }, { key: "Branch", label: "Branch" }, { key: "_candidateQualityLabel", label: "Quality" }, { key: "_reusableReason", label: "Reusable reason" }]} /></div>}

        {tab === "Live Queue" && <SimpleTable rows={data?.queueRows || []} columns={[{ key: "QToken", label: "Token" }, { key: "CandidateID", label: "Candidate ID" }, { key: "FullName", label: "Candidate" }, { key: "Branch", label: "Branch" }, { key: "RoleApplied", label: "Role" }, { key: "RecruiterAssignedName", label: "Recruiter" }, { key: "CurrentStage", label: "Stage" }, { key: "WaitingMinutes", label: "Waiting", render: (r) => mins(r.WaitingMinutes) }, { key: "SLAFlag", label: "SLA" }]} />}

        {tab === "Candidate Journey" && <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex gap-3">
              <input value={journeyQuery} onChange={(e) => setJourneyQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runJourney()} placeholder="Candidate ID / QToken / mobile / email / name" className="flex-1 rounded-xl border border-slate-200 px-3 py-2" />
              <button onClick={runJourney} disabled={journeyLoading} className="rounded-xl bg-slate-900 px-4 py-2 font-bold text-white disabled:opacity-60">{journeyLoading ? "Searching..." : "Search"}</button>
            </div>
            {journeyError && <div className="mt-2 text-sm text-rose-600">{journeyError}</div>}
          </div>
          {journey && <>
            <div className="grid gap-4 md:grid-cols-4">
              <Kpi label="Candidate" value={journey.candidate?.FullName || "-"} foot={journey.candidate?.CandidateID || journey.candidate?.candidate_code} />
              <Kpi label="Stage" value={journey.candidate?.CurrentStage || journey.candidate?.current_stage || "-"} foot={journey.candidate?.Status || journey.candidate?.status} />
              <Kpi label="Quality" value={`${journey.candidate?._candidateQualityScore || 0}`} foot={journey.candidate?._candidateQualityLabel} />
              <Kpi label="Handling" value={`${journey.candidate?._handlingQualityScore || 0}`} foot={journey.candidate?._handlingQualityLabel} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 font-bold text-slate-700">Stage Log</div>
                <SimpleTable rows={journey.stageLogs || []} columns={[{ key: "from_stage", label: "From" }, { key: "to_stage", label: "To" }, { key: "stage_date", label: "Date" }, { key: "remarks", label: "Remarks" }]} empty="No stage transitions recorded" />
              </div>
              <div>
                <div className="mb-2 font-bold text-slate-700">Confirmations</div>
                <SimpleTable rows={journey.confirmations || []} columns={[{ key: "will_join", label: "Will Join" }, { key: "hr_query", label: "HR Query" }, { key: "process_name", label: "Process" }, { key: "created_at", label: "Date" }]} empty="No confirmations" />
              </div>
            </div>
          </>}
        </div>}

        {tab === "Health" && <>
          {healthLoading && <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-500">Running health checks...</div>}
          {!healthLoading && health && (
            <div className="space-y-3">
              <div className={`rounded-2xl border p-3 text-sm font-bold ${health.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                Overall: {health.ok ? "All checks passed" : "One or more checks need attention"}
              </div>
              <SimpleTable rows={health.checks || []} columns={[{ key: "type", label: "Type" }, { key: "name", label: "Check" }, { key: "ok", label: "Status", render: (r) => r.ok ? <span className="font-bold text-emerald-600">OK</span> : <span className="font-bold text-rose-600">Fix Needed</span> }, { key: "count", label: "Count" }]} />
            </div>
          )}
        </>}
      </div>
    </div>
  );
}
