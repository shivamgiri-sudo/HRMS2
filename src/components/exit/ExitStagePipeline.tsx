import {
  AlertTriangle,
  FileSignature,
  Hourglass,
  LogOut,
  UserCheck,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";

export type ExitStageKey = "resign" | "accept" | "notice" | "exit" | "settle";

type StageDef = {
  key: ExitStageKey;
  label: string;
  owner: string;
  rule: string;
  statuses: string[];
  icon: ReactNode;
  tone: string;
};

/**
 * Five governed stages over the existing status machine. The database keeps its own
 * states; this only groups them for display and filtering.
 */
export const EXIT_STAGES: StageDef[] = [
  {
    key: "resign",
    label: "Resign",
    owner: "Employee",
    rule: "Resignation submitted with reason and proposed last working day.",
    statuses: ["draft", "submitted"],
    icon: <FileSignature className="h-4 w-4" />,
    tone: "from-slate-500 to-slate-600",
  },
  {
    key: "accept",
    label: "Accept",
    owner: "Manager, then HR",
    rule: "Manager accepts or records an objection. HR confirms last working day and notice terms.",
    statuses: ["manager_review", "accepted"],
    icon: <UserCheck className="h-4 w-4" />,
    tone: "from-blue-500 to-indigo-600",
  },
  {
    key: "notice",
    label: "Notice",
    owner: "HR, IT, Payroll, Manager",
    rule: "Clearance and NOC run in parallel. Neither blocks the exit date.",
    statuses: ["notice_serving", "notice_active"],
    icon: <Hourglass className="h-4 w-4" />,
    tone: "from-cyan-500 to-teal-600",
  },
  {
    key: "exit",
    label: "Exit",
    owner: "HR",
    rule: "Employee marked exited on the last working day. Access is revoked.",
    statuses: ["exited", "exit_confirmed"],
    icon: <LogOut className="h-4 w-4" />,
    tone: "from-amber-500 to-orange-600",
  },
  {
    key: "settle",
    label: "Settle",
    owner: "Payroll, Finance",
    rule: "F&F needs clearance done. Payout, bank batch and relieving letter need NOC done.",
    statuses: ["clearance_pending", "fnf_pending", "closed"],
    icon: <Wallet className="h-4 w-4" />,
    tone: "from-emerald-500 to-green-600",
  },
];

const STOPPED_STATUSES = ["withdrawn", "revoked", "rejected", "terminated"];

export function exitStageOf(status: string): ExitStageKey | "stopped" {
  const s = String(status ?? "");
  if (STOPPED_STATUSES.includes(s)) return "stopped";
  const hit = EXIT_STAGES.find((st) => st.statuses.includes(s));
  return hit?.key ?? "resign";
}

type PipelineRow = {
  status: string;
  clearance_total?: number;
  clearance_cleared?: number;
};

/** Open clearance work on an employee who has already left: it now gates F&F only. */
export function isPendingAtExit(row: PipelineRow): boolean {
  if (exitStageOf(row.status) !== "exit" && exitStageOf(row.status) !== "settle")
    return false;
  return Number(row.clearance_total ?? 0) > Number(row.clearance_cleared ?? 0);
}

type Props = {
  rows: PipelineRow[];
  active: ExitStageKey | "all";
  onSelect: (stage: ExitStageKey | "all") => void;
};

export function ExitStagePipeline({ rows, active, onSelect }: Props) {
  const counts = new Map<ExitStageKey, number>();
  for (const r of rows) {
    const stage = exitStageOf(r.status);
    if (stage !== "stopped") counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  const pendingAtExit = rows.filter(isPendingAtExit).length;

  return (
    <section
      aria-label="Exit stages"
      className="rounded-2xl border border-white/60 bg-white/95 p-4 shadow-sm backdrop-blur-sm"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-slate-800">Exit pipeline</h2>
          <p className="text-xs text-slate-500">
            Five stages. Click a stage to filter the journey board.
          </p>
        </div>
        {active !== "all" && (
          <button
            type="button"
            onClick={() => onSelect("all")}
            className="min-h-[44px] rounded-xl bg-slate-100 px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200 sm:min-h-0 sm:py-1.5"
          >
            Show all stages
          </button>
        )}
      </div>

      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {EXIT_STAGES.map((stage, i) => {
          const selected = active === stage.key;
          return (
            <li key={stage.key}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(selected ? "all" : stage.key)}
                className={`h-full w-full rounded-2xl border p-3 text-left transition-all duration-200 ${
                  selected
                    ? "border-slate-900 shadow-md ring-2 ring-slate-900/10"
                    : "border-slate-200 hover:border-slate-300 hover:shadow-md"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br text-white ${stage.tone}`}
                  >
                    {stage.icon}
                  </span>
                  <span className="text-2xl font-bold text-slate-900">
                    {counts.get(stage.key) ?? 0}
                  </span>
                </div>
                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Step {i + 1}
                </div>
                <div className="font-bold text-slate-800">{stage.label}</div>
                <div className="text-xs font-semibold text-slate-600">
                  {stage.owner}
                </div>
                <p className="mt-1 text-xs leading-snug text-slate-500">
                  {stage.rule}
                </p>
              </button>
            </li>
          );
        })}
      </ol>

      {pendingAtExit > 0 && (
        <div
          role="status"
          className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {pendingAtExit} exited employee(s) still have open clearance. Exit is
          not blocked, but F&F approval waits until it is cleared.
        </div>
      )}
    </section>
  );
}
