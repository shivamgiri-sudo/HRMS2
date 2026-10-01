import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { RosterRequest } from "./types";

export interface Impact {
  blockers: string[]; warnings: string[]; locked: boolean;
  rest: Array<{ employeeId: string; ok: boolean; message: string | null }>;
  sameDayHeadcount: { date: string; processName: string | null; planned: number } | null;
  week: Array<{ employeeId: string; days: Array<{ date: string; shiftName: string | null; isWeekOff: boolean }> }>;
}

/** Shared by ImpactPanel and ActionBar: same query key, so react-query de-duplicates the fetch. */
export function useImpact(request: RosterRequest) {
  return useQuery({
    queryKey: ["rr", "impact", request.key],
    queryFn: async () => (await hrmsApi.get<{ data: Impact }>(`/api/roster-requests/impact?kind=${request.kind}&id=${encodeURIComponent(request.id)}`)).data,
  });
}
