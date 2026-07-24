import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { MapPin, Users, RefreshCw, AlertCircle } from "lucide-react";

// Fix Leaflet default marker icons broken by bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface LiveEmployee {
  employee_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  captured_at: string;
  full_name: string;
  branch_name: string | null;
}

function minutesAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff === 1) return "1 min ago";
  return `${diff} min ago`;
}

// Auto-fit map bounds whenever employee data changes
function BoundsFitter({ employees }: { employees: LiveEmployee[] }) {
  const map = useMap();
  useEffect(() => {
    if (!employees.length) return;
    const bounds = L.latLngBounds(
      employees.map((e) => [Number(e.latitude), Number(e.longitude)])
    );
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }, [employees]);
  return null;
}

export default function LiveLocationMap() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["live-location"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: LiveEmployee[] }>(
        "/api/location/live"
      );
      return res.data ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const employees = data ?? [];

  const branchCounts = employees.reduce<Record<string, number>>((acc, e) => {
    const b = e.branch_name || "Unknown";
    acc[b] = (acc[b] || 0) + 1;
    return acc;
  }, {});

  const lastUpdate = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN")
    : "—";

  return (
    <DashboardLayout>
      <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>

        {/* ── Header ── */}
        <div className="bg-white border-b px-5 py-3 shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-gray-500 flex items-center gap-1 mb-0.5">
                <MapPin className="w-3.5 h-3.5" />
                Admin / Live Location
              </p>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">
                Live Employee Location
              </h1>
            </div>

            <div className="flex items-center gap-3 flex-wrap text-xs">
              <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 text-blue-700 font-medium">
                <Users className="w-3.5 h-3.5" />
                <span>{employees.length} Online</span>
              </div>

              {Object.entries(branchCounts).map(([branch, count]) => (
                <span
                  key={branch}
                  className="bg-gray-100 text-gray-600 rounded-full px-2.5 py-1 border border-gray-200"
                >
                  {branch}: {count}
                </span>
              ))}

              <button
                onClick={() => void refetch()}
                className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
                title="Refresh now"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                <span>{lastUpdate}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Map ── */}
        <div className="flex-1 relative overflow-hidden">
          {isError && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg shadow">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Failed to load live locations
            </div>
          )}

          {!isLoading && !isError && employees.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 z-[500] pointer-events-none">
              <MapPin className="w-10 h-10 mb-2" />
              <p className="text-sm font-medium">No employees online in the last 5 minutes</p>
              <p className="text-xs text-gray-400 mt-1">Employees send a location heartbeat every 30 seconds when logged in</p>
            </div>
          )}

          <MapContainer
            center={[20.5937, 78.9629]}
            zoom={5}
            style={{ width: "100%", height: "100%" }}
            zoomControl
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
              maxZoom={19}
            />

            <BoundsFitter employees={employees} />

            {employees.map((emp) => (
              <Marker
                key={emp.employee_id}
                position={[Number(emp.latitude), Number(emp.longitude)]}
                eventHandlers={{ click: () => setSelectedId(emp.employee_id) }}
              >
                <Popup>
                  <div style={{ minWidth: 160, fontSize: 13 }}>
                    <strong style={{ display: "block", marginBottom: 4 }}>
                      {emp.full_name}
                    </strong>
                    {emp.branch_name && (
                      <span style={{ color: "#555", display: "block" }}>
                        {emp.branch_name}
                      </span>
                    )}
                    <span style={{ color: "#888", fontSize: 11 }}>
                      Last seen: {minutesAgo(emp.captured_at)}
                    </span>
                    {emp.accuracy != null && (
                      <span style={{ display: "block", color: "#aaa", fontSize: 10, marginTop: 2 }}>
                        ±{Math.round(emp.accuracy)}m accuracy
                      </span>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>
    </DashboardLayout>
  );
}
