import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Truck, Phone, PackageCheck, MapPin, Users, TrendingUp, X, Building2, Gauge, Clock, Route, AlertTriangle, Info,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardHero, DashboardExportMenu, type ExportSlide } from "./DashboardKit";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

/**
 * AHM -- a telesales-to-delivery operation (survey/order taken by phone, fulfilled by a
 * delivery agent). The ops team already produces six separate workbooks for this process; this
 * page is their live replacement, ONE SLIDE PER WORKBOOK, all reading from the same
 * db_masmis.ahm_dump_raw (see ahm-dashboard.service.ts for exactly what each KPI means):
 *
 *   DPTS Mumbai Branch ............ "DPTS" tab
 *   GPI Daily Performance Tracker .. "GPI Performance" tab
 *   Hourly Order Taken Report ...... "Hourly Order Taken" tab
 *   Maharashtra Order vs Delivery .. "Maharashtra" tab (zone LIKE 'MH%')
 *   Order vs Delivery -- Mumbai Metro "Mumbai Metro" tab (zone LIKE 'MM%')
 *   Max Disposition Week ........... "Max Disposition" tab
 *
 * Two of those workbooks' own KPIs (GPI's EC%/PC%/Lines Cut/Incoming%, and DPTS's NBO
 * Billed/Unbilled roster) need a call-attempt log and an outlet-billing master this upload does
 * not carry -- their tabs say so plainly rather than inventing a number.
 *
 * A persistent header above the tabs carries the headline KPIs and filters, so switching
 * slides never loses the big picture. Status color (delivered/critical/warning) is reserved for
 * state, never reused as a 4th series color; a single accent (amber -- "order in motion") carries
 * every plain magnitude bar.
 */

type TabKey = "dpts" | "gpi" | "hourly" | "orderDelivery" | "maxDispo";
type Region = "ALL" | "MP" | "MM";

interface Headline {
  outlets: number; orders: number;
  orderQty: number; orderOfferQty: number; salesQty: number; salesOfferQty: number;
  orderValue: number; salesValue: number; gapQty: number; gapPct: number;
  delivered: number; deliveredPct: number; telesalesAgents: number; deliveryAgents: number;
}
interface StatusRow { status: string; orders: number; pct: number }
interface DispositionRow { disposition: string; orders: number; pct: number }
interface HourRow { hour: number; orders: number; orderQty: number; delivered: number }
interface DailyRow { date: string; orders: number; orderQty: number; salesQty: number; gapPct: number; deliveredPct: number }
interface GroupRow { name: string; orders: number; outlets: number; orderQty: number; salesQty: number; gapPct: number; deliveredPct: number }
interface AgentRow { agent: string; outlets: number; orders: number; orderQty: number; salesQty: number; deliveredPct: number }
interface ProductRow { name: string; orderQty: number; salesQty: number; orders: number }
interface HourDispositionRow { hour: number; disposition: string; orders: number }
interface ZoneDispositionRow { zone: string; disposition: string; orders: number }

interface DashboardData {
  from: string; to: string; region: "MP" | "MM" | null;
  headline: Headline;
  statuses: StatusRow[];
  dispositions: DispositionRow[];
  hourly: HourRow[];
  daily: DailyRow[];
  byZone: GroupRow[];
  byTown: GroupRow[];
  byTelesales: AgentRow[];
  byDeliveredBy: AgentRow[];
  byFranchise: ProductRow[];
  byCategory: ProductRow[];
  hourlyDisposition: HourDispositionRow[];
  zoneDisposition: ZoneDispositionRow[];
  dataAvailable: boolean;
}

type DetailKind = "telesales" | "deliveredBy" | "zone" | "town";
interface DetailRow {
  id: string; sales_no: string; survey_date: string | null; outlet_id: string; outlet_name: string | null;
  product_sku: string | null; survey_qty: number; sales_qty: number; sku_mrp: number | null;
  last_status: string | null; last_disposition_status: string | null; delivered_by: string | null;
  telesales_id: string | null; zone: string | null; city_town: string | null;
}
interface Detail {
  kind: DetailKind; key: string; counts: GroupRow;
  daily: DailyRow[]; dispositions: DispositionRow[];
  rows: DetailRow[]; rowsTotal: number;
}

const PALETTE = {
  canvas: "#FDF6EC", card: "#FFFFFF", ink: "#241A10", muted: "#8A7A68", line: "#EBDFCF",
  good: "#0E9F8E", critical: "#DC2626", warning: "#D97706", order: "#7C8DB5", sales: "#B45309",
};
const ACCENT = "#B45309";
const ACCENT_SOFT = "#FDE9D2";

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap");
.ahm-root{--canvas:${PALETTE.canvas};--ink:${PALETTE.ink};--muted:${PALETTE.muted};--line:${PALETTE.line};--accent:${ACCENT};
  font-family:"Inter",ui-sans-serif,system-ui,sans-serif;color:var(--ink);background:var(--canvas);border-radius:18px;padding:12px;position:relative}
.ahm-root *{box-sizing:border-box}
.ahm-eyebrow{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.ahm-card{background:${PALETTE.card};border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:0 1px 0 rgba(36,26,16,.03),0 8px 20px -16px rgba(36,26,16,.2)}
.ahm-tiles{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(132px,1fr))}
.ahm-tile{background:${PALETTE.card};border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:4px}
.ahm-val{font-size:19px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.ahm-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}
.ahm-table th{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:right;padding:7px 9px;border-bottom:1px solid var(--line);background:#FBF2E3;position:sticky;top:0}
.ahm-table th:first-child,.ahm-table td:first-child{text-align:left}
.ahm-table td{padding:7px 9px;text-align:right;border-bottom:1px solid #F3E9D6;font-variant-numeric:tabular-nums;color:#4A3B2A}
.ahm-row{cursor:pointer;transition:background .15s ease}
.ahm-row:hover{background:#FBF2E3}
.ahm-bar-track{height:8px;border-radius:999px;background:#F3E9D6;overflow:hidden;flex:1}
.ahm-bar-fill{display:block;height:100%;border-radius:999px}
.ahm-slot{height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;font-variant-numeric:tabular-nums}
.ahm-slot-empty{background:#F3E9D6;color:#B8A98E}
.ahm-section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94A3B8;margin:0 0 8px}
.ahm-banner{display:flex;gap:10px;align-items:flex-start;border:1px solid #FDE68A;background:#FFFBEB;border-radius:12px;padding:10px 14px;font-size:12px;color:#92400E;margin-bottom:14px}
.ahm-slide-head{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.ahm-slide-icon{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:${ACCENT_SOFT};color:${ACCENT};flex-shrink:0}
.ahm-drawer-backdrop{position:fixed;inset:0;background:rgba(36,26,16,.45);z-index:60;transition:opacity .2s ease}
.ahm-drawer{position:fixed;top:0;right:0;height:100vh;width:100%;max-width:42rem;background:#fff;z-index:61;box-shadow:-20px 0 60px -20px rgba(0,0,0,.35);transition:transform .25s ease;display:flex;flex-direction:column}
`;

const int = (n: number) => new Intl.NumberFormat("en-IN").format(Math.round(n || 0));
const inr = (n: number) => `₹${new Intl.NumberFormat("en-IN").format(Math.round(n || 0))}`;
const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const dayLabel = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
const statusColor = (deliveredPct: number) => (deliveredPct >= 70 ? PALETTE.good : deliveredPct >= 40 ? PALETTE.warning : PALETTE.critical);

function defaultRange() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "dpts", label: "DPTS" },
  { key: "gpi", label: "GPI Performance" },
  { key: "hourly", label: "Hourly Order Taken" },
  { key: "orderDelivery", label: "Order vs Delivery" },
  { key: "maxDispo", label: "Max Disposition" },
];

function NotAvailableBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="ahm-banner">
      <Info className="h-4 w-4 shrink-0" style={{ marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

function SlideHead({ icon: Icon, title, sub }: { icon: typeof Building2; title: string; sub: string }) {
  return (
    <div className="ahm-slide-head">
      <span className="ahm-slide-icon"><Icon className="h-4 w-4" /></span>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{title}</p>
        <p style={{ margin: 0, fontSize: 11, color: PALETTE.muted }}>{sub}</p>
      </div>
    </div>
  );
}

/* --------------------------------- Drill-down drawer --------------------------------- */

function AhmDetailDrawer({ kind, dataKey, from, to, region, onClose }: { kind: DetailKind; dataKey: string; from: string; to: string; region: Region; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [shown, setShown] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  useEffect(() => {
    let alive = true;
    setDetail(null); setErr("");
    const regionQ = region === "ALL" ? "" : `&region=${region}`;
    hrmsApi.get<{ success: boolean; data: Detail }>(`/api/process-performance/ahm/detail?kind=${kind}&key=${encodeURIComponent(dataKey)}&from=${from}&to=${to}${regionQ}`)
      .then((res) => { if (alive) setDetail(res.data); })
      .catch(() => { if (alive) setErr("Could not load this record."); });
    return () => { alive = false; };
  }, [kind, dataKey, from, to, region]);

  const close = () => { setShown(false); setTimeout(onClose, 200); };
  const kindLabel = kind === "telesales" ? "Telesales agent" : kind === "deliveredBy" ? "Delivery partner" : kind === "zone" ? "Zone" : "Town";

  return (
    <>
      <div className="ahm-drawer-backdrop" style={{ opacity: shown ? 1 : 0 }} onClick={close} />
      <div className="ahm-drawer" style={{ transform: shown ? "translateX(0)" : "translateX(100%)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p className="ahm-eyebrow">{kindLabel}</p>
            <h3 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 700 }}>{dataKey}</h3>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#64748B" }}>{from} to {to}</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" style={{ border: "none", background: "#F1F5F9", borderRadius: 8, padding: 6, cursor: "pointer" }}><X className="h-4 w-4" /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {err && <p style={{ color: "#DC2626", fontSize: 13 }}>{err}</p>}
          {!detail && !err && <p style={{ color: "#94A3B8", fontSize: 13 }}>Loading…</p>}
          {detail && (
            <>
              <p className="ahm-section-label">Summary</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
                {([["Orders", int(detail.counts.orders)], ["Outlets", int(detail.counts.outlets)], ["Order Qty", int(detail.counts.orderQty)],
                  ["Sales Qty", int(detail.counts.salesQty)], ["Gap %", `${detail.counts.gapPct}%`], ["Delivered %", `${detail.counts.deliveredPct}%`]] as const).map(([label, value]) => (
                  <div key={label} style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: "8px 10px" }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
                    <div style={{ fontSize: 10, color: "#94A3B8" }}>{label}</div>
                  </div>
                ))}
              </div>

              <p className="ahm-section-label">Disposition split</p>
              {detail.dispositions.length === 0 ? <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 18 }}>None</p> : (
                <div style={{ marginBottom: 18 }}>
                  {detail.dispositions.slice(0, 8).map((d) => (
                    <div key={d.disposition} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: 12 }}>
                      <span style={{ width: 130, flexShrink: 0, color: "#475569" }}>{d.disposition}</span>
                      <div className="ahm-bar-track"><span className="ahm-bar-fill" style={{ width: `${d.pct}%`, background: d.disposition === "Survey Taken" ? PALETTE.good : PALETTE.warning }} /></div>
                      <span style={{ width: 60, textAlign: "right", color: "#64748B" }}>{int(d.orders)} ({d.pct}%)</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="ahm-section-label">Daily trend</p>
              {detail.daily.length === 0 ? <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 18 }}>None</p> : (
                <table className="ahm-table" style={{ marginBottom: 18 }}>
                  <thead><tr><th>Date</th><th>Orders</th><th>Order Qty</th><th>Sales Qty</th><th>Gap %</th><th>Delivered %</th></tr></thead>
                  <tbody>
                    {detail.daily.map((d) => (
                      <tr key={d.date}><td>{dayLabel(d.date)}</td><td>{int(d.orders)}</td><td>{int(d.orderQty)}</td><td>{int(d.salesQty)}</td><td>{d.gapPct}%</td><td>{d.deliveredPct}%</td></tr>
                    ))}
                  </tbody>
                </table>
              )}

              <p className="ahm-section-label">Order lines ({int(detail.rowsTotal)} total, showing up to 200)</p>
              <div style={{ overflowX: "auto" }}>
                <table className="ahm-table">
                  <thead><tr><th>Sales No</th><th>Survey Date</th><th>Outlet</th><th>SKU</th><th>Order Qty</th><th>Sales Qty</th><th>Status</th><th>Disposition</th></tr></thead>
                  <tbody>
                    {detail.rows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ textAlign: "left" }}>{r.sales_no}</td><td>{fmtDate(r.survey_date)}</td>
                        <td style={{ textAlign: "left" }}>{r.outlet_name || r.outlet_id}</td><td style={{ textAlign: "left" }}>{r.product_sku || "—"}</td>
                        <td>{int(r.survey_qty)}</td><td>{int(r.sales_qty)}</td><td>{r.last_status || "—"}</td><td>{r.last_disposition_status || "—"}</td>
                      </tr>
                    ))}
                    {detail.rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "#94A3B8" }}>None</td></tr>}
                  </tbody>
                </table>
              </div>

              <p className="ahm-section-label" style={{ marginTop: 18 }}>Workflow timeline</p>
              <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 18 }}>None — this is a raw uploaded order record, not a workflow.</p>
              <p className="ahm-section-label">Documents</p>
              <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 18 }}>None</p>
              <p className="ahm-section-label">Audit trail</p>
              <p style={{ fontSize: 12, color: "#94A3B8" }}>None</p>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* --------------------------------- Small building blocks --------------------------------- */

function RankedBars({ rows, labelKey, valueKey, pctKey, highlightFirst }: { rows: Array<Record<string, string | number>>; labelKey: string; valueKey: string; pctKey: string; highlightFirst?: boolean }) {
  if (rows.length === 0) return <p style={{ fontSize: 12, color: PALETTE.muted }}>No data for this range.</p>;
  return (
    <div>
      {rows.map((r, i) => (
        <div key={String(r[labelKey])} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 12 }}>
          <span style={{ width: 170, flexShrink: 0, color: "#4A3B2A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(r[labelKey])}</span>
          <div className="ahm-bar-track"><span className="ahm-bar-fill" style={{ width: `${r[pctKey]}%`, background: highlightFirst && i === 0 ? PALETTE.good : ACCENT }} /></div>
          <span style={{ width: 90, textAlign: "right", color: "#8A7A68" }}>{int(Number(r[valueKey]))} ({Number(r[pctKey]).toFixed(0)}%)</span>
        </div>
      ))}
    </div>
  );
}

function GroupTable({ rows, onOpen, nameHeader = "Name" }: { rows: GroupRow[]; onOpen: (name: string) => void; nameHeader?: string }) {
  return (
    <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
      <table className="ahm-table">
        <thead><tr><th>{nameHeader}</th><th>Outlets</th><th>Orders</th><th>Order Qty</th><th>Sales Qty</th><th>Gap %</th><th>Delivered %</th><th>Not Delivered %</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="ahm-row" onClick={() => onOpen(r.name)}>
              <td style={{ textAlign: "left", fontWeight: 600 }}>{r.name}</td><td>{int(r.outlets)}</td><td>{int(r.orders)}</td>
              <td>{int(r.orderQty)}</td><td>{int(r.salesQty)}</td><td>{r.gapPct}%</td>
              <td style={{ color: statusColor(r.deliveredPct), fontWeight: 700 }}>{r.deliveredPct}%</td>
              <td style={{ color: statusColor(100 - r.deliveredPct) }}>{(100 - r.deliveredPct).toFixed(1)}%</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: PALETTE.muted }}>No data for this range.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function AgentTable({ rows, onOpen }: { rows: AgentRow[]; onOpen: (agent: string) => void }) {
  return (
    <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
      <table className="ahm-table">
        <thead><tr><th>Agent</th><th>Outlets</th><th>Orders</th><th>Order Qty</th><th>Sales Qty</th><th>Delivered %</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agent} className="ahm-row" onClick={() => onOpen(r.agent)}>
              <td style={{ textAlign: "left", fontWeight: 600 }}>{r.agent}</td><td>{int(r.outlets)}</td><td>{int(r.orders)}</td>
              <td>{int(r.orderQty)}</td><td>{int(r.salesQty)}</td>
              <td style={{ color: statusColor(r.deliveredPct), fontWeight: 700 }}>{r.deliveredPct}%</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: PALETTE.muted }}>No data for this range.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function KpiTiles({ h }: { h: Headline }) {
  const tiles: Array<[string, string, typeof Phone]> = [
    ["Orders Taken", int(h.orders), Phone],
    ["Outlets Surveyed", int(h.outlets), MapPin],
    ["Order Qty", int(h.orderQty), TrendingUp],
    ["Sales Qty", int(h.salesQty), PackageCheck],
    ["Gap %", `${h.gapPct}%`, AlertTriangle],
    ["Delivered %", `${h.deliveredPct}%`, PackageCheck],
    ["Order Value", inr(h.orderValue), TrendingUp],
    ["Telesales Agents", int(h.telesalesAgents), Users],
    ["Delivery Agents", int(h.deliveryAgents), Truck],
  ];
  return (
    <div className="ahm-tiles">
      {tiles.map(([label, value, Icon]) => (
        <div key={label} className="ahm-tile">
          <span className="ahm-eyebrow" style={{ display: "flex", alignItems: "center", gap: 4 }}><Icon className="h-3 w-3" /> {label}</span>
          <span className="ahm-val">{value}</span>
        </div>
      ))}
    </div>
  );
}

function DailyTrendChart({ daily }: { daily: DailyRow[] }) {
  return (
    <div style={{ height: 230 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={daily.map((d) => ({ ...d, label: dayLabel(d.date) }))}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F3E9D6" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: PALETTE.muted }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: PALETTE.muted }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #EBDFCF" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="orderQty" name="Order Qty" fill={PALETTE.order} radius={[4, 4, 0, 0]} />
          <Bar dataKey="salesQty" name="Sales Qty" fill={PALETTE.sales} radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="deliveredPct" name="Delivered %" stroke={PALETTE.good} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* --------------------------------- Main component --------------------------------- */

export function AhmDashboard() {
  const dr = defaultRange();
  const [from, setFrom] = useState(dr.from);
  const [to, setTo] = useState(dr.to);
  const [region, setRegion] = useState<Region>("ALL");
  const [tab, setTab] = useState<TabKey>("dpts");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<{ kind: DetailKind; key: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    const regionQ = region === "ALL" ? "" : `&region=${region}`;
    hrmsApi.get<{ success: boolean; data: DashboardData }>(`/api/process-performance/ahm/dashboard?from=${from}&to=${to}${regionQ}`)
      .then((res) => { if (alive) { setData(res.data); setLoading(false); } })
      .catch(() => { if (alive) { setError("Could not load the AHM dashboard."); setLoading(false); } });
    return () => { alive = false; };
  }, [from, to, region]);

  const exportSlides: ExportSlide[] = useMemo(() => {
    if (!data) return [];
    const h = data.headline;
    const slides: ExportSlide[] = [
      {
        title: "DPTS",
        kpis: [
          { label: "Outlets Surveyed", value: int(h.outlets) }, { label: "Orders Taken", value: int(h.orders) },
          { label: "Order Value", value: inr(h.orderValue) }, { label: "Delivered %", value: `${h.deliveredPct}%` },
        ],
        tables: [{ title: "Town-wise", columns: ["Town", "Outlets", "Orders", "Order Qty", "Sales Qty", "Delivered %"], rows: data.byTown.map((r) => [r.name, r.outlets, r.orders, r.orderQty, r.salesQty, `${r.deliveredPct}%`]) }],
      },
      { title: "GPI Performance", tables: [{ title: "Town-wise Order vs Delivery", columns: ["Town", "Orders", "Order Qty", "Sales Qty", "Gap %", "Delivered %"], rows: data.byTown.map((r) => [r.name, r.orders, r.orderQty, r.salesQty, `${r.gapPct}%`, `${r.deliveredPct}%`]) }] },
      { title: "Hourly Order Taken", tables: [{ title: "Hour-wise", columns: ["Hour", "Orders", "Order Qty", "Delivered"], rows: data.hourly.map((hh) => [`${hh.hour}:00`, hh.orders, hh.orderQty, hh.delivered]) }] },
      { title: "Max Disposition", tables: [{ title: "Disposition breakdown", columns: ["Disposition", "Orders", "%"], rows: data.dispositions.map((d) => [d.disposition, d.orders, `${d.pct}%`]) }] },
    ];
    return slides;
  }, [data]);

  const activeSlideTitle = useMemo(() => {
    const map: Record<TabKey, string> = {
      dpts: "DPTS", gpi: "GPI Performance", hourly: "Hourly Order Taken",
      orderDelivery: "Order vs Delivery", maxDispo: "Max Disposition",
    };
    return map[tab];
  }, [tab]);

  return (
    <div className="ahm-root ahm-enter">
      <style>{CSS}</style>
      <DashboardHero<TabKey>
        icon={Truck} eyebrow="AHM · Telesales-to-Delivery" title="AHM Dashboard"
        tabs={TABS} activeTab={tab} onTabChange={setTab} gradient="from-amber-700 via-orange-600 to-amber-900"
      />

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "12px 0" }}>
        <DashboardExportMenu
          reportTitle="AHM Dashboard" fileBaseName="AHM" raw={{ dashboard: "ahm", from, to }}
          subtitle={`${from} to ${to}`} slides={exportSlides} activeSlideTitle={activeSlideTitle}
        />
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Region" /></SelectTrigger>
            <SelectContent><SelectItem value="ALL">All regions</SelectItem><SelectItem value="MP">MP</SelectItem><SelectItem value="MM">MM</SelectItem></SelectContent>
          </Select>
          <input aria-label="From date" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
            style={{ border: "1px solid #EBDFCF", borderRadius: 10, padding: "6px 10px", fontSize: 12 }} />
          <span style={{ color: PALETTE.muted, fontSize: 12 }}>to</span>
          <input aria-label="To date" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
            style={{ border: "1px solid #EBDFCF", borderRadius: 10, padding: "6px 10px", fontSize: 12 }} />
        </div>
      </div>

      {loading && <p style={{ padding: 24, textAlign: "center", color: PALETTE.muted }}>Loading…</p>}
      {error && <p style={{ padding: 24, textAlign: "center", color: "#DC2626" }}>{error}</p>}

      {data && !loading && (
        <>
          {/* Persistent headline strip, visible on every slide, so switching workbooks never loses the big picture. */}
          <div className="ahm-card" style={{ marginBottom: 12 }}>
            <SlideHead icon={Gauge} title="Headline" sub={`${from} to ${to}${region !== "ALL" ? ` · ${region}` : ""} · every slide below shares this range`} />
            <KpiTiles h={data.headline} />
          </div>

          {tab === "dpts" && (
            <div className="ahm-card">
              <SlideHead icon={Building2} title="DPTS — Mumbai Branch Summary" sub="Mirrors DPTS Mumbai Branch: branch-wide order activity and town-wise outlet coverage" />
              <NotAvailableBanner>
                The source DPTS workbook's Billed / Unbilled status comes from a separate outlet-coverage roster (tagging, black-outlet flag) that this upload does not carry. The table below shows real order and outlet activity by town instead.
              </NotAvailableBanner>
              <p className="ahm-section-label">Status breakdown (Last Status)</p>
              <RankedBars rows={data.statuses.map((s) => ({ ...s }))} labelKey="status" valueKey="orders" pctKey="pct" highlightFirst />
              <div style={{ marginTop: 14 }}>
                <p className="ahm-section-label">Daily trend</p>
                <DailyTrendChart daily={data.daily} />
              </div>
              <div style={{ marginTop: 14 }}>
                <p className="ahm-section-label">Town-wise outlet &amp; order activity</p>
                <GroupTable rows={data.byTown} onOpen={(name) => setDrawer({ kind: "town", key: name })} />
              </div>
            </div>
          )}

          {tab === "gpi" && (
            <div className="ahm-card">
              <SlideHead icon={Gauge} title="GPI Daily Performance Tracker" sub="Mirrors the GPI tracker's Performance and Order vs Delivery sheets" />
              <NotAvailableBanner>
                EC % (Effective Call), PC % (Productive Call), Lines Cut and Incoming % come from a call-attempt log (every dial, not just the survey/order outcome) that this upload does not carry. Order, Sales, Gap and Delivered % below are real and come from the same source as every other slide.
              </NotAvailableBanner>
              <p className="ahm-section-label">Town-wise Order vs Delivery</p>
              <GroupTable rows={data.byTown} onOpen={(name) => setDrawer({ kind: "town", key: name })} />
              <div style={{ marginTop: 14 }}>
                <p className="ahm-section-label">Telesales-wise Order vs Delivery</p>
                <AgentTable rows={data.byTelesales} onOpen={(agent) => setDrawer({ kind: "telesales", key: agent })} />
              </div>
              <div style={{ marginTop: 14, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
                <div>
                  <p className="ahm-section-label">Franchise (brand)-wise</p>
                  <RankedBars rows={data.byFranchise.map((p) => ({ name: p.name, orderQty: p.orderQty, pct: Math.round((p.orderQty / Math.max(1, data.byFranchise[0]?.orderQty || 1)) * 100) }))} labelKey="name" valueKey="orderQty" pctKey="pct" />
                </div>
                <div>
                  <p className="ahm-section-label">Category-wise</p>
                  <RankedBars rows={data.byCategory.map((p) => ({ name: p.name, orderQty: p.orderQty, pct: Math.round((p.orderQty / Math.max(1, data.byCategory[0]?.orderQty || 1)) * 100) }))} labelKey="name" valueKey="orderQty" pctKey="pct" />
                </div>
              </div>
            </div>
          )}

          {tab === "hourly" && (
            <div className="ahm-card">
              <SlideHead icon={Clock} title="Hourly Order Taken Report" sub="Mirrors the Summary (hour × disposition) and Data sheets" />
              <p className="ahm-section-label">Orders by hour of day</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(24,minmax(0,1fr))", gap: 3, marginBottom: 14 }}>
                {Array.from({ length: 24 }, (_, hour) => data.hourly.find((h) => h.hour === hour)).map((h, hour) => {
                  const max = Math.max(...data.hourly.map((r) => r.orders), 1);
                  const opacity = h ? 0.25 + 0.75 * (h.orders / max) : 0;
                  return (
                    <div key={hour} className={h ? "ahm-slot" : "ahm-slot ahm-slot-empty"} style={h ? { background: ACCENT, opacity } : undefined} title={h ? `${hour}:00 — ${h.orders} orders` : `${hour}:00 — no orders`}>
                      {hour}
                    </div>
                  );
                })}
              </div>
              <p className="ahm-section-label">Count of Last disposition Status, by hour</p>
              <div style={{ overflowX: "auto", marginBottom: 4 }}>
                <table className="ahm-table">
                  <thead>
                    <tr>
                      <th>Disposition</th>
                      {Array.from({ length: 24 }, (_, h) => <th key={h}>{h}</th>)}
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...new Set(data.hourlyDisposition.map((r) => r.disposition))].sort().map((dispo) => {
                      const byHour = new Map(data.hourlyDisposition.filter((r) => r.disposition === dispo).map((r) => [r.hour, r.orders]));
                      const total = [...byHour.values()].reduce((s, n) => s + n, 0);
                      return (
                        <tr key={dispo}>
                          <td style={{ textAlign: "left", fontWeight: 600 }}>{dispo}</td>
                          {Array.from({ length: 24 }, (_, h) => <td key={h}>{byHour.get(h) ? int(byHour.get(h)!) : "—"}</td>)}
                          <td style={{ fontWeight: 700 }}>{int(total)}</td>
                        </tr>
                      );
                    })}
                    {data.hourlyDisposition.length === 0 && <tr><td colSpan={26} style={{ textAlign: "center", color: PALETTE.muted }}>No calls on this date.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "orderDelivery" && (
            <div className="ahm-card">
              <SlideHead icon={Route} title="Order vs Delivery" sub="Mirrors Maharashtra Order vs Delivery and the Mumbai Metro Order vs Delivery report" />
              <NotAvailableBanner>
                The two source workbooks split this by ASM Zone / Branch ("MH 01", "MM 03", ...), a separate territory mapping this upload does not carry — the raw Zone column here is each outlet's own town/branch code, not that grouping. Shown combined, by real town and real telesales agent, instead of a guessed Maharashtra/Mumbai Metro split.
              </NotAvailableBanner>
              <p className="ahm-section-label">Daily trend</p>
              <DailyTrendChart daily={data.daily} />
              <div style={{ marginTop: 14 }}>
                <p className="ahm-section-label">Town-wise</p>
                <GroupTable rows={data.byTown} onOpen={(name) => setDrawer({ kind: "town", key: name })} />
              </div>
              <div style={{ marginTop: 14 }}>
                <p className="ahm-section-label">Telesales-wise</p>
                <AgentTable rows={data.byTelesales} onOpen={(agent) => setDrawer({ kind: "telesales", key: agent })} />
              </div>
              <div style={{ marginTop: 14 }}>
                <p className="ahm-section-label">Delivery Partner-wise</p>
                <AgentTable rows={data.byDeliveredBy} onOpen={(agent) => setDrawer({ kind: "deliveredBy", key: agent })} />
              </div>
            </div>
          )}

          {tab === "maxDispo" && (
            <div className="ahm-card">
              <SlideHead icon={AlertTriangle} title="Max Disposition" sub="Mirrors Max Disposition Week: unique disposition by zone, with where-to-focus flags" />
              <p className="ahm-section-label">Overall disposition breakdown ({int(data.dispositions.reduce((s, d) => s + d.orders, 0))} orders)</p>
              <RankedBars rows={data.dispositions.map((d) => ({ ...d }))} labelKey="disposition" valueKey="orders" pctKey="pct" highlightFirst />
              <div style={{ marginTop: 14 }}>
                <p className="ahm-section-label">Where to focus (non-conversion dispositions)</p>
                <RankedBars rows={data.dispositions.filter((d) => d.disposition !== "Survey Taken").slice(0, 6).map((d) => ({ ...d }))} labelKey="disposition" valueKey="orders" pctKey="pct" />
              </div>
              <div style={{ marginTop: 14, overflowX: "auto" }}>
                <p className="ahm-section-label">By zone</p>
                <table className="ahm-table">
                  <thead>
                    <tr>
                      <th>Zone</th>
                      {[...new Set(data.zoneDisposition.map((r) => r.disposition))].sort().map((d) => <th key={d}>{d}</th>)}
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...new Set(data.zoneDisposition.map((r) => r.zone))].sort().map((zone) => {
                      const dispos = [...new Set(data.zoneDisposition.map((r) => r.disposition))].sort();
                      const byDispo = new Map(data.zoneDisposition.filter((r) => r.zone === zone).map((r) => [r.disposition, r.orders]));
                      const total = [...byDispo.values()].reduce((s, n) => s + n, 0);
                      return (
                        <tr key={zone}>
                          <td style={{ textAlign: "left", fontWeight: 600 }}>{zone}</td>
                          {dispos.map((d) => <td key={d}>{byDispo.get(d) ? int(byDispo.get(d)!) : "—"}</td>)}
                          <td style={{ fontWeight: 700 }}>{int(total)}</td>
                        </tr>
                      );
                    })}
                    {data.zoneDisposition.length === 0 && <tr><td colSpan={3} style={{ textAlign: "center", color: PALETTE.muted }}>No data for this range.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {drawer && (
        <AhmDetailDrawer kind={drawer.kind} dataKey={drawer.key} from={from} to={to} region={region} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}
