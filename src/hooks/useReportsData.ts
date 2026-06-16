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

interface AnalyticsOverview {
  employeeGrowth: Array<{
    month: string;
    employees?: number;
    headcount?: number;
    joiners?: number;
    exits?: number;
  }>;
  departmentDistribution: Array<{ name: string; value: number }>;
  leaveStatistics: {
    monthlyData: Array<Record<string, string | number>>;
    leaveTypeKeys: string[];
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
    monthlyBreakdown: Array<{ month: string; hires: number; terminations: number; net: number }>;
  };
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
  });
}

export function useEmployeeGrowthData(year: number) {
  const query = useAnalyticsOverview(year);
  return {
    ...query,
    data: query.data?.employeeGrowth.map((item) => {
      const monthBreakdown = query.data?.headcount.monthlyBreakdown.find((row) => row.month === item.month);
      return {
        month: item.month,
        headcount: Number(item.headcount ?? item.employees ?? 0),
        joiners: Number(item.joiners ?? monthBreakdown?.hires ?? 0),
        exits: Number(item.exits ?? monthBreakdown?.terminations ?? 0),
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
  return {
    ...query,
    data: query.data?.leaveStatistics.leaveTypeKeys.map((key) => ({
      name: titleFromKey(key),
      days: query.data?.leaveStatistics.monthlyData.reduce((sum, month) => sum + Number(month[key] ?? 0), 0) ?? 0,
    })),
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
    data: query.data
      ? {
          ...query.data.headcount,
          startOfYear: Number(query.data.headcount.startOfYear ?? query.data.headcount.startOfYearHeadcount ?? 0),
          newJoiners: Number(query.data.headcount.newJoiners ?? query.data.headcount.newHires ?? 0),
        }
      : undefined,
  };
}
