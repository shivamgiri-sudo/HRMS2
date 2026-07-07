import { ArrowDown, ArrowUp, Minus, TrendingUp, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface EnhancedKpiCardProps {
  label: string;
  value: string | number;
  trend?: {
    direction: "up" | "down" | "stable";
    value: string | number;
    label: string;
  };
  badge?: {
    text: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  };
  footer?: string;
  icon?: LucideIcon;
  loading?: boolean;
  className?: string;
  sparklineData?: number[];
}

export function EnhancedKpiCard({
  label,
  value,
  trend,
  badge,
  footer,
  icon: Icon,
  loading,
  className,
  sparklineData,
}: EnhancedKpiCardProps) {
  if (loading) {
    return (
      <Card className={`${className || ""} animate-pulse`}>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-32 mb-2" />
          <Skeleton className="h-3 w-20" />
        </CardContent>
      </Card>
    );
  }

  const getTrendIcon = () => {
    if (!trend) return null;
    switch (trend.direction) {
      case "up":
        return <ArrowUp className="h-4 w-4 text-emerald-600" />;
      case "down":
        return <ArrowDown className="h-4 w-4 text-rose-600" />;
      case "stable":
        return <Minus className="h-4 w-4 text-slate-500" />;
    }
  };

  const getTrendColor = () => {
    if (!trend) return "";
    switch (trend.direction) {
      case "up":
        return "text-emerald-600";
      case "down":
        return "text-rose-600";
      case "stable":
        return "text-slate-500";
    }
  };

  return (
    <Card className={`${className || ""} hover:shadow-lg transition-shadow duration-200 border-slate-200 bg-white`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {Icon && (
              <div className="p-2 rounded-lg bg-gradient-to-br from-blue-50 to-sky-50">
                <Icon className="h-4 w-4 text-blue-600" />
              </div>
            )}
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {label}
            </span>
          </div>
          {badge && (
            <Badge variant={badge.variant} className="text-xs">
              {badge.text}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between">
          <div className="flex-1">
            <div className="text-3xl font-black text-slate-900 tracking-tight">
              {value}
            </div>
            {trend && (
              <div className={`flex items-center gap-1 mt-1 text-sm font-semibold ${getTrendColor()}`}>
                {getTrendIcon()}
                <span>{trend.value}</span>
                <span className="text-xs text-slate-500 ml-1">{trend.label}</span>
              </div>
            )}
            {footer && !trend && (
              <div className="mt-1 text-sm text-slate-500">{footer}</div>
            )}
          </div>
          {sparklineData && sparklineData.length > 0 && (
            <div className="ml-4 h-12 flex items-end gap-0.5">
              {sparklineData.map((value, index) => {
                const max = Math.max(...sparklineData);
                const height = max > 0 ? (value / max) * 100 : 0;
                return (
                  <div
                    key={index}
                    className="w-1 bg-gradient-to-t from-blue-500 to-sky-400 rounded-full opacity-60 hover:opacity-100 transition-opacity"
                    style={{ height: `${height}%` }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
