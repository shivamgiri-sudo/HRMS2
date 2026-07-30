import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Building2, CheckCircle2, Clock, LogOut, ShieldCheck, ThumbsDown, Loader2, AlertCircle, RefreshCcw, Search } from "lucide-react";
import { visitorApi, visitorDateTime, type PublicVisitStatus } from "@/features/visitor/visitorApi";

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string; message: string }> = {
  pending_approval: {
    icon: <Clock className="h-8 w-8 text-amber-600" />,
    label: "Awaiting Approval",
    color: "text-amber-700", bg: "bg-amber-50 border-amber-200",
    message: "Your visit request has been sent to your host. Please wait for their approval before proceeding to security.",
  },
  approved: {
    icon: <CheckCircle2 className="h-8 w-8 text-[#3BAD49]" />,
    label: "Approved",
    color: "text-[#2b7d35]", bg: "bg-[#3BAD49]/[0.08] border-[#3BAD49]/30",
    message: "Your visit is approved! Please proceed to the security desk and present this visit number.",
  },
  checked_in: {
    icon: <ShieldCheck className="h-8 w-8 text-green-600" />,
    label: "Checked In",
    color: "text-green-700", bg: "bg-green-50 border-green-200",
    message: "You are inside the premises. Have a great visit!",
  },
  checked_out: {
    icon: <LogOut className="h-8 w-8 text-slate-500" />,
    label: "Visit Complete",
    color: "text-slate-600", bg: "bg-slate-50 border-slate-200",
    message: "Your visit has been completed. Thank you for visiting MAS Callnet.",
  },
  rejected: {
    icon: <ThumbsDown className="h-8 w-8 text-rose-600" />,
    label: "Not Approved",
    color: "text-rose-700", bg: "bg-rose-50 border-rose-200",
    message: "Your visit request was not approved. Please contact your host directly or reach out to the reception.",
  },
  cancelled: {
    icon: <AlertCircle className="h-8 w-8 text-slate-400" />,
    label: "Cancelled",
    color: "text-slate-600", bg: "bg-slate-50 border-slate-200",
    message: "This visit has been cancelled.",
  },
  expired: {
    icon: <AlertCircle className="h-8 w-8 text-slate-400" />,
    label: "Expired",
    color: "text-slate-600", bg: "bg-slate-50 border-slate-200",
    message: "This visit request has expired. Please re-register if you still need to visit.",
  },
};

/** Accepts a bare token or a full tracking URL pasted from the visitor's phone. */
export function extractToken(raw: string): string {
  const value = raw.trim();
  const fromUrl = value.match(/visitor-status\/([A-Za-z0-9]+)/);
  return (fromUrl ? fromUrl[1] : value).trim();
}

export default function VisitorStatusPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [visit, setVisit] = useState<PublicVisitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [checkoutRequested, setCheckoutRequested] = useState(false);
  const [lookup, setLookup] = useState("");

  const load = async (showLoader = true) => {
    // No token means the visitor reached /visitor-status directly (the register
    // page links here). Show the lookup form rather than a dead "invalid link".
    if (!token) { setLoading(false); return; }
    if (showLoader) setLoading(true);
    setError("");
    try {
      const data = await visitorApi.getPublicStatus(token);
      setVisit(data);
      if (data.checkout_requested_at) setCheckoutRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load visit status.");
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(false), 30_000);
    return () => clearInterval(interval);
  }, [token]);

  const requestCheckout = async () => {
    if (!token) return;
    setRequesting(true);
    try {
      await visitorApi.requestPublicCheckout(token);
      setCheckoutRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout request failed.");
    } finally {
      setRequesting(false);
    }
  };

  const cfg = visit ? (STATUS_CONFIG[visit.status] ?? STATUS_CONFIG.expired) : null;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center py-8 px-4">
      <div className="w-full max-w-md space-y-4">
        {/* Header */}
        <div className="text-center mb-2">
          <div className="mx-auto mb-3 inline-flex items-center justify-center rounded-2xl bg-white px-3.5 py-2 shadow-md">
            <img src="/mcn-logo.png" alt="MAS Callnet" className="h-7 w-auto" />
          </div>
          <h1 className="text-xl font-black text-slate-900">Visit Status</h1>
          {token && <p className="text-xs text-slate-400 mt-1">Auto-refreshes every 30 seconds</p>}
        </div>

        {/* No token: let the visitor look their visit up instead of dead-ending */}
        {!token && !loading && (
          <form
            onSubmit={(e) => { e.preventDefault(); const t = extractToken(lookup); if (t) navigate(`/visitor-status/${t}`); }}
            className="rounded-3xl bg-white shadow-sm p-6"
          >
            <div className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1B6AB5]/10 text-[#1B6AB5]">
              <Search className="h-5 w-5" />
            </div>
            <p className="font-black text-slate-900">Find your visit</p>
            <p className="mt-1 text-sm text-slate-500 leading-relaxed">
              Paste the tracking link you received after registering, or scan the QR code shown on your confirmation.
            </p>
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="Paste your tracking link"
              aria-label="Tracking link or token"
              className="mt-4 h-11 w-full rounded-xl border border-slate-200 px-3.5 text-sm font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-[#1B6AB5] focus:ring-4 focus:ring-[#1B6AB5]/12"
            />
            <button
              type="submit"
              disabled={!extractToken(lookup)}
              className="mt-3 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#1B6AB5] text-sm font-black text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Search className="h-4 w-4" />Check status
            </button>
          </form>
        )}

        {loading && (
          <div className="rounded-3xl bg-white shadow-sm p-10 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-[#1B6AB5]" />
            <p className="text-sm text-slate-500">Loading visit status…</p>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-3xl bg-white shadow-sm p-8 text-center">
            <AlertCircle className="mx-auto h-10 w-10 text-rose-400 mb-3" />
            <p className="font-bold text-slate-900">Visit not found</p>
            <p className="mt-1 text-sm text-slate-500">{error}</p>
            <button onClick={() => void load()} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 transition">
              <RefreshCcw className="h-4 w-4" />Retry
            </button>
          </div>
        )}

        {visit && cfg && !loading && (
          <>
            {/* Status card */}
            <div className={`rounded-3xl border p-6 ${cfg.bg}`}>
              <div className="flex items-center gap-4">
                <div className="shrink-0">{cfg.icon}</div>
                <div>
                  <p className={`text-lg font-black ${cfg.color}`}>{cfg.label}</p>
                  <p className="mt-1 text-sm text-slate-600">{cfg.message}</p>
                </div>
              </div>
            </div>

            {/* Visit info */}
            <div className="rounded-3xl bg-white shadow-sm p-6 space-y-4">
              <div className="rounded-2xl bg-slate-950 px-5 py-4 text-white">
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Visit Number</p>
                <p className="mt-1 text-2xl font-black tracking-wider">{visit.visit_number}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Visitor", visit.visitor_name],
                  ["Branch", visit.branch_name],
                  ["Host", visit.host_display_name || "Unassigned"],
                  ["Type", visit.visit_type.replace(/_/g, " ")],
                  ["Scheduled start", visitorDateTime(visit.scheduled_start)],
                  ["Scheduled end", visitorDateTime(visit.scheduled_end)],
                  ...(visit.checked_in_at ? [["Checked in", visitorDateTime(visit.checked_in_at)]] : []),
                  ...(visit.checked_out_at ? [["Checked out", visitorDateTime(visit.checked_out_at)]] : []),
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-100 p-3">
                    <p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="mt-1 text-sm font-semibold capitalize text-slate-800">{value}</p>
                  </div>
                ))}
              </div>
              {visit.purpose && (
                <div className="rounded-2xl border border-slate-100 p-3">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-400">Purpose</p>
                  <p className="mt-1 text-sm text-slate-700 leading-relaxed">{visit.purpose}</p>
                </div>
              )}
            </div>

            {/* Checkout request */}
            {visit.status === "checked_in" && (
              <div className="rounded-3xl bg-white shadow-sm p-5">
                {checkoutRequested ? (
                  <div className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
                    <Clock className="h-5 w-5 text-amber-600 shrink-0" />
                    <p className="text-sm font-semibold text-amber-800">Checkout request sent — the security desk has been notified.</p>
                  </div>
                ) : (
                  <button onClick={requestCheckout} disabled={requesting}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-900 bg-white py-3 text-sm font-black text-slate-900 hover:bg-slate-50 disabled:opacity-50 transition">
                    {requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                    {requesting ? "Requesting…" : "Request Check-out"}
                  </button>
                )}
              </div>
            )}

            {/* Refresh manually */}
            <button onClick={() => void load()} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 transition">
              <RefreshCcw className="h-4 w-4" />Refresh Status
            </button>
          </>
        )}

        <p className="text-center text-xs text-slate-400">
          New visit?{" "}
          <a href="/visitor-register" className="font-bold text-[#1B6AB5] underline">Register here</a>
        </p>
      </div>
    </div>
  );
}
