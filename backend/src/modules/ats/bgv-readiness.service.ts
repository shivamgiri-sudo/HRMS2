/**
 * BGV Readiness Validation Service
 *
 * Validates if BGV checks meet requirements before employee creation
 * Supports role-based requirements and manual review workflow
 */

import { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getBgvRequirementsByDesignation, BgvRequirements, isLateralHire, DOCUMENT_TYPE_MAPPINGS } from './bgv-config.js';

export interface BgvCheck {
  check_type: string;
  provider_key: string | null;
  status: string;
  verified_at: string | null;
  is_auto_approved: number;
  result_summary: string | null;
}

export interface BgvReport {
  overall_status: string;
  bgv_score: number;
  is_auto_approved: number;
  hr_remarks: string | null;
}

export interface BgvReadinessResult {
  ready: boolean;
  blockers: Array<{
    check_type: string;
    reason: string;
    severity: 'critical' | 'warning';
  }>;
  warnings: string[];
  requirements: BgvRequirements;
  checksCompleted: string[];
  checksPending: string[];
  manualReviewRequired: boolean;
}

/**
 * Check if BGV is ready for employee creation based on role requirements
 */
export async function checkBgvReadiness(
  candidateId: string,
  designationId: string
): Promise<BgvReadinessResult> {
  // Get designation name to determine requirements
  const [designationRows] = await db.execute<RowDataPacket[]>(
    `SELECT designation_name FROM designation_master WHERE id = ? LIMIT 1`,
    [designationId]
  );

  const designationName = (designationRows[0] as any)?.designation_name ?? 'Unknown';
  const requirements = getBgvRequirementsByDesignation(designationName);

  // Get candidate data to check if lateral hire
  const [candidateRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       c.fresher,
       p.total_experience_years,
       p.previous_company
     FROM ats_candidate c
     LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
     WHERE c.id = ? LIMIT 1`,
    [candidateId]
  );
  const candidateData = candidateRows[0] as any;
  const lateral = isLateralHire(candidateData);

  // Get BGV checks
  const [checks] = await db.execute<RowDataPacket[]>(
    `SELECT
       check_type,
       provider_key,
       status,
       verified_at,
       is_auto_approved,
       result_summary
     FROM candidate_bgv_check
     WHERE candidate_id = ?`,
    [candidateId]
  );

  // Get BGV report
  const [reportRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       overall_status,
       bgv_score,
       is_auto_approved,
       hr_remarks
     FROM candidate_bgv_report
     WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );

  const report = reportRows[0] as BgvReport | undefined;
  const bgvChecks = checks as BgvCheck[];

  // Validate each required check
  const blockers: BgvReadinessResult['blockers'] = [];
  const warnings: string[] = [];
  const checksCompleted: string[] = [];
  const checksPending: string[] = [];
  let manualReviewRequired = false;

  // Check PAN
  if (requirements.pan) {
    const panCheck = bgvChecks.find(c => c.check_type === 'pan');
    if (!panCheck || panCheck.status !== 'verified') {
      blockers.push({
        check_type: 'pan',
        reason: 'PAN verification not completed',
        severity: 'critical',
      });
      checksPending.push('pan');
    } else if (panCheck.is_auto_approved === 1) {
      warnings.push('PAN verification was auto-approved - real verification recommended');
      manualReviewRequired = true;
      checksCompleted.push('pan');
    } else {
      checksCompleted.push('pan');
    }
  }

  // Check Aadhaar
  if (requirements.aadhaar) {
    const aadhaarCheck = bgvChecks.find(c => c.check_type === 'aadhaar_offline' || c.check_type === 'aadhaar');
    if (!aadhaarCheck || aadhaarCheck.status !== 'verified') {
      blockers.push({
        check_type: 'aadhaar',
        reason: 'Aadhaar verification not completed',
        severity: 'critical',
      });
      checksPending.push('aadhaar');
    } else if (aadhaarCheck.is_auto_approved === 1) {
      warnings.push('Aadhaar verification was auto-approved - real verification recommended');
      manualReviewRequired = true;
      checksCompleted.push('aadhaar');
    } else {
      checksCompleted.push('aadhaar');
    }
  }

  // Check Bank Account
  if (requirements.bank) {
    const bankCheck = bgvChecks.find(c => c.check_type === 'bank');
    if (!bankCheck || bankCheck.status !== 'verified') {
      blockers.push({
        check_type: 'bank',
        reason: 'Bank account verification not completed',
        severity: 'critical',
      });
      checksPending.push('bank');
    } else if (bankCheck.is_auto_approved === 1) {
      warnings.push('Bank verification was auto-approved - penny drop recommended');
      manualReviewRequired = true;
      checksCompleted.push('bank');
    } else {
      checksCompleted.push('bank');
    }
  }

  // Check UAN/Employment (optional for freshers)
  if (requirements.uan_employment) {
    const uanCheck = bgvChecks.find(c => c.check_type === 'employment');
    if (!uanCheck || uanCheck.status !== 'verified') {
      if (lateral) {
        // Mandatory for lateral hires
        blockers.push({
          check_type: 'employment',
          reason: 'Employment history verification required for lateral hires',
          severity: 'critical',
        });
        checksPending.push('employment');
      } else {
        // Warning only for freshers
        warnings.push('Employment history not verified (acceptable for freshers)');
        checksPending.push('employment');
      }
    } else {
      checksCompleted.push('employment');
    }
  }

  // Check Criminal Record
  if (requirements.criminal) {
    const criminalCheck = bgvChecks.find(c => c.check_type === 'criminal');
    if (!criminalCheck || criminalCheck.status !== 'verified') {
      blockers.push({
        check_type: 'criminal',
        reason: 'Criminal record check required for this role',
        severity: 'critical',
      });
      checksPending.push('criminal');
    } else {
      checksCompleted.push('criminal');
    }
  }

  // Check AML
  if (requirements.aml) {
    // AML not in standard checks, check in separate verification
    // For now, mark as warning if not found
    warnings.push('AML verification required for finance/senior roles - verify manually');
    manualReviewRequired = true;
  }

  // Check mandatory documents
  if (requirements.documents) {
    const documentBlockers = await checkMandatoryDocuments(candidateId, lateral);
    blockers.push(...documentBlockers);
  }

  // Check overall BGV report
  if (report) {
    if (report.is_auto_approved === 1) {
      warnings.push('BGV report was auto-approved - manual review required');
      manualReviewRequired = true;
    }

    if (report.overall_status === 'negative') {
      blockers.push({
        check_type: 'overall',
        reason: 'BGV report marked as negative',
        severity: 'critical',
      });
    } else if (report.overall_status === 'refer') {
      warnings.push('BGV report marked for manual review');
      manualReviewRequired = true;
    }
  }

  // Determine readiness
  // Employee creation proceeds even with blockers (manual review workflow)
  // But we return blockers for HR visibility
  const ready = blockers.filter(b => b.severity === 'critical').length === 0;

  return {
    ready,
    blockers,
    warnings,
    requirements,
    checksCompleted,
    checksPending,
    manualReviewRequired,
  };
}

/**
 * Check if mandatory documents are uploaded
 */
async function checkMandatoryDocuments(
  candidateId: string,
  isLateral: boolean
): Promise<Array<{ check_type: string; reason: string; severity: 'critical' | 'warning' }>> {
  const blockers: Array<{ check_type: string; reason: string; severity: 'critical' | 'warning' }> = [];

  // Get uploaded documents
  const [docs] = await db.execute<RowDataPacket[]>(
    `SELECT document_type, file_url
     FROM ats_candidate_documents
     WHERE candidate_id = ? AND deleted_at IS NULL`,
    [candidateId]
  );

  const uploadedTypes = new Set((docs as any[]).map(d => d.document_type?.toLowerCase()));

  // Check PAN card
  if (!hasDocumentType(uploadedTypes, DOCUMENT_TYPE_MAPPINGS.pan_card)) {
    blockers.push({
      check_type: 'document_pan',
      reason: 'PAN card not uploaded',
      severity: 'critical',
    });
  }

  // Check Aadhaar card
  if (!hasDocumentType(uploadedTypes, DOCUMENT_TYPE_MAPPINGS.aadhaar_card)) {
    blockers.push({
      check_type: 'document_aadhaar',
      reason: 'Aadhaar card not uploaded',
      severity: 'critical',
    });
  }

  // Check Bank proof
  if (!hasDocumentType(uploadedTypes, DOCUMENT_TYPE_MAPPINGS.bank_proof)) {
    blockers.push({
      check_type: 'document_bank',
      reason: 'Bank statement/cancelled cheque not uploaded',
      severity: 'critical',
    });
  }

  // Check Photo
  if (!hasDocumentType(uploadedTypes, DOCUMENT_TYPE_MAPPINGS.photo)) {
    blockers.push({
      check_type: 'document_photo',
      reason: 'Passport-size photo not uploaded',
      severity: 'critical',
    });
  }

  // Check Educational certificates
  if (!hasDocumentType(uploadedTypes, DOCUMENT_TYPE_MAPPINGS.educational_certificates)) {
    blockers.push({
      check_type: 'document_education',
      reason: 'Educational certificates not uploaded',
      severity: 'critical',
    });
  }

  // Check Address proof
  if (!hasDocumentType(uploadedTypes, DOCUMENT_TYPE_MAPPINGS.address_proof)) {
    blockers.push({
      check_type: 'document_address',
      reason: 'Address proof not uploaded',
      severity: 'critical',
    });
  }

  // Check Previous employment letters (only for laterals)
  if (isLateral && !hasDocumentType(uploadedTypes, DOCUMENT_TYPE_MAPPINGS.previous_employment_letters)) {
    blockers.push({
      check_type: 'document_employment',
      reason: 'Previous employment letters required for lateral hires',
      severity: 'critical',
    });
  }

  return blockers;
}

/**
 * Helper to check if document type exists in uploaded set
 */
function hasDocumentType(uploadedTypes: Set<string>, validTypes: string[]): boolean {
  for (const type of validTypes) {
    if (uploadedTypes.has(type.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Get human-readable BGV readiness summary
 */
export function getBgvReadinessSummary(result: BgvReadinessResult): string {
  if (result.ready && result.blockers.length === 0 && result.warnings.length === 0) {
    return 'BGV checks complete and verified';
  }

  if (result.manualReviewRequired) {
    return `Manual BGV review required: ${result.warnings.join(', ')}`;
  }

  if (result.blockers.length > 0) {
    const criticalCount = result.blockers.filter(b => b.severity === 'critical').length;
    return `${criticalCount} critical BGV checks pending: ${result.blockers.map(b => b.check_type).join(', ')}`;
  }

  return 'BGV in progress';
}
