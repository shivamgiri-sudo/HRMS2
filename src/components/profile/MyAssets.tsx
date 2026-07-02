import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hrmsApi } from "@/lib/hrmsApi";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Calendar, Tag, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/utils";

interface MyAssetsProps {
  employeeId: string;
}

interface AssetAssignment {
  id: string;
  assigned_date: string;
  returned_date: string | null;
  notes: string | null;
  asset: {
    id: string;
    name: string;
    asset_code: string;
    category: string;
    serial_number: string | null;
  } | null;
}

export function MyAssets({ employeeId }: MyAssetsProps) {
  const { data: assignments, isLoading } = useQuery({
    queryKey: ["my-assets", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/assets-mgmt");
      return (res.data ?? []) as AssetAssignment[];
    },
    enabled: !!employeeId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            My Assets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentAssets = assignments?.filter((a) => !a.returned_date) || [];
  const returnedAssets = assignments?.filter((a) => a.returned_date) || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Currently Assigned Assets
          </CardTitle>
          <CardDescription>Assets currently in your possession</CardDescription>
        </CardHeader>
        <CardContent>
          {currentAssets.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {currentAssets.map((assignment) => (
                <div
                  key={assignment.id}
                  className="rounded-lg border p-4 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium">{assignment.asset?.name || "Unknown Asset"}</h4>
                      <p className="text-sm text-muted-foreground">{assignment.asset?.asset_code}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {assignment.asset?.category}
                    </Badge>
                  </div>
                  {assignment.asset?.serial_number && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Tag className="h-3 w-3" />
                      <span>S/N: {assignment.asset.serial_number}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>Assigned: {format(parseLocalDate(assignment.assigned_date), "MMM d, yyyy")}</span>
                  </div>
                  {assignment.notes && (
                    <p className="text-xs text-muted-foreground italic">{assignment.notes}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="mx-auto h-8 w-8 mb-2 opacity-50" />
              <p>No assets currently assigned</p>
            </div>
          )}
        </CardContent>
      </Card>

      {returnedAssets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Previously Assigned Assets</CardTitle>
            <CardDescription>Assets you have returned</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {returnedAssets.map((assignment) => (
                <div
                  key={assignment.id}
                  className="rounded-lg border border-dashed p-4 space-y-2 opacity-75"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium">{assignment.asset?.name || "Unknown Asset"}</h4>
                      <p className="text-sm text-muted-foreground">{assignment.asset?.asset_code}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      Returned
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>Returned: {format(parseLocalDate(assignment.returned_date!), "MMM d, yyyy")}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
