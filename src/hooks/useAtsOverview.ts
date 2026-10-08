import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type OverviewPeriod = "today" | "7d" | "30d" | "90d" | "all";

type Kpi = { value: number; delta?: number | null; rate?: number };
type Named = { name: string; total: number; selected: number; rejected: number; selRate: number };

export interface AtsOverview {
  generatedAt: string;
  period: OverviewPeriod;
  branch: string | null;
  kpis: {
    registered: Kpi; selected: Kpi; rejected: Kpi; joined: Kpi; inProcess: Kpi;
    leads: number; noShow: number; noShowRate: number; hrsToSelect: number;
    offerApprovalRate: number; offersTotal: number; bgvClearRate: number; bgvFlagRate: number;
    duplicateUnresolved: number; walkoutRate: number;
  };
  outcomes: { selected: number; rejected: number; noShow: number; hold: number; waiting: number; joined: number; registered: number };
  funnel: { stage: string; n: number }[];
  trend: { date: string; registered: number; selected: number; rejected: number }[];
  heatmap: { dow: number; hour: number; n: number }[];
  sources: { name: string; total: number; selected: number; joined: number; convRate: number }[];
  branches: Named[];
  processes: Named[];
  recruiters: (Named & { joined: number })[];
  offers: { byStatus: Record<string, number>; declineReasons: { reason: string; n: number }[] };
  bgv: { status: string; n: number; avgTatDays: number | null }[];
  queue: { today: number; active: number; walkedOut: number; completed: number; slaBreach: number; avgWaitMin: number; slaMinutes: number };
  aging: { bucket: string; n: number }[];
  dropoff: { stage: string; n: number }[];
  demographics: { name: string; n: number }[];
  weekly: { week: string; registered: number; selected: number; rejected: number; selRate: number }[];
  weekday: { dow: number; registered: number; selRate: number }[];
  movers: { up: Mover[]; down: Mover[]; all: Mover[] };
  anomalies: { date: string; value: number; z: number }[];
  runRate: { month: string; mtdRegistered: number; mtdSelected: number; dailyAvg7: number; dayOfMonth: number; daysInMonth: number; projectedRegistered: number; projectedSelected: number };
}

type Mover = { name: string; total: number; prevTotal: number; volumeDelta: number | null; selRate: number; selRateDelta: number | null };

/** One aggregate request; server does the grouping. Keeps previous data visible while filters change. */
export function useAtsOverview(period: OverviewPeriod, branch: string, enabled = true) {
  return useQuery({
    queryKey: ["ats-overview", period, branch],
    enabled,
    queryFn: async () => {
      const qs = new URLSearchParams({ period });
      if (branch) qs.set("branch", branch);
      const res = await hrmsApi.get<{ success: boolean; data: AtsOverview }>(`/api/ats/dashboard/overview?${qs}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
