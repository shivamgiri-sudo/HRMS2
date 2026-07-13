import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Award,
  BookOpen,
  CalendarDays,
  Clock3,
  ExternalLink,
  GraduationCap,
  Loader,
  RefreshCcw,
  Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatIST } from "@/lib/utils";

type LmsPortal = "trainee" | "coordinator" | "admin";

interface LaunchContext {
  portal: LmsPortal;
  portal_url: string;
  embed_url: string;
  lms_token: string | null;
  lms_user_type: string | null;
  bridge_error: string | null;
}

interface EmployeeLearningData {
  trainee: any | null;
  modules: any[];
  contents: any[];
  progress: any[];
  access?: any;
}

interface CoordinatorLearningData {
  scope: { branch?: string | null; process?: string | null; lob?: string | null };
  batches: any[];
  trainees: any[];
  attendance: any[];
  access?: any;
}

const PORTAL_COPY: Record<LmsPortal, { title: string; eyebrow: string }> = {
  trainee: { title: "My Learning", eyebrow: "MCN LMS" },
  coordinator: { title: "LMS Coordinator", eyebrow: "MCN LMS" },
  admin: { title: "LMS Admin", eyebrow: "MCN LMS" },
};

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="mcn-page-card overflow-hidden">
      <div className="border-b border-slate-200/80 bg-white px-5 py-4">
        <h2 className="mcn-section-title">{title}</h2>
        {subtitle && <p className="mcn-section-subtitle">{subtitle}</p>}
      </div>
      <div className="bg-[var(--card-solid)] px-5 py-5">{children}</div>
    </section>
  );
}

export function LmsPortalFrame({ portal }: { portal: LmsPortal }) {
  const [context, setContext] = useState<LaunchContext | null>(null);
  const [data, setData] = useState<EmployeeLearningData | CoordinatorLearningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = PORTAL_COPY[portal];

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: LaunchContext }>(
        `/api/lms/launch-context?portal=${portal}`,
      );
      setContext(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open LMS");
    } finally {
      setLoading(false);
    }
  }, [portal]);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      if (portal === "trainee") {
        const res = await hrmsApi.get<{ success: boolean; data: EmployeeLearningData }>("/api/lms/native/employee");
        setData(res.data ?? null);
      } else if (portal === "coordinator") {
        const res = await hrmsApi.get<{ success: boolean; data: CoordinatorLearningData }>("/api/lms/native/coordinator");
        setData(res.data ?? null);
      } else {
        const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/lms/native/admin");
        setData(res.data ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load LMS data");
    } finally {
      setLoadingData(false);
    }
  }, [portal]);

  useEffect(() => {
    void loadContext();
    void loadData();
  }, [loadContext, loadData]);

  const traineeStats = useMemo(() => {
    if (portal !== "trainee") return null;
    const d = data as EmployeeLearningData | null;
    const modules = d?.modules ?? [];
    const contents = d?.contents ?? [];
    const progress = d?.progress ?? [];
    const completed = progress.filter((p: any) => Number(p.completion_pct ?? 0) >= 100).length;
    const avgCompletion = progress.length
      ? Math.round(progress.reduce((sum: number, p: any) => sum + Number(p.completion_pct ?? 0), 0) / progress.length)
      : 0;
    return { modules: modules.length, contents: contents.length, completed, avgCompletion };
  }, [data, portal]);

  const coordinatorStats = useMemo(() => {
    if (portal !== "coordinator") return null;
    const d = data as CoordinatorLearningData | null;
    const batches = d?.batches ?? [];
    const trainees = d?.trainees ?? [];
    const active = trainees.filter((t: any) => String(t.status ?? "").toLowerCase() === "active").length;
    return { batches: batches.length, trainees: trainees.length, active };
  }, [data, portal]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <header className="mcn-page-card overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-slate-200/80 bg-white px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
              <p className="text-xs font-black uppercase tracking-[.22em] text-blue-700">{copy.eyebrow}</p>
              <h1 className="mt-1 text-2xl font-black text-slate-950">{copy.title}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Native LMS experience inside HRMS with the same compact card style and live LMS data.
              </p>
          </div>
            <div className="flex flex-wrap items-center gap-2">
              {context?.bridge_error && (
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                LMS sign-in needed
                </span>
              )}
              <button
                onClick={() => {
                  void loadContext();
                  void loadData();
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                Refresh
              </button>
              {context?.portal_url && (
                <a
                  href={context.embed_url || context.portal_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open portal
                </a>
              )}
            </div>
          </div>
        </header>

        {(loading || loadingData) && (
          <div className="mcn-page-card flex items-center justify-center gap-3 px-6 py-16 text-slate-600">
            <Loader className="h-5 w-5 animate-spin text-blue-600" />
            Loading LMS view...
          </div>
        )}

        {!loading && !loadingData && error && (
          <div className="mcn-page-card border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-800">
            {error}
          </div>
        )}

        {!loading && !loadingData && !error && portal === "trainee" && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="mcn-page-card p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Modules</p>
                    <p className="mt-2 text-3xl font-black text-slate-950">{traineeStats?.modules ?? 0}</p>
                  </div>
                  <div className="rounded-2xl bg-blue-50 p-3 text-blue-700"><BookOpen className="h-5 w-5" /></div>
                </div>
              </div>
              <div className="mcn-page-card p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Content</p>
                    <p className="mt-2 text-3xl font-black text-slate-950">{traineeStats?.contents ?? 0}</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><GraduationCap className="h-5 w-5" /></div>
                </div>
              </div>
              <div className="mcn-page-card p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Completed</p>
                    <p className="mt-2 text-3xl font-black text-slate-950">{traineeStats?.completed ?? 0}</p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-3 text-amber-700"><Award className="h-5 w-5" /></div>
                </div>
              </div>
              <div className="mcn-page-card p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Avg Progress</p>
                    <p className="mt-2 text-3xl font-black text-slate-950">{traineeStats?.avgCompletion ?? 0}%</p>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-3 text-slate-700"><Clock3 className="h-5 w-5" /></div>
                </div>
              </div>
            </div>

            <SectionCard title="Course Progress" subtitle="Native view synced from the LMS trainee tables">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {["Course", "Progress", "Score", "Status", "Last Accessed"].map((h) => (
                        <th key={h} className="p-4 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data as EmployeeLearningData | null)?.progress?.map((row: any) => (
                      <tr key={row.id} className="border-t hover:bg-slate-50/80 transition-colors">
                        <td className="p-4 font-semibold text-slate-900">{row.course_name ?? row.course_id ?? "Unnamed course"}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, Number(row.completion_pct ?? 0))}%` }} />
                            </div>
                            <span className="text-xs font-bold text-slate-700">{Number(row.completion_pct ?? 0).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="p-4 text-slate-700">{row.score != null ? `${Number(row.score).toFixed(1)}%` : "—"}</td>
                        <td className="p-4 text-slate-700">{String(row.status ?? "").replace(/_/g, " ")}</td>
                        <td className="p-4 text-xs text-slate-500">{row.last_accessed ? formatIST(row.last_accessed) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard title="Modules" subtitle="Classroom-linked LMS modules">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(data as EmployeeLearningData | null)?.modules?.map((mod: any) => (
                  <div key={mod.module_id ?? mod.moduleId ?? mod.module_title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-black text-slate-950">{mod.module_title ?? mod.moduleTitle ?? "Module"}</p>
                    <p className="mt-1 text-xs text-slate-500">Day {mod.day_no ?? mod.dayNo ?? "—"}</p>
                    <p className="mt-3 text-xs text-slate-600">{mod.classroom_name ?? "General classroom"}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        )}

        {!loading && !loadingData && !error && portal === "coordinator" && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="mcn-page-card p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Batches</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{coordinatorStats?.batches ?? 0}</p>
                <p className="mt-2 text-xs text-slate-500">Live batch list from LMS</p>
              </div>
              <div className="mcn-page-card p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Trainees</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{coordinatorStats?.trainees ?? 0}</p>
                <p className="mt-2 text-xs text-slate-500">Mapped trainees in scope</p>
              </div>
              <div className="mcn-page-card p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Active</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{coordinatorStats?.active ?? 0}</p>
                <p className="mt-2 text-xs text-slate-500">Currently active trainees</p>
              </div>
            </div>

            <SectionCard title="Batch Overview" subtitle="Capacity and progress snapshot for coordinator scope">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {["Batch", "Branch", "Process", "Status", "Dates"].map((h) => (
                        <th key={h} className="p-4 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data as CoordinatorLearningData | null)?.batches?.map((batch: any) => (
                      <tr key={batch.batch_no ?? batch.batchNo} className="border-t hover:bg-slate-50/80 transition-colors">
                        <td className="p-4 font-semibold text-slate-900">{batch.batch_name ?? batch.batchName ?? batch.batch_no ?? batch.batchNo}</td>
                        <td className="p-4 text-slate-700">{batch.branch ?? "—"}</td>
                        <td className="p-4 text-slate-700">{batch.process ?? "—"}{batch.lob ? ` | ${batch.lob}` : ""}</td>
                        <td className="p-4 text-slate-700">{batch.batch_status ?? batch.batchStatus ?? "—"}</td>
                        <td className="p-4 text-xs text-slate-500">
                          {batch.start_date ? formatIST(batch.start_date) : "—"}
                          {batch.end_date ? ` - ${formatIST(batch.end_date)}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard title="Trainees" subtitle="Trainee rows from the coordinator scope">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {["Trainee", "Employee ID", "Batch", "Certification", "Updated"].map((h) => (
                        <th key={h} className="p-4 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data as CoordinatorLearningData | null)?.trainees?.map((trainee: any) => (
                      <tr key={trainee.employee_id ?? trainee.employeeId} className="border-t hover:bg-slate-50/80 transition-colors">
                        <td className="p-4 font-semibold text-slate-900">{trainee.trainee_name ?? trainee.traineeName ?? "Unnamed"}</td>
                        <td className="p-4 text-slate-700">{trainee.employee_id ?? trainee.employeeId ?? "—"}</td>
                        <td className="p-4 text-slate-700">{trainee.batch_no ?? trainee.batchNo ?? "—"}</td>
                        <td className="p-4 text-slate-700">{trainee.certification_status ?? trainee.certificationStatus ?? "—"}</td>
                        <td className="p-4 text-xs text-slate-500">{trainee.last_updated_at ? formatIST(trainee.last_updated_at) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
