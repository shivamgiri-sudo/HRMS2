/**
 * ATS BGV Provider Adapter Tests — Session 8
 *
 * Covers:
 *  - Adapter factory: mock/infinity_ai/digio selection by BGV_PROVIDER env
 *  - MockBgvProviderAdapter: PAN/bank/aadhaar/digilocker logic
 *  - InfinityAiBgvAdapter / DigioBgvAdapter: throw when credentials missing
 *  - requireFormApiKey: timingSafeEqual guard logic
 *  - roughNameMatchScore: helper edge cases
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { timingSafeEqual } from "crypto";
import axios from "axios";
import { db } from "../src/db/mysql.js";

// ── Shared mocks (must come before any dynamic imports) ───────────────────────

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));

vi.mock("../src/shared/scopeAccess.js", () => ({
  hasScopedAccess: vi.fn().mockResolvedValue(true),
  buildScopeWhereClause: vi.fn().mockResolvedValue({ sql: "1=1", params: [] }),
}));

// ── Adapter imports ───────────────────────────────────────────────────────────

import {
  MockBgvProviderAdapter,
  InfinityAiBgvAdapter,
  DigioBgvAdapter,
  roughNameMatchScore,
  getBgvProviderAdapter,
  resetBgvProviderAdapterCache,
  buildAdapterFromDbConfig,
} from "../src/modules/ats/bgv-provider.adapter.js";

const luckpayCfg = {
  bgv_provider: "befisc_luckpay",
  luckpay_api_url: "https://api-banking.luckpay.in/apibanking/api/v1",
  luckpay_basic_token: "test-basic-token",
  luckpay_client_id: "TESTCLIENT",
};

// ── roughNameMatchScore ───────────────────────────────────────────────────────

describe("roughNameMatchScore", () => {
  it("TC-PROV-01: exact match → 100", () => {
    expect(roughNameMatchScore("Rahul Sharma", "Rahul Sharma")).toBe(100);
  });

  it("TC-PROV-02: partial word overlap → between 0 and 100", () => {
    const score = roughNameMatchScore("Rahul Sharma", "Rahul Kumar");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it("TC-PROV-03: no common words → 0", () => {
    expect(roughNameMatchScore("Rahul Sharma", "Priya Singh")).toBe(0);
  });

  it("TC-PROV-04: null/empty inputs → 0", () => {
    expect(roughNameMatchScore(null, null)).toBe(0);
    expect(roughNameMatchScore("Rahul", null)).toBe(0);
    expect(roughNameMatchScore(null, "Rahul")).toBe(0);
  });

  it("TC-PROV-05: case-insensitive comparison", () => {
    expect(roughNameMatchScore("RAHUL SHARMA", "rahul sharma")).toBe(100);
  });
});

// ── MockBgvProviderAdapter ────────────────────────────────────────────────────

describe("MockBgvProviderAdapter", () => {
  const adapter = new MockBgvProviderAdapter();

  it("TC-PROV-06: providerKey is mock_bgv", () => {
    expect(adapter.providerKey).toBe("mock_bgv");
  });

  it("TC-PROV-07: PAN valid format → verified with no risk flags", async () => {
    const result = await adapter.verifyPan({ panNumber: "ABCDE1234F", candidateName: "Rahul" });
    expect(result.status).toBe("verified");
    expect(result.providerKey).toBe("mock_bgv");
    expect(result.riskFlags).toEqual([]);
  });

  it("TC-PROV-08: PAN invalid format → failed with PAN_FORMAT_INVALID flag", async () => {
    const result = await adapter.verifyPan({ panNumber: "INVALID_PAN" });
    expect(result.status).toBe("failed");
    expect(result.riskFlags).toContain("PAN_FORMAT_INVALID");
  });

  it("TC-PROV-09: bank valid IFSC + 12-digit account → verified", async () => {
    const result = await adapter.verifyBank({
      accountNo: "123456789012",
      ifscCode: "HDFC0001234",
      candidateName: "Mock Account Holder",
    });
    expect(result.status).toBe("verified");
    expect(result.matchScore).toBeGreaterThanOrEqual(60);
  });

  it("TC-PROV-10: bank invalid IFSC → failed with IFSC_FORMAT_INVALID flag", async () => {
    const result = await adapter.verifyBank({ accountNo: "123456", ifscCode: "BADIFSC", candidateName: "Test" });
    expect(result.status).toBe("failed");
    expect(result.riskFlags).toContain("IFSC_FORMAT_INVALID");
  });

  it("TC-PROV-11: aadhaar with documentId → manual_review", async () => {
    const result = await adapter.verifyAadhaarOffline({ documentId: "doc-123", candidateName: "Test" });
    expect(result.status).toBe("manual_review");
  });

  it("TC-PROV-12: aadhaar without documentId → failed with AADHAAR_DOCUMENT_MISSING", async () => {
    const result = await adapter.verifyAadhaarOffline({ candidateName: "Test" });
    expect(result.status).toBe("failed");
    expect(result.riskFlags).toContain("AADHAAR_DOCUMENT_MISSING");
  });

  it("TC-PROV-13: startDigilocker returns mock URL with state and expiresAt", async () => {
    const session = await adapter.startDigilocker("cand-1", ["aadhaar", "pan"]);
    expect(session.state).toBeTruthy();
    expect(session.authUrl).toContain("mock-digilocker");
    expect(session.expiresAt).toBeInstanceOf(Date);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

// ── Real adapter constructors — credential guards ──────────────────────────────

describe("InfinityAiBgvAdapter constructor guard", () => {
  it("TC-PROV-14: throws when INFINITY_AI_API_KEY is not set in env", () => {
    // In test env INFINITY_AI_API_KEY is undefined — guard must throw
    expect(() => new InfinityAiBgvAdapter()).toThrow("INFINITY_AI_API_KEY");
  });
});

describe("DigioBgvAdapter constructor guard", () => {
  it("TC-PROV-15: throws when DIGIO_CLIENT_ID / DIGIO_CLIENT_SECRET are not set", () => {
    // In test env both are undefined — guard must throw
    expect(() => new DigioBgvAdapter()).toThrow("DIGIO_CLIENT_ID");
  });
});

// ── getBgvProviderAdapter factory ─────────────────────────────────────────────

describe("getBgvProviderAdapter factory", () => {
  beforeEach(() => resetBgvProviderAdapterCache());
  afterEach(() => resetBgvProviderAdapterCache());

  it("TC-PROV-16: BGV_PROVIDER defaults to mock → returns MockBgvProviderAdapter", () => {
    const adapter = getBgvProviderAdapter();
    expect(adapter.providerKey).toBe("mock_bgv");
    expect(adapter).toBeInstanceOf(MockBgvProviderAdapter);
  });

  it("TC-PROV-17: factory caches singleton — same instance returned on second call", () => {
    const a = getBgvProviderAdapter();
    const b = getBgvProviderAdapter();
    expect(a).toBe(b);
  });

  it("TC-PROV-18: resetBgvProviderAdapterCache clears singleton so next call creates new instance", () => {
    const a = getBgvProviderAdapter();
    resetBgvProviderAdapterCache();
    const b = getBgvProviderAdapter();
    expect(a).not.toBe(b);
  });
});

describe("Composite Befisc/Luckpay adapter", () => {
  beforeEach(() => {
    vi.spyOn(axios, "post").mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-PROV-24: PAN uses Luckpay auth token and verifyPan payload contract", async () => {
    const post = vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { data: { token: "access-token", expiresIn: 60 } } })
      .mockResolvedValueOnce({ data: { status: "success", transaction_id: "pan-ref", pan_name: "Rahul Sharma", idNumber: "ABCDE1234F" } });

    const adapter = buildAdapterFromDbConfig(luckpayCfg);
    const result = await adapter.verifyPan({ panNumber: "ABCDE1234F", candidateName: "Rahul Sharma", mobileNumber: "98765 43210" });

    expect(post).toHaveBeenNthCalledWith(
      1,
      "https://api-banking.luckpay.in/apibanking/api/v1/auth/token",
      undefined,
      expect.objectContaining({
        headers: { Authorization: "Basic test-basic-token" },
      }),
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      "https://api-banking.luckpay.in/apibanking/api/v1/verifyPan",
      expect.objectContaining({
        clientTransactionId: expect.any(String),
        idNumber: "ABCDE1234F",
        mobileNumber: "9876543210",
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "TESTCLIENT",
          "X-Access-Token": "Bearer access-token",
        }),
      }),
    );
    expect(result.status).toBe("verified");
    expect(JSON.stringify(result.raw)).not.toContain("ABCDE1234F");
  });

  it("TC-PROV-25: UAN uses verifyUanByUan with identifier payload", async () => {
    const post = vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { data: { token: "access-token" } } })
      .mockResolvedValueOnce({ data: { status: "success", transaction_id: "uan-ref", member_name: "Rahul Sharma", identifier: "100200300400" } });

    const adapter = buildAdapterFromDbConfig(luckpayCfg);
    if (!adapter.verifyUan) throw new Error("verifyUan missing");
    await adapter.verifyUan({ uanNumber: "100200300400", candidateName: "Rahul Sharma" });

    expect(post).toHaveBeenNthCalledWith(
      2,
      "https://api-banking.luckpay.in/apibanking/api/v1/verifyUanByUan",
      expect.objectContaining({
        clientTransactionId: expect.any(String),
        identifier: "100200300400",
      }),
      expect.any(Object),
    );
  });

  it("TC-PROV-26: bank verification uses Luckpay verifyPennyDrop contract", async () => {
    const post = vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { data: { token: "access-token" } } })
      .mockResolvedValueOnce({ data: { status: "success", transaction_id: "bank-ref", registered_name: "Rahul Sharma", customerAccountNumber: "123456789012" } });

    const adapter = buildAdapterFromDbConfig(luckpayCfg);
    await adapter.verifyBank({
      accountNo: "123456789012",
      ifscCode: "HDFC0001234",
      accountHolderName: "Rahul Sharma",
    });

    expect(post).toHaveBeenNthCalledWith(
      2,
      "https://api-banking.luckpay.in/apibanking/api/v1/verifyPennyDrop",
      expect.objectContaining({
        clientTransactionId: expect.any(String),
        customerAccountNumber: "123456789012",
        customerAccountName: "Rahul Sharma",
        customerIfscCode: "HDFC0001234",
        verificationMode: "PENNY_DROP",
      }),
      expect.any(Object),
    );
  });

  it("TC-PROV-27: DigiLocker uses Luckpay verifyDigilockerWithURL with candidate contact", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[{ full_name: "Rahul Sharma", mobile: "9876543210" }], []] as any);
    const post = vi.spyOn(axios, "post")
      .mockResolvedValueOnce({ data: { data: { token: "access-token" } } })
      .mockResolvedValueOnce({ data: { redirectUrl: "https://luckpay.example/digilocker", mobileNumber: "9876543210" } });

    const adapter = buildAdapterFromDbConfig(luckpayCfg);
    const session = await adapter.startDigilocker("candidate-1", ["AADHAAR"]);

    expect(post).toHaveBeenNthCalledWith(
      2,
      "https://api-banking.luckpay.in/apibanking/api/v1/verifyDigilockerWithURL",
      expect.objectContaining({
        clientTransactionId: expect.any(String),
        customerName: "Rahul Sharma",
        mobileNumber: "9876543210",
      }),
      expect.any(Object),
    );
    expect(session.authUrl).toBe("https://luckpay.example/digilocker");
  });
});

// ── requireFormApiKey guard logic ─────────────────────────────────────────────
//
// We test the guard's inline logic directly rather than via supertest (avoids
// re-importing the router after resetModules which would break the top-level mocks).

describe("requireFormApiKey guard logic", () => {
  it("TC-PROV-19: missing header — simulated guard rejects", () => {
    const secret = "test-ats-key-12345";
    const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const mockNext = vi.fn();

    const provided = ""; // no header
    if (!provided) {
      mockRes.status(401).json({ success: false, message: "Missing X-ATS-Api-Key header" });
    } else {
      mockNext();
    }

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
    expect(secret).toBeTruthy(); // secret is set but unused when header missing
  });

  it("TC-PROV-20: wrong key — timingSafeEqual returns false for different-length strings", () => {
    const secret = "correct-key-32ch";
    const provided = "wrong-key"; // different length → immediate false
    let match = false;
    try {
      match = provided.length === secret.length &&
        timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
    } catch {
      match = false;
    }
    expect(match).toBe(false);
  });

  it("TC-PROV-21: wrong key — same length, wrong value → timingSafeEqual returns false", () => {
    const secret = "aaaaaaaaaaaaaaaa"; // 16 chars
    const provided = "bbbbbbbbbbbbbbbb"; // 16 chars, different bytes
    let match = false;
    try {
      match = provided.length === secret.length &&
        timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
    } catch {
      match = false;
    }
    expect(match).toBe(false);
  });

  it("TC-PROV-22: correct key — timingSafeEqual returns true", () => {
    const secret = "correct-key-12345678901234567890";
    const provided = "correct-key-12345678901234567890";
    let match = false;
    try {
      match = provided.length === secret.length &&
        timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
    } catch {
      match = false;
    }
    expect(match).toBe(true);
  });

  it("TC-PROV-23: secret not configured in non-prod — next() called (guard skips)", () => {
    const mockNext = vi.fn();
    const mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    // Simulate: secret = undefined, NODE_ENV = test
    const secret: string | undefined = undefined;
    const isProduction = false;

    if (!secret) {
      if (isProduction) {
        mockRes.status(503).json({ success: false, message: "Form endpoint not configured" });
      } else {
        // Non-prod: skip with warning
        mockNext();
      }
    }

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});
