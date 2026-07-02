import { fetchWithTimeout } from "@/integrations/utils/fetchWithTimeout";

export interface IFSCDetails {
  bankName: string;
  branch: string;
  city: string;
  state: string;
  address: string;
}

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function isValidIFSC(ifscCode: string): boolean {
  return IFSC_REGEX.test(ifscCode.trim().toUpperCase());
}

export async function fetchIFSCDetails(ifscCode: string): Promise<IFSCDetails | null> {
  const cleanCode = ifscCode.trim().toUpperCase();

  if (!isValidIFSC(cleanCode)) {
    return null;
  }

  try {
    const response = await fetchWithTimeout<{
      BANK: string;
      BRANCH: string;
      CITY: string;
      STATE: string;
      ADDRESS: string;
    }>(`https://ifsc.razorpay.com/${cleanCode}`, {}, 4000);

    return {
      bankName: response.BANK || "",
      branch: response.BRANCH || "",
      city: response.CITY || "",
      state: response.STATE || "",
      address: response.ADDRESS || "",
    };
  } catch {
    return null;
  }
}
