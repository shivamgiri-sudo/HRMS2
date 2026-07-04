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
  initiateCandidateBgv(input: BgvCandidatePortalInput): Promise<BgvPortalInitiationResult>;
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
    default:
      if (env.NODE_ENV === "production") {
        console.warn("[BGV] BGV_PROVIDER=mock in production — set BGV_PROVIDER=infinity_ai or digio for live verification.");
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
  luckpay_api_url?: string;
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
  const str = String(value ?? "").trim();
  if (!str || str === "••••••••") return undefined;
  return str;
}

async function loadBgvDbConfig(): Promise<BgvDbConfig | null> {
  const keys = [
    "bgv_provider",
    "infinity_ai_api_url", "infinity_ai_api_key", "infinity_ai_client_id", "infinity_ai_portal_url",
    "digio_api_url", "digio_client_id", "digio_client_secret",
    "digilocker_session_url", "digilocker_api_key", "digilocker_client_id",
    "befisc_api_url", "befisc_api_key",
    "luckpay_api_url", "luckpay_basic_token", "luckpay_client_id",
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
    return key ? { "x-api-key": key } : {};
  }

  private luckpayBaseUrl(): string {
    const baseUrl = this.cfg.luckpay_api_url?.trim();
    if (!baseUrl) throw new Error("Luckpay API Base URL is not configured in BGV settings");
    return baseUrl.replace(/\/$/, "");
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
    let res;
    try {
      res = await axios.post(authUrl, undefined, {
        headers: { Authorization: `Basic ${this.cfg.luckpay_basic_token}` },
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
      res = await axios.post(`${this.luckpayBaseUrl()}${path}`, payload, {
        headers: {
          Authorization: this.cfg.luckpay_client_id!,
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
    const matchedName = d.pan_name ?? d.name ?? d.full_name ?? null;
    return {
      status,
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.transaction_id ?? requestId),
      matchScore: roughNameMatchScore(input.candidateName, matchedName),
      matchedName,
      matchedDob: d.dob ?? null,
      resultSummary: d.message ?? `PAN check: ${status}`,
      riskFlags: status === "verified" ? [] : [String(d.failure_reason ?? "PAN_CHECK_FAILED").toUpperCase()],
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
    const apiStatus = String(d.status ?? d.result ?? "").toLowerCase();
    const matchedName = d.registered_name ?? d.account_holder_name ?? d.name ?? null;
    const score = roughNameMatchScore(input.accountHolderName ?? input.candidateName, matchedName);
    const status: VerificationStatus = ["valid", "verified", "success", "active"].includes(apiStatus)
      ? "verified"
      : apiStatus.includes("mismatch") || score < 60 ? "mismatch" : "failed";
    return {
      status,
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.utr ?? d.transaction_id ?? requestId),
      matchScore: score,
      matchedName,
      resultSummary: d.message ?? `Bank check: ${status}`,
      riskFlags: status === "verified" ? [] : [String(d.failure_reason ?? "BANK_CHECK_FAILED").toUpperCase()],
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
    const matchedName = d.name ?? d.member_name ?? d.full_name ?? null;
    const history = Array.isArray(d.employment_history) ? d.employment_history : Array.isArray(d.establishments) ? d.establishments : [];
    return {
      status,
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.transaction_id ?? requestId),
      matchScore: roughNameMatchScore(input.candidateName, matchedName),
      matchedName,
      resultSummary: d.message ?? `UAN/employment check: ${status}`,
      riskFlags: status === "verified" ? [] : [String(d.failure_reason ?? "UAN_CHECK_FAILED").toUpperCase()],
      raw: this.sanitizedRaw(d),
      employmentHistory: history,
    };
  }

  async verifyAadhaarOffline(input: AadhaarOfflineInput): Promise<VerificationResult> {
    const requestId = randomUUID();
    const d = await this.post(this.cfg.befisc_api_url, "/aadhaar/offline-verify", {
      request_id: requestId,
      document_id: input.documentId ?? undefined,
      aadhaar_last4: input.aadhaarLast4 ?? undefined,
      name: input.candidateName ?? undefined,
    }, this.apiKeyHeaders(this.cfg.befisc_api_key));
    const apiStatus = String(d.status ?? d.result ?? "").toLowerCase();
    const status: VerificationStatus = ["valid", "verified", "success"].includes(apiStatus)
      ? "verified"
      : ["pending", "manual_review", "review"].includes(apiStatus) ? "manual_review" : "failed";
    const matchedName = d.name ?? d.matched_name ?? null;
    return {
      status,
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.transaction_id ?? requestId),
      matchScore: roughNameMatchScore(input.candidateName, matchedName),
      matchedName,
      resultSummary: d.message ?? `Aadhaar check: ${status}`,
      riskFlags: status === "verified" ? [] : [String(d.failure_reason ?? "AADHAAR_CHECK_FAILED").toUpperCase()],
      raw: d,
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
    const d = await this.post(this.cfg.crimescan_api_url, "/court/verify", {
      request_id: requestId,
      name: input.candidateName,
      dob: input.dateOfBirth,
      father_name: input.fatherName ?? undefined,
      address: input.address ?? undefined,
      state: input.state ?? undefined,
      pincode: input.pincode ?? undefined,
    }, this.apiKeyHeaders(this.cfg.crimescan_api_key));
    const apiStatus = String(d.status ?? d.result ?? "").toLowerCase();
    const status: VerificationStatus = ["clear", "no_records", "verified", "success"].includes(apiStatus)
      ? "verified"
      : ["positive", "records_found", "failed"].includes(apiStatus) ? "failed" : "manual_review";
    const cases = Array.isArray(d.court_cases ?? d.cases) ? (d.court_cases ?? d.cases).map((c: Record<string, unknown>) => ({
      caseType: String(c.case_type ?? c.type ?? ""),
      caseNumber: String(c.case_number ?? c.number ?? ""),
      court: String(c.court_name ?? c.court ?? ""),
      year: Number(c.year ?? 0),
      status: String(c.status ?? ""),
    })) : null;
    return {
      status,
      providerKey: this.providerKey,
      providerRequestId: requestId,
      providerReferenceId: String(d.reference_id ?? d.transaction_id ?? requestId),
      matchScore: null,
      matchedName: input.candidateName,
      resultSummary: d.message ?? `Criminal/court check: ${status}`,
      riskFlags: cases?.length ? ["COURT_RECORDS_FOUND"] : [],
      courtCases: cases,
      raw: d,
    };
  }

  async startDigilocker(candidateId: string, requestedDocuments: string[]): Promise<DigilockerSession> {
    const state = randomUUID();
    const candidate = await this.getCandidateContact(candidateId);
    const d = await this.postLuckpay("/verifyDigilockerWithURL", {
      clientTransactionId: state,
      customerName: candidate.fullName,
      mobileNumber: candidate.mobile,
    });
    return {
      state: String(d.state ?? state),
      authUrl: String(d.auth_url ?? d.redirect_url ?? d.access_link ?? d.redirectUrl ?? d.verificationUrl ?? d.verification_url ?? ""),
      expiresAt: d.expires_at ? new Date(d.expires_at) : new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async initiateCandidateBgv(_input: BgvCandidatePortalInput): Promise<BgvPortalInitiationResult> {
    throw Object.assign(new Error("Hosted BGV portal is not configured for Befisc/Luckpay/Crimescan. Use individual onboarding checks."), { statusCode: 501 });
  }
}
