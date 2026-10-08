import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ExitStagePipeline,
  exitStageOf,
  isPendingAtExit,
} from "@/components/exit/ExitStagePipeline";

describe("exitStageOf", () => {
  it.each([
    ["submitted", "resign"],
    ["manager_review", "accept"],
    ["accepted", "accept"],
    ["notice_serving", "notice"],
    ["exit_confirmed", "exit"],
    ["exited", "exit"],
    ["fnf_pending", "settle"],
    ["closed", "settle"],
    ["withdrawn", "stopped"],
  ])("maps %s to %s", (status, stage) => {
    expect(exitStageOf(status)).toBe(stage);
  });
});

describe("isPendingAtExit", () => {
  it("flags an exited employee with open clearance", () => {
    expect(
      isPendingAtExit({
        status: "exited",
        clearance_total: 4,
        clearance_cleared: 2,
      }),
    ).toBe(true);
  });
  it("does not flag a fully cleared exit or one still serving notice", () => {
    expect(
      isPendingAtExit({
        status: "exited",
        clearance_total: 4,
        clearance_cleared: 4,
      }),
    ).toBe(false);
    expect(
      isPendingAtExit({
        status: "notice_serving",
        clearance_total: 4,
        clearance_cleared: 0,
      }),
    ).toBe(false);
  });
});

describe("ExitStagePipeline", () => {
  it("renders five stages with counts and the pending-at-exit banner", () => {
    const html = renderToStaticMarkup(
      <ExitStagePipeline
        rows={[
          { status: "submitted" },
          { status: "exited", clearance_total: 2, clearance_cleared: 1 },
        ]}
        active="all"
        onSelect={() => {}}
      />,
    );
    for (const label of ["Resign", "Accept", "Notice", "Exit", "Settle"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain("1 exited employee(s) still have open clearance");
  });

  it("omits the banner when nothing is pending", () => {
    const html = renderToStaticMarkup(
      <ExitStagePipeline
        rows={[{ status: "notice_serving" }]}
        active="notice"
        onSelect={() => {}}
      />,
    );
    expect(html).not.toContain("still have open clearance");
    expect(html).toContain("Show all stages");
  });

  it("an exited employee with open clearance is shown in Settle, not Exit; fully cleared stays in Exit", async () => {
    const { exitStageOfRow } = await import("@/components/exit/ExitStagePipeline");
    expect(exitStageOfRow({ status: "exited", clearance_total: 8, clearance_cleared: 3 })).toBe("settle");
    expect(exitStageOfRow({ status: "exited", clearance_total: 8, clearance_cleared: 8 })).toBe("exit");
    expect(exitStageOfRow({ status: "exited" })).toBe("exit");
    expect(exitStageOfRow({ status: "clearance_pending" })).toBe("settle");
    expect(exitStageOfRow({ status: "revoked" })).toBe("stopped");
  });

  it("counts open-clearance exited employees in the Settle card", () => {
    const html = renderToStaticMarkup(
      <ExitStagePipeline
        rows={[
          { status: "exited", clearance_total: 2, clearance_cleared: 0 },
          { status: "exited", clearance_total: 2, clearance_cleared: 1 },
          { status: "exited", clearance_total: 2, clearance_cleared: 2 },
        ]}
        active="all"
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("2 exited employee(s) still have open clearance");
  });

  it("flags a backdated resignation as held for HR, and nothing else", async () => {
    const { isHeldForHr } = await import("@/components/exit/ExitStagePipeline");
    const base = { status: "manager_review", exit_type: "voluntary", exit_sub_type: "resignation", submitted_at: "2026-09-30 22:10:00" };
    expect(isHeldForHr({ ...base, last_working_day_proposed: "2026-09-15" })).toBe(true);
    expect(isHeldForHr({ ...base, last_working_day_proposed: "2026-10-31" })).toBe(false);
    expect(isHeldForHr({ ...base, last_working_day_proposed: "2026-09-15", status: "accepted" })).toBe(false);
    expect(isHeldForHr({ ...base, last_working_day_proposed: "2026-09-15", exit_sub_type: "absconding" })).toBe(false);
    const html = renderToStaticMarkup(
      <ExitStagePipeline rows={[{ ...base, last_working_day_proposed: "2026-09-15" }]} active="all" onSelect={() => {}} />,
    );
    expect(html).toContain("1 resignation(s) are held for HR");
  });
});
