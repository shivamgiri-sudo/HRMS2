import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { CalendarIcon, Download, FileText, Loader2, Table } from "lucide-react";
import { format, subMonths, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { DatePresets } from "./DatePresets";
import { cn, normalizeDate } from "@/lib/utils";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface PerformanceAnalyticsProps {
  employeeId: string;
}

export function PerformanceAnalytics({ employeeId }: PerformanceAnalyticsProps) {
  const [startDate, setStartDate] = useState<Date | undefined>(subMonths(new Date(), 6));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());

  // Fetch KPIs for trend analysis
  const { data: goals, isLoading: goalsLoading } = useQuery({
    queryKey: ["goals-analytics", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/goals/goals");
      return res.data ?? [];
    },
  });

  // Fetch performance reviews for rating trends
  const { data: reviews, isLoading: reviewsLoading } = useQuery({
    queryKey: ["reviews-analytics", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/performance-feedback/reports");
      return res.data ?? [];
    },
  });

  if (goalsLoading || reviewsLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Filter data by date range
  const filterByDateRange = (date: string | null) => {
    if (!date || !startDate || !endDate) return true;
    const itemDate = new Date(date);
    return isWithinInterval(itemDate, {
      start: startOfDay(startDate),
      end: endOfDay(endDate),
    });
  };

  const filteredGoals = goals?.filter((goal) => filterByDateRange(goal.created_at)) || [];
  const filteredReviews = reviews?.filter((review) => filterByDateRange(review.review_date)) || [];

  // Process KPIs data for status distribution
  const goalStatusData = filteredGoals.reduce((acc, goal) => {
    const status = goal.status || "not_started";
    const existing = acc.find((item) => item.status === status);
    if (existing) {
      existing.count += 1;
    } else {
      acc.push({ status, count: 1 });
    }
    return acc;
  }, [] as { status: string; count: number }[]);

  const statusLabels: Record<string, string> = {
    not_started: "Not Started",
    in_progress: "In Progress",
    completed: "Completed",
    on_hold: "On Hold",
  };

  const statusColors: Record<string, string> = {
    not_started: "hsl(var(--muted-foreground))",
    in_progress: "hsl(var(--primary))",
    completed: "hsl(142 76% 36%)",
    on_hold: "hsl(38 92% 50%)",
  };

  // Process KPIs for monthly completion trend
  const monthlyGoalsTrend = filteredGoals.reduce((acc, goal) => {
    if (goal.completed_at && filterByDateRange(goal.completed_at)) {
      const month = new Date(goal.completed_at).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
      const existing = acc.find((item) => item.month === month);
      if (existing) {
        existing.completed += 1;
      } else {
        acc.push({ month, completed: 1 });
      }
    }
    return acc;
  }, [] as { month: string; completed: number }[]);

  // Process reviews for rating trend
  const ratingTrend = filteredReviews.map((review) => ({
    period: review.review_period,
    rating: review.overall_rating || 0,
    date: new Date(normalizeDate(review.review_date)).toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    }),
  }));

  // Calculate average progress
  const avgProgress = filteredGoals.length
    ? Math.round(
        filteredGoals.reduce((sum, goal) => sum + (goal.progress || 0), 0) / filteredGoals.length
      )
    : 0;

  // Calculate average rating
  const ratingsWithValue = filteredReviews.filter((r) => r.overall_rating);
  const avgRating = ratingsWithValue.length
    ? (
        ratingsWithValue.reduce((sum, r) => sum + (r.overall_rating || 0), 0) /
        ratingsWithValue.length
      ).toFixed(1)
    : "N/A";

  const hasKPIData = filteredGoals.length > 0;
  const hasReviewData = filteredReviews.length > 0;

  // Export to CSV
  const exportToCSV = () => {
    const dateRange = `${startDate ? format(startDate, "yyyy-MM-dd") : "all"}_to_${endDate ? format(endDate, "yyyy-MM-dd") : "all"}`;
    
    // KPIs CSV
    let csvContent = "Performance Analytics Report\n";
    csvContent += `Date Range: ${startDate ? format(startDate, "PPP") : "All"} to ${endDate ? format(endDate, "PPP") : "All"}\n\n`;
    
    csvContent += "SUMMARY\n";
    csvContent += `Total KPIs,${filteredGoals.length}\n`;
    csvContent += `Average Progress,${avgProgress}%\n`;
    csvContent += `Total Reviews,${filteredReviews.length}\n`;
     csvContent += `Average Rating,${avgRating}\n\n`;
    
     csvContent += "KPIs\n";
    csvContent += "Title,Status,Progress,Priority,Due Date,Created At\n";
    filteredGoals.forEach((goal) => {
      csvContent += `"${goal.title}",${goal.status},${goal.progress || 0}%,${goal.priority || "N/A"},${goal.due_date || "N/A"},${goal.created_at ? format(new Date(goal.created_at), "yyyy-MM-dd") : "N/A"}\n`;
    });
    
    csvContent += "\nPERFORMANCE REVIEWS\n";
    csvContent += "Review Period,Date,Rating,Status\n";
    filteredReviews.forEach((review) => {
      csvContent += `"${review.review_period}",${review.review_date},${review.overall_rating || "N/A"},${review.status}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `performance_analytics_${dateRange}.csv`;
    link.click();
    toast.success("CSV exported successfully");
  };

  // Export to PDF
  const exportToPDF = () => {
    const doc = new jsPDF();
    const dateRange = `${startDate ? format(startDate, "MMM d, yyyy") : "All"} to ${endDate ? format(endDate, "MMM d, yyyy") : "All"}`;
    
    doc.setFontSize(18);
    doc.text("Performance Analytics Report", 14, 22);
    
    doc.setFontSize(11);
    doc.text(`Date Range: ${dateRange}`, 14, 32);
    
    // Summary section
    doc.setFontSize(14);
    doc.text("Summary", 14, 45);
    
    autoTable(doc, {
      startY: 50,
      head: [["Metric", "Value"]],
      body: [
        ["Total KPIs", filteredGoals.length.toString()],
        ["Average Progress", `${avgProgress}%`],
        ["Total Reviews", filteredReviews.length.toString()],
        ["Average Rating", avgRating.toString()],
      ],
      theme: "striped",
    });

    // Goals section
    const goalsStartY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(14);
    doc.text("KPIs", 14, goalsStartY);
    
    if (filteredGoals.length > 0) {
      autoTable(doc, {
        startY: goalsStartY + 5,
        head: [["Title", "Status", "Progress", "Priority", "Due Date"]],
        body: filteredGoals.map((goal) => [
          goal.title,
          statusLabels[goal.status] || goal.status,
          `${goal.progress || 0}%`,
          goal.priority || "N/A",
          goal.due_date || "N/A",
        ]),
        theme: "striped",
      });
    }

    // Reviews section
    const reviewsStartY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(14);
    doc.text("Performance Reviews", 14, reviewsStartY);
    
    if (filteredReviews.length > 0) {
      autoTable(doc, {
        startY: reviewsStartY + 5,
        head: [["Review Period", "Date", "Rating", "Status"]],
        body: filteredReviews.map((review) => [
          review.review_period,
          review.review_date,
          review.overall_rating?.toString() || "N/A",
          review.status,
        ]),
        theme: "striped",
      });
    }

    doc.save(`performance_analytics_${startDate ? format(startDate, "yyyy-MM-dd") : "all"}_to_${endDate ? format(endDate, "yyyy-MM-dd") : "all"}.pdf`);
    toast.success("PDF exported successfully");
  };

  return (
    <div className="space-y-6">
      {/* Date Range Filter */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-sm font-medium">Date Range:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[160px] justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "PP") : "Start"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground">to</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[160px] justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "PP") : "End"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportToCSV}>
                  <Table className="mr-2 h-4 w-4" />
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportToPDF}>
                  <FileText className="mr-2 h-4 w-4" />
                  Export as PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DatePresets
            onSelect={(start, end) => {
              setStartDate(start);
              setEndDate(end);
            }}
          />
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{filteredGoals.length}</div>
            <p className="text-sm text-muted-foreground">Total KPIs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{avgProgress}%</div>
            <p className="text-sm text-muted-foreground">Avg. Progress</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{filteredReviews.length}</div>
            <p className="text-sm text-muted-foreground">Reviews</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{avgRating}</div>
            <p className="text-sm text-muted-foreground">Avg. Rating</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* KPI Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">KPI Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {hasKPIData ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={goalStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="count"
                    nameKey="status"
                    label={({ status, count }) =>
                      `${statusLabels[status] || status}: ${count}`
                    }
                  >
                    {goalStatusData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={statusColors[entry.status] || "hsl(var(--muted))"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [
                      value,
                      statusLabels[name as string] || name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                No KPI data in selected range
              </div>
            )}
          </CardContent>
        </Card>

        {/* Performance Rating Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Performance Rating Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {hasReviewData && ratingTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={ratingTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 12 }}
                    className="text-muted-foreground"
                  />
                  <YAxis
                    domain={[0, 5]}
                    ticks={[1, 2, 3, 4, 5]}
                    tick={{ fontSize: 12 }}
                    className="text-muted-foreground"
                  />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="rating"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                No review data in selected range
              </div>
            )}
          </CardContent>
        </Card>

        {/* KPIs Completion Trend */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">KPIs Completed Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyGoalsTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={monthlyGoalsTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 12 }}
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    className="text-muted-foreground"
                    allowDecimals={false}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="completed"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                No completed KPIs in selected range
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
