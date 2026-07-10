import { randomUUID } from "crypto";
import axios from "axios";
import { env } from "../../config/env.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { sanitizeProviderPayload } from "../integrations/luckpay/luckpay.client.js";

// ── Shared types ──────────────────────────────────────────────────────────────

export type VerificationStatus = "verified" | "mismatch" | "failed" | "manual_review" | "queued";

export interface PanVerificationInput {
  candidateName?: string | null;
  dateOfBirth?: string | null;
  panNumber: string;
  mobileNumber?: string | null;
}

export interface BankVerificationInput {
  candidateName?: string | null;
  accountHolderName?: string | null;
  accountNo: string;
  ifscCode: string;
}

export interface AadhaarOfflineInput {
  candidateName?: string | null;
  aadhaarLast4?: string | null;
  documentId?: string | null;
}

export interface DigilockerSession {
  state: string;
  authUrl: string;
  expiresAt: Date;
}

export interface VerificationResult {
  status: VerificationStatus;
  providerKey: string;
  providerRequestId: string;
  providerReferenceId: string;
  matchScore?: number | null;
  matchedName?: string | null;
  matchedDob?: string | null;
  resultSummary: string;
  riskFlags?: string[];
  raw?: Record<string, unknown>;
}

export interface AddressDocInput {
  docType: 'driving_license' | 'voter_id';
  documentNumber: string;
  candidateName?: string | null;
  dateOfBirth?: string | null;
  state?: string | null;
}

export interface EducationVerificationInput {
  boardType: 'cbse_10' | 'cbse_12' | 'university' | 'other';
  rollNumber?: string | null;
  certificateNumber?: string | null;
  yearOfPassing: number;
  candidateName?: string | null;
  institutionName?: string | null;
}

export interface CourtVerificationInput {
  candidateName: string;
  dateOfBirth: string;
  fatherName?: string | null;
  address?: string | null;
  state?: string | null;
  pincode?: string | null;
}

export interface CourtVerificationResult extends VerificationResult {
  courtCases?: Array<{
    caseType: string;
    caseNumber: string;
    court: string;
    year: number;
    status: string;
  }> | null;
}

export interface BgvCandidatePortalInput {
  candidateId: string;
  candidateName: string;
  email: string;
  mobile?: string | null;
  dateOfBirth?: string | null;
  fatherName?: string | null;
  address?: string | null;
  employeeCode?: string | null;
}

export interface BgvPortalInitiationResult {
  providerKey: string;
  caseId: string;
  portalLoginUrl: string;
  candidateEmail: string;
  expiresAt: Date;
  raw?: Record<string, unknown>;
}

export interface BgvProviderAdapter {
  readonly providerKey: string;
  verifyPan(input: PanVerificationInput): Promise<VerificationResult>;
  verifyBank(input: BankVerificationInput): Promise<VerificationResult>;
  verifyAadhaarOffline(input: AadhaarOfflineInput): Promise<VerificationResult>;
  verifyUan?(input: { candidateName?: string | null; uanNumber: string }): Promise<VerificationResult & { employmentHistory?: unknown[] }>;
  verifyAddressDoc(input: AddressDocInput): Promise<VerificationResult>;
  verifyEducation(input: EducationVerificationInput): Promise<VerificationResult>;
  verifyCourt(input: CourtVerificationInput): Promise<CourtVerificationResult>;
  startDigilocker(candidateId: string, requestedDocuments: string[]): Promise<DigilockerSession>;
  initiateESign?(input: ESignInput): Promise<ESignSession>;
  initiateCandidateBgv(input: BgvCandidatePortalInput): Promise<BgvPortalInitiationResult>;
}

export interface ESignInput {
  candidateId: string;
  documentBuffer: Buffer;
  documentName: string;
  signedBy: string;
  location?: string;
  reason?: string;
}

export interface ESignSession {
  state: string;
  authUrl: string;
  expiresAt: Date;
  requestId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const normalizeName = (name?: string | null) =>
  String(name ?? "").trim().toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ");

export function roughNameMatchScore(a?: string | null, b?: string | null): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 100;
  const leftWords = new Set(left.split(" "));
  const rightWords = new Set(right.split(" "));
  const common = [...leftWords].filter((w) => rightWords.has(w)).length;
  return Math.round((common / Math.max(leftWords.size, rightWords.size)) * 100);
}

// ── Mock adapter (dev / test) ─────────────────────────────────────────────────

export class MockBgvProviderAdapter implements BgvProviderAdapter {
  readonly providerKey = "mock_bgv";

  async verifyPan(input: PanVerificationInput): Promise<VerificationResult> {
    const pan = input.panNumber.trim().toUpperCase();
    const validFormat = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
    const score = input.candidateName ? 85 : 70;
    return {
      status: validFormat ? "verified" : "failed",
      providerKey: "mock_bgv",
      providerRequestId: randomUUID(),
      providerReferenceId: `MOCK-PAN-${Date.now()}`,
      matchScore: validFormat ? score : 0,
      matchedName: input.candidateName ?? null,
      matchedDob: input.dateOfBirth ?? null,
      resultSummary: validFormat
        ? "PAN format passed mock verification. Switch BGV_PROVIDER=infinity_ai or digio for live checks."
        : "PAN format invalid.",
      riskFlags: validFormat ? [] : ["PAN_FORMAT_INVALID"],
      raw: { mode: "mock", validFormat },
    };
  }

  async verifyBank(input: BankVerificationInput): Promise<VerificationResult> {
    const account = input.accountNo.replace(/\s/g, "");
    const ifsc = input.ifscCode.trim().toUpperCase();
    const validIfsc = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc);
    const validAccount = account.length >= 6;
    const returnedName = input.accountHolderName || input.candidateName || "Mock Account Holder";
    const score = roughNameMatchScore(input.candidateName, returnedName);
    const ok = validIfsc && validAccount && score >= 60;
    return {
      status: ok ? "verified" : validIfsc && validAccount ? "mismatch" : "failed",
      providerKey: "mock_bgv",
      providerRequestId: randomUUID(),
      providerReferenceId: `MOCK-BANK-${Date.now()}`,
      matchScore: score,
      matchedName: returnedName,
      resultSummary: ok
        ? "Bank details passed mock penny-less verification. Switch BGV_PROVIDER for live checks."
        : "Bank details need correction or manual review.",
      riskFlags: [
        ...(validIfsc ? [] : ["IFSC_FORMAT_INVALID"]),
        ...(validAccount ? [] : ["ACCOUNT_NUMBER_TOO_SHORT"]),
        ...(score >= 60 ? [] : ["ACCOUNT_NAME_MISMATCH"]),
      ],
      raw: { mode: "mock", validIfsc, validAccount, returnedName },
    };
  }

  async verifyUan(input: { candidateName?: string | null; uanNumber: string }): Promise<VerificationResult & { employmentHistory?: unknown[] }> {
    const valid = /^\d{12}$/.test(input.uanNumber.trim());
    return {
      status: valid ? "verified" : "failed",
      providerKey: "mock_bgv",
      providerRequestId: randomUUID(),
      providerReferenceId: `MOCK-UAN-${Date.now()}`,
      matchScore: valid ? 80 : 0,
      matchedName: input.candidateName ?? null,
      resultSummary: valid ? "UAN format passed mock verification. Switch provider for live checks." : "Invalid UAN format.",
      riskFlags: valid ? [] : ["UAN_FORMAT_INVALID"],
      raw: { mode: "mock", valid },
      employmentHistory: [],
    };
  }

  async verifyAadhaarOffline(input: AadhaarOfflineInput): Promise<VerificationResult> {
    return {
      status: input.documentId ? "manual_review" : "failed",
      providerKey: "mock_bgv",
      providerRequestId: randomUUID(),
      providerReferenceId: `MOCK-AADHAAR-${Date.now()}`,
      matchScore: input.documentId ? 50 : 0,
      matchedName: input.candidateName ?? null,
      resultSummary: input.documentId
        ? "Aadhaar uploaded. Configure BGV_PROVIDER=infinity_ai or digio for auto-clear."
        : "Aadhaar document missing.",
      riskFlags: input.documentId ? ["AADHAAR_MANUAL_REVIEW_REQUIRED"] : ["AADHAAR_DOCUMENT_MISSING"],
      raw: { mode: "mock" },
    };
  }

  async verifyAddressDoc(input: AddressDocInput): Promise<VerificationResult> {
    return {
      status: "manual_review",
      providerKey: "mock_bgv",
      providerRequestId: randomUUID(),
      providerReferenceId: `MOCK-ADDR-${Date.now()}`,
      matchScore: 50,
      matchedName: input.candidateName ?? null,
      resultSummary: `${input.docType} address doc uploaded. Configure BGV_PROVIDER=infinity_ai for live checks.`,
      riskFlags: ["ADDRESS_DOC_MANUAL_REVIEW"],
      raw: { mode: "mock", docType: input.docType },
    };
  }

  async verifyEducation(input: EducationVerificationInput): Promise<VerificationResult> {
    return {
      status: "manual_review",
      providerKey: "mock_bgv",
      providerRequestId: randomUUID(),
      providerReferenceId: `MOCK-EDU-${Date.now()}`,
      matchScore: 50,
      matchedName: input.candidateName ?? null,
      resultSummary: `Education (${input.boardType}) submitted. Configure BGV_PROVIDER=infinity_ai for live checks.`,
      riskFlags: ["EDUCATION_MANUAL_REVIEW"],
      raw: { mode: "mock", boardType: input.boardType },
    };
  }

  async verifyCourt(input: CourtVerificationInput): Promise<CourtVerificationResult> {
    return {
      status: "queued",
      providerKey: "mock_bgv",
      providerRequestId: randomUUID(),
      providerReferenceId: `MOCK-COURT-${Date.now()}`,
      matchScore: null,
      matchedName: input.candidateName,
      resultSummary: "Court check queued. Configure BGV_PROVIDER=infinity_ai for live court record checks.",
      riskFlags: [],
      courtCases: null,
      raw: { mode: "mock" },
    };
  }

  async startDigilocker(candidateId: string, requestedDocuments: string[]): Promise<DigilockerSession> {
    const state = randomUUID();
    return {
      state,
      authUrl: `${env.BACKEND_URL || 'http://localhost:5056'}/api/mock-digilocker/authorize?state=${state}&candidateId=${candidateId}&docs=${encodeURIComponent(requestedDocuments.join(","))}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async initiateCandidateBgv(input: BgvCandidatePortalInput): Promise<BgvPortalInitiationResult> {
    const mockToken = Buffer.from(`MOCK-${input.candidateId}`).toString("base64");
    return {
      providerKey: "mock_bgv",
      caseId: `MOCK-CASE-${randomUUID()}`,
      portalLoginUrl: `http://localhost:5173/mock-bgv-portal/login/${mockToken}`,
      candidateEmail: input.email,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      raw: { mode: "mock", note: "Set BGV_PROVIDER=infinity_ai for live InfinitiAI portal initiation." },
    };
  }
}

// ── Infinity AI adapter ───────────────────────────────────────────────────────
// Docs: https://docs.infinityai.in/bgv-api (API shape inferred from public docs;
// update endpoint paths if Infinity AI sends you a different integration guide)

export class InfinityAiBgvAdapter implements BgvProviderAdapter {
  readonly providerKey = "infinity_ai";
  private readonly http;

  constructor() {
    if (!env.INFINITY_AI_API_KEY) throw new Error("INFINITY_AI_API_KEY is not configured");
    this.http = axios.create({
      baseURL: env.INFINITY_AI_API_URL,
      headers: {
        "x-api-key": env.INFINITY_AI_API_KEY,
        ...(env.INFINITY_AI_CLIENT_ID ? { "x-client-id": env.INFINITY_AI_CLIENT_ID } : {}),
        "Content-Type": "application/json",
      },
      timeout: 30_000,
    });
  }

  async verifyPan(input: PanVerificationInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    const res = await this.http.post("/v1/bgv/pan/verify", {
      request_id: requestId,
      pan: input.panNumber.trim().toUpperCase(),
      name: input.candidateName ?? undefined,
      dob: input.dateOfBirth ?? undefined,
    });
    const d = res.data?.data ?? res.data ?? {};
    const apiStatus: string = String(d.status ?? "").toLowerCase();
    const status: VerificationStatus =
      apiStatus === "valid" || apiStatus === "verified" ? "verified"
      : apiStatus === "name_mismatch" || apiStatus === "mismatch" ? "mismatch"
      : "failed";
    const score = roughNameMatchScore(input.candidateName, d.pan_name ?? d.name);
    return {
      status,
      providerKey: "infinity_ai",
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.transaction_id ?? requestId),
      matchScore: score,
      matchedName: d.pan_name ?? d.name ?? null,
      matchedDob: d.dob ?? null,
      resultSummary: d.message ?? d.result_message ?? `PAN check: ${status}`,
      riskFlags: status === "verified" ? [] : [String(d.failure_reason ?? "PAN_CHECK_FAILED").toUpperCase()],
      raw: d,
    };
  }

  async verifyBank(input: BankVerificationInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    const res = await this.http.post("/v1/bgv/bank/pennyless-verify", {
      request_id: requestId,
      account_number: input.accountNo.replace(/\s/g, ""),
      ifsc: input.ifscCode.trim().toUpperCase(),
      name: input.accountHolderName ?? input.candidateName ?? undefined,
    });
    const d = res.data?.data ?? res.data ?? {};
    const apiStatus: string = String(d.status ?? "").toLowerCase();
    const status: VerificationStatus =
      apiStatus === "valid" || apiStatus === "verified" || apiStatus === "active" ? "verified"
      : apiStatus === "name_mismatch" || apiStatus === "mismatch" ? "mismatch"
      : "failed";
    const matchedName = d.registered_name ?? d.account_holder_name ?? null;
    const score = roughNameMatchScore(input.accountHolderName ?? input.candidateName, matchedName);
    return {
      status,
      providerKey: "infinity_ai",
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.utr ?? requestId),
      matchScore: score,
      matchedName,
      resultSummary: d.message ?? `Bank check: ${status}`,
      riskFlags: status === "verified" ? [] : [String(d.failure_reason ?? "BANK_CHECK_FAILED").toUpperCase()],
      raw: d,
    };
  }

  async verifyAadhaarOffline(input: AadhaarOfflineInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    const res = await this.http.post("/v1/bgv/aadhaar/offline-verify", {
      request_id: requestId,
      document_id: input.documentId ?? undefined,
      aadhaar_last4: input.aadhaarLast4 ?? undefined,
      name: input.candidateName ?? undefined,
    });
    const d = res.data?.data ?? res.data ?? {};
    const apiStatus: string = String(d.status ?? "").toLowerCase();
    const status: VerificationStatus =
      apiStatus === "verified" || apiStatus === "valid" ? "verified"
      : apiStatus === "manual_review" || apiStatus === "pending" ? "manual_review"
      : "failed";
    const score = roughNameMatchScore(input.candidateName, d.name ?? d.matched_name);
    return {
      status,
      providerKey: "infinity_ai",
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? requestId),
      matchScore: score,
      matchedName: d.name ?? d.matched_name ?? null,
      resultSummary: d.message ?? `Aadhaar offline: ${status}`,
      riskFlags: status === "verified" ? [] : ["AADHAAR_OFFLINE_" + (d.failure_reason ?? "FAILED").toUpperCase()],
      raw: d,
    };
  }

  async verifyAddressDoc(input: AddressDocInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    const endpoint = input.docType === 'driving_license'
      ? '/v1/bgv/dl/verify'
      : '/v1/bgv/voter/verify';
    const payload = input.docType === 'driving_license'
      ? { request_id: requestId, dl_number: input.documentNumber, dob: input.dateOfBirth ?? undefined, name: input.candidateName ?? undefined, state: input.state ?? undefined }
      : { request_id: requestId, epic_number: input.documentNumber, name: input.candidateName ?? undefined };
    const res = await this.http.post(endpoint, payload);
    const d = res.data?.data ?? res.data ?? {};
    const apiStatus = String(d.status ?? '').toLowerCase();
    const status: VerificationStatus =
      apiStatus === 'valid' || apiStatus === 'verified' ? 'verified'
      : apiStatus === 'name_mismatch' || apiStatus === 'mismatch' ? 'mismatch'
      : 'failed';
    const matchedName = d.name ?? d.holder_name ?? d.voter_name ?? null;
    return {
      status,
      providerKey: 'infinity_ai',
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.transaction_id ?? requestId),
      matchScore: roughNameMatchScore(input.candidateName, matchedName),
      matchedName,
      matchedDob: d.dob ?? null,
      resultSummary: d.message ?? `${input.docType} check: ${status}`,
      riskFlags: status === 'verified' ? [] : [String(d.failure_reason ?? 'ADDRESS_DOC_FAILED').toUpperCase()],
      raw: d,
    };
  }

  async verifyEducation(input: EducationVerificationInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    const res = await this.http.post('/v1/bgv/education/verify', {
      request_id: requestId,
      board_type: input.boardType,
      roll_number: input.rollNumber ?? undefined,
      certificate_number: input.certificateNumber ?? undefined,
      year_of_passing: input.yearOfPassing,
      name: input.candidateName ?? undefined,
      institution_name: input.institutionName ?? undefined,
    });
    const d = res.data?.data ?? res.data ?? {};
    const apiStatus = String(d.status ?? '').toLowerCase();
    const status: VerificationStatus =
      apiStatus === 'valid' || apiStatus === 'verified' ? 'verified'
      : apiStatus === 'manual_review' || apiStatus === 'pending' ? 'manual_review'
      : apiStatus === 'name_mismatch' || apiStatus === 'mismatch' ? 'mismatch'
      : 'failed';
    const matchedName = d.candidate_name ?? d.name ?? null;
    return {
      status,
      providerKey: 'infinity_ai',
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? requestId),
      matchScore: roughNameMatchScore(input.candidateName, matchedName),
      matchedName,
      resultSummary: d.message ?? `Education (${input.boardType}) check: ${status}`,
      riskFlags: status === 'verified' ? [] : [String(d.failure_reason ?? 'EDUCATION_FAILED').toUpperCase()],
      raw: d,
    };
  }

  async verifyCourt(input: CourtVerificationInput): Promise<CourtVerificationResult> {
    const requestId = randomUUID();
    const courtHttp = axios.create({
      baseURL: env.COURT_CHECK_API_URL,
      headers: {
        'x-api-key': env.COURT_CHECK_API_KEY ?? env.INFINITY_AI_API_KEY ?? '',
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
    const res = await courtHttp.post('/v1/bgv/court/verify', {
      request_id: requestId,
      name: input.candidateName,
      dob: input.dateOfBirth,
      father_name: input.fatherName ?? undefined,
      address: input.address ?? undefined,
      state: input.state ?? undefined,
      pincode: input.pincode ?? undefined,
    });
    const d = res.data?.data ?? res.data ?? {};
    const apiStatus = String(d.status ?? '').toLowerCase();
    const status: VerificationStatus =
      apiStatus === 'clear' || apiStatus === 'no_records' ? 'verified'
      : apiStatus === 'positive' || apiStatus === 'records_found' ? 'failed'
      : apiStatus === 'manual_review' || apiStatus === 'pending' ? 'manual_review'
      : 'queued';
    const cases = Array.isArray(d.court_cases) ? d.court_cases.map((c: Record<string, unknown>) => ({
      caseType: String(c.case_type ?? ''),
      caseNumber: String(c.case_number ?? ''),
      court: String(c.court_name ?? c.court ?? ''),
      year: Number(c.year ?? 0),
      status: String(c.status ?? ''),
    })) : null;
    return {
      status,
      providerKey: 'infinity_ai',
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.transaction_id ?? requestId),
      matchScore: null,
      matchedName: input.candidateName,
      resultSummary: d.message ?? `Court check: ${status}`,
      riskFlags: cases?.length ? ['COURT_RECORDS_FOUND'] : [],
      courtCases: cases,
      raw: d,
    };
  }

  async startDigilocker(candidateId: string, requestedDocuments: string[]): Promise<DigilockerSession> {
    const state = randomUUID();
    const res = await this.http.post("/v1/digilocker/session/create", {
      state,
      candidate_id: candidateId,
      documents: requestedDocuments,
      redirect_uri: `${env.FRONTEND_URL}/onboard-full?step=digilocker`,
    });
    const d = res.data?.data ?? res.data ?? {};
    return {
      state: String(d.state ?? state),
      authUrl: String(d.auth_url ?? d.redirect_url ?? ""),
      expiresAt: d.expires_at ? new Date(d.expires_at) : new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async initiateCandidateBgv(input: BgvCandidatePortalInput): Promise<BgvPortalInitiationResult> {
    // InfinitiAI candidate portal initiation.
    // Creates the candidate on their portal; they receive a login email with URL http://candidates.theinfiniti.ai/login/{token}
    // Endpoint confirmed from InfinitiAI support email (support@theinfiniti.ai) — Mas Callnet India Pvt Ltd integration.
    const res = await this.http.post("/v1/bgv/candidate/initiate", {
      reference_id: input.candidateId,
      candidate_name: input.candidateName,
      email: input.email,
      mobile: input.mobile ?? undefined,
      dob: input.dateOfBirth ?? undefined,
      father_name: input.fatherName ?? undefined,
      address: input.address ?? undefined,
      employee_id: input.employeeCode ?? undefined,
      notify_candidate: true,
    });
    const d = res.data?.data ?? res.data ?? {};
    const caseId = String(d.case_id ?? d.candidate_id ?? d.id ?? randomUUID());
    // Build portal login URL: InfinitiAI sends candidates http://candidates.theinfiniti.ai/login/{token}
    const portalToken = String(d.login_token ?? d.token ?? caseId);
    const portalLoginUrl = `${env.INFINITY_AI_PORTAL_URL}/login/${portalToken}`;
    const expiryDays = Number(d.expiry_days ?? d.token_validity_days ?? 7);
    return {
      providerKey: "infinity_ai",
      caseId,
      portalLoginUrl,
      candidateEmail: input.email,
      expiresAt: d.expires_at ? new Date(d.expires_at) : new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
      raw: d,
    };
  }
}

// ── Digio adapter ─────────────────────────────────────────────────────────────
// Docs: https://developers.digio.in (Basic auth: client_id:client_secret)

export class DigioBgvAdapter implements BgvProviderAdapter {
  readonly providerKey = "digio";
  private readonly http;

  constructor() {
    if (!env.DIGIO_CLIENT_ID || !env.DIGIO_CLIENT_SECRET) {
      throw new Error("DIGIO_CLIENT_ID and DIGIO_CLIENT_SECRET are not configured");
    }
    const token = Buffer.from(`${env.DIGIO_CLIENT_ID}:${env.DIGIO_CLIENT_SECRET}`).toString("base64");
    this.http = axios.create({
      baseURL: env.DIGIO_API_URL,
      headers: {
        Authorization: `Basic ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 30_000,
    });
  }

  async verifyPan(input: PanVerificationInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    // Digio PAN verify: POST /v2/client/verify/pan
    const res = await this.http.post("/v2/client/verify/pan", {
      pan_number: input.panNumber.trim().toUpperCase(),
      name: input.candidateName ?? undefined,
      date_of_birth: input.dateOfBirth ?? undefined,
    });
    const d = res.data ?? {};
    const code: string = String(d.response_code ?? d.code ?? "").toUpperCase();
    const status: VerificationStatus =
      code === "200" || d.status === "VALID" ? "verified"
      : d.status === "NAME_MISMATCH" ? "mismatch"
      : "failed";
    const score = roughNameMatchScore(input.candidateName, d.pan_holder_name ?? d.name);
    return {
      status,
      providerKey: "digio",
      providerRequestId: requestId,
      providerReferenceId: String(d.id ?? d.request_id ?? requestId),
      matchScore: score,
      matchedName: d.pan_holder_name ?? d.name ?? null,
      matchedDob: d.date_of_birth ?? null,
      resultSummary: d.message ?? `PAN check: ${status}`,
      riskFlags: status === "verified" ? [] : [code || "PAN_FAILED"],
      raw: d,
    };
  }

  async verifyBank(input: BankVerificationInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    // Digio bank penny-less: POST /v2/client/verify/bank_account
    const res = await this.http.post("/v2/client/verify/bank_account", {
      account_number: input.accountNo.replace(/\s/g, ""),
      ifsc: input.ifscCode.trim().toUpperCase(),
      account_holder_name: input.accountHolderName ?? input.candidateName ?? undefined,
    });
    const d = res.data ?? {};
    const code: string = String(d.response_code ?? d.code ?? "").toUpperCase();
    const status: VerificationStatus =
      code === "200" || d.bank_account_exists === true ? "verified"
      : d.name_match === false ? "mismatch"
      : "failed";
    const matchedName = d.registered_name ?? d.account_holder_name ?? null;
    const score = roughNameMatchScore(input.accountHolderName ?? input.candidateName, matchedName);
    return {
      status,
      providerKey: "digio",
      providerRequestId: requestId,
      providerReferenceId: String(d.id ?? requestId),
      matchScore: score,
      matchedName,
      resultSummary: d.message ?? `Bank check: ${status}`,
      riskFlags: status === "verified" ? [] : [code || "BANK_FAILED"],
      raw: d,
    };
  }

  async verifyAadhaarOffline(input: AadhaarOfflineInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    // Digio Aadhaar offline XML: POST /v2/client/verify/aadhaar
    const res = await this.http.post("/v2/client/verify/aadhaar", {
      document_id: input.documentId ?? undefined,
      last_4_digits: input.aadhaarLast4 ?? undefined,
      name: input.candidateName ?? undefined,
    });
    const d = res.data ?? {};
    const code: string = String(d.response_code ?? d.code ?? "").toUpperCase();
    const status: VerificationStatus =
      code === "200" || d.status === "VALID" ? "verified"
      : d.status === "MANUAL_REVIEW" ? "manual_review"
      : "failed";
    const score = roughNameMatchScore(input.candidateName, d.name ?? d.aadhaar_name);
    return {
      status,
      providerKey: "digio",
      providerRequestId: requestId,
      providerReferenceId: String(d.id ?? requestId),
      matchScore: score,
      matchedName: d.name ?? d.aadhaar_name ?? null,
      resultSummary: d.message ?? `Aadhaar offline: ${status}`,
      riskFlags: status === "verified" ? [] : [code || "AADHAAR_FAILED"],
      raw: d,
    };
  }

  async verifyAddressDoc(input: AddressDocInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    const endpoint = input.docType === 'driving_license'
      ? '/v2/client/verify/driving_license'
      : '/v2/client/verify/voter_id';
    const payload = input.docType === 'driving_license'
      ? { dl_number: input.documentNumber, dob: input.dateOfBirth ?? undefined, name: input.candidateName ?? undefined }
      : { voter_id: input.documentNumber, name: input.candidateName ?? undefined };
    const res = await this.http.post(endpoint, payload);
    const d = res.data ?? {};
    const code = String(d.response_code ?? d.code ?? '').toUpperCase();
    const status: VerificationStatus =
      code === '200' || d.status === 'VALID' ? 'verified'
      : d.status === 'NAME_MISMATCH' ? 'mismatch'
      : 'failed';
    const matchedName = d.name ?? d.holder_name ?? null;
    return {
      status,
      providerKey: 'digio',
      providerRequestId: requestId,
      providerReferenceId: String(d.id ?? requestId),
      matchScore: roughNameMatchScore(input.candidateName, matchedName),
      matchedName,
      matchedDob: d.dob ?? null,
      resultSummary: d.message ?? `${input.docType} check: ${status}`,
      riskFlags: status === 'verified' ? [] : [code || 'ADDRESS_DOC_FAILED'],
      raw: d,
    };
  }

  async verifyEducation(input: EducationVerificationInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    const res = await this.http.post('/v2/client/verify/education', {
      board_type: input.boardType,
      roll_number: input.rollNumber ?? undefined,
      certificate_number: input.certificateNumber ?? undefined,
      year_of_passing: input.yearOfPassing,
      name: input.candidateName ?? undefined,
    });
    const d = res.data ?? {};
    const code = String(d.response_code ?? d.code ?? '').toUpperCase();
    const status: VerificationStatus =
      code === '200' || d.status === 'VALID' ? 'verified'
      : d.status === 'MANUAL_REVIEW' ? 'manual_review'
      : d.status === 'NAME_MISMATCH' ? 'mismatch'
      : 'failed';
    return {
      status,
      providerKey: 'digio',
      providerRequestId: requestId,
      providerReferenceId: String(d.id ?? requestId),
      matchScore: roughNameMatchScore(input.candidateName, d.candidate_name ?? d.name),
      matchedName: d.candidate_name ?? d.name ?? null,
      resultSummary: d.message ?? `Education check: ${status}`,
      riskFlags: status === 'verified' ? [] : [code || 'EDUCATION_FAILED'],
      raw: d,
    };
  }

  async verifyCourt(_input: CourtVerificationInput): Promise<CourtVerificationResult> {
    throw Object.assign(
      new Error("Court check is not supported by the Digio adapter. Switch BGV_PROVIDER=infinity_ai."),
      { statusCode: 501 },
    );
  }

  async startDigilocker(candidateId: string, requestedDocuments: string[]): Promise<DigilockerSession> {
    // Digio DigiLocker: POST /v2/client/digilocker/create_request
    const res = await this.http.post("/v2/client/digilocker/create_request", {
      customer_identifier: candidateId,
      redirect_url: `${env.FRONTEND_URL}/onboard-full?step=digilocker`,
      requested_documents: requestedDocuments,
      notify_on_completion: true,
    });
    const d = res.data ?? {};
    return {
      state: String(d.id ?? randomUUID()),
      authUrl: String(d.access_link ?? d.digilocker_url ?? ""),
      expiresAt: d.expire_on ? new Date(d.expire_on) : new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async initiateCandidateBgv(input: BgvCandidatePortalInput): Promise<BgvPortalInitiationResult> {
    // Digio does not provide a hosted candidate BGV portal; use InfinitiAI for this flow.
    throw Object.assign(
      new Error("Candidate BGV portal initiation is not supported by the Digio adapter. Switch BGV_PROVIDER=infinity_ai."),
      { statusCode: 501 },
    );
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

let _adapterCache: BgvProviderAdapter | null = null;

export function getBgvProviderAdapter(): BgvProviderAdapter {
  if (_adapterCache) return _adapterCache;
  switch (env.BGV_PROVIDER) {
    case "infinity_ai":
      _adapterCache = new InfinityAiBgvAdapter();
      break;
    case "digio":
      _adapterCache = new DigioBgvAdapter();
      break;
    case "befisc_luckpay":
      _adapterCache = new CompositeBgvProviderAdapter({
        bgv_provider: "befisc_luckpay",
        luckpay_api_url:     env.LUCKPAY_BASE_URL,
        luckpay_basic_token: env.LUCKPAY_BASIC_TOKEN,
        luckpay_client_id:   env.LUCKPAY_CLIENT_ID,
      } as BgvDbConfig);
      break;
    default:
      if (env.NODE_ENV === "production") {
        console.warn("[BGV] BGV_PROVIDER=mock in production — set BGV_PROVIDER=befisc_luckpay, infinity_ai or digio for live verification.");
      }
      _adapterCache = new MockBgvProviderAdapter();
  }
  return _adapterCache;
}

/** Reset adapter cache — only for tests that need to re-initialize with different env. */
export function resetBgvProviderAdapterCache(): void {
  _adapterCache = null;
}

// ── DB-config-aware adapter (reads org_settings at runtime) ──────────────────
// Used when Super Admin updates provider via UI. Bypasses env defaults.

export interface BgvDbConfig {
  bgv_provider: string;
  infinity_ai_api_url?: string;
  infinity_ai_api_key?: string;
  infinity_ai_client_id?: string;
  infinity_ai_portal_url?: string;
  digio_api_url?: string;
  digio_client_id?: string;
  digio_client_secret?: string;
  digilocker_session_url?: string;
  digilocker_api_key?: string;
  digilocker_client_id?: string;
  befisc_api_url?: string;
  befisc_api_key?: string;
  luckpay_api_url?: string;              // PAN / Bank / UAN base URL
  luckpay_digilocker_base_url?: string;  // DigiLocker + eSign base URL (may differ from PAN URL)
  luckpay_digilocker_basic_token?: string; // separate token for DigiLocker/eSign if different account
  luckpay_digilocker_client_id?: string;   // separate client ID for DigiLocker/eSign if different account
  luckpay_basic_token?: string;
  luckpay_client_id?: string;
  crimescan_api_url?: string;
  crimescan_api_key?: string;
}

export function buildAdapterFromDbConfig(cfg: BgvDbConfig): BgvProviderAdapter {
  const provider = cfg.bgv_provider ?? "mock";
  const mutableEnv = env as typeof env & Record<string, string | undefined>;
  if (provider === "infinity_ai") {
    if (!cfg.infinity_ai_api_key) throw new Error("Infinity AI API Key not configured in BGV settings.");
    // Override env temporarily for this adapter instance
    const savedKey = env.INFINITY_AI_API_KEY;
    const savedUrl = env.INFINITY_AI_API_URL;
    const savedClientId = env.INFINITY_AI_CLIENT_ID;
    const savedPortalUrl = env.INFINITY_AI_PORTAL_URL;
    mutableEnv.INFINITY_AI_API_KEY = cfg.infinity_ai_api_key;
    mutableEnv.INFINITY_AI_API_URL = cfg.infinity_ai_api_url ?? env.INFINITY_AI_API_URL;
    mutableEnv.INFINITY_AI_CLIENT_ID = cfg.infinity_ai_client_id ?? env.INFINITY_AI_CLIENT_ID;
    mutableEnv.INFINITY_AI_PORTAL_URL = cfg.infinity_ai_portal_url ?? env.INFINITY_AI_PORTAL_URL;
    const adapter = new InfinityAiBgvAdapter();
    mutableEnv.INFINITY_AI_API_KEY = savedKey;
    mutableEnv.INFINITY_AI_API_URL = savedUrl;
    mutableEnv.INFINITY_AI_CLIENT_ID = savedClientId;
    mutableEnv.INFINITY_AI_PORTAL_URL = savedPortalUrl;
    return adapter;
  }
  if (provider === "digio") {
    if (!cfg.digio_client_id || !cfg.digio_client_secret) throw new Error("Digio Client ID and Secret not configured in BGV settings.");
    const savedId = env.DIGIO_CLIENT_ID;
    const savedSecret = env.DIGIO_CLIENT_SECRET;
    const savedUrl = env.DIGIO_API_URL;
    mutableEnv.DIGIO_CLIENT_ID = cfg.digio_client_id;
    mutableEnv.DIGIO_CLIENT_SECRET = cfg.digio_client_secret;
    mutableEnv.DIGIO_API_URL = cfg.digio_api_url ?? env.DIGIO_API_URL;
    const adapter = new DigioBgvAdapter();
    mutableEnv.DIGIO_CLIENT_ID = savedId;
    mutableEnv.DIGIO_CLIENT_SECRET = savedSecret;
    mutableEnv.DIGIO_API_URL = savedUrl;
    return adapter;
  }
  if (provider === "befisc_luckpay") {
    return new CompositeBgvProviderAdapter(cfg);
  }
  return new MockBgvProviderAdapter();
}

function cleanSettingValue(value: unknown): string | undefined {
  // Strip all whitespace including embedded newlines/carriage-returns that cause
  // "Invalid header value char" when credential tokens are pasted via the Admin UI.
  const str = String(value ?? "").replace(/\s+/g, "").trim();
  if (!str || str === "••••••••") return undefined;
  return str;
}

async function loadBgvDbConfig(): Promise<BgvDbConfig | null> {
  const keys = [
    "bgv_provider",
    "infinity_ai_api_url", "infinity_ai_api_key", "infinity_ai_client_id", "infinity_ai_portal_url",
    "digio_api_url", "digio_client_id", "digio_client_secret",
    "befisc_api_url", "befisc_api_key",
    "luckpay_api_url", "luckpay_basic_token", "luckpay_client_id",
    "luckpay_digilocker_base_url", "luckpay_digilocker_basic_token", "luckpay_digilocker_client_id",
    "crimescan_api_url", "crimescan_api_key",
  ];
  const placeholders = keys.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT setting_key, setting_value FROM org_settings WHERE setting_key IN (${placeholders})`,
    keys,
  );
  if (!rows.length) return null;
  const cfg: Record<string, string> = {};
  for (const row of rows as RowDataPacket[]) {
    const value = cleanSettingValue(row.setting_value);
    if (value !== undefined) cfg[String(row.setting_key)] = value;
  }
  return cfg.bgv_provider ? cfg as unknown as BgvDbConfig : null;
}

export async function getConfiguredBgvProviderAdapter(): Promise<BgvProviderAdapter> {
  const cfg = await loadBgvDbConfig();
  if (cfg?.bgv_provider && cfg.bgv_provider !== "mock") {
    return buildAdapterFromDbConfig(cfg);
  }
  if (env.NODE_ENV === "production" || process.env.DISABLE_MOCK_BGV === "true") {
    throw Object.assign(
      new Error("Live BGV provider is not configured. Configure DigiLocker/Aadhaar/PAN/Criminal APIs from Super Admin > Settings > BGV Config."),
      { statusCode: 503 },
    );
  }
  return getBgvProviderAdapter();
}

class CompositeBgvProviderAdapter implements BgvProviderAdapter {
  readonly providerKey = "befisc_luckpay";
  private luckpayAccessToken = "";
  private luckpayAccessTokenExpiresAt = 0;
  constructor(private readonly cfg: BgvDbConfig) {}

  private async post(baseOrUrl: string | undefined, path: string, payload: Record<string, unknown>, auth: Record<string, string> = {}) {
    if (!baseOrUrl) throw new Error(`${path} endpoint is not configured in BGV settings`);
    const url = /^https?:\/\//i.test(baseOrUrl) && !baseOrUrl.endsWith("/") && baseOrUrl.includes(path)
      ? baseOrUrl
      : `${baseOrUrl.replace(/\/$/, "")}${path}`;
    const res = await axios.post(url, payload, { headers: { "Content-Type": "application/json", ...auth }, timeout: 30_000 });
    return res.data?.data ?? res.data ?? {};
  }

  private apiKeyHeaders(key?: string): Record<string, string> {
    const clean = String(key ?? "").replace(/\s+/g, "").trim();
    return clean ? { "x-api-key": clean } : {};
  }

  // Befisc uses "authkey" header, not "x-api-key"
  private befiscHeaders(key?: string): Record<string, string> {
    const clean = String(key ?? "").replace(/\s+/g, "").trim();
    return clean ? { authkey: clean, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }

  // Crimescan uses Bearer token
  private crimescanHeaders(key?: string): Record<string, string> {
    const clean = String(key ?? "").replace(/\s+/g, "").trim();
    return clean
      ? { Authorization: `Bearer ${clean}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  }

  private luckpayBaseUrl(): string {
    const baseUrl = this.cfg.luckpay_api_url?.trim();
    if (!baseUrl) throw new Error("Luckpay API Base URL is not configured in BGV settings");
    return baseUrl.replace(/\/$/, "");
  }

  // DigiLocker + eSign may use a different base URL (e.g. staging vs production)
  // Falls back to luckpay_api_url if luckpay_digilocker_base_url is not set
  private digilockerBaseUrl(): string {
    const url = (this.cfg.luckpay_digilocker_base_url ?? this.cfg.luckpay_api_url ?? "").trim();
    if (!url) throw new Error("Luckpay DigiLocker Base URL is not configured in BGV settings");
    return url.replace(/\/$/, "");
  }

  // DigiLocker/eSign auth uses its own token when separate credentials are configured
  private async getDigilockerAccessToken(): Promise<string> {
    const basicToken = (this.cfg.luckpay_digilocker_basic_token ?? this.cfg.luckpay_basic_token ?? "").replace(/\s+/g, "").trim();
    const clientId = (this.cfg.luckpay_digilocker_client_id ?? this.cfg.luckpay_client_id ?? "").replace(/\s+/g, "").trim();
    if (!basicToken || !clientId) throw new Error("Luckpay DigiLocker credentials are not configured in BGV settings.");
    // Use digilocker base URL for auth if separate
    const authUrl = `${this.digilockerBaseUrl()}/auth/token`;
    let res;
    try {
      res = await axios.post(authUrl, undefined, {
        headers: { Authorization: `Basic ${basicToken}` },
        timeout: env.LUCKPAY_TIMEOUT_MS,
      });
    } catch (error) { throw this.toLuckpayError(error); }
    const payload = res.data?.data ?? res.data ?? {};
    const token = String(payload.accessToken ?? payload.access_token ?? payload.token ?? "");
    if (!token) throw new Error("Luckpay DigiLocker auth response did not include a token.");
    return token;
  }

  private digilockerClientId(): string {
    return (this.cfg.luckpay_digilocker_client_id ?? this.cfg.luckpay_client_id ?? "").replace(/\s+/g, "").trim();
  }

  private async getLuckpayAccessToken(): Promise<string> {
    if (!this.cfg.luckpay_basic_token || !this.cfg.luckpay_client_id) {
      throw new Error("Luckpay Basic Token and Client ID are not configured in BGV settings.");
    }
    const now = Date.now();
    if (this.luckpayAccessToken && this.luckpayAccessTokenExpiresAt > now + 2_000) {
      return this.luckpayAccessToken;
    }

    const authUrl = `${this.luckpayBaseUrl()}/auth/token`;
    const basicToken = String(this.cfg.luckpay_basic_token ?? "").replace(/\s+/g, "").trim();
    let res;
    try {
      res = await axios.post(authUrl, undefined, {
        headers: { Authorization: `Basic ${basicToken}` },
        timeout: env.LUCKPAY_TIMEOUT_MS,
      });
    } catch (error) {
      throw this.toLuckpayError(error);
    }
    const payload = res.data?.data ?? res.data ?? {};
    const token = String(payload.accessToken ?? payload.access_token ?? payload.token ?? "");
    if (!token) throw new Error("Luckpay auth token response did not include an access token.");
    const expiresIn = Number(payload.expiresIn ?? payload.expires_in ?? env.LUCKPAY_TOKEN_CACHE_TTL_SECONDS);
    this.luckpayAccessToken = token;
    this.luckpayAccessTokenExpiresAt = now + Math.max(1, expiresIn) * 1000;
    return token;
  }

  private async postLuckpay(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const accessToken = await this.getLuckpayAccessToken();
    let res;
    try {
      const clientId = String(this.cfg.luckpay_client_id ?? "").replace(/\s+/g, "").trim();
      res = await axios.post(`${this.luckpayBaseUrl()}${path}`, payload, {
        headers: {
          Authorization: clientId,
          "X-Access-Token": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: env.LUCKPAY_TIMEOUT_MS,
      });
    } catch (error) {
      throw this.toLuckpayError(error);
    }
    const data = res.data?.data ?? res.data ?? {};
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : { data };
  }

  private async getCandidateContact(candidateId: string): Promise<{ fullName: string; mobile: string }> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT full_name, mobile FROM ats_candidate WHERE id = ? LIMIT 1`,
      [candidateId],
    );
    const row = rows[0];
    const fullName = String(row?.full_name ?? "").trim();
    const mobile = String(row?.mobile ?? "").replace(/\D/g, "");
    if (!fullName || !mobile) {
      throw new Error("Candidate name/mobile is required before starting Luckpay DigiLocker.");
    }
    return { fullName, mobile };
  }

  private sanitizedRaw(data: Record<string, unknown>): Record<string, unknown> {
    return sanitizeProviderPayload(data) as Record<string, unknown>;
  }

  private providerString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return null;
  }

  private toLuckpayError(error: unknown): Error {
    const status = Number((error as { response?: { status?: number } })?.response?.status ?? 502);
    const responseData = (error as { response?: { data?: unknown } })?.response?.data;
    const sanitized = sanitizeProviderPayload(responseData) as Record<string, unknown> | null;
    const providerMessage = sanitized && typeof sanitized === "object"
      ? String(sanitized.message ?? sanitized.error ?? sanitized.status ?? "")
      : "";
    const message = providerMessage || "Luckpay provider request failed";
    return Object.assign(new Error(`Luckpay provider request failed: ${message}`), {
      statusCode: status >= 400 && status < 600 ? status : 502,
      providerPayload: sanitized,
    });
  }

  async verifyPan(input: PanVerificationInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    const d = await this.postLuckpay("/verifyPan", {
      clientTransactionId: requestId,
      idNumber: input.panNumber.trim().toUpperCase(),
      mobileNumber: String(input.mobileNumber ?? "").replace(/\D/g, "") || "9999999999",
    });
    const apiStatus = String(d.status ?? d.result ?? "").toLowerCase();
    const status: VerificationStatus = ["valid", "verified", "success", "active"].includes(apiStatus)
      ? "verified"
      : apiStatus.includes("mismatch") ? "mismatch" : "failed";
    const matchedName = this.providerString(d.pan_name ?? d.name ?? d.full_name);
    const matchedDob = this.providerString(d.dob);
    const message = this.providerString(d.message);
    const failureReason = this.providerString(d.failure_reason);
    return {
      status,
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.transaction_id ?? requestId),
      matchScore: roughNameMatchScore(input.candidateName, matchedName),
      matchedName,
      matchedDob,
      resultSummary: message ?? `PAN check: ${status}`,
      riskFlags: status === "verified" ? [] : [String(failureReason ?? "PAN_CHECK_FAILED").toUpperCase()],
      raw: this.sanitizedRaw(d),
    };
  }

  async verifyBank(input: BankVerificationInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    const d = await this.postLuckpay("/verifyPennyDrop", {
      clientTransactionId: requestId,
      customerAccountNumber: input.accountNo.replace(/\s/g, ""),
      customerAccountName: input.accountHolderName ?? input.candidateName ?? "",
      customerIfscCode: input.ifscCode.trim().toUpperCase(),
      verificationMode: "PENNY_DROP",
    });
    // Luckpay penny-drop wraps name in data.details.beneficiaryNameWithBank
    const details = (d.details && typeof d.details === "object" ? d.details : {}) as Record<string, unknown>;
    const apiStatus = String(d.status ?? d.result ?? "").toLowerCase();
    const detailsVerified = Boolean(details.verified ?? details.status);
    const matchedName = this.providerString(
      details.beneficiaryNameWithBank ?? details.beneficiaryName ??
      d.registered_name ?? d.account_holder_name ?? d.name
    );
    const score = roughNameMatchScore(input.accountHolderName ?? input.candidateName, matchedName);
    const fuzzyScore = Number(details.fuzzyMatchScore ?? score);
    const message = this.providerString(d.message);
    const failureReason = this.providerString(d.failure_reason);
    const status: VerificationStatus = (detailsVerified || ["valid", "verified", "success", "active"].includes(apiStatus))
      ? "verified"
      : apiStatus.includes("mismatch") || fuzzyScore < 60 ? "mismatch" : "failed";
    return {
      status,
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.utr ?? d.transaction_id ?? requestId),
      matchScore: fuzzyScore,
      matchedName,
      resultSummary: message ?? `Bank check: ${status}`,
      riskFlags: status === "verified" ? [] : [String(failureReason ?? "BANK_CHECK_FAILED").toUpperCase()],
      raw: this.sanitizedRaw(d),
    };
  }

  async verifyUan(input: { candidateName?: string | null; uanNumber: string }): Promise<VerificationResult & { employmentHistory?: unknown[] }> {
    const requestId = randomUUID();
    const d = await this.postLuckpay("/verifyUanByUan", {
      clientTransactionId: requestId,
      identifier: input.uanNumber.trim(),
    });
    const apiStatus = String(d.status ?? d.result ?? "").toLowerCase();
    const status: VerificationStatus = ["valid", "verified", "success", "active"].includes(apiStatus)
      ? "verified"
      : apiStatus.includes("mismatch") ? "mismatch" : "failed";
    const matchedName = this.providerString(d.name ?? d.member_name ?? d.full_name);
    const history = Array.isArray(d.employment_history) ? d.employment_history : Array.isArray(d.establishments) ? d.establishments : [];
    const message = this.providerString(d.message);
    const failureReason = this.providerString(d.failure_reason);
    return {
      status,
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.transaction_id ?? requestId),
      matchScore: roughNameMatchScore(input.candidateName, matchedName),
      matchedName,
      resultSummary: message ?? `UAN/employment check: ${status}`,
      riskFlags: status === "verified" ? [] : [String(failureReason ?? "UAN_CHECK_FAILED").toUpperCase()],
      raw: this.sanitizedRaw(d),
      employmentHistory: history,
    };
  }

  async verifyAadhaarOffline(input: AadhaarOfflineInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    if (!this.cfg.befisc_api_url || !this.cfg.befisc_api_key) {
      return {
        status: "manual_review",
        providerKey: this.providerKey,
        providerRequestId: requestId,
        providerReferenceId: requestId,
        matchScore: null,
        matchedName: input.candidateName ?? null,
        resultSummary: "Aadhaar verification queued for manual review — Befisc API not configured. HR will verify the uploaded Aadhaar document.",
        riskFlags: [],
        raw: { mode: "manual_fallback" },
      };
    }
    // Befisc uses the full standalone URL (e.g. https://aadhaar-xml-download.befisc.com/)
    // and requires "authkey" header (NOT "x-api-key")
    let res;
    try {
      res = await axios.post(
        this.cfg.befisc_api_url.replace(/\/$/, "") + "/",
        {
          aadharNo: input.aadhaarLast4 ? undefined : undefined,
          aadhaar_last4: input.aadhaarLast4 ?? undefined,
          document_id: input.documentId ?? undefined,
          name: input.candidateName ?? undefined,
        },
        {
          headers: this.befiscHeaders(this.cfg.befisc_api_key),
          timeout: 30_000,
        },
      );
    } catch (error: any) {
      const msg = error?.response?.data?.message ?? error?.message ?? "Befisc Aadhaar check failed";
      throw new Error(msg);
    }
    const raw = res.data?.data ?? res.data ?? {};
    const apiStatus = String(raw.status ?? raw.result ?? "").toLowerCase();
    const status: VerificationStatus = ["valid", "verified", "success"].includes(apiStatus)
      ? "verified"
      : ["pending", "manual_review", "review"].includes(apiStatus) ? "manual_review" : "failed";
    const matchedName = this.providerString(raw.name ?? raw.matched_name) ?? null;
    return {
      status,
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: String(raw.reference_id ?? raw.transaction_id ?? requestId),
      matchScore: roughNameMatchScore(input.candidateName, matchedName),
      matchedName,
      resultSummary: this.providerString(raw.message) ?? `Aadhaar check: ${status}`,
      riskFlags: status === "verified" ? [] : [String(raw.failure_reason ?? "AADHAAR_CHECK_FAILED").toUpperCase()],
      raw: raw,
    };
  }

  async verifyAddressDoc(input: AddressDocInput): Promise<VerificationResult> {
    return {
      status: "manual_review",
      providerKey: this.providerKey,
      providerRequestId: randomUUID(),
      providerReferenceId: `ADDR-MANUAL-${Date.now()}`,
      matchScore: null,
      matchedName: input.candidateName ?? null,
      resultSummary: `${input.docType} verification is not configured for Befisc/Luckpay/Crimescan provider. Use DigiLocker/manual review.`,
      riskFlags: ["ADDRESS_DOC_MANUAL_REVIEW"],
      raw: { provider: this.providerKey, docType: input.docType },
    };
  }

  async verifyEducation(input: EducationVerificationInput): Promise<VerificationResult> {
    return {
      status: "manual_review",
      providerKey: this.providerKey,
      providerRequestId: randomUUID(),
      providerReferenceId: `EDU-MANUAL-${Date.now()}`,
      matchScore: null,
      matchedName: input.candidateName ?? null,
      resultSummary: `${input.boardType} education verification is not configured for Befisc/Luckpay/Crimescan provider. Use manual/vendor review.`,
      riskFlags: ["EDUCATION_MANUAL_REVIEW"],
      raw: { provider: this.providerKey, boardType: input.boardType },
    };
  }

  async verifyCourt(input: CourtVerificationInput): Promise<CourtVerificationResult> {
    const requestId = randomUUID();
    // Crimescan uses exact search URL + poll pattern with Bearer auth (NOT x-api-key)
    // Step 1: exact search → get cs_id
    // Step 2: poll results endpoint with cs_id until status=1 (max 6 attempts, 10s apart)
    const searchUrl = this.cfg.crimescan_api_url?.trim();
    if (!searchUrl || !this.cfg.crimescan_api_key) {
      return {
        status: "manual_review",
        providerKey: this.providerKey,
        providerRequestId: requestId,
        providerReferenceId: requestId,
        matchScore: null,
        matchedName: input.candidateName,
        resultSummary: "Criminal/court check queued for manual HR review — Crimescan API not configured.",
        riskFlags: [],
        courtCases: null,
        raw: { mode: "manual_fallback" },
      };
    }

    const crimescanHeaders = this.crimescanHeaders(this.cfg.crimescan_api_key);
    const searchPayload: Record<string, unknown> = {
      name: input.candidateName,
      father_name: input.fatherName ?? undefined,
      address: input.address ?? undefined,
    };
    if (input.dateOfBirth) searchPayload.dob = input.dateOfBirth;

    let csId: string;
    try {
      const searchRes = await axios.post(searchUrl, searchPayload, { headers: crimescanHeaders, timeout: 120_000 });
      const searchData = searchRes.data ?? {};
      csId = String(searchData.cs_id ?? searchData?.data?.cs_id ?? "");
      if (!csId) {
        return {
          status: "manual_review", providerKey: this.providerKey,
          providerRequestId: requestId, providerReferenceId: requestId,
          matchScore: null, matchedName: input.candidateName,
          resultSummary: "Crimescan search returned no cs_id — manual review required.",
          riskFlags: [], courtCases: [], raw: searchData,
        };
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message ?? error?.message ?? "Crimescan search failed";
      throw new Error(`Court check failed: ${msg}`);
    }

    // Step 2: derive results URL from search URL (replace /exact/search with /results)
    const historyUrl = searchUrl.replace(/\/exact\/search\/?$/, "/results").replace(/\/exact\/search\//, "/results/");
    let d: Record<string, unknown> = { status: 0, message: "Processing" };
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 10_000));
      try {
        const histRes = await axios.post(historyUrl, { cs_id: csId }, { headers: crimescanHeaders, timeout: 120_000 });
        d = histRes.data ?? {};
        if (Number(d.status) === 1) break;
      } catch { /* keep polling */ }
    }

    const rawCases = d.court_cases ?? d.cases;
    const cases = Array.isArray(rawCases)
      ? (rawCases as unknown[]).map((c: unknown) => {
          const row = c as Record<string, unknown>;
          return {
            caseType: String(row.case_type ?? row.type ?? ""),
            caseNumber: String(row.case_number ?? row.number ?? ""),
            court: String(row.court_name ?? row.court ?? ""),
            year: Number(row.year ?? 0),
            status: String(row.status ?? ""),
          };
        })
      : null;

    const resultStatus: VerificationStatus = cases && cases.length > 0 ? "failed" : "verified";
    return {
      status: resultStatus,
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: csId,
      matchScore: null,
      matchedName: input.candidateName,
      resultSummary: this.providerString(d.message) ?? `Criminal/court check: ${resultStatus}`,
      riskFlags: cases?.length ? ["COURT_RECORDS_FOUND"] : [],
      courtCases: cases,
      raw: d,
    };
  }

  async startDigilocker(candidateId: string, requestedDocuments: string[]): Promise<DigilockerSession> {
    const state = randomUUID();
    const candidate = await this.getCandidateContact(candidateId);
    // DigiLocker uses its own base URL + credentials (staging vs production may differ)
    const accessToken = await this.getDigilockerAccessToken();
    let dlRes;
    try {
      dlRes = await axios.post(
        `${this.digilockerBaseUrl()}/verifyDigilockerWithURL`,
        { clientTransactionId: state, customerName: candidate.fullName, mobileNumber: candidate.mobile },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: this.digilockerClientId(),
            "X-Access-Token": `Bearer ${accessToken}`,
          },
          timeout: env.LUCKPAY_TIMEOUT_MS,
        },
      );
    } catch (error) { throw this.toLuckpayError(error); }
    const d = dlRes.data?.data ?? dlRes.data ?? {};
    return {
      state: String(d.state ?? state),
      authUrl: String(d.auth_url ?? d.redirect_url ?? d.access_link ?? d.redirectUrl ?? d.verificationUrl ?? d.verification_url ?? ""),
      expiresAt: this.providerString(d.expires_at) ? new Date(this.providerString(d.expires_at)!) : new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async initiateESign(input: ESignInput): Promise<ESignSession> {
    const state = randomUUID();
    // eSign uses digilocker credentials (same staging/prod split as DigiLocker)
    const accessToken = await this.getDigilockerAccessToken();

    // Luckpay eSignWithURL uses multipart/form-data
    const FormData = (await import("form-data")).default;
    const formData = new FormData();

    formData.append("file", input.documentBuffer, {
      filename: input.documentName,
      contentType: "application/pdf",
    });

    const requestMetadata = {
      clientTransactionId: state,
      signedBy: input.signedBy,
      location: input.location || "India",
      reason: input.reason || "Digital Signature for Employment Document",
    };
    formData.append("request", JSON.stringify(requestMetadata), {
      contentType: "application/json",
    });

    let res;
    try {
      res = await axios.post(`${this.digilockerBaseUrl()}/eSignWithURL`, formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: this.digilockerClientId(),
          "X-Access-Token": `Bearer ${accessToken}`,
        },
        timeout: env.LUCKPAY_TIMEOUT_MS,
      });
    } catch (error) {
      throw this.toLuckpayError(error);
    }

    const d = res.data?.data ?? res.data ?? {};
    return {
      state,
      authUrl: String(d.sign_url ?? d.signUrl ?? d.redirect_url ?? d.redirectUrl ?? d.auth_url ?? ""),
      expiresAt: this.providerString(d.expires_at) ? new Date(this.providerString(d.expires_at)!) : new Date(Date.now() + 30 * 60 * 1000),
      requestId: String(d.request_id ?? d.requestId ?? state),
    };
  }

  async initiateCandidateBgv(_input: BgvCandidatePortalInput): Promise<BgvPortalInitiationResult> {
    throw Object.assign(new Error("Hosted BGV portal is not configured for Befisc/Luckpay/Crimescan. Use individual onboarding checks."), { statusCode: 501 });
  }
}
