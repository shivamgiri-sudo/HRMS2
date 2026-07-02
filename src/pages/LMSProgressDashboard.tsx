import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Award, BookOpen, Clock } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

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

export default function LMSProgressDashboard() {
  const { data: progressData = [], isLoading } = useQuery({
    queryKey: ["lms-progress-dashboard"],
    queryFn: async () => {
      // TODO: Replace with actual endpoint when available
      // For now, return empty array to prevent runtime errors
      const res = await hrmsApi.get<{ success: boolean; data: EmployeeProgress[] }>(
        "/api/lms/progress-summary"
      );
      return res.data.data ?? [];
    },
    retry: false,
  });

  const stats = {
    totalLearners: progressData.length,
    avgCompletion: progressData.length
      ? Math.round(
          progressData.reduce((sum, p) => sum + p.completion_percent, 0) / progressData.length
        )
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
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-950">LMS Progress Dashboard</h1>
          <p className="mt-1 text-slate-600">
            Read-only view of employee learning progress from integrated LMS
          </p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-500">Total Learners</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{stats.totalLearners}</p>
              </div>
              <div className="rounded-2xl bg-blue-100 p-3 text-blue-600">
                <BookOpen className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-500">Avg Completion</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{stats.avgCompletion}%</p>
              </div>
              <div className="rounded-2xl bg-green-100 p-3 text-green-600">
                <TrendingUp className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-500">Certifications</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{stats.totalCertifications}</p>
              </div>
              <div className="rounded-2xl bg-purple-100 p-3 text-purple-600">
                <Award className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-500">Active (7d)</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{stats.activeLearners}</p>
              </div>
              <div className="rounded-2xl bg-yellow-100 p-3 text-yellow-600">
                <Clock className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>

        {/* Progress Table */}
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-slate-950">Employee Progress</h2>
            <p className="text-sm text-slate-600">Learning progress synced from external LMS</p>
          </div>

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
                      <td className="px-4 py-3 font-medium text-slate-950">
                        {progress.employee_name}
                      </td>
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
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                            <Award className="h-3 w-3" />
                            {progress.certifications_earned}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {formatISTDate(progress.last_activity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Note */}
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
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
