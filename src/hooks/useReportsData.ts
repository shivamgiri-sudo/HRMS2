import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary))",
];

interface LeaveSummaryRow {
  leave_name: string;
  total_days: number;
  employee_count: number;
  request_count: number;
}

interface AnalyticsOverview {
  employeeGrowth: Array<{ month: string; employees?: number; headcount?: number; joiners?: number; exits?: number }>;
  departmentDistribution: Array<{ name: string; value: number }>;
  leaveStatistics: {
    monthlyData: Array<Record<string, string | number>>;
    leaveTypeKeys: string[];
    leaveTypeLabels?: Record<string, string>;
    leaveSummary?: LeaveSummaryRow[];
  };
  payrollTrend: Array<{ month: string; amount: number }>;
  headcount: {
    newHires?: number;
    newJoiners?: number;
    terminations: number;
    netChange: number;
    currentHeadcount: number;
    startOfYearHeadcount?: number;
    startOfYear?: number;
    monthlyBreakdown: Array<{ month: string; hires?: number; joiners?: number; terminations?: number; exits?: number; net: number }>;
  };
  dataHealth?: Record<string, unknown>;
}

function titleFromKey(key: string) {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function useAnalyticsOverview(year: number) {
  return useQuery({
    queryKey: ["reports-analytics-overview", year],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: AnalyticsOverview }>(
        `/api/reports/analytics-overview?year=${year}`
      );
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });
}

export function useEmployeeGrowthData(year: number) {
  const query = useAnalyticsOverview(year);
  return {
    ...query,
    data: query.data?.employeeGrowth.map((row) => {
      const breakdown = query.data?.headcount.monthlyBreakdown.find((item) => item.month === row.month);
      return {
        month: row.month,
        headcount: Number(row.headcount ?? row.employees ?? 0),
        joiners: Number(row.joiners ?? breakdown?.joiners ?? breakdown?.hires ?? 0),
        exits: Number(row.exits ?? breakdown?.exits ?? breakdown?.terminations ?? 0),
      };
    }),
  };
}

export function useDepartmentDistribution(year = new Date().getFullYear()) {
  const query = useAnalyticsOverview(year);
  return {
    ...query,
    data: query.data?.departmentDistribution.map((item, index) => ({
      ...item,
      color: CHART_COLORS[index % CHART_COLORS.length],
    })),
  };
}

export function useLeaveStatistics(year: number) {
  const query = useAnalyticsOverview(year);
  const ls = query.data?.leaveStatistics;
  return {
    ...query,
    // Per-type totals with employee count (for the bar chart)
    data: ls?.leaveSummary?.map((row, i) => ({
      name: row.leave_name,
      days: row.total_days,
      employees: row.employee_count,
      requests: row.request_count,
      color: CHART_COLORS[i % CHART_COLORS.length],
    })) ?? ls?.leaveTypeKeys.map((key, i) => ({
      name: ls.leaveTypeLabels?.[key] ?? titleFromKey(key),
      days: ls.monthlyData.reduce((sum, month) => sum + Number(month[key] ?? 0), 0),
      employees: 0,
      requests: 0,
      color: CHART_COLORS[i % CHART_COLORS.length],
    })),
    // Month-by-month stacked data (for trend chart)
    monthlyData: ls?.monthlyData,
    leaveTypeKeys: ls?.leaveTypeKeys ?? [],
    leaveTypeLabels: ls?.leaveTypeLabels ?? {},
  };
}

export function usePayrollTrend(year: number) {
  const query = useAnalyticsOverview(year);
  return { ...query, data: query.data?.payrollTrend };
}

export function useHeadcountSummary(year: number) {
  const query = useAnalyticsOverview(year);
  return {
    ...query,
    data: query.data?.headcount
      ? {
          ...query.data.headcount,
          startOfYear: Number(query.data.headcount.startOfYear ?? query.data.headcount.startOfYearHeadcount ?? 0),
          newJoiners: Number(query.data.headcount.newJoiners ?? query.data.headcount.newHires ?? 0),
        }
      : undefined,
  };
}
