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

/**
 * One tone per leave type, shared by the balance rings and both charts below — so
 * "Casual Leave" is the same blue everywhere on this tab instead of three
 * independently-guessed color sets. Keyed by the short code (what `useLeaveBalances`
 * returns as `leave_code`); `resolveTone` below matches the full type name the
 * charts carry (e.g. "Casual Leave") back to the same key.
 */
const LEAVE_TONE: Record<string, { grad: string; border: string; hex: string; text: string }> = {
  CL:   { grad: "from-blue-50 to-indigo-50",   border: "border-blue-200",   hex: "#3b82f6", text: "text-blue-700" },
  EL:   { grad: "from-emerald-50 to-green-50", border: "border-emerald-200", hex: "#10b981", text: "text-emerald-700" },
  ML:   { grad: "from-purple-50 to-violet-50", border: "border-purple-200", hex: "#a855f7", text: "text-purple-700" },
  LWP:  { grad: "from-amber-50 to-orange-50",  border: "border-amber-200", hex: "#f59e0b", text: "text-amber-700" },
  MTRL: { grad: "from-cyan-50 to-teal-50",     border: "border-cyan-200",  hex: "#06b6d4", text: "text-cyan-700" },
  PTRL: { grad: "from-pink-50 to-rose-50",     border: "border-pink-200",  hex: "#ec4899", text: "text-pink-700" },
};
const DEFAULT_TONE = { grad: "from-slate-50 to-slate-100", border: "border-slate-200", hex: "#94a3b8", text: "text-slate-600" };

/** Matches a leave code directly (CL, EL, ...) or a full name (Casual Leave, Sick Leave) to a tone. */
function resolveTone(codeOrName: string) {
  const key = codeOrName.trim().toUpperCase();
  if (LEAVE_TONE[key]) return LEAVE_TONE[key];
  const name = codeOrName.toLowerCase();
  if (name.includes("casual")) return LEAVE_TONE.CL;
  if (name.includes("earned") || name.includes("annual")) return LEAVE_TONE.EL;
  if (name.includes("medical") || name.includes("sick")) return LEAVE_TONE.ML;
  if (name.includes("without pay") || name.includes("lwp")) return LEAVE_TONE.LWP;
  if (name.includes("maternity")) return LEAVE_TONE.MTRL;
  if (name.includes("paternity")) return LEAVE_TONE.PTRL;
  return DEFAULT_TONE;
}

interface LeaveTrendsProps {
  employeeId: string | undefined;
}

/**
 * 56px / 5px-stroke progress ring per the frozen leave-balance-card spec: the arc fills
 * by available/allocated proportion (how much is left to use), color keyed to the same
 * per-type tone as the chart bars, with the available-days figure centered.
 */
function LeaveBalanceRing({ available, allocated, hex }: { available: number; allocated: number; hex: string }) {
  const size = 56;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = allocated > 0 ? Math.max(0, Math.min(1, available / allocated)) : 0;
  const offset = circumference * (1 - pct);

  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-slate-200/70" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={hex}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[13px] font-bold leading-none text-slate-900">{available.toFixed(1)}</span>
      </div>
    </div>
  );
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
      {/* Summary stats row — one progress ring per leave type, toned by resolveTone() */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {balances?.map((b) => {
          const tone = resolveTone(b.leave_code);
          return (
            <div
              key={b.id}
              className={`flex items-center gap-3 rounded-xl border bg-gradient-to-br p-3 shadow-sm transition-shadow hover:shadow-md ${tone.grad} ${tone.border}`}
            >
              <LeaveBalanceRing available={b.available_days} allocated={b.allocated_days} hex={tone.hex} />
              <div className="min-w-0">
                <p className={`text-[10px] font-bold uppercase tracking-widest ${tone.text}`}>{b.leave_code}</p>
                <p className="text-xs text-slate-500">
                  of <span className="font-semibold text-slate-700">{b.allocated_days.toFixed(0)}</span> allotted
                </p>
                <p className="text-[10px] text-slate-400">{b.used_days.toFixed(1)} used</p>
              </div>
            </div>
          );
        })}
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
                  <defs>
                    <linearGradient id="leaveMonthlyFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1B6AB5" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#1B6AB5" stopOpacity={0.55} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "#f1f5f9" }}
                    formatter={(v: number) => [`${v} day${v !== 1 ? "s" : ""}`, "Used"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  />
                  <Bar dataKey="days" fill="url(#leaveMonthlyFill)" radius={[4, 4, 0, 0]} />
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
              <>
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
                      cursor={{ fill: "#f1f5f9" }}
                      formatter={(v: number) => [`${v} day${v !== 1 ? "s" : ""}`, "Used"]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                    />
                    <Bar dataKey="days" radius={[0, 4, 4, 0]}>
                      {byTypeData.map((entry) => (
                        <Cell key={entry.type} fill={resolveTone(entry.type).hex} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2">
                  {byTypeData.map((entry) => (
                    <span key={entry.type} className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: resolveTone(entry.type).hex }} />
                      {entry.type}
                    </span>
                  ))}
                </div>
              </>
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
