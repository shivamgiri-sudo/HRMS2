import type { PincodeDetails } from "@/integrations/types/integrations.types";
import { fetchWithTimeout } from "@/integrations/utils/fetchWithTimeout";

interface PostalPincodeResponse {
  Status?: string;
  PostOffice?: Array<{
    Name?: string;
    District?: string;
    State?: string;
    Country?: string;
  }>;
}

export async function fetchPincodeDetails(pincode: string): Promise<PincodeDetails | null> {
  const cleanPincode = pincode.trim();

  if (!/^[1-9][0-9]{5}$/.test(cleanPincode)) {
    return null;
  }

  const payload = await fetchWithTimeout<PostalPincodeResponse[]>(
    `https://api.postalpincode.in/pincode/${cleanPincode}`,
    {},
    4500,
  );

  const firstResult = payload?.[0]?.PostOffice?.[0];

  if (!firstResult) {
    return null;
  }

  return {
    city: firstResult.Name || "",
    district: firstResult.District || "",
    state: firstResult.State || "",
    country: firstResult.Country || "India",
    postOffice: firstResult.Name || "",
  };
}
