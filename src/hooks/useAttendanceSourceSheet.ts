import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type PayrollSource = "apr" | "cosec";

export interface SourceSheetDay {
  code: string;
  status: string;
  cosecMinutes: number | null;
  aprMinutes: number | null;
  /** The reading that decided the day's status — the payroll attendance source. */
  payrollSource: PayrollSource | null;
}

export interface SourceSheetEmployee {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branch: string | null;
  costCentre: string | null;
  process: string | null;
  lob: string | null;
  attendanceSource: string;
  days: Record<string, SourceSheetDay>;
}

export interface SourceSheetFilters {
  month: string;
  branchId: string;
  processId: string;
  search: string;
  page: number;
  limit: number;
}

interface SourceSheetResponse {
  data: { month: string; days: string[]; employees: SourceSheetEmployee[] };
  total: number;
}

const BASE_PATH = "/api/wfm/attendance-source-sheet";

function toParams(
  f: Omit<SourceSheetFilters, "page" | "limit">,
): URLSearchParams {
  const params = new URLSearchParams({ month: f.month });
  if (f.branchId) params.set("branchId", f.branchId);
  if (f.processId) params.set("processId", f.processId);
  if (f.search.trim()) params.set("search", f.search.trim());
  return params;
}

export function useAttendanceSourceSheet(filters: SourceSheetFilters) {
  return useQuery({
    queryKey: ["attendance-source-sheet", filters],
    queryFn: async () => {
      const params = toParams(filters);
      params.set("page", String(filters.page));
      params.set("limit", String(filters.limit));
      const res = await hrmsApi.get<SourceSheetResponse>(
        `${BASE_PATH}?${params}`,
      );
      return {
        month: res.data.month,
        days: res.data.days,
        employees: res.data.employees,
        total: res.total,
      };
    },
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

/** Downloads the whole filtered sheet (every page) as .xlsx. */
export async function downloadAttendanceSourceSheet(
  filters: Omit<SourceSheetFilters, "page" | "limit">,
): Promise<void> {
  const blob = await hrmsApi.getBlob(
    `${BASE_PATH}/export?${toParams(filters)}`,
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `attendance-source-sheet-${filters.month}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
