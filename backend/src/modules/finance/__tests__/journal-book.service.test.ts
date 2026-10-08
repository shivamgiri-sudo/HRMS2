import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../journal-voucher.queries.js", () => ({ resolveJvAccountNames: vi.fn() }));

import { clampPage, sourceLabel } from "../journal-book.service.js";

describe("journal book helpers", () => {
  it("names the posting source in plain words", () => {
    expect(sourceLabel("grn")).toBe("GRN");
    expect(sourceLabel("manual")).toBe("Journal voucher");
    expect(sourceLabel("payment_voucher")).toBe("Payment voucher");
    expect(sourceLabel("something_new")).toBe("something_new");
  });

  it("keeps the page size and offset in range", () => {
    expect(clampPage(undefined, undefined)).toEqual({ limit: 100, offset: 0 });
    expect(clampPage("9999", "-5")).toEqual({ limit: 500, offset: 0 });
    expect(clampPage("25", "50")).toEqual({ limit: 25, offset: 50 });
    expect(clampPage("abc", "xyz")).toEqual({ limit: 100, offset: 0 });
  });
});
