/**
 * The signed appointment letter on the employee's Joining Documents page.
 *
 * Access is decided by the page's own resolveEmployeeDocumentAccessContext
 * (mocked here as the thing that throws 403/404 for out-of-scope callers); on top
 * of that the letter — which carries salary — is limited to letter roles and the
 * employee themselves. Files are real, in a temp storage root; the DB is a mock.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const state = vi.hoisted(() => ({ root: "" }));
type Access = { isSelf: boolean; isAdmin: boolean; roles: string[] };
let access: Access = { isSelf: false, isAdmin: false, roles: ["hr"] };
let accessError: (Error & { statusCode?: number }) | null = null;
let listRows: Array<Record<string, unknown>> = [];
let issueRow: Record<string, unknown> | null = null;
let txRows: Array<Record<string, unknown>> = [];
const calls: Array<{ sql: string; params: unknown[] }> = [];
const audit = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("JOIN appointment_letter_esign_transaction")) return [listRows];
      if (sql.includes("FROM appointment_letter_esign_transaction") && sql.includes("WHERE issue_id")) return [txRows];
      if (sql.includes("FROM appointment_letter_issue WHERE id")) return [issueRow ? [issueRow] : []];
      return [[]];
    }),
  },
}));
vi.mock("../employeeJoiningDocuments.service.js", () => ({
  resolveEmployeeDocumentAccessContext: vi.fn(async () => {
    if (accessError) throw accessError;
    return { ...access, canManage: true };
  }),
}));
vi.mock("../../letters/appointmentLetterEsign.service.js", () => ({ appointmentLetterStorageRoot: () => state.root }));
vi.mock("../../letters/appointmentLetterAudit.js", () => ({ auditAppointmentLetter: (...a: unknown[]) => audit(...a) }));

const { listSignedAppointmentLetters, getSignedAppointmentLetterForAccess } = await import("../employeeSignedAppointmentLetter.service.js");

const ACCEPTED = Buffer.from("%PDF employee-signed copy");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
let acceptedPath = "";

beforeAll(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), "emp-al-"));
  fs.mkdirSync(path.join(state.root, "emp-1"), { recursive: true });
  acceptedPath = path.join(state.root, "emp-1", "MCN-AL-1-accepted.pdf");
  fs.writeFileSync(acceptedPath, ACCEPTED);
});
afterAll(() => fs.rmSync(state.root, { recursive: true, force: true }));

const httpErr = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

beforeEach(() => {
  access = { isSelf: false, isAdmin: false, roles: ["hr"] };
  accessError = null;
  listRows = [{
    id: "issue-1", letter_number: "MCN-AL-1", status: "issued", revoked_at: null,
    completed_at: "2026-09-24T05:30:00.000Z", signed_file_sha256: sha(ACCEPTED),
  }];
  issueRow = { letter_number: "MCN-AL-1", status: "issued", revoked_at: null };
  txRows = [{ id: "tx-1", signed_file_path: acceptedPath, signed_file_sha256: sha(ACCEPTED), completed_at: "2026-09-24T05:30:00.000Z" }];
  calls.length = 0;
  audit.mockClear();
});

describe("listSignedAppointmentLetters", () => {
  it("lists the signed letter with number, accepted time and a short hash, and never a path", async () => {
    const out = await listSignedAppointmentLetters("emp-1", access);
    expect(out).toEqual([{
      issue_id: "issue-1", letter_number: "MCN-AL-1", status: "issued",
      accepted_at: "2026-09-24T05:30:00.000Z", sha256_short: sha(ACCEPTED).slice(0, 12),
    }]);
    expect(JSON.stringify(out)).not.toContain(acceptedPath);
  });

  it("reads only the employee's own letters, from the newest signed transaction (read-only join)", async () => {
    await listSignedAppointmentLetters("emp-1", access);
    const q = calls[0];
    expect(q.sql).toMatch(/^\s*SELECT/);
    expect(q.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(q.sql).toContain("i.employee_id = ?");
    expect(q.sql).toMatch(/t2\.status = 'signed' AND t2\.signed_file_path IS NOT NULL/);
    expect(q.sql).toMatch(/ORDER BY t2\.completed_at DESC/);
    expect(q.params).toEqual(["emp-1"]);
  });

  it.each([["team leader", ["tl"]], ["process manager", ["process_manager"]], ["manager", ["manager"]]])(
    "shows nothing (and runs no query) to a %s: scoped page access does not include a report's salary letter",
    async (_l, roles) => {
      const out = await listSignedAppointmentLetters("emp-1", { isSelf: false, isAdmin: false, roles });
      expect(out).toEqual([]);
      expect(calls).toHaveLength(0);
    },
  );

  it.each([["hr"], ["payroll_hr"], ["payroll"], ["branch_head"], ["payroll_head"]])("shows the letter to %s", async (role) => {
    expect(await listSignedAppointmentLetters("emp-1", { isSelf: false, isAdmin: false, roles: [role] })).toHaveLength(1);
  });

  it("shows the employee their own letter", async () => {
    expect(await listSignedAppointmentLetters("emp-1", { isSelf: true, isAdmin: false, roles: ["employee"] })).toHaveLength(1);
  });

  it("hides a revoked letter from the employee but keeps it, marked, for HR", async () => {
    listRows = [{ ...listRows[0], status: "revoked", revoked_at: "2026-09-25T00:00:00.000Z" }];
    expect(await listSignedAppointmentLetters("emp-1", { isSelf: true, isAdmin: false, roles: ["employee"] })).toEqual([]);
    const forHr = await listSignedAppointmentLetters("emp-1", access);
    expect(forHr).toHaveLength(1);
    expect(forHr[0].status).toBe("revoked");
  });
});

describe("getSignedAppointmentLetterForAccess", () => {
  const params = { employeeId: "emp-1", issueId: "issue-1", actorUserId: "u-1", inline: false };

  it("returns the verified bytes and audits the view", async () => {
    const file = await getSignedAppointmentLetterForAccess(params);
    expect(Buffer.compare(file.bytes, ACCEPTED)).toBe(0);
    expect(file.fileName).toBe("MCN-AL-1-accepted.pdf");
    expect(audit).toHaveBeenCalledWith("issue-1", "SIGNED_COPY_VIEWED", "u-1", {
      transactionId: "tx-1", inline: false, via: "employee_documents",
    });
  });

  it("row-scopes the letter lookup to the employee in the URL", async () => {
    await getSignedAppointmentLetterForAccess(params);
    const lookup = calls.find((c) => c.sql.includes("FROM appointment_letter_issue WHERE id"))!;
    expect(lookup.sql).toContain("employee_id = ?");
    expect(lookup.params).toEqual(["issue-1", "emp-1"]);
  });

  it("404s an issue id that belongs to a different employee, before any file is read", async () => {
    issueRow = null;
    await expect(getSignedAppointmentLetterForAccess(params)).rejects.toMatchObject({ statusCode: 404 });
    expect(calls.some((c) => c.sql.includes("FROM appointment_letter_esign_transaction"))).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it("passes through the page's own 403 for a caller outside the employee's scope", async () => {
    accessError = httpErr("Forbidden: employee is outside your assigned scope", 403);
    await expect(getSignedAppointmentLetterForAccess(params)).rejects.toMatchObject({ statusCode: 403 });
    expect(calls).toHaveLength(0);
  });

  it("403s a scoped role that is not a letter role (team leader)", async () => {
    access = { isSelf: false, isAdmin: false, roles: ["tl"] };
    await expect(getSignedAppointmentLetterForAccess(params)).rejects.toMatchObject({ statusCode: 403 });
    expect(calls).toHaveLength(0);
  });

  it("404s a revoked letter for the employee, serves it to HR", async () => {
    issueRow = { letter_number: "MCN-AL-1", status: "revoked", revoked_at: "2026-09-25T00:00:00.000Z" };
    access = { isSelf: true, isAdmin: false, roles: ["employee"] };
    await expect(getSignedAppointmentLetterForAccess(params)).rejects.toMatchObject({ statusCode: 404 });
    access = { isSelf: false, isAdmin: false, roles: ["hr"] };
    await expect(getSignedAppointmentLetterForAccess(params)).resolves.toMatchObject({ fileName: "MCN-AL-1-accepted.pdf" });
  });

  it("404s when the letter has no signed copy, and 409s on a hash mismatch", async () => {
    txRows = [];
    await expect(getSignedAppointmentLetterForAccess(params)).rejects.toMatchObject({ statusCode: 404 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    txRows = [{ id: "tx-1", signed_file_path: acceptedPath, signed_file_sha256: sha(Buffer.from("other")), completed_at: null }];
    await expect(getSignedAppointmentLetterForAccess(params)).rejects.toMatchObject({ statusCode: 409 });
    warn.mockRestore();
  });

  it("refuses a recorded path outside the storage root", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    txRows = [{ id: "tx-1", signed_file_path: path.join(os.tmpdir(), "elsewhere.pdf"), signed_file_sha256: null, completed_at: null }];
    await expect(getSignedAppointmentLetterForAccess(params)).rejects.toMatchObject({ statusCode: 404 });
    warn.mockRestore();
  });
});

describe("wiring (source pins: the pack response and the route)", () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");

  it("getJoiningDocumentPack returns signed_appointment_letters and cannot be broken by the lookup", () => {
    const src = read("employeeJoiningDocuments.service.ts");
    const pack = src.slice(src.indexOf("export async function getJoiningDocumentPack"), src.indexOf("export async function generateJoiningDocumentChecklist"));
    expect(pack).toContain("listSignedAppointmentLetters(employeeId, access)");
    expect(pack).toMatch(/listSignedAppointmentLetters\(employeeId, access\)\.catch/);
    expect(pack).toContain("signed_appointment_letters: signedAppointmentLetters");
  });

  it("the signed-copy route lives on the joining-documents router, behind requireAuth, and goes through the access service", () => {
    const src = read("employee.compliance.routes.ts");
    const authAt = src.indexOf("employeeJoiningDocumentsRouter.use(requireAuth)");
    const routeAt = src.indexOf("/joining-documents/appointment-letters/:issueId/signed-copy");
    expect(authAt).toBeGreaterThan(0);
    expect(routeAt).toBeGreaterThan(authAt);
    const route = src.slice(routeAt, routeAt + 900);
    expect(route).toContain("getSignedAppointmentLetterForAccess");
    expect(route).toContain("req.authUser!.id");
    expect(route).toContain("no-store");
  });
});
