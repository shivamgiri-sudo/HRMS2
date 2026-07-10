import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, UserPlus, Search, CheckCircle2, XCircle, Info } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

interface PageCatalogEntry {
  page_code: string;
  page_name: string;
  page_path?: string;
  module?: string;
  description?: string;
  active_status: number;
}

interface RoleCatalogEntry {
  role_key: string;
  role_name: string;
  description?: string;
}

interface RolePagePermission {
  page_code: string;
  page_name: string;
  module?: string;
  permissions: {
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    can_export: boolean;
  };
}

type PermissionSet = { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean; can_export: boolean };

interface UserForAccess {
  id: string;
  email: string;
  employee_code: string | null;
  full_name: string | null;
}

interface UserPageAccess {
  user_id: string;
  page_code: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  assigned_by: string;
  assigned_at: Date;
  notes?: string;
}

interface PageAccessAssignment {
  user_id: string;
  user_email: string;
  page_code: string;
  page_name: string;
  module?: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  assigned_by_email: string;
  assigned_at: Date;
  notes?: string;
}

export default function SuperAdminAccessControl() {
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [permissions, setPermissions] = useState({
    can_view: true,
    can_create: false,
    can_edit: false,
    can_delete: false,
    can_export: false,
  });

  const [selectedRoleKey, setSelectedRoleKey] = useState<string>("");
  const [permissionDraft, setPermissionDraft] = useState<Record<string, PermissionSet>>({});
  const [dirtyPages, setDirtyPages] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();

  // Fetch all available pages
  const { data: pages = [] } = useQuery<PageCatalogEntry[]>({
    queryKey: ["page-catalog"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: PageCatalogEntry[] }>("/api/access/pages/catalog?include_disabled=true");
      return res.data ?? [];
    },
  });

  // Fetch all users
  const { data: users = [] } = useQuery<UserForAccess[]>({
    queryKey: ["users-for-access"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: UserForAccess[] }>("/api/access/users-for-access");
      return res.data ?? [];
    },
  });

  // Fetch user's current page assignments
  const { data: userPageAccess = [] } = useQuery<UserPageAccess[]>({
    queryKey: ["user-page-access", selectedUserId],
    queryFn: async () => {
      if (!selectedUserId) return [];
      const res = await hrmsApi.get<{ success: boolean; data: UserPageAccess[] }>(
        `/api/access/user-page-access/${selectedUserId}`
      );
      return res.data ?? [];
    },
    enabled: !!selectedUserId,
  });

  // Fetch all assignments (for overview tab)
  const { data: allAssignments = [] } = useQuery<PageAccessAssignment[]>({
    queryKey: ["user-page-access-all"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: PageAccessAssignment[] }>(
        "/api/access/user-page-access-all"
      );
      return res.data ?? [];
    },
  });

  // Assign page access mutation
  const assignAccess = useMutation({
    mutationFn: async (data: {
      user_id: string;
      page_code: string;
      permissions: typeof permissions;
      notes?: string;
    }) => {
      return hrmsApi.post("/api/access/user-page-access/assign", data);
    },
    onSuccess: () => {
      toast.success("Page access assigned successfully");
      queryClient.invalidateQueries({ queryKey: ["user-page-access"] });
      queryClient.invalidateQueries({ queryKey: ["user-page-access-all"] });
    },
    onError: () => {
      toast.error("Failed to assign page access");
    },
  });

  // Bulk assign mutation
  const bulkAssign = useMutation({
    mutationFn: async (data: {
      user_id: string;
      assignments: Array<{ page_code: string; permissions: typeof permissions }>;
      notes?: string;
    }) => {
      return hrmsApi.post("/api/access/user-page-access/bulk-assign", data);
    },
    onSuccess: (_, variables) => {
      toast.success(`${variables.assignments.length} page(s) assigned successfully`);
      queryClient.invalidateQueries({ queryKey: ["user-page-access"] });
      queryClient.invalidateQueries({ queryKey: ["user-page-access-all"] });
      setSelectedPages(new Set());
      setNotes("");
    },
    onError: () => {
      toast.error("Failed to bulk assign pages");
    },
  });

  // Revoke access mutation
  const revokeAccess = useMutation({
    mutationFn: async (data: { user_id: string; page_code: string; notes?: string }) => {
      return hrmsApi.post("/api/access/user-page-access/revoke", data);
    },
    onSuccess: () => {
      toast.success("Page access revoked successfully");
      queryClient.invalidateQueries({ queryKey: ["user-page-access"] });
      queryClient.invalidateQueries({ queryKey: ["user-page-access-all"] });
    },
    onError: () => {
      toast.error("Failed to revoke page access");
    },
  });

  // Fetch role catalog
  const { data: roles = [] } = useQuery<RoleCatalogEntry[]>({
    queryKey: ["role-catalog"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: RoleCatalogEntry[] }>("/api/access/roles/catalog");
      return res.data ?? [];
    },
  });

  // Fetch permissions for selected role
  const { data: rolePermissions = [], isLoading: rolePermsLoading } = useQuery<RolePagePermission[]>({
    queryKey: ["role-page-permissions", selectedRoleKey],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: RolePagePermission[] }>(
        `/api/access/roles/${encodeURIComponent(selectedRoleKey)}/permissions`
      );
      return res.data ?? [];
    },
    enabled: !!selectedRoleKey,
  });

  // Sync draft when role permissions load
  useEffect(() => {
    if (!selectedRoleKey) return;
    const draft: Record<string, PermissionSet> = {};
    for (const rp of rolePermissions) {
      draft[rp.page_code] = { ...rp.permissions };
    }
    setPermissionDraft(draft);
    setDirtyPages(new Set());
  }, [selectedRoleKey, rolePermissions]);

  const updateRolePermissions = useMutation({
    mutationFn: async (data: { role_key: string; updates: Array<{ page_code: string; permissions: PermissionSet }> }) => {
      return hrmsApi.put(`/api/access/roles/${encodeURIComponent(data.role_key)}/permissions`, { updates: data.updates });
    },
    onSuccess: () => {
      toast.success("Role permissions saved");
      queryClient.invalidateQueries({ queryKey: ["role-page-permissions", selectedRoleKey] });
      setDirtyPages(new Set());
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to save role permissions");
    },
  });

  const removeRolePageAccess = useMutation({
    mutationFn: async (data: { role_key: string; page_code: string }) => {
      return hrmsApi.delete(`/api/access/role-page-access/${encodeURIComponent(data.role_key)}/${encodeURIComponent(data.page_code)}`);
    },
    onSuccess: (_, variables) => {
      toast.success("Page removed from role");
      queryClient.invalidateQueries({ queryKey: ["role-page-permissions", selectedRoleKey] });
      setPermissionDraft(prev => {
        const next = { ...prev };
        delete next[variables.page_code];
        return next;
      });
      setDirtyPages(prev => {
        const next = new Set(prev);
        next.delete(variables.page_code);
        return next;
      });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to remove page from role");
    },
  });

  const togglePageStatus = useMutation({
    mutationFn: async (data: { page_code: string; active_status: boolean }) => {
      return hrmsApi.patch(
        `/api/access/pages/catalog/${encodeURIComponent(data.page_code)}/status`,
        { active_status: data.active_status }
      );
    },
    onSuccess: (_, variables) => {
      toast.success(variables.active_status ? "Page enabled" : "Page disabled");
      queryClient.invalidateQueries({ queryKey: ["page-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["user-page-access-all"] });
      queryClient.invalidateQueries({ queryKey: ["user-role-workforce-os"] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || "Failed to update page status");
    },
  });

  const handlePermissionToggle = (pageCode: string, field: keyof PermissionSet, value: boolean) => {
    setPermissionDraft(prev => ({
      ...prev,
      [pageCode]: { ...(prev[pageCode] ?? { can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false }), [field]: value },
    }));
    setDirtyPages(prev => new Set(prev).add(pageCode));
  };

  const handleSaveRolePermissions = () => {
    if (!selectedRoleKey || dirtyPages.size === 0) return;
    const updates = Array.from(dirtyPages).map(page_code => ({
      page_code,
      permissions: permissionDraft[page_code] ?? { can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false },
    }));
    updateRolePermissions.mutate({ role_key: selectedRoleKey, updates });
  };

  const handleBulkAssign = () => {
    if (!selectedUserId) {
      toast.error("Please select a user");
      return;
    }
    if (selectedPages.size === 0) {
      toast.error("Please select at least one page");
      return;
    }

    const assignments = Array.from(selectedPages).map(page_code => ({
      page_code,
      permissions,
    }));

    bulkAssign.mutate({
      user_id: selectedUserId,
      assignments,
      notes: notes || undefined,
    });
  };

  const handleRevoke = (pageCode: string) => {
    if (!selectedUserId) return;
    revokeAccess.mutate({
      user_id: selectedUserId,
      page_code: pageCode,
    });
  };

  const togglePageSelection = (pageCode: string) => {
    setSelectedPages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(pageCode)) {
        newSet.delete(pageCode);
      } else {
        newSet.add(pageCode);
      }
      return newSet;
    });
  };

  // Filter pages based on search and module
  const filteredPages = pages.filter(page =>
    page.page_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    page.page_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (page.module?.toLowerCase() || "").includes(searchQuery.toLowerCase())
  );

  // Group pages by module
  const pagesByModule = filteredPages.reduce((acc, page) => {
    const module = page.module || "Other";
    if (!acc[module]) acc[module] = [];
    acc[module].push(page);
    return acc;
  }, {} as Record<string, PageCatalogEntry[]>);

  const userEmail = users.find(u => u.id === selectedUserId)?.email || "";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-blue-100 p-3">
                <Shield className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-2xl">Super Admin Access Control</CardTitle>
                <CardDescription>
                  Assign pages to users and globally hold pages until compliance approves release.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Tabs defaultValue="assign" className="space-y-4">
          <TabsList>
            <TabsTrigger value="assign">Assign Access</TabsTrigger>
            <TabsTrigger value="overview">All Assignments</TabsTrigger>
            <TabsTrigger value="global">Global Page Control</TabsTrigger>
            <TabsTrigger value="role-access">Role Access</TabsTrigger>
          </TabsList>

          <TabsContent value="assign" className="space-y-6">
            {/* User Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">1. Select User</CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select user..." />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map(user => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.full_name?.trim()
                          ? `${user.full_name}${user.employee_code ? ` (${user.employee_code})` : ""} — ${user.email}`
                          : user.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {selectedUserId && (
              <>
                {/* Current Assignments */}
                {userPageAccess.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Current Page Assignments for {userEmail}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table className="smarthr-table">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Page</TableHead>
                            <TableHead>View</TableHead>
                            <TableHead>Create</TableHead>
                            <TableHead>Edit</TableHead>
                            <TableHead>Delete</TableHead>
                            <TableHead>Export</TableHead>
                            <TableHead>Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {userPageAccess.map(access => {
                            const page = pages.find(p => p.page_code === access.page_code);
                            return (
                              <TableRow key={access.page_code} className="hover:bg-gray-50 transition-colors">
                                <TableCell>
                                  <div>
                                    <p className="font-medium">{page?.page_name || access.page_code}</p>
                                    <p className="text-xs text-muted-foreground">{access.page_code}</p>
                                    {page?.active_status === 0 && (
                                      <Badge variant="destructive" className="mt-1 text-xs">Globally disabled</Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {access.can_view ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-gray-300" />}
                                </TableCell>
                                <TableCell>
                                  {access.can_create ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-gray-300" />}
                                </TableCell>
                                <TableCell>
                                  {access.can_edit ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-gray-300" />}
                                </TableCell>
                                <TableCell>
                                  {access.can_delete ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-gray-300" />}
                                </TableCell>
                                <TableCell>
                                  {access.can_export ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-gray-300" />}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRevoke(access.page_code)}
                                    disabled={revokeAccess.isPending}
                                  >
                                    Revoke
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                {/* Page Selection */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">2. Select Pages to Assign</CardTitle>
                    <div className="flex gap-2 mt-4">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search pages..."
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {Object.entries(pagesByModule).map(([module, modulePages]) => (
                      <div key={module} className="space-y-2">
                        <h3 className="font-semibold text-sm text-muted-foreground">{module}</h3>
                        <div className="grid gap-2">
                          {modulePages.map(page => (
                            <div
                              key={page.page_code}
                              className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                              onClick={() => togglePageSelection(page.page_code)}
                            >
                              <Checkbox
                                checked={selectedPages.has(page.page_code)}
                                onCheckedChange={() => togglePageSelection(page.page_code)}
                              />
                              <div className="flex-1">
                                <p className="font-medium">{page.page_name}</p>
                                <p className="text-xs text-muted-foreground">{page.page_code}</p>
                                {page.active_status === 0 && (
                                  <Badge variant="destructive" className="mt-1 text-xs">Globally disabled</Badge>
                                )}
                                {page.description && (
                                  <p className="text-xs text-muted-foreground mt-1">{page.description}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Permissions Configuration */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">3. Set Permissions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={permissions.can_view}
                        onCheckedChange={(checked) => setPermissions(prev => ({ ...prev, can_view: checked as boolean }))}
                      />
                      <label className="text-sm font-medium">View</label>
                    </div>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={permissions.can_create}
                        onCheckedChange={(checked) => setPermissions(prev => ({ ...prev, can_create: checked as boolean }))}
                      />
                      <label className="text-sm font-medium">Create</label>
                    </div>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={permissions.can_edit}
                        onCheckedChange={(checked) => setPermissions(prev => ({ ...prev, can_edit: checked as boolean }))}
                      />
                      <label className="text-sm font-medium">Edit</label>
                    </div>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={permissions.can_delete}
                        onCheckedChange={(checked) => setPermissions(prev => ({ ...prev, can_delete: checked as boolean }))}
                      />
                      <label className="text-sm font-medium">Delete</label>
                    </div>
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={permissions.can_export}
                        onCheckedChange={(checked) => setPermissions(prev => ({ ...prev, can_export: checked as boolean }))}
                      />
                      <label className="text-sm font-medium">Export</label>
                    </div>

                    <div className="pt-3">
                      <label className="text-sm font-medium block mb-2">Notes (optional)</label>
                      <Textarea
                        placeholder="Reason for assignment..."
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        rows={3}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Action */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg mb-4">
                      <Info className="h-5 w-5 text-blue-600 flex-shrink-0" />
                      <p className="text-sm text-blue-900">
                        Selected pages will be immediately accessible to {userEmail} with the specified permissions.
                        User assignments override role-based access.
                      </p>
                    </div>
                    <Button
                      onClick={handleBulkAssign}
                      disabled={selectedPages.size === 0 || bulkAssign.isPending}
                      className="w-full"
                      size="lg"
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      Assign {selectedPages.size} Page(s) to {userEmail}
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="overview">
            <Card>
              <CardHeader>
                <CardTitle>All User Page Assignments</CardTitle>
                <CardDescription>
                  Complete list of user-specific page access assignments
                </CardDescription>
              </CardHeader>
              <CardContent>
                {allAssignments.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No user page assignments yet
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Page</TableHead>
                        <TableHead>Module</TableHead>
                        <TableHead>Permissions</TableHead>
                        <TableHead>Assigned By</TableHead>
                        <TableHead>Assigned At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allAssignments.map((assignment, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{assignment.user_email}</TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{assignment.page_name}</p>
                              <p className="text-xs text-muted-foreground">{assignment.page_code}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{assignment.module || "Other"}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {assignment.can_view && <Badge variant="secondary" className="text-xs">View</Badge>}
                              {assignment.can_create && <Badge variant="secondary" className="text-xs">Create</Badge>}
                              {assignment.can_edit && <Badge variant="secondary" className="text-xs">Edit</Badge>}
                              {assignment.can_delete && <Badge variant="secondary" className="text-xs">Delete</Badge>}
                              {assignment.can_export && <Badge variant="secondary" className="text-xs">Export</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{assignment.assigned_by_email}</TableCell>
                          <TableCell className="text-sm">
                            {formatISTDate(assignment.assigned_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="global">
            <Card>
              <CardHeader>
                <CardTitle>Global Page Control</CardTitle>
                <CardDescription>
                  Disabled pages are blocked for every user until re-enabled, regardless of role or direct assignment.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search pages..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Page</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Global Availability</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPages.map(page => {
                      const enabled = page.active_status !== 0;
                      const locked = page.page_code === "ACCESS_CONTROL";
                      return (
                        <TableRow key={page.page_code}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{page.page_name}</p>
                              <p className="text-xs text-muted-foreground">{page.page_code}</p>
                              {page.page_path && (
                                <p className="text-xs text-muted-foreground">{page.page_path}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{page.module || "Other"}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={enabled ? "secondary" : "destructive"}>
                              {enabled ? "Enabled" : "Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex items-center gap-3">
                              <span className="text-sm text-muted-foreground">{enabled ? "Available" : "Held"}</span>
                              <Switch
                                checked={enabled}
                                disabled={togglePageStatus.isPending || locked}
                                onCheckedChange={(checked) => togglePageStatus.mutate({
                                  page_code: page.page_code,
                                  active_status: Boolean(checked),
                                })}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="role-access" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Role-wise Page Access</CardTitle>
                <CardDescription>
                  Configure which pages each role can access and what permissions they have. Changes apply to all users with that role.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Role selector */}
                <div className="flex items-center gap-3">
                  <Select
                    value={selectedRoleKey}
                    onValueChange={(v) => {
                      setSelectedRoleKey(v);
                      setPermissionDraft({});
                      setDirtyPages(new Set());
                    }}
                  >
                    <SelectTrigger className="w-72">
                      <SelectValue placeholder="Select a role..." />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map(role => (
                        <SelectItem key={role.role_key} value={role.role_key}>
                          {role.role_name} <span className="text-xs text-muted-foreground ml-1">({role.role_key})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedRoleKey && dirtyPages.size > 0 && (
                    <Button
                      onClick={handleSaveRolePermissions}
                      disabled={updateRolePermissions.isPending}
                    >
                      Save {dirtyPages.size} change{dirtyPages.size !== 1 ? "s" : ""}
                    </Button>
                  )}
                </div>

                {selectedRoleKey && (
                  rolePermsLoading ? (
                    <p className="text-sm text-muted-foreground py-4">Loading permissions...</p>
                  ) : (
                    <>
                      {/* Group pages by module — merge catalog (all pages) with current grants */}
                      {(() => {
                        const grantedCodes = new Set(rolePermissions.map(r => r.page_code));
                        // Build unified rows: granted pages first, then catalog pages not yet granted
                        const allRows: Array<{ page_code: string; page_name: string; module: string; granted: boolean }> = [
                          ...rolePermissions.map(r => ({ page_code: r.page_code, page_name: r.page_name, module: r.module || "Other", granted: true })),
                          ...pages
                            .filter(p => !grantedCodes.has(p.page_code))
                            .map(p => ({ page_code: p.page_code, page_name: p.page_name, module: p.module || "Other", granted: false })),
                        ];
                        const byModule = allRows.reduce((acc, row) => {
                          if (!acc[row.module]) acc[row.module] = [];
                          acc[row.module].push(row);
                          return acc;
                        }, {} as Record<string, typeof allRows>);

                        return Object.entries(byModule).map(([mod, modRows]) => (
                          <div key={mod} className="space-y-2">
                            <h3 className="font-semibold text-sm text-muted-foreground border-b pb-1">{mod}</h3>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-64">Page</TableHead>
                                  <TableHead className="text-center w-16">View</TableHead>
                                  <TableHead className="text-center w-16">Create</TableHead>
                                  <TableHead className="text-center w-16">Edit</TableHead>
                                  <TableHead className="text-center w-16">Delete</TableHead>
                                  <TableHead className="text-center w-16">Export</TableHead>
                                  <TableHead className="w-20">Action</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {modRows.map(row => {
                                  const draft = permissionDraft[row.page_code];
                                  const isDirty = dirtyPages.has(row.page_code);
                                  return (
                                    <TableRow key={row.page_code} className={isDirty ? "bg-amber-50" : row.granted ? "" : "opacity-60"}>
                                      <TableCell>
                                        <div>
                                          <p className="font-medium text-sm">{row.page_name}</p>
                                          <p className="text-xs text-muted-foreground">{row.page_code}</p>
                                        </div>
                                      </TableCell>
                                      {(["can_view", "can_create", "can_edit", "can_delete", "can_export"] as (keyof PermissionSet)[]).map(field => (
                                        <TableCell key={field} className="text-center">
                                          <Checkbox
                                            checked={draft?.[field] ?? false}
                                            onCheckedChange={(checked) => handlePermissionToggle(row.page_code, field, Boolean(checked))}
                                          />
                                        </TableCell>
                                      ))}
                                      <TableCell>
                                        {row.granted && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => removeRolePageAccess.mutate({ role_key: selectedRoleKey, page_code: row.page_code })}
                                            disabled={removeRolePageAccess.isPending}
                                          >
                                            Remove
                                          </Button>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        ));
                      })()}
                    </>
                  )
                )}

                {!selectedRoleKey && (
                  <p className="text-sm text-muted-foreground text-center py-8">Select a role above to view and edit its page permissions.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
