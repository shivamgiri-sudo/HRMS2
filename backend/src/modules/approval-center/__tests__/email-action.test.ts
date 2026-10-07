import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("../../auth/auth.service.js", () => ({ authService: { mintScopedAccessToken: vi.fn(async () => "jwt") } }));
vi.mock("../approval-center.service.js", () => ({
  decideApproval: vi.fn(async () => ({ ok: true })),
  findAdapter: vi.fn(),
}));

import { executeActionToken } from "../email-action.service.js";

const TOKEN = "a".repeat(43);
const tokenRow = { id: "t1", user_id: "u1", approval_uid: "leave:1", kind: "leave", used_at: null, used_action: null, expired: 0 };

describe("emailed approval link: official email check", () => {
  beforeEach(() => execute.mockReset());

  it("refuses a wrong or empty email id and never claims the token", async () => {
    execute.mockImplementation(async (...args: unknown[]) => { const sql = String(args[0]);
      if (args.length === 0) return [[]];
      if (args.length === 0) return [[]];
      if (/FROM approval_email_action/.test(sql)) return [[tokenRow]];
      if (/FROM auth_user au/.test(sql)) return [[{ login_email: "boss@mas.in", work_email: "boss.work@mas.in" }]];
      throw new Error("unexpected query: " + String(sql));
    });
    for (const typed of ["attacker@evil.com", ""]) {
      const out = await executeActionToken(TOKEN, "approve", "", "1.1.1.1", typed);
      expect(out).toMatchObject({ ok: false, reason: "email" });
    }
    expect(execute.mock.calls.some(([s]) => /UPDATE approval_email_action/.test(String(s)))).toBe(false);
  });

  it("accepts the login or employee email, case-insensitively, then claims and decides", async () => {
    execute.mockImplementation(async (...args: unknown[]) => { const sql = String(args[0]);
      if (args.length === 0) return [[]];
      if (/FROM approval_email_action/.test(sql)) return [[tokenRow]];
      if (/FROM auth_user au/.test(sql)) return [[{ login_email: "boss@mas.in", work_email: "boss.work@mas.in" }]];
      if (/UPDATE approval_email_action SET used_at = NOW\(\), used_action/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error("unexpected query: " + String(sql));
    });
    const out = await executeActionToken(TOKEN, "approve", "", "1.1.1.1", "  Boss.Work@MAS.in ");
    expect(out).toEqual({ ok: true, action: "approve" });
  });
});
