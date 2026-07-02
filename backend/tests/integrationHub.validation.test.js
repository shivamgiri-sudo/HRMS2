import { describe, it, expect } from "vitest";
import { createIntegrationSchema, updateIntegrationSchema, confirmFieldMapSchema, runFiltersSchema, } from "../src/modules/integration-hub/integration.validation.js";
describe("createIntegrationSchema", () => {
    const valid = {
        integrationKey: "dialer_3",
        integrationName: "Dialer 3",
        integrationType: "rest_pull",
    };
    it("accepts minimal valid input", () => {
        const result = createIntegrationSchema.parse(valid);
        expect(result.integrationKey).toBe("dialer_3");
    });
    it("rejects missing integrationKey", () => {
        expect(() => createIntegrationSchema.parse({ ...valid, integrationKey: undefined })).toThrow();
    });
    it("rejects integrationKey shorter than 2 chars", () => {
        expect(() => createIntegrationSchema.parse({ ...valid, integrationKey: "x" })).toThrow();
    });
    it("rejects invalid integrationType", () => {
        expect(() => createIntegrationSchema.parse({ ...valid, integrationType: "ftp" })).toThrow();
    });
    it("accepts all valid integrationType values", () => {
        const types = ["rest_pull", "rest_push", "database", "sftp", "file_upload"];
        for (const t of types) {
            expect(() => createIntegrationSchema.parse({ ...valid, integrationType: t })).not.toThrow();
        }
    });
    it("accepts optional fields", () => {
        const result = createIntegrationSchema.parse({
            ...valid,
            vendorName: "Acme",
            baseUrl: "https://api.acme.com",
            authType: "api_key",
            secretName: "acme_secret",
            notes: "test connector",
        });
        expect(result.vendorName).toBe("Acme");
        expect(result.secretName).toBe("acme_secret");
    });
    it("trims whitespace from integrationKey and integrationName", () => {
        const result = createIntegrationSchema.parse({
            ...valid,
            integrationKey: "  dialer_3  ",
            integrationName: "  Dialer 3  ",
        });
        expect(result.integrationKey).toBe("dialer_3");
        expect(result.integrationName).toBe("Dialer 3");
    });
});
describe("updateIntegrationSchema", () => {
    it("accepts empty object", () => {
        expect(() => updateIntegrationSchema.parse({})).not.toThrow();
    });
    it("accepts activeStatus boolean", () => {
        const result = updateIntegrationSchema.parse({ activeStatus: false });
        expect(result.activeStatus).toBe(false);
    });
    it("rejects invalid integrationType when provided", () => {
        expect(() => updateIntegrationSchema.parse({ integrationType: "bad" })).toThrow();
    });
});
describe("confirmFieldMapSchema", () => {
    it("requires integrationKey, sourceField, targetTable, targetColumn", () => {
        expect(() => confirmFieldMapSchema.parse({})).toThrow();
        expect(() => confirmFieldMapSchema.parse({
            integrationKey: "dialer_1",
            sourceField: "emp_id",
            targetTable: "employees",
            targetColumn: "employee_code",
        })).not.toThrow();
    });
    it("accepts optional transform", () => {
        const result = confirmFieldMapSchema.parse({
            integrationKey: "dialer_1",
            sourceField: "emp_id",
            targetTable: "employees",
            targetColumn: "employee_code",
            transform: "UPPER(value)",
        });
        expect(result.transform).toBe("UPPER(value)");
    });
});
describe("runFiltersSchema", () => {
    it("defaults to first page, 20 per page", () => {
        const result = runFiltersSchema.parse({});
        expect(result.page).toBe(1);
        expect(result.limit).toBe(20);
    });
    it("accepts integrationKey filter", () => {
        const result = runFiltersSchema.parse({ integrationKey: "dialer_1" });
        expect(result.integrationKey).toBe("dialer_1");
    });
    it("accepts status filter", () => {
        const result = runFiltersSchema.parse({ status: "complete" });
        expect(result.status).toBe("complete");
    });
    it("rejects limit greater than 100", () => {
        expect(() => runFiltersSchema.parse({ limit: 200 })).toThrow();
    });
    it("rejects page less than 1", () => {
        expect(() => runFiltersSchema.parse({ page: 0 })).toThrow();
    });
});
