import React, { useEffect, useMemo, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";

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
  candidate_id: string;
  candidate_code?: string;
  q_token?: string;
  recruiter_code?: string;
  submitted_at?: string;
  walkin_end_stage?: string;
  final_decision?: string;
  interviewed_for_process?: string;
  round1_result?: string;
  skilltest_result?: string;
  round2_result?: string;
  round3_result?: string;
  offer_salary?: string;
  offer_doj?: string;
  previous_submitted_time?: string;
  full_name?: string;
  mobile?: string;
  email?: string;
  onboarding_status?: string;
  onboarding_token_expires_at?: string;
  onboarding_joining_date?: string;
};

type RecruiterProfile = {
  id: string;
  name: string;
  recruiterCode: string;
  branch: string;
  email: string | null;
  employeeId: string | null;
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

const localDateIso = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const todayIso = () => localDateIso();
const monthStartIso = () => { const d = new Date(); return localDateIso(new Date(d.getFullYear(), d.getMonth(), 1)); };

function Opts({ values }: { values: string[] }) {
  return <>{values.map((v) => <option key={v} value={v}>{v}</option>)}</>;
}

function Badge({ value }: { value?: string }) {
  const text = value || "Waiting";
  const v = text.toLowerCase();
  const cls = v.includes("selected") ? "ok" : v.includes("reject") || v.includes("no show") ? "bad" : v.includes("pending") || v.includes("hold") ? "warn" : "info";
  return <span className={`rw-badge ${cls}`}>{text}</span>;
}

// Client-side validation mirrors backend rules
function validateForm(form: Form): string | null {
  if (!form.processName) return "Interviewed for Process is required.";
  if (!form.finalDecision) return "Final Decision is required.";
  if (!form.stageName) return "Walk-in End Stage is required.";
  const rank = STAGE_RANK[form.stageName] ?? -1;
  if (rank < 0) return `Invalid Walk-in End Stage: "${form.stageName}"`;
  if (rank >= 1) {
    if (!form.round1Result) return "Round1 Result is required from Round 1 stage onwards.";
    if (form.round1Result === "Rejected" && !form.round1Voc) return "Round1 VOC is required when Round1 Result is Rejected.";
  }
  if (form.skillResult === "Rejected" && !form.skillVoc) return "SkillTest VOC is required when SkillTest Result is Rejected.";
  if (rank >= 3) {
    if (!form.round2Result) return "Round2 Result is required from Round 2 stage onwards.";
    if (form.round2Result === "Rejected" && !form.round2Voc) return "Round2 VOC is required when Round2 Result is Rejected.";
  }
  if (rank >= 4) {
    if (!form.round3Result) return "Round3 Result is required from Round 3 stage onwards.";
    if (form.round3Result === "Rejected" && !form.round3Voc) return "Round3 VOC is required when Round3 Result is Rejected.";
  }
  if (form.finalDecision === "Selected") {
    if (!form.offerSalary) return "Offer Salary is required when Final Decision is Selected.";
    if (!form.offerDoj) return "Date of Joining is required when Final Decision is Selected.";
    if (!form.reportingTiming) return "Reporting Timing is required when Final Decision is Selected.";
  }
  return null;
}

// Auto-cascade round results when finalDecision = Selected; clear when not Selected
function cascadeSelected(form: Form): Form {
  const rank = STAGE_RANK[form.stageName] ?? 0;
  const updated = { ...form };
  if (form.finalDecision === "Selected") {
    if (rank >= 1) updated.round1Result = "Selected";
    if (rank >= 3) updated.round2Result = "Selected";
    if (rank >= 4) updated.round3Result = "Selected";
  } else {
    // Clear cascaded fields so recruiter must fill them explicitly
    if (updated.round1Result === "Selected") updated.round1Result = "";
    if (updated.round2Result === "Selected") updated.round2Result = "";
    if (updated.round3Result === "Selected") updated.round3Result = "";
    updated.offerSalary = "";
    updated.offerDoj = "";
    updated.reportingTiming = "";
    updated.otDetails = "";
    updated.performanceIncentives = "";
  }
  return updated;
}

export default function NativeATSRecruiterWorkspace() {
  const [screen, setScreen] = useState<"workspace" | "form">("workspace");
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [recruiterProfile, setRecruiterProfile] = useState<RecruiterProfile | null>(null);
  const [pending, setPending] = useState<CandidateRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [config] = useState<Config>(DEFAULT_CONFIG);
  const [selected, setSelected] = useState<CandidateRow | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState("All");
  const [fromDate, setFromDate] = useState(monthStartIso());
  const [toDate, setToDate] = useState(todayIso());

  const rank = STAGE_RANK[form.stageName] ?? 0;

  const loadPending = async () => {
    const res = await hrmsApi.get<{ success: boolean; data: any[]; recruiter?: RecruiterProfile | null }>(
      "/api/ats/recruiter/my-candidates"
    );
    setRecruiterProfile(res.recruiter ?? null);
    setPending((res.data ?? []).map((c: any) => ({
      candidateId: c.candidateId,
      qToken: c.qToken ?? null,
      fullName: c.fullName,
      mobile: c.mobile,
      branch: c.branch,
      roleApplied: c.process,
      status: c.status,
      stage: c.status,
      recruiterName: c.recruiterName ?? res.recruiter?.name,
      pendingMinutes: c.pendingMinutes ?? 0,
    })));
  };

  const loadHistory = async () => {
    const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
      "/api/ats/recruiter/submission-history"
    );
    setHistory(res.data ?? []);
  };

  const loadWorkspace = async () => {
    setLoading(true);
    setMsg("Loading workspace...");
    try {
      await Promise.all([loadPending(), loadHistory()]);
      setMsg("");
    } catch (err: any) {
      const detail = err?.response?.data?.message || err.message || "Unable to load recruiter workspace";
      setMsg(detail);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    setMsg("");
    try {
      await Promise.all([loadPending(), loadHistory()]);
    } catch (err: any) {
      setMsg(err.message || "Unable to refresh");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  const openForm = (c: CandidateRow, resubmit = false, h?: HistoryRow) => {
    setSelected(c);
    setForm({
      ...EMPTY_FORM,
      processName: h?.interviewed_for_process || "",
      stageName: h?.walkin_end_stage || c.stage || "Arrival",
      finalDecision: resubmit ? "" : h?.final_decision || "",
      round1Result: h?.round1_result || "",
      skillResult: h?.skilltest_result || "",
      round2Result: h?.round2_result || "",
      round3Result: h?.round3_result || "",
      offerSalary: h?.offer_salary || "",
      offerDoj: h?.offer_doj || "",
    });
    setMsg("");
    setScreen("form");
  };

  const updateForm = (patch: Partial<Form>) => {
    setForm((prev) => {
      const updated = { ...prev, ...patch };
      if ("finalDecision" in patch || "stageName" in patch) {
        return cascadeSelected(updated);
      }
      return updated;
    });
  };

  const submit = async () => {
    if (!selected || !recruiterProfile) return;
    const validationError = validateForm(form);
    if (validationError) {
      setMsg(validationError);
      return;
    }
    setLoading(true);
    setMsg("Submitting update...");
    try {
      await hrmsApi.post("/api/ats-full-parity/recruiter-submission", {
        recruiterCode: recruiterProfile.recruiterCode,
        candidateId: selected.candidateId,
        qToken: selected.qToken,
        interviewedForProcess: form.processName,
        walkinEndStage: form.stageName,
        finalDecision: form.finalDecision,
        round1Result: form.round1Result || null,
        round1Voc: form.round1Voc || null,
        round1Remarks: form.round1Remarks || null,
        skillTestTyping: form.skillTypingScore ? Number(form.skillTypingScore) : null,
        skillTestAi: form.skillAiScore ? Number(form.skillAiScore) : null,
        skillTestResult: form.skillResult || null,
        skillTestVoc: form.skillVoc || null,
        skillTestRemarks: form.skillRemarks || null,
        round2Result: form.round2Result || null,
        round2Voc: form.round2Voc || null,
        round2Remarks: form.round2Remarks || null,
        round3Result: form.round3Result || null,
        round3Voc: form.round3Voc || null,
        round3Remarks: form.round3Remarks || null,
        offerSalary: form.offerSalary ? Number(form.offerSalary) : null,
        offerDoj: form.offerDoj || null,
        reportingTiming: form.reportingTiming || null,
        otDetails: form.otDetails || null,
        performanceIncentives: form.performanceIncentives || null,
      });
      setMsg("Update submitted successfully.");
      setScreen("workspace");
      await refresh();
    } catch (err: any) {
      const detail = err?.response?.data?.message || err.message || "Unable to submit update";
      setMsg(detail);
    } finally {
      setLoading(false);
    }
  };

  const filteredHistory = useMemo(() => {
    const q = query.trim().toLowerCase();
    const decisionFilter = decision.replace(/^[^\w]+/, '').trim(); // strip emoji prefix
    return history.filter((h) => {
      const text = [h.candidate_id, h.full_name, h.mobile, h.final_decision, h.walkin_end_stage, h.interviewed_for_process].join(" ").toLowerCase();
      const dateStr = h.submitted_at ? h.submitted_at.slice(0, 10) : '';
      const inRange = (!fromDate || dateStr >= fromDate) && (!toDate || dateStr <= toDate);
      const decisionMatch = decisionFilter === 'All' || h.final_decision === decisionFilter;
      return (!q || text.includes(q)) && decisionMatch && inRange;
    });
  }, [history, query, decision, fromDate, toDate]);

  const kpiSelected = history.filter((h) => h.final_decision === "Selected").length;
  const kpiPending = history.filter((h) => h.final_decision === "Client Round - Pending").length;

  const field = (label: string, key: keyof Form, type: "input" | "select" | "textarea", options: string[] = []) => (
    <div>
      <label>{label}</label>
      {type === "textarea"
        ? <textarea value={form[key]} onChange={(e) => updateForm({ [key]: e.target.value })} />
        : type === "select"
        ? <select value={form[key]} onChange={(e) => updateForm({ [key]: e.target.value })}><option value="">Select</option><Opts values={options} /></select>
        : <input value={form[key]} onChange={(e) => updateForm({ [key]: e.target.value })} type={key === "offerDoj" ? "date" : key === "reportingTiming" ? "time" : "text"} />}
    </div>
  );

  return (
    <div className="rw-page">
      <style>{`
        .rw-page{min-height:100dvh;background:linear-gradient(135deg,#eff6ff,#f8fafc);font-family:Arial,sans-serif;color:#0f172a}.rw-top{background:linear-gradient(135deg,#0f172a,#1d4ed8,#7c3aed);color:#fff;padding:24px 16px 92px}.rw-top h1{margin:0;font-size:25px}.rw-top p{margin:8px 0 0;color:#dbeafe}.rw-wrap{max-width:1050px;margin:-62px auto 28px;padding:0 14px}.rw-card{background:#fff;border:1px solid #e2e8f0;border-radius:22px;box-shadow:0 12px 32px rgba(15,23,42,.10);padding:18px;margin-bottom:14px}.rw-grid{display:grid;gap:12px}.rw-2{grid-template-columns:1fr 1fr}.rw-3{grid-template-columns:repeat(3,1fr)}@media(max-width:760px){.rw-2,.rw-3{grid-template-columns:1fr}}label{display:block;font-size:13px;font-weight:700;margin:0 0 6px}input,select,textarea,button{font-family:inherit;font-size:15px;border-radius:14px}input,select,textarea{width:100%;border:1px solid #dbe4f0;padding:12px;background:#fff}textarea{min-height:80px}button{border:0;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-weight:800;padding:12px 14px;cursor:pointer}button:disabled{background:#cbd5e1;cursor:not-allowed}.rw-muted{font-size:13px;color:#64748b}.rw-tabs{display:flex;gap:8px;flex-wrap:wrap}.rw-tab{width:auto;background:#e2e8f0;color:#0f172a;box-shadow:none}.rw-tab.on{background:#0f172a;color:#fff}.rw-kpi{border:1px solid #e2e8f0;border-radius:18px;padding:14px;background:#f8fafc}.rw-kpi b{font-size:26px}.rw-item{border:1px solid #e2e8f0;border-radius:18px;padding:14px;margin-top:12px;background:#fff}.rw-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start}.rw-badge{display:inline-block;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800}.rw-badge.ok{background:#ecfdf5;color:#047857}.rw-badge.bad{background:#fff1f2;color:#be123c}.rw-badge.warn{background:#fffbeb;color:#b45309}.rw-badge.info{background:#eff6ff;color:#1d4ed8}.rw-table{width:100%;border-collapse:collapse;min-width:920px}.rw-table th,.rw-table td{text-align:left;padding:12px;border-top:1px solid #e2e8f0;font-size:13px}.rw-table th{background:#f8fafc;color:#64748b;text-transform:uppercase;font-size:11px}.rw-scroll{overflow:auto}.rw-msg{font-weight:800;color:#1d4ed8}.rw-danger{color:#be123c}
      `}</style>
      <div className="rw-top"><h1>Recruiter Workspace</h1><p>Pending queue, full submission history, filters, search, and Client Round Pending resubmission.</p></div>
      <div className="rw-wrap">
        {screen === "workspace" && <>
          <div className="rw-card"><div className="rw-row"><div><h2 style={{margin:0}}>{recruiterProfile?.name ?? "Recruiter Workspace"}</h2><p className="rw-muted">{recruiterProfile ? `${recruiterProfile.recruiterCode} • ${recruiterProfile.branch}` : "Showing authorised candidate queue"}</p></div><button onClick={refresh} disabled={loading} style={{width:"auto"}}>Refresh</button></div>{msg && <p className="rw-msg">{msg}</p>}</div>
          <div className="rw-grid rw-3"><div className="rw-kpi"><span className="rw-muted">Pending Queue</span><br/><b>{pending.length}</b></div><div className="rw-kpi"><span className="rw-muted">Selected Today</span><br/><b>{kpiSelected}</b></div><div className="rw-kpi"><span className="rw-muted">Client Pending</span><br/><b>{kpiPending}</b></div></div>
          <div className="rw-card"><div className="rw-tabs"><button className={`rw-tab ${tab==='pending'?'on':''}`} onClick={()=>setTab('pending')}>Pending Queue</button><button className={`rw-tab ${tab==='history'?'on':''}`} onClick={()=>setTab('history')}>Submission History</button></div></div>

          {tab === "pending" && <div className="rw-card"><h3>Assigned Waiting Candidates</h3>{pending.length===0?<p className="rw-muted">No pending candidates.</p>:pending.map((c)=><div className="rw-item" key={c.candidateId}><div className="rw-row"><div><b>{c.fullName}</b><p className="rw-muted">{c.candidateId} • {c.mobile} • {c.branch} • Waiting {c.pendingMinutes||0} mins</p><Badge value={c.status}/></div><button style={{width:"auto"}} disabled={!recruiterProfile} onClick={()=>openForm(c)}>{recruiterProfile ? "Open" : "View Only"}</button></div></div>)}</div>}

          {tab === "history" && <div className="rw-card">
            <h3 style={{margin:'0 0 14px'}}>Submission History</h3>

            {/* Filters */}
            <div className="rw-grid rw-2" style={{marginBottom:10}}>
              <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search name, mobile, candidate ID…"/>
              <select value={decision} onChange={(e)=>setDecision(e.target.value)}>
                <option value="All">All Decisions</option>
                <option value="Selected">✅ Selected</option>
                <option value="Rejected">❌ Rejected</option>
                <option value="Hold">⏸ Hold</option>
                <option value="Client Round - Pending">🔄 Client Round - Pending</option>
                <option value="No Show">👻 No Show</option>
              </select>
              <div><label>From</label><input type="date" value={fromDate} onChange={(e)=>setFromDate(e.target.value)} /></div>
              <div><label>To</label><input type="date" value={toDate} onChange={(e)=>setToDate(e.target.value)} /></div>
            </div>
            <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
              <button onClick={()=>setDecision('Selected')} style={{width:'auto',padding:'6px 14px',fontSize:13,background:decision==='Selected'?'#047857':'#e2e8f0',color:decision==='Selected'?'#fff':'#0f172a'}}>Selected Only</button>
              <button onClick={()=>setDecision('All')} style={{width:'auto',padding:'6px 14px',fontSize:13,background:decision==='All'?'#0f172a':'#e2e8f0',color:decision==='All'?'#fff':'#0f172a'}}>All</button>
              <button onClick={refresh} disabled={loading} style={{width:'auto',padding:'6px 14px',fontSize:13}}>Refresh</button>
            </div>

            {/* Stats bar */}
            <div className="rw-grid rw-3" style={{marginBottom:14}}>
              <div className="rw-kpi"><span className="rw-muted">Showing</span><br/><b>{filteredHistory.length}</b></div>
              <div className="rw-kpi"><span className="rw-muted">Selected</span><br/><b style={{color:'#047857'}}>{filteredHistory.filter(h=>h.final_decision==='Selected').length}</b></div>
              <div className="rw-kpi"><span className="rw-muted">Onboarding Pending</span><br/><b style={{color:'#b45309'}}>{filteredHistory.filter(h=>h.final_decision==='Selected'&&h.onboarding_status==='pending').length}</b></div>
            </div>

            <div className="rw-scroll">
              <table className="rw-table">
                <thead><tr>
                  <th>Candidate</th><th>Contact</th><th>Process</th>
                  <th>Decision</th><th>Stage</th><th>Submitted</th>
                  <th>Onboarding</th><th>Action</th>
                </tr></thead>
                <tbody>{filteredHistory.map((h)=>{
                  const isSelected = h.final_decision === 'Selected';
                  const canResubmit = h.final_decision === 'Client Round - Pending' && !!recruiterProfile;
                  const canRectify = !!recruiterProfile;
                  const obStatus = h.onboarding_status;
                  const obBadge = !isSelected ? null :
                    obStatus === 'completed' ? <span className="rw-badge ok">✓ Joined</span> :
                    obStatus === 'submitted' ? <span className="rw-badge warn">📝 Form Submitted</span> :
                    obStatus === 'approved' ? <span className="rw-badge ok">✓ Approved</span> :
                    obStatus === 'pending' ? <span className="rw-badge warn">⏳ Link Sent</span> :
                    <span className="rw-badge info">—</span>;
                  return <tr key={h.id} style={isSelected?{background:'#f0fdf4'}:{}}>
                    <td><b>{h.full_name||'-'}</b><br/><span className="rw-muted">{h.candidate_code||h.candidate_id}</span></td>
                    <td>{h.mobile||'-'}<br/><span className="rw-muted" style={{fontSize:11}}>{h.email||''}</span></td>
                    <td>{h.interviewed_for_process||'-'}</td>
                    <td><Badge value={h.final_decision}/></td>
                    <td style={{fontSize:12}}>{h.walkin_end_stage||'-'}</td>
                    <td style={{fontSize:12,whiteSpace:'nowrap'}}>{fmt(h.submitted_at)}</td>
                    <td>{obBadge ?? <span className="rw-muted" style={{fontSize:12}}>—</span>}
                      {isSelected && h.onboarding_joining_date && <><br/><span className="rw-muted" style={{fontSize:11}}>DOJ: {h.onboarding_joining_date}</span></>}
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      {canResubmit && <button style={{fontSize:12,padding:'6px 10px',marginBottom:4,display:'block'}} onClick={()=>openForm({candidateId:h.candidate_id,qToken:h.q_token??undefined,fullName:h.full_name??undefined,mobile:h.mobile??undefined},true,h)}>Resubmit</button>}
                      {canRectify && <button style={{fontSize:12,padding:'6px 10px',background:'linear-gradient(135deg,#f59e0b,#d97706)',display:'block'}} onClick={()=>openForm({candidateId:h.candidate_id,qToken:h.q_token??undefined,fullName:h.full_name??undefined,mobile:h.mobile??undefined},false,h)}>Rectify</button>}
                      {!canResubmit && !canRectify && <span className="rw-muted" style={{fontSize:12}}>—</span>}
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </div>}
        </>}

        {screen === "form" && selected && <div className="rw-card">
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
            <button onClick={()=>setScreen('workspace')} style={{width:"auto",background:'#e2e8f0',color:'#0f172a',padding:'8px 16px'}}>← Back</button>
            <div>
              <h2 style={{margin:0,fontSize:20}}>Update Candidate</h2>
              <p className="rw-muted" style={{margin:'2px 0 0'}}><b>{selected.fullName}</b> • {selected.mobile}</p>
            </div>
          </div>

          {/* SECTION 1: Walk-in Summary */}
          <div style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:14,padding:16,marginBottom:16}}>
            <div style={{fontWeight:800,fontSize:13,color:'#64748b',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>📋 Walk-in Summary</div>
            <div className="rw-grid rw-3">
              {field('Interviewed for Process *','processName','select',config.processOptions)}
              {field('Walk-in End Stage *','stageName','select',config.stageOptions)}
              {field('Final Decision *','finalDecision','select',config.decisionOptions)}
            </div>
          </div>

          {/* SECTION 2: Round 1 — HR Screening */}
          {rank>=1&&<div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:14,padding:16,marginBottom:16}}>
            <div style={{fontWeight:800,fontSize:13,color:'#1d4ed8',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>🔵 Round 1 — HR Screening</div>
            <div className="rw-grid rw-2">
              {field('Round 1 Result *','round1Result','select',config.decisionOptions)}
              {form.round1Result==='Rejected'&&field('Round 1 VOC *','round1Voc','select',config.vocOptions)}
            </div>
            <div style={{marginTop:10}}>{field('Round 1 Remarks','round1Remarks','textarea')}</div>
          </div>}

          {/* SECTION 3: Skill Test */}
          {rank>=2&&<div style={{background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:14,padding:16,marginBottom:16}}>
            <div style={{fontWeight:800,fontSize:13,color:'#7c3aed',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>🟣 Skill Test</div>
            <div className="rw-grid rw-3">
              {field('Typing Score','skillTypingScore','input')}
              {field('AI Score','skillAiScore','input')}
              {field('Skill Test Result','skillResult','select',config.decisionOptions)}
            </div>
            {form.skillResult==='Rejected'&&<div style={{marginTop:10}} className="rw-grid rw-2">{field('Skill Test VOC *','skillVoc','select',config.skillVocOptions)}</div>}
            <div style={{marginTop:10}}>{field('Skill Test Remarks','skillRemarks','textarea')}</div>
          </div>}

          {/* SECTION 4: Round 2 — Operations */}
          {rank>=3&&<div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:14,padding:16,marginBottom:16}}>
            <div style={{fontWeight:800,fontSize:13,color:'#047857',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>🟢 Round 2 — Operations</div>
            <div className="rw-grid rw-2">
              {field('Round 2 Result *','round2Result','select',config.decisionOptions)}
              {form.round2Result==='Rejected'&&field('Round 2 VOC *','round2Voc','select',config.vocOptions)}
            </div>
            <div style={{marginTop:10}}>{field('Round 2 Remarks','round2Remarks','textarea')}</div>
          </div>}

          {/* SECTION 5: Round 3 — Client */}
          {rank>=4&&<div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:14,padding:16,marginBottom:16}}>
            <div style={{fontWeight:800,fontSize:13,color:'#c2410c',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>🟠 Round 3 — Client</div>
            <div className="rw-grid rw-2">
              {field('Round 3 Result *','round3Result','select',config.decisionOptions)}
              {form.round3Result==='Rejected'&&field('Round 3 VOC *','round3Voc','select',config.vocOptions)}
            </div>
            <div style={{marginTop:10}}>{field('Round 3 Remarks','round3Remarks','textarea')}</div>
          </div>}

          {/* SECTION 6: Offer Details — only if Selected */}
          {form.finalDecision==='Selected'&&<div style={{background:'#ecfdf5',border:'2px solid #6ee7b7',borderRadius:14,padding:16,marginBottom:16}}>
            <div style={{fontWeight:800,fontSize:13,color:'#047857',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>✅ Offer Details (Required for Selected)</div>
            <div className="rw-grid rw-3">
              {field('Offer Salary *','offerSalary','input')}
              {field('Date of Joining *','offerDoj','input')}
              {field('Reporting Timing *','reportingTiming','input')}
            </div>
            <div className="rw-grid rw-2" style={{marginTop:10}}>
              {field('OT Details','otDetails','input')}
              {field('Performance Incentives','performanceIncentives','input')}
            </div>
          </div>}

          {msg && <p className="rw-msg" style={{marginBottom:10}}>{msg}</p>}
          <button disabled={loading} onClick={submit} style={{width:'100%',padding:16,fontSize:16}}>{loading?'Submitting...':'Submit Update'}</button>
        </div>}
      </div>
    </div>
  );
}
