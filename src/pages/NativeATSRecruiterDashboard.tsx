import React, { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

type CandidateRow = {
  candidateId: string;
  qToken: string;
  fullName: string;
  mobile: string;
  email: string;
  branch: string;
  roleApplied: string;
  stage: string;
  status: string;
  pendingMinutes: number;
};

type CandidateDetail = CandidateRow & {
  recruiterName: string;
};

type AppConfig = {
  processOptions: string[];
  decisionOptions: string[];
  stageOptions: string[];
  vocOptions: string[];
  skillVocOptions: string[];
};

const DEFAULT_CONFIG: AppConfig = {
  processOptions: ["Onfido", "Reginald", "BBB", "GS1", "GPI", "FF", "DRA"],
  decisionOptions: ["Selected", "Rejected", "Hold", "Client Round - Pending", "No Show"],
  stageOptions: ["Arrival", "Round 1- HR Screening", "Interview - Skill Test", "Round 2- Op's", "Round 3- Client", "Selection Discussion"],
  vocOptions: [
    "Undergraduate / Qualification Issue",
    "Poor Communication Skill",
    "Poor Reading / Comprehension",
    "Salary Issue",
    "Shift / Timing Issue",
    "Location / Travel Issue",
    "Stability Concern",
    "Documentation Issue",
    "Role / Process Mismatch",
    "Candidate Not Interested",
    "No Show",
    "Age Barrier",
  ],
  skillVocOptions: [
    "Typing Speed Issue",
    "Typing Accuracy Issue",
    "Pehchan Score Low",
    "Poor Sales Skill",
    "Vocabulary / Grammar Issue",
    "Computer / System Skill Gap",
    "Assessment Incomplete / Failed",
  ],
};

const STAGE_ORDER: Record<string, number> = {
  Arrival: 0,
  "Round 1- HR Screening": 1,
  "Interview - Skill Test": 2,
  "Round 2- Op's": 3,
  "Round 3- Client": 4,
  "Selection Discussion": 5,
};

type UpdateForm = {
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

const EMPTY_FORM: UpdateForm = {
  processName: "",
  finalDecision: "",
  stageName: "",
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

function selectOptions(options: string[], includeBlank = true) {
  return (
    <>
      {includeBlank && <option value="">Select</option>}
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </>
  );
}

export default function NativeATSRecruiterDashboard() {
  const [screen, setScreen] = useState<"login" | "list" | "form">("login");
  const [recruiterCode, setRecruiterCode] = useState("");
  const [pin, setPin] = useState("");
  const [recruiterName, setRecruiterName] = useState("");
  const [loginMsg, setLoginMsg] = useState("");
  const [loginMsgType, setLoginMsgType] = useState<"ok" | "err" | "">("");
  const [formMsg, setFormMsg] = useState("");
  const [formMsgType, setFormMsgType] = useState<"ok" | "err" | "">("");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateDetail | null>(null);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [form, setForm] = useState<UpdateForm>(EMPTY_FORM);

  const rank = useMemo(() => STAGE_ORDER[form.stageName] ?? 0, [form.stageName]);

  const updateForm = (key: keyof UpdateForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const hydrateConfig = async () => {
    try {
      const { data } = await db.rpc("native_ats_get_recruiter_app_config");
      const parsed = data as any;
      if (parsed?.ok) {
        setConfig({
          processOptions: parsed.processOptions?.length ? parsed.processOptions : DEFAULT_CONFIG.processOptions,
          decisionOptions: parsed.decisionOptions?.length ? parsed.decisionOptions : DEFAULT_CONFIG.decisionOptions,
          stageOptions: parsed.stageOptions?.length ? parsed.stageOptions : DEFAULT_CONFIG.stageOptions,
          vocOptions: parsed.vocOptions?.length ? parsed.vocOptions : DEFAULT_CONFIG.vocOptions,
          skillVocOptions: parsed.skillVocOptions?.length ? parsed.skillVocOptions : DEFAULT_CONFIG.skillVocOptions,
        });
      }
    } catch {
      setConfig(DEFAULT_CONFIG);
    }
  };

  const loadCandidates = async (showMessage = false) => {
    setLoading(true);
    if (showMessage) {
      setLoginMsg("Loading...");
      setLoginMsgType("");
    }

    try {
      await hydrateConfig();
      const { data, error } = await db.rpc("native_ats_get_pending_candidates", {
        p_recruiter_code: recruiterCode.trim(),
        p_pin: pin.trim(),
      });

      if (error) throw error;
      const res = data as any;

      if (!res?.ok) {
        setLoginMsg(res?.message || "Login failed");
        setLoginMsgType("err");
        return false;
      }

      setRecruiterName(res.recruiterName || "");
      setCandidates(res.candidates || []);
      setLoginMsg("");
      setLoginMsgType("");
      setScreen("list");
      return true;
    } catch (err: any) {
      setLoginMsg(err?.message || "Login failed");
      setLoginMsgType("err");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const login = async () => {
    if (!recruiterCode.trim() || !pin.trim()) {
      setLoginMsg("Recruiter Code and PIN are required.");
      setLoginMsgType("err");
      return;
    }
    await loadCandidates(true);
  };

  const reloadList = async () => {
    await loadCandidates(false);
  };

  const openCandidate = async (candidateId: string) => {
    setLoading(true);
    try {
      const { data, error } = await db.rpc("native_ats_get_candidate_details", {
        p_recruiter_code: recruiterCode.trim(),
        p_pin: pin.trim(),
        p_candidate_code: candidateId,
      });

      if (error) throw error;
      const res = data as any;
      if (!res?.ok) {
        alert(res?.message || "Unable to load candidate");
        return;
      }

      const candidate = res.candidate as CandidateDetail;
      setSelectedCandidate(candidate);
      setForm({
        ...EMPTY_FORM,
        stageName: candidate.stage || "Arrival",
      });
      setFormMsg("");
      setFormMsgType("");
      setScreen("form");
    } catch (err: any) {
      alert(err?.message || "Unable to load candidate");
    } finally {
      setLoading(false);
    }
  };

  const backToList = async () => {
    setScreen("list");
    setSelectedCandidate(null);
    setForm(EMPTY_FORM);
    setFormMsg("");
    setFormMsgType("");
    await reloadList();
  };

  const handleFinalDecisionChange = (value: string) => {
    setForm((prev) => {
      const next = { ...prev, finalDecision: value };
      const stageRank = STAGE_ORDER[prev.stageName] ?? 0;
      if (value === "Selected") {
        next.round1Result = "Selected";
        if (stageRank >= 3) next.round2Result = "Selected";
        if (stageRank >= 4) next.round3Result = "Selected";
      }
      return next;
    });
  };

  const submitUpdate = async () => {
    if (!selectedCandidate) return;

    setFormMsg("Submitting...");
    setFormMsgType("");
    setLoading(true);

    try {
      const payload = {
        recruiterCode: recruiterCode.trim(),
        pin: pin.trim(),
        candidateId: selectedCandidate.candidateId,
        processName: form.processName,
        finalDecision: form.finalDecision,
        stageName: form.stageName,
        round1Result: form.round1Result,
        round1Voc: form.round1Voc,
        round1Remarks: form.round1Remarks.trim(),
        skillTypingScore: form.skillTypingScore.trim(),
        skillAiScore: form.skillAiScore.trim(),
        skillResult: form.skillResult,
        skillVoc: form.skillVoc,
        skillRemarks: form.skillRemarks.trim(),
        round2Result: form.round2Result,
        round2Voc: form.round2Voc,
        round2Remarks: form.round2Remarks.trim(),
        round3Result: form.round3Result,
        round3Voc: form.round3Voc,
        round3Remarks: form.round3Remarks.trim(),
        offerSalary: form.offerSalary.trim(),
        offerDoj: form.offerDoj,
        reportingTiming: form.reportingTiming,
        otDetails: form.otDetails.trim(),
        performanceIncentives: form.performanceIncentives.trim(),
      };

      const { data, error } = await db.rpc("native_ats_submit_interview_update", { payload });
      if (error) throw error;

      const res = data as any;
      if (!res?.ok) {
        setFormMsg(res?.message || "Submission failed");
        setFormMsgType("err");
        return;
      }

      setFormMsg(res.message || "Update submitted successfully.");
      setFormMsgType("ok");
      window.setTimeout(() => {
        void backToList();
      }, 900);
    } catch (err: any) {
      setFormMsg(err?.message || "Submission failed");
      setFormMsgType("err");
    } finally {
      setLoading(false);
    }
  };

  const selectedVisible = form.finalDecision === "Selected";
  const typingVisible = rank >= 2 && form.processName === "Onfido";
  const round1Visible = rank >= 1;
  const skillVisible = rank >= 2;
  const round2Visible = rank >= 3;
  const round3Visible = rank >= 4;

  return (
    <div className="recruiter-native-page">
      <style>{`
        :root{
          --rm-bg1:#0f172a;
          --rm-bg2:#1d4ed8;
          --rm-card:#ffffff;
          --rm-muted:#64748b;
          --rm-text:#0f172a;
          --rm-line:#dbe4f0;
          --rm-accent:#2563eb;
          --rm-accent2:#7c3aed;
          --rm-success:#0f766e;
          --rm-danger:#b91c1c;
        }
        .recruiter-native-page *{box-sizing:border-box}
        .recruiter-native-page{
          min-height:100dvh;
          margin:0;
          font-family:Arial,sans-serif;
          color:var(--rm-text);
          background:linear-gradient(135deg,#eff6ff 0%,#eef2ff 45%,#f8fafc 100%);
        }
        .rm-top{
          background:linear-gradient(135deg,var(--rm-bg1) 0%,var(--rm-bg2) 65%,var(--rm-accent2) 100%);
          color:#fff;
          padding:22px 16px 90px;
        }
        .rm-top h1{margin:0;font-size:24px;line-height:1.2}
        .rm-top p{margin:8px 0 0;color:#dbeafe;font-size:14px}
        .rm-wrap{
          max-width:820px;
          margin:-62px auto 24px;
          padding:0 14px 28px;
        }
        .rm-card{
          background:var(--rm-card);
          border-radius:20px;
          box-shadow:0 12px 32px rgba(15,23,42,.10);
          border:1px solid #edf2f7;
          padding:18px;
          margin-bottom:14px;
        }
        .rm-hidden{display:none!important}
        .rm-grid{display:grid;gap:14px}
        .rm-grid-2{grid-template-columns:1fr 1fr}
        @media(max-width:700px){.rm-grid-2{grid-template-columns:1fr}}
        .recruiter-native-page label{
          display:block;
          margin:0 0 6px;
          font-weight:700;
          font-size:13px;
          color:#1e293b;
        }
        .rm-sub{font-size:12px;color:var(--rm-muted);margin-top:4px}
        .recruiter-native-page input,
        .recruiter-native-page select,
        .recruiter-native-page textarea,
        .recruiter-native-page button{
          width:100%;
          font-size:16px;
          border-radius:14px;
          font-family:inherit;
        }
        .recruiter-native-page input,
        .recruiter-native-page select,
        .recruiter-native-page textarea{
          border:1px solid var(--rm-line);
          padding:13px 14px;
          background:#fff;
          color:#0f172a;
          outline:none;
        }
        .recruiter-native-page input:focus,
        .recruiter-native-page select:focus,
        .recruiter-native-page textarea:focus{
          border-color:#93c5fd;
          box-shadow:0 0 0 4px rgba(59,130,246,.14);
        }
        .recruiter-native-page textarea{min-height:86px;resize:vertical}
        .recruiter-native-page button{
          border:none;
          padding:14px 16px;
          font-weight:700;
          cursor:pointer;
          color:#fff;
          background:linear-gradient(135deg,#2563eb 0%,#7c3aed 100%);
          box-shadow:0 10px 24px rgba(37,99,235,.22);
          margin-top:12px;
        }
        .recruiter-native-page button:disabled{opacity:.65;cursor:not-allowed}
        .rm-btn-secondary{
          background:#e2e8f0!important;
          color:#0f172a!important;
          box-shadow:none!important;
          margin-top:0!important;
        }
        .rm-pill{
          display:inline-block;
          font-size:12px;
          font-weight:700;
          padding:7px 10px;
          border-radius:999px;
          background:#eff6ff;
          color:#1d4ed8;
          margin-top:8px;
        }
        .rm-muted{color:var(--rm-muted);font-size:13px}
        .rm-msg{margin-top:12px;font-weight:700;font-size:14px}
        .rm-ok{color:var(--rm-success)}
        .rm-err{color:var(--rm-danger)}
        .rm-item{
          border:1px solid #e2e8f0;
          border-radius:16px;
          padding:14px;
          background:linear-gradient(180deg,#fff 0%,#f8fbff 100%);
          margin-top:12px;
        }
        .rm-item h3{margin:0 0 6px;font-size:18px}
        .rm-row{margin:3px 0;color:#334155;font-size:14px}
        .rm-infoBox{
          background:linear-gradient(180deg,#f8fbff 0%,#eef6ff 100%);
          border:1px solid #dbeafe;
          border-radius:16px;
          padding:14px;
          font-size:14px;
          line-height:1.6;
        }
        .rm-section{
          margin-top:16px;
          padding-top:12px;
          border-top:1px dashed #dbe4f0;
        }
        .rm-section h3{
          margin:0 0 12px;
          font-size:16px;
          color:#0f172a;
        }
        .rm-readonly{
          background:#f8fafc!important;
          color:#475569!important;
        }
      `}</style>

      <div className="rm-top">
        <h1>Recruiter Mobile App</h1>
        <p>Fast interview closure from mobile. Controlled dropdowns, stage-wise logic, and direct submission to Recruiter Submission.</p>
      </div>

      <div className="rm-wrap">
        {screen === "login" && (
          <div className="rm-card">
            <div className="rm-grid rm-grid-2">
              <div>
                <label>Recruiter Code</label>
                <input value={recruiterCode} onChange={(e) => setRecruiterCode(e.target.value)} placeholder="Enter recruiter code" />
              </div>
              <div>
                <label>PIN</label>
                <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" placeholder="Enter PIN" />
              </div>
            </div>
            <button disabled={loading} onClick={login}>{loading ? "Loading..." : "Load My Candidates"}</button>
            {loginMsg && <div className={`rm-msg ${loginMsgType === "err" ? "rm-err" : loginMsgType === "ok" ? "rm-ok" : ""}`}>{loginMsg}</div>}
          </div>
        )}

        {screen === "list" && (
          <div className="rm-card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>{recruiterName} - Pending Candidates</h2>
                <div className="rm-muted">Tap a candidate to submit recruiter update.</div>
              </div>
              <button className="rm-btn-secondary" style={{ width: "auto", padding: "12px 18px" }} disabled={loading} onClick={reloadList}>Refresh</button>
            </div>

            {!candidates.length ? (
              <div className="rm-muted" style={{ marginTop: 12 }}>No pending candidates found.</div>
            ) : (
              <div>
                {candidates.map((r) => (
                  <div className="rm-item" key={r.candidateId}>
                    <h3>{r.fullName}</h3>
                    <div className="rm-row"><b>Candidate ID:</b> {r.candidateId}</div>
                    <div className="rm-row"><b>Queue Token:</b> {r.qToken}</div>
                    <div className="rm-row"><b>Role:</b> {r.roleApplied}</div>
                    <div className="rm-row"><b>Branch:</b> {r.branch}</div>
                    <div className="rm-row"><b>Pending:</b> {r.pendingMinutes || 0} mins</div>
                    <div className="rm-pill">{r.status}</div>
                    <button onClick={() => openCandidate(r.candidateId)}>Open Candidate</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {screen === "form" && selectedCandidate && (
          <div className="rm-card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>Recruiter Update</h2>
                <div className="rm-muted">Fill only what is relevant for the selected stage.</div>
              </div>
              <button className="rm-btn-secondary" style={{ width: "auto", padding: "12px 18px" }} onClick={backToList}>Back</button>
            </div>

            <div className="rm-infoBox" style={{ marginTop: 12 }}>
              <b>{selectedCandidate.fullName}</b><br />
              Queue Token: {selectedCandidate.qToken}<br />
              Role: {selectedCandidate.roleApplied}<br />
              Branch: {selectedCandidate.branch}<br />
              Current Status: {selectedCandidate.status}<br />
              Assigned Recruiter: {selectedCandidate.recruiterName}
            </div>

            <div className="rm-section">
              <h3>Basic Details</h3>
              <div className="rm-grid rm-grid-2">
                <div>
                  <label>CandidateID</label>
                  <input className="rm-readonly" readOnly value={selectedCandidate.candidateId} />
                </div>
                <div>
                  <label>Interviewed for Process</label>
                  <select value={form.processName} onChange={(e) => updateForm("processName", e.target.value)}>
                    {selectOptions(config.processOptions)}
                  </select>
                </div>
                <div>
                  <label>Final Decision</label>
                  <select value={form.finalDecision} onChange={(e) => handleFinalDecisionChange(e.target.value)}>
                    {selectOptions(config.decisionOptions)}
                  </select>
                </div>
                <div>
                  <label>Walk-in End Stage</label>
                  <select value={form.stageName} onChange={(e) => updateForm("stageName", e.target.value)}>
                    {selectOptions(config.stageOptions)}
                  </select>
                </div>
              </div>
            </div>

            {round1Visible && (
              <div className="rm-section">
                <h3>Round 1 - HR Screening</h3>
                <div className="rm-grid rm-grid-2">
                  <div>
                    <label>Round1 Result</label>
                    <select value={form.round1Result} onChange={(e) => updateForm("round1Result", e.target.value)}>
                      {selectOptions(config.decisionOptions)}
                    </select>
                  </div>
                  {form.round1Result === "Rejected" && (
                    <div>
                      <label>Round1 VOC</label>
                      <select value={form.round1Voc} onChange={(e) => updateForm("round1Voc", e.target.value)}>
                        {selectOptions(config.vocOptions)}
                      </select>
                    </div>
                  )}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label>Round1 Remarks</label>
                    <textarea value={form.round1Remarks} onChange={(e) => updateForm("round1Remarks", e.target.value)} placeholder="Enter round 1 remarks" />
                  </div>
                </div>
              </div>
            )}

            {skillVisible && (
              <div className="rm-section">
                <h3>Skill Test</h3>
                <div className="rm-grid rm-grid-2">
                  {typingVisible && (
                    <div>
                      <label>SkillTest Typing Score (WPM/Accuracy%)</label>
                      <input value={form.skillTypingScore} onChange={(e) => updateForm("skillTypingScore", e.target.value)} placeholder="Example: 32 WPM / 91%" />
                    </div>
                  )}
                  <div>
                    <label>SkillTest AI Score</label>
                    <input value={form.skillAiScore} onChange={(e) => updateForm("skillAiScore", e.target.value)} type="number" placeholder="Enter AI score" />
                    <div className="rm-sub">Mandatory for all processes</div>
                  </div>
                  <div>
                    <label>SkillTest Result</label>
                    <select value={form.skillResult} onChange={(e) => updateForm("skillResult", e.target.value)}>
                      {selectOptions(config.decisionOptions)}
                    </select>
                    <div className="rm-sub">Visible for every recruiter. Not mandatory.</div>
                  </div>
                  {form.skillResult === "Rejected" && (
                    <div>
                      <label>SkillTest VOC</label>
                      <select value={form.skillVoc} onChange={(e) => updateForm("skillVoc", e.target.value)}>
                        {selectOptions(config.skillVocOptions)}
                      </select>
                    </div>
                  )}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label>SkillTest Remarks</label>
                    <textarea value={form.skillRemarks} onChange={(e) => updateForm("skillRemarks", e.target.value)} placeholder="Enter skill test remarks" />
                  </div>
                </div>
              </div>
            )}

            {round2Visible && (
              <div className="rm-section">
                <h3>Round 2 - Op's</h3>
                <div className="rm-grid rm-grid-2">
                  <div>
                    <label>Round2 Result</label>
                    <select value={form.round2Result} onChange={(e) => updateForm("round2Result", e.target.value)}>
                      {selectOptions(config.decisionOptions)}
                    </select>
                  </div>
                  {form.round2Result === "Rejected" && (
                    <div>
                      <label>Round2 VOC</label>
                      <select value={form.round2Voc} onChange={(e) => updateForm("round2Voc", e.target.value)}>
                        {selectOptions(config.vocOptions)}
                      </select>
                    </div>
                  )}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label>Round2 Remarks</label>
                    <textarea value={form.round2Remarks} onChange={(e) => updateForm("round2Remarks", e.target.value)} placeholder="Enter round 2 remarks" />
                  </div>
                </div>
              </div>
            )}

            {round3Visible && (
              <div className="rm-section">
                <h3>Round 3 - Client</h3>
                <div className="rm-grid rm-grid-2">
                  <div>
                    <label>Round3 Result</label>
                    <select value={form.round3Result} onChange={(e) => updateForm("round3Result", e.target.value)}>
                      {selectOptions(config.decisionOptions)}
                    </select>
                  </div>
                  {form.round3Result === "Rejected" && (
                    <div>
                      <label>Round3 VOC</label>
                      <select value={form.round3Voc} onChange={(e) => updateForm("round3Voc", e.target.value)}>
                        {selectOptions(config.vocOptions)}
                      </select>
                    </div>
                  )}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label>Round3 Remarks</label>
                    <textarea value={form.round3Remarks} onChange={(e) => updateForm("round3Remarks", e.target.value)} placeholder="Enter round 3 remarks" />
                  </div>
                </div>
              </div>
            )}

            {selectedVisible && (
              <div className="rm-section">
                <h3>Selection Discussion</h3>
                <div className="rm-grid rm-grid-2">
                  <div>
                    <label>Offer Salary</label>
                    <input value={form.offerSalary} onChange={(e) => updateForm("offerSalary", e.target.value)} placeholder="Enter offer salary" />
                  </div>
                  <div>
                    <label>Date of Joining</label>
                    <input value={form.offerDoj} onChange={(e) => updateForm("offerDoj", e.target.value)} type="date" />
                  </div>
                  <div>
                    <label>Reporting Timing</label>
                    <input value={form.reportingTiming} onChange={(e) => updateForm("reportingTiming", e.target.value)} type="time" />
                  </div>
                  <div>
                    <label>OT Details</label>
                    <input value={form.otDetails} onChange={(e) => updateForm("otDetails", e.target.value)} placeholder="Optional" />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label>Performance Incentives</label>
                    <input value={form.performanceIncentives} onChange={(e) => updateForm("performanceIncentives", e.target.value)} placeholder="Optional" />
                  </div>
                </div>
              </div>
            )}

            <button disabled={loading} onClick={submitUpdate}>{loading ? "Submitting..." : "Submit Update"}</button>
            {formMsg && <div className={`rm-msg ${formMsgType === "err" ? "rm-err" : formMsgType === "ok" ? "rm-ok" : ""}`}>{formMsg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
