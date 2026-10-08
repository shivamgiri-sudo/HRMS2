import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  useEmployeeCodePattern,
  formatEmployeeCodeWithPattern,
  isValidEmployeeCodeWithPattern,
  EmployeeCodePattern,
} from "./useEmployeeCodePattern";

const DEFAULT_PATTERN: EmployeeCodePattern = {
  prefix: "ACQ",
  min_digits: 3,
  separator: "",
};

/**
 * Extract the numeric part from an employee code based on pattern
 */
const extractNumber = (code: string, pattern: EmployeeCodePattern): number => {
  const escapedPrefix = pattern.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedSeparator = pattern.separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escapedPrefix}${escapedSeparator}(\\d+)$`, "i");
  const match = code.match(regex);
  return match ? parseInt(match[1], 10) : 0;
};

/**
 * Format a number as padded employee code (legacy function for backwards compatibility)
 */
export const formatEmployeeCode = (num: number): string => {
  return formatEmployeeCodeWithPattern(num, DEFAULT_PATTERN);
};

/** GET /api/employees rejects limit > 200 (employeeFiltersSchema). */
export const EMPLOYEE_PAGE_SIZE = 200;
/** Hard stop so a broad prefix cannot turn one form load into hundreds of requests. */
export const MAX_EMPLOYEE_PAGES = 50;

/**
 * Highest numeric suffix among employee codes matching the pattern.
 *
 * This used to fetch `/api/employees?limit=1000`, which the API rejects (max 200) — so the
 * query errored and no code was suggested at all. Even when it loaded, it saw only the first
 * 1000 *active* employees, so the "max" could be stale and the suggested code a duplicate.
 * Now: narrowed by the code prefix, across active and inactive records, paged within the limit.
 */
export async function fetchMaxEmployeeCodeNumber(pattern: EmployeeCodePattern): Promise<number> {
  let maxNumber = 0;
  for (let page = 1; page <= MAX_EMPLOYEE_PAGES; page++) {
    const params = new URLSearchParams({
      recordStatus: "all",
      limit: String(EMPLOYEE_PAGE_SIZE),
      page: String(page),
    });
    if (pattern.prefix) params.set("search", pattern.prefix);
    const res = await hrmsApi.get<{ success?: boolean; data: any[]; total?: number }>(
      `/api/employees?${params.toString()}`,
    );
    const employees = Array.isArray(res?.data) ? res.data : [];
    for (const emp of employees) {
      if (emp?.employee_code) {
        const num = extractNumber(String(emp.employee_code), pattern);
        if (num > maxNumber) maxNumber = num;
      }
    }
    const total = Number(res?.total);
    if (employees.length < EMPLOYEE_PAGE_SIZE) break;
    if (Number.isFinite(total) && page * EMPLOYEE_PAGE_SIZE >= total) break;
  }
  return maxNumber;
}

/**
 * Hook to get the next available employee code based on pattern settings
 */
export function useNextEmployeeCode() {
  const { data: pattern = DEFAULT_PATTERN } = useEmployeeCodePattern();

  return useQuery({
    queryKey: ["next-employee-code", pattern],
    queryFn: async () => {
      const maxNumber = await fetchMaxEmployeeCodeNumber(pattern);
      return formatEmployeeCodeWithPattern(maxNumber + 1, pattern);
    },
  });
}

/**
 * Validate that an employee code is in the correct format (legacy function)
 * This now uses the default pattern for backwards compatibility
 * For dynamic validation, use isValidEmployeeCodeWithPattern from useEmployeeCodePattern
 */
export const isValidEmployeeCode = (code: string): boolean => {
  // Accept both the default ACQ pattern and any pattern with prefix + digits
  return /^[A-Z]{2,10}[-_]?\d{1,}$/i.test(code);
};
