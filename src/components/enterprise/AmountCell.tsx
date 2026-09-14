import { cn } from "@/lib/utils";

export function AmountCell({
  amount,
  prefix,
  className,
}: {
  amount: number;
  prefix?: string;
  className?: string;
}) {
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);

  return <span className={cn("tabular-nums", className)}>{prefix}{formatted}</span>;
}
