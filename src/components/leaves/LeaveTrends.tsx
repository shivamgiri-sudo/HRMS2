import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useLeaveBalances } from "@/hooks/useLeaveBalances";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TrendingUp, Loader2 } from "lucide-react";
import { parseISO, getMonth, getYear } from "date-fns";
import { normalizeDate } from "@/lib/utils";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const TYPE_COLORS: Record<string, string> = {
  CL: "#1B6AB5",
  EL: "#3BAD49",
  ML: "#f59e0b",
  PTRL: "#8b5cf6",
  MTRL: "#ec4899",
};
const DEFAULT_COLOR = "#94a3b8";

interface LeaveTrendsProps {
  employeeId: string | undefined;
}

export function LeaveTrends({ employeeId }: LeaveTrendsProps) {
  const currentYear = new Date().getFullYear();

  const { data: balances, isLoading: isLoadingBalances } = useLeaveBalances(employeeId);

  const { data: requests, isLoading: isLoadingRequests } = useQuery({
    queryKey: ["leave-requests-history", employeeId, currentYear],
    queryFn: async () => {
      if (!employeeId) return [];
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/leave/requests?employeeId=${employeeId}&limit=200`
      );
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });

  // Monthly breakdown: days taken per month this year (approved only)
  const monthlyData = useMemo(() => {
    if (!requests) return [];
    const byMonth: number[] = Array(12).fill(0);
    for (const r of requests) {
      if (r.status !== "approved") continue;
      const dateStr = r.from_date ?? r.start_date;
      if (!dateStr) continue;
      try {
        const d = parseISO(normalizeDate(dateStr));
        if (getYear(d) !== currentYear) continue;
        byMonth[getMonth(d)] += Number(r.total_days ?? r.days_count ?? 0);
      } catch { /* skip */ }
    }
    return MONTH_SHORT.map((month, i) => ({ month, days: byMonth[i] }));
  }, [requests, currentYear]);

  // By type: days taken per leave type this year (approved only)
  const byTypeData = useMemo(() => {
    if (!requests) return [];
    const counts: Record<string, number> = {};
    for (const r of requests) {
      if (r.status !== "approved") continue;
      const dateStr = r.from_date ?? r.start_date;
      if (!dateStr) continue;
      try {
        const d = parseISO(normalizeDate(dateStr));
        if (getYear(d) !== currentYear) continue;
        const typeName = r.leave_type_name ?? r.type ?? "Other";
        counts[typeName] = (counts[typeName] ?? 0) + Number(r.total_days ?? r.days_count ?? 0);
      } catch { /* skip */ }
    }
    return Object.entries(counts)
      .map(([type, days]) => ({ type, days }))
      .sort((a, b) => b.days - a.days);
  }, [requests, currentYear]);

  const isLoading = isLoadingBalances || isLoadingRequests;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalUsed = balances?.reduce((sum, b) => sum + b.used_days, 0) ?? 0;
  const totalAllocated = balances?.reduce((sum, b) => sum + b.allocated_days, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Summary stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {balances?.map((b) => (
          <div key={b.id} className="rounded-xl border bg-white p-3 text-center shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{b.leave_code}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">
              {b.available_days.toFixed(1)}
              <span className="text-xs font-normal text-slate-400">/{b.allocated_days.toFixed(0)}</span>
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {b.used_days.toFixed(1)} used
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Monthly usage chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Monthly Leave Usage ({currentYear})</CardTitle>
            <CardDescription className="text-xs">Approved leave days taken per month</CardDescription>
          </CardHeader>
          <CardContent>
            {monthlyData.every((m) => m.days === 0) ? (
              <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
                No approved leaves recorded for {currentYear}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthlyData} barSize={12} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    formatter={(v: number) => [`${v} day${v !== 1 ? "s" : ""}`, "Used"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  />
                  <Bar dataKey="days" fill="#1B6AB5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* By leave type chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Leave by Type ({currentYear})</CardTitle>
            <CardDescription className="text-xs">Approved days taken per leave type</CardDescription>
          </CardHeader>
          <CardContent>
            {byTypeData.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
                No approved leaves recorded for {currentYear}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={byTypeData}
                  layout="vertical"
                  barSize={14}
                  margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis dataKey="type" type="category" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                  <Tooltip
                    formatter={(v: number) => [`${v} day${v !== 1 ? "s" : ""}`, "Used"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  />
                  <Bar dataKey="days" radius={[0, 4, 4, 0]}>
                    {byTypeData.map((entry) => {
                      const code = entry.type.split(" ")[0]?.toUpperCase();
                      return (
                        <Cell
                          key={entry.type}
                          fill={TYPE_COLORS[code] ?? DEFAULT_COLOR}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Utilisation summary */}
      {totalAllocated > 0 && (
        <div className="rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-600 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-slate-400 shrink-0" />
          You have used <span className="font-semibold text-slate-900 mx-1">{totalUsed.toFixed(1)}</span> of{" "}
          <span className="font-semibold text-slate-900 mx-1">{totalAllocated.toFixed(1)}</span> allocated days
          {" "}({((totalUsed / totalAllocated) * 100).toFixed(0)}% utilisation) in {currentYear}.
        </div>
      )}
    </div>
  );
}
