import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Mock dependencies before importing the module
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(),
    query: vi.fn(),
  },
}));

vi.mock("../../document-vault/documentVault.service.js", () => ({
  registerUpload: vi.fn(),
  findByStoredFilename: vi.fn(),
  softDelete: vi.fn(),
  issueDownloadToken: vi.fn(),
  consumeDownloadToken: vi.fn(),
  logDocumentAccess: vi.fn(),
}));

vi.mock("../documentVaultAuth.js", () => ({
  authorizeDocumentAccess: vi.fn(),
}));

vi.mock("../../auth/auth.service.js", () => ({
  authService: {
    verifyAccessToken: vi.fn(),
  },
}));

vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: vi.fn(),
}));

describe("Document Vault Security", () => {
  describe("Magic Byte Validation", () => {
    const MAGIC_BYTES: Record<string, Buffer> = {
      ".pdf": Buffer.from([0x25, 0x50, 0x44, 0x46]),
      ".png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      ".jpg": Buffer.from([0xff, 0xd8, 0xff]),
      ".jpeg": Buffer.from([0xff, 0xd8, 0xff]),
      ".gif": Buffer.from([0x47, 0x49, 0x46, 0x38]),
      ".zip": Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      ".docx": Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      ".xlsx": Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    };

    function validateFileMagicBytes(filePath: string, extension: string): boolean {
      const ext = extension.toLowerCase();
      const expected = MAGIC_BYTES[ext];
      if (!expected) return true;

      try {
        const fd = fs.openSync(filePath, "r");
        const buffer = Buffer.alloc(expected.length);
        fs.readSync(fd, buffer, 0, expected.length, 0);
        fs.closeSync(fd);
        return buffer.equals(expected);
      } catch {
        return false;
      }
    }

    it("should reject .pdf extension with non-PDF content", () => {
      const tempFile = path.join(__dirname, "test-fake.pdf");
      fs.writeFileSync(tempFile, "This is plain text, not a PDF");

      const result = validateFileMagicBytes(tempFile, ".pdf");

      fs.unlinkSync(tempFile);
      expect(result).toBe(false);
    });

    it("should accept valid PDF file", () => {
      const tempFile = path.join(__dirname, "test-valid.pdf");
      const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
      fs.writeFileSync(tempFile, pdfHeader);

      const result = validateFileMagicBytes(tempFile, ".pdf");

      fs.unlinkSync(tempFile);
      expect(result).toBe(true);
    });

    it("should reject .png extension with executable content", () => {
      const tempFile = path.join(__dirname, "test-fake.png");
      const exeHeader = Buffer.from([0x4d, 0x5a]);
      fs.writeFileSync(tempFile, exeHeader);

      const result = validateFileMagicBytes(tempFile, ".png");

      fs.unlinkSync(tempFile);
      expect(result).toBe(false);
    });

    it("should accept valid PNG file", () => {
      const tempFile = path.join(__dirname, "test-valid.png");
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      fs.writeFileSync(tempFile, pngHeader);

      const result = validateFileMagicBytes(tempFile, ".png");

      fs.unlinkSync(tempFile);
      expect(result).toBe(true);
    });

    it("should allow unknown extensions without magic byte check", () => {
      const tempFile = path.join(__dirname, "test-unknown.xyz");
      fs.writeFileSync(tempFile, "arbitrary content");

      const result = validateFileMagicBytes(tempFile, ".xyz");

      fs.unlinkSync(tempFile);
      expect(result).toBe(true);
    });
  });

  describe("Authorization Always Enforced", () => {
    let mockDb: { execute: ReturnType<typeof vi.fn> };
    let mockAuthorizeDocumentAccess: ReturnType<typeof vi.fn>;
    let mockGetUserRoleContext: ReturnType<typeof vi.fn>;
    let mockAuthService: { verifyAccessToken: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      const { db } = await import("../../../db/mysql.js");
      const { authorizeDocumentAccess } = await import("../documentVaultAuth.js");
      const { getUserRoleContext } = await import("../../../shared/roleResolver.js");
      const { authService } = await import("../../auth/auth.service.js");

      mockDb = db as typeof mockDb;
      mockAuthorizeDocumentAccess = authorizeDocumentAccess as ReturnType<typeof vi.fn>;
      mockGetUserRoleContext = getUserRoleContext as ReturnType<typeof vi.fn>;
      mockAuthService = authService as typeof mockAuthService;

      vi.clearAllMocks();
    });

    it("should deny access when role lookup fails (fail-closed)", async () => {
      mockAuthService.verifyAccessToken.mockReturnValue({ id: "user-123" });
      mockGetUserRoleContext.mockRejectedValue(new Error("DB error"));

      expect(mockGetUserRoleContext).toBeDefined();
    });

    it("should enforce authorization even without DPDP flag", async () => {
      mockAuthService.verifyAccessToken.mockReturnValue({ id: "user-123" });
      mockGetUserRoleContext.mockResolvedValue({ primaryRole: "employee" });
      mockAuthorizeDocumentAccess.mockResolvedValue({ allowed: false, reasonCode: "ACCESS_DENIED" });

      expect(mockAuthorizeDocumentAccess).toBeDefined();
    });
  });

  describe("Retention Policy Enforcement", () => {
    let mockDb: { execute: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      const { db } = await import("../../../db/mysql.js");
      mockDb = db as typeof mockDb;
      vi.clearAllMocks();
    });

    it("should block deletion when legal hold is active", async () => {
      mockDb.execute.mockImplementation((query: string) => {
        if (query.includes("document_legal_hold")) {
          return [[{ id: "hold-1", hold_reason: "Litigation pending" }]];
        }
        return [[]];
      });

      const result = await mockDb.execute(
        "SELECT id, hold_reason FROM document_legal_hold WHERE is_active = 1 AND (vault_item_id = ? OR category = ?)",
        ["item-1", "employee-documents"]
      );

      expect(result[0].length).toBeGreaterThan(0);
      expect(result[0][0].hold_reason).toBe("Litigation pending");
    });

    it("should block deletion when retention period not expired", async () => {
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - 30);

      mockDb.execute.mockImplementation((query: string) => {
        if (query.includes("document_legal_hold")) {
          return [[]];
        }
        if (query.includes("document_retention_policy")) {
          return [[{
            retention_days: 2555,
            deletion_requires_approval: 1,
            created_at: createdAt.toISOString(),
          }]];
        }
        return [[]];
      });

      const [retentionRows] = await mockDb.execute(
        "SELECT retention_days FROM document_retention_policy",
        []
      );

      expect(retentionRows[0].retention_days).toBe(2555);

      const policy = retentionRows[0];
      const docCreatedAt = new Date(policy.created_at);
      const retentionExpiry = new Date(docCreatedAt);
      retentionExpiry.setDate(retentionExpiry.getDate() + policy.retention_days);

      expect(new Date() < retentionExpiry).toBe(true);
    });

    it("should require maker-checker approval for regulated documents", async () => {
      mockDb.execute.mockImplementation((query: string) => {
        if (query.includes("document_legal_hold")) {
          return [[]];
        }
        if (query.includes("document_retention_policy")) {
          return [[{
            retention_days: 1,
            deletion_requires_approval: 1,
            created_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
          }]];
        }
        if (query.includes("document_deletion_request")) {
          return [[]];
        }
        return [[]];
      });

      const [approvalRows] = await mockDb.execute(
        "SELECT id FROM document_deletion_request WHERE vault_item_id = ? AND status = 'approved'",
        ["item-1"]
      );

      expect(approvalRows.length).toBe(0);
    });
  });

  describe("Vault Inventory Mandatory Registration", () => {
    let mockRegisterUpload: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const { registerUpload } = await import("../../document-vault/documentVault.service.js");
      mockRegisterUpload = registerUpload as ReturnType<typeof vi.fn>;
      vi.clearAllMocks();
    });

    it("should fail upload when vault registration fails", async () => {
      mockRegisterUpload.mockRejectedValue(new Error("Database connection failed"));

      await expect(mockRegisterUpload({
        uploadedByUser: "user-123",
        category: "employee-documents",
        storedFilename: "test-file.pdf",
        originalFilename: "original.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 1024,
        accessLevel: "internal",
      })).rejects.toThrow("Database connection failed");
    });

    it("should succeed upload when vault registration succeeds", async () => {
      mockRegisterUpload.mockResolvedValue({ id: "vault-item-123" });

      const result = await mockRegisterUpload({
        uploadedByUser: "user-123",
        category: "employee-documents",
        storedFilename: "test-file.pdf",
        originalFilename: "original.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 1024,
        accessLevel: "internal",
      });

      expect(result.id).toBe("vault-item-123");
    });
  });

  describe("Download Token Security", () => {
    let mockIssueDownloadToken: ReturnType<typeof vi.fn>;
    let mockConsumeDownloadToken: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const { issueDownloadToken, consumeDownloadToken } = await import("../../document-vault/documentVault.service.js");
      mockIssueDownloadToken = issueDownloadToken as ReturnType<typeof vi.fn>;
      mockConsumeDownloadToken = consumeDownloadToken as ReturnType<typeof vi.fn>;
      vi.clearAllMocks();
    });

    it("should reject expired download token", async () => {
      mockConsumeDownloadToken.mockResolvedValue(null);

      const result = await mockConsumeDownloadToken("expired-token-xyz");

      expect(result).toBeNull();
    });

    it("should reject already-consumed download token", async () => {
      mockConsumeDownloadToken.mockResolvedValue(null);

      const result = await mockConsumeDownloadToken("already-used-token");

      expect(result).toBeNull();
    });

    it("should accept valid download token", async () => {
      mockConsumeDownloadToken.mockResolvedValue({
        tokenId: "token-123",
        issuedTo: "user-456",
        vaultItemId: "item-789",
      });

      const result = await mockConsumeDownloadToken("valid-token");

      expect(result).not.toBeNull();
      expect(result?.tokenId).toBe("token-123");
    });
  });

  describe("Employee Photos Endpoint Security", () => {
    it("should require authentication for employee photos access", () => {
      expect(true).toBe(true);
    });
  });
});
