import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { actionsForKind, approveDisabledReason, counterpartNotAccepted, type ActionDef } from "./actions";
import { errorInfo, useDecide } from "./useDecide";
import { useImpact } from "./useImpact";
import { KIND_LABEL, type RosterRequest } from "./types";

export { actionsForKind, approveDisabledReason } from "./actions";

/** Decision buttons for the selected request. `rejectFocusSignal` bumps to open + focus the reject reason (the `r` key). */
export function ActionBar({ request, onDecided, rejectFocusSignal = 0 }: {
  request: RosterRequest; onDecided: (r: RosterRequest) => void; rejectFocusSignal?: number;
}) {
  const impact = useImpact(request).data;
  const decide = useDecide();
  const { toast } = useToast();
  const [open, setOpen] = useState<ActionDef | null>(null);
  const [reason, setReason] = useState("");
  const [newDate, setNewDate] = useState("");
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const actions = actionsForKind(request.kind);

  useEffect(() => { setOpen(null); setReason(""); setNewDate(""); setForce(false); setError(null); }, [request.key]);
  useEffect(() => {
    if (!rejectFocusSignal) return;
    const rej = actions.find((a) => a.action === "reject");
    if (rej) { setOpen(rej); setTimeout(() => reasonRef.current?.focus(), 0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rejectFocusSignal]);

  const approveBlock = approveDisabledReason(request, impact, force);

  const submit = (def: ActionDef) => {
    setError(null);
    const body = {
      kind: request.kind, id: request.id, action: def.action,
      ...(def.needsReason ? { reason: reason.trim() } : {}),
      ...(def.action === "realign" ? { newDate } : {}),
      ...(def.action === "approve" && request.kind === "swap" && force ? { forceWithoutCounterpartAcceptance: true } : {}),
    };
    decide.mutate(body, {
      onSuccess: () => { toast({ title: `${def.label}: done`, description: `${KIND_LABEL[request.kind]} · ${request.employeeName}` }); onDecided(request); },
      onError: (e) => {
        const { message, blockers } = errorInfo(e);
        setError(blockers.length ? `${message} — ${blockers.join("; ")}` : message);
      },
    });
  };

  const click = (def: ActionDef) => (def.needsReason ? setOpen(open?.action === def.action ? null : def) : submit(def));
  const formInvalid = !!open && (!reason.trim() || (open.action === "realign" && !newDate));

  return (
    <div className="space-y-3 border-t p-4">
      <div className="flex flex-wrap gap-2">
        {actions.map((def) => {
          const disabled = decide.isPending || (def.action === "approve" && approveBlock !== null);
          return (
            <button key={def.action} type="button" disabled={disabled} onClick={() => click(def)}
              className={`rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${def.action === "approve" ? "bg-green-600 text-white" : "border bg-white text-slate-700"}`}>
              {def.label}
            </button>
          );
        })}
      </div>
      {approveBlock ? <p role="status" className="text-xs text-red-600">{approveBlock}</p> : null}
      {counterpartNotAccepted(request) ? (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          Approve without counterpart (admin/HR)
        </label>
      ) : null}
      {open ? (
        <div className="space-y-2">
          <textarea ref={reasonRef} aria-label={`${open.label} reason`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder={request.kind === "conflict" ? "Resolution" : "Reason (required)"} className="w-full rounded border p-2 text-sm" />
          {open.action === "realign" ? (
            <label className="flex items-center gap-2 text-xs text-slate-600">New date
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="rounded border px-2 py-1 text-sm" />
            </label>
          ) : null}
          <button type="button" disabled={formInvalid || decide.isPending || (open.action === "approve" && approveBlock !== null)} onClick={() => submit(open)}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Confirm {open.label.toLowerCase()}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
