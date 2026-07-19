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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2, User, Mail, Phone, MapPin, Building2, Calendar,
    Briefcase, Save, Clock, Wallet, Files, Package, Star,
    Users, Cake, Edit3, X, ChevronRight, GitBranch, Landmark,
    HeartHandshake,
} from "lucide-react";
import { PhotoUpload } from "@/components/employee/PhotoUpload";
import { useToast } from "@/hooks/use-toast";
import { useAuth, useIsReadOnly } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
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
import { EmployeeJourneyTimeline } from "@/components/employees/EmployeeJourneyTimeline";
import {
  BankStatutoryDetails,
  EmergencyNomineeDetails,
} from "@/components/profile/ProfileSensitiveDetails";

interface ProfileForm {
  official_email: string;
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
  // Use UTC to avoid timezone offset issues
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "—";
  }
  return date.toLocaleDateString("en-IN", {
    year: "numeric", month: "long", day: "numeric",
    timeZone: "UTC",
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
        <Icon className="h-4 w-4 text-slate-700" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
        <p className="mt-1 break-words text-base font-extrabold leading-6 text-slate-950 uppercase">{value || "—"}</p>
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

const Profile = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdminOrHR } = useIsAdminOrHR();
  const isReadOnly = useIsReadOnly();

  const tabParam = (searchParams.get("tab") || "").toLowerCase();
  const allowedTabs = ["profile", "statutory", "emergency", "journey", "leaves", "attendance", "assets", "reviews", "payslips", "documents"] as const;
  const initialTab = allowedTabs.includes(tabParam as (typeof allowedTabs)[number]) ? tabParam : "profile";

  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [isEditing, setIsEditing] = useState(false);
  const [rmChangeOpen, setRmChangeOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProfileForm>({
    official_email: "", mobile: "", personal_email: "", personal_phone: "", alternate_mobile: "", address_line1: "", city: "",
    date_of_birth: "", gender: "", marital_status: "", blood_group: "",
    working_hours_start: "09:00", working_hours_end: "18:00",
    working_days: [1, 2, 3, 4, 5, 6], // Default: Mon-Sat (Sunday off)
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

  useEffect(() => {
    if (employee) {
      if (!avatarUrl) setAvatarUrl(employee.avatar_url ?? null);
      const fmt = (t: string | null) => (t ? t.slice(0, 5) : "");
      setFormData({
        official_email: employee.official_email || "",
        mobile: employee.mobile || "",
        personal_email: employee.personal_email || "",
        personal_phone: employee.personal_phone || "",
        alternate_mobile: employee.alternate_mobile || "",
        address_line1: employee.address_line1 || employee.address || "",
        city: employee.city || "",
        date_of_birth: employee.date_of_birth
          ? employee.date_of_birth.slice(0, 10)
          : "",
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
      console.error("[Profile Save Error]", err);
      const msg = err.message || "Failed to save profile. Check console and network tab.";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const cancelEdit = () => {
    setIsEditing(false);
    const fmt = (t: string | null) => (t ? t.slice(0, 5) : "");
    if (employee) setFormData({
      official_email: employee.official_email || "",
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
            <div className="relative overflow-hidden rounded-3xl bg-[#073f78] px-6 py-8 text-white shadow-lg">
              {/* decorative blobs */}
              <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[#1B6AB5]/20 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-10 left-1/3 h-48 w-48 rounded-full bg-[#3BAD49]/15 blur-3xl" />

              <div className="relative flex flex-col gap-7 lg:flex-row lg:items-center">
                {/* Avatar */}
                <div className="shrink-0">
                  <PhotoUpload
                    currentUrl={avatarUrl}
                    displayName={`${employee.first_name} ${employee.last_name}`}
                    onSuccess={async (url) => {
                      console.log("[Profile] Photo upload success, URL:", url);
                      // Add cache-busting timestamp to force browser reload
                      const cacheBustedUrl = url ? `${url}?t=${Date.now()}` : null;
                      setAvatarUrl(cacheBustedUrl);
                      // Hard remove queries to force fresh fetch
                      queryClient.removeQueries({ queryKey: ["my-profile"] });
                      queryClient.removeQueries({ queryKey: ["employee-profile"] });
                      console.log("[Profile] Refetching employee data...");
                      const result = await refetch();
                      console.log("[Profile] Refetch complete:", result.data?.avatar_url);
                    }}
                    size="2xl"
                  />
                </div>

                {/* Identity */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black uppercase tracking-[0.2em] text-green-200">
                    Employee Profile
                  </p>
                  <h1 className="mt-2 text-balance text-3xl font-black tracking-tight sm:text-4xl break-words">
                    {employee.first_name} {employee.last_name}
                  </h1>
                  <p className="mt-2 text-lg font-bold text-blue-100">
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
                      <Badge className="rounded-full border px-4 py-1 text-sm font-extrabold" style={{ background: "rgba(27,106,181,0.3)", color: "#d9ecff", borderColor: "rgba(139,189,233,0.55)" }}>
                        {employee.department.name}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Quick stats */}
                <div className="grid shrink-0 grid-cols-2 gap-3 lg:w-[420px]">
                  {[
                    { label: "Joined", value: formatDate(employee.date_of_joining) },
                    { label: "DOB", value: formatDate(employee.date_of_birth) },
                    { label: "Email", value: employee.official_email || employee.email },
                    { label: "Phone", value: employee.mobile || "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-2xl border border-white/20 bg-white/10 px-4 py-4">
                      <p className="text-xs font-black uppercase tracking-widest text-blue-200">{label}</p>
                      <p className="mt-1 truncate text-sm font-bold text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Tabs ─────────────────────────────────────────────────── */}
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
              <div className="overflow-x-auto pb-px">
                <TabsList className="inline-flex h-auto gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
                  {[
                    { value: "profile",    icon: User,       label: "Profile" },
                    { value: "statutory",  icon: Landmark,   label: "Bank & Statutory" },
                    { value: "emergency",  icon: HeartHandshake, label: "Emergency & Nominee" },
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
                      className="gap-2 rounded-xl px-4 py-3 text-sm font-extrabold text-slate-600 data-[state=active]:bg-[#e8f2fc] data-[state=active]:text-[#073f78] data-[state=active]:shadow-sm"
                    >
                      <Icon className="h-4 w-4" />
                      <span>{label}</span>
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
                        <InfoRow icon={Mail}      label="Official Email" value={employee.official_email || employee.email} />
                        <InfoRow icon={Phone}     label="Phone"      value={employee.mobile} />
                        <InfoRow icon={Phone}     label="Alternate"  value={employee.alternate_mobile} />
                        <InfoRow icon={MapPin}    label="City"       value={employee.city} />
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <SectionTitle>Work Info</SectionTitle>
                      <div className="divide-y divide-slate-50">
                        <InfoRow icon={Briefcase}  label="Designation"        value={employee.designation} />
                        <InfoRow icon={Building2}  label="Department"         value={employee.department?.name} />
                        <InfoRow icon={Users}      label="Reporting Manager"  value={employee.reporting_manager_name} />
                        <InfoRow icon={Calendar}   label="Date of Joining"    value={formatDate(employee.date_of_joining)} />
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setChangePasswordOpen(true)}
                          className="w-full rounded-xl text-xs font-bold"
                        >
                          Change Password
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <SectionTitle>Personal</SectionTitle>
                      <div className="divide-y divide-slate-50">
                        <InfoRow icon={Cake}      label="Date of Birth"  value={formatDate(employee.date_of_birth)} />
                        <InfoRow icon={User}      label="Gender"         value={employee.gender} />
                        <InfoRow icon={HeartHandshake} label="Marital Status" value={employee.marital_status} />
                        <InfoRow icon={User} label="Blood Group" value={employee.blood_group} />
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
                          disabled={isReadOnly}
                          className="gap-1.5 rounded-xl text-xs font-bold"
                          title={isReadOnly ? "Cannot edit in read-only mode" : ""}
                        >
                          <Edit3 className="h-3.5 w-3.5" /> {isReadOnly ? "Read-Only" : "Edit"}
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
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Official Email</Label>
                            <Input
                              type="email"
                              value={formData.official_email}
                              onChange={(e) => setFormData(p => ({ ...p, official_email: e.target.value.toLowerCase() }))}
                              disabled={!isEditing}
                              placeholder="name@teammas.in"
                              className="rounded-xl"
                            />
                            <p className={`text-xs font-semibold ${employee.official_email_compliant ? "text-emerald-600" : "text-amber-600"}`}>
                              {employee.official_email_compliant
                                ? "Official email verified"
                                : "Use @teammas.in or @teammas.co.in"}
                            </p>
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
                              value={formData.mobile}
                              onChange={(e) => setFormData(p => ({ ...p, mobile: e.target.value }))}
                              disabled={!isEditing}
                              placeholder="e.g. +91 98765 43210"
                              className="rounded-xl"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Personal Email</Label>
                            <Input
                              type="email"
                              value={formData.personal_email}
                              onChange={(e) => setFormData(p => ({ ...p, personal_email: e.target.value.toLowerCase() }))}
                              disabled={!isEditing}
                              placeholder="personal@gmail.com"
                              className="rounded-xl"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Personal Phone</Label>
                            <Input
                              type="tel"
                              value={formData.personal_phone}
                              onChange={(e) => setFormData(p => ({ ...p, personal_phone: e.target.value }))}
                              disabled={!isEditing}
                              placeholder="+91 98765 43210"
                              className="rounded-xl"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Alternate Number</Label>
                            <Input
                              type="tel"
                              value={formData.alternate_mobile}
                              onChange={(e) => setFormData(p => ({ ...p, alternate_mobile: e.target.value }))}
                              disabled={!isEditing}
                              placeholder="Alternate contact number"
                              className="rounded-xl"
                            />
                          </div>
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Address</Label>
                            <Input
                              value={formData.address_line1}
                              onChange={(e) => setFormData(p => ({ ...p, address_line1: e.target.value }))}
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
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">State</Label>
                            <Input
                              value={(formData as any).state || ""}
                              onChange={(e) => setFormData(p => ({ ...p, state: e.target.value } as any))}
                              disabled={!isEditing}
                              placeholder="Delhi"
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
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Marital Status</Label>
                            <Select
                              value={formData.marital_status}
                              onValueChange={(v) => setFormData(p => ({ ...p, marital_status: v }))}
                              disabled={!isEditing}
                            >
                              <SelectTrigger className="rounded-xl">
                                <SelectValue placeholder="Select marital status" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="single">Single</SelectItem>
                                <SelectItem value="married">Married</SelectItem>
                                <SelectItem value="divorced">Divorced</SelectItem>
                                <SelectItem value="widowed">Widowed</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Blood Group</Label>
                            <Input
                              value={formData.blood_group}
                              onChange={(e) => setFormData(p => ({ ...p, blood_group: e.target.value.toUpperCase() }))}
                              disabled={!isEditing}
                              placeholder="e.g. O+"
                              maxLength={10}
                              className="rounded-xl"
                            />
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
              <TabsContent value="statutory">
                <BankStatutoryDetails employee={employee} allowStatutoryEdit={isAdminOrHR} />
              </TabsContent>

              <TabsContent value="emergency">
                <EmergencyNomineeDetails employee={employee} />
              </TabsContent>

              <TabsContent value="journey">
                <EmployeeJourneyTimeline
                  employeeName={`${employee.first_name} ${employee.last_name}`}
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
                <EmployeeDocuments
                  employeeId={employee.id}
                  canUpload={isAdminOrHR}
                  canDelete={isAdminOrHR}
                />
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

export default Profile;
