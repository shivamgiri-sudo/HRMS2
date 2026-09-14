import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Clock, AlertTriangle, PackageCheck, RotateCcw } from "lucide-react";

type Item = { item_name: string; asset_id: string | null; quantity: number; category: string };

type PassResult = {
  pass_number: string;
  status: string;
  verdict: "valid" | "valid_return" | "already_used" | "invalid" | "not_ready";
  movement_type: "returnable" | "non_returnable";
  carrier_name: string | null;
  carrier_type: string;
  branch_name: string;
  planned_exit_at: string;
  expected_return_at: string | null;
  exit_verified_at: string | null;
  is_overdue: boolean;
  items: Item[];
};

function fmt(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function VerdictBanner({ result }: { result: PassResult }) {
  const { verdict, is_overdue, pass_number } = result;

  if (verdict === "valid" || verdict === "valid_return") {
    return (
      <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-400 px-6 py-5 flex items-start gap-4">
        <CheckCircle2 className="h-10 w-10 text-emerald-500 shrink-0 mt-0.5" />
        <div>
          <div className="text-xl font-extrabold text-emerald-800 tracking-tight">
            {verdict === "valid_return" ? "VALID — RETURN EXPECTED" : "VALID PASS"}
          </div>
          <div className="text-sm text-emerald-700 mt-0.5">
            {is_overdue
              ? "⚠ This returnable pass is overdue — the expected return time has passed."
              : verdict === "valid_return"
              ? "This asset is outside premises. Return is expected."
              : "This gate pass is approved and ready for exit."}
          </div>
          <div className="mt-2 font-mono text-sm font-bold text-emerald-900 bg-emerald-100 inline-block px-2 py-0.5 rounded">
            {pass_number}
          </div>
        </div>
      </div>
    );
  }

  if (verdict === "already_used") {
    return (
      <div className="rounded-2xl bg-amber-50 border-2 border-amber-400 px-6 py-5 flex items-start gap-4">
        <PackageCheck className="h-10 w-10 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <div className="text-xl font-extrabold text-amber-800 tracking-tight">ALREADY USED</div>
          <div className="text-sm text-amber-700 mt-0.5">
            Exit has already been recorded against this pass.{" "}
            {result.exit_verified_at && <>Verified at {fmt(result.exit_verified_at)}.</>}
          </div>
          <div className="mt-2 font-mono text-sm font-bold text-amber-900 bg-amber-100 inline-block px-2 py-0.5 rounded">
            {pass_number}
          </div>
        </div>
      </div>
    );
  }

  if (verdict === "not_ready") {
    return (
      <div className="rounded-2xl bg-slate-100 border-2 border-slate-300 px-6 py-5 flex items-start gap-4">
        <Clock className="h-10 w-10 text-slate-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-xl font-extrabold text-slate-700 tracking-tight">NOT YET APPROVED</div>
          <div className="text-sm text-slate-600 mt-0.5">This pass has not been fully approved yet. Do not allow exit.</div>
          <div className="mt-2 font-mono text-sm font-bold text-slate-700 bg-slate-200 inline-block px-2 py-0.5 rounded">
            {pass_number}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-rose-50 border-2 border-rose-400 px-6 py-5 flex items-start gap-4">
      <XCircle className="h-10 w-10 text-rose-500 shrink-0 mt-0.5" />
      <div>
        <div className="text-xl font-extrabold text-rose-800 tracking-tight">INVALID / REVOKED</div>
        <div className="text-sm text-rose-700 mt-0.5">This pass has been rejected, cancelled, or voided. Do not allow exit.</div>
        <div className="mt-2 font-mono text-sm font-bold text-rose-900 bg-rose-100 inline-block px-2 py-0.5 rounded">
          {pass_number}
        </div>
      </div>
    </div>
  );
}

export default function PublicGatePassVerify() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";

  const [result, setResult] = useState<PassResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError("No gate pass token in this URL. Please scan the QR code from the printed pass.");
      setLoading(false);
      return;
    }
    fetch(`/api/public/exit-passes/t/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const json = await r.json();
        if (!json.success) throw new Error(json.message ?? "Could not verify pass");
        setResult(json.data as PassResult);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not verify this pass"))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <img src="/mcn-logo.png" alt="MAS" className="h-7" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        <div>
          <div className="text-sm font-bold text-slate-900 leading-tight">Mas Callnet India Pvt Ltd</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">Gate Pass Verification</div>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-sm space-y-4">
          {loading && (
            <div className="text-center py-12 text-slate-400 text-sm">Verifying pass…</div>
          )}

          {error && !loading && (
            <div className="rounded-2xl bg-rose-50 border-2 border-rose-300 px-5 py-4 flex gap-3">
              <AlertTriangle className="h-6 w-6 text-rose-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-rose-800 text-sm">Verification Failed</div>
                <div className="text-xs text-rose-700 mt-0.5">{error}</div>
              </div>
            </div>
          )}

          {result && (
            <>
              <VerdictBanner result={result} />

              {/* Pass details */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Pass Details</div>
                </div>
                <div className="divide-y divide-slate-100">
                  <Row label="Branch" value={result.branch_name} />
                  <Row label="Carrier" value={result.carrier_name ?? "—"} />
                  <Row label="Type" value={result.movement_type === "returnable" ? "Returnable" : "Non-Returnable"} />
                  <Row label="Planned Exit" value={fmt(result.planned_exit_at)} />
                  {result.expected_return_at && (
                    <Row
                      label="Expected Return"
                      value={fmt(result.expected_return_at)}
                      highlight={result.is_overdue ? "overdue" : undefined}
                    />
                  )}
                </div>
              </div>

              {/* Items */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Items ({result.items.length})
                  </div>
                </div>
                <ul className="divide-y divide-slate-100">
                  {result.items.map((it, i) => (
                    <li key={i} className="px-4 py-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{it.item_name}</div>
                        {it.asset_id && (
                          <div className="text-[10px] font-mono text-blue-600">Asset #{it.asset_id}</div>
                        )}
                      </div>
                      <div className="text-sm font-bold text-slate-600 shrink-0">×{it.quantity}</div>
                    </li>
                  ))}
                </ul>
              </div>

              {result.verdict === "valid" && (
                <div className="rounded-xl bg-emerald-600 text-white px-5 py-3 flex items-center gap-2 text-sm font-semibold">
                  <RotateCcw className="h-4 w-4 shrink-0" />
                  Confirm identity of carrier before allowing exit. Record exit in the HRMS security console.
                </div>
              )}
            </>
          )}

          <p className="text-center text-[10px] text-slate-400 pt-2">
            MAS Callnet India Pvt Ltd · Secure Gate Pass System · {new Date().getFullYear()}
          </p>
        </div>
      </main>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: "overdue" }) {
  return (
    <div className="px-4 py-2.5 flex items-center justify-between gap-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0">{label}</span>
      <span className={`text-sm text-right font-medium ${highlight === "overdue" ? "text-rose-600 font-bold" : "text-slate-700"}`}>
        {value}
      </span>
    </div>
  );
}
