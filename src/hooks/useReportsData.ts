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
  employeeGrowth: Array<{ month: string; employees: number }>;
  departmentDistribution: Array<{ name: string; value: number }>;
  leaveStatistics: {
    monthlyData: Array<Record<string, string | number>>;
    leaveTypeKeys: string[];
  };
  payrollTrend: Array<{ month: string; amount: number }>;
  headcount: {
    newHires: number;
    terminations: number;
    netChange: number;
    currentHeadcount: number;
    startOfYearHeadcount: number;
    monthlyBreakdown: Array<{ month: string; hires: number; terminations: number; net: number }>;
  };
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
  return { ...query, data: query.data?.employeeGrowth };
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
  return { ...query, data: query.data?.leaveStatistics };
}

export function usePayrollTrend(year: number) {
  const query = useAnalyticsOverview(year);
  return { ...query, data: query.data?.payrollTrend };
}

export function useHeadcountSummary(year: number) {
  const query = useAnalyticsOverview(year);
  return { ...query, data: query.data?.headcount };
}
