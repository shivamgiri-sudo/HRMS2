import { useCallback, useEffect, useRef, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useGeoCapture } from "@/hooks/useGeoCapture";

const API = "/api/ats/onboarding-full";
const BGV = "/api/ats/bgv";

export type TokenData = {
  candidate_id: string;
  candidate_code?: string;
  full_name?: string;
  mobile?: string;
  email?: string;
  gender?: string;
  date_of_birth?: string;
  branch_name?: string;
  process_name?: string;
  source_type?: string;
  source?: string;
};

export type DocRecord = {
  id: string;
  doc_type: string;
  doc_name: string;
  page_no?: number;
  file_original_name?: string;
  file_url?: string;
  document_status: string;
  uploaded_at: string;
};

export type StatusData = {
  token: TokenData;
  documents: DocRecord[];
  bank?: Record<string, any>;
  qualifications: any[];
  family?: any;
  experience?: any;
  saved_profile?: Record<string, any>;
};

export type BgvStatus = {
  consent?: any;
  checks: any[];
  score: number;
  overall_status: string;
  employee_creation_ready: boolean;
  payroll_activation_ready: boolean;
  missing_mandatory_checks: string[];
};

export type EmployeeForm = {
  title: string; employeeName: string; relation: string; fatherHusbandName: string;
  motherName: string; gender: string; maritalStatus: string; dateOfBirth: string;
  bloodGroup: string; mobileNumber: string; altMobileNumber: string;
  personalEmailId: string; officialEmailId: string;
  emergencyContactName: string; emergencyContactRelation: string; emergencyContactMobile: string;
  nationality: string; religion: string; category: string;
  permanentAddress: string; permanentState: string; permanentCity: string; permanentPincode: string;
  presentAddress: string; presentState: string; presentCity: string; presentPincode: string;
  addressProofType: string;
  panNumber: string; aadhaarNumber: string; passportNo: string; drivingLicenseNo: string;
  uanNumber: string; epfNumber: string; esicNumber: string;
  nominee: string; nomineeRelation: string; nomineeDateOfBirth: string; nominee1SharePct: string;
  nominee2Name: string; nominee2Relation: string; nominee2Dob: string; nominee2SharePct: string;
};

export type BankForm = {
  bankName: string; branchName: string; accountHolderName: string;
  accountNo: string; confirmAccountNo: string; ifscCode: string; accountType: string;
};

export type QualForm = {
  qualification: string; specializationCourseName: string; passedOutYear: string;
  passedOutState: string; passedOutCity: string; passedOutPercentage: string;
  boardType: string; institutionName: string;
};

export type ExperienceForm = {
  workingExperience: string; experienceYear: string; experienceDocType: string;
  employerName: string; lastDesignation: string; lastCtc: string;
  fromDate: string; toDate: string; reasonForLeaving: string;
};

export type FamilyForm = { annualIncome: string; countOfDependents: string };

export type LanguageRow = {
  id: string; language_name: string; can_read: boolean; can_write: boolean;
  can_speak: boolean; proficiency: string;
};

export type StatutoryForm = {
  previousPfMember: boolean | null; epsMember: boolean | null;
  internationalWorker: boolean; declarationAccepted: boolean;
};

export const EMPTY_EMPLOYEE: EmployeeForm = {
  title: "Mr", employeeName: "", relation: "Father", fatherHusbandName: "", motherName: "",
  gender: "", maritalStatus: "", dateOfBirth: "", bloodGroup: "",
  mobileNumber: "", altMobileNumber: "", personalEmailId: "", officialEmailId: "",
  emergencyContactName: "", emergencyContactRelation: "", emergencyContactMobile: "",
  nationality: "Indian", religion: "", category: "", addressProofType: "",
  permanentAddress: "", permanentState: "", permanentCity: "", permanentPincode: "",
  presentAddress: "", presentState: "", presentCity: "", presentPincode: "",
  panNumber: "", aadhaarNumber: "", passportNo: "", drivingLicenseNo: "",
  uanNumber: "", epfNumber: "", esicNumber: "",
  nominee: "", nomineeRelation: "", nomineeDateOfBirth: "", nominee1SharePct: "100",
  nominee2Name: "", nominee2Relation: "", nominee2Dob: "", nominee2SharePct: "",
};

export const EMPTY_BANK: BankForm = {
  bankName: "", branchName: "", accountHolderName: "", accountNo: "",
  confirmAccountNo: "", ifscCode: "", accountType: "Savings",
};

export const EMPTY_QUAL: QualForm = {
  qualification: "", specializationCourseName: "", passedOutYear: "",
  passedOutState: "", passedOutCity: "", passedOutPercentage: "",
  boardType: "", institutionName: "",
};

export const EMPTY_EXP: ExperienceForm = {
  workingExperience: "fresher", experienceYear: "", experienceDocType: "",
  employerName: "", lastDesignation: "", lastCtc: "",
  fromDate: "", toDate: "", reasonForLeaving: "",
};

export const EMPTY_FAMILY: FamilyForm = { annualIncome: "", countOfDependents: "" };

export const EMPTY_STATUTORY: StatutoryForm = {
  previousPfMember: null, epsMember: null, internationalWorker: false, declarationAccepted: false,
};

export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export const STEP_LABELS: Record<Step, string> = {
  1: "Welcome", 2: "Personal", 3: "Address & KYC", 4: "Identity Docs",
  5: "Documents", 6: "BGV", 7: "Bank", 8: "Education", 9: "Experience & Language",
  10: "Statutory & Submit",
};

export function useOnboardingFull(token: string) {
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [bgv, setBgv] = useState<BgvStatus | null>(null);
  const [employee, setEmployee] = useState<EmployeeForm>(EMPTY_EMPLOYEE);
  const [bank, setBank] = useState<BankForm>(EMPTY_BANK);
  const [qual, setQual] = useState<QualForm>(EMPTY_QUAL);
  const [experience, setExperience] = useState<ExperienceForm>(EMPTY_EXP);
  const [family, setFamily] = useState<FamilyForm>(EMPTY_FAMILY);
  const [languages, setLanguages] = useState<LanguageRow[]>([]);
  const [statutory, setStatutory] = useState<StatutoryForm>(EMPTY_STATUTORY);
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geoCapture = useGeoCapture();

  const load = useCallback(async () => {
    if (!token) { setError("No onboarding token."); setLoading(false); return; }
    setLoading(true);
    try {
      const [statusRes, bgvRes] = await Promise.all([
        hrmsApi.get<{ data: StatusData }>(`${API}/status?token=${encodeURIComponent(token)}`),
        hrmsApi.get<{ data: BgvStatus }>(`${BGV}/status?token=${encodeURIComponent(token)}`),
      ]);
      const s = statusRes.data;
      const sp = s.saved_profile ?? (s.token as any).saved_profile ?? {};
      setStatus(s);
      setBgv(bgvRes.data);
      setConsentAccepted(Boolean(bgvRes.data?.consent));
      setOtpVerified(Boolean(sp.otp_verified));

      setEmployee((prev) => ({
        ...prev,
        employeeName: sp.employee_name ?? s.token.full_name ?? "",
        mobileNumber: sp.mobile_number ?? s.token.mobile ?? "",
        personalEmailId: sp.personal_email_id ?? s.token.email ?? "",
        gender: sp.gender ?? s.token.gender ?? "",
        dateOfBirth: (sp.date_of_birth ?? s.token.date_of_birth ?? "").slice(0, 10),
        title: sp.title ?? prev.title,
        relation: sp.relation ?? prev.relation,
        fatherHusbandName: sp.father_husband_name ?? "",
        motherName: sp.mother_name ?? "",
        maritalStatus: sp.marital_status ?? "",
        bloodGroup: sp.blood_group ?? "",
        altMobileNumber: sp.alt_mobile_number ?? "",
        officialEmailId: sp.official_email_id ?? "",
        emergencyContactName: sp.emergency_contact_name ?? "",
        emergencyContactRelation: sp.emergency_contact_relation ?? "",
        emergencyContactMobile: sp.emergency_contact_mobile ?? "",
        nationality: sp.nationality ?? "Indian",
        religion: sp.religion ?? "",
        category: sp.category ?? "",
        addressProofType: sp.address_proof_type ?? "",
        permanentAddress: sp.permanent_address ?? "",
        permanentState: sp.permanent_state ?? "",
        permanentCity: sp.permanent_city ?? "",
        permanentPincode: sp.permanent_pincode ?? "",
        presentAddress: sp.present_address ?? "",
        presentState: sp.present_state ?? "",
        presentCity: sp.present_city ?? "",
        presentPincode: sp.present_pincode ?? "",
        panNumber: sp.pan_number_masked ? "" : "",
        aadhaarNumber: "",
        passportNo: sp.passport_no ?? "",
        drivingLicenseNo: sp.driving_license_no ?? "",
        uanNumber: sp.uan_number ?? "",
        epfNumber: sp.epf_number ?? "",
        esicNumber: sp.esic_number ?? "",
        nominee: sp.nominee_name ?? "",
        nomineeRelation: sp.nominee_relation ?? "",
        nomineeDateOfBirth: (sp.nominee_date_of_birth ?? "").slice(0, 10),
        nominee1SharePct: sp.nominee1_share_pct ?? "100",
        nominee2Name: sp.nominee2_name ?? "",
        nominee2Relation: sp.nominee2_relation ?? "",
        nominee2Dob: (sp.nominee2_dob ?? "").slice(0, 10),
        nominee2SharePct: sp.nominee2_share_pct ?? "",
      }));

      if (s.bank) {
        setBank((prev) => ({
          ...prev,
          bankName: s.bank!.bank_name ?? "",
          branchName: s.bank!.branch_name ?? "",
          accountHolderName: s.bank!.account_holder_name ?? "",
          ifscCode: s.bank!.ifsc_code ?? "",
          accountType: s.bank!.account_type ?? "Savings",
        }));
      }
      if (s.experience) {
        setExperience((prev) => ({
          ...prev,
          workingExperience: s.experience.working_experience ?? "fresher",
          experienceYear: s.experience.experience_year ?? "",
          employerName: s.experience.employer_name ?? "",
          lastDesignation: s.experience.last_designation ?? "",
          lastCtc: s.experience.last_ctc ?? "",
          fromDate: (s.experience.from_date ?? "").slice(0, 10),
          toDate: (s.experience.to_date ?? "").slice(0, 10),
          reasonForLeaving: s.experience.reason_for_leaving ?? "",
        }));
      }
      if (s.family) {
        setFamily({ annualIncome: s.family.annual_income ?? "", countOfDependents: s.family.count_of_dependents ?? "" });
      }
      setStatutory({
        previousPfMember: sp.previous_pf_member != null ? Boolean(sp.previous_pf_member) : null,
        epsMember: sp.eps_member != null ? Boolean(sp.eps_member) : null,
        internationalWorker: Boolean(sp.international_worker),
        declarationAccepted: Boolean(sp.statutory_declaration_accepted),
      });
    } catch (e: any) {
      setError(e?.message || "Unable to load onboarding.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const autosave = useCallback((section: string, data: unknown) => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      hrmsApi.post(`${API}/autosave`, { token, section, data }).catch(() => {});
    }, 1500);
  }, [token]);

  const updateSectionStatus = useCallback((section: string, isComplete: boolean) => {
    return hrmsApi.put(`${API}/section-status`, { token, section, isComplete }).catch(() => {});
  }, [token]);

  const getBlockers = useCallback(() => {
    return hrmsApi.get<{ data: Array<{ code: string; message: string; severity: "hard" | "soft" }> }>(
      `${API}/blockers?token=${encodeURIComponent(token)}`
    ).then((r) => r.data);
  }, [token]);

  const saveFamily = useCallback(async (members: Array<Record<string, unknown>>) => {
    return hrmsApi.post(`${API}/family-members`, { token, members });
  }, [token]);

  const saveNominees = useCallback(async (nominees: Array<Record<string, unknown>>) => {
    return hrmsApi.post(`${API}/nominees`, { token, nominees });
  }, [token]);

  const saveEmployee = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${API}/employee-details`, { token, ...employee });
      updateSectionStatus("personal", true).catch(() => {});
      await load();
    } finally { setSaving(false); }
  };

  const saveStatutory = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${API}/statutory`, { token, ...statutory });
      updateSectionStatus("statutory", true).catch(() => {});
      await load();
    } finally { setSaving(false); }
  };

  const saveBank = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${API}/bank-details`, { token, ...bank });
      updateSectionStatus("bank", true).catch(() => {});
      await load();
    } finally { setSaving(false); }
  };

  const addQualification = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${API}/qualification`, { token, ...qual });
      setQual(EMPTY_QUAL);
      updateSectionStatus("education", true).catch(() => {});
      await load();
    } finally { setSaving(false); }
  };

  const saveExperience = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${API}/experience`, { token, ...experience });
      await hrmsApi.post(`${API}/family`, { token, ...family });
      if (languages.length > 0) await hrmsApi.post(`${API}/languages`, { token, languages });
      updateSectionStatus("experience", true).catch(() => {});
      await load();
    } finally { setSaving(false); }
  };

  const sendOtp = async () => {
    setSaving(true);
    try { await hrmsApi.post(`${API}/otp/send`, { token }); setOtpSent(true); }
    finally { setSaving(false); }
  };

  const verifyOtp = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${API}/otp/verify`, { token, otp: otpCode });
      setOtpVerified(true); setOtpCode("");
    } finally { setSaving(false); }
  };

  const grantConsent = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${BGV}/consent`, { token, purposes: ["identity_verification", "employment_onboarding", "payroll_readiness", "statutory_compliance"] });
      await load();
    } finally { setSaving(false); }
  };

  const verifyPan = async () => { setSaving(true); try { await hrmsApi.post(`${BGV}/verify/pan`, { token, panNumber: employee.panNumber }); await load(); } finally { setSaving(false); } };
  const verifyBank = async () => { setSaving(true); try { await hrmsApi.post(`${BGV}/verify/bank`, { token, accountNo: bank.accountNo, ifscCode: bank.ifscCode, accountHolderName: bank.accountHolderName }); await load(); } finally { setSaving(false); } };
  const verifyAadhaar = async () => {
    const doc = status?.documents.find((d) => d.doc_type.toLowerCase().includes("aadhaar"));
    setSaving(true);
    try { await hrmsApi.post(`${BGV}/verify/aadhaar-offline`, { token, documentId: doc?.id, aadhaarLast4: employee.aadhaarNumber.slice(-4) }); await load(); }
    finally { setSaving(false); }
  };
  const startDigilocker = async () => {
    setSaving(true);
    try {
      const res = await hrmsApi.post<{ data: { authUrl: string } }>(`${BGV}/digilocker/start`, { token, requestedDocuments: ["AADHAAR", "PAN"] });
      window.location.href = res.data.authUrl;
    } finally { setSaving(false); }
  };

  const lookupIfsc = async (ifsc: string) => {
    if (ifsc.length !== 11) return;
    try {
      const res = await fetch(`https://ifsc.razorpay.com/${ifsc.toUpperCase()}`);
      if (res.ok) {
        const d = await res.json();
        setBank((prev) => ({ ...prev, bankName: d.BANK || prev.bankName, branchName: d.BRANCH || prev.branchName }));
      }
    } catch { /* non-fatal */ }
  };

  const submit = async () => {
    setSaving(true);
    const geo = await geoCapture();
    try { await hrmsApi.post(`${API}/submit`, { token, submit_lat: geo.latitude, submit_lng: geo.longitude }); setSubmitted(true); }
    catch (e: any) { setError(e.message || "Submit failed"); }
    finally { setSaving(false); }
  };

  const advanceStep = async () => {
    if (saving) return;
    try {
      if (step === 2) await saveEmployee();
      else if (step === 3) await saveEmployee();
      else if (step === 7) await saveBank();
      else if (step === 9) await saveExperience();
      else if (step === 10) await saveStatutory();
    } catch { /* banner shown, still advance */ }
    setStep((s) => Math.min(10, s + 1) as Step);
    await hrmsApi.post(`${API}/progress`, { token, stepIdx: Math.min(10, step) }).catch(() => {});
  };

  const uploadDoc = async (file: File, docType: string, docName: string, pageNo: string) => {
    const UPLOAD_URL = (import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055") + `${API}/documents`;
    const fd = new FormData();
    fd.append("token", token); fd.append("docType", docType); fd.append("docName", docName);
    fd.append("pageNo", pageNo); fd.append("file", file);
    const res = await fetch(UPLOAD_URL, { method: "POST", body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || "Upload failed");
    if (consentAccepted) {
      const docId = json.data?.id;
      try {
        if (docType.toLowerCase().includes("aadhaar") && employee.aadhaarNumber)
          await hrmsApi.post(`${BGV}/verify/aadhaar-offline`, { token, documentId: docId, aadhaarLast4: employee.aadhaarNumber.slice(-4) });
        else if (docType.toLowerCase().includes("pan") && employee.panNumber)
          await hrmsApi.post(`${BGV}/verify/pan`, { token, panNumber: employee.panNumber });
      } catch { /* BGV auto-trigger non-fatal */ }
    }
    await load();
  };

  const deleteDoc = async (docId: string) => {
    await hrmsApi.delete(`${API}/documents/${docId}`, { data: { token } });
    await load();
  };

  const completion = (() => {
    const checks = [
      employee.employeeName, employee.mobileNumber, employee.personalEmailId,
      employee.fatherHusbandName, employee.dateOfBirth, employee.permanentAddress,
      employee.panNumber, employee.aadhaarNumber, bank.bankName, bank.accountHolderName,
      bank.ifscCode,
    ];
    let done = checks.filter((v) => String(v || "").trim()).length;
    let total = checks.length + 3;
    if (status?.documents.length) done++;
    if (bgv?.consent) done++;
    if (otpVerified) done++;
    return Math.round((done / total) * 100);
  })();

  return {
    step, setStep, loading, saving, error, setError, submitted,
    status, bgv, employee, setEmployee, bank, setBank, qual, setQual,
    experience, setExperience, family, setFamily, languages, setLanguages,
    statutory, setStatutory, otpSent, otpVerified, otpCode, setOtpCode,
    consentAccepted, completion,
    load, autosave, advanceStep,
    saveEmployee, saveBank, addQualification, saveExperience, saveStatutory,
    sendOtp, verifyOtp, grantConsent, verifyPan, verifyBank, verifyAadhaar,
    startDigilocker, lookupIfsc, uploadDoc, deleteDoc, submit,
    updateSectionStatus, getBlockers, saveFamily, saveNominees,
  };
}
