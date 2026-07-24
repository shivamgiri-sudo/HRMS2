import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import mcnLogo from "@/assets/brand/mcn-logo.png";

// ── Types ──────────────────────────────────────────────────────────────────────

interface OpsBoardEntry {
  candidate_code: string;
  candidate_name: string;
  current_stage: string;
  applied_role: string | null;
  round1_result: string | null;
  skilltest_result: string | null;
  round2_result: string | null;
  final_decision: string | null;
  walkin_end_stage: string | null;
  assessment_percentage: number | null;
  mcq_percentage: number | null;
  typing_net_wpm: number | null;
  typing_accuracy: number | null;
  arrived_at: string | null;
  recruiter_assigned_name: string | null;
  second_round_interviewer_name_snapshot: string | null;
}

type TabKey = "all" | "waiting" | "interview" | "decisions";

// ── Constants ──────────────────────────────────────────────────────────────────

const POLL_MS = 30_000;

const WAITING_STAGES   = ["Arrived", "Applied", "New", "Screening", "Written Test", "Hold"];
const INTERVIEW_STAGES = ["Round 1- HR Screening", "HR Interview", "Interview - Skill Test", "Round 2- Op's", "Operations Interview"];
const DECISION_STAGES  = ["Selected", "Offered", "Joined", "Rejected", "No Show", "Dropped"];

// Pipeline position — used for journey cell rendering (stage-order guard)
const PIPELINE_POS: Record<string, number> = {
  Arrived: 0, Applied: 0, New: 0, Screening: 0, "Written Test": 0, Hold: 0,
  "Round 1- HR Screening": 1, "HR Interview": 1,
  "Interview - Skill Test": 2,
  "Round 2- Op's": 3, "Operations Interview": 3,
  Selected: 4, Offered: 4, Joined: 4, Rejected: 4, "No Show": 4, Dropped: 4,
};

const STAGE_DISPLAY: Record<string, string> = {
  "Round 2- Op's": "Ops Round",
  "Operations Interview": "Ops Round",
  "Round 1- HR Screening": "HR Round",
  "HR Interview": "HR Round",
  "Interview - Skill Test": "Skill Test",
};

const STAGE_BADGE_CLS: Record<string, string> = {
  "Round 1- HR Screening":  "bg-sky-500/20 text-sky-300 border-sky-500/30",
  "HR Interview":            "bg-sky-500/20 text-sky-300 border-sky-500/30",
  "Interview - Skill Test":  "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "Round 2- Op's":           "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  "Operations Interview":    "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  Selected:                  "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  Offered:                   "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  Joined:                    "bg-teal-500/20 text-teal-300 border-teal-500/30",
  Rejected:                  "bg-rose-500/20 text-rose-300 border-rose-500/30",
  "No Show":                 "bg-orange-500/20 text-orange-300 border-orange-500/30",
  Dropped:                   "bg-rose-700/20 text-rose-400 border-rose-700/30",
  Arrived:                   "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  Applied:                   "bg-slate-500/20 text-slate-400 border-slate-600",
  New:                       "bg-slate-500/20 text-slate-400 border-slate-600",
  Screening:                 "bg-slate-500/20 text-slate-400 border-slate-600",
  "Written Test":            "bg-purple-500/20 text-purple-300 border-purple-500/30",
  Hold:                      "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtNow(): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  }).format(new Date());
}

function fmtTime(iso: string | null | Date): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "numeric", minute: "2-digit", hour12: true,
    }).format(typeof iso === "string" ? new Date(iso) : iso);
  } catch { return "—"; }
}

function waitMins(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatTile({
  label, value, color = "text-slate-200",
}: {
  label: string; value: string | number; color?: string;
}) {
  return (
    <div className="text-center min-w-[56px]">
      <p className={`text-2xl font-black tabular-nums leading-none ${color}`}>{value}</p>
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

function Th({ children, center }: { children: string; center?: boolean }) {
  return (
    <th className={`px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 whitespace-nowrap ${center ? "text-center" : "text-left"}`}>
      {children}
    </th>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const label = STAGE_DISPLAY[stage] ?? stage;
  const cls   = STAGE_BADGE_CLS[stage] ?? "bg-slate-500/20 text-slate-400 border-slate-600";
  return (
    <span className={`inline-block border rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function JourneyCell({
  result, roundPos, candidatePos,
}: {
  result: string | null; roundPos: number; candidatePos: number;
}) {
  // Round not yet reached
  if (roundPos > candidatePos) {
    return <span className="text-slate-700">—</span>;
  }
  // Currently in this round (in progress)
  if (roundPos === candidatePos) {
    return <span className="text-amber-400 font-bold">●</span>;
  }
  // Past this round — show actual result
  if (result === "Selected" || result === "Pass") {
    return <span className="text-emerald-400 font-bold text-base">✓</span>;
  }
  if (result === "Rejected" || result === "Fail") {
    return <span className="text-rose-400 font-bold text-base">✗</span>;
  }
  // Passed through but result not explicitly recorded
  return <span className="text-slate-600">—</span>;
}

function DecisionBadge({ entry }: { entry: OpsBoardEntry }) {
  const isSelected = entry.final_decision === "Selected"
    || entry.current_stage === "Selected"
    || entry.current_stage === "Offered";
  const isRejected = entry.final_decision === "Rejected"
    || entry.current_stage === "Rejected";

  if (isSelected) {
    return (
      <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        SELECTED
      </span>
    );
  }
  if (isRejected) {
    return (
      <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-black bg-rose-500/20 text-rose-300 border border-rose-500/30">
        REJECTED
      </span>
    );
  }
  return <span className="text-slate-700">—</span>;
}

function TypingCell({ wpm, accuracy }: { wpm: number | null; accuracy: number | null }) {
  if (wpm == null && accuracy == null) return <span className="text-slate-700">—</span>;
  return (
    <div className="flex flex-col items-center gap-0.5">
      {wpm != null && (
        <span className="text-sm font-bold text-slate-200 tabular-nums">{Math.round(wpm)} WPM</span>
      )}
      {accuracy != null && (
        <span className={`text-xs font-semibold tabular-nums ${
          accuracy >= 90 ? "text-emerald-400" : accuracy >= 75 ? "text-amber-400" : "text-rose-400"
        }`}>
          {accuracy.toFixed(0)}% acc
        </span>
      )}
    </div>
  );
}

function CandidateRow({ entry }: { entry: OpsBoardEntry }) {
  const candidatePos = PIPELINE_POS[entry.current_stage] ?? 0;
  const isWaiting    = WAITING_STAGES.includes(entry.current_stage);

  const mins   = isWaiting ? waitMins(entry.arrived_at) : 0;
  const waitCl = mins >= 30 ? "text-rose-400" : mins >= 15 ? "text-amber-400" : "text-slate-300";

  return (
    <tr className="border-b border-slate-800/60">
      {/* Candidate */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <p className="font-bold text-white text-sm leading-tight">{entry.candidate_name}</p>
        <p className="text-[11px] font-mono text-slate-500 mt-0.5">{entry.candidate_code}</p>
      </td>
      {/* Process */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="text-sm text-slate-300">{entry.applied_role ?? "—"}</span>
      </td>
      {/* Recruiter */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="text-sm text-slate-300">{entry.recruiter_assigned_name ?? "—"}</span>
      </td>
      {/* MCQ — use mcq_percentage (MCQ-only, typing excluded) when available */}
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        {(entry.mcq_percentage ?? entry.assessment_percentage) != null
          ? (() => {
              const pct = entry.mcq_percentage ?? entry.assessment_percentage!;
              return (
                <span className={`text-sm font-bold tabular-nums ${pct >= 60 ? "text-emerald-400" : "text-rose-400"}`}>
                  {pct.toFixed(0)}%
                </span>
              );
            })()
          : <span className="text-slate-700">—</span>
        }
      </td>
      {/* Typing */}
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        <TypingCell wpm={entry.typing_net_wpm} accuracy={entry.typing_accuracy} />
      </td>
      {/* Wait */}
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        {isWaiting && entry.arrived_at
          ? <span className={`text-sm font-bold tabular-nums ${waitCl}`}>{mins}m</span>
          : <span className="text-slate-700">—</span>
        }
      </td>
      {/* Stage */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <StageBadge stage={entry.current_stage} />
      </td>
      {/* HR Round — pipeline pos 1 */}
      <td className="px-3 py-2.5 text-center">
        <JourneyCell result={entry.round1_result} roundPos={1} candidatePos={candidatePos} />
      </td>
      {/* Skill Test — pipeline pos 2 */}
      <td className="px-3 py-2.5 text-center">
        <JourneyCell result={entry.skilltest_result} roundPos={2} candidatePos={candidatePos} />
      </td>
      {/* Ops Round — pipeline pos 3 */}
      <td className="px-3 py-2.5 text-center">
        <JourneyCell result={entry.round2_result} roundPos={3} candidatePos={candidatePos} />
      </td>
      {/* Ops Interviewer */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="text-sm text-indigo-300">{entry.second_round_interviewer_name_snapshot ?? "—"}</span>
      </td>
      {/* Decision */}
      <td className="px-3 py-2.5 text-center whitespace-nowrap">
        <DecisionBadge entry={entry} />
      </td>
    </tr>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function OpsBoard() {
  const [searchParams] = useSearchParams();
  const branchParam = searchParams.get("branch") ?? "";
  const dateParam   = searchParams.get("date")   ?? "";

  const [entries,        setEntries]        = useState<OpsBoardEntry[]>([]);
  const [branches,       setBranches]       = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(branchParam);
  const [selectedDate,   setSelectedDate]   = useState(dateParam);
  const [lastUpdated,    setLastUpdated]     = useState<Date | null>(null);
  const [clockStr,       setClockStr]       = useState(fmtNow());
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [countdown,      setCountdown]      = useState(POLL_MS / 1000);
  const [activeTab,      setActiveTab]      = useState<TabKey>("all");

  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live clock
  useEffect(() => {
    clockRef.current = setInterval(() => setClockStr(fmtNow()), 1000);
    return () => { if (clockRef.current) clearInterval(clockRef.current); };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedBranch) params.set("branch", selectedBranch);
      if (selectedDate)   params.set("date",   selectedDate);
      const qs  = params.toString();
      const res = await fetch(`/api/ats/queue/ops-board${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { success: boolean; data: OpsBoardEntry[] };
      if (json.success) {
        setEntries(json.data);
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, selectedDate]);

  // Fetch branches once
  useEffect(() => {
    fetch("/api/ats/queue/branches")
      .then(r => r.json())
      .then((j: { success: boolean; data: string[] }) => { if (j.success) setBranches(j.data); })
      .catch(() => undefined);
  }, []);

  // Poll + countdown
  useEffect(() => {
    void fetchData();
    setCountdown(POLL_MS / 1000);
    pollRef.current      = setInterval(() => { void fetchData(); setCountdown(POLL_MS / 1000); }, POLL_MS);
    countdownRef.current = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => {
      if (pollRef.current)      clearInterval(pollRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchData]);

  // Partitions
  const waitingQueue   = useMemo(() => entries.filter(e => WAITING_STAGES.includes(e.current_stage)), [entries]);
  const interviewQueue = useMemo(() => entries.filter(e => INTERVIEW_STAGES.includes(e.current_stage)), [entries]);
  const decisionsQueue = useMemo(() => entries.filter(e =>
    DECISION_STAGES.includes(e.current_stage) || e.final_decision != null
  ), [entries]);
  const selectedToday  = useMemo(() => entries.filter(e =>
    e.final_decision === "Selected" || e.current_stage === "Selected" || e.current_stage === "Offered"
  ), [entries]);
  const rejectedToday  = useMemo(() => entries.filter(e =>
    e.final_decision === "Rejected" || e.current_stage === "Rejected"
  ), [entries]);

  // Avg wait — computed from waiting candidates only (not all active)
  const avgWaitMins = useMemo(() => {
    if (!waitingQueue.length) return 0;
    const total = waitingQueue.reduce((sum, e) => sum + waitMins(e.arrived_at), 0);
    return Math.round(total / waitingQueue.length);
  }, [waitingQueue]);

  // Rows for current tab
  const visibleEntries = useMemo(() => {
    switch (activeTab) {
      case "waiting":   return waitingQueue;
      case "interview": return interviewQueue;
      case "decisions": return decisionsQueue;
      default:          return entries;
    }
  }, [activeTab, entries, waitingQueue, interviewQueue, decisionsQueue]);

  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "all",       label: "All",         count: entries.length        },
    { key: "waiting",   label: "Waiting",      count: waitingQueue.length   },
    { key: "interview", label: "In Interview", count: interviewQueue.length },
    { key: "decisions", label: "Decisions",    count: decisionsQueue.length },
  ];

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col text-white">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-20">
        <div className="flex items-center justify-between gap-4 px-5 py-3 flex-wrap">

          {/* Brand */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <img src={mcnLogo} alt="MAS Callnet" className="h-9 w-auto brightness-200" />
            <div>
              <p className="text-base font-black text-white leading-tight">Walk-in Interview Board</p>
              <p className="text-xs text-slate-400">Live · auto-refreshes every 30s</p>
            </div>
          </div>

          {/* Stats strip */}
          <div className="flex items-center gap-5 flex-wrap">
            <StatTile label="Total Today"  value={entries.length} />
            <StatTile label="Waiting"      value={waitingQueue.length}
              color={waitingQueue.length > 0 ? "text-yellow-300" : "text-slate-600"} />
            <StatTile label="In Interview" value={interviewQueue.length}
              color={interviewQueue.length > 0 ? "text-indigo-300" : "text-slate-600"} />
            <StatTile label="Selected ✓"   value={selectedToday.length}
              color={selectedToday.length > 0 ? "text-emerald-400" : "text-slate-600"} />
            <StatTile label="Rejected ✗"   value={rejectedToday.length}
              color={rejectedToday.length > 0 ? "text-rose-400" : "text-slate-600"} />
            <StatTile label="Avg Wait"     value={waitingQueue.length ? `${avgWaitMins}m` : "—"}
              color="text-amber-300" />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {branches.length > 0 && (
              <select
                value={selectedBranch}
                onChange={e => setSelectedBranch(e.target.value)}
                className="h-8 rounded-lg border border-slate-600 bg-slate-700 px-2.5 text-xs text-slate-200 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Branches</option>
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="h-8 rounded-lg border border-slate-600 bg-slate-700 px-2.5 text-xs text-slate-200 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={() => void fetchData()}
              className="h-8 px-3 rounded-lg border border-slate-600 bg-slate-700 text-xs font-bold text-slate-200"
            >
              Refresh
            </button>
            <div className="text-right hidden sm:block">
              <p className="text-xs font-black text-slate-200 tabular-nums">{clockStr}</p>
              {lastUpdated && (
                <p className="text-[10px] text-slate-500">
                  Updated {fmtTime(lastUpdated)} · {countdown}s
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-t border-slate-700">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-colors border-b-2 ${
                activeTab === tab.key
                  ? "border-indigo-400 text-indigo-300 bg-slate-700/40"
                  : "border-transparent text-slate-400"
              }`}
            >
              {tab.label}
              <span className={`rounded-full px-2 py-0.5 text-xs font-black ${
                activeTab === tab.key ? "bg-indigo-500/30 text-indigo-300" : "bg-slate-700 text-slate-500"
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <main className="flex-1">

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-indigo-500 mb-3" />
            <p className="text-sm font-medium">Loading interview board…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="m-4 flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm font-semibold text-rose-300">
            Failed to load: {error}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center text-slate-500">
            <p className="text-lg font-bold">No candidates recorded today</p>
            <p className="text-sm mt-1">
              {selectedBranch ? `for ${selectedBranch}` : "Board will update automatically every 30 seconds"}
            </p>
          </div>
        )}

        {/* Table — overflow-x-auto on the scroll container, NOT on main, so sticky thead works */}
        {!loading && !error && entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
                <tr>
                  <Th>Candidate</Th>
                  <Th>Process</Th>
                  <Th>Recruiter</Th>
                  <Th center>MCQ</Th>
                  <Th center>Typing</Th>
                  <Th center>Wait</Th>
                  <Th>Stage</Th>
                  <Th center>HR</Th>
                  <Th center>Skill</Th>
                  <Th center>Ops</Th>
                  <Th>Ops Interviewer</Th>
                  <Th center>Decision</Th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-12 text-center text-slate-600 text-sm font-medium">
                      No candidates in this category
                    </td>
                  </tr>
                ) : (
                  visibleEntries.map(e => (
                    <CandidateRow key={e.candidate_code} entry={e} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-800 bg-slate-900 px-5 py-2 flex items-center justify-between">
        <p className="text-[11px] text-slate-600">MAS Callnet PeopleOS — Walk-in Interview Board</p>
        <p className="text-[11px] text-slate-600 tabular-nums">Auto-refresh every 30s</p>
      </footer>
    </div>
  );
}
