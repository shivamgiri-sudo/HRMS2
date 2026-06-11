import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Target, Loader2, Calendar, Users, Plus, Trash2, Edit2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCreateGoal, useUpdateGoal, useDeleteGoal } from "@/hooks/usePerformance";
import { format } from "date-fns";

interface TeamGoalsViewProps {
  managerId: string;
}

interface TeamMemberWithGoals {
  id: string;
  first_name: string;
  last_name: string;
  designation: string;
  avatar_url: string | null;
  goals: {
    id: string;
    title: string;
    description: string | null;
    category: string;
    priority: string;
    status: string;
    due_date: string | null;
  }[];
}

const statusColors: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/10 text-primary border-primary/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
};

const priorityColors: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  high: "bg-destructive/10 text-destructive border-destructive/20",
};

export function TeamGoalsView({ managerId }: TeamGoalsViewProps) {
  const [selectedEmployee, setSelectedEmployee] = useState<string>("all");
  const [isGoalDialogOpen, setIsGoalDialogOpen] = useState(false);
  const [editingGoalData, setEditingGoalData] = useState<{ id: string; employeeId: string } | null>(null);
  const [goalForm, setGoalForm] = useState({
    employee_id: "", title: "", description: "", category: "performance", customCategory: "", priority: "medium", due_date: "",
  });
  const queryClient = useQueryClient();
  const createGoalMutation = useCreateGoal();
  const updateGoalMutation = useUpdateGoal();
  const deleteGoalMutation = useDeleteGoal();

  const { data: teamData, isLoading } = useQuery({
    queryKey: ["team-goals", managerId],
    queryFn: async () => {
      const empRes = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      const employees = empRes.data ?? [];
      if (!employees || employees.length === 0) return [];

      const goalsRes = await hrmsApi.get<{success:boolean;data:any}>("/api/goals/goals");
      const goals = goalsRes.data ?? [];

      return employees.map((emp: any) => ({
        ...emp,
        goals: (goals || []).filter((g: any) => g.employee_id === emp.id),
      })) as TeamMemberWithGoals[];
    },
    enabled: !!managerId,
  });

  const resetGoalForm = () => {
    setGoalForm({ employee_id: "", title: "", description: "", category: "performance", customCategory: "", priority: "medium", due_date: "" });
    setEditingGoalData(null);
  };

  const openAddGoalDialog = (employeeId?: string) => {
    resetGoalForm();
    if (employeeId) setGoalForm(prev => ({ ...prev, employee_id: employeeId }));
    setIsGoalDialogOpen(true);
  };

  const openEditGoalDialog = (goal: TeamMemberWithGoals["goals"][0], employeeId: string) => {
    const predefined = ["performance", "productivity", "quality", "leadership", "development"];
    const isCustom = goal.category && !predefined.includes(goal.category);
    setEditingGoalData({ id: goal.id, employeeId });
    setGoalForm({
      employee_id: employeeId, title: goal.title, description: goal.description || "",
      category: isCustom ? "other" : goal.category, customCategory: isCustom ? goal.category : "",
      priority: goal.priority, due_date: goal.due_date || "",
    });
    setIsGoalDialogOpen(true);
  };

  const handleGoalSubmit = async () => {
    if (!goalForm.title.trim() || !goalForm.employee_id) return;
    const finalCategory = goalForm.category === "other" ? goalForm.customCategory.trim() || "other" : goalForm.category;

    if (editingGoalData) {
      await updateGoalMutation.mutateAsync({
        id: editingGoalData.id, employeeId: editingGoalData.employeeId,
        title: goalForm.title, description: goalForm.description || null,
        category: finalCategory, priority: goalForm.priority, due_date: goalForm.due_date || null,
      });
    } else {
      await createGoalMutation.mutateAsync({
        employee_id: goalForm.employee_id, title: goalForm.title,
        description: goalForm.description || undefined, category: finalCategory,
        priority: goalForm.priority, due_date: goalForm.due_date || undefined,
      });
    }
    queryClient.invalidateQueries({ queryKey: ["team-goals", managerId] });
    setIsGoalDialogOpen(false);
    resetGoalForm();
  };

  const handleDeleteGoal = (goalId: string, employeeId: string) => {
    deleteGoalMutation.mutate({ id: goalId, employeeId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team-goals", managerId] }),
    });
  };

  if (isLoading) {
    return <Card><CardContent className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>;
  }

  if (!teamData || teamData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" />Team KPIs</CardTitle>
          <CardDescription>Manage KPIs for your team. Ratings are added during reviews.</CardDescription>
        </CardHeader>
        <CardContent className="text-center py-8 text-muted-foreground">
          <Users className="mx-auto h-8 w-8 mb-2 opacity-50" /><p>No team members found</p>
        </CardContent>
      </Card>
    );
  }

  const filteredData = selectedEmployee === "all" ? teamData : teamData.filter(emp => emp.id === selectedEmployee);
  const totalKPIs = teamData.reduce((sum, emp) => sum + emp.goals.length, 0);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" />Team KPIs</CardTitle>
            <CardDescription>{totalKPIs} total KPIs • Ratings are added during reviews</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Filter by employee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Team Members</SelectItem>
                {teamData.map(emp => <SelectItem key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={() => openAddGoalDialog()}><Plus className="h-4 w-4 mr-2" />Add KPI</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {filteredData.map(employee => (
              <div key={employee.id} className="space-y-3">
                <div className="flex items-center gap-3 pb-2 border-b">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={employee.avatar_url || undefined} />
                    <AvatarFallback>{employee.first_name[0]}{employee.last_name[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{employee.first_name} {employee.last_name}</p>
                    <p className="text-xs text-muted-foreground">{employee.designation}</p>
                  </div>
                  <Badge variant="outline" className="ml-auto">{employee.goals.length} KPIs</Badge>
                </div>

                {employee.goals.length > 0 ? (
                  <div className="space-y-3 pl-11">
                    {employee.goals.map(goal => (
                      <div key={goal.id} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 flex-1">
                            <h4 className="font-medium text-sm">{goal.title}</h4>
                            {goal.description && <p className="text-xs text-muted-foreground line-clamp-2">{goal.description}</p>}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditGoalDialog(goal, employee.id)}><Edit2 className="h-3.5 w-3.5" /></Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>Delete KPI</AlertDialogTitle><AlertDialogDescription>Are you sure you want to delete "{goal.title}"?</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteGoal(goal.id, employee.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline" className={`text-xs ${statusColors[goal.status]}`}>{goal.status.replace("_", " ")}</Badge>
                          <Badge variant="outline" className={`text-xs ${priorityColors[goal.priority]}`}>{goal.priority}</Badge>
                          {goal.due_date && <Badge variant="outline" className="text-xs gap-1"><Calendar className="h-3 w-3" />{format(new Date(goal.due_date), "MMM d")}</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pl-11 flex items-center gap-2">
                    <p className="text-sm text-muted-foreground">No KPIs set</p>
                    <Button variant="link" size="sm" className="text-xs" onClick={() => openAddGoalDialog(employee.id)}><Plus className="h-3 w-3 mr-1" /> Add one</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isGoalDialogOpen} onOpenChange={setIsGoalDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingGoalData ? "Edit KPI" : "Add KPI for Team Member"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!editingGoalData && (
              <div className="space-y-2">
                <Label>Team Member</Label>
                <Select value={goalForm.employee_id} onValueChange={(v) => setGoalForm(prev => ({ ...prev, employee_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select team member" /></SelectTrigger>
                  <SelectContent>{teamData?.map(emp => <SelectItem key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2"><Label>Title</Label><Input value={goalForm.title} onChange={(e) => setGoalForm(prev => ({ ...prev, title: e.target.value }))} placeholder="Enter KPI title" /></div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={goalForm.description} onChange={(e) => setGoalForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Describe the KPI..." rows={3} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={goalForm.category} onValueChange={(v) => setGoalForm(prev => ({ ...prev, category: v, customCategory: v === "other" ? prev.customCategory : "" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="performance">Performance</SelectItem><SelectItem value="productivity">Productivity</SelectItem>
                    <SelectItem value="quality">Quality</SelectItem><SelectItem value="leadership">Leadership</SelectItem>
                    <SelectItem value="development">Development</SelectItem><SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                {goalForm.category === "other" && <Input value={goalForm.customCategory} onChange={(e) => setGoalForm(prev => ({ ...prev, customCategory: e.target.value }))} placeholder="Enter custom category" className="mt-2" />}
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={goalForm.priority} onValueChange={(v) => setGoalForm(prev => ({ ...prev, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Due Date (Optional)</Label><Input type="date" value={goalForm.due_date} onChange={(e) => setGoalForm(prev => ({ ...prev, due_date: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsGoalDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleGoalSubmit} disabled={!goalForm.title.trim() || !goalForm.employee_id || createGoalMutation.isPending || updateGoalMutation.isPending}>
              {(createGoalMutation.isPending || updateGoalMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingGoalData ? "Save Changes" : "Add KPI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
