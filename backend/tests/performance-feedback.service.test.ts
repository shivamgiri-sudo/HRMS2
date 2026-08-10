import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module before importing the service
vi.mock("../src/db/mysql", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([[], []]),
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

describe("PerformanceFeedbackService - Competency Management", () => {
  let service: PerformanceFeedbackService;

  beforeEach(() => {
    service = new PerformanceFeedbackService();
    vi.clearAllMocks();
  });

  describe("getCompetencies", () => {
    it("should get all active competencies", async () => {
      const mockCompetencies = [
        {
          competency_id: 1,
          competency_name: "Communication",
          description: "Clear communication",
          category: "core",
          is_active: true,
        },
        {
          competency_id: 2,
          competency_name: "Teamwork",
          description: "Works well with team",
          category: "core",
          is_active: true,
        },
      ];

      mockDb.execute.mockResolvedValueOnce([mockCompetencies, []]);

      const competencies = await service.getCompetencies({ is_active: true });

      expect(Array.isArray(competencies)).toBe(true);
      expect(competencies.length).toBe(2);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("SELECT * FROM competency_master"),
        expect.any(Array)
      );
    });

    it("should filter by category", async () => {
      const mockCompetencies = [
        {
          competency_id: 1,
          competency_name: "Leadership",
          category: "leadership",
        },
      ];

      mockDb.execute.mockResolvedValueOnce([mockCompetencies, []]);

      const competencies = await service.getCompetencies({
        category: "leadership",
      });

      expect(Array.isArray(competencies)).toBe(true);
    });
  });

  describe("createCompetency", () => {
    it("should create new competency", async () => {
      const competencyData = {
        competency_name: "Innovation",
        description: "Creative thinking",
        category: "behavioral",
        display_order: 5,
      };

      const mockCompetency = {
        competency_id: 11,
        competency_name: "Innovation",
        description: "Creative thinking",
        category: "behavioral",
        display_order: 5,
        is_active: true,
      };

      mockDb.execute
        .mockResolvedValueOnce([{ insertId: 11 }, []]) // INSERT
        .mockResolvedValueOnce([[mockCompetency], []]); // SELECT

      const result = await service.createCompetency(competencyData);

      expect(result).toBeDefined();
      expect(result.competency_id).toBe(11);
      expect(result.competency_name).toBe("Innovation");
    });
  });

  describe("updateCompetency", () => {
    it("should update competency fields", async () => {
      mockDb.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      await service.updateCompetency("comp-1", {
        competency_name: "Updated Name",
        description: "Updated description",
      });

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE competency_master"),
        expect.any(Array)
      );
    });
  });

  describe("deactivateCompetency", () => {
    it("should deactivate competency (soft delete)", async () => {
      mockDb.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      await service.deactivateCompetency("comp-123");

      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE competency_master SET is_active = 0 WHERE competency_id = ?",
        ["comp-123"]
      );
    });
  });
});

describe("PerformanceFeedbackService - Feedback Form & Submission", () => {
  let service: PerformanceFeedbackService;

  beforeEach(() => {
    service = new PerformanceFeedbackService();
    vi.clearAllMocks();
  });

  describe("getFormTemplate", () => {
    it("should get form template with employee, competencies, and KPIs", async () => {
      const mockRequest = {
        request_id: "req-123",
        cycle_id: "cycle-456",
        employee_id: "emp-789",
        manager_id: "mgr-111",
        status: "pending",
      };

      const mockEmployee = {
        emp_id: "emp-789",
        full_name: "John Doe",
        designation: "Senior Developer",
      };

      const mockCompetencies = [
        {
          competency_id: 1,
          competency_name: "Communication",
          description: "Clear communication",
          category: "core",
          is_active: true,
        },
        {
          competency_id: 2,
          competency_name: "Teamwork",
          description: "Works well with team",
          category: "core",
          is_active: true,
        },
      ];

      const mockKpis = [
        {
          kpi_id: "kpi-1",
          metric_name: "Sales Target",
          target_value: 100,
          actual_value: 95,
          unit: "deals",
        },
      ];

      // Mock getRequestById
      mockDb.execute
        .mockResolvedValueOnce([[mockRequest], []]) // getRequestById
        .mockResolvedValueOnce([[mockEmployee], []]) // employee query
        .mockResolvedValueOnce([mockCompetencies, []]) // competencies query
        .mockResolvedValueOnce([mockKpis, []]); // KPIs query

      const result = await service.getFormTemplate("req-123");

      expect(result).toBeDefined();
      expect(result.employee).toEqual({
        emp_id: "emp-789",
        full_name: "John Doe",
        designation: "Senior Developer",
      });
      expect(result.competencies).toHaveLength(2);
      expect(result.kpis).toHaveLength(1);
      expect(mockDb.execute).toHaveBeenCalledTimes(4);
    });

    it("should throw error if request not found", async () => {
      mockDb.execute.mockResolvedValueOnce([[], []]); // getRequestById returns empty

      await expect(service.getFormTemplate("non-existent")).rejects.toThrow(
        "Request not found"
      );
    });

    it("should throw error if employee not found", async () => {
      const mockRequest = {
        request_id: "req-123",
        cycle_id: "cycle-456",
        employee_id: "emp-789",
        manager_id: "mgr-111",
        status: "pending",
      };

      mockDb.execute
        .mockResolvedValueOnce([[mockRequest], []]) // getRequestById
        .mockResolvedValueOnce([[], []]); // employee not found

      await expect(service.getFormTemplate("req-123")).rejects.toThrow(
        "Employee not found"
      );
    });
  });

  describe("submitFeedback", () => {
    it("should submit feedback and update request status", async () => {
      const feedbackData = {
        request_id: "req-123",
        ratings_json: {
          competencies: [
            {
              competency_id: "1",
              competency_name: "Communication",
              rating: 4,
              comment: "Good communicator",
            },
          ],
          kpis: [],
        },
        overall_strengths: "Strong team player",
        development_areas: "Time management",
      };

      const mockRequest = {
        request_id: "req-123",
        cycle_id: "cycle-456",
        employee_id: "emp-789",
        manager_id: "mgr-111",
        status: "pending",
      };

      // Mock getRequestById
      mockDb.execute
        .mockResolvedValueOnce([[mockRequest], []]) // getRequestById
        .mockResolvedValueOnce([[], []]) // check existing response (none)
        .mockResolvedValueOnce([{ insertId: "response-123" }, []]) // INSERT response
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE request status

      const result = await service.submitFeedback(feedbackData, "mgr-111");

      expect(result).toBeDefined();
      expect(result.response_id).toBe("response-123");
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE performance_feedback_request SET status = 'submitted'"),
        ["req-123"]
      );
    });

    it("should throw error if request not found", async () => {
      const feedbackData = {
        request_id: "non-existent",
        ratings_json: { competencies: [], kpis: [] },
      };

      mockDb.execute.mockResolvedValueOnce([[], []]); // getRequestById returns empty

      await expect(
        service.submitFeedback(feedbackData, "mgr-111")
      ).rejects.toThrow("Request not found");
    });

    it("should throw error if manager unauthorized", async () => {
      const feedbackData = {
        request_id: "req-123",
        ratings_json: { competencies: [], kpis: [] },
      };

      const mockRequest = {
        request_id: "req-123",
        cycle_id: "cycle-456",
        employee_id: "emp-789",
        manager_id: "mgr-111",
        status: "pending",
      };

      mockDb.execute.mockResolvedValueOnce([[mockRequest], []]); // getRequestById

      await expect(
        service.submitFeedback(feedbackData, "wrong-manager")
      ).rejects.toThrow("Unauthorized: not assigned manager");
    });

    it("should update existing response if already submitted", async () => {
      const feedbackData = {
        request_id: "req-123",
        ratings_json: {
          competencies: [
            {
              competency_id: "1",
              competency_name: "Communication",
              rating: 5,
              comment: "Excellent",
            },
          ],
          kpis: [],
        },
        overall_strengths: "Leadership",
        development_areas: "None",
      };

      const mockRequest = {
        request_id: "req-123",
        cycle_id: "cycle-456",
        employee_id: "emp-789",
        manager_id: "mgr-111",
        status: "submitted",
      };

      const mockExistingResponse = {
        response_id: "response-existing",
        request_id: "req-123",
      };

      mockDb.execute
        .mockResolvedValueOnce([[mockRequest], []]) // getRequestById
        .mockResolvedValueOnce([[mockExistingResponse], []]) // existing response found
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // UPDATE response
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE request status

      const result = await service.submitFeedback(feedbackData, "mgr-111");

      expect(result).toBeDefined();
      expect(result.response_id).toBe("response-existing");
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE performance_feedback_response"),
        expect.any(Array)
      );
    });
  });
});

describe("PerformanceFeedbackService - Report Generation", () => {
  let service: PerformanceFeedbackService;

  beforeEach(() => {
    service = new PerformanceFeedbackService();
    vi.clearAllMocks();
  });

  describe("generateReport", () => {
    it("should generate report with aggregated scores and create training needs for low scores", async () => {
      const mockRequest = {
        request_id: "req-123",
        cycle_id: "cycle-456",
        employee_id: "emp-789",
        manager_id: "mgr-111",
        status: "submitted",
      };

      const mockResponse = {
        response_id: "response-123",
        request_id: "req-123",
        ratings_json: JSON.stringify({
          competencies: [
            { competency_id: "1", competency_name: "Communication", rating: 4.5, comment: "Excellent" },
            { competency_id: "2", competency_name: "Teamwork", rating: 2.5, comment: "Needs work" },
            { competency_id: "3", competency_name: "Problem Solving", rating: 3.5, comment: "Good" },
          ],
          kpis: [
            { kpi_id: "kpi-1", kpi_name: "Sales Target", rating: 4.0, comment: "Met target" },
          ],
        }),
        overall_strengths: "Communication, Sales",
        development_areas: "Teamwork needs improvement",
        submitted_at: "2026-05-31T00:00:00Z",
      };

      const mockCompetency = {
        competency_id: "2",
        competency_name: "Teamwork",
        category: "core",
      };

      const aggregatedData = {
        competency_scores: [
          { competency_id: "1", competency_name: "Communication", score: 4.5 },
          { competency_id: "2", competency_name: "Teamwork", score: 2.5 },
          { competency_id: "3", competency_name: "Problem Solving", score: 3.5 },
        ],
        kpi_scores: [
          { kpi_id: "kpi-1", kpi_name: "Sales Target", score: 4.0 },
        ],
        overall_score: 3.63, // (4.5 + 2.5 + 3.5 + 4.0) / 4
      };

      mockDb.execute
        .mockResolvedValueOnce([[mockRequest], []]) // getRequestById
        .mockResolvedValueOnce([[mockResponse], []]) // get response
        .mockResolvedValueOnce([[], []]) // check existing report (none)
        .mockResolvedValueOnce([{ insertId: "report-123" }, []]) // INSERT report
        .mockResolvedValueOnce([[mockCompetency], []]) // get competency for training need
        .mockResolvedValueOnce([{ insertId: "training-need-1" }, []]); // INSERT training need

      const result = await service.generateReport("req-123");

      expect(result).toBeDefined();
      expect(result.report_id).toBe("report-123");
      expect(result.training_need_ids).toEqual(["training-need-1"]);

      // Verify report INSERT was called with cycle_id, employee_id, overall_score
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO performance_feedback_report"),
        expect.arrayContaining([
          "cycle-456", // cycle_id
          "emp-789", // employee_id
          expect.any(Number), // overall_score
        ])
      );

      // Verify training need INSERT was called for low score (2.5 < 3.0)
      const trainingNeedCalls = (mockDb.execute as any).mock.calls.filter(
        (call: any) => call[0]?.includes("INSERT INTO training_need")
      );
      expect(trainingNeedCalls.length).toBe(1);
      expect(trainingNeedCalls[0][1]).toEqual([
        "emp-789",
        "Teamwork",
        "Teamwork needs improvement",
      ]);
    });

    it("should update existing report if already generated", async () => {
      const mockRequest = {
        request_id: "req-123",
        cycle_id: "cycle-456",
        employee_id: "emp-789",
        manager_id: "mgr-111",
        status: "submitted",
      };

      const mockResponse = {
        response_id: "response-123",
        request_id: "req-123",
        ratings_json: JSON.stringify({
          competencies: [
            { competency_id: "1", competency_name: "Communication", rating: 5.0, comment: "Perfect" },
          ],
          kpis: [],
        }),
        overall_strengths: "All areas strong",
        development_areas: "",
        submitted_at: "2026-05-31T00:00:00Z",
      };

      const mockExistingReport = {
        report_id: "report-existing",
        request_id: "req-123",
      };

      mockDb.execute
        .mockResolvedValueOnce([[mockRequest], []]) // getRequestById
        .mockResolvedValueOnce([[mockResponse], []]) // get response
        .mockResolvedValueOnce([[mockExistingReport], []]) // existing report found
        .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE report

      const result = await service.generateReport("req-123");

      expect(result.report_id).toBe("report-existing");
      expect(result.training_need_ids).toEqual([]); // no low scores

      // Verify UPDATE was called
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE performance_feedback_report"),
        expect.any(Array)
      );
    });

    it("should throw error if request not found", async () => {
      mockDb.execute.mockResolvedValueOnce([[], []]); // getRequestById returns empty

      await expect(service.generateReport("non-existent")).rejects.toThrow(
        "Request not found"
      );
    });

    it("should throw error if response not submitted", async () => {
      const mockRequest = {
        request_id: "req-123",
        cycle_id: "cycle-456",
        employee_id: "emp-789",
        manager_id: "mgr-111",
        status: "submitted",
      };

      mockDb.execute
        .mockResolvedValueOnce([[mockRequest], []])
        .mockResolvedValueOnce([[], []]); // no response found

      await expect(service.generateReport("req-123")).rejects.toThrow(
        "Response not found"
      );
    });

    it("should create multiple training needs for multiple low scores", async () => {
      const mockRequest = {
        request_id: "req-123",
        cycle_id: "cycle-456",
        employee_id: "emp-789",
        manager_id: "mgr-111",
        status: "submitted",
      };

      const mockResponse = {
        response_id: "response-123",
        request_id: "req-123",
        ratings_json: JSON.stringify({
          competencies: [
            { competency_id: "1", competency_name: "Communication", rating: 2.0, comment: "Poor" },
            { competency_id: "2", competency_name: "Teamwork", rating: 2.8, comment: "Below avg" },
            { competency_id: "3", competency_name: "Leadership", rating: 4.5, comment: "Great" },
          ],
          kpis: [],
        }),
        overall_strengths: "Leadership",
        development_areas: "Communication and Teamwork need significant improvement",
        submitted_at: "2026-05-31T00:00:00Z",
      };

      const mockCompetency1 = { competency_id: "1", competency_name: "Communication", category: "core" };
      const mockCompetency2 = { competency_id: "2", competency_name: "Teamwork", category: "core" };

      mockDb.execute
        .mockResolvedValueOnce([[mockRequest], []]) // getRequestById
        .mockResolvedValueOnce([[mockResponse], []]) // get response
        .mockResolvedValueOnce([[], []]) // check existing report (none)
        .mockResolvedValueOnce([{ insertId: "report-123" }, []]) // INSERT report
        .mockResolvedValueOnce([[mockCompetency1], []]) // get competency 1
        .mockResolvedValueOnce([{ insertId: "training-need-1" }, []]) // INSERT training need 1
        .mockResolvedValueOnce([[mockCompetency2], []]) // get competency 2
        .mockResolvedValueOnce([{ insertId: "training-need-2" }, []]); // INSERT training need 2

      const result = await service.generateReport("req-123");

      expect(result.training_need_ids).toHaveLength(2);
      expect(result.training_need_ids).toEqual(["training-need-1", "training-need-2"]);
    });

    it("should not create training needs if all scores >= 3.0", async () => {
      const mockRequest = {
        request_id: "req-123",
        cycle_id: "cycle-456",
        employee_id: "emp-789",
        manager_id: "mgr-111",
        status: "submitted",
      };

      const mockResponse = {
        response_id: "response-123",
        request_id: "req-123",
        ratings_json: JSON.stringify({
          competencies: [
            { competency_id: "1", competency_name: "Communication", rating: 4.0, comment: "Good" },
            { competency_id: "2", competency_name: "Teamwork", rating: 3.5, comment: "Solid" },
          ],
          kpis: [
            { kpi_id: "kpi-1", kpi_name: "Sales", rating: 4.5, comment: "Excellent" },
          ],
        }),
        overall_strengths: "All strong",
        development_areas: "",
        submitted_at: "2026-05-31T00:00:00Z",
      };

      mockDb.execute
        .mockResolvedValueOnce([[mockRequest], []])
        .mockResolvedValueOnce([[mockResponse], []])
        .mockResolvedValueOnce([[], []])
        .mockResolvedValueOnce([{ insertId: "report-123" }, []]);

      const result = await service.generateReport("req-123");

      expect(result.training_need_ids).toEqual([]);

      // Verify training_need INSERT was NOT called
      const insertTrainingCalls = (mockDb.execute as any).mock.calls.filter(
        (call: any) => call[0]?.includes("INSERT INTO training_need")
      );
      expect(insertTrainingCalls.length).toBe(0);
    });
  });
});
