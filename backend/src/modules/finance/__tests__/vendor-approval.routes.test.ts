import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { raise, list, approve, reject, getUserBranchId } = vi.hoisted(() => ({
  raise: vi.fn(),
  list: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  getUserBranchId: vi.fn(),
}));

vi.mock("../vendor-approval.service.js", () => ({
  vendorApprovalService: { raise, list, approve, reject },
}));
vi.mock("../finance-access-scope.js", () => ({ getUserBranchId }));

// requireAuth defaults to a "branch_admin" caller so most tests exercise the route logic,
// not the gate; a few probe the role boundaries directly.
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = {
      id: "user-1",
      role: String(req.headers["x-test-role"] ?? "branch_admin"),
    };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole:
    (...roles: string[]) =>
    (req: any, res: any, next: any) => {
      const role = req.authUser?.role;
      if (!role || !roles.includes(role)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      next();
    },
}));

let vendorApprovalRouter: (typeof import("../vendor-approval.routes.js"))["vendorApprovalRouter"];
let app: express.Express;

beforeAll(async () => {
  ({ vendorApprovalRouter } = await import("../vendor-approval.routes.js"));
  app = express();
  app.use(express.json());
  app.use("/api/finance", vendorApprovalRouter);
});

beforeEach(() => {
  raise.mockReset();
  list.mockReset();
  approve.mockReset();
  reject.mockReset();
  getUserBranchId.mockReset();
});

describe("POST /api/finance/vendor-approval/raise", () => {
  it("lets a branch_admin raise a create request scoped to their own branch", async () => {
    getUserBranchId.mockResolvedValueOnce("branch-9");
    raise.mockResolvedValueOnce({ id: "req-1", status: "pending" });

    const res = await request(app)
      .post("/api/finance/vendor-approval/raise")
      .send({
        requestType: "create",
        payload: { vendor_name: "Acme Supplies" },
      });

    expect(res.status).toBe(202);
    expect(raise).toHaveBeenCalledWith({
      requestType: "create",
      vendorId: null,
      payload: { vendor_name: "Acme Supplies" },
      raisedBy: "user-1",
      branchId: "branch-9",
    });
  });

  it("rejects a caller who is not in RAISE_ROLES", async () => {
    const res = await request(app)
      .post("/api/finance/vendor-approval/raise")
      .set("x-test-role", "employee")
      .send({ requestType: "create", payload: { vendor_name: "Acme" } });

    expect(res.status).toBe(403);
    expect(raise).not.toHaveBeenCalled();
  });

  it("returns 400 when requestType or payload is missing", async () => {
    const res = await request(app)
      .post("/api/finance/vendor-approval/raise")
      .send({});
    expect(res.status).toBe(400);
    expect(raise).not.toHaveBeenCalled();
  });
});

describe("GET /api/finance/vendor-approval/requests", () => {
  it("rejects a branch_admin from the review queue (finance_head/super_admin only)", async () => {
    const res = await request(app)
      .get("/api/finance/vendor-approval/requests")
      .set("x-test-role", "branch_admin");

    expect(res.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("allows finance_head and passes filters through", async () => {
    list.mockResolvedValueOnce([{ id: "req-1" }]);

    const res = await request(app)
      .get(
        "/api/finance/vendor-approval/requests?status=pending&branchId=branch-9",
      )
      .set("x-test-role", "finance_head");

    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      status: "pending",
      branchId: "branch-9",
      limit: undefined,
    });
  });
});

describe("GET /api/finance/vendor-approval/my-requests", () => {
  it("scopes to the caller's own raised requests regardless of role", async () => {
    list.mockResolvedValueOnce([]);

    const res = await request(app).get(
      "/api/finance/vendor-approval/my-requests",
    );

    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith({ raisedBy: "user-1", limit: 50 });
  });
});

describe("PATCH /api/finance/vendor-approval/:id/approve", () => {
  it("lets a finance_head approve with an edited payload", async () => {
    approve.mockResolvedValueOnce({ vendorId: "vendor-1" });

    const res = await request(app)
      .patch("/api/finance/vendor-approval/req-1/approve")
      .set("x-test-role", "finance_head")
      .send({
        editedPayload: { gst_number: "22AAAAA0000A1Z5" },
        reviewNotes: "looks fine",
      });

    expect(res.status).toBe(200);
    expect(approve).toHaveBeenCalledWith(
      "req-1",
      "user-1",
      { gst_number: "22AAAAA0000A1Z5" },
      "looks fine",
    );
  });

  it("rejects a branch_admin from approving", async () => {
    const res = await request(app)
      .patch("/api/finance/vendor-approval/req-1/approve")
      .set("x-test-role", "branch_admin")
      .send({});

    expect(res.status).toBe(403);
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/finance/vendor-approval/:id/reject", () => {
  it("requires reviewNotes", async () => {
    const res = await request(app)
      .patch("/api/finance/vendor-approval/req-1/reject")
      .set("x-test-role", "finance_head")
      .send({});

    expect(res.status).toBe(400);
    expect(reject).not.toHaveBeenCalled();
  });

  it("rejects with notes when provided", async () => {
    reject.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .patch("/api/finance/vendor-approval/req-1/reject")
      .set("x-test-role", "finance_head")
      .send({ reviewNotes: "missing GST" });

    expect(res.status).toBe(200);
    expect(reject).toHaveBeenCalledWith("req-1", "user-1", "missing GST");
  });
});
