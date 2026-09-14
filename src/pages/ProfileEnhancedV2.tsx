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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2, User, Mail, Phone, MapPin, Building2, Calendar,
  Briefcase, Save, Clock, Wallet, Files, Package, Star,
  Users, Cake, Edit3, X, GitBranch, Landmark,
  HeartHandshake, ShieldCheck, CheckCircle2, TrendingUp, Award, AlertCircle,
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
import { format, parseISO } from "date-fns";
import { normalizeDate } from "@/lib/utils";

interface ProfileForm {
  mobile: string; personal_email: string; personal_phone: string; alternate_mobile: string;
  address_line1: string; city: string; date_of_birth: string; gender: string;
  marital_status: string; blood_group: string; working_hours_start: string;
  working_hours_end: string; working_days: number[];
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "—";
  const d = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/)?.slice(1);
  if (!d) return "—";
  const date = new Date(Date.UTC(+d[0], +d[1]-1, +d[2]));
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const formatTime = (t: string | null) => {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

// ═══════════════════════════════════════════════════════════════════════
// COMPACT UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

function GlassCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-slate-200/60 bg-white/90 backdrop-blur-sm shadow-sm", className)}>
      {children}
    </div>
  );
}

function MiniDonut({ used, total, color, size = 48 }: { used: number; total: number; color: string; size?: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="-rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${(pct/100)*c} ${c}`} strokeLinecap="round" className="transition-all" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-slate-700">
        {(total - used).toFixed(0)}
      </span>
    </div>
  );
}

function InfoItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <Icon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      <span className="text-[10px] font-semibold text-slate-400 uppercase w-20 shrink-0">{label}</span>
      <span className="text-xs font-semibold text-slate-800 truncate">{value || "—"}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ENHANCED LEAVES TAB
// ═══════════════════════════════════════════════════════════════════════

function EnhancedLeavesTab({ employeeId }: { employeeId: string }) {
  const { data: balances, isLoading } = useLeaveBalances(employeeId);
  const { data: requests } = useQuery({
    queryKey: ["leave-requests", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>(`/api/leave/requests?employeeId=${employeeId}`);
      return (res.data ?? []) as any[];
    },
    enabled: !!employeeId,
  });

  const colors: Record<string, string> = { CL: "#3B82F6", ML: "#8B5CF6", EL: "#10B981", LWP: "#F59E0B", default: "#64748B" };
  const statusStyles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700", pending_branch_head: "bg-orange-100 text-orange-700",
    approved: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700", cancelled: "bg-slate-100 text-slate-500",
  };

  const pendingReqs = requests?.filter(r => r.status === "pending" || r.status === "pending_branch_head") || [];
  const recentReqs = requests?.slice(0, 5) || [];

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {/* Left: Balances + History */}
      <div className="space-y-4">
        {/* Balance Cards - Compact Grid */}
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-bold text-slate-800">Leave Balance</span>
            <Badge variant="outline" className="ml-auto text-[9px]">FY {new Date().getFullYear()}</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {balances?.map(b => {
              const ent = b.annual_entitlement ?? (b.leave_code === "CL" ? 7 : b.leave_code === "ML" ? 5 : b.allocated_days);
              const clr = colors[b.leave_code || ""] || colors.default;
              return (
                <div key={b.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                  <MiniDonut used={b.used_days} total={ent} color={clr} />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{b.leave_type?.name || b.leave_code}</p>
                    <p className="text-[10px] text-slate-500">{b.used_days.toFixed(1)} / {ent} used</p>
                  </div>
                </div>
              );
            })}
            {(!balances || balances.length === 0) && (
              <p className="col-span-4 text-center text-xs text-slate-400 py-4">No leave balances</p>
            )}
          </div>
        </GlassCard>

        {/* Pending Requests */}
        {pendingReqs.length > 0 && (
          <GlassCard className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-bold text-slate-800">Pending Requests</span>
              <Badge className="ml-auto bg-amber-100 text-amber-700 text-[9px]">{pendingReqs.length}</Badge>
            </div>
            <div className="space-y-2">
              {pendingReqs.map(r => (
                <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-amber-50/50 border border-amber-100">
                  <div>
                    <p className="text-xs font-semibold text-slate-800">{r.leave_type_name || r.leave_type_code}</p>
                    <p className="text-[10px] text-slate-500">
                      {formatDate(r.from_date)} — {formatDate(r.to_date)} ({r.total_days} days)
                    </p>
                  </div>
                  <Badge className={cn("text-[9px]", statusStyles[r.status] || statusStyles.pending)}>
                    {r.status === "pending_branch_head" ? "Awaiting BH" : "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
          </GlassCard>
        )}

        {/* Recent History - Compact Table */}
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-slate-600" />
            <span className="text-sm font-bold text-slate-800">Recent Requests</span>
          </div>
          {recentReqs.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-100">
                    <TableHead className="text-[10px] font-bold py-2">Type</TableHead>
                    <TableHead className="text-[10px] font-bold py-2">Dates</TableHead>
                    <TableHead className="text-[10px] font-bold py-2 text-center">Days</TableHead>
                    <TableHead className="text-[10px] font-bold py-2 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentReqs.map(r => (
                    <TableRow key={r.id} className="border-slate-50">
                      <TableCell className="text-xs font-medium py-2">{r.leave_type_name || r.leave_type_code || "—"}</TableCell>
                      <TableCell className="text-[11px] text-slate-600 py-2">
                        {formatDate(r.from_date)} — {formatDate(r.to_date)}
                      </TableCell>
                      <TableCell className="text-xs font-semibold text-center py-2">{r.total_days}</TableCell>
                      <TableCell className="py-2 text-right">
                        <Badge className={cn("text-[9px]", statusStyles[r.status] || "bg-slate-100 text-slate-600")}>
                          {r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-4">No leave history</p>
          )}
        </GlassCard>
      </div>

      {/* Right: Apply Leave Form */}
      <GlassCard className="p-4 h-fit">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-bold text-slate-800">Apply Leave</span>
        </div>
        <LeaveRequestForm employeeId={employeeId} />
      </GlassCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ENHANCED ATTENDANCE TAB
// ═══════════════════════════════════════════════════════════════════════

function EnhancedAttendanceTab({ employeeId }: { employeeId: string }) {
  const [attMonth, setAttMonth] = useState(() => {
    const now = new Date();
    return { m: now.getMonth(), y: now.getFullYear() };
  });
  const attFrom = `${attMonth.y}-${String(attMonth.m + 1).padStart(2, "0")}-01`;
  const attTo = `${attMonth.y}-${String(attMonth.m + 1).padStart(2, "0")}-${String(new Date(attMonth.y, attMonth.m + 1, 0).getDate()).padStart(2, "0")}`;
  const { data: attRows = [], isLoading } = useAttendanceDailyRecords(employeeId, attFrom, attTo);

  // Summary stats
  const present = attRows.filter(r => r.final_status === "P" || r.final_status === "present").length;
  const absent = attRows.filter(r => r.final_status === "A" || r.final_status === "absent").length;
  const halfDay = attRows.filter(r => r.final_status === "H" || r.final_status === "half_day").length;
  const leave = attRows.filter(r => r.final_status === "L" || r.final_status === "leave").length;

  return (
    <div className="space-y-4">
      {/* Summary Stats - Compact */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Present", value: present, color: "bg-emerald-500", icon: CheckCircle2 },
          { label: "Absent", value: absent, color: "bg-red-500", icon: X },
          { label: "Half Day", value: halfDay, color: "bg-amber-500", icon: Clock },
          { label: "On Leave", value: leave, color: "bg-purple-500", icon: Calendar },
        ].map(s => (
          <GlassCard key={s.label} className="p-3 flex items-center gap-3">
            <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", s.color)}>
              <s.icon className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-lg font-black text-slate-800">{s.value}</p>
              <p className="text-[10px] font-semibold text-slate-500 uppercase">{s.label}</p>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Calendar */}
      <GlassCard className="p-4">
        <AttendanceCalendar
          employeeId={employeeId}
          month={attMonth.m}
          year={attMonth.y}
          onMonthChange={(m, y) => setAttMonth({ m, y })}
          records={adrRecordsToAttendanceDays(attRows)}
          recordsLoading={isLoading}
          sourceLabel="HRMS Record"
        />
      </GlassCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN PROFILE COMPONENT
// ═══════════════════════════════════════════════════════════════════════

const ProfileEnhancedV2 = () => {
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["my-profile"] }); setIsEditing(false); toast({ title: "Saved" }); },
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

  if (isLoading) return <DashboardLayout><div className="flex min-h-[300px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div></DashboardLayout>;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {!employee ? (
          <GlassCard className="p-12 text-center">
            <User className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800">No Employee Profile</h3>
            <p className="text-xs text-slate-500 mt-1">Contact HR to link your account.</p>
          </GlassCard>
        ) : (
          <>
            {/* ═══ COMPACT HERO ═══════════════════════════════════════════════ */}
            <div className="rounded-xl bg-gradient-to-r from-[#0a1628] via-[#0f2847] to-[#1a365d] p-4 text-white relative overflow-hidden">
              <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
              <div className="relative flex items-center gap-4">
                <div className="shrink-0">
                  <PhotoUpload currentUrl={avatarUrl} displayName={`${employee.first_name} ${employee.last_name}`}
                    onSuccess={async (url) => { setAvatarUrl(url ? `${url}?t=${Date.now()}` : null); queryClient.removeQueries({ queryKey: ["my-profile"] }); await refetch(); }}
                    size="lg" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Employee Profile</p>
                  <h1 className="text-xl font-black truncate">{employee.first_name} {employee.last_name}</h1>
                  <p className="text-xs text-blue-200/80 font-medium">{employee.designation || "—"}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[9px]"><CheckCircle2 className="h-2.5 w-2.5 mr-1" />{employee.status}</Badge>
                    <Badge className="bg-white/10 text-white border-white/20 text-[9px] font-mono">{employee.employee_code}</Badge>
                    {employee.department?.name && <Badge className="bg-blue-500/20 text-blue-200 border-blue-400/30 text-[9px]"><Building2 className="h-2.5 w-2.5 mr-1" />{employee.department.name}</Badge>}
                  </div>
                </div>
                <div className="hidden md:grid grid-cols-2 gap-2 shrink-0">
                  {[
                    { label: "Joined", value: formatDate(employee.date_of_joining), icon: Calendar },
                    { label: "DOB", value: formatDate(employee.date_of_birth), icon: Cake },
                  ].map(({ label, value, icon: I }) => (
                    <div key={label} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 min-w-[100px]">
                      <div className="flex items-center gap-1 text-[9px] text-blue-300/70 font-semibold uppercase"><I className="h-2.5 w-2.5" />{label}</div>
                      <p className="text-xs font-bold truncate mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ═══ TABS ════════════════════════════════════════════════════════ */}
            <Tabs value={activeTab} onValueChange={handleTabChange}>
              <TabsList className="w-full justify-start overflow-x-auto bg-white/80 border border-slate-200 rounded-lg p-1 h-auto">
                {[
                  { v: "profile", i: User, l: "Profile" }, { v: "statutory", i: Landmark, l: "Statutory" },
                  { v: "emergency", i: HeartHandshake, l: "Emergency" }, { v: "journey", i: GitBranch, l: "Journey" },
                  { v: "leaves", i: Calendar, l: "Leaves" }, { v: "attendance", i: Clock, l: "Attendance" },
                  { v: "assets", i: Package, l: "Assets" }, { v: "reviews", i: Star, l: "Reviews" },
                  { v: "payslips", i: Wallet, l: "Payslips" }, { v: "documents", i: Files, l: "Documents" },
                  { v: "security", i: ShieldCheck, l: "Security" },
                ].map(({ v, i: I, l }) => (
                  <TabsTrigger key={v} value={v} className={cn(
                    "gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
                    "data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow"
                  )}>
                    <I className="h-3.5 w-3.5" /><span className="hidden sm:inline">{l}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* ═══ PROFILE TAB ════════════════════════════════════════════════ */}
              <TabsContent value="profile" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                  {/* Left - Info Cards */}
                  <div className="space-y-3">
                    <GlassCard className="p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Contact</p>
                      <InfoItem icon={Mail} label="Email" value={employee.official_email || employee.email} />
                      <InfoItem icon={Phone} label="Phone" value={employee.mobile} />
                      <InfoItem icon={Phone} label="Alt" value={employee.alternate_mobile} />
                      <InfoItem icon={MapPin} label="City" value={employee.city} />
                    </GlassCard>
                    <GlassCard className="p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Work</p>
                      <InfoItem icon={Briefcase} label="Role" value={employee.designation} />
                      <InfoItem icon={Building2} label="Dept" value={employee.department?.name} />
                      <InfoItem icon={Users} label="Manager" value={employee.reporting_manager_name} />
                      <InfoItem icon={Calendar} label="Joined" value={formatDate(employee.date_of_joining)} />
                    </GlassCard>
                    <GlassCard className="p-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Personal</p>
                      <InfoItem icon={Cake} label="DOB" value={formatDate(employee.date_of_birth)} />
                      <InfoItem icon={User} label="Gender" value={employee.gender} />
                      <InfoItem icon={HeartHandshake} label="Status" value={employee.marital_status} />
                      <InfoItem icon={User} label="Blood" value={employee.blood_group} />
                    </GlassCard>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 text-[10px] h-8" disabled={hasPendingRMRequest} onClick={() => setRmChangeOpen(true)}>
                        {hasPendingRMRequest ? "RM Change Pending" : "Change Manager"}
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-[10px] h-8" onClick={() => setChangePasswordOpen(true)}>Password</Button>
                    </div>
                  </div>

                  {/* Right - Editable Form */}
                  <GlassCard>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                      <p className="text-sm font-bold text-slate-800">Personal Information</p>
                      {!isEditing ? (
                        <Button size="sm" variant="outline" onClick={() => setIsEditing(true)} disabled={isReadOnly} className="h-7 text-[10px]">
                          <Edit3 className="h-3 w-3 mr-1" />{isReadOnly ? "Read-Only" : "Edit"}
                        </Button>
                      ) : (
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 text-[10px]"><X className="h-3 w-3 mr-1" />Cancel</Button>
                          <Button size="sm" onClick={() => updateMutation.mutate(formData)} disabled={updateMutation.isPending} className="h-7 text-[10px] bg-blue-600 hover:bg-blue-700">
                            {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}Save
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="p-4 space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><Label className="text-[10px] text-slate-400 uppercase">First Name</Label><Input value={employee.first_name} disabled className="h-8 text-xs mt-1" /></div>
                        <div><Label className="text-[10px] text-slate-400 uppercase">Last Name</Label><Input value={employee.last_name} disabled className="h-8 text-xs mt-1" /></div>
                        <div><Label className="text-[10px] text-slate-400 uppercase">Phone</Label><Input value={formData.mobile} onChange={e => setFormData(p => ({...p, mobile: e.target.value}))} disabled={!isEditing} className="h-8 text-xs mt-1" /></div>
                        <div><Label className="text-[10px] text-slate-400 uppercase">Personal Email</Label><Input value={formData.personal_email} onChange={e => setFormData(p => ({...p, personal_email: e.target.value.toLowerCase()}))} disabled={!isEditing} className="h-8 text-xs mt-1" /></div>
                        <div className="sm:col-span-2"><Label className="text-[10px] text-slate-400 uppercase">Address</Label><Input value={formData.address_line1} onChange={e => setFormData(p => ({...p, address_line1: e.target.value}))} disabled={!isEditing} className="h-8 text-xs mt-1" /></div>
                        <div><Label className="text-[10px] text-slate-400 uppercase">City</Label><Input value={formData.city} onChange={e => setFormData(p => ({...p, city: e.target.value}))} disabled={!isEditing} className="h-8 text-xs mt-1" /></div>
                        <div><Label className="text-[10px] text-slate-400 uppercase">DOB</Label><Input type="date" value={formData.date_of_birth} onChange={e => setFormData(p => ({...p, date_of_birth: e.target.value}))} disabled={!isEditing} className="h-8 text-xs mt-1" /></div>
                      </div>
                      <div>
                        <Label className="text-[10px] text-slate-400 uppercase">Working Days</Label>
                        <div className="flex gap-1 mt-1.5">
                          {DAY_LABELS.map((d, i) => {
                            const active = formData.working_days.includes(i);
                            return (
                              <button key={i} type="button" disabled={!isEditing}
                                onClick={() => isEditing && setFormData(p => ({ ...p, working_days: active ? p.working_days.filter(x => x !== i) : [...p.working_days, i].sort((a,b) => a-b) }))}
                                className={cn("h-7 w-7 rounded text-[10px] font-bold transition", active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500", !isEditing && "opacity-60")}
                              >{d}</button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                </div>
              </TabsContent>

              {/* ═══ OTHER TABS ══════════════════════════════════════════════════ */}
              <TabsContent value="statutory" className="mt-4"><GlassCard className="p-4"><BankStatutoryDetails employee={employee} allowStatutoryEdit={isAdminOrHR} /></GlassCard></TabsContent>
              <TabsContent value="emergency" className="mt-4"><GlassCard className="p-4"><EmergencyNomineeDetails employee={employee} /></GlassCard></TabsContent>
              <TabsContent value="journey" className="mt-4"><GlassCard className="p-4"><EmployeeJourneyTimeline employeeName={`${employee.first_name} ${employee.last_name}`} events={journeyEvents} loading={journeyLoading} /></GlassCard></TabsContent>
              <TabsContent value="leaves" className="mt-4"><EnhancedLeavesTab employeeId={employee.id} /></TabsContent>
              <TabsContent value="attendance" className="mt-4"><EnhancedAttendanceTab employeeId={employee.id} /></TabsContent>
              <TabsContent value="assets" className="mt-4"><GlassCard className="p-4"><MyAssets employeeId={employee.id} /></GlassCard></TabsContent>
              <TabsContent value="reviews" className="mt-4"><GlassCard className="p-4"><MyPerformanceReviews employeeId={employee.id} /></GlassCard></TabsContent>
              <TabsContent value="payslips" className="mt-4"><GlassCard className="p-4"><PayslipViewer employeeId={employee.id} employeeName={`${employee.first_name} ${employee.last_name}`} employeeCode={employee.employee_code} /></GlassCard></TabsContent>
              <TabsContent value="documents" className="mt-4">
                <div className="space-y-4">
                  <GlassCard className="p-4"><TaxDocumentsViewer employeeId={employee.id} /></GlassCard>
                  <GlassCard className="p-4"><EmployeeDocuments employeeId={employee.id} canUpload={isAdminOrHR} canDelete={isAdminOrHR} /></GlassCard>
                </div>
              </TabsContent>
              <TabsContent value="security" className="mt-4"><GlassCard className="p-4"><SessionsSecurityPanel /></GlassCard></TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <ReportingManagerChangeDialog open={rmChangeOpen} onOpenChange={setRmChangeOpen} currentManagerName={employee?.reporting_manager_name} />
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </DashboardLayout>
  );
};

export default ProfileEnhancedV2;
