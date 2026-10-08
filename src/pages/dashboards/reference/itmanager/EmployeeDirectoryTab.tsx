import { useState } from "react";
import { ReferencePanel } from "../../ReferenceDashboardUI";
import { arrayAt, asNumber, asRecord, asString, formatValue } from "../../reference-dashboard-model";

// ── Tab: Employee IT Directory ────────────────────────────────────────────────

export function EmployeeDirectoryTab({ employees }: { employees: Record<string, unknown>[] }) {
  const [search, setSearch] = useState("");
  const filtered = employees.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(e.employee_code ?? "").toLowerCase().includes(q) ||
      String(e.employee_name ?? "").toLowerCase().includes(q) ||
      String(e.official_email ?? "").toLowerCase().includes(q) ||
      String(e.domain_account ?? "").toLowerCase().includes(q) ||
      String(e.branch_name ?? "").toLowerCase().includes(q) ||
      String(e.process_name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <ReferencePanel
      title="Employee IT Directory"
      action={
        <input
          type="text"
          placeholder="Search name, email, domain..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs text-[#0b1f44] placeholder:text-[#a0aec0] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30 w-56"
        />
      }
      bodyClassName="p-0"
    >
      {filtered.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#edf1f6] text-[10px] font-semibold uppercase tracking-wider text-[#a0aec0]">
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Employee</th>
                <th className="px-4 py-3 text-left">Official Email</th>
                <th className="px-4 py-3 text-left">Domain Account</th>
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">Branch</th>
                <th className="px-4 py-3 text-left">Process</th>
                <th className="px-4 py-3 text-left">IT Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const provStatus = String(e.it_provision_status ?? "");
                const statusColor =
                  provStatus === "actioned" || provStatus === "confirmed" ? "bg-emerald-50 text-emerald-700" :
                  provStatus === "pending"  || provStatus === "pending_unassigned" ? "bg-amber-50 text-amber-700" :
                  provStatus === "waived"   ? "bg-slate-100 text-slate-500" : "bg-slate-50 text-slate-400";
                return (
                  <tr key={String(e.id ?? i)} className="border-b border-[#f8fafc] hover:bg-[#f8fafc]">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#61708a]">{asString(e.employee_code) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs font-medium text-[#0b1f44]">{asString(e.employee_name) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">
                      {e.official_email ? <span className="font-mono">{String(e.official_email)}</span> : <span className="text-[#a0aec0]">Not assigned</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">
                      {e.domain_account ? <span className="font-mono">{String(e.domain_account)}</span> : <span className="text-[#a0aec0]">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">
                      {e.asset_name
                        ? <div><p className="font-medium text-[#0b1f44]">{String(e.asset_name)}</p><p className="text-[10px] text-[#a0aec0]">{String(e.serial_number ?? "")}</p></div>
                        : <span className="text-[#a0aec0]">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">{asString(e.branch_name) ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-[#61708a]">{asString(e.process_name) ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {provStatus
                        ? <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusColor}`}>{provStatus.replace(/_/g, " ")}</span>
                        : <span className="text-[10px] text-[#a0aec0]">No IT task</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">
          {search ? "No matching employees found" : "No employee IT data available"}
        </p>
      )}
    </ReferencePanel>
  );
}
