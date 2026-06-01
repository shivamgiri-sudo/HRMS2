import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Eye } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface TeamReport {
  id: string;
  request_id: string;
  overall_score: number;
  request: {
    employee_id: string;
    // Joined employee data
    employee_name: string;
    designation: string;
  };
  competency_scores_json: Array<{
    competency_id: string;
    competency_name: string;
    score: number;
  }>;
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
      const data = await hrmsApi.get("/api/performance-feedback/reports");
      setReports(data);
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
          const lowestComp = [...report.competency_scores_json].sort((a, b) => a.score - b.score)[0];
          const highestComp = [...report.competency_scores_json].sort((a, b) => b.score - a.score)[0];

          return (
            <Card key={report.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{report.request.employee_name}</CardTitle>
                    <p className="text-sm text-gray-500">{report.request.designation}</p>
                  </div>
                  <div className={`text-2xl font-bold rounded-full w-14 h-14 flex items-center justify-center ${getScoreColor(report.overall_score)}`}>
                    {report.overall_score.toFixed(1)}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Top Strength</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-green-700">{highestComp.competency_name}</span>
                      <Badge className="bg-green-100 text-green-800">{highestComp.score}/5</Badge>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Development Need</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-red-700">{lowestComp.competency_name}</span>
                      <Badge className="bg-red-100 text-red-800">{lowestComp.score}/5</Badge>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => navigate(`/performance-feedback/reports/${report.request_id}`)}
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
