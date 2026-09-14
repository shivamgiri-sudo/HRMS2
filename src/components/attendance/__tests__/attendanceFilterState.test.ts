import { describe, expect, it } from "vitest";
import { getDependentAttendanceFilterChange } from "../attendanceFilterState";

describe("attendance hub dependent filters", () => {
  it("clears process and designation when branch changes", () => {
    expect(getDependentAttendanceFilterChange("branchId", "branch-2")).toEqual({
      branchId: "branch-2",
      processId: "",
      designationId: "",
      status: "",
      page: 1,
    });
  });

  it("clears designation when process changes", () => {
    expect(getDependentAttendanceFilterChange("processId", "process-3")).toEqual({
      processId: "process-3",
      designationId: "",
      status: "",
      page: 1,
    });
  });

  it("clears status when designation changes", () => {
    expect(getDependentAttendanceFilterChange("designationId", "designation-4")).toEqual({
      designationId: "designation-4",
      status: "",
      page: 1,
    });
  });
});
