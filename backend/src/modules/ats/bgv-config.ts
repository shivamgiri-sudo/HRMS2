/**
 * BGV Configuration - Role-Based Requirements
 *
 * Defines which BGV checks are mandatory/optional for each designation
 * Based on business rules confirmed 2026-07-16
 */

export interface BgvRequirements {
  pan: boolean;              // PAN verification via Luckpay
  aadhaar: boolean;          // Aadhaar verification via Befisc
  bank: boolean;             // Bank account penny drop via Luckpay
  uan_employment: boolean;   // UAN/employment history via Luckpay
  criminal: boolean;         // Criminal record via Crimescan
  aml: boolean;              // AML verification via Prescreening
  documents: boolean;        // Mandatory document upload
}

export interface MandatoryDocuments {
  pan_card: boolean;
  aadhaar_card: boolean;
  bank_proof: boolean;
  photo: boolean;
  educational_certificates: boolean;
  address_proof: boolean;
  previous_employment_letters: boolean; // Only for laterals
}

/**
 * Role-based BGV requirements matrix
 * Key: designation name pattern (case-insensitive)
 */
export const BGV_REQUIREMENTS_BY_ROLE: Record<string, BgvRequirements> = {
  // Entry-level roles (Telecaller, Agent, Associate)
  'telecaller': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: false,
    criminal: false,
    aml: false,
    documents: true,
  },
  'agent': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: false,
    criminal: false,
    aml: false,
    documents: true,
  },
  'associate': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: false,
    criminal: false,
    aml: false,
    documents: true,
  },

  // Team Leaders
  'team leader': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: false,
    aml: false,
    documents: true,
  },
  'tl': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: false,
    aml: false,
    documents: true,
  },

  // Quality & Training
  'quality analyst': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: false,
    aml: false,
    documents: true,
  },
  'qa': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: false,
    aml: false,
    documents: true,
  },
  'trainer': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: false,
    aml: false,
    documents: true,
  },

  // Management roles (Process Manager, Operations Manager)
  'process manager': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: false,
    documents: true,
  },
  'operations manager': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: false,
    documents: true,
  },
  'manager': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: false,
    documents: true,
  },

  // Finance & Payroll (highest risk)
  'finance': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: true,
    documents: true,
  },
  'payroll': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: true,
    documents: true,
  },
  'accounts': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: true,
    documents: true,
  },

  // HR & Recruitment
  'hr': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: false,
    documents: true,
  },
  'recruitment': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: false,
    documents: true,
  },

  // IT & Admin
  'it': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: false,
    documents: true,
  },
  'admin': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: false,
    criminal: false,
    aml: false,
    documents: true,
  },

  // Senior Management (Branch Head, Directors)
  'branch head': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: true,
    documents: true,
  },
  'director': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: true,
    documents: true,
  },
  'head': {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: true,
    documents: true,
  },
};

/**
 * Mandatory documents for all roles (comprehensive list)
 */
export const MANDATORY_DOCUMENTS: MandatoryDocuments = {
  pan_card: true,
  aadhaar_card: true,
  bank_proof: true,
  photo: true,
  educational_certificates: true,
  address_proof: true,
  previous_employment_letters: true, // Will check if lateral hire
};

/**
 * Document type mappings to database enum values
 */
export const DOCUMENT_TYPE_MAPPINGS = {
  pan_card: ['pan_card', 'pan'],
  aadhaar_card: ['aadhaar_card', 'aadhaar', 'aadhar_card'],
  bank_proof: ['bank_statement', 'cancelled_cheque', 'passbook'],
  photo: ['passport_photo', 'photo'],
  educational_certificates: ['10th_certificate', '12th_certificate', 'degree_certificate', 'diploma'],
  address_proof: ['address_proof', 'utility_bill', 'rental_agreement'],
  previous_employment_letters: ['experience_letter', 'relieving_letter', 'appointment_letter'],
};

/**
 * Get BGV requirements for a designation
 */
export function getBgvRequirementsByDesignation(designationName: string): BgvRequirements {
  const normalized = designationName.toLowerCase().trim();

  // Direct match
  if (BGV_REQUIREMENTS_BY_ROLE[normalized]) {
    return BGV_REQUIREMENTS_BY_ROLE[normalized];
  }

  // Pattern matching for partial matches
  for (const [key, requirements] of Object.entries(BGV_REQUIREMENTS_BY_ROLE)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return requirements;
    }
  }

  // Default: Most restrictive (assume high-risk if unknown)
  console.warn(`[BGV] Unknown designation: ${designationName}, applying default high-risk requirements`);
  return {
    pan: true,
    aadhaar: true,
    bank: true,
    uan_employment: true,
    criminal: true,
    aml: false,
    documents: true,
  };
}

/**
 * Check if candidate is lateral hire (has previous employment)
 */
export function isLateralHire(candidateData: {
  fresher?: boolean | string | null;
  total_experience_years?: number | null;
  previous_company?: string | null;
}): boolean {
  // Explicit fresher flag
  if (candidateData.fresher === true || candidateData.fresher === 'yes' || candidateData.fresher === '1') {
    return false;
  }

  // Has experience
  if (candidateData.total_experience_years && candidateData.total_experience_years > 0) {
    return true;
  }

  // Has previous company mentioned
  if (candidateData.previous_company && candidateData.previous_company.trim().length > 0) {
    return true;
  }

  // Default: assume fresher (previous employment letters not mandatory)
  return false;
}

/**
 * PAN validation regex
 */
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Aadhaar validation regex (12 digits)
 */
export const AADHAAR_REGEX = /^[0-9]{12}$/;

/**
 * UAN validation regex (12 digits)
 */
export const UAN_REGEX = /^[0-9]{12}$/;
