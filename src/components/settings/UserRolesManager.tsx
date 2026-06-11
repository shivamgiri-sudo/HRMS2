import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Pencil, Loader2, Ban, CheckCircle, Link, Unlink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";

type AppRole = "admin" | "hr" | "manager" | "employee";
type EmployeeStatus = "active" | "inactive" | "onboarding" | "offboarded";

interface UserWithRole {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: AppRole | null;
  role_id: string | null;
  employee_status: EmployeeStatus | null;
  blocked: boolean;
  employee_id: string | null;
}

interface UnlinkedEmployee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  designation: string;
}

const roleLabels: Record<AppRole, string> = {
  admin: "Administrator",
  hr: "HR Manager",
  manager: "Manager",
  employee: "Employee",
};

const roleBadgeVariant: Record<AppRole, "default" | "secondary" | "outline"> = {
  admin: "default",
  hr: "default",
  manager: "secondary",
  employee: "outline",
};

const statusLabels: Record<EmployeeStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  onboarding: "Onboarding",
  offboarded: "Offboarded",
};

const statusBadgeVariant: Record<EmployeeStatus, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  inactive: "destructive",
  onboarding: "secondary",
  offboarded: "outline",
};

export function UserRolesManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithRole | null>(null);
  const [selectedRole, setSelectedRole] = useState<AppRole>("employee");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users-with-roles'],
    queryFn: async () => {
      // Fetch employees and roles in parallel
      const [empRes, rolesRes] = await Promise.all([
        hrmsApi.get<{success:boolean;data:any}>("/api/employees"),
        hrmsApi.get<{success:boolean;data:any}>("/api/access/roles/catalog"),
      ]);
      const profiles = empRes.data ?? [];
      const roles = rolesRes.data ?? [];
      const employees = profiles;

      // Map roles and status to users
      const usersWithRoles: UserWithRole[] = (profiles || []).map((profile: any) => {
        const userRole = roles?.find((r: any) => r.user_id === profile.id);
        const employee = employees?.find((e: any) => e.user_id === profile.id);
        return {
          ...profile,
          role: userRole?.role as AppRole | null,
          role_id: userRole?.id || null,
          employee_status: employee?.status as EmployeeStatus | null,
          blocked: profile.blocked ?? false,
          employee_id: employee?.id || null,
        };
      });

      return usersWithRoles;
    },
  });

  // Fetch unlinked employees (those without a user_id)
  const { data: unlinkedEmployees = [] } = useQuery({
    queryKey: ['unlinked-employees'],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      return (res.data ?? []) as UnlinkedEmployee[];
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role, existingRoleId }: { userId: string; role: AppRole; existingRoleId: string | null }) => {
      if (existingRoleId) {
        // Update existing role
        await hrmsApi.post(`/api/admin/users/${userId}/roles`, { roleKey: role });
      } else {
        // Insert new role
        await hrmsApi.post(`/api/admin/users/${userId}/roles`, { roleKey: role });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      queryClient.invalidateQueries({ queryKey: ['user-role'] });
      setDialogOpen(false);
      setSelectedUser(null);
      toast({ title: "Role updated", description: "User role has been updated successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleBlockMutation = useMutation({
    mutationFn: async ({ userId, block }: { userId: string; block: boolean }) => {
      if (block) {
        await hrmsApi.post('/api/account-control/lock', { userId });
      } else {
        await hrmsApi.post('/api/account-control/unlock', { userId });
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      setBlockDialogOpen(false);
      setSelectedUser(null);
      toast({ 
        title: variables.block ? "User blocked" : "User unblocked", 
        description: variables.block 
          ? "User has been blocked and can no longer login." 
          : "User has been unblocked and can now login."
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const linkEmployeeMutation = useMutation({
    mutationFn: async ({ employeeId, userId }: { employeeId: string; userId: string }) => {
      await hrmsApi.patch(`/api/employees/${employeeId}`, { user_id: userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      queryClient.invalidateQueries({ queryKey: ['unlinked-employees'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setLinkDialogOpen(false);
      setSelectedUser(null);
      setSelectedEmployeeId("");
      toast({ title: "Employee linked", description: "User has been linked to the employee record." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const unlinkEmployeeMutation = useMutation({
    mutationFn: async ({ employeeId }: { employeeId: string }) => {
      await hrmsApi.patch(`/api/employees/${employeeId}`, { user_id: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      queryClient.invalidateQueries({ queryKey: ['unlinked-employees'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setUnlinkDialogOpen(false);
      setSelectedUser(null);
      toast({ title: "Employee unlinked", description: "User has been unlinked from the employee record." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleEditRole = (user: UserWithRole) => {
    setSelectedUser(user);
    setSelectedRole(user.role || "employee");
    setDialogOpen(true);
  };

  const handleBlockClick = (user: UserWithRole) => {
    setSelectedUser(user);
    setBlockDialogOpen(true);
  };

  const handleLinkClick = (user: UserWithRole) => {
    setSelectedUser(user);
    // Pre-select employee with matching email if available
    const matchingEmployee = unlinkedEmployees.find(e => e.email.toLowerCase() === user.email.toLowerCase());
    setSelectedEmployeeId(matchingEmployee?.id || "");
    setLinkDialogOpen(true);
  };

  const handleUnlinkClick = (user: UserWithRole) => {
    setSelectedUser(user);
    setUnlinkDialogOpen(true);
  };

  const handleToggleBlock = () => {
    if (!selectedUser) return;
    toggleBlockMutation.mutate({
      userId: selectedUser.id,
      block: !selectedUser.blocked,
    });
  };

  const handleSaveRole = () => {
    if (!selectedUser) return;
    updateRoleMutation.mutate({
      userId: selectedUser.id,
      role: selectedRole,
      existingRoleId: selectedUser.role_id,
    });
  };

  const handleLinkEmployee = () => {
    if (!selectedUser || !selectedEmployeeId) return;
    linkEmployeeMutation.mutate({
      employeeId: selectedEmployeeId,
      userId: selectedUser.id,
    });
  };

  const handleUnlinkEmployee = () => {
    if (!selectedUser || !selectedUser.employee_id) return;
    unlinkEmployeeMutation.mutate({
      employeeId: selectedUser.employee_id,
    });
  };

  const getUserInitials = (name: string | null, email: string) => {
    const displayName = name || email;
    return displayName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  // Sort unlinked employees to show matching email first
  const sortedUnlinkedEmployees = selectedUser
    ? [...unlinkedEmployees].sort((a, b) => {
        const aMatches = a.email.toLowerCase() === selectedUser.email.toLowerCase();
        const bMatches = b.email.toLowerCase() === selectedUser.email.toLowerCase();
        if (aMatches && !bMatches) return -1;
        if (!aMatches && bMatches) return 1;
        return 0;
      })
    : unlinkedEmployees;

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Roles</CardTitle>
        <CardDescription>Manage user access levels and permissions</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">No users found.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user.avatar_url || undefined} />
                        <AvatarFallback>{getUserInitials(user.full_name, user.email)}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{user.full_name || "Unnamed User"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    {user.blocked ? (
                      <Badge variant="destructive">Blocked</Badge>
                    ) : user.employee_status ? (
                      <Badge variant={statusBadgeVariant[user.employee_status]}>
                        {statusLabels[user.employee_status]}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Not Linked</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.role ? (
                      <Badge variant={roleBadgeVariant[user.role]}>
                        {roleLabels[user.role]}
                      </Badge>
                    ) : (
                      <Badge variant="outline">No Role</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEditRole(user)} title="Edit role">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {/* Link/Unlink Employee Button */}
                      {user.employee_id ? (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleUnlinkClick(user)}
                          title="Unlink employee"
                        >
                          <Unlink className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleLinkClick(user)}
                          title="Link to employee"
                          disabled={unlinkedEmployees.length === 0}
                        >
                          <Link className="h-4 w-4" />
                        </Button>
                      )}
                      {user.id !== currentUser?.id && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleBlockClick(user)}
                          className={user.blocked ? "text-green-600 hover:text-green-700" : "text-destructive hover:text-destructive"}
                          title={user.blocked ? "Unblock user" : "Block user"}
                        >
                          {user.blocked ? <CheckCircle className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setSelectedUser(null);
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User Role</DialogTitle>
              <DialogDescription>
                Change the role for {selectedUser?.full_name || selectedUser?.email}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as AppRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">
                      <div className="flex flex-col">
                        <span>Administrator</span>
                        <span className="text-xs text-muted-foreground">Full system access</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="hr">
                      <div className="flex flex-col">
                        <span>HR Manager</span>
                        <span className="text-xs text-muted-foreground">Manage employees, leaves, payroll</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="manager">
                      <div className="flex flex-col">
                        <span>Manager</span>
                        <span className="text-xs text-muted-foreground">Manage team members</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="employee">
                      <div className="flex flex-col">
                        <span>Employee</span>
                        <span className="text-xs text-muted-foreground">Basic access</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveRole} disabled={updateRoleMutation.isPending}>
                {updateRoleMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={blockDialogOpen} onOpenChange={(open) => {
          setBlockDialogOpen(open);
          if (!open) setSelectedUser(null);
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {selectedUser?.blocked ? "Unblock User" : "Block User"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {selectedUser?.blocked 
                  ? `Are you sure you want to unblock ${selectedUser?.full_name || selectedUser?.email}? They will be able to login again.`
                  : `Are you sure you want to block ${selectedUser?.full_name || selectedUser?.email}? They will not be able to login until unblocked.`
                }
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleToggleBlock}
                className={selectedUser?.blocked ? "" : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
              >
                {toggleBlockMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {selectedUser?.blocked ? "Unblock" : "Block"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Link Employee Dialog */}
        <Dialog open={linkDialogOpen} onOpenChange={(open) => {
          setLinkDialogOpen(open);
          if (!open) {
            setSelectedUser(null);
            setSelectedEmployeeId("");
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Link Employee to User</DialogTitle>
              <DialogDescription>
                Link {selectedUser?.full_name || selectedUser?.email} to an existing employee record
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Select Employee</Label>
                {sortedUnlinkedEmployees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No unlinked employees available</p>
                ) : (
                  <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an employee..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedUnlinkedEmployees.map((emp) => {
                        const isMatch = selectedUser && emp.email.toLowerCase() === selectedUser.email.toLowerCase();
                        return (
                          <SelectItem key={emp.id} value={emp.id}>
                            <div className="flex items-center gap-2">
                              <span>{emp.first_name} {emp.last_name}</span>
                              <span className="text-xs text-muted-foreground">({emp.employee_code})</span>
                              {isMatch && (
                                <Badge variant="secondary" className="text-xs">Recommended</Badge>
                              )}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {selectedEmployeeId && (
                <div className="rounded-md border p-3 text-sm">
                  {(() => {
                    const emp = unlinkedEmployees.find(e => e.id === selectedEmployeeId);
                    if (!emp) return null;
                    return (
                      <div className="space-y-1">
                        <p><span className="text-muted-foreground">Name:</span> {emp.first_name} {emp.last_name}</p>
                        <p><span className="text-muted-foreground">Code:</span> {emp.employee_code}</p>
                        <p><span className="text-muted-foreground">Email:</span> {emp.email}</p>
                        <p><span className="text-muted-foreground">Designation:</span> {emp.designation}</p>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleLinkEmployee} disabled={!selectedEmployeeId || linkEmployeeMutation.isPending}>
                {linkEmployeeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Link Employee
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Unlink Employee Dialog */}
        <AlertDialog open={unlinkDialogOpen} onOpenChange={(open) => {
          setUnlinkDialogOpen(open);
          if (!open) setSelectedUser(null);
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Unlink Employee</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to unlink {selectedUser?.full_name || selectedUser?.email} from their employee record? 
                The employee record will remain but won't be associated with this user account.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleUnlinkEmployee}>
                {unlinkEmployeeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Unlink
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
