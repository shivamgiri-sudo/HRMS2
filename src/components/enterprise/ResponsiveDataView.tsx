import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";

export function ResponsiveDataView<T>({
  data,
  renderDesktop,
  renderMobileCard,
  loading,
  emptyTitle = "No records found",
  emptyDescription = "There is no data available for the current view.",
  keyExtractor,
}: {
  data: T[];
  columns?: unknown;
  renderDesktop: (data: T[]) => ReactNode;
  renderMobileCard: (item: T) => ReactNode;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  keyExtractor: (item: T) => string;
}) {
  if (loading) return <LoadingState rows={5} />;
  if (data.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  return (
    <>
      <div className="hidden md:block">{renderDesktop(data)}</div>
      <div className="grid gap-3 md:hidden">
        {data.map((item) => (
          <div key={keyExtractor(item)}>{renderMobileCard(item)}</div>
        ))}
      </div>
    </>
  );
}
