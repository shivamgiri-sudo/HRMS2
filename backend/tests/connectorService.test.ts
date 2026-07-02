import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));
vi.mock("../src/modules/integration-hub/integration.service.js", () => ({
  integrationService: {
    getByKey: vi.fn(),
    listFieldMaps: vi.fn(),
    createRun: vi.fn(),
  },
}));
vi.mock("../src/modules/integration-hub/schemaAnalyzer.js", () => ({
  analyzeSchema: vi.fn(),
}));
vi.mock("../src/modules/integration-hub/promotionEngine.js", () => ({
  promoteRows: vi.fn(),
}));

import { db } from "../src/db/mysql.js";
import { integrationService } from "../src/modules/integration-hub/integration.service.js";
import { analyzeSchema } from "../src/modules/integration-hub/schemaAnalyzer.js";
import { promoteRows } from "../src/modules/integration-hub/promotionEngine.js";
import { runConnector } from "../src/modules/integration-hub/connectorService.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetByKey = integrationService.getByKey as ReturnType<typeof vi.fn>;
const mockListFieldMaps = integrationService.listFieldMaps as ReturnType<typeof vi.fn>;
const mockCreateRun = integrationService.createRun as ReturnType<typeof vi.fn>;
const mockAnalyze = analyzeSchema as ReturnType<typeof vi.fn>;
const mockPromote = promoteRows as ReturnType<typeof vi.fn>;

const fakeConfig = {
  id: "cfg-1",
  integration_key: "dialer_1",
  integration_name: "Dialer 1",
  integration_type: "file_upload",
  vendor_name: null,
  base_url: null,
  auth_type: "none",
  secret_name: null,
  config_json: null,
  active_status: 1,
  notes: null,
};

const fakeRun = { id: "run-1", integration_key: "dialer_1", status: "running" };

const rawPayload = [
  { emp_id: "EMP001", login_date: "2026-05-20", login_minutes: 480 },
];

const fakeFieldMaps = [
  { id: "m1", integration_key: "dialer_1", source_field: "emp_id", target_table: "dialer_session_log", target_column: "employee_code", transform: null, confirmed_by: "u1", confirmed_at: "2026-05-01", active_status: 1, created_at: "2026-05-01" },
];

describe("runConnector", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a run record at start", async () => {
    mockGetByKey.mockResolvedValue(fakeConfig);
    mockCreateRun.mockResolvedValue(fakeRun);
    mockListFieldMaps.mockResolvedValue(fakeFieldMaps);
    mockAnalyze.mockReturnValue([{ name: "emp_id", type: "string", nullable: false, sample_values: ["EMP001"] }]);
    mockPromote.mockResolvedValue({ promoted: 1, failed: 0 });
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    await runConnector("dialer_1", rawPayload, "user-1");
    expect(mockCreateRun).toHaveBeenCalledWith("dialer_1", "manual", "user-1");
  });

  it("stores raw payload in integration_raw_payload", async () => {
    mockGetByKey.mockResolvedValue(fakeConfig);
    mockCreateRun.mockResolvedValue(fakeRun);
    mockListFieldMaps.mockResolvedValue(fakeFieldMaps);
    mockAnalyze.mockReturnValue([]);
    mockPromote.mockResolvedValue({ promoted: 0, failed: 0 });
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    await runConnector("dialer_1", rawPayload, "user-1");
    const calls = mockExecute.mock.calls.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) => sql as string);
    expect(calls.some((s: string) => /integration_raw_payload/i.test(s))).toBe(true);
  });

  it("stores schema snapshot", async () => {
    mockGetByKey.mockResolvedValue(fakeConfig);
    mockCreateRun.mockResolvedValue(fakeRun);
    mockListFieldMaps.mockResolvedValue(fakeFieldMaps);
    mockAnalyze.mockReturnValue([{ name: "emp_id", type: "string", nullable: false, sample_values: [] }]);
    mockPromote.mockResolvedValue({ promoted: 1, failed: 0 });
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    await runConnector("dialer_1", rawPayload, "user-1");
    const calls = mockExecute.mock.calls.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) => sql as string);
    expect(calls.some((s: string) => /integration_schema_snapshot/i.test(s))).toBe(true);
  });

  it("generates suggestions for unmapped fields", async () => {
    mockGetByKey.mockResolvedValue(fakeConfig);
    mockCreateRun.mockResolvedValue(fakeRun);
    mockListFieldMaps.mockResolvedValue([]); // no confirmed maps
    mockAnalyze.mockReturnValue([{ name: "emp_id", type: "string", nullable: false, sample_values: [] }]);
    mockPromote.mockResolvedValue({ promoted: 0, failed: 0 });
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    await runConnector("dialer_1", rawPayload, "user-1");
    const calls = mockExecute.mock.calls.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) => sql as string);
    expect(calls.some((s: string) => /integration_field_map_suggestion/i.test(s))).toBe(true);
  });

  it("calls promoteRows with confirmed field maps", async () => {
    mockGetByKey.mockResolvedValue(fakeConfig);
    mockCreateRun.mockResolvedValue(fakeRun);
    mockListFieldMaps.mockResolvedValue(fakeFieldMaps);
    mockAnalyze.mockReturnValue([]);
    mockPromote.mockResolvedValue({ promoted: 1, failed: 0 });
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    await runConnector("dialer_1", rawPayload, "user-1");
    expect(mockPromote).toHaveBeenCalledWith("dialer_1", rawPayload, fakeFieldMaps, "run-1");
  });

  it("updates run to complete with row counts", async () => {
    mockGetByKey.mockResolvedValue(fakeConfig);
    mockCreateRun.mockResolvedValue(fakeRun);
    mockListFieldMaps.mockResolvedValue(fakeFieldMaps);
    mockAnalyze.mockReturnValue([]);
    mockPromote.mockResolvedValue({ promoted: 1, failed: 0 });
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    await runConnector("dialer_1", rawPayload, "user-1");
    const calls = mockExecute.mock.calls.map(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) => sql as string);
    const updateCall = calls.find((s: string) => /UPDATE.*integration_connector_run/i.test(s));
    expect(updateCall).toBeDefined();
  });

  it("marks run as failed when promoteRows throws", async () => {
    mockGetByKey.mockResolvedValue(fakeConfig);
    mockCreateRun.mockResolvedValue(fakeRun);
    mockListFieldMaps.mockResolvedValue(fakeFieldMaps);
    mockAnalyze.mockReturnValue([]);
    mockPromote.mockRejectedValue(new Error("DB exploded"));
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    await runConnector("dialer_1", rawPayload, "user-1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = mockExecute.mock.calls.map(([sql]: any) => sql as string);
    const failUpdate = calls.find((s: string) => /UPDATE.*integration_connector_run/i.test(s));
    expect(failUpdate).toBeDefined();
  });

  it("returns summary with row counts", async () => {
    mockGetByKey.mockResolvedValue(fakeConfig);
    mockCreateRun.mockResolvedValue(fakeRun);
    mockListFieldMaps.mockResolvedValue(fakeFieldMaps);
    mockAnalyze.mockReturnValue([]);
    mockPromote.mockResolvedValue({ promoted: 3, failed: 1 });
    mockExecute.mockResolvedValue([{ affectedRows: 1 }]);

    const result = await runConnector("dialer_1", rawPayload, "user-1");
    expect(result.rows_fetched).toBe(rawPayload.length);
    expect(result.rows_promoted).toBe(3);
    expect(result.rows_failed).toBe(1);
    expect(result.run_id).toBe("run-1");
  });
});
