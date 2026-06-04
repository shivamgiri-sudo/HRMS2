import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]), getConnection: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

import { db } from "../src/db/mysql.js";
import { integrationService } from "../src/modules/integration-hub/integration.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const fakeConfig = {
  id: "cfg-1",
  integration_key: "dialer_1",
  integration_name: "Dialer 1",
  integration_type: "rest_pull",
  vendor_name: null,
  base_url: null,
  auth_type: "api_key",
  secret_name: null,
  config_json: null,
  active_status: 1,
  notes: "First dialer",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

const fakeRun = {
  id: "run-1",
  integration_key: "dialer_1",
  triggered_by: "manual",
  triggered_user: "user-1",
  status: "complete",
  rows_fetched: 100,
  rows_staged: 100,
  rows_promoted: 98,
  rows_failed: 2,
  duration_ms: 1234,
  error_message: null,
  started_at: "2026-05-01T10:00:00Z",
  completed_at: "2026-05-01T10:00:01Z",
};

const fakeFieldMap = {
  id: "map-1",
  integration_key: "dialer_1",
  source_field: "emp_id",
  target_table: "employees",
  target_column: "employee_code",
  transform: null,
  confirmed_by: "user-1",
  confirmed_at: "2026-05-01T00:00:00Z",
  active_status: 1,
  created_at: "2026-05-01T00:00:00Z",
};

describe("integrationService.list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all integrations", async () => {
    mockExecute.mockResolvedValueOnce([[fakeConfig], []]);
    const result = await integrationService.list();
    expect(result).toHaveLength(1);
    expect(result[0].integration_key).toBe("dialer_1");
  });

  it("filters by activeStatus when provided", async () => {
    mockExecute.mockResolvedValueOnce([[fakeConfig], []]);
    await integrationService.list({ activeStatus: "active" });
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/active_status\s*=\s*1/i);
  });
});

describe("integrationService.getByKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns integration when found", async () => {
    mockExecute.mockResolvedValueOnce([[fakeConfig], []]);
    const result = await integrationService.getByKey("dialer_1");
    expect(result.integration_key).toBe("dialer_1");
  });

  it("throws when not found", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await expect(integrationService.getByKey("no_such_key")).rejects.toThrow(
      "Integration not found"
    );
  });
});

describe("integrationService.create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when integration_key already exists", async () => {
    mockExecute.mockResolvedValueOnce([[fakeConfig], []]); // duplicate check
    await expect(
      integrationService.create(
        { integrationKey: "dialer_1", integrationName: "Dup", integrationType: "rest_pull" },
        "user-1"
      )
    ).rejects.toThrow("Integration key already exists");
  });

  it("creates and returns new integration", async () => {
    mockExecute.mockResolvedValueOnce([[], []]); // no duplicate
    mockExecute.mockResolvedValueOnce([{ insertId: 0 }, []]); // INSERT
    mockExecute.mockResolvedValueOnce([[fakeConfig], []]); // re-fetch
    const result = await integrationService.create(
      { integrationKey: "dialer_3", integrationName: "Dialer 3", integrationType: "rest_pull" },
      "user-1"
    );
    expect(result.integration_key).toBe("dialer_1"); // returned from re-fetch mock
  });
});

describe("integrationService.update", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when integration not found", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await expect(
      integrationService.update("missing_key", { integrationName: "X" }, "user-1")
    ).rejects.toThrow("Integration not found");
  });

  it("updates and returns integration", async () => {
    mockExecute.mockResolvedValueOnce([[fakeConfig], []]); // getByKey
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE
    mockExecute.mockResolvedValueOnce([[{ ...fakeConfig, integration_name: "Updated" }], []]); // re-fetch
    const result = await integrationService.update("dialer_1", { integrationName: "Updated" }, "user-1");
    expect(result.integration_name).toBe("Updated");
  });
});

describe("integrationService.listRuns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated runs", async () => {
    mockExecute.mockResolvedValueOnce([[fakeRun], []]);
    mockExecute.mockResolvedValueOnce([[{ total: 1 }], []]);
    const result = await integrationService.listRuns({ page: 1, limit: 20 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  it("filters runs by integrationKey", async () => {
    mockExecute.mockResolvedValueOnce([[fakeRun], []]);
    mockExecute.mockResolvedValueOnce([[{ total: 1 }], []]);
    await integrationService.listRuns({ integrationKey: "dialer_1", page: 1, limit: 20 });
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/integration_key/i);
  });
});

describe("integrationService.listFieldMaps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns field maps for an integration", async () => {
    mockExecute.mockResolvedValueOnce([[fakeFieldMap], []]);
    const result = await integrationService.listFieldMaps("dialer_1");
    expect(result).toHaveLength(1);
    expect(result[0].source_field).toBe("emp_id");
  });
});

describe("integrationService.confirmFieldMap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts field map and returns it", async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPSERT
    mockExecute.mockResolvedValueOnce([[fakeFieldMap], []]); // re-fetch
    const result = await integrationService.confirmFieldMap(
      {
        integrationKey: "dialer_1",
        sourceField: "emp_id",
        targetTable: "employees",
        targetColumn: "employee_code",
      },
      "user-1"
    );
    expect(result.source_field).toBe("emp_id");
  });
});

describe("integrationService.listSuggestions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns pending suggestions for an integration", async () => {
    const fakeSuggestion = {
      id: "sug-1",
      integration_key: "dialer_1",
      source_field: "branch_code",
      suggested_table: null,
      suggested_column: null,
      confidence_score: 0,
      status: "pending",
      created_at: "2026-05-01T00:00:00Z",
    };
    mockExecute.mockResolvedValueOnce([[fakeSuggestion], []]);
    const result = await integrationService.listSuggestions("dialer_1");
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("pending");
  });
});

describe("integrationService.createRun", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a new run and returns it", async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // INSERT
    mockExecute.mockResolvedValueOnce([[fakeRun], []]); // re-fetch by id
    const result = await integrationService.createRun("dialer_1", "manual", "user-1");
    expect(result.integration_key).toBe("dialer_1");
    expect(result.triggered_by).toBe("manual");
  });
});
