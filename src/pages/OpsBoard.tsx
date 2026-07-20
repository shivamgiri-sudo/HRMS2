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
  "Round 1- HR Screening": "HR Round 1",
  "HR Interview": "HR Interview",
};

const STAGE_COLOR: Record<string, string> = {
  "Ops Round": "bg-indigo-100 text-indigo-800",
  "Skill Test": "bg-amber-100 text-amber-800",
  "HR Round 1": "bg-sky-100 text-sky-800",
  "HR Interview": "bg-sky-100 text-sky-800",
};

function stageLabel(raw: string): string {
  return STAGE_LABEL[raw] ?? raw;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function sortEntries(entries: OpsBoardEntry[]): OpsBoardEntry[] {
  return [...entries].sort((a, b) => {
    const so = (STAGE_ORDER[a.current_stage] ?? 99) - (STAGE_ORDER[b.current_stage] ?? 99);
    if (so !== 0) return so;
    return (a.arrived_at ?? "").localeCompare(b.arrived_at ?? "");
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OpsBoard() {
  const [searchParams] = useSearchParams();
  const branchParam = searchParams.get("branch") ?? "";
  const dateParam = searchParams.get("date") ?? "";

  const [entries, setEntries] = useState<OpsBoardEntry[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(branchParam);
  const [selectedDate, setSelectedDate] = useState(dateParam);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedBranch) params.set("branch", selectedBranch);
      if (selectedDate) params.set("date", selectedDate);
      const qs = params.toString();

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

  // Fetch branches once
  useEffect(() => {
    fetch("/api/ats/queue/branches")
      .then(r => r.json())
      .then((j: { success: boolean; data: string[] }) => {
        if (j.success) setBranches(j.data);
      })
      .catch(() => undefined);
  }, []);

  // Auto-poll
  useEffect(() => {
    void fetchData();
    pollRef.current = setInterval(() => void fetchData(), POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchData]);

  const opsRound = entries.filter(e =>
    e.current_stage === "Round 2- Op's" || e.current_stage === "Operations Interview"
  );
  const earlier = entries.filter(e =>
    e.current_stage !== "Round 2- Op's" && e.current_stage !== "Operations Interview"
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <img src={mcnLogo} alt="MAS Callnet" className="h-8 w-auto" />
          <div>
            <h1 className="text-base font-bold text-slate-900 leading-tight">Interview Board</h1>
            <p className="text-xs text-slate-500">Today's walk-in candidates &amp; scores</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Branch filter */}
          {branches.length > 0 && (
            <select
              value={selectedBranch}
              onChange={e => setSelectedBranch(e.target.value)}
              className="h-8 rounded border border-slate-300 px-2 text-xs text-slate-700 bg-white"
            >
              <option value="">All Branches</option>
              {branches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}
          {/* Date filter */}
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="h-8 rounded border border-slate-300 px-2 text-xs text-slate-700 bg-white"
          />
          <button
            onClick={() => void fetchData()}
            className="h-8 px-3 rounded border border-slate-300 text-xs text-slate-600 bg-white hover:bg-slate-50"
          >
            Refresh
          </button>
          {lastUpdated && (
            <span className="text-[11px] text-slate-400">
              Updated {fmtTime(lastUpdated.toISOString())}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-6 max-w-5xl mx-auto">
        {loading && (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
            Loading candidates…
          </div>
        )}

        {!loading && error && (
          <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="rounded border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400 text-sm">
            No candidates at interview stages today
            {selectedBranch ? ` for ${selectedBranch}` : ""}.
          </div>
        )}

        {/* Ops Round section */}
        {opsRound.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="rounded-full bg-indigo-600 px-3 py-0.5 text-xs font-semibold text-white">
                Ops Round — {opsRound.length}
              </span>
              <span className="text-xs text-slate-400">Ready for second-round interview</span>
            </div>
            <CandidateTable entries={opsRound} />
          </section>
        )}

        {/* Earlier rounds section */}
        {earlier.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="rounded-full bg-slate-200 px-3 py-0.5 text-xs font-semibold text-slate-600">
                Earlier Rounds — {earlier.length}
              </span>
              <span className="text-xs text-slate-400">In progress / skill test</span>
            </div>
            <CandidateTable entries={earlier} dimmed />
          </section>
        )}
      </div>
    </div>
  );
}

// ── Table sub-component ───────────────────────────────────────────────────────

function CandidateTable({ entries, dimmed }: { entries: OpsBoardEntry[]; dimmed?: boolean }) {
  return (
    <div className={`overflow-x-auto rounded-lg border bg-white shadow-sm ${dimmed ? "opacity-70" : ""}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-xs text-slate-500">
            <th className="px-4 py-2.5 text-left font-medium">Candidate</th>
            <th className="px-4 py-2.5 text-left font-medium">Applied Role</th>
            <th className="px-4 py-2.5 text-left font-medium">Stage</th>
            <th className="px-4 py-2.5 text-left font-medium">Assessment</th>
            <th className="px-4 py-2.5 text-left font-medium">Typing WPM</th>
            <th className="px-4 py-2.5 text-left font-medium">R1 Result</th>
            <th className="px-4 py-2.5 text-left font-medium">Arrived</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {entries.map((c, i) => {
            const sl = stageLabel(c.current_stage);
            const pass =
              c.skilltest_result?.toLowerCase() === "selected" ||
              (c.assessment_percentage != null && c.assessment_percentage >= 60);

            return (
              <tr key={`${c.candidate_code}-${i}`} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-900">{c.candidate_name}</p>
                  <p className="text-xs text-slate-400">{c.candidate_code}</p>
                </td>
                <td className="px-4 py-3 text-slate-600 text-xs">{c.applied_role ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STAGE_COLOR[sl] ?? "bg-slate-100 text-slate-600"}`}>
                    {sl}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {c.assessment_percentage != null ? (
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${pass ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                      {c.assessment_percentage.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.typing_net_wpm != null ? (
                    <div>
                      <span className="font-medium text-slate-800">{Math.round(c.typing_net_wpm)}</span>
                      <span className="text-slate-400 text-xs"> WPM</span>
                      {c.typing_accuracy != null && (
                        <p className="text-[11px] text-slate-400">{c.typing_accuracy.toFixed(1)}% acc</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.skilltest_result ? (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {c.skilltest_result}
                    </span>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtTime(c.arrived_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
