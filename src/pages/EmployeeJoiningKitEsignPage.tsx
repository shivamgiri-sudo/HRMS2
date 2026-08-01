/**
 * The page the joining-kit email links to.
 *
 * One signature covers every document in the kit, so this screen has to make
 * that explicit before the signer commits: it lists exactly what is included,
 * shows the merged file itself, and requires a deliberate consent tick. A signer
 * who cannot see what they are signing cannot meaningfully consent to it.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, Send, ShieldCheck } from "lucide-react";

type KitSession = {
  kitId: string;
  employeeName: string;
  employeeCode: string | null;
  branchName: string | null;
  status: string;
  documentCount: number;
  totalPages: number;
  documents: Array<{ code: string; name: string; pageFrom: number; pageTo: number }>;
  providerUrl: string | null;
  txStatus: string | null;
  signedAt: string | null;
  expiresAt: string | null;
};

export default function EmployeeJoiningKitEsignPage() {
  const { token = "" } = useParams();
  const [session, setSession] = useState<KitSession | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A completed kit is not an error, so it gets its own state rather than being
  // rendered as a failure.
  const [done, setDone] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signUrl, setSignUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/joining-kit/esign/${token}`);
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 410) { setDone(body?.message || "These documents have already been signed."); return; }
        throw new Error(body?.message || "Unable to open this signing link.");
      }
      setSession(body.data.session);
      setMessage(body.data.employee_message ?? "");
      if (body.data.session?.signedAt) setDone("These documents have already been signed. No further action is needed.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to open this signing link.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const sign = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/joining-kit/esign/${token}/start`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || "Unable to start the signing session.");
      const providerUrl = String(body?.data?.providerUrl || session?.providerUrl || "");
      if (providerUrl && /^https?:/i.test(providerUrl)) {
        setSignUrl(providerUrl);
        // Same-tab navigation, not window.open: the popup path is blocked
        // silently once the user gesture has been consumed by the await above.
        window.location.assign(providerUrl);
        return;
      }
      setError(body?.data?.message || "The eSign provider is not available right now. Please contact HR.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to start the signing session.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="rounded-[30px] border border-white/10 bg-white/5 p-6 backdrop-blur">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">MAS Callnet India Pvt. Ltd.</p>
          <h1 className="mt-2 text-3xl font-black">Sign your joining documents</h1>
          {session && (
            <p className="mt-2 text-sm text-slate-300">
              {session.employeeName}
              {session.employeeCode ? ` · ${session.employeeCode}` : ""}
              {session.branchName ? ` · ${session.branchName}` : ""}
            </p>
          )}
          {message && <p className="mt-3 text-sm text-slate-300">{message}</p>}
        </div>

        {error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="font-semibold">{error}</p>
            </div>
          </div>
        )}

        {done && (
          <div className="rounded-[30px] border border-emerald-400/30 bg-emerald-500/10 p-6 text-emerald-100">
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" />
              <div>
                <p className="text-lg font-black">{done}</p>
                <p className="mt-1 text-sm text-emerald-200/90">
                  You can download your signed copy below. Keep it for your records.
                </p>
                <a
                  href={`/api/public/joining-kit/esign/${token}/download`}
                  className="mt-4 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20"
                >
                  <Download className="h-4 w-4" /> Download signed documents
                </a>
              </div>
            </div>
          </div>
        )}

        {signUrl && (
          <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
            <p className="font-semibold">Taking you to Aadhaar eSign…</p>
            <p className="mt-1 text-cyan-200/90">
              If nothing happens,{" "}
              <a href={signUrl} rel="noreferrer" className="font-bold underline underline-offset-2 hover:text-white">
                open the Aadhaar eSign page
              </a>.
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-[30px] border border-white/10 bg-white/5">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : session && !done && (
          <div className="grid gap-5 xl:grid-cols-[1.05fr,0.95fr]">
            <div className="space-y-5">
              <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-cyan-300" />
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                    {session.documentCount} documents · {session.totalPages} pages
                  </p>
                </div>
                <ul className="mt-4 space-y-2">
                  {session.documents.map((d) => (
                    <li key={d.code} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                      <span className="text-sm font-semibold text-white">{d.name}</span>
                      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        {d.pageFrom === d.pageTo ? `Page ${d.pageFrom}` : `Pages ${d.pageFrom}–${d.pageTo}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="overflow-hidden rounded-[30px] border border-white/10 bg-white/5">
                <div className="border-b border-white/10 px-5 py-3">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Read before signing</p>
                </div>
                {/* The signer must be able to read the exact file being signed,
                    not a summary of it. */}
                <iframe
                  title="Joining documents"
                  src={`/api/public/joining-kit/esign/${token}/download`}
                  className="h-[560px] w-full bg-white"
                />
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
              <div className="flex items-start gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
                <p className="text-sm text-slate-300">
                  You will sign <strong className="text-white">once</strong> with Aadhaar eSign. That single
                  signature is applied to <strong className="text-white">all {session.documentCount} documents</strong> listed
                  here, in the signature area of each one.
                </p>
              </div>

              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(e) => setConsented(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-cyan-500"
                />
                <span className="text-sm text-slate-300">
                  I have read the {session.documentCount} documents above and I agree to sign all of
                  them electronically using Aadhaar eSign.
                </span>
              </label>

              <div className="mt-5 grid gap-3">
                <a
                  href={`/api/public/joining-kit/esign/${token}/download`}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-semibold text-white hover:bg-black/30"
                >
                  <Download className="h-4 w-4" /> Download to read offline
                </a>
                <button
                  type="button"
                  onClick={() => void sign()}
                  disabled={busy || !consented}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Sign all {session.documentCount} documents
                </button>
                {!consented && (
                  <p className="text-center text-[11px] text-slate-500">Tick the box above to continue.</p>
                )}
              </div>

              {session.expiresAt && (
                <p className="mt-4 text-center text-[11px] text-slate-500">
                  This link expires on {new Date(session.expiresAt).toLocaleDateString("en-IN", {
                    day: "2-digit", month: "short", year: "numeric",
                  })}.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
