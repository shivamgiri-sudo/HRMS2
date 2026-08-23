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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2, User, Mail, Phone, MapPin, Building2, Calendar,
  Briefcase, Save, Clock, Wallet, Files, Package, Star,
  Users, Cake, Edit3, X, ChevronRight, GitBranch, Landmark,
  HeartHandshake, ShieldCheck, Sparkles, TrendingUp, Award, CheckCircle2,
} from "lucide-react";
import { PhotoUpload } from "@/components/employee/PhotoUpload";
import { useToast } from "@/hooks/use-toast";
import { useAuth, useIsReadOnly } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { EmployeeDocuments } from "@/components/documents/EmployeeDocuments";
import { SessionsSecurityPanel } from "@/components/profile/SessionsSecurityPanel";
import { LeaveBalanceCard } from "@/components/profile/LeaveBalanceCard";
import { LeaveRequestForm } from "@/components/profile/LeaveRequestForm";
import { LeaveRequestHistory } from "@/components/profile/LeaveRequestHistory";
import { PayslipViewer } from "@/components/profile/PayslipViewer";
import { TaxDocumentsViewer } from "@/components/profile/TaxDocumentsViewer";
import { MyAttendanceHistory } from "@/components/profile/MyAttendanceHistory";
import { AttendanceCalendar, adrRecordsToAttendanceDays } from "@/components/attendance/AttendanceCalendar";
import { useAttendanceDailyRecords } from "@/hooks/useAttendanceHub";
import { MyAssets } from "@/components/profile/MyAssets";
import { MyPerformanceReviews } from "@/components/profile/MyPerformanceReviews";
import { EmployeeJourneyTimeline } from "@/components/employees/EmployeeJourneyTimeline";
import {
  BankStatutoryDetails,
  EmergencyNomineeDetails,
} from "@/components/profile/ProfileSensitiveDetails";
import { cn } from "@/lib/utils";

interface ProfileForm {
  mobile: string;
  personal_email: string;
  personal_phone: string;
  alternate_mobile: string;
  address_line1: string;
  city: string;
  date_of_birth: string;
  gender: string;
  marital_status: string;
  blood_group: string;
  working_hours_start: string;
  working_hours_end: string;
  working_days: number[];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "—";
  const datePart = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/)?.slice(1);
  if (!datePart) return "—";
  const [year, month, day] = datePart.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "—";
  }
  return date.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
};

const formatTime = (time: string | null) => {
  if (!time) return "—";
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
};

// ════════════════════════════════════════════════════════════════════════════
// ENHANCED UI COMPONENTS
// ════════════════════════════════════════════════════════════════════════════

function GlassCard({ children, className, glow }: { children: React.ReactNode; className?: string; glow?: 'blue' | 'green' | 'purple' }) {
  const glowColors = {
    blue: 'before:bg-blue-500/20',
    green: 'before:bg-emerald-500/20',
    purple: 'before:bg-purple-500/20',
  };
  return (
    <div className={cn(
      "relative rounded-2xl border border-white/20 bg-white/80 backdrop-blur-xl shadow-lg overflow-hidden",
      "before:absolute before:inset-0 before:rounded-2xl before:opacity-0 before:blur-xl before:transition-opacity",
      "hover:before:opacity-100",
      glow && glowColors[glow],
      className
    )}>
      <div className="relative">{children}</div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, trend, color = 'blue' }: {
  icon: React.ElementType; label: string; value: string; trend?: number; color?: 'blue' | 'green' | 'purple' | 'amber'
}) {
  const colors = {
    blue: { bg: 'bg-blue-500/10', icon: 'text-blue-600', border: 'border-blue-200' },
    green: { bg: 'bg-emerald-500/10', icon: 'text-emerald-600', border: 'border-emerald-200' },
    purple: { bg: 'bg-purple-500/10', icon: 'text-purple-600', border: 'border-purple-200' },
    amber: { bg: 'bg-amber-500/10', icon: 'text-amber-600', border: 'border-amber-200' },
  };
  const c = colors[color];

  return (
    <div className={cn(
      "group relative rounded-2xl border p-4 bg-white/60 backdrop-blur-sm transition-all duration-300",
      "hover:shadow-lg hover:scale-[1.02] hover:-translate-y-0.5",
      c.border
    )}>
      <div className="flex items-start justify-between">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", c.bg)}>
          <Icon className={cn("h-5 w-5", c.icon)} />
        </div>
        {trend !== undefined && (
          <Badge variant="outline" className={cn(
            "text-[10px] font-bold",
            trend >= 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
          )}>
            {trend >= 0 ? '+' : ''}{trend}%
          </Badge>
        )}
      </div>
      <p className="mt-3 text-2xl font-black text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null | undefined }) {
  return (
    <div className="group flex items-start gap-3 py-3 px-2 -mx-2 rounded-xl transition-colors hover:bg-slate-50/50">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200/50 shadow-sm group-hover:shadow-md transition-shadow">
        <Icon className="h-4 w-4 text-slate-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">{label}</p>
        <p className="mt-0.5 break-words text-sm font-bold leading-6 text-slate-900">{value || "—"}</p>
      </div>
    </div>
  );
}

function SectionTitle({ children, icon: Icon }: { children: React.ReactNode; icon?: React.ElementType }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      {Icon && (
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-slate-800 to-slate-900">
          <Icon className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-700">{children}</span>
      <span className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
    </div>
  );
}

function MiniSparkline({ data, color = '#10B981' }: { data: number[]; color?: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 24;
  const w = 60;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');

  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <polygon
        fill={`url(#spark-${color.replace('#', '')})`}
        points={`0,${h} ${points} ${w},${h}`}
      />
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN PROFILE COMPONENT
// ════════════════════════════════════════════════════════════════════════════

const ProfileEnhanced = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdminOrHR } = useIsAdminOrHR();
  const isReadOnly = useIsReadOnly();

  const tabParam = (searchParams.get("tab") || "").toLowerCase();
  const allowedTabs = ["profile", "statutory", "emergency", "journey", "leaves", "attendance", "assets", "reviews", "payslips", "documents", "security"] as const;
  const initialTab = allowedTabs.includes(tabParam as (typeof allowedTabs)[number]) ? tabParam : "profile";

  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [isEditing, setIsEditing] = useState(false);
  const [rmChangeOpen, setRmChangeOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [attMonth, setAttMonth] = useState<{ m: number; y: number }>(() => {
    const now = new Date();
    return { m: now.getMonth(), y: now.getFullYear() };
  });
  const [formData, setFormData] = useState<ProfileForm>({
    mobile: "", personal_email: "", personal_phone: "", alternate_mobile: "", address_line1: "", city: "",
    date_of_birth: "", gender: "", marital_status: "", blood_group: "",
    working_hours_start: "09:00", working_hours_end: "18:00",
    working_days: [1, 2, 3, 4, 5, 6],
  });

  useEffect(() => {
    if (allowedTabs.includes(tabParam as (typeof allowedTabs)[number]) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set("tab", value); return n; });
  };

  const { data: myRMRequests } = useMyRMChangeRequests();
  const hasPendingRMRequest = myRMRequests?.some(r => r.status === "pending") ?? false;

  const { data: employee, isLoading, refetch } = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/employees/me");
      return res.data ?? null;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  const attFrom = `${attMonth.y}-${String(attMonth.m + 1).padStart(2, "0")}-01`;
  const attTo = `${attMonth.y}-${String(attMonth.m + 1).padStart(2, "0")}-${String(new Date(attMonth.y, attMonth.m + 1, 0).getDate()).padStart(2, "0")}`;
  const { data: attRows = [], isLoading: attLoading } = useAttendanceDailyRecords(employee?.id ?? null, attFrom, attTo);

  useEffect(() => {
    if (employee) {
      if (!avatarUrl) setAvatarUrl(employee.avatar_url ?? null);
      const fmt = (t: string | null) => (t ? t.slice(0, 5) : "");
      setFormData({
        mobile: employee.mobile || "",
        personal_email: employee.personal_email || "",
        personal_phone: employee.personal_phone || "",
        alternate_mobile: employee.alternate_mobile || "",
        address_line1: employee.address_line1 || employee.address || "",
        city: employee.city || "",
        date_of_birth: employee.date_of_birth ? employee.date_of_birth.slice(0, 10) : "",
        gender: employee.gender || "",
        marital_status: employee.marital_status || "",
        blood_group: employee.blood_group || "",
        working_hours_start: fmt(employee.working_hours_start) || "09:00",
        working_hours_end: fmt(employee.working_hours_end) || "18:00",
        working_days: employee.working_days || [1, 2, 3, 4, 5, 6],
      });
    }
  }, [employee]);

  const { data: journeyEvents = [], isLoading: journeyLoading } = useQuery({
    queryKey: ["my-journey", employee?.id],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/employees/me/journey");
      return res.data ?? [];
    },
    enabled: !!employee?.id,
  });

  const updateMutation = useMutation({
    mutationFn: (data: ProfileForm) => hrmsApi.patch("/api/employees/me", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      setIsEditing(false);
      toast({ title: "Profile updated", description: "Your information has been saved." });
    },
    onError: (err: Error) => {
      const msg = err.message || "Failed to save profile.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const cancelEdit = () => {
    setIsEditing(false);
    const fmt = (t: string | null) => (t ? t.slice(0, 5) : "");
    if (employee) setFormData({
      mobile: employee.mobile || "",
      personal_email: employee.personal_email || "",
      personal_phone: employee.personal_phone || "",
      alternate_mobile: employee.alternate_mobile || "",
      address_line1: employee.address_line1 || employee.address || "",
      city: employee.city || "",
      date_of_birth: employee.date_of_birth ? employee.date_of_birth.slice(0, 10) : "",
      gender: employee.gender || "",
      marital_status: employee.marital_status || "",
      blood_group: employee.blood_group || "",
      working_hours_start: fmt(employee.working_hours_start) || "09:00",
      working_hours_end: fmt(employee.working_hours_end) || "18:00",
      working_days: employee.working_days || [1, 2, 3, 4, 5, 6],
    });
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 animate-pulse" />
              <Loader2 className="absolute inset-0 m-auto h-8 w-8 text-white animate-spin" />
            </div>
            <p className="text-sm font-semibold text-slate-500">Loading your profile...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* Background gradient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      <div className="space-y-6">
        {!employee ? (
          <GlassCard className="p-16 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200">
              <User className="h-10 w-10 text-slate-400" />
            </div>
            <h3 className="mt-6 text-xl font-black text-slate-900">No Employee Profile</h3>
            <p className="mt-2 text-sm text-slate-500">
              Your account is not linked to an employee profile. Please contact HR.
            </p>
          </GlassCard>
        ) : (
          <>
            {/* ══ HERO BANNER ══════════════════════════════════════════════ */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0a1628] via-[#0f2847] to-[#1a365d] p-1">
              {/* Inner glow border */}
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-emerald-500/20 blur-xl" />

              <div className="relative rounded-[calc(1.5rem-4px)] bg-gradient-to-br from-[#0a1628] via-[#0f2847] to-[#1a365d] px-6 py-8 text-white overflow-hidden">
                {/* Decorative elements */}
                <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-20 left-1/4 h-60 w-60 rounded-full bg-purple-500/10 blur-3xl" />
                <div className="pointer-events-none absolute top-1/2 right-1/3 h-40 w-40 rounded-full bg-emerald-500/10 blur-2xl" />

                {/* Grid pattern overlay */}
                <div className="absolute inset-0 opacity-5" style={{
                  backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
                  backgroundSize: '40px 40px'
                }} />

                <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center">
                  {/* Avatar with glow */}
                  <div className="shrink-0 relative">
                    <div className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 blur-xl opacity-50 scale-110" />
                    <div className="relative">
                      <PhotoUpload
                        currentUrl={avatarUrl}
                        displayName={`${employee.first_name} ${employee.last_name}`}
                        onSuccess={async (url) => {
                          const cacheBustedUrl = url ? `${url}?t=${Date.now()}` : null;
                          setAvatarUrl(cacheBustedUrl);
                          queryClient.removeQueries({ queryKey: ["my-profile"] });
                          queryClient.removeQueries({ queryKey: ["employee-profile"] });
                          await refetch();
                        }}
                        size="2xl"
                      />
                    </div>
                  </div>

                  {/* Identity */}
                  <div className="flex-1 min-w-0">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 mb-3">
                      <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">Employee Profile</span>
                    </div>
                    <h1 className="text-balance text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl break-words bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text text-transparent">
                      {employee.first_name} {employee.last_name}
                    </h1>
                    <p className="mt-2 text-lg font-semibold text-blue-200/80">
                      {employee.designation || "—"}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Badge className={cn(
                        "rounded-full px-4 py-1 text-xs font-bold border",
                        employee.status === "active"
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                          : "bg-slate-500/20 text-slate-300 border-slate-500/40"
                      )}>
                        <CheckCircle2 className="h-3 w-3 mr-1.5" />
                        {employee.status === "active" ? "Active" : employee.status}
                      </Badge>
                      <Badge className="rounded-full bg-white/10 px-4 py-1 text-xs font-bold text-white border border-white/20 font-mono">
                        {employee.employee_code}
                      </Badge>
                      {employee.department?.name && (
                        <Badge className="rounded-full px-4 py-1 text-xs font-bold bg-blue-500/20 text-blue-200 border border-blue-400/30">
                          <Building2 className="h-3 w-3 mr-1.5" />
                          {employee.department.name}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Quick stats - Bento style */}
                  <div className="grid shrink-0 grid-cols-2 gap-3 lg:w-[380px]">
                    {[
                      { label: "Joined", value: formatDate(employee.date_of_joining), icon: Calendar, color: 'from-blue-500/20 to-blue-600/10' },
                      { label: "Birthday", value: formatDate(employee.date_of_birth), icon: Cake, color: 'from-purple-500/20 to-purple-600/10' },
                      { label: "Email", value: employee.official_email || employee.email, icon: Mail, color: 'from-emerald-500/20 to-emerald-600/10' },
                      { label: "Phone", value: employee.mobile || "—", icon: Phone, color: 'from-amber-500/20 to-amber-600/10' },
                    ].map(({ label, value, icon: Icon, color }) => (
                      <div key={label} className={cn(
                        "group relative rounded-2xl border border-white/10 bg-gradient-to-br p-4 transition-all duration-300 hover:border-white/20 hover:scale-[1.02]",
                        color
                      )}>
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className="h-3.5 w-3.5 text-blue-300/70" />
                          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200/70">{label}</p>
                        </div>
                        <p className="truncate text-sm font-bold text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick action buttons */}
                <div className="relative mt-6 pt-6 border-t border-white/10 flex flex-wrap gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={hasPendingRMRequest}
                    onClick={() => setRmChangeOpen(true)}
                    className="rounded-xl bg-white/5 border-white/20 text-white hover:bg-white/10 text-xs font-bold"
                  >
                    {hasPendingRMRequest ? (
                      <span className="text-amber-400">Manager Change Pending</span>
                    ) : (
                      <>
                        <Users className="h-3.5 w-3.5 mr-1.5" />
                        Request Manager Change
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setChangePasswordOpen(true)}
                    className="rounded-xl bg-white/5 border-white/20 text-white hover:bg-white/10 text-xs font-bold"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                    Change Password
                  </Button>
                </div>
              </div>
            </div>

            {/* ══ QUICK STATS ROW ══════════════════════════════════════════ */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatTile icon={Calendar} label="Days This Month" value="22" trend={5} color="blue" />
              <StatTile icon={Clock} label="Avg Login Time" value="9:15 AM" color="green" />
              <StatTile icon={Award} label="Performance" value="4.2/5" trend={12} color="purple" />
              <StatTile icon={TrendingUp} label="Attendance" value="96%" trend={3} color="amber" />
            </div>

            {/* ══ TABS ═════════════════════════════════════════════════════ */}
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
              <div className="overflow-x-auto pb-px">
                <GlassCard className="inline-flex p-1.5">
                  <TabsList className="flex h-auto gap-1 bg-transparent p-0">
                    {[
                      { value: "profile", icon: User, label: "Profile" },
                      { value: "statutory", icon: Landmark, label: "Bank & Statutory" },
                      { value: "emergency", icon: HeartHandshake, label: "Emergency" },
                      { value: "journey", icon: GitBranch, label: "Journey" },
                      { value: "leaves", icon: Calendar, label: "Leaves" },
                      { value: "attendance", icon: Clock, label: "Attendance" },
                      { value: "assets", icon: Package, label: "Assets" },
                      { value: "reviews", icon: Star, label: "Reviews" },
                      { value: "payslips", icon: Wallet, label: "Payslips" },
                      { value: "documents", icon: Files, label: "Documents" },
                      { value: "security", icon: ShieldCheck, label: "Security" },
                    ].map(({ value, icon: Icon, label }) => (
                      <TabsTrigger
                        key={value}
                        value={value}
                        className={cn(
                          "gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all duration-200",
                          "text-slate-500 hover:text-slate-700 hover:bg-slate-100/50",
                          "data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-700",
                          "data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{label}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </GlassCard>
              </div>

              {/* ══ PROFILE TAB ════════════════════════════════════════════ */}
              <TabsContent value="profile" className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-[340px_1fr]">

                  {/* Left — info cards */}
                  <div className="space-y-4">
                    <GlassCard glow="blue" className="p-6">
                      <SectionTitle icon={Mail}>Contact Info</SectionTitle>
                      <div className="space-y-1">
                        <InfoRow icon={Mail} label="Official Email" value={employee.official_email || employee.email} />
                        <InfoRow icon={Phone} label="Phone" value={employee.mobile} />
                        <InfoRow icon={Phone} label="Alternate" value={employee.alternate_mobile} />
                        <InfoRow icon={MapPin} label="City" value={employee.city} />
                      </div>
                    </GlassCard>

                    <GlassCard glow="green" className="p-6">
                      <SectionTitle icon={Briefcase}>Work Info</SectionTitle>
                      <div className="space-y-1">
                        <InfoRow icon={Briefcase} label="Designation" value={employee.designation} />
                        <InfoRow icon={Building2} label="Department" value={employee.department?.name} />
                        <InfoRow icon={Users} label="Reporting Manager" value={employee.reporting_manager_name} />
                        <InfoRow icon={Calendar} label="Date of Joining" value={formatDate(employee.date_of_joining)} />
                      </div>
                    </GlassCard>

                    <GlassCard glow="purple" className="p-6">
                      <SectionTitle icon={User}>Personal</SectionTitle>
                      <div className="space-y-1">
                        <InfoRow icon={Cake} label="Date of Birth" value={formatDate(employee.date_of_birth)} />
                        <InfoRow icon={User} label="Gender" value={employee.gender} />
                        <InfoRow icon={HeartHandshake} label="Marital Status" value={employee.marital_status} />
                        <InfoRow icon={User} label="Blood Group" value={employee.blood_group} />
                      </div>
                    </GlassCard>
                  </div>

                  {/* Right — editable form */}
                  <GlassCard className="overflow-hidden">
                    {/* Form header */}
                    <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5 bg-gradient-to-r from-slate-50/80 to-transparent">
                      <div>
                        <h2 className="text-base font-black text-slate-900">Personal Information</h2>
                        <p className="mt-0.5 text-xs text-slate-500">Update your editable contact & schedule details</p>
                      </div>
                      {!isEditing ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsEditing(true)}
                          disabled={isReadOnly}
                          className="gap-1.5 rounded-xl text-xs font-bold bg-white hover:bg-slate-50"
                          title={isReadOnly ? "Cannot edit in read-only mode" : ""}
                        >
                          <Edit3 className="h-3.5 w-3.5" /> {isReadOnly ? "Read-Only" : "Edit Profile"}
                        </Button>
                      ) : (
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" onClick={cancelEdit} className="rounded-xl text-xs font-bold">
                            <X className="mr-1 h-3.5 w-3.5" /> Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => updateMutation.mutate(formData)}
                            disabled={updateMutation.isPending}
                            className="gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-xs font-bold text-white hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-500/25"
                          >
                            {updateMutation.isPending
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Save className="h-3.5 w-3.5" />}
                            Save Changes
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-6 p-6">
                      {/* Identity — read-only */}
                      <div>
                        <SectionTitle icon={User}>Identity</SectionTitle>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">First Name</Label>
                            <Input value={employee.first_name} disabled className="rounded-xl bg-slate-50/50 border-slate-200" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Last Name</Label>
                            <Input value={employee.last_name} disabled className="rounded-xl bg-slate-50/50 border-slate-200" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Official Email</Label>
                            <Input
                              type="email"
                              value={employee.official_email || ""}
                              disabled
                              placeholder="name@teammas.in"
                              className="rounded-xl bg-slate-50/50 border-slate-200"
                            />
                            <p className={cn(
                              "text-[10px] font-semibold",
                              employee.official_email_compliant ? "text-emerald-600" : "text-amber-600"
                            )}>
                              {employee.official_email_compliant ? "Official email verified" : "Use @teammas.in or @teammas.co.in"} · Contact HR to change
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Employee Code</Label>
                            <Input value={employee.employee_code} disabled className="rounded-xl bg-slate-50/50 border-slate-200 font-mono" />
                          </div>
                        </div>
                      </div>

                      <Separator className="bg-gradient-to-r from-slate-200 via-slate-100 to-transparent" />

                      {/* Contact — editable */}
                      <div>
                        <SectionTitle icon={MapPin}>Contact & Location</SectionTitle>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Phone</Label>
                            <Input
                              value={formData.mobile}
                              onChange={(e) => setFormData(p => ({ ...p, mobile: e.target.value }))}
                              disabled={!isEditing}
                              placeholder="e.g. +91 98765 43210"
                              className={cn("rounded-xl transition-all", isEditing ? "border-blue-300 focus:border-blue-500" : "bg-slate-50/50")}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Personal Email</Label>
                            <Input
                              type="email"
                              value={formData.personal_email}
                              onChange={(e) => setFormData(p => ({ ...p, personal_email: e.target.value.toLowerCase() }))}
                              disabled={!isEditing}
                              placeholder="personal@gmail.com"
                              className={cn("rounded-xl transition-all", isEditing ? "border-blue-300 focus:border-blue-500" : "bg-slate-50/50")}
                            />
                          </div>
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Address</Label>
                            <Input
                              value={formData.address_line1}
                              onChange={(e) => setFormData(p => ({ ...p, address_line1: e.target.value }))}
                              disabled={!isEditing}
                              placeholder="Street address"
                              className={cn("rounded-xl transition-all", isEditing ? "border-blue-300 focus:border-blue-500" : "bg-slate-50/50")}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">City</Label>
                            <Input
                              value={formData.city}
                              onChange={(e) => setFormData(p => ({ ...p, city: e.target.value }))}
                              disabled={!isEditing}
                              placeholder="Mumbai"
                              className={cn("rounded-xl transition-all", isEditing ? "border-blue-300 focus:border-blue-500" : "bg-slate-50/50")}
                            />
                          </div>
                        </div>
                      </div>

                      <Separator className="bg-gradient-to-r from-slate-200 via-slate-100 to-transparent" />

                      {/* Schedule */}
                      <div>
                        <SectionTitle icon={Clock}>Working Schedule</SectionTitle>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Start Time</Label>
                            <div className={cn(
                              "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-all",
                              isEditing ? "border-blue-300 bg-white" : "border-slate-200 bg-slate-50/50"
                            )}>
                              {isEditing ? (
                                <Input
                                  type="time"
                                  value={formData.working_hours_start}
                                  onChange={(e) => setFormData(p => ({ ...p, working_hours_start: e.target.value }))}
                                  className="rounded-xl border-0 p-0 shadow-none focus-visible:ring-0"
                                />
                              ) : (
                                <span className="flex items-center gap-2 text-slate-700">
                                  <Clock className="h-4 w-4 text-blue-500" />
                                  {formatTime(formData.working_hours_start)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">End Time</Label>
                            <div className={cn(
                              "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-all",
                              isEditing ? "border-blue-300 bg-white" : "border-slate-200 bg-slate-50/50"
                            )}>
                              {isEditing ? (
                                <Input
                                  type="time"
                                  value={formData.working_hours_end}
                                  onChange={(e) => setFormData(p => ({ ...p, working_hours_end: e.target.value }))}
                                  className="rounded-xl border-0 p-0 shadow-none focus-visible:ring-0"
                                />
                              ) : (
                                <span className="flex items-center gap-2 text-slate-700">
                                  <Clock className="h-4 w-4 text-blue-500" />
                                  {formatTime(formData.working_hours_end)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 space-y-2">
                          <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Working Days</Label>
                          <div className="flex flex-wrap gap-2">
                            {DAY_LABELS.map((label, idx) => {
                              const active = formData.working_days.includes(idx);
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  disabled={!isEditing}
                                  onClick={() => {
                                    if (!isEditing) return;
                                    setFormData(p => ({
                                      ...p,
                                      working_days: active
                                        ? p.working_days.filter(d => d !== idx)
                                        : [...p.working_days, idx].sort((a, b) => a - b),
                                    }));
                                  }}
                                  className={cn(
                                    "h-10 w-14 rounded-xl text-xs font-bold transition-all duration-200",
                                    active
                                      ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25"
                                      : "border border-slate-200 bg-white text-slate-500 hover:border-blue-300",
                                    "disabled:opacity-60"
                                  )}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                </div>
              </TabsContent>

              {/* ══ OTHER TABS ═════════════════════════════════════════════ */}
              <TabsContent value="statutory">
                <GlassCard className="p-6">
                  <BankStatutoryDetails employee={employee} allowStatutoryEdit={isAdminOrHR} />
                </GlassCard>
              </TabsContent>

              <TabsContent value="emergency">
                <GlassCard className="p-6">
                  <EmergencyNomineeDetails employee={employee} />
                </GlassCard>
              </TabsContent>

              <TabsContent value="journey">
                <GlassCard className="p-6">
                  <EmployeeJourneyTimeline
                    employeeName={`${employee.first_name} ${employee.last_name}`}
                    events={journeyEvents}
                    loading={journeyLoading}
                  />
                </GlassCard>
              </TabsContent>

              <TabsContent value="leaves" className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="lg:col-span-2 space-y-6">
                    <GlassCard glow="green" className="p-6">
                      <LeaveBalanceCard employeeId={employee.id} />
                    </GlassCard>
                    <GlassCard className="p-6">
                      <LeaveRequestHistory employeeId={employee.id} />
                    </GlassCard>
                  </div>
                  <div className="lg:col-span-1">
                    <GlassCard glow="blue" className="p-6">
                      <LeaveRequestForm employeeId={employee.id} />
                    </GlassCard>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="attendance" className="space-y-6">
                <GlassCard glow="purple" className="p-6">
                  <AttendanceCalendar
                    employeeId={employee.id}
                    month={attMonth.m}
                    year={attMonth.y}
                    onMonthChange={(m, y) => setAttMonth({ m, y })}
                    records={adrRecordsToAttendanceDays(attRows)}
                    recordsLoading={attLoading}
                    sourceLabel="HRMS Record"
                  />
                </GlassCard>
                <GlassCard className="p-6">
                  <MyAttendanceHistory employeeId={employee.id} />
                </GlassCard>
              </TabsContent>

              <TabsContent value="assets" className="space-y-6">
                <GlassCard glow="amber" className="p-6">
                  <MyAssets employeeId={employee.id} />
                </GlassCard>
              </TabsContent>

              <TabsContent value="reviews" className="space-y-6">
                <GlassCard glow="purple" className="p-6">
                  <MyPerformanceReviews employeeId={employee.id} />
                </GlassCard>
              </TabsContent>

              <TabsContent value="payslips" className="space-y-6">
                <GlassCard glow="green" className="p-6">
                  <PayslipViewer
                    employeeId={employee.id}
                    employeeName={`${employee.first_name} ${employee.last_name}`}
                    employeeCode={employee.employee_code}
                  />
                </GlassCard>
              </TabsContent>

              <TabsContent value="documents" className="space-y-6">
                <GlassCard className="p-6">
                  <TaxDocumentsViewer employeeId={employee.id} />
                </GlassCard>
                <GlassCard className="p-6">
                  <EmployeeDocuments
                    employeeId={employee.id}
                    canUpload={isAdminOrHR}
                    canDelete={isAdminOrHR}
                  />
                </GlassCard>
              </TabsContent>

              <TabsContent value="security" className="space-y-6">
                <GlassCard glow="blue" className="p-6">
                  <SessionsSecurityPanel />
                </GlassCard>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <ReportingManagerChangeDialog
        open={rmChangeOpen}
        onOpenChange={setRmChangeOpen}
        currentManagerName={employee?.reporting_manager_name}
      />
      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
      />
    </DashboardLayout>
  );
};

export default ProfileEnhanced;
