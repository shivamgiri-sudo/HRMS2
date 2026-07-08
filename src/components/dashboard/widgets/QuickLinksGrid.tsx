import { Link } from "react-router-dom";
import { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface QuickLink {
  label: string;
  href: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  subtitle?: string;
}

interface QuickLinksGridProps {
  title?: string;
  links: QuickLink[];
  cols?: 3 | 4 | 6;
}

export function QuickLinksGrid({ title = "Quick Links", links, cols = 3 }: QuickLinksGridProps) {
  const colClass = cols === 4 ? "grid-cols-2 sm:grid-cols-4" : cols === 6 ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-3";

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
        <CardTitle className="text-sm font-bold text-slate-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className={`grid ${colClass} gap-3`}>
          {links.map((link, i) => {
            const Icon = link.icon;
            return (
              <Link
                key={i}
                to={link.href}
                className="flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-100 hover:border-slate-200 transition-colors group text-center"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${link.iconBg}`}>
                  <Icon className={`w-5 h-5 ${link.iconColor}`} />
                </div>
                <p className="text-[11px] font-semibold text-slate-700 leading-tight">{link.label}</p>
                {link.subtitle && <p className="text-[10px] text-slate-400">{link.subtitle}</p>}
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
