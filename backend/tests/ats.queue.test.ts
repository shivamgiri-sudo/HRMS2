/**
 * ATS Queue Token Tests — Stage 6
 * Covers: token creation, duplicate active token guard, walk-out, re-entry,
 * wait-time calculation, >20min alert, direct ID tampering (404 path).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));

import { db } from "../src/db/mysql.js";
import { atsQueueService } from "../src/modules/ats/ats.queue.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

function resetDbMock() {
  vi.clearAllMocks();
  mockExecute.mockReset().mockResolvedValue([[], []]);
}

const fakeToken = {
  id: "tok-1",
  candidate_id: "cand-1",
  token: "uuid-token-here",
  arrival_time: "2026-06-10 09:00:00",
  current_stage: "Arrived",
  assigned_recruiter_id: null,
  assigned_interviewer_id: null,
  status: "active",
  wait_alert_sent: 0,
  walk_out_at: null,
  created_at: "2026-06-10T09:00:00Z",
  updated_at: "2026-06-10T09:00:00Z",
};

describe("atsQueueService.createToken", () => {
  beforeEach(resetDbMock);

  it("creates a queue token for a valid candidate", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "cand-1", active_status: 1 }]]) // candidate exists
      .mockResolvedValueOnce([[]])                      // no existing active token
      .mockResolvedValueOnce([{ affectedRows: 1 }])    // INSERT
      .mockResolvedValueOnce([[fakeToken]]);            // re-fetch
    const result = await atsQueueService.createToken("cand-1", "2026-06-10 09:00:00");
    expect(result.candidate_id).toBe("cand-1");
    expect(result.status).toBe("active");
  });

  it("throws 404 when candidate does not exist", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // candidate not found
    const err = await atsQueueService.createToken("unknown-id", "2026-06-10 09:00:00").catch((e) => e);
    expect(err.message).toMatch(/not found/i);
    expect((err as any).statusCode).toBe(404);
  });

  it("throws 409 DUPLICATE_QUEUE_TOKEN when active token already exists", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ id: "cand-1", active_status: 1 }]]) // candidate exists
      .mockResolvedValueOnce([[{ id: "tok-1" }]]);    // active token already exists
    const err = await atsQueueService.createToken("cand-1", "2026-06-10 09:00:00").catch((e) => e);
    expect(err.message).toMatch(/already has an active queue token/i);
    expect((err as any).statusCode).toBe(409);
    expect((err as any).code).toBe("DUPLICATE_QUEUE_TOKEN");
  });
});

describe("atsQueueService.walkOut", () => {
  beforeEach(resetDbMock);

  it("marks token as walked_out and records walk_out_at", async () => {
    mockExecute
      .mockResolvedValueOnce([[fakeToken]])                  // getTokenById
      .mockResolvedValueOnce([{ affectedRows: 1 }])          // UPDATE
      .mockResolvedValueOnce([[{ ...fakeToken, status: "walked_out", walk_out_at: "2026-06-10 10:00:00" }]]);
    const result = await atsQueueService.walkOut("tok-1");
    expect(result.status).toBe("walked_out");
    expect(result.walk_out_at).not.toBeNull();
  });

  it("throws 400 when token is not active", async () => {
    mockExecute.mockResolvedValueOnce([[{ ...fakeToken, status: "walked_out" }]]);
    const err = await atsQueueService.walkOut("tok-1").catch((e) => e);
    expect(err.message).toMatch(/not active/i);
    expect((err as any).statusCode).toBe(400);
  });

  it("throws 404 for non-existent token (direct ID tampering)", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // not found
    const err = await atsQueueService.walkOut("tampered-id").catch((e) => e);
    expect(err.message).toMatch(/not found/i);
    expect((err as any).statusCode).toBe(404);
  });
});

describe("atsQueueService.reEntry", () => {
  beforeEach(resetDbMock);

  it("creates a new active token after walk-out", async () => {
    mockExecute
      .mockResolvedValueOnce([[]])                      // no active token
      .mockResolvedValueOnce([[{ id: "cand-1", active_status: 1 }]]) // candidate exists
      .mockResolvedValueOnce([[]])                      // no active token (inside createToken)
      .mockResolvedValueOnce([{ affectedRows: 1 }])    // INSERT
      .mockResolvedValueOnce([[{ ...fakeToken, id: "tok-2" }]]); // re-fetch
    const result = await atsQueueService.reEntry("cand-1", "2026-06-10 11:00:00");
    expect(result.candidate_id).toBe("cand-1");
    expect(result.status).toBe("active");
  });

  it("throws 409 when candidate still has active token", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "tok-1" }]]); // active token found
    const err = await atsQueueService.reEntry("cand-1", "2026-06-10 11:00:00").catch((e) => e);
    expect(err.message).toMatch(/walk out first/i);
    expect((err as any).statusCode).toBe(409);
  });
});

describe("atsQueueService.listActiveQueue — wait-time and alert", () => {
  beforeEach(resetDbMock);

  it("includes wait_minutes and over_threshold=false for candidates under 20 minutes", async () => {
    mockExecute.mockResolvedValueOnce([[
      { ...fakeToken, candidate_name: "Test User", mobile: "9876543210", wait_minutes: 10 }
    ]]);
    const now = new Date("2026-06-10T09:10:00Z");
    const results = await atsQueueService.listActiveQueue({ sql: "", params: [] }, now);
    expect(results[0].wait_minutes).toBe(10);
    expect(results[0].over_threshold).toBe(false);
  });

  it("sets over_threshold=true for candidates waiting >= 20 minutes", async () => {
    mockExecute.mockResolvedValueOnce([[
      { ...fakeToken, candidate_name: "Slow Candidate", mobile: "9999999999", wait_minutes: 25 }
    ]]);
    const now = new Date("2026-06-10T09:25:00Z");
    const results = await atsQueueService.listActiveQueue({ sql: "", params: [] }, now);
    expect(results[0].wait_minutes).toBe(25);
    expect(results[0].over_threshold).toBe(true);
  });

  it("returns empty array when no candidates in queue", async () => {
    mockExecute.mockResolvedValueOnce([[]]);
    const results = await atsQueueService.listActiveQueue({ sql: "", params: [] }, new Date());
    expect(results).toHaveLength(0);
  });
});

describe("atsQueueService.getTokenById — direct ID tampering", () => {
  beforeEach(resetDbMock);

  it("throws 404 for a non-existent token id", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // not found
    const err = await atsQueueService.getTokenById("injected-id").catch((e) => e);
    expect(err.message).toMatch(/not found/i);
    expect((err as any).statusCode).toBe(404);
  });
});
