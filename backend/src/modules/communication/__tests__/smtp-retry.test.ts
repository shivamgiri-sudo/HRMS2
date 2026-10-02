import { describe, it, expect, vi } from "vitest";
import { isTransientSmtpError, withSmtpRetry } from "../smtp-retry.js";
import { isVendorFailedStatusMappingError } from "../../integrations/luckpay/luckpay-status.service.js";

vi.mock("../../../db/mysql.js", () => ({ db: {} }));

const smtp = (responseCode: number) => Object.assign(new Error("Data command failed: 421-4.3.0 Temporary System Problem"), { responseCode });

describe("smtp retry", () => {
  it("classifies 4xx as transient and 5xx as permanent", () => {
    expect(isTransientSmtpError(smtp(421))).toBe(true);
    expect(isTransientSmtpError(smtp(550))).toBe(false);
    expect(isTransientSmtpError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientSmtpError(new Error("Invalid login"))).toBe(false);
  });
  it("retries 421 with growing backoff then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(smtp(421)).mockRejectedValueOnce(smtp(421)).mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withSmtpRetry(fn, sleep)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls[1][0]).toBeGreaterThan(sleep.mock.calls[0][0]);
  });
  it("does not retry 5xx", async () => {
    const fn = vi.fn().mockRejectedValue(smtp(550));
    await expect(withSmtpRetry(fn, vi.fn())).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("gives up after max attempts", async () => {
    const fn = vi.fn().mockRejectedValue(smtp(421));
    await expect(withSmtpRetry(fn, vi.fn().mockResolvedValue(undefined))).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

describe("luckpay failed-status mapping", () => {
  it("recognises the vendor BGW_001 Failed mapping error only", () => {
    const e = Object.assign(new Error("Luckpay provider request failed"), {
      providerPayload: { code: "BGW_001", message: "Status mapping not found for pipe: TRANSBNK, service: API_BANKING, status: Failed" },
    });
    expect(isVendorFailedStatusMappingError(e)).toBe(true);
    expect(isVendorFailedStatusMappingError(new Error("Endpoint request timed out"))).toBe(false);
  });
});
