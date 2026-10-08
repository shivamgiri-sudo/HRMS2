import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HUB_FULL_ACCESS_ROLES,
  LOB_ONLY_IMPORT_RPC,
  LOB_ONLY_UPLOAD_TYPE,
  isLobOnlyUploader,
  restrictLobOnlyFileCategory,
} from "../bulk-role-restriction.js";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

function runFileGuard(roles: string[], category: string) {
  const next = vi.fn();
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnValue({ json }) };
  restrictLobOnlyFileCategory({ authUser: { id: "u", roles }, query: { category } } as any, res as any, next);
  return { next, status: res.status };
}

describe("restrictLobOnlyFileCategory (POST /api/files/upload)", () => {
  it("lets a LOB-only caller upload into the hub's own category only", () => {
    expect(runFileGuard(["branch_wfm"], "bulk-uploads").next).toHaveBeenCalled();
    const denied = runFileGuard(["branch_wfm"], "employee-documents");
    expect(denied.next).not.toHaveBeenCalled();
    expect(denied.status).toHaveBeenCalledWith(403);
  });

  it("does not touch anyone else", () => {
    expect(runFileGuard(["wfm"], "employee-documents").next).toHaveBeenCalled();
    expect(runFileGuard(["admin"], "").next).toHaveBeenCalled();
  });
});

describe("isLobOnlyUploader", () => {
  it.each(["branch_wfm", "ho_wfm", "wfm_spoc"])("restricts a user whose only hub role is %s", (role) => {
    expect(isLobOnlyUploader([role])).toBe(true);
  });

  it("restricts a holder of several LOB-only roles", () => {
    expect(isLobOnlyUploader(["branch_wfm", "wfm_spoc", "ho_wfm"])).toBe(true);
  });

  it("restricts when the other roles carry no hub access (employee, branch_head, ...)", () => {
    expect(isLobOnlyUploader(["branch_wfm", "employee"])).toBe(true);
    expect(isLobOnlyUploader(["wfm_spoc", "branch_head", "team_leader"])).toBe(true);
  });

  it.each([...HUB_FULL_ACCESS_ROLES])("does NOT restrict branch_wfm + %s", (full) => {
    expect(isLobOnlyUploader(["branch_wfm", full])).toBe(false);
    expect(isLobOnlyUploader([full, "wfm_spoc"])).toBe(false);
  });

  it("does not restrict someone holding both branch_wfm and wfm", () => {
    expect(isLobOnlyUploader(["branch_wfm", "wfm"])).toBe(false);
  });

  it("does not restrict when a legacy alias of a full role is held (branch_hr -> hr, payroll_admin -> payroll)", () => {
    expect(isLobOnlyUploader(["branch_wfm", "branch_hr"])).toBe(false);
    expect(isLobOnlyUploader(["ho_wfm", "payroll_admin"])).toBe(false);
    expect(isLobOnlyUploader(["wfm_spoc", "Super Admin"])).toBe(false);
  });

  it("never restricts users who hold no LOB-only role", () => {
    for (const roles of [["admin"], ["hr"], ["super_admin"], ["wfm"], ["wfm_analyst"], ["payroll"], ["payroll_hr"], ["employee"], []]) {
      expect(isLobOnlyUploader(roles)).toBe(false);
    }
    expect(isLobOnlyUploader(undefined)).toBe(false);
    expect(isLobOnlyUploader(null)).toBe(false);
  });

  it("matches role keys case- and whitespace-insensitively", () => {
    expect(isLobOnlyUploader([" Branch_WFM "])).toBe(true);
    expect(isLobOnlyUploader(["Branch WFM", "ADMIN"])).toBe(false);
  });
});

describe("constants stay in step with the importer", () => {
  it("names the same upload type and rpc as the LOB importer and dispatcher", () => {
    const service = readFileSync(path.resolve(__dirname, "../employee-lob-bulk.service.ts"), "utf8");
    const dispatch = readFileSync(path.resolve(__dirname, "../bulk-dispatch.ts"), "utf8");
    expect(service).toContain(`EMPLOYEE_LOB_UPLOAD_TYPE = "${LOB_ONLY_UPLOAD_TYPE}"`);
    expect(dispatch).toContain(`rpc_name === "${LOB_ONLY_IMPORT_RPC}"`);
  });

  it("assertEmployeeLobUploader's role list already covers the three LOB-only roles", () => {
    const service = readFileSync(path.resolve(__dirname, "../../wfm/process-lob-map.service.ts"), "utf8");
    expect(service).toMatch(/WFM_LOB_ROLES = \[[^\]]*"wfm_spoc"[^\]]*"branch_wfm"[^\]]*"ho_wfm"/);
  });
});
