import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface TeamReport {
  id: string;
  employee_id: string;
  employee_name?: string;
  cycle_name?: string;
  final_rating: number;
  consolidated_strengths: string | null;
  consolidated_improvements: string | null;
}

export default function NativePerformanceFeedbackTeamReports() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<TeamReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTeamReports();
  }, []);

  const fetchTeamReports = async () => {
    try {
      const response = await hrmsApi.get<{ success: boolean; data: TeamReport[] }>(
        "/api/performance-feedback/reports",
      );
      setReports(response.data ?? []);
    } catch (error) {
      console.error("Failed to fetch team reports:", error);
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score < 3) return "text-red-600 bg-red-50";
    if (score < 4) return "text-yellow-600 bg-yellow-50";
    return "text-green-600 bg-green-50";
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Team Feedback Reports</h1>
        <p className="text-gray-500 mt-1">Performance feedback for your team members</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reports.map((report) => {
          return (
            <Card key={report.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{report.employee_name ?? "Employee"}</CardTitle>
                    <p className="text-sm text-gray-500">{report.cycle_name ?? "Performance cycle"}</p>
                  </div>
                  <div className={`text-2xl font-bold rounded-full w-14 h-14 flex items-center justify-center ${getScoreColor(report.final_rating)}`}>
                    {Number(report.final_rating).toFixed(1)}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Top Strength</p>
                    <p className="text-sm font-medium text-green-700">
                      {report.consolidated_strengths || "Not recorded"}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Development Need</p>
                    <p className="text-sm font-medium text-red-700">
                      {report.consolidated_improvements || "Not recorded"}
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => navigate(`/performance-feedback/reports/${report.id}`)}
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    View Full Report
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {reports.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Reports Yet</h3>
            <p className="text-gray-500">Your team members don't have completed feedback reports.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
