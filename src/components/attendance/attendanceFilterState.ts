import type { HubFilters } from "@/hooks/useAttendanceHub";

type DependentFilterKey = "branchId" | "processId" | "designationId";

export function getDependentAttendanceFilterChange(
  key: DependentFilterKey,
  value: string,
): Partial<HubFilters> {
  if (key === "branchId") {
    return {
      branchId: value,
      processId: "",
      designationId: "",
      status: "",
      page: 1,
    };
  }

  if (key === "processId") {
    return {
      processId: value,
      designationId: "",
      status: "",
      page: 1,
    };
  }

  return { designationId: value, status: "", page: 1 };
}
