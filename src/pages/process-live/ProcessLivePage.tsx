/**
 * Process Live Dashboard — exact replica of GAS dashboards.
 *
 * Each tab shows EVERY data point from the corresponding GAS HTML:
 *
 * B-3 IB (Inbound):
 *   Overview  — 12 KPI cards + health score ring + executive signals + action insights
 *   Monthly   — matrix table (all 11 metrics) + 4 charts
 *   Day-wise  — matrix table + 4 charts
 *   Hourly    — slot performance table (all 18 columns incl hold/repeat) + 2 charts
 *   Agents    — CDR + APR merged (17 columns: offered, handled, calls20, talk, SL%, AL%, AHT,
 *               APR calls, net login, utilization, wait, APR talk, pause, LB, TB, WB)
 *   APR       — full APR table with LB/TB/WB breakdown
 *   Disposition — scenario totals + sub-disposition + day-wise snapshots + repeat analysis
 *
 * Reginald Cart:
 *   Overview  — campaign-level KPIs + unique dialed/connected + lt30/ge30
 *   Day-wise  — unique dialed, unique connected, connect%, AHT, avgWrap, avgIdle
 *   Monthly   — same metrics by month
 *   Analysts  — CDR+APR merged with all GAS analyst columns
 *   APR       — LB/TB/WB breakdown
 *
 * Molecular Email / Reginald Email:
 *   APR summary + daily + agent table (all GAS APR columns incl LB/TB/WB/ACHT)
 *   Note shown: ticket metrics (received/closed/closure%) need separate DB
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { getAuthToken } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

// ── GAS Design Tokens ─────────────────────────────────────────────────────────
const TOPBAR_BG = "radial-gradient(circle at 88% 12%,rgba(79,209,255,.18),transparent 24%),linear-gradient(118deg,#071b35 0%,#124d82 48%,#0f7890 100%)";
const ACCENT_LINE = "linear-gradient(90deg,#2f6fed,#10b8d4,#18a866,#e89b19,#7c5ce5)";
const CARD: React.CSSProperties = { background:"#fff", border:"1px solid #dce4ed", borderRadius:17, boxShadow:"0 12px 30px rgba(16,35,57,.08)", padding:"14px 16px", position:"relative", overflow:"hidden" };
const COLORS = { blue:"#2f6fed", cyan:"#10b8d4", green:"#18a866", red:"#e5484d", amber:"#e89b19", purple:"#7c5ce5", teal:"#0f9f8f" };
const KPI_GRADIENTS = [
  "linear-gradient(135deg,#334155,#475569)",
  "linear-gradient(135deg,#047857,#10b981)",
  "linear-gradient(135deg,#be123c,#f43f5e)",
  "linear-gradient(135deg,#6d28d9,#8b5cf6)",
  "linear-gradient(135deg,#0369a1,#06b6d4)",
  "linear-gradient(135deg,#b45309,#f59e0b)",
  "linear-gradient(135deg,#065f46,#059669)",
  "linear-gradient(135deg,#831843,#db2777)",
  "linear-gradient(135deg,#1e3a5f,#2f6fed)",
  "linear-gradient(135deg,#4c1d95,#7c5ce5)",
  "linear-gradient(135deg,#1e293b,#334155)",
  "linear-gradient(135deg,#0f766e,#0f9f8f)",
];

type Tab = "inbound" | "reginald-cart" | "molecular-email" | "reginald-email";
type InboundSub = "overview" | "monthly" | "daily" | "hourly" | "agents" | "apr" | "disposition";
type CartSub = "sales" | "overview" | "monthly" | "daily" | "analysts" | "apr";

interface CartSalesData {
  from:string; to:string;
  orders:number; revenue:number; aov:number;
  prepaid:number; cod:number; prepaidPct:number; codPct:number;
  byAgent:{ empId:string; agentName:string; orders:number; revenue:number; aov:number }[];
  daily:{ date:string; orders:number; revenue:number; aov:number; prepaid:number; cod:number; prepaidPct:number; codPct:number }[];
}
interface Filters { from: string; to: string }

const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0,10); };
const todayStr = () => new Date().toISOString().slice(0,10);
const fmtSecAxis = (s: number): string => { if (s <= 0) return "0"; const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); if (h > 0) return `${h}h`; return `${m}m`; };
const fmtSecShort = (s: number): string => { if (s <= 0) return "0s"; const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.round(s % 60); if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`; if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`; return `${sec}s`; };

async function fetchLive<T>(path: string, params: Record<string,string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const token = getAuthToken();
  const headers: Record<string,string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`/api/process-live/${path}?${qs}`, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json() as { ok: boolean; data: T };
  if (!d.ok) throw new Error("API error");
  return d.data;
}

// ── Micro components ──────────────────────────────────────────────────────────
function Spinner() {
  return <div style={{ display:"flex", justifyContent:"center", padding:"48px 0" }}><div style={{ width:36, height:36, borderRadius:"50%", border:"4px solid #e2e8f0", borderTopColor:"#2f6fed", animation:"spin 0.9s linear infinite" }} /></div>;
}
function ErrorBanner({ msg }: { msg: string }) {
  return <div style={{ margin:"12px 0", padding:"10px 14px", background:"#fff0f2", border:"1px solid #ffc2c2", borderRadius:11, color:"#be123c", fontSize:13 }}>{msg}</div>;
}
function InfoBanner({ msg }: { msg: string }) {
  return <div style={{ margin:"0 0 14px", padding:"10px 14px", background:"linear-gradient(135deg,#eef7ff,#f4fbff)", border:"1px solid #d6e9f8", borderRadius:12, color:"#36536f", fontSize:12, fontWeight:700 }} dangerouslySetInnerHTML={{ __html: msg }} />;
}
function SectionHead({ title }: { title: string }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, margin:"18px 2px 11px" }}>
      <div style={{ width:9, height:9, borderRadius:"50%", background:"linear-gradient(135deg,#2f6fed,#10b8d4)", boxShadow:"0 0 0 4px rgba(47,111,237,.10)", flexShrink:0 }} />
      <h3 style={{ margin:0, color:"#102f4b", fontSize:15, fontWeight:800 }}>{title}</h3>
      <span style={{ height:1, flex:1, background:"linear-gradient(90deg,#d6e0ea,transparent)" }} />
    </div>
  );
}
function KpiTile({ label, value, sub, color }: { label:string; value:string|number; sub?:string; color:string }) {
  return (
    <div style={{ position:"relative", minHeight:98, padding:"13px 14px", borderRadius:16, color:"#fff", overflow:"hidden", boxShadow:"0 12px 30px rgba(16,35,57,.08)", background:color }}>
      <div style={{ position:"absolute", width:78, height:78, borderRadius:"50%", right:-22, top:-28, background:"rgba(255,255,255,.14)" }} />
      <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:".4px", fontWeight:900, opacity:0.9, display:"flex", alignItems:"center", gap:5, minHeight:22 }}>
        <span style={{ width:8, height:8, borderRadius:"50%", background:"rgba(255,255,255,.6)", flexShrink:0 }} />{label}
      </div>
      <div style={{ fontSize:22, fontWeight:950, marginTop:5, lineHeight:1.1 }}>{value}</div>
      {sub && <div style={{ fontSize:9, marginTop:6, opacity:0.88, fontWeight:700 }}>{sub}</div>}
    </div>
  );
}
function Panel({ title, sub, children }: { title:string; sub?:string; children:React.ReactNode }) {
  return (
    <div style={{ ...CARD }}>
      <div style={{ position:"absolute", left:0, top:0, width:4, height:55, background:"linear-gradient(180deg,#2f6fed,#10b8d4)", borderRadius:"0 0 7px 0" }} />
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, paddingLeft:7 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:9, height:9, borderRadius:"50%", background:"linear-gradient(135deg,#2f6fed,#10b8d4)", boxShadow:"0 0 0 4px rgba(47,111,237,.08)" }} />
          <h3 style={{ margin:0, color:"#102f4b", fontSize:15, fontWeight:800 }}>{title}</h3>
        </div>
        {sub && <span style={{ fontSize:11, fontWeight:800, color:"#0369a1", background:"#e7f6fb", border:"1px solid #c8edf5", borderRadius:999, padding:"4px 8px" }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}
function Pct({ v, good="high" }: { v:number; good?:"high"|"low" }) {
  const ok = good==="high" ? v>=80 : v<=20;
  const mid = good==="high" ? v>=55 : v<=40;
  const c = ok ? "#16a34a" : mid ? "#d97706" : "#dc2626";
  const bg = ok ? "#eaf8ef" : mid ? "#fff8e7" : "#fff0f2";
  return <span style={{ fontWeight:900, color:c, background:bg, borderRadius:6, padding:"2px 7px" }}>{v.toFixed(1)}%</span>;
}
function DateFilter({ f, onChange }: { f:Filters; onChange:(f:Filters)=>void }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      {(["from","to"] as const).map(k => (
        <div key={k} style={{ display:"flex", alignItems:"center", gap:5 }}>
          <label style={{ fontSize:11, fontWeight:900, color:"#c8e0f4" }}>{k==="from"?"From":"To"}</label>
          <input type="date" value={f[k]} onChange={e => onChange({ ...f, [k]:e.target.value })}
            style={{ height:34, border:"1px solid rgba(255,255,255,.25)", borderRadius:8, padding:"0 8px", fontSize:12, fontWeight:700, background:"rgba(255,255,255,.12)", color:"#fff", outline:"none" }} />
        </div>
      ))}
    </div>
  );
}

// Table helper
interface Col<T> { h:string; k:keyof T | string; left?:boolean; fmt?:(v:unknown, r:T)=>React.ReactNode }
function Table<T extends Record<string,unknown>>({ cols, rows, empty="No data" }: { cols:Col<T>[]; rows:T[]; empty?:string }) {
  return (
    <div style={{ overflowX:"auto", maxHeight:600, border:"1px solid #dce4ed", borderRadius:11, background:"#fff" }}>
      <table style={{ borderCollapse:"separate", borderSpacing:0, width:"100%", fontSize:12, whiteSpace:"nowrap" }}>
        <thead>
          <tr>
            {cols.map((c,i) => <th key={i} style={{ position:"sticky", top:0, background:"linear-gradient(180deg,#15365e,#102550)", color:"#fff", padding:"10px 8px", fontWeight:900, fontSize:11, textAlign:c.left?"left":"right", zIndex:2 }}>{c.h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length===0 ? <tr><td colSpan={cols.length} style={{ padding:44, textAlign:"center", color:"#697586" }}>{empty}</td></tr>
            : rows.map((row,i) => (
            <tr key={i}>
              {cols.map((c,j) => (
                <td key={j} style={{ padding:"8px 8px", borderBottom:"1px solid #e8eef5", textAlign:c.left?"left":"right", background:i%2===1?"#f8fafc":"#fff" }}>
                  {c.fmt ? c.fmt(row[c.k as keyof T], row) : String(row[c.k as keyof T]??"")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Health Score Ring ─────────────────────────────────────────────────────────
function HealthRing({ score, status }: { score:number; status:string }) {
  const color = score>=90 ? "#45d49a" : score>=75 ? "#f2b54b" : "#f06b70";
  const r = 42, cx = 50, cy = 50;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
      <svg width={100} height={100} viewBox="0 0 100 100">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth={10} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
        <text x={cx} y={cy+2} textAnchor="middle" dominantBaseline="middle" fontSize={18} fontWeight={900} fill="#fff">{score}%</text>
      </svg>
      <div style={{ fontSize:11, fontWeight:900, color, background:"rgba(255,255,255,.12)", borderRadius:20, padding:"3px 10px" }}>{status}</div>
    </div>
  );
}

// ── INBOUND DASHBOARD ─────────────────────────────────────────────────────────
type IBSummary = {
  offered:number; handled:number; abandoned:number; abndWithin:number; abndAfter:number;
  calls20:number; sl:number; al:number; ahtSec:number; aht:string;
  avgWrapSec:number; avgWrap:string; loginCount:number; cpa:number;
  talkSecTotal:number; talkTime:string; acwSecTotal:number; acwTime:string; callDurationSec:number;
  abandonRate:number; within20Rate:number; dailyAverage:number;
  healthScore:number; healthStatus:string; from:string; to:string; generatedAt:string;
};

function IBOverview({ f }: { f:Filters }) {
  const { data:d, isLoading, error, refetch } = useQuery({
    queryKey:["pld","ib","summary",f],
    queryFn:()=>fetchLive<IBSummary>("inbound/summary",{from:f.from,to:f.to}),
    staleTime:2*60*1000,
  });
  if (isLoading) return <Spinner />;
  if (error||!d) return <ErrorBanner msg="Failed to load inbound summary" />;

  const kpis = [
    ["Call Offered", d.offered.toLocaleString(), `Daily avg: ${d.dailyAverage}`],
    ["Call Answered", d.handled.toLocaleString(), `AL: ${d.al.toFixed(1)}%`],
    ["Ans Within 20 Sec", d.calls20.toLocaleString(), "Speed of answer"],
    ["Total Abandoned", d.abandoned.toLocaleString(), `${d.abandonRate.toFixed(1)}% abandon rate`],
    ["Abandon Within 20s", d.abndWithin.toLocaleString(), "Early disconnects"],
    ["Abandon After Threshold", d.abndAfter.toLocaleString(), "Long-wait risk"],
    ["Talk Time", d.talkTime, "Total connected time"],
    [`SL% (20 Sec)`, `${d.sl.toFixed(1)}%`, "Target ≥ 80%"],
    [`AL%`, `${d.al.toFixed(1)}%`, "Target ≥ 80%"],
    ["AHT (Sec)", d.ahtSec.toFixed(0), "Average handle time"],
    ["Call Duration / Offered", d.callDurationSec.toFixed(2), "Avg talk sec per call"],
    ["ACW Duration", d.acwTime, "After-call work"],
  ];

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(6,minmax(0,1fr))", gap:10, marginBottom:20 }}>
        {kpis.map(([label,value,sub],i) => (
          <KpiTile key={i} label={label as string} value={value as string} sub={sub as string}
            color={i===7 ? (d.sl>=80?"linear-gradient(135deg,#047857,#10b981)":"linear-gradient(135deg,#be123c,#f43f5e)")
              : i===8 ? (d.al>=80?"linear-gradient(135deg,#047857,#10b981)":"linear-gradient(135deg,#be123c,#f43f5e)")
              : KPI_GRADIENTS[i % KPI_GRADIENTS.length]} />
        ))}
      </div>
      {/* Executive summary + Health Score */}
      <div style={{ background:"radial-gradient(circle at 92% 18%,rgba(40,202,193,.20),transparent 28%),linear-gradient(132deg,#0a2848 0%,#124c72 61%,#176f81 100%)", borderRadius:18, padding:"18px 22px", marginBottom:14, color:"#fff", display:"grid", gridTemplateColumns:"auto 1fr", gap:22, alignItems:"start" }}>
        <HealthRing score={d.healthScore} status={d.healthStatus} />
        <div>
          <div style={{ fontSize:16, fontWeight:900, marginBottom:8 }}>Executive Brief — {f.from} to {f.to}</div>
          <div style={{ fontSize:12, color:"#d8e9ff", lineHeight:1.6, marginBottom:12 }}>
            {d.offered>0
              ? `${d.handled.toLocaleString()} of ${d.offered.toLocaleString()} offered calls were answered. Service Level is ${d.sl.toFixed(1)}%, Answer Level is ${d.al.toFixed(1)}%, and abandonment is ${d.abandonRate.toFixed(1)}%.`
              : "No call volume for the selected range."}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(0,1fr))", gap:10 }}>
            {[
              { name:"Answer Rate", value:`${d.al.toFixed(1)}%`, note:"Answered / offered" },
              { name:"Within 20 Sec", value:`${d.within20Rate.toFixed(1)}%`, note:"Of answered calls" },
              { name:"Abandon Rate", value:`${d.abandonRate.toFixed(1)}%`, note:"Target ≤ 5%" },
              { name:"Daily Average", value:Math.round(d.dailyAverage).toLocaleString(), note:"Calls per active day" },
            ].map((s,i) => (
              <div key={i} style={{ background:"rgba(255,255,255,.09)", borderRadius:12, padding:"10px 12px" }}>
                <div style={{ fontSize:10, color:"#a8c8e8", fontWeight:800 }}>{s.name}</div>
                <div style={{ fontSize:18, fontWeight:900, marginTop:4 }}>{s.value}</div>
                <div style={{ fontSize:9, color:"#a8c8e8", marginTop:3 }}>{s.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <Panel title="Call Volume" sub={`${d.offered} total`}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={[
              {name:"Handled",value:d.handled},{name:"Abnd>20s",value:d.abndAfter},{name:"Abnd≤20s",value:d.abndWithin}
            ]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="name" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/><Tooltip/>
              <Bar dataKey="value" radius={[6,6,0,0]}><Cell fill="#10b981"/><Cell fill="#f59e0b"/><Cell fill="#ef4444"/></Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Time Breakdown (handled calls, duration)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={[{name:"Talk",value:d.handledTalkSec??0},{name:"Hold",value:d.holdSec??0},{name:"ACW (Wrap)",value:d.handledAcwSec??0}]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="name" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}} tickFormatter={fmtSecAxis}/><Tooltip formatter={(v: number) => [fmtSecShort(v), "Duration"]}/>
              <Bar dataKey="value" fill="#2f6fed" radius={[6,6,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <div style={{ marginTop:8, textAlign:"right", fontSize:10, color:"#697586" }}>
        Generated: {new Date(d.generatedAt).toLocaleString("en-IN")} · <button onClick={()=>refetch()} style={{border:"none",background:"none",cursor:"pointer",color:"#2f6fed",fontSize:10,fontWeight:800}}>Refresh</button>
      </div>
    </div>
  );
}

type IBMatrixRow = {
  date?:string; month?:string;
  offered:number; handled:number; abandoned:number; abndWithin:number; abndAfter:number;
  calls20:number; sl:number; al:number; ahtSec:number; callDurationSec:number; talkTime:string;
};

function IBMatrix({ f, mode }: { f:Filters; mode:"monthly"|"daily" }) {
  const { data, isLoading, error } = useQuery({
    queryKey:["pld","ib",mode,f],
    queryFn:()=>fetchLive<IBMatrixRow[]>(`inbound/${mode}`,{from:f.from,to:f.to}),
    staleTime:2*60*1000,
  });
  if (isLoading) return <Spinner />;
  if (error||!data) return <ErrorBanner msg="Failed to load data" />;
  const labelKey = mode==="monthly" ? "month" : "date";
  const fmtLabel = (v:unknown) => {
    const s = String(v??"");
    if (mode==="daily") { const d=new Date(s); return isNaN(d.getTime())?s:d.toLocaleDateString("en-IN",{day:"2-digit",month:"short"}); }
    const [y,m]=s.split("-"); const ML=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${ML[parseInt(m,10)-1]}-${y?.slice(2)}`;
  };

  const matrixMetrics: Array<{key:keyof IBMatrixRow; label:string; pct?:boolean}> = [
    {key:"al",label:"AL%",pct:true},{key:"sl",label:"SL% (20 Sec)",pct:true},
    {key:"offered",label:"Call Offered"},{key:"handled",label:"Call Answered"},
    {key:"calls20",label:"Calls Ans Within 20 Sec"},{key:"abandoned",label:"Total Abandoned"},
    {key:"abndWithin",label:"Abandon Within 20 Sec"},{key:"abndAfter",label:"Abandon After Threshold"},
    {key:"talkTime",label:"Talk Time"},{key:"callDurationSec",label:"Call Duration / Offered"},{key:"ahtSec",label:"AHT (Sec)"},
  ];

  const chartData = data.map(r => ({ label:fmtLabel(r[labelKey]), sl:r.sl, al:r.al, offered:r.offered, handled:r.handled }));

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
        <Panel title={`${mode==="monthly"?"Monthly":"Daily"} SL% & AL%`}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:10}}/><YAxis domain={[0,100]} tick={{fontSize:10}}/><Tooltip formatter={(v:unknown)=>`${Number(v).toFixed(1)}%`}/>
              <Line type="monotone" dataKey="sl" stroke="#2f6fed" strokeWidth={2} name="SL%" dot={false}/>
              <Line type="monotone" dataKey="al" stroke="#10b981" strokeWidth={2} name="AL%" dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={`${mode==="monthly"?"Monthly":"Daily"} Call Volume`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/>
              <Bar dataKey="offered" fill="#93c5fd" name="Offered"/><Bar dataKey="handled" fill="#2f6fed" name="Handled"/>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <Panel title={`${mode==="monthly"?"Month":"Day"}-wise Metric Matrix`} sub={`${data.length} rows`}>
        <div style={{ overflowX:"auto", maxHeight:500, border:"1px solid #dce4ed", borderRadius:11 }}>
          <table style={{ borderCollapse:"collapse", fontSize:11, whiteSpace:"nowrap", width:"100%" }}>
            <thead>
              <tr>
                <th style={{ position:"sticky", top:0, left:0, background:"linear-gradient(135deg,#0a2848,#124c72)", color:"#fff", padding:"9px 10px", fontWeight:900, textAlign:"left", zIndex:4, minWidth:200 }}>Metric</th>
                {data.map((r,i)=><th key={i} style={{ position:"sticky", top:0, background:"linear-gradient(135deg,#123f69,#1f6f9f)", color:"#fff", padding:"9px 8px", fontWeight:900, textAlign:"right", zIndex:2 }}>{fmtLabel(r[labelKey])}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrixMetrics.map(m=>(
                <tr key={m.key}>
                  <td style={{ background:"linear-gradient(135deg,#e6eef7,#f4f8fc)", fontWeight:900, color:"#0d3154", padding:"6px 10px", borderLeft:"6px solid #174f86", fontSize:10.5 }}>{m.label}</td>
                  {data.map((r,i)=>{
                    const raw = r[m.key]; const v = Number(raw??0);
                    const cls = m.pct ? (v>=90?"#e8fdf1":v>=80?"#fff8e7":"#fff0f2") : "#fff";
                    return <td key={i} style={{ padding:"6px 8px", borderBottom:"1px solid #dbe6ef", textAlign:"right", background:i%2===1?"#f8fbfe":cls, fontWeight:700, color:"#2a435c" }}>{typeof raw==="string"?raw:typeof v==="number"?m.pct?`${v.toFixed(1)}%`:v.toLocaleString():String(raw??"")}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

type SlotRow = {
  slot:string; offered:number; handled:number; abandoned:number; calls20:number;
  sl:number; al:number; ahtSec:number; avgWrapSec:number; loginCount:number; cpa:number;
  abndWithin:number; abndAfter:number; talkTime:string; handledTalkSec:number; holdSec:number;
  repeatCalls:number; repeatPct:number;
};

function IBHourly({ f }: { f:Filters }) {
  const [date, setDate] = useState(todayStr());
  const { data, isLoading, error } = useQuery({
    queryKey:["pld","ib","hourly",date],
    queryFn:()=>fetchLive<SlotRow[]>("inbound/hourly",{date}),
    staleTime:2*60*1000,
  });
  if (isLoading) return <Spinner />;
  if (error||!data) return <ErrorBanner msg="Failed to load hourly data" />;

  const slotCols: Col<SlotRow>[] = [
    {h:"Interval",k:"slot",left:true},{h:"Offered",k:"offered"},{h:"Answered",k:"handled"},
    {h:"Abandoned",k:"abandoned"},{h:"Ans ≤20s",k:"calls20"},{h:"SL%",k:"sl",fmt:v=><Pct v={Number(v)}/>},
    {h:"AL%",k:"al",fmt:v=><Pct v={Number(v)}/>},{h:"AHT Sec",k:"ahtSec"},
    {h:"WT Sec",k:"avgWrapSec"},{h:"Login HC",k:"loginCount"},{h:"CPA",k:"cpa"},
    {h:"Abnd ≤20s",k:"abndWithin"},{h:"Abnd >20s",k:"abndAfter"},
    {h:"Talk Time",k:"talkTime"},{h:"Talk Time (fmt)",k:"handledTalkSec",fmt:(v)=>fmtSecShort(Number(v))},{h:"Hold Time",k:"holdSec",fmt:(v)=>fmtSecShort(Number(v))},
    {h:"Repeat",k:"repeatCalls"},{h:"Repeat %",k:"repeatPct",fmt:v=>`${Number(v).toFixed(1)}%`},
  ];

  const total: Partial<SlotRow> = data.reduce((acc,r) => ({
    offered:(acc.offered??0)+r.offered, handled:(acc.handled??0)+r.handled,
    abandoned:(acc.abandoned??0)+r.abandoned, calls20:(acc.calls20??0)+r.calls20,
    abndWithin:(acc.abndWithin??0)+r.abndWithin, abndAfter:(acc.abndAfter??0)+r.abndAfter,
    handledTalkSec:(acc.handledTalkSec??0)+r.handledTalkSec, holdSec:(acc.holdSec??0)+r.holdSec,
    repeatCalls:(acc.repeatCalls??0)+r.repeatCalls,
  }), {});

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
        <label style={{ fontSize:12, fontWeight:800, color:"#172235" }}>Date:</label>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)}
          style={{ height:34, border:"1px solid #dce4ed", borderRadius:8, padding:"0 10px", fontSize:12, fontWeight:700, background:"#f9fbfd", outline:"none" }} />
      </div>
      <Panel title="Slot Performance Table" sub={`${data.length} slots · Grand Total: offered ${total.offered}, handled ${total.handled}`}>
        <Table cols={slotCols} rows={data} />
      </Panel>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginTop:14 }}>
        <Panel title="Hourly Offered vs Handled">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="slot" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/>
              <Bar dataKey="offered" fill="#93c5fd" name="Offered"/><Bar dataKey="handled" fill="#2f6fed" name="Handled"/>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Hourly SL% & AL%">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="slot" tick={{fontSize:10}}/><YAxis domain={[0,100]} tick={{fontSize:10}}/><Tooltip/>
              <Line type="monotone" dataKey="sl" stroke="#2f6fed" strokeWidth={2} name="SL%" dot={false}/>
              <Line type="monotone" dataKey="al" stroke="#10b981" strokeWidth={2} name="AL%" dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}

type IBAgent = {
  agentName:string; offered:number; handled:number; calls20:number; talk:string;
  sl:number; al:number; ahtSec:number; aht:string;
  aprCalls:number; netLoginTime:string; utilization:number; waitTime:string;
  aprTalkTime:string; pauseTime:string; lbTime:string; tbTime:string; wbTime:string;
};

function IBAgents({ f }: { f:Filters }) {
  const { data, isLoading, error } = useQuery({
    queryKey:["pld","ib","agents",f],
    queryFn:()=>fetchLive<IBAgent[]>("inbound/agents",{from:f.from,to:f.to}),
    staleTime:2*60*1000,
  });
  if (isLoading) return <Spinner />;
  if (error||!data) return <ErrorBanner msg="Failed to load agent data" />;
  const cols: Col<IBAgent>[] = [
    {h:"Agent Name",k:"agentName",left:true},{h:"Call Offered",k:"offered"},{h:"Handled",k:"handled"},
    {h:"Calls Ans ≤20s",k:"calls20"},{h:"CDR Talk Time",k:"talk"},
    {h:"SL%",k:"sl",fmt:v=><Pct v={Number(v)}/>},{h:"AL%",k:"al",fmt:v=><Pct v={Number(v)}/>},{h:"AHT",k:"aht"},
    {h:"APR Calls",k:"aprCalls"},{h:"Net Login Hrs",k:"netLoginTime"},
    {h:"Utilization",k:"utilization",fmt:v=><Pct v={Number(v)}/>},
    {h:"Wait Time",k:"waitTime"},{h:"APR Talk",k:"aprTalkTime"},{h:"Pause",k:"pauseTime"},
    {h:"LB",k:"lbTime"},{h:"TB",k:"tbTime"},{h:"WB",k:"wbTime"},
  ];
  return <Panel title="Agent-wise Performance (CDR + APR Merged)" sub={`${data.length} agents`}><Table cols={cols} rows={data}/></Panel>;
}

type APRRow = { user:string; aprCalls:number; netLoginTime:string; talkSec:number; talk:string; waitSec:number; wait:string; dispoSec:number; dispo:string; pauseSec:number; pause:string; lbTime:string; tbTime:string; wbTime:string; utilization:number; loginStart:string; logout:string };

function IBApr({ f }: { f:Filters }) {
  const { data, isLoading, error } = useQuery({
    queryKey:["pld","ib","apr",f],
    queryFn:()=>fetchLive<APRRow[]>("inbound/apr",{from:f.from,to:f.to}),
    staleTime:2*60*1000,
  });
  if (isLoading) return <Spinner />;
  if (error||!data) return <ErrorBanner msg="Failed to load APR" />;
  const cols: Col<APRRow>[] = [
    {h:"Agent ID",k:"user",left:true},{h:"APR Calls",k:"aprCalls"},{h:"Net Login",k:"netLoginTime"},
    {h:"Talk",k:"talk"},{h:"Wait",k:"wait"},{h:"Dispo",k:"dispo"},{h:"Pause",k:"pause"},
    {h:"LB",k:"lbTime"},{h:"TB",k:"tbTime"},{h:"WB",k:"wbTime"},
    {h:"Utilization",k:"utilization",fmt:v=><Pct v={Number(v)}/>},
    {h:"Login Start",k:"loginStart"},{h:"Logout",k:"logout"},
  ];
  return <Panel title="Agent Productivity Report (APR)" sub={`${data.length} agents`}><Table cols={cols} rows={data}/></Panel>;
}

type DispoData = { totals:{complaint:number;query:number;request:number;sales:number;other:number;total:number}; daily:{date:string;complaint:number;query:number;request:number;sales:number;other:number;total:number}[]; subDisposition:{scenario:string;subDisposition:string;count:number}[]; rowCount:number };
type RepeatData = { daily:{date:string;total:number;unique:number;repeat:number;repeatPct:number}[]; agents:{agentName:string;total:number;unique:number;repeat:number;repeatPct:number}[]; totals:{total:number;unique:number;repeat:number;repeatPct:number} };

function IBDisposition({ f }: { f:Filters }) {
  const { data:dispo, isLoading:dl, error:de } = useQuery({ queryKey:["pld","ib","dispo",f], queryFn:()=>fetchLive<DispoData>("inbound/disposition",{from:f.from,to:f.to}), staleTime:2*60*1000 });
  const { data:repeat, isLoading:rl } = useQuery({ queryKey:["pld","ib","repeat",f], queryFn:()=>fetchLive<RepeatData>("inbound/repeat",{from:f.from,to:f.to}), staleTime:2*60*1000 });

  if (dl||rl) return <Spinner />;
  if (de||!dispo) return <ErrorBanner msg="Failed to load disposition" />;
  const t = dispo.totals;
  const scenarioColors: Record<string,string> = { complaint:"#e5484d", query:"#2f6fed", request:"#18a866", sales:"#e89b19", other:"#7c5ce5" };
  const scenarios = ["complaint","query","request","sales","other"] as const;

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,minmax(0,1fr))", gap:10, marginBottom:14 }}>
        {scenarios.map(k => <KpiTile key={k} label={k.charAt(0).toUpperCase()+k.slice(1)} value={(t[k]??0).toLocaleString()} sub={t.total>0?`${((t[k]/t.total)*100).toFixed(1)}% of total`:""} color={scenarioColors[k]??KPI_GRADIENTS[0]} />)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
        <Panel title="Day-wise Complaint" sub="Count by date">
          <ResponsiveContainer width="100%" height={180}><BarChart data={dispo.daily}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="date" tick={{fontSize:9}} tickFormatter={v=>new Date(v).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}/><YAxis tick={{fontSize:9}}/><Tooltip/><Bar dataKey="complaint" fill="#e5484d" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>
        </Panel>
        <Panel title="Day-wise Query" sub="Count by date">
          <ResponsiveContainer width="100%" height={180}><BarChart data={dispo.daily}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="date" tick={{fontSize:9}} tickFormatter={v=>new Date(v).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}/><YAxis tick={{fontSize:9}}/><Tooltip/><Bar dataKey="query" fill="#2f6fed" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>
        </Panel>
        <Panel title="Day-wise Request" sub="Count by date">
          <ResponsiveContainer width="100%" height={180}><BarChart data={dispo.daily}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="date" tick={{fontSize:9}} tickFormatter={v=>new Date(v).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}/><YAxis tick={{fontSize:9}}/><Tooltip/><Bar dataKey="request" fill="#18a866" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>
        </Panel>
        <Panel title="Day-wise Sales" sub="Count by date">
          <ResponsiveContainer width="100%" height={180}><BarChart data={dispo.daily}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="date" tick={{fontSize:9}} tickFormatter={v=>new Date(v).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}/><YAxis tick={{fontSize:9}}/><Tooltip/><Bar dataKey="sales" fill="#e89b19" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>
        </Panel>
      </div>
      {/* Sub-disposition breakdown */}
      <SectionHead title="Sub-Disposition Breakdown (Category2)" />
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:14 }}>
        {scenarios.filter(k=>k!=="other").map(k=>{
          const rows = dispo.subDisposition.filter(r=>r.scenario===k);
          return (
            <Panel key={k} title={k.charAt(0).toUpperCase()+k.slice(1)} sub={`${rows.length} sub-types`}>
              <Table cols={[{h:"Sub Disposition",k:"subDisposition",left:true},{h:"Count",k:"count"}]} rows={rows} empty="No sub-disposition data" />
            </Panel>
          );
        })}
      </div>
      {/* Daily disposition table */}
      <Panel title="Daily Disposition Breakdown" sub={`${dispo.rowCount.toLocaleString()} records`}>
        <Table cols={[
          {h:"Date",k:"date",left:true,fmt:v=>new Date(String(v)).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})},
          {h:"Complaint",k:"complaint"},{h:"Query",k:"query"},{h:"Request",k:"request"},{h:"Sales",k:"sales"},{h:"Other",k:"other"},{h:"Total",k:"total"}
        ]} rows={dispo.daily} />
      </Panel>
      {/* Repeat analysis */}
      {repeat && (
        <>
          <SectionHead title="Repeat Analysis (Phone-based)" />
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(0,1fr))", gap:10, marginBottom:14 }}>
            {[
              {label:"Total Handled",value:repeat.totals.total.toLocaleString(),color:KPI_GRADIENTS[0]},
              {label:"Unique Callers",value:repeat.totals.unique.toLocaleString(),color:KPI_GRADIENTS[1]},
              {label:"Repeat Calls",value:repeat.totals.repeat.toLocaleString(),color:KPI_GRADIENTS[2]},
              {label:"Repeat %",value:`${repeat.totals.repeatPct.toFixed(1)}%`,color:KPI_GRADIENTS[6]},
            ].map((k,i)=><KpiTile key={i} {...k} />)}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <Panel title="Daily Repeat Contribution">
              <ResponsiveContainer width="100%" height={220}><AreaChart data={repeat.daily}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="date" tick={{fontSize:9}} tickFormatter={v=>new Date(v).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}/><YAxis tick={{fontSize:9}}/><Tooltip/>
                <Area type="monotone" dataKey="total" stroke="#93c5fd" fill="#dbeafe" name="Total"/><Area type="monotone" dataKey="repeat" stroke="#e5484d" fill="#fee2e2" name="Repeat"/>
              </AreaChart></ResponsiveContainer>
            </Panel>
            <Panel title="Agent-wise Unique & Repeat" sub={`${repeat.agents.length} agents`}>
              <Table cols={[{h:"Agent",k:"agentName",left:true},{h:"Total",k:"total"},{h:"Unique",k:"unique"},{h:"Repeat",k:"repeat"},{h:"Repeat %",k:"repeatPct",fmt:v=>`${Number(v).toFixed(1)}%`}]} rows={repeat.agents.slice(0,15)} />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

// ── REGINALD CART DASHBOARD ───────────────────────────────────────────────────
type CartSummaryT = { from:string;to:string;offered:number;connected:number;abandoned:number;uniqueDialed:number;uniqueConnected:number;connectPct:number;talkSec:number;talk:string;avgTalkSec:number;avgTalk:string;ahtSec:number;aht:string;avgWrapSec:number;avgWrap:string;loginCount:number;lt30:number;ge30:number;generatedAt:string;byCampaign:{campaign:string;offered:number;connected:number;uniqueDialed:number;uniqueConnected:number;connectPct:number;avgTalk:string}[] };
type CartDayT = { date:string;totalDialed:number;uniqueDialed:number;uniqueConnected:number;connectPct:number;loginCount:number;avgTalk:string;aht:string;avgWrap:string;avgIdle:string };
type CartMonthT = { month:string;monthLabel:string;totalDialed:number;uniqueDialed:number;uniqueConnected:number;connectPct:number;loginCount:number;avgTalk:string;aht:string;avgWrap:string };
type CartAnalystT = { analyst:string;loginDays:number;totalDialed:number;uniqueDialed:number;uniqueConnected:number;connectPct:number;lt30:number;ge30:number;avgTalk:string;aht:string;avgWrap:string;avgWait:string;netLoginTime:string;utilization:number };
type CartAprT = { user:string;aprCalls:number;netLoginTime:string;talk:string;wait:string;dispo:string;pause:string;lbTime:string;tbTime:string;wbTime:string;utilization:number };

function CartOverview({ f }: { f:Filters }) {
  const { data:d, isLoading, error, refetch } = useQuery({ queryKey:["pld","cart","summary",f], queryFn:()=>fetchLive<CartSummaryT>("reginald-cart/summary",{from:f.from,to:f.to}), staleTime:2*60*1000 });
  if (isLoading) return <Spinner />;
  if (error||!d) return <ErrorBanner msg="Failed to load Reginald Cart summary" />;
  const kpis = [
    {label:"Total Dialled",value:d.offered.toLocaleString(),sub:`${f.from} – ${f.to}`,color:KPI_GRADIENTS[0]},
    {label:"Connected",value:d.connected.toLocaleString(),sub:`Connect: ${d.connectPct.toFixed(1)}%`,color:"linear-gradient(135deg,#047857,#10b981)"},
    {label:"Not Connected",value:d.abandoned.toLocaleString(),sub:`${(100-d.connectPct).toFixed(1)}% drop`,color:"linear-gradient(135deg,#be123c,#f43f5e)"},
    {label:"Unique Dialled",value:d.uniqueDialed.toLocaleString(),sub:"Distinct phones",color:KPI_GRADIENTS[4]},
    {label:"Unique Connected",value:d.uniqueConnected.toLocaleString(),sub:"Distinct answered",color:"linear-gradient(135deg,#065f46,#059669)"},
    {label:"Avg Talk Time",value:d.avgTalk,sub:"Per connected call",color:KPI_GRADIENTS[3]},
    {label:"AHT (Talk+Wrap+Dead)",value:d.aht,sub:"Per connected call",color:KPI_GRADIENTS[9]},
    {label:"Calls < 30 Sec",value:d.lt30.toLocaleString(),sub:"Short connections",color:"linear-gradient(135deg,#b45309,#f59e0b)"},
    {label:"Calls ≥ 30 Sec",value:d.ge30.toLocaleString(),sub:"Quality connections",color:"linear-gradient(135deg,#0369a1,#06b6d4)"},
  ];
  return (
    <div>
      <InfoBanner msg="<strong>Note:</strong> This Overview tab shows call volume + APR metrics only (from dialler_db). Sales, Revenue &amp; AOV are on the <strong>Sales</strong> tab, imported from the Live Sales export via Bulk Upload Hub." />
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:10, marginBottom:14 }}>
        {kpis.map((k,i)=><KpiTile key={i} {...k}/>)}
      </div>
      <SectionHead title="By Campaign" />
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <Panel title="Campaign Performance Table" sub={`${d.byCampaign.length} campaigns`}>
          <Table cols={[
            {h:"Campaign",k:"campaign",left:true},{h:"Offered",k:"offered"},{h:"Connected",k:"connected"},
            {h:"Unique Dialled",k:"uniqueDialed"},{h:"Unique Connected",k:"uniqueConnected"},
            {h:"Connect%",k:"connectPct",fmt:v=><Pct v={Number(v)}/>},{h:"Avg Talk",k:"avgTalk"},
          ]} rows={d.byCampaign} />
        </Panel>
        <Panel title="Campaign Volume Chart">
          <ResponsiveContainer width="100%" height={280}><BarChart data={d.byCampaign} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis type="number" tick={{fontSize:10}}/><YAxis dataKey="campaign" type="category" width={80} tick={{fontSize:11}}/><Tooltip/><Bar dataKey="offered" fill="#93c5fd" name="Offered"/><Bar dataKey="connected" fill="#2f6fed" name="Connected"/></BarChart></ResponsiveContainer>
        </Panel>
      </div>
      <div style={{ marginTop:8, textAlign:"right", fontSize:10, color:"#697586" }}>Generated: {new Date(d.generatedAt).toLocaleString("en-IN")} · <button onClick={()=>refetch()} style={{border:"none",background:"none",cursor:"pointer",color:"#2f6fed",fontSize:10,fontWeight:800}}>Refresh</button></div>
    </div>
  );
}

function CartDaily({ f }: { f:Filters }) {
  const { data, isLoading, error } = useQuery({ queryKey:["pld","cart","daily",f], queryFn:()=>fetchLive<CartDayT[]>("reginald-cart/daily",{from:f.from,to:f.to}), staleTime:2*60*1000 });
  if (isLoading) return <Spinner />;
  if (error||!data) return <ErrorBanner msg="Failed to load daily data" />;
  const fmtD = (v:unknown)=>new Date(String(v)).toLocaleDateString("en-IN",{day:"2-digit",month:"short"});
  const cols: Col<CartDayT>[] = [
    {h:"Date",k:"date",left:true,fmt:fmtD},{h:"Total CDR",k:"totalDialed"},{h:"Unique Dialled",k:"uniqueDialed"},
    {h:"Unique Connected",k:"uniqueConnected"},{h:"Connect%",k:"connectPct",fmt:v=><Pct v={Number(v)}/>},
    {h:"Login Count",k:"loginCount"},{h:"Avg Talk",k:"avgTalk"},{h:"AHT",k:"aht"},{h:"Avg Wrap",k:"avgWrap"},{h:"Avg Idle",k:"avgIdle"},
  ];
  const chartData = data.map(r=>({ label:fmtD(r.date) as string, uniqueDialed:r.uniqueDialed, uniqueConnected:r.uniqueConnected, connectPct:r.connectPct }));
  return (
    <div>
      <Panel title="Day-wise Performance" sub={`${data.length} days`}><Table cols={cols} rows={data}/></Panel>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginTop:14 }}>
        <Panel title="Unique Dialled vs Connected Trend">
          <ResponsiveContainer width="100%" height={220}><AreaChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Area type="monotone" dataKey="uniqueDialed" stroke="#93c5fd" fill="#dbeafe" name="Unique Dialled"/><Area type="monotone" dataKey="uniqueConnected" stroke="#2f6fed" fill="#bfdbfe" name="Unique Connected"/></AreaChart></ResponsiveContainer>
        </Panel>
        <Panel title="Connect % Trend">
          <ResponsiveContainer width="100%" height={220}><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:10}}/><YAxis domain={[0,100]} tick={{fontSize:10}}/><Tooltip formatter={(v:unknown)=>`${Number(v).toFixed(1)}%`}/><Line type="monotone" dataKey="connectPct" stroke="#7c5ce5" strokeWidth={2} name="Connect%" dot={false}/></LineChart></ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}

function CartMonthly({ f }: { f:Filters }) {
  const { data, isLoading, error } = useQuery({ queryKey:["pld","cart","monthly",f], queryFn:()=>fetchLive<CartMonthT[]>("reginald-cart/monthly",{from:f.from,to:f.to}), staleTime:2*60*1000 });
  if (isLoading) return <Spinner />;
  if (error||!data) return <ErrorBanner msg="Failed to load monthly data" />;
  const cols: Col<CartMonthT>[] = [
    {h:"Month",k:"monthLabel",left:true},{h:"Total CDR",k:"totalDialed"},{h:"Unique Dialled",k:"uniqueDialed"},
    {h:"Unique Connected",k:"uniqueConnected"},{h:"Connect%",k:"connectPct",fmt:v=><Pct v={Number(v)}/>},
    {h:"Avg Daily Login",k:"loginCount"},{h:"Avg Talk",k:"avgTalk"},{h:"AHT",k:"aht"},{h:"Avg Wrap",k:"avgWrap"},
  ];
  return (
    <div>
      <Panel title="Monthly Performance" sub={`${data.length} months`}><Table cols={cols} rows={data}/></Panel>
      <div style={{ marginTop:14 }}>
        <Panel title="Monthly Connect % Trend">
          <ResponsiveContainer width="100%" height={220}><LineChart data={data.map(r=>({label:r.monthLabel,connectPct:r.connectPct}))}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:11}}/><YAxis domain={[0,100]} tick={{fontSize:10}}/><Tooltip formatter={(v:unknown)=>`${Number(v).toFixed(1)}%`}/><Line type="monotone" dataKey="connectPct" stroke="#7c5ce5" strokeWidth={2} name="Connect%" dot={false}/></LineChart></ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}

function CartAnalysts({ f }: { f:Filters }) {
  const { data, isLoading, error } = useQuery({ queryKey:["pld","cart","analysts",f], queryFn:()=>fetchLive<CartAnalystT[]>("reginald-cart/analysts",{from:f.from,to:f.to}), staleTime:2*60*1000 });
  if (isLoading) return <Spinner />;
  if (error||!data) return <ErrorBanner msg="Failed to load analyst data" />;
  const cols: Col<CartAnalystT>[] = [
    {h:"Analyst",k:"analyst",left:true},{h:"Login Days",k:"loginDays"},{h:"Total CDR",k:"totalDialed"},
    {h:"Unique Dialled",k:"uniqueDialed"},{h:"Unique Connected",k:"uniqueConnected"},
    {h:"Connect%",k:"connectPct",fmt:v=><Pct v={Number(v)}/>},
    {h:"<30 Sec",k:"lt30"},{h:"≥30 Sec",k:"ge30"},
    {h:"Avg Talk",k:"avgTalk"},{h:"AHT",k:"aht"},{h:"Avg Wrap",k:"avgWrap"},{h:"Avg Wait",k:"avgWait"},
    {h:"Net Login",k:"netLoginTime"},{h:"Utilization",k:"utilization",fmt:v=><Pct v={Number(v)}/>},
  ];
  return <Panel title="Analyst-wise Performance (CDR + APR)" sub={`${data.length} analysts`}><Table cols={cols} rows={data}/></Panel>;
}

function CartApr({ f }: { f:Filters }) {
  const { data, isLoading, error } = useQuery({ queryKey:["pld","cart","apr",f], queryFn:()=>fetchLive<CartAprT[]>("reginald-cart/apr",{from:f.from,to:f.to}), staleTime:2*60*1000 });
  if (isLoading) return <Spinner />;
  if (error||!data) return <ErrorBanner msg="Failed to load APR" />;
  const cols: Col<CartAprT>[] = [
    {h:"Agent ID",k:"user",left:true},{h:"APR Calls",k:"aprCalls"},{h:"Net Login",k:"netLoginTime"},
    {h:"Talk",k:"talk"},{h:"Wait",k:"wait"},{h:"Dispo",k:"dispo"},{h:"Pause",k:"pause"},
    {h:"LB",k:"lbTime"},{h:"TB",k:"tbTime"},{h:"WB",k:"wbTime"},{h:"Utilization",k:"utilization",fmt:v=><Pct v={Number(v)}/>},
  ];
  return <Panel title="Agent Productivity Report (APR)" sub={`${data.length} agents`}><Table cols={cols} rows={data}/></Panel>;
}

function CartSales({ f }: { f:Filters }) {
  const { data, isLoading, error } = useQuery({ queryKey:["pld","cart","sales",f], queryFn:()=>fetchLive<CartSalesData>("reginald-cart/sales",{from:f.from,to:f.to}), staleTime:2*60*1000 });
  if (isLoading) return <Spinner />;
  if (error||!data) return <ErrorBanner msg="Failed to load sales data" />;
  const rs = (v:number) => `₹${v.toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:0})}`;
  const fmtD = (v:unknown) => { const d=new Date(String(v??"")); return isNaN(d.getTime())?String(v??""):d.toLocaleDateString("en-IN",{day:"2-digit",month:"short"}); };
  // This dashboard has no upload control of its own — every upload in this system goes
  // through the general Bulk Upload Hub (REGINALD_ABANDONED_CART_SALES template), which had
  // no link pointing back here. Sales/revenue data is only as fresh as the last upload there.
  const uploadBanner =
    '<a href="/bulk-upload" target="_blank" rel="noopener noreferrer" style="color:#1e6fa8;font-weight:800;text-decoration:underline">Upload the latest Live Sales export →</a> ' +
    '(Bulk Upload Hub, "Reginald Men — Abandoned Cart Live Sales" template). Sales/Revenue/AOV below reflect only what has been uploaded so far.';
  const kpis = [
    {label:"Total Orders",value:data.orders.toLocaleString(),sub:`${f.from} – ${f.to}`,color:"linear-gradient(135deg,#153f69,#1e6fa8)"},
    {label:"Total Revenue",value:rs(data.revenue),sub:`AOV ${rs(data.aov)}`,color:"linear-gradient(135deg,#047857,#10b981)"},
    {label:"Prepaid Orders",value:data.prepaid.toLocaleString(),sub:`${data.prepaidPct.toFixed(1)}% of orders`,color:"linear-gradient(135deg,#6d28d9,#8b5cf6)"},
    {label:"COD Orders",value:data.cod.toLocaleString(),sub:`${data.codPct.toFixed(1)}% of orders`,color:"linear-gradient(135deg,#b45309,#f59e0b)"},
    {label:"AOV",value:rs(data.aov),sub:"Revenue ÷ Orders",color:"linear-gradient(135deg,#0369a1,#06b6d4)"},
  ];
  return (
    <div>
      <InfoBanner msg={uploadBanner} />
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,minmax(0,1fr))", gap:10, marginBottom:16 }}>
        {kpis.map((k,i)=><KpiTile key={i} {...k}/>)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <Panel title="Daily Orders & Revenue" sub={`${data.daily.length} days`}>
          <Table<CartSalesData["daily"][0]> cols={[
            {h:"Date",k:"date",left:true,fmt:fmtD},
            {h:"Orders",k:"orders"},
            {h:"Revenue",k:"revenue",fmt:(v:unknown)=>rs(Number(v))},
            {h:"AOV",k:"aov",fmt:(v:unknown)=>rs(Number(v))},
            {h:"Prepaid",k:"prepaid"},
            {h:"COD",k:"cod"},
            {h:"Prepaid %",k:"prepaidPct",fmt:(v:unknown)=>`${Number(v).toFixed(1)}%`},
          ]} rows={data.daily}/>
        </Panel>
        <Panel title="Agent-wise Sales" sub={`${data.byAgent.length} agents`}>
          <Table<CartSalesData["byAgent"][0]> cols={[
            {h:"Agent",k:"agentName",left:true},
            {h:"EMP ID",k:"empId"},
            {h:"Orders",k:"orders"},
            {h:"Revenue",k:"revenue",fmt:(v:unknown)=>rs(Number(v))},
            {h:"AOV",k:"aov",fmt:(v:unknown)=>rs(Number(v))},
          ]} rows={data.byAgent}/>
        </Panel>
      </div>
    </div>
  );
}

// ── EMAIL APR DASHBOARD ───────────────────────────────────────────────────────
type EmailAprSummary = { process:string;campaign:string;from:string;to:string;totalLoginTime:string;totalTalk:string;totalWait:string;totalPause:string;totalLbTime:string;totalTbTime:string;totalWbTime:string;avgUtilization:number;agentCount:number;generatedAt:string };
type EmailAprAgentRow = { user:string;aprCalls:number;netLoginTime:string;talk:string;wait:string;dispo:string;pause:string;lbTime:string;tbTime:string;wbTime:string;totalBreak:string;acht:string;utilization:number;loginStart:string;logout:string };
type EmailAprDayRow = { date:string;loginTime:string;talk:string;wait:string;dispo:string;pause:string;utilization:number;agentCount:number };

function EmailAprView({ process, label, f }: { process:"molecular-email"|"reginald-email"; label:string; f:Filters }) {
  const [sub, setSub] = useState<"overview"|"daily"|"agents">("overview");
  const summaryQ = useQuery({ queryKey:["pld",process,"summary",f], queryFn:()=>fetchLive<EmailAprSummary>(`${process}/summary`,{from:f.from,to:f.to}), staleTime:2*60*1000 });
  const agentsQ = useQuery({ queryKey:["pld",process,"agents",f], queryFn:()=>fetchLive<EmailAprAgentRow[]>(`${process}/agents`,{from:f.from,to:f.to}), staleTime:2*60*1000, enabled:sub==="agents" });
  const dailyQ = useQuery({ queryKey:["pld",process,"daily",f], queryFn:()=>fetchLive<EmailAprDayRow[]>(`${process}/daily`,{from:f.from,to:f.to}), staleTime:2*60*1000, enabled:sub==="daily" });

  return (
    <div>
      <InfoBanner msg={`<strong>${label}</strong> — APR from <code>vicidial_agent_log_10_25</code> (campaign ${process==="molecular-email"?"MOEMAIL":"EMAIL"}). Email ticket metrics (received, closed, pending, reopened, closure%) require <code>molecular_db_email</code> on 122.184.128.89 — not accessible from this backend.`} />
      <div style={{ display:"flex", gap:6, marginBottom:14 }}>
        {(["overview","daily","agents"] as const).map(t=>(
          <button key={t} onClick={()=>setSub(t)} style={{ height:32, border:"none", borderRadius:8, padding:"0 14px", fontSize:12, fontWeight:800, cursor:"pointer", transition:".15s", background:sub===t?"linear-gradient(135deg,#153f69,#2673a0)":"#edf3f9", color:sub===t?"#fff":"#334155" }}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
        ))}
      </div>
      {sub==="overview" && (
        summaryQ.isLoading ? <Spinner/> :
        summaryQ.error||!summaryQ.data ? <ErrorBanner msg="Failed to load summary"/> : (()=>{
          const d = summaryQ.data;
          const kpis = [
            {label:"Agents Active",value:d.agentCount,sub:`${d.from} – ${d.to}`,color:KPI_GRADIENTS[0]},
            {label:"Total Login Time",value:d.totalLoginTime,sub:"Across all agents",color:KPI_GRADIENTS[4]},
            {label:"Total Talk Time",value:d.totalTalk,sub:"Productive time",color:"linear-gradient(135deg,#047857,#10b981)"},
            {label:"Total Pause",value:d.totalPause,sub:`LB: ${d.totalLbTime} · TB: ${d.totalTbTime}`,color:"linear-gradient(135deg,#b45309,#f59e0b)"},
            {label:"Avg Utilization",value:`${d.avgUtilization.toFixed(1)}%`,sub:"(Wait+Talk)/Login",color:d.avgUtilization>=70?"linear-gradient(135deg,#047857,#10b981)":"linear-gradient(135deg,#b45309,#f59e0b)"},
          ];
          return <div style={{ display:"grid", gridTemplateColumns:"repeat(5,minmax(0,1fr))", gap:10 }}>{kpis.map((k,i)=><KpiTile key={i} {...k}/>)}</div>;
        })()
      )}
      {sub==="daily" && (
        dailyQ.isLoading ? <Spinner/> :
        dailyQ.error||!dailyQ.data ? <ErrorBanner msg="Failed to load daily APR"/> : (
          <Panel title="Daily APR" sub={`${dailyQ.data.length} days`}>
            <Table cols={[
              {h:"Date",k:"date",left:true,fmt:v=>new Date(String(v)).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})},
              {h:"Login Time",k:"loginTime"},{h:"Talk",k:"talk"},{h:"Wait",k:"wait"},
              {h:"Dispo",k:"dispo"},{h:"Pause",k:"pause"},{h:"Agents",k:"agentCount"},
              {h:"Utilization",k:"utilization",fmt:v=><Pct v={Number(v)}/>},
            ]} rows={dailyQ.data} />
          </Panel>
        )
      )}
      {sub==="agents" && (
        agentsQ.isLoading ? <Spinner/> :
        agentsQ.error||!agentsQ.data ? <ErrorBanner msg="Failed to load agents"/> : (
          <Panel title="Agent-wise APR" sub={`${agentsQ.data.length} agents`}>
            <Table cols={[
              {h:"Agent ID",k:"user",left:true},{h:"Calls",k:"aprCalls"},{h:"Net Login",k:"netLoginTime"},
              {h:"Talk",k:"talk"},{h:"Wait",k:"wait"},{h:"Dispo",k:"dispo"},{h:"Pause",k:"pause"},
              {h:"LB",k:"lbTime"},{h:"TB",k:"tbTime"},{h:"WB",k:"wbTime"},
              {h:"Total Break",k:"totalBreak"},{h:"ACHT",k:"acht"},
              {h:"Utilization",k:"utilization",fmt:v=><Pct v={Number(v)}/>},
              {h:"Login Start",k:"loginStart"},{h:"Logout",k:"logout"},
            ]} rows={agentsQ.data}/>
          </Panel>
        )
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const PROCESSES: { key:Tab; label:string; short:string; color:string }[] = [
  { key:"inbound", label:"B-3 IB (Inbound)", short:"BLA BLI BLU", color:"#2f6fed" },
  { key:"reginald-cart", label:"Reginald Cart", short:"Abandoned Cart", color:"#e89b19" },
  { key:"molecular-email", label:"Molecular Email", short:"APR only", color:"#18a866" },
  { key:"reginald-email", label:"Reginald Email", short:"APR only", color:"#7c5ce5" },
];
const IB_SUBS: { key:InboundSub; label:string }[] = [
  {key:"overview",label:"Overview"},{key:"monthly",label:"Monthly"},{key:"daily",label:"Day-wise"},
  {key:"hourly",label:"Hourly Slots"},{key:"agents",label:"Agents (CDR+APR)"},{key:"apr",label:"APR"},{key:"disposition",label:"Disposition"},
];
const CART_SUBS: { key:CartSub; label:string }[] = [
  {key:"sales",label:"Sales"},{key:"overview",label:"CDR Overview"},{key:"monthly",label:"Monthly"},
  {key:"daily",label:"Day-wise"},{key:"analysts",label:"Analysts"},{key:"apr",label:"APR"},
];

export default function ProcessLivePage() {
  const [proc, setProc] = useState<Tab>("inbound");
  const [ibSub, setIbSub] = useState<InboundSub>("overview");
  const [cartSub, setCartSub] = useState<CartSub>("sales");
  const [filters, setFilters] = useState<Filters>({ from:monthStart(), to:todayStr() });

  const p = PROCESSES.find(x=>x.key===proc)!;

  return (
    <DashboardLayout>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.85)}}`}</style>
      {/* Sticky shell */}
      <div style={{ position:"sticky", top:0, zIndex:100, background:"#fff", boxShadow:"0 5px 22px rgba(10,34,55,.12)" }}>
        <div style={{ height:4, background:ACCENT_LINE }} />
        <div style={{ minHeight:78, padding:"10px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:16, color:"#fff", background:TOPBAR_BG, position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute", width:230, height:230, borderRadius:"50%", right:-65, top:-155, background:"radial-gradient(circle,rgba(255,255,255,.20),transparent 65%)" }} />
          <div style={{ position:"relative" }}>
            <div style={{ fontSize:18, fontWeight:900 }}>Process Live Dashboard</div>
            <div style={{ fontSize:11, color:"#c8e0f4", marginTop:2 }}>dialler_db · 122.184.128.90 · {filters.from} – {filters.to}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", position:"relative" }}>
            <DateFilter f={filters} onChange={setFilters} />
            <div style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(255,255,255,.12)", borderRadius:20, padding:"5px 10px" }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:"#10b981", boxShadow:"0 0 0 3px rgba(16,185,129,.25)", animation:"pulse 2s infinite" }} />
              <span style={{ fontSize:10, fontWeight:900 }}>LIVE</span>
            </div>
          </div>
        </div>
        {/* Process tabs */}
        <div style={{ display:"flex", gap:6, padding:"8px 20px", background:"#f4f7fb", borderBottom:"1px solid #e2e8f0", overflowX:"auto" }}>
          {PROCESSES.map(px=>(
            <button key={px.key} onClick={()=>setProc(px.key)}
              style={{ height:36, border:proc===px.key?"none":"1px solid #e2e8f0", borderRadius:10, padding:"0 16px", fontSize:12, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap", transition:".15s", background:proc===px.key?px.color:"#fff", color:proc===px.key?"#fff":"#334155", boxShadow:proc===px.key?`0 5px 14px ${px.color}44`:"0 2px 6px rgba(16,35,57,.07)" }}>
              {px.label} <span style={{ fontSize:10, opacity:.78, marginLeft:4 }}>({px.short})</span>
            </button>
          ))}
        </div>
        {/* Sub-tabs */}
        {(proc==="inbound"||proc==="reginald-cart") && (
          <div style={{ display:"flex", gap:4, padding:"6px 20px", background:"#fff", borderBottom:"1px solid #e2e8f0", overflowX:"auto" }}>
            {(proc==="inbound"?IB_SUBS:CART_SUBS).map(s=>{
              const active = proc==="inbound"?ibSub===s.key:cartSub===s.key;
              return <button key={s.key} onClick={()=>proc==="inbound"?setIbSub(s.key as InboundSub):setCartSub(s.key as CartSub)}
                style={{ height:30, border:"none", borderRadius:8, padding:"0 13px", fontSize:12, fontWeight:800, cursor:"pointer", transition:".15s", background:active?"linear-gradient(135deg,#153f69,#2673a0)":"transparent", color:active?"#fff":"#64748b", whiteSpace:"nowrap" }}>{s.label}</button>;
            })}
          </div>
        )}
      </div>
      {/* Content */}
      <div style={{ padding:"16px 20px 40px", background:"radial-gradient(circle at 5% 2%,rgba(47,111,237,.07),transparent 24%),radial-gradient(circle at 96% 3%,rgba(15,159,143,.05),transparent 25%),linear-gradient(180deg,#f1f5fa 0,#f7f9fc 300px,#f4f7fa 100%)", minHeight:"100vh" }}>
        {proc==="inbound"&&ibSub==="overview"    && <IBOverview f={filters}/>}
        {proc==="inbound"&&ibSub==="monthly"     && <IBMatrix f={filters} mode="monthly"/>}
        {proc==="inbound"&&ibSub==="daily"       && <IBMatrix f={filters} mode="daily"/>}
        {proc==="inbound"&&ibSub==="hourly"      && <IBHourly f={filters}/>}
        {proc==="inbound"&&ibSub==="agents"      && <IBAgents f={filters}/>}
        {proc==="inbound"&&ibSub==="apr"         && <IBApr f={filters}/>}
        {proc==="inbound"&&ibSub==="disposition" && <IBDisposition f={filters}/>}
        {proc==="reginald-cart"&&cartSub==="sales"     && <CartSales f={filters}/>}
        {proc==="reginald-cart"&&cartSub==="overview"  && <CartOverview f={filters}/>}
        {proc==="reginald-cart"&&cartSub==="monthly"   && <CartMonthly f={filters}/>}
        {proc==="reginald-cart"&&cartSub==="daily"     && <CartDaily f={filters}/>}
        {proc==="reginald-cart"&&cartSub==="analysts"  && <CartAnalysts f={filters}/>}
        {proc==="reginald-cart"&&cartSub==="apr"       && <CartApr f={filters}/>}
        {proc==="molecular-email" && <EmailAprView process="molecular-email" label="Molecular Email" f={filters}/>}
        {proc==="reginald-email"  && <EmailAprView process="reginald-email"  label="Reginald Email"  f={filters}/>}
      </div>
    </DashboardLayout>
  );
}
