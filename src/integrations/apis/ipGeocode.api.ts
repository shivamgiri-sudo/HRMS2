import { fetchWithTimeout } from "@/integrations/utils/fetchWithTimeout";
import type { BranchLocation } from "@/integrations/types/integrations.types";

interface IpApiPayload {
  status: string;
  city?: string;
  lat?: number;
  lon?: number;
}

export async function getLocationFromIP(): Promise<BranchLocation | null> {
  try {
    const payload = await fetchWithTimeout<IpApiPayload>(
      "https://ip-api.com/json?fields=status,city,lat,lon",
      {},
      4000,
    );

    if (payload.status === "success" && payload.city && payload.lat != null && payload.lon != null) {
      return {
        label: payload.city,
        latitude: payload.lat,
        longitude: payload.lon,
      };
    }

    return null;
  } catch {
    return null;
  }
}
