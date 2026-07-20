import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchWithTimeoutMock } = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn(),
}));

vi.mock("@/integrations/utils/fetchWithTimeout", () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
}));

import { getLocationFromIP } from "@/integrations/apis/ipGeocode.api";

describe("IP geolocation fallback", () => {
  beforeEach(() => {
    fetchWithTimeoutMock.mockReset();
  });

  it("uses the HTTPS endpoint and maps its location response", async () => {
    fetchWithTimeoutMock.mockResolvedValue({
      city: "New Delhi",
      latitude: 28.6139,
      longitude: 77.209,
    });

    await expect(getLocationFromIP()).resolves.toEqual({
      label: "New Delhi",
      latitude: 28.6139,
      longitude: 77.209,
    });
    expect(fetchWithTimeoutMock).toHaveBeenCalledWith(
      "https://ipapi.co/json/",
      {},
      4000,
    );
  });

  it("returns null when the provider fails or omits coordinates", async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce({ city: "New Delhi" });
    await expect(getLocationFromIP()).resolves.toBeNull();

    fetchWithTimeoutMock.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(getLocationFromIP()).resolves.toBeNull();
  });
});
