import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { IndianRupee, Search, FileStack, Users, ArrowUpRight, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useSalaryStructures } from "@/hooks/usePayroll";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export function SalaryStructureManager() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: structures = [], isLoading } = useSalaryStructures();

  const filteredStructures = structures.filter(
    (s) =>
      s.employeeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.employeeEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.employeeCode ?? "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const uniqueTemplates = (() => {
    const map = new Map<string, { basic: number; hra: number; other: number; count: number }>();
    for (const s of structures) {
      const key = `${s.basicSalary}-${s.hra}-${s.otherAllowances}`;
      const existing = map.get(key);
      if (existing) { existing.count++; } else { map.set(key, { basic: s.basicSalary, hra: s.hra, other: s.otherAllowances, count: 1 }); }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  })();

  return (
    <Tabs defaultValue="assignments" className="space-y-4">
      <TabsList>
        <TabsTrigger value="assignments" className="gap-2"><Users className="h-4 w-4" />Employee Assignments</TabsTrigger>
        <TabsTrigger value="templates" className="gap-2"><FileStack className="h-4 w-4" />Salary Templates</TabsTrigger>
      </TabsList>

      <TabsContent value="templates" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Salary Structure Templates</CardTitle>
          </CardHeader>
          <CardContent>
            {uniqueTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No salary structures defined yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Basic</TableHead>
                    <TableHead>HRA</TableHead>
                    <TableHead>Other Allowances</TableHead>
                    <TableHead>Gross (Template)</TableHead>
                    <TableHead className="text-right">Employees</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uniqueTemplates.map((t, i) => (
                    <TableRow key={i}>
                      <TableCell>{formatCurrency(t.basic)}</TableCell>
                      <TableCell>{formatCurrency(t.hra)}</TableCell>
                      <TableCell>{formatCurrency(t.other)}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(t.basic + t.hra + t.other)}</TableCell>
                      <TableCell className="text-right"><Badge variant="secondary">{t.count}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="assignments" className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button asChild variant="outline">
          <Link to="/salary-increment">
            <ArrowUpRight className="mr-2 h-4 w-4" />
            Revise salary
          </Link>
        </Button>
      </div>

      {/*
        This view is read-only by design.

        It previously offered Add/Edit/Delete against POST/PUT /api/payroll/structures,
        sending a per-employee rupee breakdown (basic_salary, hra, transport_allowance…).
        That endpoint takes a shared percentage template (structureCode, structureName,
        basicPct, hraPct), so every submit failed validation and surfaced only a generic
        "Failed to create salary structure" toast — the feature never worked.

        Re-pointing the form at the real per-employee endpoint
        (POST /api/payroll/salary-assignments) would not have fixed it either: salary
        assignment is governance-gated by assertSalaryAssignmentAllowed, which refuses a
        manual amount without an approved salary slab or an approved salary proposal.
        A free-text amount box cannot satisfy that, and should not be able to.

        So the affordances are replaced by a link to the governed flow rather than
        rebuilt. Nothing that worked was removed.
      */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-amber-900">
          Salary figures are read-only here. Revisions go through the approval-gated
          increment flow, which records the slab or approved proposal each change is based on.{" "}
          <Link to="/salary-increment" className="font-medium underline underline-offset-2">
            Open salary increments
          </Link>
        </p>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : filteredStructures.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <IndianRupee className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-semibold text-foreground">No Salary Structures</h3>
            <p className="text-muted-foreground">
              {structures.length === 0
                ? "Salary assignments appear here once they are approved through the increment flow"
                : "No structures match your search"}
            </p>
            {structures.length === 0 && (
              <Button asChild className="mt-4" variant="outline">
                <Link to="/salary-increment">
                  <ArrowUpRight className="mr-2 h-4 w-4" />
                  Open salary increments
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Basic</TableHead>
                  <TableHead className="text-right">Allowances</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net Salary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStructures.map((structure) => (
                  <TableRow key={structure.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={structure.employeeAvatar} />
                          <AvatarFallback>
                            {structure.employeeName.split(" ").map((n) => n[0]).join("")}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-foreground">{structure.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{structure.employeeCode || structure.employeeEmail}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(structure.basicSalary)}
                    </TableCell>
                    <TableCell className="text-right text-emerald-600">
                      +{formatCurrency(structure.hra + structure.otherAllowances)}
                    </TableCell>
                    <TableCell className="text-right text-slate-400 text-xs">
                      At run time
                    </TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {formatCurrency(structure.basicSalary + structure.hra + structure.otherAllowances)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      </TabsContent>
    </Tabs>
  );
}