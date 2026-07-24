import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  InfoWindow,
} from "@react-google-maps/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { MapPin, Users, RefreshCw, AlertCircle, Key } from "lucide-react";

interface LiveEmployee {
  employee_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  captured_at: string;
  full_name: string;
  branch_name: string | null;
}

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };
const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 }; // India

function minutesAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff === 1) return "1 min ago";
  return `${diff} min ago`;
}

export default function LiveLocationMap() {
  const [selectedEmp, setSelectedEmp] = useState<LiveEmployee | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY ?? "",
    id: "hrms-google-map",
  });

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["live-location"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: LiveEmployee[] }>("/api/location/live");
      return res.data ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  // Fit bounds once data is loaded and map is ready
  const fitBounds = useCallback(() => {
    if (!mapRef.current || !data || data.length === 0) return;
    const bounds = new window.google.maps.LatLngBounds();
    data.forEach((e) => bounds.extend({ lat: Number(e.latitude), lng: Number(e.longitude) }));
    mapRef.current.fitBounds(bounds, 60);
  }, [data]);

  const branchCounts = (data ?? []).reduce<Record<string, number>>((acc, e) => {
    const b = e.branch_name || "Unknown";
    acc[b] = (acc[b] || 0) + 1;
    return acc;
  }, {});

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN") : "—";

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)] gap-4 text-gray-500">
          <Key className="w-10 h-10 text-amber-400" />
          <p className="text-sm font-medium text-gray-700">Google Maps API key not configured</p>
          <p className="text-xs text-gray-500 max-w-xs text-center">
            Add <code className="bg-gray-100 px-1 rounded">VITE_GOOGLE_MAPS_API_KEY=your_key</code> to your <code className="bg-gray-100 px-1 rounded">.env</code> file and restart the dev server.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
        {/* Header */}
        <div className="bg-white border-b px-5 py-3 shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-gray-500 flex items-center gap-1 mb-0.5">
                <MapPin className="w-3.5 h-3.5" />
                Admin / Live Location
              </p>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">Live Employee Location</h1>
            </div>

            <div className="flex items-center gap-3 flex-wrap text-xs">
              <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 text-blue-700 font-medium">
                <Users className="w-3.5 h-3.5" />
                <span>{(data ?? []).length} Online</span>
              </div>

              {Object.entries(branchCounts).map(([branch, count]) => (
                <span key={branch} className="bg-gray-100 text-gray-600 rounded-full px-2.5 py-1 border border-gray-200">
                  {branch}: {count}
                </span>
              ))}

              <button
                onClick={() => { void refetch().then(fitBounds); }}
                className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                <span>{lastUpdate}</span>
              </button>

              {(data ?? []).length > 0 && (
                <button
                  onClick={fitBounds}
                  className="text-blue-600 hover:text-blue-800 underline text-xs"
                >
                  Fit all
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          {(isLoading && !data) && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {(isError || loadError) && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg shadow">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {loadError ? "Failed to load Google Maps" : "Failed to load live locations"}
            </div>
          )}
          {!isLoading && !isError && (data ?? []).length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 z-10 pointer-events-none">
              <MapPin className="w-10 h-10 mb-2" />
              <p className="text-sm font-medium">No employees online in the last 5 minutes</p>
            </div>
          )}

          {isLoaded && (
            <GoogleMap
              mapContainerStyle={MAP_CONTAINER_STYLE}
              center={DEFAULT_CENTER}
              zoom={5}
              onLoad={onMapLoad}
              options={{
                streetViewControl: false,
                mapTypeControl: true,
                fullscreenControl: true,
                clickableIcons: false,
              }}
            >
              {(data ?? []).map((emp) => (
                <Marker
                  key={emp.employee_id}
                  position={{ lat: Number(emp.latitude), lng: Number(emp.longitude) }}
                  title={emp.full_name}
                  onClick={() => setSelectedEmp(emp)}
                />
              ))}

              {selectedEmp && (
                <InfoWindow
                  position={{ lat: Number(selectedEmp.latitude), lng: Number(selectedEmp.longitude) }}
                  onCloseClick={() => setSelectedEmp(null)}
                >
                  <div style={{ minWidth: 160, fontFamily: "sans-serif", fontSize: 13 }}>
                    <strong style={{ display: "block", marginBottom: 4 }}>{selectedEmp.full_name}</strong>
                    {selectedEmp.branch_name && (
                      <span style={{ color: "#555", display: "block" }}>{selectedEmp.branch_name}</span>
                    )}
                    <span style={{ color: "#888", fontSize: 11 }}>
                      Last seen: {minutesAgo(selectedEmp.captured_at)}
                    </span>
                    {selectedEmp.accuracy != null && (
                      <span style={{ display: "block", color: "#aaa", fontSize: 10 }}>
                        ±{Math.round(selectedEmp.accuracy)}m accuracy
                      </span>
                    )}
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
