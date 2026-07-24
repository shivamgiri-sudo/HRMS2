import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { playChime } from "./useSoundNotification";
import { toast } from "sonner";

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

function mapInboxItem(item: InboxItem): Notification {
  return {
    id: item.id,
    user_id: item.user_id,
    title: item.title,
    message: item.description || "",
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

// Repeat intervals by priority (ms)
const REPEAT_INTERVAL: Record<"urgent" | "high" | "normal", number> = {
  urgent: 2 * 60 * 1000,
  high: 5 * 60 * 1000,
  normal: 15 * 60 * 1000,
};

function chimePriorityFrom(p: Notification["priority"]): "urgent" | "high" | "normal" | null {
  if (p === "urgent") return "urgent";
  if (p === "high") return "high";
  if (p === "normal") return "normal";
  return null; // "low" → no sound
}

const TOAST_DURATION: Record<"urgent" | "high" | "normal", number | undefined> = {
  urgent: Infinity, // stays until manually dismissed
  high: 8000,
  normal: 5000,
};

const PRIORITY_ICON: Record<"urgent" | "high" | "normal", string> = {
  urgent: "🔴",
  high: "🟠",
  normal: "⬤",
};

function showNotificationToast(n: Notification, isReminder: boolean): void {
  const p = chimePriorityFrom(n.priority) ?? "normal";
  const prefix = isReminder ? "Reminder: " : "";
  const title = `${PRIORITY_ICON[p]}  ${prefix}${n.title}`;
  const body = n.message || undefined;
  const duration = TOAST_DURATION[p];
  const action = n.link
    ? { label: "View", onClick: () => { window.location.href = n.link!; } }
    : undefined;

  if (p === "urgent") {
    toast.error(title, { description: body, duration, action });
  } else if (p === "high") {
    toast.warning(title, { description: body, duration, action });
  } else {
    toast(title, { description: body, duration, action });
  }
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => { /* silently ignore */ });
  }
}

function fireBrowserNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      icon: "/favicon.svg",
      tag: "hrms-notification",
    });
  } catch {
    /* some browsers block programmatic Notification outside SW */
  }
}

export const useNotifications = () => {
  const { user } = useAuth();
  const prevCountRef = useRef<number>(-1);
  // Map<itemId, intervalId> — tracks active repeat timers
  const repeatTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const permissionRequested = useRef(false);

  useEffect(() => {
    if (user && !permissionRequested.current) {
      permissionRequested.current = true;
      requestNotificationPermission();
    }
  }, [user]);

  // Clear all repeat timers on unmount / logout
  useEffect(() => {
    return () => {
      repeatTimers.current.forEach((id) => clearInterval(id));
      repeatTimers.current.clear();
    };
  }, []);

  const query = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      if (!user?.id) return [] as Notification[];
      const res = await hrmsApi.get<{ success: boolean; data: InboxItem[] }>("/api/inbox");
      return (res.data ?? []).map(mapInboxItem);
    },
    enabled: !!user?.id,
    refetchInterval: 60000,
  });

  // Sound + repeat logic whenever data refreshes
  useEffect(() => {
    const notifications = query.data;
    if (!notifications) return;

    const unactioned = notifications.filter((n) => !n.actioned);
    const currentCount = notifications.length;

    // --- New notifications arrived ---
    if (prevCountRef.current >= 0 && currentCount > prevCountRef.current) {
      const newOnes = notifications.slice(0, currentCount - prevCountRef.current);
      const priorities: Array<"urgent" | "high" | "normal"> = ["urgent", "high", "normal"];
      for (const p of priorities) {
        if (newOnes.some((n) => n.priority === p)) {
          playChime(p);
          const newest = newOnes[0];
          fireBrowserNotification(newest.title, newest.message || `You have a new ${p} priority notification`);
          showNotificationToast(newest, false);
          break;
        }
      }
    }
    prevCountRef.current = currentCount;

    // --- Repeat-until-actioned timers ---
    const unactionedIds = new Set(unactioned.map((n) => n.id));

    // Clear timers for items that are now actioned
    repeatTimers.current.forEach((timerId, itemId) => {
      if (!unactionedIds.has(itemId)) {
        clearInterval(timerId);
        repeatTimers.current.delete(itemId);
      }
    });

    // Start timers for unactioned items that don't yet have one
    for (const n of unactioned) {
      if (repeatTimers.current.has(n.id)) continue;
      const cp = chimePriorityFrom(n.priority);
      if (!cp) continue; // "low" — no repeat
      const intervalMs = REPEAT_INTERVAL[cp];
      const timerId = setInterval(() => {
        playChime(cp);
        fireBrowserNotification(n.title, n.message || "Reminder: unactioned notification");
        showNotificationToast(n, true);
      }, intervalMs);
      repeatTimers.current.set(n.id, timerId);
    }
  }, [query.data]);

  return query;
};

export const useUnreadNotificationsCount = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["notifications-unread-count", user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const res = await hrmsApi.get<{ success: boolean; count: number }>("/api/inbox/count");
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
      await hrmsApi.patch("/api/inbox/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-count", user?.id] });
    },
  });
};
