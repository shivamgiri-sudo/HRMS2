import { useState, useEffect } from "react";
import { ReportingManagerChangeDialog } from "@/components/profile/ReportingManagerChangeDialog";
import { ChangePasswordDialog } from "@/components/profile/ChangePasswordDialog";
import { useMyRMChangeRequests } from "@/hooks/useReportingManagerChange";
import { hrmsApi } from "@/lib/hrmsApi";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, User, Mail, Phone, MapPin, Building2, Calendar,
  Briefcase, Save, Clock, Wallet, Files, Package, Star,
  Users, Cake, Edit3, X, GitBranch, Landmark, CheckCircle2,
  HeartHandshake, ShieldCheck, TrendingUp, AlertCircle, FileText, Key
} from "lucide-react";
import { PhotoUpload } from "@/components/employee/PhotoUpload";
import { useToast } from "@/hooks/use-toast";
import { useAuth, useIsReadOnly } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { useLeaveBalances } from "@/hooks/useLeaveBalances";
import { AttendanceCalendar, adrRecordsToAttendanceDays } from "@/components/attendance/AttendanceCalendar";
import { useAttendanceDailyRecords } from "@/hooks/useAttendanceHub";
import { EmployeeJourneyTimeline } from "@/components/employees/EmployeeJourneyTimeline";
import { BankStatutoryDetails, EmergencyNomineeDetails } from "@/components/profile/ProfileSensitiveDetails";
import { EmployeeDocuments } from "@/components/documents/EmployeeDocuments";
import { SessionsSecurityPanel } from "@/components/profile/SessionsSecurityPanel";
import { PayslipViewer } from "@/components/profile/PayslipViewer";
import { TaxDocumentsViewer } from "@/components/profile/TaxDocumentsViewer";
import { MyAssets } from "@/components/profile/MyAssets";
import { MyPerformanceReviews } from "@/components/profile/MyPerformanceReviews";
import { LeaveRequestForm } from "@/components/profile/LeaveRequestForm";
import { cn } from "@/lib/utils";

interface ProfileForm {
  mobile: string; personal_email: string; personal_phone: string; alternate_mobile: string;
  address_line1: string; city: string; date_of_birth: string; gender: string;
  marital_status: string; blood_group: string; working_hours_start: string;
  working_hours_end: string; working_days: number[];
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
const formatTime = (t: string | null) => { if (!t) return "—"; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

// ═══════════════════════════════════════════════════════════════════════════════
// DESIGN SYSTEM COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function Donut({ v, max, color, size = 56 }: { v: number; max: number; color: string; size?: number }) {
  const pct = max > 0 ? (v / max) * 100 : 0;
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} className="transition-all duration-700 drop-shadow-sm" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-black text-gray-800">{(max - v).toFixed(0)}</span>
      </div>
    </div>
  );
}

function GlassCard({ children, className, gradient }: { children: React.ReactNode; className?: string; gradient?: string }) {
  return (
    <div className={cn(
      "rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm transition-all duration-200 hover:shadow-md",
      gradient && `bg-gradient-to-br ${gradient}`,
      className
    )}>
      {children}
    </div>
  );
}

function InfoField({ icon: Icon, label, value, color = "#6366F1" }: { icon: React.ElementType; label: string; value: string | null | undefined; color?: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white/80 border border-gray-100 hover:border-gray-200 transition-all">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shadow-sm" style={{ backgroundColor: `${color}20` }}>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{label}</p>
        <p className="text-sm font-bold text-gray-900 truncate">{value || "—"}</p>
      </div>
    </div>
  );
}

function FormField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-[11px] font-bold text-gray-700 uppercase tracking-wide mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPLY LEAVE FORM - Premium Styled
// ═══════════════════════════════════════════════════════════════════════════════

function ApplyLeaveForm({ employeeId, balances }: { employeeId: string; balances: any[] | undefined }) {
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const leaveColors: Record<string, { color: string; bg: string }> = {
    CL: { color: "#3B82F6", bg: "bg-blue-50 border-blue-200 hover:border-blue-400" },
    ML: { color: "#8B5CF6", bg: "bg-purple-50 border-purple-200 hover:border-purple-400" },
    EL: { color: "#10B981", bg: "bg-emerald-50 border-emerald-200 hover:border-emerald-400" },
    LWP: { color: "#F59E0B", bg: "bg-amber-50 border-amber-200 hover:border-amber-400" },
    PL: { color: "#EC4899", bg: "bg-pink-50 border-pink-200 hover:border-pink-400" },
    MTL: { color: "#06B6D4", bg: "bg-cyan-50 border-cyan-200 hover:border-cyan-400" },
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await hrmsApi.post("/api/leave/requests", {
        employee_id: employeeId,
        leave_type_code: leaveType,
        from_date: startDate,
        to_date: endDate,
        reason,
      });
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances", employeeId] });
      toast({ title: "Leave request submitted!", description: "Awaiting manager approval." });
      setLeaveType(""); setStartDate(""); setEndDate(""); setReason("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const selectedBalance = balances?.find(b => b.leave_code === leaveType);
  const canSubmit = leaveType && startDate && endDate && reason.length >= 10;

  return (
    <GlassCard className="h-fit sticky top-4 overflow-visible">
      {/* Gradient Header */}
      <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-5 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white, transparent 50%)' }} />
        <div className="relative">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Calendar className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Request Leave</h3>
              <p className="text-sm text-white/80">Submit for approval</p>
            </div>
          </div>
          {selectedBalance && (
            <div className="mt-3 p-3 rounded-xl bg-white/10 backdrop-blur-sm">
              <p className="text-xs text-white/70">Available Balance</p>
              <p className="text-2xl font-black">{(selectedBalance.allocated_days - selectedBalance.used_days).toFixed(1)} <span className="text-sm font-normal text-white/70">days</span></p>
            </div>
          )}
        </div>
      </div>

      {/* Form Body */}
      <div className="p-5 space-y-5">
        {/* Leave Type Selection - Compact Inline */}
        <div>
          <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Select Leave Type</label>
          <div className="space-y-1.5">
            {balances?.filter(b => (b.allocated_days - b.used_days) > 0 || b.leave_code === "LWP").slice(0, 6).map(b => {
              const colors = leaveColors[b.leave_code] || { color: "#6B7280", bg: "bg-gray-50 border-gray-200" };
              const remaining = b.allocated_days - b.used_days;
              const isSelected = leaveType === b.leave_code;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setLeaveType(b.leave_code)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all duration-200",
                    isSelected ? "shadow-md" : "hover:bg-gray-50",
                    colors.bg
                  )}
                  style={{ borderColor: isSelected ? colors.color : undefined }}
                >
                  <span className="text-sm font-semibold text-gray-800">{b.leave_type?.name || b.leave_code}</span>
                  <span className="text-sm font-black" style={{ color: colors.color }}>{remaining.toFixed(1)} <span className="text-xs font-normal text-gray-500">days</span></span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Date Range - Stacked to prevent overflow */}
        <div>
          <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Date Range</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 font-medium mb-1 block">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border-2 border-gray-200 focus:border-indigo-500 outline-none text-sm font-medium transition-all bg-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 font-medium mb-1 block">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                className="w-full h-10 px-3 rounded-lg border-2 border-gray-200 focus:border-indigo-500 outline-none text-sm font-medium transition-all bg-white"
              />
            </div>
          </div>
        </div>

        {/* Reason */}
        <div>
          <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe why you need this leave..."
            rows={3}
            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm resize-none transition-all placeholder:text-gray-400"
          />
          <p className={cn("text-[10px] mt-1", reason.length >= 10 ? "text-emerald-600" : "text-gray-400")}>
            {reason.length}/10 characters minimum
          </p>
        </div>

        {/* Submit Button */}
        <button
          type="button"
          onClick={() => submitMutation.mutate()}
          disabled={!canSubmit || submitMutation.isPending}
          className={cn(
            "w-full py-4 rounded-xl font-bold text-sm transition-all duration-300",
            canSubmit
              ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          )}
        >
          {submitMutation.isPending ? (
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          ) : (
            <>Submit Request</>
          )}
        </button>

        {/* Info Note */}
        <div className="rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 p-4">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-800">Important</p>
              <p className="text-[11px] text-amber-700 mt-0.5">Requests need manager approval. Apply early for planned leaves.</p>
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEAVES TAB - Polished
// ═══════════════════════════════════════════════════════════════════════════════

function LeavesTab({ employeeId }: { employeeId: string }) {
  const { data: balances, isLoading } = useLeaveBalances(employeeId);
  const { data: requests } = useQuery({
    queryKey: ["leave-requests", employeeId],
    queryFn: async () => { const res = await hrmsApi.get<{success:boolean;data:any}>(`/api/leave/requests?employeeId=${employeeId}`); return (res.data ?? []) as any[]; },
    enabled: !!employeeId,
  });

  const leaveColors: Record<string, string> = { CL: "#3B82F6", ML: "#8B5CF6", EL: "#10B981", LWP: "#F59E0B", PL: "#EC4899", MTL: "#06B6D4" };
  const statusBg: Record<string, string> = { pending: "bg-amber-100 text-amber-700", pending_branch_head: "bg-orange-100 text-orange-700", approved: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700", cancelled: "bg-gray-100 text-gray-500" };
  const pendingReqs = requests?.filter(r => r.status === "pending" || r.status === "pending_branch_head") || [];

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {/* Leave Balances - Premium Cards */}
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <Calendar className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Leave Balance</h3>
                <p className="text-[10px] text-gray-500">FY {new Date().getFullYear()}</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {balances?.map(b => {
              const total = b.annual_entitlement ?? (b.leave_code === "CL" ? 7 : b.leave_code === "ML" ? 5 : b.allocated_days);
              const color = leaveColors[b.leave_code || ""] || "#6B7280";
              const remaining = total - b.used_days;
              const bgColors: Record<string, string> = {
                CL: "from-blue-50 to-indigo-50 border-blue-200",
                ML: "from-purple-50 to-violet-50 border-purple-200",
                EL: "from-emerald-50 to-green-50 border-emerald-200",
                LWP: "from-amber-50 to-orange-50 border-amber-200",
                PL: "from-pink-50 to-rose-50 border-pink-200",
                MTRL: "from-cyan-50 to-teal-50 border-cyan-200",
                PTRL: "from-indigo-50 to-blue-50 border-indigo-200",
              };
              const bgClass = bgColors[b.leave_code || ""] || "from-gray-50 to-slate-50 border-gray-200";
              return (
                <div key={b.id} className={cn("group relative p-4 rounded-xl border bg-gradient-to-br hover:shadow-lg transition-all duration-200", bgClass)}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-800 truncate">{b.leave_type?.name || b.leave_code}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{b.leave_code}</p>
                      <div className="mt-2">
                        <p className="text-2xl font-black" style={{ color }}>{remaining.toFixed(1)}</p>
                        <p className="text-[10px] text-gray-600">of {total} days left</p>
                      </div>
                    </div>
                    <Donut v={b.used_days} max={total} color={color} />
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-white/60 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(b.used_days / total) * 100}%`, backgroundColor: color }} />
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">{b.used_days.toFixed(1)} used</p>
                </div>
              );
            })}
            {(!balances || balances.length === 0) && (
              <div className="col-span-full text-center py-8 text-gray-400">
                <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No leave balances</p>
              </div>
            )}
          </div>
        </GlassCard>

        {/* Pending Requests */}
        {pendingReqs.length > 0 && (
          <GlassCard className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                <AlertCircle className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Pending Approval</h3>
                <p className="text-[10px] text-gray-500">{pendingReqs.length} request(s) awaiting</p>
              </div>
            </div>
            <div className="space-y-2">
              {pendingReqs.map(r => (
                <div key={r.id} className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-100">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{r.leave_type_name || r.leave_type_code}</p>
                    <p className="text-[11px] text-gray-500">{formatDate(r.from_date)} — {formatDate(r.to_date)} • {r.total_days} days</p>
                  </div>
                  <Badge className={cn("text-[10px] font-semibold", statusBg[r.status] || statusBg.pending)}>
                    {r.status === "pending_branch_head" ? "Awaiting BH" : "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
          </GlassCard>
        )}

        {/* Request History - Premium Table */}
        <GlassCard className="overflow-hidden">
          <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50/80 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <FileText className="h-4 w-4 text-slate-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Leave History</h3>
                <p className="text-[10px] text-gray-500">Recent requests</p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-4 py-3">Type</th>
                  <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-4 py-3">From</th>
                  <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-4 py-3">To</th>
                  <th className="text-center text-[10px] font-bold text-gray-500 uppercase tracking-wide px-4 py-3">Days</th>
                  <th className="text-right text-[10px] font-bold text-gray-500 uppercase tracking-wide px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests?.slice(0, 8).map((r, i) => (
                  <tr key={r.id} className={cn("border-b border-gray-50 hover:bg-gray-50/50 transition-colors", i % 2 === 0 && "bg-gray-50/30")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: leaveColors[r.leave_type_code || ""] || "#6B7280" }} />
                        <span className="text-sm font-medium text-gray-800">{r.leave_type_name || r.leave_type_code || "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(r.from_date)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(r.to_date)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 text-sm font-bold text-gray-700">{r.total_days}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge className={cn("text-[10px] font-semibold", statusBg[r.status] || "bg-gray-100 text-gray-500")}>{r.status}</Badge>
                    </td>
                  </tr>
                ))}
                {(!requests || requests.length === 0) && (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">No leave history</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>

      {/* Apply Leave - Premium Styled Form */}
      <ApplyLeaveForm employeeId={employeeId} balances={balances || []} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTENDANCE TAB - Polished
// ═══════════════════════════════════════════════════════════════════════════════

function AttendanceTab({ employeeId }: { employeeId: string }) {
  const [attMonth, setAttMonth] = useState(() => ({ m: new Date().getMonth(), y: new Date().getFullYear() }));
  const attFrom = `${attMonth.y}-${String(attMonth.m + 1).padStart(2, "0")}-01`;
  const attTo = `${attMonth.y}-${String(attMonth.m + 1).padStart(2, "0")}-${String(new Date(attMonth.y, attMonth.m + 1, 0).getDate()).padStart(2, "0")}`;
  const { data: attRows = [], isLoading } = useAttendanceDailyRecords(employeeId, attFrom, attTo);

  const present = attRows.filter(r => r.final_status === "P" || r.final_status === "present").length;
  const absent = attRows.filter(r => r.final_status === "A" || r.final_status === "absent").length;
  const halfDay = attRows.filter(r => r.final_status === "H" || r.final_status === "half_day").length;
  const leave = attRows.filter(r => r.final_status === "L" || r.final_status === "leave").length;
  const workingDays = attRows.length;
  const attendanceRate = workingDays > 0 ? ((present + halfDay * 0.5) / workingDays * 100).toFixed(1) : "0.0";

  const stats = [
    { label: "Present", value: present, color: "#10B981", bg: "from-emerald-50 to-green-50 border-emerald-200", icon: CheckCircle2 },
    { label: "Absent", value: absent, color: "#EF4444", bg: "from-red-50 to-rose-50 border-red-200", icon: X },
    { label: "Half Day", value: halfDay, color: "#F59E0B", bg: "from-amber-50 to-orange-50 border-amber-200", icon: Clock },
    { label: "On Leave", value: leave, color: "#8B5CF6", bg: "from-purple-50 to-violet-50 border-purple-200", icon: Calendar },
  ];

  const monthName = new Date(attMonth.y, attMonth.m).toLocaleString("en-IN", { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      {/* Header with Summary */}
      <GlassCard className="overflow-hidden">
        <div className="bg-gradient-to-r from-teal-600 via-cyan-600 to-teal-700 p-5 text-white relative">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, white, transparent 60%)' }} />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Clock className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Attendance Summary</h3>
                <p className="text-sm text-white/80">{monthName}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black">{attendanceRate}%</p>
              <p className="text-xs text-white/70">Attendance Rate</p>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className={cn("rounded-xl border bg-gradient-to-br p-4 transition-all hover:shadow-md", s.bg)}>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shadow-sm" style={{ backgroundColor: `${s.color}20` }}>
                <s.icon className="h-5 w-5" style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-2xl font-black text-gray-900">{s.value}</p>
                <p className="text-xs font-bold text-gray-600 uppercase">{s.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Calendar */}
      <GlassCard className="overflow-hidden">
        <div className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-100 px-5 py-3">
          <p className="text-sm font-bold text-gray-800">Monthly Calendar</p>
          <p className="text-xs text-gray-500">Click on a date to view details</p>
        </div>
        <div className="p-5">
          <AttendanceCalendar
            employeeId={employeeId}
            month={attMonth.m}
            year={attMonth.y}
            onMonthChange={(m, y) => setAttMonth({ m, y })}
            records={adrRecordsToAttendanceDays(attRows)}
            recordsLoading={isLoading}
            sourceLabel="HRMS Record"
          />
        </div>
      </GlassCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE TAB - Polished
// ═══════════════════════════════════════════════════════════════════════════════

function ProfileTab({ employee, formData, setFormData, isEditing, setIsEditing, isReadOnly, updateMutation, cancelEdit }: any) {
  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      {/* Info Cards */}
      <div className="space-y-3">
        <GlassCard className="p-4">
          <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Mail className="h-3 w-3" /> Contact
          </p>
          <div className="space-y-2">
            <InfoField icon={Mail} label="Email" value={employee.official_email || employee.email} color="#6366F1" />
            <InfoField icon={Phone} label="Phone" value={employee.mobile} color="#10B981" />
            <InfoField icon={Phone} label="Alternate" value={employee.alternate_mobile} color="#F59E0B" />
            <InfoField icon={MapPin} label="City" value={employee.city} color="#EF4444" />
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Briefcase className="h-3 w-3" /> Work
          </p>
          <div className="space-y-2">
            <InfoField icon={Briefcase} label="Designation" value={employee.designation} color="#10B981" />
            <InfoField icon={Building2} label="Department" value={employee.department?.name} color="#3B82F6" />
            <InfoField icon={Users} label="Manager" value={employee.reporting_manager_name} color="#8B5CF6" />
            <InfoField icon={Calendar} label="Joined" value={formatDate(employee.date_of_joining)} color="#F59E0B" />
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[10px] font-bold text-purple-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <User className="h-3 w-3" /> Personal
          </p>
          <div className="space-y-2">
            <InfoField icon={Cake} label="Birthday" value={formatDate(employee.date_of_birth)} color="#EC4899" />
            <InfoField icon={User} label="Gender" value={employee.gender} color="#6366F1" />
            <InfoField icon={HeartHandshake} label="Marital" value={employee.marital_status} color="#EF4444" />
            <InfoField icon={User} label="Blood Group" value={employee.blood_group} color="#DC2626" />
          </div>
        </GlassCard>
      </div>

      {/* Editable Form */}
      <GlassCard className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50/50 to-transparent">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Personal Information</h3>
            <p className="text-[10px] text-gray-500">Update your contact & schedule</p>
          </div>
          {!isEditing ? (
            <Button size="sm" variant="outline" onClick={() => setIsEditing(true)} disabled={isReadOnly} className="h-8 text-xs rounded-lg">
              <Edit3 className="h-3.5 w-3.5 mr-1.5" />{isReadOnly ? "Read-Only" : "Edit"}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-8 text-xs rounded-lg"><X className="h-3.5 w-3.5 mr-1" />Cancel</Button>
              <Button size="sm" onClick={() => updateMutation.mutate(formData)} disabled={updateMutation.isPending}
                className="h-8 text-xs rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/25">
                {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}Save
              </Button>
            </div>
          )}
        </div>
        <div className="p-5 space-y-4">
          {/* Identity Section */}
          <div className="rounded-xl bg-gradient-to-br from-indigo-50/80 to-blue-50/50 border border-indigo-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                <User className="h-3.5 w-3.5 text-indigo-600" />
              </div>
              <p className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Identity</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="First Name"><Input value={employee.first_name} disabled className="h-9 text-sm font-semibold text-gray-800 rounded-lg bg-white border-indigo-200" /></FormField>
              <FormField label="Last Name"><Input value={employee.last_name} disabled className="h-9 text-sm font-semibold text-gray-800 rounded-lg bg-white border-indigo-200" /></FormField>
              <FormField label="Employee Code"><Input value={employee.employee_code} disabled className="h-9 text-sm font-bold text-indigo-700 rounded-lg bg-white border-indigo-200 font-mono" /></FormField>
              <FormField label="Official Email"><Input value={employee.official_email || ""} disabled className="h-9 text-sm font-semibold text-gray-800 rounded-lg bg-white border-indigo-200" /></FormField>
            </div>
          </div>
          {/* Contact Section */}
          <div className="rounded-xl bg-gradient-to-br from-emerald-50/80 to-teal-50/50 border border-emerald-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Phone className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Contact</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Phone">
                <Input value={formData.mobile} onChange={e => setFormData((p: any) => ({...p, mobile: e.target.value}))} disabled={!isEditing}
                  className={cn("h-9 text-sm font-semibold text-gray-800 rounded-lg", isEditing ? "bg-white border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200" : "bg-white border-emerald-200")} />
              </FormField>
              <FormField label="Personal Email">
                <Input value={formData.personal_email} onChange={e => setFormData((p: any) => ({...p, personal_email: e.target.value.toLowerCase()}))} disabled={!isEditing}
                  className={cn("h-9 text-sm font-semibold text-gray-800 rounded-lg", isEditing ? "bg-white border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200" : "bg-white border-emerald-200")} />
              </FormField>
              <FormField label="Address" className="sm:col-span-2">
                <Input value={formData.address_line1} onChange={e => setFormData((p: any) => ({...p, address_line1: e.target.value}))} disabled={!isEditing}
                  className={cn("h-9 text-sm font-semibold text-gray-800 rounded-lg", isEditing ? "bg-white border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200" : "bg-white border-emerald-200")} />
              </FormField>
              <FormField label="City">
                <Input value={formData.city} onChange={e => setFormData((p: any) => ({...p, city: e.target.value}))} disabled={!isEditing}
                  className={cn("h-9 text-sm font-semibold text-gray-800 rounded-lg", isEditing ? "bg-white border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200" : "bg-white border-emerald-200")} />
              </FormField>
              <FormField label="Date of Birth">
                <Input type="date" value={formData.date_of_birth} onChange={e => setFormData((p: any) => ({...p, date_of_birth: e.target.value}))} disabled={!isEditing}
                  className={cn("h-9 text-sm font-semibold text-gray-800 rounded-lg", isEditing ? "bg-white border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200" : "bg-white border-emerald-200")} />
              </FormField>
            </div>
          </div>
          {/* Schedule Section */}
          <div className="rounded-xl bg-gradient-to-br from-amber-50/80 to-orange-50/50 border border-amber-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
                <Clock className="h-3.5 w-3.5 text-amber-600" />
              </div>
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">Working Schedule</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DAY_LABELS.map((d, i) => {
                const active = formData.working_days.includes(i);
                return (
                  <button key={i} type="button" disabled={!isEditing}
                    onClick={() => isEditing && setFormData((p: any) => ({ ...p, working_days: active ? p.working_days.filter((x: number) => x !== i) : [...p.working_days, i].sort((a: number, b: number) => a - b) }))}
                    className={cn(
                      "w-10 h-10 rounded-xl text-xs font-bold transition-all duration-200",
                      active ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/25" : "bg-white/80 text-gray-500 hover:bg-amber-100 border border-amber-200",
                      !isEditing && "opacity-70 cursor-default"
                    )}>{d}</button>
                );
              })}
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function ProfileV3() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdminOrHR } = useIsAdminOrHR();
  const isReadOnly = useIsReadOnly();

  const tabParam = (searchParams.get("tab") || "").toLowerCase();
  const allowedTabs = ["profile", "statutory", "emergency", "journey", "leaves", "attendance", "assets", "reviews", "payslips", "documents", "security"] as const;
  const initialTab = allowedTabs.includes(tabParam as any) ? tabParam : "profile";

  const [activeTab, setActiveTab] = useState(initialTab);
  const [isEditing, setIsEditing] = useState(false);
  const [rmChangeOpen, setRmChangeOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProfileForm>({
    mobile: "", personal_email: "", personal_phone: "", alternate_mobile: "", address_line1: "", city: "",
    date_of_birth: "", gender: "", marital_status: "", blood_group: "",
    working_hours_start: "09:00", working_hours_end: "18:00", working_days: [1,2,3,4,5,6],
  });

  useEffect(() => { if (allowedTabs.includes(tabParam as any) && tabParam !== activeTab) setActiveTab(tabParam); }, [tabParam]);
  const handleTabChange = (v: string) => { setActiveTab(v); setSearchParams(p => { const n = new URLSearchParams(p); n.set("tab", v); return n; }); };

  const { data: myRMRequests } = useMyRMChangeRequests();
  const hasPendingRMRequest = myRMRequests?.some(r => r.status === "pending") ?? false;

  const { data: employee, isLoading, refetch } = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: async () => { if (!user?.id) return null; const res = await hrmsApi.get<{success:boolean;data:any}>("/api/employees/me"); return res.data ?? null; },
    enabled: !!user?.id, staleTime: 5*60_000, gcTime: 10*60_000,
  });

  const { data: journeyEvents = [], isLoading: journeyLoading } = useQuery({
    queryKey: ["my-journey", employee?.id],
    queryFn: async () => { const res = await hrmsApi.get<{success:boolean;data:any[]}>("/api/employees/me/journey"); return res.data ?? []; },
    enabled: !!employee?.id,
  });

  useEffect(() => {
    if (employee) {
      if (!avatarUrl) setAvatarUrl(employee.avatar_url ?? null);
      const fmt = (t: string | null) => t ? t.slice(0, 5) : "";
      setFormData({
        mobile: employee.mobile || "", personal_email: employee.personal_email || "",
        personal_phone: employee.personal_phone || "", alternate_mobile: employee.alternate_mobile || "",
        address_line1: employee.address_line1 || employee.address || "", city: employee.city || "",
        date_of_birth: employee.date_of_birth ? employee.date_of_birth.slice(0, 10) : "",
        gender: employee.gender || "", marital_status: employee.marital_status || "", blood_group: employee.blood_group || "",
        working_hours_start: fmt(employee.working_hours_start) || "09:00", working_hours_end: fmt(employee.working_hours_end) || "18:00",
        working_days: employee.working_days || [1,2,3,4,5,6],
      });
    }
  }, [employee]);

  const updateMutation = useMutation({
    mutationFn: (data: ProfileForm) => hrmsApi.patch("/api/employees/me", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["my-profile"] }); setIsEditing(false); toast({ title: "Saved!" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancelEdit = () => {
    setIsEditing(false);
    if (employee) {
      const fmt = (t: string | null) => t ? t.slice(0, 5) : "";
      setFormData({
        mobile: employee.mobile || "", personal_email: employee.personal_email || "",
        personal_phone: employee.personal_phone || "", alternate_mobile: employee.alternate_mobile || "",
        address_line1: employee.address_line1 || employee.address || "", city: employee.city || "",
        date_of_birth: employee.date_of_birth ? employee.date_of_birth.slice(0, 10) : "",
        gender: employee.gender || "", marital_status: employee.marital_status || "", blood_group: employee.blood_group || "",
        working_hours_start: fmt(employee.working_hours_start) || "09:00", working_hours_end: fmt(employee.working_hours_end) || "18:00",
        working_days: employee.working_days || [1,2,3,4,5,6],
      });
    }
  };

  if (isLoading) return <DashboardLayout><div className="flex min-h-[300px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-indigo-500" /></div></DashboardLayout>;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {!employee ? (
          <GlassCard className="p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <User className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-800">No Employee Profile</h3>
            <p className="text-sm text-gray-500 mt-1">Contact HR to link your account.</p>
          </GlassCard>
        ) : (
          <>
            {/* ═══ HERO ═════════════════════════════════════════════════════════ */}
            <GlassCard className="overflow-hidden">
              <div className="bg-gradient-to-r from-[#0f172a] via-[#1e293b] to-[#334155] p-6 lg:p-8 text-white relative">
                <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(99, 102, 241, 0.4), transparent 50%), radial-gradient(circle at 80% 50%, rgba(168, 85, 247, 0.4), transparent 50%)' }} />
                <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
                <div className="relative flex items-center gap-6">
                  <PhotoUpload currentUrl={avatarUrl} displayName={`${employee.first_name} ${employee.last_name}`}
                    onSuccess={async (url) => { setAvatarUrl(url ? `${url}?t=${Date.now()}` : null); queryClient.removeQueries({ queryKey: ["my-profile"] }); await refetch(); }}
                    size="2xl" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-indigo-300 uppercase tracking-widest">Employee Profile</p>
                    <h1 className="text-3xl lg:text-4xl font-black mt-1 truncate">{employee.first_name} {employee.last_name}</h1>
                    <p className="text-base text-gray-300 font-medium mt-1">{employee.designation || "—"}</p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs font-semibold px-3 py-1"><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />{employee.status}</Badge>
                      <Badge className="bg-white/10 text-white border-white/20 text-xs font-mono px-3 py-1">{employee.employee_code}</Badge>
                      {employee.department?.name && <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs px-3 py-1"><Building2 className="h-3.5 w-3.5 mr-1.5" />{employee.department.name}</Badge>}
                    </div>
                  </div>
                  <div className="hidden lg:flex gap-3">
                    {[
                      { label: "Joined", value: formatDate(employee.date_of_joining), color: "from-blue-500/20 to-indigo-500/10" },
                      { label: "Birthday", value: formatDate(employee.date_of_birth), color: "from-pink-500/20 to-rose-500/10" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className={cn("rounded-xl px-4 py-3 min-w-[120px] bg-gradient-to-br border border-white/10", color)}>
                        <p className="text-[9px] font-bold text-white/60 uppercase tracking-wide">{label}</p>
                        <p className="text-sm font-bold text-white mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="relative flex gap-2 mt-4 pt-4 border-t border-white/10">
                  <Button size="sm" variant="outline" disabled={hasPendingRMRequest} onClick={() => setRmChangeOpen(true)}
                    className="h-8 text-[10px] bg-white/5 border-white/20 text-white hover:bg-white/10">
                    <Users className="h-3 w-3 mr-1.5" />{hasPendingRMRequest ? "RM Change Pending" : "Change Manager"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setChangePasswordOpen(true)}
                    className="h-8 text-[10px] bg-white/5 border-white/20 text-white hover:bg-white/10">
                    <Key className="h-3 w-3 mr-1.5" />Password
                  </Button>
                </div>
              </div>
            </GlassCard>

            {/* ═══ TABS ═════════════════════════════════════════════════════════ */}
            <GlassCard className="p-1.5">
              <div className="flex flex-wrap gap-1">
                {[
                  { v: "profile", i: User }, { v: "statutory", i: Landmark }, { v: "emergency", i: HeartHandshake },
                  { v: "journey", i: GitBranch }, { v: "leaves", i: Calendar }, { v: "attendance", i: Clock },
                  { v: "assets", i: Package }, { v: "reviews", i: Star }, { v: "payslips", i: Wallet },
                  { v: "documents", i: Files }, { v: "security", i: ShieldCheck },
                ].map(({ v, i: I }) => (
                  <button key={v} onClick={() => handleTabChange(v)} className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-200 capitalize",
                    activeTab === v
                      ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25"
                      : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  )}>
                    <I className="h-3.5 w-3.5" /><span className="hidden sm:inline">{v === "statutory" ? "Bank" : v}</span>
                  </button>
                ))}
              </div>
            </GlassCard>

            {/* ═══ TAB CONTENT ══════════════════════════════════════════════════ */}
            {activeTab === "profile" && <ProfileTab employee={employee} formData={formData} setFormData={setFormData} isEditing={isEditing} setIsEditing={setIsEditing} isReadOnly={isReadOnly} updateMutation={updateMutation} cancelEdit={cancelEdit} />}
            {activeTab === "statutory" && <BankStatutoryDetails employee={employee} allowStatutoryEdit={isAdminOrHR} />}
            {activeTab === "emergency" && <EmergencyNomineeDetails employee={employee} />}
            {activeTab === "journey" && (
              <GlassCard className="overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 p-5 text-white relative">
                  <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, white, transparent 60%)' }} />
                  <div className="relative flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <GitBranch className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">Career Journey</h3>
                      <p className="text-sm text-white/80">Your employment timeline and milestones</p>
                    </div>
                  </div>
                </div>
                <div className="p-5"><EmployeeJourneyTimeline employeeName={`${employee.first_name} ${employee.last_name}`} events={journeyEvents} loading={journeyLoading} /></div>
              </GlassCard>
            )}
            {activeTab === "leaves" && <LeavesTab employeeId={employee.id} />}
            {activeTab === "attendance" && <AttendanceTab employeeId={employee.id} />}
            {activeTab === "assets" && (
              <GlassCard className="overflow-hidden">
                <div className="bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 p-5 text-white relative">
                  <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, white, transparent 60%)' }} />
                  <div className="relative flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <Package className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">My Assets</h3>
                      <p className="text-sm text-white/80">Company assets assigned to you</p>
                    </div>
                  </div>
                </div>
                <div className="p-5"><MyAssets employeeId={employee.id} /></div>
              </GlassCard>
            )}
            {activeTab === "reviews" && (
              <GlassCard className="overflow-hidden">
                <div className="bg-gradient-to-r from-pink-500 via-rose-500 to-pink-600 p-5 text-white relative">
                  <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, white, transparent 60%)' }} />
                  <div className="relative flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <Star className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">Performance Reviews</h3>
                      <p className="text-sm text-white/80">Your performance history and feedback</p>
                    </div>
                  </div>
                </div>
                <div className="p-5"><MyPerformanceReviews employeeId={employee.id} /></div>
              </GlassCard>
            )}
            {activeTab === "payslips" && (
              <GlassCard className="overflow-hidden">
                <div className="bg-gradient-to-r from-green-600 via-emerald-600 to-green-700 p-5 text-white relative">
                  <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, white, transparent 60%)' }} />
                  <div className="relative flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <Wallet className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">Payslips</h3>
                      <p className="text-sm text-white/80">Download and view your salary slips</p>
                    </div>
                  </div>
                </div>
                <div className="p-5"><PayslipViewer employeeId={employee.id} employeeName={`${employee.first_name} ${employee.last_name}`} employeeCode={employee.employee_code} /></div>
              </GlassCard>
            )}
            {activeTab === "documents" && (
              <div className="space-y-4">
                <GlassCard className="overflow-hidden">
                  <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-violet-700 p-5 text-white relative">
                    <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, white, transparent 60%)' }} />
                    <div className="relative flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <FileText className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">Tax Documents</h3>
                        <p className="text-sm text-white/80">Form 16, investment declarations</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-5"><TaxDocumentsViewer employeeId={employee.id} /></div>
                </GlassCard>
                <GlassCard className="overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 p-5 text-white relative">
                    <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, white, transparent 60%)' }} />
                    <div className="relative flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <Files className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">My Documents</h3>
                        <p className="text-sm text-white/80">Personal and employment documents</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-5"><EmployeeDocuments employeeId={employee.id} canUpload={isAdminOrHR} canDelete={isAdminOrHR} /></div>
                </GlassCard>
              </div>
            )}
            {activeTab === "security" && (
              <GlassCard className="overflow-hidden">
                <div className="bg-gradient-to-r from-slate-700 via-gray-700 to-slate-800 p-5 text-white relative">
                  <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, white, transparent 60%)' }} />
                  <div className="relative flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <ShieldCheck className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold">Security & Sessions</h3>
                      <p className="text-sm text-white/80">Manage your login sessions and security settings</p>
                    </div>
                  </div>
                </div>
                <div className="p-5"><SessionsSecurityPanel /></div>
              </GlassCard>
            )}
          </>
        )}
      </div>

      <ReportingManagerChangeDialog open={rmChangeOpen} onOpenChange={setRmChangeOpen} currentManagerName={employee?.reporting_manager_name} />
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </DashboardLayout>
  );
}
