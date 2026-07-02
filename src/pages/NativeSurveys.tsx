import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ClipboardList, HeartPulse, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SurveyQuestionRenderer } from "@/components/engagement/SurveyQuestionRenderer";
import type { ApiResponse, Survey, SurveyDetail } from "@/components/engagement/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

type SurveyAnswers = Record<string, string>;

const workloadOptions = ["too_light", "manageable", "heavy", "overwhelming"];

const QUESTION_TYPES = [
  { value: "text", label: "Text" },
  { value: "rating", label: "Rating (1–5)" },
  { value: "scale", label: "Scale" },
  { value: "multiple_choice", label: "Multiple Choice" },
  { value: "single_choice", label: "Single Choice" },
  { value: "yes_no", label: "Yes / No" },
] as const;

interface DraftQuestion {
  question_text: string;
  question_type: string;
  is_required: boolean;
  options_json: string[];
  scale_min?: number;
  scale_max?: number;
}

const emptyQuestion = (): DraftQuestion => ({
  question_text: "",
  question_type: "text",
  is_required: false,
  options_json: [],
});

export default function NativeSurveys() {
  const { hasAnyRole } = useWorkforceAccess();
  const canManage = hasAnyRole("admin", "hr");

  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [activeSurvey, setActiveSurvey] = useState<SurveyDetail | null>(null);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Pulse state
  const [mood, setMood] = useState("3");
  const [energy, setEnergy] = useState("3");
  const [stress, setStress] = useState("3");
  const [workload, setWorkload] = useState("manageable");
  const [feedback, setFeedback] = useState("");

  // Create survey modal state
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [surveyTitle, setSurveyTitle] = useState("");
  const [surveyDesc, setSurveyDesc] = useState("");
  const [surveyType, setSurveyType] = useState("engagement");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [pointsReward, setPointsReward] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [draftQuestions, setDraftQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);

  const monday = useMemo(() => {
    const date = new Date();
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date.toISOString().slice(0, 10);
  }, []);

  const loadSurveys = () => {
    hrmsApi
      .get<ApiResponse<Survey[]>>("/api/engagement/surveys")
      .then((response) => setSurveys(response.data))
      .catch((requestError: Error) => setError(requestError.message));
  };

  useEffect(() => {
    loadSurveys();
  }, []);

  const openSurvey = async (surveyId: string) => {
    try {
      const response = await hrmsApi.get<ApiResponse<SurveyDetail>>(
        `/api/engagement/surveys/${surveyId}`
      );
      setActiveSurvey(response.data);
      setAnswers({});
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : "Unable to open survey"
      );
    }
  };

  const submitSurvey = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeSurvey) return;

    // Validate required questions before sending
    const missing = activeSurvey.questions.filter(
      (q) => q.is_required && !answers[q.question_id]?.trim()
    );
    if (missing.length > 0) {
      toast.error(
        `Please answer: ${missing.map((q) => q.question_text.slice(0, 40)).join(", ")}`
      );
      return;
    }

    const responses = activeSurvey.questions.map((question) => {
      const answer = answers[question.question_id] ?? "";
      return question.question_type === "rating" || question.question_type === "scale"
        ? { question_id: question.question_id, response_value: Number(answer) }
        : { question_id: question.question_id, response_text: answer };
    });

    setSubmitting(true);
    try {
      await hrmsApi.post(
        `/api/engagement/surveys/${activeSurvey.survey_id}/respond`,
        { responses }
      );
      setActiveSurvey(null);
      setAnswers({});
      toast.success("Survey submitted — thank you!");
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : "Unable to submit survey"
      );
    } finally {
      setSubmitting(false);
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
      toast.error(
        requestError instanceof Error ? requestError.message : "Unable to save pulse"
      );
    }
  };

  // ── Create survey helpers ──────────────────────────────────────────────────

  const addQuestion = () =>
    setDraftQuestions((prev) => [...prev, emptyQuestion()]);

  const removeQuestion = (index: number) =>
    setDraftQuestions((prev) => prev.filter((_, i) => i !== index));

  const updateQuestion = (index: number, patch: Partial<DraftQuestion>) =>
    setDraftQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, ...patch } : q))
    );

  const updateOption = (qIndex: number, oIndex: number, value: string) =>
    setDraftQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIndex) return q;
        const options = [...q.options_json];
        options[oIndex] = value;
        return { ...q, options_json: options };
      })
    );

  const addOption = (qIndex: number) =>
    setDraftQuestions((prev) =>
      prev.map((q, i) =>
        i === qIndex ? { ...q, options_json: [...q.options_json, ""] } : q
      )
    );

  const removeOption = (qIndex: number, oIndex: number) =>
    setDraftQuestions((prev) =>
      prev.map((q, i) =>
        i === qIndex
          ? { ...q, options_json: q.options_json.filter((_, j) => j !== oIndex) }
          : q
      )
    );

  const resetCreateForm = () => {
    setSurveyTitle("");
    setSurveyDesc("");
    setSurveyType("engagement");
    setIsAnonymous(false);
    setPointsReward("0");
    setStartDate("");
    setEndDate("");
    setDraftQuestions([emptyQuestion()]);
  };

  const submitCreateSurvey = async () => {
    if (!surveyTitle.trim()) {
      toast.error("Survey title is required");
      return;
    }
    if (draftQuestions.some((q) => !q.question_text.trim())) {
      toast.error("All questions must have text");
      return;
    }

    const payload = {
      survey_title: surveyTitle.trim(),
      survey_description: surveyDesc.trim() || undefined,
      survey_type: surveyType,
      is_anonymous: isAnonymous,
      is_active: true,
      points_reward: parseInt(pointsReward, 10) || 0,
      start_date: startDate ? new Date(startDate).toISOString() : undefined,
      end_date: endDate ? new Date(endDate).toISOString() : undefined,
      questions: draftQuestions.map((q, i) => ({
        question_text: q.question_text,
        question_type: q.question_type,
        question_order: i + 1,
        is_required: q.is_required,
        options_json:
          ["multiple_choice", "single_choice"].includes(q.question_type)
            ? q.options_json.filter(Boolean)
            : undefined,
        scale_min:
          ["scale", "rating"].includes(q.question_type) ? q.scale_min ?? 1 : undefined,
        scale_max:
          ["scale", "rating"].includes(q.question_type) ? q.scale_max ?? 5 : undefined,
      })),
    };

    setCreating(true);
    try {
      await hrmsApi.post("/api/engagement/surveys", payload);
      toast.success("Survey created successfully");
      setShowCreate(false);
      resetCreateForm();
      loadSurveys();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : "Unable to create survey"
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Surveys & Pulse</h1>
            <p className="mt-1 text-slate-500">
              Share useful feedback and record a quick weekly check-in.
            </p>
          </div>
          {canManage && (
            <Button onClick={() => setShowCreate(true)} className="shrink-0">
              <Plus className="mr-2 h-4 w-4" />
              Create Survey
            </Button>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            {surveys.length === 0 && (
              <div className="rounded-xl border border-dashed p-10 text-center">
                <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium text-slate-500">
                  No active surveys right now
                </p>
                {canManage && (
                  <p className="text-xs text-slate-400 mt-1">
                    Use "Create Survey" above to launch one
                  </p>
                )}
              </div>
            )}
            {surveys.map((survey) => (
              <Card key={survey.survey_id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-slate-900">
                        {survey.survey_title}
                      </h2>
                      <Badge variant="secondary">{survey.survey_type}</Badge>
                      {survey.is_anonymous && (
                        <Badge variant="outline">anonymous</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {survey.survey_description ?? "Open employee survey"}
                    </p>
                    <p className="mt-2 text-xs font-medium text-amber-700">
                      +{survey.points_reward} points on completion
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => openSurvey(survey.survey_id)}
                  >
                    Answer survey
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HeartPulse className="h-5 w-5 text-rose-600" />
                Weekly pulse
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submitPulse}>
                <Rating label="Mood" value={mood} setValue={setMood} />
                <Rating label="Energy" value={energy} setValue={setEnergy} />
                <Rating label="Stress" value={stress} setValue={setStress} />
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Workload
                  </label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={workload}
                    onChange={(event) => setWorkload(event.target.value)}
                  >
                    {workloadOptions.map((option) => (
                      <option key={option} value={option}>
                        {option.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <Textarea
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="Optional note for HR"
                />
                <Button className="w-full">Save pulse</Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Survey answer modal */}
        {activeSurvey && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  {activeSurvey.survey_title}
                </CardTitle>
                {activeSurvey.survey_description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {activeSurvey.survey_description}
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <form className="space-y-5" onSubmit={submitSurvey}>
                  {activeSurvey.questions.map((question) => (
                    <div key={question.question_id}>
                      <SurveyQuestionRenderer
                        question={question}
                        value={answers[question.question_id] ?? ""}
                        setValue={(value) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.question_id]: value,
                          }))
                        }
                      />
                      {question.is_required && (
                        <span className="text-xs text-rose-500 ml-1">* Required</span>
                      )}
                    </div>
                  ))}
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setActiveSurvey(null)}
                      disabled={submitting}
                    >
                      Cancel
                    </Button>
                    <Button disabled={submitting}>
                      {submitting ? "Submitting…" : "Submit survey"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Create survey modal */}
        <Dialog open={showCreate} onOpenChange={(open) => { if (!open) resetCreateForm(); setShowCreate(open); }}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Survey</DialogTitle>
            </DialogHeader>

            <div className="space-y-5 py-2">
              {/* Basic info */}
              <div className="space-y-3">
                <div>
                  <Label htmlFor="s-title">Title *</Label>
                  <Input
                    id="s-title"
                    value={surveyTitle}
                    onChange={(e) => setSurveyTitle(e.target.value)}
                    placeholder="e.g. Q3 Engagement Survey"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="s-desc">Description</Label>
                  <Textarea
                    id="s-desc"
                    value={surveyDesc}
                    onChange={(e) => setSurveyDesc(e.target.value)}
                    placeholder="What is this survey about?"
                    rows={2}
                    className="mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Type</Label>
                    <Select value={surveyType} onValueChange={setSurveyType}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="engagement">Engagement</SelectItem>
                        <SelectItem value="feedback">Feedback</SelectItem>
                        <SelectItem value="pulse">Pulse</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="s-points">Points reward</Label>
                    <Input
                      id="s-points"
                      type="number"
                      min="0"
                      value={pointsReward}
                      onChange={(e) => setPointsReward(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="s-start">Start date</Label>
                    <Input
                      id="s-start"
                      type="datetime-local"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="s-end">End date</Label>
                    <Input
                      id="s-end"
                      type="datetime-local"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="s-anon"
                    checked={isAnonymous}
                    onCheckedChange={setIsAnonymous}
                  />
                  <Label htmlFor="s-anon">Anonymous responses</Label>
                </div>
              </div>

              {/* Questions */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">Questions</h3>
                  <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
                    <Plus className="mr-1 h-3 w-3" /> Add question
                  </Button>
                </div>
                <div className="space-y-4">
                  {draftQuestions.map((q, qi) => (
                    <div key={qi} className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <Label className="text-xs text-muted-foreground">
                            Question {qi + 1}
                          </Label>
                          <Input
                            value={q.question_text}
                            onChange={(e) =>
                              updateQuestion(qi, { question_text: e.target.value })
                            }
                            placeholder="Enter your question"
                            className="mt-1"
                          />
                        </div>
                        {draftQuestions.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="mt-6 shrink-0 text-rose-500 hover:text-rose-700"
                            onClick={() => removeQuestion(qi)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Type</Label>
                          <Select
                            value={q.question_type}
                            onValueChange={(v) => updateQuestion(qi, { question_type: v })}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {QUESTION_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-end gap-2 pb-0.5">
                          <Switch
                            id={`req-${qi}`}
                            checked={q.is_required}
                            onCheckedChange={(v) => updateQuestion(qi, { is_required: v })}
                          />
                          <Label htmlFor={`req-${qi}`} className="text-xs">Required</Label>
                        </div>
                      </div>

                      {["multiple_choice", "single_choice"].includes(q.question_type) && (
                        <div>
                          <Label className="text-xs text-muted-foreground">Options</Label>
                          <div className="space-y-2 mt-1">
                            {q.options_json.map((opt, oi) => (
                              <div key={oi} className="flex gap-2">
                                <Input
                                  value={opt}
                                  onChange={(e) => updateOption(qi, oi, e.target.value)}
                                  placeholder={`Option ${oi + 1}`}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="shrink-0 text-rose-500"
                                  onClick={() => removeOption(qi, oi)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addOption(qi)}
                            >
                              <Plus className="mr-1 h-3 w-3" /> Add option
                            </Button>
                          </div>
                        </div>
                      )}

                      {["scale", "rating"].includes(q.question_type) && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">Min</Label>
                            <Input
                              type="number"
                              value={q.scale_min ?? 1}
                              onChange={(e) =>
                                updateQuestion(qi, { scale_min: parseInt(e.target.value, 10) })
                              }
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Max</Label>
                            <Input
                              type="number"
                              value={q.scale_max ?? 5}
                              onChange={(e) =>
                                updateQuestion(qi, { scale_max: parseInt(e.target.value, 10) })
                              }
                              className="mt-1"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => { resetCreateForm(); setShowCreate(false); }}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button onClick={submitCreateSurvey} disabled={creating}>
                {creating ? "Creating…" : "Create Survey"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </DashboardLayout>
  );
}

function Rating({
  label,
  value,
  setValue,
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label} (1–5)
      </label>
      <Input
        type="number"
        min="1"
        max="5"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        required
      />
    </div>
  );
}
