import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

export interface WorkInboxItem {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count: number;
  href: string;
  color?: string; // Tailwind bg-* for count badge
  timestamp?: string;
}

interface WorkInboxPanelProps {
  items: WorkInboxItem[];
  isLoading?: boolean;
  viewAllHref?: string;
}

export function WorkInboxPanel({ items, isLoading, viewAllHref = "/work-inbox" }: WorkInboxPanelProps) {
  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
        <CardTitle className="text-sm font-bold text-slate-900">Work Inbox</CardTitle>
        <Link to={viewAllHref} className="text-xs font-semibold text-[#1B6AB5] hover:underline">
          View All →
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-1 p-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">All clear — no pending items</div>
        ) : (
          <div>
            {items.map((item, i) => (
              <Link
                key={i}
                to={item.href}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors group border-b border-slate-50 last:border-0"
              >
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0 [&_svg]:w-4 [&_svg]:h-4">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                  <p className="text-xs text-slate-500 truncate">{item.subtitle}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span
                    className={`min-w-[28px] h-6 flex items-center justify-center rounded-full text-[11px] font-bold px-2 ${
                      item.color ?? "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {item.count}
                  </span>
                  {item.timestamp && (
                    <span className="text-[11px] text-slate-400 hidden sm:block whitespace-nowrap">
                      {item.timestamp}
                    </span>
                  )}
                  <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
