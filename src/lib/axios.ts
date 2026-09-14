import { hrmsApi } from "@/lib/hrmsApi";

// Compatibility shim for older pages that still import `@/lib/axios`.
// The app now uses the shared fetch-based HRMS client everywhere.
export default hrmsApi;
