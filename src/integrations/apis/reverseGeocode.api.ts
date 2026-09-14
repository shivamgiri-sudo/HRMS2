import { fetchWithTimeout } from "@/integrations/utils/fetchWithTimeout";

interface BigDataCloudPayload {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryName?: string;
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      localityLanguage: "en",
    });

    const payload = await fetchWithTimeout<BigDataCloudPayload>(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?${params.toString()}`,
      {},
      4000,
    );

    return payload.city || payload.locality || payload.principalSubdivision || null;
  } catch {
    return null;
  }
}
