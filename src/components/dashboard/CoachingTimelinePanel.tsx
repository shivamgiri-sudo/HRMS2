/**
 * CoachingTimelinePanel — Upcoming coaching sessions timeline for Manager dashboard.
 * Fetches from GET /api/management/coaching
 */
import { useQuery } from "@tanstack/react-query";
import { Loader, AlertTriangle, Calendar, MessageSquare, Clock } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface CoachingSessionItem {
  id: string;
  employee_id: string;
  employee_name: string;
  session_date: string;
  session_type: string;
  notes?: string;
  action_items?: string;
  status: string;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; ring: string }> = {
  scheduled: { bg: "bg-blue-50", text: "text-blue-800", ring: "ring-blue-200" },
  completed: { bg: "bg-green-50", text: "text-green-800", ring: "ring-green-200" },
  cancelled: { bg: "bg-red-50", text: "text-red-700", ring: "ring-red-200" },
  rescheduled: { bg: "bg-amber-50", text: "text-amber-800", ring: "ring-amber-200" },
  in_progress: { bg: "bg-violet-50", text: "text-violet-800", ring: "ring-violet-200" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.scheduled;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ring-1 ${cfg.bg} ${cfg.text} ${cfg.ring}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatSessionType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CoachingTimelinePanel() {
  const { data: sessions, isLoading, error } = useQuery<CoachingSessionItem[], Error>({
    queryKey: ["management", "coaching-timeline"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: CoachingSessionItem[] }>("/api/management/coaching");
      return (res as { success: boolean; data: CoachingSessionItem[] }).data ?? [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });

  // Show upcoming sessions (not completed/cancelled) first, sorted by date
  const upcoming = (sessions ?? [])
    .filter((s) => !["completed", "cancelled"].includes(s.status))
    .sort((a, b) => new Date(a.session_date).getTime() - new Date(b.session_date).getTime());

  const displayItems = upcoming.length > 0 ? upcoming : (sessions ?? []).slice(0, 8);

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white shadow-sm overflow-hidden transition-all hover:shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-blue-50/60 to-indigo-50/40 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-100 p-2.5">
            <MessageSquare className="h-5 w-5 text-blue-700" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900">Coaching Sessions</h3>
            <p className="text-xs text-slate-500">
              {isLoading ? "Loading..." : `${upcoming.length} upcoming session${upcoming.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        {upcoming.length > 0 && (
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
            Next: {formatDate(upcoming[0].session_date)}
          </span>
        )}
      </div>

      {/* Timeline Content */}
      <div className="px-5 py-4">
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium">Failed to load coaching data: {error.message}</span>
          </div>
        )}

        {!isLoading && !error && displayItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Calendar className="mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold text-sm">No coaching sessions scheduled</p>
            <p className="text-xs mt-1">Schedule sessions from the Coaching tab above</p>
          </div>
        )}

        {!isLoading && !error && displayItems.length > 0 && (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-[2px] bg-gradient-to-b from-blue-200 via-slate-200 to-transparent" />

            <div className="space-y-4">
              {displayItems.slice(0, 8).map((session) => (
                <div
                  key={session.id}
                  className="group relative flex gap-4 pl-10 transition-all"
                >
                  {/* Timeline dot */}
                  <div className="absolute left-[9px] top-3 h-3.5 w-3.5 rounded-full border-[3px] border-white bg-blue-500 shadow-sm ring-2 ring-blue-100 transition-all group-hover:ring-blue-200" />

                  {/* Session card */}
                  <div className="flex-1 rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition-all group-hover:border-slate-200 group-hover:bg-white group-hover:shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{session.employee_name}</span>
                        <StatusBadge status={session.status} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDate(session.session_date)}
                      </span>
                      {formatTime(session.session_date) && (
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {formatTime(session.session_date)}
                        </span>
                      )}
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {formatSessionType(session.session_type)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {displayItems.length > 8 && (
              <p className="mt-4 text-center text-xs font-semibold text-slate-400">
                + {displayItems.length - 8} more sessions
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
