import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProcessMaster } from "../src/modules/process/process.types.js";

// Mock the repository selector so we can control what repository is returned
vi.mock("../src/modules/process/process.repository.js", () => ({
  getProcessRepository: vi.fn(),
}));

// Mock supabaseAdmin so env validation doesn't fail
vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

import { getProcessRepository } from "../src/modules/process/process.repository.js";
import { processService } from "../src/modules/process/process.service.js";

const mockRepo = {
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateStatus: vi.fn(),
};

const mockGetRepo = getProcessRepository as ReturnType<typeof vi.fn>;

const fakeProcess: ProcessMaster = {
  id: "proc-1",
  process_code: "IB",
  process_name: "Inbound",
  department_id: null,
  process_type: null,
  branch_name: null,
  location_name: null,
  process_owner_employee_id: null,
  process_manager_employee_id: null,
  active_status: true,
  description: null,
  metadata: {},
  created_by: "user-1",
  updated_by: "user-1",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

describe("processService.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRepo.mockReturnValue(mockRepo);
  });

  it("delegates to repository with filters", async () => {
    mockRepo.list.mockResolvedValueOnce([fakeProcess]);
    const result = await processService.list({ activeStatus: "active" });
    expect(result).toEqual([fakeProcess]);
    expect(mockRepo.list).toHaveBeenCalledWith({ activeStatus: "active" });
  });
});

describe("processService.getById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRepo.mockReturnValue(mockRepo);
  });

  it("returns process when found", async () => {
    mockRepo.getById.mockResolvedValueOnce(fakeProcess);
    const result = await processService.getById("proc-1");
    expect(result).toEqual(fakeProcess);
  });

  it("throws 'Process not found' when repository returns null", async () => {
    mockRepo.getById.mockResolvedValueOnce(null);
    await expect(processService.getById("missing-id")).rejects.toThrow("Process not found");
  });
});

describe("processService.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRepo.mockReturnValue(mockRepo);
  });

  it("creates and returns new process when code is unique", async () => {
    mockRepo.list.mockResolvedValueOnce([]); // no duplicate
    mockRepo.create.mockResolvedValueOnce(fakeProcess);

    const result = await processService.create(
      { processCode: "IB", processName: "Inbound" },
      "user-1"
    );
    expect(result).toEqual(fakeProcess);
    expect(mockRepo.create).toHaveBeenCalledOnce();
  });

  it("throws when process code already exists (case-insensitive)", async () => {
    mockRepo.list.mockResolvedValueOnce([fakeProcess]); // 'IB' already exists

    await expect(
      processService.create({ processCode: "ib", processName: "Inbound 2" }, "user-1")
    ).rejects.toThrow("Process code or process name already exists");

    expect(mockRepo.create).not.toHaveBeenCalled();
  });
});

describe("processService.update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRepo.mockReturnValue(mockRepo);
  });

  it("updates process when it exists", async () => {
    mockRepo.getById.mockResolvedValueOnce(fakeProcess);
    const updated = { ...fakeProcess, process_name: "Inbound Updated" };
    mockRepo.update.mockResolvedValueOnce(updated);

    const result = await processService.update("proc-1", { processName: "Inbound Updated" }, "user-1");
    expect(result.process_name).toBe("Inbound Updated");
  });

  it("throws when process does not exist", async () => {
    mockRepo.getById.mockResolvedValueOnce(null);

    await expect(
      processService.update("missing", { processName: "X" }, "user-1")
    ).rejects.toThrow("Process not found");

    expect(mockRepo.update).not.toHaveBeenCalled();
  });
});

describe("processService.updateStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRepo.mockReturnValue(mockRepo);
  });

  it("deactivates process when it exists", async () => {
    mockRepo.getById.mockResolvedValueOnce(fakeProcess);
    const deactivated = { ...fakeProcess, active_status: false };
    mockRepo.updateStatus.mockResolvedValueOnce(deactivated);

    const result = await processService.updateStatus("proc-1", false, "user-1");
    expect(result.active_status).toBe(false);
  });

  it("throws when process does not exist", async () => {
    mockRepo.getById.mockResolvedValueOnce(null);

    await expect(
      processService.updateStatus("missing", true, "user-1")
    ).rejects.toThrow("Process not found");
  });
});
