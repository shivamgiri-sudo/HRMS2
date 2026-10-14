import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: h.get, post: h.post } }));

import { listTallyBatches, listTallyKinds, previewTallyVouchers } from "@/lib/tallyVoucherApi";

beforeEach(() => { h.get.mockReset(); h.post.mockReset(); });

describe("tallyVoucherApi reads the hrmsApi envelope once", () => {
  it("voucher kinds come through (Preview was a no-op when this was empty)", async () => {
    h.get.mockResolvedValue({ success: true, data: [{ kind: "sales", label: "Sales" }, { kind: "credit_note", label: "Credit notes" }] });
    expect((await listTallyKinds()).map((k) => k.kind)).toEqual(["sales", "credit_note"]);
  });

  it("batches come through", async () => {
    h.get.mockResolvedValue({ success: true, data: [{ id: "b1" }] });
    expect(await listTallyBatches({ limit: 30 })).toEqual([{ id: "b1" }]);
  });

  it("preview (spread envelope) keeps its fields, and an error envelope throws", async () => {
    h.post.mockResolvedValueOnce({ success: true, xml: "<ENVELOPE/>", summary: { cleanVouchers: 1 } });
    expect((await previewTallyVouchers({ companyGstin: "09X", periodMonth: "2026-10", voucherKinds: ["sales"] })).xml).toBe("<ENVELOPE/>");
    h.post.mockResolvedValueOnce({ success: false, error: "nope" });
    await expect(previewTallyVouchers({ companyGstin: "09X", periodMonth: "2026-10", voucherKinds: ["sales"] })).rejects.toThrow("nope");
  });
});
