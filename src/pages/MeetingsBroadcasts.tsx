import { useEffect, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Video, Users, Calendar, RefreshCw } from "lucide-react";
import { useMcnmeetConfig, useMyMeetings, MEETING_STATUS_LABELS, type MeetingStatus } from "@/hooks/useMcnmeet";
import { MeetingList } from "@/components/mcnmeet/MeetingList";
import { MeetingForm } from "@/components/mcnmeet/MeetingForm";
import { MeetingDetails } from "@/components/mcnmeet/MeetingDetails";
import { MeetingStatusBadge } from "@/components/mcnmeet/MeetingStatusBadge";
import { useHasRole } from "@/hooks/useUserRole";
import { Skeleton } from "@/components/ui/skeleton";

const MCN_NAVY = "#073f78";

const ADMIN_ROLES = ['super_admin', 'admin', 'hr_admin', 'hr'];
const MANAGER_ROLES = [...ADMIN_ROLES, 'manager', 'process_manager', 'branch_head', 'trainer', 'coordinator', 'wfm', 'tl', 'team_leader', 'recruiter'];

type View = 'list' | 'create' | 'detail';
type Tab = 'admin' | 'my';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

export default function MeetingsBroadcasts() {
  const { data: config, isLoading: configLoading } = useMcnmeetConfig();

  // useHasRole, not user.role: HrmsUser carries only { id, email, isReadOnly },
  // so `user?.role ?? 'employee'` resolved to 'employee' for everyone and the
  // admin and manager surfaces below were hidden from all users.
  const isAdmin = useHasRole(...ADMIN_ROLES);
  const isManager = useHasRole(...MANAGER_ROLES);
  const canCreate = config?.can_create ?? false;

  const [tab, setTab] = useState<Tab>('my');

  // Roles arrive from a query, so isManager is false on first render and the
  // initial tab cannot depend on it. Land managers on 'admin' once it resolves,
  // but only before they have chosen a tab themselves.
  const tabChosen = useRef(false);
  useEffect(() => {
    if (isManager && !tabChosen.current) setTab('admin');
  }, [isManager]);
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (configLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </DashboardLayout>
    );
  }

  if (!config?.enabled) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Video className="mb-4 h-12 w-12 text-slate-300" />
          <h2 className="text-lg font-semibold text-slate-700">MCNmeet is disabled</h2>
          <p className="mt-1 text-sm text-slate-500">Contact your administrator to enable video meetings.</p>
        </div>
      </DashboardLayout>
    );
  }

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setView('detail');
  };

  const handleBack = () => {
    setView('list');
    setSelectedId(null);
  };

  const handleCreateSuccess = (id: string) => {
    setSelectedId(id);
    setView('detail');
  };

  return (
    <DashboardLayout>
      <div className="w-full space-y-5">
        {/* Hero header */}
        <div className="overflow-hidden rounded-3xl" style={{ background: MCN_NAVY }}>
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white p-1.5">
                <img src="/mcn-logo.png" alt="MCN" className="h-full w-full object-contain" />
              </div>
              <div>
                <h1 className="text-lg font-black text-white sm:text-xl">MCNmeet</h1>
                <p className="hidden text-xs text-white/70 sm:block">Meetings &amp; Broadcasts</p>
              </div>
            </div>
            {view === 'list' && canCreate && (
              <Button onClick={() => setView('create')}
                className="bg-white text-[#073f78] hover:bg-white/90 font-semibold">
                <Video className="mr-1.5 h-4 w-4" /> New Meeting
              </Button>
            )}
          </div>
          <div className="flex h-1">
            <div className="flex-1 bg-[#1B6AB5]" />
            <div className="flex-1 bg-[#3BAD49]" />
            <div className="flex-1 bg-[#E8231A]" />
          </div>
        </div>

        {/* Tabs (only if manager+ sees admin tab) */}
        {view === 'list' && isManager && (
          <div className="flex gap-1 border-b border-slate-100">
            {([
              { id: 'admin' as Tab, label: 'All Meetings', icon: <Users className="h-4 w-4" /> },
              { id: 'my' as Tab, label: 'My Meetings', icon: <Calendar className="h-4 w-4" /> },
            ]).map(t => (
              <button key={t.id} onClick={() => { tabChosen.current = true; setTab(t.id); }}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-[#073f78] text-[#073f78]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        )}

        {/* View: List */}
        {view === 'list' && tab === 'admin' && isManager && (
          <MeetingList onSelect={handleSelect} onCreate={() => setView('create')} canCreate={canCreate} />
        )}

        {view === 'list' && (tab === 'my' || !isManager) && (
          <MyMeetingsPanel onSelect={handleSelect} />
        )}

        {/* View: Create */}
        {view === 'create' && (
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="mb-5 text-lg font-bold" style={{ color: MCN_NAVY }}>Create New Meeting</h2>
            <MeetingForm
              onSuccess={handleCreateSuccess}
              onCancel={handleBack}
              allowedMeetingTypes={config?.allowed_meeting_types}
            />
          </div>
        )}

        {/* View: Detail */}
        {view === 'detail' && selectedId && (
          <MeetingDetails meetingId={selectedId} onBack={handleBack} isAdmin={isAdmin} />
        )}
      </div>
    </DashboardLayout>
  );
}

function MyMeetingsPanel({ onSelect }: { onSelect: (id: string) => void }) {
  const [status, setStatus] = useState<string>('all');
  const { data, isLoading, isError, refetch } = useMyMeetings({
    status: status !== 'all' ? status : undefined,
  });

  const meetings = data?.meetings ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {['all', 'scheduled', 'live', 'completed'].map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              status === s
                ? 'bg-[#073f78] text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s === 'all' ? 'All' : MEETING_STATUS_LABELS[s as MeetingStatus]}
          </button>
        ))}
        <Button variant="ghost" size="icon" className="ml-auto" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}
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
          <Calendar className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">No meetings scheduled for you</p>
        </div>
      )}

      <div className="space-y-3">
        {meetings.map(m => (
          <div key={m.id} onClick={() => onSelect(m.id)}
            className="cursor-pointer rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
                style={{ background: MCN_NAVY }}>
                <Video className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900 truncate">{m.title}</p>
                  <MeetingStatusBadge status={m.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  <Calendar className="mr-1 inline h-3 w-3" />
                  {fmtDate(m.start_at)}
                </p>
                <a href={m.mcnmeet_join_url} target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline"
                  style={{ color: '#1B6AB5' }}>
                  <Video className="h-3 w-3" /> Join on MCNmeet
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
