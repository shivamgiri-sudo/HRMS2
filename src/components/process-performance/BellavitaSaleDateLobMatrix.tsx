import { useEffect, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Table2 } from "lucide-react";
import { Spinner, formatINR } from "./DashboardKit";

/**
 * Date-wise, LOB-wise Sale/Revenue split by COD vs Paid -- the matrix from
 * the reference sheet the user supplied (Repeat Customer / Chat / Inbound /
 * Abandon Cart, each COD | Paid | Grand Total, plus an Overall Sale
 * Performance block, an RTO/RTD block and a Net Sale Amount block, one row
 * per date). Backed by GET .../bellavita-sale-dashboard/date-lob-matrix,
 * which reuses the exact same DEDUPED_SALE_SQL as the LOB-wise Performance
 * table above it, so the two can never disagree.
 *
 * COD% / Paid% are added per LOB block (not in the original reference
 * layout) per explicit request -- computed from that LOB's own COD/Paid
 * sale counts for the date, same formula the LOB-wise Performance table
 * already uses for its single-period COD%/Paid%.
 */

interface Block { codSale: number; codRevenue: number; paidSale: number; paidRevenue: number; totalSale: number; totalRevenue: number; codPct: number; paidPct: number }
interface MatrixRow { date: string; lobs: Record<string, Block>; overall: Block; rtoCount: number; rtoRevenue: number; netSaleCount: number; netSaleRevenue: number }
interface MatrixData { from: string; to: string; lobOrder: string[]; rows: MatrixRow[]; grandTotal: MatrixRow }

const LOB_TONE: Record<string, { head: string; sub: string }> = {
  Repeat: { head: "bg-sky-700", sub: "bg-sky-50" },
  Chat: { head: "bg-violet-700", sub: "bg-violet-50" },
  "Abandon Cart": { head: "bg-rose-700", sub: "bg-rose-50" },
  Inbound: { head: "bg-amber-700", sub: "bg-amber-50" },
};
const DEFAULT_TONE = { head: "bg-slate-700", sub: "bg-slate-50" };
const OVERALL_TONE = { head: "bg-indigo-800", sub: "bg-indigo-50" };
const RTO_TONE = { head: "bg-red-700", sub: "bg-red-50" };
const NET_TONE = { head: "bg-emerald-700", sub: "bg-emerald-50" };

const th = "border border-slate-200 px-2 py-1.5 font-semibold whitespace-nowrap";
const td = "border border-slate-200 px-2 py-1.5 text-right whitespace-nowrap";

function fmtDate(iso: string): string {
  if (iso === "Grand Total") return iso;
  const [y, m, d] = iso.split("-");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)}-${MON[Number(m) - 1]}-${y.slice(2)}`;
}

function BlockCells({ b }: { b: Block }) {
  return (
    <>
      <td className={td}>{b.codSale.toLocaleString("en-IN")}</td>
      <td className={td}>{formatINR(b.codRevenue)}</td>
      <td className={td}>{b.paidSale.toLocaleString("en-IN")}</td>
      <td className={td}>{formatINR(b.paidRevenue)}</td>
      <td className={`${td} font-semibold`}>{b.totalSale.toLocaleString("en-IN")}</td>
      <td className={`${td} font-semibold`}>{formatINR(b.totalRevenue)}</td>
      <td className={td}>{b.codPct}%</td>
      <td className={td}>{b.paidPct}%</td>
    </>
  );
}

function BlockGroupHeader({ label, tone, colSpan = 8 }: { label: string; tone: { head: string }; colSpan?: number }) {
  return <th className={`border border-slate-200 px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-white ${tone.head}`} colSpan={colSpan}>{label}</th>;
}
function BlockSubHeader({ tone, full = false }: { tone: { sub: string }; full?: boolean }) {
  if (full) {
    return (
      <>
        <th className={`${th} text-center ${tone.sub}`} colSpan={2}>COD</th>
        <th className={`${th} text-center ${tone.sub}`} colSpan={2}>Paid</th>
        <th className={`${th} text-center ${tone.sub}`} colSpan={2}>Grand Total</th>
        <th className={`${th} text-center ${tone.sub}`} colSpan={2}>%</th>
      </>
    );
  }
  return <th className={`${th} text-center ${tone.sub}`} colSpan={2}>Grand Total</th>;
}
function BlockLeafHeader({ full = false }: { full?: boolean }) {
  if (full) {
    return (
      <>
        <th className={th}>Sale</th><th className={th}>Revenue</th>
        <th className={th}>Sale</th><th className={th}>Revenue</th>
        <th className={th}>Sale</th><th className={th}>Revenue</th>
        <th className={th}>COD%</th><th className={th}>Paid%</th>
      </>
    );
  }
  return <><th className={th}>Sale</th><th className={th}>Revenue</th></>;
}

export function BellavitaSaleDateLobMatrix({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    hrmsApi
      .get<{ success: boolean; data: MatrixData }>(`/api/process-performance/bellavita-sale-dashboard/date-lob-matrix?from=${from}&to=${to}`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the date-wise LOB matrix."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <Table2 className="h-4 w-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Date-wise LOB Performance</p>
      </div>
      <p className="mb-3 text-[11px] text-slate-400">
        Sale count and revenue by payment type, per LOB and per date. "RTO , RTD" reports RTO only -- this app's data carries one return-status
        flag (final_status = 'RTO'), no separate RTD value exists to break out.
      </p>
      {loading && !data && <Spinner tone="blue" />}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {data && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="border-collapse text-center text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border border-slate-200 bg-slate-800 px-3 py-1.5 text-white" rowSpan={3}>Date</th>
                {data.lobOrder.map((lob) => <BlockGroupHeader key={lob} label={lob} tone={LOB_TONE[lob] ?? DEFAULT_TONE} />)}
                <BlockGroupHeader label="Overall Sale Performance" tone={OVERALL_TONE} />
                <BlockGroupHeader label="RTO , RTD & Revenue" tone={RTO_TONE} colSpan={2} />
                <BlockGroupHeader label="Net Sale Amount" tone={NET_TONE} colSpan={2} />
              </tr>
              <tr>
                {data.lobOrder.map((lob) => <BlockSubHeader key={lob} tone={LOB_TONE[lob] ?? DEFAULT_TONE} full />)}
                <BlockSubHeader tone={OVERALL_TONE} full />
                <BlockSubHeader tone={RTO_TONE} />
                <BlockSubHeader tone={NET_TONE} />
              </tr>
              <tr>
                {data.lobOrder.map((lob) => <BlockLeafHeader key={`${lob}-leaf`} full />)}
                <BlockLeafHeader full />
                <BlockLeafHeader />
                <BlockLeafHeader />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.date} className={i % 2 === 1 ? "bg-slate-50/60" : "bg-white"}>
                  <td className="sticky left-0 z-10 border border-slate-200 bg-inherit px-3 py-1.5 text-left font-medium text-slate-700">{fmtDate(r.date)}</td>
                  {data.lobOrder.map((lob) => <BlockCells key={lob} b={r.lobs[lob] ?? { codSale: 0, codRevenue: 0, paidSale: 0, paidRevenue: 0, totalSale: 0, totalRevenue: 0, codPct: 0, paidPct: 0 }} />)}
                  <BlockCells b={r.overall} />
                  <td className={td}>{r.rtoCount.toLocaleString("en-IN")}</td>
                  <td className={td}>{formatINR(r.rtoRevenue)}</td>
                  <td className={td}>{r.netSaleCount.toLocaleString("en-IN")}</td>
                  <td className={td}>{formatINR(r.netSaleRevenue)}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr><td colSpan={1 + data.lobOrder.length * 8 + 8 + 2 + 2} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className="bg-amber-50 font-bold text-slate-800">
                  <td className="sticky left-0 z-10 border border-slate-200 bg-amber-50 px-3 py-1.5 text-left">G. Total</td>
                  {data.lobOrder.map((lob) => <BlockCells key={lob} b={data.grandTotal.lobs[lob] ?? { codSale: 0, codRevenue: 0, paidSale: 0, paidRevenue: 0, totalSale: 0, totalRevenue: 0, codPct: 0, paidPct: 0 }} />)}
                  <BlockCells b={data.grandTotal.overall} />
                  <td className={td}>{data.grandTotal.rtoCount.toLocaleString("en-IN")}</td>
                  <td className={td}>{formatINR(data.grandTotal.rtoRevenue)}</td>
                  <td className={td}>{data.grandTotal.netSaleCount.toLocaleString("en-IN")}</td>
                  <td className={td}>{formatINR(data.grandTotal.netSaleRevenue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
