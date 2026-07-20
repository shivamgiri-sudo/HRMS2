import { useQuery } from "@tanstack/react-query";
import { Umbrella, FileText, Clock, BookOpen, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import { useEmployeeProfile } from "@/hooks/useEmployeeProfile";
import { LeaveBalanceTable } from "../widgets/LeaveBalanceTable";
import { useDashboardUser } from "../widgets/useDashboardUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function EmployeeLayout() {
  const { firstName } = useDashboardUser();
  const { data: profile } = useEmployeeProfile();
  const employeeId = profile?.id ?? "";

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = `${currentMonth}-01`;
  const monthEnd = `${currentMonth}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const dataTimestamp = now.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) +
    ", " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " AM";

  const { data: attData } = useQuery<any>({
    queryKey: ["attendance-monthly", employeeId, currentMonth],
    queryFn: () => hrmsApi.get(`/api/wfm/attendance/ncosec-monthly?employeeId=${employeeId}&fromDate=${monthStart}&toDate=${monthEnd}&limit=500`),
    enabled: !!employeeId,
    staleTime: 1000 * 60 * 5,
  });

  const { data: leaveReqs } = useQuery<any>({
    queryKey: ["my-leave-requests"],
    queryFn: () => hrmsApi.get("/api/leave/requests"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: engData } = useQuery<any>({
    queryKey: ["dashboard-engagement-me"],
    queryFn: () => hrmsApi.get("/api/engagement/me"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: empSummary } = useQuery<any>({
    queryKey: ["dashboard-employee-summary"],
    queryFn: () => hrmsApi.get("/api/dashboards/employee/summary"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: actionsData } = useQuery<any>({
    queryKey: ["my-actions"],
    queryFn: () => hrmsApi.get("/api/work-inbox/my-actions"),
    staleTime: 1000 * 60 * 5,
  });
  // TODO: Verify /api/dashboards/employee/summary endpoint exists and returns expected fields
  // If different endpoint pattern exists, adjust queryFn accordingly

  // Attendance computed from WFM daily records — filter to current month
  const allRecords: any[] = Array.isArray(attData?.data) ? attData.data : [];
  const monthRecords = allRecords.filter((r: any) => (r.date ?? "").startsWith(currentMonth));
  const presentDays = monthRecords.filter((r: any) => r.status === "present").length;
  const absentDays  = monthRecords.filter((r: any) => r.status === "absent").length;
  const lateDays    = monthRecords.filter((r: any) => r.status === "late").length;
  const totalDays   = presentDays + absentDays + lateDays;
  const attPct      = totalDays > 0 ? ((presentDays / totalDays) * 100).toFixed(1) : "0.0";

  // Leave requests
  const requests: any[] = Array.isArray(leaveReqs?.data) ? leaveReqs.data : [];
  const pendingRequests = requests.filter((r: any) => r.status === "pending");

  // Engagement
  const eng = engData?.data ?? {};
  const badges: any[] = Array.isArray(eng.badges_earned) ? eng.badges_earned : [];

  // Onboarding metrics
  const onbDetail = empSummary?.data?.metrics?.onb?.detail ?? {};
  const onbSteps = onbDetail.submitted ?? 0;
  const onbTotal = (onbDetail.submitted ?? 0) + (onbDetail.pending ?? 0) + (onbDetail.stuck ?? 0);
  const onbPct = onbTotal > 0 ? Math.round((onbSteps / onbTotal) * 100) : 0;

  // Work inbox items
  const actions: any[] = Array.isArray(actionsData?.data)
    ? actionsData.data.filter((a: any) => a.status !== "completed").slice(0, 4)
    : [];

  // Build work inbox from real data only: pending leave requests + real actions from API
  const workInboxItems = [
    ...pendingRequests.slice(0, 2).map((r: any) => ({
      icon: <Umbrella className="w-4 h-4 text-slate-500" />,
      title: "Leave Request – Pending Approval",
      subtitle: `${r.leave_name ?? r.leave_type ?? "Leave"} · ${r.from_date ?? ""}`,
      badge: 1,
      time: r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—",
    })),
    ...actions.slice(0, 3).map((a: any) => ({
      icon: <Clock className="w-4 h-4 text-slate-500" />,
      title: a.title ?? a.item_type ?? "Action Required",
      subtitle: a.description ?? a.detail ?? "",
      badge: a.is_overdue ? 1 : 0,
      time: a.due_at ? new Date(a.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—",
    })),
  ].filter(Boolean).slice(0, 4);

  const quickLinks = [
    { label: "Apply Leave",    subtitle: "Request time off",       href: "/leaves",       icon: <Umbrella className="w-5 h-5 text-[#1B6AB5]" />,  bg: "bg-blue-50"   },
    { label: "View Payslip",   subtitle: "Check your salary details", href: "/payroll/payslips",   icon: <FileText className="w-5 h-5 text-emerald-600" />,  bg: "bg-emerald-50"},
    { label: "Raise Helpdesk", subtitle: "Get support for issues",   href: "/helpdesk",   icon: <Clock className="w-5 h-5 text-amber-600" />,     bg: "bg-amber-50"  },
    { label: "View Documents", subtitle: "Access your documents",    href: "/profile",  icon: <FileText className="w-5 h-5 text-violet-600" />,  bg: "bg-violet-50" },
  ];

  return (
    <div className="space-y-6">
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome, {firstName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-slate-500">Your personal dashboard</p>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              <Sparkles className="w-3 h-3" /> Self Service
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-400 flex-shrink-0 mt-1">Data as of {dataTimestamp} ↺</p>
      </div>

      {/* ── ROW 1: My Attendance This Month (4 flat stat tiles) ── */}
      <div>
        <p className="text-base font-bold text-slate-800 mb-3">My Attendance This Month</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Present */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Present</p>
              <p className="text-3xl font-black text-slate-900 leading-tight" style={{ fontFamily: "'Fira Code', monospace" }}>{presentDays}</p>
              <p className="text-xs text-slate-500">Days</p>
            </div>
          </div>
          {/* Absent */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wide">Absent</p>
              <p className="text-3xl font-black text-slate-900 leading-tight" style={{ fontFamily: "'Fira Code', monospace" }}>{absentDays}</p>
              <p className="text-xs text-slate-500">Day{absentDays !== 1 ? "s" : ""}</p>
            </div>
          </div>
          {/* Late */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" /></svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Late</p>
              <p className="text-3xl font-black text-slate-900 leading-tight" style={{ fontFamily: "'Fira Code', monospace" }}>{lateDays}</p>
              <p className="text-xs text-slate-500">Days</p>
            </div>
          </div>
          {/* Attendance % */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Attendance %</p>
              <p className="text-3xl font-black text-slate-900 leading-tight" style={{ fontFamily: "'Fira Code', monospace" }}>{attPct}%</p>
              <p className="text-xs text-slate-500">This Month</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── ROW 2: My Training Status | AI Brief ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My Training Status */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">My Training Status</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {/* Completion */}
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center">
                  <BookOpen className="w-7 h-7 text-violet-500" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Completion</p>
                  <p className="text-2xl font-black text-slate-900" style={{ fontFamily: "'Fira Code', monospace" }}>
                    {eng.progress_percentage ? `${Math.round(eng.progress_percentage)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-slate-400">{badges.length > 0 ? `${badges.length} course${badges.length !== 1 ? "s" : ""} completed` : "No courses yet"}</p>
                </div>
              </div>
              {/* MCQ / Points as proxy */}
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <svg className="w-7 h-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" /></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Points</p>
                  <p className="text-2xl font-black text-slate-900" style={{ fontFamily: "'Fira Code', monospace" }}>
                    {(eng.total_points ?? 0).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-400">Total Earned</p>
                </div>
              </div>
              {/* Tier */}
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
                  <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tier Level</p>
                  <p className="text-2xl font-black text-slate-900" style={{ fontFamily: "'Fira Code', monospace" }}>
                    {eng.current_tier?.tier_level ?? "—"}
                  </p>
                  <p className="text-[10px] text-slate-400">{eng.current_tier?.tier_name ?? "Bronze"}</p>
                </div>
              </div>
              {/* Badges */}
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
                  <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Badges</p>
                  <p className="text-2xl font-black text-slate-900" style={{ fontFamily: "'Fira Code', monospace" }}>
                    {badges.length}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {badges[0]?.badge_name ?? "Achievements"}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Attendance & Leave AI Brief */}
        <div
          className="rounded-2xl border border-violet-200 overflow-hidden relative"
          style={{ background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 60%, #ddd6fe 100%)" }}
        >
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-violet-600 text-white">
                <Sparkles className="w-3 h-3" /> AI
              </span>
              <p className="text-sm font-bold text-slate-900">Attendance &amp; Leave AI Brief</p>
            </div>
            <div className="space-y-2 text-sm text-slate-700 leading-relaxed">
              {parseFloat(attPct) >= 80 ? (
                <>
                  <p>Great job! Your attendance this month is <span className="font-semibold text-slate-900">{attPct}%</span>, which is above the target threshold.</p>
                  <p>You have <span className="font-semibold text-slate-900">{leaveReqs?.data ? requests.filter((r:any) => r.status === "approved" || r.status === "pending").length : "—"}</span> leave requests this cycle.</p>
                  <p>Keep maintaining consistency!</p>
                </>
              ) : (
                <>
                  <p>Your attendance this month is <span className="font-semibold text-red-700">{attPct}%</span>. Please ensure regular attendance.</p>
                  <p>You have {absentDays} absent day{absentDays !== 1 ? "s" : ""} and {lateDays} late arrival{lateDays !== 1 ? "s" : ""} this month.</p>
                </>
              )}
            </div>
            <p className="mt-4 text-[11px] text-violet-600 font-semibold flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Insights powered by AI
            </p>
          </div>
          {/* Decorative illustration placeholder */}
          <div className="absolute right-4 bottom-4 opacity-20 pointer-events-none">
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none"><rect x="10" y="10" width="60" height="60" rx="12" stroke="#7c3aed" strokeWidth="2"/><path d="M20 40h40M40 20v40" stroke="#7c3aed" strokeWidth="2"/></svg>
          </div>
        </div>
      </div>

      {/* ── My Onboarding Status ──────────────────────────────── */}
      {(onbTotal > 0 || empSummary) && (
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">My Onboarding Status</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 mt-1">
                <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Stage: <span className="text-slate-600">Joining Completion</span></p>
                    <p className="text-xs text-slate-500 mt-0.5">Completed Steps: {onbSteps} / {onbTotal || 12}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-2xl font-black text-slate-900 leading-none" style={{ fontFamily: "'Fira Code', monospace" }}>{onbPct > 0 ? `${onbPct}%` : "—"}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Complete</p>
                  </div>
                </div>
                {/* Progress bar — max-w so it doesn't span full card width */}
                <div className="max-w-md">
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full transition-all duration-700"
                      style={{ width: `${onbPct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── ROW 3: My Leave Balance | Work Inbox ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LeaveBalanceTable />

        {/* Work Inbox */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">Work Inbox</CardTitle>
            <Link to="/work-inbox" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All →</Link>
          </CardHeader>
          <CardContent className="p-0">
            {workInboxItems.map((item, i) => (
              <Link
                key={i}
                to="/work-inbox"
                className="flex items-start gap-3 px-5 py-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors group"
              >
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                  <p className="text-xs text-slate-500 truncate">{item.subtitle}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {item.badge > 0 && (
                    <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{item.badge}</span>
                  )}
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">{item.time}</span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── ROW 4: Quick Links (horizontal rows with arrows) ── */}
      <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
        <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
          <CardTitle className="text-sm font-bold text-slate-900">Quick Links</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {quickLinks.map((ql, i) => (
              <Link
                key={i}
                to={ql.href}
                className="flex items-center gap-4 px-5 py-4 border-b sm:border-b-0 sm:border-r border-slate-100 last:border-0 hover:bg-slate-50 transition-colors group"
              >
                <div className={`w-10 h-10 rounded-xl ${ql.bg} flex items-center justify-center flex-shrink-0`}>
                  {ql.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{ql.label}</p>
                  <p className="text-xs text-slate-500">{ql.subtitle}</p>
                </div>
                <svg className="w-4 h-4 text-slate-400 group-hover:text-slate-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
