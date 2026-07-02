import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EnterprisePageHeader } from "./EnterprisePageHeader";

export function EnterprisePageShell({
  eyebrow,
  title,
  description,
  status,
  children,
  actions,
  breadcrumbs,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: string;
  children: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-5", className)}>
      {breadcrumbs}
      <EnterprisePageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        status={status}
        primaryAction={actions}
      />
      {children}
    </div>
  );
}
