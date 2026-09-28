import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Search } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useDebounce } from "@/hooks/useDebounce";
import { hrmsApi } from "@/lib/hrmsApi";
import { CoachingDetail } from "@/components/coaching/CoachingDetail";

interface TeamRow {
  employeeId: string;
  code: string | null;
  name: string;
  processName: string | null;
  batchName: string | null;
  readinessScore: number | null;
  coursesTotal: number;
  overdueCourses: number;
  avgCompletion: number | null;
  lastAssessment: string | null;
  lastPercentage: number | null;
  lastResult: string | null;
  failedAssessments: number;
  attritionRisk: string | null;
  opsHandoverReady: number | null;
  reasons: string[];
}

interface TeamResponse {
  scope: "none" | "span" | "all";
  truncated?: boolean;
  rows: TeamRow[];
}

const DASH = "-";

/**
 * Coaching Center: the learning side of coaching for the people in my span (a TL sees the team, an AM each TL's
 * team). It reads the LMS data already synced into HRMS - who is behind on courses, who failed an assessment,
 * who is not handover-ready - most in need of attention first. Open a person for the full record.
 */
export default function TeamCoachingPage() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<TeamRow | null>(null);
  const debounced = useDebounce(search, 300);
  const query = useQuery({
    queryKey: ["coaching", "team", debounced.trim()],
    queryFn: () =>
      hrmsApi.get<{ data: TeamResponse }>(
        `/api/lms/coaching/team${debounced.trim() ? `?search=${encodeURIComponent(debounced.trim())}` : ""}`,
      ),
    staleTime: 60_000,
  });
  const data = query.data?.data;
  const rows = data?.rows ?? [];
  const attention = rows.filter((r) => r.reasons.length > 0).length;

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4 md:p-6">
        <header className="flex items-center gap-3">
          <span className="rounded-xl bg-blue-50 p-2 text-blue-700">
            <GraduationCap className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Coaching Center
            </h1>
            <p className="text-sm text-slate-500">
              Course progress, assessments and handover readiness for the people
              you coach, from the LMS.
            </p>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search
              className="pointer-events-none absolute left-2.5 top-3 h-4 w-4 text-slate-400"
              aria-hidden
            />
            <Input
              aria-label="Search people"
              placeholder="Search name or employee code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 pl-8 sm:h-10"
            />
          </div>
          {data && (
            <p className="text-sm text-slate-600">
              {rows.length} {rows.length === 1 ? "person" : "people"}
              {attention > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  {attention} need attention
                </span>
              )}
              {data.truncated && (
                <span className="ml-2 text-xs text-slate-400">
                  Showing the first 300 - search to narrow.
                </span>
              )}
            </p>
          )}
        </div>

        {query.isLoading && (
          <p className="text-sm text-slate-500">Loading...</p>
        )}
        {query.error instanceof Error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            Could not load the team. {query.error.message}
          </p>
        )}
        {data && rows.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            {data.scope === "none"
              ? "Your login is not linked to an employee record, so there is no team to show."
              : "No one in your team matches."}
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-3">Person</th>
                  <th className="p-3">Batch</th>
                  <th className="p-3">Readiness</th>
                  <th className="p-3">Courses</th>
                  <th className="p-3">Last assessment</th>
                  <th className="p-3">Needs attention</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.employeeId}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open coaching record for ${r.name}`}
                    className="cursor-pointer border-t border-slate-100 transition-colors duration-200 hover:bg-slate-50 focus-visible:bg-slate-50"
                    onClick={() => setOpen(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpen(r);
                      }
                    }}
                  >
                    <td className="p-3">
                      <div className="font-semibold text-slate-800">
                        {r.name}
                      </div>
                      <div className="text-xs text-slate-400">
                        {[r.code, r.processName].filter(Boolean).join(" - ")}
                      </div>
                    </td>
                    <td className="p-3 text-slate-600">
                      {r.batchName ?? DASH}
                    </td>
                    <td className="p-3">
                      {r.readinessScore === null
                        ? DASH
                        : `${Math.round(r.readinessScore)}%`}
                    </td>
                    <td className="p-3">
                      {r.coursesTotal === 0
                        ? DASH
                        : `${r.avgCompletion ?? 0}% of ${r.coursesTotal}`}
                      {r.overdueCourses > 0 && (
                        <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          {r.overdueCourses} overdue
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-slate-600">
                      {r.lastAssessment
                        ? `${r.lastAssessment} - ${r.lastPercentage === null ? DASH : `${Math.round(r.lastPercentage)}%`} ${r.lastResult ?? ""}`
                        : DASH}
                    </td>
                    <td className="p-3">
                      {r.reasons.length === 0 ? (
                        <span className="text-slate-400">-</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.reasons.map((reason) => (
                            <span
                              key={reason}
                              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Sheet
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) setOpen(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{open?.name}</SheetTitle>
            <SheetDescription>
              {[open?.code, open?.processName].filter(Boolean).join(" - ")}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {open && (
              <CoachingDetail source={{ employeeId: open.employeeId }} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
