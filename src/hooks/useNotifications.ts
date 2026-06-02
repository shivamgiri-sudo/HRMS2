import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link: string | null;
  created_at: string;
}

// Map work_inbox_item rows to Notification shape
function mapInboxItem(item: any): Notification {
  return {
    id: item.id,
    user_id: item.user_id,
    title: item.title,
    message: item.description || '',
    type: item.type,
    read: item.is_read === 1 || item.is_read === true,
    link: item.action_url || null,
    created_at: item.created_at,
  };
}

export const useNotifications = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const res = await hrmsApi.get('/inbox');
      return (res.data?.data ?? []).map(mapInboxItem) as Notification[];
    },
    enabled: !!user?.id,
    refetchInterval: 60000,
  });
};

export const useUnreadNotificationsCount = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["notifications-unread-count", user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const res = await hrmsApi.get('/inbox/count');
      return Number(res.data?.count ?? 0);
    },
    enabled: !!user?.id,
    refetchInterval: 60000,
  });
};

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      await hrmsApi.patch(`/inbox/${notificationId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count", user?.id] });
    },
  });
};

export const useMarkAllNotificationsRead = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!user?.id) return;
      await hrmsApi.patch('/inbox/mark-all-read');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count", user?.id] });
    },
  });
};
