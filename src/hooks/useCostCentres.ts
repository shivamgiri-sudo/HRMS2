import { useEffect, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";

interface CostCentre {
  id: string;
  cost_centre_code: string;
  cost_centre_name: string;
  branch_id: string | null;
}

export function useCostCentres() {
  const [costCentres, setCostCentres] = useState<CostCentre[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    hrmsApi
      .get<{ data?: CostCentre[] } | CostCentre[]>("/org/cost-centres?active_status=1&limit=500")
      .then((res) => {
        // org/cost-centres returns { data: [...] } with pagination, or a plain array
        const raw = res.data;
        const list = Array.isArray(raw) ? raw : (raw as { data?: CostCentre[] }).data ?? [];
        setCostCentres(list);
      })
      .catch(() => setCostCentres([]))
      .finally(() => setLoading(false));
  }, []);

  return { costCentres, loading };
}
