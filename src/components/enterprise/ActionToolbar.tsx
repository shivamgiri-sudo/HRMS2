import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function ActionToolbar({
  primary,
  secondary,
  className,
}: {
  primary?: ReactNode;
  secondary?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {primary}
      <div className="hidden items-center gap-2 sm:flex">{secondary}</div>
      {secondary && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-10 w-10 rounded-[var(--r-md)] sm:hidden">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="p-2">
            <div className="grid gap-2">{secondary}</div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
