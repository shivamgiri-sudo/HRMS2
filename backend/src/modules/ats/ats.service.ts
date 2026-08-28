import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { sendSelectedEmail, sendRejectedEmail, sendSelectionLetterOfIntent } from "./ats.email.service.js";
import { sendOnboardingToken } from "./ats.onboarding.service.js";
import { transitionCandidateState } from "./ats.status-machine.js";
import { hasScopedAccess } from "../../shared/scopeAccess.js";
import { excludeEmployeeShapedCandidatesSql } from "./ats-reporting-scope.js";
import { JOINED_STAGE_PREDICATE } from "./analytics.unified.service.js";
import { toStoredNameRequired } from "../../shared/nameFormat.js";
import { stripCryptoPlumbing } from "../../shared/cryptoColumnHygiene.js";
import { maskPii } from "../../shared/piiMask.js";
import type {
  AtsCandidate,
  AtsCandidateStageLog,
  AtsOnboardingBridge,
  AtsSourcingChannel,
  CandidateListFilters,
  CreateCandidateInput,
  CreateOnboardingBridgeInput,
  PaginatedResult,
} from "./ats.types.js";

function candidateCode(): string {
  return `CND-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * ats_candidate raw statutory/bank identifier columns, with the mask shape each needs.
 *
 * Same denylist this codebase already applies to the `employees` table (see
 * shared/employeeIdentifierRedaction.ts's IDENTIFIER_FIELDS) — bank_ifsc and uan_number are
 * included alongside aadhaar/PAN/bank account for the same reason that module gives: an
 * account number is far less useful to an attacker without the IFSC that names its bank, and
 * a UAN is a standing statutory identifier, not a per-session token.
 *
 * listCandidates (GET /api/ats/candidates, up to 500 rows/page, open to admin/hr/recruiter/
 * manager/super_admin) used to return these in the clear via `SELECT c.*` — no consumer reads
 * the raw value: NativeATSCandidateMaster.tsx renders from this same response without ever
 * referencing aadhar_number/pan_number/bank_account_no, and getCandidate (the single-record
 * view) never selected these columns to begin with. Masking here brings the list in line with
 * the detail view instead of being the one place raw values still leak.
 */
const CANDIDATE_RAW_IDENTIFIER_FIELDS: Record<string, Parameters<typeof maskPii>[1]> = {
  aadhar_number: "aadhaar",
  pan_number: "pan",
  uan_number: "bank_account",
  bank_account_no: "bank_account",
  bank_ifsc: "bank_account",
};

/**
 * Strip at-rest crypto plumbing (aadhar_number_hash, pan_number_hash, bank_account_no_hash,
 * *_encrypted — never safe in any API response, see cryptoColumnHygiene.ts) and mask the raw
 * identifier columns above. The pre-computed *_masked columns already on ats_candidate pass
 * through untouched — they are the safe rendering these list rows should have carried all along.
 */
function sanitizeCandidateListRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const stripped = stripCryptoPlumbing(row);
  for (const [key, maskType] of Object.entries(CANDIDATE_RAW_IDENTIFIER_FIELDS)) {
    const value = stripped[key];
    if (value != null && String(value).trim() !== "") {
      stripped[key] = maskPii(String(value), maskType);
    }
  }
  return stripped;
}

/** Normalize sourcing channel to canonical values */
function normalizeSourceChannel(channel: string | null | undefined): string | null {
  if (!channel) return null;
  const normalized = channel.trim().toLowerCase();
  const mapping: Record<string, string> = {
    "walk-in": "Walk-In",
    "walkin": "Walk-In",
    "walk_in": "Walk-In",
    "employee-referral": "Employee Referral",
    "employee referral": "Employee Referral",
    "job-portal": "Job Portal",
    "job portal": "Job Portal",
    "social-media": "Social Media",
    "social media": "Social Media",
  };
  return mapping[normalized] || channel; // Return normalized or original if no match
}

export const atsService = {
  async listCandidates(filters: CandidateListFilters): Promise<PaginatedResult<AtsCandidate>> {
    const conds: string[] = ["active_status = 1"];
    const params: unknown[] = [];
    // The grid and the dashboard tile above it are built from the same table and used to
    // disagree by ~5x: getDashboardStats excluded the 29,926 legacy employee records and this
    // did not. Excluded by default, with an explicit opt-in, because those rows are still the
    // only way to find an ex-employee when checking a rehire.
    if (!filters.includeFormerEmployees) {
      // Both queries this WHERE feeds — listCandidates and its COUNT — are FROM ats_candidate c,
      // and MySQL rejects the original table name once an alias exists. Passing the literal name
      // here emitted ats_candidate.record_type against a query aliased c, so every candidate list
      // 500d with ER_BAD_FIELD_ERROR. The helper documents that this argument must be the alias.
      conds.push(excludeEmployeeShapedCandidatesSql("c"));
    }
    if (filters.stage)    { conds.push("current_stage = ?");         params.push(filters.stage); }
    if (filters.branch)   { conds.push("applied_for_branch = ?");   params.push(filters.branch); }
    if (filters.process)  { conds.push("applied_for_process = ?");  params.push(filters.process); }
    if (filters.sourcingChannel) { conds.push("sourcing_channel = ?"); params.push(filters.sourcingChannel); }
    if (filters.search) {
      conds.push("(full_name LIKE ? OR mobile LIKE ? OR candidate_code LIKE ?)");
      const search = `%${filters.search}%`;
      params.push(search, search, search);
    }
    if (filters.fromDate) { conds.push("walk_in_date >= ?"); params.push(filters.fromDate); }
    if (filters.toDate)   { conds.push("walk_in_date <= ?"); params.push(filters.toDate); }

    // Apply scope filter from middleware
    const scopedFilters = filters as CandidateListFilters & { scopeFilter?: { sql?: string; params?: unknown[] } };
    if (scopedFilters.scopeFilter) {
      // scopeFilter is {sql: string, params: unknown[]} from buildScopeWhereClause
      if (typeof scopedFilters.scopeFilter === 'object' && scopedFilters.scopeFilter.sql) {
        const { sql, params: scopeParams } = scopedFilters.scopeFilter;
        if (sql === "1=0") {
          // User has no access - return empty result immediately
          return { data: [], total: 0, page: filters.page, limit: filters.limit };
        }
        if (sql && sql !== "1=1") {
          // Add scope filter SQL (already without WHERE prefix)
          conds.push(`(${sql})`);
          // Merge scope params into main params array
          params.push(...(scopeParams || []));
        }
        // If sql === "1=1", user has full access - no additional filter needed
      }
    }

    const where = `WHERE ${conds.join(" AND ")}`;

    const offset = (filters.page - 1) * filters.limit;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT c.*,
              scores.assessment_percentage,
              scores.typing_net_wpm
       FROM ats_candidate c
       LEFT JOIN (
         SELECT aca.candidate_id,
                MAX(aca.percentage) AS assessment_percentage,
                MAX(ata.net_wpm)    AS typing_net_wpm
         FROM ats_candidate_assessment aca
         LEFT JOIN ats_typing_test_attempt ata ON ata.assessment_id = aca.id
         GROUP BY aca.candidate_id
       ) scores ON scores.candidate_id = c.id
       ${where} ORDER BY c.created_at DESC LIMIT ${filters.limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ats_candidate c ${where}`,
      params
    );
    const sanitizedRows = (rows as RowDataPacket[]).map((row) => sanitizeCandidateListRow(row));
    return { data: sanitizedRows as unknown as AtsCandidate[], total: Number(countRows[0]?.total ?? 0), page: filters.page, limit: filters.limit };
  },

  async getCandidate(id: string): Promise<AtsCandidate> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, candidate_code, full_name, mobile, email, gender,
              date_of_birth, current_stage, applied_for_process, applied_for_branch,
              sourcing_channel, referred_by, walk_in_date, remarks, active_status,
              created_at, updated_at
       FROM ats_candidate WHERE id = ? LIMIT 1`, [id]);
    const candidate = (rows as AtsCandidate[])[0];
    // statusCode makes this a 404 rather than a 500. Without it the error
    // handler treats an ordinary missing row as a server fault, which is what
    // made POST /api/ats/onboarding/send-token/:candidateId answer
    // "An unexpected server error occurred" for a candidate that simply does
    // not exist — the same for all ten callers of this method. Matches the
    // Object.assign idiom already used across ats.onboarding.service.
    if (!candidate) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });
    return candidate;
  },

  async createCandidate(input: CreateCandidateInput, userId: string | null): Promise<AtsCandidate> {
    // Duplicate detection, restored. 2885092d added mobile-stage messaging and the
    // whole email branch ("enforce registration fields, email duplicate check,
    // reprocess detection"); a later whole-tree commit reduced this to a single
    // mobile check with no status handling, and the tests asserting the rest went
    // red rather than the loss being noticed. Against production that let 1,283
    // duplicate-email candidate rows accumulate across 1,123 addresses.
    // Mobile duplicates, but only for a value that is actually a mobile number.
    //
    // Same class of gap as the email guard below, confirmed live: a single-digit
    // placeholder mobile value is shared by 539 ats_candidate rows and 1,284
    // employees rows (729,994-row collision when joined on mobile). Checking every
    // stored value verbatim means one recruiter's placeholder blocks the next 538
    // candidates who share it as "already registered".
    const isRealMobile = /^[6-9]\d{9}$/.test(String(input.mobile ?? "").trim());
    const [dupMobile] = isRealMobile
      ? await db.execute<RowDataPacket[]>(
          "SELECT id, current_stage, active_status FROM ats_candidate WHERE mobile = ? LIMIT 1",
          [input.mobile]
        )
      : [[] as RowDataPacket[]];
    if ((dupMobile as RowDataPacket[]).length > 0) {
      const existing = (dupMobile as RowDataPacket[])[0];
      const stage = String(existing.current_stage ?? "");
      if (stage === "Rejected") {
        const err = new Error("This mobile belongs to a previously rejected candidate. Please contact HR to reprocess.");
        (err as any).statusCode = 409;
        (err as any).code = "DUPLICATE_REJECTED";
        throw err;
      }
      if (stage === "Selected" || stage === "converted") {
        const err = new Error("This mobile belongs to a candidate who was already selected.");
        (err as any).statusCode = 409;
        (err as any).code = "DUPLICATE_SELECTED";
        throw err;
      }
      const err = new Error("This mobile is already registered");
      (err as any).statusCode = 409;
      (err as any).code = "DUPLICATE_MOBILE";
      throw err;
    }

    // Email duplicates, but only for an address that is actually an address.
    //
    // This guard is new, and deliberate. 14,246 of 33,856 production candidates
    // carry no usable email — "0" alone appears 1,576 times, alongside "AN",
    // "abc@gmail.com" and shared @teammas.in inboxes. Recruiters evidently use
    // placeholders where a candidate has no email, so checking every non-empty
    // value would reject those registrations outright and break intake. The
    // original check had no such guard; restoring it verbatim would have.
    const email = String(input.email ?? "").trim();
    const isRealAddress = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    if (isRealAddress) {
      const [dupEmail] = await db.execute<RowDataPacket[]>(
        "SELECT id, current_stage FROM ats_candidate WHERE email = ? LIMIT 1",
        [email]
      );
      if ((dupEmail as RowDataPacket[]).length > 0) {
        const existing = (dupEmail as RowDataPacket[])[0];
        const stage = String(existing.current_stage ?? "");
        if (stage === "Rejected") {
          const err = new Error("This email belongs to a previously rejected candidate. Please contact HR to reprocess.");
          (err as any).statusCode = 409;
          (err as any).code = "DUPLICATE_EMAIL_REJECTED";
          throw err;
        }
        const err = new Error("This email is already registered");
        (err as any).statusCode = 409;
        (err as any).code = "DUPLICATE_EMAIL";
        throw err;
      }
    }

    // Normalize sourcing channel before insert
    const normalizedChannel = normalizeSourceChannel(input.sourcingChannel);

    const id = randomUUID();
    await db.execute(
      `INSERT INTO ats_candidate
         (id, candidate_code, full_name, mobile, email, gender, date_of_birth, applied_for_process,
          applied_for_branch, sourcing_channel, referred_by, walk_in_date, remarks, created_by,
          address, education, experience, rotational_shift, preferred_shift, night_shift_ok,
          leaves_in_3months, owns_two_wheeler, id_proof_available, education_proof_available,
          recruiter_name, profile_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, candidateCode(), toStoredNameRequired(input.fullName), input.mobile, input.email ?? null, input.gender ?? null,
       input.dateOfBirth ?? null, input.appliedForProcess ?? null, input.appliedForBranch ?? null,
       normalizedChannel, input.referredBy ?? null, input.walkInDate ?? null, input.remarks ?? null, userId,
       input.address ?? null, input.education ?? null, input.experience ?? null,
       input.rotationalShift ?? null, input.preferredShift ?? null, input.nightShiftOk ?? null,
       input.leavesIn3months ?? null, input.ownsTwoWheeler ?? null, input.idProofAvailable ?? null,
       input.educationProofAvailable ?? null, input.recruiterName ?? null, input.profileStatus ?? 'registered']
    );
    return this.getCandidate(id);
  },

  async updateCandidate(id: string, input: Partial<CreateCandidateInput>, _userId: string): Promise<AtsCandidate> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const fields: Array<[keyof CreateCandidateInput, string]> = [
      ["fullName", "full_name"], ["email", "email"], ["gender", "gender"], ["dateOfBirth", "date_of_birth"],
      ["appliedForProcess", "applied_for_process"], ["appliedForBranch", "applied_for_branch"],
      ["sourcingChannel", "sourcing_channel"], ["referredBy", "referred_by"], ["walkInDate", "walk_in_date"], ["remarks", "remarks"],
    ];
    fields.forEach(([key, column]) => {
      if (input[key] !== undefined) {
        // Normalize sourcing channel if being updated; names are always stored uppercase.
        const value = key === "sourcingChannel"
          ? normalizeSourceChannel(input[key] as string)
          : key === "fullName"
          ? toStoredNameRequired(input[key] as string)
          : (input[key] ?? null);
        sets.push(`${column} = ?`);
        params.push(value);
      }
    });
    if (sets.length) {
      params.push(id);
      await db.execute(`UPDATE ats_candidate SET ${sets.join(", ")} WHERE id = ?`, params);
    }
    return this.getCandidate(id);
  },

  async moveStage(candidateId: string, toStage: string, userId: string, remarks?: string): Promise<AtsCandidate> {
    const candidate = await this.getCandidate(candidateId);

    // Enforce state-machine transitions
    const result = await transitionCandidateState(candidateId, toStage, userId, remarks);
    if (!result.success) {
      const err = new Error(result.message) as Error & { status?: number };
      err.status = 422;
      throw err;
    }

    // Fire email side-effects after the stage is committed — failure must not break the stage move
    if ((toStage === 'Selected' || toStage === 'selected') && candidate.email) {
      // Fetch complete selection data for professional Letter of Intent
      const [selectionData] = await db.execute<RowDataPacket[]>(
        `SELECT
           c.full_name, c.email, c.role_applied,
           c.recruiter_assigned_name, c.recruiter_name, c.recruiter_email, c.recruiter_mobile,
           b.branch_name,
           ob.joining_date,
           isub.offer_doj, isub.reporting_timing, isub.offer_salary,
           isub.ot_details, isub.performance_incentives,
           COALESCE(c.offer_salary, isub.offer_salary) AS final_offer_salary
         FROM ats_candidate c
         LEFT JOIN branch_master b
           ON b.id = c.applied_for_branch
           OR b.branch_name = c.applied_for_branch
           OR b.branch_code = c.applied_for_branch
         LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
         LEFT JOIN ats_interview_submission isub ON isub.candidate_id = c.id
         WHERE c.id = ? AND c.active_status = 1
         LIMIT 1`,
        [candidateId]
      );

      if (selectionData.length > 0) {
        const data = selectionData[0];
        const baseUrl = env.FRONTEND_URL || 'http://localhost:5173';
        const onboardingLink = `${baseUrl}/onboard-full?candidate=${candidateId}`;

        // Format date if available (DD MMM YYYY format)
        let formattedDate: string | null = null;
        const rawDate = data.offer_doj ?? data.joining_date;
        if (rawDate) {
          try {
            const date = new Date(rawDate);
            formattedDate = date.toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric'
            });
          } catch {
            formattedDate = String(rawDate);
          }
        }

        // Format salary if available
        const salaryStructure = data.final_offer_salary
          ? `₹${Number(data.final_offer_salary).toLocaleString('en-IN')} per month`
          : null;

        sendSelectionLetterOfIntent({
          candidateId,
          to: candidate.email,
          candidateName: data.full_name ?? candidate.full_name ?? '',
          roleOffered: data.role_applied ?? 'Team Member',
          branchName: data.branch_name ?? candidate.applied_for_branch ?? '',
          dateOfJoining: formattedDate,
          reportingTiming: data.reporting_timing ?? null,
          salaryStructure,
          otDetails: data.ot_details ?? null,
          performanceIncentives: data.performance_incentives ?? null,
          onboardingLink,
          recruiterName: data.recruiter_assigned_name ?? data.recruiter_name ?? null,
          recruiterMobile: data.recruiter_mobile ?? null,
          recruiterEmail: data.recruiter_email ?? null,
        }).catch(() => { /* already logged in ats_email_log */ });
      }

      // Still send onboarding token (separate technical email with secure token)
      sendOnboardingToken(candidateId, userId).catch(() => {});
    } else if ((toStage === 'Rejected' || toStage === 'rejected') && candidate.email) {
      sendRejectedEmail({
        candidateId,
        to: candidate.email,
        candidateName: candidate.full_name ?? '',
        branchName: candidate.applied_for_branch ?? '',
      }).catch(() => { /* already logged in ats_email_log */ });
    }

    return this.getCandidate(candidateId);
  },

  async listStageLogs(candidateId: string): Promise<AtsCandidateStageLog[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM ats_candidate_stage_log WHERE candidate_id = ? ORDER BY stage_date DESC",
      [candidateId]
    );
    return rows as AtsCandidateStageLog[];
  },

  async createOnboardingBridge(
    input: CreateOnboardingBridgeInput,
    userId: string
  ): Promise<AtsOnboardingBridge> {
    const candidate = await this.getCandidate(input.candidateId);
    const allowed = await hasScopedAccess(userId, ["admin", "hr"], { branchId: candidate.applied_for_branch ?? undefined, processId: candidate.applied_for_process ?? undefined }, { allowAdminBypass: true });
    if (!allowed) throw Object.assign(new Error("Access denied"), { statusCode: 403 });
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM ats_onboarding_bridge WHERE candidate_id = ? LIMIT 1",
      [input.candidateId]
    );
    if ((existing as RowDataPacket[]).length > 0) throw new Error("Onboarding bridge already exists for this candidate");

    const id = randomUUID();
    await db.execute(
      `INSERT INTO ats_onboarding_bridge
         (id, candidate_id, bridge_date, offer_letter_url, joining_date, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [id, input.candidateId, input.bridgeDate, input.offerLetterUrl ?? null, input.joiningDate ?? null, input.notes ?? null, userId]
    );
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM ats_onboarding_bridge WHERE id = ? LIMIT 1", [id]);
    return (rows as AtsOnboardingBridge[])[0];
  },

  async updateOnboardingBridge(
    id: string,
    input: { employeeId?: string | null; joiningDate?: string | null; status?: string; offerLetterUrl?: string | null; notes?: string | null },
    userId: string
  ): Promise<AtsOnboardingBridge> {
    const [bridgeRows] = await db.execute<RowDataPacket[]>("SELECT candidate_id FROM ats_onboarding_bridge WHERE id = ? LIMIT 1", [id]);
    const bridge = (bridgeRows as RowDataPacket[])[0];
    if (!bridge) throw Object.assign(new Error("Onboarding bridge not found"), { statusCode: 404 });
    const candidate = await this.getCandidate(bridge.candidate_id as string);
    const allowed = await hasScopedAccess(userId, ["admin", "hr"], { branchId: candidate.applied_for_branch ?? undefined, processId: candidate.applied_for_process ?? undefined }, { allowAdminBypass: true });
    if (!allowed) throw Object.assign(new Error("Access denied"), { statusCode: 403 });
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.employeeId     !== undefined) { sets.push("employee_id = ?");      params.push(input.employeeId ?? null); }
    if (input.joiningDate    !== undefined) { sets.push("joining_date = ?");     params.push(input.joiningDate ?? null); }
    if (input.status         !== undefined) { sets.push("status = ?");           params.push(input.status); }
    if (input.offerLetterUrl !== undefined) { sets.push("offer_letter_url = ?"); params.push(input.offerLetterUrl ?? null); }
    if (input.notes          !== undefined) { sets.push("notes = ?");            params.push(input.notes ?? null); }
    if (sets.length > 0) {
      params.push(id);
      await db.execute(`UPDATE ats_onboarding_bridge SET ${sets.join(", ")} WHERE id = ?`, params);
    }
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM ats_onboarding_bridge WHERE id = ? LIMIT 1", [id]);
    const rec = (rows as AtsOnboardingBridge[])[0];
    if (!rec) throw new Error("Onboarding bridge not found");
    return rec;
  },

  async listSourcingChannels(): Promise<AtsSourcingChannel[]> {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM ats_sourcing_channel WHERE active_status = 1 ORDER BY channel_name ASC");
    return rows as AtsSourcingChannel[];
  },

  async getDashboardStats(filters: { fromDate?: string; toDate?: string; branch?: string; process?: string }) {
    const conds: string[] = ["active_status = 1", excludeEmployeeShapedCandidatesSql("ats_candidate")];
    const params: unknown[] = [];
    if (filters.fromDate) { conds.push("walk_in_date >= ?"); params.push(filters.fromDate); }
    if (filters.toDate)   { conds.push("walk_in_date <= ?"); params.push(filters.toDate); }
    if (filters.branch)   { conds.push("applied_for_branch = ?"); params.push(filters.branch); }
    if (filters.process)  { conds.push("applied_for_process = ?"); params.push(filters.process); }
    const where = `WHERE ${conds.join(" AND ")}`;

    /**
     * Branch/process only, without the date window.
     *
     * The four sub-queries below each hardcoded their own WHERE and passed [], so they ignored
     * the caller's branch and process entirely: a branch-filtered dashboard rendered a GLOBAL
     * time-to-hire and a GLOBAL open-positions count beside branch-filtered stage counts, on
     * one screen. Their own date windows are deliberate (30/60-day trends), so only the scope
     * filters carry across.
     */
    const scopeConds: string[] = [];
    const scopeParams: unknown[] = [];
    if (filters.branch)  { scopeConds.push("applied_for_branch = ?");  scopeParams.push(filters.branch); }
    if (filters.process) { scopeConds.push("applied_for_process = ?"); scopeParams.push(filters.process); }
    const scopeSql = scopeConds.length ? ` AND ${scopeConds.join(" AND ")}` : "";

    const [stageRows] = await db.execute<RowDataPacket[]>(
      `SELECT current_stage, COUNT(*) AS count FROM ats_candidate ${where} GROUP BY current_stage`, params
    );
    const [total] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ats_candidate ${where}`, params
    );
    const [sourceRows] = await db.execute<RowDataPacket[]>(
      `SELECT sourcing_channel, COUNT(*) AS count FROM ats_candidate ${where} GROUP BY sourcing_channel`, params
    );
    // Was `current_stage IN ('converted','Onboarded','Selected')` — a second, hand-copied
    // stage list that had drifted from the one in analytics.unified.service.ts: it missed
    // 'payroll_validated' (undercounting — 3 of 6 live conversions invisible) and wrongly
    // included 'Selected', an offer/selection stage that has not necessarily joined, on a
    // card labelled "Conversion Rate". Verified live 2026-08-28: the old query returned 3,
    // the corrected one 6. Not a case-sensitivity fix — current_stage is utf8mb4_unicode_ci,
    // already case-insensitive; confirmed 'converted','Onboarded','Selected' and
    // 'converted','onboarded','selected' returned the identical count before this change.
    const [convRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM ats_candidate ${where} AND ${JOINED_STAGE_PREDICATE}`, params
    );
    // Approximate time-to-hire using updated_at as proxy for converted candidates.
    // Was `current_stage = 'converted'` only — narrower than the conversion-rate count
    // right above it, so the two cards on this page could describe different populations.
    // Broadened to the same predicate so "how many converted" and "how long it took" agree
    // on who counts as converted.
    const [timeRows] = await db.execute<RowDataPacket[]>(
      `SELECT AVG(DATEDIFF(updated_at, created_at)) AS avg_days
         FROM ats_candidate
        WHERE active_status = 1 AND ${JOINED_STAGE_PREDICATE} AND ${excludeEmployeeShapedCandidatesSql("ats_candidate")}${scopeSql}`, scopeParams
    );

    const totalCount = Number(total[0]?.total ?? 0);
    const convertedCount = Number(convRows[0]?.cnt ?? 0);

    // Build by_stage as Record<string, number> keyed by stage name
    const by_stage: Record<string, number> = {};
    for (const row of stageRows as { current_stage: string; count: number }[]) {
      by_stage[row.current_stage] = Number(row.count);
    }

    // Build by_source as Record<string, number>
    const by_source: Record<string, number> = {};
    for (const row of sourceRows as { sourcing_channel: string | null; count: number }[]) {
      const key = row.sourcing_channel ?? "unknown";
      by_source[key] = Number(row.count);
    }

    // Open positions from job_requisition: sum of unfilled headcount on approved, active requisitions.
    // Previously counted DISTINCT applied_for_process from ats_candidate (pipeline proxy), which
    // returned the number of processes that had any active candidate — not the actual open
    // headcount demand.
    const [openPosRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(GREATEST(requested_headcount - fulfilled_headcount, 0)), 0) AS count
       FROM job_requisition
       WHERE approval_status = 'approved'
         AND active_status = 1
         AND closed_at IS NULL`
    ).catch(() => [[{ count: 0 }]] as any);
    const openPositions = Number(openPosRows[0]?.count ?? 0);

    // Selected candidates (last 30 days)
    const selectedCount = (by_stage["selected"] ?? 0) + (by_stage["Selected"] ?? 0) +
      (by_stage["Onboarded"] ?? 0) + (by_stage["converted"] ?? 0);
    // Previous 30 days for trend comparison (selected)
    const [prevRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM ats_candidate
       WHERE active_status = 1
         AND current_stage IN ('selected','Selected','Onboarded','converted')
         AND updated_at >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
         AND updated_at < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         AND ${excludeEmployeeShapedCandidatesSql("ats_candidate")}${scopeSql}`,
      scopeParams
    ).catch((err: unknown) => {
      // Same treatment as the onboarding trend below: a swallowed failure here reads as a
      // real zero on a selection trend tile, and "zero selections in the prior 30 days"
      // is indistinguishable from a genuine hiring freeze. Log it, and return null rather
      // than 0 so the tile renders as unknown instead of asserting a number nobody measured.
      console.warn("[ats-stats] previous-30-day selected trend failed:", (err as Error).message);
      return [[{ cnt: null }]] as any;
    });

    // Previous 30 days for onboarding submitted trend (HR dashboard)
    const [prevSubmittedRows] = await db.execute<RowDataPacket[]>(
      // Three separate defects, all masked by the .catch below returning a confident 0:
      //   bridge_status  -> the column is `status`
      //   'submitted'    -> the real values are pending / profile_submitted / joined
      //   updated_at     -> ats_onboarding_bridge has no such column. The pattern was copied
      //                     from the ats_candidate query above, where updated_at does exist.
      // created_at is a proxy for "when it was submitted" — the table records no submitted_at,
      // so this counts bridges CREATED in the window that have reached profile_submitted.
      // Against production this returns 2 for the previous-30-day window, not 0.
      `SELECT COUNT(*) AS cnt FROM ats_onboarding_bridge
       WHERE status = 'profile_submitted'
         AND created_at >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
         AND created_at < DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      []
    ).catch((err: unknown) => {
      // Keep the dashboard up, but never silently again: a swallowed query here reads as a
      // real zero on an HR trend tile, which is how the above survived unnoticed.
      // null, not 0. Its two siblings above already return null on failure precisely so a
      // broken lookup cannot read as a measured zero; this one still asserted "0 submitted in
      // the prior 30 days", which is indistinguishable from a genuine standstill.
      console.warn("[ats-stats] onboarding submitted trend failed:", (err as Error).message);
      return [[{ cnt: null }]] as any;
    });

    // The Super Admin approval queue renders `pending_requisitions`, and nothing has
    // ever produced it — the field appeared in exactly one place in the repo, the line
    // that read it, so the row was a permanent em dash.
    //
    // job_requisition.approval_status holds draft / approved / closed. "Pending" is a
    // requisition still awaiting approval: raised but neither approved nor closed.
    // null on failure, so a broken lookup cannot read as an empty queue.
    const [pendingReqRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM job_requisition
        WHERE LOWER(COALESCE(approval_status, 'draft')) NOT IN ('approved', 'closed', 'rejected')`
    ).catch(() => [[{ cnt: null }]] as any);

    return {
      total_candidates: totalCount,
      by_stage,
      by_source,
      conversion_rate: totalCount > 0 ? Math.round((convertedCount / totalCount) * 1000) / 10 : 0,
      time_to_hire_avg: Number(timeRows[0]?.avg_days ?? 0),
      open_positions: openPositions,
      selected_candidates: selectedCount,
      // null, not 0, when the lookup failed — see the catch above. Same contract as
      // pending_requisitions below: unknown renders as unknown, never as a measured zero.
      previous_selected: prevRows[0]?.cnt == null ? null : Number(prevRows[0].cnt),
      previous_submitted: Number(prevSubmittedRows[0]?.cnt ?? 0),
      pending_requisitions: pendingReqRows[0]?.cnt == null ? null : Number(pendingReqRows[0].cnt),
    };
  },

  async listOnboardingBridges(scopeFilter?: { sql?: string; params?: unknown[]; branchId?: string; processId?: string }): Promise<RowDataPacket[]> {
    let where = "1=1";
    const params: unknown[] = [];
    if (scopeFilter?.sql) {
      where += ` AND (${scopeFilter.sql})`;
      params.push(...(scopeFilter.params ?? []));
    }
    if (scopeFilter?.branchId) { where += " AND c.applied_for_branch = ?"; params.push(scopeFilter.branchId); }
    if (scopeFilter?.processId) { where += " AND c.applied_for_process = ?"; params.push(scopeFilter.processId); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ob.id,
              ob.candidate_id,
              c.candidate_code,
              c.full_name,
              c.mobile,
              c.email,
              COALESCE(b_uuid.id, b_name.id) AS branch_id,
              COALESCE(b_uuid.branch_name, b_name.branch_name, c.branch_display_name, c.branch_text, c.applied_for_branch, '-') AS branch_name,
              COALESCE(c.role_applied, p.process_name, c.process_text, c.applied_for_process, '-') AS role_applied,
              COALESCE(c.recruiter_assigned_name, c.recruiter_name, '') AS recruiter_name,
              COALESCE(c.status, c.current_stage, ob.status, 'Waiting') AS status,
              c.current_stage AS latest_stage,
              c.final_decision AS latest_decision,
              COALESCE(p.process_name, c.process_text, c.applied_for_process) AS latest_process,
              c.profile_status,
              c.profile_status AS onboarding_profile_status,
              c.offer_status AS request_status,
              c.offer_status,
              c.offer_doj,
              c.offer_salary,
              ob.employee_id,
              c.employee_code,
              ob.status AS bridge_status,
              ob.bridge_date,
              ob.joining_date,
              c.current_stage,
              (SELECT verification_status FROM ats_bgv_verification WHERE candidate_id = c.id ORDER BY created_at DESC LIMIT 1) AS bgv_status,
              (SELECT overall_match_status FROM candidate_name_match_summary WHERE candidate_id = c.id LIMIT 1) AS name_status,
              (SELECT validation_status FROM ats_payroll_hr_validation WHERE candidate_id = c.id LIMIT 1) AS payroll_hr_status,
              ob.created_at
       FROM ats_onboarding_bridge ob
       JOIN ats_candidate c ON c.id = ob.candidate_id
       LEFT JOIN branch_master b_uuid ON b_uuid.id = c.applied_for_branch
       LEFT JOIN branch_master b_name ON b_uuid.id IS NULL AND LOWER(b_name.branch_name) = LOWER(c.applied_for_branch)
       LEFT JOIN process_master p ON p.id = c.applied_for_process
       WHERE ${where}
       ORDER BY ob.created_at DESC`,
      params
    );
    return Array.isArray(rows) ? rows : [];
  },
};
