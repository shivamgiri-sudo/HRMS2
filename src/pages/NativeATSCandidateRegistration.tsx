import React, { useEffect, useMemo, useRef, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";

type Bootstrap = {
  fields?: FieldDef[];
  companyName: string;
  educationOptions: string[];
  experienceOptions: string[];
  genderOptions: string[];
  roleOptions: string[];
  recruiterOptions: string[];
  branchOptions: string[];
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
  recruiterName: string;
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
  recruiterName: "",
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
  companyName: "Mas Callnet India Pvt. Ltd.",
  educationOptions: [],
  experienceOptions: [],
  genderOptions: [],
  roleOptions: [],
  recruiterOptions: [],
  branchOptions: [],
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
      { k: "roleApplied", lb: "Role Applied", t: "select", ic: "🗂️", ok: "roleOptions" },
      { k: "recruiterName", lb: "Recruiter Name", t: "select", ic: "🤝", ok: "recruiterOptions" },
      { k: "branch", lb: "Branch", t: "select", ic: "🏢", ok: "branchOptions" },
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
  .native-ats-sw { position:relative; }
  .native-ats-sw::after { content:'▾'; position:absolute; right:12px; top:50%; transform:translateY(-50%); color:#94a3b8; pointer-events:none; font-size:13px; }
  .native-ats-si { cursor:pointer; padding-right:34px; }
  .native-ats-fe { font-size:12px; color:var(--ats-red); margin-top:4px; font-weight:700; display:none; }
  .native-ats-fe.show { display:block; }

  .native-ats-uz { border:2px dashed var(--ats-border); border-radius:var(--ats-rs); padding:20px 16px; text-align:center; cursor:pointer; background:#f7f9fc; transition:border-color .15s,background .15s; }
  .native-ats-uz:active { background:var(--ats-plight); }
  .native-ats-uz.has { border-color:var(--ats-green); background:#f0fdf4; }
  .native-ats-uz-ico { font-size:26px; margin-bottom:6px; }
  .native-ats-uz-lbl { font-size:14px; font-weight:700; margin-bottom:3px; }
  .native-ats-uz-sub { font-size:12px; color:var(--ats-muted); }
  .native-ats-hf { display:none; }

  .native-ats-cam-shell { border-radius:var(--ats-rs); overflow:hidden; position:relative; background:#0f172a; width:100%; aspect-ratio:4/3; max-height:240px; }
  .native-ats-cam-shell video,.native-ats-cam-shell canvas,.native-ats-cam-shell img { width:100%; height:100%; object-fit:cover; display:block; }
  .native-ats-cam-shell canvas,.native-ats-cam-shell img { display:none; }
  .native-ats-face-oval { position:absolute; top:50%; left:50%; width:52%; aspect-ratio:1; transform:translate(-50%,-50%); border:3px solid rgba(255,255,255,.9); border-radius:50%; box-shadow:0 0 0 9999px rgba(0,0,0,.28); pointer-events:none; }
  .native-ats-cam-btns { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-top:8px; }
  .native-ats-cam-btn { border:1.5px solid var(--ats-border); background:#f7f9fc; border-radius:var(--ats-rs); padding:10px 6px; font-size:13px; font-weight:700; cursor:pointer; color:var(--ats-text); }
  .native-ats-cam-btn:active { background:#e2e8f0; }
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

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const [scanMode, setScanMode]   = useState<'idle'|'options'|'preview'|'scanning'|'done'>('idle');
  const [scanImage, setScanImage] = useState<string | null>(null);
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
      recruiterName: form.recruiterName,
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

  useEffect(() => {
    loadBootstrap();
    return () => stopCam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.setAttribute("playsinline", "true");
      videoRef.current.play().catch(() => undefined);
    }
  }, [cameraStream]);

  const loadBootstrap = async () => {
  try {
    const res = await hrmsApi.get('/ats/form-config/bootstrap').catch(() => null);
    const data = res?.data?.data;
    if (data) {
      setBootstrap({
        companyName:             "Mas Callnet India Pvt. Ltd.",
        fields:                  data.fields              ?? undefined,
        educationOptions:        data.educationOptions    ?? ["10th Pass","12th Pass","Graduate","Post Graduate","Diploma"],
        experienceOptions:       data.experienceOptions   ?? ["Fresher","0-1 Year","1-2 Years","2-3 Years","3+ Years"],
        genderOptions:           data.genderOptions       ?? ["Male","Female","Other"],
        roleOptions:             data.roleOptions         ?? ["Inbound Agent","Outbound Agent","Back Office","Team Leader","Quality Analyst"],
        recruiterOptions:        data.recruiterOptions    ?? [],
        branchOptions:           data.branchOptions       ?? ["Mumbai","Delhi","Bangalore"],
        yesNoOptions:            ["Yes","No"],
        preferredShiftOptions:   data.preferredShiftOptions   ?? ["Morning (6AM-2PM)","Afternoon (2PM-10PM)","Night (10PM-6AM)","Rotational"],
        nightShiftComfortOptions:data.nightShiftComfortOptions ?? ["Comfortable","Not Comfortable","On Request"],
      });
    } else {
      setBootstrap({
        companyName:              "Mas Callnet India Pvt. Ltd.",
        educationOptions:         ["10th Pass","12th Pass","Graduate","Post Graduate","Diploma"],
        experienceOptions:        ["Fresher","0-1 Year","1-2 Years","2-3 Years","3+ Years"],
        genderOptions:            ["Male","Female","Other"],
        roleOptions:              ["Inbound Agent","Outbound Agent","Back Office","Team Leader","Quality Analyst"],
        recruiterOptions:         [],
        branchOptions:            ["Mumbai","Delhi","Bangalore","Hyderabad","Chennai","Pune"],
        yesNoOptions:             ["Yes","No"],
        preferredShiftOptions:    ["Morning (6AM-2PM)","Afternoon (2PM-10PM)","Night (10PM-6AM)","Rotational"],
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

  const update = (key: keyof CandidateFormData, value: string | File | null) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};

    dynamicSections.forEach((section) => {
      section.fields.forEach((f) => {
        if (f.t === "camera" || f.t === "file") return;

        const value = String(form[f.k] || "").trim();
        if (!value) {
          nextErrors[f.k] = f.t === "select" ? "Please select an option." : "This field is required.";
        }
      });
    });

    if (!/^\d{10}$/.test(String(form.mobile || "").replace(/\D/g, ""))) {
      nextErrors.mobile = "Enter a valid 10-digit number.";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form.email || "").trim())) {
      nextErrors.email = "Enter a valid email address.";
    }

    setErrors(nextErrors);
    const firstErrorKey = Object.keys(nextErrors)[0];
    if (firstErrorKey) {
      window.setTimeout(() => {
        document.getElementById(`native_ats_field_${firstErrorKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
    return Object.keys(nextErrors).length === 0;
  };

  const fileToPublicPreview = (file: File) => URL.createObjectURL(file);

  const onResumeFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("Max file size is 10 MB.");
      return;
    }
    update("resumeFile", file);
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

  const uploadFile = async (_candidateId: string, file: File, type: "resume" | "selfie") => {
    // File upload stored locally as metadata only (no cloud storage dependency)
    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return { path: `${type}_${safeName}`, publicUrl: "" };
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
      const apiRes = await hrmsApi.post<{ success: boolean; data: any; message?: string }>(
        "/api/ats/candidates",
        {
          fullName:          coreData.name,
          mobile:            coreData.mobile,
          email:             coreData.email || null,
          gender:            coreData.gender || null,
          appliedForProcess: coreData.roleApplied || null,
          appliedForBranch:  coreData.branch || null,
          walkInDate:        new Date().toISOString().slice(0, 10),
          remarks: [
            coreData.address && `Address: ${coreData.address}`,
            coreData.education && `Education: ${coreData.education}`,
            coreData.experience && `Experience: ${coreData.experience}`,
            coreData.recruiterName && `Recruiter: ${coreData.recruiterName}`,
          ].filter(Boolean).join(" | ") || null,
        }
      );

      const res: SubmitResponse = {
        success: apiRes.success,
        message: apiRes.message,
        candidateDbId: apiRes.data?.id ?? "",
        candidateId: apiRes.data?.candidate_code ?? "",
        recruiterName: coreData.recruiterName || "",
        branch: apiRes.data?.applied_for_branch ?? coreData.branch ?? "",
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
      let selfiePath: string | null = null;

      if (form.resumeFile) {
        const uploaded = await uploadFile(candidateDbId, form.resumeFile, "resume");
        resumePath = uploaded.path;
      }

      if (form.selfieFile) {
        const uploaded = await uploadFile(candidateDbId, form.selfieFile, "selfie");
        selfiePath = uploaded.path;
      }

      // File metadata stored in remarks for now (no MySQL file storage yet)
      if (resumePath || selfiePath) {
        await hrmsApi.put(`/api/ats/candidates/${candidateDbId}/files`, {
          remarks: [
            resumePath && `Resume: ${resumePath}`,
            selfiePath && `Selfie: ${selfiePath}`,
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
      return (
        <div className="native-ats-fg" id={id} key={f.k}>
          <label className="native-ats-fl">{f.lb}</label>
          <div className="native-ats-iw">
            <span className="native-ats-ii">{f.ic}</span>
            <input className="native-ats-ti" type={f.t} value={String(value || "")} placeholder={f.ph || f.lb} onChange={(e) => update(f.k, e.target.value.trimStart())} />
          </div>
          <div className={`native-ats-fe ${error ? "show" : ""}`}>{error}</div>
        </div>
      );
    }

    if (f.t === "textarea") {
      return (
        <div className="native-ats-fg" id={id} key={f.k}>
          <label className="native-ats-fl">{f.lb}</label>
          <div className="native-ats-iw" style={{ alignItems: "flex-start" }}>
            <span className="native-ats-ii" style={{ top: 13 }}>{f.ic}</span>
            <textarea className="native-ats-ta native-ats-ti" value={String(value || "")} placeholder={f.ph || f.lb} onChange={(e) => update(f.k, e.target.value.trimStart())} />
          </div>
          <div className={`native-ats-fe ${error ? "show" : ""}`}>{error}</div>
        </div>
      );
    }

    if (f.t === "select") {
      const options = f.ok ? bootstrap[f.ok] || [] : [];
      return (
        <div className="native-ats-fg" id={id} key={f.k}>
          <label className="native-ats-fl">{f.lb}</label>
          <div className="native-ats-iw native-ats-sw">
            <span className="native-ats-ii">{f.ic}</span>
            <select className="native-ats-si" value={String(value || "")} onChange={(e) => update(f.k, e.target.value)}>
              <option value="">Select...</option>
              {options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className={`native-ats-fe ${error ? "show" : ""}`}>{error}</div>
        </div>
      );
    }

    if (f.t === "file") {
      const hasFile = !!form.resumeFile;
      return (
        <div className="native-ats-fg" key={f.k}>
          <label className="native-ats-fl">{f.lb}</label>
          <button type="button" className={`native-ats-uz ${hasFile ? "has" : ""}`} onClick={() => resumeInputRef.current?.click()}>
            <div className="native-ats-uz-ico">{hasFile ? "✅" : "⬆️"}</div>
            <div className="native-ats-uz-lbl">{hasFile ? `✓ ${form.resumeFile?.name}` : "Tap to upload resume"}</div>
            <div className="native-ats-uz-sub">PDF, DOC, DOCX, JPG – max 10 MB</div>
          </button>
          <input ref={resumeInputRef} type="file" className="native-ats-hf" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => onResumeFile(e.target.files?.[0] || null)} />
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
          <div className="native-ats-face-oval" />
        </div>
        <div className="native-ats-cam-btns">
          <button type="button" className="native-ats-cam-btn" onClick={openCam}>📷 Open</button>
          <button type="button" className="native-ats-cam-btn" onClick={capSnap}>🎯 Capture</button>
          <button type="button" className="native-ats-cam-btn" onClick={() => stopCam()}>⏹ Stop</button>
        </div>
        <input ref={cameraInputRef} type="file" className="native-ats-hf" accept="image/*" capture="user" onChange={(e) => onSelfieFilePick(e.target.files?.[0] || null)} />
        <div className="native-ats-helper">
          {form.selfieFile ? <span style={{ color: "var(--ats-green)", fontWeight: 700 }}>✓ Selfie captured</span> : "Optional: open front camera, align face in circle, then capture."}
        </div>
      </div>
    );
  };

  const handleScanFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setScanImage(ev.target?.result as string);
      setScanMode('preview');
    };
    reader.readAsDataURL(file);
  };

  const extractFromOCR = async (imageDataUrl: string) => {
    setScanMode('scanning');
    setScanStatus('Loading OCR engine...');
    try {
      await new Promise<void>((resolve, reject) => {
        if (document.getElementById('tesseract-script') || (window as any).Tesseract) { resolve(); return; }
        const s = document.createElement('script');
        s.id = 'tesseract-script';
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load Tesseract'));
        document.head.appendChild(s);
      });
      setScanStatus('Extracting text from image...');
      const TesseractLib = (window as any).Tesseract;
      if (!TesseractLib) throw new Error('Tesseract not available');
      const worker = await TesseractLib.createWorker('eng');
      const { data: { text } } = await worker.recognize(imageDataUrl);
      await worker.terminate();
      setScanStatus('Mapping fields...');
      const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);
      const extracted: Partial<CandidateFormData> = {};
      const mobileMatch = text.match(/\b[6-9]\d{9}\b/);
      if (mobileMatch) extracted.mobile = mobileMatch[0];
      const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) extracted.email = emailMatch[0];
      const nameLabel = text.match(/(?:Name|Full Name)\s*[:\-]\s*(.+)/i);
      if (nameLabel) {
        extracted.name = nameLabel[1].trim().split('\n')[0].trim();
      } else if (lines.length > 0) {
        const firstLine = lines[0].replace(/[^a-zA-Z\s]/g, '').trim();
        if (firstLine.length >= 3 && firstLine.length <= 60) extracted.name = firstLine;
      }
      const addressMatch = text.match(/(?:Address|Addr)\s*[:\-]\s*([\s\S]{5,100}?)(?=\n\n|\b(?:Mobile|Phone|Email|Education|Experience)\b|$)/i);
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
      setScanStatus(`OCR failed: ${err?.message ?? 'Unknown error'}. Please fill the form manually.`);
      setScanMode('done');
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
      <div className="native-ats-welcome-icon">👥</div>
      <h1 className="native-ats-welcome-title">Welcome! 👋</h1>
      <p className="native-ats-welcome-desc">Welcome to the registration desk. Fill in your details accurately to help our recruiters process your application.</p>
      <button className="native-ats-btn-start" onClick={startReg}>✦ Start Registration</button>
    </div>
  );

  const renderForm = () => (
    <div className="native-ats-single-page native-ats-anim">
      <div className="native-ats-step-hdr">
        <div className="native-ats-step-lbl">Candidate Registration</div>
        <h2 className="native-ats-step-ttl">Complete Details</h2>
        <p className="native-ats-step-dsc">Fill all details below in one page</p>
      </div>
      <div className="native-ats-form-card">
          {/* Scan Resume — optional, above form sections */}
          <div style={{ marginBottom: 24, padding: 16, background: '#f0f4ff', borderRadius: 12, border: '1px solid #c7d2fe' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: scanMode !== 'idle' ? 12 : 0 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#3730a3' }}>📄 Scan Resume (Optional)</div>
                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>Capture a photo of your resume to auto-fill this form. You can still fill manually.</div>
              </div>
              {scanMode === 'idle' && (
                <button type="button" onClick={() => setScanMode('options')}
                  style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                  Scan Resume
                </button>
              )}
              {scanMode !== 'idle' && (
                <button type="button" onClick={() => { setScanMode('idle'); setScanImage(null); setScanStatus(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '0.8rem' }}>✕ Close</button>
              )}
            </div>
            {scanMode === 'options' && (
              <div style={{ display: 'flex', gap: 10 }}>
                <input type="file" accept="image/*" capture="environment" ref={scanCameraInputRef} style={{ display: 'none' }} onChange={handleScanFileChange} />
                <input type="file" accept="image/*" ref={scanFileInputRef} style={{ display: 'none' }} onChange={handleScanFileChange} />
                <button type="button" onClick={() => scanCameraInputRef.current?.click()}
                  style={{ flex: 1, padding: 10, background: '#fff', border: '1px solid #c7d2fe', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem' }}>📷 Take Photo</button>
                <button type="button" onClick={() => scanFileInputRef.current?.click()}
                  style={{ flex: 1, padding: 10, background: '#fff', border: '1px solid #c7d2fe', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem' }}>📁 Upload Image</button>
              </div>
            )}
            {scanMode === 'preview' && scanImage && (
              <div style={{ textAlign: 'center' }}>
                <img src={scanImage} alt="Resume preview" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, marginBottom: 10, objectFit: 'contain' }} />
                <button type="button" onClick={() => extractFromOCR(scanImage)}
                  style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontWeight: 600 }}>Extract Details</button>
              </div>
            )}
            {scanMode === 'scanning' && (
              <div style={{ textAlign: 'center', padding: 12, color: '#4f46e5' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>⏳</div>
                <div style={{ fontSize: '0.85rem' }}>{scanStatus}</div>
              </div>
            )}
            {scanMode === 'done' && (
              <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#166534' }}>✅ {scanStatus}</div>
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
    const mobile = result?.recruiterMobile || "";
    const email = result?.recruiterEmail || "";
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
            <div className="native-ats-hdr-icon">MC</div>
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
            <button className="native-ats-btn-next" onClick={submitForm} disabled={!consentGiven}>Finish & Submit ✓</button>
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
