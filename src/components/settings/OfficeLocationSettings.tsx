import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Loader2, Save } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface OfficeLocation {
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
}

const DEFAULT_RADIUS = 500;

export function useOfficeLocation() {
  return useQuery({
    queryKey: ["office-location"],
    queryFn: async () => {
      try {
        const result = await hrmsApi.get<{success: boolean; data: {setting_key: string; setting_value: OfficeLocation} | null}>('/api/org/settings/office_location');
        return (result as any).data?.setting_value ?? null;
      } catch {
        return null;
      }
    },
  });
}

/** Calculate distance in meters between two lat/lng points using Haversine formula */
export function getDistanceMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function OfficeLocationSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: existing, isLoading } = useOfficeLocation();

  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radiusMeters, setRadiusMeters] = useState(DEFAULT_RADIUS.toString());
  const [initialized, setInitialized] = useState(false);

  // Initialize form when data loads
  if (existing && !initialized) {
    setAddress(existing.address || "");
    setLatitude(existing.latitude?.toString() || "");
    setLongitude(existing.longitude?.toString() || "");
    setRadiusMeters((existing.radius_meters || DEFAULT_RADIUS).toString());
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (location: OfficeLocation) => {
      await hrmsApi.put('/api/org/settings/office_location', { setting_value: location });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["office-location"] });
      toast({ title: "Office location saved", description: "Clock-in will now auto-detect WFO/WFH based on this location." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const radius = parseInt(radiusMeters) || DEFAULT_RADIUS;

    if (!address.trim()) {
      toast({ title: "Error", description: "Address is required", variant: "destructive" });
      return;
    }
    if (isNaN(lat) || lat < -90 || lat > 90) {
      toast({ title: "Error", description: "Enter a valid latitude (-90 to 90)", variant: "destructive" });
      return;
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      toast({ title: "Error", description: "Enter a valid longitude (-180 to 180)", variant: "destructive" });
      return;
    }

    saveMutation.mutate({ address: address.trim(), latitude: lat, longitude: lng, radius_meters: radius });
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: "Error", description: "Geolocation not supported", variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
        toast({ title: "Location captured", description: "Coordinates filled from your current position." });
      },
      () => {
        toast({ title: "Error", description: "Failed to get location. Please enable location access.", variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Office Location
        </CardTitle>
        <CardDescription>
          Set your office address and coordinates. When employees clock in, the system will automatically detect if they are at the office (WFO) or working remotely (WFH) based on their distance from this location.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="officeAddress">Office Address *</Label>
          <Textarea
            id="officeAddress"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g., 123 Business Park, Sector 5, Bengaluru, Karnataka"
            rows={2}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="officeLat">Latitude *</Label>
            <Input
              id="officeLat"
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="e.g., 12.971599"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="officeLng">Longitude *</Label>
            <Input
              id="officeLng"
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="e.g., 77.594566"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="officeRadius">Detection Radius (meters)</Label>
          <Input
            id="officeRadius"
            type="number"
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(e.target.value)}
            placeholder="500"
          />
          <p className="text-xs text-muted-foreground">
            Employees within this radius will be auto-detected as "Work From Office".
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={handleGetCurrentLocation} type="button">
            <MapPin className="mr-2 h-4 w-4" />
            Use Current Location
          </Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Location
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
