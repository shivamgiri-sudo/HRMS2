import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import mcnLogo from "@/assets/brand/mcn-logo.png";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  typing_net_wpm: number | null;
  typing_accuracy: number | null;
  arrived_at: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_MS = 30_000;

const ACTIVE_STAGES = [
  "Round 2- Op's",
  "Operations Interview",
  "Interview - Skill Test",
  "Round 1- HR Screening",
  "HR Interview",
];

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
  "HR Interview": "HR Round",
};

const STAGE_CONFIG: Record<string, { bg: string; text: string; dot: string }> = {
  "Ops Round":  { bg: "bg-indigo-600", text: "text-white", dot: "bg-indigo-300" },
  "Skill Test": { bg: "bg-amber-500",  text: "text-white", dot: "bg-amber-200"  },
  "HR Round":   { bg: "bg-sky-500",    text: "text-white", dot: "bg-sky-200"    },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function stageLabel(raw: string) { return STAGE_LABEL[raw] ?? raw; }

function fmtTime(iso: string | null | Date): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "numeric", minute: "2-digit", hour12: true,
    }).format(typeof iso === "string" ? new Date(iso) : iso);
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

function rejectedAtRound(e: OpsBoardEntry): string {
  if (e.round2_result === "Rejected") return "Rejected at Ops Round";
  if (e.skilltest_result === "Rejected") return "Rejected at Skill Test";
  if (e.round1_result === "Rejected") return "Rejected at HR Round";
  if (e.walkin_end_stage) return `Ended at ${stageLabel(e.walkin_end_stage)}`;
  return "Rejected";
}

function selectedAtRound(e: OpsBoardEntry): string {
  if (e.round2_result === "Selected") return "Cleared Ops Round";
  if (e.skilltest_result === "Selected") return "Cleared Skill Test";
  if (e.round1_result === "Selected") return "Cleared HR Round";
  if (e.walkin_end_stage) return `Cleared ${stageLabel(e.walkin_end_stage)}`;
  return "Selected";
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatTile({
  label, value, color = "text-slate-900", sub,
}: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="text-center min-w-[64px]">
      <p className={`text-2xl font-black tabular-nums leading-none ${color}`}>{value}</p>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
      {sub && <p className="text-[9px] text-slate-300 mt-0.5">{sub}</p>}
    </div>
  );
}

function Divider() {
  return <div className="h-8 w-px bg-slate-200 flex-shrink-0" />;
}

function JourneyBreadcrumb({ e }: { e: OpsBoardEntry }) {
  const steps = [
    { label: "HR", result: e.round1_result },
    { label: "Skill", result: e.skilltest_result },
    { label: "Ops", result: e.round2_result },
  ];
  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => {
        const passed = step.result === "Selected";
        const failed = step.result === "Rejected";
        const done   = passed || failed;
        return (
          <span key={step.label} className="flex items-center gap-1">
            <span
              className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold ${
                passed ? "bg-emerald-100 text-emerald-700" :
                failed ? "bg-rose-100 text-rose-600" :
                "bg-slate-100 text-slate-400"
              }`}
            >
              {done ? (passed ? "✓" : "✗") : "·"} {step.label}
            </span>
            {i < 2 && <span className="text-slate-200 text-[10px]">›</span>}
          </span>
        );
      })}
    </div>
  );
}

function McqBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-300 text-sm">—</span>;
  const pass = pct >= 60;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-base font-black tabular-nums ${pass ? "text-emerald-600" : "text-rose-600"}`}>
        {pct.toFixed(0)}%
      </span>
      <span className={`text-[10px] font-bold uppercase ${pass ? "text-emerald-500" : "text-rose-500"}`}>
        {pass ? "Pass" : "Fail"}
      </span>
    </div>
  );
}

function TypingBadge({ wpm, acc }: { wpm: number | null; acc: number | null }) {
  if (wpm == null) return <span className="text-slate-300 text-sm">—</span>;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-base font-black tabular-nums text-slate-800">{Math.round(wpm)}</span>
      <span className="text-[10px] text-slate-400 font-semibold">
        WPM{acc != null ? ` · ${acc.toFixed(0)}%` : ""}
      </span>
    </div>
  );
}

function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <span className="text-slate-300 text-sm">—</span>;
  const pass = result === "Selected" || result === "Pass";
  const fail = result === "Rejected" || result === "Fail";
  return (
    <span className={`inline-block rounded-lg px-2.5 py-0.5 text-xs font-bold ${
      pass ? "bg-emerald-100 text-emerald-700" :
      fail ? "bg-rose-100 text-rose-600" :
      "bg-slate-100 text-slate-600"
    }`}>
      {result}
    </span>
  );
}

function WaitChip({ arrived }: { arrived: string | null }) {
  const mins = waitMins(arrived);
  const urgent = mins >= 30;
  const mid    = mins >= 15;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-sm font-black tabular-nums ${
        urgent ? "text-rose-600" : mid ? "text-amber-600" : "text-slate-600"
      }`}>
        {mins}m
      </span>
      <span className="text-[10px] text-slate-400 font-medium">{fmtTime(arrived)}</span>
    </div>
  );
}

// ── Active Queue Row ───────────────────────────────────────────────────────────

function CandidateRow({ entry, rank }: { entry: OpsBoardEntry; rank: number }) {
  const sl  = stageLabel(entry.current_stage);
  const cfg = STAGE_CONFIG[sl] ?? STAGE_CONFIG["HR Round"];

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
      {/* Rank */}
      <td className="py-3 pl-4 pr-2 w-10">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-500">
          {rank}
        </span>
      </td>
      {/* Candidate + journey */}
      <td className="py-3 px-3">
        <p className="font-bold text-slate-900 leading-tight">{entry.candidate_name}</p>
        <p className="text-xs text-slate-400 font-mono mt-0.5">{entry.candidate_code}</p>
        <div className="mt-1.5">
          <JourneyBreadcrumb e={entry} />
        </div>
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
      {/* MCQ Score */}
      <td className="py-3 px-3 text-center">
        <McqBadge pct={entry.assessment_percentage} />
      </td>
      {/* Typing Test */}
      <td className="py-3 px-3 text-center">
        <TypingBadge wpm={entry.typing_net_wpm} acc={entry.typing_accuracy} />
      </td>
      {/* HR Result */}
      <td className="py-3 px-3 text-center">
        <ResultBadge result={entry.round1_result} />
      </td>
      {/* Wait */}
      <td className="py-3 pl-3 pr-4 text-center">
        <WaitChip arrived={entry.arrived_at} />
      </td>
    </tr>
  );
}

// ── Active Queue Section ───────────────────────────────────────────────────────

function ActiveSection({
  title, subtitle, badge, entries, accent,
}: {
  title: string; subtitle: string; badge: string; entries: OpsBoardEntry[]; accent: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="mb-5">
      <div className="flex items-center gap-3 mb-2.5">
        <span className={`rounded-full px-3 py-1 text-xs font-black text-white ${accent}`}>
          {badge} — {entries.length}
        </span>
        <span className="text-xs text-slate-400 font-medium">{subtitle}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="py-2.5 pl-4 pr-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400 w-10">#</th>
              <th className="py-2.5 px-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">Candidate</th>
              <th className="py-2.5 px-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">Applied Role</th>
              <th className="py-2.5 px-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">Current Stage</th>
              <th className="py-2.5 px-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">MCQ Score</th>
              <th className="py-2.5 px-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">Typing Test</th>
              <th className="py-2.5 px-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">HR Result</th>
              <th className="py-2.5 pl-3 pr-4 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">Waiting</th>
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

// ── Decision Cards ─────────────────────────────────────────────────────────────

function DecisionCard({
  entry, type,
}: { entry: OpsBoardEntry; type: "selected" | "rejected" }) {
  const roundLabel = type === "selected" ? selectedAtRound(entry) : rejectedAtRound(entry);
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
      type === "selected"
        ? "border-emerald-200 bg-emerald-50"
        : "border-rose-200 bg-rose-50"
    }`}>
      <div className={`mt-0.5 flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-sm font-black ${
        type === "selected" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
      }`}>
        {type === "selected" ? "✓" : "✗"}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-slate-900 text-sm leading-tight truncate">{entry.candidate_name}</p>
        <p className="text-xs font-mono text-slate-400 mt-0.5">{entry.candidate_code}</p>
        {entry.applied_role && (
          <p className="text-xs text-slate-500 mt-0.5 truncate">{entry.applied_role}</p>
        )}
        <p className={`text-xs font-bold mt-1 ${
          type === "selected" ? "text-emerald-700" : "text-rose-600"
        }`}>
          {roundLabel}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[11px] text-slate-400">{fmtTime(entry.arrived_at)}</p>
      </div>
    </div>
  );
}

function DecisionsZone({
  selected, rejected,
}: { selected: OpsBoardEntry[]; rejected: OpsBoardEntry[] }) {
  const empty = selected.length === 0 && rejected.length === 0;
  return (
    <div className="mt-2 mb-5">
      {/* Section header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-black uppercase tracking-widest text-slate-400">Today's Decisions</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      {empty ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-8 text-center">
          <p className="text-sm font-semibold text-slate-400">No final decisions recorded yet today</p>
          <p className="text-xs text-slate-300 mt-1">Selected & rejected candidates will appear here</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Selected */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="rounded-full px-3 py-1 text-xs font-black text-white bg-emerald-600">
                Selected ✓ — {selected.length}
              </span>
              <span className="text-xs text-slate-400">Cleared all required rounds</span>
            </div>
            {selected.length === 0 ? (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-5 text-center">
                <p className="text-sm text-emerald-600 font-medium">No selections yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {selected.map(e => (
                  <DecisionCard key={e.candidate_code} entry={e} type="selected" />
                ))}
              </div>
            )}
          </div>

          {/* Rejected */}
          <div>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="rounded-full px-3 py-1 text-xs font-black text-white bg-rose-600">
                Rejected ✗ — {rejected.length}
              </span>
              <span className="text-xs text-slate-400">Did not clear their round</span>
            </div>
            {rejected.length === 0 ? (
              <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-5 text-center">
                <p className="text-sm text-rose-500 font-medium">No rejections yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {rejected.map(e => (
                  <DecisionCard key={e.candidate_code} entry={e} type="rejected" />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
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

  // Partition
  const activeQueue    = entries.filter(e => ACTIVE_STAGES.includes(e.current_stage));
  const selectedToday  = entries.filter(e =>
    e.final_decision === "Selected" || (!ACTIVE_STAGES.includes(e.current_stage) && (e.current_stage === "Selected" || e.current_stage === "Offered"))
  );
  const rejectedToday  = entries.filter(e =>
    e.final_decision === "Rejected" || (!ACTIVE_STAGES.includes(e.current_stage) && e.current_stage === "Rejected")
  );

  const opsRound  = activeQueue.filter(e => e.current_stage === "Round 2- Op's" || e.current_stage === "Operations Interview");
  const skillTest = activeQueue.filter(e => e.current_stage === "Interview - Skill Test");
  const hrRound   = activeQueue.filter(e => e.current_stage === "Round 1- HR Screening" || e.current_stage === "HR Interview");

  const totalToday = entries.length;
  const avgWait    = activeQueue.length
    ? Math.round(activeQueue.reduce((s, e) => s + waitMins(e.arrived_at), 0) / activeQueue.length)
    : 0;

  const skillPassCount = entries.filter(e => e.skilltest_result === "Selected" || e.skilltest_result === "Pass").length;
  const skillTotalDone = entries.filter(e => e.skilltest_result != null).length;
  const skillPassPct   = skillTotalDone > 0 ? Math.round((skillPassCount / skillTotalDone) * 100) : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-20">
        <div className="flex items-center justify-between gap-4 px-5 py-3 flex-wrap">

          {/* Brand */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <img src={mcnLogo} alt="MAS Callnet" className="h-9 w-auto" />
            <div className="hidden sm:block">
              <p className="text-base font-black text-slate-900 leading-tight">Walk-in Interview Board</p>
              <p className="text-xs text-slate-400 font-medium">Live candidates, scores & decisions</p>
            </div>
          </div>

          {/* Summary stat strip */}
          <div className="hidden lg:flex items-center gap-4">
            <StatTile label="Total Today"  value={totalToday}               />
            <Divider />
            <StatTile label="In Progress"  value={activeQueue.length}       color={activeQueue.length > 0 ? "text-indigo-600" : "text-slate-400"} />
            <Divider />
            <StatTile label="Selected ✓"   value={selectedToday.length}     color={selectedToday.length > 0 ? "text-emerald-600" : "text-slate-400"} />
            <Divider />
            <StatTile label="Rejected ✗"   value={rejectedToday.length}     color={rejectedToday.length > 0 ? "text-rose-600" : "text-slate-400"} />
            <Divider />
            <StatTile label="Skill Pass %"
              value={skillPassPct != null ? `${skillPassPct}%` : "—"}
              color={skillPassPct != null ? (skillPassPct >= 60 ? "text-amber-600" : "text-rose-500") : "text-slate-400"}
              sub={skillTotalDone > 0 ? `${skillPassCount}/${skillTotalDone} tested` : undefined}
            />
            <Divider />
            <StatTile label="Avg Wait"     value={activeQueue.length ? `${avgWait}m` : "—"} />
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
                  Updated {fmtTime(lastUpdated)} · {countdown}s
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Mobile summary strip */}
        <div className="lg:hidden flex items-center gap-4 px-5 py-2 border-t border-slate-100 overflow-x-auto">
          <StatTile label="Total"     value={totalToday} />
          <Divider />
          <StatTile label="In Progress" value={activeQueue.length}   color="text-indigo-600" />
          <Divider />
          <StatTile label="Selected"  value={selectedToday.length}   color="text-emerald-600" />
          <Divider />
          <StatTile label="Rejected"  value={rejectedToday.length}   color="text-rose-600" />
          <Divider />
          <StatTile label="Avg Wait"  value={activeQueue.length ? `${avgWait}m` : "—"} />
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
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

        {/* No data at all */}
        {!loading && !error && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <svg className="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-lg font-bold text-slate-500">No candidates recorded today</p>
            <p className="text-sm text-slate-400 mt-1">
              {selectedBranch ? `for ${selectedBranch}` : "Board will update automatically every 30 seconds"}
            </p>
          </div>
        )}

        {/* Data */}
        {!loading && !error && entries.length > 0 && (
          <>
            {/* Zone B — Active queue */}
            {activeQueue.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">
                    Currently in Interview — {activeQueue.length}
                  </span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <ActiveSection
                  title="Ops Round"
                  subtitle="Awaiting second-round interview with Operations"
                  badge="Ops Round"
                  entries={opsRound}
                  accent="bg-indigo-600"
                />
                <ActiveSection
                  title="Skill Test"
                  subtitle="In skill / typing assessment"
                  badge="Skill Test"
                  entries={skillTest}
                  accent="bg-amber-500"
                />
                <ActiveSection
                  title="HR Round"
                  subtitle="In initial HR screening"
                  badge="HR Round"
                  entries={hrRound}
                  accent="bg-sky-500"
                />
              </div>
            )}

            {activeQueue.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white px-6 py-8 text-center mb-5">
                <p className="text-sm font-semibold text-slate-400">No candidates currently in interview stages</p>
              </div>
            )}

            {/* Zone C — Today's decisions */}
            <DecisionsZone selected={selectedToday} rejected={rejectedToday} />
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
