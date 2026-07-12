import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Download, ChevronDown, ChevronRight, User, Shield, Briefcase, LogOut, Settings, Clock } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  ts: string;
  category: string;
  event: string;
  description: string;
  actor: string;
  details: Record<string, unknown>;
}

interface EmployeeProfile {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  mobile: string;
  gender: string;
  date_of_birth: string;
  date_of_joining: string;
  salary_start_date: string;
  date_of_exit: string | null;
  employment_type: string;
  employment_status: string;
  branch_name: string;
  department_name: string;
  process_name: string;
  designation_name: string;
  reporting_manager_name: string;
}

interface ReportData {
  employee: EmployeeProfile;
  ats_profile: Record<string, unknown> | null;
  exit_request: Record<string, unknown> | null;
  provisioning_tasks: Record<string, unknown>[];
  timeline: TimelineEvent[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  ATS:          { label: "Recruitment",   color: "bg-violet-100 text-violet-700 border-violet-200",  icon: <Briefcase className="h-3.5 w-3.5" /> },
  JOINING:      { label: "Joining",       color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: <User className="h-3.5 w-3.5" /> },
  PROVISIONING: { label: "Provisioning",  color: "bg-sky-100 text-sky-700 border-sky-200",           icon: <Settings className="h-3.5 w-3.5" /> },
  LIFECYCLE:    { label: "Lifecycle",     color: "bg-amber-100 text-amber-700 border-amber-200",      icon: <Clock className="h-3.5 w-3.5" /> },
  AUDIT:        { label: "Audit",         color: "bg-slate-100 text-slate-600 border-slate-200",      icon: <Shield className="h-3.5 w-3.5" /> },
  EXIT:         { label: "Exit",          color: "bg-rose-100 text-rose-700 border-rose-200",         icon: <LogOut className="h-3.5 w-3.5" /> },
};

function fmt(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="min-w-[130px] text-slate-500 font-medium">{label}</span>
      <span className="text-slate-800 break-all">{String(value)}</span>
    </div>
  );
}

function EventCard({ event, index }: { event: TimelineEvent; index: number }) {
  const [open, setOpen] = useState(false);
  const meta = CATEGORY_META[event.category] ?? CATEGORY_META.AUDIT;
  const hasDetails = Object.keys(event.details).length > 0;

  return (
    <div className="relative flex gap-4">
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-white shadow-sm ring-1 ring-slate-200 ${meta.color.split(" ").slice(0, 2).join(" ")}`}>
          {meta.icon}
        </div>
        <div className="mt-1 w-px flex-1 bg-slate-200" />
      </div>

      {/* Card */}
      <div className="mb-4 flex-1 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div
          className={`flex items-start justify-between gap-3 p-3 ${hasDetails ? "cursor-pointer hover:bg-slate-50/60" : ""}`}
          onClick={() => hasDetails && setOpen((o) => !o)}
        >
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`text-[10px] font-bold px-1.5 py-0.5 ${meta.color}`}>
                {meta.label}
              </Badge>
              <span className="text-xs font-mono text-slate-400">{event.event}</span>
              <span className="text-[10px] text-slate-400">#{index + 1}</span>
            </div>
            <p className="text-sm font-semibold text-slate-800 leading-snug">{event.description}</p>
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 mt-0.5">
              <span>🕐 {fmt(event.ts)}</span>
              <span>👤 {event.actor}</span>
            </div>
          </div>
          {hasDetails && (
            <button className="mt-0.5 shrink-0 text-slate-400 hover:text-slate-600">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </div>

        {open && hasDetails && (
          <div className="border-t border-slate-100 px-3 pb-3 pt-2.5 flex flex-col gap-1.5 bg-slate-50/60 rounded-b-xl">
            {Object.entries(event.details).map(([k, v]) => (
              <DetailRow key={k} label={k.replace(/_/g, " ")} value={v} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NativeComplianceAuditReport() {
  const [employeeCode, setEmployeeCode] = useState("");
  const [searchCode, setSearchCode]     = useState("");

  // First resolve employee code → id
  const { data: empList, isFetching: searching } = useQuery({
    queryKey: ["compliance-emp-search", searchCode],
    queryFn: async () => {
      if (!searchCode.trim()) return null;
      const res = await hrmsApi.get<{ success: boolean; data: { id: string; employee_code: string; full_name: string }[] }>(
        `/api/employees?search=${encodeURIComponent(searchCode.trim())}&limit=10`
      );
      return res.data ?? [];
    },
    enabled: !!searchCode.trim(),
  });

  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);

  const { data: report, isFetching: loadingReport, error } = useQuery({
    queryKey: ["compliance-report", selectedEmpId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: ReportData }>(
        `/api/lifecycle/employees/${selectedEmpId}/compliance-report`
      );
      return res.data as ReportData;
    },
    enabled: !!selectedEmpId,
  });

  function handleSearch() {
    setSelectedEmpId(null);
    setSearchCode(employeeCode);
  }

  function downloadReport() {
    if (!report) return;
    const lines: string[] = [
      `JOINER/LEAVER COMPLIANCE AUDIT REPORT`,
      `Employee: ${report.employee.full_name} (${report.employee.employee_code})`,
      `Status: ${report.employee.employment_status} | Joining: ${fmtDate(report.employee.date_of_joining)} | Exit: ${fmtDate(report.employee.date_of_exit)}`,
      `Generated: ${new Date().toLocaleString("en-IN")}`,
      ``,
      `TIMELINE (${report.timeline.length} events)`,
      `─────────────────────────────────────────────────────────────────`,
    ];
    report.timeline.forEach((ev, i) => {
      lines.push(`#${i + 1} [${ev.category}] ${fmt(ev.ts)} | ${ev.actor}`);
      lines.push(`   ${ev.description}`);
      const d = ev.details;
      if (Object.keys(d).length) {
        Object.entries(d).forEach(([k, v]) => {
          if (v != null && v !== "") lines.push(`   ${k}: ${v}`);
        });
      }
      lines.push(``);
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-report-${report.employee.employee_code}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const emp = report?.employee;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Joiner / Leaver Compliance Report</h1>
          <p className="mt-1 text-sm text-slate-500">Full audit trail per employee — every event, actor, timestamp and approval for compliance.</p>
        </div>

        {/* Search */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Search Employee</p>
          <div className="flex gap-2">
            <Input
              placeholder="Employee code or name…"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="min-h-[44px]"
            />
            <Button onClick={handleSearch} disabled={searching} className="min-h-[44px] bg-[#1B6AB5] hover:bg-[#155a9a]">
              <Search className="h-4 w-4" />
            </Button>
          </div>

          {/* Search results dropdown */}
          {empList && empList.length > 0 && !selectedEmpId && (
            <div className="mt-2 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
              {empList.map((e) => (
                <button
                  key={e.id}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left border-b last:border-b-0 border-slate-100"
                  onClick={() => { setSelectedEmpId(e.id); setSearchCode(""); }}
                >
                  <span className="font-mono text-xs text-slate-400 min-w-[80px]">{e.employee_code}</span>
                  <span className="text-sm font-semibold text-slate-800">{e.full_name}</span>
                </button>
              ))}
            </div>
          )}
          {empList && empList.length === 0 && (
            <p className="mt-2 text-xs text-slate-400">No employees found.</p>
          )}
        </div>

        {loadingReport && (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading compliance report…</div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Failed to load report. {String(error)}
          </div>
        )}

        {report && emp && (
          <>
            {/* Employee profile card */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-[#061e40] to-[#0a2d5a] px-5 py-4">
                <div>
                  <p className="text-lg font-black text-white">{emp.full_name}</p>
                  <p className="text-xs font-mono text-white/60 mt-0.5">{emp.employee_code}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`text-xs font-bold ${emp.employment_status === "Active" ? "bg-emerald-500" : emp.employment_status === "Exited" ? "bg-rose-500" : "bg-amber-500"} text-white border-0`}>
                    {emp.employment_status}
                  </Badge>
                  <Button size="sm" variant="outline" className="gap-1.5 bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white" onClick={downloadReport}>
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 p-5 sm:grid-cols-3">
                {[
                  ["Designation",    emp.designation_name],
                  ["Department",     emp.department_name],
                  ["Process",        emp.process_name],
                  ["Branch",         emp.branch_name],
                  ["Employment Type",emp.employment_type],
                  ["Date of Joining",fmtDate(emp.date_of_joining)],
                  ["Salary Start",   fmtDate(emp.salary_start_date)],
                  ["Date of Exit",   fmtDate(emp.date_of_exit)],
                  ["Manager",        emp.reporting_manager_name],
                  ["Email",          emp.email],
                  ["Mobile",         emp.mobile],
                  ["Gender",         emp.gender],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
                    <span className="text-sm font-semibold text-slate-800">{value || "—"}</span>
                  </div>
                ))}
              </div>

              {/* Summary stats */}
              <div className="flex flex-wrap gap-px border-t border-slate-100">
                {[
                  ["Total Events",        report.timeline.length],
                  ["Provisioning Tasks",  report.provisioning_tasks.length],
                  ["ATS Trail",           report.ats_profile ? "Yes" : "No"],
                  ["Exit Request",        report.exit_request ? "Yes" : "No"],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex flex-1 flex-col items-center justify-center py-3 px-4 bg-slate-50 min-w-[90px]">
                    <span className="text-lg font-black text-slate-900">{String(value)}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">{String(label)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Category filter pills */}
            <FilteredTimeline timeline={report.timeline} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

// ── Filtered Timeline ─────────────────────────────────────────────────────────

function FilteredTimeline({ timeline }: { timeline: TimelineEvent[] }) {
  const [activeCategory, setActiveCategory] = useState<string>("ALL");

  const categories = ["ALL", ...Array.from(new Set(timeline.map((e) => e.category)))];

  const filtered = activeCategory === "ALL"
    ? timeline
    : timeline.filter((e) => e.category === activeCategory);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black text-slate-900">
          Audit Timeline <span className="ml-1 text-sm font-normal text-slate-400">({filtered.length} events)</span>
        </h2>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => {
          const meta = cat === "ALL" ? null : CATEGORY_META[cat];
          const count = cat === "ALL" ? timeline.length : timeline.filter((e) => e.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-all
                ${activeCategory === cat
                  ? (meta?.color ?? "bg-slate-900 text-white border-slate-900")
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                }`}
            >
              {meta?.icon}
              {cat === "ALL" ? "All" : (meta?.label ?? cat)} ({count})
            </button>
          );
        })}
      </div>

      {/* Timeline */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No events in this category.</p>
        ) : (
          filtered.map((ev, i) => (
            <EventCard key={`${ev.ts}-${i}`} event={ev} index={timeline.indexOf(ev)} />
          ))
        )}
      </div>
    </div>
  );
}
