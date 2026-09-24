import { describe, expect, it } from "vitest";
import { isLobOnlyHubUser } from "../bulkUploadAccess";

describe("isLobOnlyHubUser", () => {
  it("is true for the three LOB roles on their own", () => {
    for (const role of ["branch_wfm", "ho_wfm", "wfm_spoc"]) expect(isLobOnlyHubUser([role])).toBe(true);
    expect(isLobOnlyHubUser(["branch_wfm", "employee"])).toBe(true);
  });

  it("is false once a role with the full hub is held", () => {
    expect(isLobOnlyHubUser(["branch_wfm", "wfm"])).toBe(false);
    expect(isLobOnlyHubUser(["wfm_spoc", "admin"])).toBe(false);
    expect(isLobOnlyHubUser(["ho_wfm", "hr_admin"])).toBe(false);
  });

  it("is false for everyone else", () => {
    expect(isLobOnlyHubUser(["wfm"])).toBe(false);
    expect(isLobOnlyHubUser([])).toBe(false);
    expect(isLobOnlyHubUser(undefined)).toBe(false);
  });
});
