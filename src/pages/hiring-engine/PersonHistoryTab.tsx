/**
 * Person history: type a mobile number to see whether the person is a fresh or a repeat approach, how many times we have contacted them,
 * for which requisitions, and how many times we actually connected. Read-only. Branch users see only their own branch's requisitions.
 */
import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface Req { requisitionId: string | null; code: string; contacts: number; connected: number; lastAt: string | null }
interface History { mobile: string; type: "fresh" | "repeat"; approachNo: number; priorContacts: number; timesConnected: number; requisitions: Req[]; label: string; scoped: boolean }

const FIELD = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:min-h-9";
const CARD = "rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900";

export default function PersonHistoryTab() {
  const [mobile, setMobile] = useState("");
  const [data, setData] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    const digits = mobile.replace(/\D/g, "").slice(-10);
    if (digits.length !== 10) { setErr("Enter a 10 digit mobile number"); setData(null); return; }
    setBusy(true); setErr(null);
    try {
      const r = await hrmsApi.get<{ data?: History }>(`/he/person-history?mobile=${digits}`);
      setData(r?.data ?? null);
    } catch { setErr("Could not load the history. Try again."); setData(null); } finally { setBusy(false); }
  };

  return (
    <section className="space-y-4" aria-label="Person history">
      <form onSubmit={search} className={`${CARD} flex flex-col gap-3 sm:flex-row sm:items-end`}>
        <div className="min-w-0 flex-1 space-y-0.5">
          <label htmlFor="ph-mobile" className="text-xs font-semibold text-slate-700 dark:text-slate-200">Mobile number</label>
          <input id="ph-mobile" inputMode="numeric" autoComplete="off" className={FIELD} value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="10 digit mobile" />
        </div>
        <button type="submit" disabled={busy} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 sm:min-h-9">
          <Search className="h-4 w-4" aria-hidden /> {busy ? "Searching…" : "Look up"}
        </button>
      </form>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      {data && (
        <div className="space-y-3">
          <div className={`${CARD} flex flex-wrap items-center gap-x-6 gap-y-2`}>
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${data.type === "fresh" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
              {data.type === "fresh" ? "Fresh approach" : `Repeat approach #${data.approachNo}`}
            </span>
            <span className="text-sm text-slate-700 dark:text-slate-200">Mobile {data.mobile}</span>
            <span className="text-sm text-slate-700 dark:text-slate-200"><b className="tabular-nums">{data.priorContacts}</b> earlier contacts</span>
            <span className="text-sm text-slate-700 dark:text-slate-200"><b className="tabular-nums">{data.timesConnected}</b> times connected</span>
            {data.scoped && <span className="text-xs text-slate-500">Showing your branch only</span>}
          </div>
          <div className={CARD}>
            <h2 className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">Requisitions tried</h2>
            {data.requisitions.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">No earlier contact on record.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-slate-200 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"><th className="py-1.5 pr-4">Requisition</th><th className="py-1.5 pr-4">Contacts</th><th className="py-1.5 pr-4">Connected</th><th className="py-1.5">Last tried</th></tr></thead>
                  <tbody>
                    {data.requisitions.map((r) => (
                      <tr key={r.requisitionId ?? r.code} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-1.5 pr-4 font-medium text-slate-900 dark:text-slate-100">{r.code || "(no requisition)"}</td>
                        <td className="py-1.5 pr-4 tabular-nums">{r.contacts}</td>
                        <td className="py-1.5 pr-4 tabular-nums">{r.connected}</td>
                        <td className="py-1.5 tabular-nums text-slate-600 dark:text-slate-300">{r.lastAt || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
