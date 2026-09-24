/**
 * The page the appointment-letter email's "Review & Accept" button links to.
 *
 * Reached by an employee with no HRMS session, usually on a phone. The order is
 * deliberate: who the letter is for and what it says comes first, the consent
 * tick and the sign button next, the PDF itself after — because most phone
 * browsers refuse to render a PDF inside an iframe, so the document must also be
 * reachable as a plain "open" link, and a signer should not have to scroll past a
 * blank box to find the button. On a wide screen the PDF leads and the summary
 * sits beside it, as on the joining-kit page this mirrors.
 *
 * Public, token-gated: it calls /api/public/appointment-letter/* with plain
 * fetch, exactly as the kit page does, never the authenticated hrmsApi client.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, Maximize2, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { readPublicJson } from "@/lib/publicJson";

type LetterSession = {
  letterNumber: string;
  employeeName: string | null;
  employeeCode: string | null;
  designation: string | null;
  branchName: string | null;
  dateOfJoining: string | null;
  companySignedAt: string | null;
  companySignedBy: string | null;
  esignStatus: string;
  signed: boolean;
  signedAt: string | null;
  esignAvailable: boolean;
};

/** Why the page cannot show a letter. Each gets its own wording, not one generic error. */
type Blocked = { kind: "invalid" | "revoked"; message: string };

const formatIst = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
};

export default function EmployeeAppointmentLetterEsignPage() {
  const { token = "" } = useParams();
  const [session, setSession] = useState<LetterSession | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signUrl, setSignUrl] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/appointment-letter/${token}/session`);
      const body = await readPublicJson(response);
      if (!response.ok) {
        const message = body?.message || "This link is not valid. Please contact HR.";
        if (response.status === 410 || body?.code === "LETTER_REVOKED") { setBlocked({ kind: "revoked", message }); return; }
        if (response.status === 404) { setBlocked({ kind: "invalid", message }); return; }
        throw new Error(message);
      }
      setBlocked(null);
      setSession(body.data.session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to open this link.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // Coming back from the Aadhaar eSign page: pick up the outcome without a manual refresh.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && signUrl) void load(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, signUrl]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/public/appointment-letter/${token}/start`, { method: "POST" });
      const body = await readPublicJson(response);
      if (!response.ok) throw new Error(body?.message || "Unable to start the signing session.");
      const data = body?.data ?? {};
      if (data.alreadySigned) { await load(true); return; }
      const providerUrl = String(data.providerUrl || "");
      if (providerUrl && /^https?:/i.test(providerUrl)) {
        setSignUrl(providerUrl);
        // Same-tab navigation, not window.open: the popup path is blocked silently
        // once the user gesture has been spent on the await above.
        window.location.assign(providerUrl);
        return;
      }
      if (data.code === "PREPARING") { setNotice(data.message || "Your signing session is being prepared. Please try again in a few seconds."); return; }
      setError(data.message || "Electronic signing is not available right now. Please contact HR.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to start the signing session.");
    } finally {
      setBusy(false);
    }
  };

  const fileUrl = `/api/public/appointment-letter/${token}/file`;
  const signedFileUrl = `/api/public/appointment-letter/${token}/signed-file`;
  const [downloading, setDownloading] = useState(false);

  /**
   * The copy the employee signed. Fetched rather than linked so that "not available
   * yet" is said in words on this page instead of showing the browser a JSON body.
   */
  const downloadSigned = async () => {
    if (!session) return;
    setDownloading(true);
    setError(null);
    try {
      const response = await fetch(signedFileUrl);
      if (!response.ok) {
        const body = await readPublicJson(response);
        throw new Error(body?.message || "Your signed letter is not available to download yet. Please contact HR.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${session.letterNumber}-accepted.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to download your signed letter.");
    } finally {
      setDownloading(false);
    }
  };
  const started = session?.esignStatus === "sent" || session?.esignStatus === "opened";

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:py-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">MAS Callnet India Pvt. Ltd.</p>
          <h1 className="mt-2 text-2xl font-black sm:text-3xl">Your appointment letter</h1>
          {session && (
            <p className="mt-2 text-sm text-slate-300">
              {session.employeeName}
              {session.employeeCode ? ` · ${session.employeeCode}` : ""}
            </p>
          )}
        </div>

        {error && (
          <div role="alert" className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="font-semibold">{error}</p>
            </div>
          </div>
        )}
        {notice && (
          <div role="status" className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
            <p className="font-semibold">{notice}</p>
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-3xl border border-white/10 bg-white/5" aria-busy="true">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : blocked ? (
          <div role="alert" className={`rounded-3xl border p-6 ${blocked.kind === "revoked" ? "border-red-400/30 bg-red-500/10 text-red-100" : "border-amber-400/30 bg-amber-500/10 text-amber-100"}`}>
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
              <div>
                <p className="text-lg font-black">{blocked.kind === "revoked" ? "This letter is no longer valid" : "This link cannot be opened"}</p>
                <p className="mt-1 text-sm opacity-90">{blocked.message}</p>
              </div>
            </div>
          </div>
        ) : session?.signed ? (
          <div className="rounded-3xl border border-emerald-400/30 bg-emerald-500/10 p-6 text-emerald-100">
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" />
              <div>
                <p className="text-lg font-black">Thank you — you have accepted this letter.</p>
                <p className="mt-1 text-sm text-emerald-200/90">
                  {session.letterNumber}{session.signedAt ? ` · signed ${formatIst(session.signedAt)} IST` : ""}. No further action is needed.
                  Keep your signed copy for your records.
                </p>
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => void downloadSigned()}
                  className="mt-4 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
                >
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download your signed letter
                </button>
              </div>
            </div>
          </div>
        ) : session && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr),minmax(0,1fr)] xl:items-start">
            {/* Summary and actions first on a phone; beside the PDF on a wide screen. */}
            <div className="order-first space-y-5 xl:order-last xl:sticky xl:top-8">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-cyan-300" />
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Letter {session.letterNumber}</p>
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  {[
                    ["Designation", session.designation],
                    ["Branch", session.branchName],
                    ["Date of joining", session.dateOfJoining],
                    ["Signed by the company", session.companySignedAt ? `${session.companySignedBy ? `${session.companySignedBy}, ` : ""}${formatIst(session.companySignedAt)} IST` : null],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                      <dt className="text-slate-400">{label}</dt>
                      <dd className="text-right font-semibold text-white">{value || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-start gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
                  <p className="text-sm text-slate-300">
                    You will sign <strong className="text-white">once</strong> with Aadhaar eSign. Your signature is added to the letter
                    the company has already signed. The letter contains your salary details — please keep it confidential.
                  </p>
                </div>

                {started && (
                  <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
                    A signing session for this letter has already been started. If you did not finish, you can continue it below.
                  </p>
                )}
                {!session.esignAvailable && (
                  <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
                    Electronic signing is not available right now. You can read your letter below; please contact HR to accept it.
                  </p>
                )}

                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <input
                    type="checkbox"
                    checked={consented}
                    onChange={(e) => setConsented(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-cyan-500"
                  />
                  <span className="text-sm text-slate-300">
                    I have read my appointment letter and I accept its terms. I agree to sign it electronically using Aadhaar eSign.
                  </span>
                </label>

                <div className="mt-5 grid gap-3">
                  <button
                    type="button"
                    onClick={() => void accept()}
                    disabled={busy || !consented || !session.esignAvailable}
                    className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Review &amp; Accept — Sign with Aadhaar
                  </button>
                  {!consented && session.esignAvailable && (
                    <p className="text-center text-[11px] text-slate-500">Tick the box above to continue.</p>
                  )}
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-semibold text-white hover:bg-black/30"
                  >
                    <Maximize2 className="h-4 w-4" /> Open the letter to read it
                  </a>
                  {(started || signUrl) && (
                    <button
                      type="button"
                      onClick={() => void load(true)}
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20"
                    >
                      <RefreshCw className="h-4 w-4" /> I have signed — check my status
                    </button>
                  )}
                </div>

                {signUrl && (
                  <p className="mt-4 text-center text-xs text-cyan-100">
                    Taking you to Aadhaar eSign… If nothing happens,{" "}
                    <a href={signUrl} rel="noreferrer" className="font-bold underline underline-offset-2 hover:text-white">
                      open the Aadhaar eSign page
                    </a>.
                  </p>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Read before signing</p>
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[36px] items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 text-xs font-bold text-cyan-100 hover:bg-cyan-500/20"
                >
                  <Maximize2 className="h-3.5 w-3.5" /> Open full screen
                </a>
              </div>
              {/* Phone browsers and PDF-download-by-default desktops show a blank or
                  blocked box for a PDF in an iframe; the links above and below are the way through. */}
              <iframe
                title="Appointment letter"
                src={`${fileUrl}#view=FitH`}
                className="h-[70vh] min-h-[420px] w-full bg-white xl:h-[calc(100vh-220px)] xl:min-h-[600px]"
              />
              <p className="px-5 py-3 text-center text-xs text-slate-400">
                If the letter does not appear above, use{" "}
                <a href={fileUrl} target="_blank" rel="noreferrer" className="text-cyan-400 underline">
                  Open the letter to read it
                </a>.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
