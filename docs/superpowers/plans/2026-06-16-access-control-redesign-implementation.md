# Access Control Page Redesign - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 905-line, 6-tab access control page with a streamlined 3-tab workflow hub featuring quick actions, visual permission indicators, and lazy loading.

**Architecture:** Build new page at `/settings/access-control-v2` initially, then replace original. Three-tab structure (Users & Roles, Permissions, Administration) with shared components. React Query for caching, lazy loading per tab, progressive disclosure patterns.

**Tech Stack:** React + TypeScript, TanStack React Query, shadcn/ui components, Lucide icons, Zod validation

---

## File Structure

### New Files to Create
```
src/pages/
  UnifiedAccessControlV2.tsx                    # Main page component

src/components/access-control/
  tabs/
    UsersRolesTab.tsx                           # Tab 1: User & role management
    PermissionsTab.tsx                          # Tab 2: Permission matrix
    AdministrationTab.tsx                       # Tab 3: Requests & sync
  
  user-management/
    UserSearchPanel.tsx                         # Left column: search & list
    UserRoleCard.tsx                            # Individual user card
    AssignRoleModal.tsx                         # Modal for assigning roles
  
  role-management/
    RoleCardGrid.tsx                            # Right column: role cards
    RoleSummaryCard.tsx                         # Individual role card
  
  permissions/
    PermissionModuleGroup.tsx                   # Collapsible module section
    PermissionPageRow.tsx                       # Individual page row
    AccessLevelBadge.tsx                        # Visual permission indicator
  
  administration/
    AccessRequestCard.tsx                       # Individual request card
    RBACStatusPanel.tsx                         # Sync status display
    ActivityFeedItem.tsx                        # Activity log entry
  
  shared/
    QuickActionCard.tsx                         # Reusable action card

src/hooks/
  useAccessControl.ts                           # API calls + React Query hooks
  usePermissionGroups.ts                        # Group pages by module
  useAccessLevelBadge.ts                        # Determine access level

src/types/
  access-control.ts                             # Shared TypeScript types
```

### Files to Modify
```
src/App.tsx                                     # Add route for v2 page
```

---

## Task 1: Setup Types and API Hook

**Files:**
- Create: `src/types/access-control.ts`
- Create: `src/hooks/useAccessControl.ts`

- [ ] **Step 1: Create shared types**

```typescript
// src/types/access-control.ts
export type AccessLevel = 
  | 'no-access'
  | 'view-only'
  | 'editor'
  | 'creator'
  | 'full-access';

export interface UserWithRoles {
  id: string;
  email: string;
  full_name: string;
  employee_code?: string;
  avatar_url?: string;
}

export interface RoleInfo {
  role_key: string;
  role_name: string;
  role_description?: string;
}

export interface UserRole {
  user_id: string;
  role_key: string;
  role_name: string;
}

export interface RoleSummary {
  role_key: string;
  role_name: string;
  user_count: number;
  page_count: number;
  modules: ModuleAccessSummary[];
}

export interface ModuleAccessSummary {
  module_name: string;
  page_count: number;
  access_level: AccessLevel;
}

export interface PermissionSet {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

export interface PagePermission {
  page_code: string;
  page_name: string;
  module: string | null;
  permissions: PermissionSet;
}

export interface GroupedPermissions {
  module: string;
  pages: PagePermission[];
  summary: AccessLevel;
}

export interface AccessRequest {
  id: string;
  user_id: string;
  user_email: string | null;
  page_code: string;
  page_name: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
}

export interface RBACStatus {
  synced: boolean;
  last_sync: string;
  conflicts_count: number;
}

export interface ActivityItem {
  id: string;
  action: string;
  user_email: string | null;
  description: string;
  created_at: string;
}
```

- [ ] **Step 2: Create API hook with React Query**

```typescript
// src/hooks/useAccessControl.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type {
  UserWithRoles,
  UserRole,
  RoleInfo,
  RoleSummary,
  PagePermission,
  AccessRequest,
  RBACStatus,
  ActivityItem,
  PermissionSet,
} from "@/types/access-control";

// ──────────────────────────────────────────────────────────────
// Role Catalog (cached 1 hour)
// ──────────────────────────────────────────────────────────────

export function useRoleCatalog() {
  return useQuery<RoleInfo[]>({
    queryKey: ["role-catalog"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: RoleInfo[] }>("/api/access/roles/catalog");
      return res.data || [];
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

// ──────────────────────────────────────────────────────────────
// User Search (debounced)
// ──────────────────────────────────────────────────────────────

export function useUserSearch(searchQuery: string, enabled: boolean = true) {
  return useQuery<UserWithRoles[]>({
    queryKey: ["user-search", searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      const res = await hrmsApi.get<{ data: UserWithRoles[] }>(
        `/api/access/users?search=${encodeURIComponent(searchQuery)}&limit=20`
      );
      return res.data || [];
    },
    enabled: enabled && searchQuery.length > 0,
    staleTime: 5 * 60 * 1000, // 5 mins
  });
}

// ──────────────────────────────────────────────────────────────
// User Roles
// ──────────────────────────────────────────────────────────────

export function useUserRoles(userId: string | null) {
  return useQuery<UserRole[]>({
    queryKey: ["user-roles", userId],
    queryFn: async () => {
      if (!userId) return [];
      const res = await hrmsApi.get<{ data: UserRole[] }>(
        `/api/access/users/${encodeURIComponent(userId)}/roles`
      );
      return res.data || [];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAssignRole() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: { userId: string; roleKey: string }) => {
      await hrmsApi.post(`/api/access/users/${params.userId}/roles`, {
        role_key: params.roleKey,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["user-roles", variables.userId] });
      queryClient.invalidateQueries({ queryKey: ["role-summary"] });
      queryClient.invalidateQueries({ queryKey: ["rbac-status"] });
    },
  });
}

export function useRevokeRole() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: { userId: string; roleKey: string }) => {
      await hrmsApi.delete(`/api/access/users/${params.userId}/roles/${params.roleKey}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["user-roles", variables.userId] });
      queryClient.invalidateQueries({ queryKey: ["role-summary"] });
      queryClient.invalidateQueries({ queryKey: ["rbac-status"] });
    },
  });
}

// ──────────────────────────────────────────────────────────────
// Role Summary
// ──────────────────────────────────────────────────────────────

export function useRoleSummary(roleKey: string | null) {
  return useQuery<RoleSummary>({
    queryKey: ["role-summary", roleKey],
    queryFn: async () => {
      if (!roleKey) throw new Error("Role key required");
      const res = await hrmsApi.get<{ data: RoleSummary }>(
        `/api/access/roles/${encodeURIComponent(roleKey)}/summary`
      );
      return res.data;
    },
    enabled: !!roleKey,
    staleTime: 5 * 60 * 1000,
  });
}

// ──────────────────────────────────────────────────────────────
// Permissions
// ──────────────────────────────────────────────────────────────

export function useRolePermissions(roleKey: string | null) {
  return useQuery<PagePermission[]>({
    queryKey: ["role-permissions", roleKey],
    queryFn: async () => {
      if (!roleKey) return [];
      const res = await hrmsApi.get<{ data: PagePermission[] }>(
        `/api/access/roles/${encodeURIComponent(roleKey)}/permissions`
      );
      return res.data || [];
    },
    enabled: !!roleKey,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdatePermissions() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: { 
      roleKey: string; 
      pageCode: string; 
      permissions: PermissionSet;
    }) => {
      await hrmsApi.put(`/api/access/roles/${params.roleKey}/permissions`, {
        updates: [{ page_code: params.pageCode, permissions: params.permissions }],
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["role-permissions", variables.roleKey] });
      queryClient.invalidateQueries({ queryKey: ["role-summary", variables.roleKey] });
    },
  });
}

// ──────────────────────────────────────────────────────────────
// Access Requests
// ──────────────────────────────────────────────────────────────

export function usePendingRequests() {
  return useQuery<AccessRequest[]>({
    queryKey: ["pending-requests"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: AccessRequest[] }>(
        "/api/access/requests?status=pending&limit=50"
      );
      return res.data || [];
    },
    staleTime: 1 * 60 * 1000, // 1 min
  });
}

export function useApproveRequest() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (requestId: string) => {
      await hrmsApi.post(`/api/access/requests/${requestId}/approve`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-requests"] });
      queryClient.invalidateQueries({ queryKey: ["activity-feed"] });
    },
  });
}

export function useDenyRequest() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: { requestId: string; reason: string }) => {
      await hrmsApi.post(`/api/access/requests/${params.requestId}/deny`, {
        review_note: params.reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-requests"] });
      queryClient.invalidateQueries({ queryKey: ["activity-feed"] });
    },
  });
}

// ──────────────────────────────────────────────────────────────
// RBAC Status
// ──────────────────────────────────────────────────────────────

export function useRBACStatus() {
  return useQuery<RBACStatus>({
    queryKey: ["rbac-status"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: RBACStatus }>("/api/access/rbac/status");
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // 5 mins
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 mins
  });
}

export function useSyncRBAC() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      await hrmsApi.post("/api/access/rbac/sync", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rbac-status"] });
    },
  });
}

// ──────────────────────────────────────────────────────────────
// Activity Feed
// ──────────────────────────────────────────────────────────────

export function useActivityFeed(limit: number = 10) {
  return useQuery<ActivityItem[]>({
    queryKey: ["activity-feed", limit],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: ActivityItem[] }>(
        `/api/access/activity?limit=${limit}&offset=0`
      );
      return res.data || [];
    },
    staleTime: 2 * 60 * 1000, // 2 mins
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/access-control.ts src/hooks/useAccessControl.ts
git commit -m "feat(access-control): add types and API hooks

- Define AccessLevel, RoleSummary, PagePermission types
- Create useAccessControl hook with React Query
- Add hooks for user search, roles, permissions
- Include hooks for requests, RBAC, activity feed

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Build Shared Components

**Files:**
- Create: `src/components/access-control/shared/QuickActionCard.tsx`
- Create: `src/hooks/useAccessLevelBadge.ts`
- Create: `src/components/access-control/permissions/AccessLevelBadge.tsx`

- [ ] **Step 1: Create QuickActionCard component**

```typescript
// src/components/access-control/shared/QuickActionCard.tsx
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

interface QuickActionCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
  badge?: number;
}

export function QuickActionCard({
  icon: Icon,
  title,
  description,
  buttonLabel,
  onClick,
  badge,
}: QuickActionCardProps) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Icon className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-base">{title}</h3>
              {badge !== undefined && badge > 0 && (
                <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-red-500 text-white text-xs font-semibold">
                  {badge}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {description}
            </p>
            <Button onClick={onClick} size="sm">
              {buttonLabel}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create useAccessLevelBadge hook**

```typescript
// src/hooks/useAccessLevelBadge.ts
import type { PermissionSet, AccessLevel } from "@/types/access-control";

export function useAccessLevelBadge(permissions: PermissionSet): AccessLevel {
  const { can_view, can_create, can_edit, can_delete, can_export } = permissions;

  // No permissions
  if (!can_view && !can_create && !can_edit && !can_delete && !can_export) {
    return 'no-access';
  }

  // All permissions
  if (can_view && can_create && can_edit && can_delete && can_export) {
    return 'full-access';
  }

  // View + Create + Edit (but not delete/export)
  if (can_view && can_create && can_edit) {
    return 'creator';
  }

  // View + Edit (but not create)
  if (can_view && can_edit && !can_create) {
    return 'editor';
  }

  // Only view
  if (can_view && !can_create && !can_edit && !can_delete) {
    return 'view-only';
  }

  // Mixed permissions that don't fit a pattern
  return 'editor'; // Default to editor for partial permissions
}
```

- [ ] **Step 3: Create AccessLevelBadge component**

```typescript
// src/components/access-control/permissions/AccessLevelBadge.tsx
import { Eye, Edit, Plus, Trash2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AccessLevel } from "@/types/access-control";

interface AccessLevelBadgeProps {
  level: AccessLevel;
  className?: string;
}

const ACCESS_LEVEL_CONFIG = {
  'no-access': {
    label: 'No Access',
    icon: Lock,
    className: 'bg-slate-100 text-slate-600 hover:bg-slate-100',
  },
  'view-only': {
    label: 'View Only',
    icon: Eye,
    className: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  },
  'editor': {
    label: 'Editor',
    icon: Edit,
    className: 'bg-green-100 text-green-700 hover:bg-green-100',
  },
  'creator': {
    label: 'Creator',
    icon: Plus,
    className: 'bg-purple-100 text-purple-700 hover:bg-purple-100',
  },
  'full-access': {
    label: 'Full Access',
    icon: Trash2,
    className: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-100',
  },
};

export function AccessLevelBadge({ level, className }: AccessLevelBadgeProps) {
  const config = ACCESS_LEVEL_CONFIG[level];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`${config.className} ${className || ''}`}>
      <Icon className="h-3 w-3 mr-1" />
      {config.label}
    </Badge>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/access-control/shared/QuickActionCard.tsx \
        src/hooks/useAccessLevelBadge.ts \
        src/components/access-control/permissions/AccessLevelBadge.tsx
git commit -m "feat(access-control): add shared components

- Add QuickActionCard for quick actions
- Add useAccessLevelBadge hook to determine access level
- Add AccessLevelBadge component with visual indicators

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Build User Management Components

**Files:**
- Create: `src/components/access-control/user-management/UserRoleCard.tsx`
- Create: `src/components/access-control/user-management/UserSearchPanel.tsx`
- Create: `src/components/access-control/user-management/AssignRoleModal.tsx`

- [ ] **Step 1: Create UserRoleCard component**

```typescript
// src/components/access-control/user-management/UserRoleCard.tsx
import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useUserRoles, useRevokeRole } from "@/hooks/useAccessControl";
import { toast } from "sonner";
import type { UserWithRoles } from "@/types/access-control";

interface UserRoleCardProps {
  user: UserWithRoles;
  onAssignRole: (userId: string) => void;
}

export function UserRoleCard({ user, onAssignRole }: UserRoleCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: roles = [], isLoading } = useUserRoles(expanded ? user.id : null);
  const revokeRole = useRevokeRole();

  const initials = user.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  const handleRevokeRole = async (roleKey: string, roleName: string) => {
    try {
      await revokeRole.mutateAsync({ userId: user.id, roleKey });
      toast.success(`Revoked ${roleName} role from ${user.full_name}`);
    } catch (error) {
      toast.error("Failed to revoke role");
    }
  };

  return (
    <Card className="mb-2">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <Avatar className="h-10 w-10">
              <AvatarImage src={user.avatar_url} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{user.full_name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              {user.employee_code && (
                <p className="text-xs text-muted-foreground">{user.employee_code}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAssignRole(user.id)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Role
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading roles...</p>
            ) : roles.length === 0 ? (
              <p className="text-sm text-amber-600">
                ⚠️ No roles assigned. This user cannot access any pages.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase">
                  Assigned Roles
                </p>
                {roles.map((role) => (
                  <div
                    key={role.role_key}
                    className="flex items-center justify-between p-2 bg-slate-50 rounded"
                  >
                    <Badge variant="outline">{role.role_name}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevokeRole(role.role_key, role.role_name)}
                      disabled={revokeRole.isPending}
                    >
                      <X className="h-3 w-3 text-red-600" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create UserSearchPanel component**

```typescript
// src/components/access-control/user-management/UserSearchPanel.tsx
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { UserRoleCard } from "./UserRoleCard";
import { useDebounce } from "@/hooks/useDebounce";
import { useUserSearch } from "@/hooks/useAccessControl";

interface UserSearchPanelProps {
  onAssignRole: (userId: string) => void;
}

export function UserSearchPanel({ onAssignRole }: UserSearchPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);
  
  const { data: users = [], isLoading } = useUserSearch(
    debouncedSearch,
    debouncedSearch.length > 0
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {searchQuery.trim() === "" ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          Start typing to search for users
        </div>
      ) : isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          Searching...
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground mb-2">
            No users found matching "{searchQuery}"
          </p>
          <p className="text-xs text-muted-foreground">
            Try different keywords or check spelling
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Found {users.length} user{users.length !== 1 ? "s" : ""}
          </p>
          {users.map((user) => (
            <UserRoleCard
              key={user.id}
              user={user}
              onAssignRole={onAssignRole}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create AssignRoleModal component**

```typescript
// src/components/access-control/user-management/AssignRoleModal.tsx
import { useState, useEffect } from "react";
import { UserPlus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useRoleCatalog, useAssignRole, useRoleSummary } from "@/hooks/useAccessControl";
import { toast } from "sonner";

interface AssignRoleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  userName?: string;
}

export function AssignRoleModal({
  open,
  onOpenChange,
  userId,
  userName,
}: AssignRoleModalProps) {
  const [selectedRole, setSelectedRole] = useState<string>("");
  
  const { data: roles = [] } = useRoleCatalog();
  const { data: roleSummary } = useRoleSummary(selectedRole || null);
  const assignRole = useAssignRole();

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSelectedRole("");
    }
  }, [open]);

  const handleAssign = async () => {
    if (!userId || !selectedRole) return;

    try {
      await assignRole.mutateAsync({ userId, roleKey: selectedRole });
      toast.success(`Role assigned successfully`);
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to assign role");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Assign Role to User</DialogTitle>
          <DialogDescription>
            {userName && `Assigning role to ${userName}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="role-select">Select Role</Label>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger id="role-select">
                <SelectValue placeholder="Choose a role..." />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.role_key} value={role.role_key}>
                    {role.role_name}
                    {role.role_description && (
                      <span className="text-xs text-muted-foreground ml-2">
                        - {role.role_description}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {roleSummary && (
            <Alert>
              <AlertDescription className="text-xs">
                <p className="font-semibold mb-2">This role grants access to:</p>
                <ul className="space-y-1">
                  <li>• {roleSummary.page_count} pages across {roleSummary.modules.length} modules</li>
                  {roleSummary.modules.slice(0, 3).map((mod) => (
                    <li key={mod.module_name}>
                      • {mod.module_name}: {mod.page_count} pages
                    </li>
                  ))}
                  {roleSummary.modules.length > 3 && (
                    <li>• ... and {roleSummary.modules.length - 3} more modules</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={assignRole.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={!selectedRole || assignRole.isPending}
          >
            {assignRole.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            <UserPlus className="mr-2 h-4 w-4" />
            Assign Role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/access-control/user-management/
git commit -m "feat(access-control): add user management components

- Add UserRoleCard with expand/collapse and role revoke
- Add UserSearchPanel with debounced search
- Add AssignRoleModal with role preview

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Build Role Management Components

**Files:**
- Create: `src/components/access-control/role-management/RoleSummaryCard.tsx`
- Create: `src/components/access-control/role-management/RoleCardGrid.tsx`

- [ ] **Step 1: Create RoleSummaryCard component**

```typescript
// src/components/access-control/role-management/RoleSummaryCard.tsx
import { useState } from "react";
import { Users, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRoleSummary } from "@/hooks/useAccessControl";
import { AccessLevelBadge } from "../permissions/AccessLevelBadge";
import type { RoleInfo } from "@/types/access-control";

interface RoleSummaryCardProps {
  role: RoleInfo;
}

export function RoleSummaryCard({ role }: RoleSummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: summary, isLoading } = useRoleSummary(expanded ? role.role_key : null);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>{role.role_name}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!expanded ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span className="text-xs">Loading...</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span className="text-xs">Loading...</span>
            </div>
          </div>
        ) : isLoading ? (
          <div className="text-sm text-muted-foreground">Loading details...</div>
        ) : summary ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold">{summary.user_count}</span>
              <span className="text-muted-foreground">
                user{summary.user_count !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold">{summary.page_count}</span>
              <span className="text-muted-foreground">
                page{summary.page_count !== 1 ? "s" : ""}
              </span>
            </div>

            {summary.modules.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                  Module Access
                </p>
                <div className="space-y-2">
                  {summary.modules.map((mod) => (
                    <div
                      key={mod.module_name}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-xs">{mod.module_name}</span>
                      <AccessLevelBadge level={mod.access_level} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.user_count === 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-amber-600">
                  ⚠️ No users assigned to this role
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-red-600">Failed to load details</div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create RoleCardGrid component**

```typescript
// src/components/access-control/role-management/RoleCardGrid.tsx
import { useRoleCatalog } from "@/hooks/useAccessControl";
import { RoleSummaryCard } from "./RoleSummaryCard";
import { Loader2 } from "lucide-react";

export function RoleCardGrid() {
  const { data: roles = [], isLoading } = useRoleCatalog();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (roles.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        No roles found
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {roles.map((role) => (
        <RoleSummaryCard key={role.role_key} role={role} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/access-control/role-management/
git commit -m "feat(access-control): add role management components

- Add RoleSummaryCard with expand/collapse
- Add RoleCardGrid with responsive grid layout
- Show user count, page count, module access

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Build Permission Components

**Files:**
- Create: `src/hooks/usePermissionGroups.ts`
- Create: `src/components/access-control/permissions/PermissionPageRow.tsx`
- Create: `src/components/access-control/permissions/PermissionModuleGroup.tsx`

- [ ] **Step 1: Create usePermissionGroups hook**

```typescript
// src/hooks/usePermissionGroups.ts
import { useMemo } from "react";
import type { PagePermission, GroupedPermissions } from "@/types/access-control";
import { useAccessLevelBadge } from "./useAccessLevelBadge";

export function usePermissionGroups(permissions: PagePermission[]): GroupedPermissions[] {
  return useMemo(() => {
    const grouped = new Map<string, PagePermission[]>();

    permissions.forEach((perm) => {
      const module = perm.module || "Uncategorized";
      if (!grouped.has(module)) {
        grouped.set(module, []);
      }
      grouped.get(module)!.push(perm);
    });

    const result: GroupedPermissions[] = [];
    grouped.forEach((pages, module) => {
      // Determine overall access level for module
      const accessLevels = pages.map((p) => useAccessLevelBadge(p.permissions));
      const hasNoAccess = accessLevels.every((l) => l === 'no-access');
      const hasFullAccess = accessLevels.every((l) => l === 'full-access');
      
      const summary = hasNoAccess
        ? 'no-access'
        : hasFullAccess
        ? 'full-access'
        : 'editor'; // Mixed access

      result.push({ module, pages, summary });
    });

    // Sort alphabetically
    result.sort((a, b) => a.module.localeCompare(b.module));

    return result;
  }, [permissions]);
}
```

- [ ] **Step 2: Create PermissionPageRow component**

```typescript
// src/components/access-control/permissions/PermissionPageRow.tsx
import { useState } from "react";
import { Save } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useUpdatePermissions } from "@/hooks/useAccessControl";
import { toast } from "sonner";
import type { PagePermission, PermissionSet } from "@/types/access-control";

interface PermissionPageRowProps {
  page: PagePermission;
  roleKey: string;
}

export function PermissionPageRow({ page, roleKey }: PermissionPageRowProps) {
  const [localPerms, setLocalPerms] = useState<PermissionSet>(page.permissions);
  const [isDirty, setIsDirty] = useState(false);
  
  const updatePermissions = useUpdatePermissions();

  const handleToggle = (key: keyof PermissionSet) => {
    setLocalPerms((prev) => ({ ...prev, [key]: !prev[key] }));
    setIsDirty(true);
  };

  const handleSave = async () => {
    try {
      await updatePermissions.mutateAsync({
        roleKey,
        pageCode: page.page_code,
        permissions: localPerms,
      });
      toast.success("Permissions saved");
      setIsDirty(false);
    } catch (error) {
      toast.error("Failed to save permissions");
    }
  };

  const handleCancel = () => {
    setLocalPerms(page.permissions);
    setIsDirty(false);
  };

  return (
    <tr className={isDirty ? "bg-amber-50" : ""}>
      <td className="px-4 py-2 text-sm">{page.page_name || page.page_code}</td>
      <td className="px-3 py-2 text-center">
        <Checkbox
          checked={localPerms.can_view}
          onCheckedChange={() => handleToggle("can_view")}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <Checkbox
          checked={localPerms.can_create}
          onCheckedChange={() => handleToggle("can_create")}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <Checkbox
          checked={localPerms.can_edit}
          onCheckedChange={() => handleToggle("can_edit")}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <Checkbox
          checked={localPerms.can_delete}
          onCheckedChange={() => handleToggle("can_delete")}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <Checkbox
          checked={localPerms.can_export}
          onCheckedChange={() => handleToggle("can_export")}
        />
      </td>
      <td className="px-3 py-2 text-center">
        {isDirty && (
          <div className="flex items-center justify-center gap-1">
            <Button
              size="sm"
              variant="default"
              onClick={handleSave}
              disabled={updatePermissions.isPending}
            >
              <Save className="h-3 w-3 mr-1" />
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={updatePermissions.isPending}
            >
              Cancel
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
```

- [ ] **Step 3: Create PermissionModuleGroup component**

```typescript
// src/components/access-control/permissions/PermissionModuleGroup.tsx
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccessLevelBadge } from "./AccessLevelBadge";
import { PermissionPageRow } from "./PermissionPageRow";
import type { GroupedPermissions } from "@/types/access-control";

interface PermissionModuleGroupProps {
  group: GroupedPermissions;
  roleKey: string;
}

export function PermissionModuleGroup({ group, roleKey }: PermissionModuleGroupProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg mb-2 overflow-hidden">
      <div className="bg-slate-50 p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
          <div>
            <h3 className="font-semibold text-sm">{group.module}</h3>
            <p className="text-xs text-muted-foreground">
              {group.pages.length} page{group.pages.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <AccessLevelBadge level={group.summary} />
      </div>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Page</th>
                <th className="px-3 py-3 text-center">View</th>
                <th className="px-3 py-3 text-center">Create</th>
                <th className="px-3 py-3 text-center">Edit</th>
                <th className="px-3 py-3 text-center">Delete</th>
                <th className="px-3 py-3 text-center">Export</th>
                <th className="px-3 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {group.pages.map((page) => (
                <PermissionPageRow
                  key={page.page_code}
                  page={page}
                  roleKey={roleKey}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePermissionGroups.ts \
        src/components/access-control/permissions/PermissionPageRow.tsx \
        src/components/access-control/permissions/PermissionModuleGroup.tsx
git commit -m "feat(access-control): add permission components

- Add usePermissionGroups hook to group by module
- Add PermissionPageRow with inline editing
- Add PermissionModuleGroup with collapse/expand

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

**Due to length constraints, I'll continue in the next message with Tasks 6-10 covering Administration components, Tab components, Main page, Route setup, and Testing. Should I continue?**