/**
 * WFM issue 11 ("DigiLocker issue remains unresolved"). Luckpay answers "Failed" for a DigiLocker session the
 * candidate is still completing (live: session 7f24a5a3 answered "status: Failed" 7 s after it started and returned
 * the documents 4 minutes later). Since 2026-10-02 that first answer was stored as terminal, so the session was never
 * asked again and the candidate was pushed to retry. Inside the grace window a "Failed" now means "not finished yet".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, checkKycStatus } = vi.hoisted(() => ({ execute: vi.fn(), checkKycStatus: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: {
    execute,
    getConnection: async () => ({ execute: async () => [[{ acquired: 1 }]], release: () => undefined }),
  },
}));
vi.mock("../luckpay.client.js", () => ({ luckpayClient: { checkKycStatus, downloadKycDocument: vi.fn() } }));
vi.mock("../../../ats/bgv-api-log.service.js", () => ({
  withProviderFailureLogged: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  writeBgvApiLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../ats/onboarding-bridge-status.js", () => ({ syncBridgeDigilockerStatus: vi.fn() }));

import {
  PROVIDER_FAILED_GRACE_MS,
  isPrematureFailedVerdict,
  isWithinFailedGrace,
  syncDigilockerStatus,
} from "../luckpay-status.service.js";

const GRACE_S = PROVIDER_FAILED_GRACE_MS / 1000;
let latest: Record<string, unknown>;
let writes: Array<{ sql: string; params: unknown[] }>;

beforeEach(() => {
  writes = [];
  checkKycStatus.mockReset();
  execute.mockReset();
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/^\s*SELECT client_transaction_id/.test(sql)) return [[latest]];
    writes.push({ sql, params });
    return [{ affectedRows: 1 }];
  });
});

const row = (over: Record<string, unknown>) => ({
  client_transaction_id: "ctx-1", provider_reference_id: "APIB1", status: "initiated",
  session_age_s: 30, verdict_age_s: 0, since_update_s: 30, ...over,
});
const providerFailed = { state: "failed", providerStatus: "FAILED", transactionId: "APIB1", clientTransactionId: "ctx-1",
  message: "The given transaction id for digilocker is not success", sanitized: {} };
const providerLogStatus = () =>
  writes.filter((w) => w.sql.includes("UPDATE ats_provider_transaction_log")).map((w) => w.params[0]);

describe("grace window helpers", () => {
  it("a session younger than the window is still in progress", () => {
    expect(isWithinFailedGrace(7)).toBe(true);
    expect(isWithinFailedGrace(GRACE_S + 1)).toBe(false);
    expect(isWithinFailedGrace(null)).toBe(false);
  });
  it("a failed verdict recorded inside the window was premature", () => {
    expect(isPrematureFailedVerdict(60)).toBe(true);
    expect(isPrematureFailedVerdict(GRACE_S + 60)).toBe(false);
    expect(isPrematureFailedVerdict(undefined)).toBe(false);
  });
});

describe("syncDigilockerStatus", () => {
  it("a provider 'Failed' on a young session is reported pending, not stored as failed", async () => {
    latest = row({});
    checkKycStatus.mockResolvedValue(providerFailed);
    const out = await syncDigilockerStatus("cand-1");
    expect(out.state).toBe("pending");
    expect(out.message).toMatch(/no need to start over/);
    expect(providerLogStatus()).toEqual(["pending"]);
  });

  it("the gateway's BGW_001 'status: Failed' error on a young session is also pending", async () => {
    latest = row({});
    checkKycStatus.mockRejectedValue(new Error("Status mapping not found for pipe: TRANSBNK, service: API_BANKING, status: Failed"));
    const out = await syncDigilockerStatus("cand-1");
    expect(out.state).toBe("pending");
    expect(providerLogStatus()).toEqual(["pending"]);
  });

  it("after the window the same answer is terminal, as before", async () => {
    latest = row({ session_age_s: GRACE_S + 10 });
    checkKycStatus.mockResolvedValue(providerFailed);
    const out = await syncDigilockerStatus("cand-1");
    expect(out.state).toBe("failed");
    expect(providerLogStatus()).toEqual(["failed"]);
  });

  it("a session already stored failed prematurely is asked again once, and heals when DigiLocker completed", async () => {
    latest = row({ status: "failed", session_age_s: 3 * 86400, verdict_age_s: 90 });
    checkKycStatus.mockResolvedValue({ ...providerFailed, state: "completed", providerStatus: "SUCCESS" });
    await syncDigilockerStatus("cand-1").catch(() => undefined); // the document download path is not under test here
    expect(checkKycStatus).toHaveBeenCalledTimes(1);
  });

  it("a failed verdict recorded after the window is never re-asked", async () => {
    latest = row({ status: "failed", session_age_s: 3 * 86400, verdict_age_s: GRACE_S + 60 });
    const out = await syncDigilockerStatus("cand-1");
    expect(out.state).toBe("failed");
    expect(checkKycStatus).not.toHaveBeenCalled();
  });

  it("does not re-ask the provider within seconds of the last pending answer", async () => {
    latest = row({ status: "pending", since_update_s: 5 });
    const out = await syncDigilockerStatus("cand-1");
    expect(out.state).toBe("pending");
    expect(checkKycStatus).not.toHaveBeenCalled();
  });
});
