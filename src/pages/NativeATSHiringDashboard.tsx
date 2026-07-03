import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BarChart3, CalendarDays, CheckCircle2, Filter, RefreshCcw, Search, TrendingUp, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type MetricData = Record<string, number>;
type DashboardData = {
  metrics: MetricData;
  byRecruiter: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
  bySource: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
  byProcess: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
  byBranch: Array<{ label: string; total: number; contacted: number; selected: number; joined: number }>;
};

const initialFilters = {
  fromDate: "",
  toDate: "",
  month: "",
  recruiter: "",
  hiringSource: "",
  wpGroup: "",
  position: "",
  location: "",
  branch: "",
  process: "",
  gender: "",
  education: "",
  experienceLevel: "",
  recruiterRemarks: "",
  hrInterviewStatus: "",
  aiInterviewResult: "",
  opsInterviewStatus: "",
  offerLetterStatus: "",
  joiningStatus: "",
  batchNo: "",
  currentStatus: "",
  walkin: "",
  finalSelection: "",
  joined: "",
  contacted: "",
  search: "",
};

function StatCard({ title, value, tone, icon }: { title: string; value: string | number; tone: string; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</div>
          <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
        </div>
        <div className={`rounded-xl p-2 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

function BandList({ title, rows }: { title: string; rows: DashboardData["byRecruiter"] }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.total) || 0));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900"><BarChart3 className="h-4 w-4" /> {title}</div>
      <div className="space-y-3">
        {rows.slice(0, 8).map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-700">{row.label}</span>
              <span className="font-black text-slate-950">{row.total}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-slate-900" style={{ width: `${Math.max(8, (Number(row.total) / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function NativeATSHiringDashboard() {
  const callingView = useMemo(() => window.location.pathname.includes("/calling-dashboard"), []);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [filters, setFilters] = useState({ ...initialFilters });

  const set = (key: keyof typeof initialFilters, value: string) => setFilters((prev) => ({ ...prev, [key]: value }));

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const path = callingView ? "/api/ats/recruiter/calling-dashboard" : "/api/ats/recruiter/hiring-dashboard";
      const res = await hrmsApi.get<{ success: boolean; data: DashboardData }>(`${path}?${params.toString()}`);
      setData(res.data);
    } catch (err: any) {
      setMessage(err?.message || "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metrics = data?.metrics ?? {};
  const cards = callingView
    ? [
        ["Total Records", metrics.total_records ?? 0],
        ["Contacted", metrics.total_contacted ?? 0],
        ["Contacted %", `${metrics.contacted_pct ?? 0}%`],
        ["Not Contacted", metrics.not_contacted ?? 0],
        ["Shortlisted", metrics.shortlisted ?? 0],
        ["Recruiter Rejected", metrics.recruiter_rejected ?? 0],
        ["Walk-ins", metrics.walkins ?? 0],
        ["Active Recruiters", metrics.active_recruiters ?? 0],
      ]
    : [
        ["Total records", metrics.total_records ?? 0],
        ["Total contacted", metrics.total_contacted ?? 0],
        ["Contacted %", `${metrics.contacted_pct ?? 0}%`],
        ["Not contacted", metrics.not_contacted ?? 0],
        ["Shortlisted", metrics.shortlisted ?? 0],
        ["Rejected by recruiter", metrics.recruiter_rejected ?? 0],
        ["HR selected", metrics.hr_selected ?? 0],
        ["HR rejected", metrics.hr_rejected ?? 0],
        ["AI selected", metrics.ai_selected ?? 0],
        ["AI rejected", metrics.ai_rejected ?? 0],
        ["Ops selected", metrics.ops_selected ?? 0],
        ["Ops rejected", metrics.ops_rejected ?? 0],
        ["Final selected", metrics.final_selected ?? 0],
        ["Offer letter issued", metrics.offer_letter_issued ?? 0],
        ["Joined", metrics.joined ?? 0],
        ["Joining pending", metrics.joining_pending ?? 0],
        ["Walk-ins", metrics.walkins ?? 0],
        ["Employee referrals", metrics.employee_referrals ?? 0],
        ["Active recruiters", metrics.active_recruiters ?? 0],
        ["Recruiter inactive count", metrics.recruiter_inactive_count ?? 0],
      ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-500">{callingView ? "Calling Dashboard" : "Hiring Dashboard"}</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{callingView ? "Recruiter Calling Dashboard" : "Recruiter Hiring Dashboard"}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">Same source table, different lens. Everything here is reconciled from the recruiter hiring activity table.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800"><RefreshCcw className="h-4 w-4" /> Refresh</button>
          </div>
        </div>

        {message && <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">{message}</div>}

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900"><Filter className="h-4 w-4" /> Filters</div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input type="date" value={filters.fromDate} onChange={(e) => set("fromDate", e.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input type="date" value={filters.toDate} onChange={(e) => set("toDate", e.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input value={filters.month} onChange={(e) => set("month", e.target.value)} placeholder="Month" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input value={filters.recruiter} onChange={(e) => set("recruiter", e.target.value)} placeholder="Recruiter" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input value={filters.hiringSource} onChange={(e) => set("hiringSource", e.target.value)} placeholder="Hiring source" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input value={filters.branch} onChange={(e) => set("branch", e.target.value)} placeholder="Branch" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input value={filters.process} onChange={(e) => set("process", e.target.value)} placeholder="Process" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input value={filters.search} onChange={(e) => set("search", e.target.value)} placeholder="Search" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input value={filters.recruiterRemarks} onChange={(e) => set("recruiterRemarks", e.target.value)} placeholder="Recruiter remarks" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input value={filters.hrInterviewStatus} onChange={(e) => set("hrInterviewStatus", e.target.value)} placeholder="HR status" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input value={filters.aiInterviewResult} onChange={(e) => set("aiInterviewResult", e.target.value)} placeholder="AI result" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input value={filters.opsInterviewStatus} onChange={(e) => set("opsInterviewStatus", e.target.value)} placeholder="Ops status" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
            <input value={filters.joiningStatus} onChange={(e) => set("joiningStatus", e.target.value)} placeholder="Joining status" className="h-11 rounded-xl border border-slate-200 px-3 text-sm" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <select value={filters.walkin} onChange={(e) => set("walkin", e.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm"><option value="">Walkin</option><option value="1">Yes</option><option value="0">No</option></select>
            <select value={filters.finalSelection} onChange={(e) => set("finalSelection", e.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm"><option value="">Final Selection</option><option value="1">Yes</option><option value="0">No</option></select>
            <select value={filters.joined} onChange={(e) => set("joined", e.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm"><option value="">Joined</option><option value="1">Yes</option><option value="0">No</option></select>
            <select value={filters.contacted} onChange={(e) => set("contacted", e.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm"><option value="">Contacted</option><option value="1">Yes</option><option value="0">No</option></select>
            <button onClick={load} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800"><Search className="h-4 w-4" /> Apply Filters</button>
            <button onClick={() => { setFilters({ ...initialFilters }); setTimeout(() => void load(), 0); }} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-900 hover:bg-slate-200"><CheckCircle2 className="h-4 w-4" /> Clear</button>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {cards.map(([title, value]) => (
            <StatCard key={String(title)} title={String(title)} value={value as any} tone="bg-slate-100 text-slate-900" icon={<TrendingUp className="h-4 w-4" />} />
          ))}
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <BandList title="By Recruiter" rows={data?.byRecruiter ?? []} />
          <BandList title="By Source" rows={data?.bySource ?? []} />
          <BandList title="By Process" rows={data?.byProcess ?? []} />
          <BandList title="By Branch" rows={data?.byBranch ?? []} />
        </div>

        {loading && <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading dashboard data...</div>}
      </div>
    </DashboardLayout>
  );
}
