import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { startOfMonth, endOfMonth, format } from "date-fns";

export interface CompanyEvent {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  end_date: string | null;
  event_type: string;
  is_holiday: boolean;
  is_recurring: boolean;
  created_at: string;
}

function mapRow(row: any): CompanyEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    event_date: row.event_date,
    end_date: row.end_date ?? null,
    event_type: row.event_type ?? "general",
    is_holiday: Boolean(row.is_holiday),
    is_recurring: Boolean(row.is_recurring ?? false),
    created_at: row.created_at ?? "",
  };
}

export function useCompanyEvents(month?: Date) {
  const targetMonth = month || new Date();
  const start = format(startOfMonth(targetMonth), "yyyy-MM-dd");
  const end = format(endOfMonth(targetMonth), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["company-events", start, end],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        `/api/org/events?start=${start}&end=${end}`
      );
      return (res.data || []).map(mapRow);
    },
  });
}

export function useAllCompanyEvents() {
  return useQuery({
    queryKey: ["company-events-all"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/org/events");
      return (res.data || []).map(mapRow);
    },
  });
}

export function useCreateCompanyEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (event: {
      title: string;
      description?: string;
      event_date: string;
      end_date?: string;
      event_type: string;
      is_holiday: boolean;
    }) => {
      const res = await hrmsApi.post<{ success: boolean; data: any }>("/api/org/events", event);
      return mapRow(res.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-events"] });
      queryClient.invalidateQueries({ queryKey: ["company-events-all"] });
    },
  });
}

export function useUpdateCompanyEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...event
    }: {
      id: string;
      title: string;
      description?: string;
      event_date: string;
      end_date?: string;
      event_type: string;
      is_holiday: boolean;
    }) => {
      const res = await hrmsApi.put<{ success: boolean; data: any }>(`/api/org/events/${id}`, event);
      return mapRow(res.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-events"] });
      queryClient.invalidateQueries({ queryKey: ["company-events-all"] });
    },
  });
}

export function useDeleteCompanyEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await hrmsApi.delete(`/api/org/events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-events"] });
      queryClient.invalidateQueries({ queryKey: ["company-events-all"] });
    },
  });
}
