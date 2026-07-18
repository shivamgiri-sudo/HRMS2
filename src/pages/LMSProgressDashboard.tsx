import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Award, BookOpen, Clock, TrendingUp } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatIST } from "@/lib/utils";

interface EmployeeProgress {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  modules_assigned: number;
  modules_completed: number;
  completion_percent: number;
  certifications_earned: number;
  last_activity: string;
}

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
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="border-b border-slate-200/80 bg-white px-6 py-5">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      <div className="bg-[var(--card-solid)] p-6">{children}</div>
    </section>
  );
}

export default function LMSProgressDashboard() {
  const { data: progressData = [], isLoading } = useQuery({
    queryKey: ["lms-progress-dashboard"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: EmployeeProgress[] }>(
        "/api/lms/progress-summary",
      );
      return res.data ?? [];
    },
    retry: false,
  });

  const stats = {
    totalLearners: progressData.length,
    avgCompletion: progressData.length
      ? Math.round(progressData.reduce((sum, p) => sum + p.completion_percent, 0) / progressData.length)
      : 0,
    totalCertifications: progressData.reduce((sum, p) => sum + p.certifications_earned, 0),
    activeLearners: progressData.filter((p) => {
      const lastActivity = new Date(p.last_activity);
      const daysSince = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);
      return daysSince <= 7;
    }).length,
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <header className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="border-b border-slate-200/80 bg-white px-6 py-5">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-700">MCN LMS</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">LMS Progress Dashboard</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Read-only view of employee learning progress from the integrated LMS, rendered in the same compact LMS card style.
            </p>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Total Learners</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{stats.totalLearners}</p>
              </div>
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                <BookOpen className="h-5 w-5" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Avg Completion</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{stats.avgCompletion}%</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                <TrendingUp className="h-5 w-5" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Certifications</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{stats.totalCertifications}</p>
              </div>
              <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
                <Award className="h-5 w-5" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Active (7d)</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{stats.activeLearners}</p>
              </div>
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                <Clock className="h-5 w-5" />
              </div>
            </div>
          </div>
        </div>

        <SectionCard title="Employee Progress" subtitle="Learning progress synced from the external LMS">
          {isLoading ? (
            <div className="py-12 text-center text-slate-500">Loading progress data...</div>
          ) : progressData.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              No progress data available. Check LMS integration and sync status.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Employee</th>
                    <th className="px-4 py-3 font-semibold">Code</th>
                    <th className="px-4 py-3 font-semibold">Assigned</th>
                    <th className="px-4 py-3 font-semibold">Completed</th>
                    <th className="px-4 py-3 font-semibold">Progress</th>
                    <th className="px-4 py-3 font-semibold">Certifications</th>
                    <th className="px-4 py-3 font-semibold">Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {progressData.map((progress) => (
                    <tr key={progress.employee_id} className="border-b hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-950">{progress.employee_name}</td>
                      <td className="px-4 py-3 text-slate-700">{progress.employee_code}</td>
                      <td className="px-4 py-3 text-slate-700">{progress.modules_assigned}</td>
                      <td className="px-4 py-3 text-slate-700">{progress.modules_completed}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full bg-blue-600"
                              style={{ width: `${progress.completion_percent}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-slate-700">
                            {progress.completion_percent}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {progress.certifications_earned > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            <Award className="h-3 w-3" />
                            {progress.certifications_earned}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {formatIST(progress.last_activity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <p className="font-semibold">Integration Note:</p>
          <p className="mt-1">
            This dashboard displays read-only progress data synced from the external LMS system.
            To manage curriculum, content, and assessments, use the LMS Admin portal.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
