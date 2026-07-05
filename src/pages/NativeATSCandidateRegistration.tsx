import React, { useEffect, useMemo, useRef, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { apiUrl } from "@/lib/apiBase";
import { CompanyLogo } from "@/components/CompanyLogo";

type BranchAlias = {
  canonical: string;
  display: string;
  alias: string;
};

const WALKIN_OPTION_ID = "special:walkin";
const REFERENCE_OPTION_ID = "special:reference";

const normalizeRecruiterLookupValue = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

type RecruiterDetail = {
  name: string;
  email: string | null;
  mobile: string | null;
};

type RecruiterChoice = {
  id: string;
  name?: string;
  label: string;
  employee_code: string | null;
  employee_id: string | null;
  email: string | null;
  mobile: string | null;
};

type Bootstrap = {
  fields?: FieldDef[];
  companyName: string;
  educationOptions: string[];
  experienceOptions: string[];
  genderOptions: string[];
  roleOptions: string[];
  recruiterOptions: string[];
  branchOptions: string[];
  branchAliases?: BranchAlias[];
  recruiterDetails?: RecruiterDetail[];
  sourceOptions: string[];
  yesNoOptions: string[];
  preferredShiftOptions: string[];
  nightShiftComfortOptions: string[];
};

type CandidateFormData = {
  name: string;
  mobile: string;
  email: string;
  address: string;
  education: string;
  experience: string;
  gender: string;
  roleApplied: string;
  sourceType: string;
  recruiterName: string;
  recruiterId: string;
  referredBy: string;
  branch: string;
  rotationalShift: string;
  preferredShift: string;
  nightShiftComfort: string;
  leavesRequired: string;
  ownTwoWheeler: string;
  idProofAvailable: string;
  educationProofAvailable: string;
  resumeFile: File | null;
  selfieFile: File | null;
};

type SubmitResponse = {
  success: boolean;
  message?: string;
  candidateDbId?: string;
  candidateId?: string;
  recruiterName?: string;
  recruiterMobile?: string;
  recruiterEmail?: string;
  branch?: string;
};

type FieldConfig = {
  k: keyof CandidateFormData;
  lb: string;
  t: "text" | "tel" | "email" | "textarea" | "select" | "file" | "camera";
  ic: string;
  ph?: string;
  ok?: keyof Bootstrap;
};

type FieldDef = FieldConfig & {
  section: string;
  visible: boolean;
  required: boolean;
  sort_order: number;
};

type SectionConfig = {
  title: string;
  fields: FieldConfig[];
};

const EMPTY_FORM: CandidateFormData = {
  name: "",
  mobile: "",
  email: "",
  address: "",
  education: "",
  experience: "",
  gender: "",
  roleApplied: "",
  sourceType: "Walk-In",
  recruiterName: "",
  recruiterId: "",
  referredBy: "",
  branch: "",
  rotationalShift: "",
  preferredShift: "",
  nightShiftComfort: "",
  leavesRequired: "",
  ownTwoWheeler: "",
  idProofAvailable: "",
  educationProofAvailable: "",
  resumeFile: null,
  selfieFile: null,
};

const DEFAULT_BOOTSTRAP: Bootstrap = {
  companyName: "Mas Callnet India Pvt Ltd",
  educationOptions: [],
  experienceOptions: [],
  genderOptions: [],
  roleOptions: [],
  recruiterOptions: [],
  branchOptions: [],
  branchAliases: [],
  sourceOptions: ["Walk-In", "Reference", "Other"],
  yesNoOptions: ["Yes", "No"],
  preferredShiftOptions: [],
  nightShiftComfortOptions: [],
};

const SECTIONS: SectionConfig[] = [
  {
    title: "Basic Details",
    fields: [
      { k: "name", lb: "Full Name", t: "text", ic: "👤", ph: "Enter your full name" },
      { k: "mobile", lb: "Mobile Number", t: "tel", ic: "📞", ph: "10-digit mobile number" },
      { k: "email", lb: "Email Address", t: "email", ic: "✉️", ph: "your.email@example.com" },
      { k: "address", lb: "Address", t: "textarea", ic: "📍", ph: "Your residential address" },
      { k: "education", lb: "Education", t: "select", ic: "🎓", ok: "educationOptions" },
      { k: "experience", lb: "Experience", t: "select", ic: "💼", ok: "experienceOptions" },
      { k: "gender", lb: "Gender", t: "select", ic: "🧑", ok: "genderOptions" },
    ],
  },
  {
    title: "Job Details",
    fields: [
      { k: "branch", lb: "Branch", t: "select", ic: "🏢", ok: "branchOptions" },
      { k: "roleApplied", lb: "Role Applied", t: "select", ic: "🗂️", ok: "roleOptions" },
      { k: "recruiterName", lb: "Recruiter Name", t: "select", ic: "🤝", ok: "recruiterOptions" },
      { k: "rotationalShift", lb: "Rotational Shift", t: "select", ic: "🔄", ok: "yesNoOptions" },
      { k: "preferredShift", lb: "Preferred Shift", t: "select", ic: "🕐", ok: "preferredShiftOptions" },
      { k: "nightShiftComfort", lb: "Night Shift Comfort", t: "select", ic: "🌙", ok: "nightShiftComfortOptions" },
      { k: "leavesRequired", lb: "Leaves Required in 3 Months", t: "select", ic: "📅", ok: "yesNoOptions" },
    ],
  },
  {
    title: "Verification",
    fields: [
      { k: "ownTwoWheeler", lb: "Own 2 Wheeler", t: "select", ic: "🛵", ok: "yesNoOptions" },
      { k: "idProofAvailable", lb: "ID Proof Available", t: "select", ic: "🪪", ok: "yesNoOptions" },
      { k: "educationProofAvailable", lb: "Education Proof Available", t: "select", ic: "📄", ok: "yesNoOptions" },
      { k: "resumeFile", lb: "Upload Resume", t: "file", ic: "📎" },
      { k: "selfieFile", lb: "Capture Selfie (Optional)", t: "camera", ic: "📷" },
    ],
  },
];

const css = `
  :root {
    --ats-grad: linear-gradient(130deg, #5b21b6 0%, #7c3aed 45%, #ec4899 100%);
    --ats-bg: #f0f2f8;
    --ats-surface: #fff;
    --ats-text: #0f172a;
    --ats-muted: #64748b;
    --ats-border: #dde3ef;
    --ats-primary: #6d28d9;
    --ats-plight: #ede9fe;
    --ats-green: #10b981;
    --ats-red: #ef4444;
    --ats-amber: #f59e0b;
    --ats-r: 14px;
    --ats-rs: 10px;
    --ats-rl: 20px;
    --ats-sh: 0 2px 12px rgba(0,0,0,.07);
  }

  .native-ats-candidate * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; margin:0; padding:0; }
  .native-ats-candidate { width:100%; height:100dvh; font-family:'DM Sans',sans-serif; background:var(--ats-bg); color:var(--ats-text); overflow:hidden; font-size:16px; }
  .native-ats-app { width:100%; height:100dvh; display:flex; flex-direction:column; }

  .native-ats-hdr { flex:0 0 auto; background:var(--ats-grad); padding:calc(env(safe-area-inset-top,0px) + 14px) 16px 14px; color:#fff; position:relative; overflow:hidden; }
  .native-ats-hdr::after { content:''; position:absolute; width:160px; height:160px; border-radius:50%; background:rgba(255,255,255,.06); top:-50px; right:-30px; pointer-events:none; }
  .native-ats-hdr-brand { display:flex; align-items:center; gap:10px; }
  .native-ats-hdr-icon { width:40px; height:40px; border-radius:11px; flex:0 0 auto; background:rgba(255,255,255,.2); border:1px solid rgba(255,255,255,.3); display:flex; align-items:center; justify-content:center; font-family:'Nunito',sans-serif; font-weight:900; font-size:13px; }
  .native-ats-hdr-title { font-family:'Nunito',sans-serif; font-weight:900; font-size:15px; line-height:1.25; }
  .native-ats-hdr-sub { font-size:12px; opacity:.88; margin-top:1px; }
  .native-ats-prog-strip { margin-top:12px; }
  .native-ats-prog-track { height:5px; background:rgba(255,255,255,.25); border-radius:99px; overflow:hidden; }
  .native-ats-prog-fill { height:100%; border-radius:99px; background:#22c55e; transition:width .4s cubic-bezier(.4,0,.2,1); }

  .native-ats-body { flex:1 1 auto; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; }
  .native-ats-body::-webkit-scrollbar { width:3px; }
  .native-ats-body::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:99px; }

  .native-ats-welcome { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100%; padding:36px 24px; text-align:center; }
  .native-ats-welcome-icon { width:88px; height:88px; border-radius:26px; background:var(--ats-grad); display:flex; align-items:center; justify-content:center; font-size:40px; box-shadow:0 14px 40px rgba(109,40,217,.38); margin-bottom:24px; animation:nativeAtsFloat 3s ease-in-out infinite; }
  @keyframes nativeAtsFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-7px)} }
  @keyframes nativeAtsPop { 0%{transform:scale(0);opacity:0} 50%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }
  .native-ats-welcome-title { font-family:'Nunito',sans-serif; font-weight:900; font-size:30px; letter-spacing:-.5px; margin-bottom:10px; }
  .native-ats-welcome-desc { font-size:15px; color:var(--ats-muted); line-height:1.65; max-width:300px; margin-bottom:32px; }
  .native-ats-btn-start { background:var(--ats-grad); color:#fff; border:none; border-radius:var(--ats-r); padding:15px 36px; font-family:'Nunito',sans-serif; font-size:16px; font-weight:800; cursor:pointer; box-shadow:0 8px 24px rgba(109,40,217,.42); display:flex; align-items:center; gap:8px; }
  .native-ats-btn-start:active { opacity:.9; }

  .native-ats-single-page { padding-bottom:12px; }
  .native-ats-step-hdr { padding:18px 16px 0; }
  .native-ats-step-lbl { font-size:12px; font-weight:800; color:var(--ats-primary); letter-spacing:.9px; text-transform:uppercase; margin-bottom:3px; }
  .native-ats-step-ttl { font-family:'Nunito',sans-serif; font-weight:900; font-size:24px; letter-spacing:-.3px; margin-bottom:2px; }
  .native-ats-step-dsc { font-size:13px; color:var(--ats-muted); font-weight:500; }
  .native-ats-form-card { margin:12px 10px 0; background:var(--ats-surface); border-radius:var(--ats-rl); box-shadow:var(--ats-sh); padding:16px 14px 20px; border:1px solid rgba(0,0,0,.04); }

  .native-ats-sec-block { margin-bottom:18px; }
  .native-ats-sec-block:last-child { margin-bottom:0; }
  .native-ats-sec-title { font-size:12px; font-weight:800; letter-spacing:.8px; text-transform:uppercase; color:var(--ats-primary); margin-bottom:12px; }

  .native-ats-fg { margin-bottom:14px; }
  .native-ats-fg:last-child { margin-bottom:0; }
  .native-ats-fl { font-size:11px; font-weight:800; letter-spacing:.75px; text-transform:uppercase; color:var(--ats-muted); margin-bottom:6px; display:block; }
  .native-ats-iw { position:relative; display:flex; align-items:center; }
  .native-ats-ii { position:absolute; left:12px; font-size:16px; color:#94a3b8; pointer-events:none; line-height:1; }
  .native-ats-ti,.native-ats-ta,.native-ats-si { width:100%; border:1.5px solid var(--ats-border); outline:none; background:#f7f9fc; color:var(--ats-text); font-family:'DM Sans',sans-serif; font-size:15px; font-weight:500; padding:13px 14px 13px 42px; border-radius:var(--ats-rs); appearance:none; -webkit-appearance:none; transition:border-color .15s,box-shadow .15s,background .15s; line-height:1.4; }
  .native-ats-ta { resize:none; min-height:82px; padding-top:12px; padding-bottom:12px; }
  .native-ats-ti:focus,.native-ats-ta:focus,.native-ats-si:focus { border-color:var(--ats-primary); box-shadow:0 0 0 3px rgba(109,40,217,.1); background:#fff; }
  .native-ats-ti.error,.native-ats-ta.error { border-color:#ef4444; background:#fff5f5; }
  .native-ats-ti.error:focus,.native-ats-ta.error:focus { box-shadow:0 0 0 3px rgba(239,68,68,.1); }
  .native-ats-ti.valid,.native-ats-ta.valid { border-color:#10b981; background:#f0fdf4; }
  .native-ats-ti.valid:focus,.native-ats-ta.valid:focus { box-shadow:0 0 0 3px rgba(16,185,129,.1); }
  .native-ats-sw { position:relative; }
  .native-ats-sw::after { content:'▾'; position:absolute; right:12px; top:50%; transform:translateY(-50%); color:#94a3b8; pointer-events:none; font-size:13px; }
  .native-ats-si { cursor:pointer; padding-right:34px; }
  .native-ats-fe { font-size:12px; color:var(--ats-red); margin-top:4px; font-weight:700; display:none; }
  .native-ats-fe.show { display:block; }

  .native-ats-uz { border:2px dashed var(--ats-border); border-radius:var(--ats-rs); padding:20px 16px; text-align:center; cursor:pointer; background:#f7f9fc; transition:border-color .15s,background .15s; }
  .native-ats-uz:active { background:var(--ats-plight); }
  .native-ats-uz.has { border-color:var(--ats-green); background:#f0fdf4; }
  .native-ats-uz.error { border-color:#ef4444; background:#fff5f5; }
  .native-ats-uz-ico { font-size:26px; margin-bottom:6px; }
  .native-ats-uz-lbl { font-size:14px; font-weight:700; margin-bottom:3px; }
  .native-ats-uz-sub { font-size:12px; color:var(--ats-muted); }
  .native-ats-hf { display:none; }

  .native-ats-cam-shell { border-radius:var(--ats-rl); overflow:hidden; position:relative; background:linear-gradient(135deg,#0f172a,#1e293b); width:100%; aspect-ratio:4/3; max-height:280px; box-shadow:0 8px 24px rgba(0,0,0,.2); }
  .native-ats-cam-shell video,.native-ats-cam-shell canvas,.native-ats-cam-shell img { width:100%; height:100%; object-fit:cover; display:block; }
  .native-ats-cam-shell canvas,.native-ats-cam-shell img { display:none; }
  .native-ats-face-oval { position:absolute; top:50%; left:50%; width:52%; aspect-ratio:1; transform:translate(-50%,-50%); border:4px solid rgba(34,197,94,.85); border-radius:50%; box-shadow:0 0 0 9999px rgba(0,0,0,.35), 0 0 20px rgba(34,197,94,.4); pointer-events:none; animation:nativeAtsPulseOval 2s ease-in-out infinite; }
  @keyframes nativeAtsPulseOval { 0%,100%{border-color:rgba(34,197,94,.85);transform:translate(-50%,-50%) scale(1)} 50%{border-color:rgba(34,197,94,.65);transform:translate(-50%,-50%) scale(1.02)} }
  .native-ats-cam-hint { position:absolute; bottom:16px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,.75); color:#fff; padding:8px 16px; border-radius:99px; font-size:12px; font-weight:600; backdrop-filter:blur(8px); animation:nativeAtsFadeUp .5s ease forwards; }
  .native-ats-cam-btns { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:12px; }
  .native-ats-cam-btn { border:none; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; border-radius:var(--ats-r); padding:14px 8px; font-size:14px; font-weight:800; cursor:pointer; box-shadow:0 4px 12px rgba(99,102,241,.3); transition:all .2s; }
  .native-ats-cam-btn:active { transform:scale(.96); box-shadow:0 2px 8px rgba(99,102,241,.4); }
  .native-ats-cam-btn.success { background:linear-gradient(135deg,#10b981,#059669); box-shadow:0 4px 12px rgba(16,185,129,.3); }
  .native-ats-helper { font-size:12px; color:var(--ats-muted); margin-top:6px; line-height:1.5; }

  .native-ats-bnav { flex:0 0 auto; padding:10px 12px calc(env(safe-area-inset-bottom,0px) + 10px); background:var(--ats-surface); border-top:1px solid var(--ats-border); display:flex; gap:10px; }
  .native-ats-btn-back { border:1.5px solid var(--ats-border); background:var(--ats-surface); color:var(--ats-text); border-radius:var(--ats-r); padding:14px 20px; font-family:'Nunito',sans-serif; font-size:15px; font-weight:800; cursor:pointer; display:flex; align-items:center; gap:5px; white-space:nowrap; }
  .native-ats-btn-back:active { background:#f1f5f9; }
  .native-ats-btn-next { flex:1; background:var(--ats-grad); color:#fff; border:none; border-radius:var(--ats-r); padding:14px 20px; font-family:'Nunito',sans-serif; font-size:16px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 5px 18px rgba(109,40,217,.32); }
  .native-ats-btn-next:active { opacity:.9; }
  .native-ats-btn-next:disabled { opacity:.6; cursor:not-allowed; }

  .native-ats-loading-wrap { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; gap:16px; padding:24px; }
  .native-ats-spinner { width:36px; height:36px; border:3.5px solid rgba(109,40,217,.15); border-top-color:var(--ats-primary); border-radius:50%; animation:nativeAtsSpin .65s linear infinite; }
  @keyframes nativeAtsSpin { to { transform:rotate(360deg); } }
  .native-ats-loading-title { font-family:'Nunito',sans-serif; font-weight:900; font-size:18px; color:var(--ats-text); }
  .native-ats-loading-sub { font-size:13px; color:var(--ats-muted); text-align:center; }
  .native-ats-loading-steps { display:flex; flex-direction:column; gap:8px; width:100%; max-width:260px; margin-top:4px; }
  .native-ats-lstep { display:flex; align-items:center; gap:10px; font-size:13px; font-weight:600; color:#94a3b8; background:#f7f9fc; border:1.5px solid var(--ats-border); border-radius:var(--ats-rs); padding:9px 12px; transition:all .3s; }
  .native-ats-lstep.active { color:var(--ats-primary); border-color:var(--ats-primary); background:var(--ats-plight); }
  .native-ats-lstep.done { color:var(--ats-green); border-color:#a7f3d0; background:#f0fdf4; }
  .native-ats-lstep-dot { width:8px; height:8px; border-radius:50%; background:currentColor; flex:0 0 auto; }

  .native-ats-succ-page { padding:16px 12px 28px; }
  .native-ats-succ-banner { background:linear-gradient(135deg,#ecfdf5,#d1fae5); border:1px solid #a7f3d0; border-radius:var(--ats-rl); padding:20px 16px; text-align:center; margin-bottom:14px; }
  .native-ats-succ-emoji { font-size:44px; margin-bottom:8px; }
  .native-ats-succ-title { font-family:'Nunito',sans-serif; font-weight:900; font-size:22px; color:#065f46; margin-bottom:5px; }
  .native-ats-succ-sub { font-size:14px; color:#047857; line-height:1.5; }
  .native-ats-cid-pill { display:inline-flex; align-items:center; gap:6px; background:#fff; border:1.5px solid #a7f3d0; border-radius:99px; padding:6px 16px; margin-top:12px; font-family:'Nunito',sans-serif; font-weight:800; font-size:14px; color:#065f46; letter-spacing:.3px; }

  .native-ats-rec-card { background:var(--ats-surface); border-radius:var(--ats-rl); border:1px solid var(--ats-border); box-shadow:var(--ats-sh); padding:16px; }
  .native-ats-rec-sec-title { font-size:11px; font-weight:800; letter-spacing:.7px; text-transform:uppercase; color:var(--ats-primary); margin-bottom:10px; }
  .native-ats-rec-name { font-family:'Nunito',sans-serif; font-size:20px; font-weight:900; margin-bottom:10px; }
  .native-ats-rec-row { font-size:14px; color:var(--ats-muted); margin-bottom:7px; display:flex; align-items:center; gap:8px; }
  .native-ats-rec-row span { color:var(--ats-text); font-weight:600; }
  .native-ats-rec-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px; }
  .native-ats-rec-btn { border:1.5px solid var(--ats-plight); background:var(--ats-plight); color:var(--ats-primary); border-radius:var(--ats-rs); padding:13px 10px; font-family:'Nunito',sans-serif; font-size:14px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; text-decoration:none; }
  .native-ats-rec-btn:active { background:#ddd6fe; }

  .native-ats-upload-status { margin-top:12px; border-radius:var(--ats-rs); padding:10px 14px; font-size:13px; font-weight:600; display:flex; align-items:center; gap:10px; border:1.5px solid var(--ats-border); background:#f7f9fc; color:var(--ats-muted); transition:all .4s; }
  .native-ats-upload-status.uploading { border-color:var(--ats-amber); background:#fffbeb; color:#92400e; }
  .native-ats-upload-status.done { border-color:#a7f3d0; background:#f0fdf4; color:#065f46; }
  .native-ats-upload-status.failed { border-color:#fecaca; background:#fff5f5; color:#b91c1c; }
  .native-ats-us-spin { width:16px; height:16px; border-radius:50%; flex:0 0 auto; border:2px solid rgba(146,64,14,.25); border-top-color:#92400e; animation:nativeAtsSpin .6s linear infinite; }

  .native-ats-err-card { margin:20px 12px; background:#fff5f5; border:1px solid #fecaca; border-radius:var(--ats-rl); padding:24px 20px; text-align:center; }
  .native-ats-err-emoji { font-size:34px; margin-bottom:10px; }
  .native-ats-err-title { font-family:'Nunito',sans-serif; font-weight:900; font-size:18px; color:#b91c1c; margin-bottom:8px; }
  .native-ats-err-msg { font-size:14px; color:#64748b; line-height:1.55; white-space:pre-wrap; }

  @keyframes nativeAtsFadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  .native-ats-anim { animation:nativeAtsFadeUp .22s ease forwards; }
  .native-ats-hidden { display:none !important; }
`;

export default function NativeATSCandidateRegistration() {
  const [screen, setScreen] = useState<"loading" | "welcome" | "form" | "submitting" | "success" | "error">("loading");
  const [bootstrap, setBootstrap] = useState<Bootstrap>(DEFAULT_BOOTSTRAP);

  // Build sections dynamically from API field schema; fall back to static SECTIONS if not loaded
  const dynamicSections: SectionConfig[] = React.useMemo(() => {
    if (!bootstrap.fields || bootstrap.fields.length === 0) return SECTIONS;
    const visible = [...bootstrap.fields]
      .filter((f: FieldDef) => f.visible)
      .sort((a: FieldDef, b: FieldDef) => a.sort_order - b.sort_order);
    const map: Record<string, FieldConfig[]> = {};
    for (const f of visible) {
      if (!map[f.section]) map[f.section] = [];
      map[f.section].push({
        k: f.k as keyof CandidateFormData,
        lb: f.lb,
        t: f.t as FieldConfig['t'],
        ic: f.ic,
        ph: f.ph ?? undefined,
        ok: (f.ok ?? undefined) as keyof Bootstrap | undefined,
      });
    }
    return Object.entries(map).map(([title, fields]) => ({ title, fields }));
  }, [bootstrap.fields]);

  const isFieldRequired = (fieldKey: string): boolean => {
    if (!bootstrap.fields || bootstrap.fields.length === 0) return true;
    const field = bootstrap.fields.find((f: FieldDef) => f.k === fieldKey);
    return field ? (field.visible && field.required) : false;
  };

  const [form, setForm] = useState<CandidateFormData>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingStep, setLoadingStep] = useState(1);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "done" | "failed">("idle");
  const [uploadMessage, setUploadMessage] = useState("Preparing file upload…");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string>("");
  const [consentGiven, setConsentGiven] = useState(false);
  const [branchRecruiters, setBranchRecruiters] = useState<RecruiterChoice[]>([]);
  const [recruiterSearch, setRecruiterSearch] = useState("");

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const [scanMode, setScanMode]   = useState<'idle'|'options'|'preview'|'scanning'|'done'>('idle');
  const [scanImage, setScanImage] = useState<string | null>(null);
  const [scanFile,  setScanFile]  = useState<File | null>(null);
  const [scanStatus, setScanStatus] = useState('');
  const scanFileInputRef  = useRef<HTMLInputElement | null>(null);
  const scanCameraInputRef = useRef<HTMLInputElement | null>(null);

  const coreData = useMemo(
    () => ({
      name: form.name,
      mobile: form.mobile,
      email: form.email,
      address: form.address,
      education: form.education,
      experience: form.experience,
      gender: form.gender,
      roleApplied: form.roleApplied,
      sourceType: form.sourceType,
      recruiterName: form.recruiterName,
      recruiterId: form.recruiterId,
      referredBy: form.referredBy,
      branch: form.branch,
      rotationalShift: form.rotationalShift,
      preferredShift: form.preferredShift,
      nightShiftComfort: form.nightShiftComfort,
      leavesRequired: form.leavesRequired,
      ownTwoWheeler: form.ownTwoWheeler,
      idProofAvailable: form.idProofAvailable,
      educationProofAvailable: form.educationProofAvailable,
    }),
    [form]
  );

  const selectedRecruiterChoice = useMemo(
    () => branchRecruiters.find((item) => item.id === form.recruiterId) ?? null,
    [branchRecruiters, form.recruiterId]
  );

  const findRecruiterChoice = (rawValue: string) => {
    const normalized = normalizeRecruiterLookupValue(rawValue);
    if (!normalized) return null;

    return branchRecruiters.find((item) => {
      const code = normalizeRecruiterLookupValue(String(item.employee_code ?? ""));
      const label = normalizeRecruiterLookupValue(item.label);
      const name = normalizeRecruiterLookupValue(String(item.name ?? ""));
      return label === normalized || name === normalized || (!!code && code === normalized);
    }) ?? null;
  };

  useEffect(() => {
    loadBootstrap();
    return () => stopCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When branch changes, load recruiters for that branch
  useEffect(() => {
    const branch = form.branch;
    if (!branch) { setBranchRecruiters([]); setRecruiterSearch(""); return; }
    hrmsApi.get(`/api/ats/form-config/recruiters-by-branch?branch=${encodeURIComponent(branch)}`)
      .then((res: any) => {
        const list: RecruiterChoice[] = (res?.data ?? []).map((r: any) => ({
          id: String(r.employee_id ?? ""),
          label: `${String(r.name ?? "").trim()}${r.employee_code ? ` · ${r.employee_code}` : ""}`,
          employee_code: r.employee_code ?? null,
          employee_id: r.employee_id ?? null,
          email: r.email ?? null,
          mobile: r.mobile ?? null,
        })).filter((r: RecruiterChoice) => !!r.id);
        const normalizedList = list.map((item) => {
          const baseName = String(item.label || "")
            .replace(/\s*[Â·].*$/, "")
            .replace(/\s*\(.*\)$/, "")
            .trim();
          const label = item.employee_code ? `${baseName} (${item.employee_code})` : baseName;
          return { ...item, name: baseName, label };
        });
        setBranchRecruiters(normalizedList);
        // Auto-clear recruiter if no longer valid for this branch
        setForm(prev => {
          const keepsSpecial = prev.recruiterId === WALKIN_OPTION_ID || prev.recruiterId === REFERENCE_OPTION_ID;
          if (keepsSpecial || normalizedList.find(r => r.id === prev.recruiterId)) return prev;
          return { ...prev, recruiterId: "", recruiterName: "", sourceType: "", referredBy: "" };
        });
      })
      .catch(() => { setBranchRecruiters([]); setRecruiterSearch(""); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.branch]);

  useEffect(() => {
    if (form.recruiterId === WALKIN_OPTION_ID) {
      setRecruiterSearch("Walk-In");
      return;
    }
    if (form.recruiterId === REFERENCE_OPTION_ID) {
      setRecruiterSearch("Reference");
      return;
    }
    if (selectedRecruiterChoice) {
      setRecruiterSearch(selectedRecruiterChoice.label);
      return;
    }
    if (!form.recruiterId) setRecruiterSearch("");
  }, [form.recruiterId, selectedRecruiterChoice]);

  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.setAttribute("playsinline", "true");
      videoRef.current.play().catch(() => undefined);
    }
  }, [cameraStream]);

  const loadBootstrap = async () => {
  try {
    const res = await hrmsApi.get('/api/ats/form-config/bootstrap').catch(() => null);
    const data = res?.data;
    if (data) {
      // Use branch aliases (display names) if available, otherwise fall back to canonical names
      const branchOptions = data.branchAliases && data.branchAliases.length > 0
        ? data.branchAliases.map((a: BranchAlias) => a.display)
        : data.branchOptions ?? ["Mumbai","Delhi","Bangalore"];

      setBootstrap({
        companyName:             "Mas Callnet India Pvt Ltd",
        fields:                  data.fields              ?? undefined,
        educationOptions:        data.educationOptions    ?? ["10th Pass","12th Pass","Graduate","Post Graduate","Diploma"],
        experienceOptions:       data.experienceOptions   ?? ["Fresher","0-1 Year","1-2 Years","2-3 Years","3+ Years"],
        genderOptions:           data.genderOptions       ?? ["Male","Female","Other"],
        roleOptions:             data.roleOptions         ?? ["Inbound Agent","Outbound Agent","Back Office","Team Leader","Quality Analyst"],
        recruiterOptions:        data.recruiterOptions    ?? ["Admin","HR Team","Sourcer"],
        recruiterDetails:        data.recruiterDetails    ?? [],
        branchOptions,
        branchAliases:           data.branchAliases       ?? [],
        sourceOptions:           data.sourceOptions       ?? ["Walk-In", "Reference", "Other"],
        yesNoOptions:            ["Yes","No"],
        preferredShiftOptions:   data.preferredShiftOptions   ?? ["Morning","Afternoon","Night","Rotational"],
        nightShiftComfortOptions:data.nightShiftComfortOptions ?? ["Comfortable","Not Comfortable","On Request"],
      });
    } else {
      setBootstrap({
        companyName:              "Mas Callnet India Pvt Ltd",
        educationOptions:         ["10th Pass","12th Pass","Graduate","Post Graduate","Diploma"],
        experienceOptions:        ["Fresher","0-1 Year","1-2 Years","2-3 Years","3+ Years"],
        genderOptions:            ["Male","Female","Other"],
        roleOptions:              ["Inbound Agent","Outbound Agent","Back Office","Team Leader","Quality Analyst"],
        recruiterOptions:         ["Admin","HR Team","Sourcer"],
        branchOptions:            ["Mumbai","Delhi","Bangalore","Hyderabad","Chennai","Pune"],
        branchAliases:            [],
        sourceOptions:            ["Walk-In", "Reference", "Other"],
        yesNoOptions:             ["Yes","No"],
        preferredShiftOptions:    ["Morning","Afternoon","Night","Rotational"],
        nightShiftComfortOptions: ["Comfortable","Not Comfortable","On Request"],
      });
    }
    setScreen("welcome");
  } catch (err: any) {
    setSubmitError(`Check deployment permissions and refresh.\n${err?.message || String(err || "")}`);
    setScreen("error");
  }
  };

  const startReg = () => {
    setScreen("form");
    setErrors({});
    bodyRef.current?.scrollTo({ top: 0 });
  };

  const goBack = () => {
    stopCam();
    setScreen("welcome");
  };

  const validateField = (key: keyof CandidateFormData, value: string): string => {
    // Mobile number validation
    if (key === 'mobile') {
      const cleaned = value.replace(/\D/g, '');
      if (!cleaned) return ''; // Empty is ok during typing
      if (cleaned.length < 10) return `📞 Enter ${10 - cleaned.length} more digit${10 - cleaned.length > 1 ? 's' : ''}`;
      if (cleaned.length > 10) return '📞 Mobile must be 10 digits only';
      if (!/^[6-9]/.test(cleaned)) return '📞 Must start with 6, 7, 8, or 9';
      return ''; // Valid!
    }

    // Email validation
    if (key === 'email' && value) {
      if (!value.includes('@')) return '✉️ Email must contain @';
      const parts = value.split('@');
      if (parts.length !== 2) return '✉️ Only one @ allowed';
      if (parts[0].length < 1) return '✉️ Enter username before @';
      if (parts[1].length < 3) return '✉️ Enter domain after @';
      if (!parts[1].includes('.')) return '✉️ Domain must have extension (e.g., .com)';
      const domainParts = parts[1].split('.');
      if (domainParts[domainParts.length - 1].length < 2) return '✉️ Invalid domain extension';
      if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)) return '✉️ Invalid characters in email';
      return ''; // Valid!
    }

    // Name validation
    if (key === 'name' && value) {
      if (value.length < 3) return `📝 Enter ${3 - value.length} more character${3 - value.length > 1 ? 's' : ''}`;
      if (value.length > 100) return '📝 Name too long (max 100 characters)';
      if (!/^[a-zA-Z\s]+$/.test(value)) return '📝 Name can only contain letters and spaces';
      if (value.trim().split(/\s+/).length < 2) return '📝 Please enter full name (first and last)';
      return ''; // Valid!
    }

    // Address validation
    if (key === 'address' && value) {
      if (value.length < 10) return `📍 Enter ${10 - value.length} more character${10 - value.length > 1 ? 's' : ''} for complete address`;
      if (value.length > 500) return '📍 Address too long (max 500 characters)';
      if (!/[a-zA-Z]/.test(value)) return '📍 Address must contain some letters';
      if (!/\d/.test(value)) return '📍 Please include house/building number';
      return ''; // Valid!
    }

    return '';
  };

  const update = (key: keyof CandidateFormData, value: string | File | null) => {
    // For mobile, restrict to 10 digits only
    if (key === 'mobile' && typeof value === 'string') {
      const cleaned = value.replace(/\D/g, '');
      value = cleaned.slice(0, 10); // Hard limit to 10 digits
    }

    setForm((prev) => ({ ...prev, [key]: value }));

    // Real-time validation
    if (typeof value === 'string') {
      const error = validateField(key, value);
      setErrors((prev) => ({ ...prev, [key]: error }));
    } else {
      setErrors((prev) => ({ ...prev, [key]: "" }));
    }
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};
    const errors: string[] = [];

    // Name validation
    const name = String(form.name || "").trim();
    if (!name) {
      nextErrors.name = "📝 Please enter your full name";
      errors.push("📝 Please enter your full name");
    } else if (name.length < 3) {
      nextErrors.name = "📝 Name must be at least 3 characters";
      errors.push("📝 Name must be at least 3 characters");
    } else if (!/^[a-zA-Z\s]+$/.test(name)) {
      nextErrors.name = "📝 Name should only contain letters";
      errors.push("📝 Name should only contain letters");
    }

    // Mobile validation
    const mobile = String(form.mobile || "").replace(/\s/g, "");
    if (!mobile) {
      nextErrors.mobile = "📞 Please enter your mobile number";
      errors.push("📞 Please enter your mobile number");
    } else if (!/^[6-9]\d{9}$/.test(mobile)) {
      nextErrors.mobile = "📞 Please enter a valid 10-digit Indian mobile number";
      errors.push("📞 Please enter a valid 10-digit Indian mobile number (starting with 6-9)");
    }

    // Email validation (if provided)
    const email = String(form.email || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      nextErrors.email = "✉️ Please enter a valid email address";
      errors.push("✉️ Please enter a valid email address");
    }

    // Address validation — only if form-config marks it required
    const address = String(form.address || "").trim();
    if (isFieldRequired('address') && !address) {
      nextErrors.address = "📍 Please enter your address";
      errors.push("📍 Please enter your address");
    } else if (isFieldRequired('address') && address.length < 10) {
      nextErrors.address = "📍 Please enter a complete address (minimum 10 characters)";
      errors.push("📍 Please enter a complete address");
    }

    // Config-driven required field checks — respects form-config visibility + required flags
    const configDrivenFields = [
      { key: 'education',               label: '🎓 Education' },
      { key: 'experience',              label: '💼 Experience' },
      { key: 'gender',                  label: '🧑 Gender' },
      { key: 'roleApplied',             label: '🗂️ Role Applied' },
      { key: 'recruiterName',           label: '🤝 Recruiter Name' },
      { key: 'branch',                  label: '🏢 Branch' },
      { key: 'rotationalShift',         label: '🔄 Rotational Shift' },
      { key: 'preferredShift',          label: '🕐 Preferred Shift' },
      { key: 'nightShiftComfort',       label: '🌙 Night Shift Comfort' },
      { key: 'leavesRequired',          label: '📅 Leaves in 3 Months' },
      { key: 'ownTwoWheeler',           label: '🛵 Own 2 Wheeler' },
      { key: 'idProofAvailable',        label: '🪪 ID Proof' },
      { key: 'educationProofAvailable', label: '📄 Education Proof' },
    ];

    configDrivenFields.forEach(field => {
      if (!isFieldRequired(field.key)) return;
      const value = String(form[field.key as keyof typeof form] || "").trim();
      if (!value) {
        nextErrors[field.key] = `${field.label} is required`;
        errors.push(`${field.label} is required`);
      }
    });

    if (form.sourceType === "Reference" && !String(form.referredBy || "").trim()) {
      nextErrors.referredBy = "Referrer employee name is required";
      errors.push("Referrer employee name is required");
    }

    setErrors(nextErrors);

    if (errors.length > 0) {
      alert('⚠️ Please fix the following:\n\n' + errors.join('\n'));
      const firstErrorKey = Object.keys(nextErrors)[0];
      if (firstErrorKey) {
        window.setTimeout(() => {
          document.getElementById(`native_ats_field_${firstErrorKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
      return false;
    }

    return true;
  };

  const fileToPublicPreview = (file: File) => URL.createObjectURL(file);

  const onResumeFile = (file: File | null) => {
    if (!file) return;

    // Validate file type
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      setErrors((prev) => ({ ...prev, resumeFile: '📎 Only PDF, DOC, DOCX, JPG, PNG files allowed' }));
      return;
    }

    // Validate file size
    if (file.size > 10 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, resumeFile: '📎 File too large! Max 10 MB allowed' }));
      return;
    }

    // Validate file name length
    if (file.name.length > 100) {
      setErrors((prev) => ({ ...prev, resumeFile: '📎 File name too long (max 100 characters)' }));
      return;
    }

    setErrors((prev) => ({ ...prev, resumeFile: '' }));
    update("resumeFile", file);
  };

  // Helper to get recruiter contact info — case-insensitive match
  const getRecruiterContact = (recruiterName: string): RecruiterDetail | null => {
    if (!bootstrap.recruiterDetails?.length) return null;
    const needle = recruiterName.trim().toLowerCase();
    return bootstrap.recruiterDetails.find(r => r.name.trim().toLowerCase() === needle) || null;
  };

  const openCam = async () => {
    stopCam();
    const input = cameraInputRef.current;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      input?.click();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } },
        audio: false,
      });
      setCameraStream(stream);
      setSelfiePreview("");
    } catch {
      input?.click();
    }
  };

  const capSnap = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.srcObject) {
      cameraInputRef.current?.click();
      return;
    }

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;

    const file = new File([blob], "selfie.png", { type: "image/png" });
    update("selfieFile", file);
    setSelfiePreview(canvas.toDataURL("image/png"));
    stopCam(false);
  };

  const onSelfieFilePick = (file: File | null) => {
    if (!file) return;
    if (!/^image\//i.test(file.type)) {
      alert("Please select an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("Max image size is 10 MB.");
      return;
    }
    update("selfieFile", file);
    setSelfiePreview(fileToPublicPreview(file));
  };

  const stopCam = (resetPreview = true) => {
    setCameraStream((stream) => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      return null;
    });
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    if (resetPreview && !form.selfieFile) setSelfiePreview("");
  };

  const uploadFile = async (candidateId: string, file: File, type: "resume" | "selfie") => {
    // Upload via multipart POST to backend; backend handles storage
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);
    // Backend requires mobile to verify upload ownership
    formData.append("mobile", String(form.mobile || "").replace(/\D/g, ""));

    const res = await fetch(apiUrl(`/api/ats/candidates/${candidateId}/upload`), {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).message ?? `File upload failed (${res.status})`);
    }
    const json = await res.json();
    return { path: (json as any).path ?? "", publicUrl: (json as any).url ?? "" };
  };

  const yesNoToInt = (value: string): number | null => {
    if (!value) return null;
    const lower = value.toLowerCase();
    if (lower === 'yes' || lower === 'y' || lower === '1' || lower === 'true') return 1;
    if (lower === 'no' || lower === 'n' || lower === '0' || lower === 'false') return 0;
    return null;
  };

  const submitForm = async () => {
    if (!validateForm()) return;

    stopCam(false);
    setLoadingStep(1);
    setScreen("submitting");
    setSubmitError("");

    const step2 = window.setTimeout(() => setLoadingStep(2), 700);
    const step3 = window.setTimeout(() => setLoadingStep(3), 1400);

    try {
      const preferredRecruiterId =
        coreData.sourceType === "Recruiter" && coreData.recruiterId && !coreData.recruiterId.startsWith("special:")
          ? coreData.recruiterId
          : null;

      const payload = {
        name:                     coreData.name,
        mobile:                   coreData.mobile,
        email:                    coreData.email || null,
        gender:                   coreData.gender || null,
        roleApplied:              coreData.roleApplied || null,
        branchDisplayName:        coreData.branch,
        sourcingChannel:          coreData.sourceType || 'Walk-In',
        address:                  coreData.address || null,
        education:                coreData.education || null,
        experience:               coreData.experience || null,
        rotationalShift:          yesNoToInt(coreData.rotationalShift),
        preferredShift:           coreData.preferredShift || null,
        nightShiftOk:             yesNoToInt(coreData.nightShiftComfort),
        leavesIn3months:          yesNoToInt(coreData.leavesRequired),
        ownsTwoWheeler:           yesNoToInt(coreData.ownTwoWheeler),
        idProofAvailable:         yesNoToInt(coreData.idProofAvailable),
        educationProofAvailable:  yesNoToInt(coreData.educationProofAvailable),
        recruiterName:            coreData.sourceType === "Recruiter" ? (coreData.recruiterName || null) : null,
        referredBy:               coreData.sourceType === "Reference" ? (coreData.referredBy || null) : null,
        ...(preferredRecruiterId ? { preferredRecruiterId } : {}),
      };
      const apiRes = await hrmsApi.post<{ success: boolean; candidateId?: string; candidate_code?: string; branchName?: string; recruiter?: any; message?: string; data?: any }>(
        "/api/ats/registration/submit-enhanced",
        payload
      );

      const res: SubmitResponse = {
        success: apiRes.success,
        message: apiRes.message,
        candidateDbId: apiRes.candidateId ?? apiRes.data?.id ?? "",
        candidateId: apiRes.candidate_code ?? apiRes.data?.candidate_code ?? apiRes.candidateId ?? "",
        recruiterName: apiRes.recruiter?.name || coreData.recruiterName || "",
        branch: apiRes.branchName ?? coreData.branch ?? "",
      };

      if (!res.success) throw new Error(res.message || "Submission failed. Please try again.");

      setResult(res);
      setScreen("success");

      // Record DPDP consent (non-blocking)
      try {
        await hrmsApi.post("/api/privacy/consent", {
          principal_type: "candidate",
          purpose_code: "recruitment",
          consent_text_version: "v1.0",
          consent_text_hash: "candidate_registration_v1",
          channel: "web",
        });
      } catch {
        // Consent logging failure must not block successful registration
      }

      const candidateDbId = res.candidateDbId || "";
      const hasResume = !!form.resumeFile;
      const hasSelfie = !!form.selfieFile;

      if (!hasResume && !hasSelfie) {
        setUploadStatus("done");
        setUploadMessage("✅ No files attached");
        return;
      }

      setUploadStatus("uploading");
      setUploadMessage(hasResume && hasSelfie ? "Uploading resume & selfie…" : hasResume ? "Uploading resume…" : "Uploading selfie…");

      let resumePath: string | null = null;
      let resumeUrl: string | null = null;
      let selfiePath: string | null = null;
      let selfieUrl: string | null = null;

      if (form.resumeFile) {
        const uploaded = await uploadFile(candidateDbId, form.resumeFile, "resume");
        resumePath = uploaded.path;
        resumeUrl = uploaded.publicUrl;
      }

      if (form.selfieFile) {
        const uploaded = await uploadFile(candidateDbId, form.selfieFile, "selfie");
        selfiePath = uploaded.path;
        selfieUrl = uploaded.publicUrl;
      }

      // File metadata stored in remarks for now (no MySQL file storage yet)
      if (resumeUrl || selfieUrl) {
        await hrmsApi.put(`/api/ats/candidates/${candidateDbId}`, {
          remarks: [
            resumeUrl && `Resume: ${resumeUrl}`,
            selfieUrl && `Selfie: ${selfieUrl}`,
          ].filter(Boolean).join(" | "),
        }).catch(() => {}); // non-fatal
      }

      setUploadStatus("done");
      setUploadMessage("✅ Files uploaded successfully");
    } catch (err: any) {
      if (screen === "success") {
        setUploadStatus("failed");
        setUploadMessage("⚠️ File upload failed – contact recruiter");
      } else {
        setSubmitError(err?.message || "Submission failed. Please try again.");
        setScreen("error");
      }
    } finally {
      window.clearTimeout(step2);
      window.clearTimeout(step3);
    }
  };

  const buildField = (f: FieldConfig) => {
    const id = `native_ats_field_${f.k}`;
    const error = errors[f.k];
    const value = form[f.k];

    if (f.t === "text" || f.t === "tel" || f.t === "email") {
      const hasValue = String(value || "").length > 0;
      const isValid = hasValue && !error;
      const inputClass = `native-ats-ti ${error ? 'error' : ''} ${isValid ? 'valid' : ''}`;

      // Helper text based on field
      let helperText = '';
      if (f.k === 'mobile' && hasValue) {
        const cleaned = String(value || "").replace(/\D/g, '');
        if (cleaned.length > 0 && cleaned.length < 10) {
          helperText = `${cleaned.length}/10 digits entered`;
        }
      } else if (f.k === 'email' && hasValue && !isValid && !error) {
        helperText = 'e.g., yourname@example.com';
      } else if (f.k === 'name' && hasValue && String(value || "").length < 3) {
        helperText = `${String(value || "").length}/3 characters (minimum)`;
      }

      return (
        <div className="native-ats-fg" id={id} key={f.k}>
          <label className="native-ats-fl">{f.lb}</label>
          <div className="native-ats-iw">
            <span className="native-ats-ii">{f.ic}</span>
            <input
              className={inputClass}
              type={f.t}
              value={String(value || "")}
              placeholder={f.ph || f.lb}
              onChange={(e) => update(f.k, e.target.value.trimStart())}
              maxLength={f.k === 'mobile' ? 10 : f.k === 'email' ? 100 : 255}
              inputMode={f.k === 'mobile' ? 'numeric' : f.t === 'email' ? 'email' : 'text'}
            />
            {isValid && <span style={{ position: 'absolute', right: 12, fontSize: 16, color: '#10b981' }}>✓</span>}
          </div>
          {helperText && !error && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{helperText}</div>
          )}
          <div className={`native-ats-fe ${error ? "show" : ""}`}>{error}</div>
        </div>
      );
    }

    if (f.t === "textarea") {
      const hasValue = String(value || "").length > 0;
      const isValid = hasValue && !error && String(value || "").length >= 10;
      const charCount = String(value || "").length;
      const inputClass = `native-ats-ta native-ats-ti ${error ? 'error' : ''} ${isValid ? 'valid' : ''}`;

      return (
        <div className="native-ats-fg" id={id} key={f.k}>
          <label className="native-ats-fl">{f.lb}</label>
          <div className="native-ats-iw" style={{ alignItems: "flex-start" }}>
            <span className="native-ats-ii" style={{ top: 13 }}>{f.ic}</span>
            <textarea
              className={inputClass}
              value={String(value || "")}
              placeholder={f.ph || f.lb}
              onChange={(e) => update(f.k, e.target.value.trimStart())}
              maxLength={500}
            />
            {isValid && <span style={{ position: 'absolute', right: 12, top: 12, fontSize: 16, color: '#10b981' }}>✓</span>}
          </div>
          {hasValue && (
            <div style={{ fontSize: 11, color: charCount < 10 ? '#ef4444' : '#64748b', marginTop: 3, textAlign: 'right' }}>
              {charCount}/500 characters {charCount < 10 && `(min 10 required)`}
            </div>
          )}
          <div className={`native-ats-fe ${error ? "show" : ""}`}>{error}</div>
        </div>
      );
    }

    if (f.t === "select") {
      // Recruiter dropdown: ONLY show branch-scoped recruiters (must select branch first)
      const hasValue = f.k === "recruiterName"
        ? String(form.recruiterId || "").length > 0
        : String(value || "").length > 0;
      const isValid = hasValue;
      const selectClass = `native-ats-si ${error ? 'error' : ''} ${isValid ? 'valid' : ''}`;

      return (
        <div className="native-ats-fg" id={id} key={f.k}>
          <label className="native-ats-fl">{f.lb}</label>
          <div className="native-ats-iw native-ats-sw">
            <span className="native-ats-ii">{f.ic}</span>
            {f.k === "recruiterName" ? (
              <>
                <input
                  className={`native-ats-ti ${error ? 'error' : ''} ${isValid ? 'valid' : ''}`}
                  list="native-ats-branch-recruiters"
                  value={recruiterSearch}
                  placeholder={!form.branch ? "Select branch first" : "Type recruiter name, code, Walk-In, or Reference"}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setRecruiterSearch(nextValue);

                    const normalized = normalizeRecruiterLookupValue(nextValue);
                    if (!normalized) {
                      setForm((prev) => ({ ...prev, recruiterId: "", recruiterName: "", sourceType: "", referredBy: "" }));
                      setErrors((prev) => ({ ...prev, recruiterName: "", referredBy: "" }));
                      return;
                    }

                    if (normalized === "walk-in" || normalized === "walk in" || normalized === "walkin") {
                      setForm((prev) => ({ ...prev, recruiterId: WALKIN_OPTION_ID, recruiterName: "Walk-In", sourceType: "Walk-In", referredBy: "" }));
                      setErrors((prev) => ({ ...prev, recruiterName: "", referredBy: "" }));
                      return;
                    }

                    if (normalized === "reference") {
                      setForm((prev) => ({ ...prev, recruiterId: REFERENCE_OPTION_ID, recruiterName: "Reference", sourceType: "Reference" }));
                      setErrors((prev) => ({ ...prev, recruiterName: "", referredBy: "" }));
                      return;
                    }

                    const selectedRecruiter = findRecruiterChoice(nextValue);

                    if (selectedRecruiter) {
                      setForm((prev) => ({
                        ...prev,
                        recruiterId: selectedRecruiter.id,
                        recruiterName: selectedRecruiter.name ?? selectedRecruiter.label,
                        sourceType: "Recruiter",
                        referredBy: "",
                      }));
                      setErrors((prev) => ({ ...prev, recruiterName: "", referredBy: "" }));
                      return;
                    }

                    setForm((prev) => ({ ...prev, recruiterId: "", recruiterName: "", sourceType: "", referredBy: "" }));
                  }}
                  onBlur={() => {
                    if (!recruiterSearch.trim()) return;
                    if (form.recruiterId || !form.branch) return;
                    setErrors((prev) => ({
                      ...prev,
                      recruiterName: "Select a recruiter from this branch, or choose Walk-In / Reference",
                    }));
                  }}
                  disabled={!form.branch}
                />
                <datalist id="native-ats-branch-recruiters">
                  <option value="Walk-In" />
                  <option value="Reference" />
                  {branchRecruiters.map((opt) => (
                    <option key={opt.id} value={opt.label} />
                  ))}
                </datalist>
              </>
            ) : (
              <select className={selectClass} value={String(value || "")} onChange={(e) => update(f.k, e.target.value)}>
                <option value="">{`-- Select ${f.lb} --`}</option>
                {(((f.ok ? (bootstrap[f.ok] as string[]) || [] : []) as string[])).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
            {isValid && <span style={{ position: 'absolute', right: 36, fontSize: 16, color: '#10b981', pointerEvents: 'none' }}>✓</span>}
          </div>
          {f.k === "recruiterName" && form.sourceType === "Reference" && (
            <div style={{ marginTop: 10 }}>
              <label className="native-ats-fl">Employee Reference Name</label>
              <div className="native-ats-iw">
                <span className="native-ats-ii">Ref</span>
                <input
                  className={`native-ats-ti ${errors.referredBy ? 'error' : ''} ${form.referredBy ? 'valid' : ''}`}
                  type="text"
                  value={form.referredBy}
                  placeholder="Enter referring employee name"
                  onChange={(e) => update("referredBy", e.target.value.trimStart())}
                  maxLength={255}
                />
              </div>
              <div className={`native-ats-fe ${errors.referredBy ? "show" : ""}`}>{errors.referredBy}</div>
            </div>
          )}
          {f.k === "recruiterName" && form.branch && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
              Type recruiter name or employee code. Options are limited to the selected branch, plus Walk-In and Reference.
            </div>
          )}
          <div className={`native-ats-fe ${error ? "show" : ""}`}>{error}</div>
        </div>
      );
    }

    if (f.t === "file") {
      const hasFile = !!form.resumeFile;
      const fileError = errors['resumeFile'];
      const fileSize = form.resumeFile ? (form.resumeFile.size / 1024 / 1024).toFixed(2) : '0';

      return (
        <div className="native-ats-fg" key={f.k}>
          <label className="native-ats-fl">{f.lb}</label>
          <button
            type="button"
            className={`native-ats-uz ${hasFile ? "has" : ""} ${fileError ? "error" : ""}`}
            onClick={() => resumeInputRef.current?.click()}
          >
            <div className="native-ats-uz-ico">{hasFile ? "✅" : "⬆️"}</div>
            <div className="native-ats-uz-lbl">
              {hasFile ? `✓ ${form.resumeFile?.name}` : "Tap to upload resume"}
            </div>
            <div className="native-ats-uz-sub">
              {hasFile
                ? `${fileSize} MB • Click to change`
                : "PDF, DOC, DOCX, JPG, PNG • Max 10 MB"}
            </div>
          </button>
          {fileError && <div className="native-ats-fe show">{fileError}</div>}
          <input
            ref={resumeInputRef}
            type="file"
            className="native-ats-hf"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            onChange={(e) => onResumeFile(e.target.files?.[0] || null)}
          />
        </div>
      );
    }

    return (
      <div className="native-ats-fg" key={f.k}>
        <label className="native-ats-fl">{f.lb}</label>
        <div className="native-ats-cam-shell">
          <video ref={videoRef} autoPlay playsInline muted style={{ display: selfiePreview ? "none" : "block" }} />
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <img ref={imageRef} alt="Selfie preview" src={selfiePreview} style={{ display: selfiePreview ? "block" : "none" }} />
          {cameraStream && !selfiePreview && (
            <>
              <div className="native-ats-face-oval" />
              <div className="native-ats-cam-hint">😊 Align your face in the circle</div>
            </>
          )}
          {selfiePreview && (
            <div className="native-ats-cam-hint" style={{ background: "rgba(16,185,129,.85)" }}>✓ Perfect! Looking great!</div>
          )}
        </div>
        <div className="native-ats-cam-btns">
          {!cameraStream && !selfiePreview && (
            <button type="button" className="native-ats-cam-btn" onClick={openCam} style={{ gridColumn: "1 / -1" }}>📷 Open Camera & Smile!</button>
          )}
          {cameraStream && !selfiePreview && (
            <>
              <button type="button" className="native-ats-cam-btn" onClick={capSnap} style={{ gridColumn: "1 / 3" }}>📸 Capture!</button>
              <button type="button" className="native-ats-cam-btn" onClick={() => stopCam()} style={{ background: "linear-gradient(135deg,#ef4444,#dc2626)" }}>✕</button>
            </>
          )}
          {selfiePreview && (
            <>
              <button type="button" className="native-ats-cam-btn success" style={{ gridColumn: "1 / 3" }}>✓ Photo Saved</button>
              <button type="button" className="native-ats-cam-btn" onClick={openCam} style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}>🔄 Retake</button>
            </>
          )}
        </div>
        <input ref={cameraInputRef} type="file" className="native-ats-hf" accept="image/*" capture="user" onChange={(e) => onSelfieFilePick(e.target.files?.[0] || null)} />
        <div className="native-ats-helper" style={{ textAlign: "center", marginTop: 8 }}>
          {form.selfieFile ? <span style={{ color: "var(--ats-green)", fontWeight: 700, fontSize: "14px" }}>🎉 Your photo looks amazing!</span> : <span style={{ color: "var(--ats-muted)" }}>📷 Optional but recommended - helps us match you faster!</span>}
        </div>
      </div>
    );
  };

  const handleScanFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type === 'application/pdf') {
      setScanFile(file);
      setScanImage(null);
      setScanMode('preview');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setScanImage(ev.target?.result as string);
      setScanFile(null);
      setScanMode('preview');
    };
    reader.readAsDataURL(file);
  };

  const extractFromOCR = async (imageDataUrl: string) => {
    setScanMode('scanning');
    setScanStatus('Loading OCR engine...');
    try {
      // Load Tesseract only if not already loaded — wait for actual load, not just tag presence
      await new Promise<void>((resolve, reject) => {
        if ((window as any).Tesseract) { resolve(); return; }
        const existing = document.getElementById('tesseract-script');
        if (existing) {
          // Tag exists but may not be loaded yet — poll for Tesseract
          let attempts = 0;
          const poll = setInterval(() => {
            if ((window as any).Tesseract) { clearInterval(poll); resolve(); }
            else if (++attempts > 40) { clearInterval(poll); reject(new Error('Tesseract load timeout')); }
          }, 250);
          return;
        }
        const s = document.createElement('script');
        s.id = 'tesseract-script';
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load Tesseract'));
        document.head.appendChild(s);
      });

      setScanStatus('Starting OCR...');
      const TesseractLib = (window as any).Tesseract;
      if (!TesseractLib) throw new Error('Tesseract not available after load');

      // Must provide explicit CDN paths — without these, worker.min.js 404s when loaded via script tag
      const worker = await TesseractLib.createWorker('eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0/',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
        logger: (m: any) => {
          if (m.status === 'recognizing text' && m.progress > 0) {
            setScanStatus(`Scanning resume... ${Math.round(m.progress * 100)}%`);
          } else if (m.status === 'loading tesseract core') {
            setScanStatus('Loading OCR engine...');
          } else if (m.status === 'initializing tesseract') {
            setScanStatus('Initializing...');
          } else if (m.status === 'loading language traineddata') {
            setScanStatus('Loading language data...');
          }
        },
      });

      setScanStatus('Extracting text from image...');
      const { data: { text } } = await worker.recognize(imageDataUrl);
      await worker.terminate();
      setScanStatus('Mapping fields...');
      const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);
      const extracted: Partial<CandidateFormData> = {};
      const mobileMatch = text.match(/\b[6-9]\d{9}\b/);
      if (mobileMatch) extracted.mobile = mobileMatch[0];
      const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) extracted.email = emailMatch[0];
      const nameLabel = text.match(/(?:Name|Full Name)\s*[:-]\s*(.+)/i);
      if (nameLabel) {
        extracted.name = nameLabel[1].trim().split('\n')[0].trim();
      } else if (lines.length > 0) {
        const firstLine = lines[0].replace(/[^a-zA-Z\s]/g, '').trim();
        if (firstLine.length >= 3 && firstLine.length <= 60) extracted.name = firstLine;
      }
      const addressMatch = text.match(/(?:Address|Addr)\s*[:-]\s*([\s\S]{5,100}?)(?=\n\n|\b(?:Mobile|Phone|Email|Education|Experience)\b|$)/i);
      if (addressMatch) extracted.address = addressMatch[1].replace(/\n/g, ', ').trim();
      const eduOptions = bootstrap.educationOptions;
      const textLower = text.toLowerCase();
      for (const opt of eduOptions) {
        if (textLower.includes(opt.toLowerCase())) { extracted.education = opt; break; }
      }
      if (!extracted.education) {
        if (textLower.includes('post graduate') || textLower.includes('postgraduate')) extracted.education = eduOptions.find(o => o.toLowerCase().includes('post')) ?? '';
        else if (textLower.includes('graduate') || textLower.includes('b.tech') || textLower.includes('bsc') || textLower.includes('bcom')) extracted.education = eduOptions.find(o => o.toLowerCase() === 'graduate') ?? '';
        else if (textLower.includes('diploma')) extracted.education = eduOptions.find(o => o.toLowerCase().includes('diploma')) ?? '';
        else if (textLower.includes('12th') || textLower.includes('hsc') || textLower.includes('intermediate')) extracted.education = eduOptions.find(o => o.includes('12th')) ?? '';
        else if (textLower.includes('10th') || textLower.includes('ssc') || textLower.includes('matric')) extracted.education = eduOptions.find(o => o.includes('10th')) ?? '';
      }
      const expOptions = bootstrap.experienceOptions;
      for (const opt of expOptions) {
        if (textLower.includes(opt.toLowerCase())) { extracted.experience = opt; break; }
      }
      if (!extracted.experience) {
        if (textLower.includes('fresher') || textLower.includes('no experience')) extracted.experience = expOptions[0];
        else {
          const yearMatch = textLower.match(/(\d+)\s*(?:\+\s*)?year/);
          if (yearMatch) {
            const yrs = parseInt(yearMatch[1]);
            if (yrs === 0)      extracted.experience = expOptions.find(o => o.includes('0-1')) ?? '';
            else if (yrs === 1) extracted.experience = expOptions.find(o => o.includes('1-2')) ?? '';
            else if (yrs === 2) extracted.experience = expOptions.find(o => o.includes('2-3')) ?? '';
            else if (yrs >= 3)  extracted.experience = expOptions.find(o => o.includes('3+')) ?? '';
          }
        }
      }
      if (textLower.includes(' female') || textLower.includes('gender: f')) extracted.gender = 'Female';
      else if (textLower.includes(' male') || textLower.includes('gender: m')) extracted.gender = 'Male';
      setForm(prev => ({
        ...prev,
        ...Object.fromEntries(Object.entries(extracted).filter(([, v]) => v && String(v).trim())),
      }));
      const count = Object.keys(extracted).filter(k => extracted[k as keyof typeof extracted]).length;
      setScanStatus(`Extracted ${count} field(s). Please review and correct before submitting.`);
      setScanMode('done');
    } catch (err: any) {
      const msg = err?.message ?? '';
      const reason =
        msg.includes('Failed to load Tesseract') || msg.includes('load timeout')
          ? '📡 Could not load OCR engine. Check your internet and try again.'
          : msg.includes('network') || msg.includes('fetch')
            ? '🌐 Network error while loading OCR engine. Check your connection.'
            : msg.includes('not available')
              ? '⚙️ OCR engine did not initialise. Try refreshing the page.'
              : `⚠️ OCR failed: ${msg || 'Unknown error'}`;
      setScanStatus(reason);
      setScanMode('done'); // Keep visible so user sees the error, not swallowed
    }
  };

  const dataURLtoBlob = (dataUrl: string): Blob => {
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };

  const extractFromResume = async () => {
    setScanMode('scanning');
    setScanStatus('Analysing resume with AI…');
    try {
      const fd = new FormData();
      if (scanFile) {
        fd.append('file', scanFile);
      } else if (scanImage) {
        fd.append('file', dataURLtoBlob(scanImage), 'resume.jpg');
      } else {
        setScanStatus('⚠️ No resume selected');
        setScanMode('done');
        return;
      }
      fd.append('options', JSON.stringify({
        roleOptions: bootstrap.roleOptions ?? [],
        educationOptions: bootstrap.educationOptions ?? [],
        experienceOptions: bootstrap.experienceOptions ?? [],
        preferredShiftOptions: bootstrap.preferredShiftOptions ?? [],
        nightShiftComfortOptions: bootstrap.nightShiftComfortOptions ?? [],
      }));

      const resp = await fetch(apiUrl('/api/ats/registration/parse-resume'), {
        method: 'POST',
        body: fd,
      });
      const data = await resp.json();

      if (data.needsClientOcr && scanImage) {
        // No Gemini key on backend for images — fall back to Tesseract
        await extractFromOCR(scanImage);
        return;
      }

      const fields = data.fields ?? {};
      const filled: string[] = [];

      // Map each field key to the bootstrap options list for that field (select fields).
      // Text fields have no options list (null) — written as-is.
      const optionLists: Record<string, string[] | null> = {
        name: null, mobile: null, email: null, address: null,
        education: bootstrap.educationOptions ?? [],
        experience: bootstrap.experienceOptions ?? [],
        gender: ['Male', 'Female', 'Other'],
        roleApplied: bootstrap.roleOptions ?? [],
        rotationalShift: ['Yes', 'No'],
        preferredShift: bootstrap.preferredShiftOptions ?? [],
        nightShiftComfort: bootstrap.nightShiftComfortOptions ?? [],
        leavesRequired: ['Yes', 'No'],
        ownTwoWheeler: ['Yes', 'No'],
      };
      const fieldMap: Record<string, keyof CandidateFormData> = {
        name: 'name', mobile: 'mobile', email: 'email', address: 'address',
        education: 'education', experience: 'experience', gender: 'gender',
        roleApplied: 'roleApplied', rotationalShift: 'rotationalShift',
        preferredShift: 'preferredShift', nightShiftComfort: 'nightShiftComfort',
        leavesRequired: 'leavesRequired', ownTwoWheeler: 'ownTwoWheeler',
      };

      // Case-insensitive exact match then partial match against the dropdown options.
      // Returns the canonical option string if found, otherwise returns the raw value for text fields.
      const normalise = (value: string, opts: string[] | null): string => {
        if (!value || !value.trim()) return '';
        if (!opts) return value.trim(); // free-text field
        const v = value.trim().toLowerCase();
        // Exact match (case-insensitive)
        const exact = opts.find(o => o.toLowerCase() === v);
        if (exact) return exact;
        // Partial: option contains value OR value contains option
        const partial = opts.find(o => o.toLowerCase().includes(v) || v.includes(o.toLowerCase()));
        if (partial) return partial;
        return ''; // no match → leave blank rather than write a wrong value
      };

      setForm(prev => {
        const next = { ...prev };
        for (const [k, fk] of Object.entries(fieldMap)) {
          const raw = String(fields[k] ?? '').trim();
          const normalised = normalise(raw, optionLists[k] ?? null);
          if (normalised) {
            (next as any)[fk] = normalised;
            filled.push(k);
          }
        }
        return next;
      });
      setScanStatus(filled.length > 0
        ? `✅ Filled ${filled.length} field(s) from resume — please review!`
        : '⚠️ Could not extract details — please fill manually');
      setScanMode('done');
    } catch (err: any) {
      // If backend fails entirely, try Tesseract as last resort for images
      if (scanImage) {
        await extractFromOCR(scanImage);
      } else {
        setScanStatus(`❌ Parse failed: ${err?.message ?? 'Unknown error'}`);
        setScanMode('done');
      }
    }
  };

  const renderLoading = () => (
    <div className="native-ats-loading-wrap">
      <div className="native-ats-spinner" />
      <div className="native-ats-loading-title">Loading…</div>
    </div>
  );

  const renderWelcome = () => (
    <div className="native-ats-welcome native-ats-anim">
      <div style={{ position: "relative", marginBottom: 20 }}>
        <div className="native-ats-welcome-icon">
          <CompanyLogo size="lg" />
        </div>
        <div style={{
          position: "absolute",
          top: -8,
          right: -8,
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "#22c55e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          animation: "nativeAtsPop .6s cubic-bezier(.68,-.55,.265,1.55)"
        }}>✓</div>
      </div>
      <h1 className="native-ats-welcome-title">Welcome to MAS! 👋</h1>
      <p className="native-ats-welcome-desc">You're just 2 minutes away from joining an amazing team! Let's make this quick, easy, and fun.</p>
      <button className="native-ats-btn-start" onClick={startReg}>🚀 Let's Get Started!</button>
      <div style={{ marginTop: 24, fontSize: 12, color: "var(--ats-muted)", display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
        <span>⚡ Takes only 2 mins</span>
        <span>•</span>
        <span>📱 Mobile friendly</span>
      </div>
    </div>
  );

  const renderForm = () => {
    // Calculate completion percentage
    const requiredFields = ['name', 'mobile', 'email', 'address', 'education', 'experience', 'gender', 'roleApplied', 'recruiterName', 'branch', 'rotationalShift', 'preferredShift', 'nightShiftComfort', 'leavesRequired', 'ownTwoWheeler', 'idProofAvailable', 'educationProofAvailable'];
    if (form.sourceType === "Reference") requiredFields.push('referredBy');
    const filledFields = requiredFields.filter(k => {
      const val = form[k as keyof CandidateFormData];
      return val && String(val).trim().length > 0 && !errors[k];
    });
    const completionPercent = Math.round((filledFields.length / requiredFields.length) * 100);

    return (
      <div className="native-ats-single-page native-ats-anim">
        <div className="native-ats-step-hdr">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <CompanyLogo size="md" />
            <div style={{ flex: 1 }}>
              <div className="native-ats-step-lbl">Candidate Registration</div>
              <h2 className="native-ats-step-ttl">Complete Details</h2>
            </div>
          </div>
          <div style={{ background: '#f0f4ff', borderRadius: 10, padding: '10px 14px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#4338ca' }}>
                {completionPercent}% Complete
              </span>
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                {filledFields.length}/{requiredFields.length} fields filled
              </span>
            </div>
            <div style={{ height: 6, background: '#ddd6fe', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                borderRadius: 99,
                width: `${completionPercent}%`,
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
          <p className="native-ats-step-dsc">✨ Real-time validation • All fields required</p>
        </div>
      <div className="native-ats-form-card">
          {/* Scan Resume — optional, above form sections */}
          {scanStatus && scanMode === 'idle' && (
            <div style={{ marginBottom: 16, padding: 14, background: 'linear-gradient(135deg,#fef3c7,#fde68a)', borderRadius: 12, border: '1px solid #fbbf24', animation: 'nativeAtsFadeUp .4s ease forwards' }}>
              <div style={{ fontSize: '0.9rem', color: '#92400e', fontWeight: 600, textAlign: 'center' }}>{scanStatus}</div>
            </div>
          )}
          <div style={{ marginBottom: 24, padding: 16, background: 'linear-gradient(135deg,#f0f4ff,#e0e7ff)', borderRadius: 14, border: '2px solid #c7d2fe', boxShadow: '0 4px 12px rgba(99,102,241,.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: scanMode !== 'idle' ? 12 : 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#4338ca', display: 'flex', alignItems: 'center', gap: 6 }}>
                  ✨ Quick Scan (Optional)
                </div>
                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 3 }}>Snap your resume and we'll fill the form for you! Or fill manually - both are easy.</div>
              </div>
              {scanMode === 'idle' && (
                <button type="button" onClick={() => setScanMode('options')}
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700, boxShadow: '0 4px 12px rgba(99,102,241,.3)', transition: 'all .2s' }}>
                  📸 Scan Now
                </button>
              )}
              {scanMode !== 'idle' && (
                <button type="button" onClick={() => { setScanMode('idle'); setScanImage(null); setScanFile(null); setScanStatus(''); }}
                  style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>✕</button>
              )}
            </div>
            {scanMode === 'options' && (
              <div style={{ display: 'flex', gap: 10 }}>
                <input type="file" accept="image/*" capture="environment" ref={scanCameraInputRef} style={{ display: 'none' }} onChange={handleScanFileChange} />
                <input type="file" accept="image/*,application/pdf" ref={scanFileInputRef} style={{ display: 'none' }} onChange={handleScanFileChange} />
                <button type="button" onClick={() => scanCameraInputRef.current?.click()}
                  style={{ flex: 1, padding: 12, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, boxShadow: '0 3px 10px rgba(99,102,241,.25)' }}>📷 Take Photo</button>
                <button type="button" onClick={() => scanFileInputRef.current?.click()}
                  style={{ flex: 1, padding: 12, background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, boxShadow: '0 3px 10px rgba(16,185,129,.25)' }}>📁 Upload (Image / PDF)</button>
              </div>
            )}
            {scanMode === 'preview' && (scanImage || scanFile) && (
              <div style={{ textAlign: 'center' }}>
                {scanImage ? (
                  <img src={scanImage} alt="Resume preview" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 12, marginBottom: 12, objectFit: 'contain', border: '2px solid #c7d2fe', boxShadow: '0 4px 12px rgba(0,0,0,.1)' }} />
                ) : (
                  <div style={{ padding: '20px 16px', marginBottom: 12, background: '#f0f4ff', borderRadius: 12, border: '2px solid #c7d2fe', fontSize: '0.9rem', fontWeight: 600, color: '#4338ca' }}>
                    📄 {scanFile?.name}
                  </div>
                )}
                <button type="button" onClick={extractFromResume}
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 28px', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', boxShadow: '0 4px 12px rgba(99,102,241,.3)' }}>✨ Extract Details with AI</button>
              </div>
            )}
            {scanMode === 'scanning' && (
              <div style={{ textAlign: 'center', padding: 16, color: '#4f46e5' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8, animation: 'nativeAtsSpin 1.5s linear infinite' }}>🔍</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{scanStatus}</div>
              </div>
            )}
            {scanMode === 'done' && (
              <div style={{
                background: scanStatus.startsWith('⚠️') || scanStatus.startsWith('📡') || scanStatus.startsWith('🌐') || scanStatus.startsWith('⚙️')
                  ? 'linear-gradient(135deg,#fef2f2,#fee2e2)' : 'linear-gradient(135deg,#ecfdf5,#d1fae5)',
                borderRadius: 10, padding: '12px 16px', fontSize: '0.88rem',
                color: scanStatus.startsWith('⚠️') || scanStatus.startsWith('📡') || scanStatus.startsWith('🌐') || scanStatus.startsWith('⚙️')
                  ? '#991b1b' : '#166534',
                fontWeight: 600,
                border: scanStatus.startsWith('⚠️') || scanStatus.startsWith('📡') || scanStatus.startsWith('🌐') || scanStatus.startsWith('⚙️')
                  ? '1px solid #fca5a5' : '1px solid #a7f3d0',
              }}>{scanStatus}</div>
            )}
          </div>
        {dynamicSections.map((section) => (
          <div className="native-ats-sec-block" key={section.title}>
            <div className="native-ats-sec-title">{section.title}</div>
            {section.fields.map(buildField)}
          </div>
        ))}
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4" style={{ marginTop: 16 }}>
          <input
            type="checkbox"
            id="consent"
            checked={consentGiven}
            onChange={(e) => setConsentGiven(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="consent" className="text-sm text-slate-700">
            I consent to the processing of my personal data for recruitment purposes as per the{" "}
            <a href="/privacy-policy" target="_blank" rel="noreferrer" className="text-blue-600 underline">Privacy Policy</a>{" "}
            and the Digital Personal Data Protection Act 2023. I understand I may withdraw this consent at any time.
          </label>
        </div>
      </div>
    </div>
    );
  };

  const renderSubmitting = () => (
    <div className="native-ats-loading-wrap native-ats-anim">
      <div className="native-ats-spinner" />
      <div className="native-ats-loading-title">Submitting…</div>
      <div className="native-ats-loading-sub">Please wait a moment</div>
      <div className="native-ats-loading-steps">
        {[1, 2, 3].map((n) => (
          <div key={n} className={`native-ats-lstep ${loadingStep === n ? "active" : loadingStep > n ? "done" : ""}`}>
            <div className="native-ats-lstep-dot" />
            {n === 1 ? "Verifying details" : n === 2 ? "Saving your profile" : "Generating Candidate ID"}
          </div>
        ))}
      </div>
    </div>
  );

  const renderSuccess = () => {
    const recruiterContact = getRecruiterContact(result?.recruiterName || '');
    const mobile = result?.recruiterMobile || recruiterContact?.mobile || "";
    const email = result?.recruiterEmail || recruiterContact?.email || "";
    return (
      <div className="native-ats-succ-page native-ats-anim">
        <div className="native-ats-succ-banner">
          <div className="native-ats-succ-emoji">🎉</div>
          <div className="native-ats-succ-title">Registration Submitted!</div>
          <div className="native-ats-succ-sub">Your details have been received successfully.</div>
          <div className="native-ats-cid-pill">🪪 {result?.candidateId || ""}</div>
        </div>
        <div className={`native-ats-upload-status ${uploadStatus}`}>
          {uploadStatus === "uploading" && <div className="native-ats-us-spin" />}
          <span>{uploadMessage}</span>
        </div>
        <div className="native-ats-rec-card">
          <div className="native-ats-rec-sec-title">Your Recruiter</div>
          <div className="native-ats-rec-name">{result?.recruiterName || ""}</div>
          <div className="native-ats-rec-row">📞 <span><b>Mobile:</b> {mobile}</span></div>
          <div className="native-ats-rec-row">✉️ <span><b>Email:</b> {email}</span></div>
          <div className="native-ats-rec-row">🏢 <span><b>Branch:</b> {result?.branch || ""}</span></div>
          <div className="native-ats-rec-actions">
            <a className="native-ats-rec-btn" href={`tel:${mobile}`}>📞 Call Recruiter</a>
            <a className="native-ats-rec-btn" href={`mailto:${email}`}>✉️ Email Recruiter</a>
          </div>
        </div>
      </div>
    );
  };

  const renderError = () => (
    <div className="native-ats-err-card native-ats-anim">
      <div className="native-ats-err-emoji">⚠️</div>
      <div className="native-ats-err-title">{submitError.includes("deployment") ? "Could not load app" : "Submission Failed"}</div>
      <div className="native-ats-err-msg">{submitError}</div>
    </div>
  );

  return (
    <div className="native-ats-candidate">
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      <div className="native-ats-app">
        <div className="native-ats-hdr">
          <div className="native-ats-hdr-brand">
            <div className="native-ats-hdr-icon">
              <CompanyLogo size="sm" />
            </div>
            <div>
              <div className="native-ats-hdr-title">{bootstrap.companyName.toUpperCase()}</div>
              <div className="native-ats-hdr-sub">Interview Registration Portal</div>
            </div>
          </div>
          {screen === "form" && (
            <div className="native-ats-prog-strip">
              <div className="native-ats-prog-track"><div className="native-ats-prog-fill" style={{ width: "100%" }} /></div>
            </div>
          )}
        </div>

        <div className="native-ats-body" ref={bodyRef}>
          {screen === "loading" && renderLoading()}
          {screen === "welcome" && renderWelcome()}
          {screen === "form" && renderForm()}
          {screen === "submitting" && renderSubmitting()}
          {screen === "success" && renderSuccess()}
          {screen === "error" && renderError()}
        </div>

        {screen === "form" && (
          <div className="native-ats-bnav">
            <button className="native-ats-btn-back" onClick={goBack}>‹ Back</button>
            <button
              className="native-ats-btn-next"
              onClick={submitForm}
              disabled={!consentGiven || Object.values(errors).some(e => e.length > 0)}
              title={!consentGiven ? "Please accept consent to continue" : Object.values(errors).some(e => e.length > 0) ? "Please fix validation errors" : "Submit your registration"}
            >
              {Object.values(errors).some(e => e.length > 0) ? "⚠️ Fix Errors First" : "Finish & Submit ✓"}
            </button>
          </div>
        )}

        {screen === "error" && !submitError.includes("deployment") && (
          <div className="native-ats-bnav">
            <button className="native-ats-btn-back" onClick={() => setScreen("form")}>‹ Back</button>
          </div>
        )}
      </div>
    </div>
  );
}
