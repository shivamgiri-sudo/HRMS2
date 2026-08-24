import { CalendarDays, Loader2, TrendingUp, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { useLeaveBalances } from "@/hooks/useLeaveBalances";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface EnhancedLeaveBalanceCardProps {
  employeeId: string;
}

function DonutChart({ used, total, color }: { used: number; total: number; color: string }) {
  const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const remaining = 100 - percentage;
  const strokeWidth = 8;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const usedStroke = (percentage / 100) * circumference;
  const remainingStroke = (remaining / 100) * circumference;

  return (
    <div className="relative w-24 h-24">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
        {/* Background circle */}
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-slate-100"
        />
        {/* Used portion */}
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${usedStroke} ${circumference}`}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-black text-slate-900">{(total - used).toFixed(1)}</span>
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Left</span>
      </div>
    </div>
  );
}

function LeaveTypeCard({
  name,
  code,
  used,
  available,
  total,
  isPaid,
  color
}: {
  name: string;
  code: string;
  used: number;
  available: number;
  total: number;
  isPaid: boolean;
  color: string;
}) {
  return (
    <div className={cn(
      "group relative rounded-2xl border p-5 bg-white/60 backdrop-blur-sm transition-all duration-300",
      "hover:shadow-xl hover:scale-[1.02] hover:-translate-y-1"
    )} style={{ borderColor: `${color}30` }}>
      {/* Glow effect on hover */}
      <div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity blur-xl -z-10"
        style={{ backgroundColor: `${color}15` }}
      />

      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-black text-slate-900">{name}</span>
            {isPaid && (
              <Badge variant="outline" className="text-[9px] font-bold bg-emerald-50 text-emerald-700 border-emerald-200">
                Paid
              </Badge>
            )}
          </div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{code}</span>
        </div>
        <DonutChart used={used} total={total} color={color} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 font-medium">Used</span>
          <span className="font-bold text-slate-700">{used.toFixed(1)} days</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 font-medium">Available</span>
          <span className="font-black" style={{ color }}>{available.toFixed(1)} days</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min((used / total) * 100, 100)}%`,
              backgroundColor: color
            }}
          />
        </div>
        <p className="text-[10px] text-slate-400 font-medium">
          Annual entitlement: {total} days
        </p>
      </div>
    </div>
  );
}

export function EnhancedLeaveBalanceCard({ employeeId }: EnhancedLeaveBalanceCardProps) {
  const { data: balances, isLoading } = useLeaveBalances(employeeId);
  const currentYear = new Date().getFullYear();
  const displayYear = balances && balances.length > 0 ? balances[0].year : currentYear;

  // Color palette for different leave types
  const colors: Record<string, string> = {
    CL: "#3B82F6", // Blue - Casual Leave
    ML: "#8B5CF6", // Purple - Medical Leave
    EL: "#10B981", // Green - Earned Leave
    LWP: "#F59E0B", // Amber - Leave Without Pay
    default: "#64748B", // Slate
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 animate-pulse" />
            <Loader2 className="absolute inset-0 m-auto h-6 w-6 text-white animate-spin" />
          </div>
          <p className="text-sm font-semibold text-slate-500">Loading leave balances...</p>
        </div>
      </div>
    );
  }

  // Calculate summary stats
  const totalAvailable = balances?.reduce((sum, b) => sum + b.available_days, 0) || 0;
  const totalUsed = balances?.reduce((sum, b) => sum + b.used_days, 0) || 0;
  const totalEntitled = balances?.reduce((sum, b) => {
    const entitlement = b.annual_entitlement ?? (b.leave_code === "CL" ? 7 : b.leave_code === "ML" ? 5 : b.allocated_days);
    return sum + entitlement;
  }, 0) || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/25">
            <CalendarDays className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900">Leave Balance</h3>
            <p className="text-xs text-slate-500">Available days for {displayYear}</p>
          </div>
        </div>
        <Badge variant="outline" className="text-xs font-bold bg-slate-50 text-slate-600 border-slate-200">
          FY {displayYear}
        </Badge>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200/50 p-4 text-center">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 mx-auto mb-2" />
          <p className="text-2xl font-black text-emerald-700">{totalAvailable.toFixed(1)}</p>
          <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide">Available</p>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200/50 p-4 text-center">
          <Clock className="h-5 w-5 text-amber-600 mx-auto mb-2" />
          <p className="text-2xl font-black text-amber-700">{totalUsed.toFixed(1)}</p>
          <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">Used</p>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-slate-200/50 p-4 text-center">
          <TrendingUp className="h-5 w-5 text-slate-600 mx-auto mb-2" />
          <p className="text-2xl font-black text-slate-700">{totalEntitled.toFixed(0)}</p>
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Annual Total</p>
        </div>
      </div>

      {/* Leave Type Cards */}
      {balances && balances.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {balances.map((balance) => {
            const entitlement = balance.annual_entitlement ??
              (balance.leave_code === "CL" ? 7 : balance.leave_code === "ML" ? 5 : balance.allocated_days);
            const color = colors[balance.leave_code || ""] || colors.default;

            return (
              <LeaveTypeCard
                key={balance.id}
                name={balance.leave_type?.name || "Leave"}
                code={balance.leave_code || "—"}
                used={balance.used_days}
                available={balance.available_days}
                total={entitlement}
                isPaid={balance.leave_type?.is_paid ?? false}
                color={color}
              />
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center">
          <AlertCircle className="h-8 w-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">No leave balances found</p>
          <p className="text-xs text-slate-500 mt-1">Contact HR if you believe this is an error</p>
        </div>
      )}
    </div>
  );
}
