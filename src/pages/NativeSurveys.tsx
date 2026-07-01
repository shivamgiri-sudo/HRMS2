import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ClipboardList, HeartPulse } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SurveyQuestionRenderer } from "@/components/engagement/SurveyQuestionRenderer";
import type { ApiResponse, Survey, SurveyDetail } from "@/components/engagement/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";

type SurveyAnswers = Record<string, string>;

const workloadOptions = ["too_light", "manageable", "heavy", "overwhelming"];

export default function NativeSurveys() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [activeSurvey, setActiveSurvey] = useState<SurveyDetail | null>(null);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [error, setError] = useState("");
  const [mood, setMood] = useState("3");
  const [energy, setEnergy] = useState("3");
  const [stress, setStress] = useState("3");
  const [workload, setWorkload] = useState("manageable");
  const [feedback, setFeedback] = useState("");

  const monday = useMemo(() => {
    const date = new Date();
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date.toISOString().slice(0, 10);
  }, []);

  useEffect(() => {
    hrmsApi.get<ApiResponse<Survey[]>>("/api/engagement/surveys")
      .then((response) => setSurveys(response.data))
      .catch((requestError: Error) => setError(requestError.message));
  }, []);

  const openSurvey = async (surveyId: string) => {
    try {
      const response = await hrmsApi.get<ApiResponse<SurveyDetail>>(`/api/engagement/surveys/${surveyId}`);
      setActiveSurvey(response.data);
      setAnswers({});
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Unable to open survey");
    }
  };

  const submitSurvey = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeSurvey) return;
    const responses = activeSurvey.questions.map((question) => {
      const answer = answers[question.question_id] ?? "";
      return question.question_type === "rating" || question.question_type === "scale"
        ? { question_id: question.question_id, response_value: Number(answer) }
        : { question_id: question.question_id, response_text: answer };
    });
    try {
      await hrmsApi.post(`/api/engagement/surveys/${activeSurvey.survey_id}/respond`, { responses });
      setActiveSurvey(null);
      setAnswers({});
      toast.success("Survey submitted");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Unable to submit survey");
    }
  };

  const submitPulse = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await hrmsApi.post("/api/engagement/pulse", {
        mood_rating: Number(mood),
        energy_level: Number(energy),
        stress_level: Number(stress),
        workload_perception: workload,
        feedback_text: feedback || undefined,
        week_start_date: monday,
      });
      setFeedback("");
      toast.success("Weekly pulse saved");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Unable to save pulse");
    }
  };

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Surveys & Pulse</h1>
          <p className="mt-1 text-slate-500">Share useful feedback and record a quick weekly check-in.</p>
        </div>
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            {surveys.map((survey) => (
              <Card key={survey.survey_id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-slate-900">{survey.survey_title}</h2>
                      <Badge variant="secondary">{survey.survey_type}</Badge>
                      {survey.is_anonymous && <Badge variant="outline">anonymous</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{survey.survey_description ?? "Open employee survey"}</p>
                    <p className="mt-2 text-xs font-medium text-amber-700">+{survey.points_reward} points on completion</p>
                  </div>
                  <Button variant="outline" onClick={() => openSurvey(survey.survey_id)}>Answer survey</Button>
                </CardContent>
              </Card>
            ))}
            {surveys.length === 0 && <p className="text-sm text-slate-500">There are no active surveys right now.</p>}
          </div>

          <Card className="h-fit">
            <CardHeader><CardTitle className="flex items-center gap-2"><HeartPulse className="h-5 w-5 text-rose-600" /> Weekly pulse</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submitPulse}>
                <Rating label="Mood" value={mood} setValue={setMood} />
                <Rating label="Energy" value={energy} setValue={setEnergy} />
                <Rating label="Stress" value={stress} setValue={setStress} />
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Workload</label>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={workload} onChange={(event) => setWorkload(event.target.value)}>
                    {workloadOptions.map((option) => <option key={option} value={option}>{option.replace("_", " ")}</option>)}
                  </select>
                </div>
                <Textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Optional note for HR" />
                <Button className="w-full">Save pulse</Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {activeSurvey && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto">
              <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{activeSurvey.survey_title}</CardTitle></CardHeader>
              <CardContent>
                <form className="space-y-5" onSubmit={submitSurvey}>
                  {activeSurvey.questions.map((question) => <SurveyQuestionRenderer key={question.question_id} question={question} value={answers[question.question_id] ?? ""} setValue={(value) => setAnswers((current) => ({ ...current, [question.question_id]: value }))} />)}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setActiveSurvey(null)}>Cancel</Button>
                    <Button>Submit survey</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}

function Rating({ label, value, setValue }: { label: string; value: string; setValue: (value: string) => void }) {
  return <div><label className="mb-1 block text-sm font-medium text-slate-700">{label} (1-5)</label><Input type="number" min="1" max="5" value={value} onChange={(event) => setValue(event.target.value)} required /></div>;
}
