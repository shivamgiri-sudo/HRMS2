import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  priority: "low" | "normal" | "high" | "urgent";
  read: boolean;
  actioned: boolean;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}

interface InboxItem {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  type: string;
  priority?: Notification["priority"] | null;
  is_read: boolean | number;
  is_actioned: boolean | number;
  action_url?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  created_at: string;
}

// Map work_inbox_item rows to Notification shape
function mapInboxItem(item: InboxItem): Notification {
  return {
    id: item.id,
    user_id: item.user_id,
    title: item.title,
    message: item.description || '',
    type: item.type,
    priority: item.priority || "normal",
    read: item.is_read === 1 || item.is_read === true,
    actioned: item.is_actioned === 1 || item.is_actioned === true,
    link: item.action_url || null,
    entity_type: item.entity_type || null,
    entity_id: item.entity_id || null,
    created_at: item.created_at,
  };
}

export const useNotifications = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const res = await hrmsApi.get<{ success: boolean; data: InboxItem[] }>('/api/inbox');
      return (res.data ?? []).map(mapInboxItem) as Notification[];
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
      const res = await hrmsApi.get<{ success: boolean; count: number }>('/api/inbox/count');
      return Number(res.count ?? 0);
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
      await hrmsApi.patch(`/api/inbox/${notificationId}/read`);
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
      await hrmsApi.patch('/api/inbox/mark-all-read');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count", user?.id] });
    },
  });
};
