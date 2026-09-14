import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
export interface EmployeeCodePattern {
  prefix: string;
  min_digits: number;
  separator: string;
}

const DEFAULT_PATTERN: EmployeeCodePattern = {
  prefix: "ACQ",
  min_digits: 3,
  separator: "",
};

interface SystemSettingRow {
  id: string;
  setting_key: string;
  setting_value: EmployeeCodePattern;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Hook to fetch the employee code pattern from system settings
 */
export function useEmployeeCodePattern() {
  return useQuery({
    queryKey: ["employee-code-pattern"],
    queryFn: async (): Promise<EmployeeCodePattern> => {
      try {
        const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/org/settings/employee_code_pattern");
        if (res.data?.setting_value) {
          const val = typeof res.data.setting_value === 'string' ? JSON.parse(res.data.setting_value) : res.data.setting_value;
          return val as EmployeeCodePattern;
        }
      } catch { /* use default */ }
      return DEFAULT_PATTERN;
    },
  });
}

/**
 * Hook to update the employee code pattern
 */
export function useUpdateEmployeeCodePattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pattern: EmployeeCodePattern) => {
      await hrmsApi.put("/api/org/settings/employee_code_pattern", { setting_value: JSON.stringify(pattern) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-code-pattern"] });
      queryClient.invalidateQueries({ queryKey: ["next-employee-code"] });
    },
  });
}

/**
 * Format employee code based on pattern
 */
export const formatEmployeeCodeWithPattern = (
  num: number,
  pattern: EmployeeCodePattern
): string => {
  const paddedNum = String(num).padStart(pattern.min_digits, "0");
  return `${pattern.prefix}${pattern.separator}${paddedNum}`;
};

/**
 * Create regex pattern for validation based on settings
 */
export const createValidationRegex = (pattern: EmployeeCodePattern): RegExp => {
  const escapedPrefix = pattern.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedSeparator = pattern.separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedPrefix}${escapedSeparator}\\d{${pattern.min_digits},}$`, "i");
};

/**
 * Validate employee code against pattern
 */
export const isValidEmployeeCodeWithPattern = (
  code: string,
  pattern: EmployeeCodePattern
): boolean => {
  const regex = createValidationRegex(pattern);
  return regex.test(code);
};
