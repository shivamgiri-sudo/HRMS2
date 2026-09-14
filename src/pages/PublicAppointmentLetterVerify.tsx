/**
 * What someone sees after scanning the QR on an appointment letter.
 *
 * Usually reached on a phone by a bank, a landlord or a background-check firm
 * deciding whether the letter in front of them is real. So the verdict comes
 * first and in plain language, and the self-signed case says so rather than
 * showing a reassuring green tick the certificate does not justify.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, BadgeCheck, Loader2, ShieldAlert, ShieldX } from "lucide-react";

type Verification = {
  found: boolean;
  valid?: boolean;
  letterNumber?: string;
  employeeName?: string | null;
  employeeCode?: string | null;
  designation?: string | null;
  branchName?: string | null;
  dateOfJoining?: string | null;
  issuedOn?: string | null;
  signedBy?: string | null;
  signedByDesignation?: string | null;
  caIssuedSignature?: boolean;
  employeeAccepted?: boolean;
  revoked?: boolean;
  revokedOn?: string | null;
  statement?: string;
  verified_at?: string;
};

export function PublicAppointmentLetterVerify() {
  const { token = "" } = useParams();
  const [data, setData] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/verify/appointment/${encodeURIComponent(token)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || "No appointment letter matches this verification link.");
      setData(body.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No appointment letter matches this verification link.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // Three distinct verdicts. Revoked and self-signed must not look like valid.
  const verdict = !data?.found ? "unknown"
    : data.revoked ? "revoked"
    : data.caIssuedSignature ? "valid" : "unverified-signature";

  const banner = {
    valid: { bg: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100", Icon: BadgeCheck, title: "Genuine appointment letter" },
    "unverified-signature": { bg: "border-amber-400/30 bg-amber-500/10 text-amber-100", Icon: ShieldAlert, title: "Issued by the company — signature not CA-verified" },
    revoked: { bg: "border-red-400/30 bg-red-500/10 text-red-100", Icon: ShieldX, title: "This letter has been revoked" },
    unknown: { bg: "border-red-400/30 bg-red-500/10 text-red-100", Icon: AlertTriangle, title: "No matching letter found" },
  }[verdict];

  const rows: Array<[string, string | null | undefined]> = data?.found ? [
    ["Employee", data.employeeName],
    ["Employee code", data.employeeCode],
    ["Designation", data.designation],
    ["Branch", data.branchName],
    ["Date of joining", data.dateOfJoining],
    ["Letter issued on", data.issuedOn],
    ["Letter number", data.letterNumber],
    ["Signed for the company by", data.signedBy ? `${data.signedBy}${data.signedByDesignation ? ` · ${data.signedByDesignation}` : ""}` : null],
    ["Accepted by employee", data.employeeAccepted ? "Yes" : "Not yet"],
    ...(data.revokedOn ? [["Revoked on", data.revokedOn] as [string, string]] : []),
  ] : [];

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="text-center">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">MAS Callnet India Pvt. Ltd.</p>
          <h1 className="mt-2 text-2xl font-black">Appointment letter verification</h1>
        </div>

        {loading ? (
          <div className="flex h-56 items-center justify-center rounded-[30px] border border-white/10 bg-white/5">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : error && !data?.found ? (
          <div className="rounded-[30px] border border-red-400/30 bg-red-500/10 p-6 text-red-100">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
              <div>
                <p className="text-lg font-black">No matching letter found</p>
                <p className="mt-1 text-sm text-red-200/90">{error}</p>
                <p className="mt-3 text-sm text-red-200/90">
                  If you were given this link on a printed letter, treat that letter as unverified
                  and confirm directly with the company before relying on it.
                </p>
              </div>
            </div>
          </div>
        ) : data?.found && (
          <>
            <div className={`rounded-[30px] border p-6 ${banner.bg}`}>
              <div className="flex gap-3">
                <banner.Icon className="mt-0.5 h-6 w-6 shrink-0" />
                <div>
                  <p className="text-lg font-black">{banner.title}</p>
                  <p className="mt-1.5 text-sm opacity-90">{data.statement}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
              <dl className="divide-y divide-white/5">
                {rows.filter(([, v]) => v).map(([label, value]) => (
                  <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                    <dt className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</dt>
                    <dd className="text-sm font-semibold text-white">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <p className="text-center text-[11px] leading-relaxed text-slate-500">
              This page shows only what is needed to confirm the letter is genuine. Salary,
              address and identity numbers are deliberately not published here.
              {data.verified_at && <><br />Checked on {new Date(data.verified_at).toLocaleString("en-IN")}.</>}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default PublicAppointmentLetterVerify;
