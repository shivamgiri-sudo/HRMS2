import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Calendar, Clock, Users, ExternalLink, Video, AlertTriangle, Loader2, Check, Link2, CalendarDays } from "lucide-react";
import {
  useMeeting, useCancelMeeting, useResolveInvitees, useAddRecording, useUpdateMeeting, useAcknowledge, useSelfJoin,
  getCalendarDownloadUrl, MEETING_TYPE_LABELS, MEETING_STATUS_LABELS, AUDIENCE_TYPE_LABELS, type MeetingStatus, type Invitee,
} from "@/hooks/useMcnmeet";
import { MeetingStatusBadge } from "./MeetingStatusBadge";
import { AttendancePanel } from "./AttendancePanel";

const MCN_NAVY = "#073f78";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

interface Props {
  meetingId: string;
  onBack: () => void;
  isAdmin?: boolean;
}

type Tab = 'overview' | 'invitees' | 'attendance' | 'recording';

const STATUS_TRANSITIONS: MeetingStatus[] = ['draft', 'scheduled', 'live', 'completed', 'cancelled'];

export function MeetingDetails({ meetingId, onBack, isAdmin }: Props) {
  const { data: meeting, isLoading, isError, refetch } = useMeeting(meetingId);
  const cancelMeeting   = useCancelMeeting(meetingId);
  const resolveInvitees = useResolveInvitees(meetingId);
  const addRecording    = useAddRecording(meetingId);
  const updateMeeting   = useUpdateMeeting(meetingId);
  const acknowledge     = useAcknowledge(meetingId);
  const selfJoin        = useSelfJoin(meetingId);

  const [tab, setTab]                 = useState<Tab>('overview');
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [recordingUrl, setRecordingUrl] = useState("");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }

  if (isError || !meeting) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-400" />
        <p className="text-sm font-semibold text-red-700">Could not load meeting</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const canCancel = isAdmin && meeting.status !== 'cancelled' && meeting.status !== 'completed';
  const canResolve = isAdmin && (meeting.status === 'scheduled' || meeting.status === 'draft');
  const canAddRecording = isAdmin && !!meeting.recording_required && meeting.status === 'completed';
  const isLive = meeting.status === 'live';

  const handleCancel = async () => {
    if (!cancelReason.trim()) { toast.error("Reason is required"); return; }
    try {
      await cancelMeeting.mutateAsync(cancelReason);
      toast.success("Meeting cancelled");
      setCancelModal(false);
      setCancelReason("");
    } catch { toast.error("Failed to cancel meeting"); }
  };

  const handleResolve = async () => {
    try {
      const res = await resolveInvitees.mutateAsync() as any;
      toast.success(`${res?.invitees_added ?? 0} invitees resolved`);
    } catch { toast.error("Failed to resolve invitees"); }
  };

  const handleAddRecording = async () => {
    if (!recordingUrl.trim()) { toast.error("URL is required"); return; }
    try {
      await addRecording.mutateAsync(recordingUrl);
      toast.success("Recording saved");
      setRecordingUrl("");
    } catch { toast.error("Failed to save recording"); }
  };

  const handleStatusChange = async (s: string) => {
    if (!s) return;
    try {
      await updateMeeting.mutateAsync({ status: s as MeetingStatus });
      toast.success(`Status updated to ${MEETING_STATUS_LABELS[s as MeetingStatus]}`);
    } catch { toast.error("Failed to update status"); }
  };

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'overview',   label: 'Overview',   show: true },
    { id: 'invitees',   label: `Invitees (${(meeting.invitees ?? []).length})`, show: true },
    { id: 'attendance', label: 'Attendance', show: !!isAdmin && !!meeting.attendance_required },
    { id: 'recording',  label: 'Recording',  show: !!isAdmin },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0 mt-0.5">Back</Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-black truncate" style={{ color: MCN_NAVY }}>{meeting.title}</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {MEETING_TYPE_LABELS[meeting.meeting_type]} - {meeting.meeting_code}
              </p>
            </div>
            <MeetingStatusBadge status={meeting.status} className="mt-0.5" />
          </div>
        </div>
      </div>

      <div className="flex gap-0 overflow-x-auto border-b border-slate-100">
        {tabs.filter(t => t.show).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
              tab === t.id
                ? 'border-[#073f78] text-[#073f78]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="flex items-center gap-2 px-4 py-3" style={{ background: MCN_NAVY }}>
              <img src="/mcn-logo.png" alt="MCN" className="h-6 w-6 rounded-md bg-white p-0.5 object-contain" />
              <span className="font-bold text-white text-sm">MCNmeet Room</span>
              {isLive && (
                <span className="ml-auto animate-pulse rounded-full bg-green-400 px-2 py-0.5 text-xs font-bold text-white">
                  LIVE
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-3 bg-white p-4">
              <a href={meeting.mcnmeet_join_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: MCN_NAVY }}>
                <Video className="h-4 w-4" /> Join on MCNmeet
              </a>
              {meeting.google_meet_backup_url && (
                <a href={meeting.google_meet_backup_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <ExternalLink className="h-3.5 w-3.5" /> Google Meet (backup)
                </a>
              )}
              <button
                onClick={() => { navigator.clipboard.writeText(meeting.mcnmeet_join_url); toast.success("Link copied"); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50">
                <Link2 className="h-3.5 w-3.5" /> Copy link
              </button>
              <a
                href={getCalendarDownloadUrl(meetingId)}
                download
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50">
                <CalendarDays className="h-3.5 w-3.5" /> Add to calendar
              </a>
            </div>
            <div className="flex h-1">
              <div className="flex-1 bg-[#1B6AB5]" />
              <div className="flex-1 bg-[#3BAD49]" />
              <div className="flex-1 bg-[#E8231A]" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow icon={<Calendar className="h-4 w-4" />} label="Start">{fmtDate(meeting.start_at)}</InfoRow>
            {meeting.end_at && <InfoRow icon={<Clock className="h-4 w-4" />} label="End">{fmtDate(meeting.end_at)}</InfoRow>}
            <InfoRow icon={<Users className="h-4 w-4" />} label="Host">{meeting.host_employee_id}</InfoRow>
            <InfoRow icon={<Clock className="h-4 w-4" />} label="Timezone">{meeting.timezone}</InfoRow>
          </div>

          {meeting.description && (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Description / Agenda</p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{meeting.description}</p>
            </div>
          )}

          {(meeting.audience ?? []).length > 0 && (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Audience</p>
              <div className="flex flex-wrap gap-2">
                {(meeting.audience ?? []).map((a, i) => (
                  <span key={i} className="rounded-full bg-white border border-slate-200 px-3 py-0.5 text-xs text-slate-600">
                    {AUDIENCE_TYPE_LABELS[a.type]}{a.label ? `: ${a.label}` : a.value ? `: ${a.value}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!isAdmin && (
            <div className="flex flex-wrap gap-3 pt-1">
              <Button size="sm" variant="outline" disabled={selfJoin.isPending} onClick={async () => {
                try { await selfJoin.mutateAsync(); toast.success("Marked as joined"); }
                catch { toast.error("Failed"); }
              }}>
                {selfJoin.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                Mark myself as joined
              </Button>
              {!!meeting.acknowledgement_required && (
                <Button size="sm" style={{ background: MCN_NAVY }} className="text-white hover:opacity-90"
                  disabled={acknowledge.isPending} onClick={async () => {
                    try { await acknowledge.mutateAsync(); toast.success("Acknowledged"); }
                    catch { toast.error("Failed"); }
                  }}>
                  {acknowledge.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                  Acknowledge
                </Button>
              )}
            </div>
          )}

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              {canResolve && (
                <Button variant="outline" size="sm" disabled={resolveInvitees.isPending} onClick={handleResolve}>
                  {resolveInvitees.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Users className="mr-1.5 h-3.5 w-3.5" />}
                  Resolve invitees
                </Button>
              )}

              <Select onValueChange={handleStatusChange}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Change status..." />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_TRANSITIONS.map(s => (
                    <SelectItem key={s} value={s} disabled={s === meeting.status}>
                      {MEETING_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {canCancel && (
                <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => setCancelModal(true)}>
                  Cancel meeting
                </Button>
              )}
            </div>
          )}

          {cancelModal && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-sm font-semibold text-red-700">Cancel this meeting?</p>
              <Textarea rows={2} placeholder="Reason for cancellation (required)"
                value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setCancelModal(false)}>Keep it</Button>
                <Button size="sm" className="bg-red-600 text-white hover:bg-red-700"
                  disabled={cancelMeeting.isPending} onClick={handleCancel}>
                  {cancelMeeting.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Yes, cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'invitees' && (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <div className="grid grid-cols-[1fr_100px_100px_100px] gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span>Employee</span><span>Invite</span><span>Joined</span><span>Ack</span>
          </div>
          {(meeting.invitees ?? []).length === 0 && (
            <p className="py-12 text-center text-sm text-slate-400">No invitees yet - resolve audience to populate</p>
          )}
          {(meeting.invitees ?? []).map((inv: Invitee) => (
            <div key={inv.id} className="grid grid-cols-[1fr_100px_100px_100px] gap-2 items-center border-b border-slate-50 px-4 py-2.5 last:border-0 hover:bg-slate-50/50">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{inv.employee_name}</p>
                <p className="text-xs text-slate-400">{inv.employee_code ?? inv.employee_id}</p>
              </div>
              <StatusPill value={inv.invite_status}
                colorMap={{ pending: 'slate', accepted: 'green', declined: 'red' }}
                labels={{ pending: 'Pending', accepted: 'Accepted', declined: 'Declined' }} />
              <StatusPill value={inv.joined_status}
                colorMap={{ not_joined: 'red', joined: 'green', late: 'amber' }}
                labels={{ not_joined: 'Absent', joined: 'Joined', late: 'Late' }} />
              <StatusPill value={inv.acknowledgement_status}
                colorMap={{ pending: 'slate', acknowledged: 'green' }}
                labels={{ pending: 'Pending', acknowledged: 'Ack' }} />
            </div>
          ))}
        </div>
      )}

      {tab === 'attendance' && isAdmin && !!meeting.attendance_required && (
        <AttendancePanel meetingId={meetingId} invitees={meeting.invitees ?? []} />
      )}

      {tab === 'recording' && isAdmin && (
        <div className="space-y-4">
          {meeting.recording_url ? (
            <div className="flex items-center gap-3 rounded-2xl border border-purple-100 bg-purple-50 p-4">
              <Video className="h-5 w-5 shrink-0 text-purple-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-purple-800">Recording saved</p>
                <a href={meeting.recording_url} target="_blank" rel="noopener noreferrer"
                  className="block truncate text-xs text-purple-600 hover:underline">{meeting.recording_url}</a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No recording saved yet.</p>
          )}
          {canAddRecording && (
            <div className="space-y-2">
              <Label htmlFor="rec_url">Add / Update Recording URL</Label>
              <div className="flex gap-2">
                <Input id="rec_url" type="url" className="flex-1" placeholder="https://..."
                  value={recordingUrl} onChange={e => setRecordingUrl(e.target.value)} />
                <Button disabled={addRecording.isPending} onClick={handleAddRecording}
                  style={{ background: MCN_NAVY }} className="text-white hover:opacity-90">
                  {addRecording.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div>
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        <span className="text-slate-700">{children}</span>
      </div>
    </div>
  );
}

const PILL_COLORS: Record<string, string> = {
  slate:  'bg-slate-100 text-slate-600',
  green:  'bg-green-100 text-green-700',
  red:    'bg-red-100 text-red-600',
  amber:  'bg-amber-100 text-amber-700',
  purple: 'bg-purple-100 text-purple-700',
};

function StatusPill({ value, colorMap, labels }: {
  value: string;
  colorMap: Record<string, string>;
  labels: Record<string, string>;
}) {
  const cls = PILL_COLORS[colorMap[value] ?? 'slate'];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {labels[value] ?? value}
    </span>
  );
}
