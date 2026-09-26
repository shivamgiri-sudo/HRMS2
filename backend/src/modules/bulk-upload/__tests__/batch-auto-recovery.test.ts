/**
 * BATCH-1790414059915 (GS1_EMAIL_DAILY): an import held locks on upload_batch_row for two hours,
 * other uploads failed with "Lock wait timeout exceeded", and a person had to end the session and
 * re-run the batch. These tests pin the automatic version: it must free real stuck sessions, retry
 * only what is safe to run twice, stop at the cap, and never touch anything else.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const query = vi.fn();
const execute = vi.fn();
const alertAdmins = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: {
    query: (...a: unknown[]) => query(...a),
    execute: (...a: unknown[]) => execute(...a),
  },
}));
vi.mock("../batch-recovery-alert.js", () => ({
  alertAdmins: (...a: unknown[]) => alertAdmins(...a),
}));

const {
  isTransientFailure,
  isAutoRetrySafe,
  killStuckRowSessions,
  requeueTransientFailures,
  AUTO_RETRY_SAFE_RPCS,
  MAX_AUTO_RETRIES,
  STUCK_SESSION_SECONDS,
} = await import("../batch-auto-recovery.service.js");

beforeEach(() => {
  query.mockReset();
  execute.mockReset();
  alertAdmins.mockReset();
});

const failed = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  upload_batch_no: "BATCH-1",
  upload_type_code: "GS1_EMAIL_DAILY",
  error_summary: "Lock wait timeout exceeded; try restarting transaction",
  uploaded_by: "u1",
  rpc: "import_gs1_email_daily_batch",
  import_user: "u2",
  retries: 0,
  ...over,
});

describe("what counts as transient", () => {
  it("recognises lock waits, deadlocks and lost jobs, and nothing else", () => {
    expect(
      isTransientFailure(
        "Lock wait timeout exceeded; try restarting transaction",
      ),
    ).toBe(true);
    expect(isTransientFailure("Deadlock found when trying to get lock")).toBe(
      true,
    );
    expect(
      isTransientFailure("Import stopped ... The job tracking it was lost"),
    ).toBe(true);
    expect(isTransientFailure("Unknown column 'x' in 'field list'")).toBe(
      false,
    );
    expect(isTransientFailure(null)).toBe(false);
  });
});

describe("which imports may be repeated", () => {
  it("allows the verified keyed-upsert imports", () => {
    expect(isAutoRetrySafe("import_gs1_email_daily_batch")).toBe(true);
    expect(isAutoRetrySafe("import_clovia_email_daily_batch")).toBe(true);
  });

  it("never allows imports that move pay, leave or master data, or that insert plain rows", () => {
    for (const rpc of [
      "import_leave_application_batch",
      "import_attendance_regularization_batch",
      "import_incentive_bulk_batch",
      "import_deduction_bulk_batch",
      "import_upload_batch",
      "import_bb_sale_masmis_batch",
      "import_owner_sale_batch",
      null,
      undefined,
      "",
    ]) {
      expect(isAutoRetrySafe(rpc as string)).toBe(false);
    }
    expect(
      [...AUTO_RETRY_SAFE_RPCS].every((r) =>
        /^import_[a-z0-9_]+_batch$/.test(r),
      ),
    ).toBe(true);
  });
});

describe("killStuckRowSessions", () => {
  it("asks only for this app's own sessions writing upload_batch_row, older than the threshold", async () => {
    query.mockResolvedValueOnce([[]]);
    await killStuckRowSessions();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("USER = SUBSTRING_INDEX(USER(), '@', 1)");
    expect(sql).toContain("UPDATE upload_batch_row%");
    expect(sql).toContain("INSERT INTO upload_batch_row%");
    expect(sql).toContain("ID <> CONNECTION_ID()");
    expect(params).toEqual([STUCK_SESSION_SECONDS]);
    expect(STUCK_SESSION_SECONDS).toBe(15 * 60);
  });

  it("ends each stuck session by validated integer id and alerts admins", async () => {
    query
      .mockResolvedValueOnce([[{ ID: 364399, TIME: 7200 }]])
      .mockResolvedValueOnce([{}]);
    const killed = await killStuckRowSessions();
    expect(killed).toEqual([364399]);
    expect(query.mock.calls[1][0]).toBe("KILL 364399");
    expect(alertAdmins).toHaveBeenCalledOnce();
  });

  it("ignores a row whose id is not a positive integer", async () => {
    query.mockResolvedValueOnce([[{ ID: "1; DROP TABLE x", TIME: 9999 }]]);
    expect(await killStuckRowSessions()).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("requeueTransientFailures", () => {
  it("re-queues a safe import that failed on a lock, counting the attempt", async () => {
    query.mockResolvedValueOnce([[failed()]]);
    execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{}]);
    const r = await requeueTransientFailures();
    expect(r.requeued).toEqual(["BATCH-1"]);
    expect(execute.mock.calls[0][0]).toContain(
      "WHERE id = ? AND batch_status = 'failed'",
    );
    expect(execute.mock.calls[0][1]).toContain(1);
    expect(execute.mock.calls[1][0]).toContain("INSERT INTO bulk_import_queue");
    expect(execute.mock.calls[1][1]).toEqual([
      "b1",
      "import_gs1_email_daily_batch",
      "u2",
    ]);
  });

  it("stops at the retry cap and alerts instead", async () => {
    expect(MAX_AUTO_RETRIES).toBe(2);
    query.mockResolvedValueOnce([[failed({ retries: 2 })]]);
    const r = await requeueTransientFailures();
    expect(r.requeued).toEqual([]);
    expect(r.needsHuman).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
    expect(alertAdmins).toHaveBeenCalledOnce();
  });

  it("does not re-run an import that is not marked safe, and alerts", async () => {
    query.mockResolvedValueOnce([
      [failed({ rpc: "import_leave_application_batch" })],
    ]);
    const r = await requeueTransientFailures();
    expect(r.requeued).toEqual([]);
    expect(r.needsHuman[0].reason).toContain("not marked safe");
    expect(execute).not.toHaveBeenCalled();
  });

  it("alerts for a batch with no recorded import function instead of guessing", async () => {
    query.mockResolvedValueOnce([[failed({ rpc: null })]]);
    const r = await requeueTransientFailures();
    expect(r.needsHuman[0].reason).toContain("import function is unknown");
    expect(execute).not.toHaveBeenCalled();
  });

  it("leaves non-transient failures alone", async () => {
    query.mockResolvedValueOnce([
      [failed({ error_summary: "Unknown column 'x'" })],
    ]);
    const r = await requeueTransientFailures();
    expect(r).toEqual({ requeued: [], needsHuman: [] });
    expect(execute).not.toHaveBeenCalled();
    expect(alertAdmins).not.toHaveBeenCalled();
  });

  it("does not queue twice when the batch changed state between scan and claim", async () => {
    query.mockResolvedValueOnce([[failed()]]);
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const r = await requeueTransientFailures();
    expect(r.requeued).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
