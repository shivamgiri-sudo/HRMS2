import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

import { buildHelpdeskModule } from "../daily-brief-helpdesk.module.js";

describe("daily-brief-helpdesk: query error handling", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("a thrown helpdesk query error yields sourceHealth = ERROR, not a silent zero", async () => {
    execute.mockImplementation(async () => {
      throw new Error("ER_NO_SUCH_TABLE: simulated failure");
    });

    const result = await buildHelpdeskModule(["e1"], "2026-08-18", "operational");

    expect(result.sourceHealth.state).toBe("ERROR");
    expect(result.sourceHealth.detail).toContain("simulated failure");
    expect(result.summary.openTickets).toBe(0);
    expect(result.summary.slaBreached).toBe(0);
    // Zero-and-unavailable must not be presented as a clean "no impact" line.
    expect(result.businessImpactLine).toBeNull();
  });
});

describe("daily-brief-helpdesk: detailLevel difference", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("operational mode hides the ticket-type breakdown and gives a one-line rollup", async () => {
    execute.mockResolvedValue([[{ new_tickets: 2, resolved_tickets: 1, open_tickets: 2, sla_breached: 1, urgent_high_open: 1 }]]);

    const result = await buildHelpdeskModule(["e1", "e2"], "2026-08-18", "operational");

    expect(result.categoryBreakdown).toBeNull();
    expect(result.businessImpactLine).toContain("2 tickets affecting your team");
    expect(result.businessImpactLine).toContain("1 SLA breach");
  });

  it("detailed mode includes a category breakdown and no business-impact one-liner", async () => {
    let call = 0;
    execute.mockImplementation(async (sql: string) => {
      call += 1;
      if (sql.includes("GROUP BY t.category")) {
        return [[{ category: "IT", total: 2, open: 2, breached: 1 }]];
      }
      return [[{ new_tickets: 2, resolved_tickets: 1, open_tickets: 2, sla_breached: 1, urgent_high_open: 1 }]];
    });

    const result = await buildHelpdeskModule(["e1", "e2"], "2026-08-18", "detailed");

    expect(result.businessImpactLine).toBeNull();
    expect(result.categoryBreakdown).not.toBeNull();
    expect(result.categoryBreakdown?.[0]?.label).toBe("IT");
    expect(result.categoryBreakdown?.[0]?.value).toBe(2);
    // No ticket subject/description content ever leaks into the output.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/subject/i);
    expect(serialized).not.toMatch(/description/i);
  });
});

describe("daily-brief-helpdesk: empty team scope", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("returns NOT_APPLICABLE and never queries when teamEmployeeIds is empty", async () => {
    const result = await buildHelpdeskModule([], "2026-08-18", "operational");
    expect(result.sourceHealth.state).toBe("NOT_APPLICABLE");
    expect(execute).not.toHaveBeenCalled();
  });
});
