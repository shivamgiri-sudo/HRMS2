/**
 * The Ops Control Tower must not count or list people who have left. Each section's SQL (summary AND drill-down,
 * so the number and the list agree) carries the filter; the exit trackers (F&F, NOC) deliberately do not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

import * as svc from "../ops-control-tower.service.js";

const B = "b0000000-0000-0000-0000-000000000001";
let sqls: string[] = [];

beforeEach(() => {
  sqls = [];
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) => {
    sqls.push(sql);
    return [sql.includes("FROM branch_master") ? [{ id: B, branch_name: "NOIDA" }] : []];
  });
});

/** The SQL a call ran, excluding the branch-list lookup every block starts with. */
async function sqlOf(fn: () => Promise<unknown>): Promise<string> {
  sqls = [];
  await fn();
  return sqls.filter((q) => !q.includes("FROM branch_master")).join("\n");
}

describe("exported filters", () => {
  it("STILL_WITH_US keeps current staff and pre-joiners, ACTIVE_STAFF_ONLY keeps current staff", () => {
    expect(svc.STILL_WITH_US).toContain("e.active_status = 1");
    expect(svc.STILL_WITH_US).toContain("'preboarding'");
    expect(svc.ACTIVE_STAFF_ONLY).toBe("e.active_status = 1");
  });
});

describe("attendance mismatch ignores people who have left", () => {
  it("summary counts only active staff", async () => {
    expect(await sqlOf(() => svc.getAttendanceMismatchBlock())).toContain(`WHERE ${svc.ACTIVE_STAFF_ONLY}`);
  });
  it("drill-down lists only active staff", async () => {
    expect(await sqlOf(() => svc.getAttendanceMismatchDetail(B))).toContain(`ari.resolved_at IS NULL AND ${svc.ACTIVE_STAFF_ONLY}`);
  });
});

describe("joiner-journey sections drop anyone who has since left, but keep pre-joiners", () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["DigiLocker summary", () => svc.getDigilockerPendingBlock()],
    ["DigiLocker list", () => svc.getDigilockerPendingDetail(B)],
    ["eSign summary", () => svc.getEsignPendingBlock()],
    ["eSign list", () => svc.getEsignPendingDetail(B)],
    ["Appointment letter summary", () => svc.getAppointmentLetterBlock()],
    ["Appointment letter list", () => svc.getAppointmentLetterDetail(B)],
    ["Penny drop summary", () => svc.getPennyDropMissingBlock()],
    ["Penny drop list", () => svc.getPennyDropMissingDetail(B)],
    ["Documents summary", () => svc.getDocsPendingBlock()],
    ["Documents list", () => svc.getDocsPendingDetail(B)],
    ["Bank details summary", () => svc.getAccountDetailsMissingBlock()],
    ["Bank details list", () => svc.getAccountDetailsMissingDetail(B)],
    ["BGV summary", () => svc.getBgvPendingBlock()],
    ["BGV list", () => svc.getBgvPendingDetail(B)],
    ["Address review summary", () => svc.getAddressReviewPendingBlock()],
    ["Address review list", () => svc.getAddressReviewPendingDetail(B)],
    ["IT provisioning summary", () => svc.getItProvisioningPendingBlock()],
    ["IT provisioning list", () => svc.getItProvisioningPendingDetail(B)],
    ["Admin provisioning list", () => svc.getAdminProvisioningPendingDetail(B)],
    ["WFM provisioning list", () => svc.getWfmProvisioningPendingDetail(B)],
  ];
  for (const [name, fn] of cases) {
    it(`${name} carries the filter`, async () => {
      expect(await sqlOf(fn)).toContain(svc.STILL_WITH_US);
    });
  }
});

describe("exit trackers still list people who have left", () => {
  it("F&F and NOC are not filtered to active staff", async () => {
    for (const fn of [() => svc.getFnfPendingBlock(), () => svc.getFnfPendingDetail(B), () => svc.getNocPendingBlock(), () => svc.getNocPendingDetail(B)]) {
      const q = await sqlOf(fn);
      expect(q).not.toContain(svc.STILL_WITH_US);
      expect(q).not.toContain(svc.ACTIVE_STAFF_ONLY);
    }
  });
});
