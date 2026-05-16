import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Filter, TrendingUp } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";

const today = new Date();
const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const todayStr = today.toISOString().slice(0, 10);

type Domain = "employee" | "branch" | "process" | "recruiter" | "quality" | "operations";

export default function UnifiedPerformanceCommandCenter() {
  const [domain, setDomain] = useState<Domain>("employee");
  const [fromDate, setFromDate] = useState(startOfMonth);
  const [toDate, setToDate] = useState(todayStr);
  const [periodType, setPeriodType] = useState("DAILY");

  const tableName = useMemo(() => {
    switch (domain) {
      case "branch": return "branch_performance_snapshot";
      case "process": return "process_performance_snapshot";
      case "recruiter": return "recruiter_performance_snapshot";
      case "quality": return "quality_score_log";
      case "operations": return "operations_productivity_log";
      default: return "employee_performance_snapshot";
    }
  }, [domain]);

  const { data = [], isLoading } = useQuery({
    queryKey: ["unified-performance-command-center", domain, fromDate, toDate, periodType],
    queryFn: async () => {
      let query = supabase.from(tableName as any).select("*");
      if (["quality"].includes(domain)) query = query.gte("audit_date", fromDate).lte("audit_date", toDate);
      else if (["operations"].includes(domain)) query = query.gte("work_date", fromDate).lte("work_date", toDate);
      else query = query.gte("metric_date", fromDate).lte("metric_date", toDate).eq("period_type", periodType);
      const { data, error } = await query.limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const summary = useMemo(() => {
    const rows: any[] = data as any[];
    const avg = (key: string) => {
      const values = rows.map((r) => Number(r[key] ?? 0)).filter((v) => !Number.isNaN(v));
      return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
    };
    return {
      rows: rows.length,
      finalScore: avg("final_score"),
      quality: avg("quality_score") || avg("qa_score"),
      productivity: avg("productivity_score") || avg("productivity_percent"),
      attendance: avg("attendance_score"),
    };
  }, [data]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl border bg-gradient-to-br from-slate-950 to-slate-800 p-6 text-white">
          <p className="text-sm text-slate-300">Performance Intelligence</p>
          <h1 className="mt-2 text-3xl font-bold">Unified Performance Command Center</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-300">All trends support date range, month, period type and performance domain filters across HRMS, ATS, LMS, WFM, Quality and Operations.</p>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-slate-900"><Filter className="h-4 w-4" /><span className="font-semibold">Filters</span></div>
          <div className="grid gap-3 md:grid-cols-4">
            <select value={domain} onChange={(e) => setDomain(e.target.value as Domain)} className="rounded-xl border px-4 py-3">
              <option value="employee">Employee / Analyst</option>
              <option value="branch">Branch</option>
              <option value="process">Process</option>
              <option value="recruiter">Recruiter</option>
              <option value="quality">Quality</option>
              <option value="operations">Operations</option>
            </select>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-xl border px-4 py-3" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-xl border px-4 py-3" />
            <select value={periodType} onChange={(e) => setPeriodType(e.target.value)} className="rounded-xl border px-4 py-3" disabled={domain === "quality" || domain === "operations"}>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {[{ label: "Rows", value: summary.rows }, { label: "Final Score", value: `${summary.finalScore}%` }, { label: "Quality", value: `${summary.quality}%` }, { label: "Productivity", value: `${summary.productivity}%` }].map((card) => (
            <div key={card.label} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between"><p className="text-sm text-slate-500">{card.label}</p><TrendingUp className="h-4 w-4 text-slate-400" /></div>
              <p className="mt-3 text-3xl font-bold text-slate-950">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2"><BarChart3 className="h-4 w-4" /><h2 className="font-semibold">Trend Data Preview</h2></div>
          {isLoading ? <p className="text-sm text-slate-500">Loading...</p> : data.length === 0 ? <p className="text-sm text-slate-500">No performance data found for the selected filters.</p> : (
            <div className="max-h-[420px] overflow-auto rounded-xl border"><pre className="p-4 text-xs">{JSON.stringify(data.slice(0, 20), null, 2)}</pre></div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
