import { useState, useEffect } from "react";
import { ReportingManagerChangeDialog } from "@/components/profile/ReportingManagerChangeDialog";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2, User, Mail, Phone, MapPin, Building2, Calendar,
  Briefcase, Save, Clock, Wallet, Files, Package, Star,
  Users, Cake, Edit3, X, ChevronRight, GitBranch,
  Award, TrendingUp, RefreshCcw, UserCheck, AlertCircle,
} from "lucide-react";
import { PhotoUpload } from "@/components/employee/PhotoUpload";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EmployeeDocuments } from "@/components/documents/EmployeeDocuments";
import { LeaveBalanceCard } from "@/components/profile/LeaveBalanceCard";
import { LeaveRequestForm } from "@/components/profile/LeaveRequestForm";
import { LeaveRequestHistory } from "@/components/profile/LeaveRequestHistory";
import { PayslipViewer } from "@/components/profile/PayslipViewer";
import { TaxDocumentsViewer } from "@/components/profile/TaxDocumentsViewer";
import { MyAttendanceHistory } from "@/components/profile/MyAttendanceHistory";
import { AttendanceCalendar } from "@/components/attendance/AttendanceCalendar";
import { MyAssets } from "@/components/profile/MyAssets";
import { MyPerformanceReviews } from "@/components/profile/MyPerformanceReviews";

interface ProfileForm {
  phone: string;
  address: string;
  city: string;
  country: string;
  date_of_birth: string;
  gender: string;
  working_hours_start: string;
  working_hours_end: string;
  working_days: number[];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    year: "numeric", month: "long", day: "numeric",
  });
};

const formatTime = (time: string | null) => {
  if (!time) return "—";
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
};

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100">
        <Icon className="h-4 w-4 text-slate-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900 truncate">{value || "—"}</p>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="h-px flex-1 bg-slate-100" />
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{children}</span>
      <span className="h-px flex-1 bg-slate-100" />
    </div>
  );
}

// ── Journey event helpers ─────────────────────────────────────────────────────

const EVENT_META: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  hire:          { icon: UserCheck,   color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
  promotion:     { icon: TrendingUp,  color: "text-blue-700",    bg: "bg-blue-50 border-blue-200" },
  transfer:      { icon: RefreshCcw,  color: "text-violet-700",  bg: "bg-violet-50 border-violet-200" },
  award:         { icon: Award,       color: "text-amber-700",   bg: "bg-amber-50 border-amber-200" },
  warning:       { icon: AlertCircle, color: "text-rose-700",    bg: "bg-rose-50 border-rose-200" },
  designation_change: { icon: Briefcase, color: "text-indigo-700", bg: "bg-indigo-50 border-indigo-200" },
  department_change:  { icon: Building2,  color: "text-cyan-700",   bg: "bg-cyan-50 border-cyan-200" },
};

const getEventMeta = (type: string) =>
  EVENT_META[type.toLowerCase()] ?? { icon: GitBranch, color: "text-slate-700", bg: "bg-slate-50 border-slate-200" };

function JourneyTimeline({
  employee, events, loading,
}: {
  employee: any;
  events: any[];
  loading: boolean;
}) {
  // Always show hire event derived from employee data
  const hireEvent = {
    id: "__hire__",
    event_type: "hire",
    event_date: employee.hire_date,
    description: `Joined as ${employee.designation || "Employee"}${employee.department?.name ? ` · ${employee.department.name}` : ""}`,
    module: "onboarding",
    new_value: null,
    old_value: null,
  };

  const allEvents = [
    ...events,
    // Only add the synthetic hire event if there's no real one
    ...(events.some(e => e.event_type === "hire") ? [] : [hireEvent]),
  ].sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime());

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="rounded-3xl bg-slate-950 px-6 py-7 text-white">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-400">Timeline</p>
        <h2 className="mt-1 text-2xl font-black">Employee Journey</h2>
        <p className="mt-1 text-sm text-slate-400">
          Every milestone, move, and recognition since you joined.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
        </div>
      ) : allEvents.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white py-16 text-center">
          <GitBranch className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-500">No journey events recorded yet.</p>
        </div>
      ) : (
        <div className="relative">
          {/* vertical line */}
          <div className="absolute left-[27px] top-4 bottom-4 w-px bg-slate-200" />

          <div className="space-y-5">
            {allEvents.map((ev, i) => {
              const { icon: Icon, color, bg } = getEventMeta(ev.event_type);
              const isFirst = i === 0;
              return (
                <div key={ev.id} className="relative flex gap-4">
                  {/* dot */}
                  <div className={`relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 ${bg} shadow-sm`}>
                    <Icon className={`h-5 w-5 ${color}`} />
                  </div>

                  {/* card */}
                  <div className={`flex-1 rounded-2xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${isFirst ? "border-slate-300 ring-1 ring-slate-950/5" : "border-slate-100"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className={`inline-block rounded-lg px-2.5 py-0.5 text-[11px] font-black uppercase tracking-widest ${bg} ${color} border`}>
                          {ev.event_type.replace(/_/g, " ")}
                        </span>
                        {ev.module && (
                          <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                            {ev.module}
                          </span>
                        )}
                      </div>
                      <time className="text-xs font-semibold text-slate-400 whitespace-nowrap">
                        {formatDate(ev.event_date)}
                      </time>
                    </div>

                    {ev.description && (
                      <p className="mt-2 text-sm font-medium text-slate-700">{ev.description}</p>
                    )}

                    {(ev.old_value || ev.new_value) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {ev.old_value && (
                          <span className="rounded-lg bg-rose-50 px-2.5 py-1 font-semibold text-rose-600 border border-rose-100">
                            {ev.old_value}
                          </span>
                        )}
                        {ev.old_value && ev.new_value && (
                          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                        )}
                        {ev.new_value && (
                          <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 border border-emerald-100">
                            {ev.new_value}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const Profile = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = (searchParams.get("tab") || "").toLowerCase();
  const allowedTabs = ["profile", "journey", "leaves", "attendance", "assets", "reviews", "payslips", "documents"] as const;
  const initialTab = allowedTabs.includes(tabParam as (typeof allowedTabs)[number]) ? tabParam : "profile";

  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [isEditing, setIsEditing] = useState(false);
  const [rmChangeOpen, setRmChangeOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProfileForm>({
    phone: "", address: "", city: "", country: "",
    date_of_birth: "", gender: "",
    working_hours_start: "09:00", working_hours_end: "18:00",
    working_days: [1, 2, 3, 4, 5],
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

  const { data: employee, isLoading } = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/employees/me");
      return res.data ?? null;
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (employee) {
      if (!avatarUrl) setAvatarUrl(employee.avatar_url ?? null);
      const fmt = (t: string | null) => (t ? t.slice(0, 5) : "");
      setFormData({
        phone: employee.phone || "",
        address: employee.address || "",
        city: employee.city || "",
        country: employee.country || "",
        date_of_birth: employee.date_of_birth
          ? employee.date_of_birth.slice(0, 10)
          : "",
        gender: employee.gender || "",
        working_hours_start: fmt(employee.working_hours_start) || "09:00",
        working_hours_end: fmt(employee.working_hours_end) || "18:00",
        working_days: employee.working_days || [1, 2, 3, 4, 5],
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
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancelEdit = () => {
    setIsEditing(false);
    const fmt = (t: string | null) => (t ? t.slice(0, 5) : "");
    if (employee) setFormData({
      phone: employee.phone || "",
      address: employee.address || "",
      city: employee.city || "",
      country: employee.country || "",
      date_of_birth: employee.date_of_birth ? employee.date_of_birth.slice(0, 10) : "",
      gender: employee.gender || "",
      working_hours_start: fmt(employee.working_hours_start) || "09:00",
      working_hours_end: fmt(employee.working_hours_end) || "18:00",
      working_days: employee.working_days || [1, 2, 3, 4, 5],
    });
  };

  const initials = employee
    ? `${employee.first_name?.[0] ?? ""}${employee.last_name?.[0] ?? ""}`.toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() ?? "U";

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {!employee ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-16 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
              <User className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-slate-900">No Employee Profile</h3>
            <p className="mt-2 text-sm text-slate-500">
              Your account is not linked to an employee profile. Please contact HR.
            </p>
          </div>
        ) : (
          <>
            {/* ── Hero Banner ─────────────────────────────────────────── */}
            <div className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white">
              {/* decorative blobs */}
              <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-blue-600/20 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-10 left-1/3 h-48 w-48 rounded-full bg-indigo-500/20 blur-3xl" />

              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
                {/* Avatar */}
                <div className="shrink-0">
                  <PhotoUpload
                    currentUrl={avatarUrl}
                    displayName={`${employee.first_name} ${employee.last_name}`}
                    onSuccess={(url) => setAvatarUrl(url || null)}
                    size="xl"
                  />
                </div>

                {/* Identity */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-400">
                    Employee Profile
                  </p>
                  <h1 className="mt-1 text-3xl font-black tracking-tight">
                    {employee.first_name} {employee.last_name}
                  </h1>
                  <p className="mt-1 text-base font-semibold text-slate-300">
                    {employee.designation || "—"}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge className={`rounded-full px-3 py-0.5 text-xs font-bold ${
                      employee.status === "active"
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        : "bg-slate-500/20 text-slate-300 border-slate-500/30"
                    }`}>
                      {employee.status === "active" ? "Active" : employee.status}
                    </Badge>
                    <Badge className="rounded-full bg-white/10 px-3 py-0.5 text-xs font-bold text-white border-white/20">
                      {employee.employee_code}
                    </Badge>
                    {employee.department?.name && (
                      <Badge className="rounded-full bg-blue-500/20 px-3 py-0.5 text-xs font-bold text-blue-300 border-blue-500/30">
                        {employee.department.name}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Quick stats */}
                <div className="hidden lg:grid grid-cols-2 gap-3 shrink-0">
                  {[
                    { label: "Joined", value: formatDate(employee.hire_date) },
                    { label: "DOB", value: formatDate(employee.date_of_birth) },
                    { label: "Email", value: employee.email },
                    { label: "Phone", value: employee.phone || "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-2xl bg-white/8 border border-white/10 px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                      <p className="mt-0.5 text-xs font-bold text-white truncate max-w-[140px]">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Tabs ─────────────────────────────────────────────────── */}
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
              <div className="overflow-x-auto pb-px">
                <TabsList className="inline-flex h-auto gap-1 rounded-2xl bg-slate-100 p-1">
                  {[
                    { value: "profile",    icon: User,       label: "Profile" },
                    { value: "journey",    icon: GitBranch,  label: "Journey" },
                    { value: "leaves",     icon: Calendar,   label: "Leaves" },
                    { value: "attendance", icon: Clock,     label: "Attendance" },
                    { value: "assets",     icon: Package,  label: "Assets" },
                    { value: "reviews",    icon: Star,     label: "Reviews" },
                    { value: "payslips",   icon: Wallet,   label: "Payslips" },
                    { value: "documents",  icon: Files,    label: "Documents" },
                  ].map(({ value, icon: Icon, label }) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-slate-900 text-slate-500"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              {/* ── Profile Tab ─────────────────────────────────────── */}
              <TabsContent value="profile" className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-[320px_1fr]">

                  {/* Left — identity card */}
                  <div className="space-y-4">
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <SectionTitle>Contact Info</SectionTitle>
                      <div className="divide-y divide-slate-50">
                        <InfoRow icon={Mail}      label="Email"      value={employee.email} />
                        <InfoRow icon={Phone}     label="Phone"      value={employee.phone} />
                        <InfoRow icon={MapPin}    label="City"       value={employee.city} />
                        <InfoRow icon={MapPin}    label="Country"    value={employee.country} />
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <SectionTitle>Work Info</SectionTitle>
                      <div className="divide-y divide-slate-50">
                        <InfoRow icon={Briefcase}  label="Designation"        value={employee.designation} />
                        <InfoRow icon={Building2}  label="Department"         value={employee.department?.name} />
                        <InfoRow icon={Users}      label="Reporting Manager"  value={employee.reporting_manager_name} />
                        <InfoRow icon={Calendar}   label="Date of Joining"    value={formatDate(employee.hire_date)} />
                      </div>
                      <div className="mt-4">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={hasPendingRMRequest}
                          onClick={() => setRmChangeOpen(true)}
                          className="w-full rounded-xl text-xs font-bold"
                        >
                          {hasPendingRMRequest ? (
                            <span className="text-amber-600">Manager Change Pending</span>
                          ) : (
                            <>Request Manager Change <ChevronRight className="ml-1 h-3 w-3" /></>
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <SectionTitle>Personal</SectionTitle>
                      <div className="divide-y divide-slate-50">
                        <InfoRow icon={Cake}      label="Date of Birth"  value={formatDate(employee.date_of_birth)} />
                        <InfoRow icon={User}      label="Gender"         value={employee.gender} />
                      </div>
                    </div>
                  </div>

                  {/* Right — editable form */}
                  <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                    {/* form header */}
                    <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
                      <div>
                        <h2 className="text-base font-black text-slate-950">Personal Information</h2>
                        <p className="mt-0.5 text-xs text-slate-500">Update your editable contact & schedule details</p>
                      </div>
                      {!isEditing ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsEditing(true)}
                          className="gap-1.5 rounded-xl text-xs font-bold"
                        >
                          <Edit3 className="h-3.5 w-3.5" /> Edit
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
                            className="gap-1.5 rounded-xl bg-slate-950 text-xs font-bold text-white hover:bg-slate-800"
                          >
                            {updateMutation.isPending
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Save className="h-3.5 w-3.5" />}
                            Save
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-6 p-6">
                      {/* Names — read-only */}
                      <div>
                        <SectionTitle>Identity</SectionTitle>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">First Name</Label>
                            <Input value={employee.first_name} disabled className="rounded-xl bg-slate-50" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Last Name</Label>
                            <Input value={employee.last_name} disabled className="rounded-xl bg-slate-50" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Email</Label>
                            <Input value={employee.email} disabled className="rounded-xl bg-slate-50" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Employee Code</Label>
                            <Input value={employee.employee_code} disabled className="rounded-xl bg-slate-50 font-mono" />
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* Contact — editable */}
                      <div>
                        <SectionTitle>Contact & Location</SectionTitle>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Phone</Label>
                            <Input
                              value={formData.phone}
                              onChange={(e) => setFormData(p => ({ ...p, phone: e.target.value }))}
                              disabled={!isEditing}
                              placeholder="e.g. +91 98765 43210"
                              className="rounded-xl"
                            />
                          </div>
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Address</Label>
                            <Input
                              value={formData.address}
                              onChange={(e) => setFormData(p => ({ ...p, address: e.target.value }))}
                              disabled={!isEditing}
                              placeholder="Street address"
                              className="rounded-xl"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">City</Label>
                            <Input
                              value={formData.city}
                              onChange={(e) => setFormData(p => ({ ...p, city: e.target.value }))}
                              disabled={!isEditing}
                              placeholder="Mumbai"
                              className="rounded-xl"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Country</Label>
                            <Input
                              value={formData.country}
                              onChange={(e) => setFormData(p => ({ ...p, country: e.target.value }))}
                              disabled={!isEditing}
                              placeholder="India"
                              className="rounded-xl"
                            />
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* Personal — editable */}
                      <div>
                        <SectionTitle>Personal Details</SectionTitle>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Date of Birth</Label>
                            <Input
                              type="date"
                              value={formData.date_of_birth}
                              onChange={(e) => setFormData(p => ({ ...p, date_of_birth: e.target.value }))}
                              disabled={!isEditing}
                              max={new Date(new Date().getFullYear() - 18, new Date().getMonth(), new Date().getDate())
                                .toISOString().split("T")[0]}
                              className="rounded-xl"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Gender</Label>
                            <Select
                              value={formData.gender}
                              onValueChange={(v) => setFormData(p => ({ ...p, gender: v }))}
                              disabled={!isEditing}
                            >
                              <SelectTrigger className="rounded-xl">
                                <SelectValue placeholder="Select gender" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="male">Male</SelectItem>
                                <SelectItem value="female">Female</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                                <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      <Separator />

                      {/* Schedule */}
                      <div>
                        <SectionTitle>Working Schedule</SectionTitle>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Start Time</Label>
                            <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:bg-slate-50">
                              {isEditing ? (
                                <Input
                                  type="time"
                                  value={formData.working_hours_start}
                                  onChange={(e) => setFormData(p => ({ ...p, working_hours_start: e.target.value }))}
                                  className="rounded-xl border-0 p-0 shadow-none focus-visible:ring-0"
                                />
                              ) : (
                                <span className="flex items-center gap-2 text-slate-700">
                                  <Clock className="h-4 w-4 text-slate-400" />
                                  {formatTime(formData.working_hours_start)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">End Time</Label>
                            <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                              {isEditing ? (
                                <Input
                                  type="time"
                                  value={formData.working_hours_end}
                                  onChange={(e) => setFormData(p => ({ ...p, working_hours_end: e.target.value }))}
                                  className="rounded-xl border-0 p-0 shadow-none focus-visible:ring-0"
                                />
                              ) : (
                                <span className="flex items-center gap-2 text-slate-700">
                                  <Clock className="h-4 w-4 text-slate-400" />
                                  {formatTime(formData.working_hours_end)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 space-y-2">
                          <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Working Days</Label>
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
                                  className={`h-9 w-12 rounded-xl text-xs font-bold transition-colors ${
                                    active
                                      ? "bg-slate-950 text-white"
                                      : "border border-slate-200 bg-white text-slate-500"
                                  } disabled:opacity-60`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* ── Other Tabs ─────────────────────────────────────────── */}
              <TabsContent value="journey">
                <JourneyTimeline
                  employee={employee}
                  events={journeyEvents}
                  loading={journeyLoading}
                />
              </TabsContent>

              <TabsContent value="leaves" className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="lg:col-span-2 space-y-6">
                    <LeaveBalanceCard employeeId={employee.id} />
                    <LeaveRequestHistory employeeId={employee.id} />
                  </div>
                  <div className="lg:col-span-1">
                    <LeaveRequestForm employeeId={employee.id} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="attendance" className="space-y-6">
                <AttendanceCalendar employeeId={employee.id} />
                <MyAttendanceHistory employeeId={employee.id} />
              </TabsContent>

              <TabsContent value="assets" className="space-y-6">
                <MyAssets employeeId={employee.id} />
              </TabsContent>

              <TabsContent value="reviews" className="space-y-6">
                <MyPerformanceReviews employeeId={employee.id} />
              </TabsContent>

              <TabsContent value="payslips" className="space-y-6">
                <PayslipViewer
                  employeeId={employee.id}
                  employeeName={`${employee.first_name} ${employee.last_name}`}
                  employeeCode={employee.employee_code}
                />
              </TabsContent>

              <TabsContent value="documents" className="space-y-6">
                <TaxDocumentsViewer employeeId={employee.id} />
                <EmployeeDocuments employeeId={employee.id} />
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
    </DashboardLayout>
  );
};

export default Profile;
