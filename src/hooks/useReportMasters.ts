import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

interface BranchOption { id: string; branch_name: string; }
interface ProcessOption { id: string; process_name: string; }
interface CostCentreOption { id: string; cost_centre_name: string; }
export interface DepartmentOption { id: string; dept_name: string; }

interface ReportMasters {
  branches: BranchOption[];
  processes: ProcessOption[];
  costCentres: CostCentreOption[];
  departments: DepartmentOption[];
}

export function useReportMasters() {
  return useQuery({
    queryKey: ["report-masters"],
    queryFn: async (): Promise<ReportMasters> => {
      const [mastersRes, deptsRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: { branches?: BranchOption[]; processes?: ProcessOption[]; costCentres?: CostCentreOption[]; cost_centres?: CostCentreOption[] } }>(
          "/api/employees/directory-masters"
        ),
        hrmsApi.get<{ success: boolean; data: DepartmentOption[] }>("/api/org/departments")
          .catch(() => ({ success: false, data: [] as DepartmentOption[] })),
      ]);
      return {
        branches:    mastersRes.data?.branches  ?? [],
        processes:   mastersRes.data?.processes ?? [],
        costCentres: mastersRes.data?.costCentres ?? mastersRes.data?.cost_centres ?? [],
        departments: deptsRes.data ?? [],
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
