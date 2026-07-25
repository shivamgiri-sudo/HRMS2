import { apiUrl } from "@/lib/apiBase";

export function getCompanyFeedImageUrl(fileId: string): string {
  return apiUrl(`/api/files/company-feed/${fileId}`);
}
