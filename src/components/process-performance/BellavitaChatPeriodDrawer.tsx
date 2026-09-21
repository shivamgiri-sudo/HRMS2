import { useEffect, useState, type ReactNode } from "react";
import { X, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatINR } from "./DashboardKit";
import { fmtDate, fmtN } from "./lpCallShared";

export interface PeriodTarget { label: string; from: string; to: string }

interface Integrity {
  saleRows: number; uniqueOrders: number; duplicateRows: number;
  grossRevenue: number; revenue: number; duplicateRevenue: number; blankOrderIdRows: number;
}
interface PeriodDetail {
  from: string; to: string; userType: string;
  byUserType: Array<{ userType: string; overall: number; unique: number; frtPct: number; repeat24: number }>;
  byTl: Array<{ tlName: string; overall: number; unique: number; frtPct: number }>;
  byAgent: Array<{ agent: string; empId: string; overall: number; unique: number; frtPct: number }>;
  integrity: Integrity | null;
  duplicateOrders: Array<{ orderId: string; date: string; amount: number; rows: number; extraRevenue: number }>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </section>
  );
}
const None = () => <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold tracking-tight text-slate-800">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function SimpleTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 font-semibold ${i === 0 ? "" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function BellavitaChatPeriodDrawer({
  apiPath, target, userType, onClose,
}: { apiPath: string; target: PeriodTarget; userType: string; onClose: () => void }) {
  const [data, setData] = useState<PeriodDetail | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    hrmsApi
      .get<{ success: boolean; data: PeriodDetail }>(
        `${apiPath}/overview/detail?from=${target.from}&to=${target.to}&userType=${encodeURIComponent(userType)}`,
      )
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the detail."); });
    return () => { cancelled = true; };
  }, [apiPath, target.from, target.to, userType]);

  const range = target.from === target.to ? fmtDate(target.from) : `${fmtDate(target.from)} to ${fmtDate(target.to)}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${target.label} detail`}>
      <button
        type="button" aria-label="Close detail" onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <aside className={`relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-start justify-between gap-3 bg-gradient-to-br from-rose-600 via-pink-600 to-rose-700 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">Bellavita Chat · {userType}</p>
            <h3 className="truncate text-lg font-bold">{target.label}</h3>
            <p className="mt-0.5 text-[11px] text-white/80">{range}</p>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="rounded-lg p-1.5 text-white/85 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {!data && !error && (
            <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
          {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          {data && (
            <>
              <Section title="By user type">
                {data.byUserType.length === 0 ? <None /> : (
                  <SimpleTable head={["User type", "Chats", "Unique", "FRT %", "Repeat 24h"]}>
                    {data.byUserType.map((r) => (
                      <tr key={r.userType} className="border-t border-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-700">{r.userType}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.overall)}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.unique)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">{r.frtPct}%</td>
                        <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.repeat24)}</td>
                      </tr>
                    ))}
                  </SimpleTable>
                )}
              </Section>

              <Section title="Order integrity (bella_vita_order_id)">
                {!data.integrity ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
                    Not available for this user type — the sales table has no Kenaz/Bevzilla split.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Stat label="Sale rows" value={fmtN(data.integrity.saleRows)} sub="one per line item" />
                      <Stat label="Unique orders" value={fmtN(data.integrity.uniqueOrders)} sub="counted as sales" />
                      <Stat label="Duplicate rows" value={fmtN(data.integrity.duplicateRows)} sub="ignored" />
                      <Stat label="Revenue (unique)" value={formatINR(data.integrity.revenue)} sub="one amount per order" />
                      <Stat label="Duplicate revenue" value={formatINR(data.integrity.duplicateRevenue)} sub="excluded" />
                      <Stat label="Without order id" value={fmtN(data.integrity.blankOrderIdRows)} sub="can't be de-duplicated" />
                    </div>
                    {data.duplicateOrders.length === 0 ? <None /> : (
                      <SimpleTable head={["Order id", "Date", "Amount", "Rows", "Extra revenue"]}>
                        {data.duplicateOrders.map((o) => (
                          <tr key={o.orderId} className="border-t border-slate-50">
                            <td className="px-3 py-2 font-medium text-slate-700">{o.orderId}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{fmtDate(o.date)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{formatINR(o.amount)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-800">{o.rows}</td>
                            <td className="px-3 py-2 text-right text-rose-600">{formatINR(o.extraRevenue)}</td>
                          </tr>
                        ))}
                      </SimpleTable>
                    )}
                  </div>
                )}
              </Section>

              <Section title="TL-wise">
                {data.byTl.length === 0 ? <None /> : (
                  <SimpleTable head={["TL", "Chats", "Unique", "FRT %"]}>
                    {data.byTl.map((r) => (
                      <tr key={r.tlName} className="border-t border-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-700">{r.tlName}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.overall)}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.unique)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">{r.frtPct}%</td>
                      </tr>
                    ))}
                  </SimpleTable>
                )}
              </Section>

              <Section title="Agent-wise">
                {data.byAgent.length === 0 ? <None /> : (
                  <SimpleTable head={["Agent", "Chats", "Unique", "FRT %"]}>
                    {data.byAgent.map((r) => (
                      <tr key={`${r.empId}-${r.agent}`} className="border-t border-slate-50">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-700">{r.agent}</div>
                          <div className="text-[10px] text-slate-400">{r.empId || "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.overall)}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.unique)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">{r.frtPct}%</td>
                      </tr>
                    ))}
                  </SimpleTable>
                )}
              </Section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
