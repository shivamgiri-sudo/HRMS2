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
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Departments</h2>
            <p className="text-muted-foreground">Manage company departments and teams</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => resetForm()}>
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

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="rounded-xl bg-primary/10 p-3">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Departments</p>
                  <p className="text-2xl font-bold">{departments?.length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="rounded-xl bg-secondary/50 p-3">
                  <Users className="h-6 w-6 text-secondary-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Employees</p>
                  <p className="text-2xl font-bold">
                    {departments?.reduce((sum, d) => sum + d.employee_count, 0) || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Departments Table */}
        <Card>
          <CardHeader>
            <CardTitle>All Departments</CardTitle>
            <CardDescription>View and manage all departments in your organization</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : departments && departments.length > 0 ? (
              <div className="rounded-md border">
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
                      <TableRow key={department.id}>
                        <TableCell className="font-medium">{department.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {department.description || "-"}
                        </TableCell>
                        <TableCell>
                          {department.manager_name || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{department.employee_count}</Badge>
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
