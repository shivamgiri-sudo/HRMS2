import { Link } from "react-router-dom";
import { Video, Calendar, ChevronRight, Bell, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyMeetings, MEETING_STATUS_LABELS, type Meeting } from "@/hooks/useMcnmeet";
import { MeetingStatusBadge } from "./MeetingStatusBadge";

const MCN_NAVY = "#073f78";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function isJoinable(meeting: Meeting): boolean {
  if (meeting.status === 'live') return true;
  if (meeting.status !== 'scheduled') return false;
  const startTime = new Date(meeting.start_at).getTime();
  const now = Date.now();
  const fifteenMinutes = 15 * 60 * 1000;
  return startTime - now <= fifteenMinutes && startTime > now - (60 * 60 * 1000);
}

export function MyMeetingsWidget() {
  const { data, isLoading, isError } = useMyMeetings({ status: 'scheduled' });

  const upcoming = (data?.meetings ?? [])
    .filter(m => m.status === 'scheduled' || m.status === 'live')
    .slice(0, 3);

  const unacknowledgedCount = (data?.meetings ?? []).filter(
    m => m.acknowledgement_required && m.status === 'scheduled'
  ).length;

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3" style={{ background: MCN_NAVY }}>
          <Skeleton className="h-5 w-32 bg-white/20" />
        </div>
        <div className="p-4 space-y-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <WidgetHeader unacknowledgedCount={0} />
        <div className="p-6 text-center text-sm text-slate-400">
          Could not load meetings
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <WidgetHeader unacknowledgedCount={unacknowledgedCount} />

      {/* Three-stripe */}
      <div className="flex h-1">
        <div className="flex-1 bg-[#1B6AB5]" />
        <div className="flex-1 bg-[#3BAD49]" />
        <div className="flex-1 bg-[#E8231A]" />
      </div>

      <div className="p-3">
        {upcoming.length === 0 ? (
          <div className="py-8 text-center">
            <Calendar className="mx-auto mb-2 h-8 w-8 text-slate-200" />
            <p className="text-sm text-slate-400">No upcoming meetings</p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.map(m => (
              <MeetingRow key={m.id} meeting={m} />
            ))}
          </div>
        )}

        <Link
          to="/meetings"
          className="mt-3 flex items-center justify-center gap-1 rounded-lg border border-slate-100 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
        >
          View all meetings <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function WidgetHeader({ unacknowledgedCount }: { unacknowledgedCount: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-3" style={{ background: MCN_NAVY }}>
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white p-0.5">
          <img src="/mcn-logo.png" alt="MCN" className="h-full w-full object-contain" />
        </div>
        <span className="font-bold text-white text-sm">My Meetings</span>
      </div>
      <div className="flex items-center gap-2">
        {unacknowledgedCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-amber-900">
            <Bell className="h-3 w-3" /> {unacknowledgedCount}
          </span>
        )}
        <Link to="/meetings" className="text-xs text-blue-200 hover:text-white hover:underline">
          View all
        </Link>
      </div>
    </div>
  );
}

function MeetingRow({ meeting: m }: { meeting: Meeting }) {
  const joinable = isJoinable(m);
  const isLive = m.status === 'live';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 hover:bg-slate-50 transition-colors">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
        style={{ background: isLive ? '#3BAD49' : MCN_NAVY }}
      >
        <Video className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-800">{m.title}</p>
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Calendar className="h-3 w-3" />
          {fmtTime(m.start_at)}
          {isLive && (
            <span className="animate-pulse rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700">
              LIVE NOW
            </span>
          )}
        </p>
      </div>

      {joinable ? (
        <a
          href={m.mcnmeet_join_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: isLive ? '#3BAD49' : MCN_NAVY }}
        >
          Join
        </a>
      ) : (
        <MeetingStatusBadge status={m.status} className="shrink-0" />
      )}
    </div>
  );
}
