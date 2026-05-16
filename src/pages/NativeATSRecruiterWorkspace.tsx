import React, { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

type CandidateRow = {
  candidateId: string;
  qToken?: string;
  fullName?: string;
  mobile?: string;
  email?: string;
  branch?: string;
  roleApplied?: string;
  stage?: string;
  status?: string;
  pendingMinutes?: number;
  recruiterName?: string;
};

type HistoryRow = {
  id: string;
  candidate_code: string;
  q_token?: string;
  recruiter_name?: string;
  submitted_at?: string;
  walkin_end_stage?: string;
  final_decision?: string;
  interviewed_for_process?: string;
  round1_result?: string;
  skill_result?: string;
  round2_result?: string;
  round3_result?: string;
  offer_salary?: string;
  offer_doj?: string;
  previous_submitted_time?: string;
  candidate?: CandidateRow;
};

type Config = {
  processOptions: string[];
  decisionOptions: string[];
  stageOptions: string[];
  vocOptions: string[];
  skillVocOptions: string[];
};

type Form = {
  processName: string;
  finalDecision: string;
  stageName: string;
  round1Result: string;
  round1Voc: string;
  round1Remarks: string;
  skillTypingScore: string;
  skillAiScore: string;
  skillResult: string;
  skillVoc: string;
  skillRemarks: string;
  round2Result: string;
  round2Voc: string;
  round2Remarks: string;
  round3Result: string;
  round3Voc: string;
  round3Remarks: string;
  offerSalary: string;
  offerDoj: string;
  reportingTiming: string;
  otDetails: string;
  performanceIncentives: string;
};

const DEFAULT_CONFIG: Config = {
  processOptions: ["Onfido", "Reginald", "BBB", "GS1", "GPI", "FF", "DRA"],
  decisionOptions: ["Selected", "Rejected", "Hold", "Client Round - Pending", "No Show"],
  stageOptions: ["Arrival", "Round 1- HR Screening", "Interview - Skill Test", "Round 2- Op's", "Round 3- Client", "Selection Discussion"],
  vocOptions: ["Undergraduate / Qualification Issue", "Poor Communication Skill", "Poor Reading / Comprehension", "Salary Issue", "Shift / Timing Issue", "Location / Travel Issue", "Stability Concern", "Documentation Issue", "Role / Process Mismatch", "Candidate Not Interested", "No Show", "Age Barrier"],
  skillVocOptions: ["Typing Speed Issue", "Typing Accuracy Issue", "Pehchan Score Low", "Poor Sales Skill", "Vocabulary / Grammar Issue", "Computer / System Skill Gap", "Assessment Incomplete / Failed"],
};

const EMPTY_FORM: Form = {
  processName: "",
  finalDecision: "",
  stageName: "Arrival",
  round1Result: "",
  round1Voc: "",
  round1Remarks: "",
  skillTypingScore: "",
  skillAiScore: "",
  skillResult: "",
  skillVoc: "",
  skillRemarks: "",
  round2Result: "",
  round2Voc: "",
  round2Remarks: "",
  round3Result: "",
  round3Voc: "",
  round3Remarks: "",
  offerSalary: "",
  offerDoj: "",
  reportingTiming: "",
  otDetails: "",
  performanceIncentives: "",
};

const STAGE_RANK: Record<string, number> = {
  Arrival: 0,
  "Round 1- HR Screening": 1,
  "Interview - Skill Test": 2,
  "Round 2- Op's": 3,
  "Round 3- Client": 4,
  "Selection Discussion": 5,
};

const fmt = (value?: string) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

function Opts({ values }: { values: string[] }) {
  return <>{values.map((v) => <option key={v} value={v}>{v}</option>)}</>;
}

function Badge({ value }: { value?: string }) {
  const text = value || "Waiting";
  const v = text.toLowerCase();
  const cls = v.includes("selected") ? "ok" : v.includes("reject") || v.includes("no show") ? "bad" : v.includes("pending") || v.includes("hold") ? "warn" : "info";
  return <span className={`rw-badge ${cls}`}>{text}</span>;
}

export default function NativeATSRecruiterWorkspace() {
  const [screen, setScreen] = useState<"login" | "workspace" | "form">("login");
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [recruiterName, setRecruiterName] = useState("");
  const [pending, setPending] = useState<CandidateRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [candidateLookup, setCandidateLookup] = useState<Record<string, CandidateRow>>({});
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [selected, setSelected] = useState<CandidateRow | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState("All");
  const [fromDate, setFromDate] = useState(monthStartIso());
  const [toDate, setToDate] = useState(todayIso());

  const rank = STAGE_RANK[form.stageName] ?? 0;

  const loadConfig = async () => {
    try {
      const { data } = await db.rpc("native_ats_get_recruiter_app_config");
      if (data?.ok) {
        setConfig({
          processOptions: data.processOptions?.length ? data.processOptions : DEFAULT_CONFIG.processOptions,
          decisionOptions: data.decisionOptions?.length ? data.decisionOptions : DEFAULT_CONFIG.decisionOptions,
          stageOptions: data.stageOptions?.length ? data.stageOptions : DEFAULT_CONFIG.stageOptions,
          vocOptions: data.vocOptions?.length ? data.vocOptions : DEFAULT_CONFIG.vocOptions,
          skillVocOptions: data.skillVocOptions?.length ? data.skillVocOptions : DEFAULT_CONFIG.skillVocOptions,
        });
      }
    } catch {
      setConfig(DEFAULT_CONFIG);
    }
  };

  const loadHistory = async (name: string) => {
    const from = `${fromDate || "2000-01-01"}T00:00:00`;
    const to = `${toDate || todayIso()}T23:59:59`;
    const { data, error } = await db
      .from("ats_recruiter_submission")
      .select("id,candidate_code,q_token,recruiter_name,submitted_at,walkin_end_stage,final_decision,interviewed_for_process,round1_result,skill_result,round2_result,round3_result,offer_salary,offer_doj,previous_submitted_time")
      .eq("recruiter_name", name)
      .gte("submitted_at", from)
      .lte("submitted_at", to)
      .order("submitted_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const codes = Array.from(new Set((data || []).map((r: HistoryRow) => r.candidate_code).filter(Boolean)));
    const lookup: Record<string, CandidateRow> = {};
    if (codes.length) {
      const { data: candidates } = await db
        .from("ats_candidate")
        .select("candidate_code,full_name,mobile,email,branch_name,role_applied,status,walkin_end_stage")
        .in("candidate_code", codes);
      (candidates || []).forEach((c: any) => {
        lookup[c.candidate_code] = {
          candidateId: c.candidate_code,
          fullName: c.full_name,
          mobile: c.mobile,
          email: c.email,
          branch: c.branch_name,
          roleApplied: c.role_applied,
          status: c.status,
          stage: c.walkin_end_stage,
          recruiterName: name,
        };
      });
    }
    setCandidateLookup(lookup);
    setHistory(data || []);
  };

  const loadPending = async () => {
    const { data, error } = await db.rpc("native_ats_get_pending_candidates", { p_recruiter_code: code.trim(), p_pin: pin.trim() });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.message || "Login failed");
    setRecruiterName(data.recruiterName || "");
    setPending(data.candidates || []);
    await loadHistory(data.recruiterName || "");
  };

  const login = async () => {
    if (!code.trim() || !pin.trim()) {
      setMsg("Recruiter Code and PIN are required.");
      return;
    }
    setLoading(true);
    setMsg("Loading recruiter workspace...");
    try {
      await loadConfig();
      await loadPending();
      setMsg("");
      setScreen("workspace");
    } catch (err: any) {
      setMsg(err.message || "Unable to login");
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    setMsg("");
    try {
      await loadPending();
    } catch (err: any) {
      setMsg(err.message || "Unable to refresh");
    } finally {
      setLoading(false);
    }
  };

  const openForm = (c: CandidateRow, resubmit = false, h?: HistoryRow) => {
    setSelected(c);
    setForm({
      ...EMPTY_FORM,
      processName: h?.interviewed_for_process || "",
      stageName: h?.walkin_end_stage || c.stage || "Arrival",
      finalDecision: resubmit ? "" : h?.final_decision || "",
      round1Result: h?.round1_result || "",
      skillResult: h?.skill_result || "",
      round2Result: h?.round2_result || "",
      round3Result: h?.round3_result || "",
      offerSalary: h?.offer_salary || "",
      offerDoj: h?.offer_doj || "",
    });
    setMsg("");
    setScreen("form");
  };

  const submit = async () => {
    if (!selected) return;
    setLoading(true);
    setMsg("Submitting update...");
    try {
      const payload = { recruiterCode: code.trim(), pin: pin.trim(), candidateId: selected.candidateId, ...form };
      const { data, error } = await db.rpc("native_ats_submit_interview_update", { payload });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || "Submission failed");
      setMsg(data.message || "Update submitted successfully.");
      setScreen("workspace");
      await refresh();
    } catch (err: any) {
      setMsg(err.message || "Unable to submit update");
    } finally {
      setLoading(false);
    }
  };

  const filteredHistory = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter((h) => {
      const c = candidateLookup[h.candidate_code] || {};
      const text = [h.candidate_code, c.fullName, c.mobile, c.email, c.branch, c.roleApplied, h.final_decision, h.walkin_end_stage, h.interviewed_for_process].join(" ").toLowerCase();
      return (!q || text.includes(q)) && (decision === "All" || h.final_decision === decision);
    });
  }, [history, candidateLookup, query, decision]);

  const kpiSelected = history.filter((h) => h.final_decision === "Selected").length;
  const kpiPending = history.filter((h) => h.final_decision === "Client Round - Pending").length;

  const field = (label: string, key: keyof Form, type: "input" | "select" | "textarea", options: string[] = []) => (
    <div>
      <label>{label}</label>
      {type === "textarea" ? <textarea value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /> : type === "select" ? <select value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}><option value="">Select</option><Opts values={options} /></select> : <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} type={key === "offerDoj" ? "date" : key === "reportingTiming" ? "time" : "text"} />}
    </div>
  );

  return (
    <div className="rw-page">
      <style>{`
        .rw-page{min-height:100dvh;background:linear-gradient(135deg,#eff6ff,#f8fafc);font-family:Arial,sans-serif;color:#0f172a}.rw-top{background:linear-gradient(135deg,#0f172a,#1d4ed8,#7c3aed);color:#fff;padding:24px 16px 92px}.rw-top h1{margin:0;font-size:25px}.rw-top p{margin:8px 0 0;color:#dbeafe}.rw-wrap{max-width:1050px;margin:-62px auto 28px;padding:0 14px}.rw-card{background:#fff;border:1px solid #e2e8f0;border-radius:22px;box-shadow:0 12px 32px rgba(15,23,42,.10);padding:18px;margin-bottom:14px}.rw-grid{display:grid;gap:12px}.rw-2{grid-template-columns:1fr 1fr}.rw-3{grid-template-columns:repeat(3,1fr)}@media(max-width:760px){.rw-2,.rw-3{grid-template-columns:1fr}}label{display:block;font-size:13px;font-weight:700;margin:0 0 6px}input,select,textarea,button{font-family:inherit;font-size:15px;border-radius:14px}input,select,textarea{width:100%;border:1px solid #dbe4f0;padding:12px;background:#fff}textarea{min-height:80px}button{border:0;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-weight:800;padding:12px 14px;cursor:pointer}button:disabled{background:#cbd5e1;cursor:not-allowed}.rw-muted{font-size:13px;color:#64748b}.rw-tabs{display:flex;gap:8px;flex-wrap:wrap}.rw-tab{width:auto;background:#e2e8f0;color:#0f172a;box-shadow:none}.rw-tab.on{background:#0f172a;color:#fff}.rw-kpi{border:1px solid #e2e8f0;border-radius:18px;padding:14px;background:#f8fafc}.rw-kpi b{font-size:26px}.rw-item{border:1px solid #e2e8f0;border-radius:18px;padding:14px;margin-top:12px;background:#fff}.rw-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start}.rw-badge{display:inline-block;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800}.rw-badge.ok{background:#ecfdf5;color:#047857}.rw-badge.bad{background:#fff1f2;color:#be123c}.rw-badge.warn{background:#fffbeb;color:#b45309}.rw-badge.info{background:#eff6ff;color:#1d4ed8}.rw-table{width:100%;border-collapse:collapse;min-width:920px}.rw-table th,.rw-table td{text-align:left;padding:12px;border-top:1px solid #e2e8f0;font-size:13px}.rw-table th{background:#f8fafc;color:#64748b;text-transform:uppercase;font-size:11px}.rw-scroll{overflow:auto}.rw-msg{font-weight:800;color:#1d4ed8}.rw-danger{color:#be123c}
      `}</style>
      <div className="rw-top"><h1>Recruiter Workspace</h1><p>Pending queue, full submission history, filters, search, and Client Round Pending resubmission.</p></div>
      <div className="rw-wrap">
        {screen === "login" && <div className="rw-card"><div className="rw-grid rw-2"><div><label>Recruiter Code</label><input value={code} onChange={(e)=>setCode(e.target.value)} /></div><div><label>PIN</label><input type="password" value={pin} onChange={(e)=>setPin(e.target.value)} /></div></div><button disabled={loading} onClick={login} style={{marginTop:12}}>{loading?"Loading...":"Open Workspace"}</button>{msg && <p className="rw-msg">{msg}</p>}</div>}

        {screen === "workspace" && <>
          <div className="rw-card"><div className="rw-row"><div><h2 style={{margin:0}}>{recruiterName}</h2><p className="rw-muted">Recruiter performance and submission workspace.</p></div><button onClick={refresh} disabled={loading} style={{width:"auto"}}>Refresh</button></div>{msg && <p className="rw-msg">{msg}</p>}</div>
          <div className="rw-grid rw-3"><div className="rw-kpi"><span className="rw-muted">Pending Queue</span><br/><b>{pending.length}</b></div><div className="rw-kpi"><span className="rw-muted">Selected in Filter</span><br/><b>{kpiSelected}</b></div><div className="rw-kpi"><span className="rw-muted">Client Pending</span><br/><b>{kpiPending}</b></div></div>
          <div className="rw-card"><div className="rw-tabs"><button className={`rw-tab ${tab==='pending'?'on':''}`} onClick={()=>setTab('pending')}>Pending Queue</button><button className={`rw-tab ${tab==='history'?'on':''}`} onClick={()=>setTab('history')}>Submission History</button></div></div>

          {tab === "pending" && <div className="rw-card"><h3>Assigned Waiting Candidates</h3>{pending.length===0?<p className="rw-muted">No pending candidates.</p>:pending.map((c)=><div className="rw-item" key={c.candidateId}><div className="rw-row"><div><b>{c.fullName}</b><p className="rw-muted">{c.candidateId} • {c.mobile} • {c.branch} • Pending {c.pendingMinutes||0} mins</p><Badge value={c.status}/></div><button style={{width:"auto"}} onClick={()=>openForm(c)}>Open</button></div></div>)}</div>}

          {tab === "history" && <div className="rw-card"><h3>Past Submissions</h3><div className="rw-grid rw-2"><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search name, number, candidate ID, process..."/><select value={decision} onChange={(e)=>setDecision(e.target.value)}><option>All</option><Opts values={config.decisionOptions}/></select><input type="date" value={fromDate} onChange={(e)=>setFromDate(e.target.value)}/><input type="date" value={toDate} onChange={(e)=>setToDate(e.target.value)}/></div><button onClick={refresh} disabled={loading} style={{marginTop:10,width:"auto"}}>Apply Filters</button><div className="rw-scroll" style={{marginTop:12}}><table className="rw-table"><thead><tr><th>Candidate</th><th>Contact</th><th>Decision</th><th>Stage</th><th>Process</th><th>Submitted</th><th>Action</th></tr></thead><tbody>{filteredHistory.map((h)=>{const c=candidateLookup[h.candidate_code]||{};const canResubmit=h.final_decision==='Client Round - Pending';return <tr key={h.id}><td><b>{c.fullName||'-'}</b><br/><span className="rw-muted">{h.candidate_code}</span></td><td>{c.mobile||'-'}<br/><span className="rw-muted">{c.email||''}</span></td><td><Badge value={h.final_decision}/></td><td>{h.walkin_end_stage||'-'}</td><td>{h.interviewed_for_process||'-'}</td><td>{fmt(h.submitted_at)}</td><td><button disabled={!canResubmit} onClick={()=>openForm(c, true, h)}>{canResubmit?'Resubmit':'View Only'}</button></td></tr>})}</tbody></table></div></div>}
        </>}

        {screen === "form" && selected && <div className="rw-card"><button onClick={()=>setScreen('workspace')} style={{width:"auto",background:'#e2e8f0',color:'#0f172a'}}>Back</button><h2>Update Candidate</h2><p className="rw-muted"><b>{selected.fullName}</b> • {selected.candidateId} • {selected.mobile}</p><div className="rw-grid rw-2">{field('Interviewed for Process','processName','select',config.processOptions)}{field('Final Decision','finalDecision','select',config.decisionOptions)}{field('Walk-in End Stage','stageName','select',config.stageOptions)}{rank>=1&&field('Round1 Result','round1Result','select',config.decisionOptions)}{rank>=1&&form.round1Result==='Rejected'&&field('Round1 VOC','round1Voc','select',config.vocOptions)}{rank>=1&&field('Round1 Remarks','round1Remarks','textarea')}{rank>=2&&field('SkillTest AI Score','skillAiScore','input')}{rank>=2&&field('SkillTest Result','skillResult','select',config.decisionOptions)}{rank>=2&&form.skillResult==='Rejected'&&field('SkillTest VOC','skillVoc','select',config.skillVocOptions)}{rank>=2&&field('SkillTest Remarks','skillRemarks','textarea')}{rank>=3&&field('Round2 Result','round2Result','select',config.decisionOptions)}{rank>=3&&form.round2Result==='Rejected'&&field('Round2 VOC','round2Voc','select',config.vocOptions)}{rank>=3&&field('Round2 Remarks','round2Remarks','textarea')}{rank>=4&&field('Round3 Result','round3Result','select',config.decisionOptions)}{rank>=4&&form.round3Result==='Rejected'&&field('Round3 VOC','round3Voc','select',config.vocOptions)}{rank>=4&&field('Round3 Remarks','round3Remarks','textarea')}{form.finalDecision==='Selected'&&field('Offer Salary','offerSalary','input')}{form.finalDecision==='Selected'&&field('Date of Joining','offerDoj','input')}{form.finalDecision==='Selected'&&field('Reporting Timing','reportingTiming','input')}{form.finalDecision==='Selected'&&field('OT Details','otDetails','input')}{form.finalDecision==='Selected'&&field('Performance Incentives','performanceIncentives','input')}</div><button disabled={loading} onClick={submit} style={{marginTop:12}}>{loading?'Submitting...':'Submit Update'}</button>{msg && <p className="rw-msg">{msg}</p>}</div>}
      </div>
    </div>
  );
}
