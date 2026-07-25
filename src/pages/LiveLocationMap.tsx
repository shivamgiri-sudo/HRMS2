import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { MapPin, Users, RefreshCw, AlertCircle, Search, X, Clock } from "lucide-react";

// Fix Leaflet default marker icons broken by Vite bundler
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
  process_name: string | null;
  designation: string | null;
}

interface BranchOption {
  id: string;
  branch_name: string;
  latitude: string | null;
  longitude: string | null;
}

interface ProcessOption {
  id: string;
  process_name: string;
  branch_id: string | null;
}

function minutesAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff === 1) return "1 min ago";
  return `${diff} min ago`;
}

// Haversine formula — returns distance in km between two lat/lng points
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Returns human-readable travel time estimate at ~40 km/h average city speed
function travelTimeLabel(distKm: number): string {
  const minutes = Math.round((distKm / 40) * 60);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `~${h}h ${m}min` : `~${h}h`;
}

// Fit map bounds ONCE on initial load only — never re-fit on polls
function BoundsFitter({ employees }: { employees: LiveEmployee[] }) {
  const map = useMap();
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current || !employees.length) return;
    fittedRef.current = true;
    const bounds = L.latLngBounds(
      employees.map((e) => [Number(e.latitude), Number(e.longitude)])
    );
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
  }, [employees]);
  return null;
}

// Captures the Leaflet map instance for programmatic flyTo
function MapRefCapture({ onMap }: { onMap: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => { onMap(map); }, [map]);
  return null;
}

export default function LiveLocationMap() {
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [searchQuery, setSearchQuery]     = useState("");
  const [branchFilter, setBranchFilter]   = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const mapRef     = useRef<L.Map | null>(null);
  const markerRefs = useRef<Record<string, L.Marker>>({});

  // Live location data — polls every 30s
  const { data: liveData, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["live-location"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: LiveEmployee[] }>("/api/location/live");
      return res.data ?? [];
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: true, // keep polling even when tab is not focused
    staleTime: 15_000,
  });

  // All active branches — includes lat/lng for travel-time calc
  const { data: branchData } = useQuery({
    queryKey: ["org-branches-live-map"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: BranchOption[] }>("/api/org/branches?active_status=1&limit=500");
      return res.data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  // All active processes — for process dropdown
  const { data: processData } = useQuery({
    queryKey: ["org-processes-live-map"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: ProcessOption[] }>("/api/org/processes?active_status=1&limit=500");
      return res.data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const employees    = liveData ?? [];
  const allBranches  = branchData ?? [];
  const allProcesses = processData ?? [];

  // Build a lookup: branch_name → { lat, lng } for travel-time calculation
  const branchCoords = useMemo(() => {
    const map: Record<string, { lat: number; lng: number }> = {};
    for (const b of allBranches) {
      if (b.latitude && b.longitude) {
        map[b.branch_name] = { lat: Number(b.latitude), lng: Number(b.longitude) };
      }
    }
    return map;
  }, [allBranches]);

  // Filter processes by selected branch (branch_id FK on process_master)
  const filteredProcesses = useMemo(() => {
    if (!branchFilter) return allProcesses;
    const selectedBranch = allBranches.find((b) => b.branch_name === branchFilter);
    if (!selectedBranch) return allProcesses;
    return allProcesses.filter((p) => p.branch_id === selectedBranch.id);
  }, [allProcesses, allBranches, branchFilter]);

  // Reset process filter when branch changes
  useEffect(() => { setProcessFilter(""); }, [branchFilter]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return employees.filter((e) => {
      if (branchFilter && e.branch_name !== branchFilter) return false;
      if (processFilter && e.process_name !== processFilter) return false;
      if (q && !e.full_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [employees, searchQuery, branchFilter, processFilter]);

  const lastUpdate = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN")
    : "—";

  function getTravelInfo(emp: LiveEmployee): { distKm: number; label: string } | null {
    if (!emp.branch_name) return null;
    const coords = branchCoords[emp.branch_name];
    if (!coords) return null;
    const distKm = haversineKm(Number(emp.latitude), Number(emp.longitude), coords.lat, coords.lng);
    return { distKm, label: travelTimeLabel(distKm) };
  }

  function flyToEmployee(emp: LiveEmployee) {
    setSelectedId(emp.employee_id);
    const map = mapRef.current;
    if (map) {
      map.flyTo([Number(emp.latitude), Number(emp.longitude)], 16, { duration: 1 });
      setTimeout(() => {
        const marker = markerRefs.current[emp.employee_id];
        if (marker) marker.openPopup();
      }, 1100);
    }
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>

        {/* ── Top header ── */}
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
                <span>{filteredEmployees.length} / {employees.length} Online</span>
              </div>
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

        {/* ── Body: sidebar + map ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Left sidebar ── */}
          <div className="w-72 shrink-0 flex flex-col border-r bg-gray-50 overflow-hidden">

            {/* Filters */}
            <div className="p-3 border-b bg-white space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by employee name…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Branch dropdown — all active branches from branch_master */}
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="w-full text-sm border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">All Branches</option>
                {allBranches.map((b) => (
                  <option key={b.id} value={b.branch_name}>{b.branch_name}</option>
                ))}
              </select>

              {/* Process dropdown — filtered by selected branch */}
              <select
                value={processFilter}
                onChange={(e) => setProcessFilter(e.target.value)}
                className="w-full text-sm border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">All Processes</option>
                {filteredProcesses.map((p) => (
                  <option key={p.id} value={p.process_name}>{p.process_name}</option>
                ))}
              </select>
            </div>

            {/* Online employee list */}
            <div className="flex-1 overflow-y-auto">
              {isLoading && employees.length === 0 && (
                <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
                  Loading…
                </div>
              )}

              {!isLoading && filteredEmployees.length === 0 && (
                <div className="flex flex-col items-center justify-center h-24 text-gray-400 text-xs px-4 text-center">
                  <MapPin className="w-6 h-6 mb-1" />
                  {employees.length === 0
                    ? "No employees online right now"
                    : "No match for current filters"}
                </div>
              )}

              {filteredEmployees.map((emp) => {
                const travel = getTravelInfo(emp);
                return (
                  <button
                    key={emp.employee_id}
                    onClick={() => flyToEmployee(emp)}
                    className={`w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-blue-50 transition-colors ${
                      selectedId === emp.employee_id
                        ? "bg-blue-50 border-l-2 border-l-blue-500"
                        : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-green-500" />
                      <div className="min-w-0 w-full">
                        <p className="text-sm font-medium text-gray-900 truncate">{emp.full_name}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {[emp.branch_name, emp.process_name].filter(Boolean).join(" · ") || "—"}
                        </p>
                        {emp.designation && (
                          <p className="text-xs text-gray-400 truncate">{emp.designation}</p>
                        )}
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs text-gray-400">{minutesAgo(emp.captured_at)}</p>
                          {travel && (
                            <span className="flex items-center gap-0.5 text-xs text-amber-600 font-medium">
                              <Clock className="w-3 h-3" />
                              {travel.label} to office
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Map panel ── */}
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
                <p className="text-xs mt-1">Employees send a heartbeat every 30 seconds when logged in</p>
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

              <MapRefCapture onMap={(m) => { mapRef.current = m; }} />
              <BoundsFitter employees={filteredEmployees} />

              {filteredEmployees.map((emp) => {
                const travel = getTravelInfo(emp);
                return (
                  <Marker
                    key={emp.employee_id}
                    position={[Number(emp.latitude), Number(emp.longitude)]}
                    ref={(m) => {
                      if (m) markerRefs.current[emp.employee_id] = m;
                      else delete markerRefs.current[emp.employee_id];
                    }}
                    eventHandlers={{ click: () => setSelectedId(emp.employee_id) }}
                  >
                    <Popup>
                      <div style={{ minWidth: 190, fontSize: 13 }}>
                        <strong style={{ display: "block", marginBottom: 4 }}>
                          {emp.full_name}
                        </strong>
                        {emp.branch_name && (
                          <span style={{ color: "#555", display: "block" }}>
                            {emp.branch_name}
                            {emp.process_name ? ` · ${emp.process_name}` : ""}
                          </span>
                        )}
                        {emp.designation && (
                          <span style={{ color: "#777", display: "block", fontSize: 11 }}>
                            {emp.designation}
                          </span>
                        )}
                        <span style={{ color: "#888", fontSize: 11, display: "block", marginTop: 4 }}>
                          Last seen: {minutesAgo(emp.captured_at)}
                        </span>
                        {emp.accuracy != null && (
                          <span style={{ display: "block", color: "#aaa", fontSize: 10, marginTop: 2 }}>
                            ±{Math.round(emp.accuracy)}m accuracy
                          </span>
                        )}
                        {travel && (
                          <div style={{
                            marginTop: 8,
                            paddingTop: 8,
                            borderTop: "1px solid #eee",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            color: "#b45309",
                            fontWeight: 600,
                            fontSize: 12,
                          }}>
                            <span>🕐</span>
                            <span>{travel.label} to office</span>
                            <span style={{ fontWeight: 400, color: "#999", fontSize: 10 }}>
                              ({travel.distKm.toFixed(1)} km est.)
                            </span>
                          </div>
                        )}
                        {emp.branch_name && !branchCoords[emp.branch_name] && (
                          <div style={{ marginTop: 8, fontSize: 10, color: "#aaa" }}>
                            Travel time unavailable — add branch coordinates in Org Masters
                          </div>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
