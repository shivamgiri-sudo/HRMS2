import { fetchWithTimeout } from "@/integrations/utils/fetchWithTimeout";
import type { BranchLocation } from "@/integrations/types/integrations.types";

interface IpApiPayload {
  city?: string;
  latitude?: number;
  longitude?: number;
}

export async function getLocationFromIP(): Promise<BranchLocation | null> {
  try {
    const payload = await fetchWithTimeout<IpApiPayload>(
      "https://ipapi.co/json/",
      {},
      4000,
    );

    if (payload.city && payload.latitude != null && payload.longitude != null) {
      return {
        label: payload.city,
        latitude: payload.latitude,
        longitude: payload.longitude,
      };
    }

    return null;
  } catch {
    return null;
  }
}
