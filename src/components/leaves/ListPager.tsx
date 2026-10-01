import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPrev: () => void;
  onNext: () => void;
  onPageSize: (n: number) => void;
}

/** Compact pager shared by the Approvals and History lists. */
export function ListPager({ currentPage, totalPages, pageSize, totalItems, onPrev, onNext, onPageSize }: Props) {
  if (totalItems <= 5) return null;
  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(totalItems, currentPage * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground sm:flex-row">
      <div className="flex items-center gap-2">
        <span>Show</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
          <SelectTrigger className="h-8 w-[72px] rounded-lg text-xs" aria-label="Rows per page"><SelectValue /></SelectTrigger>
          <SelectContent>{[5, 10, 20, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
        </Select>
        <span>per page · {from}–{to} of {totalItems}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={onPrev} disabled={currentPage <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="tabular-nums">Page {currentPage} of {totalPages}</span>
        <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={onNext} disabled={currentPage >= totalPages} aria-label="Next page">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
