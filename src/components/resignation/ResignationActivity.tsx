import { useCallback, useEffect, useState } from "react";
import { Check, Gift, History, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";
import { errorMessage, formatDateTime, statusLabel, type ApiList, type AuditEntry, type RetentionOffer } from "./resignation-types";

function offerDetailsText(details: unknown): string | null {
  let value: unknown = details;
  if (typeof details === "string") {
    try {
      value = JSON.parse(details);
    } catch {
      return details.trim() || null;
    }
  }
  if (value && typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    return parts.length ? parts.join(" · ") : null;
  }
  return value === null || value === undefined ? null : String(value);
}

function isAwaitingResponse(offer: RetentionOffer): boolean {
  const r = String(offer.employee_response ?? "").toLowerCase();
  return r === "" || r === "pending";
}

function RetentionOfferRow({ offer, exitId, onRefresh }: { offer: RetentionOffer; exitId: string; onRefresh: () => void }) {
  const [pending, setPending] = useState<"accept" | "reject" | null>(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const awaiting = isAwaitingResponse(offer);
  const details = offerDetailsText(offer.offer_details);

  async function respond(response: "accept" | "reject") {
    setBusy(true);
    setError(null);
    try {
      await hrmsApi.patch(`/api/exit/resignation/${exitId}/retention-offer/${offer.id}/respond`, {
        employee_response: response,
        response_remarks: remarks,
      });
      setPending(null);
      onRefresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to submit response"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold capitalize text-slate-900">{offer.offer_type?.replace(/_/g, " ") || "Retention offer"}</p>
          {details && <p className="mt-0.5 break-words text-base text-slate-700">{details}</p>}
          <p className="mt-1 text-sm text-slate-600">
            {offer.offered_by_name ? `From ${offer.offered_by_name} · ` : ""}
            {formatDateTime(offer.offer_date ?? offer.created_at)}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-sm font-semibold ${
            awaiting
              ? "border-slate-200 bg-white text-slate-700"
              : offer.employee_response === "accept"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-300 bg-slate-100 text-slate-800"
          }`}
        >
          {awaiting ? "Awaiting your response" : offer.employee_response === "accept" ? "You accepted" : "You declined"}
        </span>
      </div>
      {offer.response_remarks && <p className="text-sm italic text-slate-600">Your remarks: {offer.response_remarks}</p>}
      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}
      {awaiting && !pending && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" size="sm" onClick={() => setPending("accept")} className="cursor-pointer bg-emerald-700 text-white hover:bg-emerald-800">
            <Check aria-hidden /> Accept
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setPending("reject")} className="cursor-pointer">
            <X aria-hidden /> Decline
          </Button>
        </div>
      )}
      {awaiting && pending && (
        <div className="space-y-2">
          <label htmlFor={`offer-remarks-${offer.id}`} className="block text-sm font-semibold text-slate-700">
            Remarks (optional)
          </label>
          <Textarea id={`offer-remarks-${offer.id}`} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" size="sm" disabled={busy} onClick={() => respond(pending)} className="cursor-pointer bg-slate-900 text-white hover:bg-slate-800">
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Confirm {pending === "accept" ? "accept" : "decline"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPending(null)} className="cursor-pointer">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Retention offers made to the employee on this exit request (kept from the previous page). */
export function RetentionOffers({ exitId }: { exitId: string }) {
  const [offers, setOffers] = useState<RetentionOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<ApiList<RetentionOffer>>(`/api/exit/resignation/${exitId}/retention-offers`);
      setOffers(res.data ?? []);
    } catch (err) {
      setError(errorMessage(err, "Failed to load retention offers"));
    } finally {
      setLoading(false);
    }
  }, [exitId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="offers-title" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 id="offers-title" className="flex items-center gap-2 text-lg font-bold text-slate-900">
        <Gift className="h-5 w-5 text-teal-700" aria-hidden /> Retention offers
      </h2>
      <div className="mt-3">
        {loading ? (
          <Skeleton className="h-16 w-full rounded-2xl" />
        ) : error ? (
          <p className="text-base text-slate-600">{error}</p>
        ) : offers.length === 0 ? (
          <p className="text-base text-slate-600">No retention offers at this time.</p>
        ) : (
          <ul className="space-y-3">
            {offers.map((offer) => (
              <RetentionOfferRow key={offer.id} offer={offer} exitId={exitId} onRefresh={load} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Activity trail of the exit request (exit_approval_log + retention actions). */
export function ActivityTrail({ entries, loading, error }: { entries: AuditEntry[]; loading: boolean; error: string | null }) {
  return (
    <section aria-labelledby="activity-title" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 id="activity-title" className="flex items-center gap-2 text-lg font-bold text-slate-900">
        <History className="h-5 w-5 text-teal-700" aria-hidden /> Activity
      </h2>
      <div className="mt-3">
        {loading ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : error ? (
          <p className="text-base text-slate-600">{error}</p>
        ) : entries.length === 0 ? (
          <p className="text-base text-slate-600">No activity recorded yet.</p>
        ) : (
          <ol className="space-y-3">
            {entries.map((entry, idx) => (
              <li key={entry.id ?? idx} className="flex gap-3">
                <span aria-hidden className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-teal-600" />
                <div className="min-w-0">
                  <p className="text-base font-semibold capitalize text-slate-900">
                    {entry.action === "status_update" && entry.stage ? statusLabel(entry.stage) : (entry.action ?? "Event").replace(/_/g, " ")}
                  </p>
                  {entry.remarks && <p className="break-words text-sm text-slate-600">{entry.remarks}</p>}
                  <p className="text-sm text-slate-600">
                    {formatDateTime(entry.performed_at)}
                    {entry.performed_by_name ? ` · ${entry.performed_by_name}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
