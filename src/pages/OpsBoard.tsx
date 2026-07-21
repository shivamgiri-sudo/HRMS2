import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import mcnLogo from "@/assets/brand/mcn-logo.png";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OpsBoardEntry {
  candidate_code: string;
  candidate_name: string;
  current_stage: string;
  applied_role: string | null;
  skilltest_result: string | null;
  assessment_percentage: number | null;
  typing_net_wpm: number | null;
  typing_accuracy: number | null;
  arrived_at: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_MS = 30_000;

const STAGE_ORDER: Record<string, number> = {
  "Round 2- Op's": 0,
  "Operations Interview": 0,
  "Interview - Skill Test": 1,
  "Round 1- HR Screening": 2,
  "HR Interview": 2,
};

const STAGE_LABEL: Record<string, string> = {
  "Round 2- Op's": "Ops Round",
  "Operations Interview": "Ops Round",
  "Interview - Skill Test": "Skill Test",
  "Round 1- HR Screening": "HR Round",
  "HR Interview": "HR Interview",
};

const STAGE_CONFIG: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  "Ops Round":    { bg: "bg-indigo-600", text: "text-white",        border: "border-indigo-700", dot: "bg-indigo-300" },
  "Skill Test":   { bg: "bg-amber-500",  text: "text-white",        border: "border-amber-600",  dot: "bg-amber-200" },
  "HR Round":     { bg: "bg-sky-500",    text: "text-white",        border: "border-sky-600",    dot: "bg-sky-200"    },
  "HR Interview": { bg: "bg-sky-500",    text: "text-white",        border: "border-sky-600",    dot: "bg-sky-200"    },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function stageLabel(raw: string) { return STAGE_LABEL[raw] ?? raw; }

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "numeric", minute: "2-digit", hour12: true,
    }).format(new Date(iso));
  } catch { return "—"; }
}

function fmtNow(): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  }).format(new Date());
}

function waitMins(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

function sortEntries(entries: OpsBoardEntry[]): OpsBoardEntry[] {
  return [...entries].sort((a, b) => {
    const so = (STAGE_ORDER[a.current_stage] ?? 99) - (STAGE_ORDER[b.current_stage] ?? 99);
    if (so !== 0) return so;
    return (a.arrived_at ?? "").localeCompare(b.arrived_at ?? "");
  });
}

// ── Score Components ───────────────────────────────────────────────────────────

function AssessmentBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-300 text-sm font-medium">—</span>;
  const pass = pct >= 60;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-lg font-black tabular-nums ${pass ? "text-emerald-600" : "text-rose-600"}`}>
        {pct.toFixed(0)}%
      </span>
      <span className={`text-[10px] font-bold uppercase tracking-wide ${pass ? "text-emerald-500" : "text-rose-500"}`}>
        {pass ? "Pass" : "Fail"}
      </span>
    </div>
  );
}

function TypingBadge({ wpm, acc }: { wpm: number | null; acc: number | null }) {
  if (wpm == null) return <span className="text-slate-300 text-sm font-medium">—</span>;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-lg font-black tabular-nums text-slate-800">{Math.round(wpm)}</span>
      <span className="text-[10px] text-slate-400 font-semibold">WPM{acc != null ? ` · ${acc.toFixed(0)}%` : ""}</span>
    </div>
  );
}

function WaitChip({ arrived }: { arrived: string | null }) {
  const mins = waitMins(arrived);
  const urgent = mins >= 30;
  const mid    = mins >= 15;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-sm font-black tabular-nums ${urgent ? "text-rose-600" : mid ? "text-amber-600" : "text-slate-600"}`}>
        {mins}m
      </span>
      <span className="text-[10px] text-slate-400 font-medium">{fmtTime(arrived)}</span>
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────────

function CandidateRow({ entry, rank }: { entry: OpsBoardEntry; rank: number }) {
  const sl = stageLabel(entry.current_stage);
  const cfg = STAGE_CONFIG[sl] ?? STAGE_CONFIG["HR Round"];

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
      {/* Rank */}
      <td className="py-3 pl-4 pr-2 w-10">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-500">
          {rank}
        </span>
      </td>
      {/* Candidate */}
      <td className="py-3 px-3">
        <p className="font-bold text-slate-900 leading-tight">{entry.candidate_name}</p>
        <p className="text-xs text-slate-400 font-mono mt-0.5">{entry.candidate_code}</p>
      </td>
      {/* Applied Role */}
      <td className="py-3 px-3">
        <span className="text-sm text-slate-600 font-medium">{entry.applied_role ?? "—"}</span>
      </td>
      {/* Stage */}
      <td className="py-3 px-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${cfg.bg} ${cfg.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
          {sl}
        </span>
      </td>
      {/* Assessment */}
      <td className="py-3 px-3 text-center">
        <AssessmentBadge pct={entry.assessment_percentage} />
      </td>
      {/* Typing */}
      <td className="py-3 px-3 text-center">
        <TypingBadge wpm={entry.typing_net_wpm} acc={entry.typing_accuracy} />
      </td>
      {/* R1 Result */}
      <td className="py-3 px-3 text-center">
        {entry.skilltest_result ? (
          <span className="inline-block rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {entry.skilltest_result}
          </span>
        ) : <span className="text-slate-300 text-sm">—</span>}
      </td>
      {/* Wait */}
      <td className="py-3 pl-3 pr-4 text-center">
        <WaitChip arrived={entry.arrived_at} />
      </td>
    </tr>
  );
}

// ── Section ────────────────────────────────────────────────────────────────────

function Section({
  title, subtitle, badge, entries, accent,
}: {
  title: string;
  subtitle: string;
  badge: string;
  entries: OpsBoardEntry[];
  accent: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="mb-6">
      {/* Section header */}
      <div className="flex items-center gap-3 mb-3">
        <span className={`rounded-full px-3 py-1 text-xs font-black text-white ${accent}`}>
          {badge} — {entries.length}
        </span>
        <span className="text-xs text-slate-400 font-medium">{subtitle}</span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="py-2.5 pl-4 pr-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400 w-10">#</th>
              <th className="py-2.5 px-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">Candidate</th>
              <th className="py-2.5 px-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">Applied Role</th>
              <th className="py-2.5 px-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">Stage</th>
              <th className="py-2.5 px-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">Assessment</th>
              <th className="py-2.5 px-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">Typing</th>
              <th className="py-2.5 px-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">R1 Result</th>
              <th className="py-2.5 pl-3 pr-4 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">Wait</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <CandidateRow key={e.candidate_code} entry={e} rank={i + 1} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
        setEntries(sortEntries(json.data));
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, selectedDate]);

  // Branches once
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

  const opsRound = entries.filter(e =>
    e.current_stage === "Round 2- Op's" || e.current_stage === "Operations Interview"
  );
  const skillTest = entries.filter(e => e.current_stage === "Interview - Skill Test");
  const hrRound   = entries.filter(e =>
    e.current_stage === "Round 1- HR Screening" || e.current_stage === "HR Interview"
  );

  const totalWaiting = entries.length;
  const avgWait = entries.length
    ? Math.round(entries.reduce((s, e) => s + waitMins(e.arrived_at), 0) / entries.length)
    : 0;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-20">
        <div className="flex items-center justify-between gap-4 px-5 py-3">
          {/* Brand */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <img src={mcnLogo} alt="MAS Callnet" className="h-9 w-auto" />
            <div className="hidden sm:block">
              <p className="text-base font-black text-slate-900 leading-tight">Interview Board</p>
              <p className="text-xs text-slate-400 font-medium">Live walk-in candidates & scores</p>
            </div>
          </div>

          {/* Stats strip */}
          <div className="hidden md:flex items-center gap-5">
            <div className="text-center">
              <p className="text-2xl font-black text-slate-900 tabular-nums">{totalWaiting}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">In Queue</p>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div className="text-center">
              <p className={`text-2xl font-black tabular-nums ${opsRound.length > 0 ? "text-indigo-600" : "text-slate-400"}`}>{opsRound.length}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Ops Round</p>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div className="text-center">
              <p className="text-2xl font-black text-slate-500 tabular-nums">{avgWait}m</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Avg Wait</p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {branches.length > 0 && (
              <select
                value={selectedBranch}
                onChange={e => setSelectedBranch(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">All Branches</option>
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              onClick={() => void fetchData()}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Refresh
            </button>
            <div className="text-right hidden sm:block">
              <p className="text-xs font-black text-slate-700 tabular-nums">{clockStr}</p>
              {lastUpdated && (
                <p className="text-[10px] text-slate-400">
                  Updated {fmtTime(lastUpdated.toISOString())} · {countdown}s
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 px-4 py-5 sm:px-6">

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-500 mb-3" />
            <p className="text-sm font-medium">Loading interview board…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700 mb-4">
            <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Failed to load: {error}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <svg className="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-lg font-bold text-slate-500">No candidates at interview stages</p>
            <p className="text-sm text-slate-400 mt-1">
              {selectedBranch ? `for ${selectedBranch}` : "Board will update automatically"}
            </p>
          </div>
        )}

        {/* Data */}
        {!loading && !error && entries.length > 0 && (
          <>
            <Section
              title="Ops Round"
              subtitle="Ready for second-round interview with Operations"
              badge="Ops Round"
              entries={opsRound}
              accent="bg-indigo-600"
            />
            <Section
              title="Skill Test"
              subtitle="Currently in skill / typing assessment"
              badge="Skill Test"
              entries={skillTest}
              accent="bg-amber-500"
            />
            <Section
              title="HR Round"
              subtitle="In initial HR screening"
              badge="HR Round"
              entries={hrRound}
              accent="bg-sky-500"
            />
          </>
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-white px-5 py-2.5 flex items-center justify-between">
        <p className="text-[11px] text-slate-400 font-medium">
          MAS Callnet PeopleOS — Walk-in Interview Board
        </p>
        <p className="text-[11px] text-slate-400 tabular-nums">
          Auto-refresh every 30s
        </p>
      </footer>
    </div>
  );
}
