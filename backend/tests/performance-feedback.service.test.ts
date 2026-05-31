import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module before importing the service
vi.mock("../src/db/mysql", () => ({
  db: {
    execute: vi.fn(),
    executeRun: vi.fn(),
    end: vi.fn(),
  },
}));

import { db } from "../src/db/mysql";
import { PerformanceFeedbackService } from "../src/modules/performance-feedback/performance-feedback.service";

const mockDb = db as unknown as {
  execute: ReturnType<typeof vi.fn>;
  executeRun: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

describe("PerformanceFeedbackService - Cycle Management", () => {
  let service: PerformanceFeedbackService;

  beforeEach(() => {
    service = new PerformanceFeedbackService();
    vi.clearAllMocks();
  });

  describe("createCycle", () => {
    it("should create a feedback cycle successfully", async () => {
      const cycleData = {
        cycle_name: "Q2 2026 Test Cycle",
        period: "2026-Q2",
        start_date: "2026-04-01",
        end_date: "2026-06-30",
        deadline: "2026-07-07",
      };

      const mockInsertResult = { insertId: "cycle-123" };
      const mockCycle = {
        cycle_id: "cycle-123",
        cycle_name: "Q2 2026 Test Cycle",
        period: "2026-Q2",
        start_date: "2026-04-01",
        end_date: "2026-06-30",
        deadline: "2026-07-07",
        status: "draft",
        feedback_type: "360",
        appraisal_cycle_id: null,
        created_by: "user-1",
        created_at: "2026-05-31T00:00:00Z",
        updated_at: "2026-05-31T00:00:00Z",
      };

      mockDb.execute
        .mockResolvedValueOnce([mockInsertResult, []]) // INSERT
        .mockResolvedValueOnce([[mockCycle], []]); // SELECT

      const result = await service.createCycle(cycleData, "user-1");

      expect(result).toBeDefined();
      expect(result.cycle_id).toBe("cycle-123");
      expect(result.cycle_name).toBe("Q2 2026 Test Cycle");
      expect(result.status).toBe("draft");
      expect(mockDb.execute).toHaveBeenCalledTimes(2);
    });

    it("should create cycle with optional appraisal_cycle_id", async () => {
      const cycleData = {
        cycle_name: "Q3 2026 Test Cycle",
        period: "2026-Q3",
        start_date: "2026-07-01",
        end_date: "2026-09-30",
        deadline: "2026-10-07",
        appraisal_cycle_id: "appr-123",
      };

      const mockInsertResult = { insertId: "cycle-456" };
      const mockCycle = {
        cycle_id: "cycle-456",
        cycle_name: "Q3 2026 Test Cycle",
        period: "2026-Q3",
        start_date: "2026-07-01",
        end_date: "2026-09-30",
        deadline: "2026-10-07",
        status: "draft",
        feedback_type: "360",
        appraisal_cycle_id: "appr-123",
        created_by: "user-1",
        created_at: "2026-05-31T00:00:00Z",
        updated_at: "2026-05-31T00:00:00Z",
      };

      mockDb.execute
        .mockResolvedValueOnce([mockInsertResult, []])
        .mockResolvedValueOnce([[mockCycle], []]);

      const result = await service.createCycle(cycleData, "user-1");

      expect(result.cycle_id).toBe("cycle-456");
      expect(result.appraisal_cycle_id).toBe("appr-123");
    });
  });

  describe("getCycles", () => {
    it("should get all cycles without filters", async () => {
      const mockCycles = [
        {
          cycle_id: "cycle-1",
          cycle_name: "Q1 2026",
          period: "2026-Q1",
          status: "active",
        },
        {
          cycle_id: "cycle-2",
          cycle_name: "Q2 2026",
          period: "2026-Q2",
          status: "draft",
        },
      ];

      mockDb.execute.mockResolvedValueOnce([mockCycles, []]);

      const cycles = await service.getCycles({});

      expect(Array.isArray(cycles)).toBe(true);
      expect(cycles.length).toBe(2);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("SELECT * FROM performance_feedback_cycle"),
        []
      );
    });

    it("should filter cycles by status", async () => {
      const mockCycles = [
        {
          cycle_id: "cycle-1",
          cycle_name: "Q1 2026",
          status: "draft",
        },
      ];

      mockDb.execute.mockResolvedValueOnce([mockCycles, []]);

      const cycles = await service.getCycles({ status: "draft" });

      expect(Array.isArray(cycles)).toBe(true);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("AND status = ?"),
        ["draft"]
      );
    });

    it("should filter cycles by period", async () => {
      const mockCycles = [
        {
          cycle_id: "cycle-4",
          cycle_name: "Q4 2026",
          period: "2026-Q4",
        },
      ];

      mockDb.execute.mockResolvedValueOnce([mockCycles, []]);

      const cycles = await service.getCycles({ period: "2026-Q4" });

      expect(Array.isArray(cycles)).toBe(true);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("AND period LIKE ?"),
        ["%2026-Q4%"]
      );
    });
  });

  describe("getCycleById", () => {
    it("should get cycle by ID", async () => {
      const mockCycle = {
        cycle_id: "cycle-123",
        cycle_name: "Test Cycle",
        status: "active",
      };

      mockDb.execute.mockResolvedValueOnce([[mockCycle], []]);

      const cycle = await service.getCycleById("cycle-123");

      expect(cycle).toBeDefined();
      expect(cycle?.cycle_id).toBe("cycle-123");
      expect(mockDb.execute).toHaveBeenCalledWith(
        "SELECT * FROM performance_feedback_cycle WHERE cycle_id = ?",
        ["cycle-123"]
      );
    });

    it("should return null for non-existent cycle", async () => {
      mockDb.execute.mockResolvedValueOnce([[], []]);

      const cycle = await service.getCycleById("non-existent");

      expect(cycle).toBeNull();
    });
  });

  describe("updateCycle", () => {
    it("should update cycle name", async () => {
      mockDb.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      await service.updateCycle("cycle-123", {
        cycle_name: "Updated Cycle Name",
      });

      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE performance_feedback_cycle SET cycle_name = ? WHERE cycle_id = ?",
        ["Updated Cycle Name", "cycle-123"]
      );
    });

    it("should update multiple fields", async () => {
      mockDb.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      await service.updateCycle("cycle-123", {
        start_date: "2027-04-15",
        end_date: "2027-07-15",
        deadline: "2027-07-22",
      });

      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE performance_feedback_cycle SET start_date = ?, end_date = ?, deadline = ? WHERE cycle_id = ?",
        ["2027-04-15", "2027-07-15", "2027-07-22", "cycle-123"]
      );
    });

    it("should do nothing when no fields provided", async () => {
      await service.updateCycle("cycle-123", {});

      expect(mockDb.execute).not.toHaveBeenCalled();
    });
  });

  describe("closeCycle", () => {
    it("should close cycle (set status to closed)", async () => {
      mockDb.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      await service.closeCycle("cycle-123");

      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE performance_feedback_cycle SET status = 'closed' WHERE cycle_id = ?",
        ["cycle-123"]
      );
    });
  });
});

describe("PerformanceFeedbackService - Request Management", () => {
  let service: PerformanceFeedbackService;

  beforeEach(() => {
    service = new PerformanceFeedbackService();
    vi.clearAllMocks();
  });

  describe("launchCycle", () => {
    it("should launch cycle and create requests for employees", async () => {
      const launchData = {
        employee_ids: ["emp-1", "emp-2", "emp-3"],
      };

      // Mock employees query with managers
      const mockEmployees = [
        { emp_id: "emp-1", reporting_to: "mgr-1" },
        { emp_id: "emp-2", reporting_to: "mgr-1" },
        { emp_id: "emp-3", reporting_to: "mgr-2" },
      ];

      // Mock existing requests check (none exist)
      mockDb.execute
        .mockResolvedValueOnce([[mockEmployees[0]], []]) // emp-1 reporting_to
        .mockResolvedValueOnce([[], []]) // existing request check for emp-1
        .mockResolvedValueOnce([{ insertId: "req-1" }, []]) // INSERT request emp-1
        .mockResolvedValueOnce([[mockEmployees[1]], []]) // emp-2 reporting_to
        .mockResolvedValueOnce([[], []]) // existing request check for emp-2
        .mockResolvedValueOnce([{ insertId: "req-2" }, []]) // INSERT request emp-2
        .mockResolvedValueOnce([[mockEmployees[2]], []]) // emp-3 reporting_to
        .mockResolvedValueOnce([[], []]) // existing request check for emp-3
        .mockResolvedValueOnce([{ insertId: "req-3" }, []]) // INSERT request emp-3
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE cycle status

      const result = await service.launchCycle("cycle-123", launchData);

      expect(result.created).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.total).toBe(3);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE performance_feedback_cycle SET status = 'active'"),
        ["cycle-123"]
      );
    });

    it("should skip employees without managers", async () => {
      const launchData = {
        employee_ids: ["emp-1", "emp-2"],
      };

      mockDb.execute
        .mockResolvedValueOnce([[{ emp_id: "emp-1", reporting_to: "mgr-1" }], []]) // emp-1 has manager
        .mockResolvedValueOnce([[], []]) // no existing request
        .mockResolvedValueOnce([{ insertId: "req-1" }, []]) // INSERT request
        .mockResolvedValueOnce([[], []]) // emp-2 has no manager (empty result)
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE cycle status

      const result = await service.launchCycle("cycle-123", launchData);

      expect(result.created).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.total).toBe(2);
    });

    it("should skip employees with existing requests", async () => {
      const launchData = {
        employee_ids: ["emp-1"],
      };

      mockDb.execute
        .mockResolvedValueOnce([[{ emp_id: "emp-1", reporting_to: "mgr-1" }], []])
        .mockResolvedValueOnce([[{ request_id: "req-existing" }], []]) // existing request found
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE cycle status

      const result = await service.launchCycle("cycle-123", launchData);

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.total).toBe(1);
    });
  });

  describe("getRequests", () => {
    it("should get all requests without filters", async () => {
      const mockRequests = [
        { request_id: "req-1", cycle_id: "cycle-1", status: "pending" },
        { request_id: "req-2", cycle_id: "cycle-1", status: "submitted" },
      ];

      mockDb.execute.mockResolvedValueOnce([mockRequests, []]);

      const requests = await service.getRequests({});

      expect(Array.isArray(requests)).toBe(true);
      expect(requests.length).toBe(2);
    });

    it("should filter requests by cycle_id", async () => {
      const mockRequests = [
        { request_id: "req-1", cycle_id: "cycle-123", status: "pending" },
      ];

      mockDb.execute.mockResolvedValueOnce([mockRequests, []]);

      const requests = await service.getRequests({ cycle_id: "cycle-123" });

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("AND cycle_id = ?"),
        ["cycle-123"]
      );
    });

    it("should filter requests by status", async () => {
      const mockRequests = [
        { request_id: "req-1", status: "submitted" },
      ];

      mockDb.execute.mockResolvedValueOnce([mockRequests, []]);

      const requests = await service.getRequests({ status: "submitted" });

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("AND status = ?"),
        ["submitted"]
      );
    });

    it("should filter requests by manager_id", async () => {
      const mockRequests = [
        { request_id: "req-1", manager_id: "mgr-1" },
      ];

      mockDb.execute.mockResolvedValueOnce([mockRequests, []]);

      const requests = await service.getRequests({ manager_id: "mgr-1" });

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("AND manager_id = ?"),
        ["mgr-1"]
      );
    });

    it("should filter requests by employee_id", async () => {
      const mockRequests = [
        { request_id: "req-1", employee_id: "emp-1" },
      ];

      mockDb.execute.mockResolvedValueOnce([mockRequests, []]);

      const requests = await service.getRequests({ employee_id: "emp-1" });

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("AND employee_id = ?"),
        ["emp-1"]
      );
    });
  });

  describe("getRequestById", () => {
    it("should get request by ID", async () => {
      const mockRequest = {
        request_id: "req-123",
        cycle_id: "cycle-1",
        employee_id: "emp-1",
        status: "pending",
      };

      mockDb.execute.mockResolvedValueOnce([[mockRequest], []]);

      const request = await service.getRequestById("req-123");

      expect(request).toBeDefined();
      expect(request?.request_id).toBe("req-123");
      expect(mockDb.execute).toHaveBeenCalledWith(
        "SELECT * FROM performance_feedback_request WHERE request_id = ?",
        ["req-123"]
      );
    });

    it("should return null for non-existent request", async () => {
      mockDb.execute.mockResolvedValueOnce([[], []]);

      const request = await service.getRequestById("non-existent");

      expect(request).toBeNull();
    });
  });

  describe("deleteRequest", () => {
    it("should delete request by ID", async () => {
      mockDb.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      await service.deleteRequest("req-123");

      expect(mockDb.execute).toHaveBeenCalledWith(
        "DELETE FROM performance_feedback_request WHERE request_id = ?",
        ["req-123"]
      );
    });
  });
});
