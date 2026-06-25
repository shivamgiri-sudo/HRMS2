// Master data for onboarding forms: banks, IFSC, states, address proof types, etc.
// All data sourced from RBI, govt, and standard Indian registries.

export const INDIAN_BANKS = [
  // Public Sector Banks
  { code: "SBI", name: "State Bank of India" },
  { code: "BOB", name: "Bank of Baroda" },
  { code: "PNB", name: "Punjab National Bank" },
  { code: "CANARA", name: "Canara Bank" },
  { code: "IOB", name: "Indian Overseas Bank" },
  { code: "UNION", name: "Union Bank of India" },
  { code: "CENTRAL", name: "Central Bank of India" },
  { code: "INDIAN", name: "Indian Bank" },

  // Private Sector Banks
  { code: "HDFC", name: "HDFC Bank" },
  { code: "ICICI", name: "ICICI Bank" },
  { code: "AXIS", name: "Axis Bank" },
  { code: "KOTAK", name: "Kotak Mahindra Bank" },
  { code: "IDBI", name: "IDBI Bank" },
  { code: "YES", name: "YES Bank" },
  { code: "INDUSIND", name: "IndusInd Bank" },
  { code: "FEDERAL", name: "Federal Bank" },
  { code: "SOUTH_INDIAN", name: "South Indian Bank" },
  { code: "RBL", name: "RBL Bank" },
  { code: "AUBANK", name: "AU Bank" },
  { code: "BANDHAN", name: "Bandhan Bank" },
  { code: "IDFCFIRST", name: "IDFCFIRST Bank" },

  // Foreign Banks
  { code: "HSBC", name: "HSBC Bank India" },
  { code: "CITIUS", name: "Citibank India" },
  { code: "DEUTSCHE", name: "Deutsche Bank India" },
  { code: "STANDARD", name: "Standard Chartered Bank" },
];

export const ADDRESS_PROOF_TYPES = [
  { code: "DL", name: "Driving License" },
  { code: "VOTER", name: "Voter ID" },
  { code: "PASSPORT", name: "Passport" },
  { code: "AADHAAR", name: "Aadhaar Card" },
  { code: "UTILITY", name: "Utility Bill (Electricity/Water)" },
  { code: "PROPERTY", name: "Property Tax Certificate" },
  { code: "RENT_AGREEMENT", name: "Rent Agreement" },
  { code: "BANK_STATEMENT", name: "Bank Statement" },
];

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam",
  "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Dadar and Nagar Haveli", "Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
  "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

export const QUALIFICATION_TYPES = [
  { code: "10TH", name: "10th Grade / SSC" },
  { code: "12TH", name: "12th Grade / HSC" },
  { code: "DIPLOMA", name: "Diploma (2-3 years)" },
  { code: "BACHELOR", name: "Bachelor's Degree" },
  { code: "MASTER", name: "Master's Degree" },
  { code: "PHD", name: "PhD" },
  { code: "POSTDOC", name: "Post-Doctoral" },
  { code: "PROFESSIONAL", name: "Professional Certification (CA/CS/CMA)" },
  { code: "VOCATIONAL", name: "Vocational Training" },
  { code: "OTHER", name: "Other" },
];

export const DESIGNATION_TYPES = [
  { code: "TRAINEE", name: "Trainee" },
  { code: "EXECUTIVE", name: "Executive" },
  { code: "SR_EXECUTIVE", name: "Senior Executive" },
  { code: "TEAM_LEAD", name: "Team Lead" },
  { code: "MANAGER", name: "Manager" },
  { code: "SR_MANAGER", name: "Senior Manager" },
  { code: "HEAD", name: "Head of Department" },
  { code: "DIRECTOR", name: "Director" },
  { code: "MD", name: "Managing Director / CEO" },
];

export const ACCOUNT_TYPES = [
  { code: "SAVINGS", name: "Savings Account" },
  { code: "CURRENT", name: "Current Account" },
  { code: "SALARY", name: "Salary Account" },
];

export const EMPLOYMENT_TYPES = [
  { code: "FRESHER", name: "Fresher (0 years)" },
  { code: "LT1", name: "Less than 1 year" },
  { code: "1T2", name: "1-2 years" },
  { code: "2T3", name: "2-3 years" },
  { code: "3T5", name: "3-5 years" },
  { code: "5TPLUS", name: "5+ years" },
];

// Mock IFSC lookup — in production, fetch from RBI IFSC API or centralized DB
export function lookupIFSC(ifscCode: string): Promise<{
  bankName: string;
  branchName: string;
  city: string;
  state: string;
} | null> {
  return new Promise((resolve) => {
    setTimeout(() => {
      // Mock: return sample data for demo
      if (ifscCode.toUpperCase().startsWith("SBIN")) {
        return resolve({ bankName: "State Bank of India", branchName: "Sample Branch", city: "Mumbai", state: "Maharashtra" });
      }
      if (ifscCode.toUpperCase().startsWith("HDFC")) {
        return resolve({ bankName: "HDFC Bank", branchName: "Sample Branch", city: "Bangalore", state: "Karnataka" });
      }
      resolve(null);
    }, 200);
  });
}

// Mock cheque OCR — extract name from cheque image
// In production, use AWS Textract, Google Vision, or Tesseract
export async function extractNameFromCheque(fileUrl: string): Promise<string | null> {
  // Placeholder: would call actual OCR service
  return null;
}

export class OnboardingDataService {
  static getBanks() { return INDIAN_BANKS; }
  static getAddressProofTypes() { return ADDRESS_PROOF_TYPES; }
  static getStates() { return INDIAN_STATES; }
  static getQualifications() { return QUALIFICATION_TYPES; }
  static getDesignations() { return DESIGNATION_TYPES; }
  static getAccountTypes() { return ACCOUNT_TYPES; }
  static getEmploymentTypes() { return EMPLOYMENT_TYPES; }
  static async lookupIFSC(code: string) { return lookupIFSC(code); }
  static async extractChequeOCR(url: string) { return extractNameFromCheque(url); }
}
