import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, Video, Calendar, ExternalLink, RefreshCw } from "lucide-react";
import { useMeetingsList, MEETING_TYPE_LABELS, MEETING_STATUS_LABELS, type Meeting, type MeetingStatus, type MeetingType } from "@/hooks/useMcnmeet";
import { MeetingStatusBadge } from "./MeetingStatusBadge";

interface Props {
  onSelect: (id: string) => void;
  onCreate: () => void;
  canCreate?: boolean;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

const MCN_NAVY = "#073f78";

export function MeetingList({ onSelect, onCreate, canCreate }: Props) {
  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState<string>("all");
  const [type, setType]         = useState<string>("all");
  const [page, setPage]         = useState(1);

  const { data, isLoading, isError, refetch } = useMeetingsList({
    status: status !== "all" ? status : undefined,
    type:   type   !== "all" ? type   : undefined,
    page,
  });

  const meetings = (data?.meetings ?? []).filter(m =>
    !search || m.title.toLowerCase().includes(search.toLowerCase())
  );
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input placeholder="Search meetings..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9" />
        </div>

        <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.entries(MEETING_STATUS_LABELS) as [MeetingStatus, string][]).map(([v, l]) =>
              <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={type} onValueChange={v => { setType(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {(Object.entries(MEETING_TYPE_LABELS) as [MeetingType, string][]).map(([v, l]) =>
              <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>

        <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>

        {canCreate && (
          <Button onClick={onCreate} style={{ background: MCN_NAVY }} className="text-white hover:opacity-90">
            <Plus className="mr-1.5 h-4 w-4" /> New Meeting
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      )}

      {isError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-semibold text-red-700">Could not load meetings</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {!isLoading && !isError && meetings.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-16 text-center">
          <Video className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">No meetings found</p>
          {canCreate && (
            <Button variant="outline" size="sm" className="mt-3" onClick={onCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Create first meeting
            </Button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {meetings.map(m => <MeetingCard key={m.id} meeting={m} onSelect={onSelect} />)}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-slate-500">
            Showing {(page-1)*20+1}-{Math.min(page*20, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p-1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p+1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MeetingCard({ meeting: m, onSelect }: { meeting: Meeting; onSelect: (id: string) => void }) {
  return (
    <div
      className="group cursor-pointer rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
      onClick={() => onSelect(m.id)}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: MCN_NAVY }}>
          <Video className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 truncate">{m.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{MEETING_TYPE_LABELS[m.meeting_type]} - {m.meeting_code}</p>
            </div>
            <MeetingStatusBadge status={m.status} />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {fmtDate(m.start_at)}
              {m.end_at && ` - ${fmtDate(m.end_at)}`}
            </span>
            <a
              href={m.mcnmeet_join_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 font-medium text-[#1B6AB5] hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> MCNmeet
            </a>
            {m.google_meet_backup_url && (
              <a
                href={m.google_meet_backup_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1 text-slate-500 hover:text-slate-800"
              >
                <ExternalLink className="h-3 w-3" /> G Meet
              </a>
            )}
            {m.recording_url && (
              <a
                href={m.recording_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1 text-purple-600 hover:underline font-medium"
              >
                Recording
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
