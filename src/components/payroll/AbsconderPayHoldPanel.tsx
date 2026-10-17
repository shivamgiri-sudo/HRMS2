import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Lock, Unlock } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";

export type HoldState = "not_held" | "hold_requested" | "request_rejected" | "held" | "released";

export interface HoldView {
  state: HoldState;
  held: boolean;
  route: string | null;
  lastEvent: { action: string; reason: string | null; at: string } | null;
  canRequestHold: boolean;
  canDecideRequest: boolean;
  canPlaceHold: boolean;
  canRelease: boolean;
  /** Months a release cannot rewrite because their payroll run is closed or signed off. */
  releaseImpact?: { closedMonths: string[] };
}

const BASE = "/api/payroll/absconder-pay-release";

export const ARREARS_NOTE = "PF and ESIC are not worked out on a salary paid through the F&F, and the closed month's ECR stays as filed. File the contributions for these days as arrears yourself.";

export const COPY: Record<HoldState, { tone: string; title: string; body: string }> = {
  not_held: {
    tone: "border-slate-200 bg-slate-50 text-slate-800",
    title: "Salary is paid as normal",
    body: "An absconded employee is paid by the system unless the reporting manager asks for the salary days to be made 0 and the branch Payroll HR approves.",
  },
  hold_requested: {
    tone: "border-amber-300 bg-amber-50 text-amber-900",
    title: "Hold requested — waiting for branch Payroll HR",
    body: "Salary is unchanged until the branch Payroll HR approves.",
  },
  request_rejected: {
    tone: "border-slate-200 bg-slate-50 text-slate-800",
    title: "Hold request declined — salary is paid as normal",
    body: "The reporting manager can request again with new facts.",
  },
  held: {
    tone: "border-red-300 bg-red-50 text-red-900",
    title: "Salary HELD at 0 days",
    body: "Paid days stay 0 until the branch Payroll HR releases the hold.",
  },
  released: {
    tone: "border-emerald-300 bg-emerald-50 text-emerald-900",
    title: "Hold released — attendance days restored",
    body: "",
  },
};

/**
 * Pure view: what to show for a given state and what each person may do. Rendered by the panel below and
 * tested directly. The can* flags come from the server, never guessed here.
 */
export function AbsconderPayHoldView({
  exitId, view, reason, busy, onReason, onAct,
}: {
  exitId: string;
  view: HoldView;
  reason: string;
  busy: boolean;
  onReason: (v: string) => void;
  onAct: (path: string, success: string) => void;
}) {
  const c = COPY[view.state];
  const anyAction = view.canRequestHold || view.canDecideRequest || view.canPlaceHold || view.canRelease;
  return (
    <section aria-label="Absconder salary hold" className={`rounded-xl border p-4 ${c.tone}`}>
      <div className="flex items-start gap-2">
        {view.state === "held" ? <Lock className="mt-0.5 h-5 w-5" /> : view.state === "released" ? <CheckCircle2 className="mt-0.5 h-5 w-5" /> : view.state === "hold_requested" ? <AlertTriangle className="mt-0.5 h-5 w-5" /> : <Unlock className="mt-0.5 h-5 w-5" />}
        <div>
          <p className="text-base font-bold">{c.title}</p>
          {c.body && <p className="mt-0.5 text-sm">{c.body}</p>}
          {view.lastEvent?.reason && (
            <p className="mt-1 text-sm"><span className="font-semibold">Last note:</span> {view.lastEvent.reason}</p>
          )}
          {view.state === "released" && view.route && (
            <p className="mt-1 text-sm">{view.route === "payroll" ? "Paid through the open payroll run." : "That month's payroll had closed: the salary is paid through the F&F."}</p>
          )}
          {view.state === "released" && view.route === "fnf" && (
            <p role="note" className="mt-1 text-sm font-semibold">{ARREARS_NOTE}</p>
          )}
        </div>
      </div>

      {view.canRelease && (view.releaseImpact?.closedMonths.length ?? 0) > 0 && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-bold">Payroll for {view.releaseImpact!.closedMonths.join(", ")} is already closed.</span>{" "}
            Releasing will not change that run. The days are paid through the F&F as an amount HR types in. {ARREARS_NOTE}
          </p>
        </div>
      )}

      {anyAction && (
        <div className="mt-3">
          <label className="text-sm font-semibold" htmlFor={`hold-reason-${exitId}`}>Reason (recorded against your name)</label>
          <textarea
            id={`hold-reason-${exitId}`}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder="At least 15 characters"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {view.canRequestHold && (
              <button disabled={busy} onClick={() => onAct("hold/request", "Hold requested")} className="cursor-pointer rounded-lg bg-amber-700 px-4 py-2 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-50">
                Request salary hold
              </button>
            )}
            {view.canDecideRequest && (
              <>
                <button disabled={busy} onClick={() => onAct("hold/approve", "Hold approved — salary days are 0")} className="cursor-pointer rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50">
                  Approve hold
                </button>
                <button disabled={busy} onClick={() => onAct("hold/reject", "Request declined")} className="cursor-pointer rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50">
                  Decline
                </button>
              </>
            )}
            {view.canPlaceHold && !view.canDecideRequest && (
              <button disabled={busy} onClick={() => onAct("hold", "Salary is on hold")} className="cursor-pointer rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50">
                Hold salary
              </button>
            )}
            {view.canRelease && (
              <button disabled={busy} onClick={() => onAct("hold/release", "Hold released")} className="cursor-pointer rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                Release hold
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Loads the state for one exit and wires the actions. Shows nothing when the user has no access. */
export function AbsconderPayHoldPanel({ exitId }: { exitId: string }) {
  const { toast } = useToast();
  const [view, setView] = useState<HoldView | null>(null);
  const [off, setOff] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await hrmsApi.get<{ data: HoldView }>(`${BASE}/${exitId}`);
      setView(res.data ?? null);
    } catch {
      setOff(true); // no access, or not an absconding exit: show nothing rather than an error
    }
  }, [exitId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (path: string, success: string) => {
    if (reason.trim().length < 15) {
      toast({ title: "Reason needed", description: "Give a reason of at least 15 characters.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await hrmsApi.post(`${BASE}/${exitId}/${path}`, { reason: reason.trim() });
      toast({ title: success });
      setReason("");
      await load();
    } catch (err) {
      toast({ title: "Not done", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (off) return null;
  if (!view) return <div className="py-3 text-sm text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin" /> Checking salary hold…</div>;
  return <AbsconderPayHoldView exitId={exitId} view={view} reason={reason} busy={busy} onReason={setReason} onAct={(p, ok) => void act(p, ok)} />;
}
