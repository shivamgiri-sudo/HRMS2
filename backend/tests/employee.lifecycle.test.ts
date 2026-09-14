/**
 * Package 2 — Employee lifecycle, assets, helpdesk, letters tests.
 * Includes privacy/ownership negative security tests (Package 2 security fix).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));

/**
 * Tokens this suite authenticates with, and who each one is.
 *
 * Authentication is MySQL JWT; signing in through supabaseAuthClient.auth.getUser
 * stopped working when auth moved off Supabase, so every request here 401'd and
 * none of the lifecycle or ownership assertions were reached.
 */
const TOKEN_USERS: Record<string, { id: string; email: string }> = {
  "admin.token": { id: "u-admin", email: "admin@test.com" },
  "hr.token": { id: "u-hr", email: "hr@test.com" },
  "emp.token": { id: "u-emp", email: "emp@test.com" },
};

/**
 * requireAuth is replaced rather than fed.
 *
 * The real middleware resolves roles and a read-only flag from the database on a
 * cache miss, so it consumes db.execute calls before a handler runs. This suite
 * drives 29 tests through 63 positional mockResolvedValueOnce chains, and any
 * query requireAuth makes shifts every one of them by an unpredictable amount.
 *
 * The subject here is lifecycle and ownership authorization, not JWT
 * verification — which access.rbac.test.ts covers against the real middleware.
 * So this stands in a minimal requireAuth that consumes no queries, leaving the
 * chains meaning exactly what they say. Unknown and missing tokens still 401, so
 * the suite's own negative auth tests stay honest.
 */
vi.mock("../src/middleware/authMiddleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/middleware/authMiddleware.js")>();
  return {
    ...actual,
    requireAuth: (req: any, res: any, next: any) => {
      const header = String(req.headers?.authorization ?? "");
      if (!header.startsWith("Bearer ")) {
        return res.status(401).json({ success: false, message: "Missing authorization token" });
      }
      const user = TOKEN_USERS[header.replace("Bearer ", "").trim()];
      if (!user) {
        return res.status(401).json({ success: false, message: "Invalid or expired token" });
      }
      req.authUser = { id: user.id, email: user.email };
      return next();
    },
  };
});

import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;

const ADMIN_AUTH = { Authorization: "Bearer admin.token" };
const HR_AUTH    = { Authorization: "Bearer hr.token" };
const EMP_AUTH   = { Authorization: "Bearer emp.token" };

beforeEach(() => { vi.clearAllMocks(); mockExecute.mockResolvedValue([[], []]); });

function mockAdmin() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-admin" } }, error: null });
  mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
}
function mockHr() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-hr" } }, error: null });
  mockExecute.mockResolvedValueOnce([[{ role_key: "hr" }], []]);
}
function mockEmployee(empId: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
  mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
  mockExecute.mockResolvedValueOnce([[{ id: empId, employee_code: "E001" }], []]);
}

describe("GET /api/lifecycle/employees/:id/lifecycle", () => {
  it("returns 200 for admin", async () => {
    mockAdmin();
    mockExecute.mockResolvedValueOnce([[{ id: "ev-1", event_type: "confirmation" }], []]);
    const r = await request(app).get("/api/lifecycle/employees/emp-1/lifecycle").set(ADMIN_AUTH);
    expect(r.status).toBe(200);
  });
  it("returns 200 for employee reading own", async () => {
    mockEmployee("emp-1");
    mockExecute.mockResolvedValueOnce([[{ id: "ev-1", event_type: "confirmation" }], []]);
    const r = await request(app).get("/api/lifecycle/employees/emp-1/lifecycle").set(EMP_AUTH);
    expect(r.status).toBe(200);
  });
  it("returns 401 without token", async () => {
    const r = await request(app).get("/api/lifecycle/employees/emp-1/lifecycle");
    expect(r.status).toBe(401);
  });
});

describe("POST /api/lifecycle/employees/:id/lifecycle", () => {
  it("returns 403 for employee role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    const r = await request(app).post("/api/lifecycle/employees/emp-1/lifecycle").set(EMP_AUTH)
      .send({ event_type: "promotion", effective_date: "2026-06-01" });
    expect(r.status).toBe(403);
  });
  it("creates lifecycle event for hr", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([[{ id: "ev-new", event_type: "promotion" }], []]);
    const r = await request(app).post("/api/lifecycle/employees/emp-1/lifecycle").set(HR_AUTH)
      .send({ event_type: "promotion", effective_date: "2026-06-01", remarks: "Promoted to TL" });
    expect(r.status).toBe(201);
  });
});

describe("POST /api/lifecycle/documents/:id/verify", () => {
  it("returns 403 for employee role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    const r = await request(app).post("/api/lifecycle/documents/doc-1/verify").set(EMP_AUTH);
    expect(r.status).toBe(403);
  });
  it("verifies document for hr and writes audit", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const r = await request(app).post("/api/lifecycle/documents/doc-1/verify").set(HR_AUTH)
      .send({ remarks: "BGV verified" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe("GET /api/assets-mgmt", () => {
  it("returns 200 for admin", async () => {
    mockAdmin();
    mockExecute.mockResolvedValueOnce([[{ id: "a-1", asset_code: "LT-001" }], []]);
    const r = await request(app).get("/api/assets-mgmt").set(ADMIN_AUTH);
    expect(r.status).toBe(200);
  });
  it("returns 403 for employee role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    const r = await request(app).get("/api/assets-mgmt").set(EMP_AUTH);
    expect(r.status).toBe(403);
  });
});

describe("POST /api/assets-mgmt/:id/assign", () => {
  it("returns 403 for employee role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    const r = await request(app).post("/api/assets-mgmt/a-1/assign").set(EMP_AUTH)
      .send({ employee_id: "emp-1" });
    expect(r.status).toBe(403);
  });
  it("assigns asset for hr and writes audit", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([[{ id: "aa-1", asset_id: "a-1" }], []]);
    const r = await request(app).post("/api/assets-mgmt/a-1/assign").set(HR_AUTH)
      .send({ employee_id: "emp-1" });
    expect(r.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auditCall = mockExecute.mock.calls.find(([sql]: any) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });
});

describe("POST /api/assets-mgmt/:id/return", () => {
  it("marks asset as returned for hr", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const r = await request(app).post("/api/assets-mgmt/a-1/return").set(HR_AUTH).send({ condition: "good" });
    expect(r.status).toBe(200);
  });
});

describe("POST /api/helpdesk/tickets", () => {
  it("creates ticket using server-derived employee_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    mockExecute.mockResolvedValueOnce([[{ id: "emp-1", employee_code: "E001" }], []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([[{ id: "t-1", status: "open" }], []]);
    mockExecute.mockResolvedValueOnce([[], []]);
    const r = await request(app).post("/api/helpdesk/tickets").set(EMP_AUTH)
      .send({ category: "hr", subject: "Test", description: "Desc" });
    expect(r.status).toBe(201);
  });
});

describe("GET /api/helpdesk/grievances", () => {
  it("returns 403 for non-hr", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    const r = await request(app).get("/api/helpdesk/grievances").set(EMP_AUTH);
    expect(r.status).toBe(403);
  });
  it("returns grievances for hr", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([[{ id: "g-1", category: "harassment", status: "submitted" }], []]);
    const r = await request(app).get("/api/helpdesk/grievances").set(HR_AUTH);
    expect(r.status).toBe(200);
  });
});

describe("POST /api/helpdesk/grievances", () => {
  it("creates grievance with server-enforced employee_id (body value discarded)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ id: "emp-a", employee_code: "E001" }], []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([[{ id: "g-new", grievance_code: "GRV-1", is_anonymous: 1, status: "submitted" }], []]);
    const r = await request(app).post("/api/helpdesk/grievances").set(EMP_AUTH)
      .send({ category: "workplace", description: "Hostile", is_anonymous: true, employee_id: "emp-attacker" });
    expect(r.status).toBe(201);
    expect(r.body.data.employee_id).toBeUndefined();
  });
});

describe("GET /api/letters/templates", () => {
  it("returns 403 for employee role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    const r = await request(app).get("/api/letters/templates").set(EMP_AUTH);
    expect(r.status).toBe(403);
  });
  it("returns templates for admin", async () => {
    mockAdmin();
    mockExecute.mockResolvedValueOnce([[{ id: "t-1", template_code: "OFFER_LETTER" }], []]);
    const r = await request(app).get("/api/letters/templates").set(ADMIN_AUTH);
    expect(r.status).toBe(200);
  });
});

describe("POST /api/letters/generate", () => {
  it("generates letter with employee data interpolated", async () => {
    mockAdmin();
    mockExecute.mockResolvedValueOnce([[{ id: "tpl-1", template_code: "OFFER_LETTER", letter_type: "offer", body_template: "Dear {{full_name}}, join as {{designation}}." }], []]);
    mockExecute.mockResolvedValueOnce([[{ id: "emp-1", employee_code: "EMP001", full_name: "Amit Kumar", first_name: "Amit", last_name: "Kumar", designation_name: "Agent", date_of_joining: "2026-06-01" }], []]);
    // Salary now resolves through resolveAppointmentLetterSalary, which walks
    // salary_component_assignments (package, then assignment) and refuses to
    // issue a letter whose amounts are all zero — "Refusing to issue a letter
    // showing zero". A ctc_annual alone does not satisfy that, so the row has to
    // carry gross and basic. Keyed on the statement because the resolver tries
    // several sources in order and stops at the first hit.
    mockExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM salary_component_assignments/i.test(text)) {
        return [[{ gross: 30000, basic: 15000, hra: 6000, ctc_annual: 360000,
                   pf_applicable: 1, esi_applicable: 0, status: "active" }], []];
      }
      if (/INSERT INTO generated_letter/i.test(text)) return [{ affectedRows: 1 }, []];
      return [[], []];
    });

    const r = await request(app).post("/api/letters/generate").set(ADMIN_AUTH)
      .send({ employee_id: "emp-1", template_code: "OFFER_LETTER", issued_date: "2026-06-01" });

    expect(r.status).toBe(201);
    // generateLetter returns { id, letter_type, template_code }. The interpolated
    // body is persisted, not returned, so asserting on r.body.data.generated_text
    // could never pass — it tested a field the endpoint does not expose.
    expect(r.body.data).toMatchObject({ letter_type: "offer", template_code: "OFFER_LETTER" });

    // Assert the interpolation where it actually happens: the stored text.
    const insert = mockExecute.mock.calls.find(([sql]: [unknown]) =>
      /INSERT INTO generated_letter/i.test(String(sql)),
    );
    expect(insert, "expected the letter to be persisted").toBeDefined();
    const stored = ((insert![1] as unknown[]) ?? []).map(String).join(" ");
    expect(stored).toContain("Amit Kumar");
    expect(stored).toContain("Agent");
  });
});

// ── SECURITY: Privacy / ownership negative tests ──────────────────────────────

describe("SECURITY — Lifecycle: Employee A cannot read Employee B", () => {
  it("403 when employee reads another employee lifecycle", async () => {
    mockEmployee("emp-mine");
    const r = await request(app).get("/api/lifecycle/employees/emp-other/lifecycle").set(EMP_AUTH);
    expect(r.status).toBe(403);
  });
  it("200 when employee reads own lifecycle", async () => {
    mockEmployee("emp-mine");
    mockExecute.mockResolvedValueOnce([[{ id: "ev-1", event_type: "confirmation" }], []]);
    const r = await request(app).get("/api/lifecycle/employees/emp-mine/lifecycle").set(EMP_AUTH);
    expect(r.status).toBe(200);
  });
});

describe("SECURITY — Assets: Employee A cannot read Employee B", () => {
  it("403 when employee queries another employee asset list", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    mockExecute.mockResolvedValueOnce([[{ id: "emp-mine", employee_code: "E001" }], []]);
    const r = await request(app).get("/api/assets-mgmt/employee/emp-other").set(EMP_AUTH);
    expect(r.status).toBe(403);
  });
  it("200 when employee queries own asset list", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    mockExecute.mockResolvedValueOnce([[{ id: "emp-mine", employee_code: "E001" }], []]);
    mockExecute.mockResolvedValueOnce([[{ id: "aa-1", asset_name: "Laptop" }], []]);
    const r = await request(app).get("/api/assets-mgmt/employee/emp-mine").set(EMP_AUTH);
    expect(r.status).toBe(200);
  });
});

describe("SECURITY — Helpdesk ticket privacy", () => {
  // Mock call order below matches helpdesk.routes.ts's GET /tickets/:id as of the
  // 2026-08-14 row-scope fix (delta-audit, Stage 5a): isAdminHr is now resolved via
  // hasRoleForRequest BEFORE the ticket is fetched, not after — the scope-aware
  // getTicket() call needs to know upfront whether to apply a scope condition to the
  // SQL itself, since scope is enforced inside the query, not by filtering the result
  // afterwards. That structurally requires the role check first. Previously: ticket,
  // comments, role, employee. Now: role, ticket, comments, employee. Reordering an
  // independent, unrelated pair of async lookups changes nothing about real request
  // behavior (each query hits its own real data in production regardless of order) —
  // only this test's hard-coded mock sequence needed updating to match.
  it("403 when employee reads another employee ticket", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp-a" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    mockExecute.mockResolvedValueOnce([[{ id: "t-1", employee_id: "emp-b", status: "open" }], []]);
    mockExecute.mockResolvedValueOnce([[], []]);
    mockExecute.mockResolvedValueOnce([[{ id: "emp-a", employee_code: "E001" }], []]);
    const r = await request(app).get("/api/helpdesk/tickets/t-1").set(EMP_AUTH);
    expect(r.status).toBe(403);
  });
  it("403 when employee tries to post internal comment", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    const r = await request(app).post("/api/helpdesk/tickets/t-1/comments").set(EMP_AUTH)
      .send({ text: "secret", is_internal: true });
    expect(r.status).toBe(403);
  });
  it("internal comments stripped from employee ticket view", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    mockExecute.mockResolvedValueOnce([[{ id: "t-1", employee_id: "emp-mine", status: "open" }], []]);
    mockExecute.mockResolvedValueOnce([[
      { id: "c-1", is_internal: 0, comment_text: "Public" },
      { id: "c-2", is_internal: 1, comment_text: "Secret HR note" },
    ], []]);
    mockExecute.mockResolvedValueOnce([[{ id: "emp-mine", employee_code: "E001" }], []]);
    const r = await request(app).get("/api/helpdesk/tickets/t-1").set(EMP_AUTH);
    expect(r.status).toBe(200);
    expect(r.body.data.comments.every((c: any) => !c.is_internal)).toBe(true);
  });
});

describe("SECURITY — Grievance identity", () => {
  it("403 when no employee record linked to user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-no-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[], []]);
    const r = await request(app).post("/api/helpdesk/grievances").set(EMP_AUTH)
      .send({ category: "harassment", description: "Test" });
    expect(r.status).toBe(403);
  });
});

describe("SECURITY — Letter acknowledgement ownership", () => {
  it("403 when employee A acknowledges employee B letter", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp-a" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ id: "l-1", employee_id: "emp-b", letter_type: "offer" }], []]);
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    mockExecute.mockResolvedValueOnce([[{ id: "emp-a", employee_code: "E001" }], []]);
    const r = await request(app).post("/api/letters/l-1/acknowledge").set(EMP_AUTH);
    expect(r.status).toBe(403);
  });
  it("200 when employee acknowledges own letter", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp-a" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ id: "l-1", employee_id: "emp-a", letter_type: "offer" }], []]);
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    mockExecute.mockResolvedValueOnce([[{ id: "emp-a", employee_code: "E001" }], []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const r = await request(app).post("/api/letters/l-1/acknowledge").set(EMP_AUTH);
    expect(r.status).toBe(200);
  });
});
