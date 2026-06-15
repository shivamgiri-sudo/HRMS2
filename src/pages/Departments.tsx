import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Pencil, Trash2, Users, Loader2, ShieldAlert } from "lucide-react";
import { useDepartments, useCreateDepartment, useUpdateDepartment, useDeleteDepartment, Department } from "@/hooks/useDepartments";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { format } from "date-fns";

const Departments = () => {
  const { data: departments, isLoading } = useDepartments();
  const { isAdminOrHR, isLoading: roleLoading } = useIsAdminOrHR();
  const createDepartment = useCreateDepartment();
  const updateDepartment = useUpdateDepartment();
  const deleteDepartment = useDeleteDepartment();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "", manager_id: "" });

  // Fetch employees for manager selection
  const { data: employees = [] } = useQuery({
    queryKey: ["employees-for-manager"],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      return res.data ?? [];
    },
  });

  const resetForm = () => {
    setFormData({ name: "", description: "", manager_id: "" });
    setEditingDepartment(null);
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast.error("Department name is required");
      return;
    }

    try {
      await createDepartment.mutateAsync({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        manager_id: formData.manager_id || null,
      });
      toast.success("Department created successfully");
      setIsCreateOpen(false);
      resetForm();
    } catch (error) {
      toast.error("Failed to create department");
    }
  };

  const handleUpdate = async () => {
    if (!editingDepartment || !formData.name.trim()) {
      toast.error("Department name is required");
      return;
    }

    try {
      await updateDepartment.mutateAsync({
        id: editingDepartment.id,
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        manager_id: formData.manager_id || null,
      });
      toast.success("Department updated successfully");
      setEditingDepartment(null);
      resetForm();
    } catch (error) {
      toast.error("Failed to update department");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDepartment.mutateAsync(id);
      toast.success("Department deleted successfully");
    } catch (error) {
      toast.error("Failed to delete department. It may have employees assigned.");
    }
  };

  const openEdit = (department: Department) => {
    setEditingDepartment(department);
    setFormData({
      name: department.name,
      description: department.description || "",
      manager_id: department.manager_id || "",
    });
  };

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
          <p className="text-sm text-muted-foreground">Only administrators and HR personnel can manage departments.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Hero Header */}
        <section className="relative overflow-hidden rounded-2xl bg-slate-950 text-white shadow-lg">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[#1B6AB5]/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-8 left-1/3 h-48 w-48 rounded-full bg-[#3BAD49]/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#5aa0dd]">
                Organization Structure
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-white">Departments</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                Manage company departments, assign heads and track team size.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <div className="rounded-xl border border-white/10 bg-white/8 px-4 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Departments</p>
                  <p className="text-lg font-black text-[#5aa0dd]">{departments?.length ?? 0}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/8 px-4 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Employees</p>
                  <p className="text-lg font-black text-[#3BAD49]">{departments?.reduce((s, d) => s + d.employee_count, 0) ?? 0}</p>
                </div>
              </div>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button
                  onClick={() => resetForm()}
                  className="shrink-0 rounded-xl bg-[#1B6AB5] px-5 font-bold text-white shadow-lg shadow-[#1B6AB5]/25 hover:bg-[#155e9f]"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Department
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Department</DialogTitle>
                <DialogDescription>Add a new department to your organization</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Engineering"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Brief description of the department"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manager">Department Head</Label>
                  <Select
                    value={formData.manager_id}
                    onValueChange={(value) => setFormData({ ...formData, manager_id: value === "none" ? "" : value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select department head" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Manager</SelectItem>
                      {employees.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.first_name} {emp.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={createDepartment.isPending}>
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </section>

        {/* Departments Table */}
        <Card className="overflow-hidden rounded-2xl border-slate-100 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-black text-slate-950">All Departments</CardTitle>
                <CardDescription className="mt-0.5">View and manage all departments in your organization</CardDescription>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f2fc]">
                <Building2 className="h-5 w-5 text-[#1B6AB5]" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : departments && departments.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Department Head</TableHead>
                      <TableHead>Employees</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {departments.map((department) => (
                      <TableRow key={department.id} className="cursor-pointer hover:bg-gray-50 transition-colors">
                        <TableCell className="font-medium">{department.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {department.description || <span className="text-muted-foreground">Not configured</span>}
                        </TableCell>
                        <TableCell>
                          {department.manager_name || <span className="text-muted-foreground">Not assigned</span>}
                        </TableCell>
                        <TableCell>
                          <Badge className="rounded-full bg-[#e8f2fc] px-2.5 text-xs font-bold text-[#1B6AB5] hover:bg-[#e8f2fc]">{department.employee_count}</Badge>
                        </TableCell>
                        <TableCell>
                          {department.created_at && !isNaN(new Date(department.created_at).getTime())
                            ? format(new Date(department.created_at), "MMM d, yyyy")
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Dialog
                              open={editingDepartment?.id === department.id}
                              onOpenChange={(open) => !open && setEditingDepartment(null)}
                            >
                              <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEdit(department)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Edit Department</DialogTitle>
                                  <DialogDescription>Update department details</DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                  <div className="space-y-2">
                                    <Label htmlFor="edit-name">Name *</Label>
                                    <Input
                                      id="edit-name"
                                      value={formData.name}
                                      onChange={(e) =>
                                        setFormData({ ...formData, name: e.target.value })
                                      }
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="edit-description">Description</Label>
                                    <Textarea
                                      id="edit-description"
                                      value={formData.description}
                                      onChange={(e) =>
                                        setFormData({ ...formData, description: e.target.value })
                                      }
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="edit-manager">Department Head</Label>
                                    <Select
                                      value={formData.manager_id}
                                      onValueChange={(value) => setFormData({ ...formData, manager_id: value === "none" ? "" : value })}
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select department head" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="none">No Manager</SelectItem>
                                        {employees.map((emp) => (
                                          <SelectItem key={emp.id} value={emp.id}>
                                            {emp.first_name} {emp.last_name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                <DialogFooter>
                                  <Button
                                    variant="outline"
                                    onClick={() => setEditingDepartment(null)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    onClick={handleUpdate}
                                    disabled={updateDepartment.isPending}
                                  >
                                    Save Changes
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>

                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Department</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{department.name}"? This action
                                    cannot be undone. Departments with assigned employees cannot be
                                    deleted.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(department.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                No departments found. Create your first department to get started.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default Departments;
