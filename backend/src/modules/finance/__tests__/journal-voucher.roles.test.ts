import { describe, expect, it } from "vitest";
import { computeJvPermissions, holdsAnyRole } from "../journal-voucher.roles.js";

const MAKER = { id: "user-maker", roles: ["finance"] };
const OTHER_MAKER = { id: "user-other-maker", roles: ["finance_head"] };
const APPROVER = { id: "user-approver", roles: ["ceo"] };
const READ_ONLY = { id: "user-employee", roles: ["employee"] };

describe("holdsAnyRole", () => {
  it("matches when the user holds one of the allowed roles", () => {
    expect(holdsAnyRole(["finance_head"], ["finance_head", "ceo"])).toBe(true);
  });
  it("does not match when the user holds none of the allowed roles", () => {
    expect(holdsAnyRole(["employee"], ["finance_head", "ceo"])).toBe(false);
  });
  it("super_admin always matches, regardless of the allowed list", () => {
    expect(holdsAnyRole(["super_admin"], ["finance_head"])).toBe(true);
  });
});

describe("computeJvPermissions", () => {
  it("a draft's own maker can edit, delete and submit it", () => {
    const p = computeJvPermissions({ status: "draft", created_by: MAKER.id }, MAKER);
    expect(p.canEdit).toBe(true);
    expect(p.canDelete).toBe(true);
    expect(p.canSubmit).toBe(true);
    expect(p.canApprove).toBe(false);
  });

  it("a different maker cannot edit or delete someone else's draft", () => {
    const p = computeJvPermissions({ status: "draft", created_by: MAKER.id }, OTHER_MAKER);
    expect(p.canEdit).toBe(false);
    expect(p.canDelete).toBe(false);
    expect(p.canSubmit).toBe(false);
  });

  it("a read-only role cannot edit even its own draft", () => {
    const p = computeJvPermissions({ status: "draft", created_by: READ_ONLY.id }, READ_ONLY);
    expect(p.canEdit).toBe(false);
  });

  it("pending_approval cannot be edited or deleted, even by its own maker", () => {
    const p = computeJvPermissions({ status: "pending_approval", created_by: MAKER.id }, MAKER);
    expect(p.canEdit).toBe(false);
    expect(p.canDelete).toBe(false);
    expect(p.canSubmit).toBe(false);
  });

  it("an approver can approve and reject a pending voucher they did not make", () => {
    const p = computeJvPermissions({ status: "pending_approval", created_by: MAKER.id }, APPROVER);
    expect(p.canApprove).toBe(true);
    expect(p.canReject).toBe(true);
  });

  it("the maker of a pending voucher cannot approve or reject their own voucher, even if they also hold an approver role", () => {
    const makerWhoIsAlsoApprover = { id: "dual-role-user", roles: ["finance_head"] };
    const p = computeJvPermissions({ status: "pending_approval", created_by: makerWhoIsAlsoApprover.id }, makerWhoIsAlsoApprover);
    expect(p.canApprove).toBe(false);
    expect(p.canReject).toBe(false);
  });

  it("the maker can withdraw their own pending voucher", () => {
    const p = computeJvPermissions({ status: "pending_approval", created_by: MAKER.id }, MAKER);
    expect(p.canWithdraw).toBe(true);
  });

  it("finance_head can withdraw someone else's pending voucher even without being the maker", () => {
    const p = computeJvPermissions({ status: "pending_approval", created_by: MAKER.id }, OTHER_MAKER);
    expect(p.canWithdraw).toBe(true);
  });

  it("a rejected voucher can be edited by its maker (editing moves it back to draft, from where it can be resubmitted)", () => {
    const p = computeJvPermissions({ status: "rejected", created_by: MAKER.id }, MAKER);
    expect(p.canEdit).toBe(true);
    expect(p.canSubmit).toBe(false);
  });

  it("a rejected voucher cannot be deleted (only a draft can)", () => {
    const p = computeJvPermissions({ status: "rejected", created_by: MAKER.id }, MAKER);
    expect(p.canDelete).toBe(false);
  });

  it("only a posted voucher can be reversed, and only by a reverse-authorised role", () => {
    const postedByFinanceHead = computeJvPermissions({ status: "posted", created_by: MAKER.id }, { id: "fh", roles: ["finance_head"] });
    expect(postedByFinanceHead.canReverse).toBe(true);
    const draftByFinanceHead = computeJvPermissions({ status: "draft", created_by: MAKER.id }, { id: "fh", roles: ["finance_head"] });
    expect(draftByFinanceHead.canReverse).toBe(false);
    const postedByEmployee = computeJvPermissions({ status: "posted", created_by: MAKER.id }, READ_ONLY);
    expect(postedByEmployee.canReverse).toBe(false);
  });

  it("a posted voucher can no longer be edited, deleted or submitted", () => {
    const p = computeJvPermissions({ status: "posted", created_by: MAKER.id }, MAKER);
    expect(p.canEdit).toBe(false);
    expect(p.canDelete).toBe(false);
    expect(p.canSubmit).toBe(false);
  });
});
