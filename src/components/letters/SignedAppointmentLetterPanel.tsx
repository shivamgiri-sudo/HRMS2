/**
 * "Appointment Letter (signed)" on the employee's Joining Documents page.
 *
 * The letter the employee signed with Aadhaar eSign is stored by the
 * appointment-letter flow, not by the joining-document checklist, so it does not
 * appear as a checklist row. The pack response carries it separately
 * (signed_appointment_letters) and this panel shows it beside the signed joining
 * kit, with View and Download. The backend applies the same access rules as the
 * rest of the page; this component only renders what it is given.
 */
import { useState } from "react";
import { Download, Eye, FileCheck2, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

export type SignedAppointmentLetter = {
  issue_id: string;
  letter_number: string;
  status: string;
  accepted_at: string | null;
  sha256_short: string | null;
};

const formatDateTime = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).replace(",", "");
};

export function SignedAppointmentLetterPanel({
  employeeId, letters,
}: { employeeId: string; letters: SignedAppointmentLetter[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchCopy = async (letter: SignedAppointmentLetter, inline: boolean) => {
    const base = `/api/employees/${employeeId}/joining-documents/appointment-letters/${letter.issue_id}/signed-copy`;
    return hrmsApi.getBlob(inline ? `${base}?inline=1` : base);
  };

  const run = async (letter: SignedAppointmentLetter, action: "view" | "download") => {
    setBusy(`${letter.issue_id}:${action}`);
    setError(null);
    try {
      const blob = await fetchCopy(letter, action === "view");
      const url = URL.createObjectURL(blob);
      if (action === "view") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${letter.letter_number}-accepted.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to open the signed appointment letter.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Appointment Letter (signed)">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Appointment Letter (signed)</p>
      {error && <p role="alert" className="mt-2 text-xs font-medium text-red-600">{error}</p>}
      {letters.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">None</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {letters.map((letter) => {
            const at = formatDateTime(letter.accepted_at);
            return (
              <li key={letter.issue_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <FileCheck2 className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-semibold text-slate-800">{letter.letter_number}</span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                    Signed by employee
                  </span>
                  {letter.status === "revoked" && (
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[10px] font-bold uppercase text-red-600">Revoked</span>
                  )}
                  {at && <span className="text-xs text-slate-500">{at}</span>}
                  {letter.sha256_short && (
                    <span className="text-xs text-slate-400">SHA-256 <span className="font-mono">{letter.sha256_short}</span></span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={busy !== null} onClick={() => void run(letter, "view")}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60">
                    {busy === `${letter.issue_id}:view` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} View
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => void run(letter, "download")}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60">
                    {busy === `${letter.issue_id}:download` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Download
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
