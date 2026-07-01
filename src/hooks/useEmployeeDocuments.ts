import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

export interface EmployeeDocument {
  id: string;
  employee_id: string;
  document_name: string;
  document_type: string;
  file_url: string;
  verified: boolean;
  uploaded_at: string;
}

export function useEmployeeDocuments(employeeId: string | undefined) {
  return useQuery({
    queryKey: ["employee-documents", employeeId],
    queryFn: async () => {
      if (!employeeId) return [];
      const res = await hrmsApi.get<{ data: EmployeeDocument[] }>(`/api/employee-docs/${employeeId}`);
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      employeeId,
      file,
      documentType,
    }: {
      employeeId: string;
      file: File;
      documentType: string;
    }) => {
      // Upload via multipart form to the backend; backend stores binary to configured storage
      const formData = new FormData();
      formData.append("file", file);
      formData.append("document_type", documentType);
      formData.append("document_name", file.name);

      const token = localStorage.getItem("hrms_access_token");
      const apiBase = import.meta.env.VITE_HRMS_API_URL || (import.meta.env.DEV ? "http://localhost:5055" : "");
      const uploadRes = await fetch(
        `${apiBase}/api/employee-docs/${employeeId}/upload`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        }
      );
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error((err as any).message ?? "Upload failed");
      }
      const json = await uploadRes.json();
      return (json as any).data as EmployeeDocument;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employee-documents", variables.employeeId] });
      toast.success("Document uploaded successfully");
    },
    onError: (error: any) => {
      toast.error("Failed to upload document: " + error.message);
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      documentId,
      fileUrl: _fileUrl,
      employeeId,
    }: {
      documentId: string;
      fileUrl: string;
      employeeId: string;
    }) => {
      // Backend handles both metadata deletion and storage cleanup
      await hrmsApi.delete(`/api/employee-docs/${employeeId}/${documentId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["employee-documents", variables.employeeId] });
      toast.success("Document deleted successfully");
    },
    onError: (error: any) => {
      toast.error("Failed to delete document: " + error.message);
    },
  });
}
