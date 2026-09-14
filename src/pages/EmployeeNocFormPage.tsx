/**
 * NOC Certificate — the employee-facing form.
 *
 * Reached from an emailed link at /employee/noc/:token with no session: the leaver's HRMS account
 * is being deprovisioned, which is why the link carries its own token. Talks to
 * /api/public/noc/* with plain fetch and no auth header, and reads responses through
 * readPublicJson so an nginx HTML error page does not surface as "Unexpected token '<'" — which
 * to the reader is indistinguishable from a broken link.
 *
 * Mirrors the printed certificate's layout on purpose. The employee has almost certainly seen the
 * paper form, and a screen that reorders its fields makes them re-read a document they already
 * know rather than just filling in the four things that are actually theirs to enter.
 *
 * Identity fields are rendered as locked text, not disabled inputs. A disabled input still looks
 * like something that failed to work; static text reads as "already known", which is what it is.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, FileCheck, Loader2 } from "lucide-react";
import { readPublicJson } from "@/lib/publicJson";

type AssetStatus = "returned" | "not_returned" | "na";

interface AssetRow {
  itemNo: number;
  itemCode: string;
  itemLabel: string;
  quantity: number | null;
  status: AssetStatus;
}

interface FormView {
  caseId: string;
  employeeCode: string | null;
  employeeName: string | null;
  location: string | null;
  portfolio: string | null;
  designation: string | null;
  resignationDate: string | null;
  lastWorkingDay: string | null;
  reasonForLeaving: string | null;
  submitted: boolean;
  assets: AssetRow[];
}

const ASSET_OPTIONS: Array<{ value: AssetStatus; label: string }> = [
  { value: "returned", label: "Returned" },
  { value: "not_returned", label: "Not Returned" },
  { value: "na", label: "N/A" },
];

/** IST today, so the max on the date input matches the server's own check. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function LockedField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-900">
        {value?.trim() || "—"}
      </div>
    </div>
  );
}

export default function EmployeeNocFormPage() {
  const { token = "" } = useParams();

  const [view, setView] = useState<FormView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [resignationDate, setResignationDate] = useState("");
  const [reason, setReason] = useState("");
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/public/noc/${encodeURIComponent(token)}`);
      const body = await readPublicJson(res);
      if (!res.ok || !body.success) {
        throw new Error(body.message ?? "This NOC form link is not valid.");
      }
      const data = body.data as FormView;
      setView(data);
      setResignationDate(data.resignationDate ?? "");
      setReason(data.reasonForLeaving ?? "");
      setAssets(data.assets ?? []);
      if (data.submitted) setDone(true);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const maxDate = useMemo(istToday, []);

  const setAssetStatus = (itemCode: string, status: AssetStatus) => {
    setAssets((prev) => prev.map((a) => (a.itemCode === itemCode ? { ...a, status } : a)));
  };
  const setAssetQty = (itemCode: string, raw: string) => {
    const qty = raw.trim() === "" ? null : Math.max(0, Number(raw));
    setAssets((prev) => prev.map((a) => (a.itemCode === itemCode ? { ...a, quantity: Number.isFinite(qty as number) ? qty : null } : a)));
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    // Checked here as well as on the server. The server check is the real one — this page is
    // reachable by anyone with the link — but catching it locally saves a round trip and keeps
    // the message next to the field.
    if (!resignationDate) {
      setSubmitError("Please enter your resignation date.");
      return;
    }
    if (resignationDate > maxDate) {
      setSubmitError("Resignation date cannot be later than today.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/noc/${encodeURIComponent(token)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resignationDate,
          reasonForLeaving: reason.trim() || null,
          assets: assets.map((a) => ({
            itemCode: a.itemCode,
            quantity: a.quantity,
            status: a.status,
          })),
        }),
      });
      const body = await readPublicJson(res);
      if (!res.ok || !body.success) {
        throw new Error(body.message ?? "Your form could not be submitted.");
      }
      setDone(true);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── States ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-3 py-20 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Loading your NOC form…</span>
        </div>
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-500" />
          <h2 className="mt-4 text-lg font-bold text-slate-900">This form cannot be opened</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">{loadError}</p>
          <p className="mt-4 text-xs text-slate-500">
            If you believe this is a mistake, please contact your HR team and ask them to resend the link.
          </p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h2 className="mt-4 text-lg font-bold text-slate-900">Your NOC form has been submitted</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-600">
            Your reporting line, HR, IT, Admin, Accounts and Finance will now complete their
            clearance. You do not need to do anything else here.
          </p>
          <p className="mx-auto mt-4 max-w-lg text-xs leading-relaxed text-slate-500">
            If any company property is still with you, please return it as soon as possible — your
            full and final settlement cannot be released until every clearance is signed off.
          </p>
        </div>
      </Shell>
    );
  }

  const shownAssets = assets;

  return (
    <Shell>
      {/* Employee details — auto-filled, read-only */}
      <section className="mb-6">
        <h2 className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-700">
          Employee Details
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <LockedField label="Employee Name" value={view?.employeeName ?? null} />
          <LockedField label="Employee Code" value={view?.employeeCode ?? null} />
          <LockedField label="Location" value={view?.location ?? null} />
          <LockedField label="Portfolio" value={view?.portfolio ?? null} />
          <LockedField label="Designation" value={view?.designation ?? null} />
          {/*
            Last Working Day is HR's entry, not the employee's — it is only settled once notice
            period or waiver is agreed. Shown so the employee can see it once it exists, never
            editable here.
          */}
          <LockedField
            label="Last Working Day (set by HR)"
            value={view?.lastWorkingDay ?? "To be confirmed by HR"}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          These details come from your HR record. If anything is wrong, tell HR — do not work around it here.
        </p>
      </section>

      {/* Employee entry */}
      <section className="mb-6">
        <h2 className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-700">
          Your Details
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="noc-resignation-date" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Resignation Date <span className="text-red-500">*</span>
            </label>
            <input
              id="noc-resignation-date"
              type="date"
              required
              max={maxDate}
              value={resignationDate}
              onChange={(e) => setResignationDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
        <div className="mt-4">
          <label htmlFor="noc-reason" className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Reason for Leaving
          </label>
          <textarea
            id="noc-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Briefly tell us why you are leaving."
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </section>

      {/* Asset return */}
      <section className="mb-6">
        <h2 className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-700">
          Company Property
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Company property to be returned, with quantity and return status for each item
            </caption>
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 w-12">#</th>
                <th scope="col" className="px-3 py-2">Item</th>
                <th scope="col" className="px-3 py-2 w-24">Qty</th>
                <th scope="col" className="px-3 py-2 w-64">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shownAssets.map((a) => (
                <tr key={a.itemCode}>
                  <td className="px-3 py-2 text-slate-500">{a.itemNo}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{a.itemLabel}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      aria-label={`Quantity for ${a.itemLabel}`}
                      value={a.quantity ?? ""}
                      onChange={(e) => setAssetQty(a.itemCode, e.target.value)}
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {/* Radio group rather than a select: three options, and the whole point is that
                        the reader sees all three without opening anything. */}
                    <fieldset className="flex gap-3">
                      <legend className="sr-only">Return status for {a.itemLabel}</legend>
                      {ASSET_OPTIONS.map((opt) => (
                        <label key={opt.value} className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
                          <input
                            type="radio"
                            name={`asset-${a.itemCode}`}
                            value={opt.value}
                            checked={a.status === opt.value}
                            onChange={() => setAssetStatus(a.itemCode, opt.value)}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </fieldset>
                  </td>
                </tr>
              ))}
              {shownAssets.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                    No property items are listed on this form.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Declaration — the wording from the paper form, which is what makes the asset gate fair */}
      <section className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs leading-relaxed text-amber-900">
          I declare that I will return all company property first — Desktop (TFT), Keyboard, CPU,
          Mouse and ID Card — before any further FNF/NOC procedure. I agree to the Company Full and
          Final / NOC procedure as per the 45-day policy.
        </p>
      </section>

      {submitError && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-sm text-red-800">{submitError}</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-800 disabled:opacity-60"
      >
        {submitting ? "Submitting…" : "Submit my NOC form"}
      </button>
      <p className="mt-3 text-center text-xs text-slate-500">
        Submitting confirms the declaration above. You will not be able to edit this form afterwards.
      </p>
    </Shell>
  );
}

/** The certificate's letterhead, reproduced so the screen is recognisably the same document. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <header className="bg-[#1e3a63] px-6 py-5 text-center text-white">
          <h1 className="text-lg font-bold">Mas Callnet India Pvt. Ltd.</h1>
          <p className="mt-1 text-sm text-blue-100">NOC Certificate — Exit Clearance</p>
          <p className="mt-0.5 text-[11px] italic text-blue-200">
            <FileCheck className="mr-1 inline h-3 w-3" />
            Employee &amp; signatory details are captured digitally within HRMS
          </p>
        </header>
        <div className="px-6 py-6">{children}</div>
      </div>
      <p className="mx-auto mt-4 max-w-3xl text-center text-[11px] text-slate-400">
        © Mas Callnet India Pvt. Ltd. — Do not share this link; it is unique to you.
      </p>
    </div>
  );
}
