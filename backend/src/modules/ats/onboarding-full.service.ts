import { randomUUID, createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

type ActorType = "candidate" | "hr" | "system";

const hashValue = (value: unknown) => {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
};

const maskAadhaar = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `XXXX-XXXX-${digits.slice(-4)}`;
};

const maskPan = (value: unknown) => {
  const pan = String(value ?? "").trim().toUpperCase();
  if (!pan) return null;
  return `${pan.slice(0, 3)}XXXX${pan.slice(-2)}`;
};

const maskAccount = (value: unknown) => {
  const account = String(value ?? "").replace(/\s/g, "");
  if (!account) return null;
  return `XXXXXX${account.slice(-4)}`;
};

async function logCandidateAction(candidateId: string, actionType: string, payload?: unknown, meta?: { ip?: string; userAgent?: string; actorType?: ActorType; actorId?: string | null }) {
  await db.execute(
    `INSERT INTO candidate_onboarding_submission_log
       (id, candidate_id, action_type, action_by_type, action_by, action_payload, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      candidateId,
      actionType,
      meta?.actorType ?? "candidate",
      meta?.actorId ?? null,
      payload ? JSON.stringify(payload) : null,
      meta?.ip ?? null,
      meta?.userAgent ?? null,
    ]
  );
}

async function triggerBgvAfterOnboardingSubmit(candidateId: string, meta?: { ip?: string; userAgent?: string }) {
  const checkTypes = ["aadhaar", "digilocker", "pan", "court", "education_doc", "employment", "address"];
  for (const checkType of checkTypes) {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM candidate_bgv_check WHERE candidate_id = ? AND check_type = ? LIMIT 1`,
      [candidateId, checkType]
    );
    if (existing.length) continue;
    await db.execute(
      `INSERT INTO candidate_bgv_check
         (id, candidate_id, check_type, provider_key, status, result_summary, result_json)
       VALUES (?, ?, ?, 'system', 'pending', 'Auto-created after onboarding submit', CAST(? AS JSON))`,
      [randomUUID(), candidateId, checkType, JSON.stringify({ source: "onboarding_submit" })]
    );
  }

  await db.execute(
    `INSERT INTO candidate_bgv_report (id, candidate_id, overall_status, bgv_score, hr_remarks)
     VALUES (?, ?, 'in_progress', 0, 'Auto-triggered after onboarding profile submission')
     ON DUPLICATE KEY UPDATE overall_status = IF(overall_status = 'verified', overall_status, 'in_progress'), updated_at = NOW()`,
    [randomUUID(), candidateId]
  );

  await db.execute(
    `INSERT INTO candidate_bgv_verification_event
       (id, candidate_id, event_type, event_status, event_payload, actor_type, ip_address, user_agent)
     VALUES (?, ?, 'BGV_AUTO_TRIGGERED', 'in_progress', CAST(? AS JSON), 'system', ?, ?)`,
    [randomUUID(), candidateId, JSON.stringify({ checkTypes }), meta?.ip ?? null, meta?.userAgent ?? null]
  );
}

export async function validateOnboardingToken(token: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.candidate_id, b.onboarding_token_expires_at,
            c.id, c.candidate_code, c.full_name, c.mobile, c.email,
            c.gender, c.date_of_birth, c.applied_for_branch, c.applied_for_process,
            c.sourcing_channel, c.source_details, c.resume_url, c.selfie_url,
            c.profile_status, br.branch_name, pm.process_name
       FROM ats_onboarding_bridge b
       JOIN ats_candidate c ON c.id = b.candidate_id
       LEFT JOIN branch_master br ON br.id = c.applied_for_branch
       LEFT JOIN process_master pm ON pm.id = c.applied_for_process
      WHERE b.onboarding_token = ?
      LIMIT 1`,
    [token]
  );

  if (!rows.length) throw Object.assign(new Error("Invalid onboarding token"), { statusCode: 400 });
  const row = rows[0];
  if (new Date(row.onboarding_token_expires_at as string) < new Date()) {
    throw Object.assign(new Error("Onboarding token expired"), { statusCode: 410 });
  }

  const [profileRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
    [row.candidate_id]
  );

  return {
    candidate_id: row.candidate_id,
    candidate_code: row.candidate_code,
    full_name: row.full_name,
    mobile: row.mobile,
    email: row.email,
    gender: row.gender,
    date_of_birth: row.date_of_birth,
    branch_id: row.applied_for_branch,
    branch_name: row.branch_name,
    process_id: row.applied_for_process,
    process_name: row.process_name,
    source_type: row.sourcing_channel ?? null,
    source: row.source_details ?? row.sourcing_channel ?? null,
    resume_url: row.resume_url,
    selfie_url: row.selfie_url,
    profile_status: row.profile_status,
    saved_profile: profileRows[0] ?? null,
  };
}

export async function getFullOnboardingStatus(token: string) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;

  const [documents] = await db.execute<RowDataPacket[]>(
    `SELECT id, doc_type, doc_name, page_no, file_original_name, file_url, mime_type, file_size_bytes,
            document_status, verification_method, verification_ref, uploaded_at
       FROM candidate_onboarding_document
      WHERE candidate_id = ? AND deleted_at IS NULL
      ORDER BY uploaded_at DESC`,
    [candidateId]
  );
  const [bankRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_bank_detail WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  const [qualificationRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_qualification WHERE candidate_id = ? ORDER BY created_at DESC`,
    [candidateId]
  );
  const [familyRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_family WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  const [experienceRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_experience WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );

  return {
    token: tokenData,
    documents,
    bank: bankRows[0] ?? null,
    qualifications: qualificationRows,
    family: familyRows[0] ?? null,
    experience: experienceRows[0] ?? null,
  };
}

export async function saveEmployeeDetails(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  const id = randomUUID();
  const panMasked = maskPan(input.panNumber ?? input.pan_number ?? input.pan_number_masked);
  const panHash = hashValue(input.panNumber ?? input.pan_number);
  const aadhaarMasked = maskAadhaar(input.aadhaarNumber ?? input.aadhar_number ?? input.aadhaar_number);
  const aadhaarHash = hashValue(input.aadhaarNumber ?? input.aadhar_number ?? input.aadhaar_number);

  await db.execute(
    `INSERT INTO candidate_onboarding_profile
       (id, candidate_id, onboarding_token_hash, title, employee_name, relation, father_husband_name,
        gender, marital_status, date_of_birth, blood_group,
        nominee_name, nominee_relation, nominee_date_of_birth, nominee1_share_pct,
        nominee2_name, nominee2_relation, nominee2_dob, nominee2_share_pct,
        permanent_address, permanent_state, permanent_city, permanent_pincode,
        present_address, present_state, present_city, present_pincode, mobile_number, alt_mobile_number,
        personal_email_id, official_email_id, pan_number_masked, pan_number_hash, aadhaar_number_masked,
        aadhaar_number_hash, passport_no, driving_license_no,
        uan_number, epf_number, esic_number,
        source_type, source, profile_status,
        mother_name, emergency_contact_name, emergency_contact_relation, emergency_contact_mobile,
        nationality, religion, category, address_proof_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'employee_details_saved', ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        title = VALUES(title), employee_name = VALUES(employee_name), relation = VALUES(relation),
        father_husband_name = VALUES(father_husband_name), gender = VALUES(gender), marital_status = VALUES(marital_status),
        date_of_birth = VALUES(date_of_birth), blood_group = VALUES(blood_group),
        nominee_name = VALUES(nominee_name), nominee_relation = VALUES(nominee_relation),
        nominee_date_of_birth = VALUES(nominee_date_of_birth), nominee1_share_pct = VALUES(nominee1_share_pct),
        nominee2_name = VALUES(nominee2_name), nominee2_relation = VALUES(nominee2_relation),
        nominee2_dob = VALUES(nominee2_dob), nominee2_share_pct = VALUES(nominee2_share_pct),
        permanent_address = VALUES(permanent_address), permanent_state = VALUES(permanent_state), permanent_city = VALUES(permanent_city),
        permanent_pincode = VALUES(permanent_pincode), present_address = VALUES(present_address), present_state = VALUES(present_state),
        present_city = VALUES(present_city), present_pincode = VALUES(present_pincode), mobile_number = VALUES(mobile_number),
        alt_mobile_number = VALUES(alt_mobile_number), personal_email_id = VALUES(personal_email_id), official_email_id = VALUES(official_email_id),
        pan_number_masked = VALUES(pan_number_masked), pan_number_hash = VALUES(pan_number_hash),
        aadhaar_number_masked = VALUES(aadhaar_number_masked), aadhaar_number_hash = VALUES(aadhaar_number_hash),
        passport_no = VALUES(passport_no), driving_license_no = VALUES(driving_license_no),
        uan_number = VALUES(uan_number), epf_number = VALUES(epf_number), esic_number = VALUES(esic_number),
        source_type = VALUES(source_type), source = VALUES(source),
        mother_name = VALUES(mother_name), emergency_contact_name = VALUES(emergency_contact_name),
        emergency_contact_relation = VALUES(emergency_contact_relation), emergency_contact_mobile = VALUES(emergency_contact_mobile),
        nationality = VALUES(nationality), religion = VALUES(religion), category = VALUES(category),
        address_proof_type = VALUES(address_proof_type),
        profile_status = IF(profile_status='submitted', profile_status, 'employee_details_saved'), updated_at = NOW()`,
    [
      id,
      candidateId,
      hashValue(token),
      input.title ?? null,
      input.employeeName ?? tokenData.full_name ?? null,
      input.relation ?? null,
      input.fatherHusbandName ?? input.father_name ?? null,
      input.gender ?? tokenData.gender ?? null,
      input.maritalStatus ?? null,
      input.dateOfBirth ?? tokenData.date_of_birth ?? null,
      input.bloodGroup ?? null,
      input.nominee ?? input.nomineeName ?? null,
      input.nomineeRelation ?? null,
      input.nomineeDateOfBirth ?? null,
      input.nominee1SharePct ?? null,
      input.nominee2Name ?? null,
      input.nominee2Relation ?? null,
      input.nominee2Dob ?? null,
      input.nominee2SharePct ?? null,
      input.permanentAddress ?? null,
      input.permanentState ?? null,
      input.permanentCity ?? null,
      input.permanentPincode ?? null,
      input.presentAddress ?? input.current_address ?? null,
      input.presentState ?? null,
      input.presentCity ?? null,
      input.presentPincode ?? null,
      input.mobileNumber ?? tokenData.mobile ?? null,
      input.altMobileNumber ?? null,
      input.personalEmailId ?? tokenData.email ?? null,
      input.officialEmailId ?? null,
      panMasked,
      panHash,
      aadhaarMasked,
      aadhaarHash,
      input.passportNo ?? (input as any).passportNumber ?? (input as any).passport_number ?? null,
      input.drivingLicenseNo ?? (input as any).dlNumber ?? (input as any).dl_number ?? null,
      input.uanNumber ?? null,
      input.epfNumber ?? null,
      input.esicNumber ?? null,
      input.sourceType ?? tokenData.source_type ?? null,
      input.source ?? tokenData.source ?? null,
      input.motherName ?? null,
      input.emergencyContactName ?? null,
      input.emergencyContactRelation ?? null,
      input.emergencyContactMobile ?? null,
      input.nationality ?? 'Indian',
      input.religion ?? null,
      input.category ?? null,
      input.addressProofType ?? null,
    ]
  );

  await db.execute(
    `UPDATE ats_candidate SET
       title = ?, relation = ?, father_husband_name = ?, father_name = ?, gender = ?, marital_status = ?,
       date_of_birth = ?, blood_group = ?, nominee_name = ?, nominee_relation = ?, nominee_date_of_birth = ?,
       permanent_address = ?, permanent_state = ?, permanent_city = ?, permanent_pincode = ?,
       current_address = ?, present_state = ?, present_city = ?, present_pincode = ?, alt_mobile_number = ?,
       personal_email_id = ?, official_email_id = ?,
       pan_number = COALESCE(?, pan_number), pan_number_hash = COALESCE(?, pan_number_hash),
       aadhar_number = COALESCE(?, aadhar_number), aadhar_number_hash = COALESCE(?, aadhar_number_hash),
       source_type = ?, source = ?, profile_status = 'profile_in_progress', updated_at = NOW()
     WHERE id = ?`,
    [
      input.title ?? null,
      input.relation ?? null,
      input.fatherHusbandName ?? input.father_name ?? null,
      input.fatherHusbandName ?? input.father_name ?? null,
      input.gender ?? tokenData.gender ?? null,
      input.maritalStatus ?? null,
      input.dateOfBirth ?? tokenData.date_of_birth ?? null,
      input.bloodGroup ?? null,
      input.nominee ?? input.nomineeName ?? null,
      input.nomineeRelation ?? null,
      input.nomineeDateOfBirth ?? null,
      input.permanentAddress ?? null,
      input.permanentState ?? null,
      input.permanentCity ?? null,
      input.permanentPincode ?? null,
      input.presentAddress ?? input.current_address ?? null,
      input.presentState ?? null,
      input.presentCity ?? null,
      input.presentPincode ?? null,
      input.altMobileNumber ?? null,
      input.personalEmailId ?? tokenData.email ?? null,
      input.officialEmailId ?? null,
      panMasked,
      panHash,
      aadhaarMasked,
      aadhaarHash,
      input.sourceType ?? tokenData.source_type ?? null,
      input.source ?? tokenData.source ?? null,
      candidateId,
    ]
  );
  // Update extra identity/statutory fields on ats_candidate if columns exist
  // These are safe UPDATE SET with COALESCE to not overwrite non-null existing values
  await db.execute(
    `UPDATE ats_candidate SET
       passport_no = COALESCE(?, passport_no),
       driving_license_no = COALESCE(?, driving_license_no),
       uan_number = COALESCE(?, uan_number),
       epf_number = COALESCE(?, epf_number),
       esic_number = COALESCE(?, esic_number),
       updated_at = NOW()
     WHERE id = ?`,
    [
      input.passportNo ?? (input as any).passportNumber ?? (input as any).passport_number ?? null,
      input.drivingLicenseNo ?? (input as any).dlNumber ?? (input as any).dl_number ?? null,
      input.uanNumber ?? null,
      input.epfNumber ?? null,
      input.esicNumber ?? null,
      candidateId,
    ]
  ).catch(() => { /* columns may not exist on older schema — safe to ignore */ });

  await logCandidateAction(candidateId, "SAVE_EMPLOYEE_DETAILS", { fields: Object.keys(input) }, meta);
  return getFullOnboardingStatus(token);
}

export async function saveBankDetails(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  const accountNo = input.accountNo ?? input.bank_account_no ?? input.account_no;
  const id = randomUUID();

  await db.execute(
    `INSERT INTO candidate_onboarding_bank_detail
       (id, candidate_id, bank_name, branch_name, account_holder_name, account_no_masked,
        account_no_hash, ifsc_code, account_type, cancelled_cheque_document_id, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started')
     ON DUPLICATE KEY UPDATE
       bank_name = VALUES(bank_name), branch_name = VALUES(branch_name), account_holder_name = VALUES(account_holder_name),
       account_no_masked = VALUES(account_no_masked), account_no_hash = VALUES(account_no_hash), ifsc_code = VALUES(ifsc_code),
       account_type = VALUES(account_type), cancelled_cheque_document_id = VALUES(cancelled_cheque_document_id),
       updated_at = NOW()`,
    [
      id,
      candidateId,
      input.bankName ?? input.bank_name ?? null,
      input.branchName ?? null,
      input.accountHolderName ?? null,
      maskAccount(accountNo),
      hashValue(accountNo),
      String(input.ifscCode ?? input.bank_ifsc ?? "").trim().toUpperCase() || null,
      input.accountType ?? null,
      input.cancelledChequeDocumentId ?? null,
    ]
  );

  await db.execute(
    `UPDATE candidate_onboarding_profile SET profile_status = IF(profile_status='submitted', profile_status, 'bank_saved'), updated_at = NOW()
      WHERE candidate_id = ?`,
    [candidateId]
  );
  await db.execute(
    `UPDATE ats_candidate SET
       bank_name = ?,
       bank_ifsc = ?,
       bank_account_no = COALESCE(?, bank_account_no),
       bank_account_no_hash = COALESCE(?, bank_account_no_hash),
       updated_at = NOW()
     WHERE id = ?`,
    [
      input.bankName ?? input.bank_name ?? null,
      input.ifscCode ?? input.bank_ifsc ?? null,
      maskAccount(accountNo),
      hashValue(accountNo),
      candidateId,
    ]
  );

  // Cheque name validation: compare name_on_cheque against account_holder_name.
  // Mismatch is queued for Payroll HO review — onboarding is NEVER blocked.
  const nameOnCheque = String(input.nameOnCheque ?? input.name_on_cheque ?? '').trim();
  const accountHolderName = String(input.accountHolderName ?? '').trim();
  const chequeDocId = (input.cancelledChequeDocumentId ?? null) as string | null;

  if (nameOnCheque && accountHolderName) {
    const namesMatch = nameOnCheque.toLowerCase() === accountHolderName.toLowerCase();

    // Fetch the bank_detail row we just upserted
    const [bdRows] = await db.execute(
      `SELECT id FROM candidate_onboarding_bank_detail WHERE candidate_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [candidateId]
    );
    const bankDetailId = (bdRows as any[])[0]?.id ?? null;

    if (namesMatch) {
      await db.execute(
        `UPDATE candidate_onboarding_bank_detail SET name_validation_status = 'matched' WHERE id = ?`,
        [bankDetailId]
      );
    } else {
      // Insert mismatch record and route to Payroll HO queue
      const valId = randomUUID();
      await db.execute(
        `INSERT INTO cheque_name_validation
           (id, candidate_id, bank_detail_id, cheque_document_id, name_on_cheque, name_in_profile, match_status)
         VALUES (?, ?, ?, ?, ?, ?, 'mismatch')
         ON DUPLICATE KEY UPDATE
           name_on_cheque = VALUES(name_on_cheque), name_in_profile = VALUES(name_in_profile),
           match_status = 'mismatch', validated_by = NULL, validated_at = NULL`,
        [valId, candidateId, bankDetailId, chequeDocId, nameOnCheque, accountHolderName]
      );
      await db.execute(
        `UPDATE candidate_onboarding_bank_detail
            SET name_validation_status = 'pending_review', cheque_validation_id = ?
          WHERE id = ?`,
        [valId, bankDetailId]
      );
    }
  }

  await logCandidateAction(candidateId, "SAVE_BANK_DETAILS", { bankName: input.bankName ?? input.bank_name, ifsc: input.ifscCode ?? input.bank_ifsc }, meta);
  return getFullOnboardingStatus(token);
}

export async function addQualification(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  const id = randomUUID();
  await db.execute(
    `INSERT INTO candidate_onboarding_qualification
      (id, candidate_id, qualification, specialization_course_name, passed_out_year,
       passed_out_state, passed_out_city, passed_out_percentage, document_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      candidateId,
      input.qualification ?? null,
      input.specializationCourseName ?? input.specialization ?? null,
      input.passedOutYear ?? null,
      input.passedOutState ?? null,
      input.passedOutCity ?? null,
      input.passedOutPercentage ?? input.percentage ?? null,
      input.documentId ?? null,
    ]
  );
  await logCandidateAction(candidateId, "ADD_QUALIFICATION", input, meta);
  return getFullOnboardingStatus(token);
}

export async function saveFamilyDetails(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await db.execute(
    `INSERT INTO candidate_onboarding_family (id, candidate_id, annual_income, count_of_dependents)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE annual_income = VALUES(annual_income), count_of_dependents = VALUES(count_of_dependents), updated_at = NOW()`,
    [randomUUID(), candidateId, input.annualIncome ?? null, input.countOfDependents ?? null]
  );
  await logCandidateAction(candidateId, "SAVE_FAMILY_DETAILS", input, meta);
  return getFullOnboardingStatus(token);
}

export async function saveExperienceDetails(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await db.execute(
    `INSERT INTO candidate_onboarding_experience
       (id, candidate_id, working_experience, experience_year, experience_doc_type,
        experience_document_id, employer_name, last_designation, last_ctc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       working_experience = VALUES(working_experience), experience_year = VALUES(experience_year),
       experience_doc_type = VALUES(experience_doc_type), experience_document_id = VALUES(experience_document_id),
       employer_name = VALUES(employer_name), last_designation = VALUES(last_designation), last_ctc = VALUES(last_ctc), updated_at = NOW()`,
    [
      randomUUID(),
      candidateId,
      input.workingExperience ?? "fresher",
      input.experienceYear ?? null,
      input.experienceDocType ?? null,
      input.experienceDocumentId ?? null,
      input.employerName ?? null,
      input.lastDesignation ?? null,
      input.lastCtc ?? null,
    ]
  );
  await logCandidateAction(candidateId, "SAVE_EXPERIENCE_DETAILS", input, meta);
  return getFullOnboardingStatus(token);
}

export async function saveFinalSection(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await db.execute(
    `UPDATE candidate_onboarding_profile SET profile_status = IF(profile_status='submitted', profile_status, 'final_saved'), updated_at = NOW()
      WHERE candidate_id = ?`,
    [candidateId]
  );
  await logCandidateAction(candidateId, "SAVE_FINAL_SECTION", input, meta);
  return getFullOnboardingStatus(token);
}

export async function savePfOptOutConsent(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  await logCandidateAction((await validateOnboardingToken(token)).candidate_id as string, "SAVE_PF_OPT_OUT_CONSENT", input, meta);
  return saveStatutory(token, { ...input, pf_opt_out_consent: true });
}

export async function submitFullOnboarding(token: string, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;

  const [profileRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_name, mobile_number, personal_email_id, pan_number_hash, aadhaar_number_hash
       FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  if (!profileRows.length) throw Object.assign(new Error("Employee details are required before submit"), { statusCode: 400 });

  const [bankRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_onboarding_bank_detail WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  if (!bankRows.length) throw Object.assign(new Error("Bank details are required before submit"), { statusCode: 400 });

  await db.execute(
    `UPDATE candidate_onboarding_profile SET profile_status = 'submitted', submitted_at = NOW(), updated_at = NOW()
      WHERE candidate_id = ?`,
    [candidateId]
  );
  // Keep all three status tables in sync via syncOnboardingStatus
  await syncOnboardingStatus(candidateId, 'submitted', 'profile_submitted', 'profile_submitted');
  await db.execute(
    `UPDATE ats_candidate SET profile_submitted_at = NOW() WHERE id = ?`,
    [candidateId]
  );
  await db.execute(
    `INSERT INTO ats_candidate_stage_log
       (id, candidate_id, from_stage, to_stage, remarks, updated_by)
     VALUES (UUID(), ?, 'Onboarding Link Sent', 'Profile Submitted', 'Candidate completed onboarding profile', NULL)`,
    [candidateId]
  );
  await triggerBgvAfterOnboardingSubmit(candidateId, meta);
  await db.execute(
    `INSERT INTO ats_candidate_stage_log
       (id, candidate_id, from_stage, to_stage, remarks, updated_by)
     VALUES (UUID(), ?, 'Profile Submitted', 'BGV In Progress', 'BGV checks auto-created after onboarding profile submission', NULL)`,
    [candidateId]
  );
  await logCandidateAction(candidateId, "SUBMIT_ONBOARDING", null, meta);
  return { candidateId, status: "submitted" };
}

const MAGIC_BYTES: Record<string, Uint8Array[]> = {
  pdf: [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
  jpg: [new Uint8Array([0xFF, 0xD8, 0xFF])],
  jpeg: [new Uint8Array([0xFF, 0xD8, 0xFF])],
  png: [new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  webp: [new Uint8Array([0x52, 0x49, 0x46, 0x46]), new Uint8Array([0x57, 0x45, 0x42, 0x50])],
};

function validateFileMagicBytes(filePath: string, ext: string): boolean {
  const signatures = MAGIC_BYTES[ext.toLowerCase()];
  if (!signatures) return true;
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    if (bytesRead < signatures[0].length) return false;
    for (const sig of signatures) {
      if (sig.length > bytesRead) continue;
      const matches = sig.every((b, i) => buf[i] === b);
      if (matches) return true;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

export async function uploadOnboardingDocument(token: string, file: Express.Multer.File, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  if (!file) throw Object.assign(new Error("File is required"), { statusCode: 400 });
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;

  const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
  if (!validateFileMagicBytes(file.path, ext)) {
    fs.unlink(file.path, () => {});
    throw Object.assign(new Error("File content does not match its extension. Upload cancelled."), { statusCode: 400 });
  }

  const id = randomUUID();
  const fileUrl = `/uploads/onboarding/${file.filename}`;
  await db.execute(
    `INSERT INTO candidate_onboarding_document
       (id, candidate_id, doc_type, doc_name, page_no, file_original_name, file_path, file_url, mime_type, file_size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      candidateId,
      input.docType ?? input.doc_type ?? "Other",
      input.docName ?? input.doc_name ?? file.originalname,
      input.pageNo ?? input.page_no ?? null,
      file.originalname,
      file.path,
      fileUrl,
      file.mimetype,
      file.size,
    ]
  );
  await logCandidateAction(candidateId, "UPLOAD_DOCUMENT", { documentId: id, docType: input.docType ?? input.doc_type }, meta);
  return { id, fileUrl };
}

export async function getOnboardingDocument(documentId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_document WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [documentId]
  );
  return (rows as RowDataPacket[])[0] ?? null;
}

export async function deleteOnboardingDocument(token: string, documentId: string, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await db.execute(
    `UPDATE candidate_onboarding_document
        SET document_status = 'deleted', deleted_at = NOW(), deleted_by = NULL
      WHERE id = ? AND candidate_id = ?`,
    [documentId, candidateId]
  );
  await logCandidateAction(candidateId, "DELETE_DOCUMENT", { documentId }, meta);
  return getFullOnboardingStatus(token);
}

export async function listFullOnboardingRequests(branchId?: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.*, c.candidate_code, c.full_name, c.mobile, c.email,
            br.branch_name, pm.process_name,
            bank.verification_status AS bank_verification_status,
            COUNT(doc.id) AS documents_uploaded
       FROM candidate_onboarding_profile p
       JOIN ats_candidate c ON c.id = p.candidate_id
       LEFT JOIN branch_master br ON br.id = c.applied_for_branch
       LEFT JOIN process_master pm ON pm.id = c.applied_for_process
       LEFT JOIN candidate_onboarding_bank_detail bank ON bank.candidate_id = p.candidate_id
       LEFT JOIN candidate_onboarding_document doc ON doc.candidate_id = p.candidate_id AND doc.deleted_at IS NULL
      WHERE (? IS NULL OR c.applied_for_branch = ?)
      GROUP BY p.id, c.candidate_code, c.full_name, c.mobile, c.email, br.branch_name, pm.process_name, bank.verification_status
      ORDER BY p.updated_at DESC`,
    [branchId ?? null, branchId ?? null]
  );
  return rows;
}

export async function getFullOnboardingByCandidate(candidateId: string) {
  const [profileRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [documents] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_document WHERE candidate_id = ? AND deleted_at IS NULL ORDER BY uploaded_at DESC`, [candidateId]);
  const [bankRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_bank_detail WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [qualificationRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_qualification WHERE candidate_id = ? ORDER BY created_at DESC`, [candidateId]);
  const [familyRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_family WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [experienceRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_experience WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  return { profile: profileRows[0] ?? null, documents, bank: bankRows[0] ?? null, qualifications: qualificationRows, family: familyRows[0] ?? null, experience: experienceRows[0] ?? null };
}

export async function reviewFullOnboarding(candidateId: string, input: { status: "approved" | "rejected" | "hr_review"; remarks?: string }, reviewedBy: string) {
  const dbStatus = input.status === "approved" ? "approved" : input.status === "rejected" ? "rejected" : "hr_review";

  const requestStatusMap: Record<string, string> = {
    approved: "approved",
    rejected: "rejected",
    hr_review: "in_progress",
  };
  const candidateStatusMap: Record<string, string> = {
    approved: "approved",
    rejected: "rejected",
    hr_review: "profile_submitted",
  };

  await syncOnboardingStatus(candidateId, dbStatus, requestStatusMap[input.status] ?? "in_progress", candidateStatusMap[input.status] ?? "profile_submitted");
  await logCandidateAction(candidateId, "HR_REVIEW", input, { actorType: "hr", actorId: reviewedBy });

  if (input.status === "rejected" && input.remarks) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, review_remarks FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`, [candidateId]
    );
    if ((rows as RowDataPacket[]).length > 0) {
      await db.execute(
        `UPDATE candidate_onboarding_profile SET review_remarks = ?, updated_at = NOW() WHERE candidate_id = ?`,
        [input.remarks, candidateId]
      );
    }
  }

  return getFullOnboardingByCandidate(candidateId);
}

export async function payrollReviewFullOnboarding(candidateId: string, input: { status: "approved" | "rejected"; remarks?: string }, reviewedBy: string) {
  const dbStatus = input.status === "approved" ? "approved" : "rejected";
  await syncOnboardingStatus(candidateId, dbStatus,
    input.status === "approved" ? "approved" : "rejected",
    input.status === "approved" ? "approved" : "rejected"
  );
  await logCandidateAction(candidateId, "PAYROLL_REVIEW", input, { actorType: "hr", actorId: reviewedBy });
  return getFullOnboardingByCandidate(candidateId);
}

export async function checkBgvReadiness(candidateId: string): Promise<{ ready: boolean; missing: string[]; score: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT check_type, status FROM candidate_bgv_check WHERE candidate_id = ?`, [candidateId]
  );
  const checks = rows as RowDataPacket[];
  const mandatoryChecks = ["pan", "aadhaar_offline", "bank", "address_doc", "education_doc", "employment", "criminal"];
  const missing: string[] = [];

  let score = 0;
  let verifiedCount = 0;

  for (const required of mandatoryChecks) {
    const match = checks.find((c: any) => c.check_type === required);
    if (!match || match.status === "not_started" || match.status === "failed") {
      missing.push(required);
    } else if (match.status === "verified" || match.status === "waived") {
      verifiedCount++;
    }
  }

  score = mandatoryChecks.length > 0 ? Math.round((verifiedCount / mandatoryChecks.length) * 100) : 0;

  return {
    ready: missing.length === 0 && verifiedCount >= 3,
    missing,
    score,
  };
}

// Single source-of-truth sync: keeps ats_candidate, ats_onboarding_request, and
// candidate_onboarding_profile aligned after each major status transition.
export async function syncOnboardingStatus(
  candidateId: string,
  profileStatus: string,
  requestStatus: string,
  candidateProfileStatus: string
) {
  await db.execute(
    `UPDATE ats_candidate SET profile_status = ?, updated_at = NOW() WHERE id = ?`,
    [candidateProfileStatus, candidateId]
  );
  await db.execute(
    `UPDATE ats_onboarding_request SET status = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [requestStatus, candidateId]
  );
  await db.execute(
    `UPDATE candidate_onboarding_profile SET profile_status = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [profileStatus, candidateId]
  );
}

export async function recordPrivacyConsent(token: string) {
  const { candidate_id } = await validateOnboardingToken(token);
  await db.execute(
    `UPDATE candidate_onboarding_profile SET dpdp_consent = 1, dpdp_consent_at = NOW(), updated_at = NOW() WHERE candidate_id = ?`,
    [candidate_id]
  );
  await logCandidateAction(candidate_id, "PRIVACY_CONSENT", null, { actorType: "candidate" });
  return { candidateId: candidate_id, consented: true };
}

export async function saveLanguages(
  token: string,
  languages: Array<{ language_name: string; can_read?: boolean; can_write?: boolean; can_speak?: boolean; proficiency?: string }>
) {
  const { candidate_id } = await validateOnboardingToken(token);
  if (!Array.isArray(languages) || languages.length === 0) return { deleted: 0, inserted: 0 };
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [del] = await conn.execute(`DELETE FROM candidate_onboarding_language WHERE candidate_id = ?`, [candidate_id]);
    for (const lang of languages) {
      if (!lang.language_name?.trim()) continue;
      await conn.execute(
        `INSERT INTO candidate_onboarding_language (id, candidate_id, language_name, can_read, can_write, can_speak, proficiency)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
        [candidate_id, lang.language_name.trim(), lang.can_read ? 1 : 0, lang.can_write ? 1 : 0, lang.can_speak ? 1 : 0, lang.proficiency ?? null]
      );
    }
    await conn.commit();
    return { candidateId: candidate_id, deleted: (del as any).affectedRows ?? 0, inserted: languages.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function saveStatutory(token: string, input: Record<string, unknown>) {
  const { candidate_id } = await validateOnboardingToken(token);
  await db.execute(
    `UPDATE candidate_onboarding_profile SET
       eps_member = ?, international_worker = ?, previous_pf_member = ?,
       statutory_declaration_accepted = ?, statutory_declaration_at = IF(? = 1, NOW(), NULL),
       updated_at = NOW()
     WHERE candidate_id = ?`,
    [
      input.epsMember != null ? (input.epsMember ? 1 : 0) : null,
      input.internationalWorker ? 1 : 0,
      input.previousPfMember != null ? (input.previousPfMember ? 1 : 0) : null,
      input.declarationAccepted ? 1 : 0,
      input.declarationAccepted ? 1 : 0,
      candidate_id,
    ]
  );
  return { candidateId: candidate_id, saved: true };
}

export async function saveProgress(token: string, stepIdx: number) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  const idx = Math.max(0, Math.min(10, Math.floor(stepIdx)));
  await db.execute(
    `UPDATE candidate_onboarding_profile SET current_step_idx = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [idx, candidateId]
  );
  return { candidateId, currentStepIdx: idx };
}

// ── New functions added by migration 298 ─────────────────────────────────────

export async function saveFamilyMembers(
  token: string,
  members: Array<{
    memberName?: string;
    relation?: string;
    dob?: string;
    occupation?: string;
    isDependent?: boolean;
  }>
) {
  const { candidate_id } = await validateOnboardingToken(token);
  if (!Array.isArray(members)) throw Object.assign(new Error("members must be an array"), { statusCode: 400 });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM candidate_onboarding_family_member WHERE candidate_id = ?`, [candidate_id]);
    for (const m of members) {
      await conn.execute(
        `INSERT INTO candidate_onboarding_family_member
           (id, candidate_id, member_name, relation, dob, occupation, is_dependent)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
        [
          candidate_id,
          m.memberName ?? null,
          m.relation ?? null,
          m.dob ?? null,
          m.occupation ?? null,
          m.isDependent ? 1 : 0,
        ]
      );
    }
    await conn.commit();
    return { candidateId: candidate_id, inserted: members.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function saveNominees(
  token: string,
  nominees: Array<{
    nomineeName?: string;
    relation?: string;
    dob?: string;
    sharePercentage?: number;
    aadharLast4?: string;
    isPrimary?: boolean;
  }>
) {
  const { candidate_id } = await validateOnboardingToken(token);
  if (!Array.isArray(nominees)) throw Object.assign(new Error("nominees must be an array"), { statusCode: 400 });

  const total = nominees.reduce((sum, n) => sum + (Number(n.sharePercentage) || 0), 0);
  if (total > 100) {
    throw Object.assign(
      new Error(`Total nominee share percentage is ${total}% which exceeds 100%`),
      { statusCode: 400 }
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM candidate_onboarding_nominee WHERE candidate_id = ?`, [candidate_id]);
    for (const n of nominees) {
      await conn.execute(
        `INSERT INTO candidate_onboarding_nominee
           (id, candidate_id, nominee_name, relation, dob, share_percentage, aadhar_last4, is_primary)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
        [
          candidate_id,
          n.nomineeName ?? null,
          n.relation ?? null,
          n.dob ?? null,
          n.sharePercentage != null ? n.sharePercentage : null,
          n.aadharLast4 ?? null,
          n.isPrimary ? 1 : 0,
        ]
      );
    }
    await conn.commit();
    return { candidateId: candidate_id, inserted: nominees.length, totalSharePct: total };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function updateSectionStatus(
  candidateId: string,
  section: string,
  isComplete: boolean
) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO candidate_onboarding_section_status
       (id, candidate_id, section, is_complete, completed_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_complete = VALUES(is_complete),
       completed_at = IF(VALUES(is_complete) = 1 AND completed_at IS NULL, NOW(), completed_at),
       last_updated = NOW()`,
    [id, candidateId, section, isComplete ? 1 : 0, isComplete ? new Date() : null]
  );
  return { candidateId, section, isComplete };
}

export async function getOnboardingBlockers(
  candidateId: string
): Promise<Array<{ code: string; message: string; severity: "hard" | "soft" }>> {
  const blockers: Array<{ code: string; message: string; severity: "hard" | "soft" }> = [];

  const [profileRows] = await db.execute<RowDataPacket[]>(
    `SELECT otp_verified, statutory_declaration_accepted, dpdp_consent, bgv_consent
       FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  const profile = profileRows[0] as any ?? {};

  if (!profile.otp_verified) {
    blockers.push({ code: "OTP_NOT_VERIFIED", message: "Mobile OTP verification is required before submission.", severity: "hard" });
  }
  if (!profile.statutory_declaration_accepted) {
    blockers.push({ code: "DECLARATION_NOT_ACCEPTED", message: "Statutory declaration must be accepted before submission.", severity: "hard" });
  }
  if (!profile.dpdp_consent) {
    blockers.push({ code: "DPDP_CONSENT_MISSING", message: "DPDP data privacy consent is required.", severity: "hard" });
  }

  const [bankRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_onboarding_bank_detail WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  if (!bankRows.length) {
    blockers.push({ code: "BANK_DETAILS_MISSING", message: "Bank account details must be saved before submission.", severity: "hard" });
  }

  const [qualRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_onboarding_qualification WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  if (!qualRows.length) {
    blockers.push({ code: "QUALIFICATION_MISSING", message: "At least one qualification record is recommended.", severity: "soft" });
  }

  if (!profile.bgv_consent) {
    blockers.push({ code: "BGV_CONSENT_MISSING", message: "BGV consent is recommended for faster background verification.", severity: "soft" });
  }

  return blockers;
}
