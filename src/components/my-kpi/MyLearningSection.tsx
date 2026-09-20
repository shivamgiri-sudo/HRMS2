import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  BookOpen, Trophy, Target, Clock, CheckCircle2,
  AlertTriangle, ChevronRight, GraduationCap,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { DrillDownDrawer, DrawerSection, DrawerKV } from "./DrillDownDrawer";

// ── Types ──────────────────────────────────────────────────────────────────

interface LmsData {
  courses?: Array<{
    course_id?: string | number;
    course_name?: string;
    completion_pct?: number;
    mcq_score?: number;
    status?: string;
    modules_total?: number;
    modules_completed?: number;
    certificate_url?: string | null;
    assigned_at?: string;
    completed_at?: string | null;
  }>;
  overall_completion_pct?: number;
  mcq_best_score?: number;
  readiness_score?: number;
  certification_status?: string;
}

interface TniRow {
  parameter_key: string;
  pass_rate: number;
  org_baseline: number;
  gap: number;
  call_count: number;
}

interface Assignment {
  id: string | number;
  skill_category?: string;
  course_name?: string;
  severity?: string;
  due_date?: string;
  status?: string;
  acknowledged?: boolean;
  breach_flag?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function statusBadge(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "completed" || s === "passed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s === "in_progress" || s === "started") return "bg-blue-50 text-blue-700 border-blue-200";
  if (s === "not_started" || s === "pending") return "bg-slate-50 text-slate-600 border-slate-200";
  return "bg-slate-50 text-slate-500 border-slate-200";
}

function severityBadge(sev: string | null | undefined): string {
  const s = (sev ?? "").toUpperCase();
  if (s === "CRITICAL") return "bg-rose-100 text-rose-700 border-rose-300";
  if (s === "HIGH") return "bg-orange-100 text-orange-700 border-orange-200";
  if (s === "MEDIUM") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

const TNI_LABELS: Record<string, string> = {
  call_opening: "Call Opening",
  professionalism: "Professionalism",
  active_listening: "Active Listening",
  hold_procedure: "Hold Procedure",
  accuracy: "Information Accuracy",
  call_closure: "Call Closure",
};

// ── Component ──────────────────────────────────────────────────────────────

export function MyLearningSection() {
  const [selectedCourse, setSelectedCourse] = useState<LmsData["courses"] extends Array<infer T> ? T : never | null>(null);

  const { data: lmsData, isLoading: lmsLoading } = useQuery<LmsData>({
    queryKey: ["lms-employee"],
    queryFn: () => hrmsApi.get("/api/lms/native/employee").then((r) => r.data?.data ?? r.data),
    staleTime: 120_000,
  });

  const { data: assignments, isLoading: assignLoading } = useQuery<Assignment[]>({
    queryKey: ["my-assignments"],
    queryFn: () =>
      hrmsApi.get("/api/quality-learning/my-assignments").then((r) => {
        const d = r.data?.data ?? r.data;
        return Array.isArray(d) ? d : [];
      }),
    staleTime: 60_000,
  });

  const { data: tniRows } = useQuery<TniRow[]>({
    queryKey: ["my-tni"],
    queryFn: () =>
      hrmsApi.get("/api/quality-dashboard/tni-analysis").then((r) => {
        const d = r.data?.data ?? r.data;
        return Array.isArray(d?.agents) ? d.agents : Array.isArray(d) ? d : [];
      }),
    staleTime: 120_000,
  });

  const courses = lmsData?.courses ?? [];
  const pendingAssignments = (assignments ?? []).filter((a) =>
    !["completed", "passed"].includes((a.status ?? "").toLowerCase())
  );
  const tniParams = (tniRows ?? []).slice(0, 6);

  return (
    <>
      <div className="space-y-5">

        {/* === Pending Training Assignments === */}
        {pendingAssignments.length > 0 && (
          <div className="bg-amber-50 rounded-xl border border-amber-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={15} className="text-amber-600" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                Pending Training Assignments
              </p>
              <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">
                {pendingAssignments.length} pending
              </span>
            </div>
            <div className="space-y-2">
              {pendingAssignments.slice(0, 5).map((a) => (
                <div key={a.id} className="bg-white rounded-lg border border-amber-100 px-3 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{a.course_name ?? a.skill_category ?? "Training Module"}</p>
                    <p className="text-[10px] text-slate-500">Due: {fmtDate(a.due_date)}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${severityBadge(a.severity)}`}>
                    {a.severity ?? "PENDING"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === My Courses === */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen size={15} className="text-blue-600" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">My Courses</p>
            {lmsData?.overall_completion_pct != null && (
              <span className="ml-auto text-xs font-bold text-blue-700">{Math.round(lmsData.overall_completion_pct)}% overall</span>
            )}
          </div>

          {lmsLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-slate-100 rounded-lg" />)}
            </div>
          ) : courses.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">No courses assigned</p>
          ) : (
            <div className="space-y-2">
              {courses.slice(0, 6).map((c, i) => {
                const pct = c.completion_pct ?? 0;
                return (
                  <div
                    key={c.course_id ?? i}
                    className="rounded-lg border border-slate-100 p-3 cursor-pointer hover:border-blue-200 hover:bg-blue-50/30 transition-colors group"
                    onClick={() => setSelectedCourse(c as never)}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-sm font-semibold text-slate-900 truncate flex-1">{c.course_name ?? "Course"}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${statusBadge(c.status)}`}>
                        {c.status ?? "—"}
                      </span>
                      <ChevronRight size={14} className="text-slate-300 group-hover:text-blue-400 flex-shrink-0" />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? "bg-emerald-500" : "bg-blue-500"}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 flex-shrink-0">{Math.round(pct)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* === TNI Heatmap === */}
        {tniParams.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Target size={15} className="text-purple-600" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Training Need Identification
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {tniParams.map((row) => {
                const label = TNI_LABELS[row.parameter_key] ?? row.parameter_key.replace(/_/g, " ");
                const isFlagged = row.gap < -10;
                return (
                  <div
                    key={row.parameter_key}
                    className={`rounded-lg border p-3 ${
                      isFlagged
                        ? "bg-rose-50 border-rose-200"
                        : "bg-emerald-50 border-emerald-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <p className="text-[10px] font-bold text-slate-700 capitalize leading-tight">{label}</p>
                      {isFlagged ? (
                        <AlertTriangle size={12} className="text-rose-500 flex-shrink-0" />
                      ) : (
                        <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
                      )}
                    </div>
                    <p className={`text-lg font-extrabold font-mono ${isFlagged ? "text-rose-700" : "text-emerald-700"}`}>
                      {Math.round(row.pass_rate)}%
                    </p>
                    <p className="text-[9px] text-slate-400">
                      Org avg {Math.round(row.org_baseline)}%
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* === Summary Stats === */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              icon: GraduationCap,
              label: "Completion",
              value: lmsData?.overall_completion_pct != null ? `${Math.round(lmsData.overall_completion_pct)}%` : "—",
              color: "text-blue-600 bg-blue-50 border-blue-100",
            },
            {
              icon: Trophy,
              label: "MCQ Best",
              value: lmsData?.mcq_best_score != null ? `${Math.round(lmsData.mcq_best_score)}%` : "—",
              color: "text-emerald-600 bg-emerald-50 border-emerald-100",
            },
            {
              icon: Clock,
              label: "Pending",
              value: pendingAssignments.length > 0 ? pendingAssignments.length : (assignLoading ? "…" : "0"),
              color: pendingAssignments.length > 0 ? "text-amber-700 bg-amber-50 border-amber-100" : "text-slate-600 bg-slate-50 border-slate-100",
            },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className={`rounded-xl border p-4 ${color}`}>
              <Icon size={16} className="mb-2" />
              <p className="text-[10px] font-bold uppercase tracking-wide text-current/70">{label}</p>
              <p className="text-2xl font-extrabold font-mono">{value}</p>
            </div>
          ))}
        </div>

      </div>

      {/* Course detail drawer */}
      {selectedCourse && (
        <DrillDownDrawer
          open={!!selectedCourse}
          onClose={() => setSelectedCourse(null)}
          title={(selectedCourse as { course_name?: string }).course_name ?? "Course Detail"}
          badge={
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusBadge((selectedCourse as { status?: string }).status)}`}>
              {(selectedCourse as { status?: string }).status ?? "—"}
            </span>
          }
        >
          <DrawerSection label="Progress">
            <DrawerKV label="Completion" value={`${Math.round((selectedCourse as { completion_pct?: number }).completion_pct ?? 0)}%`} />
            <DrawerKV label="Modules" value={
              (selectedCourse as { modules_completed?: number; modules_total?: number }).modules_total
                ? `${(selectedCourse as { modules_completed?: number }).modules_completed ?? 0} / ${(selectedCourse as { modules_total?: number }).modules_total}`
                : "—"
            } />
            <DrawerKV label="MCQ Score" value={(selectedCourse as { mcq_score?: number }).mcq_score != null ? `${Math.round((selectedCourse as { mcq_score?: number }).mcq_score!)}%` : "—"} />
            <DrawerKV label="Assigned" value={fmtDate((selectedCourse as { assigned_at?: string }).assigned_at)} />
            <DrawerKV label="Completed" value={fmtDate((selectedCourse as { completed_at?: string | null }).completed_at)} />
          </DrawerSection>
          {(selectedCourse as { certificate_url?: string | null }).certificate_url && (
            <DrawerSection label="Certificate">
              <a
                href={(selectedCourse as { certificate_url?: string | null }).certificate_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-blue-600 font-semibold hover:underline"
              >
                <Trophy size={14} />
                View Certificate
              </a>
            </DrawerSection>
          )}
        </DrillDownDrawer>
      )}
    </>
  );
}
