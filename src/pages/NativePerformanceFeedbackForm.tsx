import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RatingSlider } from "@/components/performance-feedback/RatingSlider";
import { Save, Send } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface FormTemplate {
  request: {
    id: string;
    employee_id: string;
  };
  employee: {
    id: string;
    full_name: string;
    designation: string;
  };
  competencies: Array<{
    id: string;
    competency_name: string;
    description: string;
    category: string;
  }>;
  kpis: Array<{
    id: string;
    metric_code: string;
    metric_name: string;
    unit: string;
    target_value: number;
    actual_value: number | null;
  }>;
}

export default function NativePerformanceFeedbackForm() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [ratings, setRatings] = useState<Record<string, { rating: number; comment: string }>>({});
  const [kpiRatings, setKpiRatings] = useState<Record<string, { rating: number; comment: string }>>({});
  const [overallStrengths, setOverallStrengths] = useState("");
  const [developmentAreas, setDevelopmentAreas] = useState("");

  useEffect(() => {
    fetchFormTemplate();
  }, [requestId]);

  const fetchFormTemplate = async () => {
    try {
      const data = await hrmsApi.get(`/api/performance-feedback/requests/${requestId}/form`);
      setTemplate(data);

      // Initialize ratings
      const initialRatings: Record<string, { rating: number; comment: string }> = {};
      data.competencies.forEach((comp: any) => {
        initialRatings[comp.id] = { rating: 3, comment: "" };
      });
      setRatings(initialRatings);

      const initialKpiRatings: Record<string, { rating: number; comment: string }> = {};
      data.kpis.forEach((kpi: any) => {
        initialKpiRatings[kpi.id] = { rating: 3, comment: "" };
      });
      setKpiRatings(initialKpiRatings);
    } catch (error) {
      console.error("Failed to fetch form template:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = {
        request_id: requestId,
        ratings_json: {
          competencies: Object.entries(ratings).map(([competency_id, data]) => ({
            competency_id,
            rating: data.rating,
            comment: data.comment || undefined,
          })),
          kpis: Object.entries(kpiRatings).map(([metric_id, data]) => ({
            metric_id,
            rating: data.rating,
            comment: data.comment || undefined,
          })),
        },
        overall_strengths: overallStrengths || undefined,
        development_areas: developmentAreas || undefined,
      };

      await hrmsApi.post(`/api/performance-feedback/requests/${requestId}/submit`, payload);
      navigate("/performance-feedback/my-assignments");
    } catch (error) {
      console.error("Failed to submit feedback:", error);
      alert("Failed to submit feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !template) return <div className="p-8">Loading...</div>;

  const totalItems = template.competencies.length + template.kpis.length;
  const ratedItems = Object.values(ratings).filter(r => r.rating > 0).length + Object.values(kpiRatings).filter(r => r.rating > 0).length;
  const progress = (ratedItems / totalItems) * 100;

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Performance Feedback</h1>
        <p className="text-gray-500 mt-1">
          For {template.employee.full_name} - {template.employee.designation}
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Progress</span>
            <span className="text-sm text-gray-500">{ratedItems}/{totalItems} rated</span>
          </div>
          <Progress value={progress} className="h-2" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Competencies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {template.competencies.map((competency) => (
            <div key={competency.id} className="border-b pb-6 last:border-b-0">
              <div className="mb-3">
                <h4 className="font-semibold text-gray-900">{competency.competency_name}</h4>
                <p className="text-sm text-gray-500">{competency.description}</p>
              </div>

              <div className="space-y-3">
                <div>
                  <Label>Rating</Label>
                  <RatingSlider
                    value={ratings[competency.id]?.rating || 3}
                    onChange={(value) => setRatings({
                      ...ratings,
                      [competency.id]: { ...ratings[competency.id], rating: value }
                    })}
                  />
                </div>

                <div>
                  <Label>Comment (Optional)</Label>
                  <Textarea
                    placeholder="Provide specific examples or context..."
                    value={ratings[competency.id]?.comment || ""}
                    onChange={(e) => setRatings({
                      ...ratings,
                      [competency.id]: { ...ratings[competency.id], comment: e.target.value }
                    })}
                    rows={2}
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {template.kpis.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>KPI Performance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {template.kpis.map((kpi) => (
              <div key={kpi.id} className="border-b pb-6 last:border-b-0">
                <div className="mb-3">
                  <h4 className="font-semibold text-gray-900">{kpi.metric_name}</h4>
                  <p className="text-sm text-gray-500">
                    Target: {kpi.target_value} {kpi.unit} | Actual: {kpi.actual_value || "N/A"} {kpi.unit}
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label>Rating</Label>
                    <RatingSlider
                      value={kpiRatings[kpi.id]?.rating || 3}
                      onChange={(value) => setKpiRatings({
                        ...kpiRatings,
                        [kpi.id]: { ...kpiRatings[kpi.id], rating: value }
                      })}
                    />
                  </div>

                  <div>
                    <Label>Comment (Optional)</Label>
                    <Textarea
                      placeholder="Context or explanation..."
                      value={kpiRatings[kpi.id]?.comment || ""}
                      onChange={(e) => setKpiRatings({
                        ...kpiRatings,
                        [kpi.id]: { ...kpiRatings[kpi.id], comment: e.target.value }
                      })}
                      rows={2}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Overall Assessment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Key Strengths</Label>
            <Textarea
              placeholder="What are this employee's main strengths?"
              value={overallStrengths}
              onChange={(e) => setOverallStrengths(e.target.value)}
              rows={4}
            />
          </div>

          <div>
            <Label>Development Areas</Label>
            <Textarea
              placeholder="What areas need improvement?"
              value={developmentAreas}
              onChange={(e) => setDevelopmentAreas(e.target.value)}
              rows={4}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" disabled={submitting}>
          <Save className="w-4 h-4 mr-2" />
          Save Draft
        </Button>
        <Button onClick={handleSubmit} className="flex-1" disabled={submitting}>
          <Send className="w-4 h-4 mr-2" />
          {submitting ? "Submitting..." : "Submit Feedback"}
        </Button>
      </div>
    </div>
  );
}
