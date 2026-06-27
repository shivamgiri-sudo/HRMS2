/**
 * Employee BGV Status — dual-purpose page:
 *  • Employee self-view: own BGV checks, status, and HR-issued report
 *  • Employer/HR view: look up any employee's BGV by employee ID
 *
 * Routes:
 *  /employees/bgv-status            → employee self-view (GET /api/bgv/employee/me)
 *  /employees/bgv-status/:employeeId → HR/admin lookup (GET /api/bgv/employee/:id)
 */
import { useState, useRef } from "react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  BookOpen,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FileText,
  Fingerprint,
  GraduationCap,
  Info,
  Lock,
  MapPin,
  RefreshCw,
  Shield,
  ShieldAlert,
  User,
  XCircle,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckStatus = "verified" | "mismatch" | "failed" | "manual_review" | "queued" | "waived" | "pending";
type OverallStatus = "clear" | "conditional" | "hold" | "pending" | "no_bgv_record";

interface BgvCheck {
  id: string;
  check_type: string;
  status: CheckStatus;
  match_score: number | null;
  matched_name: string | null;
  matched_dob: string | null;
  result_summary: string | null;
  risk_flags_json: string | null;
  verified_at: string | null;
  updated_at: string;
  provider_key: string | null;
}

interface BgvReport {
  overall_verdict: string | null;
  report_date: string | null;
  hr_comments: string | null;
  aadhaar_status: string | null;
  pan_status: string | null;
  bank_status: string | null;
  education_status: string | null;
  employment_status: string | null;
  court_status: string | null;
  locked_at: string | null;
}

interface EmployeeBgvData {
  employeeId: string;
  candidateId: string | null;
  employeeName: string;
  status: OverallStatus;
  message?: string;
  score: number;
  overall_status: OverallStatus;
  checks: BgvCheck[];
  missing_mandatory_checks: string[];
  employee_creation_ready: boolean;
  payroll_activation_ready: boolean;
  consent: { consent_status: string; granted_at: string } | null;
  report: BgvReport | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHECK_META: Record<string, { label: string; icon: React.ReactNode }> = {
  aadhaar:     { label: "Aadhaar",          icon: <Fingerprint className="size-4" /> },
  pan:         { label: "PAN",              icon: <FileText className="size-4" /> },
  bank:        { label: "Bank Account",     icon: <Banknote className="size-4" /> },
  address:     { label: "Address Doc",      icon: <MapPin className="size-4" /> },
  education:   { label: "Education",        icon: <GraduationCap className="size-4" /> },
  experience:  { label: "Employment",       icon: <Briefcase className="size-4" /> },
  court:       { label: "Court / Criminal", icon: <Shield className="size-4" /> },
  photo_match: { label: "Photo Match",      icon: <User className="size-4" /> },
};

const STATUS_CONFIG: Record<CheckStatus, { color: string; icon: React.ReactNode; label: string }> = {
  verified:      { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="size-3.5" />, label: "Verified" },
  mismatch:      { color: "bg-amber-50 text-amber-700 border-amber-200",       icon: <AlertTriangle className="size-3.5" />, label: "Mismatch" },
  failed:        { color: "bg-rose-50 text-rose-700 border-rose-200",           icon: <XCircle className="size-3.5" />, label: "Failed" },
  manual_review: { color: "bg-blue-50 text-blue-700 border-blue-200",           icon: <Clock className="size-3.5" />, label: "Under Review" },
  queued:        { color: "bg-slate-50 text-slate-500 border-slate-200",        icon: <Clock className="size-3.5" />, label: "Queued" },
  waived:        { color: "bg-purple-50 text-purple-700 border-purple-200",     icon: <BadgeCheck className="size-3.5" />, label: "Waived" },
  pending:       { color: "bg-slate-50 text-slate-400 border-slate-200",        icon: <Clock className="size-3.5" />, label: "Pending" },
};

const VERDICT_CONFIG: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  clear:      { color: "bg-emerald-100 text-emerald-800 border-emerald-300", label: "BGV Clear",       icon: <BadgeCheck className="size-5" /> },
  conditional:{ color: "bg-amber-100 text-amber-800 border-amber-300",       label: "Conditional",     icon: <AlertTriangle className="size-5" /> },
  hold:       { color: "bg-rose-100 text-rose-800 border-rose-300",           label: "On Hold",         icon: <ShieldAlert className="size-5" /> },
  refer:      { color: "bg-orange-100 text-orange-800 border-orange-300",     label: "Refer to HR",     icon: <AlertTriangle className="size-5" /> },
  negative:   { color: "bg-rose-100 text-rose-800 border-rose-300",           label: "Negative",        icon: <XCircle className="size-5" /> },
  pending:    { color: "bg-slate-100 text-slate-600 border-slate-300",        label: "In Progress",     icon: <Clock className="size-5" /> },
  in_progress:{ color: "bg-blue-100 text-blue-800 border-blue-300",           label: "In Progress",     icon: <Clock className="size-5" /> },
  no_bgv_record: { color: "bg-slate-100 text-slate-500 border-slate-200",    label: "No BGV Record",   icon: <Info className="size-5" /> },
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return formatISTDate(d);
}

function CheckCard({ check }: { check: BgvCheck }) {
  const meta = CHECK_META[check.check_type] ?? { label: check.check_type, icon: <FileText className="size-4" /> };
  const statusCfg = STATUS_CONFIG[check.status] ?? STATUS_CONFIG.pending;
  const riskFlags: string[] = (() => {
    try { return check.risk_flags_json ? JSON.parse(check.risk_flags_json) : []; } catch { return []; }
  })();

  return (
    <div className={`rounded-xl border p-4 ${check.status === "verified" || check.status === "waived" ? "border-emerald-200 bg-emerald-50/30" : check.status === "failed" || check.status === "mismatch" ? "border-rose-200 bg-rose-50/20" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-700">
          <span className="text-slate-500">{meta.icon}</span>
          <span className="text-sm font-semibold">{meta.label}</span>
        </div>
        <Badge variant="outline" className={`rounded-full text-[10px] font-semibold flex items-center gap-1 ${statusCfg.color}`}>
          {statusCfg.icon} {statusCfg.label}
        </Badge>
      </div>
      {check.result_summary && (
        <p className="mt-2 text-xs text-slate-600 leading-relaxed">{check.result_summary}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
        {check.matched_name && <span>Matched: <strong className="text-slate-700">{check.matched_name}</strong></span>}
        {check.match_score != null && <span>Score: <strong className="text-slate-700">{check.match_score}%</strong></span>}
        {check.verified_at && <span>Verified: <strong className="text-slate-700">{fmtDate(check.verified_at)}</strong></span>}
        {check.provider_key && <span className="ml-auto opacity-60">via {check.provider_key}</span>}
      </div>
      {riskFlags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {riskFlags.map(f => (
            <Badge key={f} variant="outline" className="text-[9px] bg-rose-50 text-rose-600 border-rose-200 rounded">{f}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportSection({ report }: { report: BgvReport }) {
  const verdict = report.overall_verdict ?? "pending";
  const verdictCfg = VERDICT_CONFIG[verdict] ?? VERDICT_CONFIG.pending;

  const checks = [
    { label: "Aadhaar",    status: report.aadhaar_status },
    { label: "PAN",        status: report.pan_status },
    { label: "Bank",       status: report.bank_status },
    { label: "Education",  status: report.education_status },
    { label: "Employment", status: report.employment_status },
    { label: "Court",      status: report.court_status },
  ].filter(c => c.status);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className={`px-6 py-4 border-b flex items-center gap-3 ${verdictCfg.color}`}>
        {verdictCfg.icon}
        <div>
          <p className="text-xs font-medium opacity-70">HR-Issued BGV Report</p>
          <p className="text-base font-bold">{verdictCfg.label}</p>
        </div>
        {report.locked_at && (
          <div className="ml-auto flex items-center gap-1 text-xs opacity-70">
            <Lock className="size-3.5" /> Locked {fmtDate(report.locked_at)}
          </div>
        )}
        {report.report_date && !report.locked_at && (
          <p className="ml-auto text-xs opacity-70">Issued: {fmtDate(report.report_date)}</p>
        )}
      </div>
      <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {checks.map(c => {
          const ok = c.status === "passed" || c.status === "verified" || c.status === "not_run";
          return (
            <div key={c.label} className={`rounded-lg border px-3 py-2 text-xs font-medium flex items-center gap-2 ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {ok ? <CheckCircle2 className="size-3.5 shrink-0" /> : <XCircle className="size-3.5 shrink-0" />}
              {c.label}: <span className="capitalize">{c.status?.replace(/_/g, " ")}</span>
            </div>
          );
        })}
      </div>
      {report.hr_comments && (
        <div className="px-5 pb-4">
          <p className="text-xs font-semibold text-slate-600 mb-1">HR Comments</p>
          <p className="text-xs text-slate-700 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200 leading-relaxed">{report.hr_comments}</p>
        </div>
      )}
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
      <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-xl font-bold text-slate-800">{score}</span>
        <span className="text-[10px] text-slate-500 -mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NativeEmployeeBGVStatus() {
  const { employeeId: routeEmployeeId } = useParams<{ employeeId?: string }>();
  const [searchId, setSearchId] = useState(routeEmployeeId ?? "");
  const [activeEmployeeId, setActiveEmployeeId] = useState(routeEmployeeId ?? "");
  const printRef = useRef<HTMLDivElement>(null);

  // Self-view when no employeeId in route; HR lookup when employeeId present
  const isSelfView = !routeEmployeeId;
  const apiPath = isSelfView
    ? "/api/bgv/employee/me"
    : `/api/bgv/employee/${activeEmployeeId || routeEmployeeId}`;

  const { data, isFetching, refetch, error } = useQuery<EmployeeBgvData>({
    queryKey: ["employee-bgv", isSelfView ? "me" : activeEmployeeId],
    queryFn: () => hrmsApi.get<EmployeeBgvData>(apiPath),
    enabled: isSelfView || !!activeEmployeeId,
    retry: false,
  });

  const verdict = data?.overall_status ?? data?.status ?? "pending";
  const verdictCfg = VERDICT_CONFIG[verdict] ?? VERDICT_CONFIG.pending;

  function handlePrint() {
    window.print();
  }

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white" ref={printRef}>
      {/* Page header */}
      <div className="bg-white border-b border-slate-200 shadow-sm px-6 py-4 print:shadow-none">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#e8f2fc] text-[#073f78]">
              <Shield className="size-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900">
                {isSelfView ? "My Background Verification" : "Employee BGV Status"}
              </h1>
              <p className="text-xs text-slate-500">
                {isSelfView
                  ? "Your BGV status, verification checks and HR-issued clearance report"
                  : "HR / Payroll view — BGV check results and employer report"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            {!isSelfView && (
              <div className="flex gap-2">
                <Input
                  className="h-8 text-xs w-48"
                  placeholder="Enter Employee ID…"
                  value={searchId}
                  onChange={e => setSearchId(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && setActiveEmployeeId(searchId)}
                />
                <Button size="sm" className="h-8 bg-[#073f78] hover:bg-[#052d57]" onClick={() => setActiveEmployeeId(searchId)}>
                  Look Up
                </Button>
              </div>
            )}
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void refetch()}>
              <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            {data && (
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handlePrint}>
                <Download className="size-3.5 mr-1" /> Download Report
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 max-w-4xl mx-auto space-y-6">

        {/* Loading / error */}
        {isFetching && (
          <div className="py-16 text-center text-slate-400">
            <RefreshCw className="size-6 animate-spin mx-auto mb-2" />
            <p className="text-sm">Loading BGV status…</p>
          </div>
        )}
        {error && !isFetching && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
            {(error as Error).message}
          </div>
        )}

        {/* No BGV record */}
        {data?.status === "no_bgv_record" && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
            <Info className="size-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600">No BGV record linked</p>
            <p className="text-xs text-slate-400 mt-1">{data.message}</p>
          </div>
        )}

        {data && data.status !== "no_bgv_record" && (
          <>
            {/* Summary card */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 flex flex-wrap items-center gap-6">
              <ScoreRing score={data.score ?? 0} />
              <div className="flex-1 min-w-[180px]">
                <p className="text-xs text-slate-500 mb-1">Employee</p>
                <p className="text-base font-bold text-slate-900">{data.employeeName ?? "—"}</p>
                <p className="text-xs text-slate-500 mt-0.5">ID: {data.employeeId}</p>
              </div>
              <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-semibold text-sm ${verdictCfg.color}`}>
                {verdictCfg.icon}
                <span>{verdictCfg.label}</span>
              </div>
              <div className="flex flex-col gap-1 text-xs text-slate-600 ml-auto">
                <span className="flex items-center gap-1.5">
                  {data.employee_creation_ready
                    ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                    : <XCircle className="size-3.5 text-slate-300" />}
                  Employee creation ready
                </span>
                <span className="flex items-center gap-1.5">
                  {data.payroll_activation_ready
                    ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                    : <XCircle className="size-3.5 text-slate-300" />}
                  Payroll activation ready
                </span>
                <span className="flex items-center gap-1.5 mt-1">
                  {data.consent
                    ? <CheckCircle2 className="size-3.5 text-emerald-500" />
                    : <XCircle className="size-3.5 text-slate-300" />}
                  Consent: {data.consent?.consent_status ?? "not given"}
                </span>
              </div>
            </div>

            {/* Missing checks alert */}
            {data.missing_mandatory_checks?.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 text-sm text-amber-800">
                <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                <span>
                  <strong>Mandatory checks pending:</strong>{" "}
                  {data.missing_mandatory_checks.join(", ")}
                </span>
              </div>
            )}

            {/* HR-issued report */}
            {data.report && <ReportSection report={data.report} />}

            {/* Individual check cards */}
            {data.checks?.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <BookOpen className="size-4" /> Verification Checks
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {data.checks.map(c => <CheckCard key={c.id} check={c} />)}
                </div>
              </div>
            )}

            {/* No checks yet */}
            {(!data.checks || data.checks.length === 0) && !data.report && (
              <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
                <Shield className="size-8 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-600">No verification checks run yet</p>
                <p className="text-xs text-slate-400 mt-1">
                  {isSelfView
                    ? "Your BGV process hasn't started. Contact your HR team."
                    : "This employee's BGV checks haven't been initiated yet."}
                </p>
              </div>
            )}

            {/* Print footer */}
            <div className="hidden print:block mt-8 pt-4 border-t border-slate-200 text-xs text-slate-400 text-center">
              MAS Callnet PeopleOS — BGV Status Report — {formatISTDate()} — Confidential
            </div>
          </>
        )}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          .print\\:bg-white { background: white !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          body { font-size: 12px; }
        }
      `}</style>
    </div>
  );
}
