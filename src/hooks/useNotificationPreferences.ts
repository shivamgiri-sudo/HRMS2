import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

export interface NotificationPreferences {
  id: string;
  user_id: string;
  event_notifications: boolean;
  holiday_notifications: boolean;
  leave_status_notifications: boolean;
  review_notifications: boolean;
  goal_reminder_notifications: boolean;
  onboarding_notifications: boolean;
  created_at: string;
  updated_at: string;
}

export function useNotificationPreferences() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["notification-preferences", user?.id],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any }>("/api/communication/preferences");
      return (res.data ?? null) as NotificationPreferences | null;
    },
    enabled: !!user,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (
      preferences: Partial<Omit<NotificationPreferences, "id" | "user_id" | "created_at" | "updated_at">>
    ) => {
      const res = await hrmsApi.patch<{ data: any }>("/api/communication/preferences", preferences);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
  });
}
