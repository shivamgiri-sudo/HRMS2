import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  CheckCheck,
  ChevronRight,
  Inbox,
  Mail,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationsCount,
} from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

const filters = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "payroll", label: "Payroll" },
  { key: "attendance", label: "Attendance" },
  { key: "leave", label: "Leave" },
  { key: "performance", label: "Performance" },
  { key: "onboarding", label: "Onboarding" },
  { key: "alerts", label: "Alerts" },
] as const;

const priorityStyle = {
  urgent: "border-rose-200 bg-rose-50 text-rose-700",
  high: "border-amber-200 bg-amber-50 text-amber-700",
  normal: "border-blue-200 bg-blue-50 text-blue-700",
  low: "border-slate-200 bg-slate-50 text-slate-600",
};

function categoryFor(type: string): string {
  const normalized = type.toLowerCase();
  return filters.find((filter) => filter.key !== "all" && filter.key !== "unread" && normalized.includes(filter.key))?.key
    ?? (normalized.includes("salary") || normalized.includes("payslip") ? "payroll" : "alerts");
}

export default function Notifications() {
  const navigate = useNavigate();
  const { data: notifications = [], isLoading, refetch, isFetching } = useNotifications();
  const { data: unreadCount = 0 } = useUnreadNotificationsCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const [activeFilter, setActiveFilter] = useState<(typeof filters)[number]["key"]>("all");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return notifications.filter((notification) => {
      const matchesFilter = activeFilter === "all"
        || (activeFilter === "unread" && !notification.read)
        || categoryFor(notification.type) === activeFilter;
      const matchesSearch = !query
        || `${notification.title} ${notification.message} ${notification.type}`.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [activeFilter, notifications, search]);

  const openNotification = (notification: (typeof notifications)[number]) => {
    if (!notification.read) markRead.mutate(notification.id);
    if (notification.link) navigate(notification.link);
  };

  return (
    <DashboardLayout>
      <main className="space-y-6 p-5 lg:p-8">
        <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#073f78] via-[#1B6AB5] to-violet-700 p-7 text-white shadow-xl">
          <div className="absolute -right-16 -top-20 size-72 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
                <Sparkles className="size-3.5" />
                Personal notification centre
              </div>
              <h1 className="text-3xl font-black tracking-tight lg:text-4xl">Your updates, in one place</h1>
              <p className="mt-2 max-w-2xl text-sm text-blue-100 lg:text-base">
                Payroll, attendance, leave, onboarding, performance and important company alerts personalised for you.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="rounded-2xl bg-white/15 px-4 py-3 backdrop-blur-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-blue-100">Unread</p>
                <p className="text-2xl font-black">{unreadCount}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="h-auto rounded-2xl px-4 font-bold"
                onClick={() => markAllRead.mutate()}
                disabled={unreadCount === 0 || markAllRead.isPending}
              >
                <CheckCheck className="mr-2 size-4" />
                Mark all read
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Inbox, label: "Portal inbox", value: notifications.length, tone: "text-blue-700 bg-blue-50" },
            { icon: Mail, label: "Unread updates", value: unreadCount, tone: "text-violet-700 bg-violet-50" },
            { icon: ShieldCheck, label: "Private delivery", value: "Personal", tone: "text-emerald-700 bg-emerald-50" },
          ].map(({ icon: Icon, label, value, tone }) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className={cn("mb-4 flex size-10 items-center justify-center rounded-xl", tone)}>
                <Icon className="size-5" />
              </div>
              <p className="text-sm font-semibold text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-xl">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search your notifications"
                className="h-11 rounded-xl pl-10"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => void refetch()} disabled={isFetching}>
                Refresh
              </Button>
              <Button asChild type="button" variant="outline" className="rounded-xl">
                <Link to="/communication/preferences">
                  <Settings2 className="mr-2 size-4" />
                  Preferences
                </Link>
              </Button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={cn(
                  "rounded-xl px-3.5 py-2 text-sm font-bold transition-colors",
                  activeFilter === filter.key
                    ? "bg-[#073f78] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          {isLoading ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500">
              Loading your notifications...
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-14 text-center">
              <Bell className="mx-auto size-10 text-slate-300" />
              <p className="mt-3 font-bold text-slate-800">You are all caught up</p>
              <p className="mt-1 text-sm text-slate-500">No notifications match this view.</p>
            </div>
          ) : (
            visible.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => openNotification(notification)}
                className={cn(
                  "flex w-full items-start gap-4 rounded-3xl border bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                  notification.read ? "border-slate-200" : "border-blue-200 ring-2 ring-blue-100"
                )}
              >
                <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl border", priorityStyle[notification.priority])}>
                  <Bell className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider text-[#1B6AB5]">
                      {categoryFor(notification.type)}
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold capitalize", priorityStyle[notification.priority])}>
                      {notification.priority}
                    </span>
                    {!notification.read && <span className="size-2 rounded-full bg-blue-600" />}
                  </div>
                  <p className="mt-2 text-base font-black text-slate-950">{notification.title}</p>
                  <p className="mt-1 line-clamp-3 text-sm leading-6 text-slate-600">{notification.message}</p>
                  <p className="mt-3 text-xs font-semibold text-slate-400">
                    {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                  </p>
                </div>
                {notification.link && <ChevronRight className="mt-3 size-5 shrink-0 text-slate-400" />}
              </button>
            ))
          )}
        </section>
      </main>
    </DashboardLayout>
  );
}
