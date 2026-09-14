import { Link } from "react-router-dom";
import { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface NavLink {
  label: string;
  href: string;
  icon: LucideIcon;
  color: string; // Tailwind color classes like "bg-blue-100 text-blue-600"
}

interface QuickNavWidgetProps {
  title?: string;
  links: NavLink[];
}

export function QuickNavWidget({ title = "Quick Navigation", links }: QuickNavWidgetProps) {
  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4">
        <CardTitle className="text-sm font-bold text-slate-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-2 gap-3">
          {links.map((link, i) => {
            const Icon = link.icon;
            return (
              <Link
                key={i}
                to={link.href}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-100 hover:border-slate-200 transition group"
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${link.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold text-slate-700 text-center leading-tight">{link.label}</span>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
