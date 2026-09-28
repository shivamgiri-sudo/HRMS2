import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-text contract test for the Onfido Name Mapping HR review screen,
 * following this project's established convention for verifying component
 * structure without a DOM renderer (see src/tests/process-pnl-page.contract.test.tsx).
 * There is no @testing-library/react in this project yet, so actual rendering
 * and click behavior are verified by manual UAT, not here.
 */
const componentSource = readFileSync(
  resolve(process.cwd(), "src/pages/onfido-process/OnfidoNameMapping.tsx"),
  "utf8",
);

describe("OnfidoNameMapping component contract", () => {
  it("reads from the admin/hr-gated name-mapping list endpoint", () => {
    expect(componentSource).toContain("/api/onfido-process/name-mapping");
  });

  it("supports filtering to only unverified rows, defaulted on", () => {
    expect(componentSource).toContain("showOnlyUnverified");
    expect(componentSource).toContain("useState(true)");
  });

  it("writes HR's decision via PATCH, not a raw employeeId-less upsert path", () => {
    expect(componentSource).toContain("hrmsApi.patch");
    expect(componentSource).toContain("employeeId:");
  });

  it("invalidates the list query after a successful verify so the row leaves the unverified filter", () => {
    expect(componentSource).toContain("invalidateQueries");
    expect(componentSource).toContain('queryKey: ["onfido-name-mapping"');
  });

  it("allows submitting a blank employee id as an explicit null (no employee matches)", () => {
    expect(componentSource).toContain('trimmed === "" ? null : trimmed');
  });

  it("surfaces a save error to the reviewer instead of failing silently", () => {
    expect(componentSource).toContain("verifyMutation.error");
  });

  it("uses the shared SectionCard/EmptyNote pieces rather than one-off markup", () => {
    expect(componentSource).toContain("<SectionCard");
    expect(componentSource).toContain("<EmptyNote>");
  });
});

describe("OnfidoProcessDashboard mounts the Name Mapping tab", () => {
  const dashboardSource = readFileSync(
    resolve(process.cwd(), "src/pages/onfido-process/OnfidoProcessDashboard.tsx"),
    "utf8",
  );

  it("registers a namemapping view key and tab entry", () => {
    expect(dashboardSource).toContain('"namemapping"');
    expect(dashboardSource).toContain('{ key: "namemapping", label: "Name Mapping (HR)"');
  });

  it("renders OnfidoNameMapping for that view", () => {
    expect(dashboardSource).toContain("import OnfidoNameMapping from \"./OnfidoNameMapping\"");
    expect(dashboardSource).toContain('view === "namemapping" && <OnfidoNameMapping />');
  });

  it("hides the date-range Executive Filters bar for this view (it has its own filter)", () => {
    expect(dashboardSource).toContain('view !== "namemapping"');
  });
});

