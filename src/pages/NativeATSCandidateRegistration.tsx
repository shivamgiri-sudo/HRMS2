import React, { useEffect, useRef, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { CompanyLogo } from "@/components/CompanyLogo";

type BranchAlias = { canonical: string; display: string; alias: string };
type RecruiterDetail = { name: string; email: string | null; mobile: string | null };

type Bootstrap = {
  companyName: string;
  educationOptions: string[];
  experienceOptions: string[];
  genderOptions: string[];
  roleOptions: string[];
  branchAliases: BranchAlias[];
  preferredShiftOptions: string[];
};

type FormData = {
  branch: string;          // display name
  name: string;
  mobile: string;
  email: string;
  roleApplied: string;
  education: string;
  experience: string;
  gender: string;
  preferredShift: string;
  recruiterName: string;
};

type SubmitResponse = {
  success: boolean;
  message?: string;
  candidateId?: string;
  recruiterName?: string;
  recruiterMobile?: string;
  recruiterEmail?: string;
  branch?: string;
};

const EMPTY: FormData = {
  branch: "", name: "", mobile: "", email: "",
  roleApplied: "", education: "", experience: "",
  gender: "", preferredShift: "", recruiterName: "",
};

const DEFAULT_BOOTSTRAP: Bootstrap = {
  companyName: "Mas Callnet India Pvt Ltd",
  educationOptions: ["10th Pass","12th Pass","Graduate","Post Graduate","Diploma"],
  experienceOptions: ["Fresher","0-1 Year","1-2 Years","2-3 Years","3+ Years"],
  genderOptions: ["Male","Female","Other"],
  roleOptions: ["Inbound Agent","Outbound Agent","Back Office","Team Leader","Quality Analyst"],
  branchAliases: [],
  preferredShiftOptions: ["Morning","Afternoon","Night","Rotational"],
};

const css = `
  :root {
    --c-bg:#f0f2f8; --c-surface:#fff; --c-primary:#6d28d9; --c-plight:#ede9fe;
    --c-text:#0f172a; --c-muted:#64748b; --c-border:#dde3ef;
    --c-green:#10b981; --c-red:#ef4444; --c-grad:linear-gradient(130deg,#5b21b6 0%,#7c3aed 45%,#ec4899 100%);
    --r:12px; --sh:0 2px 12px rgba(0,0,0,.07);
  }
  .rg*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  .rg{width:100%;height:100dvh;font-family:'DM Sans',sans-serif;background:var(--c-bg);color:var(--c-text);font-size:16px;display:flex;flex-direction:column}
  .rg-hdr{flex:0 0 auto;background:var(--c-grad);padding:calc(env(safe-area-inset-top,0px)+12px) 16px 12px;color:#fff}
  .rg-hdr-row{display:flex;align-items:center;gap:10px}
  .rg-hdr-ico{width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;flex:0 0 auto}
  .rg-hdr-title{font-family:'Nunito',sans-serif;font-weight:900;font-size:14px;line-height:1.25}
  .rg-hdr-sub{font-size:11px;opacity:.88;margin-top:1px}
  .rg-prog{height:4px;background:rgba(255,255,255,.25);border-radius:99px;overflow:hidden;margin-top:10px}
  .rg-prog-fill{height:100%;background:#22c55e;border-radius:99px;transition:width .35s cubic-bezier(.4,0,.2,1)}
  .rg-body{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;min-height:0}
  .rg-body::-webkit-scrollbar{width:3px}
  .rg-body::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:99px}

  /* Welcome */
  .rg-welcome{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;padding:36px 24px;text-align:center}
  .rg-welcome-icon{width:84px;height:84px;border-radius:24px;background:var(--c-grad);display:flex;align-items:center;justify-content:center;font-size:38px;box-shadow:0 14px 40px rgba(109,40,217,.38);margin-bottom:22px;animation:rgFloat 3s ease-in-out infinite}
  @keyframes rgFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
  .rg-welcome-title{font-family:'Nunito',sans-serif;font-weight:900;font-size:28px;letter-spacing:-.5px;margin-bottom:8px}
  .rg-welcome-desc{font-size:14px;color:var(--c-muted);line-height:1.65;max-width:290px;margin-bottom:28px}
  .rg-btn-start{background:var(--c-grad);color:#fff;border:none;border-radius:var(--r);padding:14px 34px;font-family:'Nunito',sans-serif;font-size:16px;font-weight:800;cursor:pointer;box-shadow:0 8px 24px rgba(109,40,217,.42);display:flex;align-items:center;gap:8px}

  /* Form */
  .rg-form{padding:14px 12px 8px}
  .rg-card{background:var(--c-surface);border-radius:16px;box-shadow:var(--sh);padding:16px 14px 18px;border:1px solid rgba(0,0,0,.04);margin-bottom:12px}
  .rg-sec-title{font-size:10px;font-weight:800;letter-spacing:.9px;text-transform:uppercase;color:var(--c-primary);margin-bottom:12px}

  /* Field group */
  .rg-fg{margin-bottom:14px}
  .rg-fg:last-child{margin-bottom:0}
  .rg-fl{font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--c-muted);margin-bottom:6px;display:flex;align-items:center;gap:4px}
  .rg-req{color:var(--c-red);font-size:11px}
  .rg-iw{position:relative;display:flex;align-items:center}
  .rg-ii{position:absolute;left:12px;font-size:16px;color:#94a3b8;pointer-events:none;line-height:1}
  .rg-input{width:100%;border:1.5px solid var(--c-border);outline:none;background:#f7f9fc;color:var(--c-text);font-family:'DM Sans',sans-serif;font-size:15px;font-weight:500;padding:13px 14px 13px 42px;border-radius:10px;appearance:none;-webkit-appearance:none;transition:border-color .15s,box-shadow .15s,background .15s;line-height:1.4}
  .rg-input:focus{border-color:var(--c-primary);box-shadow:0 0 0 3px rgba(109,40,217,.1);background:#fff}
  .rg-input.err{border-color:var(--c-red);background:#fff5f5}
  .rg-input.ok{border-color:var(--c-green);background:#f0fdf4}
  .rg-ok-tick{position:absolute;right:12px;font-size:15px;color:var(--c-green);pointer-events:none}
  .rg-err{font-size:11px;color:var(--c-red);margin-top:4px;font-weight:700;display:none}
  .rg-err.show{display:block}

  /* Branch chips */
  .rg-branch-search{width:100%;border:1.5px solid var(--c-border);border-radius:10px;padding:11px 14px 11px 42px;font-size:15px;font-family:'DM Sans',sans-serif;background:#f7f9fc;outline:none;margin-bottom:10px}
  .rg-branch-search:focus{border-color:var(--c-primary);box-shadow:0 0 0 3px rgba(109,40,217,.1);background:#fff}
  .rg-branch-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;max-height:220px;overflow-y:auto}
  .rg-branch-chip{border:1.5px solid var(--c-border);border-radius:10px;padding:10px 10px;font-size:13px;font-weight:600;background:#f7f9fc;color:var(--c-text);cursor:pointer;text-align:center;transition:all .15s;line-height:1.3}
  .rg-branch-chip:active{background:var(--c-plight)}
  .rg-branch-chip.sel{border-color:var(--c-primary);background:var(--c-plight);color:var(--c-primary);font-weight:800}

  /* Pill chips (gender, shift, yes/no) */
  .rg-pill-row{display:flex;flex-wrap:wrap;gap:8px}
  .rg-pill{border:1.5px solid var(--c-border);border-radius:99px;padding:9px 16px;font-size:13px;font-weight:600;background:#f7f9fc;color:var(--c-text);cursor:pointer;transition:all .15s;white-space:nowrap}
  .rg-pill:active{background:var(--c-plight)}
  .rg-pill.sel{border-color:var(--c-primary);background:var(--c-grad);color:#fff;font-weight:700;box-shadow:0 2px 8px rgba(109,40,217,.3)}

  /* Recruiter list */
  .rg-recruiter-list{display:flex;flex-direction:column;gap:8px;max-height:200px;overflow-y:auto}
  .rg-recruiter-item{border:1.5px solid var(--c-border);border-radius:10px;padding:12px 14px;cursor:pointer;background:#f7f9fc;transition:all .15s}
  .rg-recruiter-item:active{background:var(--c-plight)}
  .rg-recruiter-item.sel{border-color:var(--c-primary);background:var(--c-plight)}
  .rg-recruiter-name{font-size:14px;font-weight:700;color:var(--c-text)}
  .rg-recruiter-meta{font-size:12px;color:var(--c-muted);margin-top:2px}
  .rg-recruiter-loading{text-align:center;padding:16px;color:var(--c-muted);font-size:13px}

  /* Nav bar */
  .rg-nav{flex:0 0 auto;padding:10px 12px calc(env(safe-area-inset-bottom,0px)+10px);background:var(--c-surface);border-top:1px solid var(--c-border);display:flex;gap:10px}
  .rg-btn-back{border:1.5px solid var(--c-border);background:var(--c-surface);color:var(--c-text);border-radius:var(--r);padding:13px 18px;font-family:'Nunito',sans-serif;font-size:15px;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:5px;white-space:nowrap}
  .rg-btn-submit{flex:1;background:var(--c-grad);color:#fff;border:none;border-radius:var(--r);padding:13px 20px;font-family:'Nunito',sans-serif;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 5px 18px rgba(109,40,217,.32)}
  .rg-btn-submit:disabled{opacity:.5;cursor:not-allowed}

  /* Submitting */
  .rg-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:14px;padding:24px}
  .rg-spinner{width:34px;height:34px;border:3.5px solid rgba(109,40,217,.15);border-top-color:var(--c-primary);border-radius:50%;animation:rgSpin .65s linear infinite}
  @keyframes rgSpin{to{transform:rotate(360deg)}}
  .rg-loading-title{font-family:'Nunito',sans-serif;font-weight:900;font-size:18px}
  .rg-loading-steps{display:flex;flex-direction:column;gap:8px;width:100%;max-width:260px;margin-top:4px}
  .rg-lstep{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:#94a3b8;background:#f7f9fc;border:1.5px solid var(--c-border);border-radius:10px;padding:9px 12px;transition:all .3s}
  .rg-lstep.active{color:var(--c-primary);border-color:var(--c-primary);background:var(--c-plight)}
  .rg-lstep.done{color:var(--c-green);border-color:#a7f3d0;background:#f0fdf4}
  .rg-lstep-dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex:0 0 auto}

  /* Success */
  .rg-succ{padding:16px 12px 28px}
  .rg-succ-banner{background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:1px solid #a7f3d0;border-radius:16px;padding:20px 16px;text-align:center;margin-bottom:14px}
  .rg-succ-emoji{font-size:44px;margin-bottom:8px}
  .rg-succ-title{font-family:'Nunito',sans-serif;font-weight:900;font-size:22px;color:#065f46;margin-bottom:5px}
  .rg-succ-sub{font-size:14px;color:#047857;line-height:1.5}
  .rg-cid{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1.5px solid #a7f3d0;border-radius:99px;padding:6px 16px;margin-top:12px;font-family:'Nunito',sans-serif;font-weight:800;font-size:14px;color:#065f46}
  .rg-rec-card{background:var(--c-surface);border-radius:16px;border:1px solid var(--c-border);box-shadow:var(--sh);padding:16px}
  .rg-rec-title{font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--c-primary);margin-bottom:10px}
  .rg-rec-name{font-family:'Nunito',sans-serif;font-size:20px;font-weight:900;margin-bottom:8px}
  .rg-rec-row{font-size:13px;color:var(--c-muted);margin-bottom:6px;display:flex;align-items:center;gap:8px}
  .rg-rec-row span{color:var(--c-text);font-weight:600}
  .rg-rec-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
  .rg-rec-btn{border:1.5px solid var(--c-plight);background:var(--c-plight);color:var(--c-primary);border-radius:10px;padding:12px 10px;font-family:'Nunito',sans-serif;font-size:14px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}

  /* Error */
  .rg-err-card{margin:20px 12px;background:#fff5f5;border:1px solid #fecaca;border-radius:16px;padding:24px 20px;text-align:center}
  .rg-err-emoji{font-size:34px;margin-bottom:10px}
  .rg-err-title{font-family:'Nunito',sans-serif;font-weight:900;font-size:18px;color:#b91c1c;margin-bottom:8px}
  .rg-err-msg{font-size:14px;color:#64748b;line-height:1.55;white-space:pre-wrap}

  @keyframes rgFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .rg-anim{animation:rgFadeUp .22s ease forwards}

  /* Consent */
  .rg-consent{display:flex;align-items:flex-start;gap:10px;padding:12px;background:#fefce8;border:1px solid #fde68a;border-radius:10px;margin-top:4px}
  .rg-consent input{margin-top:3px;flex:0 0 auto;width:16px;height:16px;cursor:pointer}
  .rg-consent label{font-size:12px;color:#92400e;line-height:1.5;cursor:pointer}
  .rg-consent a{color:var(--c-primary)}
`;

export default function NativeATSCandidateRegistration() {
  const [screen, setScreen] = useState<"loading"|"welcome"|"form"|"submitting"|"success"|"error">("loading");
  const [bootstrap, setBootstrap] = useState<Bootstrap>(DEFAULT_BOOTSTRAP);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [branchSearch, setBranchSearch] = useState("");
  const [recruiters, setRecruiters] = useState<RecruiterDetail[]>([]);
  const [recruiterLoading, setRecruiterLoading] = useState(false);
  const [consent, setConsent] = useState(false);
  const [loadingStep, setLoadingStep] = useState(1);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadBootstrap(); }, []);

  // Load recruiters when branch changes
  useEffect(() => {
    if (!form.branch) { setRecruiters([]); return; }
    setRecruiterLoading(true);
    setForm(p => ({ ...p, recruiterName: "" }));
    hrmsApi.get(`/api/ats/form-config/recruiters-by-branch?branch=${encodeURIComponent(form.branch)}`)
      .then(res => {
        const list: RecruiterDetail[] = (res as any)?.data ?? [];
        setRecruiters(list);
        if (list.length === 1) setForm(p => ({ ...p, recruiterName: list[0].name }));
      })
      .catch(() => setRecruiters([]))
      .finally(() => setRecruiterLoading(false));
  }, [form.branch]);

  const loadBootstrap = async () => {
    try {
      const res = await hrmsApi.get('/api/ats/form-config/bootstrap').catch(() => null);
      const data = (res as any)?.data;
      if (data) {
        setBootstrap({
          companyName: "Mas Callnet India Pvt Ltd",
          educationOptions: data.educationOptions ?? DEFAULT_BOOTSTRAP.educationOptions,
          experienceOptions: data.experienceOptions ?? DEFAULT_BOOTSTRAP.experienceOptions,
          genderOptions: data.genderOptions ?? DEFAULT_BOOTSTRAP.genderOptions,
          roleOptions: data.roleOptions ?? DEFAULT_BOOTSTRAP.roleOptions,
          branchAliases: data.branchAliases ?? [],
          preferredShiftOptions: data.preferredShiftOptions ?? DEFAULT_BOOTSTRAP.preferredShiftOptions,
        });
      }
      setScreen("welcome");
    } catch (err: any) {
      setSubmitError(`Load failed. Refresh and try again.\n${err?.message || ""}`);
      setScreen("error");
    }
  };

  const set = (k: keyof FormData, v: string) => {
    if (k === "mobile") v = v.replace(/\D/g, "").slice(0, 10);
    setForm(p => ({ ...p, [k]: v }));
    setErrors(p => ({ ...p, [k]: "" }));
  };

  const filteredBranches = bootstrap.branchAliases.filter(b =>
    !branchSearch || b.display.toLowerCase().includes(branchSearch.toLowerCase())
  );

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (!form.branch) e.branch = "Select a branch";
    if (!form.name.trim() || form.name.trim().length < 3) e.name = "Enter full name (min 3 chars)";
    else if (!/^[a-zA-Z\s]+$/.test(form.name.trim())) e.name = "Name: letters only";
    if (!/^[6-9]\d{9}$/.test(form.mobile)) e.mobile = "Valid 10-digit mobile required";
    if (!form.roleApplied) e.roleApplied = "Select a role";
    if (!form.education) e.education = "Select education";
    if (!form.experience) e.experience = "Select experience";
    if (!form.gender) e.gender = "Select gender";
    if (!form.recruiterName) e.recruiterName = "Select recruiter";
    setErrors(e);
    if (Object.keys(e).length > 0) {
      const firstKey = Object.keys(e)[0];
      setTimeout(() => document.getElementById(`rg_${firstKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!validate() || !consent) return;
    setLoadingStep(1);
    setScreen("submitting");
    const t2 = setTimeout(() => setLoadingStep(2), 700);
    const t3 = setTimeout(() => setLoadingStep(3), 1400);
    try {
      const alias = bootstrap.branchAliases.find(a => a.display === form.branch);
      const canonicalBranch = alias?.canonical || form.branch;
      const payload = {
        fullName: form.name.trim(),
        mobile: form.mobile,
        email: form.email.trim() || null,
        gender: form.gender || null,
        appliedForProcess: form.roleApplied || null,
        appliedForRole: form.roleApplied || null,
        appliedForBranch: canonicalBranch,
        sourcingChannel: "Walk-In",
        walkInDate: new Date().toISOString().slice(0, 10),
        education: form.education || null,
        experience: form.experience || null,
        preferredShift: form.preferredShift || null,
        recruiterName: form.recruiterName || null,
      };
      const apiRes = await hrmsApi.post<{ success: boolean; data: any; message?: string }>("/api/ats/candidates", payload);
      if (!(apiRes as any).success) throw new Error((apiRes as any).message || "Submission failed");
      setResult({
        success: true,
        candidateId: (apiRes as any).data?.candidate_code ?? "",
        recruiterName: form.recruiterName,
        recruiterMobile: recruiters.find(r => r.name === form.recruiterName)?.mobile ?? undefined,
        recruiterEmail: recruiters.find(r => r.name === form.recruiterName)?.email ?? undefined,
        branch: form.branch,
      });
      // Record consent (non-blocking)
      hrmsApi.post("/api/privacy/consent", {
        principal_type: "candidate", purpose_code: "recruitment",
        consent_text_version: "v1.0", consent_text_hash: "candidate_registration_v1", channel: "web",
      }).catch(() => {});
      setScreen("success");
    } catch (err: any) {
      setSubmitError(err?.message || "Submission failed. Please try again.");
      setScreen("error");
    } finally {
      clearTimeout(t2); clearTimeout(t3);
    }
  };

  // Completion % for progress bar
  const fields: (keyof FormData)[] = ["branch","name","mobile","roleApplied","education","experience","gender","recruiterName"];
  const filled = fields.filter(k => form[k]?.trim()).length;
  const pct = Math.round((filled / fields.length) * 100);

  const Pill = ({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) => (
    <div className="rg-pill-row">
      {options.map(o => (
        <button key={o} type="button" className={`rg-pill${value === o ? " sel" : ""}`} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  );

  const renderForm = () => (
    <div className="rg-form rg-anim">
      {/* Progress */}
      <div style={{ marginBottom: 12, padding: "10px 14px", background: "#f0f4ff", borderRadius: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#4338ca" }}>{pct}% complete</span>
          <span style={{ fontSize: 11, color: "#6b7280" }}>{filled}/{fields.length} required fields</span>
        </div>
        <div style={{ height: 5, background: "#ddd6fe", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ height: "100%", background: "linear-gradient(90deg,#6366f1,#8b5cf6)", borderRadius: 99, width: `${pct}%`, transition: "width .3s" }} />
        </div>
      </div>

      {/* BRANCH — first and most prominent */}
      <div className="rg-card" id="rg_branch">
        <div className="rg-sec-title">🏢 Which branch are you at?</div>
        <div className="rg-iw" style={{ marginBottom: 10 }}>
          <span className="rg-ii">🔍</span>
          <input className="rg-branch-search" placeholder="Search branch…" value={branchSearch} onChange={e => setBranchSearch(e.target.value)} />
        </div>
        {filteredBranches.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--c-muted)", textAlign: "center", padding: 12 }}>No branches found</div>
        )}
        <div className="rg-branch-grid">
          {filteredBranches.map(b => (
            <button key={b.canonical} type="button"
              className={`rg-branch-chip${form.branch === b.display ? " sel" : ""}`}
              onClick={() => { set("branch", b.display); setBranchSearch(""); }}>
              {form.branch === b.display && "✓ "}{b.display}
            </button>
          ))}
        </div>
        {errors.branch && <div className="rg-err show" style={{ marginTop: 6 }}>{errors.branch}</div>}
      </div>

      {/* PERSONAL DETAILS */}
      <div className="rg-card">
        <div className="rg-sec-title">👤 Your Details</div>

        <div className="rg-fg" id="rg_name">
          <label className="rg-fl">Full Name <span className="rg-req">*</span></label>
          <div className="rg-iw">
            <span className="rg-ii">👤</span>
            <input className={`rg-input${errors.name ? " err" : form.name.trim().length >= 3 ? " ok" : ""}`}
              type="text" placeholder="First and last name" value={form.name}
              onChange={e => set("name", e.target.value.trimStart())} maxLength={100} />
            {!errors.name && form.name.trim().length >= 3 && <span className="rg-ok-tick">✓</span>}
          </div>
          <div className={`rg-err${errors.name ? " show" : ""}`}>{errors.name}</div>
        </div>

        <div className="rg-fg" id="rg_mobile">
          <label className="rg-fl">Mobile Number <span className="rg-req">*</span></label>
          <div className="rg-iw">
            <span className="rg-ii">📞</span>
            <input className={`rg-input${errors.mobile ? " err" : /^[6-9]\d{9}$/.test(form.mobile) ? " ok" : ""}`}
              type="tel" inputMode="numeric" placeholder="10-digit mobile" value={form.mobile}
              onChange={e => set("mobile", e.target.value)} maxLength={10} />
            {!errors.mobile && /^[6-9]\d{9}$/.test(form.mobile) && <span className="rg-ok-tick">✓</span>}
          </div>
          {form.mobile && form.mobile.length < 10 && (
            <div style={{ fontSize: 11, color: "var(--c-muted)", marginTop: 3 }}>{form.mobile.length}/10 digits</div>
          )}
          <div className={`rg-err${errors.mobile ? " show" : ""}`}>{errors.mobile}</div>
        </div>

        <div className="rg-fg">
          <label className="rg-fl">Email <span style={{ fontSize: 10, fontWeight: 600, color: "var(--c-muted)", textTransform: "lowercase", letterSpacing: 0 }}>(optional)</span></label>
          <div className="rg-iw">
            <span className="rg-ii">✉️</span>
            <input className="rg-input" type="email" inputMode="email" placeholder="your@email.com" value={form.email}
              onChange={e => set("email", e.target.value.trim())} maxLength={100} />
          </div>
        </div>

        <div className="rg-fg" id="rg_gender">
          <label className="rg-fl">Gender <span className="rg-req">*</span></label>
          <Pill options={bootstrap.genderOptions} value={form.gender} onChange={v => set("gender", v)} />
          <div className={`rg-err${errors.gender ? " show" : ""}`}>{errors.gender}</div>
        </div>
      </div>

      {/* JOB DETAILS */}
      <div className="rg-card">
        <div className="rg-sec-title">💼 Job Details</div>

        <div className="rg-fg" id="rg_roleApplied">
          <label className="rg-fl">Role Applying For <span className="rg-req">*</span></label>
          <div className="rg-pill-row" style={{ flexWrap: "wrap" }}>
            {bootstrap.roleOptions.map(o => (
              <button key={o} type="button"
                className={`rg-pill${form.roleApplied === o ? " sel" : ""}`}
                onClick={() => set("roleApplied", o)}
                style={{ fontSize: 12 }}>{o}</button>
            ))}
          </div>
          <div className={`rg-err${errors.roleApplied ? " show" : ""}`}>{errors.roleApplied}</div>
        </div>

        <div className="rg-fg" id="rg_education">
          <label className="rg-fl">Education <span className="rg-req">*</span></label>
          <Pill options={bootstrap.educationOptions} value={form.education} onChange={v => set("education", v)} />
          <div className={`rg-err${errors.education ? " show" : ""}`}>{errors.education}</div>
        </div>

        <div className="rg-fg" id="rg_experience">
          <label className="rg-fl">Experience <span className="rg-req">*</span></label>
          <Pill options={bootstrap.experienceOptions} value={form.experience} onChange={v => set("experience", v)} />
          <div className={`rg-err${errors.experience ? " show" : ""}`}>{errors.experience}</div>
        </div>

        <div className="rg-fg">
          <label className="rg-fl">Preferred Shift <span style={{ fontSize: 10, fontWeight: 600, color: "var(--c-muted)", textTransform: "lowercase", letterSpacing: 0 }}>(optional)</span></label>
          <Pill options={bootstrap.preferredShiftOptions} value={form.preferredShift} onChange={v => set("preferredShift", v)} />
        </div>
      </div>

      {/* RECRUITER — shown only after branch selected */}
      <div className="rg-card" id="rg_recruiterName">
        <div className="rg-sec-title">🤝 Your Recruiter</div>
        {!form.branch ? (
          <div style={{ fontSize: 13, color: "var(--c-muted)", textAlign: "center", padding: "10px 0" }}>
            ☝️ Select a branch first
          </div>
        ) : recruiterLoading ? (
          <div className="rg-recruiter-loading">Loading recruiters…</div>
        ) : recruiters.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--c-muted)", textAlign: "center", padding: "10px 0" }}>
            No recruiters found for this branch
          </div>
        ) : (
          <div className="rg-recruiter-list">
            {recruiters.map(r => (
              <div key={r.name}
                className={`rg-recruiter-item${form.recruiterName === r.name ? " sel" : ""}`}
                onClick={() => set("recruiterName", r.name)}>
                <div className="rg-recruiter-name">
                  {form.recruiterName === r.name ? "✓ " : ""}{r.name}
                </div>
                {(r.mobile || r.email) && (
                  <div className="rg-recruiter-meta">
                    {r.mobile && `📞 ${r.mobile}`}{r.mobile && r.email ? "  ·  " : ""}{r.email && `✉️ ${r.email}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className={`rg-err${errors.recruiterName ? " show" : ""}`} style={{ marginTop: 6 }}>{errors.recruiterName}</div>
      </div>

      {/* Consent */}
      <div className="rg-consent">
        <input type="checkbox" id="rg-consent" checked={consent} onChange={e => setConsent(e.target.checked)} />
        <label htmlFor="rg-consent">
          I consent to the processing of my personal data for recruitment purposes as per the{" "}
          <a href="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</a>{" "}
          and the Digital Personal Data Protection Act 2023.
        </label>
      </div>
    </div>
  );

  const renderSuccess = () => (
    <div className="rg-succ rg-anim">
      <div className="rg-succ-banner">
        <div className="rg-succ-emoji">🎉</div>
        <div className="rg-succ-title">You're Registered!</div>
        <div className="rg-succ-sub">Details received. Your recruiter will call you shortly.</div>
        <div className="rg-cid">🪪 {result?.candidateId}</div>
      </div>
      <div className="rg-rec-card">
        <div className="rg-rec-title">Your Recruiter</div>
        <div className="rg-rec-name">{result?.recruiterName}</div>
        {result?.recruiterMobile && <div className="rg-rec-row">📞 <span>{result.recruiterMobile}</span></div>}
        {result?.recruiterEmail && <div className="rg-rec-row">✉️ <span>{result.recruiterEmail}</span></div>}
        <div className="rg-rec-row">🏢 <span>{result?.branch}</span></div>
        <div className="rg-rec-actions">
          {result?.recruiterMobile && <a className="rg-rec-btn" href={`tel:${result.recruiterMobile}`}>📞 Call</a>}
          {result?.recruiterEmail && <a className="rg-rec-btn" href={`mailto:${result.recruiterEmail}`}>✉️ Email</a>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="rg">
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <div className="rg-hdr">
        <div className="rg-hdr-row">
          <div className="rg-hdr-ico"><CompanyLogo size="sm" /></div>
          <div>
            <div className="rg-hdr-title">MAS CALLNET</div>
            <div className="rg-hdr-sub">Interview Registration</div>
          </div>
        </div>
        {screen === "form" && (
          <div className="rg-prog"><div className="rg-prog-fill" style={{ width: `${pct}%` }} /></div>
        )}
      </div>

      {/* Body */}
      <div className="rg-body" ref={bodyRef}>
        {screen === "loading" && (
          <div className="rg-loading"><div className="rg-spinner" /><div className="rg-loading-title">Loading…</div></div>
        )}
        {screen === "welcome" && (
          <div className="rg-welcome rg-anim">
            <div className="rg-welcome-icon"><CompanyLogo size="lg" /></div>
            <h1 className="rg-welcome-title">Welcome! 👋</h1>
            <p className="rg-welcome-desc">Quick registration — takes under 2 minutes. We'll match you with a recruiter instantly.</p>
            <button className="rg-btn-start" onClick={() => { setScreen("form"); setErrors({}); bodyRef.current?.scrollTo({ top: 0 }); }}>
              🚀 Start Registration
            </button>
            <div style={{ marginTop: 20, fontSize: 12, color: "var(--c-muted)", display: "flex", gap: 12 }}>
              <span>⚡ 2 mins</span><span>•</span><span>📱 Mobile friendly</span><span>•</span><span>🔒 Secure</span>
            </div>
          </div>
        )}
        {screen === "form" && renderForm()}
        {screen === "submitting" && (
          <div className="rg-loading rg-anim">
            <div className="rg-spinner" />
            <div className="rg-loading-title">Submitting…</div>
            <div className="rg-loading-steps">
              {(["Verifying details","Saving your profile","Generating ID"] as const).map((label, i) => (
                <div key={label} className={`rg-lstep${loadingStep === i+1 ? " active" : loadingStep > i+1 ? " done" : ""}`}>
                  <div className="rg-lstep-dot" />{label}
                </div>
              ))}
            </div>
          </div>
        )}
        {screen === "success" && renderSuccess()}
        {screen === "error" && (
          <div className="rg-err-card rg-anim">
            <div className="rg-err-emoji">⚠️</div>
            <div className="rg-err-title">Submission Failed</div>
            <div className="rg-err-msg">{submitError}</div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      {screen === "form" && (
        <div className="rg-nav">
          <button className="rg-btn-back" onClick={() => setScreen("welcome")}>‹ Back</button>
          <button className="rg-btn-submit" onClick={submit}
            disabled={!consent}
            title={!consent ? "Accept consent to submit" : ""}>
            Submit ✓
          </button>
        </div>
      )}
      {screen === "error" && (
        <div className="rg-nav">
          <button className="rg-btn-back" onClick={() => setScreen("form")}>‹ Back</button>
        </div>
      )}
    </div>
  );
}
