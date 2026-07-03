import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, CheckCircle2, Plus, Settings, Users } from "lucide-react";

type Process = { id: string; process_name: string; process_code: string };
type ShiftTemplate = { id: string; shift_code: string; shift_name: string };
type RosterTemplate = {
  id: string;
  template_name: string;
  process_id: string;
  pattern_type: "fixed" | "rotation" | "custom";
  cycle_days: number;
  pattern_json: RosterPattern;
  support_ratio_min: number | null;
  support_ratio_max: number | null;
  is_active: number;
};
type RosterPattern = {
  days: {
    day_number: number;
    shift_template_id: string | null;
    is_week_off: boolean;
    is_rotational: boolean;
  }[];
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NO_SHIFT_VALUE = "__no_shift__";

export default function NativeRosterMasterBuilder() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("templates");

  // Form state
  const [processId, setProcessId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [patternType, setPatternType] = useState<"fixed" | "rotation" | "custom">("fixed");
  const [cycleDays, setCycleDays] = useState(7);
  const [supportRatioMin, setSupportRatioMin] = useState("");
  const [supportRatioMax, setSupportRatioMax] = useState("");
  const [pattern, setPattern] = useState<RosterPattern>({
    days: Array.from({ length: 7 }, (_, i) => ({
      day_number: i + 1,
      shift_template_id: null,
      is_week_off: i === 0 || i === 6, // Sunday and Saturday
      is_rotational: false,
    })),
  });

  // Queries
  const { data: processes } = useQuery({
    queryKey: ["processes"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: Process[] }>("/api/processes");
      return res.data || [];
    },
  });

  const { data: shifts } = useQuery({
    queryKey: ["shifts", processId],
    enabled: !!processId,
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: ShiftTemplate[] }>(
        `/api/roster-gov/shifts/templates?process_id=${processId}&active_status=1`
      );
      return res.data || [];
    },
  });

  const { data: templates, refetch: refetchTemplates } = useQuery({
    queryKey: ["roster-templates", processId],
    enabled: !!processId,
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: RosterTemplate[] }>(
        `/api/roster-master/templates?process_id=${processId}`
      );
      return res.data || [];
    },
  });

  // Mutations
  const createTemplate = useMutation({
    mutationFn: async (data: any) => {
      return await hrmsApi.post("/api/roster-master/templates", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roster-templates"] });
      resetForm();
    },
  });

  const toggleTemplate = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      return await hrmsApi.patch(`/api/roster-master/templates/${id}`, { is_active });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roster-templates"] });
    },
  });

  // Handlers
  const resetForm = () => {
    setTemplateName("");
    setPatternType("fixed");
    setCycleDays(7);
    setSupportRatioMin("");
    setSupportRatioMax("");
    setPattern({
      days: Array.from({ length: 7 }, (_, i) => ({
        day_number: i + 1,
        shift_template_id: null,
        is_week_off: i === 0 || i === 6,
        is_rotational: false,
      })),
    });
  };

  const handleCycleDaysChange = (days: number) => {
    setCycleDays(days);
    setPattern({
      days: Array.from({ length: days }, (_, i) => ({
        day_number: i + 1,
        shift_template_id: null,
        is_week_off: false,
        is_rotational: false,
      })),
    });
  };

  const updatePatternDay = (dayNumber: number, field: string, value: any) => {
    setPattern({
      days: pattern.days.map((d) =>
        d.day_number === dayNumber ? { ...d, [field]: value } : d
      ),
    });
  };

  const handleSubmit = () => {
    if (!processId || !templateName) {
      alert("Please fill all required fields");
      return;
    }

    createTemplate.mutate({
      template_name: templateName,
      process_id: processId,
      pattern_type: patternType,
      cycle_days: cycleDays,
      pattern_json: pattern,
      support_ratio_min: supportRatioMin ? Number(supportRatioMin) : null,
      support_ratio_max: supportRatioMax ? Number(supportRatioMax) : null,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="rounded-3xl bg-gradient-to-r from-purple-600 to-blue-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <Calendar className="h-10 w-10" />
            <div>
              <h1 className="text-3xl font-black">Roster Master Builder</h1>
              <p className="mt-1 text-sm opacity-90">
                Create process-specific roster templates with shift patterns and week-off rules
              </p>
            </div>
          </div>
        </div>

        {/* Process Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Select Process</CardTitle>
            <CardDescription>Choose the process for roster template</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={processId} onValueChange={setProcessId}>
              <SelectTrigger>
                <SelectValue placeholder="Select process" />
              </SelectTrigger>
              <SelectContent>
                {processes?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.process_name} ({p.process_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {processId && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="templates">
                <Settings className="mr-2 h-4 w-4" />
                Templates
              </TabsTrigger>
              <TabsTrigger value="create">
                <Plus className="mr-2 h-4 w-4" />
                Create New
              </TabsTrigger>
            </TabsList>

            {/* Existing Templates */}
            <TabsContent value="templates" className="space-y-4">
              {templates && templates.length > 0 ? (
                templates.map((template) => (
                  <Card key={template.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle>{template.template_name}</CardTitle>
                          <CardDescription>
                            {template.cycle_days}-day cycle • {template.pattern_type}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={template.is_active ? "default" : "secondary"}>
                            {template.is_active ? "Active" : "Inactive"}
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              toggleTemplate.mutate({
                                id: template.id,
                                is_active: !template.is_active,
                              })
                            }
                          >
                            {template.is_active ? "Deactivate" : "Activate"}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {/* Pattern Preview */}
                        <div>
                          <p className="text-sm font-medium mb-2">Pattern:</p>
                          <div className="grid grid-cols-7 gap-2">
                            {template.pattern_json.days.map((day) => (
                              <div
                                key={day.day_number}
                                className={`rounded-lg p-3 text-center text-sm ${
                                  day.is_week_off
                                    ? "bg-red-100 text-red-700"
                                    : "bg-green-100 text-green-700"
                                }`}
                              >
                                <div className="font-bold">Day {day.day_number}</div>
                                <div className="text-xs mt-1">
                                  {day.is_week_off ? "Week Off" : "Work Day"}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Support Ratio */}
                        {(template.support_ratio_min || template.support_ratio_max) && (
                          <div className="flex gap-4 text-sm">
                            <div>
                              <span className="font-medium">Min Support:</span>{" "}
                              {template.support_ratio_min}%
                            </div>
                            <div>
                              <span className="font-medium">Max Support:</span>{" "}
                              {template.support_ratio_max}%
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No templates found. Create your first template.
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Create Template */}
            <TabsContent value="create" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Template Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Template Name */}
                  <div>
                    <Label>Template Name</Label>
                    <Input
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="e.g., 5-Day Week (Mon-Fri)"
                    />
                  </div>

                  {/* Pattern Type */}
                  <div>
                    <Label>Pattern Type</Label>
                    <Select
                      value={patternType}
                      onValueChange={(v: any) => setPatternType(v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed</SelectItem>
                        <SelectItem value="rotation">Rotation</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Cycle Days */}
                  <div>
                    <Label>Cycle Days</Label>
                    <Select
                      value={cycleDays.toString()}
                      onValueChange={(v) => handleCycleDaysChange(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7">7 Days (Weekly)</SelectItem>
                        <SelectItem value="14">14 Days (Bi-Weekly)</SelectItem>
                        <SelectItem value="28">28 Days (Monthly)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Support Ratio */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Min Support Ratio (%)</Label>
                      <Input
                        type="number"
                        value={supportRatioMin}
                        onChange={(e) => setSupportRatioMin(e.target.value)}
                        placeholder="e.g., 75"
                      />
                    </div>
                    <div>
                      <Label>Max Support Ratio (%)</Label>
                      <Input
                        type="number"
                        value={supportRatioMax}
                        onChange={(e) => setSupportRatioMax(e.target.value)}
                        placeholder="e.g., 100"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Pattern Builder */}
              <Card>
                <CardHeader>
                  <CardTitle>Roster Pattern</CardTitle>
                  <CardDescription>
                    Define work days and week-offs for the {cycleDays}-day cycle
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3">
                    {pattern.days.map((day) => (
                      <div
                        key={day.day_number}
                        className="flex items-center justify-between rounded-lg border p-4"
                      >
                        <div className="flex items-center gap-4">
                          <div className="font-bold">
                            Day {day.day_number}
                            {cycleDays === 7 && (
                              <span className="ml-2 text-sm font-normal text-muted-foreground">
                                ({DAY_NAMES[day.day_number - 1]})
                              </span>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant={day.is_week_off ? "destructive" : "default"}
                            onClick={() =>
                              updatePatternDay(
                                day.day_number,
                                "is_week_off",
                                !day.is_week_off
                              )
                            }
                          >
                            {day.is_week_off ? "Week Off" : "Work Day"}
                          </Button>
                        </div>
                        {!day.is_week_off && shifts && shifts.length > 0 && (
                          <Select
                            value={day.shift_template_id || NO_SHIFT_VALUE}
                            onValueChange={(v) =>
                              updatePatternDay(
                                day.day_number,
                                "shift_template_id",
                                v === NO_SHIFT_VALUE ? null : v
                              )
                            }
                          >
                            <SelectTrigger className="w-48">
                              <SelectValue placeholder="Select shift" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_SHIFT_VALUE}>No specific shift</SelectItem>
                              {shifts.map((shift) => (
                                <SelectItem key={shift.id} value={shift.id}>
                                  {shift.shift_name} ({shift.shift_code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Submit */}
              <Button
                onClick={handleSubmit}
                disabled={createTemplate.isPending}
                className="w-full"
                size="lg"
              >
                <CheckCircle2 className="mr-2 h-5 w-5" />
                {createTemplate.isPending ? "Creating..." : "Create Template"}
              </Button>

              {createTemplate.isSuccess && (
                <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700">
                  Template created successfully!
                </div>
              )}
              {createTemplate.isError && (
                <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
                  Error: {(createTemplate.error as any)?.message || "Failed to create template"}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}
