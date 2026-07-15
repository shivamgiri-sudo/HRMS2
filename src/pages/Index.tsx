import { Skeleton } from "@/components/ui/skeleton";
import { useUserRole } from "@/hooks/useUserRole";
import ReferenceRoleDashboard from "./dashboards/ReferenceRoleDashboard";
import { resolveRoleDashboardVariant } from "./dashboards/roleDashboardAccess";

export { resolveRoleDashboardVariant } from "./dashboards/roleDashboardAccess";

export default function Index() {
  const { data, isLoading } = useUserRole();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white p-6">
        <div className="mx-auto max-w-[1600px] space-y-4">
          <Skeleton className="h-12 w-80" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-28 rounded-xl" />)}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return <ReferenceRoleDashboard variant={resolveRoleDashboardVariant(data?.roleKeys ?? [])} />;
}
