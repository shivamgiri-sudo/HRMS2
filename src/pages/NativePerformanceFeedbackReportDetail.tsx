import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, TrendingUp, User, Users, UserCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { CompetencyCard } from "@/components/performance-feedback";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatISTDate } from "@/lib/utils";

interface CompetencyScore {
  competency_id: string;
  competency_name: string;
  rating: number;
  comment?: string;
}

interface FeedbackDetail {
  id: string;
  request_id: string;
  ratings: {
    competencies: CompetencyScore[];
  };
  overall_rating: number;
  strengths: string | null;
  areas_for_improvement: string | null;
  comments: string | null;
  submitted_at: string;
  reviewer_name?: string;
  reviewer_type?: string;
}

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
  cycle_name?: string;
  employee_name?: string;
  feedback_details?: FeedbackDetail[];
}

interface TrendDataPoint {
  name: string;
  rating: number;
}

export default function NativePerformanceFeedbackReportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchReportDetail();
      fetchTrendData();
    }
  }, [id]);

  const fetchReportDetail = async () => {
    try {
      const data = await hrmsApi.get(`/api/performance-feedback/reports/${id}`);
      setReport(data);
    } catch (error) {
      console.error("Failed to fetch report detail:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTrendData = async () => {
    try {
      // Fetch all reports for the employee to show trend
      const allReports = await hrmsApi.get("/api/performance-feedback/reports");

      const trend = allReports
        .slice(0, 5)
        .reverse()
        .map((r: Report) => ({
          name: r.cycle_name || formatISTDate(r.report_generated_at),
          rating: r.final_rating,
        }));

      setTrendData(trend);
    } catch (error) {
      console.error("Failed to fetch trend data:", error);
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

  const getReviewerIcon = (reviewerType?: string) => {
    if (reviewerType === "self") return <User className="w-4 h-4" />;
    if (reviewerType === "peer") return <Users className="w-4 h-4" />;
    if (reviewerType === "manager") return <UserCircle className="w-4 h-4" />;
    return null;
  };

  const aggregateCompetencyScores = () => {
    if (!report?.feedback_details) return [];

    const competencyMap = new Map<string, { name: string; ratings: number[]; comments: string[] }>();

    report.feedback_details.forEach((feedback) => {
      feedback.ratings.competencies.forEach((comp) => {
        if (!competencyMap.has(comp.competency_id)) {
          competencyMap.set(comp.competency_id, {
            name: comp.competency_name,
            ratings: [],
            comments: [],
          });
        }
        const entry = competencyMap.get(comp.competency_id)!;
        entry.ratings.push(comp.rating);
        if (comp.comment) entry.comments.push(comp.comment);
      });
    });

    return Array.from(competencyMap.entries()).map(([id, data]) => ({
      competency_id: id,
      competency_name: data.name,
      avg_rating: (data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length).toFixed(2),
      rating_count: data.ratings.length,
      comments: data.comments,
    }));
  };

  if (loading) return <div className="p-8">Loading...</div>;
  if (!report) return <div className="p-8">Report not found</div>;

  const competencyScores = aggregateCompetencyScores();

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center space-x-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{report.cycle_name}</h1>
            <p className="text-gray-500 mt-1">
              Report generated on {formatISTDate(report.report_generated_at)}
            </p>
          </div>
          <Badge className={getRatingBadgeColor(report.final_rating)}>
            Final Rating: {report.final_rating.toFixed(2)}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {report.self_rating !== null && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Self Rating</p>
                  <p className={`text-3xl font-bold mt-1 ${getRatingColor(report.self_rating)}`}>
                    {report.self_rating.toFixed(2)}
                  </p>
                </div>
                <User className="w-10 h-10 text-blue-500" />
              </div>
            </CardContent>
          </Card>
        )}

        {report.peer_avg_rating !== null && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Peer Average</p>
                  <p className={`text-3xl font-bold mt-1 ${getRatingColor(report.peer_avg_rating)}`}>
                    {report.peer_avg_rating.toFixed(2)}
                  </p>
                </div>
                <Users className="w-10 h-10 text-purple-500" />
              </div>
            </CardContent>
          </Card>
        )}

        {report.manager_rating !== null && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Manager Rating</p>
                  <p className={`text-3xl font-bold mt-1 ${getRatingColor(report.manager_rating)}`}>
                    {report.manager_rating.toFixed(2)}
                  </p>
                </div>
                <UserCircle className="w-10 h-10 text-green-500" />
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {trendData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <TrendingUp className="w-5 h-5" />
              <span>Performance Trend</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis domain={[0, 5]} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="rating"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 6 }}
                  activeDot={{ r: 8 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="summary" className="space-y-6">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="competencies">Competencies</TabsTrigger>
          <TabsTrigger value="feedback">Individual Feedback</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          {report.consolidated_strengths && (
            <Card>
              <CardHeader>
                <CardTitle>Key Strengths</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 whitespace-pre-wrap">{report.consolidated_strengths}</p>
              </CardContent>
            </Card>
          )}

          {report.consolidated_improvements && (
            <Card>
              <CardHeader>
                <CardTitle>Areas for Development</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 whitespace-pre-wrap">
                  {report.consolidated_improvements}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="competencies" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {competencyScores.map((comp) => (
              <CompetencyCard
                key={comp.competency_id}
                name={comp.competency_name}
                score={parseFloat(comp.avg_rating)}
                description={
                  comp.comments.length > 0
                    ? comp.comments.join(" • ")
                    : `Rated by ${comp.rating_count} reviewer(s)`
                }
              />
            ))}
          </div>

          {competencyScores.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-gray-500">
                No competency data available
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="feedback" className="space-y-4">
          {report.feedback_details && report.feedback_details.length > 0 ? (
            report.feedback_details.map((feedback) => (
              <Card key={feedback.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {getReviewerIcon(feedback.reviewer_type)}
                      <div>
                        <CardTitle className="text-lg">
                          {feedback.reviewer_name || "Anonymous"}
                        </CardTitle>
                        <p className="text-sm text-gray-500 capitalize">
                          {feedback.reviewer_type} Review
                        </p>
                      </div>
                    </div>
                    <Badge className={getRatingBadgeColor(feedback.overall_rating)}>
                      {feedback.overall_rating.toFixed(2)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {feedback.strengths && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 mb-1">Strengths:</p>
                      <p className="text-sm text-gray-600">{feedback.strengths}</p>
                    </div>
                  )}

                  {feedback.areas_for_improvement && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 mb-1">
                        Areas for Improvement:
                      </p>
                      <p className="text-sm text-gray-600">{feedback.areas_for_improvement}</p>
                    </div>
                  )}

                  {feedback.comments && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 mb-1">Comments:</p>
                      <p className="text-sm text-gray-600">{feedback.comments}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-2">Competency Ratings:</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {feedback.ratings.competencies.map((comp) => (
                        <div key={comp.competency_id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <span className="text-xs text-gray-600">{comp.competency_name}</span>
                          <Badge variant="outline" className="ml-2">{comp.rating}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="text-xs text-gray-400">
                    Submitted on {formatISTDate(feedback.submitted_at)}
                  </p>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-gray-500">
                No individual feedback available
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button onClick={() => navigate("/performance-feedback/development-plan")}>
          View Development Plan
        </Button>
      </div>
    </div>
  );
}
