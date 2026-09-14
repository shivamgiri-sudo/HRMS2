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
        // org/cost-centres returns { data: [...] } with pagination, or a plain array. Checking
        // Array.isArray(res) directly (rather than res.data first) matters: when res really is a
        // plain array, res.data is undefined, so reading .data off THAT before checking its shape
        // would throw instead of falling back to [].
        const list = Array.isArray(res) ? res : res.data ?? [];
        setCostCentres(list);
      })
      .catch(() => setCostCentres([]))
      .finally(() => setLoading(false));
  }, []);

  return { costCentres, loading };
}
