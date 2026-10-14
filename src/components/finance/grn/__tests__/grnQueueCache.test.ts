import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { dropGrnFromQueues } from "../grnQueueCache";

const rows = (ids: string[]) => ids.map((id) => ({ id }));

describe("dropGrnFromQueues", () => {
  it("removes the decided GRN from every cached list and shrinks the total", () => {
    const qc = new QueryClient();
    qc.setQueryData(["grn-list", "submitted", "_all", "", "", "", 1], rows(["a", "b", "c"]));
    qc.setQueryData(["imprest-approval-queue", "", ""], { rows: rows(["a", "z"]), total: 2 });
    qc.setQueryData(["grn-list", "_all", "_all", "", "", "", 1], rows(["x"]));
    dropGrnFromQueues(qc, { id: "a" });
    expect(qc.getQueryData(["grn-list", "submitted", "_all", "", "", "", 1])).toEqual(rows(["b", "c"]));
    expect(qc.getQueryData(["imprest-approval-queue", "", ""])).toEqual({ rows: rows(["z"]), total: 1 });
    expect(qc.getQueryData(["grn-list", "_all", "_all", "", "", "", 1])).toEqual(rows(["x"]));
  });

  it("takes the GRN off its summary bucket and the in-queue total", () => {
    const qc = new QueryClient();
    qc.setQueryData(["grn-summary"], {
      byStatus: { submitted: { count: 5, value: 1000 }, paid: { count: 9, value: 9 } },
      inQueue: { count: 7, value: 2000 },
    });
    dropGrnFromQueues(qc, { id: "a", status: "submitted", amount: 250 });
    expect(qc.getQueryData(["grn-summary"])).toEqual({
      byStatus: { submitted: { count: 4, value: 750 }, paid: { count: 9, value: 9 } },
      inQueue: { count: 6, value: 1750 },
    });
  });

  it("never goes negative and ignores a summary that is not loaded", () => {
    const qc = new QueryClient();
    dropGrnFromQueues(qc, { id: "a", status: "submitted", amount: 10 });
    expect(qc.getQueryData(["grn-summary"])).toBeUndefined();
    qc.setQueryData(["grn-summary"], { byStatus: { submitted: { count: 0, value: 0 } }, inQueue: { count: 0, value: 0 } });
    dropGrnFromQueues(qc, { id: "a", status: "submitted", amount: 10 });
    expect((qc.getQueryData(["grn-summary"]) as any).byStatus.submitted).toEqual({ count: 0, value: 0 });
  });
});
