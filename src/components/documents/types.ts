export type CandidateDocument = {
  id: string;
  candidate_id: string;
  document_type: string;
  document_category: string;
  document_name: string;
  file_name: string;
  mime_type?: string | null;
  file_size?: number | null;
  verification_status: string;
  mandatory_flag: boolean;
  sensitive_flag: boolean;
  name_match_status: string;
  uploaded_at?: string | null;
  preview_url: string;
  download_url: string;
};

export type DocumentAuditEntry = {
  access_type: string;
  actor_id?: string | null;
  outcome: string;
  ip_address?: string | null;
  created_at: string;
};
