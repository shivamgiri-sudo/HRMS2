import { useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, X } from "lucide-react";

// Fix Leaflet default marker icons broken by Vite bundler
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface Props {
  value: { lat: string; lng: string } | null;
  onChange: (v: { lat: string; lng: string }) => void;
  onClose: () => void;
}

interface ClickedPin {
  lat: number;
  lng: number;
}

// Inner component that listens for map clicks and drops a marker
function MapClickHandler({
  pin,
  onPin,
}: {
  pin: ClickedPin | null;
  onPin: (p: ClickedPin) => void;
}) {
  useMapEvents({
    click(e) {
      onPin({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return pin ? <Marker position={[pin.lat, pin.lng]} /> : null;
}

export function BranchCoordPicker({ value, onChange, onClose }: Props) {
  const initialLat = value?.lat ? parseFloat(value.lat) : null;
  const initialLng = value?.lng ? parseFloat(value.lng) : null;

  const hasInitial =
    initialLat !== null &&
    initialLng !== null &&
    !isNaN(initialLat) &&
    !isNaN(initialLng);

  const centerLat = hasInitial ? initialLat! : 20.5937;
  const centerLng = hasInitial ? initialLng! : 78.9629;
  const initialZoom = hasInitial ? 14 : 5;

  const [pin, setPin] = useState<ClickedPin | null>(
    hasInitial ? { lat: initialLat!, lng: initialLng! } : null
  );

  const handleUse = () => {
    if (!pin) return;
    onChange({
      lat: String(parseFloat(pin.lat.toFixed(7))),
      lng: String(parseFloat(pin.lng.toFixed(7))),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4 shrink-0">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-black text-slate-950">Pick Branch Location</h2>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Instruction */}
        <p className="px-6 pt-3 pb-1 text-sm text-slate-500 shrink-0">
          Click on the map to drop a pin at the branch location.
        </p>

        {/* Map */}
        <div className="h-96 w-full shrink-0">
          <MapContainer
            center={[centerLat, centerLng]}
            zoom={initialZoom}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapClickHandler pin={pin} onPin={setPin} />
          </MapContainer>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t px-6 py-4 shrink-0">
          <div className="text-sm text-slate-600 font-mono">
            {pin ? (
              <span>
                <span className="font-semibold text-slate-800">
                  {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}
                </span>
              </span>
            ) : (
              <span className="text-slate-400 italic">No location selected</span>
            )}
          </div>
          <div className="flex gap-3 shrink-0">
            <button
              onClick={onClose}
              className="cursor-pointer rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleUse}
              disabled={!pin}
              className="cursor-pointer rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Use This Location
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
