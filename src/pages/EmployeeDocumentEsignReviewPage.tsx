import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Download, Loader2, PenSquare, Send } from "lucide-react";

type PublicPayload = {
  session: {
    token: string;
    document_name: string;
    employee_name: string | null;
    employee_code: string | null;
    provider_url: string | null;
    tx_status: string | null;
  };
  review: {
    values: Array<{ field_key: string; field_label: string; value_text: string | null; value_source: string; fill_status: string }>;
  };
  employee_message: string;
};

export default function EmployeeDocumentEsignReviewPage() {
  const { token = "" } = useParams();
  const [payload, setPayload] = useState<PublicPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"confirm" | "correction" | "esign" | null>(null);
  const [actorName, setActorName] = useState("");
  const [comment, setComment] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/employee-documents/esign/${token}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || "Unable to load the secure review link.");
      setPayload(body.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load the secure review link.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const act = async (action: "confirm" | "request_correction" | "esign") => {
    setBusy(action === "request_correction" ? "correction" : action);
    setError(null);
    setResult(null);
    try {
      const url = action === "esign"
        ? `/api/public/employee-documents/esign/${token}/start`
        : `/api/public/employee-documents/esign/${token}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          actor_name: actorName || payload?.session.employee_name || "Employee",
          signer_name: actorName || payload?.session.employee_name || "Employee",
          comment,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || "Unable to complete this action.");
      if (action === "esign") {
        const providerUrl = String(body?.data?.provider_url || payload?.session.provider_url || "");
        if (providerUrl && /^https?:/i.test(providerUrl)) {
          window.open(providerUrl, "_blank", "noopener,noreferrer");
        }
        setResult(body?.data?.fallback_message || "eSign request started. Completion waits for Luckpay confirmation.");
      } else {
        setResult(action === "confirm" ? "Details confirmed successfully." : "Correction request sent to HR.");
        await load();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to complete this action.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="rounded-[30px] border border-white/10 bg-white/5 p-6 backdrop-blur">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">Secure Employee Review</p>
          <h1 className="mt-2 text-3xl font-black">{payload?.session.document_name || "Joining Document"}</h1>
          <p className="mt-2 text-sm text-slate-300">{payload?.employee_message || "Review your document values before signing."}</p>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="font-semibold">{error}</p>
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="font-semibold">{result}</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-[30px] border border-white/10 bg-white/5">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : payload && (
          <div className="grid gap-5 xl:grid-cols-[1.1fr,0.9fr]">
            <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
              <div className="grid gap-3 md:grid-cols-2">
                {payload.review.values.map((value) => (
                  <div key={value.field_key} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs font-black uppercase tracking-wide text-slate-400">{value.field_label}</p>
                    <p className="mt-2 text-sm font-semibold text-white">{value.value_text || "Not provided"}</p>
                    <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">{String(value.value_source).replace(/_/g, " ")} · {String(value.fill_status).replace(/_/g, " ")}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Your Name</span>
                <input value={actorName} onChange={(event) => setActorName(event.target.value)} className="min-h-[48px] w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-cyan-400" placeholder="Enter your full name" />
              </label>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">Comment</span>
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} className="min-h-[112px] w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400" placeholder="Add a note if you need any correction or context." />
              </label>

              <div className="mt-5 grid gap-3">
                <a href={`/api/public/employee-documents/esign/${token}/download`} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-semibold text-white hover:bg-black/30">
                  <Download className="h-4 w-4" /> Download draft
                </a>
                <button type="button" onClick={() => void act("confirm")} disabled={busy !== null} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-70">
                  {busy === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm Details
                </button>
                <button type="button" onClick={() => void act("request_correction")} disabled={busy !== null} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 text-sm font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-70">
                  {busy === "correction" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenSquare className="h-4 w-4" />} Request Correction
                </button>
                <button type="button" onClick={() => void act("esign")} disabled={busy !== null} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-70">
                  {busy === "esign" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Proceed to Aadhaar eSign
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
