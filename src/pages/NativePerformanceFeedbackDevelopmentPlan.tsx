import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Target, CheckCircle2, Clock, AlertCircle, Calendar } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { DevPlanTimeline } from "@/components/performance-feedback";
import { toast } from "sonner";

interface Goal {
  id: string;
  development_plan_id: string;
  goal_description: string;
  target_date: string;
  status: "not_started" | "in_progress" | "completed";
  completion_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface DevelopmentPlan {
  id: string;
  employee_id: string;
  cycle_id: string;
  plan_title: string;
  plan: {
    objectives: string[];
    training_needs: string[];
    timeline: string;
    resources_needed?: string[];
  };
  status: "draft" | "active" | "completed";
  created_by: string;
  created_at: string;
  updated_at: string;
  employee_name?: string;
  cycle_name?: string;
  goals?: Goal[];
}

export default function NativePerformanceFeedbackDevelopmentPlan() {
  const { user } = useAuth();
  const { data: roleData } = useUserRole();
  const [plans, setPlans] = useState<DevelopmentPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<DevelopmentPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingGoal, setEditingGoal] = useState<string | null>(null);
  const [goalNotes, setGoalNotes] = useState<string>("");

  const isManager = roleData?.primaryRole && ["manager", "admin", "hr"].includes(roleData.primaryRole);

  useEffect(() => {
    fetchDevelopmentPlans();
  }, []);

  const fetchDevelopmentPlans = async () => {
    try {
      const data = await hrmsApi.get("/api/performance-feedback/development-plans", {
        employee_id: user?.id,
      });
      setPlans(data);
      if (data.length > 0) {
        setSelectedPlan(data[0]);
      }
    } catch (error) {
      console.error("Failed to fetch development plans:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateGoalStatus = async (goalId: string, status: Goal["status"], notes?: string) => {
    if (!selectedPlan || !isManager) return;

    try {
      await hrmsApi.patch(
        `/api/performance-feedback/development-plans/${selectedPlan.id}/goals/${goalId}`,
        {
          status,
          notes,
          completion_date: status === "completed" ? new Date().toISOString() : null,
        }
      );

      toast.success("Goal updated successfully");
      fetchDevelopmentPlans();
      setEditingGoal(null);
      setGoalNotes("");
    } catch (error) {
      console.error("Failed to update goal:", error);
      toast.error("Failed to update goal");
    }
  };

  const getStatusColor = (status: Goal["status"]) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800";
      case "in_progress":
        return "bg-blue-100 text-blue-800";
      case "not_started":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: Goal["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case "in_progress":
        return <Clock className="w-5 h-5 text-blue-600" />;
      case "not_started":
        return <AlertCircle className="w-5 h-5 text-gray-600" />;
      default:
        return null;
    }
  };

  const getDaysUntilTarget = (targetDate: string) => {
    const days = Math.ceil(
      (new Date(targetDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
    );
    return days;
  };

  const getPlanStatusColor = (status: DevelopmentPlan["status"]) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800";
      case "active":
        return "bg-blue-100 text-blue-800";
      case "draft":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getGoalStats = (plan: DevelopmentPlan) => {
    if (!plan.goals) return { total: 0, completed: 0, inProgress: 0, notStarted: 0 };

    return {
      total: plan.goals.length,
      completed: plan.goals.filter((g) => g.status === "completed").length,
      inProgress: plan.goals.filter((g) => g.status === "in_progress").length,
      notStarted: plan.goals.filter((g) => g.status === "not_started").length,
    };
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Development Plan</h1>
        <p className="text-gray-500 mt-1">
          {isManager
            ? "Track and manage development goals"
            : "View your development goals and progress"}
        </p>
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Target className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Development Plan</h3>
            <p className="text-gray-500">
              Your development plan will appear here after your performance review is completed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex space-x-4 overflow-x-auto pb-2">
            {plans.map((plan) => {
              const stats = getGoalStats(plan);
              return (
                <Card
                  key={plan.id}
                  className={`min-w-[300px] cursor-pointer transition-all ${
                    selectedPlan?.id === plan.id
                      ? "border-blue-500 border-2 shadow-lg"
                      : "hover:shadow-md"
                  }`}
                  onClick={() => setSelectedPlan(plan)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{plan.plan_title}</CardTitle>
                        <p className="text-sm text-gray-500">{plan.cycle_name}</p>
                      </div>
                      <Badge className={getPlanStatusColor(plan.status)}>
                        {plan.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center space-x-4 text-sm">
                      <div className="flex items-center space-x-1">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <span>{stats.completed}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Clock className="w-4 h-4 text-blue-600" />
                        <span>{stats.inProgress}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <AlertCircle className="w-4 h-4 text-gray-600" />
                        <span>{stats.notStarted}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {selectedPlan && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Plan Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">Objectives</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {selectedPlan.plan.objectives.map((obj, idx) => (
                        <li key={idx} className="text-sm text-gray-600">
                          {obj}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">Training Needs</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {selectedPlan.plan.training_needs.map((need, idx) => (
                        <li key={idx} className="text-sm text-gray-600">
                          {need}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">Timeline</h4>
                    <p className="text-sm text-gray-600">{selectedPlan.plan.timeline}</p>
                  </div>

                  {selectedPlan.plan.resources_needed &&
                    selectedPlan.plan.resources_needed.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">
                          Resources Needed
                        </h4>
                        <ul className="list-disc list-inside space-y-1">
                          {selectedPlan.plan.resources_needed.map((resource, idx) => (
                            <li key={idx} className="text-sm text-gray-600">
                              {resource}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Development Goals</CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedPlan.goals && selectedPlan.goals.length > 0 ? (
                    <div className="space-y-4">
                      {selectedPlan.goals.map((goal) => {
                        const daysUntilTarget = getDaysUntilTarget(goal.target_date);
                        const isOverdue = daysUntilTarget < 0 && goal.status !== "completed";

                        return (
                          <Card key={goal.id} className={isOverdue ? "border-red-300" : ""}>
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-2">
                                    {getStatusIcon(goal.status)}
                                    <h4 className="font-semibold text-gray-900">
                                      {goal.goal_description}
                                    </h4>
                                  </div>
                                  <div className="flex items-center space-x-4 text-sm text-gray-500">
                                    <div className="flex items-center space-x-1">
                                      <Calendar className="w-4 h-4" />
                                      <span>
                                        Target: {new Date(goal.target_date).toLocaleDateString()}
                                      </span>
                                    </div>
                                    {isOverdue && (
                                      <Badge className="bg-red-100 text-red-800">
                                        Overdue by {Math.abs(daysUntilTarget)} days
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <Badge className={getStatusColor(goal.status)}>
                                  {goal.status.replace("_", " ")}
                                </Badge>
                              </div>

                              {goal.notes && (
                                <div className="mb-3 p-3 bg-gray-50 rounded">
                                  <p className="text-sm text-gray-600">{goal.notes}</p>
                                </div>
                              )}

                              {goal.completion_date && (
                                <p className="text-xs text-green-600 mb-3">
                                  Completed on {new Date(goal.completion_date).toLocaleDateString()}
                                </p>
                              )}

                              {isManager && goal.status !== "completed" && (
                                <div className="space-y-3">
                                  {editingGoal === goal.id ? (
                                    <>
                                      <Textarea
                                        value={goalNotes}
                                        onChange={(e) => setGoalNotes(e.target.value)}
                                        placeholder="Add notes about progress..."
                                        className="min-h-[80px]"
                                      />
                                      <div className="flex space-x-2">
                                        <Button
                                          size="sm"
                                          onClick={() =>
                                            updateGoalStatus(
                                              goal.id,
                                              goal.status === "not_started"
                                                ? "in_progress"
                                                : "completed",
                                              goalNotes
                                            )
                                          }
                                        >
                                          {goal.status === "not_started"
                                            ? "Start Goal"
                                            : "Mark Complete"}
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => {
                                            setEditingGoal(null);
                                            setGoalNotes("");
                                          }}
                                        >
                                          Cancel
                                        </Button>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="flex space-x-2">
                                      {goal.status === "not_started" && (
                                        <Button
                                          size="sm"
                                          onClick={() => {
                                            setEditingGoal(goal.id);
                                            setGoalNotes(goal.notes || "");
                                          }}
                                        >
                                          Start Goal
                                        </Button>
                                      )}
                                      {goal.status === "in_progress" && (
                                        <>
                                          <Button
                                            size="sm"
                                            onClick={() => {
                                              setEditingGoal(goal.id);
                                              setGoalNotes(goal.notes || "");
                                            }}
                                          >
                                            Update Progress
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                              updateGoalStatus(goal.id, "completed", goal.notes || "")
                                            }
                                          >
                                            Mark Complete
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 py-8">
                      No goals defined yet for this development plan
                    </div>
                  )}
                </CardContent>
              </Card>

              {selectedPlan.goals && selectedPlan.goals.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Timeline View</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DevPlanTimeline
                      goals={selectedPlan.goals.map((g) => ({
                        title: g.goal_description,
                        targetDate: g.target_date,
                        status: g.status,
                      }))}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
