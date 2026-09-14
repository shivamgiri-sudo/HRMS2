import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * PAYROLL_READINESS decided "has a PAN" with `pan_number IS NULL OR pan_number = ''`.
 * Two separate ways that disagrees with the live data (verified 2026-08-28, 1,120 active
 * employees, 30-day joining grace applied throughout):
 *
 *  1. It never checks the format. Seven employees past the grace window hold a value that
 *     cannot be a PAN — CTRPC455K, CPWPD2907, GJKPMO583H, NPRK4925R, SCOPS624C,
 *     BSPPTO806H, JWZPS2362, FWHPR13R: eight, nine or ten characters in the wrong shape.
 *     The dashboard counted every one as payroll-ready. payroll-governance.service.ts
 *     already raises INVALID_PAN_FORMAT on exactly these, a blocker under auto-TDS, with
 *     the note that the engine "cannot treat it as a genuine identity any more than a
 *     missing PAN can". So the CEO dashboard certified as ready seven employees the
 *     payroll run itself refuses.
 *
 *  2. It never looks at `pan_number_encrypted`. Six employees hold ciphertext with an
 *     empty plaintext column and were reported as missing a PAN. Every payroll read of
 *     this field goes through resolvePii(pan_number_encrypted, pan_number), which PREFERS
 *     the ciphertext (payroll.routes.ts, payroll-more.routes.ts) — payroll can read those
 *     six PANs perfectly well.
 *
 * Net on live data: reported 238, of which 6 are false alarms and 7 real blockers were
 * missing — 232 with no PAN anywhere, plus 7 holding an unusable one.
 *
 * The two errors nearly cancel in the headline, which is why this was invisible: 238
 * against a true 239.
 */

const source = readFileSync(resolve(__dirname, "../dashboard-metric.service.ts"), "utf-8");
const governanceSource = readFileSync(
  resolve(__dirname, "../../payroll/payroll-governance.service.ts"),
  "utf-8",
);

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const SCOPE = {
  level: "ORG_WIDE",
  branchIds: [],
  processIds: [],
  employeeIds: [],
  userId: "u1",
  role: "ceo",
} as never;

async function capturePayrollSql(): Promise<string> {
  const { getPayrollReadinessMetrics } = await import("../dashboard-metric.service.js");
  execute.mockReset();
  execute.mockResolvedValue([[{
    total: 1120, readyCount: 881, missingBank: 5, missingNeftBank: 6,
    missingPan: 232, invalidPan: 7, missingUan: 410,
  }], []]);
  await getPayrollReadinessMetrics(SCOPE);
  return String(execute.mock.calls[0]?.[0] ?? "").replace(/\s+/g, " ");
}

describe("PAYROLL_READINESS PAN gate", () => {
  it("validates PAN format, not just presence", async () => {
    const sql = await capturePayrollSql();

    // The Income Tax Act shape: five letters, four digits, one letter.
    expect(sql).toMatch(/\[A-Z\]\{5\}\[0-9\]\{4\}\[A-Z\]/);
  });

  it("uses the same PAN format rule the payroll run itself enforces", async () => {
    const sql = await capturePayrollSql();

    // payroll-governance.service.ts raises INVALID_PAN_FORMAT on this exact pattern. Two
    // gates answering "can this employee be paid" must not disagree about what a PAN is.
    expect(governanceSource).toContain("[A-Z]{5}[0-9]{4}[A-Z]");
    expect(sql).toContain("[A-Z]{5}[0-9]{4}[A-Z]");
  });

  it("treats an encrypted-only PAN as present, the way every payroll read does", async () => {
    const sql = await capturePayrollSql();

    expect(sql).toContain("pan_number_encrypted");
  });

  it("reports employees holding an unusable PAN separately from those holding none", async () => {
    const { getPayrollReadinessMetrics } = await import("../dashboard-metric.service.js");
    execute.mockReset();
    execute.mockResolvedValue([[{
      total: 1120, readyCount: 881, missingBank: 5, missingNeftBank: 6,
      missingPan: 232, invalidPan: 7, missingUan: 410,
    }], []]);

    const result = await getPayrollReadinessMetrics(SCOPE);

    // "232 have no PAN" and "7 have a PAN that will be rejected" are different pieces of
    // work for different people; collapsing them loses the actionable one.
    expect(result.detail?.missingPan).toBe(232);
    expect(result.detail?.invalidPan).toBe(7);
  });

  it("counts an unusable PAN against readiness rather than passing it as ready", async () => {
    const sql = await capturePayrollSql();

    // The readyCount branch must apply the same PAN test, otherwise the seven invalid
    // rows keep inflating the readiness percentage even once they are reported below it.
    const readyBranch = sql.slice(sql.indexOf("AS missingUan"), sql.indexOf("AS readyCount"));
    expect(readyBranch).toContain("[A-Z]{5}[0-9]{4}[A-Z]");
  });

  it("still grants the 30-day joining grace on the PAN checks", async () => {
    const sql = await capturePayrollSql();

    // A brand-new joiner has not had time to submit paperwork; that was right before and
    // must survive the format fix.
    expect(sql).toMatch(/DATEDIFF\(CURDATE\(\), ?date_of_joining\) ?> ?30/);
  });
});
