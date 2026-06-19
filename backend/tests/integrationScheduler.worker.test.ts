import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
}));

vi.mock("../src/modules/integration-hub/connectorRunner.js", () => ({
  executeConnector: vi.fn(),
}));

import { db } from "../src/db/mysql.js";
import { executeConnector } from "../src/modules/integration-hub/connectorRunner.js";
import {
  initializeIntegrationSchedules,
  runDueIntegrationSchedule,
} from "../src/workers/integration-scheduler.worker.js";

const mockGetConnection = db.getConnection as ReturnType<typeof vi.fn>;
const mockDbExecute = db.execute as ReturnType<typeof vi.fn>;
const mockExecuteConnector = executeConnector as ReturnType<typeof vi.fn>;

const dueSchedule = {
  id: "connector-1",
  integration_key: "dialer_1",
  integration_name: "Dialer 1",
  integration_type: "rest_pull",
  vendor_name: null,
  base_url: "https://example.test/data",
  auth_type: null,
  secret_name: null,
  config_json: null,
  active_status: 1,
  notes: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  cron_expression: "*/5 * * * *",
  enabled: 1,
  last_run_at: null,
  next_run_at: null,
};

describe("Integration Hub scheduler worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims a due schedule and runs it without a logged-in user", async () => {
    const connection = {
      execute: vi.fn()
        .mockResolvedValueOnce([[{ acquired: 1 }], []])
        .mockResolvedValueOnce([[dueSchedule], []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([[{ released: 1 }], []]),
      release: vi.fn(),
    };
    mockGetConnection.mockResolvedValue(connection);
    mockExecuteConnector.mockResolvedValue({
      run_id: "run-1",
      rows_fetched: 10,
      rows_promoted: 10,
      rows_failed: 0,
      status: "complete",
    });

    await expect(runDueIntegrationSchedule("dialer_1")).resolves.toBe(true);
    expect(mockExecuteConnector).toHaveBeenCalledWith(
      expect.objectContaining({ integration_key: "dialer_1" }),
      null,
      {},
      "schedule",
    );
    expect(connection.execute.mock.calls[2][0]).toMatch(/SET next_run_at/i);
    expect(connection.execute.mock.calls[3][0]).toMatch(/SET last_run_at/i);
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("does not run when another backend process owns the connector lock", async () => {
    const connection = {
      execute: vi.fn()
        .mockResolvedValueOnce([[{ acquired: 0 }], []])
        .mockResolvedValueOnce([[{ released: 0 }], []]),
      release: vi.fn(),
    };
    mockGetConnection.mockResolvedValue(connection);

    await expect(runDueIntegrationSchedule("dialer_1")).resolves.toBe(false);
    expect(mockExecuteConnector).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("initializes legacy enabled schedules without executing them immediately", async () => {
    mockDbExecute
      .mockResolvedValueOnce([[
        { integration_key: "dialer_1", cron_expression: "*/5 * * * *" },
      ], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await expect(initializeIntegrationSchedules()).resolves.toBe(1);
    expect(mockDbExecute.mock.calls[1][0]).toMatch(/SET next_run_at/i);
    expect(mockExecuteConnector).not.toHaveBeenCalled();
  });
});
