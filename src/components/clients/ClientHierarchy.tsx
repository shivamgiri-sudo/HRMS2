import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Badge } from "@/components/ui/badge";

interface HierarchyCostCentre {
  id: string;
  cost_centre_code: string;
  status: string;
  active_status: number;
  cc_category: string | null;
  branch_name: string | null;
  billing_client_name: string | null;
}
interface HierarchyProcess {
  process_id: string | null;
  process_name: string;
  process_code: string | null;
  cost_centres: HierarchyCostCentre[];
}

/**
 * Client -> Process -> Cost Centre tree for one client, loaded on first expand.
 * client_master is the single source of the client's name; processes and cost centres hang off it
 * by id, so nothing here is re-typed per screen.
 */
export function ClientHierarchy({
  clientId,
  costCentreCount,
  processCount,
}: {
  clientId: string;
  costCentreCount: number;
  processCount: number;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["client-hierarchy", clientId],
    enabled: open,
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: { processes: HierarchyProcess[] } }>(
        `/api/clients/${clientId}/hierarchy`
      );
      return res.data.processes;
    },
  });

  return (
    <div className="border-t pt-2">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Processes ({processCount}) &middot; Active cost centres ({costCentreCount})
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-sm">
          {isLoading && <div className="text-muted-foreground">Loading...</div>}
          {data?.length === 0 && (
            <div className="text-muted-foreground">No process or cost centre linked to this client.</div>
          )}
          {data?.map((p) => (
            <div key={p.process_id ?? "none"} className="rounded border p-2">
              <div className="font-medium">
                {p.process_name}
                {p.process_code && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.process_code}</span>}
              </div>
              {p.cost_centres.length === 0 ? (
                <div className="text-xs text-muted-foreground">No cost centre</div>
              ) : (
                <ul className="mt-1 space-y-1">
                  {p.cost_centres.map((cc) => (
                    <li key={cc.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono">{cc.cost_centre_code}</span>
                      {cc.cc_category && <Badge variant="outline">{cc.cc_category}</Badge>}
                      {cc.branch_name && <span className="text-muted-foreground">{cc.branch_name}</span>}
                      <Badge variant={cc.status === "active" && cc.active_status ? "default" : "secondary"}>
                        {cc.status === "active" && cc.active_status ? "Active" : cc.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
