import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

interface BranchOption { id: string; branch_name: string; }
interface ProcessOption { id: string; process_name: string; }
interface CostCentreOption { id: string; cost_centre_name: string; }

interface ReportMasters {
  branches: BranchOption[];
  processes: ProcessOption[];
  costCentres: CostCentreOption[];
}

export function useReportMasters() {
  return useQuery({
    queryKey: ["report-masters"],
    queryFn: async (): Promise<ReportMasters> => {
      const res = await hrmsApi.get<{ success: boolean; data: { branches?: BranchOption[]; processes?: ProcessOption[]; costCentres?: CostCentreOption[]; cost_centres?: CostCentreOption[] } }>(
        "/api/employees/directory-masters"
      );
      return {
        branches: res.data?.branches ?? [],
        processes: res.data?.processes ?? [],
        costCentres: res.data?.costCentres ?? res.data?.cost_centres ?? [],
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
