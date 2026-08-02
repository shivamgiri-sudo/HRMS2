/**
 * What Payroll HR submitted, shown back to them.
 *
 * Once an offer is submitted the form is hidden, and until now it was replaced
 * by a status badge and a single sentence. The person who raised the offer could
 * not see the salary they had entered, the joining date, or — after the Branch
 * Head acted — who decided it, when, or why. They were also given no way to
 * correct a mistake: the only route back into the form was for the Branch Head
 * to reject the offer, which records an adverse decision on a candidate for what
 * is usually a keying error.
 *
 * So this panel does two things: shows the submitted offer read-only with its
 * decision trail, and offers Withdraw & Revise while the offer is still pending.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Clock, Loader2, RotateCcw, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";

type OfferDetail = {
  offer_id: string;
  status: string;
  emp_type: string | null;
  salary_band: string | null;
  date_of_joining: string | null;
  date_of_salary: string | null;
  offered_ctc: string | null;
  basic: string | null;
  hra: string | null;
  conveyance: string | null;
  da: string | null;
  special_allowance: string | null;
  other_allowance: string | null;
  bonus: string | null;
  gross: string | null;
  pf_employee: string | null;
  pf_employer: string | null;
  esic_employee: string | null;
  esic_employer: string | null;
  professional_tax: string | null;
  net_in_hand: string | null;
  pf_eligible: number | null;
  esi_eligible: number | null;
  submitted_at: string | null;
  designation_name: string | null;
  department_name: string | null;
  cost_centre_name: string | null;
  reporting_manager_name: string | null;
  submitted_by_name: string | null;
};

type Decision = {
  action: string;
  remarks: string | null;
  action_at: string | null;
  actor_name: string | null;
  actor_code: string | null;
};

const money = (v: string | null) =>
  v == null || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const day = (v: string | null) =>
  !v ? "—" : new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const stamp = (v: string | null) =>
  !v ? "—" : new Date(v).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm ${strong ? "font-bold text-slate-900" : "text-slate-800"}`}>{value}</span>
    </div>
  );
}

export function SubmittedOfferPanel({
  requestId, offerStatus, canWithdraw, onWithdrawn,
}: {
  requestId: string;
  offerStatus: string | undefined;
  /** False for viewers who may read the offer but not take it back. */
  canWithdraw: boolean;
  onWithdrawn: () => void;
}) {
  const [detail, setDetail] = useState<OfferDetail | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await hrmsApi.get<{ data: { offer: OfferDetail | null; decisions: Decision[] } }>(
        `/api/ats/onboarding/requests/${encodeURIComponent(requestId)}/offer-detail`,
      );
      setDetail(r.data?.offer ?? null);
      setDecisions(r.data?.decisions ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load the submitted offer.");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => { void load(); }, [load]);

  const withdraw = async () => {
    // A reason is required, exactly as it is for a rejection — a salary that
    // changes with no recorded explanation is what an audit asks about.
    const reason = window.prompt(
      "Withdraw this offer so it can be revised?\n\n" +
      "It returns to draft and leaves the Branch Head's queue.\n\n" +
      "Why are you withdrawing it? This is recorded on the candidate's journey.",
    );
    if (!reason || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await hrmsApi.post(`/api/ats/onboarding/offers/${encodeURIComponent(detail!.offer_id)}/withdraw`, { reason });
      onWithdrawn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not withdraw this offer.");
    } finally {
      setBusy(false);
    }
  };

  const pending = offerStatus === "submitted";
  const approved = offerStatus === "bh_approved";

  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div className="flex items-center gap-2.5">
          {approved ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            : pending ? <Clock className="h-5 w-5 text-blue-600" aria-hidden="true" />
            : <XCircle className="h-5 w-5 text-red-600" aria-hidden="true" />}
          <div>
            <h3 className="font-bold text-slate-900">Submitted Employment Offer</h3>
            <p className="text-xs text-slate-500">
              {approved ? "Approved by Branch Head — no further changes allowed."
                : pending ? "Pending Branch Head approval."
                : "This offer is no longer pending."}
            </p>
          </div>
        </div>

        {pending && canWithdraw && detail && (
          <Button
            type="button" variant="outline" onClick={() => void withdraw()} disabled={busy}
            className="min-h-[44px] cursor-pointer gap-2 border-amber-300 text-amber-800 hover:bg-amber-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
            Withdraw &amp; Revise
          </Button>
        )}
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="inline-flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading offer" />
        </div>
      ) : !detail ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">No offer found for this request.</p>
      ) : (
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Position</p>
            <div className="divide-y divide-slate-100">
              <Row label="Designation" value={detail.designation_name ?? "—"} />
              <Row label="Department" value={detail.department_name ?? "—"} />
              <Row label="Cost centre" value={detail.cost_centre_name ?? "—"} />
              <Row label="Reporting manager" value={detail.reporting_manager_name ?? "—"} />
              <Row label="Employment type" value={detail.emp_type ?? "—"} />
              <Row label="Salary band" value={detail.salary_band ?? "—"} />
              <Row label="Date of joining" value={day(detail.date_of_joining)} strong />
              <Row label="Salary starts" value={day(detail.date_of_salary)} />
            </div>
          </div>

          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Salary submitted</p>
            <div className="divide-y divide-slate-100">
              <Row label="Monthly CTC" value={money(detail.offered_ctc)} strong />
              <Row label="Basic" value={money(detail.basic)} />
              <Row label="HRA" value={money(detail.hra)} />
              <Row label="Conveyance" value={money(detail.conveyance)} />
              <Row label="Special allowance" value={money(detail.special_allowance)} />
              <Row label="Gross" value={money(detail.gross)} strong />
              <Row label="PF (employee)" value={Number(detail.pf_eligible) === 1 ? money(detail.pf_employee) : "Not applicable"} />
              <Row label="ESIC (employee)" value={Number(detail.esi_eligible) === 1 ? money(detail.esic_employee) : "Not applicable"} />
              <Row label="Net in hand" value={money(detail.net_in_hand)} strong />
            </div>
          </div>

          <div className="md:col-span-2 border-t pt-3">
            <p className="text-xs text-slate-500">
              Submitted {stamp(detail.submitted_at)}
              {detail.submitted_by_name ? ` by ${detail.submitted_by_name}` : ""}
            </p>
          </div>

          {decisions.length > 0 && (
            <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Branch Head decision</p>
              <ul className="mt-2 space-y-2">
                {decisions.map((d, i) => (
                  <li key={`${d.action}-${d.action_at}-${i}`} className="text-sm">
                    <span className={`font-semibold ${d.action === "approved" ? "text-emerald-700" : "text-red-700"}`}>
                      {d.action === "approved" ? "Approved" : "Rejected"}
                    </span>
                    <span className="text-slate-600">
                      {" "}by {d.actor_name ?? "—"} · {stamp(d.action_at)}
                    </span>
                    {d.remarks && <p className="mt-0.5 text-xs text-slate-600">“{d.remarks}”</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SubmittedOfferPanel;
