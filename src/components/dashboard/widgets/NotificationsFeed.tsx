import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, AlertCircle, Clock, CheckCircle2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

type FeedItemType = "announcement" | "alert" | "overdue";

interface FeedItem {
  id: string | number;
  title: string;
  body?: string;
  type: FeedItemType;
  createdAt: string;
  href?: string;
}

interface InboxApiItem {
  id?: string | number;
  title?: string;
  subject?: string;
  body?: string;
  message?: string;
  type?: string;
  category?: string;
  createdAt?: string;
  created_at?: string;
}

interface NotificationsFeedProps {
  maxHeight?: string;
  title?: string;
}

function resolveType(raw?: string): FeedItemType {
  if (!raw) return "announcement";
  const lower = raw.toLowerCase();
  if (lower.includes("overdue") || lower.includes("late") || lower.includes("missed")) return "overdue";
  if (lower.includes("alert") || lower.includes("warn") || lower.includes("action")) return "alert";
  return "announcement";
}

function normalizeItem(item: InboxApiItem, fallbackType: FeedItemType): FeedItem {
  return {
    id: item.id ?? Math.random(),
    title: (item.title ?? item.subject ?? "Notification").trim(),
    body: item.body ?? item.message,
    type: resolveType(item.type ?? item.category) ?? fallbackType,
    createdAt: item.createdAt ?? item.created_at ?? new Date().toISOString(),
    href: undefined,
  };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const TYPE_CONFIG: Record<
  FeedItemType,
  { dot: string; icon: React.ReactNode }
> = {
  announcement: {
    dot: "#1B6AB5",
    icon: <Bell className="w-4 h-4" />,
  },
  alert: {
    dot: "#F59E0B",
    icon: <AlertCircle className="w-4 h-4" />,
  },
  overdue: {
    dot: "#E8231A",
    icon: <Clock className="w-4 h-4" />,
  },
};

function FeedRow({ item }: { item: FeedItem }) {
  const cfg = TYPE_CONFIG[item.type];

  const inner = (
    <div className="flex items-start gap-3 py-3 px-4 hover:bg-slate-50 transition-colors group">
      {/* Left dot */}
      <span
        className="mt-1 flex-shrink-0 w-2 h-2 rounded-full"
        style={{ backgroundColor: cfg.dot }}
      />

      {/* Icon */}
      <span
        className="mt-0.5 flex-shrink-0"
        style={{ color: cfg.dot }}
      >
        {cfg.icon}
      </span>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 leading-snug truncate">
          {item.title}
        </p>
        {item.body && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{item.body}</p>
        )}
      </div>

      {/* Time */}
      <span className="text-xs text-slate-400 flex-shrink-0 mt-0.5">
        {timeAgo(item.createdAt)}
      </span>
    </div>
  );

  if (item.href) {
    return (
      <Link to={item.href} className="block border-b border-slate-100 last:border-b-0">
        {inner}
      </Link>
    );
  }

  return (
    <div className="border-b border-slate-100 last:border-b-0">{inner}</div>
  );
}

export function NotificationsFeed({
  maxHeight = "420px",
  title = "Notifications",
}: NotificationsFeedProps) {
  const inboxQuery = useQuery<FeedItem[]>({
    queryKey: ["inbox"],
    queryFn: async () => {
      const data = await hrmsApi.get<InboxApiItem[]>("/api/inbox");
      const items = Array.isArray(data) ? data : [];
      return items.map((item) => normalizeItem(item, "announcement"));
    },
    staleTime: 60_000,
  });

  const workInboxQuery = useQuery<FeedItem[]>({
    queryKey: ["work-inbox-my"],
    queryFn: async () => {
      const data = await hrmsApi.get<InboxApiItem[]>("/api/work-inbox/my");
      const items = Array.isArray(data) ? data : [];
      return items.map((item) => normalizeItem(item, "alert"));
    },
    staleTime: 60_000,
  });

  const allItems: FeedItem[] = [
    ...(inboxQuery.data ?? []),
    ...(workInboxQuery.data ?? []),
  ].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const isLoading = inboxQuery.isLoading || workInboxQuery.isLoading;
  const unreadCount = allItems.length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#1B6AB5] text-white text-[10px] font-bold">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </div>

      {/* Feed */}
      <div
        className="overflow-y-auto flex-1"
        style={{ maxHeight }}
      >
        {isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-2 h-2 rounded-full bg-slate-200 flex-shrink-0" />
                <div className="w-4 h-4 rounded bg-slate-200 flex-shrink-0" />
                <div className="flex-1 h-3 bg-slate-200 rounded" />
                <div className="w-8 h-3 bg-slate-200 rounded flex-shrink-0" />
              </div>
            ))}
          </div>
        ) : allItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            <p className="text-sm font-medium text-slate-500">
              All clear — no new notifications
            </p>
          </div>
        ) : (
          allItems.map((item) => <FeedRow key={`${item.type}-${item.id}`} item={item} />)
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-100 px-4 py-2.5 flex-shrink-0">
        <Link
          to="/notifications"
          className="text-xs font-semibold text-[#1B6AB5] hover:underline"
        >
          View all notifications →
        </Link>
      </div>
    </div>
  );
}

export default NotificationsFeed;
