import { useState, useMemo } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { CalendarIcon, Download, FileText, Loader2, Table, TrendingUp, Users, Target, Star } from "lucide-react";
import { format, subMonths, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { DatePresets } from "./DatePresets";
import { cn } from "@/lib/utils";
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

interface TeamAnalyticsProps {
  isManager?: boolean;
  managerId?: string;
}

export function TeamAnalytics({ isManager, managerId }: TeamAnalyticsProps) {
  const [startDate, setStartDate] = useState<Date | undefined>(subMonths(new Date(), 6));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");

  // Fetch all employees (filtered by manager if manager view)
  const { data: employees, isLoading: employeesLoading } = useQuery({
    queryKey: ["team-employees", isManager, managerId],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      const all = res.data ?? [];
      if (isManager && managerId) {
        return all.filter((e: any) => e.reporting_manager_id === managerId);
      }
      return all;
    },
  });

  // Fetch all departments
  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/org/departments");
      return res.data ?? [];
    },
  });

  const employeeIds = employees?.map((e) => e.id) || [];

  // Fetch all goals for team
  const { data: goals, isLoading: goalsLoading } = useQuery({
    queryKey: ["team-goals", employeeIds],
    queryFn: async () => {
      if (employeeIds.length === 0) return [];
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/goals/goals");
      return res.data ?? [];
    },
    enabled: employeeIds.length > 0,
  });

  // Fetch all performance reviews for team
  const { data: reviews, isLoading: reviewsLoading } = useQuery({
    queryKey: ["team-reviews", employeeIds],
    queryFn: async () => {
      if (employeeIds.length === 0) return [];
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/performance-feedback/reports");
      return res.data ?? [];
    },
    enabled: employeeIds.length > 0,
  });

  const isLoading = employeesLoading || goalsLoading || reviewsLoading;

  // Filter by date range and department
  const filterByDateRange = (date: string | null) => {
    if (!date || !startDate || !endDate) return true;
    const itemDate = new Date(date);
    return isWithinInterval(itemDate, {
      start: startOfDay(startDate),
      end: endOfDay(endDate),
    });
  };

  const filteredEmployees = useMemo(() => {
    if (!employees) return [];
    if (selectedDepartment === "all") return employees;
    return employees.filter((e) => e.department_id === selectedDepartment);
  }, [employees, selectedDepartment]);

  const filteredEmployeeIds = filteredEmployees.map((e) => e.id);

  const filteredGoals = useMemo(() => {
    return goals?.filter(
      (goal) =>
        filteredEmployeeIds.includes(goal.employee_id) &&
        filterByDateRange(goal.created_at)
    ) || [];
  }, [goals, filteredEmployeeIds, startDate, endDate]);

  const filteredReviews = useMemo(() => {
    return reviews?.filter(
      (review) =>
        filteredEmployeeIds.includes(review.employee_id) &&
        filterByDateRange(review.review_date)
    ) || [];
  }, [reviews, filteredEmployeeIds, startDate, endDate]);

  // Calculate team statistics
  const teamStats = useMemo(() => {
    const totalGoals = filteredGoals.length;
    const completedGoals = filteredGoals.filter((g) => g.status === "completed").length;
    const avgProgress = totalGoals
      ? Math.round(filteredGoals.reduce((sum, g) => sum + (g.progress || 0), 0) / totalGoals)
      : 0;

    const reviewsWithRating = filteredReviews.filter((r) => r.overall_rating);
    const avgRating = reviewsWithRating.length
      ? (reviewsWithRating.reduce((sum, r) => sum + (r.overall_rating || 0), 0) / reviewsWithRating.length).toFixed(1)
      : "N/A";

    return {
      totalEmployees: filteredEmployees.length,
      totalGoals,
      completedGoals,
      completionRate: totalGoals ? Math.round((completedGoals / totalGoals) * 100) : 0,
      avgProgress,
      totalReviews: filteredReviews.length,
      avgRating,
    };
  }, [filteredEmployees, filteredGoals, filteredReviews]);

  // Goal status distribution
  const goalStatusData = useMemo(() => {
    const statusMap = filteredGoals.reduce((acc, goal) => {
      const status = goal.status || "not_started";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(statusMap).map(([status, count]) => ({ status, count }));
  }, [filteredGoals]);

  // Employee performance ranking
  const employeePerformance = useMemo(() => {
    return filteredEmployees.map((emp) => {
      const empGoals = filteredGoals.filter((g) => g.employee_id === emp.id);
      const empReviews = filteredReviews.filter((r) => r.employee_id === emp.id);
      const completedGoals = empGoals.filter((g) => g.status === "completed").length;
      const avgProgress = empGoals.length
        ? Math.round(empGoals.reduce((sum, g) => sum + (g.progress || 0), 0) / empGoals.length)
        : 0;
      const ratingsWithValue = empReviews.filter((r) => r.overall_rating);
      const avgRating = ratingsWithValue.length
        ? ratingsWithValue.reduce((sum, r) => sum + (r.overall_rating || 0), 0) / ratingsWithValue.length
        : 0;

      return {
        ...emp,
        totalGoals: empGoals.length,
        completedGoals,
        avgProgress,
        avgRating,
        reviewCount: empReviews.length,
      };
    }).sort((a, b) => b.avgProgress - a.avgProgress);
  }, [filteredEmployees, filteredGoals, filteredReviews]);

  // Rating distribution
  const ratingDistribution = useMemo(() => {
    const dist = [0, 0, 0, 0, 0];
    filteredReviews.forEach((r) => {
      if (r.overall_rating && r.overall_rating >= 1 && r.overall_rating <= 5) {
        dist[r.overall_rating - 1]++;
      }
    });
    return dist.map((count, idx) => ({ rating: idx + 1, count }));
  }, [filteredReviews]);

  const statusLabels: Record<string, string> = {
    not_started: "Not Started",
    in_progress: "In Progress",
    completed: "Completed",
    on_hold: "On Hold",
  };

  // SmartHR color palette for status visualization
  const statusColors: Record<string, string> = {
    not_started: "hsl(215 16% 47%)",      // Gray (neutral)
    in_progress: "hsl(223 81% 61%)",      // SmartHR Blue (#4361ee)
    completed: "hsl(142 76% 36%)",        // SmartHR Green (#10b981)
    on_hold: "hsl(38 92% 50%)",           // SmartHR Orange (#f59e0b)
  };

  // Export functions
  const exportToCSV = () => {
    const dateRange = `${startDate ? format(startDate, "yyyy-MM-dd") : "all"}_to_${endDate ? format(endDate, "yyyy-MM-dd") : "all"}`;
    
    let csvContent = "Team Performance Analytics Report\n";
    csvContent += `Date Range: ${startDate ? format(startDate, "PPP") : "All"} to ${endDate ? format(endDate, "PPP") : "All"}\n\n`;
    
    csvContent += "TEAM SUMMARY\n";
    csvContent += `Total Employees,${teamStats.totalEmployees}\n`;
    csvContent += `Total Goals,${teamStats.totalGoals}\n`;
    csvContent += `Completed Goals,${teamStats.completedGoals}\n`;
    csvContent += `Completion Rate,${teamStats.completionRate}%\n`;
    csvContent += `Average Progress,${teamStats.avgProgress}%\n`;
    csvContent += `Total Reviews,${teamStats.totalReviews}\n`;
    csvContent += `Average Rating,${teamStats.avgRating}\n\n`;
    
    csvContent += "EMPLOYEE PERFORMANCE\n";
    csvContent += "Employee,Designation,Goals,Completed,Progress,Avg Rating,Reviews\n";
    employeePerformance.forEach((emp) => {
      csvContent += `"${emp.first_name} ${emp.last_name}",${emp.designation},${emp.totalGoals},${emp.completedGoals},${emp.avgProgress}%,${emp.avgRating.toFixed(1)},${emp.reviewCount}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `team_analytics_${dateRange}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported successfully");
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    const dateRange = `${startDate ? format(startDate, "MMM d, yyyy") : "All"} to ${endDate ? format(endDate, "MMM d, yyyy") : "All"}`;
    
    doc.setFontSize(18);
    doc.text("Team Performance Analytics", 14, 22);
    
    doc.setFontSize(11);
    doc.text(`Date Range: ${dateRange}`, 14, 32);
    
    // Summary
    doc.setFontSize(14);
    doc.text("Summary", 14, 45);
    
    autoTable(doc, {
      startY: 50,
      head: [["Metric", "Value"]],
      body: [
        ["Total Employees", teamStats.totalEmployees.toString()],
        ["Total Goals", teamStats.totalGoals.toString()],
        ["Completed Goals", teamStats.completedGoals.toString()],
        ["Completion Rate", `${teamStats.completionRate}%`],
        ["Average Progress", `${teamStats.avgProgress}%`],
        ["Total Reviews", teamStats.totalReviews.toString()],
        ["Average Rating", teamStats.avgRating.toString()],
      ],
      theme: "striped",
    });

    // Employee rankings
    const startY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(14);
    doc.text("Employee Performance", 14, startY);
    
    autoTable(doc, {
      startY: startY + 5,
      head: [["Employee", "Designation", "Goals", "Completed", "Progress", "Avg Rating"]],
      body: employeePerformance.slice(0, 15).map((emp) => [
        `${emp.first_name} ${emp.last_name}`,
        emp.designation,
        emp.totalGoals.toString(),
        emp.completedGoals.toString(),
        `${emp.avgProgress}%`,
        emp.avgRating.toFixed(1),
      ]),
      theme: "striped",
    });

    doc.save(`team_analytics_${startDate ? format(startDate, "yyyy-MM-dd") : "all"}_to_${endDate ? format(endDate, "yyyy-MM-dd") : "all"}.pdf`);
    toast.success("PDF exported successfully");
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
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
              {!isManager && departments && departments.length > 0 && (
                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Departments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>
                        {dept.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
      <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{teamStats.totalEmployees}</span>
            </div>
            <p className="text-sm text-muted-foreground">Employees</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{teamStats.totalGoals}</span>
            </div>
            <p className="text-sm text-muted-foreground">Total Goals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-emerald-600">{teamStats.completedGoals}</div>
            <p className="text-sm text-muted-foreground">Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{teamStats.completionRate}%</div>
            <p className="text-sm text-muted-foreground">Completion Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{teamStats.avgProgress}%</div>
            <p className="text-sm text-muted-foreground">Avg. Progress</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{teamStats.totalReviews}</div>
            <p className="text-sm text-muted-foreground">Reviews</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-500" />
              <span className="text-2xl font-bold">{teamStats.avgRating}</span>
            </div>
            <p className="text-sm text-muted-foreground">Avg. Rating</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Goal Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Goal Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {goalStatusData.length > 0 ? (
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
                No goals data
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rating Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rating Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredReviews.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={ratingDistribution}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="rating"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => `${v} ★`}
                  />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip formatter={(value) => [value, "Reviews"]} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[250px] items-center justify-center text-muted-foreground">
                No review data
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Employee Performance Ranking */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            Employee Performance Ranking
          </CardTitle>
        </CardHeader>
        <CardContent>
          {employeePerformance.length > 0 ? (
            <div className="space-y-4">
              {employeePerformance.slice(0, 10).map((emp, idx) => (
                <div
                  key={emp.id}
                  className="flex items-center gap-4 rounded-lg border p-4"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {idx + 1}
                  </div>
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>
                      {emp.first_name?.[0]}{emp.last_name?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {emp.first_name} {emp.last_name}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">{emp.designation}</p>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <p className="font-medium">{emp.completedGoals}/{emp.totalGoals}</p>
                      <p className="text-xs text-muted-foreground">Goals</p>
                    </div>
                    <div className="w-24">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Progress</span>
                        <span className="text-xs font-medium">{emp.avgProgress}%</span>
                      </div>
                      <Progress value={emp.avgProgress} className="h-2" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Star className="h-4 w-4 text-amber-500" />
                      <span className="font-medium">{emp.avgRating.toFixed(1)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No employee data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
