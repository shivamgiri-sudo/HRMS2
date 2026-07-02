/**
 * PageHeader — top section for every HRMS page.
 *
 * Handles: breadcrumbs, title, subtitle, icon, primary action, secondary actions,
 * status badge, and an optional bottom-border divider.
 *
 * Usage (simple):
 *   <PageHeader title="Employees" subtitle="Manage your workforce" />
 *
 * Usage (full):
 *   <PageHeader
 *     breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Employees" }]}
 *     icon={<Users className="h-5 w-5" />}
 *     title="Employees"
 *     subtitle="136 active members across 4 branches"
 *     status={<StatusBadge status="active" />}
 *     action={<Button onClick={onAdd}><Plus className="h-4 w-4 mr-2" />Add Employee</Button>}
 *     secondaryActions={[
 *       <Button variant="outline" onClick={onExport}>Export</Button>
 *     ]}
 *   />
 */

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BreadcrumbItem {
  label: string;
  /** If omitted, the item renders as plain text (current page). */
  href?: string;
}

export interface PageHeaderProps {
  /** Breadcrumb trail rendered above the title. */
  breadcrumbs?: BreadcrumbItem[];
  /** Small icon shown left of the title. */
  icon?: React.ReactNode;
  title: string;
  /** One-line context shown below the title. */
  subtitle?: string;
  /** Status indicator rendered inline with the title. */
  status?: React.ReactNode;
  /** Primary action (rightmost, typically a filled Button). */
  action?: React.ReactNode;
  /** Additional actions rendered left of the primary action. */
  secondaryActions?: React.ReactNode[];
  /** Render a bottom border separator between the header and page content. */
  divider?: boolean;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PageHeader({
  breadcrumbs,
  icon,
  title,
  subtitle,
  status,
  action,
  secondaryActions,
  divider = false,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "space-y-3",
        divider && "border-b border-border pb-4",
        className
      )}
    >
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <li key={idx} className="flex items-center gap-1">
                  {isLast ? (
                    <span aria-current="page" className="font-medium text-foreground">
                      {crumb.label}
                    </span>
                  ) : crumb.href ? (
                    <a
                      href={crumb.href}
                      className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                    >
                      {crumb.label}
                    </a>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                  {!isLast && (
                    <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {/* Title row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: icon + title + subtitle */}
        <div className="flex items-start gap-3">
          {icon && (
            <div
              aria-hidden
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {title}
              </h1>
              {status && <span>{status}</span>}
            </div>
            {subtitle && (
              <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Right: actions */}
        {(action || (secondaryActions && secondaryActions.length > 0)) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {secondaryActions?.map((a, i) => (
              <React.Fragment key={i}>{a}</React.Fragment>
            ))}
            {action}
          </div>
        )}
      </div>
    </header>
  );
}
