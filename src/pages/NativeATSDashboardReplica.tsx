import { useEffect, useMemo, useState } from "react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { getAtsDashboardReplicaData, type AtsDashCandidateRow, type AtsDashPayload, type AtsDashQueueRow } from "@/lib/atsDashboardReplicaAdapter";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

type TabKey = "cover" | "dashboard" | "trends" | "rejections" | "recruiters" | "sourcing" | "queue" | "journey" | "intelligence";
type PeriodKey = "FTD" | "WTD" | "MTD" | "ALL";

const tabs: { key: TabKey; label: string }[] = [
  { key: "cover", label: "Cover Page" },
  { key: "dashboard", label: "Dashboard" },
  { key: "trends", label: "Trends" },
  { key: "rejections", label: "Rejection Analysis" },
  { key: "recruiters", label: "Recruiter Productivity" },
  { key: "sourcing", label: "Sourcing Analysis" },
  { key: "queue", label: "Live Queue" },
  { key: "journey", label: "Candidate Journey" },
  { key: "intelligence", label: "Intelligence" },
];

const emptyPayload: AtsDashPayload = {
  ok: true,
  orgName: "ATS Command Center",
  refreshTime: "--",
  todayISO: "",
  options: { months: [], branches: [], roles: [], processes: [], recruiters: [], sourcers: [], slots: [] },
  queueRows: [],
  dashboardRows: [],
  candidateRows: [],
};

const num = (v: any) => Number(v || 0);
const fmt = (n: any) => Number(n || 0).toLocaleString("en-IN");
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "0%");
const todayKey = () => formatISTDate();
const monthKey = () => todayKey().slice(0, 7);
const weekStartKey = () => {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

function getPeriodRows(rows: AtsDashCandidateRow[], period: PeriodKey) {
  if (period === "ALL") return rows;
  if (period === "FTD") return rows.filter((r) => r._dateKey === todayKey());
  if (period === "WTD") return rows.filter((r) => r._dateKey >= weekStartKey() && r._dateKey <= todayKey());
  if (period === "MTD") return rows.filter((r) => r._monthKey === monthKey());
  return rows;
}

function groupRows(rows: AtsDashCandidateRow[], key: keyof AtsDashCandidateRow | ((r: AtsDashCandidateRow) => string)) {
  const map = new Map<string, any>();
  rows.forEach((r) => {
    const name = typeof key === "function" ? key(r) : String(r[key] || "Unspecified");
    const item = map.get(name) || { Name: name, TotalArrival: 0, Selection: 0, Rejection: 0, Hold: 0, Waiting: 0, SlaBreach: 0, AvgTime: 0, _time: 0 };
    item.TotalArrival += 1;
    if (r._selected) item.Selection += 1;
    if (r._rejected || r._noShow) item.Rejection += 1;
    if (r._onHold) item.Hold += 1;
    if (r._waiting) item.Waiting += 1;
    if (r._slaBreached) item.SlaBreach += 1;
    item._time += r._totalMinutes || 0;
    item.AvgTime = Math.round(item._time / item.TotalArrival);
    item.SelectionRate = item.TotalArrival ? item.Selection / item.TotalArrival : 0;
    map.set(name, item);
  });
  return Array.from(map.values()).sort((a, b) => b.TotalArrival - a.TotalArrival);
}

function summary(rows: AtsDashCandidateRow[]) {
  const total = rows.length;
  const selected = rows.filter((r) => r._selected).length;
  const rejected = rows.filter((r) => r._rejected || r._noShow).length;
  const hold = rows.filter((r) => r._onHold).length;
  const waiting = rows.filter((r) => r._waiting).length;
  const sla = rows.filter((r) => r._slaBreached).length;
  const clientPending = rows.filter((r) => String(r.FinalDecision || "").toLowerCase().includes("client round")).length;
  const noShow = rows.filter((r) => r._noShow).length;
  const avg = total ? Math.round(rows.reduce((a, r) => a + (r._totalMinutes || 0), 0) / total) : 0;
  return { total, selected, rejected, hold, waiting, sla, clientPending, noShow, avg, selectionRate: pct(selected, total) };
}

function kpi(label: string, value: any, foot = "") {
  return <div className="kpi"><div className="kLabel">{label}</div><div className="kValue">{value}</div>{foot && <div className="kFoot">{foot}</div>}</div>;
}

function insight(title: string, text: string) {
  return <div className="insight"><strong>{title}</strong><span>{text}</span></div>;
}

function Table({ headers, rows }: { headers: string[]; rows: any[][] }) {
  return <div className="tableWrap"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>) : <tr><td colSpan={headers.length} className="empty">No data</td></tr>}</tbody></table></div>;
}

function Badge({ children, type = "stage" }: { children: any; type?: "ok" | "breach" | "waiting" | "stage" }) {
  return <span className={`badge ${type}`}>{children}</span>;
}

function BarList({ rows, value = "TotalArrival" }: { rows: any[]; value?: string }) {
  const max = Math.max(1, ...rows.map((r) => num(r[value])));
  return <div className="insightList">{rows.slice(0, 8).map((r) => <div className="insight" key={r.Name}><strong>{r.Name}</strong><span>{fmt(r[value])} • Sel {pct(r.Selection, r.TotalArrival)} • SLA {fmt(r.SlaBreach)}</span><div className="barBg"><div style={{ width: `${Math.max(6, (num(r[value]) / max) * 100)}%` }} /></div></div>)}</div>;
}

export default function NativeATSDashboardReplica() {
  const [payload, setPayload] = useState<AtsDashPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [active, setActive] = useState<TabKey>("cover");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [period, setPeriod] = useState<PeriodKey>("FTD");
  const [branch, setBranch] = useState("All");
  const [role, setRole] = useState("All");
  const [recruiter, setRecruiter] = useState("All");
  const [process, setProcess] = useState("All");
  const [journeyQuery, setJourneyQuery] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");
    const data = await getAtsDashboardReplicaData();
    if (!data.ok) setError(data.error || "Dashboard loading failed");
    setPayload(data);
    setLoading(false);
  };

  useEffect(() => { void loadData(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => void loadData(), 60000);
    return () => window.clearInterval(id);
  }, [autoRefresh]);

  const filtered = useMemo(() => {
    let rows = getPeriodRows(payload.candidateRows, period);
    rows = rows.filter((r) => (branch === "All" || r._branch === branch) && (role === "All" || r._role === role) && (recruiter === "All" || r._recruiter === recruiter) && (process === "All" || r._process === process));
    return rows;
  }, [payload.candidateRows, period, branch, role, recruiter, process]);

  const s = summary(filtered);
  const branchRows = groupRows(filtered, "_branch");
  const processRows = groupRows(filtered, "_process");
  const recruiterRows = groupRows(filtered, "_recruiter");
  const sourceRows = groupRows(filtered, "_source");
  const slotRows = groupRows(filtered, "_slot");
  const rejectionRows = filtered.filter((r) => r._rejected || r._noShow || r._hardRejectReason);
  const queueRows = payload.queueRows;

  const journeyMatches = useMemo(() => {
    const q = journeyQuery.trim().toLowerCase();
    if (!q) return [] as AtsDashCandidateRow[];
    return payload.candidateRows.map((r) => {
      let score = 0;
      const id = String(r.CandidateID || "").toLowerCase();
      const token = String(r.QToken || "").toLowerCase();
      const email = String(r.Email || "").toLowerCase();
      const mobile = String(r.Mobile || "").replace(/\D/g, "");
      const name = String(r.FullName || "").toLowerCase();
      const digits = q.replace(/\D/g, "");
      if (id === q) score += 100;
      if (token === q) score += 95;
      if (email === q) score += 90;
      if (digits && mobile === digits) score += 88;
      if (name === q) score += 80;
      if (id.includes(q)) score += 40;
      if (token.includes(q)) score += 38;
      if (email.includes(q)) score += 35;
      if (digits && mobile.includes(digits)) score += 34;
      if (name.includes(q)) score += 30;
      return { row: r, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.row).slice(0, 5);
  }, [payload.candidateRows, journeyQuery]);

  const renderCover = () => <>
    <div className="grid4">{kpi("Total Arrival", fmt(s.total), `Selection ${s.selectionRate}`)}{kpi("Selection", fmt(s.selected), "Selected candidates")}{kpi("Live Waiting", fmt(queueRows.length), "Queue_View equivalent")}{kpi("SLA Breach", fmt(queueRows.filter((r) => r.SLAFlag === "BREACH").length), "120 mins SLA")}</div>
    <div className="ceoGrid"><div className="card"><div className="title">Critical insights</div><div className="desc">Highest priority alerts and wins for leadership.</div><div className="insightList">{queueRows.filter((r) => r.SLAFlag === "BREACH").length ? insight("Live breach pressure", `${fmt(queueRows.filter((r) => r.SLAFlag === "BREACH").length)} live queue cases are already in breach status.`) : insight("Queue discipline", "No live breach currently visible in Queue_View equivalent.")}{s.clientPending ? insight("Client round pending", `${fmt(s.clientPending)} client round pending cases need same-day follow-up.`) : insight("Client pending", "No client round pending cases in selected period.")}{s.noShow ? insight("No-show recovery", `${fmt(s.noShow)} no-show cases can be recovered by recruiter follow-up.`) : insight("No-show", "No no-show spike in selected period.")}</div></div><div className="card"><div className="title">Current waiting status</div><div className="desc">Highest risk live queue cases.</div><Table headers={["Token","Candidate","Branch","Waiting","SLA"]} rows={queueRows.slice(0, 10).map((r) => [r.QToken, r.FullName, r.Branch, r.waitingLabel, <Badge type={r.SLAFlag === "BREACH" ? "breach" : "ok"}>{r.SLAFlag}</Badge>])} /></div></div>
    <div className="grid3"><div className="card"><div className="title">Branch performance snapshot</div><BarList rows={branchRows} /></div><div className="card"><div className="title">Risk center</div><BarList rows={sourceRows} /></div><div className="card"><div className="title">Top / Bottom Recruiters</div><BarList rows={recruiterRows} /></div></div>
  </>;

  const renderDashboard = () => <>
    <div className="filters"><div className="field"><label>Period</label><select value={period} onChange={(e)=>setPeriod(e.target.value as PeriodKey)}><option>FTD</option><option>WTD</option><option>MTD</option><option>ALL</option></select></div><div className="field"><label>Branch</label><select value={branch} onChange={(e)=>setBranch(e.target.value)}><option>All</option>{payload.options.branches.map((x)=><option key={x}>{x}</option>)}</select></div><div className="field"><label>Role</label><select value={role} onChange={(e)=>setRole(e.target.value)}><option>All</option>{payload.options.roles.map((x)=><option key={x}>{x}</option>)}</select></div><div className="field"><label>Recruiter</label><select value={recruiter} onChange={(e)=>setRecruiter(e.target.value)}><option>All</option>{payload.options.recruiters.map((x)=><option key={x}>{x}</option>)}</select></div><div className="field"><label>Process</label><select value={process} onChange={(e)=>setProcess(e.target.value)}><option>All</option>{payload.options.processes.map((x)=><option key={x}>{x}</option>)}</select></div></div>
    <div className="grid5">{kpi("Arrival", fmt(s.total))}{kpi("Selection", fmt(s.selected), s.selectionRate)}{kpi("Rejection", fmt(s.rejected))}{kpi("Pending", fmt(s.waiting))}{kpi("Avg Time", `${fmt(s.avg)}m`)}</div>
    <div className="grid2"><div className="card"><div className="title">Branch Funnel</div><Table headers={["Branch","Arrival","Selected","Rejected","Waiting","Sel %","SLA"]} rows={branchRows.map((r)=>[r.Name, fmt(r.TotalArrival), fmt(r.Selection), fmt(r.Rejection), fmt(r.Waiting), pct(r.Selection,r.TotalArrival), fmt(r.SlaBreach)])}/></div><div className="card"><div className="title">Process Funnel</div><Table headers={["Process","Arrival","Selected","Rejected","Waiting","Sel %","Avg"]} rows={processRows.map((r)=>[r.Name, fmt(r.TotalArrival), fmt(r.Selection), fmt(r.Rejection), fmt(r.Waiting), pct(r.Selection,r.TotalArrival), `${fmt(r.AvgTime)}m`])}/></div></div>
  </>;

  const renderTrends = () => <div className="grid2"><div className="card"><div className="title">Daily trend</div><Table headers={["Date","Arrival","Selection","Rejection","Hold","Pending","SLA","Avg"]} rows={payload.dashboardRows.map((r)=>[r.Date, fmt(r["Total Arrival"]), fmt(r.Selection), fmt(r.Rejection), fmt(r["On Hold"]), fmt(r.Pending), fmt(r["SLA Breach"]), `${fmt(r["Avg Time"])}m`])}/></div><div className="card"><div className="title">Slot conversion</div><Table headers={["Slot","Walk-in","Selected","Rejected","Waiting","Sel %"]} rows={slotRows.map((r)=>[r.Name, fmt(r.TotalArrival), fmt(r.Selection), fmt(r.Rejection), fmt(r.Waiting), pct(r.Selection,r.TotalArrival)])}/></div></div>;

  const renderRejections = () => <div className="grid2"><div className="card"><div className="title">Rejection Analysis</div><Table headers={["Candidate","Branch","Process","Stage","VOC / Reason","Decision"]} rows={rejectionRows.slice(0, 200).map((r)=>[r.FullName, r.Branch, r.Process, r._endStage, r._hardRejectReason || Object.values(r._stageVoc || {}).find(Boolean) || "-", r.FinalDecision])}/></div><div className="card"><div className="title">Stage rejection leakage</div><BarList rows={groupRows(rejectionRows, (r)=>r._endStage || "Unspecified")} /></div></div>;

  const renderRecruiters = () => <div className="card"><div className="title">Recruiter Productivity</div><div className="desc">Sourced, attended, selection %, SLA breach and average wait.</div><Table headers={["Recruiter","Sourced","Selected","Rejected","Waiting","Sel %","SLA","Avg Wait"]} rows={recruiterRows.map((r)=>[r.Name, fmt(r.TotalArrival), fmt(r.Selection), fmt(r.Rejection), fmt(r.Waiting), pct(r.Selection,r.TotalArrival), fmt(r.SlaBreach), `${fmt(r.AvgTime)}m`])}/></div>;

  const renderSourcing = () => <div className="grid2"><div className="card"><div className="title">Sourcing Analysis</div><div className="desc">Current native source foundation mapped from candidate Source / source_system / recruiter selected.</div><Table headers={["Source","Walk-in","Selected","Rejected","Waiting","Sel %","Quality"]} rows={sourceRows.map((r)=>[r.Name, fmt(r.TotalArrival), fmt(r.Selection), fmt(r.Rejection), fmt(r.Waiting), pct(r.Selection,r.TotalArrival), r.SelectionRate >= .5 ? "High" : r.SelectionRate >= .25 ? "Medium" : "Low"])}/></div><div className="card"><div className="title">Reusable Pool</div><Table headers={["Candidate","Branch","Source","Reason","Quality"]} rows={filtered.filter((r)=>r._reusableReason).slice(0,100).map((r)=>[r.FullName, r.Branch, r._source, r._reusableReason, r._candidateQualityLabel])}/></div></div>;

  const renderQueue = () => <div className="grid2"><div className="card"><div className="title">Live Queue</div><div className="desc">Queue_View equivalent: only live waiting-at-arrival candidates stay here.</div><Table headers={["Token","Candidate","Branch","Role","Recruiter","Waiting","SLA"]} rows={queueRows.map((r)=>[r.QToken, r.FullName, r.Branch, r.RoleApplied, r.RecruiterAssignedName, r.waitingLabel, <Badge type={r.SLAFlag === "BREACH" ? "breach" : "ok"}>{r.SLAFlag}</Badge>])}/></div><div className="card"><div className="title">Queue Pressure</div><BarList rows={groupRows(filtered.filter((r)=>r._waiting), "_branch")} /></div></div>;

  const renderJourney = () => <div className="card"><div className="title">Candidate Journey</div><div className="journeyToolbar"><div className="field"><label>Search by CandidateID / QToken / Mobile / Email / Name</label><input value={journeyQuery} onChange={(e)=>setJourneyQuery(e.target.value)} placeholder="Type candidate id, qtoken, mobile, email or name" /></div></div>{journeyMatches.length ? journeyMatches.map((r)=><div className="journeyCard" key={r.CandidateID}><div className="journeyGrid"><div className="kpi"><div className="kLabel">Candidate</div><div className="kValue" style={{fontSize:22}}>{r.FullName}</div><div className="kFoot">{r.CandidateID} • {r.QToken}</div></div><div className="kpi"><div className="kLabel">Branch / Role</div><div className="kValue" style={{fontSize:22}}>{r.Branch}</div><div className="kFoot">{r.RoleApplied}</div></div><div className="kpi"><div className="kLabel">Decision</div><div className="kValue" style={{fontSize:22}}>{r.FinalDecision}</div><div className="kFoot">{r._endStage}</div></div><div className="kpi"><div className="kLabel">Quality</div><div className="kValue" style={{fontSize:22}}>{r._candidateQualityScore}</div><div className="kFoot">{r._candidateQualityLabel}</div></div></div><div className="timeline"><div className="timelineItem"><div className="timelineTitle">Registration</div><div className="mini">{r.CreatedDate} {r.CreatedTime} • {r.Source}</div></div><div className="timelineItem"><div className="timelineTitle">Recruiter Assigned</div><div className="mini">{r.RecruiterAssignedName} • {r.RecruiterMobile}</div></div><div className="timelineItem"><div className="timelineTitle">Interview Movement</div><div className="mini">Round1: {r.Round1_Result || "-"} • Skill: {r.SkillTest_Result || "-"} • Ops: {r.Round2_Result || "-"} • Client: {r.Round3_Result || "-"}</div></div></div></div>) : <div className="journeyPlaceholder">Search candidate to view journey.</div>}</div>;

  const renderIntelligence = () => <div className="grid3"><div className="card"><div className="title">Real-time Alerts</div><div className="alertGrid"><div className="alertCard"><div className="label">Live Breaches</div><div className="value">{fmt(queueRows.filter((r)=>r.SLAFlag==='BREACH').length)}</div><div className="sub">Immediate attention</div></div><div className="alertCard"><div className="label">About To Breach</div><div className="value">{fmt(queueRows.filter((r)=>r.WaitingMinutes>=90 && r.WaitingMinutes<120).length)}</div><div className="sub">Next SLA risk</div></div></div></div><div className="card"><div className="title">Reusable Candidates</div><BarList rows={groupRows(filtered.filter((r)=>r._reusableReason), "_source")} /></div><div className="card"><div className="title">Best Slot Window</div><BarList rows={slotRows} /></div></div>;

  const renderActive = () => ({ cover: renderCover, dashboard: renderDashboard, trends: renderTrends, rejections: renderRejections, recruiters: renderRecruiters, sourcing: renderSourcing, queue: renderQueue, journey: renderJourney, intelligence: renderIntelligence }[active]());

  return <div className="ats-replica"><style>{css}</style><div className="wrap"><div id="loadingBox" className="box loading" style={{display: loading ? "block" : "none"}}>Loading dashboard...</div>{error && <div className="box error" style={{display:"block"}}>{error}<div className="errorActions"><button onClick={loadData}>Retry</button><button className="secondary" onClick={()=>setError("")}>Dismiss</button></div></div>}<section className="hero"><div className="card"><div className="pill">Cover Page</div><h1>ATS Command Center</h1><p className="sub">Executive recruitment dashboard for leadership, branch performance, recruiter effectiveness, sourcing quality, queue risk, and conversion leakage.</p><div className="heroMeta"><div className="meta">FTD = today till now</div><div className="meta">WTD = current week till now</div><div className="meta">MTD = current month till now</div></div></div><div className="heroActions card"><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}><div><div className="pill" style={{background:"rgba(56,211,159,.10)",borderColor:"rgba(56,211,159,.18)"}}>Live status</div><div style={{marginTop:10,fontSize:13,color:"var(--muted)"}}>Compact leadership control with fast review visibility.</div></div><div className="liveDot" /></div><div className="btnRow"><button onClick={loadData}>Refresh</button><button className="secondary" onClick={()=>setAutoRefresh(!autoRefresh)}>{autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}</button></div><div className="meta">Updated: <strong>{payload.refreshTime}</strong><div className="refreshState">Auto-refresh is {autoRefresh ? "active" : "paused"}</div></div></div></section><div className="tabsRow"><div className="tabs">{tabs.map((t)=><div key={t.key} className={`tab ${active===t.key?"active":""}`} onClick={()=>setActive(t.key)}>{t.label}</div>)}</div></div><section className="view active">{renderActive()}</section></div></div>;
}

const css = `
:root{--bg:#07111e;--panel:#0d1b2d;--panel2:#12253d;--muted:#8ea6c9;--text:#edf4ff;--line:rgba(255,255,255,.08);--blue:#3ba8ff;--blue2:#7bcfff;--green:#38d39f;--amber:#ffb84d;--pink:#ff6f91;--violet:#9e8dff;--shadow:0 16px 48px rgba(0,0,0,.28);--radius:18px}.ats-replica *{box-sizing:border-box}.ats-replica{min-height:100vh;margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;color:var(--text);background:radial-gradient(circle at top left,rgba(59,168,255,.18),transparent 24%),radial-gradient(circle at top right,rgba(123,207,255,.14),transparent 22%),linear-gradient(180deg,#040914 0%,#091425 60%,#07111e 100%)}.wrap{max-width:1600px;margin:0 auto;padding:14px}.box,.hero,.card,.tab,.kpi,.summaryStrip,.insight,.topbar,.chip,.funnelCard{border:1px solid var(--line);background:rgba(13,27,45,.94);box-shadow:var(--shadow);border-radius:var(--radius);backdrop-filter:blur(12px)}.loading{padding:12px 14px;margin-bottom:10px}.error{white-space:pre-wrap;padding:12px 14px;margin-bottom:10px;background:rgba(255,111,145,.12);border-color:rgba(255,111,145,.2);color:#ffdbe5}.hero{padding:18px 20px;margin-bottom:12px;display:grid;grid-template-columns:1.3fr .9fr;gap:12px;position:relative;overflow:hidden}.hero:after{content:'';position:absolute;right:-70px;top:-80px;width:220px;height:220px;background:radial-gradient(circle,rgba(123,207,255,.25),transparent 70%)}h1{margin:8px 0 6px;font-size:clamp(24px,3vw,36px);line-height:1.02;letter-spacing:-.03em}.sub{margin:0;color:var(--muted);font-size:13px;line-height:1.5}.pill{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:rgba(59,168,255,.12);border:1px solid rgba(59,168,255,.18);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.heroMeta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.meta{padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.06);font-size:13px;color:#d9e7ff}.heroActions{display:flex;flex-direction:column;justify-content:space-between;gap:12px;padding:16px}.liveDot{width:10px;height:10px;border-radius:50%;background:var(--green);box-shadow:0 0 0 8px rgba(56,211,159,.14)}.btnRow{display:flex;gap:8px;flex-wrap:wrap}button{border:none;border-radius:12px;padding:10px 14px;font-weight:800;cursor:pointer;color:#04111f;background:linear-gradient(135deg,var(--blue),var(--blue2));box-shadow:0 8px 18px rgba(59,168,255,.18)}button.secondary{background:rgba(255,255,255,.06);color:var(--text);border:1px solid rgba(255,255,255,.08);box-shadow:none}.tabsRow{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}.tabs{display:flex;gap:8px;flex-wrap:wrap}.tab{padding:10px 14px;font-size:13px;font-weight:800;color:var(--muted);cursor:pointer}.tab.active{color:#fff;background:linear-gradient(135deg,rgba(59,168,255,.18),rgba(123,207,255,.10));border-color:rgba(123,207,255,.24)}.view{display:block}.grid2,.grid3,.grid4,.grid5,.ceoGrid,.kpiGrid,.filters,.funnelGrid{display:grid;gap:12px;margin-bottom:12px}.grid2{grid-template-columns:1.2fr 1fr}.grid3{grid-template-columns:repeat(3,minmax(0,1fr))}.grid4{grid-template-columns:repeat(4,minmax(0,1fr))}.grid5{grid-template-columns:repeat(5,minmax(0,1fr))}.ceoGrid{grid-template-columns:1.2fr 1fr}.filters{grid-template-columns:repeat(5,minmax(0,1fr))}.card{padding:14px;min-height:120px}.title{font-size:16px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px}.desc{font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:10px}.field{display:flex;flex-direction:column;gap:5px}.field label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:700}.field input,.field select{width:100%;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:#0c1a2c;color:var(--text);padding:10px 12px;outline:none}.field select option{background:#0c1a2c;color:var(--text)}.kpi{padding:12px 14px;position:relative;overflow:hidden}.kpi:before{content:'';position:absolute;inset:0;background:linear-gradient(145deg,rgba(255,255,255,.05),transparent 55%);pointer-events:none}.kLabel{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:800}.kValue{margin-top:8px;font-size:clamp(24px,3vw,36px);font-weight:900;letter-spacing:-.03em}.kFoot{margin-top:6px;font-size:13px;color:#bfd0ea}.insightList{display:grid;gap:10px}.insight{padding:11px 12px;background:rgba(255,255,255,.04)}.insight strong{display:block;margin-bottom:4px}.barBg{height:8px;border-radius:999px;background:rgba(255,255,255,.07);margin-top:8px;overflow:hidden}.barBg>div{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--blue2))}.tableWrap{max-height:500px;overflow:auto;border-radius:14px;border:1px solid rgba(255,255,255,.06)}table{width:100%;border-collapse:collapse}thead th{position:sticky;top:0;z-index:1;background:rgba(8,17,31,.96);font-size:12px;text-transform:uppercase;letter-spacing:.08em;padding:11px 10px;text-align:left;color:#dcecff;border-bottom:1px solid rgba(255,255,255,.08)}tbody td{padding:10px;border-bottom:1px solid rgba(255,255,255,.05);font-size:14px;vertical-align:top}tbody tr:hover{background:rgba(255,255,255,.03)}.empty{padding:24px 14px;text-align:center;color:var(--muted)}.badge{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border-radius:999px;font-size:12px;font-weight:800}.ok{background:rgba(56,211,159,.14);color:#8cf5cb}.breach{background:rgba(255,111,145,.16);color:#ffb6c8}.waiting{background:rgba(255,184,77,.16);color:#ffd59d}.stage{background:rgba(59,168,255,.14);color:#d4f1ff}.mini{margin-top:3px;font-size:11px;color:var(--muted)}.journeyToolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.journeyToolbar .field{flex:1 1 360px}.journeyCard{padding:14px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);margin-top:12px}.journeyGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:12px}.timeline{display:grid;gap:10px}.timelineItem{padding:12px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}.timelineTitle{font-size:15px;font-weight:800}.journeyPlaceholder{padding:28px 16px;text-align:center;color:var(--muted)}.alertGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:12px}.alertCard{padding:12px 14px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);box-shadow:var(--shadow)}.alertCard .label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:800}.alertCard .value{margin-top:6px;font-size:22px;font-weight:900;letter-spacing:-.03em}.alertCard .sub{margin-top:4px;font-size:13px;color:#bfd0ea}.errorActions{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap}.refreshState{font-size:11px;color:var(--muted);margin-top:6px}@media(max-width:1180px){.hero,.grid2,.grid3,.grid4,.grid5,.ceoGrid,.filters{grid-template-columns:1fr 1fr}}@media(max-width:760px){.hero,.grid2,.grid3,.grid4,.grid5,.ceoGrid,.filters,.journeyGrid{grid-template-columns:1fr}.wrap{padding:12px 10px 20px}}
`;
