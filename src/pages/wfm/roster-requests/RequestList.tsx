import { KIND_LABEL, type RosterRequest, type SlaState } from "./types";

const SLA_LABEL: Record<SlaState, string> = { urgent: "Urgent", overdue: "Overdue", due_soon: "Due soon", ok: "On time" };
const SLA_CLASS: Record<SlaState, string> = {
  urgent: "bg-red-100 text-red-700",
  overdue: "bg-amber-100 text-amber-800",
  due_soon: "bg-yellow-50 text-yellow-700",
  ok: "bg-slate-100 text-slate-600",
};

export function RequestList({ requests, selectedKey, onSelect, checkedKeys, onToggle, canCheck }: {
  requests: RosterRequest[]; selectedKey: string | null; onSelect: (r: RosterRequest) => void;
  /** Bulk selection: the checkbox only renders when onToggle is provided. */
  checkedKeys?: ReadonlySet<string>; onToggle?: (r: RosterRequest) => void; canCheck?: (r: RosterRequest) => boolean;
}) {
  if (requests.length === 0) {
    return <div className="rounded-lg border border-dashed p-10 text-center text-sm text-slate-500">No pending roster requests. You are all caught up.</div>;
  }
  return (
    <ul role="listbox" aria-label="Pending roster requests" className="divide-y rounded-lg border bg-white">
      {requests.map((r) => (
        <li key={r.key} data-approval-id={r.id} role="option" aria-selected={r.key === selectedKey}
            className={`cursor-pointer p-3 hover:bg-slate-50 ${r.key === selectedKey ? "bg-blue-50" : ""}`}
            onClick={() => onSelect(r)}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {onToggle && (canCheck ? canCheck(r) : true) ? (
                <input type="checkbox" aria-label={`Select ${r.employeeName}`} checked={checkedKeys?.has(r.key) ?? false}
                  onClick={(e) => e.stopPropagation()} onChange={() => onToggle(r)} />
              ) : null}
              <span>{r.employeeName}{r.secondaryName ? ` ⇄ ${r.secondaryName}` : ""}</span>
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SLA_CLASS[r.slaState]}`}>{SLA_LABEL[r.slaState]}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{KIND_LABEL[r.kind]} · {r.date} · {r.ageHours}h ago</div>
          {r.kind === "swap" && r.counterpartStatus === "pending" ? (
            <span className="mt-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">Awaiting counterpart</span>
          ) : null}
          {r.kind === "swap" && r.counterpartStatus === "declined" ? (
            <span className="mt-1 inline-block rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Counterpart declined</span>
          ) : null}
          {r.reason ? <div className="mt-1 line-clamp-2 text-xs text-slate-600">{r.reason}</div> : null}
        </li>
      ))}
    </ul>
  );
}
