import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CalendarDays, CheckCircle2, Clock, Coffee,
  Flag, MessageSquare, RefreshCcw, ThumbsUp, Umbrella, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RosterCycle {
  id: string;
  process_id: string;
  week_start_date: string;
  week_end_date: string;
  status: string;
}

interface DailyAssignment {
  id: string;
  cycle_id: string;
  employee_id: string;
  roster_date: string;
  shift_template_id: string | null;
  shift_name: string | null;
  start_time: string | null;
  end_time: string | null;
  is_week_off: number;
  is_holiday: number;
  acknowledgement_status: string;
  acknowledged_at: string | null;
  notes: string | null;
}

interface LeaveRequest {
  id: string;
  start_date: string;
  end_date: string;
  leave_type_name?: string;
  status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weekDates(weekStart: string): string[] {
  const base = new Date(weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function fmtTime(t: string | null): string {
  if (!t) return "";
  // already HH:mm or HH:mm:ss
  return t.slice(0, 5);
}

function isOnLeave(date: string, leaves: LeaveRequest[]): LeaveRequest | undefined {
  return leaves.find(
    (l) =>
      l.status === "approved" &&
      date >= l.start_date &&
      date <= l.end_date,
  );
}

// ── Dispute Modal ─────────────────────────────────────────────────────────────

function DisputeModal({
  assignment,
  onClose,
  onSubmit,
  isPending,
}: {
  assignment: DailyAssignment;
  onClose: () => void;
  onSubmit: (assignmentId: string, reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Flag className="h-5 w-5 text-rose-600" />
            <h3 className="font-black text-slate-900">Raise Dispute</h3>
          </div>
          <button onClick={onClose} className="rounded-xl p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>
        <p className="text-sm text-slate-600 mb-1">
          Date: <strong>{fmtDate(assignment.roster_date)}</strong>
        </p>
        {assignment.shift_name && (
          <p className="text-sm text-slate-600 mb-4">
            Shift: <strong>{assignment.shift_name} ({fmtTime(assignment.start_time)} – {fmtTime(assignment.end_time)})</strong>
          </p>
        )}
        <label className="block text-xs font-bold text-slate-700 mb-1">Reason for dispute *</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Explain why this assignment needs to be reviewed..."
          className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-blue-500 focus:outline-none resize-none"
        />
        <div className="mt-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            disabled={!reason.trim() || isPending}
            onClick={() => onSubmit(assignment.id, reason.trim())}
            className="flex-1 rounded-xl bg-rose-600 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {isPending ? "Submitting..." : "Submit Dispute"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DayCell({
  label,
  date,
  assignment,
  leave,
  cyclePublished,
  onAck,
  onDispute,
  ackPending,
}: {
  label: string;
  date: string;
  assignment: DailyAssignment | undefined;
  leave: LeaveRequest | undefined;
  cyclePublished: boolean;
  onAck: (id: string) => void;
  onDispute: (a: DailyAssignment) => void;
  ackPending: boolean;
}) {
  const isOff = assignment?.is_week_off === 1;
  const isHoliday = assignment?.is_holiday === 1;
  const isToday = date === new Date().toISOString().slice(0, 10);
  const ackStatus = assignment?.acknowledgement_status;
  const isAcked = ackStatus === "acknowledged";
  const isDisputed = ackStatus === "disputed";

  let bg = "bg-white";
  let borderColor = "border-slate-200";
  if (isToday) { bg = "bg-blue-50"; borderColor = "border-blue-400"; }
  if (isOff) { bg = "bg-slate-100"; borderColor = "border-slate-300"; }
  if (isHoliday) { bg = "bg-violet-50"; borderColor = "border-violet-300"; }
  if (leave) { bg = "bg-amber-50"; borderColor = "border-amber-300"; }
  if (isDisputed) { bg = "bg-rose-50"; borderColor = "border-rose-400"; }
  if (isAcked && !isOff && !isHoliday && !leave) { borderColor = "border-emerald-400"; }

  const showActions = cyclePublished && assignment && !isOff && !isHoliday && !leave;

  return (
    <div className={`rounded-2xl border-2 ${borderColor} ${bg} p-3 flex flex-col gap-1 min-h-[130px]`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-black uppercase ${isToday ? "text-blue-600" : "text-slate-500"}`}>{label}</span>
        <span className="text-xs text-slate-400">{new Date(date).getDate()}</span>
      </div>

      {leave && (
        <div className="flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1">
          <Umbrella className="h-3 w-3 text-amber-600 shrink-0" />
          <span className="text-xs font-bold text-amber-700 truncate">
            {leave.leave_type_name ?? "On Leave"}
          </span>
        </div>
      )}

      {isHoliday && !leave && (
        <div className="flex items-center gap-1 rounded-lg bg-violet-100 px-2 py-1">
          <CalendarDays className="h-3 w-3 text-violet-600 shrink-0" />
          <span className="text-xs font-bold text-violet-700">Holiday</span>
        </div>
      )}

      {isOff && !leave && !isHoliday && (
        <div className="flex items-center gap-1 rounded-lg bg-slate-200 px-2 py-1">
          <Coffee className="h-3 w-3 text-slate-500 shrink-0" />
          <span className="text-xs font-bold text-slate-500">Weekly Off</span>
        </div>
      )}

      {!isOff && !isHoliday && !leave && assignment?.shift_name && (
        <>
          <span className="text-xs font-black text-slate-800 truncate">{assignment.shift_name}</span>
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Clock className="h-3 w-3 shrink-0" />
            {fmtTime(assignment.start_time)} – {fmtTime(assignment.end_time)}
          </span>
        </>
      )}

      {!assignment && !leave && (
        <span className="text-xs text-slate-400 italic">Not assigned</span>
      )}

      {/* Ack status badge */}
      {isAcked && (
        <div className="mt-auto flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
          <span className="text-xs font-bold text-emerald-700">Acknowledged</span>
        </div>
      )}
      {isDisputed && (
        <div className="mt-auto flex items-center gap-1">
          <Flag className="h-3 w-3 text-rose-600 shrink-0" />
          <span className="text-xs font-bold text-rose-700">Disputed</span>
        </div>
      )}

      {/* Per-day action buttons */}
      {showActions && !isAcked && !isDisputed && (
        <div className="mt-auto flex gap-1 pt-1">
          <button
            disabled={ackPending}
            onClick={() => onAck(assignment.id)}
            className="flex-1 rounded-lg bg-emerald-600 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-0.5"
          >
            <ThumbsUp className="h-3 w-3" /> OK
          </button>
          <button
            onClick={() => onDispute(assignment)}
            className="flex-1 rounded-lg border border-rose-300 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50 flex items-center justify-center gap-0.5"
          >
            <MessageSquare className="h-3 w-3" /> ?
          </button>
        </div>
      )}
    </div>
  );
}

function CycleCard({
  cycle,
  onSelect,
  selected,
}: {
  cycle: RosterCycle;
  onSelect: () => void;
  selected: boolean;
}) {
  const isPublished = ["published", "acknowledged", "active"].includes(cycle.status);
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-2xl border-2 p-4 text-left transition-all ${
        selected
          ? "border-blue-500 bg-blue-50"
          : "border-slate-200 bg-white hover:border-slate-400"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-black text-slate-900">
          {fmtDate(cycle.week_start_date)} – {fmtDate(cycle.week_end_date)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            isPublished
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {cycle.status.replace(/_/g, " ")}
        </span>
      </div>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NativeMyRoster() {
  const qc = useQueryClient();
  const [selectedCycleId, setSelectedCycleId] = useState<string>("");
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [disputeTarget, setDisputeTarget] = useState<DailyAssignment | null>(null);

  // Fetch published/active cycles for the employee's process
  const cyclesQ = useQuery({
    queryKey: ["my-roster-cycles"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: RosterCycle[] }>(
        "/api/roster-gov/my-cycles?status=published,acknowledged,active",
      );
      return res.data ?? [];
    },
  });

  const cycles: RosterCycle[] = cyclesQ.data ?? [];
  const selectedCycle = cycles.find((c) => c.id === selectedCycleId) ?? cycles[0];

  // Auto-select first cycle on load
  const onSelectCycle = useCallback(
    (id: string) => {
      setSelectedCycleId(id);
      setNotice(null);
    },
    [],
  );

  // Fetch roster assignments for selected cycle
  const assignmentsQ = useQuery({
    queryKey: ["my-roster-assignments", selectedCycle?.id],
    enabled: !!selectedCycle?.id,
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: DailyAssignment[] }>(
        `/api/roster-gov/my-roster/${selectedCycle!.id}`,
      );
      return res.data ?? [];
    },
  });

  const assignments: DailyAssignment[] = assignmentsQ.data ?? [];

  // Fetch employee's leave requests
  const leavesQ = useQuery({
    queryKey: ["my-leave-requests"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: LeaveRequest[] }>(
        "/api/leave/requests?my=true&status=approved&limit=100",
      );
      return res.data ?? [];
    },
  });

  const leaves: LeaveRequest[] = leavesQ.data ?? [];

  // Bulk-acknowledge entire week
  const ackMutation = useMutation({
    mutationFn: (cycleId: string) =>
      hrmsApi.post<{ data: { acknowledged: number } }>(
        `/api/roster-gov/cycles/${cycleId}/acknowledge`,
        {},
      ),
    onSuccess: (res) => {
      const count = res.data?.acknowledged ?? 0;
      setNotice({
        type: "success",
        msg: count > 0 ? `Roster acknowledged (${count} days confirmed).` : "Roster already acknowledged.",
      });
      void qc.invalidateQueries({ queryKey: ["my-roster-assignments", selectedCycle?.id] });
    },
    onError: (err: Error) => {
      setNotice({ type: "error", msg: err.message ?? "Acknowledgement failed." });
    },
  });

  // Per-assignment acknowledge
  const perDayAckMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      hrmsApi.post<{ success: boolean }>(`/api/roster-gov/assignments/${assignmentId}/acknowledge`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-roster-assignments", selectedCycle?.id] });
    },
    onError: (err: Error) => {
      setNotice({ type: "error", msg: err.message ?? "Acknowledgement failed." });
    },
  });

  // Per-assignment dispute
  const disputeMutation = useMutation({
    mutationFn: ({ assignmentId, dispute_reason }: { assignmentId: string; dispute_reason: string }) =>
      hrmsApi.post<{ success: boolean }>(`/api/roster-gov/assignments/${assignmentId}/dispute`, { dispute_reason }),
    onSuccess: () => {
      setDisputeTarget(null);
      setNotice({ type: "success", msg: "Dispute raised. Your manager will review." });
      void qc.invalidateQueries({ queryKey: ["my-roster-assignments", selectedCycle?.id] });
    },
    onError: (err: Error) => {
      setNotice({ type: "error", msg: err.message ?? "Dispute submission failed." });
    },
  });

  // Derived state
  const dates = selectedCycle ? weekDates(selectedCycle.week_start_date) : [];

  const pendingAck =
    selectedCycle &&
    ["published", "acknowledged", "active"].includes(selectedCycle.status) &&
    assignments.some((a) => a.acknowledgement_status === "pending");

  const allAcknowledged =
    assignments.length > 0 &&
    assignments.every((a) => a.acknowledgement_status === "acknowledged");

  const isLoading = cyclesQ.isLoading || assignmentsQ.isFetching;
  const cyclePublished = selectedCycle ? ["published", "acknowledged", "active"].includes(selectedCycle.status) : false;

  return (
    <DashboardLayout>
      {disputeTarget && (
        <DisputeModal
          assignment={disputeTarget}
          onClose={() => setDisputeTarget(null)}
          onSubmit={(id, reason) => disputeMutation.mutate({ assignmentId: id, dispute_reason: reason })}
          isPending={disputeMutation.isPending}
        />
      )}
      <div className="space-y-6">

        {/* Header */}
        <header className="rounded-3xl bg-slate-950 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-blue-300">
            WFM · My Roster
          </p>
          <h1 className="mt-2 text-3xl font-black">My Weekly Schedule</h1>
          <p className="mt-2 text-sm text-slate-300">
            View your assigned shifts, weekly off, and leave for each published roster week.
            Acknowledge your schedule to confirm you have reviewed it.
          </p>
        </header>

        {/* Notice */}
        {notice && (
          <div
            className={`rounded-xl border p-4 text-sm font-semibold ${
              notice.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {notice.msg}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[320px_1fr]">

          {/* Cycle Selector */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">Weeks</h2>
              <button
                onClick={() => void qc.invalidateQueries({ queryKey: ["my-roster-cycles"] })}
                className="rounded-xl border p-2 text-slate-500 hover:bg-slate-100"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
            </div>
            {cyclesQ.isLoading ? (
              <div className="rounded-2xl border bg-white p-6 text-center text-sm text-slate-400">
                Loading weeks...
              </div>
            ) : cycles.length === 0 ? (
              <div className="rounded-2xl border bg-white p-6 text-center text-sm text-slate-400">
                No published roster cycles found.
              </div>
            ) : (
              cycles.map((c) => (
                <CycleCard
                  key={c.id}
                  cycle={c}
                  selected={(selectedCycleId || cycles[0]?.id) === c.id}
                  onSelect={() => onSelectCycle(c.id)}
                />
              ))
            )}
          </div>

          {/* Roster Calendar */}
          <div className="space-y-4">
            {selectedCycle ? (
              <>
                {/* Acknowledgement Banner */}
                {pendingAck && (
                  <div className="flex items-start justify-between gap-4 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                      <div>
                        <p className="font-black text-amber-800">
                          Roster for {fmtDate(selectedCycle.week_start_date)} –{" "}
                          {fmtDate(selectedCycle.week_end_date)} needs acknowledgement
                        </p>
                        <p className="mt-0.5 text-sm text-amber-700">
                          Please review your schedule for the week and confirm below.
                        </p>
                      </div>
                    </div>
                    <button
                      disabled={ackMutation.isPending}
                      onClick={() => ackMutation.mutate(selectedCycle.id)}
                      className="shrink-0 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {ackMutation.isPending ? "Saving..." : "Acknowledge Week"}
                    </button>
                  </div>
                )}

                {allAcknowledged && (
                  <div className="flex items-center gap-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <p className="font-bold text-emerald-800">
                      You have acknowledged this week's roster.
                    </p>
                  </div>
                )}

                {/* Week Header */}
                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <h3 className="font-black text-slate-900">
                    Week of {fmtDate(selectedCycle.week_start_date)}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {fmtDate(selectedCycle.week_start_date)} – {fmtDate(selectedCycle.week_end_date)}
                  </p>
                </div>

                {/* Calendar Grid */}
                {isLoading ? (
                  <div className="flex items-center justify-center rounded-3xl border bg-white py-20">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-950" />
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
                    {dates.map((date, i) => {
                      const asgn = assignments.find((a) => a.roster_date.slice(0, 10) === date);
                      const leave = isOnLeave(date, leaves);
                      return (
                        <DayCell
                          key={date}
                          label={DAY_LABELS[i]}
                          date={date}
                          assignment={asgn}
                          leave={leave}
                          cyclePublished={cyclePublished}
                          onAck={(id) => perDayAckMutation.mutate(id)}
                          onDispute={(a) => setDisputeTarget(a)}
                          ackPending={perDayAckMutation.isPending}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Legend */}
                <div className="flex flex-wrap gap-3 text-xs">
                  {[
                    { color: "bg-blue-50 border-blue-400", label: "Today" },
                    { color: "bg-white border-slate-200", label: "Shift Day" },
                    { color: "bg-slate-100 border-slate-300", label: "Weekly Off" },
                    { color: "bg-violet-50 border-violet-300", label: "Holiday" },
                    { color: "bg-amber-50 border-amber-300", label: "On Leave" },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <div className={`h-3 w-3 rounded border-2 ${color}`} />
                      <span className="text-slate-600">{label}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              !cyclesQ.isLoading && (
                <div className="flex items-center justify-center rounded-3xl border bg-white py-24 text-sm text-slate-400">
                  Select a week from the left to view your schedule.
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
