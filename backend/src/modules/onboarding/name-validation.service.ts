// Cross-check names across all onboarding sections
// Flags mismatches for manual Payroll HQ review

export interface NameValidationResult {
  isValid: boolean;
  matches: {
    profileName: { value: string; source: string };
    fatherHusbandName: { value: string; source: string };
    accountHolderName: { value: string; source: string };
    nomineeName?: { value: string; source: string };
    chequeHolderName?: { value: string; source: string };
  };
  mismatches: Array<{
    field1: string;
    field2: string;
    value1: string;
    value2: string;
    score: number;
  }>;
  summary: string;
  flagForReview: boolean;
  reviewReason?: string;
}

export class NameValidationService {
  /**
   * Normalize name: lowercase, trim, remove special chars
   */
  static normalizeName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .replace(/\s+/g, " ");
  }

  /**
   * Calculate name match score (0-100)
   * Uses word overlap + Levenshtein distance
   */
  static calculateNameMatch(name1: string, name2: string): number {
    const n1 = this.normalizeName(name1);
    const n2 = this.normalizeName(name2);

    if (!n1 || !n2) return 0;
    if (n1 === n2) return 100;

    const words1 = new Set(n1.split(/\s+/));
    const words2 = new Set(n2.split(/\s+/));

    const common = [...words1].filter((w) => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;

    const wordScore = (common / union) * 100;

    // Levenshtein-based penalty for very different lengths
    const lenPenalty = Math.abs(n1.length - n2.length) * 2;
    const finalScore = Math.max(0, wordScore - lenPenalty);

    return Math.round(finalScore);
  }

  /**
   * Validate names across all onboarding sections
   */
  static validateAllNames(data: {
    employee_name?: string;
    father_husband_name?: string;
    account_holder_name?: string;
    nominee_name?: string;
    name_on_cheque?: string;
  }): NameValidationResult {
    const matches = {
      profileName: { value: data.employee_name ?? "", source: "Profile (Section 1)" },
      fatherHusbandName: { value: data.father_husband_name ?? "", source: "Father/Husband Name (Section 1)" },
      accountHolderName: { value: data.account_holder_name ?? "", source: "Bank Account (Section 5)" },
      nomineeName: data.nominee_name ? { value: data.nominee_name, source: "Nominee (Section 8)" } : undefined,
      chequeHolderName: data.name_on_cheque ? { value: data.name_on_cheque, source: "Cheque (Section 5)" } : undefined,
    };

    const mismatches: NameValidationResult["mismatches"] = [];

    // Check profile name vs account holder
    if (matches.profileName.value && matches.accountHolderName.value) {
      const score = this.calculateNameMatch(
        matches.profileName.value,
        matches.accountHolderName.value
      );
      if (score < 70) {
        mismatches.push({
          field1: "Profile Name",
          field2: "Account Holder Name",
          value1: matches.profileName.value,
          value2: matches.accountHolderName.value,
          score,
        });
      }
    }

    // Check profile name vs cheque holder
    if (matches.profileName.value && matches.chequeHolderName?.value) {
      const score = this.calculateNameMatch(
        matches.profileName.value,
        matches.chequeHolderName.value
      );
      if (score < 70) {
        mismatches.push({
          field1: "Profile Name",
          field2: "Cheque Holder Name",
          value1: matches.profileName.value,
          value2: matches.chequeHolderName.value,
          score,
        });
      }
    }

    // Check account holder vs cheque holder
    if (matches.accountHolderName.value && matches.chequeHolderName?.value) {
      const score = this.calculateNameMatch(
        matches.accountHolderName.value,
        matches.chequeHolderName.value
      );
      if (score < 70) {
        mismatches.push({
          field1: "Account Holder Name",
          field2: "Cheque Holder Name",
          value1: matches.accountHolderName.value,
          value2: matches.chequeHolderName.value,
          score,
        });
      }
    }

    // Check nominee name consistency
    if (matches.nomineeName?.value && matches.profileName.value) {
      // Nominee can have different name, just check it's not empty
      if (!matches.nomineeName.value.trim()) {
        mismatches.push({
          field1: "Nominee Name",
          field2: "Validation",
          value1: matches.nomineeName.value,
          value2: "Empty",
          score: 0,
        });
      }
    }

    const isValid = mismatches.length === 0;
    let summary = "";
    let flagForReview = false;
    let reviewReason = "";

    if (isValid) {
      summary = "All names match across sections ✓";
    } else {
      summary = `${mismatches.length} name mismatch(es) detected`;
      flagForReview = true;

      const criticalMismatches = mismatches.filter((m) => m.score < 50);
      if (criticalMismatches.length > 0) {
        reviewReason = `Critical mismatch: ${criticalMismatches[0].field1} ≠ ${criticalMismatches[0].field2}`;
      } else {
        reviewReason = "Minor name variations detected. Payroll HQ to verify.";
      }
    }

    return {
      isValid,
      matches,
      mismatches,
      summary,
      flagForReview,
      reviewReason,
    };
  }
}
