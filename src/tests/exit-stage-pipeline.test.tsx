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
    expect(isPendingAtExit({ status: "exited", clearance_total: 4, clearance_cleared: 2 })).toBe(true);
  });
  it("does not flag a fully cleared exit or one still serving notice", () => {
    expect(isPendingAtExit({ status: "exited", clearance_total: 4, clearance_cleared: 4 })).toBe(false);
    expect(isPendingAtExit({ status: "notice_serving", clearance_total: 4, clearance_cleared: 0 })).toBe(false);
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
      <ExitStagePipeline rows={[{ status: "notice_serving" }]} active="notice" onSelect={() => {}} />,
    );
    expect(html).not.toContain("still have open clearance");
    expect(html).toContain("Show all stages");
  });
});
