import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, UserPlus, Search, CheckCircle2, XCircle, Info } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
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

interface PageCatalogEntry {
  page_code: string;
  page_name: string;
  page_path?: string;
  module?: string;
  description?: string;
}

interface UserForAccess {
  id: string;
  email: string;
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

  const queryClient = useQueryClient();

  // Fetch all available pages
  const { data: pages = [] } = useQuery<PageCatalogEntry[]>({
    queryKey: ["page-catalog"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: PageCatalogEntry[] }>("/api/access/pages/catalog");
      return res.data.data ?? [];
    },
  });

  // Fetch all users
  const { data: users = [] } = useQuery<UserForAccess[]>({
    queryKey: ["users-for-access"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: UserForAccess[] }>("/api/access/users-for-access");
      return res.data.data ?? [];
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
      return res.data.data ?? [];
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
      return res.data.data ?? [];
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
                  Assign specific pages to individual users. User assignments override role-based access.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Tabs defaultValue="assign" className="space-y-4">
          <TabsList>
            <TabsTrigger value="assign">Assign Access</TabsTrigger>
            <TabsTrigger value="overview">All Assignments</TabsTrigger>
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
                        {user.email}
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
                      <Table>
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
                              <TableRow key={access.page_code}>
                                <TableCell>
                                  <div>
                                    <p className="font-medium">{page?.page_name || access.page_code}</p>
                                    <p className="text-xs text-muted-foreground">{access.page_code}</p>
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
                            {new Date(assignment.assigned_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
