/**
 * SmartPing reports a REFUSED send with HTTP 200.
 *
 * Probed against the live production account on 2026-08-20:
 *
 *   GET /fe/api/v1/send?username=<wrong>&password=<wrong>&...
 *   -> HTTP 200
 *      {"transactionId":0,"state":"SUBMIT_FAILED","statusCode":2070,
 *       "description":"Authentication failure","pdu":0}
 *
 * The provider used to return `{ success: true, message_id: "200" }` for that,
 * because it only looked at `res.status`. Every downstream caller therefore
 * believed the SMS had gone out. The onboarding OTP path is the one that hurt:
 * ats.otp.service sends over SMS and email together and logs each channel's
 * outcome, so the log said "SMS=sent" while candidates only ever received the
 * code by email and nobody could see why.
 *
 * A 4xx carries the same body shape, so the provider must not let axios throw
 * those away either — "Request failed with status code 400" names no cause.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

const axios = (await import("axios")).default as unknown as { get: ReturnType<typeof vi.fn> };
const { SmartPingProvider } = await import("../smartping.provider.js");
const { SMARTPING_DLT_REGISTRY } = await import("../../../smartping-dlt-registry.js");

const provider = new SmartPingProvider("user", "pass", "Ispark", "1001485540000016211");
const MOBILE = "9999746258";
const DLT = SMARTPING_DLT_REGISTRY.candidate_mobile_otp.dltContentId;

beforeEach(() => axios.get.mockReset());

describe("SmartPing send outcome is read from the body, not the HTTP status", () => {
  it("treats a 200 SUBMIT_FAILED as a failure", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { transactionId: 0, state: "SUBMIT_FAILED", statusCode: 2070, description: "Authentication failure", pdu: 0 },
    });

    const res = await provider.send(MOBILE, DLT, "Your OTP is 123456");

    expect(res.success, "a refused send must never report success").toBe(false);
    expect(res.error).toContain("Authentication failure");
    expect(res.error).toContain("SUBMIT_FAILED");
  });

  it("keeps SmartPing's diagnosis on a 4xx instead of collapsing it to a status code", async () => {
    axios.get.mockResolvedValue({
      status: 400,
      data: { transactionId: 3721136044, state: "SUBMIT_FAILED", statusCode: 2054, description: "Invalid Msisdn [910000000000] for country [IN]" },
    });

    const res = await provider.send(MOBILE, DLT, "Your OTP is 123456");

    expect(res.success).toBe(false);
    expect(res.error).toContain("Invalid Msisdn");
    expect(res.error).toContain("2054");
  });

  it("does not let axios reject 4xx responses before the body is read", async () => {
    axios.get.mockResolvedValue({ status: 400, data: { state: "SUBMIT_FAILED", description: "x" } });
    await provider.send(MOBILE, DLT, "body");
    expect(axios.get.mock.calls[0][1].validateStatus(400)).toBe(true);
  });

  // The exact body SmartPing returned for a real, accepted OTP to 9999746258 on
  // 2026-08-20. An allow-list of "known good" states was written first and would
  // have called this a failure — every working send reported as broken. Pinned
  // here so that inversion cannot come back.
  it("still accepts a genuine submission (SUBMIT_ACCEPTED, observed live)", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { transactionId: 3721268555, state: "SUBMIT_ACCEPTED", statusCode: 200, description: "Message accepted successfully", pdu: 1 },
    });

    const res = await provider.send(MOBILE, DLT, "Your OTP is 123456");

    expect(res.success, "a real send must not be broken by the guard").toBe(true);
    expect(res.message_id).toBe("3721268555");
  });

  it("stays permissive when SmartPing returns no state at all", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { messageId: "sent-123" } });
    const res = await provider.send(MOBILE, DLT, "body");
    expect(res.success).toBe(true);
  });
});
