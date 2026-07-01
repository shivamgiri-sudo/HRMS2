import { TrendingUp, Award, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ReportSummaryProps {
  overallScore: number;
  maxScore?: number;
  strengths: string[];
  developmentAreas: string[];
  competencies?: Array<{
    name: string;
    rating: number;
  }>;
  className?: string;
}

export function ReportSummary({
  overallScore,
  maxScore = 5,
  strengths,
  developmentAreas,
  competencies = [],
  className,
}: ReportSummaryProps) {
  const percentage = (overallScore / maxScore) * 100;

  const getScoreColor = (score: number) => {
    const pct = (score / maxScore) * 100;
    if (pct >= 80) return "text-emerald-600 bg-emerald-50 border-emerald-200";
    if (pct >= 60) return "text-blue-600 bg-blue-50 border-blue-200";
    if (pct >= 40) return "text-amber-600 bg-amber-50 border-amber-200";
    return "text-rose-600 bg-rose-50 border-rose-200";
  };

  const getPerformanceLabel = (score: number) => {
    const pct = (score / maxScore) * 100;
    if (pct >= 80) return "Exceeds Expectations";
    if (pct >= 60) return "Meets Expectations";
    if (pct >= 40) return "Needs Improvement";
    return "Below Expectations";
  };

  // Calculate spider chart points (pentagon for 5 competencies)
  const generateSpiderPoints = () => {
    if (competencies.length === 0) return "";

    const centerX = 100;
    const centerY = 100;
    const maxRadius = 80;
    const angleStep = (2 * Math.PI) / competencies.length;

    const points = competencies.map((comp, index) => {
      const angle = angleStep * index - Math.PI / 2; // Start from top
      const radius = (comp.rating / maxScore) * maxRadius;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      return `${x},${y}`;
    });

    return points.join(" ");
  };

  // Generate grid circles for spider chart
  const gridCircles = [0.2, 0.4, 0.6, 0.8, 1.0];

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="border-b bg-muted/30">
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          Performance Summary
        </CardTitle>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* Overall Score */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Overall Score</p>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-foreground">
                {overallScore.toFixed(1)}
              </span>
              <span className="text-xl text-muted-foreground">/ {maxScore}</span>
            </div>
            <Badge
              variant="outline"
              className={cn("text-xs font-semibold", getScoreColor(overallScore))}
            >
              {getPerformanceLabel(overallScore)}
            </Badge>
          </div>

          {/* Circular Progress */}
          <div className="relative h-32 w-32">
            <svg className="transform -rotate-90 h-32 w-32">
              <circle
                cx="64"
                cy="64"
                r="56"
                stroke="currentColor"
                strokeWidth="8"
                fill="transparent"
                className="text-muted/30"
              />
              <circle
                cx="64"
                cy="64"
                r="56"
                stroke="currentColor"
                strokeWidth="8"
                fill="transparent"
                strokeDasharray={`${2 * Math.PI * 56}`}
                strokeDashoffset={`${2 * Math.PI * 56 * (1 - percentage / 100)}`}
                className={cn(
                  "transition-all duration-1000",
                  percentage >= 80
                    ? "text-emerald-500"
                    : percentage >= 60
                    ? "text-blue-500"
                    : percentage >= 40
                    ? "text-amber-500"
                    : "text-rose-500"
                )}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl font-bold">{Math.round(percentage)}%</span>
            </div>
          </div>
        </div>

        {/* Spider Chart */}
        {competencies.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Competency Profile</p>
            <div className="flex justify-center">
              <svg
                viewBox="0 0 200 200"
                className="w-full max-w-xs h-auto"
              >
                {/* Grid circles */}
                {gridCircles.map((scale, idx) => (
                  <circle
                    key={idx}
                    cx="100"
                    cy="100"
                    r={scale * 80}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="0.5"
                    className="text-muted-foreground/20"
                  />
                ))}

                {/* Grid lines */}
                {competencies.map((_, index) => {
                  const angle =
                    ((2 * Math.PI) / competencies.length) * index - Math.PI / 2;
                  const x = 100 + 80 * Math.cos(angle);
                  const y = 100 + 80 * Math.sin(angle);
                  return (
                    <line
                      key={index}
                      x1="100"
                      y1="100"
                      x2={x}
                      y2={y}
                      stroke="currentColor"
                      strokeWidth="0.5"
                      className="text-muted-foreground/20"
                    />
                  );
                })}

                {/* Data polygon */}
                <polygon
                  points={generateSpiderPoints()}
                  fill="currentColor"
                  fillOpacity="0.2"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-primary"
                />

                {/* Data points */}
                {competencies.map((comp, index) => {
                  const angle =
                    ((2 * Math.PI) / competencies.length) * index - Math.PI / 2;
                  const radius = (comp.rating / maxScore) * 80;
                  const x = 100 + radius * Math.cos(angle);
                  const y = 100 + radius * Math.sin(angle);
                  return (
                    <circle
                      key={index}
                      cx={x}
                      cy={y}
                      r="3"
                      fill="currentColor"
                      className="text-primary"
                    />
                  );
                })}

                {/* Labels */}
                {competencies.map((comp, index) => {
                  const angle =
                    ((2 * Math.PI) / competencies.length) * index - Math.PI / 2;
                  const x = 100 + 95 * Math.cos(angle);
                  const y = 100 + 95 * Math.sin(angle);
                  return (
                    <text
                      key={index}
                      x={x}
                      y={y}
                      fontSize="8"
                      fill="currentColor"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="text-muted-foreground font-medium"
                    >
                      {comp.name.split(" ")[0]}
                    </text>
                  );
                })}
              </svg>
            </div>
          </div>
        )}

        {/* Strengths */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-medium">Key Strengths</p>
          </div>
          <ul className="space-y-1.5 ml-6">
            {strengths.map((strength, index) => (
              <li
                key={index}
                className="text-sm text-muted-foreground list-disc"
              >
                {strength}
              </li>
            ))}
          </ul>
        </div>

        {/* Development Areas */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-medium">Development Areas</p>
          </div>
          <ul className="space-y-1.5 ml-6">
            {developmentAreas.map((area, index) => (
              <li key={index} className="text-sm text-muted-foreground list-disc">
                {area}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
