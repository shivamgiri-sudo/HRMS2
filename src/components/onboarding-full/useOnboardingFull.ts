/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import { hrmsApi, getHrmsApiErrorStatus } from "@/lib/hrmsApi";
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
  is_minor?: boolean;
};

export type DocRecord = {
  id: string;
  doc_type: string;
  doc_name: string;
  page_no?: number;
  file_original_name?: string;
  mime_type?: string;
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
  languages?: any[];
  familyMembers?: any[];
  saved_profile?: Record<string, any>;
  digilocker?: {
    status?: string;
    verification_url?: string | null;
    client_transaction_id?: string | null;
    stale?: boolean;
  };
  esign?: {
    status?: string;
    verification_url?: string | null;
    client_transaction_id?: string | null;
  };
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
  nameOnCheque: string; cancelledChequeDocumentId: string;
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

/**
 * A family member as declared for EPF Form 2 Part B (pension scheme).
 *
 * Distinct from the PF nominee captured in step 2 — Part B asks who the member's
 * family is, which cannot be inferred from who they nominated. `isEpsNominee`
 * marks the single fallback entry the form uses where no eligible family exists.
 */
export type FamilyMemberRow = {
  id: string; memberName: string; relation: string; dob: string;
  address: string; isEpsNominee: boolean;
};

/** Form 2 prints four family rows; the UI caps entry to match. */
export const FAMILY_MEMBER_LIMIT = 4;

export type StatutoryForm = {
  previousPfMember: boolean | null; epsMember: boolean | null;
  internationalWorker: boolean; declarationAccepted: boolean;
};

// Raw PAN/Aadhaar/account numbers are never returned to the browser — the server
// only sends masked forms ("XXXXXXXX0118"). Some legacy rows hold a literal "0",
// which must not count as a saved value.
export function hasSavedMaskedValue(masked: unknown): boolean {
  const s = String(masked ?? "").trim();
  return s.length > 1 && s !== "0";
}

// Recover the last 4 digits from a masked value so a candidate who resumes the
// form does not have to re-type their Aadhaar just to trigger verification.
function last4FromMasked(masked: unknown): string {
  const digits = String(masked ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

// Extract the most useful message from a BGV API error response.
//
// hrmsApi throws an HrmsApiError carrying `.status` and `.payload` — it is not
// axios and never sets `.response`. Reading `e.response.status` therefore matched
// nothing, so every status-specific branch below was dead code and candidates got
// the raw server string for conditions the product had proper wording for.
function bgvErrorStatus(e: any): number | null {
  const status = getHrmsApiErrorStatus(e) ?? e?.status;
  return typeof status === "number" ? status : null;
}

function extractBgvError(e: any, fallback: string): string {
  const status = bgvErrorStatus(e);
  const serverMsg =
    e?.payload?.message ?? e?.payload?.error ??
    (typeof e?.message === "string" ? e.message : null);
  if (status === 503) return serverMsg ?? "Verification service is not configured — please contact HR.";
  if (status === 403) return serverMsg ?? "BGV consent required — please complete the consent step first.";
  if (status === 400) return serverMsg ?? fallback;
  return serverMsg ?? fallback;
}

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
  nameOnCheque: "", cancelledChequeDocumentId: "",
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
  1: "Welcome", 2: "Personal", 3: "DigiLocker & KYC", 4: "Documents",
  5: "Verification", 6: "Bank", 7: "Education", 8: "Experience",
  9: "Family & Language", 10: "Statutory & Submit",
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
  const [familyMembers, setFamilyMembers] = useState<FamilyMemberRow[]>([]);
  const [statutory, setStatutory] = useState<StatutoryForm>(EMPTY_STATUTORY);
  const [otpSent, setOtpSent] = useState(false);
  /**
   * Which channels the server actually got the OTP out on. The send response
   * carries smsDelivered/emailDelivered per channel, and this screen used to
   * throw it away and tell every candidate "an OTP will be sent to your
   * registered mobile number" regardless — so when SMS was refused and only the
   * email went out, the page still pointed people at their phone. Null until a
   * send has been made.
   */
  const [otpChannels, setOtpChannels] = useState<{ sms: boolean; email: boolean } | null>(null);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [bgvApiAvailable, setBgvApiAvailable] = useState(true);
  const [privacyConsentAccepted, setPrivacyConsentAccepted] = useState(false);
  const [pfOptOutElected, setPfOptOutElected] = useState<boolean | null>(null);
  const [pfOptOutSaving, setPfOptOutSaving] = useState(false);
  const [pfOptOutConsented, setPfOptOutConsented] = useState(false);
  const [pfOptOutConsentedAt, setPfOptOutConsentedAt] = useState<string | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sectionComplete, setSectionComplete] = useState<Record<number, boolean>>({});
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geoCapture = useGeoCapture();
  // Applied once per page load, not on every load() call — load() re-runs after nearly
  // every save, and re-applying the server's saved step on each of those would yank the
  // candidate back to wherever they last clicked "Next" from, undoing in-session progress.
  const initialStepAppliedRef = useRef(false);

  const load = useCallback(async () => {
    if (!token) { setError("No onboarding token."); setLoading(false); return; }
    setLoading(true);
    try {
      const [statusRes, bgvRes] = await Promise.allSettled([
        hrmsApi.get<{ data: StatusData }>(`${API}/status?token=${encodeURIComponent(token)}`),
        hrmsApi.get<{ data: BgvStatus }>(`${BGV}/status?token=${encodeURIComponent(token)}`),
      ]);

      if (statusRes.status === "rejected") throw (statusRes as PromiseRejectedResult).reason;

      const s = statusRes.value.data;
      const sp = s.saved_profile ?? (s.token as any).saved_profile ?? {};
      setStatus(s);
      setOtpVerified(Boolean(sp.otp_verified));
      setPrivacyConsentAccepted(Boolean(sp.dpdp_consent));

      // Resume on the step the candidate was last on (e.g. returning from DigiLocker, or
      // reopening the link after closing the tab) instead of always restarting at Step 1.
      // current_step_idx is written by saveProgress() on every "Next" click but was never
      // read back — every reload silently discarded it.
      if (!initialStepAppliedRef.current) {
        initialStepAppliedRef.current = true;
        const savedStepIdx = Math.floor(Number(sp.current_step_idx ?? 0));
        if (savedStepIdx >= 1 && savedStepIdx <= 10) {
          setStep(savedStepIdx as Step);
        }
      }

      // BGV status is non-blocking — page still loads if it fails
      let bgvConsent = false;
      if (bgvRes.status === "fulfilled") {
        setBgv(bgvRes.value.data);
        bgvConsent = Boolean(bgvRes.value.data?.consent);
        setConsentAccepted(bgvConsent);
        setBgvApiAvailable(true);
      } else {
        setBgvApiAvailable(false);
      }

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
        // PAN and Aadhaar are never pre-filled from server (security); user must re-enter
        panNumber: "",
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
          nameOnCheque: s.bank!.name_on_cheque ?? "",
          cancelledChequeDocumentId: s.bank!.cancelled_cheque_document_id ?? "",
          // accountNo intentionally NOT pre-filled — user must re-enter for security
          accountNo: "",
          confirmAccountNo: "",
        }));
      }
      if (s.experience) {
        setExperience((prev) => ({
          ...prev,
          workingExperience: s.experience!.working_experience ?? "fresher",
          experienceYear: s.experience!.experience_year ?? "",
          employerName: s.experience!.employer_name ?? "",
          lastDesignation: s.experience!.last_designation ?? "",
          lastCtc: s.experience!.last_ctc ?? "",
          fromDate: (s.experience!.from_date ?? "").slice(0, 10),
          toDate: (s.experience!.to_date ?? "").slice(0, 10),
          reasonForLeaving: s.experience!.reason_for_leaving ?? "",
        }));
      }
      if (s.family) {
        setFamily({ annualIncome: s.family.annual_income ?? "", countOfDependents: s.family.count_of_dependents ?? "" });
      }
      if (s.languages?.length) {
        setLanguages(s.languages.map((l: any) => ({
          id: l.id ?? String(Math.random()),
          language_name: l.language_name ?? "",
          can_read: Boolean(l.can_read),
          can_write: Boolean(l.can_write),
          can_speak: Boolean(l.can_speak),
          proficiency: l.proficiency ?? "basic",
        })));
      }
      if (s.familyMembers?.length) {
        setFamilyMembers(s.familyMembers.map((m: any) => ({
          id: m.id ?? String(Math.random()),
          memberName: m.member_name ?? "",
          relation: m.relation ?? "",
          // Same .slice(0,10) the other date fields use, so <input type="date">
          // accepts what the server returns.
          dob: (m.dob ?? "").slice(0, 10),
          address: m.address ?? "",
          isEpsNominee: Boolean(m.is_eps_nominee),
        })));
      }
      setStatutory({
        previousPfMember: sp.previous_pf_member != null ? Boolean(sp.previous_pf_member) : null,
        epsMember: sp.eps_member != null ? Boolean(sp.eps_member) : null,
        internationalWorker: Boolean(sp.international_worker),
        declarationAccepted: Boolean(sp.statutory_declaration_accepted),
      });
      // Restore PF opt-out consent state if candidate already completed Form 11
      if (sp.pf_opt_out_elected != null) {
        setPfOptOutElected(Boolean(sp.pf_opt_out_elected));
        setPfOptOutConsented(Boolean(sp.pf_opt_out_elected) && Boolean(sp.pf_opt_out_consented_at));
        setPfOptOutConsentedAt(sp.pf_opt_out_consented_at ?? null);
      }

      // Build section-level completion map from saved data
      const sc: Record<number, boolean> = {};
      sc[2] = !!(sp.employee_name && sp.mobile_number && sp.personal_email_id && sp.date_of_birth);
      // candidate_onboarding_profile has no pan_number / aadhaar_number column —
      // only masked and hashed forms — so this step could never be marked complete.
      sc[3] = !!(sp.permanent_address && hasSavedMaskedValue(sp.pan_number_masked) && hasSavedMaskedValue(sp.aadhaar_number_masked));
      sc[4] = (s?.documents?.length ?? 0) > 0;
      sc[5] = bgvConsent;
      sc[6] = !!(s.bank?.bank_name && s.bank?.ifsc_code);
      sc[7] = (s.qualifications?.length ?? 0) > 0;
      sc[8] = !!(s.experience && s.experience.working_experience);
      sc[9] = !!(s.family || (s.languages?.length ?? 0) > 0 || (s.familyMembers?.length ?? 0) > 0);
      sc[10] = Boolean(sp.statutory_declaration_accepted);
      setSectionComplete(sc);
    } catch (e: any) {
      setError(e?.message || "Unable to load onboarding.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const autosave = useCallback((section: string, data: unknown) => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (autosaveClearTimer.current) clearTimeout(autosaveClearTimer.current);
    autosaveTimer.current = setTimeout(() => {
      setAutosaveStatus("saving");
      hrmsApi.post(`${API}/autosave`, { token, section, data })
        .then(() => {
          setAutosaveStatus("saved");
          autosaveClearTimer.current = setTimeout(() => setAutosaveStatus("idle"), 2500);
        })
        .catch((e) => {
          console.warn("[onboarding] Autosave failed:", e);
          setAutosaveStatus("error");
          autosaveClearTimer.current = setTimeout(() => setAutosaveStatus("idle"), 3000);
        });
    }, 1500);
  }, [token]);

  const updateSectionStatus = useCallback((section: string, isComplete: boolean) => {
    return hrmsApi.put(`${API}/section-status`, { token, section, isComplete }).catch((e) => console.warn("[onboarding] Background operation failed:", e));
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

  const pfOptOutConsent = async (elected: boolean) => {
    setPfOptOutSaving(true);
    try {
      await hrmsApi.patch(`${API}/pf-opt-out-consent`, { token, elected });
      setPfOptOutElected(elected);
      if (elected) {
        setPfOptOutConsented(true);
        setPfOptOutConsentedAt(new Date().toISOString());
      }
    } catch (e: any) {
      setError(e?.message || "Failed to save PF opt-out consent");
    } finally {
      setPfOptOutSaving(false);
    }
  };

  const saveEmployee = async () => {
    setSaving(true);
    try {
      // Auto-calculate nominee share percentages
      const hasNominee2 = employee.nominee2Name?.trim();
      const employeeWithShares = {
        ...employee,
        nominee1SharePct: hasNominee2 ? "50" : "100",
        nominee2SharePct: hasNominee2 ? "50" : "0",
      };

      await hrmsApi.post(`${API}/employee-details`, { token, ...employeeWithShares });
      updateSectionStatus("personal", true).catch((e) => console.warn("[onboarding] Background operation failed:", e));
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save personal details");
      throw e;
    } finally { setSaving(false); }
  };

  const saveStatutory = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${API}/statutory`, { token, ...statutory });
      updateSectionStatus("statutory", true).catch((e) => console.warn("[onboarding] Background operation failed:", e));
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save statutory details");
    } finally { setSaving(false); }
  };

  const saveBank = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${API}/bank-details`, { token, ...bank });
      updateSectionStatus("bank", true).catch((e) => console.warn("[onboarding] Background operation failed:", e));
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save bank details");
      throw e;
    } finally { setSaving(false); }
  };

  const addQualification = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${API}/qualification`, { token, ...qual });
      setQual(EMPTY_QUAL);
      updateSectionStatus("education", true).catch((e) => console.warn("[onboarding] Background operation failed:", e));
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to add qualification");
    } finally { setSaving(false); }
  };

  const saveExperience = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${API}/experience`, { token, ...experience });
      await hrmsApi.post(`${API}/family`, { token, ...family });
      if (languages.length > 0) await hrmsApi.post(`${API}/languages`, { token, languages });
      // Posted unconditionally, unlike languages above. The endpoint replaces the
      // whole set, so skipping an empty array would make "remove my last family
      // member" a silent no-op — the row would survive a save that appeared to
      // succeed. Sending [] lets a member genuinely clear the section.
      await hrmsApi.post(`${API}/family-members`, {
        token,
        members: familyMembers
          .filter((m) => m.memberName.trim())
          .map((m) => ({
            memberName: m.memberName.trim(),
            relation: m.relation,
            dob: m.dob,
            address: m.address,
            isEpsNominee: m.isEpsNominee,
          })),
      });
      updateSectionStatus("experience", true).catch((e) => console.warn("[onboarding] Background operation failed:", e));
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save experience details");
      throw e;
    } finally { setSaving(false); }
  };

  const sendOtp = async () => {
    setSaving(true);
    try {
      const res: any = await hrmsApi.post(`${API}/otp/send`, { token });
      // The route returns smsDelivered/emailDelivered at the envelope's top
      // level, but read through `data` too so a later move of those fields
      // doesn't quietly turn both channels back into "false".
      const flat = { ...(res?.data ?? {}), ...(res ?? {}) } as any;
      setOtpChannels({
        sms: Boolean(flat.smsDelivered ?? res?.data?.smsDelivered),
        email: Boolean(flat.emailDelivered ?? res?.data?.emailDelivered),
      });
      setOtpSent(true);
    }
    catch (e: any) { setError(e?.message || "Failed to send OTP"); }
    finally { setSaving(false); }
  };

  const verifyOtp = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${API}/otp/verify`, { token, otp: otpCode });
      setOtpVerified(true); setOtpCode("");
    } catch (e: any) { setError(e?.message || "OTP verification failed"); }
    finally { setSaving(false); }
  };

  const grantConsent = async () => {
    setSaving(true);
    try {
      await hrmsApi.post(`${BGV}/consent`, { token, purposes: ["identity_verification", "employment_onboarding", "payroll_readiness", "statutory_compliance"] });
      setConsentAccepted(true);
      setBgvApiAvailable(true);
      await load();
    } catch (e: any) {
      const status = bgvErrorStatus(e);
      if (status === 503) {
        // BGV service offline — consent not recorded on server; inform HR will process manually
        setBgvApiAvailable(false);
        setError("BGV service is temporarily offline. Your consent could not be recorded digitally. HR will process background verification manually after submission. You may continue your onboarding.");
      } else {
        setError(extractBgvError(e, "Failed to record BGV consent. Please try again or contact HR."));
      }
    } finally { setSaving(false); }
  };

  const verifyPan = async () => {
    const panCheck = bgv?.checks?.find((c: any) => c.check_type === "pan");
    if (panCheck?.status === "verified" && panCheck?.provider_key === "digilocker") {
      setError("✓ PAN already verified via DigiLocker in Step 3 — no additional verification needed.");
      return;
    }
    if (!employee.panNumber || employee.panNumber.trim().length !== 10) {
      // The raw PAN is never sent back by the server (security), so `employee.panNumber`
      // is blank on every reload even when a PAN was already saved — checking it alone
      // told a candidate who HAD saved a PAN that they hadn't. Distinguish "never saved"
      // from "saved, but needs retyping to run this verification call" using the signal
      // that survives reloads: the persisted masked value (same source `sp` in load() reads).
      const savedProfile = status?.saved_profile ?? (status?.token as any)?.saved_profile ?? {};
      const panAlreadySaved = hasSavedMaskedValue(savedProfile.pan_number_masked);
      setError(
        panAlreadySaved
          ? "Your PAN was already saved in Step 3. Please retype it here to run this verification."
          : "Please enter your 10-character PAN number in Step 3 (DigiLocker & KYC) before verification.",
      );
      return;
    }
    setSaving(true);
    try {
      await hrmsApi.post(`${BGV}/verify/pan`, { token, panNumber: employee.panNumber });
      await load();
      setError(""); // Clear error on success
    }
    catch (e: any) { setError(extractBgvError(e, "PAN verification failed")); }
    finally { setSaving(false); }
  };

  const verifyBank = async () => {
    // PAN must be saved in Step 3 before bank verification (Luckpay penny-drop requires PAN).
    const panSaved = Boolean((status as any)?.token?.saved_profile?.pan_number_masked);
    if (!panSaved) {
      setError("Please save your PAN number in Step 3 (DigiLocker & KYC) before verifying your bank account.");
      return;
    }
    // Bank details must be saved first (IFSC at minimum — account number can come from server-side decrypt)
    const bankSaved = Boolean(bank.bankName || (status as any)?.bank?.ifsc_code);
    if (!bankSaved) {
      setError("Please save your bank details in Step 6 first, then return here to verify.");
      return;
    }
    // If account number is not in React state, the backend will attempt to decrypt the stored encrypted value.
    // Only block if we know there's no bank record at all.
    if (!bank.accountNo && !(status as any)?.bank) {
      setError(
        "Account number required for verification. For security, we don't store your raw account number. " +
        "Please go to Step 6, re-enter your account number and save, then try verification again."
      );
      return;
    }
    setSaving(true);
    try {
      await hrmsApi.post(`${BGV}/verify/bank`, {
        token,
        accountNo: bank.accountNo,
        ifscCode: bank.ifscCode,
        accountHolderName: bank.accountHolderName
      });
      await load();
      setError(""); // Clear error on success
    }
    catch (e: any) {
      const errorMsg = extractBgvError(e, "Bank verification failed");

      // Specific handling for account number missing error
      if (errorMsg.includes("Raw account number is required")) {
        setError(
          "Account number not available for verification. " +
          "Please re-enter your account number in Step 6 above and try again. " +
          "(We don't store raw account numbers for security)"
        );
      } else if (errorMsg.includes("IP") && errorMsg.includes("whitelist")) {
        setError(
          "Bank verification service is temporarily unavailable. " +
          "Your bank details have been saved and HR will verify manually after submission. " +
          "This does not block your onboarding."
        );
      } else {
        setError(errorMsg);
      }
    }
    finally { setSaving(false); }
  };

  const verifyAadhaar = async () => {
    const aadhaarCheck = bgv?.checks?.find((c: any) => c.check_type === "aadhaar");
    if (aadhaarCheck?.status === "verified" && aadhaarCheck?.provider_key === "digilocker") {
      setError("✓ Aadhaar already verified via DigiLocker in Step 3 — no additional verification needed.");
      return;
    }
    // The Aadhaar field is deliberately blanked on every load, so a candidate who
    // resumes has nothing in local state even though the server holds their number.
    // Fall back to the last 4 digits of the saved masked value.
    const savedProfile: any = (status as any)?.saved_profile ?? (status as any)?.token?.saved_profile ?? {};
    const typedAadhaar = employee.aadhaarNumber.replace(/\D/g, "");
    const aadhaarLast4 = typedAadhaar.length === 12
      ? typedAadhaar.slice(-4)
      : last4FromMasked(savedProfile.aadhaar_number_masked);
    if (!aadhaarLast4) {
      setError("Please enter your 12-digit Aadhaar number in Step 3 (DigiLocker & KYC) before verification.");
      return;
    }
    const doc = status?.documents.find((d) => d.doc_type.toLowerCase().includes("aadhaar"));
    if (!doc) {
      setError("Please upload your Aadhaar document in Step 4 (Documents) before verification. Offline verification requires the uploaded document.");
      return;
    }
    setSaving(true);
    try {
      await hrmsApi.post(`${BGV}/verify/aadhaar-offline`, {
        token,
        documentId: doc?.id,
        aadhaarLast4,
      });
      await load();
      setError(""); // Clear error on success
    }
    catch (e: any) { setError(extractBgvError(e, "Aadhaar verification failed")); }
    finally { setSaving(false); }
  };

  const verifyUan = async () => {
    const uan = employee.uanNumber?.trim();
    if (!uan) { setError("Please enter your UAN number in the KYC section (Step 3) before verifying."); return; }
    setSaving(true);
    try {
      const res = await hrmsApi.post<{ data?: { employment_history?: unknown[] } }>(`${BGV}/verify/uan`, { token, uanNumber: uan });
      await load();
      // hrmsApi returns the `{ success, data }` body, so employment_history sits
      // one .data down, not two. The extra hop made count always 0, so a UAN
      // lookup that did return history never cleared the error banner.
      const count = res.data?.employment_history?.length ?? 0;
      if (count > 0) setError(""); // clear any prior error; employment history fetched
    }
    catch (e: any) { setError(extractBgvError(e, "UAN verification failed")); }
    finally { setSaving(false); }
  };

  // Kept so the destination is always reachable as a plain link, even if the
  // redirect above is prevented for any reason. A dead button with no
  // explanation is what this whole fix is about.
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [digilockerSyncing, setDigilockerSyncing] = useState(false);

  /**
   * Ask the server to fetch the DigiLocker result from the provider.
   *
   * Luckpay's verifyDigilockerWithURL takes only clientTransactionId,
   * customerName and mobileNumber — there is no redirect or callback parameter
   * anywhere in their API. The candidate therefore finishes on the provider's
   * own success page and is never sent back here; that is by design, not a
   * misconfiguration, so there is no return URL to fix.
   *
   * Polling on return is the only way to close the loop: whenever the candidate
   * comes back to this form — reopening the link, switching tabs, or returning
   * to the window — we ask the server whether the provider has the documents
   * yet. syncDigilockerStatus() on the backend does the rest.
   *
   * Deliberately quiet: this runs on its own, so a failure must not throw an
   * error banner over a form the candidate is happily filling in.
   */
  const syncDigilocker = useCallback(async () => {
    if (!token) return;
    setDigilockerSyncing(true);
    try {
      // hrmsApi returns the parsed body, so the API envelope's `data` is one
      // level in — not res.data.data as an axios response would be.
      const res = await hrmsApi.post<{ data?: { state?: string }; state?: string }>(`${API}/digilocker/sync`, { token });
      const state = (res as any)?.data?.state ?? (res as any)?.state;
      if (state === "completed") await load();
    } catch {
      // Nothing to tell the candidate: they can still continue, and the next
      // return to this page tries again.
    } finally {
      setDigilockerSyncing(false);
    }
  }, [token, load]);

  // A session that was started but never resolved is the only case worth
  // polling for. Checking on mount covers reopening the emailed link; the
  // visibility and focus listeners cover coming back from another tab.
  useEffect(() => {
    const sessionState = String(status?.digilocker?.status ?? "");
    const started = Boolean(sessionState) && !["completed", "not_started", "documents_received"].includes(sessionState);
    if (!started) return;
    void syncDigilocker();
    const onReturn = () => { if (document.visibilityState === "visible") void syncDigilocker(); };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [status?.digilocker?.status, syncDigilocker]);

  const startDigilocker = async () => {
    setSaving(true);
    try {
      const res = await hrmsApi.post<{ data: { authUrl?: string | null; redirectUrl?: string | null; verificationUrl?: string | null } }>(`${BGV}/digilocker/start`, { token });
      // data is nested under res.data.data from the API envelope
      const payload = (res.data as any)?.data ?? res.data;
      const nextUrl = payload?.authUrl ?? payload?.redirectUrl ?? payload?.verificationUrl;
      if (!nextUrl) throw new Error("DigiLocker link was not returned by the server. Please try again or contact HR.");
      // Navigate this tab instead of window.open.
      //
      // window.open only survives inside the synchronous run of a user gesture.
      // This line runs after `await`, so that gesture is already spent and the
      // browser blocks the popup SILENTLY — no error, no console warning. The
      // button looked completely dead, and production recorded 22 DigiLocker
      // sessions that never once got past 'created' because nobody ever
      // actually arrived at the provider.
      //
      // A same-tab redirect is never blocked, and it is the right flow anyway:
      // the candidate comes back through the provider callback, and phones
      // handle one tab far better than a popup.
      setRedirectUrl(String(nextUrl));
      window.location.assign(String(nextUrl));
    } catch (e: any) { setError(extractBgvError(e, "DigiLocker verification unavailable — please contact HR")); }
    finally { setSaving(false); }
  };

  const startEsign = async (documentId: string) => {
    setSaving(true);
    try {
      const res = await hrmsApi.post<{ data: { verification_url?: string | null; authUrl?: string | null; sign_url?: string | null } }>(
        `${API}/esign/initiate`,
        { token, documentId }
      );
      const payload = (res.data as any)?.data ?? res.data;
      const nextUrl = payload?.verification_url ?? payload?.authUrl ?? payload?.sign_url;
      if (!nextUrl) throw new Error("eSign link was not returned by the server.");
      // Same popup-blocking problem as startDigilocker above.
      setRedirectUrl(String(nextUrl));
      window.location.assign(String(nextUrl));
    } catch (e: any) { setError(extractBgvError(e, "eSign initiation failed")); }
    finally { setSaving(false); }
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

  const recordPrivacyConsent = async () => {
    try {
      await hrmsApi.post(`${API}/privacy-consent`, { token });
      setPrivacyConsentAccepted(true);
    } catch (e: any) {
      setError(e?.message || "Failed to record privacy consent. Please try again.");
    }
  };

  const submit = async () => {
    setSaving(true);
    const geo = await geoCapture();
    try {
      await hrmsApi.post(`${API}/submit`, { token, submit_lat: geo.latitude, submit_lng: geo.longitude });
      setSubmitted(true);
    } catch (e: any) { setError(e.message || "Submit failed"); }
    finally { setSaving(false); }
  };

  const advanceStep = async () => {
    if (saving) return;
    try {
      if (step === 2) await saveEmployee();      // Personal
      else if (step === 3) await saveEmployee(); // Address & KYC
      else if (step === 6) await saveBank();     // Bank
      else if (step === 8) await saveExperience(); // Experience
      else if (step === 9) await saveExperience(); // Family & Language
      else if (step === 10) await saveStatutory(); // Statutory
    } catch {
      // Stay on the step when its save failed. Advancing anyway is how candidates
      // reached Submit believing their details were stored — the banner scrolls out
      // of view and the next step looks like progress. The save is retryable, so
      // holding here costs a tap; carrying on silently costs the data.
      return;
    }
    setStep((s) => Math.min(10, s + 1) as Step);
    hrmsApi.post(`${API}/progress`, { token, stepIdx: Math.min(10, step) }).catch((e) => console.warn("[onboarding] Background operation failed:", e));
  };

  const uploadDoc = async (file: File, docType: string, docName: string, pageNo: string) => {
    const fd = new FormData();
    fd.append("token", token); fd.append("docType", docType); fd.append("docName", docName);
    fd.append("pageNo", pageNo); fd.append("file", file);
    const json = await hrmsApi.postForm<{ success: boolean; data?: { id?: string } }>(
      `${API}/documents`, fd
    );
    const docId: string | undefined = json.data?.id;

    // Auto-link cancelled cheque / bank passbook to the bank detail record
    const isCheque = /cancelled.?cheque|bank.?passbook|passbook/i.test(docType);
    if (isCheque && docId) {
      setBank((prev) => ({ ...prev, cancelledChequeDocumentId: docId }));
      // Persist linkage immediately so it's saved with next bank save
      hrmsApi.post(`${API}/bank-details`, { token, ...bank, cancelledChequeDocumentId: docId }).catch((e) => console.warn("[onboarding] Background operation failed:", e));
    }

    if (consentAccepted) {
      try {
        const aadhaarAlreadyVerified = bgv?.checks?.some((c: any) => c.check_type === "aadhaar" && c.status === "verified" && c.provider_key === "digilocker");
        const panAlreadyVerified = bgv?.checks?.some((c: any) => c.check_type === "pan" && c.status === "verified" && c.provider_key === "digilocker");
        if (docType.toLowerCase().includes("aadhaar") && employee.aadhaarNumber && !aadhaarAlreadyVerified)
          await hrmsApi.post(`${BGV}/verify/aadhaar-offline`, { token, documentId: docId, aadhaarLast4: employee.aadhaarNumber.slice(-4) });
        else if (docType.toLowerCase().includes("pan") && employee.panNumber && !panAlreadyVerified)
          await hrmsApi.post(`${BGV}/verify/pan`, { token, panNumber: employee.panNumber });
      } catch { /* BGV auto-trigger non-fatal */ }
    }
    await load();
  };

  const deleteDoc = async (docId: string) => {
    await hrmsApi.delete(`${API}/documents/${docId}`, { params: { token } });
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
    const total = checks.length + 3;
    if (status?.documents.length) done++;
    if (consentAccepted) done++;
    if (otpVerified) done++;
    return Math.round((done / total) * 100);
  })();

  return {
    step, setStep, loading, saving, error, setError, submitted,
    status, bgv, bgvApiAvailable, employee, setEmployee, bank, setBank, qual, setQual,
    experience, setExperience, family, setFamily, languages, setLanguages,
    familyMembers, setFamilyMembers,
    statutory, setStatutory, otpSent, otpVerified, otpCode, setOtpCode, otpChannels,
    consentAccepted, privacyConsentAccepted, completion,
    pfOptOutElected, pfOptOutSaving, pfOptOutConsented, pfOptOutConsentedAt, pfOptOutConsent,
    load, autosave, advanceStep,
    saveEmployee, saveBank, addQualification, saveExperience, saveStatutory,
    sendOtp, verifyOtp, grantConsent, verifyPan, verifyBank, verifyAadhaar, verifyUan,
    startDigilocker, startEsign, lookupIfsc, uploadDoc, deleteDoc, submit,
    redirectUrl,
    // Lets Step 3 say "already connected" instead of inviting a second attempt.
    // Documents are through when the session completes; the session itself
    // being open is enough to stop offering the button again.
    syncDigilocker,
    digilockerSyncing,
    digilockerSessionState: String(status?.digilocker?.status ?? "not_started"),
    digilockerConnected: String(status?.digilocker?.status ?? "") === "completed",
    // A session Luckpay never reports back on (e.g. tab closed mid-flow) otherwise leaves
    // "already started" showing forever with no way out — this flags it stale so Step 3 can
    // offer Start Over instead.
    digilockerStale: Boolean(status?.digilocker?.stale),
    updateSectionStatus, getBlockers, saveFamily, saveNominees, recordPrivacyConsent,
    autosaveStatus, sectionComplete,
  };
}
