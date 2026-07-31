/**
 * Package 2 — Employee lifecycle, assets, helpdesk, letters tests.
 * Includes privacy/ownership negative security tests (Package 2 security fix).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));

import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
// supabaseAdmin stays mocked above (app.ts imports it); authMiddleware no
// longer calls it — auth is MySQL JWT now.

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const JWT_SECRET = process.env.JWT_SECRET || "change-me-jwt-secret-32characters!!";

/**
 * Real JWTs replace the retired "<role>.token" placeholders — jwt.verify throws
 * on those, so every request 401'd and none of the employee-lifecycle, asset,
 * helpdesk, letter or privacy/ownership rules here were ever exercised.
 *
 * Fresh subject per call: authMiddleware caches resolved roles for 30 seconds
 * per user id, so a fixed subject lets one test inherit another's roles.
 */
let subjectCounter = 0;
const bearer = (sub: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { sub: `${sub}-${++subjectCounter}`, email: `${sub}@mcn.com`, iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`,
});

/**
 * Ordered fixtures for SELECTs only.
 *
 * The tests express "this query, then that one" as a positional db.execute
 * queue, which is fine for a route's own reads but broke once auth began
 * issuing its own queries — the number of those varies with whether the subject
 * is already cached. Ordering is kept where it carries meaning (SELECTs) and
 * dropped where it never did: role lookups and writes are answered by shape,
 * outside the queue.
 */
let selectQueue: unknown[][] = [];
function selectRows(rows: unknown[]) { selectQueue.push(rows); }

function authAs(sub: string, roles: string[]) {
  selectQueue = [];
  mockExecute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (/FROM user_roles/i.test(text)) return [roles.map((r) => ({ role_key: r })), []];
    if (/user_assignment_scope|FROM auth_user/i.test(text)) return [[], []];
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(text)) return [{ affectedRows: 1 }, []];
    return [selectQueue.length ? selectQueue.shift()! : [], []];
  });
  return bearer(sub);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockReset();
  mockExecute.mockResolvedValue([[], []]);
  selectQueue = [];
});

const mockAdmin = () => authAs("u-admin", ["admin"]);
const mockHr = () => authAs("u-hr", ["hr"]);
const mockEmployeeRole = () => authAs("u-emp", ["employee"]);
/** Employee whose user maps to a specific employee record (first SELECT). */
function mockEmployee(empId: string) {
  const auth = authAs("u-emp", ["employee"]);
  selectRows([{ id: empId, employee_code: "E001" }]);
  return auth;
}

describe("GET /api/lifecycle/employees/:id/lifecycle", () => {
  it("returns 200 for admin", async () => {
    const auth = mockAdmin();
    selectRows([{ id: "ev-1", event_type: "confirmation" }]);
    const r = await request(app).get("/api/lifecycle/employees/emp-1/lifecycle").set(auth);
    expect(r.status).toBe(200);
  });
  it("returns 200 for employee reading own", async () => {
    const auth = mockEmployee("emp-1");
    selectRows([{ id: "ev-1", event_type: "confirmation" }]);
    const r = await request(app).get("/api/lifecycle/employees/emp-1/lifecycle").set(auth);
    expect(r.status).toBe(200);
  });
  it("returns 401 without token", async () => {
    const r = await request(app).get("/api/lifecycle/employees/emp-1/lifecycle");
    expect(r.status).toBe(401);
  });
});

describe("POST /api/lifecycle/employees/:id/lifecycle", () => {
  it("returns 403 for employee role", async () => {
    const auth = mockEmployeeRole();
    const r = await request(app).post("/api/lifecycle/employees/emp-1/lifecycle").set(auth)
      .send({ event_type: "promotion", effective_date: "2026-06-01" });
    expect(r.status).toBe(403);
  });
  it("creates lifecycle event for hr", async () => {
    const auth = mockHr();
    selectRows([{ id: "ev-new", event_type: "promotion" }]);
    const r = await request(app).post("/api/lifecycle/employees/emp-1/lifecycle").set(auth)
      .send({ event_type: "promotion", effective_date: "2026-06-01", remarks: "Promoted to TL" });
    expect(r.status).toBe(201);
  });
});

describe("POST /api/lifecycle/documents/:id/verify", () => {
  it("returns 403 for employee role", async () => {
    const auth = mockEmployeeRole();
    const r = await request(app).post("/api/lifecycle/documents/doc-1/verify").set(auth);
    expect(r.status).toBe(403);
  });
  it("verifies document for hr and writes audit", async () => {
    const auth = mockHr();
    const r = await request(app).post("/api/lifecycle/documents/doc-1/verify").set(auth)
      .send({ remarks: "BGV verified" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe("GET /api/assets-mgmt", () => {
  it("returns 200 for admin", async () => {
    const auth = mockAdmin();
    selectRows([{ id: "a-1", asset_code: "LT-001" }]);
    const r = await request(app).get("/api/assets-mgmt").set(auth);
    expect(r.status).toBe(200);
  });
  it("returns 403 for employee role", async () => {
    const auth = mockEmployeeRole();
    const r = await request(app).get("/api/assets-mgmt").set(auth);
    expect(r.status).toBe(403);
  });
});

describe("POST /api/assets-mgmt/:id/assign", () => {
  it("returns 403 for employee role", async () => {
    const auth = mockEmployeeRole();
    const r = await request(app).post("/api/assets-mgmt/a-1/assign").set(auth)
      .send({ employee_id: "emp-1" });
    expect(r.status).toBe(403);
  });
  it("assigns asset for hr and writes audit", async () => {
    const auth = mockHr();
    selectRows([{ id: "aa-1", asset_id: "a-1" }]);
    const r = await request(app).post("/api/assets-mgmt/a-1/assign").set(auth)
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
    const auth = mockHr();
    const r = await request(app).post("/api/assets-mgmt/a-1/return").set(auth).send({ condition: "good" });
    expect(r.status).toBe(200);
  });
});

describe("POST /api/helpdesk/tickets", () => {
  it("creates ticket using server-derived employee_id", async () => {
    const auth = mockEmployeeRole();
    selectRows([{ id: "emp-1", employee_code: "E001" }]);
    selectRows([{ id: "t-1", status: "open" }]);
    selectRows([]);
    const r = await request(app).post("/api/helpdesk/tickets").set(auth)
      .send({ category: "hr", subject: "Test", description: "Desc" });
    expect(r.status).toBe(201);
  });
});

describe("GET /api/helpdesk/grievances", () => {
  it("returns 403 for non-hr", async () => {
    const auth = mockEmployeeRole();
    const r = await request(app).get("/api/helpdesk/grievances").set(auth);
    expect(r.status).toBe(403);
  });
  it("returns grievances for hr", async () => {
    const auth = mockHr();
    selectRows([{ id: "g-1", category: "harassment", status: "submitted" }]);
    const r = await request(app).get("/api/helpdesk/grievances").set(auth);
    expect(r.status).toBe(200);
  });
});

describe("POST /api/helpdesk/grievances", () => {
  it("creates grievance with server-enforced employee_id (body value discarded)", async () => {
    const auth = mockEmployeeRole();
    selectRows([{ id: "emp-a", employee_code: "E001" }]);
    selectRows([{ id: "g-new", grievance_code: "GRV-1", is_anonymous: 1, status: "submitted" }]);
    const r = await request(app).post("/api/helpdesk/grievances").set(auth)
      .send({ category: "workplace", description: "Hostile", is_anonymous: true, employee_id: "emp-attacker" });
    expect(r.status).toBe(201);
    expect(r.body.data.employee_id).toBeUndefined();
  });
});

describe("GET /api/letters/templates", () => {
  it("returns 403 for employee role", async () => {
    const auth = mockEmployeeRole();
    const r = await request(app).get("/api/letters/templates").set(auth);
    expect(r.status).toBe(403);
  });
  it("returns templates for admin", async () => {
    const auth = mockAdmin();
    selectRows([{ id: "t-1", template_code: "OFFER_LETTER" }]);
    const r = await request(app).get("/api/letters/templates").set(auth);
    expect(r.status).toBe(200);
  });
});

describe("POST /api/letters/generate", () => {
  it("generates letter with employee data interpolated", async () => {
    // Routed by SQL: the route does not read the template and the employee in
    // the order the fixtures were written, so a positional pair handed the
    // employee row to the template query and the interpolation had nothing to
    // substitute — 201 with an empty generated_text.
    const auth = mockAdmin();
    mockExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/FROM user_roles/i.test(text)) return [[{ role_key: "admin" }], []];
      if (/user_assignment_scope|FROM auth_user/i.test(text)) return [[], []];
      if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(text)) return [{ affectedRows: 1 }, []];
      if (/template/i.test(text)) {
        return [[{
          id: "tpl-1", template_code: "OFFER_LETTER", letter_type: "offer",
          body_template: "Dear {{full_name}}, join as {{designation}}.",
        }], []];
      }
      if (/FROM employees/i.test(text)) {
        return [[{
          id: "emp-1", employee_code: "EMP001", full_name: "Amit Kumar",
          first_name: "Amit", last_name: "Kumar", designation_name: "Agent",
          date_of_joining: "2026-06-01",
        }], []];
      }
      return [[], []];
    });
    const r = await request(app).post("/api/letters/generate").set(auth)
      .send({ employee_id: "emp-1", template_code: "OFFER_LETTER", issued_date: "2026-06-01" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ letter_type: "offer", template_code: "OFFER_LETTER" });

    /**
     * The interpolation is asserted against what gets written, not the response.
     * lettersService.generate returns only { id, letter_type, template_code } —
     * generated_text is persisted, never sent back — so the original
     * `r.body.data.generated_text` was reading undefined and this test could not
     * have verified interpolation even once it authenticated. Checking the
     * INSERT payload keeps the original intent, and is stricter: it proves the
     * employee's data actually reached storage.
     */
    const insert = mockExecute.mock.calls.find(
      ([sql]: [unknown]) => typeof sql === "string" && /INSERT INTO generated_letter/i.test(sql),
    );
    expect(insert).toBeDefined();
    const payload = (insert![1] as unknown[]).find(
      (v) => typeof v === "string" && v.includes("{"),
    ) as string | undefined;
    expect(payload).toBeDefined();
    expect(payload).toContain("Amit Kumar");
    expect(payload).toContain("Agent");
  });
});

// ── SECURITY: Privacy / ownership negative tests ──────────────────────────────

describe("SECURITY — Lifecycle: Employee A cannot read Employee B", () => {
  it("403 when employee reads another employee lifecycle", async () => {
    const auth = mockEmployee("emp-mine");
    const r = await request(app).get("/api/lifecycle/employees/emp-other/lifecycle").set(auth);
    expect(r.status).toBe(403);
  });
  it("200 when employee reads own lifecycle", async () => {
    const auth = mockEmployee("emp-mine");
    selectRows([{ id: "ev-1", event_type: "confirmation" }]);
    const r = await request(app).get("/api/lifecycle/employees/emp-mine/lifecycle").set(auth);
    expect(r.status).toBe(200);
  });
});

describe("SECURITY — Assets: Employee A cannot read Employee B", () => {
  it("403 when employee queries another employee asset list", async () => {
    const auth = mockEmployeeRole();
    selectRows([{ id: "emp-mine", employee_code: "E001" }]);
    const r = await request(app).get("/api/assets-mgmt/employee/emp-other").set(auth);
    expect(r.status).toBe(403);
  });
  it("200 when employee queries own asset list", async () => {
    const auth = mockEmployeeRole();
    selectRows([{ id: "emp-mine", employee_code: "E001" }]);
    selectRows([{ id: "aa-1", asset_name: "Laptop" }]);
    const r = await request(app).get("/api/assets-mgmt/employee/emp-mine").set(auth);
    expect(r.status).toBe(200);
  });
});

describe("SECURITY — Helpdesk ticket privacy", () => {
  it("403 when employee reads another employee ticket", async () => {
    const auth = mockEmployeeRole();
    selectRows([{ id: "t-1", employee_id: "emp-b", status: "open" }]);
    selectRows([]);
    selectRows([{ id: "emp-a", employee_code: "E001" }]);
    const r = await request(app).get("/api/helpdesk/tickets/t-1").set(auth);
    expect(r.status).toBe(403);
  });
  it("403 when employee tries to post internal comment", async () => {
    const auth = mockEmployeeRole();
    const r = await request(app).post("/api/helpdesk/tickets/t-1/comments").set(auth)
      .send({ text: "secret", is_internal: true });
    expect(r.status).toBe(403);
  });
  it("internal comments stripped from employee ticket view", async () => {
    const auth = mockEmployeeRole();
    selectRows([{ id: "t-1", employee_id: "emp-mine", status: "open" }]);
    selectRows([
      { id: "c-1", is_internal: 0, comment_text: "Public" },
      { id: "c-2", is_internal: 1, comment_text: "Secret HR note" },
    ]);
    selectRows([{ id: "emp-mine", employee_code: "E001" }]);
    const r = await request(app).get("/api/helpdesk/tickets/t-1").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.data.comments.every((c: any) => !c.is_internal)).toBe(true);
  });
});

describe("SECURITY — Grievance identity", () => {
  it("403 when no employee record linked to user", async () => {
    const auth = mockEmployeeRole();
    selectRows([]);
    const r = await request(app).post("/api/helpdesk/grievances").set(auth)
      .send({ category: "harassment", description: "Test" });
    expect(r.status).toBe(403);
  });
});

describe("SECURITY — Letter acknowledgement ownership", () => {
  it("403 when employee A acknowledges employee B letter", async () => {
    const auth = mockEmployeeRole();
    selectRows([{ id: "l-1", employee_id: "emp-b", letter_type: "offer" }]);
    selectRows([{ id: "emp-a", employee_code: "E001" }]);
    const r = await request(app).post("/api/letters/l-1/acknowledge").set(auth);
    expect(r.status).toBe(403);
  });
  it("200 when employee acknowledges own letter", async () => {
    const auth = mockEmployeeRole();
    selectRows([{ id: "l-1", employee_id: "emp-a", letter_type: "offer" }]);
    selectRows([{ id: "emp-a", employee_code: "E001" }]);
    const r = await request(app).post("/api/letters/l-1/acknowledge").set(auth);
    expect(r.status).toBe(200);
  });
});
