import { useState } from "react";
import { Navigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Building2, CalendarDays, Plus, Pencil, Trash2, Loader2, ShieldAlert, Users, Hash, Globe, MapPin, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDepartments } from "@/hooks/useEmployees";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useIsAdminOrHR, useUserRole } from "@/hooks/useUserRole";
import { UserRolesManager } from "@/components/settings/UserRolesManager";
import { EmployeeCodeSettings } from "@/components/settings/EmployeeCodeSettings";
import DomainWhitelistSettings from "@/components/settings/DomainWhitelistSettings";
import OfficeLocationSettings from "@/components/settings/OfficeLocationSettings";

// Fetch leave types from MySQL backend
const useLeaveTypes = () => {
  return useQuery({
    queryKey: ['leave-types'],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>('/api/leave/types');
      // Normalise MySQL field names to the shape the UI expects
      return (res.data ?? []).map((lt: any) => ({
        id: lt.id,
        name: lt.leave_name,
        description: null,          // MySQL table has no description column
        days_per_year: lt.max_days_per_year,
        is_paid: Boolean(lt.paid_leave),
        leave_code: lt.leave_code,
        carry_forward: Boolean(lt.carry_forward),
        requires_approval: Boolean(lt.requires_approval),
      }));
    },
  });
};

interface DepartmentForm {
  name: string;
  description: string;
}

interface LeaveTypeForm {
  name: string;
  description: string;
  days_per_year: number;
  is_paid: boolean;
}

const SecuritySettings = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: setting, isLoading } = useQuery({
    queryKey: ['org-setting', 'two_factor_enabled'],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: { setting_value: string } }>(
        '/api/org/settings/two_factor_enabled'
      );
      return res.data?.setting_value !== 'false';
    },
  });

  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await hrmsApi.put('/api/org/settings/two_factor_enabled', { setting_value: String(enabled) });
    },
    onSuccess: (_data, enabled) => {
      queryClient.invalidateQueries({ queryKey: ['org-setting', 'two_factor_enabled'] });
      toast({
        title: enabled ? '2FA Enabled' : '2FA Disabled',
        description: enabled
          ? 'All users must complete two-factor authentication on login.'
          : 'Two-factor authentication is disabled for all users.',
      });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update setting.', variant: 'destructive' });
    },
  });

  const enabled = setting ?? true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-600" />
          Security Settings
        </CardTitle>
        <CardDescription>Manage platform-wide security policies</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-xl border p-5">
          <div className="space-y-1">
            <p className="font-semibold text-slate-900">Two-Factor Authentication (2FA)</p>
            <p className="text-sm text-slate-500">
              When enabled, all users are required to verify via OTP on every login.
              Disable to allow direct login with password only.
            </p>
            <p className={`text-xs font-bold mt-1 ${enabled ? 'text-emerald-600' : 'text-rose-600'}`}>
              {enabled ? '● Enabled — OTP required for all users' : '● Disabled — direct login allowed'}
            </p>
          </div>
          <div className="ml-6 flex items-center gap-3">
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            ) : (
              <Switch
                checked={enabled}
                disabled={mutation.isPending}
                onCheckedChange={(val) => mutation.mutate(val)}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const Settings = () => {
  const [activeTab, setActiveTab] = useState("user-roles");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdminOrHR, isLoading: roleLoading, role } = useIsAdminOrHR();
  const isAdmin = role === 'admin' || role === 'super_admin';
  
  // Department state
  const [deptDialogOpen, setDeptDialogOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<{ id: string } | null>(null);
  const [deptForm, setDeptForm] = useState<DepartmentForm>({ name: '', description: '' });
  
  // Leave type state
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<{ id: string } | null>(null);
  const [leaveForm, setLeaveForm] = useState<LeaveTypeForm>({ 
    name: '', 
    description: '', 
    days_per_year: 0, 
    is_paid: true 
  });

  const { data: departments = [], isLoading: loadingDepts } = useDepartments();
  const { data: leaveTypes = [], isLoading: loadingLeaves } = useLeaveTypes();

  // Department mutations - must be before any early returns
  const createDeptMutation = useMutation({
    mutationFn: async (data: DepartmentForm) => {
      await hrmsApi.post('/api/org/departments', {
        dept_name: data.name.trim(),
        dept_code: data.name.trim().toUpperCase().replace(/\s+/g, '_').slice(0, 20),
        description: data.description.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      setDeptDialogOpen(false);
      setDeptForm({ name: '', description: '' });
      toast({ title: "Department created", description: "New department has been added." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateDeptMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: DepartmentForm }) => {
      await hrmsApi.put(`/api/org/departments/${id}`, {
        dept_name: data.name.trim(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      setDeptDialogOpen(false);
      setEditingDept(null);
      setDeptForm({ name: '', description: '' });
      toast({ title: "Department updated", description: "Department has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteDeptMutation = useMutation({
    mutationFn: async (id: string) => {
      await hrmsApi.delete(`/api/org/departments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      toast({ title: "Department deleted", description: "Department has been removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Leave type mutations - must be before any early returns
  const createLeaveMutation = useMutation({
    mutationFn: async (data: LeaveTypeForm) => {
      await hrmsApi.post('/api/leave/types', {
        leaveCode: data.name.trim().toUpperCase().replace(/\s+/g, '_').slice(0, 20),
        leaveName: data.name.trim(),
        maxDaysPerYear: data.days_per_year,
        carryForward: false,
        requiresApproval: true,
        paidLeave: data.is_paid,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
      setLeaveDialogOpen(false);
      setLeaveForm({ name: '', description: '', days_per_year: 0, is_paid: true });
      toast({ title: "Leave type created", description: "New leave type has been added." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateLeaveMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: LeaveTypeForm }) => {
      await hrmsApi.put(`/api/leave/types/${id}`, {
        leave_name: data.name.trim(),
        max_days_per_year: data.days_per_year,
        paid_leave: data.is_paid,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
      setLeaveDialogOpen(false);
      setEditingLeave(null);
      setLeaveForm({ name: '', description: '', days_per_year: 0, is_paid: true });
      toast({ title: "Leave type updated", description: "Leave type has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteLeaveMutation = useMutation({
    mutationFn: async (id: string) => {
      await hrmsApi.delete(`/api/leave/types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
      toast({ title: "Leave type deleted", description: "Leave type has been removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Show loading while checking role
  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  // Redirect non-admin/HR users
  if (!isAdminOrHR) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] flex-col items-center justify-center space-y-4">
          <ShieldAlert className="h-16 w-16 text-destructive" />
          <h2 className="text-2xl font-bold text-foreground">Access Denied</h2>
          <p className="text-muted-foreground">You don't have permission to access this page.</p>
          <p className="text-sm text-muted-foreground">Only administrators and HR personnel can manage settings.</p>
        </div>
      </DashboardLayout>
    );
  }


  const handleEditDept = (dept: { id: string; name: string; description: string | null }) => {
    setEditingDept({ id: dept.id });
    setDeptForm({ name: dept.name, description: dept.description || '' });
    setDeptDialogOpen(true);
  };

  const handleEditLeave = (leave: { id: string; name: string; description: string | null; days_per_year: number; is_paid: boolean | null }) => {
    setEditingLeave({ id: leave.id });
    setLeaveForm({ 
      name: leave.name, 
      description: leave.description || '', 
      days_per_year: leave.days_per_year,
      is_paid: leave.is_paid ?? true,
    });
    setLeaveDialogOpen(true);
  };

  const handleDeptSubmit = () => {
    if (!deptForm.name.trim()) {
      toast({ title: "Error", description: "Department name is required", variant: "destructive" });
      return;
    }
    if (editingDept) {
      updateDeptMutation.mutate({ id: editingDept.id, data: deptForm });
    } else {
      createDeptMutation.mutate(deptForm);
    }
  };

  const handleLeaveSubmit = () => {
    if (!leaveForm.name.trim()) {
      toast({ title: "Error", description: "Leave type name is required", variant: "destructive" });
      return;
    }
    if (editingLeave) {
      updateLeaveMutation.mutate({ id: editingLeave.id, data: leaveForm });
    } else {
      createLeaveMutation.mutate(leaveForm);
    }
  };

  const isDeptSaving = createDeptMutation.isPending || updateDeptMutation.isPending;
  const isLeaveSaving = createLeaveMutation.isPending || updateLeaveMutation.isPending;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">System</p>
          <h2 className="mt-1 text-3xl font-black text-slate-950">Settings</h2>
          <p className="text-slate-600">Manage system configurations</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:h-10 sm:w-auto">
            {isAdmin && (
              <TabsTrigger
                value="user-roles"
                className="w-full justify-center gap-2 sm:w-auto"
              >
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Users</span>
                <span className="sm:hidden">Users</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="departments" className="w-full justify-center gap-2 sm:w-auto">
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">Departments</span>
              <span className="sm:hidden">Depts</span>
            </TabsTrigger>
            <TabsTrigger value="leave-types" className="w-full justify-center gap-2 sm:w-auto">
              <CalendarDays className="h-4 w-4" />
              <span className="hidden sm:inline">Leave Types</span>
              <span className="sm:hidden">Leaves</span>
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="employee-id" className="w-full justify-center gap-2 sm:w-auto">
                <Hash className="h-4 w-4" />
                <span className="hidden sm:inline">Employee ID</span>
                <span className="sm:hidden">ID</span>
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="domain-whitelist" className="w-full justify-center gap-2 sm:w-auto">
                <Globe className="h-4 w-4" />
                <span className="hidden sm:inline">Domain Whitelist</span>
                <span className="sm:hidden">Domains</span>
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="office-location" className="w-full justify-center gap-2 sm:w-auto">
                <MapPin className="h-4 w-4" />
                <span className="hidden sm:inline">Office Location</span>
                <span className="sm:hidden">Office</span>
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="security" className="w-full justify-center gap-2 sm:w-auto">
                <ShieldCheck className="h-4 w-4" />
                <span className="hidden sm:inline">Security</span>
                <span className="sm:hidden">Security</span>
              </TabsTrigger>
            )}
          </TabsList>

          {/* Departments Tab */}
          <TabsContent value="departments" className="mt-6">
            <Card>
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Departments</CardTitle>
                  <CardDescription>Manage company departments</CardDescription>
                </div>
                <Dialog open={deptDialogOpen} onOpenChange={(open) => {
                  setDeptDialogOpen(open);
                  if (!open) {
                    setEditingDept(null);
                    setDeptForm({ name: '', description: '' });
                  }
                }}>
                  <DialogTrigger asChild>
                    <Button className="bg-slate-950 text-white hover:bg-slate-800 rounded-2xl px-5 py-2.5 font-semibold cursor-pointer transition-colors">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Department
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingDept ? 'Edit Department' : 'Add Department'}</DialogTitle>
                      <DialogDescription>
                        {editingDept ? 'Update department details' : 'Create a new department'}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="deptName">Name *</Label>
                        <Input
                          id="deptName"
                          value={deptForm.name}
                          onChange={(e) => setDeptForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="e.g., Engineering"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="deptDescription">Description</Label>
                        <Textarea
                          id="deptDescription"
                          value={deptForm.description}
                          onChange={(e) => setDeptForm(prev => ({ ...prev, description: e.target.value }))}
                          placeholder="Brief description of the department"
                          rows={3}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDeptDialogOpen(false)}>Cancel</Button>
                      <Button onClick={handleDeptSubmit} disabled={isDeptSaving}>
                        {isDeptSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {editingDept ? 'Update' : 'Create'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {loadingDepts ? (
                  <div className="py-8 text-center text-muted-foreground">Loading departments...</div>
                ) : departments.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">No departments found. Add your first department.</div>
                ) : (
                  <Table className="smarthr-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-24">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {departments.map((dept) => (
                        <TableRow key={dept.id} className="hover:bg-gray-50 transition-colors">
                          <TableCell className="font-medium">{dept.name}</TableCell>
                          <TableCell className="text-muted-foreground">{dept.description || '-'}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="icon" className="cursor-pointer" onClick={() => handleEditDept(dept)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="cursor-pointer text-destructive hover:text-destructive"
                                onClick={() => deleteDeptMutation.mutate(dept.id)}
                                disabled={deleteDeptMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Leave Types Tab */}
          <TabsContent value="leave-types" className="mt-6">
            <Card>
              <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Leave Types</CardTitle>
                  <CardDescription>Configure available leave types and their policies</CardDescription>
                </div>
                <Dialog open={leaveDialogOpen} onOpenChange={(open) => {
                  setLeaveDialogOpen(open);
                  if (!open) {
                    setEditingLeave(null);
                    setLeaveForm({ name: '', description: '', days_per_year: 0, is_paid: true });
                  }
                }}>
                  <DialogTrigger asChild>
                    <Button className="bg-slate-950 text-white hover:bg-slate-800 rounded-2xl px-5 py-2.5 font-semibold cursor-pointer transition-colors">
                      <Plus className="mr-2 h-4 w-4" />
                      Add Leave Type
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingLeave ? 'Edit Leave Type' : 'Add Leave Type'}</DialogTitle>
                      <DialogDescription>
                        {editingLeave ? 'Update leave type details' : 'Create a new leave type'}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="leaveName">Name *</Label>
                        <Input
                          id="leaveName"
                          value={leaveForm.name}
                          onChange={(e) => setLeaveForm(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="e.g., Annual Leave"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="leaveDescription">Description</Label>
                        <Textarea
                          id="leaveDescription"
                          value={leaveForm.description}
                          onChange={(e) => setLeaveForm(prev => ({ ...prev, description: e.target.value }))}
                          placeholder="Brief description of this leave type"
                          rows={2}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="daysPerYear">Days Per Year</Label>
                        <Input
                          id="daysPerYear"
                          type="number"
                          min="0"
                          value={leaveForm.days_per_year}
                          onChange={(e) => setLeaveForm(prev => ({ ...prev, days_per_year: parseInt(e.target.value) || 0 }))}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div>
                          <Label htmlFor="isPaid">Paid Leave</Label>
                          <p className="text-xs text-muted-foreground">Employee receives salary during this leave</p>
                        </div>
                        <Switch
                          id="isPaid"
                          checked={leaveForm.is_paid}
                          onCheckedChange={(checked) => setLeaveForm(prev => ({ ...prev, is_paid: checked }))}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setLeaveDialogOpen(false)}>Cancel</Button>
                      <Button onClick={handleLeaveSubmit} disabled={isLeaveSaving}>
                        {isLeaveSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {editingLeave ? 'Update' : 'Create'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {loadingLeaves ? (
                  <div className="py-8 text-center text-muted-foreground">Loading leave types...</div>
                ) : leaveTypes.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">No leave types found. Add your first leave type.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Days/Year</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-24">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leaveTypes.map((leave) => (
                        <TableRow key={leave.id}>
                          <TableCell className="font-medium">{leave.name}</TableCell>
                          <TableCell>{leave.days_per_year}</TableCell>
                          <TableCell>
                            <Badge variant={leave.is_paid ? "default" : "secondary"}>
                              {leave.is_paid ? "Paid" : "Unpaid"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{leave.description || '-'}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="icon" className="cursor-pointer" onClick={() => handleEditLeave(leave)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="cursor-pointer text-destructive hover:text-destructive"
                                onClick={() => deleteLeaveMutation.mutate(leave.id)}
                                disabled={deleteLeaveMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* User Roles Tab - Admin Only */}
          {isAdmin && (
            <TabsContent value="user-roles" className="mt-6">
              <UserRolesManager />
            </TabsContent>
          )}

          {/* Employee ID Pattern Tab - Admin Only */}
          {isAdmin && (
            <TabsContent value="employee-id" className="mt-6">
              <EmployeeCodeSettings />
            </TabsContent>
          )}

          {/* Domain Whitelist Tab - Admin Only */}
          {isAdmin && (
            <TabsContent value="domain-whitelist" className="mt-6">
              <DomainWhitelistSettings />
            </TabsContent>
          )}

          {/* Office Location Tab - Admin Only */}
          {isAdmin && (
            <TabsContent value="office-location" className="mt-6">
              <OfficeLocationSettings />
            </TabsContent>
          )}

          {/* Security Tab - Admin Only */}
          {isAdmin && (
            <TabsContent value="security" className="mt-6">
              <SecuritySettings />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Settings;
