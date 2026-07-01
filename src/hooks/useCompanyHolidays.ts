import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface CompanyHoliday {
  id: string;
  title: string;
  event_date: string;
}

export function useCompanyHolidays(year?: number) {
  const y = year ?? new Date().getFullYear();

  return useQuery({
    queryKey: ["company-holidays", y],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/org/events?is_holiday=true&start=${y}-01-01&end=${y}-12-31`
      );
      return (res.data || []).map((h: any): CompanyHoliday => ({
        id: h.id,
        title: h.title ?? h.holiday_name ?? "",
        event_date: h.event_date ?? h.holiday_date ?? "",
      }));
    },
  });
}
