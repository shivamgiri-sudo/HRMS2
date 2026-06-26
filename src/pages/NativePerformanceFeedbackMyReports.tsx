import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, TrendingUp, TrendingDown, Minus, Calendar } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";

interface Report {
  id: string;
  cycle_id: string;
  employee_id: string;
  self_rating: number | null;
  peer_avg_rating: number | null;
  manager_rating: number | null;
  final_rating: number;
  consolidated_strengths: string | null;
  consolidated_improvements: string | null;
  report_generated_at: string;
  // Joined data
  cycle_name?: string;
  employee_name?: string;
}

interface ReportWithTrend extends Report {
  trend?: "up" | "down" | "stable";
}

export default function NativePerformanceFeedbackMyReports() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [reports, setReports] = useState<ReportWithTrend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const qs = user?.id ? `?employee_id=${encodeURIComponent(user.id)}` : "";
      const resp = await hrmsApi.get<{ success: boolean; data: Report[] }>(`/api/performance-feedback/reports${qs}`);
      const data: Report[] = resp.data ?? [];

      // Calculate trends by comparing consecutive reports
      const reportsWithTrends = data.map((report: Report, index: number) => {
        if (index === data.length - 1) {
          return { ...report, trend: "stable" as const };
        }

        const prevReport = data[index + 1];
        const diff = report.final_rating - prevReport.final_rating;

        let trend: "up" | "down" | "stable" = "stable";
        if (diff > 0.2) trend = "up";
        else if (diff < -0.2) trend = "down";

        return { ...report, trend };
      });

      setReports(reportsWithTrends);
    } catch (error) {
      console.error("Failed to fetch reports:", error);
    } finally {
      setLoading(false);
    }
  };

  const getRatingColor = (rating: number) => {
    if (rating >= 4.5) return "text-green-600";
    if (rating >= 3.5) return "text-blue-600";
    if (rating >= 2.5) return "text-yellow-600";
    return "text-red-600";
  };

  const getRatingBadgeColor = (rating: number) => {
    if (rating >= 4.5) return "bg-green-100 text-green-800";
    if (rating >= 3.5) return "bg-blue-100 text-blue-800";
    if (rating >= 2.5) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const getTrendIcon = (trend?: "up" | "down" | "stable") => {
    if (trend === "up") return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (trend === "down") return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const getLatestRating = () => {
    if (reports.length === 0) return null;
    return reports[0].final_rating;
  };

  const getAverageRating = () => {
    if (reports.length === 0) return null;
    const sum = reports.reduce((acc, r) => acc + r.final_rating, 0);
    return (sum / reports.length).toFixed(2);
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">My Performance Reports</h1>
        <p className="text-gray-500 mt-1">View your feedback history and track progress</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Reports</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{reports.length}</p>
              </div>
              <FileText className="w-10 h-10 text-indigo-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Latest Rating</p>
                <p className={`text-3xl font-bold mt-1 ${getRatingColor(getLatestRating() ?? 0)}`}>
                  {getLatestRating()?.toFixed(2) ?? "N/A"}
                </p>
              </div>
              <div className="flex items-center space-x-2">
                {reports.length > 0 && getTrendIcon(reports[0].trend)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Average Rating</p>
                <p className={`text-3xl font-bold mt-1 ${getRatingColor(parseFloat(getAverageRating() ?? "0"))}`}>
                  {getAverageRating() ?? "N/A"}
                </p>
              </div>
              <Calendar className="w-10 h-10 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {reports.map((report) => (
          <Card key={report.id} className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <span>{report.cycle_name}</span>
                    {getTrendIcon(report.trend)}
                  </CardTitle>
                  <p className="text-sm text-gray-500">
                    {formatISTDate(report.report_generated_at)}
                  </p>
                </div>
                <Badge className={getRatingBadgeColor(report.final_rating)}>
                  {report.final_rating.toFixed(2)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {report.self_rating !== null && (
                  <div>
                    <p className="text-xs text-gray-500">Self Rating</p>
                    <p className="text-lg font-semibold">{report.self_rating.toFixed(2)}</p>
                  </div>
                )}
                {report.peer_avg_rating !== null && (
                  <div>
                    <p className="text-xs text-gray-500">Peer Average</p>
                    <p className="text-lg font-semibold">{report.peer_avg_rating.toFixed(2)}</p>
                  </div>
                )}
                {report.manager_rating !== null && (
                  <div>
                    <p className="text-xs text-gray-500">Manager Rating</p>
                    <p className="text-lg font-semibold">{report.manager_rating.toFixed(2)}</p>
                  </div>
                )}
              </div>

              {report.consolidated_strengths && (
                <div className="mb-3">
                  <p className="text-xs text-gray-500 mb-1">Strengths</p>
                  <p className="text-sm text-gray-700 line-clamp-2">
                    {report.consolidated_strengths}
                  </p>
                </div>
              )}

              <Button
                onClick={() => navigate(`/performance-feedback/reports/${report.id}`)}
                variant="outline"
                className="w-full"
              >
                View Full Report
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {reports.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Reports Yet</h3>
            <p className="text-gray-500">
              Your performance reports will appear here once feedback cycles are completed.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
