// Silent geo capture — never throws, never blocks the calling action.
// Returns null coords if permission denied, browser unsupported, or timeout.
export function useGeoCapture() {
  return (): Promise<{ latitude: number | null; longitude: number | null }> =>
    new Promise((resolve) => {
      if (!navigator?.geolocation) {
        return resolve({ latitude: null, longitude: null });
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve({ latitude: null, longitude: null }),
        { timeout: 5000, maximumAge: 60000, enableHighAccuracy: false }
      );
    });
}
